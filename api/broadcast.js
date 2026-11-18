// /api/broadcast.js
// Admin-only "Daily safety update". One button on the admin dashboard sends every
// resident AND admin a personalised update by SMS + the in-app notification bar:
//   weather today, flood-risk estimate, Taal volcano level, recent earthquakes,
//   active alerts, reviewed incidents near them, and their NEAREST evacuation
//   center (from their saved coordinates, else their city) with a directions link.
//
// POST { dryRun: true }              -> preview only: counts + a sample message, nothing is sent
// POST { dryRun: false, note?, force? } -> sends. A second send within 10 minutes is refused
//                                          unless force=true (protects against double clicks).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENWEATHER_API_KEY,
//      SMS_GATEWAY_LOGIN, SMS_GATEWAY_PASSWORD (same ones api/notifications.js uses).

import { fetchJson, haversineKm } from './_lib/util.js';
import {
  getAdminId, supabaseSelect, supabaseSelectStrict, supabaseInsert, insertNotifications, sendSms,
  normalizePhone, loadEvacuationCenters, loadPlaces,
} from './_lib/notify.js';
import { residentLocation, nearestEvacCenter, floodEstimate, topAlerts, buildSmsText, buildShortSms, groupByText } from './_lib/broadcast.js';

const OWM = 'https://api.openweathermap.org/data/2.5';
const USGS = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
const MAX_WEATHER_CELLS = 25;
const NEAR_INCIDENT_KM = 10;

// --- city-wide hazard data (fetched once per broadcast; each part fails soft) ---------

async function getQuakes() {
  try {
    const start = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const q = new URLSearchParams({ format: 'geojson', starttime: start, minmagnitude: '2.5', minlatitude: '4', maxlatitude: '21', minlongitude: '116', maxlongitude: '127', orderby: 'magnitude', limit: '20' });
    const j = await fetchJson(`${USGS}?${q}`, { timeoutMs: 6000 });
    const feats = j?.features || [];
    if (!feats.length) return { count: 0 };
    const top = feats[0].properties;
    return { count: feats.length, minMag: '2.5', maxMag: Number(top.mag).toFixed(1), place: String(top.place || '').replace(/^\d+\s*km\s+\w+\s+of\s+/i, '').slice(0, 40) };
  } catch (err) {
    console.error('broadcast quakes:', err.message);
    return null;
  }
}

/** Newest of: an admin-entered volcano_status row, or the nightly digest (only when it states one level). */
async function getVolcano() {
  try {
    const [manual, digest] = await Promise.all([
      supabaseSelect(`volcano_status?select=alert_level,bulletin_issued_at&volcano=eq.Taal&order=bulletin_issued_at.desc&limit=1`),
      supabaseSelect(`ai_digests?select=alert_level,digest_date,source_fetched_at&kind=eq.volcano&status=eq.ok&alert_level=not.is.null&order=digest_date.desc&limit=1`),
    ]);
    const cands = [];
    if (manual?.[0]) cands.push({ level: manual[0].alert_level, ts: Date.parse(manual[0].bulletin_issued_at) });
    if (digest?.[0]) cands.push({ level: digest[0].alert_level, ts: Date.parse(digest[0].source_fetched_at || digest[0].digest_date) });
    if (!cands.length) return null;
    const best = cands.sort((a, b) => b.ts - a.ts)[0];
    const dateLabel = Number.isFinite(best.ts) ? new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' }).format(new Date(best.ts)) : '';
    return { level: best.level, dateLabel };
  } catch (err) {
    console.error('broadcast volcano:', err.message);
    return null;
  }
}

async function getWeatherCell(lat, lng) {
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) return { weather: null, flood: null };
  const [cur, fc] = await Promise.allSettled([
    fetchJson(`${OWM}/weather?lat=${lat}&lon=${lng}&units=metric&appid=${key}`, { timeoutMs: 6000 }),
    fetchJson(`${OWM}/forecast?lat=${lat}&lon=${lng}&units=metric&appid=${key}`, { timeoutMs: 6000 }),
  ]);
  const c = cur.status === 'fulfilled' ? cur.value : null;
  const weather = c ? {
    desc: String(c.weather?.[0]?.description || 'unknown').replace(/^./, (s) => s.toUpperCase()),
    tempC: Math.round(c.main?.temp),
    rainMm: Math.round((c.rain?.['1h'] || 0) * 10) / 10,
  } : null;
  const flood = fc.status === 'fulfilled' ? floodEstimate(fc.value?.list || []) : null;
  return { weather, flood };
}

