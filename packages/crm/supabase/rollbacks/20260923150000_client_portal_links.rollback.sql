-- Containment: every shared link stops working immediately; link rows are kept
-- for audit (who shared what, when, and how often it was opened).
revoke execute on function public.get_client_portal(text) from anon, authenticated;
update public.client_portal_links set revoked_at = now() where revoked_at is null;
