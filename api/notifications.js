// /api/notifications.js
// Serverless function (Vercel Node.js runtime). Receives Supabase Database
// Webhooks (Dashboard → Database → Webhooks — see supabase/005_*.sql for
// the exact tables/events to wire up) and sends transactional emails via
// Resend (https://resend.com). No npm dependencies, same style as
// api/chat.js and api/weather.js — everything is plain fetch() so this
// deploys without a package.json/build step.
//
// Handles three triggers, dispatched by table + event:
//   1. INSERT on alerts     -> email every resident with an email on file
//   2. INSERT on incidents  -> email every admin
//   3. UPDATE on incidents  -> email the reporter, only when status changed
//
// Required Vercel environment variables:
//   RESEND_API_KEY            - from resend.com
//   EMAIL_FROM                - e.g. "DIVA <alerts@yourdomain.com>", or
//                                "DIVA <onboarding@resend.dev>" for testing
//                                without a verified domain
//   SUPABASE_URL               - same project URL as assets/js/supabase-client.js
//   SUPABASE_SERVICE_ROLE_KEY  - Supabase → Settings → API → service_role.
//                                NEVER put this in frontend code — it bypasses
//                                every RLS policy. It's only safe here because
//                                this file only ever runs on the server.
//   EMAIL_WEBHOOK_SECRET       - any random string you make up. Set the same
//                                value as a custom header on the Supabase
//                                webhook so this endpoint can reject requests
//                                that don't come from Supabase.
//   APP_URL                    - e.g. "https://your-app.vercel.app", used to
//                                build links inside the emails

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
      await notifyReporterOfStatusChange(record);
    }
    // Anything else that matches no branch above is a no-op, not an error —
    // e.g. an incident UPDATE that didn't touch status.
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('notifications.js error:', err);
    return res.status(500).json({ error: 'Failed to process notification' });
  }
}

// ---------------------------------------------------------------------
// Supabase REST helper (service role key — bypasses RLS, server-only)
// ---------------------------------------------------------------------
async function supabaseSelect(pathAndQuery) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    console.error('Supabase REST error:', await res.text());
    return [];
  }
  return res.json();
}

// ---------------------------------------------------------------------
// Resend helpers
// ---------------------------------------------------------------------
async function sendEmail({ to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, html }),
  });
  if (!res.ok) console.error('Resend send error:', await res.text());
}

async function sendEmailBatch(emails) {
  // Resend's batch endpoint caps at 100 per call, so chunk larger lists.
  for (let i = 0; i < emails.length; i += 100) {
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(emails.slice(i, i + 100)),
    });
    if (!res.ok) console.error('Resend batch error:', await res.text());
  }
}

// ---------------------------------------------------------------------
// 1. Alert broadcasts
// ---------------------------------------------------------------------
async function notifyResidentsOfAlert(alert) {
  const rows = await supabaseSelect('profiles?select=email&email=not.is.null');
  const emails = [...new Set(rows.map((r) => r.email).filter(Boolean))];
  if (!emails.length) return;

  const severityLabel = (alert.severity || '').toUpperCase();
  const html = `
    <p><strong>${severityLabel} — ${escapeHtml(alert.area || '')}</strong></p>
    <h2 style="margin:.3em 0;">${escapeHtml(alert.title || 'DIVA Alert')}</h2>
    <p>${escapeHtml(alert.message || '')}</p>
    <p style="color:#666; font-size:.85em;">You're receiving this because you have a DIVA account. Open the app for full details.</p>`;

  await sendEmailBatch(
    emails.map((email) => ({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: `DIVA Alert: ${alert.title || 'New alert issued'}`,
      html,
    }))
  );
}

// ---------------------------------------------------------------------
// 2. New incident report -> admins
// ---------------------------------------------------------------------
async function notifyAdminsOfIncident(incident) {
  const rows = await supabaseSelect('profiles?select=email&role=eq.admin&email=not.is.null');
  const emails = [...new Set(rows.map((r) => r.email).filter(Boolean))];
  if (!emails.length) return;

  const html = `
    <p>A new incident report was just submitted.</p>
    <p><strong>${escapeHtml(incident.category || 'Incident')}</strong> — ${escapeHtml(incident.area || 'Location not provided')}</p>
    <p>${escapeHtml(incident.description || 'No description provided.')}</p>
    <p><a href="${process.env.APP_URL || ''}/admin-incidents.html">Review it in the admin dashboard</a></p>`;

  await sendEmailBatch(
    emails.map((email) => ({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: `New incident report: ${incident.category || 'Incident'}`,
      html,
    }))
  );
}

// ---------------------------------------------------------------------
// 3. Incident status change -> the reporter
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
