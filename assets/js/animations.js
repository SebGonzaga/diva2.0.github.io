/* =========================================================================
   DIVA — assets/js/animations.js
   Centralized Anime.js 4.5.0 animation utility.
   Presentation only — never contains API, auth, or data logic.
   Respects prefers-reduced-motion throughout.
   ========================================================================= */

(function (global) {
  "use strict";

  // Anime.js 4.x exposes named exports on the global `anime` bundle object
  // when loaded via the UMD build: anime.animate, anime.stagger, anime.utils
  const engine = global.anime || null;
  const reduceMotion = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function safeAnimate(targets, params) {
    if (!engine || !targets) return;
    const els = typeof targets === "string" ? document.querySelectorAll(targets) : targets;
    if (!els || (els.length === 0 && !(els instanceof Element))) return;

    if (reduceMotion) {
      // Reduced motion: snap to end state, skip movement/looping.
      const endState = {};
      Object.keys(params).forEach((k) => {
        if (["duration", "delay", "easing", "loop", "direction", "autoplay"].includes(k)) return;
        const v = params[k];
        endState[k] = Array.isArray(v) ? v[v.length - 1] : v;
      });
      return engine.animate(els, { ...endState, duration: 1, delay: 0 });
    }
    return engine.animate(els, params);
  }

  const DivaAnim = {
    /** Landing hero: title -> subtitle -> CTAs, staggered */
    animatePageEntrance() {
      safeAnimate(".hero-title", { opacity: [0, 1], translateY: [16, 0], scale: [0.97, 1], duration: 700, easing: "easeOutQuad" });
      safeAnimate(".hero-subtitle", { opacity: [0, 1], translateY: [12, 0], duration: 600, delay: 180, easing: "easeOutQuad" });
      safeAnimate(".hero-desc", { opacity: [0, 1], translateY: [12, 0], duration: 600, delay: 300, easing: "easeOutQuad" });
      safeAnimate(".hero-cta", { opacity: [0, 1], translateY: [10, 0], duration: 500, delay: engine ? engine.stagger(90, { start: 420 }) : 420, easing: "easeOutQuad" });
      safeAnimate(".hero-stat", { opacity: [0, 1], translateY: [10, 0], duration: 500, delay: engine ? engine.stagger(80, { start: 560 }) : 560, easing: "easeOutQuad" });
    },

    /** Generic staggered card entrance — dashboard, volcano list, alerts, admin */
    animateCards(selector, opts) {
      opts = opts || {};
      safeAnimate(selector, {
        opacity: [0, 1],
        translateY: [20, 0],
        duration: opts.duration || 520,
        delay: engine ? engine.stagger(opts.stagger || 90, { start: opts.start || 0 }) : 0,
        easing: "easeOutQuad",
      });
    },

    /** Volcano-style horizontal card entrance */
    animateCardsX(selector, opts) {
      opts = opts || {};
      safeAnimate(selector, {
        opacity: [0, 1],
        translateX: [-15, 0],
        duration: 520,
        delay: engine ? engine.stagger(opts.stagger || 100) : 0,
        easing: "easeOutQuad",
      });
    },

    /** Scroll-triggered reveal using IntersectionObserver, animates once */
    initScrollReveal(selector) {
      const els = document.querySelectorAll(selector);
      if (!els.length) return;
      if (!("IntersectionObserver" in global) || reduceMotion) {
        safeAnimate(selector, { opacity: [0, 1], translateY: [0, 0], duration: 1 });
        return;
      }
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              safeAnimate(entry.target, { opacity: [0, 1], translateY: [24, 0], scale: [0.98, 1], duration: 600, easing: "easeOutQuad" });
              io.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.15 }
      );
      els.forEach((el) => io.observe(el));
    },

    /** Count a number from 0 -> target once visible. el must have data-count-to */
    animateCounter(el) {
      if (!el) return;
      const target = parseFloat(el.getAttribute("data-count-to") || "0");
      const suffix = el.getAttribute("data-count-suffix") || "";
      if (reduceMotion || !engine) {
        el.textContent = target.toLocaleString() + suffix;
        return;
      }
      const obj = { val: 0 };
      engine.animate(obj, {
        val: target,
        duration: 1200,
        easing: "easeOutExpo",
        onUpdate: () => {
          el.textContent = Math.floor(obj.val).toLocaleString() + suffix;
        },
      });
    },

    initCounters(selector) {
      const els = document.querySelectorAll(selector || "[data-count-to]");
      if (!els.length) return;
      if (!("IntersectionObserver" in global)) {
        els.forEach((el) => DivaAnim.animateCounter(el));
        return;
      }
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              DivaAnim.animateCounter(entry.target);
              io.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.4 }
      );
      els.forEach((el) => io.observe(el));
    },

    /** Modal open/close */
    animateModalOpen(el) {
      safeAnimate(el, { opacity: [0, 1], scale: [0.95, 1], duration: 220, easing: "easeOutQuad" });
    },
    animateModalClose(el, done) {
      if (reduceMotion || !engine) { if (done) done(); return; }
      engine.animate(el, { opacity: [1, 0], scale: [1, 0.95], duration: 160, easing: "easeInQuad", onComplete: done });
    },

    /** Toast enter/exit */
    animateToastIn(el) {
      safeAnimate(el, { translateX: ["110%", "0%"], opacity: [0, 1], duration: 320, easing: "easeOutQuad" });
    },
    animateToastOut(el, done) {
      if (reduceMotion || !engine) { if (done) done(); return; }
      engine.animate(el, { translateX: ["0%", "110%"], opacity: [1, 0], duration: 260, easing: "easeInQuad", onComplete: done });
    },

    /** Chat message enter */
    animateChatMessage(el, role) {
      const from = role === "user" ? 24 : -24;
      safeAnimate(el, { opacity: [0, 1], translateX: [from, 0], duration: 320, easing: "easeOutQuad" });
    },

    /** Typing indicator dots — subtle sequential opacity/scale loop */
    startTypingDots(container) {
      if (!container) return null;
      const dots = container.querySelectorAll("span");
      if (!engine || reduceMotion) return null;
      return engine.animate(dots, {
        opacity: [0.25, 1, 0.25],
        scale: [0.85, 1, 0.85],
        duration: 1000,
        delay: engine.stagger(160),
        loop: true,
        easing: "easeInOutSine",
      });
    },
    stopTypingDots(handle) {
      if (handle && handle.pause) handle.pause();
    },

    /** Sidebar mobile slide */
    animateSidebarOpen(el, overlay) {
      if (overlay) overlay.classList.add("show");
      el.classList.add("show");
      safeAnimate(el, { translateX: ["-100%", "0%"], duration: 280, easing: "easeOutQuad" });
      if (overlay) safeAnimate(overlay, { opacity: [0, 1], duration: 280 });
    },
    animateSidebarClose(el, overlay, done) {
      const finish = () => {
        el.classList.remove("show");
        if (overlay) overlay.classList.remove("show");
        if (done) done();
      };
      if (reduceMotion || !engine) { finish(); return; }
      engine.animate(el, { translateX: ["0%", "-100%"], duration: 260, easing: "easeInQuad", onComplete: finish });
      if (overlay) engine.animate(overlay, { opacity: [1, 0], duration: 260 });
    },

    /** Alert banner entrance, with extra pulse for Critical */
    animateAlertBanner(el, severity) {
      safeAnimate(el, { opacity: [0, 1], translateY: [-15, 0], duration: 400, easing: "easeOutQuad" });
    },

    /** Button micro-interaction (press feedback) */
    pressButton(el) {
      if (reduceMotion || !engine) return;
      engine.animate(el, { scale: [1, 0.96, 1], duration: 260, easing: "easeOutQuad" });
    },

    /** Loading spinner container fade */
    animateLoadingIn(el) {
      safeAnimate(el, { opacity: [0, 1], duration: 200 });
    },
    animateLoadingOut(el, done) {
      if (reduceMotion || !engine) { if (done) done(); return; }
      engine.animate(el, { opacity: [1, 0], duration: 180, onComplete: done });
    },

    /** Value refresh highlight (e.g., temperature ticking up) */
    highlightUpdate(el) {
      if (reduceMotion || !engine) return;
      engine.animate(el, { scale: [1, 1.08, 1], color: [{ to: "#33c9d1" }, { to: null }], duration: 700, easing: "easeOutQuad" });
    },

    /** Status pulse for volcano markers / status dots, intensity 1-5 */
    pulseIntensity(el, level) {
      if (!el) return;
      el.classList.remove("pulse-dot");
      if (level >= 1) el.classList.add("pulse-dot");
    },
  };

  global.DivaAnim = DivaAnim;
})(window);
