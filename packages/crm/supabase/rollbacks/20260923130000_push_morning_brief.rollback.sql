-- Containment: stop members from registering devices; existing rows are kept for audit.
revoke insert on public.push_subscriptions from authenticated;
