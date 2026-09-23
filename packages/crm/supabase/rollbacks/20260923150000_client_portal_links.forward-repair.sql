-- Forward repair: portal reads work again. Links revoked during containment stay
-- revoked on purpose; the realtor shares a fresh link.
grant execute on function public.get_client_portal(text) to anon, authenticated;
