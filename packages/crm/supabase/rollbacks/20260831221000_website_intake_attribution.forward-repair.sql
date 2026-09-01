begin;
grant execute on function public.configure_website_intake_endpoint(uuid,uuid,text,text,text[],integer,integer,uuid,timestamptz) to authenticated;
grant execute on function public.claim_website_intake_submission(uuid,text,text,text,text,text,text,timestamptz),public.review_website_intake_submission(uuid,uuid,jsonb,jsonb,jsonb,text,timestamptz),public.finalize_website_intake_submission(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,timestamptz),public.fail_website_intake_submission(uuid,uuid,text,timestamptz) to service_role;
comment on table public.website_intake_submissions is
  'Immutable raw website lead submissions with review and attribution lifecycle.';
commit;
