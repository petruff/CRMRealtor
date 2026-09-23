-- Restore guarded command only after migration repair and workspace QA.
grant execute on function public.create_capture_calendar_intent(uuid,integer,uuid,text,uuid,text,uuid,integer,jsonb,uuid) to authenticated;
