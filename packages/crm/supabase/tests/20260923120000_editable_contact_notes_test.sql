begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

select has_table('public','note_revisions','note revisions preserve replaced text');
select has_column('public','notes','revision','notes expose an optimistic-concurrency revision');
select ok(not has_table_privilege('authenticated','public.notes','UPDATE'),'note bodies still cannot be updated directly');
select ok(not has_table_privilege('authenticated','public.note_revisions','INSERT'),'revisions are written only by the edit RPC');
select ok(has_function_privilege('authenticated','public.edit_contact_note(uuid,integer,text,uuid,timestamptz)','EXECUTE'),'members can call the edit RPC');
select ok(not has_function_privilege('anon','public.edit_contact_note(uuid,integer,text,uuid,timestamptz)','EXECUTE'),'anonymous clients cannot edit notes');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','19230000-0000-4000-8000-000000000001','authenticated','authenticated','notes-owner@omnix.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','19230000-0000-4000-8000-000000000002','authenticated','authenticated','notes-outsider@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values
('29230000-0000-4000-8000-000000000001','Editable notes'),
('29230000-0000-4000-8000-000000000002','Other workspace');
select set_config('omnix.actor_user_id','19230000-0000-4000-8000-000000000001',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
('39230000-0000-4000-8000-000000000001','29230000-0000-4000-8000-000000000001','19230000-0000-4000-8000-000000000001','owner','active');
select set_config('omnix.actor_user_id','19230000-0000-4000-8000-000000000002',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
('39230000-0000-4000-8000-000000000002','29230000-0000-4000-8000-000000000002','19230000-0000-4000-8000-000000000002','owner','active');
insert into public.contacts(id,workspace_id,owner_id,first_name,last_name,lead_type,relationship,intent,source,pipeline_stage,tags)
values('49230000-0000-4000-8000-000000000001','29230000-0000-4000-8000-000000000001','19230000-0000-4000-8000-000000000001','Judith','Notes','hot','lead','unknown','other','new','{}');
insert into public.notes(id,contact_id,workspace_id,owner_id,body,created_at) values
('59230000-0000-4000-8000-000000000001','49230000-0000-4000-8000-000000000001','29230000-0000-4000-8000-000000000001','19230000-0000-4000-8000-000000000001','Wants 3 beds','2026-09-01T10:00:00Z'),
('59230000-0000-4000-8000-000000000002','49230000-0000-4000-8000-000000000001','29230000-0000-4000-8000-000000000001','19230000-0000-4000-8000-000000000001','Untouched legacy note','2026-09-02T10:00:00Z'),
('59230000-0000-4000-8000-000000000003','49230000-0000-4000-8000-000000000001','29230000-0000-4000-8000-000000000001','19230000-0000-4000-8000-000000000001','Will be archived','2026-09-03T10:00:00Z');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','19230000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.edit_contact_note('59230000-0000-4000-8000-000000000001',1,E'Wants 4 beds\nNear the park','69230000-0000-4000-8000-000000000001','2026-09-23T12:00:00Z')$$,'owner edits an active note');
reset role;
select is((select body from public.notes where id='59230000-0000-4000-8000-000000000001'),E'Wants 4 beds\nNear the park','edit replaces the body and keeps line breaks');
select is((select revision::text||'|'||created_at::text||'|'||updated_at::text||'|'||edited_by_membership_id::text from public.notes where id='59230000-0000-4000-8000-000000000001'),
  '2|2026-09-01 10:00:00+00|2026-09-23 12:00:00+00|39230000-0000-4000-8000-000000000001','same note keeps created_at and records editor metadata');
select is((select count(*)::integer from public.notes where contact_id='49230000-0000-4000-8000-000000000001'),3,'editing never creates a duplicate note');
select is((select body||'|'||revision from public.note_revisions where note_id='59230000-0000-4000-8000-000000000001'),'Wants 3 beds|1','the replaced text is preserved as revision 1');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','19230000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.edit_contact_note('59230000-0000-4000-8000-000000000001',1,'Stale tab overwrite','69230000-0000-4000-8000-000000000002','2026-09-23T12:05:00Z')$$,'40001',null,'a stale revision is rejected instead of overwriting');
select is((select (public.edit_contact_note('59230000-0000-4000-8000-000000000001',1,E'Wants 4 beds\nNear the park','69230000-0000-4000-8000-000000000001','2026-09-23T12:00:00Z')->>'noOp')),'true','a replayed submission is idempotent');
select throws_ok($$select public.edit_contact_note('59230000-0000-4000-8000-000000000001',2,E'  \n ','69230000-0000-4000-8000-000000000003','2026-09-23T12:06:00Z')$$,'22023',null,'blank bodies are rejected');
select lives_ok($$select public.archive_contact_note('59230000-0000-4000-8000-000000000003','Outdated context','69230000-0000-4000-8000-000000000004','2026-09-23T12:07:00Z')$$,'archive still works on the new columns');
select throws_ok($$select public.edit_contact_note('59230000-0000-4000-8000-000000000003',1,'Edit archived','69230000-0000-4000-8000-000000000005','2026-09-23T12:08:00Z')$$,'55000',null,'archived notes stay read only');
select set_config('request.jwt.claim.sub','19230000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.edit_contact_note('59230000-0000-4000-8000-000000000002',1,'Cross-workspace edit','69230000-0000-4000-8000-000000000006','2026-09-23T12:09:00Z')$$,'42501',null,'members of another workspace cannot edit');
select is((select count(*)::integer from public.note_revisions),0,'other workspaces cannot read revisions');
reset role;

select is((select revision::text||'|'||coalesce(updated_at::text,'none')||'|'||body from public.notes where id='59230000-0000-4000-8000-000000000002'),'1|none|Untouched legacy note','notes without edit metadata keep working');
select is((select count(*)::integer from public.note_revisions),1,'failed and replayed edits add no revisions');
select throws_ok($$update public.notes set body='Silent rewrite' where id='59230000-0000-4000-8000-000000000002'$$,'23514',null,'a body change without a preserved revision is blocked even for privileged roles');
select throws_ok($$update public.note_revisions set body='Rewritten history'$$,'55000',null,'revision evidence is append-only');

select * from finish();
rollback;
