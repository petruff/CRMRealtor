-- Forward repair for a partially applied pre-use migration.
-- If any proposal or memory row exists, stop and prepare a data-preserving repair.

do $$ begin
  if to_regclass('public.omnix_action_proposals') is not null
     and exists(select 1 from public.omnix_action_proposals limit 1) then
    raise exception 'Omnix proposal data exists; use a data-preserving forward repair';
  end if;
  if to_regclass('public.omnix_relationship_memories') is not null
     and exists(select 1 from public.omnix_relationship_memories limit 1) then
    raise exception 'Omnix relationship memory data exists; use a data-preserving forward repair';
  end if;
end $$;

\ir 20260831120000_omnix_operational_brain.rollback.sql
\ir ../migrations/20260831120000_omnix_operational_brain.sql
