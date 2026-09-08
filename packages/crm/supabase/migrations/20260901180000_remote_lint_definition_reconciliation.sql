begin;

create extension if not exists plpgsql_check with schema extensions;

create or replace function pg_temp.replace_function_fragment_flexible(target_signature text,target_pattern text,replacement text)
returns void language plpgsql as $$
declare definition text; reconciled text;
begin
  if to_regprocedure(target_signature) is null then raise exception 'remote lint reconciliation target is missing: %',target_signature; end if;
  definition:=pg_get_functiondef(to_regprocedure(target_signature));
  reconciled:=regexp_replace(definition,target_pattern,replacement,'g');
  if reconciled<>definition then execute reconciled; end if;
end;
$$;

-- Dollar-quoted patterns contain literal single quotes, not SQL string escapes.
-- Replace assignments before declarations so each intermediate definition compiles.
select pg_temp.replace_function_fragment_flexible('public.is_valid_contact_conversion_payload(jsonb,boolean)',$pattern$parsed_uuid[[:space:]]*:=[[:space:]]*\(target->>'referredById'\)::uuid[[:space:]]*;$pattern$,$replacement$perform (target->>'referredById')::uuid;$replacement$);
select pg_temp.replace_function_fragment_flexible('public.is_valid_contact_conversion_payload(jsonb,boolean)',$pattern$parsed_timestamp[[:space:]]*:=[[:space:]]*\(target->>'lastContactedAt'\)::timestamptz[[:space:]]*;$pattern$,$replacement$perform (target->>'lastContactedAt')::timestamptz;$replacement$);
select pg_temp.replace_function_fragment_flexible('public.is_valid_contact_conversion_payload(jsonb,boolean)',$pattern$\mparsed_uuid\M[[:space:]]+uuid[[:space:]]*;$pattern$,'');
select pg_temp.replace_function_fragment_flexible('public.is_valid_contact_conversion_payload(jsonb,boolean)',$pattern$\mparsed_timestamp\M[[:space:]]+timestamptz[[:space:]]*;$pattern$,'');
select pg_temp.replace_function_fragment_flexible('public.is_valid_incomplete_conversion_plan(jsonb)',$pattern$matched_contact_id[[:space:]]*:=[[:space:]]*\(target->>'matchedContactId'\)::uuid[[:space:]]*;$pattern$,$replacement$perform (target->>'matchedContactId')::uuid;$replacement$);
select pg_temp.replace_function_fragment_flexible('public.is_valid_incomplete_conversion_plan(jsonb)',$pattern$\mmatched_contact_id\M[[:space:]]+uuid[[:space:]]*;$pattern$,'');

select pg_temp.replace_function_fragment_flexible('public.create_connector_action_intent(uuid,text,text,uuid,text,uuid,integer,jsonb,uuid)',$pattern$\mtarget_payload\M[[:space:]]+connector_private\.connector_payload_envelopes%rowtype[[:space:]]*;$pattern$,'');
select pg_temp.replace_function_fragment_flexible('public.create_connector_action_intent(uuid,text,text,uuid,text,uuid,integer,jsonb,uuid)',$pattern$\mtarget_policy\M[[:space:]]+public\.connector_automation_policies%rowtype[[:space:]]*;$pattern$,'');
select pg_temp.replace_function_fragment_flexible('public.create_connector_action_intent(uuid,text,text,uuid,text,uuid,integer,jsonb,uuid)',$pattern$select[[:space:]]+payload\.\*[[:space:]]+into[[:space:]]+target_payload$pattern$,'perform 1');
select pg_temp.replace_function_fragment_flexible('public.create_connector_action_intent(uuid,text,text,uuid,text,uuid,integer,jsonb,uuid)',$pattern$select[[:space:]]+policy\.\*[[:space:]]+into[[:space:]]+target_policy$pattern$,'perform 1');
select pg_temp.replace_function_fragment_flexible('public.revise_connector_action_intent(uuid,integer,text,uuid,text,uuid,integer,jsonb,uuid)',$pattern$\mtarget_payload\M[[:space:]]+connector_private\.connector_payload_envelopes%rowtype[[:space:]]*;$pattern$,'');
select pg_temp.replace_function_fragment_flexible('public.revise_connector_action_intent(uuid,integer,text,uuid,text,uuid,integer,jsonb,uuid)',$pattern$\mtarget_policy\M[[:space:]]+public\.connector_automation_policies%rowtype[[:space:]]*;$pattern$,'');
select pg_temp.replace_function_fragment_flexible('public.revise_connector_action_intent(uuid,integer,text,uuid,text,uuid,integer,jsonb,uuid)',$pattern$select[[:space:]]+payload\.\*[[:space:]]+into[[:space:]]+target_payload$pattern$,'perform 1');
select pg_temp.replace_function_fragment_flexible('public.revise_connector_action_intent(uuid,integer,text,uuid,text,uuid,integer,jsonb,uuid)',$pattern$select[[:space:]]+policy\.\*[[:space:]]+into[[:space:]]+target_policy$pattern$,'perform 1');

