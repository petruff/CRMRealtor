-- Story 3.2 SQL/RLS/backfill/archive/import matrix.
-- Prerequisite: migrations 0001..0007 applied to an isolated Supabase DB.
-- Assertions are fail-fast, TAP is emitted directly, and all fixtures roll back.

begin;

select '1..18';

do $$
declare target_table text;
begin
  foreach target_table in array array[
    'contact_points', 'households', 'household_memberships',
    'contact_relationships', 'contact_assignments',
    'contact_custom_field_definitions', 'contact_custom_field_values'
  ] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = target_table
        and column_name = 'workspace_id' and is_nullable = 'NO'
    ) or not exists (
      select 1 from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public' and relation.relname = target_table
        and relation.relrowsecurity and relation.relforcerowsecurity
    ) or has_table_privilege('authenticated', 'public.' || target_table, 'INSERT')
      or has_table_privilege('authenticated', 'public.' || target_table, 'UPDATE')
      or has_table_privilege('authenticated', 'public.' || target_table, 'DELETE') then
      raise exception 'rich-contact authority/grant boundary failed for %', target_table;
    end if;
  end loop;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and column_name = 'rating'
      and table_name in ('contacts', 'contact_points')
  ) then raise exception 'independent rating authority exists'; end if;
end;
$$;

select 'ok 1 - seven workspace tables use forced RLS, RPC-only writes and no rating axis';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000','11000000-0000-4000-8000-000000000001','authenticated','authenticated','owner-a@omnix.test','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','11000000-0000-4000-8000-000000000002','authenticated','authenticated','assistant-a@omnix.test','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','11000000-0000-4000-8000-000000000003','authenticated','authenticated','owner-b@omnix.test','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','11000000-0000-4000-8000-000000000004','authenticated','authenticated','revoked-a@omnix.test','',now(),'{}','{}',now(),now());

insert into public.workspaces (id, name) values
  ('21000000-0000-4000-8000-000000000001','Rich Contact A'),
  ('21000000-0000-4000-8000-000000000002','Rich Contact B');

select set_config('omnix.actor_user_id','11000000-0000-4000-8000-000000000001',true);
insert into public.workspace_members (id,workspace_id,user_id,role,status,revoked_at) values
  ('31000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','owner','active',null),
  ('31000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','assistant','active',null),
  ('31000000-0000-4000-8000-000000000004','21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000004','assistant','revoked',now());
select set_config('omnix.actor_user_id','11000000-0000-4000-8000-000000000003',true);
insert into public.workspace_members (id,workspace_id,user_id,role,status) values
  ('31000000-0000-4000-8000-000000000003','21000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000003','owner','active');
set constraints all immediate;
set constraints all deferred;

insert into public.contacts (
  id, owner_id, workspace_id, first_name, last_name, phone,
  secondary_phone, email, lead_type, relationship, intent, source,
  pipeline_stage, tags, created_at, updated_at
) values
  ('41000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','Ada','Lovelace','+1 (555) 010-1000','555-010-1001','Ada@Example.com','hot','lead','buyer','referral','new','{}','2026-08-11T10:00:00Z','2026-08-11T10:00:00Z'),
  ('41000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','Grace','Hopper','+1 555 010 1000',null,'grace@example.com','warm','sphere','seller','other','contacted','{}','2026-08-11T10:01:00Z','2026-08-11T10:01:00Z'),
  ('41000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000003','21000000-0000-4000-8000-000000000002','Katherine','Johnson','5550102000',null,'kj@example.com','nurture','lead','unknown','website','new','{}','2026-08-11T10:02:00Z','2026-08-11T10:02:00Z');

do $$ begin
  if (select count(*) from public.contact_points where contact_id='41000000-0000-4000-8000-000000000001') <> 3
     or (select count(*) from public.contact_points where contact_id='41000000-0000-4000-8000-000000000001' and is_primary) <> 2
     or not exists (select 1 from public.contact_points where contact_id='41000000-0000-4000-8000-000000000001' and normalized_value='5550101000')
     or not exists (select 1 from public.contact_points where contact_id='41000000-0000-4000-8000-000000000001' and normalized_value='ada@example.com') then
    raise exception 'legacy scalar projection failed';
  end if;
