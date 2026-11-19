/* =========================================================================
   RAIN — sw.js (service worker)
   Makes the app shell (HTML/CSS/JS + the emergency-critical pages) load
   offline. This is deliberately NOT a "cache everything forever" worker:

   - App-shell files (HTML/CSS/JS/icons/manifest) are precached on install
     and served network-first with a short timeout, then cache fallback:
     an online device gets the current build, an offline device opens from
     the last cache, and a device on a weak/"lie-fi" connection stops
     waiting after a few seconds instead of hanging on the network.
   - Only successful (2xx) responses are ever written to the cache, so a
     404/500 can never replace a good cached page.
   - Third-party libraries (Bootstrap, Leaflet, Supabase JS, ...) from the
     two CDNs the app uses are cached in their own long-lived cache so
     pages keep their styling and scripts offline. Everything else that
     is cross-origin (map tiles, images) goes straight to the network.
   - Live data requests (Supabase, USGS, OpenWeather, the /api/* Vercel
     functions, PHIVOLCS/volcview) are deliberately left alone — they go
     to the network as normal. Offline *readings* for that data are
     handled by assets/js/offline-store.js writing known-good snapshots
     to localStorage (and, inside the Median app, the Native Datastore),
     not by the service worker caching API responses. That keeps "what
     the user sees offline" honest and explicit instead of silently
     replaying a stale network response.

   Median note: service workers run in the Android Median app out of the
   box. On iOS they need App-Bound Domains (custom iOS build); without
   that, iOS relies on Median's bundled offline page (offline.html) plus
   the Native Datastore mirror written by offline-store.js.
   ========================================================================= */

// Stamped at deploy time by scripts/bump-sw-version.js (run through the
// "vercel-build" npm script) with the current git commit hash, so every
// deploy gets a new shell cache and the old one is deleted on activate.
// Run locally without the build step, the placeholder just means "treat
// this as a fresh version".
const CACHE_VERSION = "rain-shell-__SW_BUILD_ID__";

// CDN libraries are versioned/immutable, so they live in a cache that is
// NOT tied to the build id — a new deploy doesn't re-download them. Bump
// this suffix only if you need to force-refresh every CDN file.
const CDN_CACHE = "rain-cdn-v1";

// Seconds-to-give-up before serving the cached copy instead of waiting on
// a slow network. The network request keeps running and refreshes the
// cache for next time.
const NAV_TIMEOUT_MS = 4000;
const ASSET_TIMEOUT_MS = 3000;

// Every page in the app, so a resident who only ever opened the dashboard
// can still navigate to Emergency/Alerts/Weather/etc. once offline, not
// just reload the one page they happened to be on.
const APP_PAGES = [
  "./index.html",
  "./login.html",
  "./register.html",
  "./dashboard.html",
  "./weather.html",
  "./flood-landslide.html",
  "./volcano.html",
  "./earthquake.html",
  "./virtual-assistance.html",
  "./emergency.html",
  "./alerts.html",
  "./report.html",
  "./profile.html",
  "./admin-dashboard.html",
  "./admin-alerts.html",
  "./admin-incidents.html",
  "./admin-analytics.html",
  "./admin-users.html",
  "./offline.html", // last-resort navigation fallback (see handleNavigation)
];

const STATIC_ASSETS = [
  "./",
  "./manifest.json",
  "./assets/css/style.css",
  "./assets/css/earthquake.css",
  "./assets/css/rain-bot.css",
  "./assets/js/animations.js",
  "./assets/js/rain-bot.js",
  "./assets/js/demo-data.js",
  "./assets/js/tanauan-boundaries.js",
  "./assets/css/emergency.css",
  "./assets/css/flood.css",
  "./assets/css/volcano.css",
  "./assets/css/weather-map.css",
  "./assets/css/dashboard.css",
  "./assets/js/weather-timely.js",
  "./assets/js/rain-indices.js",
  "./assets/js/rain-auth.js",
  "./assets/js/ai-digest-card.js",
  "./assets/js/icons.js",
  "./assets/js/main.js",
  "./assets/js/offline-store.js",
  "./assets/js/supabase-client.js",
  "./assets/js/taal-places.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
];

const PRECACHE_URLS = [...APP_PAGES, ...STATIC_ASSETS];

// Third-party libraries used on (nearly) every page. The HTML loads these
// without a `crossorigin` attribute, so the browser's own request is
// "opaque" and can't be cached — we fetch them ourselves in CORS mode
// (both CDNs send Access-Control-Allow-Origin: *). Best-effort: a failure
// here never blocks the service worker from installing. Libraries used on
// only one or two pages (chart.js, maplibre-gl) are cached the first time
// those pages load online, by cdnRequest() below. Keep in sync with the
// <script>/<link> tags — tests/sw-precache.test.mjs checks that.
const CDN_PRECACHE = [
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css",
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js",
  "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css",
  "https://cdn.jsdelivr.net/npm/animejs@4.5.0/lib/anime.iife.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
];

const CDN_HOSTS = new Set(["cdn.jsdelivr.net", "unpkg.com"]);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(CACHE_VERSION);
    await shell.addAll(PRECACHE_URLS); // local files: all-or-nothing, as before
    await precacheCdn().catch(() => {}); // CDN libs: best effort
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("rain-") && key !== CACHE_VERSION && key !== CDN_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function precacheCdn() {
  const cache = await caches.open(CDN_CACHE);
  await Promise.allSettled(CDN_PRECACHE.map(async (url) => {
    if (await cache.match(url)) return; // already have it from an earlier build
    const res = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    await cache.put(url, res.clone());
    // Stylesheets pull in fonts/images by relative URL (the Bootstrap Icons
    // font, Leaflet's marker/layer images). Without these the CSS is cached
    // but the icons are blank offline, so grab them too.
    if (url.endsWith(".css")) await precacheCssDependencies(cache, url, await res.text());
  }));
}

