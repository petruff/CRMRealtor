-- PRE-USE ONLY: refuse after keys or operational evidence exist.
begin;
do $$ begin if exists(select 1 from public.operational_api_keys) or exists(select 1 from public.operational_api_receipts) or exists(select 1 from public.data_mapping_profiles) or exists(select 1 from public.data_import_runs) or exists(select 1 from public.data_export_receipts) or exists(select 1 from public.generic_webhook_endpoints) or exists(select 1 from public.generic_webhook_receipts) then raise exception '0023 rollback refused: operational data or evidence exists' using errcode='55000'; end if; end $$;
drop function if exists public.authenticate_operational_api_key(text,text,timestamptz);
drop function if exists public.execute_operational_contacts_api(text,text,text,jsonb,text,uuid,timestamptz);
drop function if exists public.create_generic_webhook_endpoint(uuid,text,text,text,text,uuid,timestamptz);
drop function if exists public.rotate_generic_webhook_secret(uuid,text,timestamptz,uuid,timestamptz);
drop function if exists public.resolve_generic_webhook_authority(text,timestamptz);
drop function if exists public.record_generic_webhook_delivery(uuid,text,text,boolean,integer,text,timestamptz,uuid);
drop function if exists public.revoke_operational_api_key(uuid,uuid,timestamptz);
drop function if exists public.rotate_operational_api_key(uuid,text,text,timestamptz,uuid,timestamptz);
drop function if exists public.create_operational_api_key(uuid,text,text,text,text[],timestamptz,uuid,timestamptz);
drop function if exists public.save_data_mapping_profile(uuid,text,jsonb,uuid,timestamptz);
drop function if exists public.record_data_import_run(uuid,uuid,uuid,integer,text,text,text,text,public.data_operation_outcome,jsonb,jsonb,timestamptz,timestamptz,uuid);
drop function if exists public.record_data_export_receipt(uuid,uuid,text,text,jsonb,text,integer,public.data_operation_outcome,uuid,timestamptz);
drop table public.generic_webhook_receipts,public.generic_webhook_endpoints,public.operational_api_receipts,public.operational_api_keys,public.data_export_receipts,public.data_import_row_outcomes,public.data_import_runs,public.data_mapping_profiles;
drop function public.prevent_data_portability_evidence_mutation();
drop type public.data_operation_outcome; drop type public.operational_api_key_state;
commit;
