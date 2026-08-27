#!/usr/bin/env bash
set -euo pipefail

SUPABASE_CLI_VERSION="2.90.0"
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

ensure_local_database_ready() {
  local attempt

  # `supabase test db` runs pg_prove in a sibling container. On a cold hosted
  # runner the local Postgres container can briefly stop when that container
  # exits, so reassert the stack and wait before the recovery rehearsal.
  npx --yes "supabase@${SUPABASE_CLI_VERSION}" start >/dev/null
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
    if psql "${local_database_url}" --set ON_ERROR_STOP=1 --command 'select 1' >/dev/null 2>&1; then
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

npx --yes "supabase@${SUPABASE_CLI_VERSION}" start
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

npx --yes "supabase@${SUPABASE_CLI_VERSION}" test db "${TEST_DIRECTORY}" --local

if (( ${#candidate_migrations[@]} > 0 )); then
  ensure_local_database_ready
  echo "Rehearsing containment rollback for ${#candidate_migrations[@]} candidate migration(s)."
  for (( index=${#candidate_migrations[@]}-1; index>=0; index-- )); do
    migration_name="$(basename "${candidate_migrations[index]}" .sql)"
    psql "${local_database_url}" \
      --set ON_ERROR_STOP=1 --file "${ROLLBACK_DIRECTORY}/${migration_name}.rollback.sql"
  done

  echo "Rehearsing forward repair in migration order."
  for migration_path in "${candidate_migrations[@]}"; do
    migration_name="$(basename "${migration_path}" .sql)"
    psql "${local_database_url}" \
      --set ON_ERROR_STOP=1 --file "${ROLLBACK_DIRECTORY}/${migration_name}.forward-repair.sql"
  done

  echo "Running pgTAP after rollback and forward-repair recovery."
  npx --yes "supabase@${SUPABASE_CLI_VERSION}" test db "${TEST_DIRECTORY}" --local
else
  echo "No candidate migrations differ from MIGRATION_BASE_SHA; recovery rehearsal has no candidate target."
fi