async function precacheCssDependencies(cache, cssUrl, cssText) {
  const deps = new Set();
  for (const m of cssText.matchAll(/url\(\s*['"]?([^'")]+?)['"]?\s*\)/g)) {
    const ref = m[1];
    if (ref.startsWith("data:") || !/\.(woff2|png|gif|jpe?g|svg)(\?|#|$)/i.test(ref)) continue;
    deps.add(new URL(ref, cssUrl).href.split("#")[0]);
  }
  await Promise.allSettled([...deps].map(async (dep) => {
    if (await cache.match(dep)) return;
    const res = await fetch(dep, { mode: "cors", credentials: "omit" });
    if (res.ok) await cache.put(dep, res);
  }));
}

// Requests we never want to intercept: live/third-party data APIs. Letting
// these fall straight through to the network keeps alerts, weather, quake
// and chat data honest — the service worker never serves a stale API
// response as if it were current.
const NEVER_CACHE_PATTERNS = [
  /\/api\//,                          // Vercel functions: chat, weather, notifications
  /supabase\.co/,                     // Supabase REST/auth/realtime
  /earthquake\.usgs\.gov/,            // USGS quake feed
  /volcview\.wr\.usgs\.gov/,          // PHIVOLCS-style volcano feed
  /openstreetmap\.org\/directions/,   // external directions link, not app content
  /jma\.go\.jp\/bosai\/himawari/,    // JMA Himawari frame list + tiles: a cached list would hide new images
  /earthdata\.nasa\.gov/,             // NASA GIBS satellite tiles (fallback source)
];

function isNeverCache(url) {
  return NEVER_CACHE_PATTERNS.some((re) => re.test(url));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;          // never touch POST/PUT (form submits, API writes)
  if (req.headers.has("range")) return;      // media range requests can't be cached as 200s
  if (isNeverCache(req.url)) return;         // let live data hit the network untouched

  const url = new URL(req.url);

  if (url.origin !== self.location.origin) {
    // Only the two library CDNs are cached. Map tiles, satellite imagery and
    // other third-party resources go straight to the network: they'd be
    // opaque (and, in Chrome, count ~7 MB each against storage quota).
    if (CDN_HOSTS.has(url.hostname)) event.respondWith(cdnRequest(event, req));
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(handleNavigation(event, req));
    return;
  }

  // Same-origin static assets (CSS/JS/icons/data): network-first so a live
  // page always gets code that matches it, cache fallback when offline or
  // when the network is too slow.
  event.respondWith(
    networkFirst(event, req, { timeoutMs: ASSET_TIMEOUT_MS })
      .catch(() => Response.error())
  );
});

/** Page loads: network-first with timeout; if the network is down and this
 *  exact page isn't cached, show offline.html (hotlines, evacuation tips,
 *  last saved alerts) rather than silently showing a different page. */
async function handleNavigation(event, req) {
  try {
    return await networkFirst(event, req, { timeoutMs: NAV_TIMEOUT_MS, navigation: true });
  } catch (err) {
    const cache = await caches.open(CACHE_VERSION);
    return (await cache.match("./offline.html")) || Response.error();
  }
}

/** Network first, but don't wait forever:
 *   - network answers in time     -> use it, refresh the cache (2xx only)
 *   - network fails fast (offline) -> cached copy
 *   - network is slow              -> after timeoutMs serve the cached copy
 *                                     if there is one; the request keeps
 *                                     running to refresh the cache
 *   - slow AND nothing cached      -> keep waiting on the network
 *  Throws if there's neither a network response nor a cached copy. */
async function networkFirst(event, req, { timeoutMs, navigation = false }) {
  const cache = await caches.open(CACHE_VERSION);
  // ignoreSearch: "alerts.html?x=1" should still find the cached alerts.html
  const fromCache = () => cache.match(req, { ignoreSearch: true });

  const network = fetch(req).then(async (res) => {
    if (res.ok) {
      // A cached *redirected* response can't be used to answer a navigation
      // (browsers reject it), so store a clean copy instead.
      const copy = navigation && res.redirected ? await flatten(res.clone()) : res.clone();
      event.waitUntil(cache.put(req, copy).catch(() => {}));
    }
    return res;
  });
  event.waitUntil(network.catch(() => {})); // keep the worker alive for the background refresh

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => fromCache().then(resolve, () => resolve(undefined)), timeoutMs);
  });

  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    return await network;
  } catch (err) {
    const cached = await fromCache();
    if (cached) return cached;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function flatten(res) {
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

/** CDN libraries: serve from the long-lived cache instantly, refresh in the
 *  background. Fetched in CORS mode (not the page's opaque no-cors request)
 *  so the response is readable and can actually be cached. */
async function cdnRequest(event, req) {
  const cache = await caches.open(CDN_CACHE);
  const cached = await cache.match(req.url);
  const refresh = fetch(req.url, { mode: "cors", credentials: "omit" }).then((res) => {
    if (res.ok) cache.put(req.url, res.clone());
    return res;
  });
  if (cached) {
    event.waitUntil(refresh.catch(() => {}));
    return cached;
  }
  return refresh.catch(() => Response.error());
}
