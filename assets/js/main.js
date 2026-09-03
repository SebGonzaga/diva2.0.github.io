/* =========================================================================
   DIVA — assets/js/main.js
   Shared app-shell rendering (sidebar/topbar/footer), a lightweight demo
   auth guard, toast helper, and the animation initializer dispatcher.
   This is a frontend-only prototype: "auth" is simulated in localStorage
   until the PHP session-based backend (see spec §8) is wired in.
   ========================================================================= */

const DIVA_NAV = {
  resident: [
    { section: "Monitor", links: [
      { href: "dashboard.html", icon: "bi-grid-1x2", label: "Dashboard" },
      { href: "weather.html", icon: "bi-cloud-sun", label: "Weather" },
      { href: "volcano.html", icon: "bi-triangle", label: "Volcano Monitoring" },
      { href: "earthquake.html", icon: "bi-activity", label: "Earthquake" },
    ]},
    { section: "Assistance", links: [
      { href: "virtual-assistance.html", icon: "bi-chat-dots", label: "Virtual Assistance" },
      { href: "emergency.html", icon: "bi-telephone", label: "Emergency" },
      { href: "alerts.html", icon: "bi-bell", label: "Alerts" },
      { href: "report.html", icon: "bi-flag", label: "Report Incident" },
    ]},
    { section: "Account", links: [
      { href: "profile.html", icon: "bi-person-circle", label: "Profile" },
    ]},
  ],
  admin: [
    { section: "Monitor", links: [
      { href: "admin-dashboard.html", icon: "bi-grid-1x2", label: "Dashboard" },
      { href: "weather.html", icon: "bi-cloud-sun", label: "Weather" },
      { href: "volcano.html", icon: "bi-triangle", label: "Volcano Monitoring" },
      { href: "earthquake.html", icon: "bi-activity", label: "Earthquake" },
    ]},
    { section: "Operations", links: [
      { href: "virtual-assistance.html", icon: "bi-chat-dots", label: "Virtual Assistance" },
      { href: "emergency.html", icon: "bi-telephone", label: "Emergency" },
      { href: "admin-alerts.html", icon: "bi-bell", label: "Alerts" },
      { href: "admin-incidents.html", icon: "bi-flag", label: "Incident Reports" },
      { href: "admin-analytics.html", icon: "bi-bar-chart", label: "Analytics" },
    ]},
    { section: "System", links: [
      { href: "admin-users.html", icon: "bi-people", label: "User Management" },
    ]},
  ],
};

/* =========================================================================
   Theme (light / dark) — persisted per-browser. The <head> of every
   app-shell page also runs a tiny inline copy of the "apply" step before
   paint, so switching themes never causes a flash of the wrong colors.
   ========================================================================= */
const DivaTheme = {
  KEY: "diva_theme",
  get() {
    try { return localStorage.getItem(this.KEY) || "dark"; } catch (e) { return "dark"; }
  },
  apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
  },
  set(theme) {
    try { localStorage.setItem(this.KEY, theme); } catch (e) {}
    this.apply(theme);
  },
  toggle() {
    const next = this.get() === "dark" ? "light" : "dark";
    this.set(next);
    return next;
  },
};

