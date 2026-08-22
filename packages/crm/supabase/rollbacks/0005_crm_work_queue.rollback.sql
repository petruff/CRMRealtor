-- MANUAL ROLLBACK — Story 3.1 CRM Work Queue Foundation
--
-- Destructive: removes Smart Lists, quarantined records, tasks and activity
-- evidence. Use only in an approved pre-write window. After any real writes,
-- restore the pre-migration snapshot/PITR instead of running this file.

begin;

drop policy if exists activity_events_member_select on activity_events;
drop policy if exists tasks_member_update on tasks;
drop policy if exists tasks_member_insert on tasks;
drop policy if exists tasks_member_select on tasks;
drop policy if exists incomplete_records_member_update on incomplete_records;
drop policy if exists incomplete_records_member_insert on incomplete_records;
drop policy if exists incomplete_records_member_select on incomplete_records;
drop policy if exists smart_lists_member_update on smart_lists;
drop policy if exists smart_lists_member_insert on smart_lists;
drop policy if exists smart_lists_member_select on smart_lists;

drop function if exists convert_incomplete_record(
  uuid, jsonb, jsonb, text, uuid, timestamptz
);
drop function if exists transition_tasks_with_events(
  uuid, uuid[], crm_task_status, uuid, timestamptz, jsonb
);
drop function if exists create_task_with_event(
  uuid, uuid, text, text, timestamptz, uuid, uuid, text, text, timestamptz
);
drop function if exists transition_tasks(uuid, uuid[], crm_task_status, uuid);
drop function if exists create_incomplete_record(
  uuid, text, text, jsonb, jsonb, text, uuid
);
drop function if exists append_activity_event(
  uuid, crm_activity_event_type, uuid, timestamptz, text, uuid, uuid, uuid
);
drop function if exists is_valid_incomplete_conversion_plan(jsonb);
drop function if exists is_valid_contact_conversion_payload(jsonb, boolean);
drop function if exists is_valid_seller_conversion_payload(jsonb);
drop function if exists is_valid_buyer_conversion_payload(jsonb);

drop table if exists activity_events;
drop table if exists tasks;
drop table if exists incomplete_records;
drop table if exists smart_lists;

drop function if exists guard_activity_event_mutation();
drop function if exists prepare_activity_event_insert();
drop function if exists prepare_task_write();
drop function if exists prepare_incomplete_record_write();
drop function if exists prepare_smart_list_write();
drop function if exists guard_crm_work_queue_delete();
drop function if exists assert_crm_actor_membership(uuid, uuid);
drop function if exists crm_membership_is_active(uuid, uuid);
drop function if exists is_valid_incomplete_reasons(jsonb);
drop function if exists is_valid_incomplete_candidate(jsonb);
drop function if exists is_valid_smart_list_definition(jsonb);
drop function if exists is_iso_date_value(jsonb);
drop function if exists jsonb_is_string_array(jsonb, boolean);
drop function if exists jsonb_object_has_only(jsonb, text[]);

drop type if exists crm_activity_event_type;
drop type if exists crm_task_status;
drop type if exists incomplete_conversion_action;
drop type if exists incomplete_record_status;
drop type if exists smart_list_status;

commit;
