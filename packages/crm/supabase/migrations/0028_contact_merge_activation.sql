-- Omnix — Story 3.15 whole-plan contact-merge activation.
--
-- This forward-only activation unlocks the apply/reverse RPCs installed by
-- migration 0027. It remains additive: no contact foreign key or immutable
-- ledger is rewritten. Donors are represented by reversible logical aliases.
--
-- PRECONDITION: application/import/outbound alias compatibility is green.
-- ROLLBACK: reverse every applied plan, then run
-- ../rollbacks/0028_contact_merge_activation.rollback.sql. The rollback fails
-- closed while any applied plan or active alias remains.

begin;

do $$
begin
  if exists (
    select 1 from public.contact_merge_plans where state = 'applied'
  ) or exists (
    select 1 from public.contact_merge_aliases where inactive_at is null
  ) then
    raise exception '0028 activation requires zero pre-existing applied plans and active aliases'
      using errcode = '55000';
  end if;
end;
$$;

alter table public.contact_merge_workspace_state
  drop constraint contact_merge_foundation_inert;

alter table public.contact_merge_workspace_state
  alter column apply_enabled set default true,
  alter column activation_version set default 2;

update public.contact_merge_workspace_state
set apply_enabled = true,
    activation_version = 2,
    updated_at = now();

alter table public.contact_merge_workspace_state
  add constraint contact_merge_activation_v2 check (
    apply_enabled = true and activation_version = 2
  );

comment on table public.contact_merge_workspace_state is
  'Story 3.15 alias epoch and migration-0028 whole-plan activation gate.';
comment on function public.apply_exact_contact_merge(uuid,uuid,text,text,timestamptz) is
  'Atomically activates every donor alias in one exact-contact plan; migration 0028 activation required.';
comment on function public.reverse_exact_contact_merge(uuid,uuid,text,text,timestamptz) is
  'Atomically deactivates every alias and restores donor archive projections for one applied plan.';

commit;