const DIVA_BOTTOM_NAV = {
  resident: [
    { href: "dashboard.html", icon: "bi-house-door-fill", label: "Home" },
    { href: "alerts.html", icon: "bi-bell-fill", label: "Alerts" },
    { href: "virtual-assistance.html", icon: "bi-robot", label: "DIVA" },
    // "#more" is a sentinel href (not a real page): renderAppShell()
    // intercepts it below and opens the same full sidebar menu the
    // hamburger button opens, instead of navigating. This is how phones
    // reach Weather/Volcano/Earthquake/Report Incident/Profile — the bar
    // itself only has room for a few tabs, so it borrows the sidebar as
    // its "More" sheet rather than leaving those pages one tap short of
    // reachable.
    { href: "#more", icon: "bi-grid-3x3-gap-fill", label: "More" },
    // Emergency Mode has to be one tap away on mobile — this is a disaster
    // app, not a settings menu. "#emergency" is a sentinel href, same
    // pattern: intercepted below to open the overlay in place.
    { href: "#emergency", icon: "bi-exclamation-triangle-fill", label: "SOS", emergency: true },
  ],
  admin: [
    { href: "admin-dashboard.html", icon: "bi-house-door-fill", label: "Home" },
    { href: "admin-alerts.html", icon: "bi-bell-fill", label: "Alerts" },
    { href: "virtual-assistance.html", icon: "bi-robot", label: "DIVA" },
    { href: "#more", icon: "bi-grid-3x3-gap-fill", label: "More" },
    { href: "#emergency", icon: "bi-exclamation-triangle-fill", label: "SOS", emergency: true },
  ],
};

// DivaStore (the old localStorage prototype "database" for users/alerts/
// incidents) has been fully replaced by Supabase — every page now reads
// and writes the real profiles/alerts/incidents tables instead.
// DivaAuth now lives in assets/js/diva-auth.js (Supabase-backed).
// Make sure that file is loaded on this page BEFORE main.js.

/** Shared Leaflet pin icon — same visual language everywhere on the app
 *  (dashboard's Live Situation Map, Emergency's evacuation map, etc.) so a
 *  "shelter" pin always looks like a shelter pin no matter which page it's
 *  on, instead of one page using icon pins and another using flat dots. */
function divaPinIcon(cls, icon, pulse) {
  return L.divIcon({
    className: "",
    html: `<div class="map-marker-pin ${cls} ${pulse ? "map-marker-pulse" : ""}"><i class="bi ${icon}"></i></div>`,
    iconSize: [26, 26], iconAnchor: [13, 26],
  });
}

/** Great-circle distance in km — shared so every page computes "how far"
 *  the same way instead of each page carrying its own copy. */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* =========================================================================
   Live earthquake data — USGS's public FDSN event API, no key required.
   PHIVOLCS is the authoritative source for Philippine seismic bulletins but
   doesn't publish a public API (see volcano.html's Taal alert-level card
   for the same caveat re: PHIVOLCS volcano data), so USGS is what this app
   can actually fetch live. Shared here so both earthquake.html and
   dashboard.html (Community Risk) query it the same way.
   ========================================================================= */
const USGS_QUAKE_ENDPOINT = "https://earthquake.usgs.gov/fdsnws/event/1/query";
// Loose bounding box around the Philippine archipelago — wide enough to
// catch offshore events (e.g. Moro Gulf, Philippine Trench) that can still
// matter to residents, without pulling in the whole Pacific Ring of Fire.
const PH_QUAKE_BBOX = { minlatitude: 4, maxlatitude: 21, minlongitude: 116, maxlongitude: 127 };

/** Fetch recent earthquakes within the Philippines bounding box from USGS.
 *  Returns a flat array of {id, mag, place, timeMs, updatedMs, url, tsunami,
 *  felt, lat, lng, depthKm}, newest first. Throws on network/HTTP failure —
 *  callers should catch and fall back to an honest "no data" state rather
 *  than fabricating numbers. */
async function fetchPhilippineEarthquakes({ days = 7, minMagnitude = 2.5 } = {}) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    format: "geojson",
    starttime: start.toISOString(),
    endtime: end.toISOString(),
    minmagnitude: String(minMagnitude),
    minlatitude: String(PH_QUAKE_BBOX.minlatitude), maxlatitude: String(PH_QUAKE_BBOX.maxlatitude),
    minlongitude: String(PH_QUAKE_BBOX.minlongitude), maxlongitude: String(PH_QUAKE_BBOX.maxlongitude),
    orderby: "time",
  });
  const res = await fetch(`${USGS_QUAKE_ENDPOINT}?${params.toString()}`);
  if (!res.ok) throw new Error("USGS earthquake request failed: " + res.status);
  const data = await res.json();
  return (data.features || []).map((f) => ({
    id: f.id,
    mag: f.properties.mag,
    place: f.properties.place || "Unknown location",
    timeMs: f.properties.time,
    updatedMs: f.properties.updated,
    url: f.properties.url,
    tsunami: !!f.properties.tsunami,
    felt: f.properties.felt,
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    depthKm: f.geometry.coordinates[2],
  }));
}

