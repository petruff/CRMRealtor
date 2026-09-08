-- Data-preserving containment: retain source records, immutable versions and canonical receipts.
begin;
revoke execute on function public.save_capture_outcome(uuid,uuid,jsonb,integer,text),public.append_capture_outcome_note(uuid,uuid,uuid,integer,uuid,text,text,timestamptz) from authenticated,service_role;
comment on table public.capture_outcomes is 'CONTAINED: Capture commands disabled; retained workspace records and receipts remain readable.';
commit;
