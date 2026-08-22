-- PRE-USE ONLY. Refuse once pipeline evidence exists.
begin;
do $$ begin
  if exists(select 1 from public.activity_events where type::text='pipeline-stage-changed') then
    raise exception '0022 rollback refused: pipeline history exists' using errcode='55000';
  end if;
end $$;
drop function if exists public.move_contact_pipeline_stage(uuid,uuid,public.pipeline_stage,public.pipeline_stage,timestamptz,uuid,timestamptz,text);
drop index if exists public.activity_events_workspace_pipeline_occurred_idx;
drop index if exists public.contacts_workspace_pipeline_updated_idx;
alter table public.activity_events drop constraint activity_events_target_shape;
alter table public.activity_events drop constraint activity_events_metadata_object;
alter table public.activity_events drop column metadata;
alter table public.activity_events add constraint activity_events_target_shape check (
  (type in (
    'contact-created','contact-updated','contact-imported','note-added','touch-recorded',
    'contact-archived','contact-restored','contact-point-added','contact-point-updated',
    'contact-point-archived','contact-point-restored','relationship-updated',
    'assignment-updated'
  ) and contact_id is not null and task_id is null and incomplete_record_id is null)
  or (type in ('household-updated','custom-field-updated')
    and task_id is null and incomplete_record_id is null)
  or (type='incomplete-record-converted' and contact_id is not null
    and task_id is null and incomplete_record_id is not null)
  or (type::text='incomplete-record-received' and contact_id is null
    and task_id is null and incomplete_record_id is not null)
  or (type::text in ('email-metadata-linked','email-sent') and contact_id is not null
    and task_id is null and incomplete_record_id is null)
  or (type in ('task-created','task-completed','task-archived')
    and task_id is not null and incomplete_record_id is null)
);
-- Enum values are intentionally retained; PostgreSQL cannot safely remove them.
commit;