/** Coarse magnitude → 0-100 risk contribution, shared between the Earthquake
 *  page and the Community Risk card so the two never disagree about what
 *  "notable" means. PH seismicity is constant (dozens of small M2.5-3.5
 *  events most weeks), so this deliberately keeps minor events low-weight. */
function quakeRiskValue(mag) {
  if (mag == null) return 0;
  if (mag < 3) return 12;
  if (mag < 4) return 30;
  if (mag < 5) return 55;
  if (mag < 6) return 78;
  return 96;
}

/** Shared weather snapshot cache — written by weather.html after every
 *  successful load (live or demo), read by dashboard.html and any other
 *  page that needs a weather summary. This is what keeps the dashboard's
 *  weather card from silently disagreeing with the Weather page: there is
 *  exactly one place weather data gets written, and everyone else reads it. */
const WEATHER_CACHE_KEY = "diva_weather_cache";
function setWeatherCache(snapshot) {
  try {
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ ...snapshot, cachedAt: Date.now() }));
  } catch (e) { /* storage unavailable — non-fatal, dashboard just falls back to demo */ }
}
function getWeatherCache() {
  try { return JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) || "null"); }
  catch (e) { return null; }
}

/* =========================================================================
   Real-time inline field validation — used by login/register/report forms.
   Deliberately lightweight (no framework): wires a single input, shows a
   red border + short message once the user has interacted with the field,
   and re-validates on every keystroke after that first interaction so the
   error clears the moment it's fixed instead of waiting for another submit.
   ========================================================================= */
const DivaFieldValidation = {
  /**
   * @param {HTMLInputElement} input
   * @param {(value:string, input:HTMLInputElement) => boolean} validate
   * @param {string} message shown when validate() returns false
   */
  wireField(input, validate, message) {
    if (!input) return;
    let touched = false;
    let feedback = input.parentElement.querySelector(`[data-feedback-for="${input.id}"]`);
    if (!feedback) {
      feedback = document.createElement("div");
      feedback.className = "field-feedback";
      feedback.setAttribute("data-feedback-for", input.id);
      feedback.setAttribute("role", "alert");
      feedback.innerHTML = `<i class="bi bi-exclamation-circle"></i><span></span>`;
      input.insertAdjacentElement("afterend", feedback);
    }
    const run = () => {
      const ok = validate(input.value, input);
      input.classList.toggle("is-invalid", touched && !ok);
      input.classList.toggle("is-valid", touched && ok && input.value.length > 0);
      input.setAttribute("aria-invalid", touched && !ok ? "true" : "false");
      feedback.classList.toggle("show", touched && !ok);
      feedback.querySelector("span").textContent = message;
    };
    input.addEventListener("blur", () => { touched = true; run(); });
    input.addEventListener("input", () => { if (touched) run(); });
    return { revalidate: run, forceShow: () => { touched = true; run(); } };
  },
};

/** Shared client for the Gemini-backed chat endpoint (api/chat.js) — used
 *  by virtual-assistance.html's chat UI AND the "Hey IRIS" voice command
 *  fallback (assets/js/voice-command.js), so the request shape/parsing only
 *  lives in one place instead of being copy-pasted between the two. Returns
 *  the raw markdown reply string on success; throws on any failure (bad
 *  status, network error, empty reply) so each caller can apply its own
 *  fallback (virtual-assistance.html shows a canned demo reply, the voice
 *  command falls back to a short spoken/displayed error). */
