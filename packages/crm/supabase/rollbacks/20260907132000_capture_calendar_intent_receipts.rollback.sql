-- Data-preserving containment; retain immutable evidence and canonical receipts.
revoke execute on function public.create_capture_calendar_intent(uuid,integer,uuid,text,uuid,text,uuid,integer,jsonb,uuid) from authenticated,service_role;
