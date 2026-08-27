-- Forward repair after Story 4.5 containment.
-- Restore only the governed RPC entry points; durable campaign evidence stays
-- intact throughout containment and recovery.
begin;

revoke all on function public.create_mailchimp_campaign_draft(
  uuid,text,text,text,text,text,text,text,text,text,text,uuid,timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.update_mailchimp_campaign_draft(
  uuid,integer,text,text,text,text,text,text,text,text,text,text,uuid,timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.approve_mailchimp_campaign_action(
  uuid,integer,text,text,text,uuid,timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.claim_mailchimp_campaign_execution(
  uuid,text,uuid,timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.record_mailchimp_campaign_provider_result(
  uuid,text,text,text,text,text,text,uuid,uuid,timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.create_mailchimp_campaign_draft(
  uuid,text,text,text,text,text,text,text,text,text,text,uuid,timestamptz
) to authenticated;
grant execute on function public.update_mailchimp_campaign_draft(
  uuid,integer,text,text,text,text,text,text,text,text,text,text,uuid,timestamptz
) to authenticated;
grant execute on function public.approve_mailchimp_campaign_action(
  uuid,integer,text,text,text,uuid,timestamptz
) to authenticated;
grant execute on function public.claim_mailchimp_campaign_execution(
  uuid,text,uuid,timestamptz
) to service_role;
grant execute on function public.record_mailchimp_campaign_provider_result(
  uuid,text,text,text,text,text,text,uuid,uuid,timestamptz
) to service_role;

do $$
begin
  if not has_function_privilege(
       'authenticated',
       'public.create_mailchimp_campaign_draft(uuid,text,text,text,text,text,text,text,text,text,text,uuid,timestamptz)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.approve_mailchimp_campaign_action(uuid,integer,text,text,text,uuid,timestamptz)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.claim_mailchimp_campaign_execution(uuid,text,uuid,timestamptz)',
       'EXECUTE'
     ) then
    raise exception 'campaign forward repair failed: an execution privilege is missing';
  end if;
end;
$$;

commit;
