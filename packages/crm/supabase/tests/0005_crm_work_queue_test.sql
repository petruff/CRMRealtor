-- Story 3.1 SQL/RLS matrix.
-- Prerequisite: migrations 0001..0005 applied to an isolated Supabase DB.
-- TAP is emitted directly because the local Postgres image does not bundle
-- the optional pgtap extension. Every assertion is fail-fast; fixtures roll
-- back at the end.

begin;

select '1..16';

do $$
declare
  tenant_table text;
begin
  foreach tenant_table in array array[
    'smart_lists', 'incomplete_records', 'tasks', 'activity_events'
  ] loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and information_schema.columns.table_name = tenant_table
        and column_name = 'workspace_id'
        and is_nullable = 'NO'
    ) then
      raise exception 'missing non-null workspace_id on %', tenant_table;
    end if;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and information_schema.columns.table_name = tenant_table
        and column_name = 'owner_id'
    ) then
      raise exception 'legacy owner_id found on %', tenant_table;
    end if;

    if not exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = tenant_table
        and relation.relrowsecurity
    ) then
      raise exception 'RLS missing on %', tenant_table;
    end if;
  end loop;
end;
$$;

select 'ok 1 - four work queue tables use non-null workspace authority and RLS';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000',
   '11000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'queue-owner-a@omnix.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '11000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'queue-assistant-a@omnix.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '11000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'queue-owner-b@omnix.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now());

insert into workspaces (id, name) values
  ('21000000-0000-4000-8000-000000000001', 'Queue Workspace A'),
  ('21000000-0000-4000-8000-000000000002', 'Queue Workspace B');

select set_config('omnix.actor_user_id', '11000000-0000-4000-8000-000000000001', true);
insert into workspace_members (id, workspace_id, user_id, role, status) values
  ('31000000-0000-4000-8000-000000000001',
   '21000000-0000-4000-8000-000000000001',
   '11000000-0000-4000-8000-000000000001', 'owner', 'active'),
  ('31000000-0000-4000-8000-000000000002',
   '21000000-0000-4000-8000-000000000001',
   '11000000-0000-4000-8000-000000000002', 'assistant', 'active');

select set_config('omnix.actor_user_id', '11000000-0000-4000-8000-000000000003', true);
insert into workspace_members (id, workspace_id, user_id, role, status) values
  ('31000000-0000-4000-8000-000000000003',
   '21000000-0000-4000-8000-000000000002',
   '11000000-0000-4000-8000-000000000003', 'owner', 'active');

set constraints all immediate;
set constraints all deferred;

insert into contacts (
  id, owner_id, workspace_id, first_name, last_name
) values
  ('41000000-0000-4000-8000-000000000001',
   '11000000-0000-4000-8000-000000000001',
   '21000000-0000-4000-8000-000000000001', 'Queue', 'Alpha'),
  ('41000000-0000-4000-8000-000000000002',
   '11000000-0000-4000-8000-000000000003',
   '21000000-0000-4000-8000-000000000002', 'Queue', 'Beta');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);

insert into smart_lists (
  id, workspace_id, name, definition, created_by_membership_id
) values (
  '51000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  'Hot Boston buyers',
  '{
    "schemaVersion":"smart-list-filter.v1",
    "criteria":[
      {"field":"leadType","operator":"in","value":["hot","warm"]},
      {"field":"city","operator":"eq","value":"Boston"},
      {"field":"buyer.priceMax","operator":"max","value":900000},
      {"field":"nextTouchAt","operator":"empty"}
    ],
    "sort":{"field":"priority","direction":"asc"}
  }'::jsonb,
  '31000000-0000-4000-8000-000000000001'
);

do $$
begin
  if (select count(*) from smart_lists) <> 1 then
    raise exception 'valid Smart List was not persisted';
  end if;
end;
$$;

select 'ok 2 - valid versioned Smart List definitions persist';

do $$
declare
  first_create jsonb;
  replay_create jsonb;
