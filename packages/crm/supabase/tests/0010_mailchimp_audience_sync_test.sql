-- Story 4.1 Mailchimp audience-sync SQL/RLS/authority matrix.
-- Prerequisite: migrations 0001..0010 applied to an isolated Supabase DB.
-- TAP is emitted directly because the local image need not bundle pgtap.

begin;

select '1..25';

do $$
declare target_table text;
begin
  foreach target_table in array array[
    'mailchimp_audience_bindings','mailchimp_member_links',
    'mailchimp_subscription_authority','mailchimp_sync_evidence','mailchimp_webhook_jobs'
  ] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=target_table
        and column_name='workspace_id' and is_nullable='NO'
    ) or not exists (
      select 1 from pg_class relation
      join pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='public' and relation.relname=target_table
        and relation.relrowsecurity and relation.relforcerowsecurity
    ) or has_table_privilege('authenticated','public.'||target_table,'INSERT')
      or has_table_privilege('authenticated','public.'||target_table,'UPDATE')
      or has_table_privilege('authenticated','public.'||target_table,'DELETE') then
      raise exception 'Mailchimp table boundary failed for %',target_table;
    end if;
  end loop;
  if has_function_privilege('authenticated',
      'public.finalize_mailchimp_oauth(uuid,text,text[],jsonb,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz,uuid)','EXECUTE')
     or has_function_privilege('authenticated',
      'public.apply_mailchimp_inbound_subscription_event(uuid,text,uuid,text,text,text,text,text,text,uuid,timestamptz)','EXECUTE')
     or not has_function_privilege('authenticated',
      'public.begin_mailchimp_oauth(uuid,uuid,text,uuid,text,text,text[],text,text,text,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz,timestamptz)','EXECUTE') then
    raise exception 'Mailchimp RPC grant boundary failed';
  end if;
end $$;
select 'ok 1 - five workspace tables force RLS and mutations remain RPC-only';

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000','1a000000-0000-4000-8000-000000000001','authenticated','authenticated','mailchimp-owner-a@omnix.test','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','1a000000-0000-4000-8000-000000000002','authenticated','authenticated','mailchimp-assistant-a@omnix.test','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','1a000000-0000-4000-8000-000000000003','authenticated','authenticated','mailchimp-owner-b@omnix.test','',now(),'{}','{}',now(),now());

insert into public.workspaces(id,name) values
  ('2a000000-0000-4000-8000-000000000001','Mailchimp Workspace A'),
  ('2a000000-0000-4000-8000-000000000002','Mailchimp Workspace B');

select set_config('omnix.actor_user_id','1a000000-0000-4000-8000-000000000001',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
  ('3a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','owner','active'),
  ('3a000000-0000-4000-8000-000000000002','2a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000002','assistant','active');
select set_config('omnix.actor_user_id','1a000000-0000-4000-8000-000000000003',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
  ('3a000000-0000-4000-8000-000000000003','2a000000-0000-4000-8000-000000000002','1a000000-0000-4000-8000-000000000003','owner','active');
set constraints all immediate;
set constraints all deferred;

insert into public.contacts(
  id,owner_id,workspace_id,first_name,last_name,email,email_subscribed,
  lead_type,relationship,intent,source,pipeline_stage,tags,created_at,updated_at
) values
  ('4a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','Ada','Mailchimp','ada.mailchimp@example.com',true,'hot','lead','buyer','website','new','{}','2026-08-11T12:00:00Z','2026-08-11T12:00:00Z'),
  ('4a000000-0000-4000-8000-000000000002','1a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','Ambiguous','One','duplicate.mailchimp@example.com',true,'warm','lead','unknown','other','new','{}','2026-08-11T12:00:01Z','2026-08-11T12:00:01Z'),
  ('4a000000-0000-4000-8000-000000000003','1a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','Ambiguous','Two','duplicate.mailchimp@example.com',true,'warm','lead','unknown','other','new','{}','2026-08-11T12:00:02Z','2026-08-11T12:00:02Z'),
  ('4a000000-0000-4000-8000-000000000004','1a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','Archived','Contact','archived.mailchimp@example.com',true,'nurture','lead','unknown','other','new','{}','2026-08-11T12:00:03Z','2026-08-11T12:00:03Z'),
  ('4a000000-0000-4000-8000-000000000005','1a000000-0000-4000-8000-000000000003','2a000000-0000-4000-8000-000000000002','Other','Workspace','other.mailchimp@example.com',true,'nurture','lead','unknown','other','new','{}','2026-08-11T12:00:04Z','2026-08-11T12:00:04Z');
update public.contacts set archived_at='2026-08-11T12:01:00Z',
  archived_by_membership_id='3a000000-0000-4000-8000-000000000001',archive_reason='test'
where id='4a000000-0000-4000-8000-000000000004';

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','1a000000-0000-4000-8000-000000000002',true);

do $$ begin
  begin
    perform public.begin_mailchimp_oauth(
      '5a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','Mailchimp',
      '6a000000-0000-4000-8000-000000000001',repeat('1',64),'mailchimp.audience-sync.v1',array['audience.sync','audience.reconcile'],
      repeat('2',64),'https://omnix.test/oauth/mailchimp/callback','/connections',decode(repeat('aa',32),'hex'),decode(repeat('01',12),'hex'),
      decode(repeat('02',16),'hex'),decode(repeat('bb',32),'hex'),decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),'v1',repeat('3',64),
      '2026-08-11T12:15:00Z','2026-08-11T12:05:00Z');
    raise exception 'assistant unexpectedly started Mailchimp OAuth';
  exception when insufficient_privilege then null; end;
  if exists(select 1 from public.connector_connections where id='5a000000-0000-4000-8000-000000000001') then
    raise exception 'assistant denial left an orphan connection';
  end if;
end $$;
select 'ok 2 - assistant cannot start OAuth and denial leaves no authorizing orphan';

select set_config('request.jwt.claim.sub','1a000000-0000-4000-8000-000000000001',true);
do $$
declare started jsonb; replay jsonb;
begin
  started:=public.begin_mailchimp_oauth(
    '5a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','Mailchimp primary',
    '6a000000-0000-4000-8000-000000000001',repeat('1',64),'mailchimp.audience-sync.v1',array['audience.sync','audience.reconcile'],
    repeat('2',64),'https://omnix.test/oauth/mailchimp/callback','/connections',decode(repeat('aa',32),'hex'),decode(repeat('01',12),'hex'),
    decode(repeat('02',16),'hex'),decode(repeat('bb',32),'hex'),decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),'v1',repeat('3',64),
    '2026-08-11T12:15:00Z','2026-08-11T12:05:00Z');
  replay:=public.begin_mailchimp_oauth(
    '5a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','Mailchimp primary',
    '6a000000-0000-4000-8000-000000000001',repeat('1',64),'mailchimp.audience-sync.v1',array['audience.sync','audience.reconcile'],
    repeat('2',64),'https://omnix.test/oauth/mailchimp/callback','/connections',decode(repeat('aa',32),'hex'),decode(repeat('01',12),'hex'),
    decode(repeat('02',16),'hex'),decode(repeat('bb',32),'hex'),decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),'v1',repeat('3',64),
    '2026-08-11T12:15:00Z','2026-08-11T12:05:00Z');
  if (started->>'noOp')::boolean or not (replay->>'noOp')::boolean
     or started#>>'{connection,status}'<>'authorizing'
     or started#>>'{receipt,provider}'<>'mailchimp'
     or started#>>'{receipt,event_type}'<>'oauth.started'
     or started::text ~* '(ciphertext|wrapped_dek|auth_tag|pkce)'
     or (select count(*) from public.connector_connections where id='5a000000-0000-4000-8000-000000000001')<>1 then
    raise exception 'atomic OAuth start/replay contract failed';
  end if;
