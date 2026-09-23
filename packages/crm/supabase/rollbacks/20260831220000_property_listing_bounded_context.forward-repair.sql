begin;
grant execute on function public.create_manual_property(uuid,uuid,text,text,text,text,text,text,text,text,timestamptz),public.update_property_identity(uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text,text,timestamptz),public.upsert_property_fact(uuid,uuid,uuid,text,jsonb,text,text,text,text,timestamptz,text,timestamptz,timestamptz,integer,text,timestamptz),public.link_property_interest(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,timestamptz),public.archive_property_interest(uuid,uuid,uuid,integer,text,text,timestamptz),public.link_transaction_property(uuid,uuid,uuid,uuid,text,text,timestamptz) to authenticated,service_role;
comment on table public.properties is
  'Workspace-scoped canonical property identities with append-only revisions and source-authority facts.';
commit;
