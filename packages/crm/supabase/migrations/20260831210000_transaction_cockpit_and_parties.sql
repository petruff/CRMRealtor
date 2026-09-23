-- Story 7.1: transaction cockpit, explicit transaction kind, parties and history.

begin;

create type public.real_estate_transaction_kind as enum (
  'unclassified', 'buyer', 'seller', 'listing', 'lease', 'referral'
);
create type public.transaction_party_role as enum (
  'client', 'co-client', 'buyer', 'seller', 'tenant', 'landlord',
  'referring-agent', 'cooperating-agent', 'lender', 'title', 'attorney', 'other'
);
create type public.transaction_event_kind as enum (
  'created', 'details-updated', 'status-transitioned',
  'party-added', 'party-updated', 'party-archived'
);

alter table public.real_estate_transactions
  add column transaction_kind public.real_estate_transaction_kind not null default 'unclassified',
  add column kind_verified boolean not null default false,
  add column title text not null default '',
  add column responsible_membership_id uuid,
  add column next_action text,
  add column next_action_due_at timestamptz,
  add column source_snapshot jsonb not null default '{}'::jsonb,
  add column current_version integer not null default 1;

update public.real_estate_transactions
set title = left(trim(property_address), 120),
    responsible_membership_id = created_by_membership_id,
    source_snapshot = jsonb_build_object(
      'source', source::text,
      'capturedAt', created_at,
      'authority', 'contact-source-at-transaction-creation'
    );

alter table public.real_estate_transactions
  alter column responsible_membership_id set not null,
  add constraint real_estate_transactions_responsible_workspace_fk
    foreign key (responsible_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id) on delete restrict,
  add constraint real_estate_transactions_title_present
    check (length(trim(title)) between 1 and 120),
  add constraint real_estate_transactions_next_action_bounded
    check (next_action is null or length(trim(next_action)) between 1 and 200),
  add constraint real_estate_transactions_next_action_due_requires_action
    check (next_action_due_at is null or next_action is not null),
  add constraint real_estate_transactions_source_snapshot_object
    check (jsonb_typeof(source_snapshot) = 'object'),
  add constraint real_estate_transactions_version_positive check (current_version > 0);

create table public.transaction_parties (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  transaction_id uuid not null,
  contact_id uuid,
  role public.transaction_party_role not null,
  display_label text not null,
  participates_in_communication boolean not null default false,
  current_version integer not null default 1,
  archived_at timestamptz,
  created_by_membership_id uuid not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint transaction_parties_transaction_workspace_fk
    foreign key (transaction_id, workspace_id)
    references public.real_estate_transactions(id, workspace_id) on delete restrict,
  constraint transaction_parties_contact_workspace_fk
    foreign key (contact_id, workspace_id)
    references public.contacts(id, workspace_id) on delete restrict,
  constraint transaction_parties_member_workspace_fk
    foreign key (created_by_membership_id, workspace_id)
    references public.workspace_members(id, workspace_id) on delete restrict,
  constraint transaction_parties_label_present check (length(trim(display_label)) between 1 and 120),
  constraint transaction_parties_version_positive check (current_version > 0),
  constraint transaction_parties_id_workspace_unique unique(id, workspace_id)
);

create unique index transaction_parties_active_identity_unique
  on public.transaction_parties (
    workspace_id, transaction_id, role,
    coalesce(contact_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(trim(display_label))
  ) where archived_at is null;
create index transaction_parties_transaction_active_idx
  on public.transaction_parties(workspace_id, transaction_id, created_at)
  where archived_at is null;

create table public.transaction_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  transaction_id uuid not null,
  party_id uuid,
  actor_membership_id uuid not null,
  kind public.transaction_event_kind not null,
  from_version integer,
  to_version integer not null,
  reason_code text not null,
  evidence jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null,
  constraint transaction_events_transaction_workspace_fk
    foreign key (transaction_id, workspace_id)
    references public.real_estate_transactions(id, workspace_id) on delete restrict,
  constraint transaction_events_party_workspace_fk
    foreign key (party_id, workspace_id)
    references public.transaction_parties(id, workspace_id) on delete restrict,
  constraint transaction_events_actor_workspace_fk
    foreign key (actor_membership_id, workspace_id)
    references public.workspace_members(id, workspace_id) on delete restrict,
  constraint transaction_events_versions_valid
    check (to_version > 0 and (from_version is null or from_version > 0)),
  constraint transaction_events_reason_present check (length(trim(reason_code)) between 1 and 80),
  constraint transaction_events_evidence_object check (jsonb_typeof(evidence) = 'object'),
  constraint transaction_events_idempotency_unique unique(workspace_id, idempotency_key)
);
create index transaction_events_transaction_idx
  on public.transaction_events(workspace_id, transaction_id, occurred_at desc, id desc);