end $$;
select 'ok 3 - owner OAuth start is atomic, replay-safe, provider-bound and redacted';

reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub','',true);
do $$
declare consumed jsonb; completed jsonb;
begin
  consumed:=public.consume_connector_oauth_transaction(repeat('1',64),'2a000000-0000-4000-8000-000000000001',
    '1a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000001',repeat('2',64),
    'https://omnix.test/oauth/mailchimp/callback','2026-08-11T12:06:00Z');
  completed:=public.finalize_mailchimp_oauth('5a000000-0000-4000-8000-000000000001',repeat('a',64),
    array['audience.sync','audience.reconcile'],'{"accountIdHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","accountName":"Omnix Test","dataCenter":"us21"}',
    decode(repeat('cc',32),'hex'),decode(repeat('05',12),'hex'),decode(repeat('06',16),'hex'),decode(repeat('dd',32),'hex'),
    decode(repeat('07',12),'hex'),decode(repeat('08',16),'hex'),'v1',repeat('4',64),'2026-08-11T12:07:00Z','6a000000-0000-4000-8000-000000000002');
  if consumed#>>'{connectionId}'<>'5a000000-0000-4000-8000-000000000001'
     or completed#>>'{connection,status}'<>'active'
     or completed#>>'{secret,secretType}'<>'mailchimp-access-token'
     or completed#>>'{receipt,provider}'<>'mailchimp'
     or completed#>>'{receipt,event_type}'<>'oauth.completed'
     or completed::text ~* '(ciphertext|wrapped_dek|auth_tag)' then
    raise exception 'OAuth completion contract failed';
  end if;
end $$;
select 'ok 4 - consumed OAuth finalizes one encrypted token and returns only redacted metadata';

do $$
declare replay jsonb;
begin
  replay:=public.finalize_mailchimp_oauth('5a000000-0000-4000-8000-000000000001',repeat('a',64),
    array['audience.sync','audience.reconcile'],'{"accountIdHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","accountName":"Omnix Test","dataCenter":"us21"}',
    decode(repeat('cc',32),'hex'),decode(repeat('05',12),'hex'),decode(repeat('06',16),'hex'),decode(repeat('dd',32),'hex'),
    decode(repeat('07',12),'hex'),decode(repeat('08',16),'hex'),'v1',repeat('4',64),'2026-08-11T12:07:00Z','6a000000-0000-4000-8000-000000000002');
  if not (replay->>'noOp')::boolean or replay#>>'{receipt,event_type}'<>'oauth.completed' then
    raise exception 'OAuth finalize replay rotated token';
  end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from connector_private.connector_connection_secrets
      where connection_id='5a000000-0000-4000-8000-000000000001'
        and secret_type='mailchimp-access-token' and destroyed_at is null)<>1
     or (select secret_version from connector_private.connector_connection_secrets
         where connection_id='5a000000-0000-4000-8000-000000000001')<>1 then
    raise exception 'OAuth finalize replay rotated or duplicated token';
  end if;
