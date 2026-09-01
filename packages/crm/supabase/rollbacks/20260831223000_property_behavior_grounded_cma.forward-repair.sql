begin;
update public.cma_requests set state='blocked',blocked_reason='Licensed comparable workflow paused for recovery.',current_version=current_version+1,updated_at=now() where state in ('draft','researching','ready-for-review');
commit;