begin
  first_create := create_task_with_event(
    '21000000-0000-4000-8000-000000000001',
    '41000000-0000-4000-8000-000000000001',
    'Atomic task', 'Created with its event', '2026-08-12T12:00:00Z',
    '31000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000002',
    'task-create-key-atomic', 'task-create-event-atomic',
    '2026-08-11T12:00:00Z'
  );

  replay_create := create_task_with_event(
    '21000000-0000-4000-8000-000000000001',
    '41000000-0000-4000-8000-000000000001',
    'Atomic task', 'Created with its event', '2026-08-12T12:00:00Z',
    '31000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000002',
    'task-create-key-atomic', 'task-create-event-atomic',
    '2026-08-11T12:00:00Z'
  );

  if first_create#>>'{task,id}' <> replay_create#>>'{task,id}'
     or (first_create->>'noOp')::boolean
     or not (replay_create->>'noOp')::boolean
     or first_create#>>'{event,task_id}' <> first_create#>>'{task,id}' then
    raise exception 'atomic task create/replay envelope is inconsistent';
  end if;

  begin
    insert into smart_lists (
      workspace_id, name, definition, created_by_membership_id
    ) values (
      '21000000-0000-4000-8000-000000000001',
      repeat('x', 81),
      '{"schemaVersion":"smart-list-filter.v1","criteria":[]}'::jsonb,
      '31000000-0000-4000-8000-000000000001'
    );
    raise exception 'overlong Smart List name unexpectedly succeeded';
  exception when check_violation then null;
  end;

  begin
    insert into smart_lists (
      workspace_id, name, definition, created_by_membership_id
    ) values (
      '21000000-0000-4000-8000-000000000001',
      'Injected definition',
      '{"schemaVersion":"smart-list-filter.v1","criteria":[{"field":"rawSql","operator":"exec","value":"select 1"}]}'::jsonb,
      '31000000-0000-4000-8000-000000000001'
    );
    raise exception 'unknown field/operator unexpectedly succeeded';
  exception when check_violation then null;
  end;

  begin
    insert into smart_lists (
      workspace_id, name, definition, created_by_membership_id
    ) values (
      '21000000-0000-4000-8000-000000000001',
      'Long query',
      jsonb_build_object(
        'schemaVersion', 'smart-list-filter.v1',
        'criteria', jsonb_build_array(jsonb_build_object(
          'field', 'query', 'operator', 'contains', 'value', repeat('q', 201)
        ))
      ),
      '31000000-0000-4000-8000-000000000001'
    );
    raise exception 'overlong query unexpectedly succeeded';
  exception when check_violation then null;
  end;

  begin
    insert into smart_lists (
      workspace_id, name, definition, created_by_membership_id
    ) values (
      '21000000-0000-4000-8000-000000000001',
      'Empty query',
      '{"schemaVersion":"smart-list-filter.v1","criteria":[{"field":"query","operator":"contains","value":"   "}]}'::jsonb,
      '31000000-0000-4000-8000-000000000001'
    );
    raise exception 'empty Smart List text unexpectedly succeeded';
  exception when check_violation then null;
  end;

  begin
    insert into smart_lists (
      workspace_id, name, definition, created_by_membership_id
    ) values (
      '21000000-0000-4000-8000-000000000001',
      'Control text',
      jsonb_build_object(
        'schemaVersion', 'smart-list-filter.v1',
        'criteria', jsonb_build_array(jsonb_build_object(
          'field', 'city', 'operator', 'eq', 'value', E'Bos\nton'
        ))
      ),
      '31000000-0000-4000-8000-000000000001'
    );
    raise exception 'control-character Smart List text unexpectedly succeeded';
  exception when check_violation then null;
  end;

  begin
    insert into smart_lists (
      workspace_id, name, definition, created_by_membership_id
    ) values (
      '21000000-0000-4000-8000-000000000001',
      'Negative price',
      '{"schemaVersion":"smart-list-filter.v1","criteria":[{"field":"buyer.priceMin","operator":"min","value":-1}]}'::jsonb,
      '31000000-0000-4000-8000-000000000001'
    );
    raise exception 'negative Smart List number unexpectedly succeeded';
  exception when check_violation then null;
  end;
end;
$$;

select 'ok 3 - Smart List name, field, operator, printable text and numeric limits fail closed';

do $$
begin
  begin
    insert into smart_lists (
      workspace_id, name, definition, created_by_membership_id
    ) values (
      '21000000-0000-4000-8000-000000000002',
      'Cross workspace',
      '{"schemaVersion":"smart-list-filter.v1","criteria":[]}'::jsonb,
      '31000000-0000-4000-8000-000000000001'
    );
    raise exception 'cross-workspace Smart List unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select 'ok 4 - composite membership and RLS reject cross-workspace Smart Lists';

insert into incomplete_records (
  id, workspace_id, source, external_id, candidate, validation_reasons,
  intake_idempotency_key, intake_request_hash
) values (
  '61000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  'csv-import',
  'external-1',
  '{"firstName":"Ada","email":"ada@example.test","tags":["buyer"]}'::jsonb,
  '[{"field":"lastName","code":"required","message":"Last name is required"}]'::jsonb,
  'intake-key-0001',
  repeat('a', 64)
);

