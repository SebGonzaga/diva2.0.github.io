/* =========================================================================
   RAIN-bot — cute animated chatbot mascot.

   Usage (virtual-assistance.html):
     RainBot.mount(document.getElementById("rainBotStrip"), { lang: "en" });
     RainBot.setThinking(true);   // AI is generating  -> busy "thinking" actions
     RainBot.setThinking(false);
     RainBot.celebrate();         // reply arrived
     RainBot.oops();              // request failed / fell back to offline
     RainBot.setLang("fil");

   When idle it wanders left/right and does random things (wave, hop, spin,
   dance, look around, stretch, zap, nap...). While thinking it paces, types,
   scans and spins a little cog. Poke it for a reaction.
   All motion is CSS (rain-bot.css); this file only picks what to do next.
   ========================================================================= */
const RainBot = (() => {
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const SAY = {
    en: {
      hello: ["Hi! I'm RAIN-bot 👋", "Hello! Ask me anything", "Beep boop, ready to help!"],
      idle: ["Stay safe out there!", "Got an emergency kit?", "Beep boop~", "Weather check?", "I never get tired ⚡", "Know your evac route!", "*humming*"],
      think: ["Thinking…", "Crunching data…", "Checking sources…", "Beep boop…", "One moment…", "Reading the sky ☁️", "Almost there…"],
      done: ["Done! ✨", "Here you go!", "Got it!", "Ta-da!"],
      oops: ["Oops! Offline mode", "Hmm, couldn't reach the AI", "Something glitched…"],
      poke: ["Hehe, that tickles!", "Boop!", "Hi hi! 💙", "Eep!", "Hey, I'm working!"],
      wake: ["Huh? I'm awake!", "*yawn* Hi!", "Oh! Hello!"],
      sleep: ["Zzz…"],
    },
    fil: {
      hello: ["Hi! Ako si RAIN-bot 👋", "Kumusta! Magtanong ka", "Beep boop, handa na ako!"],
      idle: ["Ingat palagi!", "May emergency kit ka na?", "Beep boop~", "Check natin ang panahon?", "Alam mo ba ang evac route?", "*humuhuni*"],
      think: ["Nag-iisip…", "Sinusuri ang data…", "Tinitingnan ang sources…", "Beep boop…", "Sandali lang…", "Binabasa ang langit ☁️", "Malapit na…"],
      done: ["Tapos na! ✨", "Heto na!", "Nakuha ko!", "Ta-da!"],
      oops: ["Oops! Offline mode", "Hindi maabot ang AI", "May nag-glitch…"],
      poke: ["Hehe, kiliti!", "Boop!", "Hi hi! 💙", "Eep!", "Uy, nagtatrabaho ako!"],
      wake: ["Ha? Gising na ako!", "*hikab* Hi!", "Oh! Hello!"],
      sleep: ["Zzz…"],
    },
  };

  const IDLE_ACTIONS = [
    // [name, durationMs, weight]
    ["wave", 2200, 3], ["hop", 1200, 3], ["spin", 950, 2], ["dance", 3000, 2],
    ["look", 2300, 3], ["stretch", 1400, 2], ["zap", 1200, 1],
  ];
  const THINK_ACTIONS = ["type", "scan", "cog", "pace", "type", "scan"];

  const SVG = `
<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <g class="rb-ant">
    <line x1="32" y1="14" x2="32" y2="7" stroke="#8fb3d6" stroke-width="2" stroke-linecap="round"/>
    <circle class="rb-ant-ball" cx="32" cy="5.5" r="3.2"/>
  </g>
  <rect class="rb-arm l" x="12.5" y="45" width="6" height="12" rx="3" fill="#cfe0f2" stroke="#9fbcd8" stroke-width="1"/>
  <rect class="rb-arm r" x="45.5" y="45" width="6" height="12" rx="3" fill="#cfe0f2" stroke="#9fbcd8" stroke-width="1"/>
  <ellipse class="rb-foot l" cx="26" cy="60" rx="5.5" ry="2.8" fill="#8fb3d6"/>
  <ellipse class="rb-foot r" cx="38" cy="60" rx="5.5" ry="2.8" fill="#8fb3d6"/>
  <rect x="20" y="43" width="24" height="15" rx="7.5" fill="#eaf4ff" stroke="#bcd3ea" stroke-width="1.2"/>
  <circle class="rb-chest" cx="32" cy="50.5" r="3"/>
  <circle cx="9.5" cy="28" r="3" fill="#33c9d1"/><circle cx="54.5" cy="28" r="3" fill="#33c9d1"/>
  <rect x="11.5" y="13.5" width="41" height="29" rx="13" fill="#eaf4ff" stroke="#bcd3ea" stroke-width="1.2"/>
  <rect x="16.5" y="19" width="31" height="18" rx="9" fill="#0a1830"/>
  <g class="rb-eyes">
    <ellipse class="rb-eye" cx="25.5" cy="27.5" rx="3" ry="3.6"/>
    <ellipse class="rb-eye" cx="38.5" cy="27.5" rx="3" ry="3.6"/>
  </g>
  <circle class="rb-blush" cx="20.5" cy="33" r="2" fill="#ff9fb2"/>
  <circle class="rb-blush" cx="43.5" cy="33" r="2" fill="#ff9fb2"/>
  <path d="M29 33 q3 2.4 6 0" fill="none" stroke="#33c9d1" stroke-width="1.4" stroke-linecap="round"/>
</svg>`;

  let strip, bot, say, hopper, flipEl, lang = "en";
  let x = 0, facing = 1, maxX = 0;
  let idleTimer = null, thinkTimer = null, actTimer = null, sayTimer = null, walkTimer = null;
  let thinking = false, sleeping = false, mounted = false, lastActivity = Date.now(), thinkTick = 0;

  const t = (k) => pick(SAY[lang][k] || SAY.en[k]);

  function speak(text, ms = 2200) {
    if (!say) return;
    say.textContent = text;
    say.classList.add("show");
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => say.classList.remove("show"), ms);
  }

  function clearActs() {
    clearTimeout(actTimer);
    [...bot.classList].forEach((c) => { if (c.startsWith("act-") || c.startsWith("think-")) bot.classList.remove(c); });
    sleeping = false;
  }

  function act(name, ms, onEnd) {
    clearActs();
    bot.classList.add("act-" + name);
    if (name === "sleep") sleeping = true;
    if (ms) actTimer = setTimeout(() => { bot.classList.remove("act-" + name); if (onEnd) onEnd(); }, ms);
  }

  function measure() {
    const w = strip.clientWidth;
    const size = bot.offsetWidth || 56;
    maxX = Math.max(0, w - size - 8);
    if (x > maxX) place(maxX, 0);
  }

  function place(nx, ms) {
    x = Math.min(Math.max(8, nx), Math.max(8, maxX));
    bot.style.transition = ms ? `transform ${ms}ms linear` : "none";
    bot.style.transform = `translateX(${x}px)`;
  }

  function face(dir) {
    facing = dir;
    flipEl.style.transform = dir < 0 ? "scaleX(-1)" : "";
  }

  // Walk to a new spot; calls done() when it arrives.
  function walkTo(target, { fast = false, done } = {}) {
    clearTimeout(walkTimer);
    if (reduced() || maxX < 20) { if (done) done(); return; }
    target = Math.min(Math.max(8, target), maxX);
    const dist = Math.abs(target - x);
    if (dist < 14) { if (done) done(); return; }
    const ms = dist / (fast ? 0.22 : 0.075); // px per ms
    face(target > x ? 1 : -1);
    bot.classList.add("is-walking");
    bot.classList.toggle("is-running", fast);
    place(target, ms);
    walkTimer = setTimeout(() => {
      bot.classList.remove("is-walking", "is-running");
      if (done) done();
    }, ms + 30);
  }

  /* ---------------- idle behaviour ---------------- */
  function scheduleIdle(ms) {
    clearTimeout(idleTimer);
    if (thinking || document.hidden) return;
    idleTimer = setTimeout(idleStep, ms == null ? rand(1800, 4800) : ms);
  }

  function idleStep() {
    if (thinking) return;
    const idleFor = Date.now() - lastActivity;
    // Long quiet spell -> take a nap in place.
    if (!sleeping && idleFor > 45000 && Math.random() < 0.6) {
      speak(t("sleep"), 1600);
      act("sleep", 0);
      scheduleIdle(rand(9000, 16000));
      return;
    }
    if (sleeping) {               // sleep a while, then stretch awake on its own
      if (idleFor > 90000 || Math.random() < 0.15) { act("stretch", 1400, () => scheduleIdle()); }
      else scheduleIdle(rand(6000, 12000));
      return;
    }
    const roll = Math.random();
    if (roll < 0.5 && !reduced()) {
      walkTo(rand(8, maxX), { done: () => scheduleIdle() });
    } else {
      const total = IDLE_ACTIONS.reduce((s, a) => s + a[2], 0);
      let r = Math.random() * total, chosen = IDLE_ACTIONS[0];
      for (const a of IDLE_ACTIONS) { if ((r -= a[2]) <= 0) { chosen = a; break; } }
      act(chosen[0], chosen[1], () => scheduleIdle());
      if (Math.random() < 0.3) speak(t("idle"));
    }
  }

  /* ---------------- thinking behaviour ---------------- */
  function thinkStep() {
    if (!thinking) return;
    const a = pick(THINK_ACTIONS);
    thinkTick++;
    if (thinkTick % 2 === 1) speak(t("think"), 2000);
    clearTimeout(walkTimer);
    bot.classList.remove("is-walking", "is-running");
    clearActs();
    if (a === "pace") {
      walkTo(rand(8, maxX), { fast: true, done: () => { thinkTimer = setTimeout(thinkStep, rand(200, 500)); } });
      return;
    }
    bot.classList.add("think-" + a);
    thinkTimer = setTimeout(thinkStep, rand(1700, 2800));
  }

  function setThinking(on) {
    if (!mounted || thinking === on) return;
    thinking = on;
    clearTimeout(idleTimer); clearTimeout(thinkTimer);
    lastActivity = Date.now();
    if (on) {
      clearActs();
      bot.classList.add("is-thinking");
      // Hurry to the middle-ish and get to work.
      walkTo(maxX / 2 + rand(-40, 40), { fast: true, done: () => { thinkTick = 0; thinkStep(); } });
      if (reduced() || maxX < 20) { thinkTick = 0; thinkStep(); }
    } else {
      clearTimeout(walkTimer);
      bot.classList.remove("is-thinking", "is-walking", "is-running");
      clearActs();
      say.classList.remove("show");
      scheduleIdle(1500);
    }
  }

  /* ---------------- reactions ---------------- */
  function burst(chars) {
    if (reduced()) return;
    for (let i = 0; i < 6; i++) {
      const s = document.createElement("span");
      s.className = "rb-spark";
      s.textContent = pick(chars);
      s.style.setProperty("--dx", rand(-34, 34) + "px");
      s.style.setProperty("--dy", rand(-48, -16) + "px");
      s.style.animationDelay = i * 40 + "ms";
      bot.appendChild(s);
      setTimeout(() => s.remove(), 1100);
    }
  }

  function celebrate() {
    if (!mounted) return;
    thinking = false; // make sure
    clearTimeout(thinkTimer); clearTimeout(walkTimer);
    bot.classList.remove("is-thinking", "is-walking", "is-running");
    lastActivity = Date.now();
    speak(t("done"), 1800);
    burst(["✦", "✧", "★", "·"]);
    act("cheer", 1500, () => scheduleIdle(1200));
  }

  function oops() {
    if (!mounted) return;
    thinking = false;
    clearTimeout(thinkTimer); clearTimeout(walkTimer);
    bot.classList.remove("is-thinking", "is-walking", "is-running");
    lastActivity = Date.now();
    speak(t("oops"), 2600);
    act("oops", 1000, () => scheduleIdle(1500));
  }

  function poke() {
    lastActivity = Date.now();
    if (thinking) { speak(t("poke"), 1600); return; }
    clearTimeout(idleTimer); clearTimeout(walkTimer);
    bot.classList.remove("is-walking", "is-running");
    if (sleeping) {
      speak(t("wake"), 1800);
      act("hop", 1200, () => scheduleIdle(1500));
    } else {
      speak(t("poke"), 1800);
      burst(["💙", "✦"]);
      act("giggle", 1000, () => scheduleIdle(1500));
    }
  }

  // Any user activity (typing, clicking a topic) wakes the bot.
  function wake() {
    lastActivity = Date.now();
    if (sleeping && !thinking) {
      speak(t("wake"), 1600);
      act("stretch", 1200, () => scheduleIdle(1200));
    }
  }

  function mount(el, opts = {}) {
    if (mounted || !el) return;
    strip = el;
    lang = opts.lang || "en";
    strip.classList.add("rb-strip");
    strip.innerHTML = `
      <div class="rb-bot" role="button" tabindex="0" aria-label="RAIN-bot mascot — tap to say hi">
        <div class="rb-hopper"><div class="rb-flip"><div class="rb-bob">${SVG}</div></div></div>
        <span class="rb-shadow"></span>
        <span class="rb-cog"></span>
        <span class="rb-dots"><b></b><b></b><b></b></span>
        <span class="rb-zzz"><i>z</i><i>z</i><i>Z</i></span>
        <div class="rb-say" role="presentation"></div>
      </div>`;
    bot = strip.querySelector(".rb-bot");
    say = strip.querySelector(".rb-say");
    hopper = strip.querySelector(".rb-hopper");
    flipEl = strip.querySelector(".rb-flip");
    mounted = true;

    measure();
    place(Math.min(24, maxX), 0);
    if ("ResizeObserver" in window) new ResizeObserver(measure).observe(strip);
    else window.addEventListener("resize", measure);

    bot.addEventListener("click", poke);
    bot.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); poke(); } });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { clearTimeout(idleTimer); }
      else if (!thinking) scheduleIdle(800);
    });
    const inp = document.getElementById("chatInput");
    if (inp) { inp.addEventListener("input", wake); inp.addEventListener("focus", wake); }

    // Say hello, then start wandering.
    setTimeout(() => {
      speak(t("hello"), 2600);
      act("wave", 2200, () => scheduleIdle(1200));
    }, 700);
  }

  function setLang(l) { lang = SAY[l] ? l : "en"; }

  return { mount, setThinking, celebrate, oops, poke, wake, setLang, say: speak };
})();
window.RainBot = RainBot;
