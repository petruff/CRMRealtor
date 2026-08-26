begin;

select plan(6);

select has_function(
  'public',
  'repair_google_connection_capabilities',
  array['uuid', 'timestamp with time zone'],
  'Google capability self-repair RPC exists'
);

select function_returns(
  'public',
  'repair_google_connection_capabilities',
  array['uuid', 'timestamp with time zone'],
  'jsonb',
  'Google capability self-repair returns the redacted capability projection'
);

select function_privs_are(
  'public',
  'repair_google_connection_capabilities',
  array['uuid', 'timestamp with time zone'],
  'authenticated',
  array['EXECUTE'],
  'Authenticated workspace members can invoke bounded self-repair'
);

select function_privs_are(
  'public',
  'repair_google_connection_capabilities',
  array['uuid', 'timestamp with time zone'],
  'anon',
  array[]::text[],
  'Anonymous callers cannot invoke Google capability self-repair'
);

select ok(
  pg_get_functiondef('public.repair_google_connection_capabilities(uuid,timestamp with time zone)'::regprocedure)
    like '%connector_private.repair_google_connection_capabilities%',
  'Public self-repair delegates to a non-public evidence verifier'
);

select ok(
  pg_get_functiondef('connector_private.repair_google_connection_capabilities(uuid,timestamp with time zone)'::regprocedure)
    like '%public.google_oauth_completions%',
  'Self-repair is anchored to immutable Google OAuth completion evidence'
);

select * from finish();

rollback;