do $$
begin
  begin
    insert into incomplete_records (
      workspace_id, source, candidate, validation_reasons
    ) values (
      '21000000-0000-4000-8000-000000000001',
      'webhook',
      '{"rawBody":"secret","authorization":"Bearer secret"}'::jsonb,
      '[{"field":"payload","code":"invalid","message":"Invalid"}]'::jsonb
    );
    raise exception 'raw/unmapped candidate keys unexpectedly persisted';
  exception when check_violation then null;
  end;

  begin
    insert into incomplete_records (
      workspace_id, source, candidate, validation_reasons
    ) values (
      '21000000-0000-4000-8000-000000000001',
      'webhook',
      '{"city":"Boston"}'::jsonb,
      '[{"field":"identity","code":"missing","message":"Identity required"}]'::jsonb
    );
    raise exception 'record without safe identity unexpectedly persisted';
  exception when check_violation then null;
  end;

  begin
    insert into incomplete_records (
      workspace_id, source, candidate, validation_reasons
    ) values (
      '21000000-0000-4000-8000-000000000001',
      'webhook',
      jsonb_build_object('firstName', repeat('x', 10000)),
      '[{"field":"firstName","code":"too-long","message":"First name is too long"}]'::jsonb
    );
    raise exception '10k firstName unexpectedly persisted';
  exception when check_violation then null;
  end;

  begin
    insert into incomplete_records (
      workspace_id, source, candidate, validation_reasons
    ) values (
      '21000000-0000-4000-8000-000000000001',
      'webhook',
      '{"firstName":"Bad email","email":"not-an-email"}'::jsonb,
      '[{"field":"email","code":"invalid-email","message":"Email is invalid"}]'::jsonb
    );
    raise exception 'invalid candidate email unexpectedly persisted';
  exception when check_violation then null;
  end;

  begin
    insert into incomplete_records (
      workspace_id, source, candidate, validation_reasons
    ) values (
      '21000000-0000-4000-8000-000000000001',
      'webhook',
      '{"firstName":"Bad phone","phone":"305-555-0100"}'::jsonb,
      '[{"field":"phone","code":"invalid-phone","message":"Phone is invalid"}]'::jsonb
    );
    raise exception 'non-normalized candidate phone unexpectedly persisted';
  exception when check_violation then null;
  end;

  begin
    insert into incomplete_records (
      workspace_id, source, candidate, validation_reasons
    ) values (
      '21000000-0000-4000-8000-000000000001',
      'webhook',
      jsonb_build_object(
        'firstName', 'Too many tags',
        'tags', (select jsonb_agg('tag-' || value) from generate_series(1, 51) value)
      ),
      '[{"field":"tags","code":"too-many","message":"Too many tags"}]'::jsonb
    );
    raise exception 'candidate with 51 tags unexpectedly persisted';
  exception when check_violation then null;
  end;

  begin
    insert into incomplete_records (
      workspace_id, source, candidate, validation_reasons
    ) values (
      '21000000-0000-4000-8000-000000000001',
      'webhook',
      jsonb_build_object('firstName', 'Long tag', 'tags', jsonb_build_array(repeat('t', 81))),
      '[{"field":"tags","code":"too-long","message":"Tag is too long"}]'::jsonb
    );
    raise exception 'overlong candidate tag unexpectedly persisted';
  exception when check_violation then null;
  end;
end;
$$;

select 'ok 5 - quarantine enforces allowlists, identity, field shapes and application bounds';

update incomplete_records
set status = 'archived',
    archived_by_membership_id = '31000000-0000-4000-8000-000000000001',
    archive_reason = 'Not actionable'
where id = '61000000-0000-4000-8000-000000000001';

update incomplete_records
set status = 'pending'
where id = '61000000-0000-4000-8000-000000000001';