end $$;
select 'ok 2 - legacy scalar writes create deterministic normalized canonical points';

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);

do $$
declare third_phone public.contact_points; point_count integer;
begin
  begin
    perform public.add_contact_point(
      '41000000-0000-4000-8000-000000000001','phone','duplicate','(555) 010-1001','5550101001',false,null,2,
      '31000000-0000-4000-8000-000000000001','2026-08-11T10:59:59Z');
    raise exception 'duplicate point unexpectedly succeeded';
  exception when unique_violation then null; end;
  third_phone := public.add_contact_point(
    '41000000-0000-4000-8000-000000000001','phone','office','5550101002','5550101002',false,null,2,
    '31000000-0000-4000-8000-000000000001','2026-08-11T11:00:00Z'
  );
  begin
    perform public.add_contact_point(
      '41000000-0000-4000-8000-000000000001','phone','overflow','5550101003','5550101003',false,null,3,
      '31000000-0000-4000-8000-000000000001','2026-08-11T11:00:01Z');
    raise exception 'fourth phone unexpectedly succeeded';
  exception when check_violation then null; end;
  select count(*) into point_count from public.contact_points
  where contact_id='41000000-0000-4000-8000-000000000001' and type='phone' and archived_at is null;
  if point_count<>3 then raise exception 'phone bound was not preserved'; end if;
  perform set_config('omnix.test_third_phone',third_phone.id::text,true);
end $$;
select 'ok 3 - active point count, normalized duplicate and per-contact bounds fail closed';

do $$
declare target_id uuid; updated public.contact_points;
begin
  select id into target_id from public.contact_points
  where contact_id='41000000-0000-4000-8000-000000000001' and normalized_value='5550101001';
  updated := public.update_contact_point(target_id,'secondary','555-010-1001','5550101001',true,null,0,
    '31000000-0000-4000-8000-000000000001','2026-08-11T11:01:00Z');
  if (select count(*) from public.contact_points where contact_id=updated.contact_id and type='phone' and archived_at is null and is_primary)<>1
     or (select phone from public.contacts where id=updated.contact_id)<>'555-010-1001' then
    raise exception 'primary/projection update failed';
  end if;
end $$;
select 'ok 4 - one primary per type and legacy projection update atomically';

do $$
declare point_id uuid; archived public.contact_points;
begin
  point_id:=current_setting('omnix.test_third_phone')::uuid;
  archived:=public.archive_contact_point(point_id,'31000000-0000-4000-8000-000000000001','cleanup','2026-08-11T11:02:00Z');
  perform public.add_contact_point('41000000-0000-4000-8000-000000000001','phone','replacement','5550101004','5550101004',false,null,2,'31000000-0000-4000-8000-000000000001','2026-08-11T11:02:01Z');
  begin
    perform public.restore_contact_point(point_id,'31000000-0000-4000-8000-000000000001','2026-08-11T11:02:02Z');
    raise exception 'conflicting restore unexpectedly succeeded';
  exception when check_violation then null; end;
end $$;
select 'ok 5 - point archive preserves history and restore conflicts at the active bound';

do $$
declare household public.households; membership public.household_memberships;
begin
  household:=public.create_household('Lovelace household','31000000-0000-4000-8000-000000000001','2026-08-11T11:03:00Z');
  membership:=public.add_household_member(household.id,'41000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','2026-08-11T11:03:01Z');
  perform set_config('omnix.test_household',household.id::text,true);
  begin
    perform public.add_household_member(household.id,'41000000-0000-4000-8000-000000000003','31000000-0000-4000-8000-000000000001','2026-08-11T11:03:02Z');
    raise exception 'cross-workspace household link unexpectedly succeeded';
  exception when foreign_key_violation then null; when check_violation then null; end;
  perform public.remove_household_member(household.id,membership.contact_id,'31000000-0000-4000-8000-000000000001','2026-08-11T11:03:03Z');
  if not exists(select 1 from public.household_memberships where id=membership.id and ended_at='2026-08-11T11:03:03Z' and ended_by_membership_id='31000000-0000-4000-8000-000000000001') then
    raise exception 'household history was not retained';
  end if;
end $$;
select 'ok 6 - household membership is workspace-local and removal retains actor/time history';

