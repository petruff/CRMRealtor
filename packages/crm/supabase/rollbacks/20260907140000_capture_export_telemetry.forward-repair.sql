alter table public.data_export_receipts drop constraint if exists capture_exports_paused;
grant insert on public.capture_run_telemetry to authenticated;
