create extension if not exists pgtap with schema extensions;
create extension if not exists plpgsql_check with schema extensions;

begin;
select plan(1);

select is(
  (
    select count(*)::integer
    from unnest(array[
      'public.is_valid_contact_conversion_payload(jsonb,boolean)','public.is_valid_incomplete_conversion_plan(jsonb)',
      'public.create_connector_action_intent(uuid,text,text,uuid,text,uuid,integer,jsonb,uuid)','public.revise_connector_action_intent(uuid,integer,text,uuid,text,uuid,integer,jsonb,uuid)',
      'public.approve_and_enqueue_connector_action(uuid,integer,text,text,uuid,timestamptz,integer)','public.create_connector_oauth_transaction(uuid,uuid,text,text,text,text[],uuid,uuid,text,text,text,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz)',
      'public.resolve_contact_import_identity(uuid,text,text,text,text)','public.register_and_apply_twilio_callback(text,text,text,text,text,text,text,text,public.twilio_callback_kind,text,public.texting_keyword_class,text,text,text,jsonb,timestamptz,timestamptz,uuid)',
      'public.record_omnix_inbound_response_intelligence(uuid,uuid,bigint,text,text,text,text,text,text,text,text,text,text[],timestamptz)'
    ]) signature cross join lateral extensions.plpgsql_check_function(signature::regprocedure) issue
    where issue::text like 'warning%'
  ),
  0,
  'local and remote function variants remain free of PL/pgSQL lint warnings'
);

select * from finish();
rollback;
