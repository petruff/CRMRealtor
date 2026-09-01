begin;

-- Rollback is a behavior-preserving no-op. Forward repair proves the clean
-- function set remains present; the canonical migration performs reconciliation.
do $$
begin
  if to_regprocedure('public.is_valid_contact_conversion_payload(jsonb,boolean)') is null
     or to_regprocedure('public.record_omnix_inbound_response_intelligence(uuid,uuid,bigint,text,text,text,text,text,text,text,text,text,text[],timestamptz)') is null then
    raise exception 'remote lint reconciliation forward-repair precondition failed';
  end if;
end;
$$;

commit;
