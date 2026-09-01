-- Story 7.3: sourced, versioned transaction economics without zero-filled financial truth.
begin;

create table public.transaction_financial_authorities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  transaction_id uuid not null,
  transaction_value_cents bigint,
  volume_basis_cents bigint,
  gross_commission_cents bigint,
  brokerage_split_cents bigint,
  referral_fee_cents bigint,
  net_commission_cents bigint,
  marketing_cost_cents bigint,
  other_expense_cents bigint,
  source_type text not null,
  source_reference text not null,
  effective_date date not null,
  verification_state text not null,
  current_version integer not null default 1,
  updated_by_membership_id uuid not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint transaction_financial_authority_transaction_workspace_fk foreign key(transaction_id,workspace_id)
    references public.real_estate_transactions(id,workspace_id) on delete restrict,
  constraint transaction_financial_authority_member_workspace_fk foreign key(updated_by_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint transaction_financial_authority_transaction_unique unique(workspace_id,transaction_id),
  constraint transaction_financial_authority_id_workspace_unique unique(id,workspace_id),
  constraint transaction_financial_authority_money_nonnegative check (
    (transaction_value_cents is null or transaction_value_cents>=0) and (volume_basis_cents is null or volume_basis_cents>=0)
    and (gross_commission_cents is null or gross_commission_cents>=0) and (brokerage_split_cents is null or brokerage_split_cents>=0)
    and (referral_fee_cents is null or referral_fee_cents>=0) and (net_commission_cents is null or net_commission_cents>=0)
    and (marketing_cost_cents is null or marketing_cost_cents>=0) and (other_expense_cents is null or other_expense_cents>=0)),
  constraint transaction_financial_authority_source_type check(source_type in (
    'closing-statement','brokerage-statement','referral-agreement','expense-receipt','manual-record','legacy-transaction')),
  constraint transaction_financial_authority_source_present check(length(trim(source_reference)) between 1 and 240),
  constraint transaction_financial_authority_verification check(verification_state in ('unverified','verified','contradictory')),
  constraint transaction_financial_authority_version_positive check(current_version>0)
);

create table public.transaction_financial_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  financial_authority_id uuid not null,
  transaction_id uuid not null,
  actor_membership_id uuid not null,
  from_version integer,
  to_version integer not null,
  reason_code text not null,
  from_snapshot jsonb,
  to_snapshot jsonb not null,
  idempotency_key text not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null,
  constraint transaction_financial_events_authority_workspace_fk foreign key(financial_authority_id,workspace_id)
    references public.transaction_financial_authorities(id,workspace_id) on delete restrict,
  constraint transaction_financial_events_transaction_workspace_fk foreign key(transaction_id,workspace_id)
    references public.real_estate_transactions(id,workspace_id) on delete restrict,
  constraint transaction_financial_events_actor_workspace_fk foreign key(actor_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint transaction_financial_events_idempotency_unique unique(workspace_id,idempotency_key),
  constraint transaction_financial_events_reason_present check(length(trim(reason_code)) between 1 and 80),
  constraint transaction_financial_events_snapshots check((from_snapshot is null or jsonb_typeof(from_snapshot)='object') and jsonb_typeof(to_snapshot)='object')
);
create index transaction_financial_events_transaction_idx on public.transaction_financial_events(workspace_id,transaction_id,occurred_at desc,id desc);

create or replace function public.reject_transaction_financial_event_mutation()
returns trigger language plpgsql security definer set search_path='' as $$
begin raise exception 'transaction financial history is append-only' using errcode='55000'; end $$;
create trigger transaction_financial_events_no_mutation before update or delete on public.transaction_financial_events
for each row execute function public.reject_transaction_financial_event_mutation();

alter table public.transaction_financial_authorities enable row level security;
alter table public.transaction_financial_authorities force row level security;
alter table public.transaction_financial_events enable row level security;
alter table public.transaction_financial_events force row level security;
create policy transaction_financial_authorities_member_select on public.transaction_financial_authorities
for select to authenticated using(public.has_workspace_access(workspace_id));
create policy transaction_financial_events_member_select on public.transaction_financial_events
for select to authenticated using(public.has_workspace_access(workspace_id));
revoke all on table public.transaction_financial_authorities,public.transaction_financial_events from public,anon,authenticated;
grant select on table public.transaction_financial_authorities,public.transaction_financial_events to authenticated;
grant all on table public.transaction_financial_authorities,public.transaction_financial_events to service_role;
revoke all on sequence public.transaction_financial_events_id_seq from public,anon,authenticated;
grant all on sequence public.transaction_financial_events_id_seq to service_role;

insert into public.transaction_financial_authorities(
  workspace_id,transaction_id,transaction_value_cents,volume_basis_cents,gross_commission_cents,net_commission_cents,
  marketing_cost_cents,other_expense_cents,source_type,source_reference,effective_date,verification_state,
  updated_by_membership_id,created_at,updated_at)
select t.workspace_id,t.id,nullif(t.sale_price_cents,0),nullif(t.sale_price_cents,0),nullif(t.gross_commission_cents,0),
  nullif(t.net_commission_cents,0),nullif(t.marketing_cost_cents,0),nullif(t.expense_cents,0),
  'legacy-transaction','Legacy transaction financial fields',coalesce(t.closed_at,t.expected_close_date,t.created_at::date),
  'unverified',t.created_by_membership_id,t.created_at,t.updated_at
from public.real_estate_transactions t
where t.sale_price_cents<>0 or t.gross_commission_cents<>0 or t.net_commission_cents<>0
  or t.marketing_cost_cents<>0 or t.expense_cents<>0;

