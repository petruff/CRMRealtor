-- Manual rollback for 0012_mailchimp_reconciliation_runs.sql.
-- PRE-WRITE ONLY. The `incomplete-record-received` enum label is intentionally
-- retained because PostgreSQL cannot safely remove enum values.

begin;

do $$
begin
  if exists(select 1 from public.mailchimp_reconciliation_pages)
     or exists(select 1 from public.mailchimp_reconciliation_runs)
     or exists(select 1 from public.incomplete_records where source='mailchimp-live')
     or exists(select 1 from public.activity_events where type::text='incomplete-record-received')
     or exists(select 1 from public.connector_receipt_events
       where event_key like 'mailchimp.reconciliation.%'
          or event_key like 'mailchimp.identity.quarantined:%') then
    raise exception '0012 rollback refused after Mailchimp reconciliation/quarantine writes; use PITR or a reviewed forward migration'
      using errcode='55000';
  end if;
end;
$$;

drop function if exists public.transition_mailchimp_reconciliation_run(
  uuid,uuid,bigint,text,text,timestamptz,timestamptz
);
drop function if exists public.complete_mailchimp_reconciliation_run(
  uuid,uuid,bigint,text,timestamptz
);
drop function if exists public.read_mailchimp_reconciliation_access_token(
  uuid,uuid,bigint,timestamptz
);
drop function if exists public.apply_mailchimp_reconciliation_page(
  uuid,uuid,bigint,integer,jsonb,integer,integer,text,timestamptz
);
drop function if exists public.start_mailchimp_reconciliation_run(
  uuid,uuid,bigint,timestamptz
);
drop function if exists public.claim_mailchimp_reconciliation_runs(
  uuid,integer,integer,timestamptz
);
drop function if exists public.request_mailchimp_reconciliation_run(
  uuid,uuid,text,text,text,integer,uuid,timestamptz,integer
);

drop function if exists public.apply_mailchimp_inbound_subscription_event(
  uuid,text,uuid,text,text,text,text,text,text,uuid,timestamptz
);
drop function if exists public.apply_mailchimp_baseline_member(
  uuid,text,text,text,text,text,text,uuid,timestamptz
);
drop function if exists public.quarantine_mailchimp_identity_review(
  uuid,uuid,uuid,text,text,text,text,text,uuid,timestamptz
);

alter function public.apply_mailchimp_inbound_subscription_event_0010(
  uuid,text,uuid,text,text,text,text,text,text,uuid,timestamptz
) rename to apply_mailchimp_inbound_subscription_event;
alter function public.apply_mailchimp_baseline_member_0011(
  uuid,text,text,text,text,text,text,uuid,timestamptz
) rename to apply_mailchimp_baseline_member;

grant execute on function public.apply_mailchimp_inbound_subscription_event(
  uuid,text,uuid,text,text,text,text,text,text,uuid,timestamptz
) to service_role;
grant execute on function public.apply_mailchimp_baseline_member(
  uuid,text,text,text,text,text,text,uuid,timestamptz
) to service_role;
grant execute on function public.complete_mailchimp_audience_baseline(
  uuid,uuid,text,uuid,timestamptz
) to service_role;

drop trigger if exists mailchimp_reconciliation_runs_invalidate_on_audience_replace
  on public.mailchimp_audience_bindings;
drop function if exists public.invalidate_mailchimp_reconciliation_runs_on_audience_replace();

drop trigger if exists mailchimp_reconciliation_pages_guard_mutation
  on public.mailchimp_reconciliation_pages;
drop trigger if exists mailchimp_reconciliation_runs_guard_delete
  on public.mailchimp_reconciliation_runs;
drop trigger if exists mailchimp_reconciliation_runs_prepare_update
  on public.mailchimp_reconciliation_runs;
drop function if exists public.prepare_mailchimp_reconciliation_run_update();

drop table if exists public.mailchimp_reconciliation_pages;
drop table if exists public.mailchimp_reconciliation_runs;

alter table public.activity_events
  drop constraint activity_events_target_shape;
alter table public.activity_events
  add constraint activity_events_target_shape check (
    (type in (
      'contact-created', 'contact-updated', 'contact-imported',
      'note-added', 'touch-recorded', 'contact-archived', 'contact-restored',
      'contact-point-added', 'contact-point-updated',
      'contact-point-archived', 'contact-point-restored',
      'relationship-updated', 'assignment-updated'
    ) and contact_id is not null
      and task_id is null and incomplete_record_id is null)
    or
    (type in ('household-updated', 'custom-field-updated')
      and task_id is null and incomplete_record_id is null)
    or
    (type = 'incomplete-record-converted' and contact_id is not null
      and task_id is null and incomplete_record_id is not null)
    or
    (type in ('task-created', 'task-completed', 'task-archived')
      and task_id is not null and incomplete_record_id is null)
  );

commit;

-- Deliberately retained enum label: incomplete-record-received.
