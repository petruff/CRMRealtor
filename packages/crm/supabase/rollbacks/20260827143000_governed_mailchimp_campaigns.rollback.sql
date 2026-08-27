-- Emergency containment rollback for Story 4.5.
-- Preserve campaign drafts, approvals, and receipts while disabling every
-- campaign mutation and provider execution entry point.
begin;

revoke execute on function public.create_mailchimp_campaign_draft(
  uuid,text,text,text,text,text,text,text,text,text,text,uuid,timestamptz
) from authenticated;
revoke execute on function public.update_mailchimp_campaign_draft(
  uuid,integer,text,text,text,text,text,text,text,text,text,text,uuid,timestamptz
) from authenticated;
revoke execute on function public.approve_mailchimp_campaign_action(
  uuid,integer,text,text,text,uuid,timestamptz
) from authenticated;
revoke execute on function public.claim_mailchimp_campaign_execution(
  uuid,text,uuid,timestamptz
) from service_role;
revoke execute on function public.record_mailchimp_campaign_provider_result(
  uuid,text,text,text,text,text,text,uuid,uuid,timestamptz
) from service_role;

do $$
begin
  if has_function_privilege(
       'authenticated',
       'public.create_mailchimp_campaign_draft(uuid,text,text,text,text,text,text,text,text,text,text,uuid,timestamptz)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.approve_mailchimp_campaign_action(uuid,integer,text,text,text,uuid,timestamptz)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.claim_mailchimp_campaign_execution(uuid,text,uuid,timestamptz)',
       'EXECUTE'
     ) then
    raise exception 'campaign containment failed: an execution privilege remains';
  end if;
end;
$$;

commit;
