-- Story 4.3/4.4 HIGH remediation contract tests. Behavioral recovery and
-- converted-review paths are exercised by the updated 0017/0016 TAP suites.
begin;
select '1..8';

do $$ begin
  if to_regprocedure('public.start_twilio_real_number_uat_attempt(uuid,uuid,bigint,timestamptz)') is null
     or to_regprocedure('public.read_twilio_real_number_uat_authority(uuid,uuid,bigint,timestamptz)') is null
     or to_regprocedure('public.transition_twilio_real_number_uat_job(uuid,uuid,bigint,text,text,text,text,timestamptz,timestamptz)') is null
     or to_regprocedure('public.resolve_meta_enquiry_review(uuid,uuid,uuid,text,uuid,timestamptz)') is null then
    raise exception '0020 stable RPC signature is missing'; end if;
end $$;
select 'ok 1 - 0020 preserves all public RPC signatures';

do $$ begin
  if has_function_privilege('authenticated','public.start_twilio_real_number_uat_attempt(uuid,uuid,bigint,timestamptz)','EXECUTE')
     or has_function_privilege('authenticated','public.read_twilio_real_number_uat_authority(uuid,uuid,bigint,timestamptz)','EXECUTE')
     or has_function_privilege('authenticated','public.transition_twilio_real_number_uat_job(uuid,uuid,bigint,text,text,text,text,timestamptz,timestamptz)','EXECUTE')
     or not has_function_privilege('service_role','public.start_twilio_real_number_uat_attempt(uuid,uuid,bigint,timestamptz)','EXECUTE')
     or not has_function_privilege('service_role','public.read_twilio_real_number_uat_authority(uuid,uuid,bigint,timestamptz)','EXECUTE')
     or not has_function_privilege('service_role','public.transition_twilio_real_number_uat_job(uuid,uuid,bigint,text,text,text,text,timestamptz,timestamptz)','EXECUTE') then
    raise exception 'Twilio UAT execution authority drift'; end if;
end $$;
select 'ok 2 - Twilio UAT start/read/transition remain service-only';

do $$ declare definition text; begin
  definition:=lower(pg_get_functiondef('public.start_twilio_real_number_uat_attempt(uuid,uuid,bigint,timestamptz)'::regprocedure));
  if position('side_effect_started_at is null' in definition)=0
     or position('sequence_complete_at is not null' in definition)=0
     or position('provider_message_sid_hash' in definition)=0 then
    raise exception 'post-STOP start guard is incomplete'; end if;
end $$;
select 'ok 3 - start requires opt-in before side effect or complete same-job evidence plus bound SID after it';

do $$ declare definition text; begin
  definition:=lower(pg_get_functiondef('public.read_twilio_real_number_uat_authority(uuid,uuid,bigint,timestamptz)'::regprocedure));
  if position('evidencecomplete' in definition)=0 or position('lookup-only' in definition)=0
     or position('payloadenvelope' in definition)=0 or position('sequence_complete_at is not null' in definition)=0 then
    raise exception 'UAT read authority response/guard drift'; end if;
end $$;
select 'ok 4 - read adds evidenceComplete and preserves bound-SID lookup-only authority';

do $$ declare definition text; begin
  definition:=lower(pg_get_functiondef('public.transition_twilio_real_number_uat_job(uuid,uuid,bigint,text,text,text,text,timestamptz,timestamptz)'::regprocedure));
  if position('uat_sequence_pending' in definition)=0
     or position('uat_finalize_pending' in definition)=0
     or position('greatest(attempt_count-1,0)' in replace(definition,' ',''))=0
     or position('sequence_complete_at is null' in definition)=0
     or position('job.attempt_count<job.max_attempts' in replace(definition,' ',''))=0 then
    raise exception 'human-wait/provider-attempt budget separation drift'; end if;
end $$;
select 'ok 5 - uat_sequence_pending is retryable without replenishing other provider failure budgets';

do $$ begin
  if not has_function_privilege('authenticated','public.resolve_meta_enquiry_review(uuid,uuid,uuid,text,uuid,timestamptz)','EXECUTE')
     or has_function_privilege('anon','public.resolve_meta_enquiry_review(uuid,uuid,uuid,text,uuid,timestamptz)','EXECUTE')
     or has_function_privilege('service_role','public.resolve_meta_enquiry_review(uuid,uuid,uuid,text,uuid,timestamptz)','EXECUTE') then
    raise exception 'Meta review actor authority drift'; end if;
end $$;
select 'ok 6 - Meta review resolution remains authenticated-member RPC only';

do $$ declare definition text; begin
  definition:=lower(pg_get_functiondef('public.resolve_meta_enquiry_review(uuid,uuid,uuid,text,uuid,timestamptz)'::regprocedure));
  if position('target_incomplete.status=''converted''' in replace(definition,' ',''))=0
     or position('target_incomplete.converted_contact_id is distinct from target_contact.id' in definition)=0
     or position('conversion_was_preexisting:=true' in replace(definition,' ',''))=0 then
    raise exception 'pre-converted Meta review exact-target guard drift'; end if;
end $$;
select 'ok 7 - pre-converted Meta review accepts only its exact active target contact';

do $$ declare definition text; begin
  definition:=lower(pg_get_functiondef('public.resolve_meta_enquiry_review(uuid,uuid,uuid,text,uuid,timestamptz)'::regprocedure));
  if position('target_identity.contact_id is not null' in definition)=0
     or position('target_conversation.contact_id is not null' in definition)=0
     or position('target_event.state=''linked''' in replace(definition,' ',''))=0 then
    raise exception 'Meta review linkage/replay conflict guard drift'; end if;
end $$;
select 'ok 8 - Meta identity, conversation and linked replay remain conflict-safe';

rollback;
