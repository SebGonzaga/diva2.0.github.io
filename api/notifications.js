// /api/notifications.js
// Serverless function (Vercel Node.js runtime). Receives Supabase Database
// Webhooks (Dashboard -> Database -> Webhooks -- see BACKEND_README.md for
// the exact tables/events to wire up).
//
// Resident alert broadcasts go out as SMS, sent through an Android phone
// running the "SMS Gateway for Android°" app (github.com/capcom6/android-sms-gateway)
// in Cloud Server mode -- the phone is the actual sender, this function just
// POSTs to the gateway's cloud relay, which pushes the send down to the phone.
// Admin and reporter notifications still go out as email via Nodemailer/SMTP,
// since those go to a handful of known people rather than the whole town.
//
// Handles these triggers, dispatched by table + event. Every one also drops a row in
// the `notifications` table, which is what the bell in the app's top bar shows
// (run supabase/014_notifications_and_locations.sql first):
//   1. INSERT on alerts      -> SMS every resident/admin with a phone + bell for everyone
//   2. INSERT on incidents   -> email every admin + bell for admins
//   3. UPDATE on incidents, status -> 'verified' (Reviewed / "under review", now visible on the
//                              Report Incident page + map): SMS + bell to every resident;
//                              the reporter gets their own message (SMS + bell + email)
//   4. UPDATE on incidents, status -> 'resolved': SMS + bell to the reporter, bell to every other
//                              resident (the incident has left the map). The proof-photo email
//                              is still sent by /api/incident-update.
//   5. Any other status change -> email the reporter, as before
//
// Required Vercel environment variables:
//   SMS_GATEWAY_LOGIN          - username shown in the SMS Gateway app's
//                                Cloud Server section on the phone
//   SMS_GATEWAY_PASSWORD       - password shown alongside it
//   SMS_GATEWAY_URL             - optional override; defaults to
//                                https://api.sms-gate.app/3rdparty/v1/message
//                                (only change this if you're self-hosting a
//                                private server instead of using the public
//                                cloud relay)
//   SMTP_HOST                  - e.g. "smtp.gmail.com"
//   SMTP_PORT                  - e.g. 465 (SSL) or 587 (STARTTLS)
//   SMTP_SECURE                - "true" for port 465, "false" for 587
//   SMTP_USER                  - the mailbox address, e.g. rainalerts@gmail.com
//   SMTP_PASS                  - a 16-character Gmail App Password (NOT your
//                                normal account password -- generate one at
//                                myaccount.google.com/apppasswords, requires
//                                2-Step Verification to be turned on first)
//   EMAIL_FROM                 - e.g. "RAIN Alerts <rainalerts@gmail.com>" --
//                                must use the same address as SMTP_USER or
//                                Gmail will reject/rewrite it
//   SUPABASE_URL                - same project URL as assets/js/supabase-client.js
//   SUPABASE_SERVICE_ROLE_KEY   - Supabase -> Settings -> API -> service_role.
//                                 NEVER put this in frontend code -- it bypasses
//                                 every RLS policy. It's only safe here because
//                                 this file only ever runs on the server.
//   EMAIL_WEBHOOK_SECRET        - any random string you make up. Set the same
//                                 value as a custom header on the Supabase
//                                 webhook so this endpoint can reject requests
//                                 that don't come from Supabase.
//   APP_URL                     - e.g. "https://your-app.vercel.app", used to
//                                 build links inside the emails

import nodemailer from 'nodemailer';
import { supabaseSelect, insertNotifications, sendSms, loadEvacuationCenters } from './_lib/notify.js';
import { nearestEvacCenter } from './_lib/broadcast.js';

let transporter; // reused across warm invocations instead of reconnecting every call

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: process.env.SMTP_SECURE !== 'false', // true for 465, false for 587
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (req.headers['x-webhook-secret'] !== process.env.EMAIL_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { type, table, record, old_record } = req.body || {};

  try {
    if (table === 'alerts' && type === 'INSERT') {
      await notifyResidentsOfAlert(record);
    } else if (table === 'incidents' && type === 'INSERT') {
      await notifyAdminsOfIncident(record);
    } else if (table === 'incidents' && type === 'UPDATE' && old_record && record.status !== old_record.status) {
      if (record.status === 'verified') await notifyIncidentUnderReview(record);
      else if (record.status === 'resolved') await notifyIncidentResolved(record);
      // 'resolved' and 'pending' are emailed by /api/incident-update (proof photo /
      // safety info), so skip them here or the resident would get two emails.
      if (!['resolved', 'pending'].includes(record.status)) await notifyReporterOfStatusChange(record);
    }
    // Anything else that matches no branch above is a no-op, not an error --
    // e.g. an incident UPDATE that didn't touch status.
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('notifications.js error:', err);
    return res.status(500).json({ error: 'Failed to process notification' });
  }
}

