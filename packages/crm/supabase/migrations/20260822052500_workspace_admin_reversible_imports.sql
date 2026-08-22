-- Honor audited workspace-admin grants for reversible historical import
-- organization while preserving the active-membership and workspace checks.

begin;

create or replace function public.apply_imported_contact_organization(
  target_workspace_id uuid,
  target_actor_membership_id uuid,
  target_policy_version text,
  target_request_hash text,
  target_changes jsonb,
  target_occurred_at timestamptz
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  existing_run public.imported_contact_organization_runs%rowtype;
  created_run public.imported_contact_organization_runs%rowtype;
  change_item jsonb;
  current_contact public.contacts%rowtype;
  before_value jsonb;
  after_value jsonb;
  target_contact_id uuid;
  expected_updated_at timestamptz;
  item_count integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.workspace_members member
    where member.id=target_actor_membership_id
      and member.workspace_id=target_workspace_id
      and member.user_id=auth.uid()
      and member.status='active' and member.revoked_at is null
  ) or not public.is_workspace_owner(target_workspace_id) then
    raise exception 'Only the active workspace owner can organize historical imports.' using errcode='42501';
  end if;
  if target_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid request hash.' using errcode='22023'; end if;
  if target_policy_version is null or length(target_policy_version) not between 1 and 80 then raise exception 'Invalid policy version.' using errcode='22023'; end if;
  if target_occurred_at is null or abs(extract(epoch from (now()-target_occurred_at)))>300 then raise exception 'Organization timestamp is outside the accepted window.' using errcode='22023'; end if;
  if jsonb_typeof(target_changes)<>'array' then raise exception 'Organization changes must be an array.' using errcode='22023'; end if;
  item_count:=jsonb_array_length(target_changes);
  if item_count<1 or item_count>500 then raise exception 'Organization batch must contain 1 to 500 contacts.' using errcode='22023'; end if;
  if (select count(*) from (select item->>'contactId' from jsonb_array_elements(target_changes) item group by 1) grouped)<>item_count then
    raise exception 'Organization batch contains duplicate contacts.' using errcode='22023';
  end if;

  select * into existing_run from public.imported_contact_organization_runs
    where workspace_id=target_workspace_id and request_hash=target_request_hash;
  if found then
    return jsonb_build_object('runId',existing_run.id,'contactCount',existing_run.contact_count,'state',existing_run.state,'noOp',true,'rollbackAvailable',existing_run.state='applied');
  end if;

  insert into public.imported_contact_organization_runs(
    workspace_id,actor_membership_id,policy_version,request_hash,state,contact_count,applied_at
  ) values (
    target_workspace_id,target_actor_membership_id,target_policy_version,target_request_hash,'applied',item_count,target_occurred_at
  ) returning * into created_run;

  for change_item in select value from jsonb_array_elements(target_changes)
  loop
    begin
      target_contact_id:=(change_item->>'contactId')::uuid;
      expected_updated_at:=(change_item->>'expectedUpdatedAt')::timestamptz;
      after_value:=change_item->'after';
    exception when others then
      raise exception 'Organization change has an invalid identity or timestamp.' using errcode='22023';
    end;
    if jsonb_typeof(after_value)<>'object'
      or not (after_value ?& array['leadType','qualificationStatus','relationship','intent','source','pipelineStage','nextTouchAt','touchDateOverridden']) then
      raise exception 'Organization change is missing required CRM fields.' using errcode='22023';
    end if;

    select * into current_contact from public.contacts contact
      where contact.id=target_contact_id and contact.workspace_id=target_workspace_id
      for update;
    if not found then raise exception 'Organization contact is unavailable.' using errcode='P0002'; end if;
    if current_contact.updated_at<>expected_updated_at then
      raise exception 'A contact changed after preview. Review the batch again before applying.' using errcode='40001';
    end if;

    before_value:=jsonb_build_object(
      'leadType',current_contact.lead_type::text,
      'qualificationStatus',current_contact.qualification_status::text,
      'relationship',current_contact.relationship::text,
      'intent',current_contact.intent::text,
      'source',current_contact.source::text,
      'pipelineStage',current_contact.pipeline_stage::text,
      'nextTouchAt',to_jsonb(current_contact.next_touch_at),
      'touchDateOverridden',current_contact.touch_date_overridden
    );

    begin
      update public.contacts set
        lead_type=(after_value->>'leadType')::public.lead_type,
        qualification_status=(after_value->>'qualificationStatus')::public.crm_qualification_status,
        relationship=(after_value->>'relationship')::public.relationship,
        intent=(after_value->>'intent')::public.intent,
        source=(after_value->>'source')::public.lead_source,
        pipeline_stage=(after_value->>'pipelineStage')::public.pipeline_stage,
        next_touch_at=(after_value->>'nextTouchAt')::date,
        touch_date_overridden=(after_value->>'touchDateOverridden')::boolean,
        updated_at=target_occurred_at
      where id=target_contact_id and workspace_id=target_workspace_id;
    exception when others then
      raise exception 'Organization change contains an invalid CRM value.' using errcode='22023';
    end;

    insert into public.imported_contact_organization_items(
      workspace_id,run_id,contact_id,before_snapshot,after_snapshot,before_updated_at,after_updated_at
    ) values (
      target_workspace_id,created_run.id,target_contact_id,before_value,after_value,current_contact.updated_at,target_occurred_at
    );
  end loop;

  return jsonb_build_object('runId',created_run.id,'contactCount',item_count,'state','applied','noOp',false,'rollbackAvailable',true);
