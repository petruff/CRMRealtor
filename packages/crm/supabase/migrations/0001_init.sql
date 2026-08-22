-- Omnix — initial schema
-- Mirrors lib/domain/contact.ts. Keep the two in step.
--
-- Modelling note: lead_type (temperature) and relationship (position in the
-- business) are separate columns on purpose. A past client can be hot. Folding
-- them into one enum is how agents lose sight of their sphere.

create extension if not exists "pgcrypto";

-- Enums ---------------------------------------------------------------------

create type lead_type as enum ('hot', 'warm', 'nurture');
create type relationship as enum ('lead', 'active-client', 'past-client', 'sphere');
create type intent as enum ('buyer', 'seller', 'both', 'investor', 'renter', 'unknown');
create type lead_source as enum (
  'cold-call', 'open-house', 'referral', 'social-media', 'website', 'mailer', 'other'
);
create type pipeline_stage as enum (
  'new', 'contacted', 'appointment-set', 'active', 'under-contract', 'closed', 'lost'
);

-- Contacts ------------------------------------------------------------------

create table contacts (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users (id) on delete cascade,

  first_name      text not null,
  last_name       text not null,
  preferred_name  text,

  phone           text,
  secondary_phone text,
  email           text,

  mailing_address text,
  city            text,
  state           text,
  postal_code     text,

  -- Date, not timestamptz: birthdays are calendar facts. Only month/day are used,
  -- because the year a contact was born is frequently wrong or unknown.
  birthdate           date,
  home_purchase_date  date,

  lead_type       lead_type      not null default 'warm',
  relationship    relationship   not null default 'lead',
  intent          intent         not null default 'unknown',
  source          lead_source    not null default 'other',
  pipeline_stage  pipeline_stage not null default 'new',

  -- Loosely-shaped criteria; the useful fields differ per contact and this
  -- avoids twenty mostly-null columns.
  buyer_criteria  jsonb,
  seller_criteria jsonb,

  referred_by_id  uuid references contacts (id) on delete set null,

  last_contacted_at      timestamptz,
  next_touch_at          date,
  touch_date_overridden  boolean not null default false,

  tags            text[] not null default '{}',

  -- Mirrors Mailchimp state so we never email someone who opted out.
  email_subscribed boolean not null default true,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint contacts_name_present check (
    length(trim(first_name)) > 0 or length(trim(last_name)) > 0
  ),
  constraint contacts_no_self_referral check (referred_by_id is null or referred_by_id <> id)
);

-- Triage reads these on every page load; everything else is incidental.
create index contacts_owner_next_touch_idx
  on contacts (owner_id, next_touch_at)
  where pipeline_stage not in ('closed', 'lost');

create index contacts_owner_lead_type_idx on contacts (owner_id, lead_type);
create index contacts_referred_by_idx on contacts (referred_by_id);

-- Month/day extraction for the birthday and homeaversary windows.
create index contacts_birthday_idx
  on contacts (owner_id, (extract(month from birthdate)), (extract(day from birthdate)))
  where birthdate is not null;

-- Notes ---------------------------------------------------------------------
-- Append-only. She said notes were her favourite thing about the old CRM;
-- an editable note is a note you can silently lose.

create table notes (
  id         uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts (id) on delete cascade,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  body       text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

create index notes_contact_idx on notes (contact_id, created_at desc);

-- Mailers -------------------------------------------------------------------
-- Printed postcards, confirmed. Her spec: "know what was sent, when, and if it
-- was done." A send row existing IS the tick; sent_on carries the date.

create table mailers (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  notes      text,
  created_at timestamptz not null default now()
);

create table mailer_sends (
  mailer_id  uuid not null references mailers (id) on delete cascade,
  contact_id uuid not null references contacts (id) on delete cascade,
  sent_on    date not null default current_date,
  primary key (mailer_id, contact_id)
);

create index mailer_sends_contact_idx on mailer_sends (contact_id);

-- updated_at ----------------------------------------------------------------

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger contacts_touch_updated_at
  before update on contacts
  for each row execute function touch_updated_at();

-- Row level security --------------------------------------------------------
-- Single user today, but enabled from the start. Retrofitting RLS onto a table
-- that already holds client PII is how data leaks between accounts.

alter table contacts     enable row level security;
alter table notes        enable row level security;
alter table mailers      enable row level security;
alter table mailer_sends enable row level security;

create policy contacts_owner on contacts
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy notes_owner on notes
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy mailers_owner on mailers
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy mailer_sends_owner on mailer_sends
  for all using (
    exists (select 1 from mailers m where m.id = mailer_id and m.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from mailers m where m.id = mailer_id and m.owner_id = auth.uid())
  );
