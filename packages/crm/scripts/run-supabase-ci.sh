#!/usr/bin/env bash
set -euo pipefail

SUPABASE_CLI_VERSION="2.90.0"
SUPABASE_DATABASE_ONLY_EXCLUDES="gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor"
MIGRATION_DIRECTORY="supabase/migrations"
ROLLBACK_DIRECTORY="supabase/rollbacks"
TEST_DIRECTORY="supabase/tests"
MIGRATION_BASE_SHA="${MIGRATION_BASE_SHA:-}"
MIGRATION_CANDIDATE_SHA="${MIGRATION_CANDIDATE_SHA:-HEAD}"
stack_started=false
local_database_url=""

cleanup() {
  if [[ "${stack_started}" == "true" ]]; then
    npx --yes "supabase@${SUPABASE_CLI_VERSION}" stop --no-backup >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

print_database_diagnostics() {
  local database_container
  database_container="$(docker ps -a --filter 'name=supabase_db_' --format '{{.ID}}' | head -n 1)"
  echo "Supabase database test failed; collecting bounded database diagnostics." >&2
  docker stats --no-stream >&2 || true
  if [[ -n "${database_container}" ]]; then
    docker logs --tail 200 "${database_container}" >&2 || true
  fi
}

database_container_id() {
  docker ps --filter 'name=supabase_db_' --format '{{.ID}}' | head -n 1
}

database_psql() {
  local database_container
  if command -v psql >/dev/null 2>&1; then
    psql "${local_database_url}" "$@"
    return
  fi
  database_container="$(database_container_id)"
  if [[ -z "${database_container}" ]]; then
    return 1
  fi
  docker exec -i "${database_container}" psql -U postgres -d postgres "$@"
}

run_database_tests() {
  local assertion_count=0
  local expected_assertions
  local file_assertions
  local file_count=0
  local plan_line
  local test_error
  local test_file
  local test_output

  # The Supabase pg_prove helper container has repeatedly triggered a
  # PostgreSQL 17 SIGSEGV on constrained hosted runners late in this suite.
  # Execute every pgTAP file in its own deterministic session instead, disable
  # JIT only for that session, and verify both its TAP plan and every assertion.
  database_psql --no-psqlrc --set ON_ERROR_STOP=1 \
    --command "create extension if not exists pgtap with schema extensions" >/dev/null
  while IFS= read -r test_file; do
    test_output="$(mktemp)"
    test_error="$(mktemp)"
    if ! {
      printf '%s\n' "set jit = off;"
      cat "${test_file}"
    } | database_psql --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 \
      >"${test_output}" 2>"${test_error}"; then
      echo "Database test failed: ${test_file}" >&2
      cat "${test_output}" >&2
      cat "${test_error}" >&2
      print_database_diagnostics
      return 1
    fi
    if grep -Eq '^not ok([[:space:]]|$)' "${test_output}"; then
      echo "Database assertion failed: ${test_file}" >&2
      cat "${test_output}" >&2
      cat "${test_error}" >&2
      return 1
    fi
    plan_line="$(grep -E '^1\.\.[0-9]+$' "${test_output}" | tail -n 1 || true)"
    if [[ -z "${plan_line}" ]]; then
      echo "Database test emitted no pgTAP plan: ${test_file}" >&2
      cat "${test_output}" >&2
      cat "${test_error}" >&2
      return 1
    fi
    expected_assertions="${plan_line#1..}"
    file_assertions="$(grep -Ec '^ok[[:space:]]+[0-9]+' "${test_output}" || true)"
    if [[ "${file_assertions}" -ne "${expected_assertions}" ]]; then
      echo "Database TAP plan mismatch in ${test_file}: expected ${expected_assertions}, observed ${file_assertions}." >&2
      cat "${test_output}" >&2
      cat "${test_error}" >&2
      return 1
    fi
    file_count=$((file_count + 1))
    assertion_count=$((assertion_count + file_assertions))
    printf '%s ok (%d assertions)\n' "${test_file}" "${file_assertions}"
    rm -f "${test_output}" "${test_error}"
  done < <(find "${TEST_DIRECTORY}" -maxdepth 1 -type f -name '*.sql' -print | sort)

  if (( file_count == 0 || assertion_count == 0 )); then
    echo "Database test discovery returned no executable pgTAP assertions." >&2
    return 1
  fi
  printf 'Database tests passed: %d files, %d assertions.\n' "${file_count}" "${assertion_count}"
}

ensure_local_database_ready() {
  local attempt

  # `supabase test db` runs pg_prove in a sibling container and can remove the
  # database while the CLI still reports a running stack. Recreate the bounded
  # database-only stack so recovery never depends on stale container state.
  npx --yes "supabase@${SUPABASE_CLI_VERSION}" stop --no-backup >/dev/null 2>&1 || true
  stack_started=false
  npx --yes "supabase@${SUPABASE_CLI_VERSION}" start --exclude "${SUPABASE_DATABASE_ONLY_EXCLUDES}" >/dev/null
  stack_started=true
  local_database_url="$(
    npx --yes "supabase@${SUPABASE_CLI_VERSION}" status -o json |
      node -e '
        let input = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => { input += chunk; });
        process.stdin.on("end", () => {
          const status = JSON.parse(input);
          const databaseUrl = status.DB_URL ?? status.db_url;
          if (typeof databaseUrl !== "string" || !databaseUrl.startsWith("postgresql://")) {
            process.exit(1);
          }
          process.stdout.write(databaseUrl);
        });
      '
  )"
  for attempt in $(seq 1 30); do
    if database_psql --set ON_ERROR_STOP=1 --command 'select 1' >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  echo "Local Supabase database did not become ready for recovery rehearsal." >&2
  npx --yes "supabase@${SUPABASE_CLI_VERSION}" status >&2 || true
  return 1
}

