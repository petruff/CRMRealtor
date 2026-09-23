-- Story 10.2: durable review records. Canonical Omnix approvals retain execution authority.
create table public.capture_outcomes (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  contact_id uuid not null,
  created_by_membership_id uuid not null,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9._:-]{1,100}$'),
  revision integer not null check (revision > 0),
  document jsonb not null check (jsonb_typeof(document) = 'object' and octet_length(document::text) <= 150000),
  created_at timestamptz not null default now(),
  unique (id, workspace_id), unique (workspace_id, idempotency_key),
  foreign key(contact_id,workspace_id) references public.contacts(id,workspace_id),
  foreign key(created_by_membership_id,workspace_id) references public.workspace_members(id,workspace_id)
);
create table public.capture_outcome_versions (
  capture_id uuid not null,
  workspace_id uuid not null,
  version integer not null check(version > 0),
  content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
  document jsonb not null,
  created_at timestamptz not null default now(),
  primary key(capture_id,version),
  foreign key(capture_id,workspace_id) references public.capture_outcomes(id,workspace_id)
);
create table public.capture_outcome_note_receipts (
  workspace_id uuid not null references public.workspaces(id),
  proposal_id uuid not null,
  proposal_version integer not null,
  note_id uuid not null references public.notes(id),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  primary key(workspace_id,idempotency_key),
  unique(proposal_id,proposal_version),
  foreign key(proposal_id,workspace_id) references public.omnix_action_proposals(id,workspace_id)
);
create index capture_outcomes_recent on public.capture_outcomes(workspace_id,created_at desc);
alter table public.capture_outcomes enable row level security;
alter table public.capture_outcomes force row level security;
alter table public.capture_outcome_versions enable row level security;
alter table public.capture_outcome_versions force row level security;
alter table public.capture_outcome_note_receipts enable row level security;
alter table public.capture_outcome_note_receipts force row level security;
create policy capture_outcomes_read on public.capture_outcomes for select to authenticated using(public.has_workspace_access(workspace_id));
create policy capture_outcome_versions_read on public.capture_outcome_versions for select to authenticated using(public.has_workspace_access(workspace_id));
create policy capture_outcome_note_receipts_read on public.capture_outcome_note_receipts for select to authenticated using(public.has_workspace_access(workspace_id));
revoke all on public.capture_outcomes,public.capture_outcome_versions,public.capture_outcome_note_receipts from public,anon,authenticated,service_role;
grant select on public.capture_outcomes,public.capture_outcome_versions,public.capture_outcome_note_receipts to authenticated,service_role;
create trigger capture_outcome_versions_immutable before update or delete on public.capture_outcome_versions for each row execute function public.guard_omnix_proposal_event_mutation();
create trigger capture_outcome_note_receipts_immutable before update or delete on public.capture_outcome_note_receipts for each row execute function public.guard_omnix_proposal_event_mutation();

