-- Story 10.2: bounded review export and redacted operational metadata; no retention duration is invented.
alter table public.data_export_receipts drop constraint data_export_receipts_entity_type_check;
alter table public.data_export_receipts add constraint data_export_receipts_entity_type_check
  check(entity_type in ('contacts','tasks','activities','incomplete-records','capture-outcomes'));
alter table public.data_export_receipts drop constraint data_export_receipts_format_check;
alter table public.data_export_receipts add constraint data_export_receipts_format_check
  check(format in ('csv','xlsx') or (format='json' and entity_type='capture-outcomes'));

create table public.capture_run_telemetry (
  correlation_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  actor_membership_id uuid not null,
  contact_id uuid not null,
  source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
  state text not null check(state in ('available','unconfigured','limited','failed')),
  reason text not null check(reason in ('not-configured','budget-unavailable','budget-denied','complete','model-failed','finalization-failed')),
  policy_version text not null check(policy_version='capture-extraction-policy.v1'),
  model text check(model in ('gemini-3.5-flash-lite','gemini-3.6-flash')),
  reservation_id uuid,
  duration_ms integer not null check(duration_ms between 0 and 3600000),
  estimated_input_tokens integer not null check(estimated_input_tokens between 0 and 100000),
  reserved_output_tokens integer not null check(reserved_output_tokens between 0 and 2400),
  charged_upper_bound_microusd integer not null check(charged_upper_bound_microusd between 0 and 10000),
  accounting text not null check(accounting in ('not-reserved','upper-bound-finalized','finalization-unavailable')),
  created_at timestamptz not null default now(),
  foreign key(actor_membership_id,workspace_id) references public.workspace_members(id,workspace_id),
  foreign key(contact_id,workspace_id) references public.contacts(id,workspace_id),
  check((accounting='not-reserved' and reservation_id is null and charged_upper_bound_microusd=0)
    or (accounting<>'not-reserved' and reservation_id is not null))
);
create index capture_run_telemetry_contact_recent on public.capture_run_telemetry(workspace_id,contact_id,created_at desc);
alter table public.capture_run_telemetry enable row level security;
alter table public.capture_run_telemetry force row level security;
create policy capture_run_telemetry_read on public.capture_run_telemetry for select to authenticated
  using(public.has_workspace_access(workspace_id));
create policy capture_run_telemetry_append on public.capture_run_telemetry for insert to authenticated
  with check(public.has_workspace_access(workspace_id) and exists (
    select 1 from public.workspace_members m where m.id=actor_membership_id and m.workspace_id=capture_run_telemetry.workspace_id
      and m.user_id=auth.uid() and m.status='active'
  ));
revoke all on public.capture_run_telemetry from public,anon,authenticated,service_role;
grant select,insert on public.capture_run_telemetry to authenticated;
grant select on public.capture_run_telemetry to service_role;
create trigger capture_run_telemetry_immutable before update or delete on public.capture_run_telemetry
  for each row execute function public.guard_omnix_proposal_event_mutation();
comment on table public.capture_run_telemetry is 'Member-scoped operational metadata, not a provider attestation. Upper-bound accounting is not measured actual usage. No raw text.';
