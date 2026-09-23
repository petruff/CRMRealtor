begin;

-- Fail closed during rollback. Restoring the former PUBLIC EXECUTE privilege
-- would recreate the vulnerability addressed by this migration. Disabling the
-- trigger temporarily preserves existing evidence while stopping new capture;
-- use the paired forward repair to restore the hardened trigger path.
drop trigger if exists google_oauth_completion_capture_insights
on public.google_oauth_completions;

revoke all on function public.capture_google_insights_capability()
from public, anon, authenticated, service_role;

commit;
