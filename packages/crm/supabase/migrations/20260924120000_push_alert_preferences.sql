-- Alerts v2: per-device choices for what Omnix may send and when it stays quiet.
-- Additive only. Existing devices keep receiving the morning brief exactly as
-- before; the new alert kinds default to on for devices the member already
-- opted in, and every choice is editable per device in Settings.
begin;

alter table public.push_subscriptions
  add column alert_new_leads boolean not null default true,
  add column alert_deadlines boolean not null default true,
  add column quiet_start_hour smallint not null default 21 check (quiet_start_hour between 0 and 23),
  add column quiet_end_hour smallint not null default 7 check (quiet_end_hour between 0 and 23);

grant update (alert_new_leads, alert_deadlines, quiet_start_hour, quiet_end_hour)
  on public.push_subscriptions to authenticated;

commit;