select pg_temp.replace_function_fragment_flexible('public.approve_and_enqueue_connector_action(uuid,integer,text,text,uuid,timestamptz,integer)',$pattern$returning[[:space:]]+\*[[:space:]]+into[[:space:]]+approval_receipt$pattern$,'');
select pg_temp.replace_function_fragment_flexible('public.approve_and_enqueue_connector_action(uuid,integer,text,text,uuid,timestamptz,integer)',$pattern$\mapproval_receipt\M[[:space:]]+public\.connector_receipt_events%rowtype[[:space:]]*;$pattern$,'');
select pg_temp.replace_function_fragment_flexible('public.create_connector_oauth_transaction(uuid,uuid,text,text,text,text[],uuid,uuid,text,text,text,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz)',$pattern$\mtarget_membership\M[[:space:]]+public\.workspace_members%rowtype[[:space:]]*;$pattern$,'');
select pg_temp.replace_function_fragment_flexible('public.create_connector_oauth_transaction(uuid,uuid,text,text,text,text[],uuid,uuid,text,text,text,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz)',$pattern$select[[:space:]]+membership\.\*[[:space:]]+into[[:space:]]+target_membership$pattern$,'perform 1');
select pg_temp.replace_function_fragment_flexible('public.resolve_contact_import_identity(uuid,text,text,text,text)',$pattern$\mactor\M[[:space:]]+public\.workspace_members%rowtype[[:space:]]*;$pattern$,'');
select pg_temp.replace_function_fragment_flexible('public.resolve_contact_import_identity(uuid,text,text,text,text)',$pattern$actor[[:space:]]*:=[[:space:]]*public\.current_rich_contact_actor\(target_workspace_id\)[[:space:]]*;$pattern$,'perform public.current_rich_contact_actor(target_workspace_id);');
select pg_temp.replace_function_fragment_flexible('public.register_and_apply_twilio_callback(text,text,text,text,text,text,text,text,public.twilio_callback_kind,text,public.texting_keyword_class,text,text,text,jsonb,timestamptz,timestamptz,uuid)',$pattern$returning[[:space:]]+\*[[:space:]]+into[[:space:]]+callback_receipt$pattern$,'');
select pg_temp.replace_function_fragment_flexible('public.register_and_apply_twilio_callback(text,text,text,text,text,text,text,text,public.twilio_callback_kind,text,public.texting_keyword_class,text,text,text,jsonb,timestamptz,timestamptz,uuid)',$pattern$\mcallback_receipt\M[[:space:]]+public\.connector_receipt_events%rowtype[[:space:]]*;$pattern$,'');
do $target_resource_reconcile$
declare
  target_signature regprocedure := 'public.record_omnix_inbound_response_intelligence(uuid,uuid,bigint,text,text,text,text,text,text,text,text,text,text[],timestamptz)'::regprocedure;
  definition text := pg_get_functiondef(target_signature);
  canonical_select text;
  reconciled text;
begin
  if definition ~ $pattern$\mtarget_resource\M[[:space:]]+[A-Za-z0-9_.]+%rowtype[[:space:]]*;$pattern$ then
    canonical_select := regexp_replace(
      definition,
      $pattern$select[[:space:]]+\*[[:space:]]+into[[:space:]]+strict[[:space:]]+target_resource[[:space:]]+from[[:space:]]+connector_private\.google_gmail_resources[[:space:]]+where[[:space:]]+workspace_id=target_job\.workspace_id[[:space:]]+and[[:space:]]+connection_id=target_job\.connection_id[[:space:]]+and[[:space:]]+resource_hash=target_resource_hash[[:space:]]+and[[:space:]]+direction='incoming'[[:space:]]+and[[:space:]]+contact_id[[:space:]]+is[[:space:]]+not[[:space:]]+null;$pattern$,
      $replacement$perform 1 from connector_private.google_gmail_resources
    where workspace_id=target_job.workspace_id and connection_id=target_job.connection_id
      and resource_hash=target_resource_hash and direction='incoming' and contact_id is not null;
  if not found then
    raise exception 'authorized Gmail resource was not found' using errcode='P0002';
  end if;$replacement$
    );
    if canonical_select = definition then
      raise exception 'remote lint reconciliation could not canonicalize target_resource lookup';
    end if;
    reconciled := regexp_replace(
      canonical_select,
      $pattern$\mtarget_resource\M[[:space:]]+[A-Za-z0-9_.]+%rowtype[[:space:]]*;$pattern$,
      ''
    );
    execute reconciled;
  end if;
end;
$target_resource_reconcile$;

do $$
declare warning_count integer;
begin
  select count(*)::integer into warning_count
  from unnest(array[
    'public.is_valid_contact_conversion_payload(jsonb,boolean)','public.is_valid_incomplete_conversion_plan(jsonb)',
    'public.create_connector_action_intent(uuid,text,text,uuid,text,uuid,integer,jsonb,uuid)','public.revise_connector_action_intent(uuid,integer,text,uuid,text,uuid,integer,jsonb,uuid)',
    'public.approve_and_enqueue_connector_action(uuid,integer,text,text,uuid,timestamptz,integer)','public.create_connector_oauth_transaction(uuid,uuid,text,text,text,text[],uuid,uuid,text,text,text,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz)',
    'public.resolve_contact_import_identity(uuid,text,text,text,text)','public.register_and_apply_twilio_callback(text,text,text,text,text,text,text,text,public.twilio_callback_kind,text,public.texting_keyword_class,text,text,text,jsonb,timestamptz,timestamptz,uuid)',
    'public.record_omnix_inbound_response_intelligence(uuid,uuid,bigint,text,text,text,text,text,text,text,text,text,text[],timestamptz)'
  ]) signature cross join lateral extensions.plpgsql_check_function(signature::regprocedure) issue
  where issue::text like 'warning%';
  if warning_count<>0 then raise exception 'remote lint reconciliation left % warning(s)',warning_count; end if;
end;
$$;

commit;
