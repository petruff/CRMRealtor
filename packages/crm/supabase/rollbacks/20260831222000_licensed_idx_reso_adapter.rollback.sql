begin;
revoke execute on function public.configure_listing_provider_authority(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,text,text,integer,integer,integer,integer,boolean,timestamptz),public.revoke_listing_provider_authority(uuid,uuid,uuid,text,timestamptz) from authenticated;
revoke execute on function public.claim_listing_sync(uuid,text,text,text,text,timestamptz),public.record_listing_sync_change(uuid,uuid,text,uuid,text,text,timestamptz,timestamptz),public.finalize_listing_sync(uuid,uuid,text,integer,integer,integer,timestamptz) from service_role;
update public.listing_provider_authorities set state='suspended',credential_binding_reference=null,updated_at=now() where state in ('pending','active');
update public.licensed_listing_records set permission_state='revoked',display_until=least(display_until,now()),updated_at=now() where permission_state='allowed';
update public.property_facts set permission_state='revoked',display_until=least(coalesce(display_until,now()),now()),updated_at=now() where authority='licensed-provider' and permission_state='allowed';
update public.listing_sync_runs set status='cancelled',failure_category='rollback-contained',completed_at=now(),updated_at=now() where status='processing';
comment on table public.listing_provider_authorities is
  'CONTAINED: licensed listing entry points are revoked and display permission is removed; authority and sync evidence are retained.';
commit;
