begin;
select '1..8';

do $$ begin
  if not has_function_privilege('authenticated','public.reserve_omnix_ai_budget(uuid,uuid,uuid,text,integer,integer,integer)','EXECUTE')
     or not has_function_privilege('authenticated','public.finalize_omnix_ai_budget(uuid,uuid,uuid,text,integer,integer,integer,text)','EXECUTE')
     or has_function_privilege('authenticated','public.read_workspace_ai_runtime_envelope(uuid,uuid,uuid)','EXECUTE')
     or not has_function_privilege('service_role','public.read_workspace_ai_runtime_envelope(uuid,uuid,uuid)','EXECUTE')
     or has_table_privilege('authenticated','public.omnix_ai_runs','INSERT') then
    raise exception 'Omnix AI grants are unsafe';
  end if;
end $$;
select 'ok 1 - model budgets are RPC-only and secret runtime access is service-only';

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','51000000-0000-4000-8000-000000000001','authenticated','authenticated','owner-51@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','51000000-0000-4000-8000-000000000002','authenticated','authenticated','assistant-51@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values
 ('52000000-0000-4000-8000-000000000001','AI workspace'),
 ('52000000-0000-4000-8000-000000000002','Other workspace');
select set_config('omnix.actor_user_id','51000000-0000-4000-8000-000000000001',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('53000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','owner','active'),
 ('53000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002','assistant','active'),
 ('53000000-0000-4000-8000-000000000003','52000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000001','owner','active');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000002',true);
do $$ declare result jsonb; begin
  result:=public.reserve_omnix_ai_budget(
    '52000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000002',
    '54000000-0000-4000-8000-000000000001','omnix-ai-policy.v1',2000,10000,1000000);
  if result->>'allowed'<>'true' or result->>'reservation_id' is null then raise exception 'assistant reservation failed: %',result; end if;
  perform set_config('omnix.ai_reservation_id',result->>'reservation_id',true);
end $$;
select 'ok 2 - an active assistant can reserve one bounded model run';

do $$ begin
  begin
    perform public.reserve_omnix_ai_budget(
      '52000000-0000-4000-8000-000000000002','53000000-0000-4000-8000-000000000002',
      gen_random_uuid(),'omnix-ai-policy.v1',2000,10000,1000000);
    raise exception 'cross-workspace budget reserved';
  exception when insufficient_privilege then null; end;
end $$;
select 'ok 3 - cross-workspace budget reservation is refused';

do $$ begin
  begin
    perform public.reserve_omnix_ai_budget(
      '52000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000002',
      gen_random_uuid(),'omnix-ai-policy.v1',2000,9999,1000000);
    raise exception 'caller changed policy ceilings';
  exception when invalid_parameter_value then null; end;
end $$;
select 'ok 4 - caller cannot weaken or expand the versioned policy';

select public.finalize_omnix_ai_budget(
  '52000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000002',
  current_setting('omnix.ai_reservation_id')::uuid,'succeeded',420,90,351,null);
do $$ begin
  if not exists(select 1 from public.omnix_ai_runs where id=current_setting('omnix.ai_reservation_id')::uuid
    and state='succeeded' and actual_microusd=351 and input_tokens=420 and output_tokens=90 and error_category is null)
  then raise exception 'terminal receipt missing'; end if;
end $$;
select 'ok 5 - successful usage is finalized as a redacted token and cost receipt';

do $$ begin
  begin
    perform public.finalize_omnix_ai_budget(
      '52000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000002',
      current_setting('omnix.ai_reservation_id')::uuid,'failed',420,0,126,'provider-failed');
    raise exception 'run finalized twice';
  exception when serialization_failure then null; end;
end $$;
select 'ok 6 - a model run can be finalized only once';

reset role;
update public.omnix_ai_usage_windows set committed_microusd=999500
where workspace_id='52000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000002',true);
do $$ declare result jsonb; begin
  result:=public.reserve_omnix_ai_budget(
    '52000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000002',
    gen_random_uuid(),'omnix-ai-policy.v1',1000,10000,1000000);
  if result<>jsonb_build_object('allowed',false,'reason','exhausted') then raise exception 'daily ceiling failed: %',result; end if;
end $$;
select 'ok 7 - workspace daily budget stops before provider dispatch';

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare result jsonb; begin
  result:=public.read_workspace_ai_runtime_envelope(
    '52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002','53000000-0000-4000-8000-000000000002');
  if result is not null then raise exception 'unexpected runtime configuration'; end if;
  begin
    perform public.read_workspace_ai_runtime_envelope(
      '52000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000002','53000000-0000-4000-8000-000000000002');
    raise exception 'service read crossed workspace identity';
  exception when insufficient_privilege then null; end;
end $$;
select 'ok 8 - runtime credential reads require an exact active member identity';

rollback;
