// /api/incident-update.js
// Called by admin-incidents.html when an admin clicks Mark Resolved / Mark Pending.
// Verifies the caller is an admin, saves the status change, then emails the reporter:
//   resolved -> admin's message + proof photo
//   pending  -> stay-safe notice + nearest evacuation centers + emergency contacts
//
// Env vars (all already used by api/notifications.js): SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER,
// SMTP_PASS, EMAIL_FROM, APP_URL.

import nodemailer from 'nodemailer';
import { loadDemo, nearestCenters, buildResolvedEmail, buildPendingEmail } from './_lib/incident-mail.js';

let transporter;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: process.env.SMTP_SECURE !== 'false',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

const svcHeaders = () => ({
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
});
const rest = (p, init = {}) => fetch(`${process.env.SUPABASE_URL}/rest/v1/${p}`, { ...init, headers: { ...svcHeaders(), 'Content-Type': 'application/json', ...(init.headers || {}) } });

async function getAdminId(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const who = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!who.ok) return null;
  const { id } = await who.json();
  if (!id) return null;
  const prof = await (await rest(`profiles?select=role&id=eq.${encodeURIComponent(id)}`)).json();
  return prof?.[0]?.role === 'admin' ? id : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const adminId = await getAdminId(req);
    if (!adminId) return res.status(403).json({ error: 'Admins only' });

    const { incidentId, status, message, photoUrl } = req.body || {};
    if (!/^[0-9a-f-]{36}$/i.test(String(incidentId || ''))) return res.status(400).json({ error: 'Invalid incident id' });
    if (!['resolved', 'pending'].includes(status)) return res.status(400).json({ error: 'Status must be resolved or pending' });

    const note = String(message || '').trim().slice(0, 1500);
    let proofUrl = null;
    if (status === 'resolved') {
      proofUrl = String(photoUrl || '');
      // Only accept photos from our own proof bucket (also stops the mailer fetching arbitrary URLs).
      const allowed = `${process.env.SUPABASE_URL}/storage/v1/object/public/incident-proofs/`;
      if (!proofUrl.startsWith(allowed)) return res.status(400).json({ error: 'A proof photo is required to mark a report resolved.' });
    }

    const incRows = await (await rest(`incidents?select=*&id=eq.${incidentId}`)).json();
    const incident = incRows?.[0];
    if (!incident) return res.status(404).json({ error: 'Incident not found' });

    const patch = status === 'resolved'
      ? { status, resolution_message: note || null, resolution_photo_url: proofUrl, resolved_at: new Date().toISOString(), resolved_by: adminId }
      : { status };
    const upd = await rest(`incidents?id=eq.${incidentId}`, { method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=minimal' } });
    if (!upd.ok) { console.error('incident-update patch:', await upd.text()); return res.status(500).json({ error: 'Could not save the status' }); }

    // --- email the reporter (status is already saved; a mail failure is reported, not fatal) ---
    let reporter = null;
    if (incident.reporter_id) {
      const p = await (await rest(`profiles?select=email,full_name&id=eq.${incident.reporter_id}`)).json();
      reporter = p?.[0] || null;
    }
    if (!reporter?.email) return res.status(200).json({ ok: true, emailSent: false, reason: 'The reporter has no email on file.' });

    let mail;
    if (status === 'resolved') {
      mail = { ...buildResolvedEmail({ incident, reporterName: reporter.full_name, message: note, photoCid: 'proof-photo' }),
        attachments: [{ filename: 'proof.jpg', path: proofUrl, cid: 'proof-photo' }] };
    } else {
      const demo = loadDemo();
      const centers = nearestCenters(incident, demo?.evacuationCenters || []);
      mail = buildPendingEmail({ incident, reporterName: reporter.full_name, note, centers, contacts: demo?.emergencyContacts || [], appUrl: process.env.APP_URL || '' });
    }

    try {
      await getTransporter().sendMail({ from: process.env.EMAIL_FROM, to: reporter.email, ...mail });
    } catch (err) {
      console.error('incident-update SMTP error:', err.message);
      return res.status(200).json({ ok: true, emailSent: false, reason: 'Status saved, but the email could not be sent.' });
    }
    return res.status(200).json({ ok: true, emailSent: true });
  } catch (err) {
    console.error('incident-update error:', err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
