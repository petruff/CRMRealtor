-- Destructive rollback for Story 6.2. Export real_estate_transactions before use.
drop function if exists public.create_real_estate_transaction(
  uuid, uuid, uuid, public.real_estate_transaction_status, public.real_estate_transaction_side,
  text, date, date, bigint, bigint, bigint, bigint, bigint, uuid
);
drop table if exists public.real_estate_transactions;
drop type if exists public.real_estate_transaction_side;
drop type if exists public.real_estate_transaction_status;
