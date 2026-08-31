-- Forward repair for a partially applied pre-use nurture migration.
do $$ begin
  if to_regclass('public.omnix_nurture_plans') is not null
     and exists(select 1 from public.omnix_nurture_plans limit 1) then
    raise exception 'Nurture plan data exists; use a data-preserving forward repair';
  end if;
end $$;
\ir 20260831160000_omnix_nurture_lifecycle.rollback.sql
\ir ../migrations/20260831160000_omnix_nurture_lifecycle.sql
