// api/_lib/broadcast.js
// Pure helpers (no network) for the admin "Daily safety update" broadcast, so
// they can be unit-tested: pick a resident's location, find the nearest
// evacuation center, estimate flood risk from rainfall, and build the SMS text.

import { haversineKm } from './util.js';

export const DEFAULT_LOC = { lat: 14.0863, lng: 121.1497, label: 'Tanauan City, Batangas' };

const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const isCoord = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** Where is this resident? Saved coordinates win; otherwise the centre of the
 *  city they picked at sign-up; otherwise Tanauan City (the app's default). */
export function residentLocation(profile, places = []) {
  const lat = num(profile?.lat), lng = num(profile?.lng);
  if (isCoord(lat, lng)) return { lat, lng, source: 'saved' };
  const name = String(profile?.barangay || '').trim().toLowerCase();
  if (name) {
    const hit = places.find((p) => p.name.toLowerCase() === name)
      || places.find((p) => name.includes(p.name.split(',')[0].toLowerCase()));
    if (hit) return { lat: hit.lat, lng: hit.lng, source: 'city' };
  }
  return { lat: DEFAULT_LOC.lat, lng: DEFAULT_LOC.lng, source: 'default' };
}

/** Closest evacuation center, preferring real shelters over malls/halls when one is reasonably close. */
export function nearestEvacCenter(loc, centers = []) {
  const list = centers
    .filter((c) => isCoord(num(c.lat), num(c.lng)))
    .map((c) => ({ ...c, km: haversineKm(loc.lat, loc.lng, c.lat, c.lng) }))
    .sort((a, b) => a.km - b.km);
  if (!list.length) return null;
  const shelter = list.find((c) => (c.category || 'shelter') === 'shelter');
  return shelter && shelter.km <= list[0].km + 3 ? shelter : list[0];
}

export const directionsUrl = (c) => `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}&travelmode=driving`;

/** Rain-based flood-risk ESTIMATE from OpenWeather's 5-day/3-hour forecast list.
 *  This is not an official flood bulletin -- the SMS says "est." for that reason. */
export function floodEstimate(forecastList = [], nowSec = Date.now() / 1000) {
  const next24 = forecastList.filter((f) => f.dt >= nowSec - 3 * 3600 && f.dt <= nowSec + 24 * 3600);
  if (!next24.length) return null;
  const mm = next24.reduce((s, f) => s + (Number(f.rain?.['3h']) || 0), 0);
  const level = mm >= 100 ? 'High' : mm >= 50 ? 'Moderate' : mm >= 20 ? 'Low-Moderate' : 'Low';
  return { mm: Math.round(mm), level };
}

const SEVERITY_RANK = { critical: 3, warning: 2, advisory: 1, information: 0 };
export function topAlerts(alerts = [], limit = 2) {
  return [...alerts].sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0)).slice(0, limit);
}

const phDate = (ms) => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' }).format(new Date(ms));

/** Short, GSM-friendly plain text (no emoji / degree sign, so segments stay cheap). */
/** Friendly, practical tips based on today's weather and flood estimate.
 *  Kept to plain ASCII so the SMS stays in the cheaper GSM character set. */
export function dayTips({ weather, flood }) {
  const tips = [];
  const temp = Number(weather?.tempC);
  const desc = String(weather?.desc || '').toLowerCase();
  const rainy = (Number(weather?.rainMm) > 0) || /rain|drizzle|storm|thunder/.test(desc);
  if (Number.isFinite(temp) && temp >= 33) tips.push('🥵 It is a hot one today, so bring water, wear a hat, and take breaks in the shade.');
  else if (Number.isFinite(temp) && temp >= 30) tips.push('💧 Warm day ahead, so keep a water bottle handy.');
  if (rainy) tips.push('☔ Rain is expected, so bring an umbrella and allow extra travel time.');
  if (flood && /high|severe|very/i.test(String(flood.level))) tips.push('🌊 Flood risk is up, so avoid low-lying roads and listen for official advisories.');
  return tips;
}

/** Public website shown in every safety update text. */
export const SITE_URL = 'https://rain2-0-github-io.vercel.app/';

export function buildSmsText({ now = Date.now(), area, weather, flood, volcano, quake, alerts = [], alertCount = 0, incidentsNear = 0, incidentsTotal = 0, center, note }) {
  // Paragraphs are separated by blank lines so the text is easy to scan on a phone.
  const intro = [`👋 Good day, neighbor!`, `📅 RAIN Daily Safety Update (${phDate(now)})`];
  if (area) intro.push(`📍 Area: ${String(area).trim().slice(0, 60)}`);

  const tips = dayTips({ weather, flood });

  const data = [];
  if (weather) data.push(`🌤 Weather: ${weather.desc}, ${weather.tempC}°C${weather.rainMm ? `, rain ${weather.rainMm}mm/h now` : ''}.`);
  else data.push('🌤 Weather: unavailable right now.');
  if (flood) data.push(`🌊 Flood risk (est.): ${flood.level}, about ${flood.mm}mm rain expected in 24h.`);
  data.push(volcano
    ? `🌋 Taal: Alert Level ${volcano.level}${volcano.dateLabel ? ` (as of ${volcano.dateLabel})` : ''}. Verify at phivolcs.dost.gov.ph.`
    : '🌋 Taal: no bulletin on file. Check phivolcs.dost.gov.ph.');
  if (quake && quake.count > 0) data.push(`🌍 Quakes: ${quake.count} M${quake.minMag}+ in PH past 24h, strongest M${quake.maxMag} ${quake.place}.`);
  else data.push('🌍 Quakes: none M2.5+ in PH past 24h.');
  if (alertCount > 0) data.push(`🚨 Alerts: ${alertCount} active, ${alerts.map((a) => `${a.title} (${a.severity})`).join('; ')}${alertCount > alerts.length ? '; more in app' : ''}.`);
  else data.push('🚨 Alerts: none active.');
  if (incidentsTotal > 0) data.push(`📋 Incidents: ${incidentsNear} reviewed within 10km of you (${incidentsTotal} in total).`);
  else data.push('📋 Incidents: no reviewed incidents right now.');
  if (center) data.push(`🏫 Nearest evac: ${center.name} (${center.km < 10 ? center.km.toFixed(1) : Math.round(center.km)}km)\n${directionsUrl(center)}`);
  if (note) data.push(`📝 Note: ${String(note).trim().slice(0, 160)}`);

  const footer = [`💛 Stay safe, neighbor! Check the web for details:\n${SITE_URL}`];

  const blocks = [intro.join('\n')];
  if (tips.length) blocks.push(tips.join('\n'));
  blocks.push(data.join('\n'));
  blocks.push(footer.join('\n'));
  return blocks.join('\n\n');
}

/** Groups recipients whose SMS text is identical, so each distinct text is one gateway request. */
export function groupByText(items) {
  const map = new Map();
  for (const it of items) {
    if (!map.has(it.text)) map.set(it.text, []);
    map.get(it.text).push(it);
  }
  return [...map.entries()].map(([text, members]) => ({ text, members }));
}