do $$
declare relationship public.contact_relationships;
begin
  relationship:=public.add_contact_relationship('41000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000001','partner',null,'31000000-0000-4000-8000-000000000001','2026-08-11T11:04:00Z');
  if relationship.first_contact_id>'41000000-0000-4000-8000-000000000002'::uuid then raise exception 'pair not canonical'; end if;
  begin
    perform public.add_contact_relationship('41000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000002','spouse',null,'31000000-0000-4000-8000-000000000001','2026-08-11T11:04:01Z');
    raise exception 'reverse duplicate unexpectedly succeeded';
  exception when unique_violation then null; end;
  begin
    perform public.add_contact_relationship('41000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','other','self','31000000-0000-4000-8000-000000000001','2026-08-11T11:04:02Z');
    raise exception 'self link unexpectedly succeeded';
  exception when check_violation then null; end;
end $$;
select 'ok 7 - relationships canonicalize unordered pairs and reject reverse/self links';

do $$
declare assignment public.contact_assignments; second_assignment public.contact_assignments;
begin
  assignment:=public.assign_contact('41000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000001','2026-08-11T11:05:00Z');
  perform public.unassign_contact(assignment.id,'31000000-0000-4000-8000-000000000001','2026-08-11T11:05:01Z');
  second_assignment:=public.assign_contact('41000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000001','2026-08-11T11:05:02Z');
  if assignment.id=second_assignment.id or (select count(*) from public.contact_assignments where contact_id=assignment.contact_id)<>2 then raise exception 'assignment history collapsed'; end if;
  begin
    perform public.assign_contact('41000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000004','31000000-0000-4000-8000-000000000001','2026-08-11T11:05:03Z');
    raise exception 'revoked assignment unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
select 'ok 8 - assignment history survives reassignment and revoked assignees fail closed';

do $$
declare definition public.contact_custom_field_definitions; stored public.contact_custom_field_values;
begin
  definition:=public.create_contact_custom_field_definition('Financing lane','single-select',array['Cash','Mortgage'],0,'31000000-0000-4000-8000-000000000001','2026-08-11T11:06:00Z');
  perform set_config('omnix.test_definition',definition.id::text,true);
  perform set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000002',true);
  stored:=public.set_contact_custom_field_value('41000000-0000-4000-8000-000000000001',definition.id,to_jsonb('Cash'::text),'31000000-0000-4000-8000-000000000002','2026-08-11T11:06:01Z');
  if stored.selected_value<>'Cash' then raise exception 'typed value not stored'; end if;
  begin
    perform public.create_contact_custom_field_definition('Assistant field','text','{}',1,'31000000-0000-4000-8000-000000000002','2026-08-11T11:06:02Z');
    raise exception 'assistant definition unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_contact_custom_field_value('41000000-0000-4000-8000-000000000001',definition.id,to_jsonb('Wire'::text),'31000000-0000-4000-8000-000000000002','2026-08-11T11:06:03Z');
    raise exception 'invalid option unexpectedly succeeded';
  exception when check_violation then null; end;
  perform set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
end $$;
select 'ok 9 - owners define typed fields while assistants set only allowlisted values';

do $$ begin
  update public.contacts set buyer_criteria='{"mortgageType":"va","desiredPropertyType":"condo","currentTenure":"rents"}',seller_criteria='{"hasPropertyToSell":"maybe","propertyType":"townhome","bedrooms":3,"bathrooms":2.5}' where id='41000000-0000-4000-8000-000000000001';
  begin
    update public.contacts set buyer_criteria='{"mortgageType":"invented"}' where id='41000000-0000-4000-8000-000000000001';
    raise exception 'invalid richer fact unexpectedly succeeded';
  exception when check_violation then null; end;
end $$;
select 'ok 10 - richer buyer/seller facts are typed, bounded and preserve unknown semantics';

