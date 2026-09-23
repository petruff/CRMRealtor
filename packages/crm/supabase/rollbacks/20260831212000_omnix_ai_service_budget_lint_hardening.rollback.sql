begin;

-- Fail closed instead of restoring the ambiguous implementation.
revoke all on function public.reserve_omnix_ai_service_budget(uuid,uuid,uuid,text,integer,integer,integer)
from public,anon,authenticated,service_role;
revoke all on function public.finalize_omnix_ai_service_budget(uuid,uuid,uuid,text,integer,integer,integer,text)
from public,anon,authenticated,service_role;

commit;
