begin;
grant execute on function public.read_workspace_ai_runtime_envelope(uuid,uuid,uuid) to service_role;
grant execute on function public.reserve_omnix_ai_budget(uuid,uuid,uuid,text,integer,integer,integer) to authenticated;
grant execute on function public.finalize_omnix_ai_budget(uuid,uuid,uuid,text,integer,integer,integer,text) to authenticated;
grant select on table public.omnix_ai_usage_windows,public.omnix_ai_runs to authenticated;
drop policy if exists omnix_ai_usage_windows_member_select on public.omnix_ai_usage_windows;
create policy omnix_ai_usage_windows_member_select on public.omnix_ai_usage_windows
  for select to authenticated using(public.has_workspace_access(workspace_id));
drop policy if exists omnix_ai_runs_member_select on public.omnix_ai_runs;
create policy omnix_ai_runs_member_select on public.omnix_ai_runs
  for select to authenticated using(public.has_workspace_access(workspace_id));
commit;
