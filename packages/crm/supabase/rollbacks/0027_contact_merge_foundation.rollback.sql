-- Story 3.15 — pre-write rollback for the inert contact-merge foundation.
-- This rollback is intentionally destructive and therefore refuses to run after
-- any plan, member, alias or event has been persisted. After first write, use a
-- forward correction; after first activated merge, use reverse_exact_contact_merge.

begin;

do $$
begin
  if exists (select 1 from public.contact_merge_plans)
     or exists (select 1 from public.contact_merge_plan_members)
     or exists (select 1 from public.contact_merge_aliases)
     or exists (select 1 from public.contact_merge_events) then
    raise exception '0027 rollback is permitted only before the first contact-merge write'
      using errcode = '55000';
  end if;
end;
$$;

drop trigger if exists contacts_reject_active_merge_donor_mutation on public.contacts;
drop trigger if exists contact_merge_aliases_star_guard on public.contact_merge_aliases;
drop function if exists public.reject_active_merge_donor_mutation();
drop function if exists public.reverse_exact_contact_merge(uuid,uuid,text,text,timestamptz);
drop function if exists public.apply_exact_contact_merge(uuid,uuid,text,text,timestamptz);
drop function if exists public.plan_exact_contact_merge(uuid,uuid,text,text,text,text,text[],timestamptz,timestamptz);
drop function if exists public.assert_contact_outbound_target(uuid,uuid,uuid);
drop function if exists public.list_contact_alias_group_ids(uuid,uuid);
drop function if exists public.resolve_canonical_contact_id(uuid,uuid);
drop function if exists public.contact_merge_plan_snapshot(uuid,uuid[],uuid);
drop function if exists public.contact_merge_provider_dependency_count(uuid,uuid);
drop function if exists public.contact_merge_contact_snapshot(uuid,uuid);
drop function if exists public.contact_merge_group_hash(text,text);
drop function if exists public.guard_contact_merge_alias_star();

drop table if exists public.contact_merge_events;
drop table if exists public.contact_merge_aliases;
drop table if exists public.contact_merge_plan_members;
drop table if exists public.contact_merge_plans;
drop table if exists public.contact_merge_workspace_state;

drop function if exists public.guard_contact_merge_internal_write();

drop type if exists public.contact_merge_event_kind;
drop type if exists public.contact_merge_member_role;
drop type if exists public.contact_merge_plan_state;
drop type if exists public.contact_merge_evidence_kind;

commit;
