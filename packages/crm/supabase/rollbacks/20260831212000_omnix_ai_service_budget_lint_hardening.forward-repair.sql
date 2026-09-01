begin;

-- The forward migration is idempotent and replaces both functions in place.
-- Reapply its function bodies before restoring service-role execution.
grant execute on function public.reserve_omnix_ai_service_budget(uuid,uuid,uuid,text,integer,integer,integer) to service_role;
grant execute on function public.finalize_omnix_ai_service_budget(uuid,uuid,uuid,text,integer,integer,integer,text) to service_role;

commit;