do $$
declare archived jsonb;
begin
  archived:=public.archive_contact('41000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','duplicate cleanup','2026-08-11T11:07:00Z');
  if archived->>'contactId'<>'41000000-0000-4000-8000-000000000001' or exists(select 1 from public.active_contacts where id='41000000-0000-4000-8000-000000000001') then raise exception 'active archive projection failed'; end if;
  begin delete from public.contacts where id='41000000-0000-4000-8000-000000000001'; raise exception 'hard delete succeeded'; exception when insufficient_privilege then null; when check_violation then null; end;
  begin
    perform public.create_task_with_event('21000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','Forbidden archived task',null,'2026-08-12T12:00:00Z','31000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000002','archived-task-key','archived-task-event-key','2026-08-11T11:07:01Z');
    raise exception 'archived task unexpectedly succeeded';
  exception when check_violation then null; end;
end $$;
select 'ok 11 - archive hides default reads, blocks hard delete and rejects new tasks';

do $$
declare restored jsonb;
begin
  restored:=public.restore_contact('41000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','2026-08-11T11:08:00Z');
  if restored->>'contactId'<>'41000000-0000-4000-8000-000000000001' or not exists(select 1 from public.contact_points where contact_id='41000000-0000-4000-8000-000000000001') or not exists(select 1 from public.contact_custom_field_values where contact_id='41000000-0000-4000-8000-000000000001') then raise exception 'restore lost identity/history'; end if;
end $$;
select 'ok 12 - restore returns the same contact ID with point/custom/activity history intact';

select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000003',true);
do $$ begin
  if exists(select 1 from public.contact_points where workspace_id='21000000-0000-4000-8000-000000000001') or (select count(*) from public.contact_points)<>2 then raise exception 'workspace B RLS leak'; end if;
end $$;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000004',true);
do $$ begin if exists(select 1 from public.contact_points) then raise exception 'revoked member retained access'; end if; end $$;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
select 'ok 13 - two-workspace and revoked-member RLS isolation fail closed';

do $$ declare identity jsonb;
begin
  perform public.add_contact_point(
    '41000000-0000-4000-8000-000000000002','phone','shared','5550101004','5550101004',false,null,1,
    '31000000-0000-4000-8000-000000000001','2026-08-11T11:08:30Z'
  );
  identity:=public.resolve_contact_import_identity('21000000-0000-4000-8000-000000000001',null,null,null,'5550101004');
  if identity->>'outcome'<>'ambiguous-identity' or (identity->>'matchCount')::int<>2 then raise exception 'shared point was merged'; end if;
  insert into public.contact_external_links(owner_id,workspace_id,contact_id,provider,external_id) values('11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','contract-import','ext-ada');
  perform public.archive_contact('41000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','identity test','2026-08-11T11:09:00Z');
  identity:=public.resolve_contact_import_identity('21000000-0000-4000-8000-000000000001','contract-import','ext-ada',null,null);
  if identity->>'outcome'<>'archived-match' then raise exception 'archived identity was mutated'; end if;
  perform public.restore_contact('41000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','2026-08-11T11:09:01Z');
end $$;
select 'ok 14 - identity resolution reports shared ambiguity and explicit archived-match';