do $$
begin
  if not exists (
    select 1 from incomplete_records
    where id = '61000000-0000-4000-8000-000000000001'
      and status = 'pending'
      and archived_at is null
      and archive_reason is null
  ) then
    raise exception 'incomplete archive/restore state is inconsistent';
  end if;

  delete from incomplete_records
  where id = '61000000-0000-4000-8000-000000000001';

  if not exists (
    select 1 from incomplete_records
    where id = '61000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'hard delete unexpectedly removed the incomplete record';
  end if;
end;
$$;

select 'ok 6 - incomplete records archive and restore without hard deletion';

reset role;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
insert into tasks (
  id, workspace_id, contact_id, title, description, due_at,
  creator_membership_id, assignee_membership_id
) values (
  '71000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001',
  'Call Ada', 'Discuss timing', now() + interval '1 day',
  '31000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000002'
);

set local role authenticated;

do $$
begin
  begin
    perform * from create_task_with_event(
      '21000000-0000-4000-8000-000000000001',
      '41000000-0000-4000-8000-000000000002',
      'Cross contact', null, now(),
      '31000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000002',
      'task-cross-contact', 'task-event-cross-contact', now()
    );
    raise exception 'cross-workspace task contact unexpectedly succeeded';
  exception when foreign_key_violation then null;
  end;

  begin
    perform * from create_task_with_event(
      '21000000-0000-4000-8000-000000000001',
      null, 'Cross assignee', null, now(),
      '31000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000003',
      'task-cross-assignee', 'task-event-cross-assignee', now()
    );
    raise exception 'cross-workspace task assignee unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select 'ok 7 - task contact and membership links cannot cross workspaces';

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);

do $$
begin
  perform * from transition_tasks_with_events(
    '21000000-0000-4000-8000-000000000001',
    array['71000000-0000-4000-8000-000000000001'::uuid],
    'completed',
    '31000000-0000-4000-8000-000000000002',
    '2026-08-11T13:00:00Z',
    '[{"taskId":"71000000-0000-4000-8000-000000000001","type":"task-completed","idempotencyKey":"task-complete-1"}]'::jsonb
  );

  perform * from transition_tasks_with_events(
    '21000000-0000-4000-8000-000000000001',
    array['71000000-0000-4000-8000-000000000001'::uuid],
    'open',
    '31000000-0000-4000-8000-000000000002',
    '2026-08-11T13:05:00Z',
    '[]'::jsonb
  );

  if not exists (
    select 1
    from tasks
    where id = '71000000-0000-4000-8000-000000000001'
      and status = 'open'
      and completed_at is null
      and completed_by_membership_id is null
      and archived_at is null
      and archived_by_membership_id is null
  ) or (
    select count(*)
    from activity_events
    where task_id = '71000000-0000-4000-8000-000000000001'
  ) <> 1 then
    raise exception 'reopen did not clear completion evidence or appended an event';
  end if;

  perform * from transition_tasks_with_events(
    '21000000-0000-4000-8000-000000000001',
    array['71000000-0000-4000-8000-000000000001'::uuid],
    'archived',
    '31000000-0000-4000-8000-000000000002',
    '2026-08-11T13:10:00Z',
    '[{"taskId":"71000000-0000-4000-8000-000000000001","type":"task-archived","idempotencyKey":"task-archive-1"}]'::jsonb
  );

  begin
    perform * from transition_tasks_with_events(
      '21000000-0000-4000-8000-000000000001',
      array['71000000-0000-4000-8000-000000000001'::uuid],
      'open',
      '31000000-0000-4000-8000-000000000002',
      '2026-08-11T13:15:00Z',
      '[]'::jsonb
    );
    raise exception 'archived task unexpectedly reopened';
  exception when check_violation then null;
  end;
end;
$$;

select 'ok 8 - task complete, reopen and archive transitions are guarded';

reset role;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);

insert into activity_events (
  id, workspace_id, type, contact_id, actor_membership_id,
  occurred_at, idempotency_key
) values (
  '81000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  'contact-created',
  '41000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001',
  now(), 'activity-key-0001'
);

do $$
begin
  begin
    update activity_events set occurred_at = now()
    where id = '81000000-0000-4000-8000-000000000001';
    raise exception 'activity update unexpectedly succeeded';
  exception when check_violation then null;
  end;

  begin
    delete from activity_events
    where id = '81000000-0000-4000-8000-000000000001';
    raise exception 'activity delete unexpectedly succeeded';
  exception when check_violation then null;
  end;

  begin
    insert into activity_events (
      workspace_id, type, contact_id, actor_membership_id,
      occurred_at, idempotency_key
    ) values (
      '21000000-0000-4000-8000-000000000001',
      'contact-updated',
      '41000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000001',
      now(), 'activity-key-0001'
    );
    raise exception 'duplicate activity key unexpectedly succeeded';
  exception when unique_violation then null;
  end;
end;
$$;

select 'ok 9 - activity events are immutable and workspace-idempotent';

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);

