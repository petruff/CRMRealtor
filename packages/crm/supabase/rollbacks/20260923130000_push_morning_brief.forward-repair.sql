-- Forward repair: members may register their own devices again (RLS still scopes every row).
grant insert on public.push_subscriptions to authenticated;
