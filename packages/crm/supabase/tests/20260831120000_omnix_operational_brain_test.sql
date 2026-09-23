begin;
select '1..10';

do $$ begin
  if has_table_privilege('authenticated','public.omnix_action_proposals','INSERT')
     or has_table_privilege('authenticated','public.omnix_action_proposal_versions','UPDATE')
     or not has_function_privilege('authenticated','public.create_omnix_action_proposal(uuid,uuid,uuid,uuid,omnix_proposal_kind,omnix_proposal_origin,omnix_approval_mode,attention_priority,integer,jsonb,text,text,jsonb,text,jsonb,timestamp with time zone,timestamp with time zone,uuid,uuid,text,timestamp with time zone)','EXECUTE')
     or not has_function_privilege('authenticated','public.decide_omnix_action_proposal(uuid,uuid,integer,text,uuid,text,timestamp with time zone)','EXECUTE') then
    raise exception 'Omnix proposal grants are unsafe';
  end if;
end $$;
select 'ok 1 - proposal writes are RPC-only and version evidence is protected';

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','61000000-0000-4000-8000-000000000001','authenticated','authenticated','owner-61@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','61000000-0000-4000-8000-000000000002','authenticated','authenticated','assistant-61@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','61000000-0000-4000-8000-000000000003','authenticated','authenticated','other-61@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values
 ('62000000-0000-4000-8000-000000000001','Operational brain workspace'),
 ('62000000-0000-4000-8000-000000000002','Other workspace');