create or replace function public.reject_transaction_event_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'transaction history is append-only' using errcode = '55000';
end;
$$;
create trigger transaction_events_no_mutation
  before update or delete on public.transaction_events
  for each row execute function public.reject_transaction_event_mutation();

alter table public.transaction_parties enable row level security;
alter table public.transaction_parties force row level security;
alter table public.transaction_events enable row level security;
alter table public.transaction_events force row level security;
create policy transaction_parties_member_select on public.transaction_parties
  for select to authenticated using (public.has_workspace_access(workspace_id));
create policy transaction_events_member_select on public.transaction_events
  for select to authenticated using (public.has_workspace_access(workspace_id));

revoke all on table public.transaction_parties, public.transaction_events
  from public, anon, authenticated;
grant select on table public.transaction_parties, public.transaction_events to authenticated;
grant all on table public.transaction_parties, public.transaction_events to service_role;
revoke all on sequence public.transaction_events_id_seq from public, anon, authenticated;
grant all on sequence public.transaction_events_id_seq to service_role;

-- Replace the legacy create path to preserve compatibility while removing its
-- former silent contact-pipeline mutation. Legacy callers remain explicitly
-- unclassified until a person verifies the transaction kind.
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
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_contact public.contacts%rowtype;
  existing_transaction public.real_estate_transactions%rowtype; created_transaction public.real_estate_transactions%rowtype;
begin
  perform 1 from public.workspace_members
   where id=target_membership_id and workspace_id=target_workspace_id
     and user_id=auth.uid() and status='active' for share;
  if not found then raise exception 'active workspace membership is required' using errcode='42501'; end if;
  select * into target_contact from public.contacts
   where id=target_contact_id and workspace_id=target_workspace_id and archived_at is null for share;
  if not found then raise exception 'active contact was not found' using errcode='P0002'; end if;
  select * into existing_transaction from public.real_estate_transactions
   where workspace_id=target_workspace_id and idempotency_key=target_idempotency_key for update;
  if found then
    if existing_transaction.kind_verified then
      raise exception 'idempotency key belongs to a verified transaction' using errcode='23505';
    end if;
    if existing_transaction.contact_id<>target_contact_id or existing_transaction.status<>target_status
      or existing_transaction.side<>target_side or existing_transaction.property_address<>trim(target_property_address)
      or existing_transaction.expected_close_date is distinct from target_expected_close_date
      or existing_transaction.closed_at is distinct from target_closed_at
      or existing_transaction.sale_price_cents<>target_sale_price_cents
      or existing_transaction.gross_commission_cents<>target_gross_commission_cents
      or existing_transaction.net_commission_cents<>target_net_commission_cents
      or existing_transaction.marketing_cost_cents<>target_marketing_cost_cents
      or existing_transaction.expense_cents<>target_expense_cents then
      raise exception 'idempotency key was already used for another transaction' using errcode='23505';
    end if;
    return jsonb_build_object('transactionId',existing_transaction.id,'noOp',true);
  end if;
  insert into public.real_estate_transactions(
    workspace_id,contact_id,title,status,side,property_address,source,expected_close_date,closed_at,
    sale_price_cents,gross_commission_cents,net_commission_cents,marketing_cost_cents,expense_cents,
    responsible_membership_id,source_snapshot,created_by_membership_id,idempotency_key,created_at,updated_at
  ) values(
    target_workspace_id,target_contact_id,left(trim(target_property_address),120),target_status,target_side,
    trim(target_property_address),target_contact.source,
    target_expected_close_date,target_closed_at,target_sale_price_cents,target_gross_commission_cents,
    target_net_commission_cents,target_marketing_cost_cents,target_expense_cents,target_membership_id,
    jsonb_build_object('source',target_contact.source::text,'capturedAt',now(),'authority','contact-source-at-transaction-creation'),
    target_membership_id,target_idempotency_key,now(),now()
  ) returning * into created_transaction;
  insert into public.transaction_events(workspace_id,transaction_id,actor_membership_id,kind,to_version,
    reason_code,evidence,idempotency_key,occurred_at,created_at)
  values(target_workspace_id,created_transaction.id,target_membership_id,'created',1,'legacy-create',
    jsonb_build_object('transactionKind','unclassified','kindVerified',false),
    'transaction-created:'||created_transaction.id::text,created_transaction.created_at,created_transaction.created_at);
  return jsonb_build_object('transactionId',created_transaction.id,'noOp',false);
