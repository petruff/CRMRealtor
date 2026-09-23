-- Sanitized shape fixture: no captured production definitions or customer rows.
-- Embedded blocks are checked against the actual migration by the companion source test.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);
create or replace function pg_temp.reconciliation_gmail_fixture() returns void language plpgsql as $fixture$
declare
  target_resource connector_private.google_gmail_resources%rowtype;
  target_job public.connector_jobs%rowtype;
  target_resource_hash text;
begin
  select * into strict target_resource from connector_private.google_gmail_resources
    where workspace_id=target_job.workspace_id and connection_id=target_job.connection_id
      and resource_hash=target_resource_hash and direction='incoming' and contact_id is not null;
end;
$fixture$;
create function pg_temp.reconciliation_contact_fixture(target jsonb, ignored boolean) returns boolean language plpgsql as $fixture$
declare parsed_uuid uuid; parsed_timestamp timestamptz;
begin
  parsed_uuid := (target->>'referredById')::uuid;
  parsed_timestamp := (target->>'lastContactedAt')::timestamptz;
  return true;
end;
$fixture$;
create function pg_temp.reconciliation_plan_fixture(target jsonb) returns boolean language plpgsql as $fixture$
declare matched_contact_id uuid;
begin
  matched_contact_id := (target->>'matchedContactId')::uuid;
  return true;
end;
$fixture$;
create temporary table reconciliation_commands (name text primary key, command text not null);
insert into reconciliation_commands values ('helper',$command$
-- BEGIN MIGRATION helper
create or replace function pg_temp.replace_function_fragment_flexible(target_signature text,target_pattern text,replacement text)
returns void language plpgsql as $$
declare definition text; reconciled text;
begin
  if to_regprocedure(target_signature) is null then raise exception 'remote lint reconciliation target is missing: %',target_signature; end if;
  definition:=pg_get_functiondef(to_regprocedure(target_signature));
  reconciled:=regexp_replace(definition,target_pattern,replacement,'g');
  if reconciled<>definition then execute reconciled; end if;
end;
$$;
-- END MIGRATION helper
$command$),('validators',$command$
-- BEGIN MIGRATION validators
select pg_temp.replace_function_fragment_flexible('pg_temp.reconciliation_contact_fixture(jsonb,boolean)',$pattern$parsed_uuid[[:space:]]*:=[[:space:]]*\(target->>'referredById'\)::uuid[[:space:]]*;$pattern$,$replacement$perform (target->>'referredById')::uuid;$replacement$);
select pg_temp.replace_function_fragment_flexible('pg_temp.reconciliation_contact_fixture(jsonb,boolean)',$pattern$parsed_timestamp[[:space:]]*:=[[:space:]]*\(target->>'lastContactedAt'\)::timestamptz[[:space:]]*;$pattern$,$replacement$perform (target->>'lastContactedAt')::timestamptz;$replacement$);
select pg_temp.replace_function_fragment_flexible('pg_temp.reconciliation_contact_fixture(jsonb,boolean)',$pattern$\mparsed_uuid\M[[:space:]]+uuid[[:space:]]*;$pattern$,'');
select pg_temp.replace_function_fragment_flexible('pg_temp.reconciliation_contact_fixture(jsonb,boolean)',$pattern$\mparsed_timestamp\M[[:space:]]+timestamptz[[:space:]]*;$pattern$,'');
select pg_temp.replace_function_fragment_flexible('pg_temp.reconciliation_plan_fixture(jsonb)',$pattern$matched_contact_id[[:space:]]*:=[[:space:]]*\(target->>'matchedContactId'\)::uuid[[:space:]]*;$pattern$,$replacement$perform (target->>'matchedContactId')::uuid;$replacement$);
select pg_temp.replace_function_fragment_flexible('pg_temp.reconciliation_plan_fixture(jsonb)',$pattern$\mmatched_contact_id\M[[:space:]]+uuid[[:space:]]*;$pattern$,'');
-- END MIGRATION validators
$command$),('gmail',$command$
-- BEGIN MIGRATION gmail
do $target_resource_reconcile$
declare
  target_signature regprocedure := 'pg_temp.reconciliation_gmail_fixture()'::regprocedure;
  definition text := pg_get_functiondef(target_signature);
  canonical_select text;
  reconciled text;
begin
  if definition ~ $pattern$\mtarget_resource\M[[:space:]]+[A-Za-z0-9_.]+%rowtype[[:space:]]*;$pattern$ then
    canonical_select := regexp_replace(
      definition,
      $pattern$select[[:space:]]+\*[[:space:]]+into[[:space:]]+strict[[:space:]]+target_resource[[:space:]]+from[[:space:]]+connector_private\.google_gmail_resources[[:space:]]+where[[:space:]]+workspace_id=target_job\.workspace_id[[:space:]]+and[[:space:]]+connection_id=target_job\.connection_id[[:space:]]+and[[:space:]]+resource_hash=target_resource_hash[[:space:]]+and[[:space:]]+direction='incoming'[[:space:]]+and[[:space:]]+contact_id[[:space:]]+is[[:space:]]+not[[:space:]]+null;$pattern$,
      $replacement$perform 1 from connector_private.google_gmail_resources
    where workspace_id=target_job.workspace_id and connection_id=target_job.connection_id
      and resource_hash=target_resource_hash and direction='incoming' and contact_id is not null;
  if not found then
    raise exception 'authorized Gmail resource was not found' using errcode='P0002';
  end if;$replacement$
    );
    if canonical_select = definition then
      raise exception 'remote lint reconciliation could not canonicalize target_resource lookup';
    end if;
    reconciled := regexp_replace(
      canonical_select,
      $pattern$\mtarget_resource\M[[:space:]]+[A-Za-z0-9_.]+%rowtype[[:space:]]*;$pattern$,
      ''
    );
    execute reconciled;
  end if;
end;
$target_resource_reconcile$;
-- END MIGRATION gmail
$command$);
select lives_ok((select command from reconciliation_commands where name='helper'),'migration helper compiles');
select lives_ok((select command from reconciliation_commands where name='helper'),'helper creation can replay in the same session');
select lives_ok((select command from reconciliation_commands where name='validators'),'quoted validator assignments reconcile before declarations are removed');
select lives_ok($test$select pg_temp.reconciliation_contact_fixture('{}'::jsonb,false)$test$,'valid nullable casts retain behavior');
select throws_ok($test$select pg_temp.reconciliation_contact_fixture('{"referredById":"invalid"}'::jsonb,false)$test$,'22P02',null,'invalid UUID remains rejected after reconciliation');
select throws_ok($test$select pg_temp.reconciliation_contact_fixture('{"lastContactedAt":"invalid"}'::jsonb,false)$test$,'22007',null,'invalid timestamp remains rejected after reconciliation');
select throws_ok($test$select pg_temp.reconciliation_plan_fixture('{"matchedContactId":"invalid"}'::jsonb)$test$,'22P02',null,'invalid plan identity remains rejected after reconciliation');
select lives_ok((select command from reconciliation_commands where name='validators'),'validator transformations replay after declarations are gone');
select lives_ok((select command from reconciliation_commands where name='gmail'),'actual single-quoted Gmail shape canonicalizes');
select ok(position('into strict target_resource' in pg_get_functiondef('pg_temp.reconciliation_gmail_fixture()'::regprocedure))=0
  and position('target_resource connector_private' in pg_get_functiondef('pg_temp.reconciliation_gmail_fixture()'::regprocedure))=0
  and position('if not found then' in pg_get_functiondef('pg_temp.reconciliation_gmail_fixture()'::regprocedure))>0,'canonical lookup removes unused record and preserves explicit not-found guard');