create or replace function public.save_capture_outcome(target_workspace_id uuid,target_membership_id uuid,target_document jsonb,target_expected_revision integer,target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare prior public.capture_outcomes%rowtype; target_id uuid; item jsonb; old_item jsonb;
  child public.omnix_action_proposals%rowtype; child_payload jsonb;
begin
  perform public.assert_crm_actor_membership(target_membership_id,target_workspace_id);
  target_id := (target_document->>'id')::uuid;
  if jsonb_typeof(target_document) is distinct from 'object'
    or not (target_document ?& array['id','workspaceId','contactId','createdByMembershipId','sourceText','sourceHash','contentHash','operations','revision','version','status','createdAt','expiresAt','targetHash'])
    or exists(select 1 from unnest(array['id','workspaceId','contactId','createdByMembershipId','sourceText','sourceHash','contentHash','revision','version','status','createdAt','expiresAt','targetHash']) key where target_document->>key is null)
    or target_document->>'schemaVersion' is distinct from 'capture-outcome.v1'
    or (target_document->>'workspaceId')::uuid is distinct from target_workspace_id
    or length(target_document->>'sourceText') not between 1 and 8000
    or target_document->>'sourceHash' is distinct from encode(extensions.digest(convert_to(target_document->>'sourceText','UTF8'),'sha256'),'hex')
    or target_document->>'contentHash' !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(target_document->'operations') is distinct from 'array'
    or jsonb_array_length(target_document->'operations') not between 1 and 17
    or target_document->>'status' not in ('pending','selected','executing','completed','partially-completed','failed','stale','expired','rejected','deferred')
    then raise exception 'Invalid capture document' using errcode='22023'; end if;
  if not exists(select 1 from public.contacts where id=(target_document->>'contactId')::uuid and workspace_id=target_workspace_id and archived_at is null) then
    raise exception 'Active workspace contact required' using errcode='42501'; end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(target_document->'operations')) <> jsonb_array_length(target_document->'operations') then raise exception 'Duplicate capture operation IDs' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(target_document->'operations') loop
    if not (item ?& array['id','type','state','selected','after']) or item->>'id' is null or item->>'type' is null or item->>'type' not in ('note-append','task-create')
      or item->>'state' is null or item->>'state' not in ('pending','executing','completed','failed','stale')
      or jsonb_typeof(item->'selected') is distinct from 'boolean' or jsonb_typeof(item->'after') is distinct from 'object' then
      raise exception 'Unsupported capture operation' using errcode='22023'; end if;
    if target_expected_revision is null and (item->>'state' <> 'pending' or item ?| array['childProposalId','receipt']) then raise exception 'New capture cannot claim execution' using errcode='42501'; end if;
    if item ? 'childProposalId' then
      select * into child from public.omnix_action_proposals where id=(item->>'childProposalId')::uuid and workspace_id=target_workspace_id;
      if not found or child.contact_id is distinct from (target_document->>'contactId')::uuid or child.kind::text is distinct from item->>'type' or child.current_version <> 1 then raise exception 'Capture child authority mismatch' using errcode='42501'; end if;
      if child.idempotency_key is distinct from 'capture:'||target_id::text||':'||(target_document->>'version')||':'||(item->>'id') then raise exception 'Capture child provenance mismatch' using errcode='42501'; end if;
      select payload into child_payload from public.omnix_action_proposal_versions where proposal_id=child.id and workspace_id=target_workspace_id and version=1;
      if child_payload->>'contactId' is distinct from target_document->>'contactId'
        or (item->>'type'='note-append' and child_payload->>'body' is distinct from item->'after'->>'text')
        or (item->>'type'='task-create' and (child_payload->>'title' is distinct from item->'after'->>'title' or (child_payload->>'dueAt')::timestamptz is distinct from (item->'after'->>'dueAt')::timestamptz)) then raise exception 'Capture child payload mismatch' using errcode='40001'; end if;
      if item->>'state'='completed' and (child.state <> 'executed' or item->>'receipt' is distinct from child.execution_reference) then raise exception 'Canonical execution receipt required' using errcode='42501'; end if;
      if item ? 'receipt' and (item->>'state' <> 'completed' or item->>'receipt' is distinct from child.execution_reference) then raise exception 'Invalid capture receipt' using errcode='42501'; end if;
    elsif item->>'state'='completed' or item ? 'receipt' then raise exception 'Unbound capture receipt' using errcode='42501';
    end if;
  end loop;
  if target_document->>'status'='completed' and (not exists(select 1 from jsonb_array_elements(target_document->'operations') op where (op->>'selected')::boolean)
    or exists(select 1 from jsonb_array_elements(target_document->'operations') op where (op->>'selected')::boolean and op->>'state' is distinct from 'completed')) then raise exception 'Selected items are not complete' using errcode='42501'; end if;
  if target_expected_revision is null then
    perform pg_advisory_xact_lock(hashtextextended(target_workspace_id::text||':'||target_idempotency_key,0));
    select * into prior from public.capture_outcomes where workspace_id=target_workspace_id and idempotency_key=target_idempotency_key;
    if found then
      if prior.document->>'sourceHash' is distinct from target_document->>'sourceHash' or prior.contact_id is distinct from (target_document->>'contactId')::uuid then raise exception 'Capture key conflict' using errcode='40001'; end if;
      return prior.document;
    end if;
    if (target_document->>'createdByMembershipId')::uuid is distinct from target_membership_id or (target_document->>'revision')::integer <> 1 or (target_document->>'version')::integer <> 1 or target_document->>'status' <> 'pending' then raise exception 'Invalid initial capture' using errcode='22023'; end if;
    insert into public.capture_outcomes(id,workspace_id,contact_id,created_by_membership_id,idempotency_key,revision,document,created_at)
      values(target_id,target_workspace_id,(target_document->>'contactId')::uuid,target_membership_id,target_idempotency_key,1,target_document,(target_document->>'createdAt')::timestamptz);
  else
    select * into prior from public.capture_outcomes where id=target_id and workspace_id=target_workspace_id for update;
    if not found or prior.revision <> target_expected_revision or (target_document->>'revision')::integer <> prior.revision+1 then raise exception 'Capture revision conflict' using errcode='40001'; end if;
    if target_document->>'sourceHash' is distinct from prior.document->>'sourceHash' or target_document->>'contactId' is distinct from prior.document->>'contactId' or target_document->>'createdByMembershipId' is distinct from prior.document->>'createdByMembershipId' then raise exception 'Capture identity is immutable' using errcode='40001'; end if;
    if (target_document->>'version')::integer = (prior.document->>'version')::integer then
      if target_document->>'contentHash' is distinct from prior.document->>'contentHash' then raise exception 'Content requires a new version' using errcode='40001'; end if;
      -- Receipt writes cannot replace the reviewed operations, selection, source, or target preconditions.
      if target_document->>'targetHash' is distinct from prior.document->>'targetHash' or jsonb_array_length(target_document->'operations') <> jsonb_array_length(prior.document->'operations') then raise exception 'Content changed without revision' using errcode='40001'; end if;
      for item in select value from jsonb_array_elements(target_document->'operations') loop
        select value into old_item from jsonb_array_elements(prior.document->'operations') where value->>'id'=item->>'id';
        if old_item is null or (item - array['state','childProposalId','receipt','error']) is distinct from (old_item - array['state','childProposalId','receipt','error']) then raise exception 'Immutable capture operation changed' using errcode='40001'; end if;
      end loop;
    elsif (target_document->>'version')::integer = (prior.document->>'version')::integer+1 then
      if prior.document->>'status' not in ('pending','selected','deferred','stale') or exists(select 1 from jsonb_array_elements(prior.document->'operations') entry where entry ? 'childProposalId') then raise exception 'Approved capture cannot be edited' using errcode='40001'; end if;
    else raise exception 'Invalid capture version' using errcode='40001'; end if;
    update public.capture_outcomes set revision=target_expected_revision+1,document=target_document where id=target_id;
  end if;
  if target_expected_revision is null or (target_document->>'version')::integer > (prior.document->>'version')::integer then
    insert into public.capture_outcome_versions(capture_id,workspace_id,version,content_hash,document) values(target_id,target_workspace_id,(target_document->>'version')::integer,target_document->>'contentHash',target_document);
  end if;
  return target_document;
