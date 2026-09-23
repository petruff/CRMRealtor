-- PostgreSQL cannot drop a value from an enum in place. Rolling back is
-- containment: stop new buyer-agreement milestones while keeping existing rows
-- (they are audit evidence). Run only after the application release that uses
-- the value has been rolled back.
create or replace function public.omnix_block_buyer_agreement_milestones() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.kind::text = 'buyer-agreement' then
    raise exception 'buyer-agreement milestones are disabled by rollback' using errcode='22023';
  end if;
  return new;
end $$;
drop trigger if exists omnix_block_buyer_agreement_milestones on public.transaction_milestones;
create trigger omnix_block_buyer_agreement_milestones before insert on public.transaction_milestones
  for each row execute function public.omnix_block_buyer_agreement_milestones();
