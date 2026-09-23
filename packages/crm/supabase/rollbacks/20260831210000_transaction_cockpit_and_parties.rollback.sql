-- Story 7.1 uses a non-destructive feature deactivation rollback. The additive
-- schema and append-only evidence remain readable; new transaction, transition,
-- and party mutations are disabled until the paired forward repair is applied.
begin;
revoke all on function public.create_real_estate_transaction_v2(uuid,uuid,uuid,public.real_estate_transaction_kind,text,
  public.real_estate_transaction_status,public.real_estate_transaction_side,text,date,date,bigint,bigint,bigint,bigint,
  bigint,uuid,text,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.transition_real_estate_transaction(uuid,uuid,uuid,integer,
  public.real_estate_transaction_status,date,text,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.add_transaction_party(uuid,uuid,uuid,uuid,public.transaction_party_role,text,boolean,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.update_real_estate_transaction(uuid,uuid,uuid,integer,public.real_estate_transaction_kind,text,
  public.real_estate_transaction_side,text,date,bigint,bigint,bigint,bigint,bigint,text,timestamptz,text,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.update_transaction_party(uuid,uuid,uuid,integer,public.transaction_party_role,text,boolean,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.archive_transaction_party(uuid,uuid,uuid,integer,text,text,timestamptz)
  from public,anon,authenticated,service_role;
comment on table public.real_estate_transactions is
  'Story 7.1 data retained in read-only recovery mode; use the paired forward repair to restore governed mutation.';
commit;
