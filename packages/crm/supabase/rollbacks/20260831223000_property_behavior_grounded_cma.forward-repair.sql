begin;
grant execute on function public.record_property_behavior(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,text,timestamptz),public.create_cma_request(uuid,uuid,uuid,uuid,text,jsonb,timestamptz,uuid,text,timestamptz),public.transition_cma_request(uuid,uuid,uuid,integer,text,text,timestamptz) to authenticated;
grant execute on function public.add_cma_comparable_candidate(uuid,uuid,uuid,numeric,boolean,text,timestamptz) to service_role;
comment on table public.cma_requests is
  'Governed comparable research request; it is not an appraisal or automated valuation.';
commit;
