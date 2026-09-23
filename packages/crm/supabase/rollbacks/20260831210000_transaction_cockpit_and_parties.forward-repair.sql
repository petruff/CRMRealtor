-- Fail-closed forward repair for Story 7.1 authority and evidence grants.
begin;
alter table public.transaction_parties enable row level security;
alter table public.transaction_parties force row level security;
alter table public.transaction_events enable row level security;
alter table public.transaction_events force row level security;
revoke all on table public.transaction_parties,public.transaction_events from public,anon,authenticated;
grant select on table public.transaction_parties,public.transaction_events to authenticated;
revoke all on function public.reject_transaction_event_mutation() from public,anon,authenticated,service_role;
revoke all on function public.create_real_estate_transaction(
  uuid,uuid,uuid,public.real_estate_transaction_status,public.real_estate_transaction_side,
  text,date,date,bigint,bigint,bigint,bigint,bigint,uuid
) from public,anon,authenticated,service_role;
revoke all on function public.create_real_estate_transaction_v2(uuid,uuid,uuid,public.real_estate_transaction_kind,text,
  public.real_estate_transaction_status,public.real_estate_transaction_side,text,date,date,bigint,bigint,bigint,bigint,
  bigint,uuid,text,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_real_estate_transaction_v2(uuid,uuid,uuid,public.real_estate_transaction_kind,text,
  public.real_estate_transaction_status,public.real_estate_transaction_side,text,date,date,bigint,bigint,bigint,bigint,
  bigint,uuid,text,timestamptz,uuid) to authenticated,service_role;
revoke all on function public.transition_real_estate_transaction(uuid,uuid,uuid,integer,
  public.real_estate_transaction_status,date,text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.transition_real_estate_transaction(uuid,uuid,uuid,integer,
  public.real_estate_transaction_status,date,text,text,timestamptz) to authenticated,service_role;
revoke all on function public.add_transaction_party(uuid,uuid,uuid,uuid,public.transaction_party_role,text,boolean,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.add_transaction_party(uuid,uuid,uuid,uuid,public.transaction_party_role,text,boolean,text,timestamptz)
  to authenticated,service_role;
revoke all on function public.update_real_estate_transaction(uuid,uuid,uuid,integer,public.real_estate_transaction_kind,text,
  public.real_estate_transaction_side,text,date,bigint,bigint,bigint,bigint,bigint,text,timestamptz,text,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.update_real_estate_transaction(uuid,uuid,uuid,integer,public.real_estate_transaction_kind,text,
  public.real_estate_transaction_side,text,date,bigint,bigint,bigint,bigint,bigint,text,timestamptz,text,text,timestamptz)
  to authenticated,service_role;
revoke all on function public.update_transaction_party(uuid,uuid,uuid,integer,public.transaction_party_role,text,boolean,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.update_transaction_party(uuid,uuid,uuid,integer,public.transaction_party_role,text,boolean,text,timestamptz)
  to authenticated,service_role;
revoke all on function public.archive_transaction_party(uuid,uuid,uuid,integer,text,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.archive_transaction_party(uuid,uuid,uuid,integer,text,text,timestamptz)
  to authenticated,service_role;
commit;
