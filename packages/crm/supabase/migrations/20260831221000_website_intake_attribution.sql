-- Story 9.2: signed website lead intake, attribution, consent, and response SLA.

create table public.website_intake_endpoints (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  endpoint_key text not null, display_name text not null, allowed_origins text[] not null,
  enabled boolean not null default true, rate_limit_per_minute integer not null, response_sla_minutes integer not null,
  responsible_membership_id uuid not null, created_by_membership_id uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint website_intake_endpoints_id_workspace_unique unique(id,workspace_id),
  constraint website_intake_endpoints_key_unique unique(endpoint_key),
  constraint website_intake_endpoints_responsible_fk foreign key(responsible_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  constraint website_intake_endpoints_creator_fk foreign key(created_by_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  constraint website_intake_endpoints_values check(endpoint_key~'^[A-Za-z0-9._:-]{8,128}$' and length(trim(display_name)) between 1 and 120 and cardinality(allowed_origins) between 1 and 20 and rate_limit_per_minute between 1 and 60 and response_sla_minutes between 1 and 1440)
);

create table public.website_intake_submissions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  endpoint_id uuid not null, idempotency_key text not null, request_hash text not null,
  origin text not null, ip_hash text not null, user_agent_hash text not null, support_reference text not null,
  status text not null, attempt_count integer not null default 1, contact_id uuid, task_id uuid,
  identity_outcome text, attribution_snapshot jsonb, consent_snapshot jsonb, classification_snapshot jsonb,
  response_due_at timestamptz, failure_category text, received_at timestamptz not null, completed_at timestamptz, updated_at timestamptz not null,
  constraint website_intake_submissions_id_workspace_unique unique(id,workspace_id),
  constraint website_intake_submissions_endpoint_fk foreign key(endpoint_id,workspace_id) references public.website_intake_endpoints(id,workspace_id) on delete restrict,
  constraint website_intake_submissions_contact_fk foreign key(contact_id,workspace_id) references public.contacts(id,workspace_id) on delete restrict,
  constraint website_intake_submissions_task_fk foreign key(task_id,workspace_id) references public.tasks(id,workspace_id) on delete restrict,
  constraint website_intake_submissions_replay_unique unique(endpoint_id,idempotency_key),
  constraint website_intake_submissions_support_unique unique(support_reference),
  constraint website_intake_submissions_values check(idempotency_key~'^[A-Za-z0-9._:-]{8,128}$' and request_hash~'^[a-f0-9]{64}$' and ip_hash~'^[a-f0-9]{64}$' and user_agent_hash~'^[a-f0-9]{64}$' and support_reference~'^[A-F0-9]{8}$' and status in ('processing','completed','review','failed','rate-limited','origin-denied') and attempt_count between 1 and 20 and (failure_category is null or failure_category~'^[a-z][a-z0-9._-]{1,79}$')),
  constraint website_intake_submissions_terminal check((status='processing' and completed_at is null) or (status<>'processing' and completed_at is not null))
);
create index website_intake_submissions_rate_idx on public.website_intake_submissions(endpoint_id,received_at desc);
create index website_intake_submissions_workspace_status_idx on public.website_intake_submissions(workspace_id,status,received_at desc);

create table public.contact_attribution_events (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  contact_id uuid not null, submission_id uuid not null, touch_type text not null,
  source text not null, medium text, campaign text, form_id text not null, landing_page text not null, referrer text,
  occurred_at timestamptz not null,
  constraint contact_attribution_events_id_workspace_unique unique(id,workspace_id),
  constraint contact_attribution_events_contact_fk foreign key(contact_id,workspace_id) references public.contacts(id,workspace_id) on delete restrict,
  constraint contact_attribution_events_submission_fk foreign key(submission_id,workspace_id) references public.website_intake_submissions(id,workspace_id) on delete restrict,
  constraint contact_attribution_events_once unique(submission_id,touch_type),
  constraint contact_attribution_events_values check(touch_type in ('first-touch','last-touch','lead-conversion') and length(trim(source)) between 1 and 80 and length(trim(form_id)) between 1 and 120 and length(landing_page) between 8 and 500)
);

create table public.contact_consent_events (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  contact_id uuid not null, submission_id uuid not null, channel text not null, consent_state text not null,
  policy_version text not null, capture_method text not null default 'website-form', occurred_at timestamptz not null,
  constraint contact_consent_events_id_workspace_unique unique(id,workspace_id),
  constraint contact_consent_events_contact_fk foreign key(contact_id,workspace_id) references public.contacts(id,workspace_id) on delete restrict,
  constraint contact_consent_events_submission_fk foreign key(submission_id,workspace_id) references public.website_intake_submissions(id,workspace_id) on delete restrict,
  constraint contact_consent_events_once unique(submission_id,channel),
  constraint contact_consent_events_values check(channel in ('email','sms','phone') and consent_state in ('granted','declined','unknown') and length(trim(policy_version)) between 1 and 80 and capture_method='website-form')
);

create table public.website_response_slas (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  submission_id uuid not null, contact_id uuid not null, task_id uuid not null, responsible_membership_id uuid not null,
  due_at timestamptz not null, status text not null default 'open', created_at timestamptz not null,
  constraint website_response_slas_id_workspace_unique unique(id,workspace_id),
  constraint website_response_slas_submission_unique unique(submission_id),
  constraint website_response_slas_submission_fk foreign key(submission_id,workspace_id) references public.website_intake_submissions(id,workspace_id) on delete restrict,
  constraint website_response_slas_contact_fk foreign key(contact_id,workspace_id) references public.contacts(id,workspace_id) on delete restrict,
  constraint website_response_slas_task_fk foreign key(task_id,workspace_id) references public.tasks(id,workspace_id) on delete restrict,
  constraint website_response_slas_responsible_fk foreign key(responsible_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  constraint website_response_slas_values check(status in ('open','responded','cancelled'))
);

create or replace function public.guard_website_intake_history() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'website intake history is append-only' using errcode='55000'; end $$;
create trigger contact_attribution_events_guard before update or delete on public.contact_attribution_events for each row execute function public.guard_website_intake_history();
create trigger contact_consent_events_guard before update or delete on public.contact_consent_events for each row execute function public.guard_website_intake_history();

create or replace function public.configure_website_intake_endpoint(target_workspace_id uuid,target_membership_id uuid,target_endpoint_key text,target_display_name text,target_allowed_origins text[],target_rate_limit_per_minute integer,target_response_sla_minutes integer,target_responsible_membership_id uuid,target_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members%rowtype; endpoint public.website_intake_endpoints%rowtype; candidate text;
begin
  perform public.assert_crm_actor_membership(target_membership_id,target_workspace_id);
  select * into actor from public.workspace_members where id=target_membership_id and workspace_id=target_workspace_id;
  if actor.role<>'owner' then raise exception 'owner authority required' using errcode='42501'; end if;
  if target_endpoint_key!~'^[A-Za-z0-9._:-]{8,128}$' or length(trim(target_display_name)) not between 1 and 120 or cardinality(target_allowed_origins) not between 1 and 20 or target_rate_limit_per_minute not between 1 and 60 or target_response_sla_minutes not between 1 and 1440 then raise exception 'invalid website endpoint configuration' using errcode='22023'; end if;
  foreach candidate in array target_allowed_origins loop if candidate!~'^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$' then raise exception 'invalid website origin' using errcode='22023'; end if; end loop;
  perform 1 from public.workspace_members where id=target_responsible_membership_id and workspace_id=target_workspace_id and status='active';
  if not found then raise exception 'responsible membership unavailable' using errcode='22023'; end if;
  insert into public.website_intake_endpoints(workspace_id,endpoint_key,display_name,allowed_origins,rate_limit_per_minute,response_sla_minutes,responsible_membership_id,created_by_membership_id,created_at,updated_at)
  values(target_workspace_id,target_endpoint_key,trim(target_display_name),target_allowed_origins,target_rate_limit_per_minute,target_response_sla_minutes,target_responsible_membership_id,target_membership_id,target_occurred_at,target_occurred_at)
  on conflict(endpoint_key) do update set display_name=excluded.display_name,allowed_origins=excluded.allowed_origins,rate_limit_per_minute=excluded.rate_limit_per_minute,response_sla_minutes=excluded.response_sla_minutes,responsible_membership_id=excluded.responsible_membership_id,enabled=true,updated_at=excluded.updated_at
  where public.website_intake_endpoints.workspace_id=excluded.workspace_id returning * into endpoint;
  if not found then raise exception 'endpoint key belongs to another workspace' using errcode='23505'; end if;
  return jsonb_build_object('endpointId',endpoint.id,'enabled',endpoint.enabled,'updatedAt',endpoint.updated_at);
end $$;

create or replace function public.claim_website_intake_submission(target_workspace_id uuid,target_endpoint_key text,target_idempotency_key text,target_request_hash text,target_origin text,target_ip_hash text,target_user_agent_hash text,target_received_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare endpoint public.website_intake_endpoints%rowtype; existing public.website_intake_submissions%rowtype; created public.website_intake_submissions%rowtype; recent_count integer; support text;
begin
  if auth.role()<>'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtext(target_endpoint_key));
  select * into endpoint from public.website_intake_endpoints where workspace_id=target_workspace_id and endpoint_key=target_endpoint_key;
  if not found or not endpoint.enabled then return jsonb_build_object('outcome','disabled'); end if;
  select * into existing from public.website_intake_submissions where endpoint_id=endpoint.id and idempotency_key=target_idempotency_key for update;
  if found then
    if existing.request_hash<>target_request_hash then return jsonb_build_object('outcome','conflict','supportReference',existing.support_reference); end if;
    if existing.status in ('completed','review') then return jsonb_build_object('outcome','replay','submissionId',existing.id,'supportReference',existing.support_reference,'status',existing.status); end if;
    if existing.status='processing' and existing.updated_at>target_received_at-interval '2 minutes' then return jsonb_build_object('outcome','processing','supportReference',existing.support_reference); end if;
    update public.website_intake_submissions set status='processing',attempt_count=least(attempt_count+1,20),failure_category=null,completed_at=null,updated_at=target_received_at where id=existing.id returning * into existing;
    return jsonb_build_object('outcome','accepted','submissionId',existing.id,'supportReference',existing.support_reference,'responseSlaMinutes',endpoint.response_sla_minutes,'responsibleMembershipId',endpoint.responsible_membership_id,'receivedAt',existing.received_at);
  end if;
  support:=upper(substr(encode(extensions.digest(pg_catalog.convert_to(gen_random_uuid()::text||target_request_hash,'UTF8'),'sha256'),'hex'),1,8));
  if not (target_origin=any(endpoint.allowed_origins)) then
    insert into public.website_intake_submissions(workspace_id,endpoint_id,idempotency_key,request_hash,origin,ip_hash,user_agent_hash,support_reference,status,received_at,completed_at,updated_at)
    values(target_workspace_id,endpoint.id,target_idempotency_key,target_request_hash,target_origin,target_ip_hash,target_user_agent_hash,support,'origin-denied',target_received_at,target_received_at,target_received_at);
    return jsonb_build_object('outcome','origin-denied','supportReference',support);
  end if;
  select count(*) into recent_count from public.website_intake_submissions where endpoint_id=endpoint.id and received_at>target_received_at-interval '1 minute' and status not in ('origin-denied','rate-limited');
  if recent_count>=endpoint.rate_limit_per_minute then
    insert into public.website_intake_submissions(workspace_id,endpoint_id,idempotency_key,request_hash,origin,ip_hash,user_agent_hash,support_reference,status,received_at,completed_at,updated_at)
    values(target_workspace_id,endpoint.id,target_idempotency_key,target_request_hash,target_origin,target_ip_hash,target_user_agent_hash,support,'rate-limited',target_received_at,target_received_at,target_received_at);
    return jsonb_build_object('outcome','rate-limited','supportReference',support);
  end if;
  insert into public.website_intake_submissions(workspace_id,endpoint_id,idempotency_key,request_hash,origin,ip_hash,user_agent_hash,support_reference,status,received_at,updated_at)
  values(target_workspace_id,endpoint.id,target_idempotency_key,target_request_hash,target_origin,target_ip_hash,target_user_agent_hash,support,'processing',target_received_at,target_received_at) returning * into created;
  return jsonb_build_object('outcome','accepted','submissionId',created.id,'supportReference',support,'responseSlaMinutes',endpoint.response_sla_minutes,'responsibleMembershipId',endpoint.responsible_membership_id,'receivedAt',created.received_at);
end $$;

create or replace function public.review_website_intake_submission(target_workspace_id uuid,target_submission_id uuid,target_attribution jsonb,target_consent jsonb,target_classification jsonb,target_review_category text,target_completed_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$ declare saved public.website_intake_submissions%rowtype; begin
  if auth.role()<>'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  if target_review_category!~'^[a-z][a-z0-9._-]{1,79}$' or jsonb_typeof(target_attribution)<>'object' or jsonb_typeof(target_consent)<>'object' or jsonb_typeof(target_classification)<>'object' then raise exception 'invalid website review evidence' using errcode='22023'; end if;
  update public.website_intake_submissions set status='review',identity_outcome='ambiguous-review',attribution_snapshot=target_attribution,consent_snapshot=target_consent,classification_snapshot=target_classification,failure_category=target_review_category,completed_at=target_completed_at,updated_at=target_completed_at where workspace_id=target_workspace_id and id=target_submission_id and status='processing' returning * into saved;
  if not found then select * into saved from public.website_intake_submissions where workspace_id=target_workspace_id and id=target_submission_id and status='review'; if not found then raise exception 'website submission not processable' using errcode='55000'; end if; return jsonb_build_object('noOp',true,'supportReference',saved.support_reference,'status','review'); end if;
  return jsonb_build_object('noOp',false,'supportReference',saved.support_reference,'status','review');
end $$;

create or replace function public.finalize_website_intake_submission(target_workspace_id uuid,target_submission_id uuid,target_contact_id uuid,target_task_id uuid,target_identity_outcome text,target_attribution jsonb,target_consent jsonb,target_classification jsonb,target_completed_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare submission public.website_intake_submissions%rowtype; endpoint public.website_intake_endpoints%rowtype; channel text; first_touch_exists boolean;
begin
  if auth.role()<>'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  select * into submission from public.website_intake_submissions where workspace_id=target_workspace_id and id=target_submission_id for update;
  if not found then raise exception 'website submission not found' using errcode='P0002'; end if;
  if submission.status in ('completed','review') then return jsonb_build_object('noOp',true,'supportReference',submission.support_reference,'status',submission.status); end if;
  if submission.status<>'processing' then raise exception 'website submission is not processable' using errcode='55000'; end if;
  if target_identity_outcome not in ('created','updated','unchanged','ambiguous-review') or jsonb_typeof(target_attribution)<>'object' or jsonb_typeof(target_consent)<>'object' or jsonb_typeof(target_classification)<>'object' then raise exception 'invalid website intake evidence' using errcode='22023'; end if;
  select * into endpoint from public.website_intake_endpoints where id=submission.endpoint_id and workspace_id=target_workspace_id;
  perform 1 from public.contacts where id=target_contact_id and workspace_id=target_workspace_id; if not found then raise exception 'website contact unavailable' using errcode='P0002'; end if;
  perform 1 from public.tasks where id=target_task_id and workspace_id=target_workspace_id and contact_id=target_contact_id; if not found then raise exception 'website response task unavailable' using errcode='P0002'; end if;
  select exists(select 1 from public.contact_attribution_events where workspace_id=target_workspace_id and contact_id=target_contact_id and touch_type='first-touch') into first_touch_exists;
  if not first_touch_exists then insert into public.contact_attribution_events(workspace_id,contact_id,submission_id,touch_type,source,medium,campaign,form_id,landing_page,referrer,occurred_at) values(target_workspace_id,target_contact_id,submission.id,'first-touch',target_attribution->>'source',target_attribution->>'medium',target_attribution->>'campaign',target_attribution->>'formId',target_attribution->>'landingPage',target_attribution->>'referrer',submission.received_at) on conflict do nothing; end if;
  insert into public.contact_attribution_events(workspace_id,contact_id,submission_id,touch_type,source,medium,campaign,form_id,landing_page,referrer,occurred_at) values(target_workspace_id,target_contact_id,submission.id,'last-touch',target_attribution->>'source',target_attribution->>'medium',target_attribution->>'campaign',target_attribution->>'formId',target_attribution->>'landingPage',target_attribution->>'referrer',submission.received_at) on conflict do nothing;
  insert into public.contact_attribution_events(workspace_id,contact_id,submission_id,touch_type,source,medium,campaign,form_id,landing_page,referrer,occurred_at) values(target_workspace_id,target_contact_id,submission.id,'lead-conversion',target_attribution->>'source',target_attribution->>'medium',target_attribution->>'campaign',target_attribution->>'formId',target_attribution->>'landingPage',target_attribution->>'referrer',submission.received_at) on conflict do nothing;
  foreach channel in array array['email','sms','phone'] loop insert into public.contact_consent_events(workspace_id,contact_id,submission_id,channel,consent_state,policy_version,occurred_at) values(target_workspace_id,target_contact_id,submission.id,channel,target_consent->>channel,target_consent->>'policyVersion',submission.received_at) on conflict do nothing; end loop;
  insert into public.website_response_slas(workspace_id,submission_id,contact_id,task_id,responsible_membership_id,due_at,created_at) values(target_workspace_id,submission.id,target_contact_id,target_task_id,endpoint.responsible_membership_id,submission.received_at+make_interval(mins=>endpoint.response_sla_minutes),target_completed_at) on conflict(submission_id) do nothing;
  update public.website_intake_submissions set status=case when target_identity_outcome='ambiguous-review' then 'review' else 'completed' end,contact_id=target_contact_id,task_id=target_task_id,identity_outcome=target_identity_outcome,attribution_snapshot=target_attribution,consent_snapshot=target_consent,classification_snapshot=target_classification,response_due_at=submission.received_at+make_interval(mins=>endpoint.response_sla_minutes),completed_at=target_completed_at,updated_at=target_completed_at where id=submission.id returning * into submission;
  return jsonb_build_object('noOp',false,'supportReference',submission.support_reference,'status',submission.status);
end $$;

create or replace function public.fail_website_intake_submission(target_workspace_id uuid,target_submission_id uuid,target_failure_category text,target_failed_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$ declare saved public.website_intake_submissions%rowtype; begin
  if auth.role()<>'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  if target_failure_category!~'^[a-z][a-z0-9._-]{1,79}$' then raise exception 'invalid failure category' using errcode='22023'; end if;
  update public.website_intake_submissions set status='failed',failure_category=target_failure_category,completed_at=target_failed_at,updated_at=target_failed_at where workspace_id=target_workspace_id and id=target_submission_id and status='processing' returning * into saved;
  if not found then raise exception 'website submission not processable' using errcode='55000'; end if;
  return jsonb_build_object('supportReference',saved.support_reference,'status','failed');
end $$;

alter table public.website_intake_endpoints enable row level security; alter table public.website_intake_endpoints force row level security;
alter table public.website_intake_submissions enable row level security; alter table public.website_intake_submissions force row level security;
alter table public.contact_attribution_events enable row level security; alter table public.contact_attribution_events force row level security;
alter table public.contact_consent_events enable row level security; alter table public.contact_consent_events force row level security;
alter table public.website_response_slas enable row level security; alter table public.website_response_slas force row level security;
create policy website_intake_endpoints_member_select on public.website_intake_endpoints for select to authenticated using(public.has_workspace_access(workspace_id));
create policy website_intake_submissions_member_select on public.website_intake_submissions for select to authenticated using(public.has_workspace_access(workspace_id));
create policy contact_attribution_events_member_select on public.contact_attribution_events for select to authenticated using(public.has_workspace_access(workspace_id));
create policy contact_consent_events_member_select on public.contact_consent_events for select to authenticated using(public.has_workspace_access(workspace_id));
create policy website_response_slas_member_select on public.website_response_slas for select to authenticated using(public.has_workspace_access(workspace_id));
revoke all on public.website_intake_endpoints,public.website_intake_submissions,public.contact_attribution_events,public.contact_consent_events,public.website_response_slas from public,anon,authenticated,service_role;
grant select on public.website_intake_endpoints,public.website_intake_submissions,public.contact_attribution_events,public.contact_consent_events,public.website_response_slas to authenticated,service_role;
revoke all on function public.configure_website_intake_endpoint(uuid,uuid,text,text,text[],integer,integer,uuid,timestamptz),public.claim_website_intake_submission(uuid,text,text,text,text,text,text,timestamptz),public.review_website_intake_submission(uuid,uuid,jsonb,jsonb,jsonb,text,timestamptz),public.finalize_website_intake_submission(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,timestamptz),public.fail_website_intake_submission(uuid,uuid,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.configure_website_intake_endpoint(uuid,uuid,text,text,text[],integer,integer,uuid,timestamptz) to authenticated;
grant execute on function public.claim_website_intake_submission(uuid,text,text,text,text,text,text,timestamptz),public.review_website_intake_submission(uuid,uuid,jsonb,jsonb,jsonb,text,timestamptz),public.finalize_website_intake_submission(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,timestamptz),public.fail_website_intake_submission(uuid,uuid,text,timestamptz) to service_role;
revoke all on function public.guard_website_intake_history() from public;

comment on table public.website_intake_submissions is 'Redacted signed website intake evidence. Raw request bodies and secrets are intentionally excluded.';
comment on table public.contact_consent_events is 'Website form consent evidence only; it does not grant OAuth/provider authorization.';