select throws_ok('select pg_temp.reconciliation_gmail_fixture()','P0002','authorized Gmail resource was not found','no matching resource still fails closed');
insert into reconciliation_commands values('canonical-definition',pg_get_functiondef('pg_temp.reconciliation_gmail_fixture()'::regprocedure));
select lives_ok((select command from reconciliation_commands where name='gmail'),'canonical Gmail reconciliation replays without mutation');
select is(pg_get_functiondef('pg_temp.reconciliation_gmail_fixture()'::regprocedure),(select command from reconciliation_commands where name='canonical-definition'),'replay preserves the exact canonical definition');
create or replace function pg_temp.reconciliation_gmail_fixture() returns void language plpgsql as $fixture$
declare
  target_resource connector_private.google_gmail_resources%rowtype;
  target_job public.connector_jobs%rowtype;
  target_resource_hash text;
begin
  select * into strict target_resource from connector_private.google_gmail_resources
    where workspace_id=target_job.workspace_id and connection_id=target_job.connection_id
      and resource_hash=target_resource_hash and direction='outgoing' and contact_id is not null;
end;
$fixture$;
insert into reconciliation_commands values('unrecognized-definition',pg_get_functiondef('pg_temp.reconciliation_gmail_fixture()'::regprocedure));
select throws_ok((select command from reconciliation_commands where name='gmail'),'P0001','remote lint reconciliation could not canonicalize target_resource lookup','unrecognized resource lookup aborts rather than removing its required declaration');
select is(pg_get_functiondef('pg_temp.reconciliation_gmail_fixture()'::regprocedure),(select command from reconciliation_commands where name='unrecognized-definition'),'failed canonicalization preserves original function');
select * from finish();
rollback;
