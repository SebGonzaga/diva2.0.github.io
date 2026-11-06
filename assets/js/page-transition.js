/* =========================================================================
   RAIN — assets/js/page-transition.js
   Simple page-switch transition: a navy "ripple" blooms out from wherever
   you clicked, a tiny raindrop falls in the middle, then the new page opens
   outward from the same spot.
   - Sits BELOW the navbar / sidebar / top bar / bottom nav (z-index 800),
     so the navigation never gets covered or restyled.
   - Load this in <head> (sync) so the entry state is set before first paint.
   - Skips reduced-motion, modified clicks, new tabs, downloads, #anchors
     and external links. Pure presentation; no data/auth logic.
   ========================================================================= */
(function () {
  "use strict";
  var root = document.documentElement;
  var KEY = "rain_pt_origin";
  function radius(x, y) {
    var w = window.innerWidth, h = window.innerHeight;
    return Math.ceil(Math.hypot(Math.max(x, w - x), Math.max(y, h - y))) + 40;
  }
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;

  /* ---------- ENTRY: open the curtain on the new page ---------- */
  try {
    var saved = sessionStorage.getItem(KEY);
    if (saved) {
      sessionStorage.removeItem(KEY);
      var o = JSON.parse(saved);
      if (Date.now() - o.t < 4000) {
        root.style.setProperty("--pt-x", o.x + "px");
        root.style.setProperty("--pt-y", o.y + "px");
        root.classList.add("pt-enter");
        // Remove the class once the animation is done (fallback timer too)
        setTimeout(function () { root.classList.remove("pt-enter"); }, 600);
      }
    }
  } catch (e) {}

  // Coming back via the browser's back/forward cache: clear any stuck curtain
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) {
      root.classList.remove("pt-enter");
      var c = document.querySelector(".pt-curtain");
      if (c) c.remove();
    }
  });

  /* ---------- EXIT: close the curtain, then navigate ---------- */
  var leaving = false;

  function isInternalPage(a) {
    if (!a || !a.href) return false;
    if (a.target && a.target !== "_self") return false;
    if (a.hasAttribute("download")) return false;
    var url;
    try { url = new URL(a.href, location.href); } catch (e) { return false; }
    if (url.origin !== location.origin) return false;
    if (url.pathname === location.pathname && url.search === location.search) return false; // same page / #anchor
    return true;
  }

  // If someone is clicking through pages quickly, skip the effect entirely
  // (instant navigation) so repeated switching never feels dizzying.
  function tooFast() {
    var now = Date.now(), hist = [];
    try { hist = JSON.parse(sessionStorage.getItem("rain_pt_hist") || "[]"); } catch (e) {}
    hist = hist.filter(function (t) { return now - t < 8000; });
    var fast = hist.length >= 2;
    if (!fast) hist.push(now);
    try { sessionStorage.setItem("rain_pt_hist", JSON.stringify(hist)); } catch (e) {}
    return fast;
  }

  function leave(href, x, y) {
    leaving = true;
    if (tooFast()) { location.href = href; return; }
    var c = document.createElement("div");
    c.className = "pt-curtain";
    c.setAttribute("aria-hidden", "true");
    c.style.setProperty("--pt-x", x + "px");
    c.style.setProperty("--pt-y", y + "px");
    c.innerHTML = '<span class="pt-ripple"></span>';
    void c.offsetWidth;
    document.body.appendChild(c);
    try { sessionStorage.setItem(KEY, JSON.stringify({ x: x, y: y, t: Date.now() })); } catch (e) {}
    setTimeout(function () { location.href = href; }, 240);
    // Safety: if navigation gets cancelled, don't leave the user stuck
    setTimeout(function () { leaving = false; if (c.parentNode) c.remove(); }, 4000);
  }

  var prefetched = {};
  function prefetch(e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!isInternalPage(a) || prefetched[a.href]) return;
    prefetched[a.href] = 1;
    var l = document.createElement("link");
    l.rel = "prefetch"; l.href = a.href;
    document.head.appendChild(l);
  }
  document.addEventListener("pointerover", prefetch, { passive: true });
  document.addEventListener("touchstart", prefetch, { passive: true });

  document.addEventListener("click", function (e) {
    if (leaving || e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest("a[href]");
    if (!isInternalPage(a)) return;
    e.preventDefault();
    var x = e.clientX || window.innerWidth / 2;
    var y = e.clientY || window.innerHeight / 2;
    // Keyboard "clicks" report 0,0 — use the link's centre instead
    if (!e.clientX && !e.clientY) {
      var r = a.getBoundingClientRect();
      x = r.left + r.width / 2; y = r.top + r.height / 2;
    }
    leave(a.href, Math.round(x), Math.round(y));
  });
})();
