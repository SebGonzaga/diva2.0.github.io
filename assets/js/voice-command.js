/* =========================================================================
   DIVA — assets/js/voice-command.js
   "Hey IRIS" voice command feature.

   Mounted into the app shell by renderAppShell() (see main.js) — every page
   that builds the shell gets a persistent mic button for free, and only for
   a logged-in user (renderAppShell already gates on that).

   Flow: tap mic -> Web Speech API SpeechRecognition captures one phrase
   ("Hey IRIS, <command>") -> strip the wake word -> check the command
   against a small set of known keywords -> navigate to the matching page
   (speaking a short confirmation first via SpeechSynthesis), or, if nothing
   matches, send the command to the existing Gemini chat backend
   (api/chat.js) via DivaChatAPI.send() (assets/js/main.js) — the same
   helper virtual-assistance.html's chat UI uses, so the request/parsing
   logic isn't duplicated — and speak + display the reply.

   Native Web Speech API only (SpeechRecognition + SpeechSynthesis) — no new
   dependencies. If either isn't supported (e.g. non-Chrome browsers), the
   mic button simply never mounts.
   ========================================================================= */
const VoiceCommand = {
  MUTE_KEY: "diva_voice_muted",

  // Known intents, checked in order — first keyword match wins. Kept small
  // and literal on purpose: this is a fast local check, not a substitute
  // for the AI fallback below.
  INTENTS: [
    { keywords: ["report", "incident"], label: "incident report", href: "report.html", voiceIntent: "report_incident" },
    { keywords: ["weather"], label: "weather", href: "weather.html", voiceIntent: "weather" },
    { keywords: ["alerts", "alert"], label: "alerts", href: "alerts.html", voiceIntent: "alerts" },
    { keywords: ["emergency", "help", "sos"], label: "emergency help", href: "emergency.html", voiceIntent: "emergency" },
    { keywords: ["volcano", "volcanic"], label: "volcano monitoring", href: "volcano.html", voiceIntent: "volcano" },
    { keywords: ["dashboard"], label: "dashboard", href: "dashboard.html", voiceIntent: "dashboard" },
  ],

  // Matches an optional lead-in ("hey"/"hi"/"ok"/"okay") plus "iris" and a
  // few speech-to-text mishearings of it ("eris", "irish", "aris"), so
  // "Hey IRIS, ..." and near-variants all strip cleanly. If the phrase
  // doesn't start with anything wake-word-shaped, the transcript is used
  // as-is rather than rejected outright — recognizers sometimes clip the
  // first word, and failing loudly there would be worse UX than just
  // treating the rest of the sentence as the command.
  WAKE_WORD_RE: /^[\s,.!?]*(?:hey|hi|hay|ho|okay|ok)?[\s,]*(?:iris|eris|irish|aris|iriss)\b[\s,.!?-]*/i,

  _mounted: false,
  _state: "idle", // idle | listening | processing
  _muted: false,
  _recognition: null,
  _hideBubbleTimer: null,

  _speechSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  },
  _ttsSupported() {
    return "speechSynthesis" in window;
  },
  _supported() {
    return this._speechSupported() && this._ttsSupported();
  },

  _getMutedPref() {
    try { return localStorage.getItem(this.MUTE_KEY) === "1"; } catch (e) { return false; }
  },
  _setMutedPref(v) {
    try { localStorage.setItem(this.MUTE_KEY, v ? "1" : "0"); } catch (e) { /* storage unavailable — non-fatal */ }
  },

  /** Call once per page load, after the app shell has been built. No-ops if
   *  already mounted (defensive — renderAppShell() only calls this once
   *  per page anyway) or if the browser lacks either Web Speech API. */
  mount() {
    if (this._mounted) return;
    if (!this._supported()) return; // hide the feature entirely — see file header
    this._mounted = true;
    this._muted = this._getMutedPref();
    this._buildWidget();
    this._wireEvents();
  },

  _buildWidget() {
    const el = document.createElement("div");
    el.className = "voice-widget";
    el.id = "voiceWidget";
    el.innerHTML = `
      <div class="voice-response-bubble" id="voiceResponseBubble" role="status" aria-live="polite"></div>
      <div class="voice-thinking" id="voiceThinking" aria-hidden="true"><span></span><span></span><span></span></div>
      <button type="button" class="voice-mute-btn" id="voiceMuteBtn" aria-pressed="false" aria-label="Mute IRIS voice responses" title="Mute voice responses">
        <i class="bi bi-volume-up-fill"></i>
      </button>
      <button type="button" class="voice-mic-btn" id="voiceMicBtn" aria-label="Activate Hey IRIS voice command" title="Hey IRIS — tap and say a command">
        <i class="bi bi-mic-fill"></i>
      </button>
    `;
    document.body.appendChild(el);
    this._els = {
      widget: el,
      mic: el.querySelector("#voiceMicBtn"),
      mute: el.querySelector("#voiceMuteBtn"),
      thinking: el.querySelector("#voiceThinking"),
      bubble: el.querySelector("#voiceResponseBubble"),
    };
    this._syncMuteBtn();
  },

  _syncMuteBtn() {
    const { mute } = this._els;
    mute.classList.toggle("is-muted", this._muted);
    mute.setAttribute("aria-pressed", this._muted ? "true" : "false");
    mute.setAttribute("title", this._muted ? "Unmute voice responses" : "Mute voice responses");
    mute.innerHTML = `<i class="bi ${this._muted ? "bi-volume-mute-fill" : "bi-volume-up-fill"}"></i>`;
  },

  _wireEvents() {
    this._els.mic.addEventListener("click", () => this._onMicTap());
    this._els.mute.addEventListener("click", () => {
      this._muted = !this._muted;
      this._setMutedPref(this._muted);
      this._syncMuteBtn();
      if (this._muted) window.speechSynthesis.cancel();
    });
  },

  _setState(state) {
    this._state = state;
    this._els.widget.classList.toggle("is-listening", state === "listening");
    this._els.widget.classList.toggle("is-processing", state === "processing");
    this._els.thinking.classList.toggle("show", state === "listening" || state === "processing");
    this._els.mic.disabled = state !== "idle";
  },

  _showResponseBubble(text, autoHideMs) {
    const { bubble } = this._els;
    bubble.textContent = text;
    bubble.classList.add("show");
    clearTimeout(this._hideBubbleTimer);
    if (autoHideMs) {
      this._hideBubbleTimer = setTimeout(() => bubble.classList.remove("show"), autoHideMs);
    }
  },
  _hideResponseBubble() {
    this._els.bubble.classList.remove("show");
    clearTimeout(this._hideBubbleTimer);
  },

  _onMicTap() {
    if (this._state !== "idle") return; // already listening/processing — ignore extra taps
    // A new command always wins over IRIS still talking from the last one.
    if (this._ttsSupported() && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
      window.speechSynthesis.cancel();
    }
    this._hideResponseBubble();
    this._startListening();
  },

  _startListening() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = (navigator.language && navigator.language.toLowerCase().startsWith("en")) ? navigator.language : "en-US";
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      const transcript = (e.results && e.results[0] && e.results[0][0] && e.results[0][0].transcript) || "";
      this._handleTranscript(transcript);
    };
    rec.onerror = (e) => {
      this._setState("idle");
      if (e.error === "no-speech") {
        divaToast('Didn\u2019t catch that \u2014 try "Hey IRIS" again.', "bi-mic-mute");
      } else if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        divaToast("Microphone access is blocked for this site.", "bi-mic-mute");
      } else {
        divaToast("Voice command couldn't start. Please try again.", "bi-exclamation-triangle");
      }
    };
    rec.onend = () => {
      // Only reset here if we never got as far as processing a result
      // (e.g. silence/timeout) — a successful result already moved state
      // to "processing" and this shouldn't stomp on that.
      if (this._state === "listening") this._setState("idle");
    };

    this._recognition = rec;
    this._setState("listening");
    try {
      rec.start();
    } catch (err) {
      console.error("VoiceCommand: recognition failed to start:", err);
      this._setState("idle");
    }
  },

  _stripWakeWord(text) {
    return text.replace(this.WAKE_WORD_RE, "");
  },

  _matchIntent(text) {
    const t = text.toLowerCase();
    for (const intent of this.INTENTS) {
      for (const kw of intent.keywords) {
        if (new RegExp("\\b" + kw + "\\b", "i").test(t)) return intent;
      }
    }
    return null;
  },

  async _handleTranscript(rawTranscript) {
    this._setState("processing");
    const command = this._stripWakeWord(rawTranscript).trim();

    if (!command) {
      this._setState("idle");
      divaToast('Say "Hey IRIS" followed by a command.', "bi-mic");
      return;
    }

    const intent = this._matchIntent(command);
    if (intent) {
      // Simple context for the destination page to pre-focus/pre-fill from
      // (e.g. report.html focuses the incident type field on
      // voiceIntent === "report_incident"). Cleared once removed — this is
      // navigation context, not permanent state — so it doesn't linger.
      try {
        sessionStorage.setItem("voiceIntent", JSON.stringify({ voiceIntent: intent.voiceIntent, raw: command }));
      } catch (e) { /* storage unavailable — page just won't get the pre-focus hint */ }
      this._setState("idle");
      const confirmation = `Opening ${intent.label}.`;
      this._showResponseBubble(confirmation);
      this._speakThenNavigate(confirmation, intent.href);
      return;
    }

    // No keyword match — fall back to the existing Gemini chat backend,
    // reusing the exact same call virtual-assistance.html makes.
    try {
      const reply = await DivaChatAPI.send(command, { lang: "en", history: [] });
      this._setState("idle");
      const spoken = this._forSpeech(reply);
      this._showResponseBubble(this._forDisplay(reply), 12000);
      this._speak(spoken);
    } catch (err) {
      console.error("VoiceCommand: chat fallback failed:", err);
      this._setState("idle");
      const message = "I couldn't reach the assistant right now. Please try again in a moment.";
      this._showResponseBubble(message, 8000);
      this._speak(message);
    }
  },

  // Gemini replies come back as raw markdown (see api/chat.js /
  // virtual-assistance.html's renderMarkdown()). The voice bubble is a
  // plain-text popup, not a full chat view, so this strips markdown syntax
  // down to readable text rather than pulling in a markdown renderer for
  // a small transient surface.
  _forDisplay(mdText) {
    return String(mdText)
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
      .replace(/\[([^\]]+)\]\((?:https?:\/\/[^\s)]+)\)/g, "$1")
      .replace(/^[ \t]*[-*]\s+/gm, "\u2022 ")
      .trim();
  },
  // Speech needs an extra pass beyond _forDisplay: no bullet glyphs, no
  // stray emoji, and line breaks read as pauses rather than silence.
  _forSpeech(mdText) {
    return this._forDisplay(mdText)
      .replace(/\u2022\s*/g, "")
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
      .replace(/\n+/g, ". ")
      .replace(/\s{2,}/g, " ")
      .trim();
  },

  _applyVoiceDefaults(utter) {
    utter.rate = 1.0;
    utter.pitch = 1.0;
    utter.volume = 1.0;
    utter.lang = "en-US";
    const voices = window.speechSynthesis.getVoices();
    if (voices && voices.length) {
      const preferred =
        voices.find((v) => /^en/i.test(v.lang) && /female|samantha|zira|google us english/i.test(v.name)) ||
        voices.find((v) => /^en/i.test(v.lang)) ||
        voices[0];
      if (preferred) utter.voice = preferred;
    }
  },

  _speak(text) {
    if (this._muted || !this._ttsSupported() || !text) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    this._applyVoiceDefaults(utter);
    window.speechSynthesis.speak(utter);
  },

  /** Speaks a confirmation, then navigates once speech finishes (so the
   *  page doesn't unload mid-sentence). Falls back to navigating
   *  immediately if voice is muted/unsupported, and includes a timeout
   *  safety net in case `onend` never fires (seen on some mobile browsers). */
  _speakThenNavigate(text, href) {
    const go = () => { window.location.href = href; };
    if (this._muted || !this._ttsSupported()) { go(); return; }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    this._applyVoiceDefaults(utter);
    let navigated = false;
    const navigateOnce = () => { if (navigated) return; navigated = true; go(); };
    utter.onend = navigateOnce;
    utter.onerror = navigateOnce;
    setTimeout(navigateOnce, 4000);
    window.speechSynthesis.speak(utter);
  },

  /** Reads back ({voiceIntent, raw} or null) and clears the sessionStorage
   *  entry a matched intent left for the destination page — one-shot, so a
   *  page refresh doesn't re-trigger the same pre-focus/pre-fill behavior.
   *  Destination pages (e.g. report.html) call this on load. */
  consumeIntent() {
    try {
      const raw = sessionStorage.getItem("voiceIntent");
      if (!raw) return null;
      sessionStorage.removeItem("voiceIntent");
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  },
};
