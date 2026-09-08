-- Restore guarded command only after migration repair and workspace QA.
grant execute on function public.save_capture_outcome(uuid,uuid,jsonb,integer,text) to authenticated;