// --- main -----------------------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const adminId = await getAdminId(req);
    if (!adminId) return res.status(403).json({ error: 'Admins only' });

    const { dryRun = false, note = '', force = false } = req.body || {};

    if (!dryRun && !force) {
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const recent = await supabaseSelect(`broadcast_log?select=created_at&created_at=gte.${since}&limit=1`);
      if (recent.length) return res.status(429).json({ error: 'A safety update was already sent in the last 10 minutes.', code: 'recent_send' });
    }

    const nowIso = new Date().toISOString();
    const [profiles, alertRows, incidentRows, quake, volcano] = await Promise.all([
      supabaseSelectStrict('profiles?select=id,full_name,role,barangay,phone,lat,lng&status=eq.active&limit=5000'),
      supabaseSelect(`alerts?select=title,severity,type,area&starts_at=lte.${nowIso}&or=(expires_at.is.null,expires_at.gt.${nowIso})&order=created_at.desc&limit=50`),
      supabaseSelect('incidents?select=id,lat,lng,category&status=eq.verified&limit=500'),
      getQuakes(),
      getVolcano(),
    ]);
    if (!profiles.length) return res.status(200).json({
      ok: true, dryRun: !!dryRun, recipients: 0, smsRecipients: 0, residents: 0, admins: 0, smsAccepted: 0, inApp: 0,
      smsConfigured: !!(process.env.SMS_GATEWAY_LOGIN && process.env.SMS_GATEWAY_PASSWORD),
      weatherConfigured: !!process.env.OPENWEATHER_API_KEY,
      sample: '', message: 'No recipients found.',
      hazards: { activeAlerts: alertRows.length, reviewedIncidents: incidentRows.length, quakes: quake?.count ?? null, taalLevel: volcano?.level ?? null },
    });

    const centers = loadEvacuationCenters();
    const places = loadPlaces();
    const alerts = topAlerts(alertRows, 2);

    // Resolve every recipient's location, then fetch weather once per ~11 km cell.
    const people = profiles.map((p) => {
      const loc = residentLocation(p, places);
      return { ...p, loc, cell: `${loc.lat.toFixed(1)},${loc.lng.toFixed(1)}` };
    });
    const cellKeys = [...new Set(people.map((p) => p.cell))].slice(0, MAX_WEATHER_CELLS);
    const cellData = {};
    await Promise.all(cellKeys.map(async (k) => {
      const [lat, lng] = k.split(',').map(Number);
      cellData[k] = await getWeatherCell(lat, lng);
    }));

    const items = people.map((p) => {
      const cell = cellData[p.cell] || { weather: null, flood: null };
      const center = nearestEvacCenter(p.loc, centers);
      const incidentsNear = incidentRows.filter((i) => i.lat != null && i.lng != null && haversineKm(p.loc.lat, p.loc.lng, i.lat, i.lng) <= NEAR_INCIDENT_KM).length;
      const text = buildSmsText({
        area: p.barangay, weather: cell.weather, flood: cell.flood, volcano, quake,
        alerts, alertCount: alertRows.length,
        incidentsNear, incidentsTotal: incidentRows.length,
        center, note,
      });
      const smsText = buildShortSms({
        area: p.barangay, weather: cell.weather, flood: cell.flood, volcano, alertCount: alertRows.length, center,
      });
      return { id: p.id, role: p.role, phone: normalizePhone(p.phone), text, smsText, center };
    });

    const smsItems = items.filter((i) => i.phone);

    if (dryRun) {
      const sample = items.find((i) => i.id === adminId) || items[0];
      return res.status(200).json({
        ok: true, dryRun: true,
        recipients: items.length, smsRecipients: smsItems.length,
        residents: items.filter((i) => i.role !== 'admin').length, admins: items.filter((i) => i.role === 'admin').length,
        smsConfigured: !!(process.env.SMS_GATEWAY_LOGIN && process.env.SMS_GATEWAY_PASSWORD),
        weatherConfigured: !!process.env.OPENWEATHER_API_KEY,
        sample: sample.smsText,
        hazards: { activeAlerts: alertRows.length, reviewedIncidents: incidentRows.length, quakes: quake?.count ?? null, taalLevel: volcano?.level ?? null },
      });
    }

    // 1) In-app bell notification for EVERYONE (with or without a phone number).
    const inApp = await insertNotifications(items.map((i) => ({
      user_id: i.id, kind: 'broadcast', title: 'Daily safety update',
      body: i.text.replace(/^👋[^\n]*\n📅[^\n]*\n(📍[^\n]*\n)?\n*/, '').replace(/\s*https?:\/\/\S+/g, '').replace(/\n*💛 Stay safe[^\n]*$/, '').trim(),
      link: i.role === 'admin' ? 'admin-dashboard.html' : 'emergency.html',
    })));

    // 2) SMS: one gateway request per distinct text (people who share a weather cell,
    //    evacuation center and incident count get the identical message).
    // Send one text group at a time with a short pause. Sending them all at once
    // makes the phone's SMS app send a burst, which triggers iOS's "large number
    // of messages" prompt and fails the rest. Stop before the function's time limit
    // and report what was not sent, so it can be resent.
    let smsAccepted = 0;
    let smsSkippedGroups = 0;
    const SMS_PAUSE_MS = 2000;
    const SMS_TIME_BUDGET_MS = 45000;
    const smsStart = Date.now();
    const groups = groupByText(smsItems.map((i) => ({ ...i, text: i.smsText })));
    for (let i = 0; i < groups.length; i++) {
      if (Date.now() - smsStart > SMS_TIME_BUDGET_MS) { smsSkippedGroups = groups.length - i; break; }
      smsAccepted += await sendSms(groups[i].members.map((m) => m.phone), groups[i].text);
      if (i < groups.length - 1) await new Promise((r) => setTimeout(r, SMS_PAUSE_MS));
    }

    await supabaseInsert('broadcast_log', {
      sent_by: adminId, recipients: items.length, sms_recipients: smsItems.length, sms_accepted: smsAccepted,
      preview: (items.find((i) => i.id === adminId) || items[0]).text.slice(0, 600),
    });

    return res.status(200).json({ ok: true, recipients: items.length, smsRecipients: smsItems.length, smsAccepted, smsSkippedGroups, inApp });
  } catch (err) {
    console.error('broadcast error:', err);
    return res.status(500).json({ error: 'Something went wrong sending the update: ' + String(err?.message || err).slice(0, 300) });
  }
}
