begin;

-- This migration reconciles implementation-only lint drift while preserving
-- signatures, privileges, outputs, and side effects. Reintroducing warnings is
-- not a safe rollback, so containment intentionally preserves clean functions.
do $$
begin
  if to_regprocedure('public.is_valid_contact_conversion_payload(jsonb,boolean)') is null
     or to_regprocedure('public.record_omnix_inbound_response_intelligence(uuid,uuid,bigint,text,text,text,text,text,text,text,text,text,text[],timestamptz)') is null then
    raise exception 'remote lint reconciliation rollback precondition failed';
  end if;
end;
$$;

commit;
