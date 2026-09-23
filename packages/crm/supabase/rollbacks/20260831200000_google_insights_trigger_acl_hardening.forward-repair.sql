begin;

revoke all on function public.capture_google_insights_capability()
from public, anon, authenticated, service_role;

drop trigger if exists google_oauth_completion_capture_insights
on public.google_oauth_completions;

create trigger google_oauth_completion_capture_insights
after insert on public.google_oauth_completions
for each row execute function public.capture_google_insights_capability();

commit;
