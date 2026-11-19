/* =========================================================================
   RAIN — assets/js/offline-store.js
   Offline support, part 2 of 2 (part 1 is sw.js, the service worker that
   caches the app shell itself so pages still LOAD with no connection).

   This file is what makes the app useful once it's open offline:
     - RainOffline.save(key, data)  — snapshot a page's live data with a
       timestamp, every time a fetch actually succeeds.
     - RainOffline.load(key)        — read the last snapshot back, with
       how long ago it was saved.
     - RainOffline.init()           — wires window "online"/"offline"
       events app-wide: updates the shell's offline banner with a "here's
       what we last saved and when" line, and — the moment the connection
       drops — surfaces a reminder toast built from whatever emergency
       data is actually saved (active alerts, nearest evac center,
       emergency numbers), so a resident who loses signal mid-typhoon
       isn't left staring at a blank "you are offline" banner.

   Loaded on every page (script tag added right before assets/js/main.js),
   registers the service worker itself, so pages don't need to remember to
   do it individually.
   ========================================================================= */

const RainOffline = (() => {
  const PREFIX = "rain_offline_";

  /** Save a named snapshot of live data (alerts, evac centers, weather,
   *  volcano status, quakes, ...) with the time it was captured, so it can
   *  be shown later with an honest "saved 12 min ago" instead of being
   *  silently presented as current. Safe to call every time a fetch
   *  succeeds — last write wins. */
  function save(key, data) {
    const savedAt = Date.now();
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify({ data, savedAt }));
    } catch (e) {
      return false; // storage full/unavailable — non-fatal, just means no offline fallback for this key
    }
    mirrorToNativeStorage(key, data, savedAt);
    return true;
  }

  const SEV_RANK = { critical: 3, warning: 2, advisory: 1, information: 0 };

  /** What the bundled Median offline page (offline.html) actually renders.
   *  Only these keys are mirrored to the Native Datastore, each trimmed to
   *  the fields that page reads. Reason: iOS caps App Storage
   *  (UserDefaults) at ~500 KB in total, and the full lists — every
   *  alert's message body, the raw quake feed — aren't needed there. (The
   *  evacuation centers and hotlines are built into offline.html itself;
   *  see scripts/build-offline-page.mjs.) Expired alerts are dropped so the offline page
   *  doesn't lead with something that's already over. */
  const NATIVE_MIRROR = {
    alerts(list) {
      const now = Date.now();
      return (list || [])
        .filter((a) => !a.expires_at || Date.parse(a.expires_at) > now)
        .sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0)
          || Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0))
        .slice(0, 5)
        .map((a) => ({ severity: a.severity, title: a.title, area: a.area, type: a.type, expires_at: a.expires_at || null }));
    },
    // Last known GPS fix, so offline.html can place "you" on its built-in
    // evacuation map and rank the nearest centers. Stays on this device.
    userLocation(loc) {
      return loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng) ? { lat: loc.lat, lng: loc.lng } : null;
    },
    taalWeather(w) {
      return w ? { condition: w.condition, tempC: w.tempC, windKmh: w.windKmh } : null;
    },
  };

  /** Also write the trimmed snapshot to Median's Native Datastore (App
   *  Storage), when running inside the Median-built app. Unlike
   *  localStorage, this storage isn't tied to this page's origin, so the
   *  standalone custom offline.html (a separate local file bundled into the
   *  app) can read it back. No-op everywhere else. */
  function mirrorToNativeStorage(key, data, savedAt) {
    const slim = NATIVE_MIRROR[key];
    if (!slim) return;
    try {
      if (typeof median !== "undefined" && median.storage && median.storage.app &&
          typeof median.storage.app.set === "function") {
        median.storage.app.set({ key: PREFIX + key, value: JSON.stringify({ data: slim(data), savedAt }) });
      }
    } catch (e) {
      // Native Datastore plugin not enabled, or bridge unavailable — fine, localStorage still has it.
    }
  }

  /** @returns {{data:*, savedAt:number}|null} */
  function load(key) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.savedAt !== "number") return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function clear(key) {
    try { localStorage.removeItem(PREFIX + key); } catch (e) {}
  }

  function isOnline() {
    return typeof navigator === "undefined" || navigator.onLine !== false;
  }

  /** Rough "X ago" for a saved timestamp — same rounding rules everywhere
   *  data-freshness is shown, so "5 min ago" on the offline banner and
   *  "5 min ago" on a card never disagree. */
  function timeAgo(ms) {
    const diff = Math.max(0, Date.now() - ms);
    const sec = Math.round(diff / 1000);
    if (sec < 60) return "just now";
    const min = Math.round(sec / 60);
    if (min < 60) return `${min} min ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr} hr ago`;
    const day = Math.round(hr / 24);
    return `${day} day${day === 1 ? "" : "s"} ago`;
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    // Service workers require a real origin (http/https) — skip silently
    // under file:// or other unsupported contexts instead of logging noise.
    if (location.protocol !== "http:" && location.protocol !== "https:") return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch((err) => {
        console.warn("RAIN service worker registration failed:", err);
      });
    });
  }

  /** Picks the most urgent saved alert (critical > warning > advisory >
   *  information) so the offline reminder leads with the thing that
   *  actually matters, same ranking used across the app. */
  function mostUrgentAlert(alerts) {
    if (!alerts || !alerts.length) return null;
    return [...alerts].sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0))[0];
  }

  /** Builds the offline reminder shown in the shell banner + the toast
   *  fired the moment the app goes offline. Reads whatever combination of
   *  alerts.html / emergency.html snapshots happen to be saved — none of
   *  this assumes every key exists, since a resident may have only ever
   *  opened, say, the Alerts page before losing connection. */
  function buildReminder() {
    const alertsSnap = load("alerts");
    const evacSnap = load("evacuationCenters");
    const contactsSnap = load("emergencyContacts");

    const parts = [];
    let oldestSavedAt = null;
    const noteAge = (snap) => {
      if (!snap) return;
      oldestSavedAt = oldestSavedAt === null ? snap.savedAt : Math.min(oldestSavedAt, snap.savedAt);
    };

    if (alertsSnap && alertsSnap.data && alertsSnap.data.length) {
      noteAge(alertsSnap);
      const top = mostUrgentAlert(alertsSnap.data);
      const criticalCount = alertsSnap.data.filter((a) => a.severity === "critical").length;
      if (top) {
        parts.push(
          criticalCount > 0
            ? `${criticalCount} critical alert${criticalCount === 1 ? "" : "s"} saved — most recent: "${top.title}" (${top.area}).`
            : `Saved alert: "${top.title}" (${top.area}).`
        );
      }
    }

    if (evacSnap && evacSnap.data && evacSnap.data.length) {
      noteAge(evacSnap);
      const nearest = evacSnap.data[0]; // pages save this list pre-sorted by distance
      if (nearest) {
        // Only "nearest" when the list was actually sorted by distance (needs a known location)
        parts.push(`${nearest.dist != null ? "Nearest saved" : "Saved"} evacuation center: ${nearest.name}${nearest.dist != null ? ` (${nearest.dist.toFixed(1)} km)` : ""}.`);
      }
    }

    if (contactsSnap && contactsSnap.data && contactsSnap.data.length) {
      noteAge(contactsSnap);
    }

    if (!parts.length) return null;
    return { text: parts.join(" "), savedAt: oldestSavedAt };
  }

  /** Enhances the app shell's existing #offlineBanner (built in
   *  renderAppShell(), main.js) with a second line summarizing what's
   *  saved for offline use, instead of leaving it as a bare "you are
   *  offline" notice with no indication of what the resident can still
   *  rely on. Safe no-op on pages without the shell (login/register/index). */
  function refreshBanner() {
    const banner = document.getElementById("offlineBanner");
    if (!banner) return;
    let sub = banner.querySelector(".offline-banner-sub");
    if (!isOnline()) {
      const reminder = buildReminder();
      if (reminder) {
        if (!sub) {
          sub = document.createElement("span");
          sub.className = "offline-banner-sub";
          banner.appendChild(sub);
        }
        sub.textContent = `${reminder.text} (saved ${timeAgo(reminder.savedAt)})`;
      } else if (sub) {
        sub.remove();
      }
    } else if (sub) {
      sub.remove();
    }
  }

  /** Fires once per disconnect — a toast pulling together whatever
   *  emergency data is saved, so losing signal doesn't mean losing sight
   *  of the nearest shelter or the alert that was on screen a minute ago. */
  function notifyWentOffline() {
    if (typeof rainToast !== "function") return;
    const reminder = buildReminder();
    const message = reminder
      ? `You're offline. ${reminder.text}`
      : "You're offline. Emergency contacts are still available on the Emergency page once you've visited it online.";
    rainToast(message, "bi-wifi-off");
  }

  function notifyBackOnline() {
    if (typeof rainToast !== "function") return;
    rainToast("Back online — refreshing to the latest data.", "bi-wifi");
  }

  function init() {
    registerServiceWorker();
    refreshBanner();
    window.addEventListener("offline", () => {
      refreshBanner();
      notifyWentOffline();
    });
    window.addEventListener("online", () => {
      refreshBanner();
      notifyBackOnline();
    });
  }

  return { save, load, clear, isOnline, timeAgo, buildReminder, refreshBanner, init, registerServiceWorker };
})();

document.addEventListener("DOMContentLoaded", () => RainOffline.init());
