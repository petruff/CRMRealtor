-- Manual rollback for 0013_mailchimp_outbound_backfill.sql.
-- PRE-WRITE ONLY. Once a preview exists, its exact approval/job/evidence graph
-- must be preserved; use PITR or a reviewed forward migration instead.

begin;

do $$
begin
  if exists(select 1 from public.mailchimp_outbound_backfill_runs)
     or exists(select 1 from public.mailchimp_outbound_backfill_approvals)
     or exists(select 1 from public.mailchimp_outbound_backfill_pages)
     or exists(select 1 from public.mailchimp_outbound_backfill_job_links)
     or exists(select 1 from public.connector_receipt_events
       where event_key like 'mailchimp.backfill.%') then
    raise exception '0013 rollback refused after Mailchimp outbound preview/approval/page/job evidence; use PITR or a reviewed forward migration'
      using errcode='55000';
  end if;
end;
$$;

drop function if exists public.transition_mailchimp_outbound_backfill_run(
  uuid,uuid,bigint,text,text,timestamptz,timestamptz
);
drop function if exists public.settle_mailchimp_outbound_backfill_run(
  uuid,uuid,bigint,timestamptz,timestamptz
);
drop function if exists public.enqueue_mailchimp_outbound_backfill_page(
  uuid,uuid,bigint,integer,text,jsonb,timestamptz
);
drop function if exists public.read_mailchimp_outbound_backfill_page(
  uuid,uuid,bigint,timestamptz
);
drop function if exists public.start_mailchimp_outbound_backfill_run(
  uuid,uuid,bigint,timestamptz
);
drop function if exists public.claim_mailchimp_outbound_backfill_runs(
  uuid,integer,integer,timestamptz
);
drop function if exists public.approve_mailchimp_outbound_backfill(
  uuid,text,integer,uuid,timestamptz
);
drop function if exists public.schedule_due_mailchimp_outbound_backfill_runs(
  timestamptz,integer,integer
);
drop function if exists public.preview_mailchimp_outbound_backfill(
  uuid,text,text,integer,uuid,timestamptz,integer
);

drop trigger if exists mailchimp_outbound_backfills_invalidate_on_audience_replace
  on public.mailchimp_audience_bindings;
drop function if exists public.invalidate_mailchimp_outbound_backfills_on_audience_replace();

drop trigger if exists mailchimp_outbound_backfill_job_links_guard_mutation
  on public.mailchimp_outbound_backfill_job_links;
drop trigger if exists mailchimp_outbound_backfill_pages_guard_mutation
  on public.mailchimp_outbound_backfill_pages;
drop trigger if exists mailchimp_outbound_backfill_approvals_guard_mutation
  on public.mailchimp_outbound_backfill_approvals;
drop trigger if exists mailchimp_outbound_backfill_items_guard_mutation
  on connector_private.mailchimp_outbound_backfill_items;
drop trigger if exists mailchimp_outbound_backfill_runs_guard_delete
  on public.mailchimp_outbound_backfill_runs;
drop trigger if exists mailchimp_outbound_backfill_runs_prepare_update
  on public.mailchimp_outbound_backfill_runs;

drop table if exists public.mailchimp_outbound_backfill_job_links;
drop table if exists public.mailchimp_outbound_backfill_pages;
drop table if exists public.mailchimp_outbound_backfill_approvals;
drop table if exists connector_private.mailchimp_outbound_backfill_items;
drop table if exists public.mailchimp_outbound_backfill_runs;

drop function if exists public.prepare_mailchimp_outbound_backfill_run_update();
drop function if exists connector_private.mailchimp_outbound_snapshot_hash(uuid);
drop function if exists connector_private.mailchimp_outbound_snapshot_rows(uuid);

commit;
