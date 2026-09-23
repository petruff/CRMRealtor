begin;
create extension if not exists pgtap with schema extensions;
select plan(2);
select ok(
  'buyer-agreement' = any(enum_range(null::public.transaction_milestone_kind)::text[]),
  'buyer-agreement is a transaction milestone kind'
);
select ok(
  'flood' = any(enum_range(null::public.transaction_milestone_kind)::text[]),
  'flood kind remains available for the Florida flood disclosure'
);
select * from finish();
rollback;
