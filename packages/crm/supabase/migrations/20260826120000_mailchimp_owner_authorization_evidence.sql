-- Story 6.10: fail closed unless the latest Mailchimp OAuth completion is
-- bound to the currently active canonical owner and the current connection.
begin;

create or replace function public.read_mailchimp_owner_authorization_evidence(
  target_connection_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_connection public.connector_connections%rowtype;
  latest_completion public.connector_receipt_events%rowtype;
  completion_transaction connector_private.connector_oauth_transactions%rowtype;
  completion_transaction_id text;
begin
  if target_connection_id is null then
    return false;
  end if;

  select connection.* into target_connection
  from public.connector_connections connection
  where connection.id = target_connection_id
    and connection.provider = 'mailchimp';

  if not found then
    return false;
  end if;

  perform public.connector_current_membership(target_connection.workspace_id, false);

  if target_connection.status <> 'active'
     or target_connection.provider_account_key_hash is null
     or target_connection.granted_scopes is distinct from
        array['audience.sync','audience.reconcile']::text[] then
    return false;
  end if;

  select receipt.* into latest_completion
  from public.connector_receipt_events receipt
  where receipt.workspace_id = target_connection.workspace_id
    and receipt.connection_id = target_connection.id
    and receipt.provider = 'mailchimp'
    and receipt.event_type = 'oauth.completed'
  order by receipt.occurred_at desc, receipt.id desc
  limit 1;

  if not found
     or latest_completion.event_key !~ '^mailchimp[.]oauth[.]completed:[0-9a-f-]{36}$' then
    return false;
  end if;

  completion_transaction_id := latest_completion.redacted_metadata->>'transactionId';
  if completion_transaction_id is null
     or completion_transaction_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;

  select oauth_transaction.* into completion_transaction
  from connector_private.connector_oauth_transactions oauth_transaction
  where oauth_transaction.id = completion_transaction_id::uuid
    and oauth_transaction.workspace_id = target_connection.workspace_id
    and oauth_transaction.connection_id = target_connection.id
    and oauth_transaction.provider = 'mailchimp'
    and oauth_transaction.consumed_at is not null;

  if not found
     or completion_transaction.requested_scope_bundle <> 'mailchimp.audience-sync.v1'
     or completion_transaction.requested_scopes is distinct from target_connection.granted_scopes
     or latest_completion.occurred_at < completion_transaction.consumed_at
     or latest_completion.redacted_metadata->>'accountIdHash'
        is distinct from target_connection.provider_account_key_hash
     or latest_completion.redacted_metadata->'grantedScopes'
        is distinct from to_jsonb(target_connection.granted_scopes) then
    return false;
  end if;

  return (
    select count(*) = 1
      and bool_and(owner_membership.id = completion_transaction.membership_id)
      and bool_and(owner_membership.user_id = completion_transaction.actor_user_id)
    from public.workspace_members owner_membership
    where owner_membership.workspace_id = target_connection.workspace_id
      and owner_membership.role = 'owner'
      and owner_membership.status = 'active'
  );
end;
$$;

revoke all on function public.read_mailchimp_owner_authorization_evidence(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_mailchimp_owner_authorization_evidence(uuid)
  to authenticated;

comment on function public.read_mailchimp_owner_authorization_evidence(uuid) is
  'Read-only current Mailchimp authorization proof. Legacy creator identity and unbound OAuth receipts fail closed.';

commit;