do $$
begin
  if (select count(*) from smart_lists) <> 1
     or (select count(*) from incomplete_records) <> 1
     or (select count(*) from tasks) <> 2
     or (select count(*) from activity_events) <> 4 then
    raise exception 'active assistant cannot share Workspace A queue';
  end if;

  if exists (
    select 1 from contacts
    where id = '41000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'active assistant can read Workspace B contact';
  end if;
end;
$$;

select 'ok 10 - active assistant shares only its workspace queue';

do $$
declare
  first_receipt jsonb;
  replay_receipt jsonb;
begin
  first_receipt := append_activity_event(
    '21000000-0000-4000-8000-000000000001',
    'touch-recorded',
    '31000000-0000-4000-8000-000000000002',
    '2026-08-11T14:00:00Z',
    'activity-rpc-key-0001',
    '41000000-0000-4000-8000-000000000001'
  );

  replay_receipt := append_activity_event(
    '21000000-0000-4000-8000-000000000001',
    'touch-recorded',
    '31000000-0000-4000-8000-000000000002',
    '2026-08-11T14:00:00Z',
    'activity-rpc-key-0001',
    '41000000-0000-4000-8000-000000000001'
  );

  if first_receipt#>>'{event,id}' <> replay_receipt#>>'{event,id}'
     or (first_receipt->>'noOp')::boolean
     or not (replay_receipt->>'noOp')::boolean then
    raise exception 'activity replay did not return the original event';
  end if;

  begin
    perform * from append_activity_event(
      '21000000-0000-4000-8000-000000000001',
      'contact-updated',
      '31000000-0000-4000-8000-000000000002',
      '2026-08-11T14:00:00Z',
      'activity-rpc-key-0001',
      '41000000-0000-4000-8000-000000000001'
    );
    raise exception 'divergent activity replay unexpectedly succeeded';
  exception when unique_violation then null;
  end;
end;
$$;

select 'ok 11 - activity RPC returns the original replay and rejects divergence';

do $$
declare
  first_record incomplete_records;
  replay_record incomplete_records;
begin
  select * into strict first_record
  from create_incomplete_record(
    '21000000-0000-4000-8000-000000000001',
    'webhook',
    'intake-rpc-external-1',
    '{"email":"replay@example.test"}'::jsonb,
    '[{"field":"name","code":"required","message":"Name is required"}]'::jsonb,
    'intake-rpc-key-0001',
    '31000000-0000-4000-8000-000000000002'
  );

  select * into strict replay_record
  from create_incomplete_record(
    '21000000-0000-4000-8000-000000000001',
    'webhook',
    'intake-rpc-external-1',
    '{"email":"replay@example.test"}'::jsonb,
    '[{"field":"name","code":"required","message":"Name is required"}]'::jsonb,
    'intake-rpc-key-0001',
    '31000000-0000-4000-8000-000000000002'
  );

  if first_record.id <> replay_record.id then
    raise exception 'intake replay did not return the original quarantine row';
  end if;

  begin
    perform * from create_incomplete_record(
      '21000000-0000-4000-8000-000000000001',
      'webhook',
      'intake-rpc-external-1',
      '{"email":"different@example.test"}'::jsonb,
      '[{"field":"name","code":"required","message":"Name is required"}]'::jsonb,
      'intake-rpc-key-0001',
      '31000000-0000-4000-8000-000000000002'
    );
    raise exception 'divergent intake replay unexpectedly succeeded';
  exception when unique_violation then null;
  end;
end;
$$;

select 'ok 12 - incomplete intake RPC is idempotent and conflict-aware';

reset role;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);
insert into tasks (
  id, workspace_id, title, due_at,
  creator_membership_id, assignee_membership_id
) values
  ('71000000-0000-4000-8000-000000000002',
   '21000000-0000-4000-8000-000000000001', 'Bulk A', now(),
   '31000000-0000-4000-8000-000000000002',
   '31000000-0000-4000-8000-000000000002'),
  ('71000000-0000-4000-8000-000000000003',
   '21000000-0000-4000-8000-000000000001', 'Bulk B', now(),
   '31000000-0000-4000-8000-000000000002',
   '31000000-0000-4000-8000-000000000002');

reset role;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000003', true);

insert into tasks (
  id, workspace_id, title, due_at,
  creator_membership_id, assignee_membership_id
) values (
  '71000000-0000-4000-8000-000000000004',
  '21000000-0000-4000-8000-000000000002', 'Workspace B task', now(),
  '31000000-0000-4000-8000-000000000003',
  '31000000-0000-4000-8000-000000000003'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);

do $$
declare
  too_many_ids uuid[];
  first_transition jsonb;
  replay_transition jsonb;
