-- Epic 11 P5: opt-in morning brief notifications (Web Push).
--
-- A subscription belongs to exactly one signed-in member on one device. Members
-- can only see and manage their own rows; the daily sender reads through the
-- service role. Endpoints and keys are the browser-issued push credentials, not
-- secrets that grant CRM access, but they are still private to their owner.
begin;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  membership_id uuid not null,
  user_id uuid not null default auth.uid(),
  endpoint text not null check (endpoint ~ '^https://' and length(endpoint) <= 2048),
  p256dh text not null check (length(p256dh) between 40 and 200),
  auth_secret text not null check (length(auth_secret) between 16 and 64),
  show_names boolean not null default false,
  last_sent_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint push_subscriptions_member_fk foreign key (membership_id, workspace_id)
    references public.workspace_members(id, workspace_id) on delete cascade,
  unique (endpoint)
);
create index push_subscriptions_workspace_active_idx
  on public.push_subscriptions(workspace_id) where revoked_at is null;

alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;
grant update (show_names, updated_at, revoked_at) on public.push_subscriptions to authenticated;

create policy push_subscriptions_own_rows on public.push_subscriptions
for all to authenticated
using (
  user_id = auth.uid() and exists (
    select 1 from public.workspace_members member
    where member.id = push_subscriptions.membership_id
      and member.workspace_id = push_subscriptions.workspace_id
      and member.user_id = auth.uid() and member.status = 'active'
  )
)
with check (
  user_id = auth.uid() and exists (
    select 1 from public.workspace_members member
    where member.id = push_subscriptions.membership_id
      and member.workspace_id = push_subscriptions.workspace_id
      and member.user_id = auth.uid() and member.status = 'active'
  )
);

commit;