// ---------------------------------------------------------------------
// Nodemailer helpers
// ---------------------------------------------------------------------
async function sendEmail({ to, subject, html }) {
  try {
    await getTransporter().sendMail({ from: process.env.EMAIL_FROM, to, subject, html });
  } catch (err) {
    console.error('SMTP send error:', err.message);
  }
}

async function sendEmailBatch(emails) {
  // Nodemailer/SMTP has no native batch endpoint, so send each message
  // individually, one at a time, so a slow/failed send can't spike memory or
  // trip Gmail's rate limiting from a burst of simultaneous connections.
  for (const email of emails) {
    await sendEmail(email);
  }
}

// ---------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------
const appLink = (page) => `${process.env.APP_URL || ''}/${page}`;
const COORD_RE = /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/;

/** Report "area" is often just "14.08312, 121.14977" (GPS). Turn that into
 *  something a resident can recognise: the barangay of the nearest evacuation center. */
function placeLabel(incident) {
  const area = String(incident.area || '').trim();
  if (area && !COORD_RE.test(area) && !/^(detecting|permission denied|location unavailable)/i.test(area)) return area;
  const lat = Number(incident.lat), lng = Number(incident.lng);
  if (incident.lat != null && incident.lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    const c = nearestEvacCenter({ lat, lng }, loadEvacuationCenters());
    if (c?.address) return `near ${String(c.address).replace(/^Brgy\.?\s*/i, 'Brgy. ')}`;
  }
  return 'location not provided';
}

const residentIds = async () => (await supabaseSelect('profiles?select=id,phone&role=eq.resident&limit=5000'));

// ---------------------------------------------------------------------
// 1. Alert broadcasts (SMS + bell)
// ---------------------------------------------------------------------
async function notifyResidentsOfAlert(alert) {
  const rows = await supabaseSelect('profiles?select=id,phone,role&limit=5000');
  if (!rows.length) return;

  const severityLabel = (alert.severity || '').toUpperCase();
  // Plain text, not HTML -- this is SMS. Kept short since carriers split
  // anything over 160 chars into multiple message segments.
  const text = [
    `RAIN Alert (${severityLabel}): ${alert.title || 'New alert issued'}`,
    alert.area ? `Area: ${alert.area}` : null,
    alert.message || null,
    'Open the RAIN app for full details.',
  ].filter(Boolean).join('\n');

  await insertNotifications(rows.map((r) => ({
    user_id: r.id, kind: 'alert',
    title: `${severityLabel ? severityLabel + ': ' : ''}${alert.title || 'New alert issued'}`,
    body: [alert.area ? `Area: ${alert.area}` : null, alert.message].filter(Boolean).join(' — '),
    link: r.role === 'admin' ? 'admin-alerts.html' : 'alerts.html',
    related_id: alert.id,
  })));

  await sendSms(rows.map((r) => r.phone).filter(Boolean), text);
}

// ---------------------------------------------------------------------
// 2. New incident report -> admins (email + bell)
// ---------------------------------------------------------------------
async function notifyAdminsOfIncident(incident) {
  const rows = await supabaseSelect('profiles?select=id,email&role=eq.admin');
  if (!rows.length) return;

  await insertNotifications(rows.map((r) => ({
    user_id: r.id, kind: 'incident_new',
    title: `New incident report: ${incident.category || 'Incident'}`,
    body: `${placeLabel(incident)} — ${String(incident.description || 'No description provided.').slice(0, 160)}`,
    link: 'admin-incidents.html', related_id: incident.id,
  })));

  const emails = [...new Set(rows.map((r) => r.email).filter(Boolean))];
  if (!emails.length) return;

  const html = `
    <p>A new incident report was just submitted.</p>
    <p><strong>${escapeHtml(incident.category || 'Incident')}</strong> — ${escapeHtml(incident.area || 'Location not provided')}</p>
    <p>${escapeHtml(incident.description || 'No description provided.')}</p>
    <p><a href="${appLink('admin-incidents.html')}">Review it in the admin dashboard</a></p>`;

  await sendEmailBatch(
    emails.map((email) => ({
      to: email,
      subject: `New incident report: ${incident.category || 'Incident'}`,
      html,
    }))
  );
}

