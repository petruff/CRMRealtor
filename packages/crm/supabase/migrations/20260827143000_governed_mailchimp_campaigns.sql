-- Story 4.5: workspace-scoped Mailchimp campaign drafts, exact owner approvals,
-- recipient snapshot drift protection and redacted provider receipts.
begin;

create table public.mailchimp_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  connection_id uuid not null,
  binding_id uuid not null,
  version integer not null default 1,
  state text not null default 'draft',
  segment_kind text not null,
  segment_value text,
  title text not null,
  subject text not null,
  preview_text text not null,
  from_name text not null,
  reply_to text not null,
  html_content text not null,
  plain_text_content text not null,
  content_hash text not null,
  recipient_snapshot_hash text not null,
  eligible_count integer not null,
  exclusion_counts jsonb not null,
  remote_campaign_id text,
  execution_token uuid,
  execution_started_at timestamptz,
  created_by_membership_id uuid not null,
  updated_by_membership_id uuid not null,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mailchimp_campaigns_id_workspace_unique unique(id,workspace_id),
  constraint mailchimp_campaigns_correlation_unique unique(workspace_id,correlation_id),
  constraint mailchimp_campaigns_connection_workspace_fk foreign key(connection_id,workspace_id)
    references public.connector_connections(id,workspace_id) on delete restrict,
  constraint mailchimp_campaigns_binding_workspace_fk foreign key(binding_id,workspace_id)
    references public.mailchimp_audience_bindings(id,workspace_id) on delete restrict,
  constraint mailchimp_campaigns_creator_workspace_fk foreign key(created_by_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint mailchimp_campaigns_editor_workspace_fk foreign key(updated_by_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint mailchimp_campaigns_version check(version between 1 and 10000),
  constraint mailchimp_campaigns_state check(state in
    ('draft','create_approved','created','send_approved','sent','failed')),
  constraint mailchimp_campaigns_segment check(
    (segment_kind='all-subscribers' and segment_value is null)
    or (segment_kind='lead-type' and segment_value in ('hot','warm','nurture'))),
  constraint mailchimp_campaigns_text check(
    length(btrim(title)) between 1 and 160 and title !~ '[[:cntrl:]]'
    and length(btrim(subject)) between 1 and 150 and subject !~ '[[:cntrl:]]'
    and length(btrim(preview_text)) between 1 and 150 and preview_text !~ '[[:cntrl:]]'
    and length(btrim(from_name)) between 1 and 100 and from_name !~ '[[:cntrl:]]'
    and length(btrim(reply_to)) between 3 and 320 and reply_to ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    and length(btrim(html_content)) between 1 and 250000
    and length(btrim(plain_text_content)) between 1 and 100000),
  constraint mailchimp_campaigns_hashes check(
    content_hash ~ '^[0-9a-f]{64}$' and recipient_snapshot_hash ~ '^[0-9a-f]{64}$'),
  constraint mailchimp_campaigns_counts check(
    eligible_count >= 0 and jsonb_typeof(exclusion_counts)='object'
    and octet_length(exclusion_counts::text)<=2048),
  constraint mailchimp_campaigns_remote check(
    (state='draft' and remote_campaign_id is null)
    or state='create_approved'
    or (state in ('created','send_approved','sent') and remote_campaign_id is not null)
    or state='failed')
  ,constraint mailchimp_campaigns_execution_lease check(
    (execution_token is null and execution_started_at is null)
    or (execution_token is not null and execution_started_at is not null))
);

create index mailchimp_campaigns_workspace_state_idx
  on public.mailchimp_campaigns(workspace_id,state,updated_at desc,id);

create table public.mailchimp_campaign_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  campaign_id uuid not null,
  campaign_version integer not null,
  action text not null,
  content_hash text not null,
  recipient_snapshot_hash text not null,
  actor_membership_id uuid not null,
  correlation_id uuid not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint mailchimp_campaign_approvals_unique unique(campaign_id,campaign_version,action),
  constraint mailchimp_campaign_approvals_id_workspace_unique unique(id,workspace_id),
  constraint mailchimp_campaign_approvals_campaign_workspace_fk foreign key(campaign_id,workspace_id)
    references public.mailchimp_campaigns(id,workspace_id) on delete restrict,
  constraint mailchimp_campaign_approvals_actor_workspace_fk foreign key(actor_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint mailchimp_campaign_approvals_action check(action in ('create','send')),
  constraint mailchimp_campaign_approvals_hashes check(
    content_hash ~ '^[0-9a-f]{64}$' and recipient_snapshot_hash ~ '^[0-9a-f]{64}$')
);

create table public.mailchimp_campaign_receipts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  campaign_id uuid not null,
  action text not null,
  outcome text not null,
  provider_campaign_id text,
  provider_status text,
  error_category text,
  request_hash text not null,
  correlation_id uuid not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint mailchimp_campaign_receipts_id_workspace_unique unique(id,workspace_id),
  constraint mailchimp_campaign_receipts_campaign_workspace_fk foreign key(campaign_id,workspace_id)
    references public.mailchimp_campaigns(id,workspace_id) on delete restrict,
  constraint mailchimp_campaign_receipts_action check(action in ('create','send')),
  constraint mailchimp_campaign_receipts_outcome check(outcome in ('succeeded','failed','unknown')),
  constraint mailchimp_campaign_receipts_hash check(request_hash ~ '^[0-9a-f]{64}$'),
  constraint mailchimp_campaign_receipts_error check(
    error_category is null or error_category ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  constraint mailchimp_campaign_receipts_success check(
    (outcome='succeeded' and provider_campaign_id is not null and error_category is null)
    or outcome<>'succeeded')
);

create unique index mailchimp_campaign_one_success_per_action_idx
  on public.mailchimp_campaign_receipts(campaign_id,action) where outcome='succeeded';

create trigger mailchimp_campaign_approvals_guard before update or delete on public.mailchimp_campaign_approvals
  for each row execute function public.guard_connector_append_only();
create trigger mailchimp_campaign_receipts_guard before update or delete on public.mailchimp_campaign_receipts
  for each row execute function public.guard_connector_append_only();

alter table public.mailchimp_campaigns enable row level security;
alter table public.mailchimp_campaigns force row level security;
alter table public.mailchimp_campaign_approvals enable row level security;
alter table public.mailchimp_campaign_approvals force row level security;
alter table public.mailchimp_campaign_receipts enable row level security;
alter table public.mailchimp_campaign_receipts force row level security;

create policy mailchimp_campaigns_member_select on public.mailchimp_campaigns for select to authenticated
  using(public.has_workspace_access(workspace_id));
create policy mailchimp_campaign_approvals_member_select on public.mailchimp_campaign_approvals for select to authenticated
  using(public.has_workspace_access(workspace_id));
create policy mailchimp_campaign_receipts_member_select on public.mailchimp_campaign_receipts for select to authenticated
  using(public.has_workspace_access(workspace_id));

revoke all on public.mailchimp_campaigns,public.mailchimp_campaign_approvals,public.mailchimp_campaign_receipts
  from public,anon,authenticated,service_role;
grant select on public.mailchimp_campaigns,public.mailchimp_campaign_approvals,public.mailchimp_campaign_receipts
  to authenticated,service_role;

create or replace function public.create_mailchimp_campaign_draft(
  target_connection_id uuid,target_segment_kind text,target_segment_value text,
  target_title text,target_subject text,target_preview_text text,target_from_name text,
  target_reply_to text,target_html_content text,target_plain_text_content text,
  target_content_hash text,target_correlation_id uuid,target_occurred_at timestamptz default clock_timestamp()
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members%rowtype; binding public.mailchimp_audience_bindings%rowtype;
  campaign public.mailchimp_campaigns%rowtype; eligible_hash text; eligible_count integer; exclusions jsonb;
begin
  select b.* into binding from public.mailchimp_audience_bindings b
  join public.connector_connections c on c.id=b.connection_id and c.workspace_id=b.workspace_id
  where b.connection_id=target_connection_id and b.replaced_at is null and c.provider='mailchimp'
    and c.status='active' and not b.baseline_required and not b.webhook_registration_required;
  if not found then raise exception 'Mailchimp campaign readiness is incomplete' using errcode='42501'; end if;
  actor:=public.connector_current_membership(binding.workspace_id,false);
  if target_segment_kind not in ('all-subscribers','lead-type')
     or (target_segment_kind='all-subscribers' and target_segment_value is not null)
     or (target_segment_kind='lead-type' and target_segment_value not in ('hot','warm','nurture'))
     or target_content_hash !~ '^[0-9a-f]{64}$' or target_correlation_id is null then
    raise exception 'invalid Mailchimp campaign draft' using errcode='22023'; end if;
  select * into campaign from public.mailchimp_campaigns
    where workspace_id=binding.workspace_id and correlation_id=target_correlation_id;
  if campaign.id is not null then
    if campaign.connection_id<>target_connection_id or campaign.segment_kind<>target_segment_kind
       or campaign.segment_value is distinct from target_segment_value or campaign.content_hash<>target_content_hash then
      raise exception 'Mailchimp campaign idempotency conflict' using errcode='40001'; end if;
    return jsonb_build_object('campaign',to_jsonb(campaign));
  end if;
  with scoped as (
    select link.subscriber_hash,coalesce(authority.provider_status,'unresolved') status
    from public.mailchimp_member_links link
    join public.contacts contact on contact.id=link.contact_id and contact.workspace_id=link.workspace_id
    left join public.mailchimp_subscription_authority authority on authority.member_link_id=link.id
    where link.binding_id=binding.id and (target_segment_kind='all-subscribers' or contact.lead_type=target_segment_value::public.lead_type)
  ), eligible as (select distinct subscriber_hash from scoped where status='subscribed')
  select coalesce(encode(extensions.digest(pg_catalog.convert_to(coalesce(string_agg(subscriber_hash,',' order by subscriber_hash),''),'UTF8'),'sha256'),'hex'),repeat('0',64)),count(*)
    into eligible_hash,eligible_count from eligible;
  with scoped as (
    select coalesce(authority.provider_status,'unresolved') status
    from public.mailchimp_member_links link
    join public.contacts contact on contact.id=link.contact_id and contact.workspace_id=link.workspace_id
    left join public.mailchimp_subscription_authority authority on authority.member_link_id=link.id
    where link.binding_id=binding.id and (target_segment_kind='all-subscribers' or contact.lead_type=target_segment_value::public.lead_type)
  ) select jsonb_build_object(
    'unsubscribed',count(*) filter(where status='unsubscribed'),'nonSubscribed',count(*) filter(where status in ('transactional','unresolved')),
    'cleaned',count(*) filter(where status='cleaned'),'pending',count(*) filter(where status='pending'),
    'archived',count(*) filter(where status='archived'),'duplicate',0,'invalid',0)
    into exclusions from scoped;
  insert into public.mailchimp_campaigns(workspace_id,connection_id,binding_id,segment_kind,segment_value,
    title,subject,preview_text,from_name,reply_to,html_content,plain_text_content,content_hash,
    recipient_snapshot_hash,eligible_count,exclusion_counts,created_by_membership_id,updated_by_membership_id,
    correlation_id,created_at,updated_at)
  values(binding.workspace_id,binding.connection_id,binding.id,target_segment_kind,target_segment_value,
    target_title,target_subject,target_preview_text,target_from_name,lower(target_reply_to),target_html_content,
    target_plain_text_content,target_content_hash,eligible_hash,eligible_count,exclusions,actor.id,actor.id,
    target_correlation_id,target_occurred_at,target_occurred_at)
  on conflict(workspace_id,correlation_id) do nothing returning * into campaign;
  if campaign.id is null then
    select * into strict campaign from public.mailchimp_campaigns
      where workspace_id=binding.workspace_id and correlation_id=target_correlation_id;
    if campaign.connection_id<>target_connection_id or campaign.segment_kind<>target_segment_kind
       or campaign.segment_value is distinct from target_segment_value or campaign.content_hash<>target_content_hash then
      raise exception 'Mailchimp campaign idempotency conflict' using errcode='40001'; end if;
  end if;
  return jsonb_build_object('campaign',to_jsonb(campaign));
end; $$;

create or replace function public.update_mailchimp_campaign_draft(
  target_campaign_id uuid,target_expected_version integer,
  target_segment_kind text,target_segment_value text,
  target_title text,target_subject text,target_preview_text text,target_from_name text,
  target_reply_to text,target_html_content text,target_plain_text_content text,
  target_content_hash text,target_correlation_id uuid,target_occurred_at timestamptz default clock_timestamp()
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members%rowtype; campaign public.mailchimp_campaigns%rowtype;
  eligible_hash text; current_eligible_count integer; current_exclusions jsonb;
begin
  select * into campaign from public.mailchimp_campaigns where id=target_campaign_id for update;
  if not found then raise exception 'Mailchimp campaign not found' using errcode='P0002'; end if;
  actor:=public.connector_current_membership(campaign.workspace_id,false);
  if campaign.correlation_id=target_correlation_id then
    if campaign.content_hash<>target_content_hash or campaign.segment_kind<>target_segment_kind
       or campaign.segment_value is distinct from target_segment_value then
      raise exception 'Mailchimp campaign idempotency conflict' using errcode='40001'; end if;
    return jsonb_build_object('campaign',to_jsonb(campaign));
  end if;
  if campaign.state<>'draft' or campaign.version<>target_expected_version then
    raise exception 'Mailchimp campaign changed after review' using errcode='40001'; end if;
  if target_segment_kind not in ('all-subscribers','lead-type')
     or (target_segment_kind='all-subscribers' and target_segment_value is not null)
     or (target_segment_kind='lead-type' and target_segment_value not in ('hot','warm','nurture'))
     or target_content_hash !~ '^[0-9a-f]{64}$' or target_correlation_id is null then
    raise exception 'invalid Mailchimp campaign revision' using errcode='22023'; end if;
  with scoped as (
    select link.subscriber_hash,coalesce(authority.provider_status,'unresolved') status
    from public.mailchimp_member_links link
    join public.contacts contact on contact.id=link.contact_id and contact.workspace_id=link.workspace_id
    left join public.mailchimp_subscription_authority authority on authority.member_link_id=link.id
    where link.binding_id=campaign.binding_id
      and (target_segment_kind='all-subscribers' or contact.lead_type=target_segment_value::public.lead_type)
  ), eligible as (select distinct subscriber_hash from scoped where status='subscribed')
  select coalesce(encode(extensions.digest(pg_catalog.convert_to(
      coalesce(string_agg(subscriber_hash,',' order by subscriber_hash),''),'UTF8'),'sha256'),'hex'),repeat('0',64)),count(*)
    into eligible_hash,current_eligible_count from eligible;
  with scoped as (
    select coalesce(authority.provider_status,'unresolved') status
    from public.mailchimp_member_links link
    join public.contacts contact on contact.id=link.contact_id and contact.workspace_id=link.workspace_id
    left join public.mailchimp_subscription_authority authority on authority.member_link_id=link.id
    where link.binding_id=campaign.binding_id
      and (target_segment_kind='all-subscribers' or contact.lead_type=target_segment_value::public.lead_type)
  ) select jsonb_build_object(
    'unsubscribed',count(*) filter(where status='unsubscribed'),'nonSubscribed',count(*) filter(where status in ('transactional','unresolved')),
    'cleaned',count(*) filter(where status='cleaned'),'pending',count(*) filter(where status='pending'),
    'archived',count(*) filter(where status='archived'),'duplicate',0,'invalid',0)
    into current_exclusions from scoped;
  update public.mailchimp_campaigns set segment_kind=target_segment_kind,segment_value=target_segment_value,
    title=target_title,subject=target_subject,preview_text=target_preview_text,from_name=target_from_name,
    reply_to=lower(target_reply_to),html_content=target_html_content,plain_text_content=target_plain_text_content,
    content_hash=target_content_hash,recipient_snapshot_hash=eligible_hash,eligible_count=current_eligible_count,
    exclusion_counts=current_exclusions,version=version+1,updated_by_membership_id=actor.id,
    correlation_id=target_correlation_id,updated_at=target_occurred_at
    where id=campaign.id returning * into campaign;
  return jsonb_build_object('campaign',to_jsonb(campaign));
end; $$;

create or replace function public.approve_mailchimp_campaign_action(
  target_campaign_id uuid,target_expected_version integer,target_action text,
  target_expected_content_hash text,target_expected_recipient_snapshot_hash text,
  target_correlation_id uuid,target_occurred_at timestamptz default clock_timestamp()
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members%rowtype; campaign public.mailchimp_campaigns%rowtype;
  approval public.mailchimp_campaign_approvals%rowtype;
  current_recipient_snapshot_hash text;
  current_eligible_count integer;
begin
  select * into campaign from public.mailchimp_campaigns where id=target_campaign_id for update;
  if not found then raise exception 'Mailchimp campaign not found' using errcode='P0002'; end if;
  actor:=public.connector_current_membership(campaign.workspace_id,true);
  if campaign.version<>target_expected_version or campaign.content_hash<>target_expected_content_hash
     or campaign.recipient_snapshot_hash<>target_expected_recipient_snapshot_hash then
    raise exception 'Mailchimp campaign changed after review' using errcode='40001'; end if;
  with eligible as (
    select distinct link.subscriber_hash
    from public.mailchimp_member_links link
    join public.contacts contact on contact.id=link.contact_id and contact.workspace_id=link.workspace_id
    join public.mailchimp_subscription_authority authority on authority.member_link_id=link.id
    where link.binding_id=campaign.binding_id and authority.provider_status='subscribed'
      and (campaign.segment_kind='all-subscribers' or contact.lead_type=campaign.segment_value::public.lead_type)
  )
  select coalesce(encode(extensions.digest(pg_catalog.convert_to(
      coalesce(string_agg(subscriber_hash,',' order by subscriber_hash),''),'UTF8'),'sha256'),'hex'),repeat('0',64)),
    count(*)
  into current_recipient_snapshot_hash,current_eligible_count from eligible;
  if current_recipient_snapshot_hash<>campaign.recipient_snapshot_hash
     or current_eligible_count<>campaign.eligible_count then
    raise exception 'Mailchimp audience changed after review' using errcode='40001';
  end if;
  if current_eligible_count=0 then
    raise exception 'Mailchimp campaign has no eligible subscribers' using errcode='23514';
  end if;
  if (target_action='create' and campaign.state<>'draft')
     or (target_action='send' and campaign.state<>'created') then
    raise exception 'Mailchimp campaign action is not available' using errcode='23514'; end if;
  insert into public.mailchimp_campaign_approvals(workspace_id,campaign_id,campaign_version,action,
    content_hash,recipient_snapshot_hash,actor_membership_id,correlation_id,occurred_at)
  values(campaign.workspace_id,campaign.id,campaign.version,target_action,campaign.content_hash,
    campaign.recipient_snapshot_hash,actor.id,target_correlation_id,target_occurred_at)
  on conflict(campaign_id,campaign_version,action) do nothing returning * into approval;
  if approval.id is null then select * into strict approval from public.mailchimp_campaign_approvals
    where campaign_id=campaign.id and campaign_version=campaign.version and action=target_action; end if;
  update public.mailchimp_campaigns set state=case target_action when 'create' then 'create_approved' else 'send_approved' end,
    updated_by_membership_id=actor.id,updated_at=target_occurred_at where id=campaign.id returning * into campaign;
  return jsonb_build_object('campaign',to_jsonb(campaign),'approval',to_jsonb(approval));
end; $$;

create or replace function public.claim_mailchimp_campaign_execution(
  target_campaign_id uuid,target_action text,target_execution_token uuid,
  target_occurred_at timestamptz default clock_timestamp()
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare campaign public.mailchimp_campaigns%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  if target_execution_token is null then raise exception 'execution token required' using errcode='22023'; end if;
  select * into campaign from public.mailchimp_campaigns where id=target_campaign_id for update;
  if not found then raise exception 'Mailchimp campaign not found' using errcode='P0002'; end if;
  if (target_action='create' and campaign.state<>'create_approved')
     or (target_action='send' and campaign.state<>'send_approved') then
    raise exception 'Mailchimp campaign lacks exact approval' using errcode='42501'; end if;
  if campaign.execution_token is not null and campaign.execution_token<>target_execution_token
     and campaign.execution_started_at>target_occurred_at-interval '5 minutes' then
    raise exception 'Mailchimp campaign execution is already in progress' using errcode='40001'; end if;
  update public.mailchimp_campaigns set execution_token=target_execution_token,
    execution_started_at=target_occurred_at,updated_at=target_occurred_at
    where id=campaign.id returning * into campaign;
  return jsonb_build_object('campaign',to_jsonb(campaign));
end; $$;

create or replace function public.record_mailchimp_campaign_provider_result(
  target_campaign_id uuid,target_action text,target_outcome text,target_provider_campaign_id text,
  target_provider_status text,target_error_category text,target_request_hash text,
  target_correlation_id uuid,target_execution_token uuid,
  target_occurred_at timestamptz default clock_timestamp()
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare campaign public.mailchimp_campaigns%rowtype; receipt public.mailchimp_campaign_receipts%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  select * into campaign from public.mailchimp_campaigns where id=target_campaign_id for update;
  if not found then raise exception 'Mailchimp campaign not found' using errcode='P0002'; end if;
  if (target_action='create' and campaign.state<>'create_approved')
     or (target_action='send' and campaign.state<>'send_approved') then
    raise exception 'Mailchimp campaign lacks exact approval' using errcode='42501'; end if;
  if campaign.execution_token is distinct from target_execution_token then
    raise exception 'Mailchimp campaign execution lease changed' using errcode='40001'; end if;
  insert into public.mailchimp_campaign_receipts(workspace_id,campaign_id,action,outcome,provider_campaign_id,
    provider_status,error_category,request_hash,correlation_id,occurred_at)
  values(campaign.workspace_id,campaign.id,target_action,target_outcome,target_provider_campaign_id,
    target_provider_status,target_error_category,target_request_hash,target_correlation_id,target_occurred_at)
  returning * into receipt;
  update public.mailchimp_campaigns set state=case when target_outcome='failed' then 'failed'
      when target_outcome='unknown' then state
      when target_action='create' then 'created' else 'sent' end,
    remote_campaign_id=coalesce(target_provider_campaign_id,remote_campaign_id),updated_at=target_occurred_at
    ,execution_token=null,execution_started_at=null
    where id=campaign.id returning * into campaign;
  return jsonb_build_object('campaign',to_jsonb(campaign),'receipt',to_jsonb(receipt));
end; $$;

revoke all on function public.create_mailchimp_campaign_draft(uuid,text,text,text,text,text,text,text,text,text,text,uuid,timestamptz) from public;
revoke all on function public.update_mailchimp_campaign_draft(uuid,integer,text,text,text,text,text,text,text,text,text,text,uuid,timestamptz) from public;
revoke all on function public.approve_mailchimp_campaign_action(uuid,integer,text,text,text,uuid,timestamptz) from public;
revoke all on function public.claim_mailchimp_campaign_execution(uuid,text,uuid,timestamptz) from public;
revoke all on function public.record_mailchimp_campaign_provider_result(uuid,text,text,text,text,text,text,uuid,uuid,timestamptz) from public;
grant execute on function public.create_mailchimp_campaign_draft(uuid,text,text,text,text,text,text,text,text,text,text,uuid,timestamptz) to authenticated;
grant execute on function public.update_mailchimp_campaign_draft(uuid,integer,text,text,text,text,text,text,text,text,text,text,uuid,timestamptz) to authenticated;
grant execute on function public.approve_mailchimp_campaign_action(uuid,integer,text,text,text,uuid,timestamptz) to authenticated;
grant execute on function public.claim_mailchimp_campaign_execution(uuid,text,uuid,timestamptz) to service_role;
grant execute on function public.record_mailchimp_campaign_provider_result(uuid,text,text,text,text,text,text,uuid,uuid,timestamptz) to service_role;

comment on table public.mailchimp_campaigns is 'Versioned Mailchimp campaign content with count-and-hash recipient snapshots; no recipient list is stored.';
comment on table public.mailchimp_campaign_approvals is 'Append-only exact owner approvals separated for campaign creation and send.';
comment on table public.mailchimp_campaign_receipts is 'Append-only redacted Mailchimp provider outcomes; success is never inferred.';

commit;
