begin;

-- This migration changes only PL/pgSQL implementation details and preserves
-- every function signature, privilege, result, and side effect. Reintroducing
-- known lint defects is not a safe rollback, so the behavioral rollback is an
-- intentional no-op. Use the forward repair to reassert the clean definitions.
do $$
begin
  if to_regprocedure('public.is_valid_contact_conversion_payload(jsonb,boolean)') is null
     or to_regprocedure('public.create_connector_action_intent(uuid,text,text,uuid,text,uuid,integer,jsonb,uuid)') is null
     or to_regprocedure('public.prepare_twilio_message_send_intent(uuid,integer,uuid,integer,text,uuid)') is null then
    raise exception 'lint cleanup rollback precondition failed';
  end if;
end;
$$;

commit;
