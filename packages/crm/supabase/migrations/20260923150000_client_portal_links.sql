-- Epic 11 P8: private, expiring, read-only client portal links.
--
-- The realtor shares one link per deal with her buyer or seller. Only the
-- SHA-256 hash of the 256-bit token is stored, so a database read never
-- reveals a working link. Visitors never touch tables: the anonymous RPC
-- returns an allowlisted snapshot (property, status, key dates) and nothing
-- else — no contact data, commissions, notes or source references.
begin;

create table public.client_portal_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  transaction_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  audience_label text not null check (length(trim(audience_label)) between 1 and 80),
  created_by_membership_id uuid not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer not null default 0 check (view_count >= 0),
  created_at timestamptz not null default now(),
  constraint client_portal_links_transaction_fk foreign key (transaction_id, workspace_id)
    references public.real_estate_transactions(id, workspace_id) on delete cascade,
  constraint client_portal_links_creator_fk foreign key (created_by_membership_id, workspace_id)
    references public.workspace_members(id, workspace_id) on delete restrict,
  constraint client_portal_links_expiry_window check (expires_at > created_at and expires_at <= created_at + interval '180 days')
);
create index client_portal_links_transaction_idx on public.client_portal_links(workspace_id, transaction_id);

alter table public.client_portal_links enable row level security;
alter table public.client_portal_links force row level security;
revoke all on public.client_portal_links from public, anon, authenticated;
grant select, insert on public.client_portal_links to authenticated;
grant update (revoked_at) on public.client_portal_links to authenticated;

create policy client_portal_links_members on public.client_portal_links
for all to authenticated
using (exists (
  select 1 from public.workspace_members member
  where member.workspace_id = client_portal_links.workspace_id
    and member.user_id = auth.uid() and member.status = 'active'
))
with check (exists (
  select 1 from public.workspace_members member
  where member.id = client_portal_links.created_by_membership_id
    and member.workspace_id = client_portal_links.workspace_id
    and member.user_id = auth.uid() and member.status = 'active'
));

create or replace function public.get_client_portal(target_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare link public.client_portal_links%rowtype; deal public.real_estate_transactions%rowtype; workspace_name text;
begin
  if target_token_hash is null or target_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into link from public.client_portal_links
    where token_hash = target_token_hash and revoked_at is null and expires_at > now()
    for update;
  if not found then return null; end if;
  select * into deal from public.real_estate_transactions where id = link.transaction_id and workspace_id = link.workspace_id;
  if not found or deal.status in ('lost', 'cancelled') then return null; end if;
  select name into workspace_name from public.workspaces where id = link.workspace_id;
  update public.client_portal_links set last_viewed_at = now(), view_count = view_count + 1 where id = link.id;
  return jsonb_build_object(
    'audience', link.audience_label,
    'agentName', workspace_name,
    'propertyAddress', deal.property_address,
    'status', deal.status,
    'side', deal.side,
    'expectedCloseDate', deal.expected_close_date,
    'closedAt', deal.closed_at,
    'expiresAt', link.expires_at,
    'milestones', coalesce((
      select jsonb_agg(jsonb_build_object('kind', m.kind, 'label', m.label, 'dueAt', m.due_at, 'state', m.state, 'timezone', m.timezone)
        order by m.due_at)
      from public.transaction_milestones m
      where m.transaction_id = deal.id and m.workspace_id = deal.workspace_id and m.state <> 'cancelled'
    ), '[]'::jsonb)
  );
end $$;
revoke all on function public.get_client_portal(text) from public;
grant execute on function public.get_client_portal(text) to anon, authenticated;

commit;
