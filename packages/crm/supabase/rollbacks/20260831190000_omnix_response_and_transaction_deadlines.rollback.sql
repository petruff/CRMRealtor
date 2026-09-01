-- Non-destructive containment rollback for inbound-response intelligence and
-- transaction deadlines. Evidence and domain types remain readable while all
-- feature mutations and automatic capture are disabled.
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

alter table connector_private.google_gmail_resources
  disable trigger google_gmail_resource_capture_omnix_response;
alter table public.real_estate_transactions
  disable trigger real_estate_transaction_seed_closing_milestone;

comment on table public.omnix_inbound_response_signals is
  'Inbound response intelligence retained in read-only recovery mode; apply the paired forward repair before capture resumes.';
comment on table public.transaction_milestones is
  'Transaction deadline evidence retained in read-only recovery mode; apply the paired forward repair before mutation resumes.';

commit;
