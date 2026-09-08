-- Data-preserving containment; retain immutable evidence and canonical receipts.
revoke execute on function public.transition_omnix_nurture_plan(uuid,uuid,integer,text,timestamptz,text,uuid,text,timestamptz) from authenticated,service_role;
