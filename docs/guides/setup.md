# Going Live — Setup Guide

**Owner:** @architect (Vega) · **Date:** 2026-08-10
**Applies to:** `packages/crm` after Story 1.1

The app runs right now with no setup at all, on seeded sample data. A banner says so
on every screen. This guide covers switching it to real data.

Three of these steps need accounts and payment methods, so they are yours to do —
not something the build can complete on its own.

---

## 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com). The free tier is
   sufficient for 200–500 contacts by a wide margin.
2. Note the **Project URL** and the **anon / publishable key** from
   *Project Settings → API*.
3. Apply the schema — either paste `packages/crm/supabase/migrations/0001_init.sql`
   into the SQL editor, or run `supabase db push` with the CLI linked.

> The `anon` key is safe in the browser; it is designed to be public. Row Level
> Security is what protects the data, and it is enabled on every table in the
> migration. The **service role** key is different — it bypasses RLS entirely and
> must never appear in this app or in any `NEXT_PUBLIC_*` variable.

## 2. Google sign-in

This is what removes her sign-in complaint — one tap, no password.

1. In the [Google Cloud console](https://console.cloud.google.com), create a project
   and an **OAuth 2.0 Client ID** (type: Web application).
2. Add the authorised redirect URI Supabase gives you, which looks like:
   `https://<project-ref>.supabase.co/auth/v1/callback`
3. In Supabase → *Authentication → Providers → Google*, paste the Client ID and
   Client Secret and enable it.
4. In Supabase → *Authentication → URL Configuration*, set the Site URL and add
   `http://localhost:3000/auth/callback` plus your production callback to the
   redirect allow-list.

**Keep the consent screen in Testing mode** and add her Google account as a test
user. Because this is a personal, single-user app, that avoids Google's verification
process and the paid third-party security assessment that restricted scopes
otherwise require.

⚠️ **This is the constraint to remember when the assistant arrives.** Testing mode
is capped at 100 test users, which is fine — but Testing-mode refresh tokens have
historically been short-lived, which is not. Re-verify this before promising Gmail
in phase 2 with two users.

## 3. Environment variables

Copy `packages/crm/.env.example` to `packages/crm/.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

The app detects these in one place — `lib/supabase/env.ts`. With them set, the
middleware starts gating routes, the repository switches to Postgres, and the
sample-data banner disappears on its own.

## 4. Verify

```bash
npm --prefix packages/crm run dev
```

- `/login` should show **Continue with Google** rather than "Not connected yet"
- After signing in, `/` should show an empty triage — no contacts yet, which is correct
- Signing out and hitting `/` should redirect to `/login`

Then import her contacts (see carry-forward in Story 1.1) and the triage populates.

---

## Known development gotcha

**Do not run `next build` while the dev server is running.** Both write to `.next`
and the result is a corrupted client manifest —
`__webpack_modules__[moduleId] is not a function`. This happened during Story 1.1.

Fix: stop the server, `rm -rf packages/crm/.next`, restart.

---

## Phase 2+ (not yet wired, listed so the sequence is clear)

| Step | Blocked on |
|---|---|
| Gmail send + logging | Adding `gmail.send` / `gmail.readonly` incrementally to the existing Google grant |
| Google Calendar | Same grant, `calendar.events` |
| Mailchimp | An API key from her account — about a minute's work |
| **Texting (10DLC)** | **Carrier registration, weeks. File early — the clock runs in parallel with development at no cost.** |
| Instagram / Facebook | Meta business verification + app review. She has not decided she wants this. |
| Website forms | The website, which is a separate build |
