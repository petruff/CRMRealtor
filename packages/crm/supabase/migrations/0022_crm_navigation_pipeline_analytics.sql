-- Story 3.3: atomic pipeline truth and bounded search/analytics indexes.
-- Forward-only. Stage history is immutable evidence; after any move use PITR
-- or an approved forward correction rather than deleting events.

alter type public.crm_activity_event_type_v2
  add value if not exists 'pipeline-stage-changed';

begin;

alter table public.activity_events
  add column metadata jsonb not null default '{}'::jsonb;

alter table public.activity_events
  add constraint activity_events_metadata_object check (
    jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 2048
  );

alter table public.activity_events drop constraint activity_events_target_shape;
alter table public.activity_events add constraint activity_events_target_shape check (
  (type in (
    'contact-created','contact-updated','contact-imported','note-added','touch-recorded',
    'contact-archived','contact-restored','contact-point-added','contact-point-updated',
    'contact-point-archived','contact-point-restored','relationship-updated',
    'assignment-updated'
  ) and contact_id is not null and task_id is null and incomplete_record_id is null)
  or (type::text='pipeline-stage-changed' and contact_id is not null
    and task_id is null and incomplete_record_id is null
    and metadata ? 'fromStage' and metadata ? 'toStage'
    and metadata - 'fromStage' - 'toStage' = '{}'::jsonb)
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

create index contacts_workspace_pipeline_updated_idx
  on public.contacts (workspace_id, pipeline_stage, updated_at desc)
  where archived_at is null;

create index activity_events_workspace_pipeline_occurred_idx
  on public.activity_events (workspace_id, type, occurred_at desc, contact_id);

create or replace function public.move_contact_pipeline_stage(
  target_workspace_id uuid,
  target_contact_id uuid,
  target_from_stage public.pipeline_stage,
  target_to_stage public.pipeline_stage,
  target_expected_updated_at timestamptz,
  target_actor_membership_id uuid,
  target_occurred_at timestamptz,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_contact public.contacts%rowtype;
  existing_event public.activity_events%rowtype;
  inserted_event public.activity_events%rowtype;
begin
  if target_workspace_id is null or target_contact_id is null
     or target_from_stage is null or target_to_stage is null
     or target_expected_updated_at is null or target_actor_membership_id is null
     or target_occurred_at is null
     or target_idempotency_key !~ '^[A-Za-z0-9_-]{1,128}$' then
    raise exception 'pipeline move command is invalid' using errcode='23514';
  end if;
  perform public.assert_crm_actor_membership(target_actor_membership_id,target_workspace_id);

  select contact.* into target_contact
  from public.contacts contact
  where contact.id=target_contact_id and contact.workspace_id=target_workspace_id
  for update;
  if target_contact.id is null or target_contact.archived_at is not null then
    raise exception 'active contact not found' using errcode='42501';
  end if;

  select event.* into existing_event
  from public.activity_events event
  where event.workspace_id=target_workspace_id
    and event.idempotency_key=target_idempotency_key;
  if existing_event.id is not null then
    if existing_event.type::text <> 'pipeline-stage-changed'
       or existing_event.contact_id <> target_contact_id
       or existing_event.actor_membership_id <> target_actor_membership_id
       or existing_event.metadata <> jsonb_build_object(
         'fromStage',target_from_stage::text,'toStage',target_to_stage::text
       ) then
      raise exception 'pipeline idempotency key conflicts' using errcode='23505';
    end if;
    return jsonb_build_object('contact',to_jsonb(target_contact),'event',to_jsonb(existing_event),'noOp',true);
  end if;

  if target_contact.pipeline_stage <> target_from_stage
     or target_contact.updated_at <> target_expected_updated_at then
    raise exception 'stale pipeline version' using errcode='40001';
  end if;
  if target_from_stage = target_to_stage then
    return jsonb_build_object('contact',to_jsonb(target_contact),'event',null,'noOp',true);
  end if;

  update public.contacts
  set pipeline_stage=target_to_stage,
      next_touch_at=case when target_to_stage in ('closed','lost') then null else next_touch_at end,
      touch_date_overridden=case when target_to_stage in ('closed','lost') then false else touch_date_overridden end,
      updated_at=target_occurred_at
  where id=target_contact.id
  returning * into target_contact;

  insert into public.activity_events(
    workspace_id,type,contact_id,actor_membership_id,occurred_at,idempotency_key,metadata
  ) values(
    target_workspace_id,'pipeline-stage-changed'::public.crm_activity_event_type_v2,
    target_contact_id,target_actor_membership_id,target_occurred_at,target_idempotency_key,
    jsonb_build_object('fromStage',target_from_stage::text,'toStage',target_to_stage::text)
  ) returning * into inserted_event;

  return jsonb_build_object('contact',to_jsonb(target_contact),'event',to_jsonb(inserted_event),'noOp',false);
end;
$$;

revoke all on function public.move_contact_pipeline_stage(
  uuid,uuid,public.pipeline_stage,public.pipeline_stage,timestamptz,uuid,timestamptz,text
) from public,anon,authenticated,service_role;
grant execute on function public.move_contact_pipeline_stage(
  uuid,uuid,public.pipeline_stage,public.pipeline_stage,timestamptz,uuid,timestamptz,text
) to authenticated;

commit;
