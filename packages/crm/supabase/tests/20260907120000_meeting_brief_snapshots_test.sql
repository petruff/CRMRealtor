begin;
create extension if not exists pgtap with schema extensions;
select plan(15);
select ok(not has_table_privilege('authenticated','public.meeting_brief_snapshots','INSERT'),'direct inserts are denied');
select ok(not has_table_privilege('authenticated','public.meeting_brief_snapshots','UPDATE'),'snapshots cannot be rewritten');
select ok(not has_table_privilege('authenticated','public.meeting_brief_snapshots','DELETE'),'prior evidence cannot be deleted');
select ok(not has_function_privilege('anon','public.create_meeting_brief_snapshot(uuid,uuid,jsonb)','EXECUTE'),'anonymous generation is denied');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','10100000-0000-4000-8000-000000000001','authenticated','authenticated','brief-owner@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','10100000-0000-4000-8000-000000000002','authenticated','authenticated','brief-assistant@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','10100000-0000-4000-8000-000000000003','authenticated','authenticated','brief-other@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values('20100000-0000-4000-8000-000000000001','Brief workspace'),('20100000-0000-4000-8000-000000000002','Other brief workspace');
select set_config('omnix.actor_user_id','10100000-0000-4000-8000-000000000001',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('30100000-0000-4000-8000-000000000001','20100000-0000-4000-8000-000000000001','10100000-0000-4000-8000-000000000001','owner','active'),
 ('30100000-0000-4000-8000-000000000002','20100000-0000-4000-8000-000000000001','10100000-0000-4000-8000-000000000002','assistant','active'),
 ('30100000-0000-4000-8000-000000000003','20100000-0000-4000-8000-000000000002','10100000-0000-4000-8000-000000000003','owner','active');
insert into public.contacts(id,owner_id,workspace_id,first_name,last_name,source) values
 ('40100000-0000-4000-8000-000000000001','10100000-0000-4000-8000-000000000001','20100000-0000-4000-8000-000000000001','Avery','Buyer','referral');
insert into public.properties(id,workspace_id,address_line_1,city,state_code,postal_code,normalized_address_key,property_kind,lifecycle,current_version,created_by_membership_id,updated_by_membership_id,created_at,updated_at) values
 ('60100000-0000-4000-8000-000000000001','20100000-0000-4000-8000-000000000001','1 Test Street','Orlando','FL','32801','1 test street|orlando|fl|32801','single-family','off-market',1,'30100000-0000-4000-8000-000000000001','30100000-0000-4000-8000-000000000001','2026-09-07T12:00:00Z','2026-09-07T12:00:00Z');
insert into public.property_behavior_events(id,workspace_id,property_id,contact_id,behavior_type,source,source_reference,source_occurred_at,permission_state,idempotency_key,recorded_by_membership_id,created_at)
select ('70100000-0000-4000-8000-00000000000'||n)::uuid,'20100000-0000-4000-8000-000000000001','60100000-0000-4000-8000-000000000001','40100000-0000-4000-8000-000000000001','view','manual','fixture','2026-09-07T12:00:00Z',permission,'brief-behavior-'||n,'30100000-0000-4000-8000-000000000001','2026-09-07T12:00:00Z'
from (values(1,'allowed'),(2,'restricted'),(3,'revoked')) as permissions(n,permission);
select set_config('omnix.brief_fixture',$json${"id":"50100000-0000-4000-8000-000000000001","workspaceId":"20100000-0000-4000-8000-000000000001","createdByMembershipId":"30100000-0000-4000-8000-000000000002","subjectContactId":"40100000-0000-4000-8000-000000000001","version":1,"deterministicRuleVersion":"meeting-brief.rules.v1","modelState":"not-requested","citations":[],"sections":[],"sourceHashes":{},"createdAt":"2026-09-07T12:00:00Z","expiresAt":"2026-09-07T12:15:00Z"}$json$,true);
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','10100000-0000-4000-8000-000000000002',true);
select lives_ok($$select public.create_meeting_brief_snapshot('20100000-0000-4000-8000-000000000001','30100000-0000-4000-8000-000000000002',current_setting('omnix.brief_fixture')::jsonb)$$,'active assistant can create a scoped brief');
select is((select count(*) from public.meeting_brief_snapshots),1::bigint,'assistant reads the saved snapshot');
select set_config('request.jwt.claim.sub','10100000-0000-4000-8000-000000000001',true);
select is((select count(*) from public.meeting_brief_snapshots),1::bigint,'owner reads assistant evidence');
select set_config('request.jwt.claim.sub','10100000-0000-4000-8000-000000000003',true);
select is((select count(*) from public.meeting_brief_snapshots),0::bigint,'another workspace cannot read the snapshot');
select throws_ok($$select public.create_meeting_brief_snapshot('20100000-0000-4000-8000-000000000001','30100000-0000-4000-8000-000000000002',current_setting('omnix.brief_fixture')::jsonb)$$,'42501',null,'another actor cannot borrow assistant authority');
select set_config('request.jwt.claim.sub','10100000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.create_meeting_brief_snapshot('20100000-0000-4000-8000-000000000001','30100000-0000-4000-8000-000000000002',jsonb_set(current_setting('omnix.brief_fixture')::jsonb,'{workspaceId}','"20100000-0000-4000-8000-000000000002"'))$$,'22023','Invalid meeting brief snapshot','snapshot cannot override membership workspace');
select throws_ok($$select public.create_meeting_brief_snapshot('20100000-0000-4000-8000-000000000001','30100000-0000-4000-8000-000000000002',jsonb_set(current_setting('omnix.brief_fixture')::jsonb,'{citations}','[{"recordId":"40100000-0000-4000-8000-000000000001","sourceType":"contact","href":"javascript:alert(1)"}]'))$$,'22023','Invalid brief evidence route','unsafe citation navigation is denied');
select throws_ok($$select public.create_meeting_brief_snapshot('20100000-0000-4000-8000-000000000001','30100000-0000-4000-8000-000000000002',jsonb_set(current_setting('omnix.brief_fixture')::jsonb,'{citations}','[{"recordId":"40100000-0000-4000-8000-000000000099","sourceType":"contact","href":"/contacts/40100000-0000-4000-8000-000000000099"}]'))$$,'P0002','Brief evidence unavailable','unrelated source references are denied');
select lives_ok($$select public.create_meeting_brief_snapshot('20100000-0000-4000-8000-000000000001','30100000-0000-4000-8000-000000000002',jsonb_set(jsonb_set(current_setting('omnix.brief_fixture')::jsonb,'{id}','"50100000-0000-4000-8000-000000000002"'),'{citations}','[{"recordId":"70100000-0000-4000-8000-000000000001","sourceType":"property-behavior","href":"/properties"}]'))$$,'permitted property behavior can be cited');
select throws_ok($$select public.create_meeting_brief_snapshot('20100000-0000-4000-8000-000000000001','30100000-0000-4000-8000-000000000002',jsonb_set(current_setting('omnix.brief_fixture')::jsonb,'{citations}','[{"recordId":"70100000-0000-4000-8000-000000000002","sourceType":"property-behavior","href":"/properties"}]'))$$,'P0002','Brief evidence unavailable','restricted property behavior cannot be cited');
select throws_ok($$select public.create_meeting_brief_snapshot('20100000-0000-4000-8000-000000000001','30100000-0000-4000-8000-000000000002',jsonb_set(current_setting('omnix.brief_fixture')::jsonb,'{citations}','[{"recordId":"70100000-0000-4000-8000-000000000003","sourceType":"property-behavior","href":"/properties"}]'))$$,'P0002','Brief evidence unavailable','revoked property behavior cannot be cited');
select * from finish();
rollback;