const DivaChatAPI = {
  async send(message, { lang = "en", history = [] } = {}) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        lang,
        history: history.slice(-10).map((m) => ({ role: m.role, content: m.message })),
      }),
    });
    if (!res.ok) throw new Error("chat request failed: " + res.status);
    const data = await res.json();
    if (!data.reply) throw new Error("empty reply from /api/chat");
    return data.reply;
  },
};

function divaToast(message, icon) {
  icon = icon || "bi-check-circle";
  const el = document.createElement("div");
  el.className = "toast-diva";
  el.innerHTML = `<i class="bi ${icon}"></i><span>${message}</span>`;
  document.body.appendChild(el);
  if (window.DivaAnim) DivaAnim.animateToastIn(el);
  setTimeout(() => {
    if (window.DivaAnim) DivaAnim.animateToastOut(el, () => el.remove());
    else el.remove();
  }, 3200);
}

/* =========================================================================
   Emergency Mode — a high-contrast, minimal, action-only overlay that can
   be triggered from any app page. Simplifies the interface dramatically
   without navigating away or losing the underlying page state.
   ========================================================================= */
const DivaEmergencyMode = {
  _built: false,
  _userLat: 14.2117, _userLng: 121.1653, // fallback: Calamba, Laguna — replaced by real GPS in open() when available

  /** Picks the closest evacuation center to a given point (falls back to
   *  the first listed center if none/no coords) — shared by _build() and
   *  the live update in open(). */
  _nearestShelter(lat, lng) {
    const centers = (window.DIVA_DEMO && window.DIVA_DEMO.evacuationCenters) || [];
    if (!centers.length) return null;
    return centers.reduce((best, c) => {
      const d = haversineKm(lat, lng, c.lat, c.lng);
      return !best || d < best.dist ? { ...c, dist: d } : best;
    }, null);
  },

  _build() {
    if (this._built) return;
    const data = (window.DIVA_DEMO) || { alerts: [], evacuationCenters: [], emergencyContacts: [] };
    const topAlert = data.alerts && data.alerts.length
      ? [...data.alerts].sort((a, b) => (b.severity === "critical") - (a.severity === "critical"))[0]
      : null;
    const nearestShelter = this._nearestShelter(this._userLat, this._userLng);
    const primaryContact = (data.emergencyContacts && data.emergencyContacts.find((c) => c.tag === "NDRRMC")) || (data.emergencyContacts && data.emergencyContacts[0]);

    const overlay = document.createElement("div");
    overlay.className = "emergency-overlay";
    overlay.id = "emergencyOverlay";
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Emergency Mode");
    overlay.innerHTML = `
      <button type="button" class="em-close" id="emCloseBtn"><i class="bi bi-x-lg"></i> Exit Emergency Mode</button>
      <div class="em-badge"><i class="bi bi-broadcast"></i> ACTIVE THREAT</div>
      <div class="em-title">${topAlert ? topAlert.title : "Stay alert in your area"}</div>
      <p class="em-desc">${topAlert ? `${topAlert.message} — ${topAlert.area}.` : "Monitor official updates and be ready to act. Use the options below for immediate help."}</p>
      <div class="em-actions">
        <a class="em-action-btn primary" href="emergency.html#evac" data-press id="emFindShelterBtn"><i class="bi bi-signpost-split-fill"></i> <span id="emFindShelterLabel">Find Evacuation Center${nearestShelter ? ` — ${nearestShelter.name}` : ""}</span></a>
        <a class="em-action-btn" href="${nearestShelter ? `https://www.openstreetmap.org/directions?to=${nearestShelter.lat},${nearestShelter.lng}` : "emergency.html#evac"}" target="_blank" rel="noopener" data-press id="emDirectionsBtn"><i class="bi bi-compass-fill"></i> Get Directions</a>
        <a class="em-action-btn" href="tel:${primaryContact ? primaryContact.number.replace(/[^\d+]/g, "") : "911"}" data-press><i class="bi bi-telephone-fill"></i> Call Emergency Contact${primaryContact ? ` — ${primaryContact.number}` : ""}</a>
        <a class="em-action-btn" href="report.html" data-press><i class="bi bi-flag-fill"></i> Report Incident</a>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector("#emCloseBtn").addEventListener("click", () => this.close());
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && overlay.classList.contains("show")) this.close(); });
    this._built = true;
    this._overlay = overlay;
  },

  /** Re-picks the nearest shelter for real coordinates and updates the
   *  already-built overlay's "Find Evacuation Center" / "Get Directions"
   *  links in place, without rebuilding the whole overlay. */
  _updateNearestShelter(lat, lng) {
    if (!this._overlay) return;
    const nearestShelter = this._nearestShelter(lat, lng);
    if (!nearestShelter) return;
    const label = this._overlay.querySelector("#emFindShelterLabel");
    const directionsBtn = this._overlay.querySelector("#emDirectionsBtn");
    if (label) label.textContent = `Find Evacuation Center — ${nearestShelter.name}`;
    if (directionsBtn) directionsBtn.href = `https://www.openstreetmap.org/directions?to=${nearestShelter.lat},${nearestShelter.lng}`;
  },

  open() {
    this._build();
    document.body.style.overflow = "hidden";
    this._overlay.classList.add("show");

    // Refine "nearest shelter" with the user's real location — the overlay
    // opens instantly using the Calamba fallback above, then quietly
    // upgrades once (or if) GPS resolves so it doesn't block the UI.
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this._userLat = pos.coords.latitude;
          this._userLng = pos.coords.longitude;
          this._updateNearestShelter(this._userLat, this._userLng);
        },
        () => {}, // keep the fallback silently — no need to alarm the user in an emergency overlay
        { timeout: 8000 }
      );
    }
    if (window.DivaAnim) {
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      if (window.anime) {
        anime.animate(this._overlay, { opacity: [0, 1], duration: 220, easing: "easeOutQuad" });
        anime.animate(this._overlay.querySelectorAll(".em-badge, .em-title, .em-desc, .em-action-btn"), {
          opacity: [0, 1], translateY: [14, 0], duration: 380,
          delay: anime.stagger(60, { start: 60 }), easing: "easeOutQuad",
        });
      }
    }
  },
  close() {
    const finish = () => { this._overlay.classList.remove("show"); document.body.style.overflow = ""; };
    if (window.anime && !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
      anime.animate(this._overlay, { opacity: [1, 0], duration: 180, easing: "easeInQuad", onComplete: finish });
    } else finish();
  },
};