end;
$$;

create or replace function public.rollback_imported_contact_organization(
  target_run_id uuid,
  target_actor_membership_id uuid,
  target_request_hash text,
  target_occurred_at timestamptz
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  target_run public.imported_contact_organization_runs%rowtype;
  item public.imported_contact_organization_items%rowtype;
  current_contact public.contacts%rowtype;
  current_value jsonb;
begin
  select * into target_run from public.imported_contact_organization_runs where id=target_run_id for update;
  if not found then raise exception 'Organization run was not found.' using errcode='P0002'; end if;
  if auth.uid() is null or not exists (
    select 1 from public.workspace_members member
    where member.id=target_actor_membership_id
      and member.workspace_id=target_run.workspace_id
      and member.user_id=auth.uid()
      and member.status='active' and member.revoked_at is null
  ) or not public.is_workspace_owner(target_run.workspace_id) then raise exception 'Only the active workspace owner can roll back historical organization.' using errcode='42501'; end if;
  if target_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid rollback request hash.' using errcode='22023'; end if;
  if target_occurred_at is null or abs(extract(epoch from (now()-target_occurred_at)))>300 then raise exception 'Rollback timestamp is outside the accepted window.' using errcode='22023'; end if;
  if target_run.state='rolled-back' then
    if target_run.rollback_request_hash<>target_request_hash then raise exception 'Rollback key conflicts with the completed rollback.' using errcode='23505'; end if;
    return jsonb_build_object('runId',target_run.id,'contactCount',target_run.contact_count,'state','rolled-back','noOp',true);
  end if;

  for item in select * from public.imported_contact_organization_items where run_id=target_run.id order by contact_id for update
  loop
    select * into current_contact from public.contacts contact
      where contact.id=item.contact_id and contact.workspace_id=target_run.workspace_id for update;
    if not found then raise exception 'A rollback contact is unavailable.' using errcode='P0002'; end if;
    current_value:=jsonb_build_object(
      'leadType',current_contact.lead_type::text,
      'qualificationStatus',current_contact.qualification_status::text,
      'relationship',current_contact.relationship::text,
      'intent',current_contact.intent::text,
      'source',current_contact.source::text,
      'pipelineStage',current_contact.pipeline_stage::text,
      'nextTouchAt',to_jsonb(current_contact.next_touch_at),
      'touchDateOverridden',current_contact.touch_date_overridden
    );
    if current_contact.updated_at<>item.after_updated_at or current_value<>item.after_snapshot then
      raise exception 'A contact changed after organization. Rollback stopped without changing any contact.' using errcode='40001';
    end if;
  end loop;

  for item in select * from public.imported_contact_organization_items where run_id=target_run.id order by contact_id
  loop
    update public.contacts set
      lead_type=(item.before_snapshot->>'leadType')::public.lead_type,
      qualification_status=(item.before_snapshot->>'qualificationStatus')::public.crm_qualification_status,
      relationship=(item.before_snapshot->>'relationship')::public.relationship,
      intent=(item.before_snapshot->>'intent')::public.intent,
      source=(item.before_snapshot->>'source')::public.lead_source,
      pipeline_stage=(item.before_snapshot->>'pipelineStage')::public.pipeline_stage,
      next_touch_at=(item.before_snapshot->>'nextTouchAt')::date,
      touch_date_overridden=(item.before_snapshot->>'touchDateOverridden')::boolean,
      updated_at=target_occurred_at
    where id=item.contact_id and workspace_id=target_run.workspace_id;
  end loop;

  update public.imported_contact_organization_runs set
    state='rolled-back',rolled_back_at=target_occurred_at,rollback_request_hash=target_request_hash
  where id=target_run.id;
  return jsonb_build_object('runId',target_run.id,'contactCount',target_run.contact_count,'state','rolled-back','noOp',false);
end;
$$;

revoke all on function public.apply_imported_contact_organization(uuid,uuid,text,text,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.apply_imported_contact_organization(uuid,uuid,text,text,jsonb,timestamptz) to authenticated;
revoke all on function public.rollback_imported_contact_organization(uuid,uuid,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.rollback_imported_contact_organization(uuid,uuid,text,timestamptz) to authenticated;

commit;
