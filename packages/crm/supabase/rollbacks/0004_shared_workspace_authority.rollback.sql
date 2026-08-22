-- MANUAL ROLLBACK — Story 3.0 Shared Workspace Authority
--
-- Do not run after workspace-aware application writes begin: workspace/member
-- and authority-audit rows would be lost, and post-migration assistant-authored
-- data might no longer be representable by legacy owner_id policies.
-- Preferred recovery is the pg_dump/PITR snapshot taken immediately before
-- migration 0004. This file exists for a verified pre-write rollback only.

begin;

drop policy if exists contacts_workspace_member on contacts;
drop policy if exists notes_workspace_member on notes;
drop policy if exists mailers_workspace_member on mailers;
drop policy if exists mailer_sends_workspace_member on mailer_sends;
drop policy if exists contact_external_links_workspace_member on contact_external_links;
drop policy if exists contact_intake_receipts_workspace_member on contact_intake_receipts;

create policy contacts_owner on contacts
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy notes_owner on notes
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy mailers_owner on mailers
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy mailer_sends_owner on mailer_sends
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy contact_external_links_owner on contact_external_links
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy contact_intake_receipts_owner on contact_intake_receipts
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

alter table contact_intake_receipts
  drop constraint if exists contact_intake_receipts_workspace_idempotency_unique,
  drop constraint if exists contact_intake_receipts_workspace_fk,
  drop column if exists workspace_id;

alter table contact_external_links
  drop constraint if exists contact_external_links_workspace_provider_unique,
  drop constraint if exists contact_external_links_contact_workspace_fk,
  drop constraint if exists contact_external_links_workspace_fk,
  drop column if exists workspace_id;

alter table mailer_sends
  drop constraint if exists mailer_sends_contact_workspace_fk,
  drop constraint if exists mailer_sends_mailer_workspace_fk,
  drop constraint if exists mailer_sends_workspace_fk,
  drop column if exists workspace_id;

alter table mailers
  drop constraint if exists mailers_id_workspace_unique,
  drop constraint if exists mailers_workspace_fk,
  drop column if exists workspace_id;

alter table notes
  drop constraint if exists notes_contact_workspace_fk,
  drop constraint if exists notes_workspace_fk,
  drop column if exists workspace_id;

alter table contacts
  drop constraint if exists contacts_referred_by_workspace_fk,
  drop constraint if exists contacts_id_workspace_unique,
  drop constraint if exists contacts_workspace_fk;

alter table contacts
  add constraint contacts_referred_by_id_fkey
  foreign key (referred_by_id) references contacts (id) on delete set null;

alter table contacts drop column if exists workspace_id;

drop function if exists bootstrap_personal_workspace(text);
drop function if exists add_workspace_assistant(uuid, uuid, text);
drop function if exists revoke_workspace_assistant(uuid, uuid, text);
drop function if exists has_workspace_access(uuid);
drop function if exists is_workspace_owner(uuid);

drop table if exists workspace_authority_audit_events;
drop table if exists workspace_members;
drop table if exists workspaces;

drop function if exists audit_workspace_rename();
drop function if exists audit_workspace_member_change();
drop function if exists workspace_audit_actor(uuid);
drop function if exists workspace_audit_correlation();
drop function if exists prepare_workspace_member_update();
drop function if exists guard_workspace_identity();
drop function if exists enforce_workspace_owner_from_member();
drop function if exists enforce_workspace_owner_from_workspace();
drop function if exists assert_workspace_owner_invariant(uuid);

drop type if exists workspace_membership_status;
drop type if exists workspace_role;

commit;
