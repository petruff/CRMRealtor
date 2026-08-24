-- Story 6.2: verified, workspace-scoped real-estate transaction intelligence.

create type public.real_estate_transaction_status as enum (
  'pending', 'under-contract', 'closed', 'lost', 'cancelled'
);
create type public.real_estate_transaction_side as enum ('buyer', 'seller', 'dual', 'referral');

create table public.real_estate_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  contact_id uuid not null,
  status public.real_estate_transaction_status not null,
  side public.real_estate_transaction_side not null,
  property_address text not null,
  source public.lead_source not null,
  expected_close_date date,
  closed_at date,
  sale_price_cents bigint not null default 0,
  gross_commission_cents bigint not null default 0,
  net_commission_cents bigint not null default 0,
  marketing_cost_cents bigint not null default 0,
  expense_cents bigint not null default 0,
  created_by_membership_id uuid not null,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint real_estate_transactions_contact_workspace_fk
    foreign key (contact_id, workspace_id) references public.contacts (id, workspace_id) on delete restrict,
  constraint real_estate_transactions_membership_workspace_fk
    foreign key (created_by_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id) on delete restrict,
  constraint real_estate_transactions_address_present check (length(trim(property_address)) between 1 and 240),
  constraint real_estate_transactions_money_nonnegative check (
    sale_price_cents >= 0 and gross_commission_cents >= 0 and net_commission_cents >= 0
    and marketing_cost_cents >= 0 and expense_cents >= 0
  ),
  constraint real_estate_transactions_closed_date check (status <> 'closed' or closed_at is not null),
  constraint real_estate_transactions_idempotency_unique unique (workspace_id, idempotency_key)
);

create index real_estate_transactions_workspace_closed_idx
  on public.real_estate_transactions (workspace_id, closed_at desc) where status = 'closed';
create index real_estate_transactions_workspace_status_idx
  on public.real_estate_transactions (workspace_id, status, expected_close_date);
create index real_estate_transactions_workspace_contact_idx
  on public.real_estate_transactions (workspace_id, contact_id, updated_at desc);

create trigger real_estate_transactions_touch_updated_at
  before update on public.real_estate_transactions
  for each row execute function public.touch_updated_at();

alter table public.real_estate_transactions enable row level security;
alter table public.real_estate_transactions force row level security;

create policy real_estate_transactions_active_member_select on public.real_estate_transactions
  for select to authenticated using (public.has_workspace_access(workspace_id));

revoke all on table public.real_estate_transactions from public, anon, authenticated;
grant select on table public.real_estate_transactions to authenticated;
grant all on table public.real_estate_transactions to service_role;

create or replace function public.create_real_estate_transaction(
  target_workspace_id uuid,
  target_membership_id uuid,
  target_contact_id uuid,
  target_status public.real_estate_transaction_status,
  target_side public.real_estate_transaction_side,
  target_property_address text,
  target_expected_close_date date,
  target_closed_at date,
  target_sale_price_cents bigint,
  target_gross_commission_cents bigint,
  target_net_commission_cents bigint,
  target_marketing_cost_cents bigint,
  target_expense_cents bigint,
  target_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_member public.workspace_members%rowtype;
  target_contact public.contacts%rowtype;
  existing_transaction public.real_estate_transactions%rowtype;
  created_transaction public.real_estate_transactions%rowtype;
begin
  select * into target_member from public.workspace_members
   where id = target_membership_id and workspace_id = target_workspace_id
     and user_id = auth.uid() and status = 'active' for share;
  if not found then raise exception 'Active workspace membership is required' using errcode = '42501'; end if;

  select * into target_contact from public.contacts
   where id = target_contact_id and workspace_id = target_workspace_id and archived_at is null for update;
  if not found then raise exception 'Active contact was not found' using errcode = 'P0002'; end if;

  select * into existing_transaction from public.real_estate_transactions
   where workspace_id = target_workspace_id and idempotency_key = target_idempotency_key;
  if found then
    if existing_transaction.contact_id <> target_contact_id
       or existing_transaction.status <> target_status
       or existing_transaction.side <> target_side
       or existing_transaction.property_address <> trim(target_property_address)
       or existing_transaction.expected_close_date is distinct from target_expected_close_date
       or existing_transaction.closed_at is distinct from target_closed_at
       or existing_transaction.sale_price_cents <> target_sale_price_cents
       or existing_transaction.gross_commission_cents <> target_gross_commission_cents
       or existing_transaction.net_commission_cents <> target_net_commission_cents
       or existing_transaction.marketing_cost_cents <> target_marketing_cost_cents
       or existing_transaction.expense_cents <> target_expense_cents then
      raise exception 'Idempotency key was already used for another transaction' using errcode = '23505';
    end if;
    return jsonb_build_object('transactionId', existing_transaction.id, 'noOp', true);
  end if;

  insert into public.real_estate_transactions (
    workspace_id, contact_id, status, side, property_address, source,
    expected_close_date, closed_at, sale_price_cents, gross_commission_cents,
    net_commission_cents, marketing_cost_cents, expense_cents,
    created_by_membership_id, idempotency_key
  ) values (
    target_workspace_id, target_contact_id, target_status, target_side, trim(target_property_address),
    target_contact.source, target_expected_close_date, target_closed_at, target_sale_price_cents,
    target_gross_commission_cents, target_net_commission_cents, target_marketing_cost_cents,
    target_expense_cents, target_membership_id, target_idempotency_key
  ) returning * into created_transaction;

  if target_status = 'under-contract' then
    update public.contacts set pipeline_stage = 'under-contract' where id = target_contact_id and workspace_id = target_workspace_id;
  elsif target_status = 'closed' then
    update public.contacts set pipeline_stage = 'closed', next_touch_at = null, touch_date_overridden = false
     where id = target_contact_id and workspace_id = target_workspace_id;
  end if;

  return jsonb_build_object('transactionId', created_transaction.id, 'noOp', false);
end;
$$;

revoke all on function public.create_real_estate_transaction(
  uuid, uuid, uuid, public.real_estate_transaction_status, public.real_estate_transaction_side,
  text, date, date, bigint, bigint, bigint, bigint, bigint, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.create_real_estate_transaction(
  uuid, uuid, uuid, public.real_estate_transaction_status, public.real_estate_transaction_side,
  text, date, date, bigint, bigint, bigint, bigint, bigint, uuid
) to authenticated, service_role;

comment on table public.real_estate_transactions is
  'Workspace-scoped verified deal financials used by live transaction intelligence.';
