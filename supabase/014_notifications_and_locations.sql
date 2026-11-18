-- Run this ONCE in Supabase SQL Editor (after 013_incident_resolution.sql).
--
-- Adds:
--   1. notifications   -- the in-app notification bar (bell) for residents AND admins
--   2. profiles.lat/lng -- the resident's saved coordinates, used to pick the
--                          nearest evacuation center for the daily safety broadcast
--   3. broadcast_log   -- audit trail of admin "Daily safety update" sends
--   4. Realtime on notifications + incidents, so the bell and the incident
--      list/map update live (a resolved incident disappears without a refresh)

-- ---------------------------------------------------------------------
-- 1. NOTIFICATIONS
-- Rows are created by the server (api/notifications.js, api/broadcast.js) with
-- the service-role key, which bypasses RLS -- so there is deliberately NO
-- insert policy: a browser can never forge a notification.
-- ---------------------------------------------------------------------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null default 'info',   -- alert | incident_new | incident_reviewed | incident_resolved | broadcast | info
  title text not null,
  body text,
  link text,                           -- page to open when tapped, e.g. 'report.html#reviewed'
  related_id uuid,                     -- the alert / incident this is about
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_created_idx on notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx on notifications (user_id) where read_at is null;

alter table notifications enable row level security;

drop policy if exists "read own notifications" on notifications;
create policy "read own notifications" on notifications
  for select using (auth.uid() = user_id);

drop policy if exists "mark own notifications read" on notifications;
create policy "mark own notifications read" on notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own notifications" on notifications;
create policy "delete own notifications" on notifications
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 2. SAVED COORDINATES
-- Filled from "Use my current location" on register/profile. Residents who
-- only picked a city keep these null; the server then falls back to that
-- city's centre point.
-- ---------------------------------------------------------------------
alter table profiles add column if not exists lat double precision;
alter table profiles add column if not exists lng double precision;

-- ---------------------------------------------------------------------
-- 3. BROADCAST LOG
-- ---------------------------------------------------------------------
create table if not exists broadcast_log (
  id uuid primary key default gen_random_uuid(),
  sent_by uuid references profiles(id) on delete set null,
  recipients int not null default 0,
  sms_recipients int not null default 0,
  sms_accepted int not null default 0,
  preview text,
  created_at timestamptz not null default now()
);
alter table broadcast_log enable row level security;
drop policy if exists "admins read broadcast log" on broadcast_log;
create policy "admins read broadcast log" on broadcast_log
  for select using (is_admin());

-- ---------------------------------------------------------------------
-- 4. REALTIME
-- ---------------------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table notifications; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table incidents;     exception when duplicate_object then null; end;
end $$;
