begin;
revoke all on function public.upsert_affordability_scenario(uuid,uuid,uuid,integer,text,uuid,uuid,jsonb,text,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.create_affordability_share_preview(uuid,uuid,uuid,integer,text,text,text,boolean,jsonb,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.upsert_affordability_scenario(uuid,uuid,uuid,integer,text,uuid,uuid,jsonb,text,text,timestamptz) to authenticated,service_role;
grant execute on function public.create_affordability_share_preview(uuid,uuid,uuid,integer,text,text,text,boolean,jsonb,text,timestamptz) to authenticated,service_role;
commit;
