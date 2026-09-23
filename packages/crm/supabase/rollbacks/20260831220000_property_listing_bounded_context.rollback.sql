begin;
-- Data-preserving containment: later IDX, intake, and CMA migrations depend on
-- these contracts. Disable write entry points and revoke licensed display
-- permission while retaining identities, interests, and immutable history.
revoke execute on function public.create_manual_property(uuid,uuid,text,text,text,text,text,text,text,text,timestamptz),public.update_property_identity(uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text,text,timestamptz),public.upsert_property_fact(uuid,uuid,uuid,text,jsonb,text,text,text,text,timestamptz,text,timestamptz,timestamptz,integer,text,timestamptz),public.link_property_interest(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,timestamptz),public.archive_property_interest(uuid,uuid,uuid,integer,text,text,timestamptz),public.link_transaction_property(uuid,uuid,uuid,uuid,text,text,timestamptz) from authenticated,service_role;
update public.property_facts
set permission_state='revoked',display_until=least(coalesce(display_until,now()),now()),updated_at=now()
where authority='licensed-provider' and permission_state<>'revoked';
comment on table public.properties is
  'CONTAINED: property mutation entry points are revoked; canonical records and immutable history are retained.';
commit;