begin
  first_transition := transition_tasks_with_events(
    '21000000-0000-4000-8000-000000000001',
    array[
      '71000000-0000-4000-8000-000000000002'::uuid,
      '71000000-0000-4000-8000-000000000003'::uuid
    ],
    'completed',
    '31000000-0000-4000-8000-000000000002',
    '2026-08-11T14:30:00Z',
    '[
      {"taskId":"71000000-0000-4000-8000-000000000002","type":"task-completed","idempotencyKey":"bulk-complete-2"},
      {"taskId":"71000000-0000-4000-8000-000000000003","type":"task-completed","idempotencyKey":"bulk-complete-3"}
    ]'::jsonb
  );

  replay_transition := transition_tasks_with_events(
    '21000000-0000-4000-8000-000000000001',
    array[
      '71000000-0000-4000-8000-000000000002'::uuid,
      '71000000-0000-4000-8000-000000000003'::uuid
    ],
    'completed',
    '31000000-0000-4000-8000-000000000002',
    '2026-08-11T14:30:00Z',
    '[
      {"taskId":"71000000-0000-4000-8000-000000000002","type":"task-completed","idempotencyKey":"bulk-complete-2"},
      {"taskId":"71000000-0000-4000-8000-000000000003","type":"task-completed","idempotencyKey":"bulk-complete-3"}
    ]'::jsonb
  );

  if (select count(*) from tasks
      where id in (
        '71000000-0000-4000-8000-000000000002',
        '71000000-0000-4000-8000-000000000003'
      ) and status = 'completed') <> 2
     or jsonb_array_length(first_transition->'events') <> 2
     or jsonb_array_length(first_transition->'noOpTaskIds') <> 0
     or jsonb_array_length(replay_transition->'events') <> 0
     or jsonb_array_length(replay_transition->'noOpTaskIds') <> 2 then
    raise exception 'bulk completion did not complete both tasks';
  end if;

  begin
    perform transition_tasks_with_events(
      '21000000-0000-4000-8000-000000000001',
      array[
        '71000000-0000-4000-8000-000000000002'::uuid,
        '71000000-0000-4000-8000-000000000004'::uuid
      ],
      'archived',
      '31000000-0000-4000-8000-000000000002',
      '2026-08-11T14:35:00Z',
      '[
        {"taskId":"71000000-0000-4000-8000-000000000002","type":"task-archived","idempotencyKey":"bulk-archive-2"},
        {"taskId":"71000000-0000-4000-8000-000000000004","type":"task-archived","idempotencyKey":"bulk-archive-cross"}
      ]'::jsonb
    );
    raise exception 'cross-workspace bulk transition unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  select array_agg(gen_random_uuid()) into too_many_ids
  from generate_series(1, 101);

  begin
    perform transition_tasks_with_events(
      '21000000-0000-4000-8000-000000000001',
      too_many_ids,
      'completed',
      '31000000-0000-4000-8000-000000000002',
      '2026-08-11T14:40:00Z',
      '[]'::jsonb
    );
    raise exception 'bulk transition over 100 IDs unexpectedly succeeded';
  exception when check_violation then null;
  end;

  begin
    perform transition_tasks_with_events(
      '21000000-0000-4000-8000-000000000001',
      '{}'::uuid[],
      'completed',
      '31000000-0000-4000-8000-000000000002',
      '2026-08-11T14:40:00Z',
      '[]'::jsonb
    );
    raise exception 'empty bulk transition unexpectedly succeeded';
  exception when check_violation then null;
  end;
end;
$$;

select 'ok 13 - task bulk transitions are atomic, idempotent and bounded to 100 IDs';

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);

do $$
declare
  first_conversion jsonb;
  replay_conversion jsonb;
  corrected_candidate jsonb := '{"firstName":"Ada","lastName":"Lovelace","email":"ada@example.test","tags":["buyer"]}'::jsonb;
  create_plan jsonb := '{
    "action":"create",
    "contactInput":{
      "firstName":"Ada","lastName":"Lovelace","email":"ada@example.test",
      "leadType":"warm","relationship":"lead","intent":"unknown",
      "source":"other","pipelineStage":"new","tags":["buyer"],
      "emailSubscribed":true,"touchDateOverridden":false
    },
    "changes":[
      "firstName","lastName","email","leadType","relationship","intent",
      "source","pipelineStage","tags","emailSubscribed","touchDateOverridden"
    ]
  }'::jsonb;
