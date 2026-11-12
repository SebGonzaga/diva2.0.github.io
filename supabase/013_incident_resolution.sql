-- Run this ONCE in Supabase SQL Editor (after the earlier migrations).
--
-- Adds "proof of resolution" to incidents: when an admin marks a report
-- Resolved, they write a message and attach a photo; both are saved on the
-- incident and emailed to the resident who reported it.

alter table incidents add column if not exists resolution_message text;
alter table incidents add column if not exists resolution_photo_url text;
alter table incidents add column if not exists resolved_at timestamptz;
alter table incidents add column if not exists resolved_by uuid references profiles(id) on delete set null;

-- Public bucket for the proof photos (they're linked from the email, so the
-- URL has to open without a login). Only admins may upload into it.
insert into storage.buckets (id, name, public)
values ('incident-proofs', 'incident-proofs', true)
on conflict (id) do nothing;

create policy "admins upload incident proofs"
  on storage.objects for insert
  with check (bucket_id = 'incident-proofs' and is_admin());
