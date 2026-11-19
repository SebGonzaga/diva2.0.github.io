/* =========================================================================
   build-offline-page.mjs
   Regenerates the data block inside offline.html from the app's own data:
     - CONTACTS : RAIN_DEMO.emergencyContacts   (assets/js/demo-data.js)
     - CENTERS  : RAIN_DEMO.evacuationCenters   (assets/js/demo-data.js)
     - BOUNDS   : per barangay { n: display name, s: short map label, c: label point,
                  r: outline rings } from assets/js/tanauan-boundaries.js,
                  simplified (Douglas-Peucker, ~35 m) and rounded to 4 decimals
   offline.html has to be 100% self-contained (Median bundles it as a local
   file with no access to the site's scripts and no network), so this data is
   embedded rather than fetched. Re-run after editing contacts or centers:

       node scripts/build-offline-page.mjs

   tests/offline.test.mjs fails if offline.html is out of date.
   ========================================================================= */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

export function buildData() {
  const demoCtx = vm.createContext({});
  vm.runInContext(read("assets/js/demo-data.js") + "\n;this.__demo = RAIN_DEMO;", demoCtx);
  const demo = demoCtx.__demo;

  const boundCtx = vm.createContext({ window: {} });
  vm.runInContext(read("assets/js/tanauan-boundaries.js"), boundCtx);
  const features = boundCtx.window.RAIN_BOUNDARIES.features;

  const contacts = demo.emergencyContacts.map((c) => ({
    name: c.name, tag: c.tag || "Contact", numbers: c.numbers && c.numbers.length ? c.numbers : [c.number],
  }));
  const centers = demo.evacuationCenters.map((c) => ({
    name: c.name, type: c.type || "", address: c.address || "", lat: c.lat, lng: c.lng,
  }));

  // boundary-file spelling -> the name residents know ("Banadero" -> "Bañadero")
  const display = {};
  for (const h of demo.barangays || []) display[h.boundary || h.name] = h.name;

  const bounds = features.map((f) => {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const rings = [];
    for (const poly of polys) for (const ring of poly) {
      const r = simplify(ring, 0.00035).map(([x, y]) => [round(x), round(y)]);
      if (r.length >= 4) rings.push(r);
    }
    const full = display[f.properties.name] || f.properties.name;
    return { n: full, s: shortName(full), c: labelPoint(rings).map(round), r: rings };
  });
  return { contacts, centers, bounds };
}

// "Poblacion Barangay 3" -> "Poblacion 3"; "Santol (Doña Jacoba Garcia)" -> "Santol"
function shortName(n) {
  return n.replace(/\s*\(([^)]*)\)\s*/g, (m, t) => (/^(west|east|north|south)$/i.test(t.trim()) ? ` (${t.trim()}) ` : " "))
    .replace(/\s+Barangay\s+/i, " ").replace(/\s+/g, " ").trim();
}

// A point guaranteed to sit inside the barangay: the centroid of the biggest
// ring, or, if that falls outside (concave shape), the middle of the widest
// horizontal slice through the centroid's latitude.
function labelPoint(rings) {
  const area = (r) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + (p[0] * q[1] - q[0] * p[1]); }, 0) / 2);
  const ring = rings.slice().sort((a, b) => area(b) - area(a))[0];
  let A = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length], f = p[0] * q[1] - q[0] * p[1];
    A += f; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f;
  }
  cx /= 3 * A; cy /= 3 * A;
  if (inRing(cx, cy, ring)) return [cx, cy];
  const xs = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    if ((p[1] > cy) !== (q[1] > cy)) xs.push(p[0] + ((cy - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
  }
  xs.sort((a, b) => a - b);
  let best = [cx, cy], w = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > w) { w = xs[i + 1] - xs[i]; best = [(xs[i] + xs[i + 1]) / 2, cy]; }
  return best;
}
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const round = (n) => Math.round(n * 1e4) / 1e4;

function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) { const d = segDist(pts[i], pts[a], pts[b]); if (d > maxD) { maxD = d; idx = i; } }
    if (maxD > tol && idx > -1) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export const START = "/*OFFLINE_DATA_START*/", END = "/*OFFLINE_DATA_END*/";
export function renderBlock(d) {
  return `${START}
    var CONTACTS = ${JSON.stringify(d.contacts)};
    var CENTERS = ${JSON.stringify(d.centers)};
    var BOUNDS = ${JSON.stringify(d.bounds)};
    ${END}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const file = path.join(root, "offline.html");
  const html = fs.readFileSync(file, "utf8");
  const a = html.indexOf(START), b = html.indexOf(END);
  if (a < 0 || b < 0) throw new Error("offline.html is missing the OFFLINE_DATA markers");
  const d = buildData();
  fs.writeFileSync(file, html.slice(0, a) + renderBlock(d) + html.slice(b + END.length));
  console.log(`offline.html data updated: ${d.contacts.length} contacts, ${d.centers.length} centers, ${d.bounds.length} outline rings (${JSON.stringify(d.bounds).length} bytes)`);
}
