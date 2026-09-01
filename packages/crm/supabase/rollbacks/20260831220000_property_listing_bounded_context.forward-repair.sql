begin;
-- Forward repair is intentionally non-destructive: revoke licensed display permission before application rollback.
update public.property_facts set permission_state='revoked',updated_at=now()
where authority='licensed-provider' and permission_state<>'revoked';
commit;