// ---------------------------------------------------------------------
// 3. Incident marked Reviewed ("under review") -> every resident (SMS + bell)
//    It is now listed on the Report Incident page and pinned on the dashboard map.
// ---------------------------------------------------------------------
async function notifyIncidentUnderReview(incident) {
  const place = placeLabel(incident);
  const category = incident.category || 'Incident';
  const residents = await residentIds();

  const others = residents.filter((r) => r.id !== incident.reporter_id);
  await insertNotifications(others.map((r) => ({
    user_id: r.id, kind: 'incident_reviewed',
    title: `Incident under review: ${category}`,
    body: `A ${category.toLowerCase()} report (${place}) is now under review by officials. See it on the Report Incident page.`,
    link: 'report.html#reviewed', related_id: incident.id,
  })));
  await sendSms(
    others.map((r) => r.phone).filter(Boolean),
    `RAIN: New incident under review - ${category} (${place}). See details on the Report Incident page. Stay alert.`
  );

  // The person who reported it gets their own wording.
  if (incident.reporter_id) {
    await insertNotifications([{
      user_id: incident.reporter_id, kind: 'incident_reviewed',
      title: 'Your report is under review',
      body: `Officials reviewed your ${category.toLowerCase()} report (${place}). It is now listed on the Report Incident page.`,
      link: 'report.html#reviewed', related_id: incident.id,
    }]);
    const self = residents.find((r) => r.id === incident.reporter_id)
      || (await supabaseSelect(`profiles?select=id,phone&id=eq.${incident.reporter_id}`))[0];
    if (self?.phone) await sendSms([self.phone], `RAIN: Your ${category} report (${place}) is now under review by officials. We will message you once it is resolved.`);
  }
}

// ---------------------------------------------------------------------
// 4. Incident resolved -> reporter (SMS + bell); other residents (bell only)
// ---------------------------------------------------------------------
async function notifyIncidentResolved(incident) {
  const place = placeLabel(incident);
  const category = incident.category || 'Incident';

  if (incident.reporter_id) {
    await insertNotifications([{
      user_id: incident.reporter_id, kind: 'incident_resolved',
      title: 'Your incident has been resolved',
      body: `Your ${category.toLowerCase()} report (${place}) was marked resolved${incident.resolution_message ? `: ${String(incident.resolution_message).slice(0, 200)}` : '.'}`,
      link: 'report.html', related_id: incident.id,
    }]);
    const rows = await supabaseSelect(`profiles?select=phone&id=eq.${incident.reporter_id}`);
    if (rows[0]?.phone) await sendSms([rows[0].phone], `RAIN: Your ${category} report (${place}) has been RESOLVED. It has been removed from the incident list and map. Thank you for reporting.`);
  }

  // Everyone else was told it was under review -- tell them it is closed (no SMS, to keep texts meaningful).
  const residents = await residentIds();
  await insertNotifications(residents.filter((r) => r.id !== incident.reporter_id).map((r) => ({
    user_id: r.id, kind: 'incident_resolved',
    title: `Incident resolved: ${category}`,
    body: `The ${category.toLowerCase()} incident (${place}) has been resolved and removed from the map.`,
    link: 'report.html#reviewed', related_id: incident.id,
  })));
}

// ---------------------------------------------------------------------
// 5. Other status changes -> the reporter (email + bell for 'dismissed')
// ---------------------------------------------------------------------
async function notifyReporterOfStatusChange(incident) {
  if (!incident.reporter_id) return; // reports without a signed-in reporter can't be notified
  const rows = await supabaseSelect(`profiles?select=email,full_name&id=eq.${incident.reporter_id}`);
  const reporter = rows[0];
  if (!reporter || !reporter.email) return;

  const statusLabel = { pending: 'Pending', verified: 'Reviewed', resolved: 'Resolved', dismissed: 'Dismissed' }[incident.status] || incident.status;
  const html = `
    <p>Hi ${escapeHtml(reporter.full_name || 'there')},</p>
    <p>Your incident report (<strong>${escapeHtml(incident.category || 'Incident')}</strong>) has been updated to:</p>
    <p style="font-size:1.1em;"><strong>${escapeHtml(statusLabel)}</strong></p>
    <p style="color:#666; font-size:.85em;">Thank you for helping keep your community informed.</p>`;

  await sendEmail({
    to: reporter.email,
    subject: `Update on your incident report: ${statusLabel}`,
    html,
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
