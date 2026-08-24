begin;

drop function if exists public.enrich_mailchimp_reconciliation_members(
  uuid,uuid,bigint,text,jsonb,timestamptz
);

drop function if exists public.quarantine_mailchimp_identity_review(
  uuid,uuid,uuid,text,text,text,text,text,uuid,timestamptz
);

alter function public.quarantine_mailchimp_identity_review_0012(
  uuid,uuid,uuid,text,text,text,text,text,uuid,timestamptz
) rename to quarantine_mailchimp_identity_review;

revoke all on function public.quarantine_mailchimp_identity_review(
  uuid,uuid,uuid,text,text,text,text,text,uuid,timestamptz
) from public,anon,authenticated,service_role;

-- Enriched identity fields remain valid contact evidence after rollback.
-- This rollback removes future mutation authority without deleting reviewed data.

commit;
