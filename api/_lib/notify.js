// api/_lib/notify.js
// Shared server-side helpers for in-app notifications + SMS (used by
// api/notifications.js and api/broadcast.js). Import-only: the "_" prefix keeps
// Vercel from deploying this folder as routes. Everything here uses the
// service-role key, so it must never be bundled into frontend code.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// ---------------------------------------------------------------------
// Supabase REST (service role -- bypasses RLS, server-only)
// ---------------------------------------------------------------------
const svcHeaders = () => ({
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
});

export async function supabaseSelect(pathAndQuery) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers: svcHeaders() });
  if (!res.ok) {
    console.error('Supabase REST error:', res.status, await res.text());
    return [];
  }
  return res.json();
}

export async function supabaseInsert(table, rows) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...svcHeaders(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    console.error(`Supabase insert into ${table} failed:`, res.status, await res.text());
    return false;
  }
  return true;
}

/** Verifies the browser's Supabase session token and returns the user id only
 *  if that account's profile role is 'admin'. Never trust a role from the client. */
export async function getAdminId(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const who = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!who.ok) return null;
    const { id } = await who.json();
    if (!id) return null;
    const prof = await supabaseSelect(`profiles?select=role&id=eq.${encodeURIComponent(id)}`);
    return prof?.[0]?.role === 'admin' ? id : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// In-app notifications (the bell in the app's top bar)
// ---------------------------------------------------------------------
/** rows: [{ user_id, kind, title, body, link, related_id }]. Inserted in chunks. */
export async function insertNotifications(rows) {
  const list = (rows || []).filter((r) => r && r.user_id && r.title);
  let ok = 0;
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500).map((r) => ({
      user_id: r.user_id,
      kind: r.kind || 'info',
      title: String(r.title).slice(0, 140),
      body: r.body ? String(r.body).slice(0, 1000) : null,
      link: r.link || null,
      related_id: r.related_id || null,
    }));
    if (await supabaseInsert('notifications', chunk)) ok += chunk.length;
  }
  return ok;
}

// ---------------------------------------------------------------------
// SMS Gateway for Android (Cloud Server mode) -- see api/notifications.js header
// ---------------------------------------------------------------------
const SMS_GATEWAY_URL = () => process.env.SMS_GATEWAY_URL || 'https://api.sms-gate.app/3rdparty/v1/message';
const SMS_BATCH_SIZE = 50;

/** "09171234567" / "9171234567" / "639171234567" / "+639171234567" -> "+639171234567"; anything else -> null. */
export function normalizePhone(raw) {
  const digits = String(raw ?? '').replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  const d = digits.replace(/^\+/, '');
  if (/^09\d{9}$/.test(d)) return '+63' + d.slice(1);
  if (/^639\d{9}$/.test(d)) return '+' + d;
  if (/^9\d{9}$/.test(d)) return '+63' + d;
  return null;
}

/** Sends one text to many numbers. Returns how many numbers the gateway accepted. */
export async function sendSms(phoneNumbers, text) {
  const numbers = [...new Set((phoneNumbers || []).map(normalizePhone).filter(Boolean))];
  if (!numbers.length || !text) return 0;
  if (!process.env.SMS_GATEWAY_LOGIN || !process.env.SMS_GATEWAY_PASSWORD) {
    console.error('SMS not sent: SMS_GATEWAY_LOGIN/SMS_GATEWAY_PASSWORD are not set.');
    return 0;
  }
  const auth = 'Basic ' + Buffer.from(`${process.env.SMS_GATEWAY_LOGIN}:${process.env.SMS_GATEWAY_PASSWORD}`).toString('base64');
  let accepted = 0;
  for (let i = 0; i < numbers.length; i += SMS_BATCH_SIZE) {
    const chunk = numbers.slice(i, i + SMS_BATCH_SIZE);
    try {
      const res = await fetch(SMS_GATEWAY_URL(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify({ textMessage: { text }, phoneNumbers: chunk, withDeliveryReport: false }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) accepted += chunk.length;
      else console.error('SMS gateway error:', res.status, await res.text());
    } catch (err) {
      console.error('SMS send error:', err.message);
    }
  }
  return accepted;
}

// ---------------------------------------------------------------------
// Static reference data shared with the browser bundle
// ---------------------------------------------------------------------
// demo-data.js (evacuation centers, hotlines) and taal-places.js (city centre
// points) are browser files. Evaluating them in an empty sandbox gives the
// server the SAME lists the app shows, with no second copy to keep in sync.
// vercel.json bundles them with the functions (functions.includeFiles).
let evacCache;
export function loadEvacuationCenters() {
  if (evacCache !== undefined) return evacCache;
  try {
    const file = path.join(process.cwd(), 'assets', 'js', 'demo-data.js');
    const raw = vm.runInNewContext(`${readFileSync(file, 'utf8')}\n;RAIN_DEMO`, { window: {} }, { timeout: 1000 });
    evacCache = JSON.parse(JSON.stringify(raw?.evacuationCenters || []));
  } catch (err) {
    console.error('notify: could not load demo-data.js:', err.message);
    evacCache = [];
  }
  return evacCache;
}

let placesCache;
export function loadPlaces() {
  if (placesCache !== undefined) return placesCache;
  try {
    const file = path.join(process.cwd(), 'assets', 'js', 'taal-places.js');
    const raw = vm.runInNewContext(`${readFileSync(file, 'utf8')}\n;window.TaalPlaces.PLACES`, { window: {} }, { timeout: 1000 });
    placesCache = JSON.parse(JSON.stringify(raw || []));
  } catch (err) {
    console.error('notify: could not load taal-places.js:', err.message);
    placesCache = [];
  }
  return placesCache;
}
