begin;

revoke all on function public.start_transaction_workflow_plan(uuid,uuid,uuid,uuid,uuid,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.transition_transaction_workflow_step(uuid,uuid,uuid,integer,public.workflow_step_state,text,boolean,text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.start_transaction_workflow_plan(uuid,uuid,uuid,uuid,uuid,text,timestamptz) to authenticated,service_role;
grant execute on function public.transition_transaction_workflow_step(uuid,uuid,uuid,integer,public.workflow_step_state,text,boolean,text,text,timestamptz) to authenticated,service_role;

commit;
