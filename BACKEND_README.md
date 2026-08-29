# DIVA — Backend Integration Notes

This zip is your original frontend with the Supabase backend wired in.
Here's exactly what changed and what you still need to do.

## What's new
- `assets/js/supabase-client.js` — initializes the Supabase client (project
  URL + publishable key already filled in for your project).
- `assets/js/diva-auth.js` — replaces the old localStorage-only `DivaAuth`.
  Same method names (`getUser`, `isAdmin`, `login`, `register`, `logout`),
  now backed by real Supabase Auth. `login`/`register`/`logout` are async.
- `api/chat.js` — Vercel serverless function proxying OpenAI for
  `virtual-assistance.html`, so your OpenAI key stays server-side.
- `api/weather.js` — same idea for OpenWeatherMap.
- `supabase/schema.sql` — the database schema (already run in your project,
  kept here for reference / re-deploying to a fresh project later).

## What changed in existing files
- Every page that calls `renderAppShell()` now loads the three Supabase
  script tags before `main.js`, and its bottom `<script>` is now
  `<script type="module">` with `await DivaAuth.init();` as the first line
  — this refreshes the cached user from the real Supabase session.
- `login.html` / `register.html` — same script tags added, form handlers
  are now `async` and call the new `DivaAuth.login()` / `.register()`.
- `assets/js/main.js` — the old fake `DivaAuth` object was removed (now
  lives in `diva-auth.js`). `DivaStore` (alerts/incidents) is untouched —
  those still read/write localStorage for now, that's the next step.

## Still to do
1. **Deploy this to Vercel** (push to your connected GitHub repo).
2. **Environment variables** in Vercel → Settings → Environment Variables:
   `OPENAI_API_KEY`, `OPENWEATHER_API_KEY`. (Supabase keys are already
   hardcoded in `supabase-client.js` since the publishable key is safe to
   expose — no env var needed for those.)
3. **Supabase Auth setting**: decide whether "Confirm email" is on or off
   under Authentication → Providers → Email. Off = instant signup/login,
   good for a demo. On = users must click an email link first.
4. **Promote an admin**: new signups default to `resident`. In Supabase's
   Table Editor, open `profiles` and change a row's `role` to `admin` to
   test the admin dashboard.
5. **Incidents & Alerts**: `report.html`, `admin-alerts.html`, `alerts.html`,
   and `admin-incidents.html` still use `DivaStore` (localStorage). Next
   step is pointing those at the `incidents`/`alerts` tables in Supabase
   directly — ask Claude to continue with this when ready.
6. **Delete the demo account chips** in `login.html` before going live —
   those reference fake local accounts that no longer exist in Supabase.