do $$
declare result jsonb; merge_result jsonb; created_id uuid;
begin
  result:=public.apply_contact_import_group(
    '21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001',
    'group-success-0001',repeat('b',64),
    jsonb_build_object(
      'action','create','contact',jsonb_build_object(
        'firstName','Dorothy','lastName','Vaughan','phone','5550103000','email','dorothy@example.com',
        'leadType','warm','relationship','lead','intent','buyer','source','other','pipelineStage','new','tags','[]'::jsonb,
        'buyer',jsonb_build_object('mortgageType','conventional','desiredPropertyType','single-family','currentTenure','rents')
      ),
      'points',jsonb_build_array(jsonb_build_object('type','phone','label','office','displayValue','5550103001','normalizedValue','5550103001','isPrimary',false,'displayOrder',1)),
      'householdIds',jsonb_build_array(current_setting('omnix.test_household')),
      'assigneeMembershipIds',jsonb_build_array('31000000-0000-4000-8000-000000000002'),
      'customValues',jsonb_build_array(jsonb_build_object('definitionId',current_setting('omnix.test_definition'),'value','Mortgage')),
      'externalLink',jsonb_build_object('provider','contract-import','externalId','ext-dorothy'),
      'note','Met at the neighborhood open house.',
      'activityIdempotencyKey','import:group-success-0001'
    ),'2026-08-11T11:10:00Z'
  );
  created_id:=(result->>'contactId')::uuid;
  perform set_config('omnix.test_imported_contact',created_id::text,true);
  merge_result:=public.apply_contact_import_group(
    '21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001',
    'group-merge-0001',repeat('e',64),
    jsonb_build_object(
      'action','unchanged','contactId',created_id::text,
      'externalLink',jsonb_build_object('provider','contract-import','externalId','ext-dorothy-merge'),
      'note','Merged duplicate source row.',
      'activityIdempotencyKey','import:group-merge-0001'
    ),'2026-08-11T11:10:00Z'
  );
  if result->>'action'<>'create' or not (result->>'notesAdded')::boolean
    or merge_result->>'action'<>'unchanged' or not (merge_result->>'notesAdded')::boolean
    or (select count(*) from public.contact_points where contact_id=created_id)<>3
    or not exists(select 1 from public.household_memberships where contact_id=created_id and ended_at is null)
    or not exists(select 1 from public.contact_assignments where contact_id=created_id and unassigned_at is null)
    or not exists(select 1 from public.contact_custom_field_values where contact_id=created_id)
    or not exists(select 1 from public.contact_external_links where contact_id=created_id and external_id='ext-dorothy')
    or not exists(select 1 from public.contact_external_links where contact_id=created_id and external_id='ext-dorothy-merge')
    or not exists(select 1 from public.notes where contact_id=created_id and body='Met at the neighborhood open house.')
    or not exists(select 1 from public.notes where contact_id=created_id and body='Merged duplicate source row.')
    or not exists(select 1 from public.activity_events where contact_id=created_id and type='contact-imported') then raise exception 'atomic import group is incomplete'; end if;
end $$;
select 'ok 15 - atomic create and unchanged merge groups persist links, notes and activities';

do $$ declare replay jsonb; before_count bigint;
begin
  select count(*) into before_count from public.contacts;
  replay:=public.apply_contact_import_group('21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','group-success-0001',repeat('b',64),'{}','2026-08-11T11:10:01Z');
  if not (replay->>'noOp')::boolean or (select count(*) from public.contacts)<>before_count then raise exception 'group replay mutated'; end if;
  begin perform public.apply_contact_import_group('21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','group-success-0001',repeat('c',64),'{}','2026-08-11T11:10:02Z'); raise exception 'divergent replay succeeded'; exception when unique_violation then null; end;
end $$;
select 'ok 16 - atomic import replay is a no-op and divergent hashes fail closed';

do $$ declare before_count bigint;
begin
  select count(*) into before_count from public.contacts;
  begin
    perform public.apply_contact_import_group('21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','group-failure-0001',repeat('d',64),jsonb_build_object('action','create','contact',jsonb_build_object('firstName','Rollback','lastName','Probe','phone','5550104000','email','rollback@example.com','leadType','warm','relationship','lead','intent','unknown','source','other','pipelineStage','new','tags','[]'::jsonb),'customValues',jsonb_build_array(jsonb_build_object('definitionId','ffffffff-ffff-4fff-8fff-ffffffffffff','value','x')),'activityIdempotencyKey','import:group-failure-0001'),'2026-08-11T11:11:00Z');
    raise exception 'invalid atomic group succeeded';
  exception when no_data_found then null; when foreign_key_violation then null; end;
  if (select count(*) from public.contacts)<>before_count or exists(select 1 from public.contact_points where normalized_value='rollback@example.com') or exists(select 1 from public.contact_intake_receipts where idempotency_key='group-failure-0001') then raise exception 'failed group left a zombie'; end if;
end $$;
select 'ok 17 - failed import target group rolls back every write without archived compensation';

reset role;
do $$ begin
  begin update public.activity_events set occurred_at=now(); raise exception 'activity mutation succeeded'; exception when check_violation then null; end;
  if not exists(select 1 from public.activity_events where type='contact-archived')
    or not exists(select 1 from public.activity_events where type='contact-point-updated')
    or not exists(select 1 from public.activity_events where type='household-updated')
    or not exists(select 1 from public.activity_events where type='assignment-updated')
    or not exists(select 1 from public.activity_events where type='custom-field-updated') then raise exception 'rich lifecycle evidence missing'; end if;
end $$;
select 'ok 18 - rich lifecycle activity evidence is append-only and complete';

rollback;
