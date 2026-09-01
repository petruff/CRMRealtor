begin;
update public.listing_provider_authorities set state='suspended',credential_binding_reference=null,updated_at=now() where state in ('pending','active');
update public.licensed_listing_records set permission_state='revoked',display_until=least(display_until,now()),updated_at=now() where permission_state='allowed';
update public.property_facts set permission_state='revoked',display_until=least(coalesce(display_until,now()),now()),updated_at=now() where authority='licensed-provider' and permission_state='allowed';
update public.listing_sync_runs set status='cancelled',failure_category='forward-repair',completed_at=now(),updated_at=now() where status='processing';
commit;
