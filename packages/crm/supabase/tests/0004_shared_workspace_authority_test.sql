-- Story 3.0 SQL/RLS smoke test.
-- Prerequisite: migrations 0001..0004 applied to an isolated Supabase test DB.
-- Run with ON_ERROR_STOP=1 as a database owner. The transaction always rolls
-- back, including auth fixtures and audit events.

begin;

-- Emit TAP directly instead of depending on the optional pgtap extension.
-- Every `ok` line is reached only after its fail-fast assertion block passes.
select '1..11';

do $$
declare
  tenant_table text;
begin
  foreach tenant_table in array array[
    'contacts',
    'notes',
    'mailers',
    'mailer_sends',
    'contact_external_links',
    'contact_intake_receipts'
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
  end loop;

  if exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'workspaces', 'workspace_members', 'workspace_authority_audit_events',
        'contacts', 'notes', 'mailers', 'mailer_sends',
        'contact_external_links', 'contact_intake_receipts'
      )
      and not relation.relrowsecurity
  ) then
    raise exception 'one or more tenant tables do not have RLS enabled';
  end if;
end;
$$;

select 'ok 1 - workspace scope columns are non-null and tenant RLS is enabled';

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'owner-a@omnix.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'assistant-a@omnix.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'owner-b@omnix.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-4000-8000-000000000004',
    'authenticated', 'authenticated', 'bootstrap@omnix.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into workspaces (id, name) values
  ('20000000-0000-4000-8000-000000000001', 'Workspace A'),
  ('20000000-0000-4000-8000-000000000002', 'Workspace B');

select set_config(
  'omnix.actor_user_id',
  '10000000-0000-4000-8000-000000000001',
  true
);

insert into workspace_members (id, workspace_id, user_id, role, status) values
  (
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'owner', 'active'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'assistant', 'active'
  );

select set_config(
  'omnix.actor_user_id',
  '10000000-0000-4000-8000-000000000003',
  true
);

insert into workspace_members (id, workspace_id, user_id, role, status) values
  (
    '30000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003',
    'owner', 'active'
  );

set constraints all immediate;
set constraints all deferred;

-- First-login bootstrap creates once and returns the same active scope on
-- replay. A per-user advisory lock prevents concurrent duplicate workspaces.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000004',
  true
);

do $$
declare
  first_result record;
  replay_result record;
begin
  select * into strict first_result
  from bootstrap_personal_workspace('Bootstrap workspace');

  select * into strict replay_result
  from bootstrap_personal_workspace('Ignored on replay');

  if first_result.workspace_id <> replay_result.workspace_id
     or first_result.membership_id <> replay_result.membership_id
     or first_result.owner_user_id <> '10000000-0000-4000-8000-000000000004'
     or first_result.role <> 'owner' then
    raise exception 'personal workspace bootstrap is not idempotent';
  end if;
end;
$$;

select 'ok 2 - personal workspace bootstrap is atomic and idempotent';

reset role;

-- A user with more than one active membership must choose a workspace through
-- an explicit selector; the personal bootstrap refuses ambiguous authority.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);

do $$
declare
  membership_result workspace_members;
begin
  select * into strict membership_result
  from add_workspace_assistant(
    '10000000-0000-4000-8000-000000000004',
    '70000000-0000-4000-8000-000000000003',
    'Ambiguity test membership'
  );

  if membership_result.status <> 'active' then
    raise exception 'assistant membership setup failed';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000004',
  true
);

do $$
begin
  begin
    perform * from bootstrap_personal_workspace('Must not create');
    raise exception 'ambiguous bootstrap unexpectedly succeeded';
  exception when check_violation then
    null;
  end;
end;
$$;

select 'ok 3 - bootstrap rejects ambiguous active workspace authority';

reset role;

insert into contacts (
  id, owner_id, workspace_id, first_name, last_name
) values
  (
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'Tenant', 'Alpha'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000002',
    'Tenant', 'Beta'
  );

insert into mailers (id, owner_id, workspace_id, name) values
  (
    '50000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'Tenant A mailer'
  );

-- Owner A can see A and cannot see B.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);

