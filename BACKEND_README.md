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
  lives in `diva-auth.js`).
- `report.html` — incident submission now inserts a real row into the
  `incidents` table (lat/lng parsed from the geolocation string if present).
- `admin-incidents.html` — fetches/updates incidents from Supabase; maps
  the UI's Pending/Reviewed/Resolved labels to the DB's
  pending/verified/resolved enum values.
- `admin-alerts.html` — full create/edit/delete against the `alerts` table.
- `alerts.html` / `dashboard.html` — read alerts and map-pinnable incidents
  live from Supabase instead of localStorage.

## Still to do
1. **Deploy this to Vercel** (push to your connected GitHub repo).
2. **Environment variables** in Vercel → Settings → Environment Variables:
   `OPENAI_API_KEY`, `OPENWEATHER_API_KEY`.
3. **Run `supabase/002_add_information_severity.sql`** in the SQL Editor —
   a one-line addition so the alerts form's "Information" severity option
   matches the database enum (schema.sql only had advisory/warning/critical).
4. **Supabase Auth setting**: decide whether "Confirm email" is on or off
   under Authentication → Providers → Email.
5. **Promote an admin**: new signups default to `resident`. In Supabase's
   Table Editor, open `profiles` and change a row's `role` to `admin`.
6. **Still on localStorage (`DivaStore`), not yet wired to Supabase:**
   - `admin-dashboard.html` and `admin-analytics.html` — stat counts still
     read the old `DivaStore.getIncidents()/getAlerts()/getUsers()`, which
     now return empty/stale data since nothing writes there anymore. These
     numbers will look wrong until this is converted — ask Claude to
     continue with this next.
   - `admin-users.html` and `profile.html` — user management and profile
     editing still use the fake `DivaStore` user records instead of
     `profiles` table.
7. **Photo uploads** on `report.html` are accepted in the form but not
   actually uploaded anywhere — needs a Supabase Storage bucket if you
   want that to work.
8. **Delete the demo account chips** in `login.html` before going live —
   those reference fake local accounts that no longer exist in Supabase.

## Email notifications (new)
`api/notifications.js` is a new serverless function that sends emails via
[Resend](https://resend.com) (free tier: 100/day, 3,000/month, no domain
verification needed if you send from their `onboarding@resend.dev` address
while testing). It handles three triggers:

1. Admin publishes an alert → every resident with an email gets it.
2. Resident submits an incident report → every admin gets notified.
3. Admin changes an incident's status → the reporter gets notified.

Nothing in the frontend calls this function directly — it's driven by
**Supabase Database Webhooks**, so notifications fire even if the browser
that triggered them closes immediately after.

### Setup steps
1. **Create a Resend account** at resend.com and grab an API key. For
   production, verify your own sending domain there too (otherwise you're
   limited to sending from `onboarding@resend.dev`, which works fine for
   testing but looks less official to residents).
2. **Add these environment variables in Vercel** (Settings → Environment
   Variables):
   - `RESEND_API_KEY`
   - `EMAIL_FROM` — e.g. `DIVA <alerts@yourdomain.com>` or
     `DIVA <onboarding@resend.dev>` for testing
   - `SUPABASE_URL` — same project URL as in `assets/js/supabase-client.js`
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Settings → API →
     `service_role` secret. **Never put this in any frontend file** — it
     bypasses every RLS policy. It's only safe here because it's a Vercel
     env var, used only inside a serverless function.
   - `EMAIL_WEBHOOK_SECRET` — make up any long random string.
   - `APP_URL` — e.g. `https://your-app.vercel.app`
3. **Redeploy** so those env vars take effect.
4. **In Supabase → Database → Webhooks**, create three webhooks, all
   pointing at `https://your-app.vercel.app/api/notifications`, all with
   an HTTP header `x-webhook-secret: <the same string you set above>`:
   - Table `alerts`, event `INSERT`
   - Table `incidents`, event `INSERT`
   - Table `incidents`, event `UPDATE`
   (The function itself checks *what* changed — e.g. it only emails the
   reporter on an UPDATE if `status` actually changed — so it's fine that
   the incidents UPDATE webhook fires on every edit.)

That's it — no changes needed to `report.html` or `admin-alerts.html`;
they already insert/update the rows that trigger these webhooks.
