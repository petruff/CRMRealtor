-- Containment: members can no longer change alert choices; stored choices are kept.
revoke update (alert_new_leads, alert_deadlines, quiet_start_hour, quiet_end_hour)
  on public.push_subscriptions from authenticated;
