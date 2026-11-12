// Builds the two emails an admin can send from admin-incidents.html:
//   - "Resolved": admin's message + proof photo
//   - "Pending":  stay-safe notice + nearest evacuation centers + emergency contacts
// Pure functions (no network) so they can be unit-tested.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { haversineKm } from './util.js';

let demoData;
// Same trick as api/_lib/tools.js: evaluate assets/js/demo-data.js so the email
// uses the SAME evacuation centers / hotlines as the Emergency page.
export function loadDemo() {
  if (demoData !== undefined) return demoData;
  try {
    const file = path.join(process.cwd(), 'assets', 'js', 'demo-data.js');
    const raw = vm.runInNewContext(`${readFileSync(file, 'utf8')}\n;RAIN_DEMO`, { window: {} }, { timeout: 1000 });
    demoData = JSON.parse(JSON.stringify(raw));
  } catch (err) {
    console.error('incident-mail: could not load demo-data.js:', err.message);
    demoData = null;
  }
  return demoData;
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const multiline = (s) => escapeHtml(s).replace(/\r?\n/g, '<br>');

/** Up to `limit` evacuation centers closest to the incident; falls back to a
 *  barangay-name match on the area label when the report has no coordinates. */
export function nearestCenters(incident, centers = [], limit = 3) {
  const list = centers.filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng));
  const lat = Number(incident.lat), lng = Number(incident.lng);
  if (incident.lat != null && incident.lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    return list
      .map((c) => ({ ...c, km: haversineKm(lat, lng, c.lat, c.lng) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, limit);
  }
  const area = String(incident.area || '').toLowerCase();
  if (!area) return [];
  return list
    .filter((c) => {
      const brgy = String(c.address || '').toLowerCase().replace(/^brgy\.?\s*/, '').trim();
      return brgy.length > 3 && area.includes(brgy);
    })
    .slice(0, limit)
    .map((c) => ({ ...c, km: null }));
}

const wrap = (inner) => `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1c2a3a;line-height:1.55;">
  ${inner}
  <hr style="border:none;border-top:1px solid #e3e8ef;margin:24px 0 12px;">
  <p style="color:#6b7787;font-size:12px;">Sent by RAIN — Tanauan City disaster-preparedness. Please don't reply to this email.</p>
</div>`;

export function buildResolvedEmail({ incident, reporterName, message, photoCid }) {
  const html = wrap(`
    <p>Hi ${escapeHtml(reporterName || 'there')},</p>
    <p>Good news — your report <strong>${escapeHtml(incident.category || 'Incident')}</strong>
       (${escapeHtml(incident.area || 'location not provided')}) has been marked
       <strong style="color:#15803d;">Resolved</strong>.</p>
    ${message ? `<p style="background:#f3f6fa;border-left:4px solid #15803d;padding:10px 14px;margin:16px 0;">${multiline(message)}</p>` : ''}
    ${photoCid ? `<p style="margin:16px 0 6px;"><strong>Proof of resolution:</strong></p>
    <img src="cid:${photoCid}" alt="Proof that the incident was resolved" style="max-width:100%;border-radius:8px;display:block;">` : ''}
    <p style="margin-top:18px;">Thank you for reporting and helping keep Tanauan informed.</p>`);
  return { subject: `Resolved: your ${incident.category || 'incident'} report`, html };
}

export function buildPendingEmail({ incident, reporterName, note, centers, contacts, appUrl }) {
  const centerRows = centers.length
    ? centers.map((c) => `
        <li style="margin-bottom:8px;"><strong>${escapeHtml(c.name)}</strong><br>
        <span style="color:#6b7787;font-size:13px;">${escapeHtml(c.address || '')}${c.km != null ? ` · about ${c.km.toFixed(1)} km from the reported location` : ''}</span></li>`).join('')
    : '';
  const centerBlock = centers.length
    ? `<ul style="padding-left:18px;margin:8px 0;">${centerRows}</ul>`
    : `<p>We couldn't pin your exact location, so please check the full list of evacuation centers on the
       <a href="${escapeHtml(appUrl || '')}/emergency.html#evac">RAIN Emergency page</a>.</p>`;

  const contactRows = contacts.map((c) => `
      <tr><td style="padding:4px 12px 4px 0;"><strong>${escapeHtml(c.name)}</strong></td>
          <td style="padding:4px 0;">${(c.numbers || [c.number]).map(escapeHtml).join(' / ')}</td></tr>`).join('');

  const html = wrap(`
    <p>Hi ${escapeHtml(reporterName || 'there')},</p>
    <p>We received your report <strong>${escapeHtml(incident.category || 'Incident')}</strong>
       (${escapeHtml(incident.area || 'location not provided')}). It is still
       <strong style="color:#b45309;">Pending</strong> — our team is working on it.</p>
    <p><strong>Please stay safe</strong> while you wait. Stay away from the hazard, follow instructions
       from local officials, and move to higher or safer ground if conditions get worse.</p>
    ${note ? `<p style="background:#f3f6fa;border-left:4px solid #b45309;padding:10px 14px;">${multiline(note)}</p>` : ''}
    <h3 style="margin:22px 0 4px;font-size:16px;">Nearest evacuation ${centers.length === 1 ? 'center' : 'centers'}</h3>
    ${centerBlock}
    <h3 style="margin:22px 0 4px;font-size:16px;">Emergency contacts</h3>
    <table style="border-collapse:collapse;font-size:14px;">${contactRows}</table>
    <p style="margin-top:18px;">If you or anyone nearby is in immediate danger, call <strong>911</strong> right away.</p>`);
  return { subject: 'Stay safe — your incident report is still pending', html };
}
