begin;
grant execute on function public.configure_listing_provider_authority(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,text,text,integer,integer,integer,integer,boolean,timestamptz),public.revoke_listing_provider_authority(uuid,uuid,uuid,text,timestamptz) to authenticated;
grant execute on function public.claim_listing_sync(uuid,text,text,text,text,timestamptz),public.record_listing_sync_change(uuid,uuid,text,uuid,text,text,timestamptz,timestamptz),public.finalize_listing_sync(uuid,uuid,text,integer,integer,integer,timestamptz) to service_role;
comment on table public.listing_provider_authorities is
  'Provider authority and permission contract for licensed IDX or RESO adapters.';
commit;
