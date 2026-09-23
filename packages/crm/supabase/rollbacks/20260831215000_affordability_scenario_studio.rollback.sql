begin;
-- Preserve scenario history and consent evidence while disabling every mutation authority.
revoke all on function public.upsert_affordability_scenario(uuid,uuid,uuid,integer,text,uuid,uuid,jsonb,text,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.create_affordability_share_preview(uuid,uuid,uuid,integer,text,text,text,boolean,jsonb,text,timestamptz) from public,anon,authenticated,service_role;
commit;
