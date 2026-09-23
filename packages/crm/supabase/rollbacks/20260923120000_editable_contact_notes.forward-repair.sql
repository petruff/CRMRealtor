-- Forward repair: re-enable note edits exactly as the migration granted them.
grant execute on function public.edit_contact_note(uuid,integer,text,uuid,timestamptz) to authenticated;
