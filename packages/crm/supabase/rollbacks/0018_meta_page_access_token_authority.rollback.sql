-- Story 4.4 HIGH remediation / migration 0018 rollback.
-- PRE-WRITE ONLY. A Page token bind/rotation/destruction is security evidence
-- and cannot be reconstructed safely by a schema rollback.

begin;

do $$ begin
  if exists(select 1 from connector_private.meta_page_access_token_bindings)
     or exists(select 1 from connector_private.connector_payload_envelopes
       where payload_kind='meta-page-access-token') then
    raise exception using errcode='55000',
      message='0018 rollback refused: Page-token authority exists; preserve evidence and use PITR or a reviewed forward remediation';
  end if;
end $$;

drop trigger if exists connector_connections_destroy_meta_page_tokens on public.connector_connections;
drop trigger if exists meta_asset_bindings_destroy_page_token on public.meta_asset_bindings;
drop trigger if exists meta_asset_bindings_require_page_token on public.meta_asset_bindings;

drop function public.destroy_meta_page_tokens_on_confirmed_disconnect();
drop function public.destroy_meta_page_token_on_asset_removal();
drop function public.guard_meta_selected_page_token();
drop function public.read_meta_page_subscription_authority(uuid,text,uuid,uuid,timestamptz);
drop function public.bind_meta_facebook_page_access_tokens(uuid,text,text,jsonb,timestamptz);
drop function public.read_meta_page_token_setup_state(uuid,uuid,uuid);
drop function connector_private.destroy_meta_page_token(uuid,timestamptz);
drop function connector_private.meta_page_token_payload_json(
  connector_private.meta_page_access_token_bindings,
  connector_private.connector_payload_envelopes
);

drop table connector_private.meta_page_access_token_bindings;

commit;
