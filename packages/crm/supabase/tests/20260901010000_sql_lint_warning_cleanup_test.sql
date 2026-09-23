create extension if not exists pgtap with schema extensions;
create extension if not exists plpgsql_check with schema extensions;

begin;
select plan(2);

select is(
  (
    select count(*)::integer
    from unnest(array[
      'public.is_valid_contact_conversion_payload(jsonb,boolean)',
      'public.is_valid_incomplete_conversion_plan(jsonb)',
      'public.create_connector_action_intent(uuid,text,text,uuid,text,uuid,integer,jsonb,uuid)',
      'public.revise_connector_action_intent(uuid,integer,text,uuid,text,uuid,integer,jsonb,uuid)',
      'public.approve_and_enqueue_connector_action(uuid,integer,text,text,uuid,timestamptz,integer)',
      'public.create_connector_oauth_transaction(uuid,uuid,text,text,text,text[],uuid,uuid,text,text,text,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz)',
      'public.resolve_contact_import_identity(uuid,text,text,text,text)',
      'public.prepare_twilio_message_send_intent(uuid,integer,uuid,integer,text,uuid)',
      'public.approve_and_enqueue_twilio_message_send(uuid,integer,text,text,text,text,text,timestamptz,timestamptz,uuid)',
      'public.archive_twilio_message_draft(uuid,integer,uuid,timestamptz)',
      'public.start_twilio_message_send_attempt(uuid,uuid,bigint,timestamptz)',
      'public.read_twilio_job_authority(uuid,uuid,bigint,timestamptz)',
      'public.register_and_apply_twilio_callback(text,text,text,text,text,text,text,text,public.twilio_callback_kind,text,public.texting_keyword_class,text,text,text,jsonb,timestamptz,timestamptz,uuid)',
      'public.schedule_due_google_gmail_watch_renewals(timestamptz,integer,integer)'
    ]) signature
    cross join lateral extensions.plpgsql_check_function(signature::regprocedure) issue
    where issue::text like 'warning%'
  ),
  0,
  'legacy connector, contact, Google, and Twilio functions have no lint warnings'
);

select is(
  (
    select count(*)::integer
    from unnest(array[
      'public.create_real_estate_transaction(uuid,uuid,uuid,public.real_estate_transaction_status,public.real_estate_transaction_side,text,date,date,bigint,bigint,bigint,bigint,bigint,uuid)',
      'public.create_real_estate_transaction_v2(uuid,uuid,uuid,public.real_estate_transaction_kind,text,public.real_estate_transaction_status,public.real_estate_transaction_side,text,date,date,bigint,bigint,bigint,bigint,bigint,uuid,text,timestamptz,uuid)',
      'public.transition_real_estate_transaction(uuid,uuid,uuid,integer,public.real_estate_transaction_status,date,text,text,timestamptz)',
      'public.add_transaction_party(uuid,uuid,uuid,uuid,public.transaction_party_role,text,boolean,text,timestamptz)',
      'public.update_real_estate_transaction(uuid,uuid,uuid,integer,public.real_estate_transaction_kind,text,public.real_estate_transaction_side,text,date,bigint,bigint,bigint,bigint,bigint,text,timestamptz,text,text,timestamptz)',
      'public.update_transaction_party(uuid,uuid,uuid,integer,public.transaction_party_role,text,boolean,text,timestamptz)',
      'public.archive_transaction_party(uuid,uuid,uuid,integer,text,text,timestamptz)',
      'public.create_transaction_milestone_v2(uuid,uuid,uuid,public.transaction_milestone_kind,text,timestamptz,text,uuid,text,text,date,text,text,timestamptz)',
      'public.update_transaction_milestone(uuid,uuid,uuid,integer,public.transaction_milestone_kind,text,timestamptz,text,uuid,text,text,date,text,text,text,timestamptz)',
      'public.record_omnix_inbound_response_intelligence(uuid,uuid,bigint,text,text,text,text,text,text,text,text,text,text[],timestamptz)'
    ]) signature
    cross join lateral extensions.plpgsql_check_function(signature::regprocedure) issue
    where issue::text like 'warning%'
  ),
  0,
  'new transaction and intelligence functions have no lint warnings'
);

select * from finish();
rollback;