if [[ -z "${MIGRATION_BASE_SHA}" ]]; then
  echo "MIGRATION_BASE_SHA is required so candidate rollback rehearsal cannot silently skip migrations." >&2
  exit 1
fi
if ! git cat-file -e "${MIGRATION_BASE_SHA}^{commit}" 2>/dev/null; then
  echo "MIGRATION_BASE_SHA is not an available commit." >&2
  exit 1
fi
if ! git cat-file -e "${MIGRATION_CANDIDATE_SHA}^{commit}" 2>/dev/null; then
  echo "MIGRATION_CANDIDATE_SHA is not an available commit." >&2
  exit 1
fi
if [[ "$(git rev-parse "${MIGRATION_BASE_SHA}^{commit}")" == "$(git rev-parse "${MIGRATION_CANDIDATE_SHA}^{commit}")" ]] \
  || ! git merge-base --is-ancestor "${MIGRATION_BASE_SHA}" "${MIGRATION_CANDIDATE_SHA}"; then
  echo "MIGRATION_BASE_SHA must be a strict ancestor of MIGRATION_CANDIDATE_SHA; equal, descendant, and sibling commits are forbidden." >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
package_prefix="$(git rev-parse --show-prefix)"
package_prefix="${package_prefix%/}"
if [[ -z "${package_prefix}" ]]; then package_prefix="."; fi

mapfile -t migration_changes < <(
  git -C "${repo_root}" diff --name-status --find-renames "${MIGRATION_BASE_SHA}" "${MIGRATION_CANDIDATE_SHA}" -- \
    "${package_prefix}/${MIGRATION_DIRECTORY}"
)
candidate_migrations=()
for migration_change in "${migration_changes[@]}"; do
  IFS=$'\t' read -r change_status first_path second_path <<< "${migration_change}"
  case "${change_status}" in
    A|M)
      candidate_path="${first_path#${package_prefix}/}"
      if [[ ! "${candidate_path}" =~ ^supabase/migrations/[^/]+\.sql$ ]]; then
        echo "Migration tree differs without a candidate migration SQL file: ${first_path}." >&2
        exit 1
      fi
      candidate_migrations+=("${candidate_path}")
      ;;
    D*)
      echo "Migration deletion is forbidden: ${first_path}." >&2
      exit 1
      ;;
    R*)
      echo "Migration rename is forbidden: ${first_path} -> ${second_path}." >&2
      exit 1
      ;;
    *)
      echo "Unsupported migration tree change ${change_status}: ${first_path}." >&2
      exit 1
      ;;
  esac