function renderAppShell(activePage, opts) {
  opts = opts || {};
  const user = DivaAuth.requireLogin();
  if (!user) return null;

  const isAdminRole = DivaAuth.isAdmin(user);
  const navGroups = isAdminRole ? DIVA_NAV.admin : DIVA_NAV.resident;
  const initials = (user.name || "U").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  const navHtml = navGroups.map((g) => `
    <div class="nav-section-label">${g.section}</div>
    ${g.links.map((l) => `<a class="sidebar-link ${activePage === l.href ? "active" : ""}" href="${l.href}"><i class="bi ${l.icon}"></i> ${l.label}</a>`).join("")}
  `).join("");

  const shell = document.getElementById("app-shell-root");
  shell.innerHTML = `
    <a href="#app-content" class="skip-link">Skip to main content</a>
    <div class="sidebar-overlay" id="sidebarOverlay"></div>
    <aside class="app-sidebar" id="appSidebar">
      <div class="sidebar-brand"><span class="brand-mark">D</span> DIVA</div>
      <nav class="sidebar-nav">${navHtml}</nav>
      <div class="sidebar-footer">
        <div class="sidebar-user mb-3">
          <div class="avatar">${initials}</div>
          <div>
            <div class="name">${user.name}</div>
            <div class="role">${user.role}</div>
          </div>
        </div>
        <button class="btn btn-diva btn-diva-outline btn-diva-sm w-100" id="logoutBtn" style="border-color:rgba(255,255,255,.2); color:#fff;">
          <i class="bi bi-box-arrow-right"></i> Log out
        </button>
      </div>
    </aside>
    <div class="app-main">
      <div class="offline-banner" id="offlineBanner"><i class="bi bi-wifi-off"></i> You are currently offline. Showing the latest available information.</div>
      <header class="app-topbar">
        <div class="d-flex align-items-center gap-3">
          <button class="sidebar-toggle-btn" id="sidebarToggle" aria-label="Toggle navigation"><i class="bi bi-list"></i></button>
          <div class="topbar-title">${opts.title || ""}</div>
        </div>
        <div class="d-flex align-items-center gap-2">
          <span class="eyebrow d-none d-md-inline-flex">Live monitoring</span>
          <button type="button" class="theme-toggle-btn" id="themeToggleBtn" aria-label="Switch between light and dark mode">
            <i class="bi bi-sun-fill icon-sun"></i><i class="bi bi-moon-stars-fill icon-moon"></i>
          </button>
          <button type="button" class="emergency-trigger" id="emergencyTriggerBtn"><i class="bi bi-exclamation-triangle-fill"></i> Emergency Mode</button>
        </div>
      </header>
      <main class="app-content" id="app-content"></main>
    </div>
    <nav class="bottom-nav" id="bottomNav" aria-label="Primary"></nav>
  `;

  // Sidebar open/close, shared by the topbar hamburger button and the
  // bottom nav's "More" tab (defined below) so both trigger the exact same
  // overlay instead of duplicating the animation logic.
  const sidebarEl = document.getElementById("appSidebar");
  const sidebarOverlayEl = document.getElementById("sidebarOverlay");
  function openSidebar() { DivaAnim.animateSidebarOpen(sidebarEl, sidebarOverlayEl); }
  function closeSidebar() { DivaAnim.animateSidebarClose(sidebarEl, sidebarOverlayEl); }

  // Mobile bottom navigation (resident vs. admin), mirrors the sidebar links
  const bottomNavHost = document.getElementById("bottomNav");
  if (bottomNavHost) {
    const bnLinks = isAdminRole ? DIVA_BOTTOM_NAV.admin : DIVA_BOTTOM_NAV.resident;
    bottomNavHost.innerHTML = bnLinks.map((l) => {
      const isActive = !l.emergency && l.href !== "#more" && activePage === l.href.split("#")[0];
      const emergencyClass = l.emergency ? "bn-emergency" : "";
      return `<a class="bn-link ${emergencyClass} ${isActive ? "active" : ""}" href="${l.href}" ${isActive ? 'aria-current="page"' : ""} ${l.emergency ? 'data-emergency-trigger="true"' : ""} ${l.href === "#more" ? 'data-more-trigger="true"' : ""}><i class="bi ${l.icon}"></i><span>${l.label}</span></a>`;
    }).join("");
    // The "SOS" tab opens Emergency Mode in place rather than navigating,
    // same as the topbar's Emergency Mode button.
    const emergencyTab = bottomNavHost.querySelector('[data-emergency-trigger="true"]');
    if (emergencyTab) {
      emergencyTab.addEventListener("click", (e) => {
        e.preventDefault();
        DivaEmergencyMode.open();
      });
    }
    // The "More" tab opens the same sidebar the hamburger button does,
    // giving mobile users one-tap access to every link (Weather, Volcano,
    // Earthquake, Report Incident, Profile, and the admin-only pages)
    // instead of just the 3 tabs that fit in the bar itself.
    const moreTab = bottomNavHost.querySelector('[data-more-trigger="true"]');
    if (moreTab) {
      moreTab.addEventListener("click", (e) => {
        e.preventDefault();
        openSidebar();
      });
    }
  }

  // Theme toggle
  const themeBtn = document.getElementById("themeToggleBtn");
  if (themeBtn) {
    themeBtn.classList.toggle("is-light", DivaTheme.get() === "light");
    themeBtn.addEventListener("click", () => {
      const next = DivaTheme.toggle();
      themeBtn.classList.toggle("is-light", next === "light");
      if (window.anime && !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
        anime.animate(themeBtn, { scale: [0.85, 1], duration: 260, easing: "easeOutBack" });
      }
    });
  }

  // Emergency Mode: available from every app page via the topbar trigger
  const emergencyBtn = document.getElementById("emergencyTriggerBtn");
  if (emergencyBtn) emergencyBtn.addEventListener("click", () => DivaEmergencyMode.open());

  document.getElementById("logoutBtn").addEventListener("click", () => DivaAuth.logout());
  const toggle = document.getElementById("sidebarToggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      if (sidebarEl.classList.contains("show")) closeSidebar(); else openSidebar();
    });
  }
  if (sidebarOverlayEl) sidebarOverlayEl.addEventListener("click", closeSidebar);

  // Offline detection (spec §38)
  const offlineBanner = document.getElementById("offlineBanner");
  function updateOnlineStatus() {
    if (offlineBanner) offlineBanner.classList.toggle("show", !navigator.onLine);
  }
  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);
  updateOnlineStatus();

  // "Hey IRIS" voice command mic (assets/js/voice-command.js). Mounted here
  // — rather than per-page — so every page that builds the app shell gets
  // the persistent mic button for free, and it only ever appears for a
  // logged-in user (we're already past the requireLogin() check above).
  // Guarded because voice-command.js may not be loaded on every page yet.
  if (window.VoiceCommand && typeof VoiceCommand.mount === "function") {
    VoiceCommand.mount(user);
  }

  return user;
}

