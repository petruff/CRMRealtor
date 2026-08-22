-- Story 3.15 — safe deactivation of migration 0028.
-- Reverse all applied plans before running this script. Historical reversed
-- plans, inactive aliases and append-only events are retained as evidence.

begin;

do $$
begin
  if exists (
    select 1 from public.contact_merge_plans where state = 'applied'
  ) or exists (
    select 1 from public.contact_merge_aliases where inactive_at is null
  ) then
    raise exception '0028 rollback requires every applied contact merge to be reversed first'
      using errcode = '55000';
  end if;
end;
$$;

alter table public.contact_merge_workspace_state
  drop constraint contact_merge_activation_v2;

update public.contact_merge_workspace_state
set apply_enabled = false,
    activation_version = 0,
    updated_at = now();

alter table public.contact_merge_workspace_state
  alter column apply_enabled set default false,
  alter column activation_version set default 0;

alter table public.contact_merge_workspace_state
  add constraint contact_merge_foundation_inert check (
    apply_enabled = false and activation_version = 0
  );

comment on table public.contact_merge_workspace_state is
  'Story 3.15 inert contact-merge foundation; productive apply/reverse requires migration 0028.';
comment on function public.apply_exact_contact_merge(uuid,uuid,text,text,timestamptz) is
  'Full transactional contract, structurally disabled until migration 0028.';
comment on function public.reverse_exact_contact_merge(uuid,uuid,text,text,timestamptz) is
  'Full transactional reversal contract, structurally disabled until migration 0028.';

commit;
