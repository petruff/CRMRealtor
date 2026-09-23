-- Capture operation content binding, shared by guarded parent persistence.
create or replace function public.capture_operation_child_payload(contact_id text, operation jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog,public as $$
declare a jsonb:=operation->'after'; p jsonb:=coalesce(operation->'preconditions','{}'); result jsonb;
begin
  case operation->>'type'
    when 'note-append' then result:=jsonb_build_object('contactId',contact_id,'body',a->>'text');
    when 'task-create' then result:=jsonb_build_object('contactId',contact_id,'title',a->>'title','dueAt',a->>'dueAt');
    when 'pipeline-move' then result:=jsonb_build_object('contactId',contact_id,'fromStage',p->>'pipelineStage','toStage',a->>'toStage','expectedUpdatedAt',p->>'contactVersion');
    when 'nurture-plan' then result:=jsonb_build_object('contactId',contact_id,'cadenceDays',(a->>'cadenceDays')::integer,'maximumSteps',(a->>'maximumSteps')::integer,'startAt',a->>'startAt');
    when 'nurture-transition' then
      result:=jsonb_build_object('contactId',contact_id,'planId',a->>'planId','expectedVersion',(p->>'planVersion')::integer,'action',a->>'action');
      if a ? 'snoozedUntil' then result:=result||jsonb_build_object('snoozedUntil',a->>'snoozedUntil'); end if;
      if a ? 'stopReason' then result:=result||jsonb_build_object('stopReason',a->>'stopReason'); end if;
    when 'google-email-draft' then result:=jsonb_build_object('contactId',contact_id,'connectionId',a->>'connectionId','contactPointId',a->>'contactPointId','recipient',p->>'recipient','sender',p->>'sender','contactPointVersion',p->>'contactPointVersion','connectionVersion',p->>'connectionVersion','subject',a->>'subject','body',a->>'body','captureExactTarget',true);
    when 'google-calendar-event' then result:=jsonb_build_object('contactId',contact_id,'connectionId',a->>'connectionId','connectionVersion',p->>'connectionVersion','taskId',a->>'taskId','taskVersion',(p->>'taskVersion')::integer,'title',p->>'taskTitle','startAt',a->>'startAt','endAt',a->>'endAt','timeZone',a->>'timeZone','captureExactTarget',true);
    else raise exception 'Unsupported capture operation' using errcode='22023';
  end case;
  if exists(select 1 from jsonb_each(result) entry where entry.value='null'::jsonb) then raise exception 'Incomplete capture child payload' using errcode='22023'; end if;
  return result;
end $$;
revoke all on function public.capture_operation_child_payload(text,jsonb) from public,anon,authenticated,service_role;
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
    or target_document->>'status' not in ('pending','selected','executing','completed','awaiting-provider','partially-completed','failed','stale','expired','rejected','deferred')
    then raise exception 'Invalid capture document' using errcode='22023'; end if;
  if not exists(select 1 from public.contacts where id=(target_document->>'contactId')::uuid and workspace_id=target_workspace_id and archived_at is null) then
    raise exception 'Active workspace contact required' using errcode='42501'; end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(target_document->'operations')) <> jsonb_array_length(target_document->'operations') then raise exception 'Duplicate capture operation IDs' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(target_document->'operations') loop
    if not (item ?& array['id','type','state','selected','after']) or item->>'id' is null or item->>'type' is null or item->>'type' not in ('note-append','task-create','pipeline-move','nurture-plan','nurture-transition','google-email-draft','google-calendar-event')
      or item->>'state' is null or item->>'state' not in ('pending','executing','completed','awaiting-provider','failed','stale')
      or jsonb_typeof(item->'selected') is distinct from 'boolean' or jsonb_typeof(item->'after') is distinct from 'object' then
      raise exception 'Unsupported capture operation' using errcode='22023'; end if;
    if item->>'type' in ('google-email-draft','google-calendar-event') and item->>'state'='completed' then raise exception 'Provider intent is not provider completion' using errcode='42501'; end if;
    if item->>'type' in ('google-email-draft','google-calendar-event') and item->>'requiredAuthority' is distinct from 'owner' then raise exception 'Provider preparation requires owner authority' using errcode='42501'; end if;
    if item->>'type' not in ('google-email-draft','google-calendar-event') and item->>'state'='awaiting-provider' then raise exception 'Only provider items await provider approval' using errcode='42501'; end if;
    if target_expected_revision is null and (item->>'state' <> 'pending' or item ?| array['childProposalId','receipt']) then raise exception 'New capture cannot claim execution' using errcode='42501'; end if;
    if item ? 'childProposalId' then
      select * into child from public.omnix_action_proposals where id=(item->>'childProposalId')::uuid and workspace_id=target_workspace_id;
      if not found or child.contact_id is distinct from (target_document->>'contactId')::uuid or child.kind::text is distinct from item->>'type' or child.current_version <> 1 then raise exception 'Capture child authority mismatch' using errcode='42501'; end if;
      if item->>'type' in ('google-email-draft','google-calendar-event') and child.approval_mode <> 'owner' then raise exception 'Provider child requires owner approval' using errcode='42501'; end if;
      if child.idempotency_key is distinct from 'capture:'||target_id::text||':'||(target_document->>'version')||':'||(item->>'id') then raise exception 'Capture child provenance mismatch' using errcode='42501'; end if;
      select payload into child_payload from public.omnix_action_proposal_versions where proposal_id=child.id and workspace_id=target_workspace_id and version=1;
      if child_payload is distinct from public.capture_operation_child_payload(target_document->>'contactId',item) then raise exception 'Capture child payload mismatch' using errcode='40001'; end if;
      if item->>'state' in ('completed','awaiting-provider') and (child.state <> 'executed' or item->>'receipt' is distinct from child.execution_reference) then raise exception 'Canonical execution receipt required' using errcode='42501'; end if;
      if item ? 'receipt' and (item->>'state' not in ('completed','awaiting-provider') or item->>'receipt' is distinct from child.execution_reference) then raise exception 'Invalid capture receipt' using errcode='42501'; end if;
      if item->>'state'='awaiting-provider' and (item->>'receipt' not like 'connector-intent:%' or not exists(select 1 from public.connector_action_intents intent where intent.id=replace(item->>'receipt','connector-intent:','')::uuid and intent.workspace_id=target_workspace_id and intent.correlation_id=child.correlation_id)) then raise exception 'Canonical provider intent required' using errcode='42501'; end if;
    elsif item->>'state' in ('completed','awaiting-provider') or item ? 'receipt' then raise exception 'Unbound capture receipt' using errcode='42501';
    end if;
  end loop;
  if target_document->>'status'='completed' and (not exists(select 1 from jsonb_array_elements(target_document->'operations') op where (op->>'selected')::boolean)
    or exists(select 1 from jsonb_array_elements(target_document->'operations') op where (op->>'selected')::boolean and op->>'state' is distinct from 'completed')) then raise exception 'Selected items are not complete' using errcode='42501'; end if;
  if target_document->>'status'='awaiting-provider' and (
    not exists(select 1 from jsonb_array_elements(target_document->'operations') op where (op->>'selected')::boolean and op->>'state'='awaiting-provider')
    or exists(select 1 from jsonb_array_elements(target_document->'operations') op where (op->>'selected')::boolean and op->>'state' not in ('completed','awaiting-provider'))
  ) then raise exception 'Selected items have not reached provider approval' using errcode='42501'; end if;
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
