-- Universal contact imports and authenticated automatic intake.

alter table contacts
  add constraint contacts_id_owner_unique unique (id, owner_id);

-- The service-role intake client bypasses RLS. This composite FK makes a note
-- with a mismatched owner impossible even if an application caller regresses.
alter table notes drop constraint notes_contact_id_fkey;
alter table notes
  add constraint notes_contact_owner_fk
  foreign key (contact_id, owner_id) references contacts (id, owner_id) on delete cascade;

create table contact_external_links (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  contact_id  uuid not null,
  provider    text not null check (provider ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  external_id text not null check (length(trim(external_id)) between 1 and 255),
  created_at  timestamptz not null default now(),
  unique (owner_id, provider, external_id),
  foreign key (contact_id, owner_id)
    references contacts (id, owner_id) on delete cascade
);

create index contact_external_links_contact_idx
  on contact_external_links (owner_id, contact_id);

create table contact_intake_receipts (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users (id) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  request_hash    text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  status_code     integer not null check (status_code between 200 and 599),
  -- Store the aggregate receipt only; never persist the submitted contact body.
  response_json   jsonb not null,
  created_at      timestamptz not null default now(),
  unique (owner_id, idempotency_key)
);

alter table contact_external_links enable row level security;
alter table contact_intake_receipts enable row level security;

create policy contact_external_links_owner on contact_external_links
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy contact_intake_receipts_owner on contact_intake_receipts
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
