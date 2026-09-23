-- Forward repair: members may change their own device alert choices again (RLS still scopes rows).
grant update (alert_new_leads, alert_deadlines, quiet_start_hour, quiet_end_hour)
  on public.push_subscriptions to authenticated;
