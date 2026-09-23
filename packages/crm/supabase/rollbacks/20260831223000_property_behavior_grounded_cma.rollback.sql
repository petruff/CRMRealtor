begin;
-- Data-preserving containment: retain behavior evidence and comparable
-- citations, revoke all mutation entry points, and block active CMA work.
revoke execute on function public.record_property_behavior(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,text,timestamptz),public.create_cma_request(uuid,uuid,uuid,uuid,text,jsonb,timestamptz,uuid,text,timestamptz),public.transition_cma_request(uuid,uuid,uuid,integer,text,text,timestamptz) from authenticated;
revoke execute on function public.add_cma_comparable_candidate(uuid,uuid,uuid,numeric,boolean,text,timestamptz) from service_role;
update public.cma_requests
set state='blocked',blocked_reason='Licensed comparable workflow paused for recovery.',current_version=current_version+1,updated_at=now()
where state in ('draft','researching','ready-for-review');
comment on table public.cma_requests is
  'CONTAINED: CMA mutation entry points are revoked; requests and cited comparable evidence are retained.';
commit;
