-- Remove unused PL/pgSQL validation variables without changing function behavior.

begin;

create temporary table function_lint_fragments (
  sequence bigint generated always as identity primary key,
  target_signature text not null,
  old_fragment text not null,
  new_fragment text not null
) on commit drop;

create function pg_temp.replace_function_fragment(
  target_signature text,
  old_fragment text,
  new_fragment text
) returns void language plpgsql as $$
begin
  if to_regprocedure(target_signature) is null then
    raise exception 'lint cleanup target is missing: %', target_signature;
  end if;
  insert into function_lint_fragments(target_signature,old_fragment,new_fragment)
  values(target_signature,old_fragment,new_fragment);
end;
$$;

create function pg_temp.apply_function_fragment_queue()
returns void language plpgsql as $$
declare
  target record;
  fragment record;
  definition text;
begin
  for target in select distinct target_signature from function_lint_fragments loop
    select pg_get_functiondef(to_regprocedure(target.target_signature)) into definition;
    for fragment in
      select * from function_lint_fragments
      where target_signature=target.target_signature order by sequence
    loop
      if position(fragment.old_fragment in definition) > 0 then
        definition:=replace(definition,fragment.old_fragment,fragment.new_fragment);
      elsif position(fragment.new_fragment in definition) = 0 then
        raise exception 'lint cleanup fragment drifted for %', target.target_signature;
      end if;
    end loop;
    execute definition;
  end loop;
end;
$$;

select pg_temp.replace_function_fragment(
  'public.is_valid_contact_conversion_payload(jsonb,boolean)',
  E'  parsed_uuid uuid;\n  parsed_timestamp timestamptz;',
  ''
);
select pg_temp.replace_function_fragment(
  'public.is_valid_contact_conversion_payload(jsonb,boolean)',
  '    parsed_uuid := (target->>''referredById'')::uuid;',
  '    perform (target->>''referredById'')::uuid;'
);
select pg_temp.replace_function_fragment(
  'public.is_valid_contact_conversion_payload(jsonb,boolean)',
  '    parsed_timestamp := (target->>''lastContactedAt'')::timestamptz;',
  '    perform (target->>''lastContactedAt'')::timestamptz;'
);
select pg_temp.replace_function_fragment(
  'public.is_valid_incomplete_conversion_plan(jsonb)',
  E'  matched_contact_id uuid;\n',
  ''
);
select pg_temp.replace_function_fragment(
  'public.is_valid_incomplete_conversion_plan(jsonb)',
  '    matched_contact_id := (target->>''matchedContactId'')::uuid;',
  '    perform (target->>''matchedContactId'')::uuid;'
);

select pg_temp.replace_function_fragment(
  'public.create_connector_action_intent(uuid,text,text,uuid,text,uuid,integer,jsonb,uuid)',
  E'  target_payload connector_private.connector_payload_envelopes%rowtype;\n  target_policy public.connector_automation_policies%rowtype;\n',
  ''
);
select pg_temp.replace_function_fragment(
  'public.create_connector_action_intent(uuid,text,text,uuid,text,uuid,integer,jsonb,uuid)',
  'select payload.* into target_payload',
  'perform 1'
);
select pg_temp.replace_function_fragment(
  'public.create_connector_action_intent(uuid,text,text,uuid,text,uuid,integer,jsonb,uuid)',
  'select policy.* into target_policy',
  'perform 1'
);
select pg_temp.replace_function_fragment(
  'public.revise_connector_action_intent(uuid,integer,text,uuid,text,uuid,integer,jsonb,uuid)',
  E'  target_payload connector_private.connector_payload_envelopes%rowtype;\n  target_policy public.connector_automation_policies%rowtype;\n',
  ''
);
select pg_temp.replace_function_fragment(
  'public.revise_connector_action_intent(uuid,integer,text,uuid,text,uuid,integer,jsonb,uuid)',
  'select payload.* into target_payload',
  'perform 1'
);
select pg_temp.replace_function_fragment(
  'public.revise_connector_action_intent(uuid,integer,text,uuid,text,uuid,integer,jsonb,uuid)',
  'select policy.* into target_policy',
  'perform 1'
);
select pg_temp.replace_function_fragment(
  'public.approve_and_enqueue_connector_action(uuid,integer,text,text,uuid,timestamptz,integer)',
  E'  approval_receipt public.connector_receipt_events%rowtype;\n',
  ''
);
select pg_temp.replace_function_fragment(
  'public.approve_and_enqueue_connector_action(uuid,integer,text,text,uuid,timestamptz,integer)',
  E'  )\n  returning * into approval_receipt;',
  E'  );'
);
select pg_temp.replace_function_fragment(
  'public.create_connector_oauth_transaction(uuid,uuid,text,text,text,text[],uuid,uuid,text,text,text,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz)',
  E'  target_membership public.workspace_members%rowtype;\n',
  ''
);
select pg_temp.replace_function_fragment(
  'public.create_connector_oauth_transaction(uuid,uuid,text,text,text,text[],uuid,uuid,text,text,text,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz)',
  'select membership.* into target_membership',
  'perform 1'
);
select pg_temp.replace_function_fragment(
  'public.resolve_contact_import_identity(uuid,text,text,text,text)',
  E'  actor public.workspace_members%rowtype;\n',
  ''
);
select pg_temp.replace_function_fragment(
  'public.resolve_contact_import_identity(uuid,text,text,text,text)',
  'actor := public.current_rich_contact_actor(target_workspace_id);',
  'perform public.current_rich_contact_actor(target_workspace_id);'
);

