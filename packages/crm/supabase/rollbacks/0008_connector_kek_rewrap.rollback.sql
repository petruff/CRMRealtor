-- Omnix Story 3.5 KEK rewrap rollback — PRE-WRITE WINDOW ONLY.
--
-- A completed rewrap has replaced the only persisted wrapped DEK. This script
-- therefore refuses to run after completion evidence exists. Keep old and new
-- KEKs and use a forward rotation or PITR after that boundary.

begin;

do $$
begin
  if exists (
    select 1
    from connector_private.connector_rewrap_claims claim
    where claim.completed_at is not null
       or claim.completed_wrapped_dek_hash is not null
  ) then
    raise exception
      '0008 rollback is restricted to the pre-write window; completed KEK rewrap evidence exists';
  end if;
end;
$$;

drop function public.cas_rewrap_connector_envelope(
  uuid, uuid, bigint, bytea, bytea, bytea, text, text, timestamptz
);
drop function public.claim_connector_kek_rewrap_candidates(
  uuid, text, text, integer, integer, timestamptz
);
drop function public.list_connector_kek_version_counts(timestamptz);

drop index connector_private.connector_sync_cursors_active_kek_rewrap_idx;
drop index connector_private.connector_oauth_transactions_active_kek_rewrap_idx;
drop index connector_private.connector_payload_envelopes_active_kek_rewrap_idx;
drop table connector_private.connector_rewrap_claims;

commit;