begin
  begin
    perform * from convert_incomplete_record(
      '61000000-0000-4000-8000-000000000001',
      '{"firstName":"Ada"}'::jsonb,
      '{
        "action":"create",
        "contactInput":{
          "firstName":"Ada","lastName":"","email":"not-an-email",
          "leadType":"warm","relationship":"lead","intent":"unknown",
          "source":"other","pipelineStage":"new","tags":[],
          "emailSubscribed":true,"touchDateOverridden":false
        },
        "changes":[
          "firstName","lastName","email","leadType","relationship","intent",
          "source","pipelineStage","tags","emailSubscribed","touchDateOverridden"
        ]
      }'::jsonb,
      'conversion-key-invalid-email',
      '31000000-0000-4000-8000-000000000001',
      '2026-08-11T14:58:00Z'
    );
    raise exception 'invalid application-shaped contactInput unexpectedly succeeded';
  exception when check_violation then null;
  end;

  begin
    perform * from convert_incomplete_record(
      '61000000-0000-4000-8000-000000000001',
      '{"firstName":"Ada"}'::jsonb,
      '{
        "action":"create",
        "contactInput":{
          "firstName":"Ada","lastName":"","email":"mallory@example.test",
          "leadType":"warm","relationship":"lead","intent":"unknown",
          "source":"other","pipelineStage":"new","tags":[],
          "emailSubscribed":true,"touchDateOverridden":false
        },
        "changes":[
          "firstName","lastName","email","leadType","relationship","intent",
          "source","pipelineStage","tags","emailSubscribed","touchDateOverridden"
        ]
      }'::jsonb,
      'conversion-key-divergent-create',
      '31000000-0000-4000-8000-000000000001',
      '2026-08-11T14:59:00Z'
    );
    raise exception 'candidate-divergent contactInput unexpectedly succeeded';
  exception when check_violation then null;
  end;

  if exists (select 1 from contacts where email in ('not-an-email', 'mallory@example.test'))
     or (select status from incomplete_records
         where id = '61000000-0000-4000-8000-000000000001') <> 'pending' then
    raise exception 'failed conversion mutated contacts or incomplete record state';
  end if;

  first_conversion := convert_incomplete_record(
    '61000000-0000-4000-8000-000000000001',
    corrected_candidate,
    create_plan,
    'conversion-key-0001',
    '31000000-0000-4000-8000-000000000001',
    '2026-08-11T15:00:00Z'
  );

  replay_conversion := convert_incomplete_record(
    '61000000-0000-4000-8000-000000000001',
    corrected_candidate,
    create_plan,
    'conversion-key-0001',
    '31000000-0000-4000-8000-000000000001',
    '2026-08-11T15:00:00Z'
  );

  if first_conversion->>'contactId' <> replay_conversion->>'contactId'
     or first_conversion#>>'{record,status}' <> 'converted'
     or (first_conversion->>'noOp')::boolean
     or not (replay_conversion->>'noOp')::boolean
     or (select count(*) from contacts
         where id = (first_conversion->>'contactId')::uuid
           and workspace_id = (first_conversion#>>'{record,workspace_id}')::uuid
           and owner_id = '11000000-0000-4000-8000-000000000001') <> 1
     or (select count(*) from activity_events
         where type = 'incomplete-record-converted'
           and incomplete_record_id = (first_conversion#>>'{record,id}')::uuid
           and contact_id = (first_conversion->>'contactId')::uuid
           and idempotency_key = 'conversion-key-0001') <> 1
     or (select count(*) from contact_external_links
         where workspace_id = (first_conversion#>>'{record,workspace_id}')::uuid
           and provider = 'csv-import'
           and external_id = 'external-1'
           and contact_id = (first_conversion->>'contactId')::uuid) <> 1 then
    raise exception 'atomic create conversion or replay evidence is inconsistent';
  end if;

  begin
    perform * from convert_incomplete_record(
      '61000000-0000-4000-8000-000000000001',
      jsonb_set(corrected_candidate, '{email}', '"different@example.test"'),
      create_plan,
      'conversion-key-0001',
      '31000000-0000-4000-8000-000000000001',
      '2026-08-11T15:00:00Z'
    );
    raise exception 'divergent conversion replay unexpectedly succeeded';
  exception when unique_violation then null;
  end;
end;
$$;

select 'ok 14 - create conversion atomically writes contact, link, status and one event';

update contacts
   set email = 'grace@example.test'
 where id = '41000000-0000-4000-8000-000000000001';

insert into incomplete_records (
  id, workspace_id, source, external_id, candidate, validation_reasons
) values (
  '61000000-0000-4000-8000-000000000003',
  '21000000-0000-4000-8000-000000000001',
  'webhook', 'external-3',
  '{"firstName":"Grace","email":"grace@example.test"}'::jsonb,
  '[{"field":"lastName","code":"required","message":"Last name is required"}]'::jsonb
);

do $$
declare
  converted_receipt jsonb;
  corrected_candidate jsonb := '{"firstName":"Grace","lastName":"Hopper","email":"grace@example.test"}'::jsonb;
begin
  begin
    perform * from convert_incomplete_record(
      '61000000-0000-4000-8000-000000000003',
      corrected_candidate,
      '{"action":"update","matchedContactId":"41000000-0000-4000-8000-000000000002","contactPatch":{"firstName":"Grace","lastName":"Hopper","email":"grace@example.test"},"matchedBy":"email","changes":["firstName","lastName","email"]}'::jsonb,
      'conversion-key-0003-cross',
      '31000000-0000-4000-8000-000000000001',
      '2026-08-11T16:00:00Z'
    );
    raise exception 'cross-workspace conversion unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    perform * from convert_incomplete_record(
      '61000000-0000-4000-8000-000000000003',
      corrected_candidate,
      '{"action":"update","matchedContactId":"41000000-0000-4000-8000-000000000001","contactPatch":{"firstName":"Grace","lastName":"Hopper"},"matchedBy":"email","changes":["firstName","lastName"],"unknown":"blocked"}'::jsonb,
      'conversion-key-0003-invalid',
      '31000000-0000-4000-8000-000000000001',
      '2026-08-11T16:00:00Z'
    );
    raise exception 'unknown conversion plan key unexpectedly succeeded';
  exception when check_violation then null;
  end;

  begin
    perform * from convert_incomplete_record(
      '61000000-0000-4000-8000-000000000003',
      corrected_candidate,
      '{"action":"update","matchedContactId":"41000000-0000-4000-8000-000000000001","contactPatch":{"email":"grace@example.test"},"matchedBy":"email","changes":["phone"]}'::jsonb,
      'conversion-key-0003-mismatched-changes',
      '31000000-0000-4000-8000-000000000001',
      '2026-08-11T16:00:00Z'
    );
    raise exception 'conversion plan with mismatched changes unexpectedly succeeded';
  exception when check_violation then null;
  end;

  begin
    perform * from convert_incomplete_record(
      '61000000-0000-4000-8000-000000000003',
      corrected_candidate,
      '{"action":"update","matchedContactId":"41000000-0000-4000-8000-000000000001","contactPatch":{"phone":"3055550100"},"matchedBy":"email","changes":["phone"]}'::jsonb,
      'conversion-key-0003-divergent-patch',
      '31000000-0000-4000-8000-000000000001',
      '2026-08-11T16:00:00Z'
    );
    raise exception 'candidate-divergent contactPatch unexpectedly succeeded';
  exception when check_violation then null;
  end;

  converted_receipt := convert_incomplete_record(
    '61000000-0000-4000-8000-000000000003',
    corrected_candidate,
    '{"action":"update","matchedContactId":"41000000-0000-4000-8000-000000000001","contactPatch":{"firstName":"Grace","lastName":"Hopper"},"matchedBy":"email","changes":["firstName","lastName"]}'::jsonb,
    'conversion-key-0003',
    '31000000-0000-4000-8000-000000000001',
    '2026-08-11T16:00:00Z'
  );

  if converted_receipt#>>'{record,status}' <> 'converted'
     or converted_receipt->>'action' <> 'update'
     or converted_receipt->>'contactId' <> '41000000-0000-4000-8000-000000000001'
     or (converted_receipt->>'noOp')::boolean
     or (select first_name <> 'Grace' or last_name <> 'Hopper'
              or email <> 'grace@example.test'
         from contacts
         where id = '41000000-0000-4000-8000-000000000001') then
    raise exception 'bounded update conversion did not apply atomically';
  end if;
end;
$$;

select 'ok 15 - exact application conversion plans pass while unknown, cross-workspace and mismatched changes fail';

reset role;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select * from revoke_workspace_assistant(
  '31000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000001',
  'Queue test revocation'
);

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);

do $$
begin
  if exists (select 1 from smart_lists)
     or exists (select 1 from incomplete_records)
     or exists (select 1 from tasks)
     or exists (select 1 from activity_events) then
    raise exception 'revoked assistant retained queue access';
  end if;

  begin
    perform create_task_with_event(
      '21000000-0000-4000-8000-000000000001',
      null, 'Revoked write', null, now(),
      '31000000-0000-4000-8000-000000000002',
      '31000000-0000-4000-8000-000000000002',
      'revoked-task-create', 'revoked-task-event', now()
    );
    raise exception 'revoked assistant write unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select 'ok 16 - revocation removes queue reads and writes immediately';

rollback;
