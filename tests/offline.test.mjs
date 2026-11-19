import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const sw = read("sw.js");
const arrayOf = (name) => [...sw.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`))[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const htmlFiles = fs.readdirSync(root).filter((f) => f.endsWith(".html"));

// Libraries intentionally cached lazily (first online visit) instead of at install.
const RUNTIME_ONLY_CDN = [
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js",
  "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js",
  "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css",
];

test("every local precache entry exists on disk (a 404 would break SW install)", () => {
  for (const p of [...arrayOf("APP_PAGES"), ...arrayOf("STATIC_ASSETS")]) {
    if (p === "./") continue;
    assert.ok(fs.existsSync(path.join(root, p)), `missing: ${p}`);
  }
});

test("every app page is precached", () => {
  const pages = new Set(arrayOf("APP_PAGES"));
  for (const f of htmlFiles) assert.ok(pages.has(`./${f}`), `${f} not in APP_PAGES`);
});

test("every CDN URL in the HTML is precached or consciously runtime-only", () => {
  const known = new Set([...arrayOf("CDN_PRECACHE"), ...RUNTIME_ONLY_CDN]);
  for (const f of htmlFiles) {
    for (const m of read(f).matchAll(/(?:src|href)="(https:\/\/(?:cdn\.jsdelivr\.net|unpkg\.com)[^"]+)"/g)) {
      assert.ok(known.has(m[1]), `${f} uses ${m[1]} which sw.js doesn't know about`);
    }
  }
});

test("supabase-client falls back to an inert client when the library is missing", async () => {
  const ctx = vm.createContext({});
  vm.runInContext(read("assets/js/supabase-client.js"), ctx);
  const q = await vm.runInContext(`sb.from("alerts").select("*").order("created_at", { ascending: false })`, ctx);
  assert.equal(q.data, null);
  assert.ok(q.error && !q.error.code, "error must have no code so RainAuth treats it as a network failure");
  const s = await vm.runInContext(`sb.auth.getSession()`, ctx);
  assert.equal(s.data.session, null);
  assert.ok(s.error);
});

function loadOfflineStore(medianSets) {
  const store = new Map();
  const ctx = vm.createContext({
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    median: { storage: { app: { set: (o) => medianSets.push(o) } } },
    document: { addEventListener() {}, getElementById: () => null },
    window: { addEventListener() {} },
    navigator: { onLine: true },
    location: { protocol: "file:" },
    Date, JSON,
  });
  vm.runInContext(read("assets/js/offline-store.js"), ctx);
  return ctx;
}

test("Native Datastore mirror is allowlisted, trimmed, and drops expired alerts", () => {
  const sets = [];
  const ctx = loadOfflineStore(sets);
  const past = new Date(Date.now() - 3600e3).toISOString();
  const future = new Date(Date.now() + 3600e3).toISOString();
  const alerts = [
    { severity: "information", title: "info", area: "A", type: "Flood", message: "x".repeat(5000), expires_at: future },
    { severity: "critical", title: "expired crit", area: "B", type: "Typhoon", expires_at: past },
    { severity: "warning", title: "warn", area: "C", type: "Flood", message: "y".repeat(5000), expires_at: null },
    ...Array.from({ length: 10 }, (_, i) => ({ severity: "advisory", title: `adv${i}`, area: "D", type: "Flood" })),
  ];
  ctx.__alerts = alerts;
  vm.runInContext(`RainOffline.save("alerts", __alerts)`, ctx);
  vm.runInContext(`RainOffline.save("earthquakes", [{big: "x".repeat(50000)}])`, ctx);
  vm.runInContext(`RainOffline.save("emergencyContacts", [{n: 1}])`, ctx);

  assert.equal(sets.length, 1, "only alerts should be mirrored in this run");
  assert.equal(sets[0].key, "rain_offline_alerts");
  const { data } = JSON.parse(sets[0].value);
  assert.equal(data.length, 5);
  assert.equal(data[0].title, "warn", "most severe live alert first");
  assert.ok(!data.some((a) => a.title === "expired crit"));
  assert.ok(!("message" in data[0]));
  assert.ok(sets[0].value.length < 2000);
});

test("only a bare lat/lng is mirrored for userLocation", () => {
  const sets = [];
  const ctx = loadOfflineStore(sets);
  ctx.__loc = { lat: 14.09, lng: 121.15, accuracy: 12, extra: "x" };
  vm.runInContext(`RainOffline.save("userLocation", __loc)`, ctx);
  assert.deepEqual(JSON.parse(sets[0].value).data, { lat: 14.09, lng: 121.15 });
  vm.runInContext(`RainOffline.save("evacuationCenters", [{name: "x"}])`, ctx);
  assert.equal(sets.length, 1, "evacuation centers are built into offline.html, not mirrored");
});

test("offline.html's built-in contacts/centers/outline are in sync with demo-data.js", async () => {
  const { buildData, renderBlock, START, END } = await import("../scripts/build-offline-page.mjs");
  const html = read("offline.html");
  const embedded = html.slice(html.indexOf(START), html.indexOf(END) + END.length);
  assert.equal(embedded, renderBlock(buildData()), "run: node scripts/build-offline-page.mjs");
});

test("offline.html has no external resources (it must work with zero network)", () => {
  const html = read("offline.html");
  assert.ok(!/(?:src|href)="https?:/i.test(html), "no http(s) src/href allowed");
  assert.ok(!/url\(\s*['"]?https?:/i.test(html));
});

test("every barangay has a name, a short label, and a label point inside its own outline", async () => {
  const { buildData } = await import("../scripts/build-offline-page.mjs");
  const { bounds } = buildData();
  assert.equal(bounds.length, 48);
  const inRing = (x, y, r) => { let o = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) o = !o; } return o; };
  for (const b of bounds) {
    assert.ok(b.n && b.s, "missing name");
    assert.ok(b.r.some((r) => inRing(b.c[0], b.c[1], r)), `${b.n}: label point falls outside its barangay`);
  }
  assert.ok(bounds.some((b) => b.n === "Bañadero"), "uses display names, not boundary-file spellings");
});
