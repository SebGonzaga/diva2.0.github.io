// /api/mgb-tile.js
// Server-side proxy for MGB flood / landslide susceptibility map images (MGB "controlmap" ArcGIS server).
//   /api/mgb-tile?svc=flood|slide&bbox=minx,miny,maxx,maxy      (bbox in EPSG:3857, from MapLibre's {bbox-epsg-3857})
// Proxying avoids browser CORS problems and lets the CDN cache tiles for a day.
import { limited } from './_lib/ratelimit.js';

const BASE = 'https://controlmap.mgb.gov.ph/arcgis/rest/services/GeospatialDataInventory/';
const SERVICES = {
  flood: BASE + 'GDI_Detailed_Flood_Susceptibility/MapServer',
  slide: BASE + 'GDI_Detailed_Rain_induced_Landslide_Susceptibility/MapServer',
};
const WORLD = 20037508.35; // Web Mercator limit

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (limited(req, res, 'mgb-tile', 1200)) return;
  const svc = SERVICES[req.query.svc];
  if (!svc) return res.status(400).json({ error: 'Unknown svc' });
  const bbox = String(req.query.bbox || '').split(',').map(Number);
  if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n) || Math.abs(n) > WORLD * 1.01)) {
    return res.status(400).json({ error: 'Invalid bbox' });
  }
  const url = `${svc}/export?bbox=${bbox.join(',')}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const up = await fetch(url, { signal: ctl.signal });
    const type = up.headers.get('content-type') || '';
    if (!up.ok || !type.startsWith('image/')) return res.status(502).json({ error: 'Upstream hazard server error' });
    const buf = Buffer.from(await up.arrayBuffer());
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).send(buf);
  } catch (err) {
    console.error('mgb-tile error:', err && err.name);
    return res.status(502).json({ error: 'Could not reach the hazard server' });
  } finally {
    clearTimeout(timer);
  }
}
