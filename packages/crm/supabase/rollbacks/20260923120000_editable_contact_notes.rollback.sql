-- Containment: stop new note edits while preserving every edited body and revision.
revoke execute on function public.edit_contact_note(uuid,integer,text,uuid,timestamptz) from authenticated;
