-- Re-enable only after validating the exact migration definitions and RLS gates.
begin;
grant execute on function public.save_capture_outcome(uuid,uuid,jsonb,integer,text),public.append_capture_outcome_note(uuid,uuid,uuid,integer,uuid,text,text,timestamptz) to authenticated;
comment on table public.capture_outcomes is 'Typed Capture Outcome workspace records; immutable review versions and canonical Omnix execution authority.';
commit;
