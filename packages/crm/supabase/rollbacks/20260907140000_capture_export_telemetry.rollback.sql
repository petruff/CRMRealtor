-- Containment preserves all existing exported-data receipts and telemetry.
revoke insert on public.capture_run_telemetry from authenticated;
alter table public.data_export_receipts add constraint capture_exports_paused check(entity_type<>'capture-outcomes') not valid;
