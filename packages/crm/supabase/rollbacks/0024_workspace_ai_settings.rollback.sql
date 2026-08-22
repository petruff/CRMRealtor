begin;
drop function if exists public.read_workspace_ai_secret_envelope(uuid,uuid,uuid);
drop function if exists public.remove_workspace_ai_configuration(uuid,integer,timestamptz);
drop function if exists public.set_workspace_ai_enabled(uuid,integer,boolean,timestamptz);
drop function if exists public.save_workspace_ai_configuration(uuid,text,boolean,text,integer,jsonb,timestamptz);
drop table if exists connector_private.workspace_ai_secret_envelopes;
drop table if exists public.workspace_ai_configurations;
commit;
