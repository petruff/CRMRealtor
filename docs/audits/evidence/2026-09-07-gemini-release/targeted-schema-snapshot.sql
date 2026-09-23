-- TARGETED SCHEMA SNAPSHOT ONLY. This is one catalog/history SELECT, not a backup,
-- a restore script, a migration, or a recoverability assertion. Run before any
-- pending migration, retain the complete JSON rows in a protected artifact, and
-- hash that artifact. Re-run after adoption/recovery for catalog comparison.
-- No application rows, credentials, tokens, vault values, password columns,
-- provider envelopes, raw migration statements, or arbitrary settings are read.
-- Actual allowlisted function definitions are required for remote-equivalent
-- recovery. Treat definitions as protected code and inspect before publication.
-- Requires the observed Supabase migration-history table and PostgreSQL >= 14.
WITH RECURSIVE
wanted_functions(signature) AS (VALUES
 ('public.is_valid_contact_conversion_payload(jsonb,boolean)'),
 ('public.is_valid_incomplete_conversion_plan(jsonb)'),
 ('public.create_connector_action_intent(uuid,text,text,uuid,text,uuid,integer,jsonb,uuid)'),
 ('public.revise_connector_action_intent(uuid,integer,text,uuid,text,uuid,integer,jsonb,uuid)'),
 ('public.approve_and_enqueue_connector_action(uuid,integer,text,text,uuid,timestamptz,integer)'),
 ('public.create_connector_oauth_transaction(uuid,uuid,text,text,text,text[],uuid,uuid,text,text,text,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz)'),
 ('public.resolve_contact_import_identity(uuid,text,text,text,text)'),
 ('public.register_and_apply_twilio_callback(text,text,text,text,text,text,text,text,public.twilio_callback_kind,text,public.texting_keyword_class,text,text,text,jsonb,timestamptz,timestamptz,uuid)'),
 ('public.record_omnix_inbound_response_intelligence(uuid,uuid,bigint,text,text,text,text,text,text,text,text,text,text[],timestamptz)'),
 ('public.transition_omnix_nurture_plan(uuid,uuid,integer,text,timestamptz,text,uuid,text,timestamptz)'),
 ('public.reject_meeting_brief_mutation()'),
 ('public.guard_omnix_proposal_event_mutation()'),
 ('public.create_meeting_brief_snapshot(uuid,uuid,jsonb)'),
 ('public.save_capture_outcome(uuid,uuid,jsonb,integer,text)'),
 ('public.append_capture_outcome_note(uuid,uuid,uuid,integer,uuid,text,text,timestamptz)'),
 ('public.capture_operation_child_payload(text,jsonb)'),
 ('public.capture_calendar_payload_hash(uuid,jsonb)'),
 ('public.create_capture_calendar_intent(uuid,integer,uuid,text,uuid,text,uuid,integer,jsonb,uuid)')
), wanted_relations(name) AS (VALUES
 ('public.meeting_brief_snapshots'),('public.capture_outcomes'),
 ('public.capture_outcome_versions'),('public.capture_outcome_note_receipts'),
 ('public.capture_calendar_intent_receipts'),('public.capture_run_telemetry'),
 ('public.omnix_nurture_plan_events'),('public.data_export_receipts'),
 ('public.omnix_nurture_plans'),('public.omnix_action_proposals'),
 ('public.omnix_action_proposal_versions'),('public.connector_action_intents'),
 ('public.connector_receipt_events'),('public.notes'),('public.activity_events'),
 ('public.tasks'),('public.contacts'),('public.workspace_members'),('public.workspaces')
), pending(version) AS (VALUES
 ('20260901180000'),('20260907120000'),('20260907121000'),
 ('20260907122000'),('20260907130000'),('20260907131000'),
 ('20260907132000'),('20260907133000'),('20260907140000')
), primary_functions(oid) AS (
 SELECT to_regprocedure(signature)::oid FROM wanted_functions WHERE to_regprocedure(signature) IS NOT NULL
 UNION SELECT evtfoid FROM pg_event_trigger
 UNION SELECT t.tgfoid FROM pg_trigger t JOIN wanted_relations r ON t.tgrelid=to_regclass(r.name) WHERE NOT t.tgisinternal
), function_references(schema_name,object_name) AS (
 SELECT DISTINCT (r.parts)[1],(r.parts)[2]
 FROM primary_functions f JOIN pg_proc p ON p.oid=f.oid
 CROSS JOIN LATERAL regexp_matches(pg_get_functiondef(p.oid),'\m(public|connector_private|auth|extensions)\.([A-Za-z_][A-Za-z0-9_]*)','g') AS r(parts)
), functions(oid) AS (
 SELECT oid FROM primary_functions
 UNION SELECT p.oid FROM function_references r JOIN pg_namespace n ON n.nspname=r.schema_name JOIN pg_proc p ON p.pronamespace=n.oid AND p.proname=r.object_name WHERE p.prokind='f'
), relation_seeds(oid) AS (
 SELECT to_regclass(name)::oid FROM wanted_relations WHERE to_regclass(name) IS NOT NULL
 UNION SELECT c.oid FROM function_references r JOIN pg_namespace n ON n.nspname=r.schema_name JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=r.object_name
 UNION SELECT d.refobjid FROM pg_depend d JOIN functions f ON f.oid=d.objid WHERE d.classid='pg_proc'::regclass AND d.refclassid='pg_class'::regclass
), relations(oid) AS (
 SELECT oid FROM relation_seeds
 UNION SELECT c.confrelid FROM pg_constraint c JOIN relations r ON r.oid=c.conrelid WHERE c.contype='f' AND c.confrelid<>0
), objects AS (
 SELECT 'metadata'::text AS category,'snapshot'::text AS identity,jsonb_build_object(
   'schema','omnix-targeted-schema-snapshot.v1','capturedAt',statement_timestamp(),
   'database',current_database(),'sessionUser',session_user,'currentUser',current_user,
   'serverVersion',current_setting('server_version'),'transactionReadOnly',current_setting('transaction_read_only'),
   'searchPath',current_setting('search_path'),'rowSecurity',current_setting('row_security'),
   'checkFunctionBodies',current_setting('check_function_bodies'),'standardConformingStrings',current_setting('standard_conforming_strings'),
   'purpose','Protected schema recovery preparation; no customer data backup',
   'functionCount',(SELECT count(*) FROM functions),'relationCount',(SELECT count(*) FROM relations)
 ) AS detail
 UNION ALL SELECT 'required-function',signature,jsonb_build_object('present',to_regprocedure(signature) IS NOT NULL) FROM wanted_functions
 UNION ALL SELECT 'required-relation',name,jsonb_build_object('present',to_regclass(name) IS NOT NULL) FROM wanted_relations
 UNION ALL SELECT 'pending-history',p.version,jsonb_build_object('alreadyRecorded',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations m WHERE m.version=p.version)) FROM pending p
 UNION ALL SELECT 'migration-history',m.version,jsonb_build_object(
   'version',m.version,'name',to_jsonb(m)->>'name',
   'statementCount',CASE WHEN jsonb_typeof(to_jsonb(m)->'statements')='array' THEN jsonb_array_length(to_jsonb(m)->'statements') ELSE NULL END,
   'statementsJsonSha256',CASE WHEN to_jsonb(m)->'statements' IS NOT NULL THEN encode(sha256(convert_to((to_jsonb(m)->'statements')::text,'UTF8')),'hex') ELSE NULL END
 ) FROM supabase_migrations.schema_migrations m
 UNION ALL SELECT 'function',p.oid::regprocedure::text,jsonb_build_object(
   'definition',pg_get_functiondef(p.oid),'definitionSha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
   'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'effectiveAcl',coalesce(p.proacl,acldefault('f',p.proowner))::text,
   'securityDefiner',p.prosecdef,'settings',p.proconfig,'language',l.lanname,'strict',p.proisstrict,
   'volatility',p.provolatile,'parallel',p.proparallel,'leakproof',p.proleakproof,
   'arguments',pg_get_function_arguments(p.oid),'identityArguments',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),
   'execute',jsonb_build_object('anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service_role',has_function_privilege('service_role',p.oid,'EXECUTE'))
 ) FROM functions f JOIN pg_proc p ON p.oid=f.oid JOIN pg_language l ON l.oid=p.prolang
 UNION ALL SELECT 'relation',c.oid::regclass::text,jsonb_build_object(
   'owner',pg_get_userbyid(c.relowner),'kind',c.relkind,'persistence',c.relpersistence,
   'acl',c.relacl::text,'rowSecurity',c.relrowsecurity,'forceRowSecurity',c.relforcerowsecurity,
   'replicaIdentity',c.relreplident,'options',c.reloptions,'tablespace',ts.spcname,
   'columns',(SELECT coalesce(jsonb_agg(jsonb_build_object('position',a.attnum,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'storage',a.attstorage,'acl',a.attacl::text,'collation',CASE WHEN a.attcollation<>0 THEN a.attcollation::regcollation::text END,'default',pg_get_expr(ad.adbin,ad.adrelid)) ORDER BY a.attnum),'[]'::jsonb) FROM pg_attribute a LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
   'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',k.conname,'type',k.contype,'definition',pg_get_constraintdef(k.oid,true),'validated',k.convalidated,'deferrable',k.condeferrable,'deferred',k.condeferred) ORDER BY k.conname),'[]'::jsonb) FROM pg_constraint k WHERE k.conrelid=c.oid),
   'indexes',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',i.indexrelid::regclass::text,'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready) ORDER BY i.indexrelid::regclass::text),'[]'::jsonb) FROM pg_index i WHERE i.indrelid=c.oid),
   'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled,'internal',t.tgisinternal,'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname),'[]'::jsonb) FROM pg_trigger t WHERE t.tgrelid=c.oid),
   'policies',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,'roles',(SELECT jsonb_agg(CASE WHEN role_oid=0 THEN 'PUBLIC' ELSE pg_get_userbyid(role_oid) END ORDER BY role_oid) FROM unnest(p.polroles) role_oid),'using',pg_get_expr(p.polqual,p.polrelid),'withCheck',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname),'[]'::jsonb) FROM pg_policy p WHERE p.polrelid=c.oid)
 ) FROM relations r JOIN pg_class c ON c.oid=r.oid LEFT JOIN pg_tablespace ts ON ts.oid=c.reltablespace
 UNION ALL SELECT 'effective-table-acl',c.oid::regclass::text||':'||actor,jsonb_object_agg(permission,has_table_privilege(actor,c.oid,permission) ORDER BY permission)
 FROM relations r JOIN pg_class c ON c.oid=r.oid CROSS JOIN unnest(array['anon','authenticated','service_role']) actor CROSS JOIN unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) permission
 WHERE c.relkind IN ('r','p','v','m','f') GROUP BY c.oid,actor
 UNION ALL SELECT 'enum',t.oid::regtype::text,jsonb_build_object('owner',pg_get_userbyid(t.typowner),'acl',t.typacl::text,'labels',jsonb_agg(jsonb_build_object('label',e.enumlabel,'sortOrder',e.enumsortorder) ORDER BY e.enumsortorder))
 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' GROUP BY t.oid
 UNION ALL SELECT 'schema',n.nspname,jsonb_build_object('owner',pg_get_userbyid(n.nspowner),'acl',n.nspacl::text) FROM pg_namespace n WHERE n.nspname IN ('public','auth','connector_private','extensions','supabase_migrations')
 UNION ALL SELECT 'default-acl',d.oid::text,jsonb_build_object('owner',pg_get_userbyid(d.defaclrole),'schema',n.nspname,'objectType',d.defaclobjtype,'acl',d.defaclacl::text) FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE d.defaclnamespace=0 OR n.nspname IN ('public','auth','connector_private','extensions')
 UNION ALL SELECT 'extension',e.extname,jsonb_build_object('version',e.extversion,'schema',n.nspname,'owner',pg_get_userbyid(e.extowner),'relocatable',e.extrelocatable) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
 UNION ALL SELECT 'event-trigger',e.evtname,jsonb_build_object('event',e.evtevent,'owner',pg_get_userbyid(e.evtowner),'function',e.evtfoid::regprocedure::text,'enabled',e.evtenabled,'tags',e.evttags) FROM pg_event_trigger e
 UNION ALL SELECT 'role',r.rolname,jsonb_build_object('superuser',r.rolsuper,'inherit',r.rolinherit,'createRole',r.rolcreaterole,'createDb',r.rolcreatedb,'canLogin',r.rolcanlogin,'replication',r.rolreplication,'bypassRls',r.rolbypassrls) FROM pg_roles r
 UNION ALL SELECT 'role-membership',a.roleid::text||':'||a.member::text,jsonb_build_object('role',pg_get_userbyid(a.roleid),'member',pg_get_userbyid(a.member),'grantor',pg_get_userbyid(a.grantor),'adminOption',a.admin_option) FROM pg_auth_members a
 UNION ALL SELECT 'dependency',d.classid::regclass::text||':'||d.objid::text||':'||d.refclassid::regclass::text||':'||d.refobjid::text||':'||d.objsubid::text||':'||d.refobjsubid::text,
 jsonb_build_object('object',pg_describe_object(d.classid,d.objid,d.objsubid),'dependsOn',pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid),'type',d.deptype)
 FROM pg_depend d WHERE (d.classid='pg_proc'::regclass AND d.objid IN (SELECT oid FROM functions)) OR (d.classid='pg_class'::regclass AND d.objid IN (SELECT oid FROM relations))
)
SELECT category,identity,detail FROM objects ORDER BY category,identity;