select pg_temp.replace_function_fragment(
  'public.prepare_twilio_message_send_intent(uuid,integer,uuid,integer,text,uuid)',
  'declare actor public.workspace_members%rowtype; target_draft',
  'declare target_draft'
);
select pg_temp.replace_function_fragment(
  'public.prepare_twilio_message_send_intent(uuid,integer,uuid,integer,text,uuid)',
  'target_version public.texting_message_draft_versions%rowtype; target_authority public.twilio_connection_authorities%rowtype;',
  'target_version public.texting_message_draft_versions%rowtype;'
);
select pg_temp.replace_function_fragment(
  'public.prepare_twilio_message_send_intent(uuid,integer,uuid,integer,text,uuid)',
  'actor:=public.connector_current_membership(target_draft.workspace_id,false);',
  'perform public.connector_current_membership(target_draft.workspace_id,false);'
);
select pg_temp.replace_function_fragment(
  'public.prepare_twilio_message_send_intent(uuid,integer,uuid,integer,text,uuid)',
  'select authority.* into target_authority',
  'perform 1'
);
select pg_temp.replace_function_fragment(
  'public.approve_and_enqueue_twilio_message_send(uuid,integer,text,text,text,text,text,timestamptz,timestamptz,uuid)',
  'target_consent public.texting_consent_states%rowtype; target_authority public.twilio_connection_authorities%rowtype;',
  'target_consent public.texting_consent_states%rowtype;'
);
select pg_temp.replace_function_fragment(
  'public.approve_and_enqueue_twilio_message_send(uuid,integer,text,text,text,text,text,timestamptz,timestamptz,uuid)',
  'select authority.* into target_authority',
  'perform 1'
);
select pg_temp.replace_function_fragment(
  'public.archive_twilio_message_draft(uuid,integer,uuid,timestamptz)',
  'declare actor public.workspace_members%rowtype; target_draft',
  'declare target_draft'
);
select pg_temp.replace_function_fragment(
  'public.archive_twilio_message_draft(uuid,integer,uuid,timestamptz)',
  'actor:=public.connector_current_membership(target_draft.workspace_id,false);',
  'perform public.connector_current_membership(target_draft.workspace_id,false);'
);
select pg_temp.replace_function_fragment(
  'public.start_twilio_message_send_attempt(uuid,uuid,bigint,timestamptz)',
  'declare started jsonb; target_job public.connector_jobs%rowtype; target_message',
  'declare started jsonb; target_message'
);
select pg_temp.replace_function_fragment(
  'public.start_twilio_message_send_attempt(uuid,uuid,bigint,timestamptz)',
  'select job.* into target_job',
  'perform 1'
);
select pg_temp.replace_function_fragment(
  'public.read_twilio_job_authority(uuid,uuid,bigint,timestamptz)',
  E' target_snapshot public.texting_send_approval_snapshots%rowtype; target_consent public.texting_consent_states%rowtype;\n',
  E' target_snapshot public.texting_send_approval_snapshots%rowtype;\n'
);
select pg_temp.replace_function_fragment(
  'public.read_twilio_job_authority(uuid,uuid,bigint,timestamptz)',
  'select state.* into target_consent',
  'perform 1'
);
select pg_temp.replace_function_fragment(
  'public.register_and_apply_twilio_callback(text,text,text,text,text,text,text,text,public.twilio_callback_kind,text,public.texting_keyword_class,text,text,text,jsonb,timestamptz,timestamptz,uuid)',
  E'  callback_receipt public.connector_receipt_events%rowtype;\n',
  ''
);
select pg_temp.replace_function_fragment(
  'public.register_and_apply_twilio_callback(text,text,text,text,text,text,text,text,public.twilio_callback_kind,text,public.texting_keyword_class,text,text,text,jsonb,timestamptz,timestamptz,uuid)',
  E'  ) returning * into callback_receipt;',
  E'  );'
);
select pg_temp.replace_function_fragment(
  'public.schedule_due_google_gmail_watch_renewals(timestamptz,integer,integer)',
  ' jobs jsonb:=''[]''::jsonb; created boolean;',
  ' jobs jsonb:=''[]''::jsonb;'
);

select pg_temp.apply_function_fragment_queue();

commit;
