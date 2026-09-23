begin;

-- Trigger functions do not require API-role EXECUTE privileges. Keep the
-- capture path database-owned and prevent direct invocation through PostgREST.
revoke all on function public.capture_google_insights_capability()
from public, anon, authenticated, service_role;

commit;
