begin;
select '1..11';

do $$ begin
  if not has_function_privilege('authenticated',
      'public.create_mailchimp_campaign_draft(uuid,text,text,text,text,text,text,text,text,text,text,uuid,timestamptz)','EXECUTE')
     or not has_function_privilege('authenticated',
      'public.approve_mailchimp_campaign_action(uuid,integer,text,text,text,uuid,timestamptz)','EXECUTE')
     or not has_function_privilege('authenticated',
      'public.update_mailchimp_campaign_draft(uuid,integer,text,text,text,text,text,text,text,text,text,text,uuid,timestamptz)','EXECUTE')
     or has_function_privilege('authenticated',
      'public.claim_mailchimp_campaign_execution(uuid,text,uuid,timestamptz)','EXECUTE')
     or has_function_privilege('authenticated',
      'public.record_mailchimp_campaign_provider_result(uuid,text,text,text,text,text,text,uuid,uuid,timestamptz)','EXECUTE')
     or has_table_privilege('authenticated','public.mailchimp_campaigns','INSERT') then
    raise exception 'campaign grants are unsafe';
  end if;
end $$;
select 'ok 1 - campaign mutations are RPC-only and provider settlement is service-only';

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','41000000-0000-4000-8000-000000000001','authenticated','authenticated','owner-45@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','41000000-0000-4000-8000-000000000002','authenticated','authenticated','assistant-45@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values('42000000-0000-4000-8000-000000000001','Campaign workspace');
select set_config('omnix.actor_user_id','41000000-0000-4000-8000-000000000001',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('43000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','owner','active'),
 ('43000000-0000-4000-8000-000000000002','42000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000002','assistant','active');
insert into public.connector_connections(id,workspace_id,provider,provider_account_key_hash,display_label,status,granted_scopes,remote_identity_summary,created_by_membership_id,created_at,updated_at)
 values('44000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000001','mailchimp',repeat('a',64),'Mailchimp','active',array['audience.sync'],'{"dataCenter":"us21"}','43000000-0000-4000-8000-000000000001',now(),now());
insert into public.mailchimp_audience_bindings(id,workspace_id,connection_id,account_id_hash,data_center,audience_external_id,audience_name,mapping_version,baseline_required,webhook_registration_required,selected_by_membership_id,selection_correlation_id,selected_at)
 values('45000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001',repeat('a',64),'us21','audience-a','Judith Realtor',1,false,false,'43000000-0000-4000-8000-000000000001',gen_random_uuid(),now());
insert into public.contacts(id,owner_id,workspace_id,first_name,last_name,email,email_subscribed,lead_type,relationship,intent,source,pipeline_stage,tags,created_at,updated_at) values
 ('46000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000001','Eligible','Person','eligible-45@example.com',true,'hot','lead','buyer','website','new','{}',now(),now()),
 ('46000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000001','Unsubscribed','Person','unsub-45@example.com',false,'warm','lead','seller','website','new','{}',now(),now());
insert into public.mailchimp_member_links(id,workspace_id,connection_id,binding_id,contact_id,contact_point_id,subscriber_hash,member_external_id,created_at,updated_at)
select '47000000-0000-4000-8000-000000000001'::uuid,point.workspace_id,'44000000-0000-4000-8000-000000000001'::uuid,'45000000-0000-4000-8000-000000000001'::uuid,point.contact_id,point.id,encode(extensions.digest(pg_catalog.convert_to(point.normalized_value,'UTF8'),'md5'),'hex'),'member-eligible',now(),now()
from public.contact_points point where point.contact_id='46000000-0000-4000-8000-000000000001' and point.type='email'
union all
select '47000000-0000-4000-8000-000000000002'::uuid,point.workspace_id,'44000000-0000-4000-8000-000000000001'::uuid,'45000000-0000-4000-8000-000000000001'::uuid,point.contact_id,point.id,encode(extensions.digest(pg_catalog.convert_to(point.normalized_value,'UTF8'),'md5'),'hex'),'member-unsub',now(),now()
from public.contact_points point where point.contact_id='46000000-0000-4000-8000-000000000002' and point.type='email';
insert into public.mailchimp_subscription_authority(id,workspace_id,connection_id,binding_id,member_link_id,provider_status,provider_unsubscribed_at,resubscribe_requires_consent,last_provider_event_id_hash,last_occurred_at) values
 ('48000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001','45000000-0000-4000-8000-000000000001','47000000-0000-4000-8000-000000000001','subscribed',null,false,repeat('1',64),now()),
 ('48000000-0000-4000-8000-000000000002','42000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001','45000000-0000-4000-8000-000000000001','47000000-0000-4000-8000-000000000002','unsubscribed',now(),true,repeat('2',64),now());

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','41000000-0000-4000-8000-000000000002',true);
do $$ declare result jsonb; begin
 perform set_config('omnix.campaign_correlation',gen_random_uuid()::text,true);
 result:=public.create_mailchimp_campaign_draft('44000000-0000-4000-8000-000000000001','all-subscribers',null,'September','Market update','Local news','Judith','judith@example.com','<p>Hello</p>','Hello',repeat('3',64),current_setting('omnix.campaign_correlation')::uuid,now());
 perform set_config('omnix.campaign_id',result#>>'{campaign,id}',true);
 perform set_config('omnix.campaign_hash',result#>>'{campaign,recipient_snapshot_hash}',true);
 result:=public.create_mailchimp_campaign_draft('44000000-0000-4000-8000-000000000001','all-subscribers',null,'September','Market update','Local news','Judith','judith@example.com','<p>Hello</p>','Hello',repeat('3',64),current_setting('omnix.campaign_correlation')::uuid,now());
 if result#>>'{campaign,eligible_count}'<>'1' or result#>>'{campaign,exclusion_counts,unsubscribed}'<>'1' or result::text ~* 'eligible-45@example.com' then raise exception 'preview failed: %',result; end if;
 if (select count(*) from public.mailchimp_campaigns where workspace_id='42000000-0000-4000-8000-000000000001')<>1 then raise exception 'draft retry duplicated campaign'; end if;
end $$;
select 'ok 2 - assistant can prepare a redacted count-only campaign draft';

do $$ declare result jsonb; begin
 perform set_config('omnix.revision_correlation',gen_random_uuid()::text,true);
 result:=public.update_mailchimp_campaign_draft(current_setting('omnix.campaign_id')::uuid,1,
  'all-subscribers',null,'September revised','Revised market update','Revised local news','Judith',
  'judith@example.com','<p>Revised</p>','Revised',repeat('6',64),current_setting('omnix.revision_correlation')::uuid,now());
 perform set_config('omnix.campaign_hash',result#>>'{campaign,recipient_snapshot_hash}',true);
 if result#>>'{campaign,version}'<>'2' or result#>>'{campaign,content_hash}'<>repeat('6',64)
    or result#>>'{campaign,subject}'<>'Revised market update' then raise exception 'revision failed: %',result; end if;
 result:=public.update_mailchimp_campaign_draft(current_setting('omnix.campaign_id')::uuid,1,
  'all-subscribers',null,'September revised','Revised market update','Revised local news','Judith',
  'judith@example.com','<p>Revised</p>','Revised',repeat('6',64),current_setting('omnix.revision_correlation')::uuid,now());
 if result#>>'{campaign,version}'<>'2' then raise exception 'revision retry was not idempotent'; end if;
end $$;
select 'ok 3 - assistant can revise a draft and refresh its exact versioned snapshot';

do $$ begin
 begin
  perform public.approve_mailchimp_campaign_action(current_setting('omnix.campaign_id')::uuid,2,'create',repeat('6',64),current_setting('omnix.campaign_hash'),gen_random_uuid(),now());
  raise exception 'assistant approved campaign';
 exception when insufficient_privilege then null; end;
end $$;
select 'ok 4 - assistant cannot approve provider creation or send';

select set_config('request.jwt.claim.sub','41000000-0000-4000-8000-000000000001',true);
reset role;
update public.mailchimp_subscription_authority set provider_status='unsubscribed',provider_unsubscribed_at=now(),resubscribe_requires_consent=true where id='48000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','41000000-0000-4000-8000-000000000001',true);
do $$ begin
 begin
  perform public.approve_mailchimp_campaign_action(current_setting('omnix.campaign_id')::uuid,2,'create',repeat('6',64),current_setting('omnix.campaign_hash'),gen_random_uuid(),now());
  raise exception 'drifted audience approved';
 exception when serialization_failure then null; end;
end $$;
select 'ok 5 - owner approval fails closed when subscriptions drift';

reset role;
select set_config('omnix.mailchimp_explicit_resubscribe','on',true);
update public.mailchimp_subscription_authority set provider_status='subscribed',provider_unsubscribed_at=null,resubscribe_requires_consent=false where id='48000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','41000000-0000-4000-8000-000000000001',true);
do $$ declare result jsonb; begin
 result:=public.approve_mailchimp_campaign_action(current_setting('omnix.campaign_id')::uuid,2,'create',repeat('6',64),current_setting('omnix.campaign_hash'),gen_random_uuid(),now());
 if result#>>'{campaign,state}'<>'create_approved' then raise exception 'create approval failed'; end if;
end $$;
select 'ok 6 - owner approves the exact immutable create snapshot';

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('omnix.execution_token',gen_random_uuid()::text,true);
do $$ begin
 perform public.claim_mailchimp_campaign_execution(current_setting('omnix.campaign_id')::uuid,'create',current_setting('omnix.execution_token')::uuid,now());
 begin
  perform public.claim_mailchimp_campaign_execution(current_setting('omnix.campaign_id')::uuid,'create',gen_random_uuid(),now());
  raise exception 'concurrent execution was claimed';
 exception when serialization_failure then null; end;
end $$;
select 'ok 7 - one active execution lease prevents concurrent provider calls';

do $$ declare result jsonb; begin
 result:=public.record_mailchimp_campaign_provider_result(current_setting('omnix.campaign_id')::uuid,'create','unknown','provider-45',null,'provider_retryable',repeat('4',64),gen_random_uuid(),current_setting('omnix.execution_token')::uuid,now());
 if result#>>'{campaign,state}'<>'create_approved' or result#>>'{campaign,remote_campaign_id}'<>'provider-45' then raise exception 'unknown create was not recoverable'; end if;
end $$;
select 'ok 8 - ambiguous provider creation remains approved and recoverable without duplicate execution';

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('omnix.execution_token',gen_random_uuid()::text,true);
select public.claim_mailchimp_campaign_execution(current_setting('omnix.campaign_id')::uuid,'create',current_setting('omnix.execution_token')::uuid,now());
do $$ declare result jsonb; begin
 result:=public.record_mailchimp_campaign_provider_result(current_setting('omnix.campaign_id')::uuid,'create','succeeded','provider-45','save',null,repeat('4',64),gen_random_uuid(),current_setting('omnix.execution_token')::uuid,now());
 if result#>>'{campaign,state}'<>'created' then raise exception 'provider create settlement failed'; end if;
end $$;
select 'ok 9 - service receipt records confirmed provider draft creation';

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','41000000-0000-4000-8000-000000000001',true);
do $$ declare result jsonb; begin
 result:=public.approve_mailchimp_campaign_action(current_setting('omnix.campaign_id')::uuid,2,'send',repeat('6',64),current_setting('omnix.campaign_hash'),gen_random_uuid(),now());
 if result#>>'{campaign,state}'<>'send_approved' then raise exception 'send approval failed'; end if;
end $$;
select 'ok 10 - sending requires a second exact owner approval';

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('omnix.execution_token',gen_random_uuid()::text,true);
select public.claim_mailchimp_campaign_execution(current_setting('omnix.campaign_id')::uuid,'send',current_setting('omnix.execution_token')::uuid,now());
do $$ declare result jsonb; begin
 result:=public.record_mailchimp_campaign_provider_result(current_setting('omnix.campaign_id')::uuid,'send','succeeded','provider-45','sent',null,repeat('5',64),gen_random_uuid(),current_setting('omnix.execution_token')::uuid,now());
 if result#>>'{campaign,state}'<>'sent' or (select count(*) from public.mailchimp_campaign_approvals where campaign_id=current_setting('omnix.campaign_id')::uuid)<>2 then raise exception 'send settlement failed'; end if;
end $$;
select 'ok 11 - confirmed send is durable with two separate approvals and receipts';
rollback;
