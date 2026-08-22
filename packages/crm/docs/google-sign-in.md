# Omnix Google Sign-In

## What is implemented

Omnix uses Supabase Auth as the server-side OAuth broker. The public `/welcome` and `/login` surfaces start a Google authorization request with identity-only scopes:

- `openid`
- `email`
- `profile`

The browser goes to Google's own authorization page. Omnix does not render, receive or store the user's Google password. Gmail and Google Calendar scopes are deliberately excluded; they require separate incremental-consent connector stories.

After authorization, Google returns to the Supabase provider callback. Supabase then returns the browser to the same Omnix origin at `/auth/callback`, where the one-time code is exchanged for a cookie-backed session. The final destination passes through the central internal-path allowlist before redirecting.

## Configuration required for a live account

1. Create the production Supabase project and apply the Omnix database migrations.
2. Create a Google OAuth web client for the approved Omnix domains.
3. In Google, allow the Supabase callback URL shown by the Supabase Google provider settings.
4. In Supabase Auth, enable Google and store the Google client ID/secret there; do not expose the secret in a browser environment variable.
5. Add each approved Omnix `/auth/callback` URL to the Supabase redirect allowlist, including the exact local port used for testing.
6. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and the absolute HTTPS `NEXT_PUBLIC_SITE_URL` in the deployment environment.
7. Test sign-in, cancellation, provider denial, expired/invalid callback, sign-out and a malicious `next` value with the realtor and assistant test accounts.

## Evidence boundary

The UI and OAuth code path are implemented locally. Google sign-in is **not production-operational** until the real Supabase project, Google OAuth client, redirect allowlists and real-account test evidence exist. When those values are absent, `/welcome` shows a sample-workspace CTA instead of a broken or misleading Google button.

Gmail, Calendar, Mailchimp, texting and Meta permissions are not granted by this sign-in. Their future connectors must use separate scopes, encrypted server-side tokens, signed webhooks where applicable, revocation/disconnect handling, reconciliation and provider receipts.

