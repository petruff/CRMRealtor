-- Story 10.1: immutable, membership-owned meeting preparation evidence.
begin;
create table public.meeting_brief_snapshots (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  contact_id uuid not null,
  transaction_id uuid,
  created_by_membership_id uuid not null,
  prior_snapshot_id uuid unique,
  version integer not null check(version > 0),
  snapshot jsonb not null check(jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null,
  expires_at timestamptz not null check(expires_at > created_at),
  unique(id,workspace_id),
  foreign key(contact_id,workspace_id) references public.contacts(id,workspace_id) on delete restrict,
  foreign key(transaction_id,workspace_id) references public.real_estate_transactions(id,workspace_id) on delete restrict,
  foreign key(created_by_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  foreign key(prior_snapshot_id,workspace_id) references public.meeting_brief_snapshots(id,workspace_id) on delete restrict
);
create index meeting_brief_contact_time_idx on public.meeting_brief_snapshots(workspace_id,contact_id,created_at desc);
alter table public.meeting_brief_snapshots enable row level security;
create policy meeting_brief_member_read on public.meeting_brief_snapshots for select to authenticated using(public.has_workspace_access(workspace_id));
-- Supabase schema default privileges can grant ALL at CREATE TABLE time.
-- A subsequent GRANT SELECT alone does not remove those inherited grants.
revoke all on public.meeting_brief_snapshots from public,anon,authenticated,service_role;
grant select on public.meeting_brief_snapshots to authenticated;
grant select,insert on public.meeting_brief_snapshots to service_role;

create function public.reject_meeting_brief_mutation() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'Meeting brief evidence is append-only' using errcode='55000'; end $$;
revoke all on function public.reject_meeting_brief_mutation() from public,anon,authenticated,service_role;
create trigger meeting_brief_immutable before update or delete on public.meeting_brief_snapshots
for each row execute function public.reject_meeting_brief_mutation();

create function public.create_meeting_brief_snapshot(target_workspace_id uuid,target_membership_id uuid,target_snapshot jsonb)
returns uuid language plpgsql security definer set search_path = public,pg_temp as $$
declare
  prior public.meeting_brief_snapshots%rowtype;
  new_id uuid := (target_snapshot->>'id')::uuid;
  contact uuid := (target_snapshot->>'subjectContactId')::uuid;
  transaction_ref uuid := (target_snapshot->>'optionalTransactionId')::uuid;
  prior_id uuid := (target_snapshot->>'priorSnapshotId')::uuid;
  citation jsonb;
  source_id uuid;
  source_ok boolean;
begin
  if auth.uid() is null then raise exception 'Authenticated actor required' using errcode='42501'; end if;
  perform public.assert_crm_actor_membership(target_membership_id,target_workspace_id);
  if (target_snapshot->>'workspaceId')::uuid is distinct from target_workspace_id
    or (target_snapshot->>'createdByMembershipId')::uuid is distinct from target_membership_id
    or target_snapshot->>'deterministicRuleVersion' is distinct from 'meeting-brief.rules.v1'
    or target_snapshot->>'modelState' is distinct from 'not-requested'
    or jsonb_typeof(target_snapshot->'citations') is distinct from 'array'
    or jsonb_typeof(target_snapshot->'sections') is distinct from 'array'
    or jsonb_typeof(target_snapshot->'sourceHashes') is distinct from 'object'
    or octet_length(target_snapshot::text) > 131072 then
    raise exception 'Invalid meeting brief snapshot' using errcode='22023';
  end if;
  if not exists(select 1 from public.contacts where id=contact and workspace_id=target_workspace_id and archived_at is null) then
    raise exception 'Contact unavailable' using errcode='P0002';
  end if;
  if transaction_ref is not null and not exists(select 1 from public.real_estate_transactions where id=transaction_ref and workspace_id=target_workspace_id and public.resolve_canonical_contact_id(target_workspace_id,contact_id)=contact) then
    raise exception 'Transaction unavailable' using errcode='P0002';
  end if;
  if jsonb_array_length(target_snapshot->'citations') > 180 or jsonb_array_length(target_snapshot->'sections') > 12 then
    raise exception 'Invalid meeting brief snapshot' using errcode='22023';
  end if;
  -- Authenticated members author the snapshot; every citation must still resolve
  -- to their subject's current readable CRM evidence. This is not model attestation.
  for citation in select value from jsonb_array_elements(target_snapshot->'citations') loop
    source_id := (citation->>'recordId')::uuid;
    if coalesce(citation->>'href','') !~ '^/(contacts/[A-Za-z0-9_-]+|activities\?task=[A-Za-z0-9_-]+|transactions(#transaction-[A-Za-z0-9_-]+)?|properties)$' then
      raise exception 'Invalid brief evidence route' using errcode='22023';
    end if;
    source_ok := false;
    case citation->>'sourceType'
      when 'contact' then source_ok := source_id=contact;
      when 'note' then select exists(select 1 from public.notes n where n.id=source_id and n.workspace_id=target_workspace_id and n.archived_at is null and public.resolve_canonical_contact_id(target_workspace_id,n.contact_id)=contact) into source_ok;
      when 'task' then select exists(select 1 from public.tasks t where t.id=source_id and t.workspace_id=target_workspace_id and public.resolve_canonical_contact_id(target_workspace_id,t.contact_id)=contact) into source_ok;
      when 'activity' then select exists(select 1 from public.activity_events e where e.id=source_id and e.workspace_id=target_workspace_id and public.resolve_canonical_contact_id(target_workspace_id,e.contact_id)=contact) into source_ok;
      when 'transaction' then select exists(select 1 from public.real_estate_transactions t where t.id=source_id and t.workspace_id=target_workspace_id and public.resolve_canonical_contact_id(target_workspace_id,t.contact_id)=contact) into source_ok;
      when 'nurture' then select exists(select 1 from public.omnix_nurture_plans n where n.id=source_id and n.workspace_id=target_workspace_id and public.resolve_canonical_contact_id(target_workspace_id,n.contact_id)=contact) into source_ok;
      when 'property-behavior' then select exists(select 1 from public.property_behavior_events e where e.id=source_id and e.workspace_id=target_workspace_id and e.permission_state='allowed' and public.resolve_canonical_contact_id(target_workspace_id,e.contact_id)=contact) into source_ok;
      when 'relationship' then
        select exists(select 1 from public.contact_relationships r where r.id=source_id and r.workspace_id=target_workspace_id and r.archived_at is null and (public.resolve_canonical_contact_id(target_workspace_id,r.first_contact_id)=contact or public.resolve_canonical_contact_id(target_workspace_id,r.second_contact_id)=contact))
          or exists(select 1 from public.household_memberships h where h.id=source_id and h.workspace_id=target_workspace_id and h.ended_at is null and public.resolve_canonical_contact_id(target_workspace_id,h.contact_id)=contact) into source_ok;
      when 'milestone' then select exists(select 1 from public.transaction_workflow_steps s join public.transaction_workflow_plans p on p.id=s.plan_id and p.workspace_id=s.workspace_id join public.real_estate_transactions t on t.id=p.transaction_id and t.workspace_id=p.workspace_id where s.id=source_id and s.workspace_id=target_workspace_id and public.resolve_canonical_contact_id(target_workspace_id,t.contact_id)=contact) into source_ok;
      else source_ok := false;
    end case;
    if not coalesce(source_ok,false) then raise exception 'Brief evidence unavailable' using errcode='P0002'; end if;
  end loop;
  if prior_id is not null then
    select * into prior from public.meeting_brief_snapshots where id=prior_id and workspace_id=target_workspace_id for update;
    if not found or prior.contact_id<>contact or prior.transaction_id is distinct from transaction_ref or (target_snapshot->>'version')::integer<>prior.version+1 then
      raise exception 'Brief revision conflict' using errcode='40001';
    end if;
  elsif (target_snapshot->>'version')::integer <> 1 then
    raise exception 'Invalid initial brief version' using errcode='22023';
  end if;
  insert into public.meeting_brief_snapshots(id,workspace_id,contact_id,transaction_id,created_by_membership_id,prior_snapshot_id,version,snapshot,created_at,expires_at)
  values(new_id,target_workspace_id,contact,transaction_ref,target_membership_id,prior_id,(target_snapshot->>'version')::integer,target_snapshot,(target_snapshot->>'createdAt')::timestamptz,(target_snapshot->>'expiresAt')::timestamptz);
  return new_id;
end $$;
revoke all on function public.create_meeting_brief_snapshot(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_meeting_brief_snapshot(uuid,uuid,jsonb) to authenticated;
commit;