do $$
begin
  if (select count(*) from contacts) <> 1 then
    raise exception 'Owner A contact isolation failed';
  end if;

  if not exists (
    select 1 from contacts
    where id = '40000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Owner A cannot read Workspace A';
  end if;

  begin
    insert into contacts (
      id, owner_id, workspace_id, first_name, last_name
    ) values (
      '40000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000003',
      '20000000-0000-4000-8000-000000000002',
      'Spoofed', 'Workspace'
    );
    raise exception 'cross-workspace insert unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into notes (
      id, contact_id, owner_id, workspace_id, body
    ) values (
      '60000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003',
      '20000000-0000-4000-8000-000000000001',
      'Cross-workspace note must fail'
    );
    raise exception 'cross-workspace note link unexpectedly succeeded';
  exception when foreign_key_violation then
    null;
  end;

  begin
    insert into contact_external_links (
      owner_id, workspace_id, contact_id, provider, external_id
    ) values (
      '10000000-0000-4000-8000-000000000003',
      '20000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000002',
      'test', 'cross-workspace'
    );
    raise exception 'cross-workspace external link unexpectedly succeeded';
  exception when foreign_key_violation then
    null;
  end;

  begin
    insert into mailer_sends (
      mailer_id, contact_id, owner_id, workspace_id
    ) values (
      '50000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001'
    );
    raise exception 'cross-workspace mailer send unexpectedly succeeded';
  exception when foreign_key_violation then
    null;
  end;
end;
$$;

select 'ok 4 - owner A is isolated from workspace B and cross-workspace links';

-- Assistant A shares ordinary CRM rows in A.
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);

do $$
begin
  if (select count(*) from contacts) <> 1 then
    raise exception 'Assistant A workspace access failed';
  end if;

  if (select count(*) from workspace_members) <> 2
     or not exists (
       select 1 from workspace_members
       where role = 'owner'
         and user_id = '10000000-0000-4000-8000-000000000001'
     ) then
    raise exception 'Assistant A cannot resolve the active workspace owner';
  end if;

  if exists (select 1 from workspace_authority_audit_events) then
    raise exception 'Assistant A can read owner-only authority audit';
  end if;
end;
$$;

select 'ok 5 - active assistant shares CRM scope and resolves its owner safely';

-- Owner B sees only B and cannot select A by an owner_id spoof.
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000003',
  true
);

do $$
begin
  if (select count(*) from contacts) <> 1 then
    raise exception 'Owner B contact isolation failed';
  end if;

  if exists (
    select 1 from contacts
    where id = '40000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Owner B can read Workspace A';
  end if;
end;
$$;

select 'ok 6 - owner B is isolated from workspace A';

-- Owner-only RPCs preserve command correlation and reason in the append-only
-- audit row. Adding an already-active assistant is an idempotent no-op.
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);

do $$
declare
  membership_result workspace_members;
begin
  select * into strict membership_result
  from add_workspace_assistant(
    '10000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000001',
    'Existing assistant replay'
  );

  if membership_result.id <> '30000000-0000-4000-8000-000000000002'
     or membership_result.status <> 'active' then
    raise exception 'idempotent assistant add returned the wrong membership';
  end if;

  select * into strict membership_result
  from revoke_workspace_assistant(
    '30000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000002',
    'Access removed in SQL test'
  );

  if membership_result.status <> 'revoked'
     or membership_result.revoked_at is null then
    raise exception 'assistant revoke RPC did not revoke the membership';
  end if;
end;
$$;

select 'ok 7 - owner RPCs add idempotently and revoke with command metadata';

-- Revocation removes access immediately.
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);

do $$
begin
  if exists (select 1 from contacts) then
    raise exception 'revoked assistant retained workspace access';
  end if;

  begin
    insert into contacts (
      owner_id, workspace_id, first_name, last_name
    ) values (
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'Revoked', 'Writer'
    );
    raise exception 'revoked assistant write unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select 'ok 8 - revoked assistant loses read and write access immediately';

-- The owner membership cannot be revoked or duplicated.
reset role;
select set_config(
  'omnix.actor_user_id',
  '10000000-0000-4000-8000-000000000001',
  true
);

do $$
begin
  begin
    update workspace_members
    set status = 'revoked'
    where id = '30000000-0000-4000-8000-000000000001';
    raise exception 'owner revocation unexpectedly succeeded';
  exception when check_violation then
    null;
  end;

  begin
    insert into workspace_members (
      workspace_id, user_id, role, status
    ) values (
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000003',
      'owner', 'active'
    );
    raise exception 'second active owner unexpectedly succeeded';
  exception when unique_violation then
    null;
  end;

  if not exists (
    select 1
    from workspace_authority_audit_events
    where workspace_id = '20000000-0000-4000-8000-000000000001'
      and action = 'member_revoked'
      and actor_user_id = '10000000-0000-4000-8000-000000000001'
      and correlation_id = '70000000-0000-4000-8000-000000000002'
      and reason = 'Access removed in SQL test'
  ) then
    raise exception 'membership revocation audit event is missing';
  end if;
end;
$$;

select 'ok 9 - active owner membership cannot be revoked';
select 'ok 10 - workspace cannot have a second active owner';
select 'ok 11 - assistant revocation is recorded in append-only audit';

rollback;
