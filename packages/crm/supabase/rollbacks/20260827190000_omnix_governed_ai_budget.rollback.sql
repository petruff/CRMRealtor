begin;
revoke execute on function public.read_workspace_ai_runtime_envelope(uuid,uuid,uuid) from service_role;
revoke execute on function public.finalize_omnix_ai_budget(uuid,uuid,uuid,text,integer,integer,integer,text) from authenticated;
revoke execute on function public.reserve_omnix_ai_budget(uuid,uuid,uuid,text,integer,integer,integer) from authenticated;
revoke select on table public.omnix_ai_usage_windows,public.omnix_ai_runs from authenticated;
drop policy if exists omnix_ai_runs_member_select on public.omnix_ai_runs;
drop policy if exists omnix_ai_usage_windows_member_select on public.omnix_ai_usage_windows;
-- Preserve run and budget evidence during rollback. Provider dispatch becomes unavailable because execute grants are removed.
commit;
