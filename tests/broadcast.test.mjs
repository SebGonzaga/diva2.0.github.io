import test from 'node:test';
import assert from 'node:assert/strict';
import { residentLocation, nearestEvacCenter, floodEstimate, buildSmsText, groupByText, topAlerts } from '../api/_lib/broadcast.js';
import { normalizePhone, loadEvacuationCenters, loadPlaces } from '../api/_lib/notify.js';

const places = [
  { name: 'Tanauan City, Batangas', lat: 14.0863, lng: 121.1497 },
  { name: 'Talisay, Batangas', lat: 14.0994, lng: 121.0125 },
];

test('residentLocation: saved coords win, then city centre, then default', () => {
  assert.equal(residentLocation({ lat: 14.1, lng: 121.0, barangay: 'Tanauan City, Batangas' }, places).source, 'saved');
  const city = residentLocation({ barangay: 'Talisay, Batangas' }, places);
  assert.equal(city.source, 'city'); assert.equal(city.lat, 14.0994);
  assert.equal(residentLocation({ barangay: 'Other place' }, places).source, 'default');
  assert.equal(residentLocation({ lat: 'abc', lng: null }, places).source, 'default');
});

test('nearestEvacCenter picks the closest and ignores bad rows', () => {
  const c = nearestEvacCenter({ lat: 14.0865, lng: 121.1518 }, [
    { name: 'Far', lat: 14.2, lng: 121.3 }, { name: 'Near', lat: 14.0866, lng: 121.152 }, { name: 'Bad', lat: null, lng: null },
  ]);
  assert.equal(c.name, 'Near');
  assert.equal(nearestEvacCenter({ lat: 1, lng: 1 }, []), null);
});

test('floodEstimate sums the next 24h of rain', () => {
  const now = 1_000_000;
  const list = [{ dt: now + 3600, rain: { '3h': 30 } }, { dt: now + 7200, rain: { '3h': 25 } }, { dt: now + 90000, rain: { '3h': 500 } }];
  assert.deepEqual(floodEstimate(list, now), { mm: 55, level: 'Moderate' });
  assert.equal(floodEstimate([], now), null);
});

test('normalizePhone', () => {
  assert.equal(normalizePhone('09171234567'), '+639171234567');
  assert.equal(normalizePhone('+63 917 123 4567'), '+639171234567');
  assert.equal(normalizePhone('639171234567'), '+639171234567');
  assert.equal(normalizePhone('12345'), null);
});

test('buildSmsText includes every section and the evacuation link', () => {
  const t = buildSmsText({
    now: Date.UTC(2026, 10, 18), weather: { desc: 'Light rain', tempC: 27, rainMm: 0.4 }, flood: { level: 'Low', mm: 8 },
    volcano: { level: 1, dateLabel: 'Nov 17' }, quake: { count: 3, minMag: '2.5', maxMag: '4.1', place: 'Mindoro' },
    alerts: [{ title: 'Typhoon Advisory', severity: 'warning' }], alertCount: 1, incidentsNear: 2, incidentsTotal: 5,
    center: { name: 'Darasa Court', lat: 14.0672, lng: 121.1531, km: 1.234 }, note: 'Bring ID.',
  });
  for (const part of ['RAIN Daily Safety Update', 'Light rain, 27°C', 'Flood risk (est.): Low', 'Alert Level 1', 'strongest M4.1 Mindoro', 'Typhoon Advisory (warning)', '2 reviewed within 10km', 'Darasa Court (1.2km)', 'destination=14.0672,121.1531', 'Bring ID.']) {
    assert.ok(t.includes(part), `missing: ${part}`);
  }
  assert.ok(t.includes('\n\n'), 'sections should be separated by paragraph breaks');
});

test('buildSmsText degrades honestly when data is missing', () => {
  const t = buildSmsText({ weather: null, flood: null, volcano: null, quake: null, alerts: [], alertCount: 0, center: null });
  assert.match(t, /Weather: unavailable/);
  assert.match(t, /Taal: no bulletin on file/);
  assert.match(t, /Alerts: none active/);
  assert.ok(!/Nearest evac/.test(t));
});

test('groupByText + topAlerts', () => {
  assert.equal(groupByText([{ text: 'a' }, { text: 'b' }, { text: 'a' }]).length, 2);
  assert.equal(topAlerts([{ severity: 'advisory' }, { severity: 'critical' }, { severity: 'warning' }], 2)[0].severity, 'critical');
});

test('server can load the browser data files (evac centers + places)', () => {
  assert.ok(loadEvacuationCenters().length > 5);
  assert.ok(loadPlaces().some((p) => /Tanauan/.test(p.name)));
});