end $$;

create or replace function public.append_capture_outcome_note(target_workspace_id uuid,target_membership_id uuid,target_proposal_id uuid,target_proposal_version integer,target_contact_id uuid,target_body text,target_idempotency_key text,target_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare proposal public.omnix_action_proposals%rowtype; payload jsonb; receipt_id uuid; owner_id uuid;
begin
  perform public.assert_crm_actor_membership(target_membership_id,target_workspace_id);
  select * into proposal from public.omnix_action_proposals where id=target_proposal_id and workspace_id=target_workspace_id for update;
  if not found or proposal.kind::text <> 'note-append' or proposal.state not in ('executing','executed') or proposal.current_version <> target_proposal_version or proposal.contact_id is distinct from target_contact_id then raise exception 'Approved canonical note required' using errcode='42501'; end if;
  select v.payload into payload from public.omnix_action_proposal_versions v where v.proposal_id=target_proposal_id and v.workspace_id=target_workspace_id and v.version=target_proposal_version;
  if payload->>'body' is distinct from target_body or payload->>'contactId' is distinct from target_contact_id::text or length(trim(target_body)) not between 1 and 8000
    or target_idempotency_key is distinct from 'omnix:'||target_proposal_id::text||':'||target_proposal_version::text then raise exception 'Approved note payload mismatch' using errcode='40001'; end if;
  select note_id into receipt_id from public.capture_outcome_note_receipts where proposal_id=target_proposal_id and proposal_version=target_proposal_version and workspace_id=target_workspace_id;
  if found then return jsonb_build_object('id',receipt_id); end if;
  select c.owner_id into owner_id from public.contacts c where c.id=target_contact_id and c.workspace_id=target_workspace_id and c.archived_at is null for share;
  if not found then raise exception 'Active contact required' using errcode='42501'; end if;
  insert into public.notes(contact_id,workspace_id,owner_id,body,created_at) values(target_contact_id,target_workspace_id,owner_id,target_body,target_occurred_at) returning id into receipt_id;
  perform public.append_activity_event(target_workspace_id,'note-added'::public.crm_activity_event_type,target_membership_id,target_occurred_at,'note-added:'||receipt_id::text,target_contact_id,null,null);
  insert into public.capture_outcome_note_receipts(workspace_id,proposal_id,proposal_version,note_id,idempotency_key) values(target_workspace_id,target_proposal_id,target_proposal_version,receipt_id,target_idempotency_key);
  return jsonb_build_object('id',receipt_id);
end $$;
revoke all on function public.save_capture_outcome(uuid,uuid,jsonb,integer,text),public.append_capture_outcome_note(uuid,uuid,uuid,integer,uuid,text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.save_capture_outcome(uuid,uuid,jsonb,integer,text),public.append_capture_outcome_note(uuid,uuid,uuid,integer,uuid,text,text,timestamptz) to authenticated;
