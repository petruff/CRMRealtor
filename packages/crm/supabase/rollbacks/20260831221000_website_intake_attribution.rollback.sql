begin;
revoke execute on function public.configure_website_intake_endpoint(uuid,uuid,text,text,text[],integer,integer,uuid,timestamptz) from authenticated;
revoke execute on function public.claim_website_intake_submission(uuid,text,text,text,text,text,text,timestamptz),public.review_website_intake_submission(uuid,uuid,jsonb,jsonb,jsonb,text,timestamptz),public.finalize_website_intake_submission(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,timestamptz),public.fail_website_intake_submission(uuid,uuid,text,timestamptz) from service_role;
update public.website_intake_endpoints set enabled=false,updated_at=now() where enabled;
update public.website_intake_submissions set status='failed',failure_category='rollback-contained',completed_at=coalesce(completed_at,now()),updated_at=now() where status='processing';
update public.website_response_slas set status='cancelled' where status='open';
comment on table public.website_intake_submissions is
  'CONTAINED: website intake entry points are revoked; submissions, attribution, consent, and SLA evidence are retained.';
commit;