select set_config('omnix.actor_user_id','61000000-0000-4000-8000-000000000001',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('63000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','owner','active'),
 ('63000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002','assistant','active'),
 ('63000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000003','owner','active');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',true);
do $$ declare result jsonb; begin
  result:=public.create_omnix_action_proposal(
    '62000000-0000-4000-8000-000000000001',null,null,null,'task-create','deterministic','owner','p1',515000,
    '{"urgency":80,"leadTemperature":"hot","daysOverdue":3,"awaitingReply":false,"potentialValueCents":0}',
    'Create follow-up','The next touch is overdue.','{"title":"Follow up","dueAt":"2026-09-01T15:00:00.000Z"}',
    repeat('a',64),'[{"entityType":"workspace","recordId":"62000000-0000-4000-8000-000000000001","factKeys":["attentionQueue"],"href":"/alerts"}]',
    '2026-09-01T15:00:00Z','2026-09-07T12:00:00Z','63000000-0000-4000-8000-000000000002',
    '64000000-0000-4000-8000-000000000001','proposal:61:owner','2026-08-31T12:00:00Z');
  if result->>'proposalId' is null or result->>'noOp'<>'false' then raise exception 'proposal was not created: %',result; end if;
  perform set_config('omnix.proposal_id',result->>'proposalId',true);
end $$;
select 'ok 2 - an active assistant can create a cited proposal for review';

do $$ declare result jsonb; begin
  result:=public.create_omnix_action_proposal(
    '62000000-0000-4000-8000-000000000001',null,null,null,'task-create','deterministic','owner','p1',515000,
    '{"urgency":80,"leadTemperature":"hot","daysOverdue":3,"awaitingReply":false,"potentialValueCents":0}',
    'Create follow-up','The next touch is overdue.','{"title":"Follow up","dueAt":"2026-09-01T15:00:00.000Z"}',
    repeat('a',64),'[{"entityType":"workspace","recordId":"62000000-0000-4000-8000-000000000001","factKeys":["attentionQueue"],"href":"/alerts"}]',
    '2026-09-01T15:00:00Z','2026-09-07T12:00:00Z','63000000-0000-4000-8000-000000000002',
    '64000000-0000-4000-8000-000000000001','proposal:61:owner','2026-08-31T12:00:00Z');
  if result->>'noOp'<>'true' then raise exception 'idempotent proposal replay failed: %',result; end if;
end $$;
select 'ok 3 - proposal creation is idempotent';

do $$ begin
  begin
    perform public.create_omnix_action_proposal(
      '62000000-0000-4000-8000-000000000002',null,null,null,'task-create','deterministic','active-member','p3',100000,
      '{"urgency":25,"leadTemperature":"unknown","daysOverdue":0,"awaitingReply":false,"potentialValueCents":0}',
      'Cross workspace','Must fail.','{}',repeat('b',64),'[{"entityType":"workspace","recordId":"x","factKeys":["x"],"href":"/"}]',
      null,'2026-09-07T12:00:00Z','63000000-0000-4000-8000-000000000002',gen_random_uuid(),'proposal:61:cross','2026-08-31T12:00:00Z');
    raise exception 'cross-workspace proposal succeeded';
  exception when insufficient_privilege then null; end;
end $$;
select 'ok 4 - proposal creation refuses cross-workspace membership authority';

do $$ begin
  begin
    perform public.decide_omnix_action_proposal(
      '62000000-0000-4000-8000-000000000001',current_setting('omnix.proposal_id')::uuid,1,'approve',
      '63000000-0000-4000-8000-000000000002','decision:61:assistant','2026-08-31T13:00:00Z');
    raise exception 'assistant approved owner-only proposal';
  exception when insufficient_privilege then null; end;
end $$;
select 'ok 5 - owner-only proposals reject assistant approval';

select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
do $$ declare result jsonb; begin
  result:=public.decide_omnix_action_proposal(
    '62000000-0000-4000-8000-000000000001',current_setting('omnix.proposal_id')::uuid,1,'approve',
    '63000000-0000-4000-8000-000000000001','decision:61:owner','2026-08-31T13:01:00Z');
  if result->>'state'<>'approved' then raise exception 'owner approval failed: %',result; end if;
end $$;
select 'ok 6 - the owner can approve the exact current version';

select public.transition_omnix_proposal_execution(
  '62000000-0000-4000-8000-000000000001',current_setting('omnix.proposal_id')::uuid,
  'approved','executing','63000000-0000-4000-8000-000000000001',null,null,'execution:61:claim','2026-08-31T13:02:00Z');
select public.transition_omnix_proposal_execution(
  '62000000-0000-4000-8000-000000000001',current_setting('omnix.proposal_id')::uuid,
  'executing','executed','63000000-0000-4000-8000-000000000001','task:61000000-0000-4000-8000-000000000099',null,
  'execution:61:complete','2026-08-31T13:03:00Z');
do $$ begin
  if not exists(select 1 from public.omnix_action_proposals where id=current_setting('omnix.proposal_id')::uuid
    and state='executed' and execution_reference like 'task:%' and executed_at is not null) then
    raise exception 'terminal execution receipt is missing';
  end if;
end $$;
select 'ok 7 - approved execution records claim and terminal receipt';

do $$ begin
  begin
    update public.omnix_action_proposal_versions set payload='{}' where proposal_id=current_setting('omnix.proposal_id')::uuid;
    raise exception 'proposal version was mutable';
  exception when check_violation or insufficient_privilege then null; end;
end $$;
select 'ok 8 - proposal versions are append-only';

select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000003',true);
do $$ declare visible integer; begin
  select count(*) into visible from public.omnix_action_proposals where workspace_id='62000000-0000-4000-8000-000000000001';
  if visible<>0 then raise exception 'RLS leaked another workspace proposal'; end if;
end $$;
select 'ok 9 - proposal RLS isolates workspaces';

reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare result jsonb; begin
  result:=public.create_omnix_action_proposal(
    '62000000-0000-4000-8000-000000000001',null,null,null,'task-create','deterministic','active-member','p3',120000,
    '{"urgency":30,"leadTemperature":"unknown","daysOverdue":0,"awaitingReply":false,"potentialValueCents":0}',
    'Scheduled proposal','Created by the governed scheduler.','{}',repeat('c',64),
    '[{"entityType":"workspace","recordId":"62000000-0000-4000-8000-000000000001","factKeys":["scheduler"],"href":"/approvals"}]',
    null,'2026-09-07T12:00:00Z',null,gen_random_uuid(),'proposal:61:system','2026-08-31T12:00:00Z');
  if result->>'proposalId' is null then raise exception 'system proposal failed: %',result; end if;
end $$;
select 'ok 10 - service-only scheduler authority can create unattributed system proposals';

rollback;
