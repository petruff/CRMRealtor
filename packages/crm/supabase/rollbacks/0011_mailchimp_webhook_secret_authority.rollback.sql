-- Manual rollback for 0011_mailchimp_webhook_secret_authority.sql.
-- PRE-WRITE ONLY. After any endpoint/signing-secret/baseline evidence write,
-- stop webhook ingress/workers and use managed PITR or a reviewed forward fix.

begin;

do $$
begin
  if exists (
    select 1
    from connector_private.connector_webhook_bindings binding
    where binding.remote_webhook_id_hash is not null
  ) or exists (
    select 1
    from connector_private.connector_connection_secrets secret
    where secret.secret_type = 'mailchimp-webhook-signing-secret'
  ) or exists (
    select 1
    from public.mailchimp_sync_evidence evidence
    where evidence.origin = 'baseline-reconciliation'
  ) then
    raise exception '0011 rollback refused after Mailchimp webhook/baseline authority writes; use PITR or a reviewed forward migration'
      using errcode = '55000';
  end if;
end;
$$;

drop function if exists public.register_mailchimp_webhook_event_encrypted(
  uuid,text,text,text,boolean,boolean,text,bytea,bytea,bytea,bytea,bytea,bytea,
  text,text,uuid,timestamptz,integer
);
drop function if exists public.apply_mailchimp_baseline_member(
  uuid,text,text,text,text,text,text,uuid,timestamptz
);
drop function if exists public.read_mailchimp_webhook_setup_state(uuid);
drop function if exists public.read_mailchimp_webhook_signing_secret(
  text,timestamptz
);
drop function if exists public.bind_mailchimp_webhook_secret(
  uuid,text,integer,bytea,bytea,bytea,bytea,bytea,bytea,text,text,text,
  timestamptz,uuid
);

-- Restore the 0010 grant only when rolling back before 0011 is used. The
-- two-step RPC must remain revoked whenever 0011 is present.
grant execute on function public.register_mailchimp_webhook_event(
  uuid,text,text,text,boolean,boolean,uuid,text,uuid,timestamptz,integer
) to service_role;

alter table public.mailchimp_sync_evidence
  drop constraint mailchimp_sync_evidence_origin;
alter table public.mailchimp_sync_evidence
  add constraint mailchimp_sync_evidence_origin check (
    origin in ('mailchimp-webhook','outbound-job','reconciliation')
  );

alter table connector_private.connector_webhook_bindings
  drop constraint connector_webhook_bindings_remote_webhook_id_hash,
  drop column remote_webhook_id_hash,
  drop column updated_at;

commit;