end $$;
select 'ok 5 - OAuth completion replay does not rotate or duplicate the token';

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','1a000000-0000-4000-8000-000000000001',true);
do $$
declare selected jsonb; replay jsonb; replaced jsonb;
begin
  selected:=public.select_mailchimp_audience('5a000000-0000-4000-8000-000000000001',repeat('a',64),'us21','audience-alpha','Primary audience',1,'6a000000-0000-4000-8000-000000000003','2026-08-11T12:08:00Z');
  replay:=public.select_mailchimp_audience('5a000000-0000-4000-8000-000000000001',repeat('a',64),'us21','audience-alpha','Primary audience',1,'6a000000-0000-4000-8000-000000000003','2026-08-11T12:08:00Z');
  replaced:=public.select_mailchimp_audience('5a000000-0000-4000-8000-000000000001',repeat('a',64),'us21','audience-beta','Production audience',2,'6a000000-0000-4000-8000-000000000004','2026-08-11T12:09:00Z');
  perform set_config('omnix.test_binding_id',replaced#>>'{binding,id}',true);
  if (selected->>'noOp')::boolean or not (replay->>'noOp')::boolean or (replaced->>'noOp')::boolean
     or replaced#>>'{receipt,event_type}'<>'audience.replaced'
     or (select count(*) from public.mailchimp_audience_bindings where connection_id='5a000000-0000-4000-8000-000000000001' and replaced_at is null)<>1
     or (select count(*) from public.mailchimp_audience_bindings where connection_id='5a000000-0000-4000-8000-000000000001')<>2 then
    raise exception 'selected audience append/replay/replace contract failed';
  end if;
end $$;
select 'ok 6 - audience selection is replay-safe and replacement keeps one active binding plus history';

select set_config('request.jwt.claim.sub','1a000000-0000-4000-8000-000000000002',true);
do $$ begin
  if (select count(*) from public.mailchimp_audience_bindings)<>2
     or exists(select 1 from public.mailchimp_audience_bindings where to_jsonb(mailchimp_audience_bindings)::text ~* 'example.com') then
    raise exception 'assistant redacted read failed';
  end if;
  begin
    perform public.select_mailchimp_audience('5a000000-0000-4000-8000-000000000001',repeat('a',64),'us21','forbidden','Forbidden',1,'6a000000-0000-4000-8000-000000000005',now());
    raise exception 'assistant unexpectedly changed selected audience';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub','1a000000-0000-4000-8000-000000000003',true);
  if exists(select 1 from public.mailchimp_audience_bindings) then raise exception 'cross-workspace binding exposed'; end if;
end $$;
select 'ok 7 - assistant gets redacted read only and cross-workspace RLS remains closed';

reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub','',true);
do $$
begin
  if has_function_privilege('service_role',
      'public.complete_mailchimp_audience_baseline(uuid,uuid,text,uuid,timestamptz)','EXECUTE') then
    raise exception 'direct baseline completion unexpectedly remains service-callable';
  end if;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','1a000000-0000-4000-8000-000000000001',true);
do $$ declare requested jsonb; begin
  requested:=public.request_mailchimp_reconciliation_run(
    '5a000000-0000-4000-8000-000000000001',current_setting('omnix.test_binding_id')::uuid,
    'baseline',repeat('a1',32),repeat('a2',32),100,
    '6a000000-0000-4000-8000-000000000101','2026-08-11T12:09:01Z',3);
  perform set_config('omnix.test_baseline_run',requested#>>'{run,id}',true);
  if requested#>>'{run,state}'<>'queued' or (requested->>'noOp')::boolean then
    raise exception 'canonical baseline request failed'; end if;
end $$;

reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub','',true);
do $$
declare claimed public.mailchimp_reconciliation_runs%rowtype; linked jsonb;
 point_id uuid; subscriber text; completed jsonb; webhook_ready jsonb;
begin
  select * into claimed from public.claim_mailchimp_reconciliation_runs(
    '6a000000-0000-4000-8000-000000000201',1,90,'2026-08-11T12:09:02Z');
  perform public.start_mailchimp_reconciliation_run(claimed.id,
    '6a000000-0000-4000-8000-000000000201',claimed.fencing_token,'2026-08-11T12:09:03Z');
  perform public.apply_mailchimp_reconciliation_page(claimed.id,
    '6a000000-0000-4000-8000-000000000201',claimed.fencing_token,
    0,'[]'::jsonb,0,0,repeat('a3',32),'2026-08-11T12:09:04Z');
  completed:=public.complete_mailchimp_reconciliation_run(claimed.id,
    '6a000000-0000-4000-8000-000000000201',claimed.fencing_token,
    repeat('a4',32),'2026-08-11T12:09:05Z');
  webhook_ready:=public.confirm_mailchimp_webhook_registration('5a000000-0000-4000-8000-000000000001',current_setting('omnix.test_binding_id')::uuid,
    repeat('a5',32),'6a000000-0000-4000-8000-000000000102','2026-08-11T12:09:06Z');
  select id,encode(extensions.digest(pg_catalog.convert_to(normalized_value,'UTF8'),'md5'),'hex') into point_id,subscriber
  from public.contact_points where contact_id='4a000000-0000-4000-8000-000000000001' and type='email' and archived_at is null;
  linked:=public.link_mailchimp_member(current_setting('omnix.test_binding_id')::uuid,point_id,subscriber,'member-ada');
  perform set_config('omnix.test_subscriber_hash',subscriber,true);
  if not (completed->>'completed')::boolean
     or completed#>>'{baselineConfirmation,binding,baseline_required}'<>'false'
     or webhook_ready#>>'{binding,webhook_registration_required}'<>'false'
     or (linked->>'noOp')::boolean or linked#>>'{memberLink,contact_id}'<>'4a000000-0000-4000-8000-000000000001'
     or linked::text ~* 'ada.mailchimp@example.com' then raise exception 'member link contract failed'; end if;
  begin
    perform public.link_mailchimp_member(current_setting('omnix.test_binding_id')::uuid,
      (select id from public.contact_points where contact_id='4a000000-0000-4000-8000-000000000005' and type='email'),
      encode(extensions.digest(pg_catalog.convert_to('other.mailchimp@example.com','UTF8'),'md5'),'hex'),'cross-workspace');
    raise exception 'cross-workspace member link unexpectedly succeeded';
  exception when no_data_found then null; end;
end $$;
select 'ok 8 - direct baseline completion is revoked; durable reconciliation, webhook readiness and member binding are evidence-backed';

do $$
declare delivery jsonb; applied jsonb;
begin
  delivery:=public.register_connector_webhook_delivery('5a000000-0000-4000-8000-000000000001',repeat('b',64),repeat('c',64),true,true,'2026-08-11T12:10:00Z','6a000000-0000-4000-8000-000000000006');
  applied:=public.apply_mailchimp_inbound_subscription_event('5a000000-0000-4000-8000-000000000001','audience-beta',(delivery#>>'{delivery,id}')::uuid,
    'member-ada',current_setting('omnix.test_subscriber_hash'),'ada.mailchimp@example.com','unsubscribed',repeat('d',64),null,
    '6a000000-0000-4000-8000-000000000007','2026-08-11T12:10:01Z');
  if applied#>>'{outcome}'<>'applied' or applied#>>'{authority,resubscribe_requires_consent}'<>'true'
     or applied#>>'{receipt,provider}'<>'mailchimp' or applied#>>'{receipt,event_type}'<>'sync.applied'
     or (select email_subscribed from public.contact_points where contact_id='4a000000-0000-4000-8000-000000000001' and type='email') is distinct from false
     or (select email_subscribed from public.contacts where id='4a000000-0000-4000-8000-000000000001') is distinct from false
     or not exists(select 1 from public.activity_events where contact_id='4a000000-0000-4000-8000-000000000001' and type='contact-point-updated') then
    raise exception 'canonical provider unsubscribe application failed';
  end if;
end $$;
select 'ok 9 - verified inbound unsubscribe atomically updates canonical and legacy projections with evidence';

do $$ begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name in ('mailchimp_member_links','mailchimp_subscription_authority','mailchimp_sync_evidence') and column_name in ('email','raw_email','provider_body','raw_body'))
     or exists(select 1 from public.mailchimp_sync_evidence where to_jsonb(mailchimp_sync_evidence)::text ~* 'ada.mailchimp@example.com')
     or exists(select 1 from public.connector_receipt_events where connection_id='5a000000-0000-4000-8000-000000000001' and redacted_metadata::text ~* 'ada.mailchimp@example.com') then
    raise exception 'raw email/body leaked to public sync evidence';
  end if;
end $$;
select 'ok 10 - public Mailchimp evidence contains hashes and IDs but no raw email or provider body';

do $$
declare replay jsonb;
begin
  replay:=public.apply_mailchimp_inbound_subscription_event('5a000000-0000-4000-8000-000000000001','audience-beta',
    (select id from public.connector_webhook_deliveries where replay_key_hash=repeat('b',64)),'member-ada',current_setting('omnix.test_subscriber_hash'),
    'ada.mailchimp@example.com','unsubscribed',repeat('d',64),null,'6a000000-0000-4000-8000-000000000007','2026-08-11T12:10:01Z');
  if not (replay->>'noOp')::boolean
     or (select count(*) from public.mailchimp_sync_evidence where provider_event_id_hash=repeat('d',64))<>1
     or (select count(*) from public.activity_events where idempotency_key='mailchimp.subscription:'||repeat('d',64))<>1 then
    raise exception 'inbound provider replay duplicated effects';
  end if;
end $$;
select 'ok 11 - provider event replay returns original evidence without duplicate effects';

do $$
declare delivery jsonb; blocked jsonb;
begin
  delivery:=public.register_connector_webhook_delivery('5a000000-0000-4000-8000-000000000001',repeat('e',64),repeat('f',64),true,true,'2026-08-11T12:11:00Z','6a000000-0000-4000-8000-000000000008');
  blocked:=public.apply_mailchimp_inbound_subscription_event('5a000000-0000-4000-8000-000000000001','audience-beta',(delivery#>>'{delivery,id}')::uuid,
    'member-ada',current_setting('omnix.test_subscriber_hash'),'ada.mailchimp@example.com','subscribed',repeat('1a',32),null,
    '6a000000-0000-4000-8000-000000000009','2026-08-11T12:11:01Z');
  if blocked#>>'{outcome}'<>'blocked-unsubscribe-authority'
     or blocked#>>'{receipt,event_type}'<>'sync.reviewed'
     or (select email_subscribed from public.contact_points where contact_id='4a000000-0000-4000-8000-000000000001' and type='email') is distinct from false then
    raise exception 'provider unsubscribe authority was bypassed';
  end if;
end $$;
select 'ok 12 - ordinary inbound subscribe cannot override provider unsubscribe without fresh consent';

do $$
declare delivery jsonb; reviewed jsonb; duplicate_hash text;
begin
  duplicate_hash:=encode(extensions.digest(pg_catalog.convert_to('duplicate.mailchimp@example.com','UTF8'),'md5'),'hex');
  delivery:=public.register_connector_webhook_delivery('5a000000-0000-4000-8000-000000000001',repeat('2a',32),repeat('2b',32),true,true,'2026-08-11T12:12:00Z','6a000000-0000-4000-8000-000000000010');
  reviewed:=public.apply_mailchimp_inbound_subscription_event('5a000000-0000-4000-8000-000000000001','audience-beta',(delivery#>>'{delivery,id}')::uuid,
    'member-ambiguous',duplicate_hash,'duplicate.mailchimp@example.com','unsubscribed',repeat('2c',32),null,
    '6a000000-0000-4000-8000-000000000011','2026-08-11T12:12:01Z');
  if reviewed#>>'{outcome}'<>'review' or reviewed#>>'{receipt,reconciliation_result}'<>'ambiguous-email'
     or exists(select 1 from public.mailchimp_member_links where member_external_id='member-ambiguous')
     or exists(select 1 from public.contact_points where normalized_value='duplicate.mailchimp@example.com' and email_subscribed is distinct from true) then
    raise exception 'ambiguous inbound event mutated contacts';
  end if;
end $$;
select 'ok 13 - ambiguous canonical email is routed to review without mutation';

do $$
declare delivery jsonb; reviewed jsonb; archived_hash text;
begin
  archived_hash:=encode(extensions.digest(pg_catalog.convert_to('archived.mailchimp@example.com','UTF8'),'md5'),'hex');
  delivery:=public.register_connector_webhook_delivery('5a000000-0000-4000-8000-000000000001',repeat('3a',32),repeat('3b',32),true,true,'2026-08-11T12:13:00Z','6a000000-0000-4000-8000-000000000012');
  reviewed:=public.apply_mailchimp_inbound_subscription_event('5a000000-0000-4000-8000-000000000001','audience-beta',(delivery#>>'{delivery,id}')::uuid,
    'member-archived',archived_hash,'archived.mailchimp@example.com','unsubscribed',repeat('3c',32),null,
    '6a000000-0000-4000-8000-000000000013','2026-08-11T12:13:01Z');
  if reviewed#>>'{outcome}'<>'review' or reviewed#>>'{receipt,reconciliation_result}'<>'archived-email'
     or exists(select 1 from public.mailchimp_member_links where member_external_id='member-archived') then
    raise exception 'archived inbound event mutated contacts';
  end if;
end $$;
select 'ok 14 - archived canonical email is routed to review without mutation';

reset role;
insert into connector_private.connector_payload_envelopes(
  id,workspace_id,connection_id,payload_kind,schema_version,canonical_hash,ciphertext,nonce,auth_tag,wrapped_dek,wrap_nonce,wrap_auth_tag,kek_version,aad_hash
) values('8a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','5a000000-0000-4000-8000-000000000001',
  'audience.sync','mailchimp-sync.v1',repeat('5',64),decode(repeat('aa',32),'hex'),decode(repeat('01',12),'hex'),decode(repeat('02',16),'hex'),
  decode(repeat('bb',32),'hex'),decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),'v1',repeat('6',64));

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','1a000000-0000-4000-8000-000000000001',true);
do $$
declare intent jsonb; approved jsonb; ensured jsonb; replay jsonb;
begin
  ensured:=public.ensure_mailchimp_sync_policy('2a000000-0000-4000-8000-000000000001','6a000000-0000-4000-8000-000000000014','2026-08-11T12:13:30Z');
  replay:=public.ensure_mailchimp_sync_policy('2a000000-0000-4000-8000-000000000001','6a000000-0000-4000-8000-000000000014','2026-08-11T12:13:30Z');
  intent:=public.create_connector_action_intent('5a000000-0000-4000-8000-000000000001','audience.sync','Sync selected Mailchimp audience',
    '8a000000-0000-4000-8000-000000000001',repeat('5',64),(ensured#>>'{policy,id}')::uuid,1,'{}','6a000000-0000-4000-8000-000000000015');
  approved:=public.approve_and_enqueue_connector_action((intent#>>'{intent,id}')::uuid,1,repeat('5',64),'mailchimp-sync-001',
    '6a000000-0000-4000-8000-000000000016','2026-08-11T12:14:00Z',5);
  perform set_config('omnix.test_job_id',approved#>>'{job,id}',true);
  if ensured#>>'{policy,action_type}'<>'audience.sync' or (ensured->>'noOp')::boolean
     or not (replay->>'noOp')::boolean
     or approved#>>'{job,provider}'<>'mailchimp' or approved#>>'{job,state}'<>'queued' then raise exception 'Mailchimp policy/job bootstrap failed'; end if;
end $$;
select 'ok 15 - owner idempotently bootstraps the canonical audience.sync policy and durable approved job';

reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub','',true);
do $$
declare claimed public.connector_jobs%rowtype; started jsonb; binding jsonb;
begin
  select * into claimed from public.claim_connector_jobs('9a000000-0000-4000-8000-000000000001',1,90,'2026-08-11T12:14:00Z');
  started:=public.start_connector_job_attempt(claimed.id,'9a000000-0000-4000-8000-000000000001',claimed.fencing_token,'2026-08-11T12:14:01Z');
  binding:=public.read_mailchimp_job_binding(claimed.id,'9a000000-0000-4000-8000-000000000001',claimed.fencing_token,'2026-08-11T12:14:02Z');
  perform set_config('omnix.test_fence',claimed.fencing_token::text,true);
  if binding<>jsonb_build_object('workspaceId','2a000000-0000-4000-8000-000000000001'::uuid,'connectionId','5a000000-0000-4000-8000-000000000001'::uuid,
      'dataCenter','us21','audienceId','audience-beta','accountIdHash',repeat('a',64),'mappingVersion',2,
      'baselineRequired',false,'webhookRegistrationRequired',false)
     or started#>>'{job,state}'<>'executing' then raise exception 'lease-bound binding contract failed: %',binding; end if;
  begin
    perform public.read_mailchimp_job_binding(claimed.id,'9a000000-0000-4000-8000-000000000002',claimed.fencing_token,'2026-08-11T12:14:02Z');
    raise exception 'wrong worker read Mailchimp binding';
  exception when insufficient_privilege then null; end;
end $$;
select 'ok 16 - worker reads server-selected routing metadata only with the active lease and fence';

do $$
declare evidence jsonb; replay jsonb;
begin
  evidence:=public.record_mailchimp_outbound_sync_evidence(current_setting('omnix.test_job_id')::uuid,'9a000000-0000-4000-8000-000000000001',current_setting('omnix.test_fence')::bigint,
    current_setting('omnix.test_subscriber_hash'),repeat('7',64),'subscribed','applied','6a000000-0000-4000-8000-000000000017','2026-08-11T12:14:03Z');
  replay:=public.record_mailchimp_outbound_sync_evidence(current_setting('omnix.test_job_id')::uuid,'9a000000-0000-4000-8000-000000000001',current_setting('omnix.test_fence')::bigint,
    current_setting('omnix.test_subscriber_hash'),repeat('7',64),'subscribed','applied','6a000000-0000-4000-8000-000000000017','2026-08-11T12:14:03Z');
  if (evidence->>'allowed')::boolean or evidence#>>'{evidence,outcome}'<>'blocked-unsubscribe-authority'
     or not (replay->>'noOp')::boolean then raise exception 'outbound unsubscribe lock/replay failed'; end if;
end $$;
select 'ok 17 - outbound sync evidence cannot silently resubscribe an unsubscribed member';

do $$
declare stored jsonb; readback jsonb; updated jsonb;
begin
  stored:=public.store_mailchimp_sync_checkpoint(current_setting('omnix.test_job_id')::uuid,'9a000000-0000-4000-8000-000000000001',current_setting('omnix.test_fence')::bigint,null,
    decode(repeat('cc',32),'hex'),decode(repeat('05',12),'hex'),decode(repeat('06',16),'hex'),decode(repeat('dd',32),'hex'),decode(repeat('07',12),'hex'),decode(repeat('08',16),'hex'),
    'v1',repeat('8',64),'2026-08-12T12:14:00Z','2026-08-11T12:14:04Z');
  readback:=public.read_mailchimp_sync_checkpoint(current_setting('omnix.test_job_id')::uuid,'9a000000-0000-4000-8000-000000000001',current_setting('omnix.test_fence')::bigint,'2026-08-11T12:14:05Z');
  updated:=public.store_mailchimp_sync_checkpoint(current_setting('omnix.test_job_id')::uuid,'9a000000-0000-4000-8000-000000000001',current_setting('omnix.test_fence')::bigint,1,
    decode(repeat('ee',32),'hex'),decode(repeat('09',12),'hex'),decode(repeat('0a',16),'hex'),decode(repeat('ff',32),'hex'),decode(repeat('0b',12),'hex'),decode(repeat('0c',16),'hex'),
    'v2',repeat('9',64),'2026-08-13T12:14:00Z','2026-08-11T12:14:06Z');
  if stored#>>'{cursorVersion}'<>'1' or readback#>>'{checkpoint,cursorVersion}'<>'1' or readback#>>'{checkpoint,ciphertext}' is null
     or updated#>>'{cursorVersion}'<>'2' or updated ? 'ciphertext' then raise exception 'checkpoint store/read contract failed'; end if;
  begin
    perform public.store_mailchimp_sync_checkpoint(current_setting('omnix.test_job_id')::uuid,'9a000000-0000-4000-8000-000000000001',current_setting('omnix.test_fence')::bigint,1,
      decode(repeat('ee',32),'hex'),decode(repeat('09',12),'hex'),decode(repeat('0a',16),'hex'),decode(repeat('ff',32),'hex'),decode(repeat('0b',12),'hex'),decode(repeat('0c',16),'hex'),
      'v2',repeat('9',64),null,'2026-08-11T12:14:07Z');
    raise exception 'stale checkpoint CAS unexpectedly succeeded';
  exception when serialization_failure then null; end;
end $$;
select 'ok 18 - encrypted selected-audience checkpoint is lease-bound and version-CAS protected';

do $$ begin
  begin
    perform public.read_mailchimp_sync_checkpoint(current_setting('omnix.test_job_id')::uuid,'9a000000-0000-4000-8000-000000000001',current_setting('omnix.test_fence')::bigint,'2026-08-11T12:16:00Z');
    raise exception 'expired lease read checkpoint';
  exception when insufficient_privilege then null; end;
end $$;
select 'ok 19 - expired lease or stale fence cannot read encrypted checkpoint material';

reset role;
do $$ begin
  begin
    update public.mailchimp_sync_evidence set outcome='no-op' where source_key_hash=repeat('7',64);
    raise exception 'sync evidence update unexpectedly succeeded';
  exception when object_not_in_prerequisite_state then null; end;
  begin
    update public.mailchimp_audience_bindings set audience_name='tamper' where id=current_setting('omnix.test_binding_id')::uuid;
    raise exception 'audience history update unexpectedly succeeded';
  exception when object_not_in_prerequisite_state then null; end;
end $$;
select 'ok 20 - sync evidence and audience selection history are append-only even for privileged SQL';

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub','',true);
do $$
declare token jsonb;
begin
  token:=public.read_mailchimp_access_token('2a000000-0000-4000-8000-000000000001','5a000000-0000-4000-8000-000000000001',
    '1a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000001');
  if token#>>'{workspaceId}'<>'2a000000-0000-4000-8000-000000000001'
     or token#>>'{secret,secretType}'<>'mailchimp-access-token'
     or token#>>'{secret,ciphertext}' is null or token::text ~* '(access-token-value|refresh-token-value)' then
    raise exception 'owner-bound encrypted token read contract failed';
  end if;
  begin
    perform public.read_mailchimp_access_token('2a000000-0000-4000-8000-000000000001','5a000000-0000-4000-8000-000000000001',
      '1a000000-0000-4000-8000-000000000002','3a000000-0000-4000-8000-000000000002');
    raise exception 'assistant authority read Mailchimp token';
  exception when insufficient_privilege then null; end;
end $$;
select 'ok 21 - service token read requires an explicitly bound active owner and returns only an envelope';

do $$
declare registered jsonb; replay jsonb; claimed public.mailchimp_webhook_jobs%rowtype; started jsonb; payload jsonb;
begin
  if has_function_privilege('service_role',
      'public.register_mailchimp_webhook_event(uuid,text,text,text,boolean,boolean,uuid,text,uuid,timestamptz,integer)','EXECUTE') then
    raise exception 'unsafe two-step webhook registration remains service-callable';
  end if;
  registered:=public.register_mailchimp_webhook_event_encrypted(
    '5a000000-0000-4000-8000-000000000001','audience-beta',repeat('c1',32),repeat('c2',32),true,true,
    repeat('b1',32),decode(repeat('11',32),'hex'),decode(repeat('12',12),'hex'),decode(repeat('13',16),'hex'),
    decode(repeat('14',32),'hex'),decode(repeat('15',12),'hex'),decode(repeat('16',16),'hex'),'v1',repeat('b2',32),
    '6a000000-0000-4000-8000-000000000201','2026-08-11T12:18:00Z',3);
  replay:=public.register_mailchimp_webhook_event_encrypted(
    '5a000000-0000-4000-8000-000000000001','audience-beta',repeat('c1',32),repeat('c2',32),true,true,
    repeat('b1',32),decode(repeat('11',32),'hex'),decode(repeat('12',12),'hex'),decode(repeat('13',16),'hex'),
    decode(repeat('14',32),'hex'),decode(repeat('15',12),'hex'),decode(repeat('16',16),'hex'),'v1',repeat('b2',32),
    '6a000000-0000-4000-8000-000000000201','2026-08-11T12:18:00Z',3);
  select * into claimed from public.claim_mailchimp_webhook_jobs('9b000000-0000-4000-8000-000000000001',1,90,'2026-08-11T12:18:01Z');
  started:=public.start_mailchimp_webhook_job(claimed.id,'9b000000-0000-4000-8000-000000000001',claimed.fencing_token,'2026-08-11T12:18:02Z');
  payload:=public.read_claimed_mailchimp_webhook_payload(claimed.id,'9b000000-0000-4000-8000-000000000001',claimed.fencing_token,'2026-08-11T12:18:03Z');
  perform set_config('omnix.test_webhook_job',claimed.id::text,true);
  perform set_config('omnix.test_webhook_fence',claimed.fencing_token::text,true);
  if not (registered->>'accepted')::boolean or registered#>>'{webhookJob,state}'<>'queued'
     or not (replay->>'noOp')::boolean or started#>>'{webhookJob,state}'<>'executing'
     or payload#>>'{audienceId}'<>'audience-beta' or payload#>>'{payload,ciphertext}' is null
     or registered::text ~* 'example.com' then raise exception 'durable webhook registration/claim failed'; end if;
  begin
    perform public.read_claimed_mailchimp_webhook_payload(claimed.id,'9b000000-0000-4000-8000-000000000002',claimed.fencing_token,'2026-08-11T12:18:03Z');
    raise exception 'wrong worker read webhook payload';
  exception when insufficient_privilege then null; end;
end $$;
select 'ok 22 - unsafe two-step ingress is revoked; atomic encrypted registration is replay-safe and leased/fenced';

do $$
declare applied jsonb; transitioned jsonb; missing_hash text;
begin
  missing_hash:=encode(extensions.digest(pg_catalog.convert_to('missing.mailchimp@example.com','UTF8'),'md5'),'hex');
  applied:=public.apply_claimed_mailchimp_inbound_subscription_event(current_setting('omnix.test_webhook_job')::uuid,
    '9b000000-0000-4000-8000-000000000001',current_setting('omnix.test_webhook_fence')::bigint,
    'member-missing',missing_hash,'missing.mailchimp@example.com','subscribed',repeat('c3',32),null,'2026-08-11T12:18:04Z');
  transitioned:=public.transition_mailchimp_webhook_job(current_setting('omnix.test_webhook_job')::uuid,
    '9b000000-0000-4000-8000-000000000001',current_setting('omnix.test_webhook_fence')::bigint,
    'succeeded',null,null,'2026-08-11T12:18:05Z');
  if applied#>>'{outcome}'<>'review' or applied#>>'{receipt,reconciliation_result}'<>'no-canonical-match'
     or transitioned#>>'{webhookJob,state}'<>'succeeded'
     or not exists(select 1 from public.connector_webhook_deliveries where id=(select delivery_id from public.mailchimp_webhook_jobs where id=current_setting('omnix.test_webhook_job')::uuid) and processed_at is not null) then
    raise exception 'claimed webhook apply/completion failed';
  end if;
end $$;
select 'ok 23 - claimed webhook apply is idempotent and completion follows durable processed evidence';

do $$
declare registered jsonb; first_claim public.mailchimp_webhook_jobs%rowtype; second_claim public.mailchimp_webhook_jobs%rowtype; transitioned jsonb;
begin
  registered:=public.register_mailchimp_webhook_event_encrypted(
    '5a000000-0000-4000-8000-000000000001','audience-beta',repeat('d1',32),repeat('d2',32),true,true,
    repeat('d3',32),decode(repeat('21',32),'hex'),decode(repeat('22',12),'hex'),decode(repeat('23',16),'hex'),
    decode(repeat('24',32),'hex'),decode(repeat('25',12),'hex'),decode(repeat('26',16),'hex'),'v1',repeat('d4',32),
    '6a000000-0000-4000-8000-000000000202','2026-08-11T12:19:00Z',3);
  select * into first_claim from public.claim_mailchimp_webhook_jobs('9b000000-0000-4000-8000-000000000001',1,30,'2026-08-11T12:19:01Z');
  perform public.start_mailchimp_webhook_job(first_claim.id,'9b000000-0000-4000-8000-000000000001',first_claim.fencing_token,'2026-08-11T12:19:02Z');
  transitioned:=public.transition_mailchimp_webhook_job(first_claim.id,'9b000000-0000-4000-8000-000000000001',first_claim.fencing_token,
    'retry','provider_timeout','2026-08-11T12:20:00Z','2026-08-11T12:19:03Z');
  select * into second_claim from public.claim_mailchimp_webhook_jobs('9b000000-0000-4000-8000-000000000002',1,30,'2026-08-11T12:20:00Z');
  if transitioned#>>'{webhookJob,state}'<>'retry_wait' or second_claim.id<>first_claim.id or second_claim.fencing_token<>first_claim.fencing_token+1 then
    raise exception 'webhook retry/fence progression failed';
  end if;
  begin
    perform public.start_mailchimp_webhook_job(first_claim.id,'9b000000-0000-4000-8000-000000000001',first_claim.fencing_token,'2026-08-11T12:20:01Z');
    raise exception 'stale webhook worker restarted job';
  exception when serialization_failure then null; end;
  perform public.start_mailchimp_webhook_job(second_claim.id,'9b000000-0000-4000-8000-000000000002',second_claim.fencing_token,'2026-08-11T12:20:01Z');
  perform public.transition_mailchimp_webhook_job(second_claim.id,'9b000000-0000-4000-8000-000000000002',second_claim.fencing_token,
    'review','manual_review_required',null,'2026-08-11T12:20:02Z');
end $$;
select 'ok 24 - webhook retry is scheduled durably and a new claim fences the prior worker';

do $$ declare queued jsonb; begin
  queued:=public.register_mailchimp_webhook_event_encrypted(
    '5a000000-0000-4000-8000-000000000001','audience-beta',repeat('e1',32),repeat('e2',32),true,true,
    repeat('e3',32),decode(repeat('31',32),'hex'),decode(repeat('32',12),'hex'),decode(repeat('33',16),'hex'),
    decode(repeat('34',32),'hex'),decode(repeat('35',12),'hex'),decode(repeat('36',16),'hex'),'v1',repeat('e4',32),
    '6a000000-0000-4000-8000-000000000203','2026-08-11T12:21:00Z',3);
  perform set_config('omnix.test_queued_webhook_job',queued#>>'{webhookJob,id}',true);
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','1a000000-0000-4000-8000-000000000001',true);
do $$
declare replaced jsonb;
begin
  replaced:=public.select_mailchimp_audience('5a000000-0000-4000-8000-000000000001',repeat('a',64),'us21','audience-gamma','Replacement audience',3,
    '6a000000-0000-4000-8000-000000000204','2026-08-11T12:22:00Z');
  if (replaced#>>'{invalidatedCursors}')::integer<>1 or (replaced#>>'{invalidatedWebhookJobs}')::integer<>1
     or replaced#>>'{binding,baseline_required}'<>'true' or replaced#>>'{binding,webhook_registration_required}'<>'true'
     or (select state from public.mailchimp_webhook_jobs where id=current_setting('omnix.test_queued_webhook_job')::uuid)<>'review' then
    raise exception 'audience replacement did not invalidate cursor/webhook authority';
  end if;
end $$;
select 'ok 25 - audience replacement cryptoshreds prior cursor and invalidates queued webhook work';

rollback;