done
if (( ${#migration_changes[@]} > 0 && ${#candidate_migrations[@]} == 0 )); then
  echo "Migration tree differs but no candidate migration was selected." >&2
  exit 1
fi
mapfile -t candidate_migrations < <(printf '%s\n' "${candidate_migrations[@]}" | sed '/^$/d' | sort)

for migration_path in "${candidate_migrations[@]}"; do
  migration_name="$(basename "${migration_path}" .sql)"
  for recovery_kind in rollback forward-repair; do
    recovery_path="${ROLLBACK_DIRECTORY}/${migration_name}.${recovery_kind}.sql"
    if [[ ! -f "${recovery_path}" ]]; then
      echo "Candidate migration ${migration_path} is missing ${recovery_path}." >&2
      exit 1
    fi
  done
done

versions_file="$(mktemp)"
while IFS= read -r migration_path; do
  migration_name="$(basename "${migration_path}" .sql)"
  printf '%s\n' "${migration_name%%_*}" >> "${versions_file}"
done < <(find "${MIGRATION_DIRECTORY}" -maxdepth 1 -type f -name '*.sql' -print | sort)
duplicate_versions="$(sort "${versions_file}" | uniq -d)"
if [[ -n "${duplicate_versions}" ]]; then
  echo "Migration history contains duplicate versions:" >&2
  printf '%s\n' "${duplicate_versions}" >&2
  exit 1
fi

if [[ "${SUPABASE_CI_RECOVERY_PLAN_ONLY:-false}" == "true" ]]; then
  printf 'Candidate migration recovery plan (%d):\n' "${#candidate_migrations[@]}"
  printf '%s\n' "${candidate_migrations[@]}"
  exit 0
fi

npx --yes "supabase@${SUPABASE_CLI_VERSION}" start --exclude "${SUPABASE_DATABASE_ONLY_EXCLUDES}"
stack_started=true
npx --yes "supabase@${SUPABASE_CLI_VERSION}" db reset --local

history_file="$(mktemp)"
npx --yes "supabase@${SUPABASE_CLI_VERSION}" migration list --local | tee "${history_file}"
while IFS= read -r migration_path; do
  migration_name="$(basename "${migration_path}" .sql)"
  migration_version="${migration_name%%_*}"
  if ! grep -Eq "(^|[[:space:]|])${migration_version}([[:space:]|]|$)" "${history_file}"; then
    echo "Migration history is missing ${migration_version} from ${migration_path}." >&2
    exit 1
  fi
done < <(find "${MIGRATION_DIRECTORY}" -maxdepth 1 -type f -name '*.sql' -print | sort)

run_database_tests

if (( ${#candidate_migrations[@]} > 0 )); then
  ensure_local_database_ready
  echo "Rehearsing containment rollback for ${#candidate_migrations[@]} candidate migration(s)."
  for (( index=${#candidate_migrations[@]}-1; index>=0; index-- )); do
    migration_name="$(basename "${candidate_migrations[index]}" .sql)"
    database_psql --set ON_ERROR_STOP=1 \
      < "${ROLLBACK_DIRECTORY}/${migration_name}.rollback.sql"
  done

  echo "Rehearsing forward repair in migration order."
  for migration_path in "${candidate_migrations[@]}"; do
    migration_name="$(basename "${migration_path}" .sql)"
    database_psql --set ON_ERROR_STOP=1 \
      < "${ROLLBACK_DIRECTORY}/${migration_name}.forward-repair.sql"
  done

  echo "Running pgTAP after rollback and forward-repair recovery."
  run_database_tests
else
  echo "No candidate migrations differ from MIGRATION_BASE_SHA; recovery rehearsal has no candidate target."
fi
