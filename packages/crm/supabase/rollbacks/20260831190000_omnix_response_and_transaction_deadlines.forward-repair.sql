-- Restore the governed capabilities disabled by the paired containment rollback.
begin;

revoke all on function public.record_omnix_inbound_response_intelligence(uuid,uuid,bigint,text,text,text,text,text,text,text,text,text,text[],timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.reserve_omnix_ai_service_budget(uuid,uuid,uuid,text,integer,integer,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.finalize_omnix_ai_service_budget(uuid,uuid,uuid,text,integer,integer,integer,text)
  from public,anon,authenticated,service_role;
revoke all on function public.create_transaction_milestone(uuid,uuid,uuid,public.transaction_milestone_kind,text,timestamptz,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.transition_transaction_milestone(uuid,uuid,uuid,integer,public.transaction_milestone_state,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.acknowledge_omnix_inbound_response(uuid,uuid,uuid,timestamptz)
  from public,anon,authenticated,service_role;

grant execute on function public.record_omnix_inbound_response_intelligence(uuid,uuid,bigint,text,text,text,text,text,text,text,text,text,text[],timestamptz)
  to service_role;
grant execute on function public.reserve_omnix_ai_service_budget(uuid,uuid,uuid,text,integer,integer,integer)
  to service_role;
grant execute on function public.finalize_omnix_ai_service_budget(uuid,uuid,uuid,text,integer,integer,integer,text)
  to service_role;
grant execute on function public.create_transaction_milestone(uuid,uuid,uuid,public.transaction_milestone_kind,text,timestamptz,text,timestamptz)
  to authenticated,service_role;
grant execute on function public.transition_transaction_milestone(uuid,uuid,uuid,integer,public.transaction_milestone_state,text,timestamptz)
  to authenticated,service_role;
grant execute on function public.acknowledge_omnix_inbound_response(uuid,uuid,uuid,timestamptz)
  to authenticated,service_role;

alter table connector_private.google_gmail_resources
  enable trigger google_gmail_resource_capture_omnix_response;
alter table public.real_estate_transactions
  enable trigger real_estate_transaction_seed_closing_milestone;

comment on table public.omnix_inbound_response_signals is
  'Governed inbound response intelligence with immutable evidence and explicit acknowledgement.';
comment on table public.transaction_milestones is
  'Governed transaction deadlines with versioned state and append-only evidence.';

commit;
