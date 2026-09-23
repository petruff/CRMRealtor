begin;

-- The canonical migration is idempotent and must be reapplied when a restored
-- database predates the lint cleanup. This guard prevents a false repair claim.
do $$
begin
  if to_regprocedure('public.is_valid_contact_conversion_payload(jsonb,boolean)') is null
     or to_regprocedure('public.create_connector_action_intent(uuid,text,text,uuid,text,uuid,integer,jsonb,uuid)') is null
     or to_regprocedure('public.prepare_twilio_message_send_intent(uuid,integer,uuid,integer,text,uuid)') is null then
    raise exception 'apply migration 20260901010000 before forward repair';
  end if;
end;
$$;

commit;
