-- Harden physical-mail history so a send can only connect resources owned by
-- the same Realtor. Forward-only and additive; existing send dates are kept.

alter table mailers
  add constraint mailers_id_owner_unique unique (id, owner_id);

alter table mailer_sends add column owner_id uuid;

update mailer_sends sends
set owner_id = mailers.owner_id
from mailers
where mailers.id = sends.mailer_id;

alter table mailer_sends alter column owner_id set not null;

alter table mailer_sends drop constraint mailer_sends_mailer_id_fkey;
alter table mailer_sends drop constraint mailer_sends_contact_id_fkey;

alter table mailer_sends
  add constraint mailer_sends_mailer_owner_fk
    foreign key (mailer_id, owner_id)
    references mailers (id, owner_id)
    on delete cascade,
  add constraint mailer_sends_contact_owner_fk
    foreign key (contact_id, owner_id)
    references contacts (id, owner_id)
    on delete cascade;

create index mailer_sends_owner_idx
  on mailer_sends (owner_id, mailer_id, sent_on desc);

drop policy mailer_sends_owner on mailer_sends;

create policy mailer_sends_owner on mailer_sends
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
