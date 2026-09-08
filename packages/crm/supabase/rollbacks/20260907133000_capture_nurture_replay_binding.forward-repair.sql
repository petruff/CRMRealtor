-- Restore guarded command only after migration repair and workspace QA.
grant execute on function public.transition_omnix_nurture_plan(uuid,uuid,integer,text,timestamptz,text,uuid,text,timestamptz) to authenticated;