insert into public.transaction_financial_events(workspace_id,financial_authority_id,transaction_id,actor_membership_id,
  from_version,to_version,reason_code,from_snapshot,to_snapshot,idempotency_key,occurred_at,created_at)
select f.workspace_id,f.id,f.transaction_id,f.updated_by_membership_id,null,1,'legacy-backfill',null,to_jsonb(f),
  'finance:legacy:'||f.transaction_id::text,f.created_at,f.created_at
from public.transaction_financial_authorities f;

create or replace function public.upsert_transaction_financial_authority(
  target_workspace_id uuid,target_membership_id uuid,target_transaction_id uuid,target_expected_version integer,
  target_transaction_value_cents bigint,target_volume_basis_cents bigint,target_gross_commission_cents bigint,
  target_brokerage_split_cents bigint,target_referral_fee_cents bigint,target_net_commission_cents bigint,
  target_marketing_cost_cents bigint,target_other_expense_cents bigint,target_source_type text,target_source_reference text,
  target_effective_date date,target_verification_state text,target_reason_code text,target_idempotency_key text,target_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_record public.transaction_financial_authorities%rowtype;
  replay public.transaction_financial_events%rowtype; updated public.transaction_financial_authorities%rowtype;
  prior jsonb; next_snapshot jsonb;
begin
  perform public.assert_crm_actor_membership(target_membership_id,target_workspace_id);
  if target_expected_version<0 or target_effective_date is null or target_occurred_at is null
    or target_source_type not in ('closing-statement','brokerage-statement','referral-agreement','expense-receipt','manual-record','legacy-transaction')
    or length(trim(target_source_reference)) not between 1 and 240 or trim(target_source_reference) ~ '[[:cntrl:]]'
    or target_verification_state not in ('unverified','verified') or length(trim(target_reason_code)) not between 1 and 80
    or target_idempotency_key !~ '^[A-Za-z0-9._:-]{1,160}$'
    or (select bool_or(value<0) from unnest(array[target_transaction_value_cents,target_volume_basis_cents,target_gross_commission_cents,
      target_brokerage_split_cents,target_referral_fee_cents,target_net_commission_cents,target_marketing_cost_cents,target_other_expense_cents]) value) then
    raise exception 'invalid transaction financial authority request' using errcode='22023'; end if;
  select * into replay from public.transaction_financial_events where workspace_id=target_workspace_id and idempotency_key=target_idempotency_key;
  if found then return jsonb_build_object('financialAuthorityId',replay.financial_authority_id,'version',replay.to_version,'noOp',true); end if;
  perform 1 from public.real_estate_transactions where id=target_transaction_id and workspace_id=target_workspace_id for share;
  if not found then raise exception 'transaction not found' using errcode='P0002'; end if;
  select * into current_record from public.transaction_financial_authorities where workspace_id=target_workspace_id
    and transaction_id=target_transaction_id for update;
  if found and current_record.current_version<>target_expected_version then raise exception 'financial version is stale' using errcode='40001'; end if;
  if not found and target_expected_version<>0 then raise exception 'financial version is stale' using errcode='40001'; end if;
  prior:=case when found then to_jsonb(current_record) else null end;
  if found then
    update public.transaction_financial_authorities set transaction_value_cents=target_transaction_value_cents,
      volume_basis_cents=target_volume_basis_cents,gross_commission_cents=target_gross_commission_cents,
      brokerage_split_cents=target_brokerage_split_cents,referral_fee_cents=target_referral_fee_cents,
      net_commission_cents=target_net_commission_cents,marketing_cost_cents=target_marketing_cost_cents,
      other_expense_cents=target_other_expense_cents,source_type=target_source_type,source_reference=trim(target_source_reference),
      effective_date=target_effective_date,verification_state=target_verification_state,current_version=current_version+1,
      updated_by_membership_id=target_membership_id,updated_at=target_occurred_at
    where id=current_record.id returning * into updated;
  else
    insert into public.transaction_financial_authorities(workspace_id,transaction_id,transaction_value_cents,volume_basis_cents,
      gross_commission_cents,brokerage_split_cents,referral_fee_cents,net_commission_cents,marketing_cost_cents,other_expense_cents,
      source_type,source_reference,effective_date,verification_state,updated_by_membership_id,created_at,updated_at)
    values(target_workspace_id,target_transaction_id,target_transaction_value_cents,target_volume_basis_cents,target_gross_commission_cents,
      target_brokerage_split_cents,target_referral_fee_cents,target_net_commission_cents,target_marketing_cost_cents,target_other_expense_cents,
      target_source_type,trim(target_source_reference),target_effective_date,target_verification_state,target_membership_id,target_occurred_at,target_occurred_at)
    returning * into updated;
  end if;
  next_snapshot:=to_jsonb(updated);
  insert into public.transaction_financial_events(workspace_id,financial_authority_id,transaction_id,actor_membership_id,
    from_version,to_version,reason_code,from_snapshot,to_snapshot,idempotency_key,occurred_at,created_at)
  values(target_workspace_id,updated.id,target_transaction_id,target_membership_id,nullif(target_expected_version,0),updated.current_version,
    trim(target_reason_code),prior,next_snapshot,target_idempotency_key,target_occurred_at,target_occurred_at);
  return jsonb_build_object('financialAuthorityId',updated.id,'version',updated.current_version,'noOp',false);
end $$;

revoke all on function public.upsert_transaction_financial_authority(uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,text,text,date,text,text,text,timestamptz)
from public,anon,authenticated,service_role;
grant execute on function public.upsert_transaction_financial_authority(uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,text,text,date,text,text,text,timestamptz)
to authenticated,service_role;

commit;
