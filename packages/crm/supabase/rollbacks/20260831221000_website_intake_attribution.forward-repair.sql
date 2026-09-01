begin;
update public.website_intake_endpoints set enabled=false,updated_at=now() where enabled;
update public.website_intake_submissions set status='failed',failure_category='forward-repair-disabled',completed_at=coalesce(completed_at,now()),updated_at=now() where status='processing';
update public.website_response_slas set status='cancelled' where status='open';
commit;
