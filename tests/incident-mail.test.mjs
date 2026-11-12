import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestCenters, buildPendingEmail, buildResolvedEmail, loadDemo } from '../api/_lib/incident-mail.js';

const demo = loadDemo();

test('nearest centers are sorted by distance from the incident', () => {
  const list = nearestCenters({ lat: 14.0548, lng: 121.0858 }, demo.evacuationCenters);
  assert.equal(list.length, 3);
  assert.match(list[0].name, /Boot/);
  assert.ok(list[0].km <= list[1].km && list[1].km <= list[2].km);
});

test('falls back to barangay-name match, then to empty', () => {
  const byArea = nearestCenters({ area: 'Brgy. Balele, Tanauan' }, demo.evacuationCenters);
  assert.ok(byArea.length > 0 && byArea.every((c) => /Balele/.test(c.address)));
  assert.deepEqual(nearestCenters({ area: 'Somewhere unknown' }, demo.evacuationCenters), []);
});

test('pending email lists centers, hotlines and escapes admin text', () => {
  const centers = nearestCenters({ lat: 14.0548, lng: 121.0858 }, demo.evacuationCenters);
  const { html, subject } = buildPendingEmail({ incident: { category: 'Flooding', area: 'Boot' }, reporterName: '<b>Ana</b>', note: '<script>x</script>', centers, contacts: demo.emergencyContacts, appUrl: 'https://x.app' });
  assert.match(subject, /safe/i);
  assert.match(html, /Boot/);
  assert.match(html, /CDRRMO Tanauan/);
  assert.match(html, /911/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<b>Ana/);
});

test('resolved email embeds the proof photo and the admin message', () => {
  const { html } = buildResolvedEmail({ incident: { category: 'Flooding', area: 'Boot' }, reporterName: 'Ana', message: 'Cleared.\nThanks', photoCid: 'proof-photo' });
  assert.match(html, /cid:proof-photo/);
  assert.match(html, /Cleared\.<br>Thanks/);
});