function initializeAnimations() {
  if (document.querySelector(".hero-title")) DivaAnim.animatePageEntrance();
  DivaAnim.initScrollReveal(".reveal-on-scroll");
  DivaAnim.initCounters("[data-count-to]");
  document.querySelectorAll(".diva-card, .feature-card").forEach((el) => {
    if (!el.classList.contains("reveal-on-scroll")) el.style.opacity = "1";
  });
  document.querySelectorAll("[data-press]").forEach((btn) => {
    btn.addEventListener("click", () => DivaAnim.pressButton(btn));
  });
}

/* =========================================================================
   Immersive page transitions — a quick fade+rise on load, and a fade-out
   before internal navigation, so moving between pages feels continuous
   rather than a hard reload. Falls back to instant navigation if anime.js
   or the user's OS reduced-motion setting isn't available.
   ========================================================================= */
function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function initPageEntranceFade() {
  if (!window.anime || prefersReducedMotion()) return;
  document.body.style.willChange = "opacity, transform";
  anime.animate(document.body, {
    opacity: [0, 1],
    translateY: [10, 0],
    duration: 420,
    easing: "easeOutQuad",
    onComplete: () => { document.body.style.willChange = ""; },
  });
}

function initPageTransitions() {
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest("a[href]");
    if (!link) return;
    const href = link.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) return;
    if (link.target && link.target !== "_self") return;
    if (link.hasAttribute("download")) return;
    let url;
    try { url = new URL(href, window.location.href); } catch (e) { return; }
    if (url.origin !== window.location.origin) return; // external link — leave untouched
    if (url.pathname === window.location.pathname && url.hash) return; // same-page anchor
    if (!window.anime || prefersReducedMotion()) return; // let the browser navigate normally

    e.preventDefault();
    anime.animate(document.body, {
      opacity: [1, 0],
      translateY: [0, -10],
      duration: 200,
      easing: "easeInQuad",
      onComplete: () => { window.location.href = href; },
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const year = document.getElementById("footerYear");
  if (year) year.textContent = new Date().getFullYear();
  initPageEntranceFade();
  initPageTransitions();
});