end;
$$;

revoke all on function public.create_real_estate_transaction(
  uuid,uuid,uuid,public.real_estate_transaction_status,public.real_estate_transaction_side,
  text,date,date,bigint,bigint,bigint,bigint,bigint,uuid
) from public,anon,authenticated,service_role;

create function public.create_real_estate_transaction_v2(
  target_workspace_id uuid,target_membership_id uuid,target_contact_id uuid,
  target_transaction_kind public.real_estate_transaction_kind,target_title text,
  target_status public.real_estate_transaction_status,target_side public.real_estate_transaction_side,
  target_property_address text,target_expected_close_date date,target_closed_at date,
  target_sale_price_cents bigint,target_gross_commission_cents bigint,target_net_commission_cents bigint,
  target_marketing_cost_cents bigint,target_expense_cents bigint,target_responsible_membership_id uuid,
  target_next_action text,target_next_action_due_at timestamptz,target_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare target_contact public.contacts%rowtype; existing public.real_estate_transactions%rowtype;
  created public.real_estate_transactions%rowtype;
begin
  perform 1 from public.workspace_members where id=target_membership_id
    and workspace_id=target_workspace_id and user_id=auth.uid() and status='active' for share;
  if not found then raise exception 'active workspace membership is required' using errcode='42501'; end if;
  perform 1 from public.workspace_members where id=target_responsible_membership_id
    and workspace_id=target_workspace_id and status='active' for share;
  if not found then raise exception 'active responsible member is required' using errcode='P0002'; end if;
  if target_transaction_kind='unclassified' then raise exception 'verified transaction kind is required' using errcode='22023'; end if;
  if length(trim(target_title)) not between 1 and 120 then raise exception 'transaction title is invalid' using errcode='22023'; end if;
  if length(trim(target_property_address)) not between 1 and 240 then raise exception 'property address is invalid' using errcode='22023'; end if;
  if target_next_action_due_at is not null and nullif(trim(target_next_action),'') is null then
    raise exception 'next action is required for its due time' using errcode='22023';
  end if;
  select * into target_contact from public.contacts where id=target_contact_id
    and workspace_id=target_workspace_id and archived_at is null for share;
  if not found then raise exception 'active contact was not found' using errcode='P0002'; end if;
  select * into existing from public.real_estate_transactions where workspace_id=target_workspace_id
    and idempotency_key=target_idempotency_key for update;
  if found then
    if existing.contact_id<>target_contact_id or existing.transaction_kind<>target_transaction_kind
      or existing.title<>trim(target_title) or existing.status<>target_status or existing.side<>target_side
      or existing.property_address<>trim(target_property_address)
      or existing.expected_close_date is distinct from target_expected_close_date
      or existing.closed_at is distinct from target_closed_at
      or existing.sale_price_cents<>target_sale_price_cents
      or existing.gross_commission_cents<>target_gross_commission_cents
      or existing.net_commission_cents<>target_net_commission_cents
      or existing.marketing_cost_cents<>target_marketing_cost_cents
      or existing.expense_cents<>target_expense_cents
      or existing.responsible_membership_id<>target_responsible_membership_id
      or existing.next_action is distinct from nullif(trim(target_next_action),'')
      or existing.next_action_due_at is distinct from target_next_action_due_at then
      raise exception 'idempotency key was already used for another transaction' using errcode='23505';
    end if;
    return jsonb_build_object('transactionId',existing.id,'version',existing.current_version,'noOp',true);
  end if;
  insert into public.real_estate_transactions(
    workspace_id,contact_id,transaction_kind,kind_verified,title,status,side,property_address,source,
    expected_close_date,closed_at,sale_price_cents,gross_commission_cents,net_commission_cents,
    marketing_cost_cents,expense_cents,responsible_membership_id,next_action,next_action_due_at,
    source_snapshot,current_version,created_by_membership_id,idempotency_key,created_at,updated_at
  ) values(
    target_workspace_id,target_contact_id,target_transaction_kind,true,trim(target_title),target_status,target_side,
    trim(target_property_address),target_contact.source,target_expected_close_date,target_closed_at,target_sale_price_cents,
    target_gross_commission_cents,target_net_commission_cents,target_marketing_cost_cents,target_expense_cents,
    target_responsible_membership_id,nullif(trim(target_next_action),''),target_next_action_due_at,
    jsonb_build_object('source',target_contact.source::text,'capturedAt',now(),'authority','contact-source-at-transaction-creation'),
    1,target_membership_id,target_idempotency_key,now(),now()
  ) returning * into created;
  insert into public.transaction_events(workspace_id,transaction_id,actor_membership_id,kind,to_version,
    reason_code,evidence,idempotency_key,occurred_at,created_at)
  values(target_workspace_id,created.id,target_membership_id,'created',1,'verified-create',
    jsonb_build_object('transactionKind',created.transaction_kind::text,'kindVerified',true,'status',created.status::text),
    'transaction-created:'||created.id::text,created.created_at,created.created_at);
  return jsonb_build_object('transactionId',created.id,'version',1,'noOp',false);
end;
$$;

create function public.transition_real_estate_transaction(
  target_workspace_id uuid,target_membership_id uuid,target_transaction_id uuid,target_expected_version integer,
  target_status public.real_estate_transaction_status,target_closed_at date,target_reason_code text,
  target_idempotency_key text,target_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.real_estate_transactions%rowtype; replay public.transaction_events%rowtype;
  next_version integer;
begin
  perform 1 from public.workspace_members where id=target_membership_id and workspace_id=target_workspace_id
    and user_id=auth.uid() and status='active' for share;
  if not found then raise exception 'active workspace membership is required' using errcode='42501'; end if;
  select * into replay from public.transaction_events where workspace_id=target_workspace_id
    and idempotency_key=target_idempotency_key;
  if found then return jsonb_build_object('transactionId',replay.transaction_id,'version',replay.to_version,'noOp',true); end if;
  select * into target from public.real_estate_transactions where id=target_transaction_id
    and workspace_id=target_workspace_id for update;
  if not found then raise exception 'transaction was not found' using errcode='P0002'; end if;
  if target.current_version<>target_expected_version then raise exception 'transaction version is stale' using errcode='40001'; end if;
  if target_status='closed' and target_closed_at is null then raise exception 'closed date is required' using errcode='22023'; end if;
  if length(trim(target_reason_code)) not between 1 and 80 then raise exception 'transition reason is invalid' using errcode='22023'; end if;
  next_version:=target.current_version+1;
  update public.real_estate_transactions set status=target_status,closed_at=target_closed_at,
    current_version=next_version,updated_at=target_occurred_at where id=target.id;
  insert into public.transaction_events(workspace_id,transaction_id,actor_membership_id,kind,from_version,to_version,
    reason_code,evidence,idempotency_key,occurred_at,created_at)
  values(target_workspace_id,target.id,target_membership_id,'status-transitioned',target.current_version,next_version,
    trim(target_reason_code),jsonb_build_object('fromStatus',target.status::text,'toStatus',target_status::text),
    target_idempotency_key,target_occurred_at,target_occurred_at);
  return jsonb_build_object('transactionId',target.id,'version',next_version,'noOp',false);
end;
$$;

create function public.add_transaction_party(
  target_workspace_id uuid,target_membership_id uuid,target_transaction_id uuid,target_contact_id uuid,
  target_role public.transaction_party_role,target_display_label text,target_participates_in_communication boolean,
  target_idempotency_key text,target_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare replay public.transaction_events%rowtype; created public.transaction_parties%rowtype;
begin
  perform 1 from public.workspace_members where id=target_membership_id and workspace_id=target_workspace_id
    and user_id=auth.uid() and status='active' for share;
  if not found then raise exception 'active workspace membership is required' using errcode='42501'; end if;
  select * into replay from public.transaction_events where workspace_id=target_workspace_id and idempotency_key=target_idempotency_key;
  if found then return jsonb_build_object('partyId',replay.party_id,'noOp',true); end if;
  perform 1 from public.real_estate_transactions where id=target_transaction_id
    and workspace_id=target_workspace_id for share;
  if not found then raise exception 'transaction was not found' using errcode='P0002'; end if;
  if target_contact_id is not null then
    perform 1 from public.contacts where id=target_contact_id and workspace_id=target_workspace_id
      and archived_at is null for share;
    if not found then raise exception 'active party contact was not found' using errcode='P0002'; end if;
  end if;
  if length(trim(target_display_label)) not between 1 and 120 then raise exception 'party label is invalid' using errcode='22023'; end if;
  insert into public.transaction_parties(workspace_id,transaction_id,contact_id,role,display_label,
    participates_in_communication,created_by_membership_id,created_at,updated_at)
  values(target_workspace_id,target_transaction_id,target_contact_id,target_role,trim(target_display_label),
    target_participates_in_communication,target_membership_id,target_occurred_at,target_occurred_at)
  returning * into created;
  insert into public.transaction_events(workspace_id,transaction_id,party_id,actor_membership_id,kind,to_version,
    reason_code,evidence,idempotency_key,occurred_at,created_at)
  values(target_workspace_id,target_transaction_id,created.id,target_membership_id,'party-added',1,'party-added',
    jsonb_build_object('role',created.role::text,'contactLinked',created.contact_id is not null,
      'participatesInCommunication',created.participates_in_communication),
    target_idempotency_key,target_occurred_at,target_occurred_at);
  return jsonb_build_object('partyId',created.id,'version',1,'noOp',false);
end;
$$;

create function public.update_real_estate_transaction(
  target_workspace_id uuid,target_membership_id uuid,target_transaction_id uuid,target_expected_version integer,
  target_transaction_kind public.real_estate_transaction_kind,target_title text,
  target_side public.real_estate_transaction_side,target_property_address text,target_expected_close_date date,
  target_sale_price_cents bigint,target_gross_commission_cents bigint,target_net_commission_cents bigint,
  target_marketing_cost_cents bigint,target_expense_cents bigint,target_next_action text,
  target_next_action_due_at timestamptz,target_reason_code text,target_idempotency_key text,target_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.real_estate_transactions%rowtype;
  replay public.transaction_events%rowtype; next_version integer;
begin
  perform 1 from public.workspace_members where id=target_membership_id and workspace_id=target_workspace_id
    and user_id=auth.uid() and status='active' for share;
  if not found then raise exception 'active workspace membership is required' using errcode='42501'; end if;
  select * into replay from public.transaction_events where workspace_id=target_workspace_id
    and idempotency_key=target_idempotency_key;
  if found then return jsonb_build_object('transactionId',replay.transaction_id,'version',replay.to_version,'noOp',true); end if;
  select * into target from public.real_estate_transactions where id=target_transaction_id
    and workspace_id=target_workspace_id for update;
  if not found then raise exception 'transaction was not found' using errcode='P0002'; end if;
  if target.current_version<>target_expected_version then raise exception 'transaction version is stale' using errcode='40001'; end if;
  if target_transaction_kind='unclassified' then raise exception 'verified transaction kind is required' using errcode='22023'; end if;
  if length(trim(target_title)) not between 1 and 120 then raise exception 'transaction title is invalid' using errcode='22023'; end if;
  if length(trim(target_property_address)) not between 1 and 240 then raise exception 'property address is invalid' using errcode='22023'; end if;
  if target_next_action_due_at is not null and nullif(trim(target_next_action),'') is null then
    raise exception 'next action is required for its due time' using errcode='22023';
  end if;
  if target_sale_price_cents<0 or target_gross_commission_cents<0 or target_net_commission_cents<0
    or target_marketing_cost_cents<0 or target_expense_cents<0 then
    raise exception 'transaction amounts must be non-negative' using errcode='22023';
  end if;
  if length(trim(target_reason_code)) not between 1 and 80 then raise exception 'update reason is invalid' using errcode='22023'; end if;
  next_version:=target.current_version+1;
  update public.real_estate_transactions set
    transaction_kind=target_transaction_kind,kind_verified=true,title=trim(target_title),side=target_side,
    property_address=trim(target_property_address),expected_close_date=target_expected_close_date,
    sale_price_cents=target_sale_price_cents,gross_commission_cents=target_gross_commission_cents,
    net_commission_cents=target_net_commission_cents,marketing_cost_cents=target_marketing_cost_cents,
    expense_cents=target_expense_cents,next_action=nullif(trim(target_next_action),''),
    next_action_due_at=target_next_action_due_at,current_version=next_version,updated_at=target_occurred_at
  where id=target.id;
  insert into public.transaction_events(workspace_id,transaction_id,actor_membership_id,kind,from_version,to_version,
    reason_code,evidence,idempotency_key,occurred_at,created_at)
  values(target_workspace_id,target.id,target_membership_id,'details-updated',target.current_version,next_version,
    trim(target_reason_code),jsonb_build_object('transactionKind',target_transaction_kind::text,'title',trim(target_title),
      'side',target_side::text,'propertyAddress',trim(target_property_address)),
    target_idempotency_key,target_occurred_at,target_occurred_at);
  return jsonb_build_object('transactionId',target.id,'version',next_version,'noOp',false);
end;
$$;

create function public.update_transaction_party(
  target_workspace_id uuid,target_membership_id uuid,target_party_id uuid,target_expected_version integer,
  target_role public.transaction_party_role,target_display_label text,target_participates_in_communication boolean,
  target_idempotency_key text,target_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.transaction_parties%rowtype;
  replay public.transaction_events%rowtype; next_version integer;
begin
  perform 1 from public.workspace_members where id=target_membership_id and workspace_id=target_workspace_id
    and user_id=auth.uid() and status='active' for share;
  if not found then raise exception 'active workspace membership is required' using errcode='42501'; end if;
  select * into replay from public.transaction_events where workspace_id=target_workspace_id
    and idempotency_key=target_idempotency_key;
  if found then return jsonb_build_object('partyId',replay.party_id,'version',replay.to_version,'noOp',true); end if;
  select * into target from public.transaction_parties where id=target_party_id and workspace_id=target_workspace_id for update;
  if not found or target.archived_at is not null then raise exception 'active transaction party was not found' using errcode='P0002'; end if;
  if target.current_version<>target_expected_version then raise exception 'transaction party version is stale' using errcode='40001'; end if;
  if length(trim(target_display_label)) not between 1 and 120 then raise exception 'party label is invalid' using errcode='22023'; end if;
  next_version:=target.current_version+1;
  update public.transaction_parties set role=target_role,display_label=trim(target_display_label),
    participates_in_communication=target_participates_in_communication,current_version=next_version,
    updated_at=target_occurred_at where id=target.id;
  insert into public.transaction_events(workspace_id,transaction_id,party_id,actor_membership_id,kind,from_version,to_version,
    reason_code,evidence,idempotency_key,occurred_at,created_at)
  values(target_workspace_id,target.transaction_id,target.id,target_membership_id,'party-updated',target.current_version,next_version,
    'party-updated',jsonb_build_object('role',target_role::text,'participatesInCommunication',target_participates_in_communication),
    target_idempotency_key,target_occurred_at,target_occurred_at);
  return jsonb_build_object('partyId',target.id,'version',next_version,'noOp',false);
end;
$$;

create function public.archive_transaction_party(
  target_workspace_id uuid,target_membership_id uuid,target_party_id uuid,target_expected_version integer,
  target_reason_code text,target_idempotency_key text,target_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.transaction_parties%rowtype;
  replay public.transaction_events%rowtype; next_version integer;
begin
  perform 1 from public.workspace_members where id=target_membership_id and workspace_id=target_workspace_id
    and user_id=auth.uid() and status='active' for share;
  if not found then raise exception 'active workspace membership is required' using errcode='42501'; end if;
  select * into replay from public.transaction_events where workspace_id=target_workspace_id
    and idempotency_key=target_idempotency_key;
  if found then return jsonb_build_object('partyId',replay.party_id,'version',replay.to_version,'noOp',true); end if;
  select * into target from public.transaction_parties where id=target_party_id and workspace_id=target_workspace_id for update;
  if not found then raise exception 'transaction party was not found' using errcode='P0002'; end if;
  if target.archived_at is not null then return jsonb_build_object('partyId',target.id,'version',target.current_version,'noOp',true); end if;
  if target.current_version<>target_expected_version then raise exception 'transaction party version is stale' using errcode='40001'; end if;
  if length(trim(target_reason_code)) not between 1 and 80 then raise exception 'archive reason is invalid' using errcode='22023'; end if;
  next_version:=target.current_version+1;
  update public.transaction_parties set archived_at=target_occurred_at,current_version=next_version,
    updated_at=target_occurred_at where id=target.id;
  insert into public.transaction_events(workspace_id,transaction_id,party_id,actor_membership_id,kind,from_version,to_version,
    reason_code,evidence,idempotency_key,occurred_at,created_at)
  values(target_workspace_id,target.transaction_id,target.id,target_membership_id,'party-archived',target.current_version,next_version,
    trim(target_reason_code),jsonb_build_object('role',target.role::text,'contactLinked',target.contact_id is not null),
    target_idempotency_key,target_occurred_at,target_occurred_at);
  return jsonb_build_object('partyId',target.id,'version',next_version,'noOp',false);
end;
$$;

revoke all on function public.reject_transaction_event_mutation() from public,anon,authenticated,service_role;
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
grant execute on function public.create_real_estate_transaction_v2(uuid,uuid,uuid,public.real_estate_transaction_kind,text,
  public.real_estate_transaction_status,public.real_estate_transaction_side,text,date,date,bigint,bigint,bigint,bigint,
  bigint,uuid,text,timestamptz,uuid) to authenticated,service_role;
grant execute on function public.transition_real_estate_transaction(uuid,uuid,uuid,integer,
  public.real_estate_transaction_status,date,text,text,timestamptz) to authenticated,service_role;
grant execute on function public.add_transaction_party(uuid,uuid,uuid,uuid,public.transaction_party_role,text,boolean,text,timestamptz)
  to authenticated,service_role;
grant execute on function public.update_real_estate_transaction(uuid,uuid,uuid,integer,public.real_estate_transaction_kind,text,
  public.real_estate_transaction_side,text,date,bigint,bigint,bigint,bigint,bigint,text,timestamptz,text,text,timestamptz)
  to authenticated,service_role;
grant execute on function public.update_transaction_party(uuid,uuid,uuid,integer,public.transaction_party_role,text,boolean,text,timestamptz)
  to authenticated,service_role;
grant execute on function public.archive_transaction_party(uuid,uuid,uuid,integer,text,text,timestamptz)
  to authenticated,service_role;

comment on table public.real_estate_transactions is
  'Canonical workspace transaction records. Transaction state never silently changes contact relationship or pipeline state.';
comment on table public.transaction_parties is
  'Versioned transaction participants; contact links are explicit and never infer or merge identity.';
comment on table public.transaction_events is
  'Append-only transaction and party lifecycle evidence.';

commit;
