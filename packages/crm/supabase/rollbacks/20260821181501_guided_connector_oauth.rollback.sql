begin;

do $$
begin
  if exists(select 1 from public.google_oauth_completions where bundle='workspace-core') then
    raise exception 'Cannot remove guided Google OAuth while workspace-core completion evidence exists';
  end if;
end;
$$;

drop function if exists public.finalize_mailchimp_oauth_v2(uuid,uuid,text,text[],jsonb,bytea,bytea,bytea,bytea,bytea,bytea,text,text,integer,timestamptz,uuid);
drop function if exists public.consume_mailchimp_oauth_transaction_v2(text,uuid,uuid,uuid,text,text,timestamptz);
drop function if exists public.begin_mailchimp_oauth_v2(uuid,uuid,text,uuid,text,text,text[],text,text,text,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz,timestamptz);

alter table public.google_oauth_completions
  drop constraint google_oauth_completions_bundle;
alter table public.google_oauth_completions
  add constraint google_oauth_completions_bundle check (
    bundle in ('gmail-send','gmail-metadata','calendar-app-created')
  );

create or replace function connector_private.google_bundle_scopes(target_bundle text)
returns text[]
language sql
immutable
security definer
set search_path=''
as $$
  select case target_bundle
    when 'gmail-send' then array['openid','email','https://www.googleapis.com/auth/gmail.send']::text[]
    when 'gmail-metadata' then array['openid','email','https://www.googleapis.com/auth/gmail.metadata']::text[]
    when 'calendar-app-created' then array['openid','email','https://www.googleapis.com/auth/calendar.app.created']::text[]
    else null::text[] end;
$$;

commit;
