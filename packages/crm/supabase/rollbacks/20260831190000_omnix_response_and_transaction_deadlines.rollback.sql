begin;
do $$ begin
  if exists(select 1 from public.google_oauth_completions where bundle='gmail-insights') then
    raise exception 'Cannot remove Gmail Insights while restricted-scope completion evidence exists';
  end if;
end $$;
drop trigger if exists google_oauth_completion_capture_insights on public.google_oauth_completions;
drop function if exists public.capture_google_insights_capability();
drop function if exists public.record_omnix_inbound_response_intelligence(uuid,uuid,bigint,text,text,text,text,text,text,text,text,text,text[],timestamptz);
drop function if exists public.reserve_omnix_ai_service_budget(uuid,uuid,uuid,text,integer,integer,integer);
drop function if exists public.finalize_omnix_ai_service_budget(uuid,uuid,uuid,text,integer,integer,integer,text);
drop trigger if exists real_estate_transaction_seed_closing_milestone on public.real_estate_transactions;
drop trigger if exists google_gmail_resource_capture_omnix_response on connector_private.google_gmail_resources;
drop function if exists public.seed_transaction_closing_milestone();
drop function if exists public.capture_omnix_inbound_response_signal();
drop function if exists public.create_transaction_milestone(uuid,uuid,uuid,public.transaction_milestone_kind,text,timestamptz,text,timestamptz);
drop function if exists public.transition_transaction_milestone(uuid,uuid,uuid,integer,public.transaction_milestone_state,text,timestamptz);
drop function if exists public.acknowledge_omnix_inbound_response(uuid,uuid,uuid,timestamptz);
drop table if exists public.transaction_milestone_events;
drop table if exists public.transaction_milestones;
drop table if exists public.omnix_inbound_response_signals;
drop type if exists public.transaction_milestone_state;
drop type if exists public.transaction_milestone_kind;
alter table public.google_connection_capabilities drop constraint google_connection_capabilities_bundle;
alter table public.google_connection_capabilities add constraint google_connection_capabilities_bundle check (
  bundle in ('gmail-send','gmail-metadata','calendar-app-created')
);
alter table public.google_oauth_completions drop constraint google_oauth_completions_bundle;
alter table public.google_oauth_completions add constraint google_oauth_completions_bundle check (
  bundle in ('workspace-core','gmail-send','gmail-metadata','calendar-app-created')
);
create or replace function connector_private.google_bundle_scopes(target_bundle text)
returns text[] language sql immutable security definer set search_path='' as $$
  select case target_bundle
    when 'workspace-core' then array['openid','email','https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.metadata','https://www.googleapis.com/auth/calendar.app.created']::text[]
    when 'gmail-send' then array['openid','email','https://www.googleapis.com/auth/gmail.send']::text[]
    when 'gmail-metadata' then array['openid','email','https://www.googleapis.com/auth/gmail.metadata']::text[]
    when 'calendar-app-created' then array['openid','email','https://www.googleapis.com/auth/calendar.app.created']::text[]
    else null::text[] end;
$$;
commit;
