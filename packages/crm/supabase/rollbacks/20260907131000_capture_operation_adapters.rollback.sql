-- Data-preserving containment; retain immutable evidence and canonical receipts.
revoke execute on function public.save_capture_outcome(uuid,uuid,jsonb,integer,text) from authenticated,service_role;
