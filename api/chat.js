// /api/chat.js
// Serverless function (Vercel Node.js runtime). Proxies chat messages to
// Google's Gemini API so the API key stays server-side. Called from
// virtual-assistance.html instead of the current localStorage-only
// simulation.
//
// Uses the free-tier-eligible Gemini 3.1 Flash-Lite model. Gemini 2.5 Flash
// previously worked here but new Google AI Studio projects (like this one)
// are provisioned only with current-gen models -- 2.5-flash 404s with
// "model not found" on such keys even though it isn't globally deprecated.
// 3.1-flash-lite is Google's recommended low-cost/high-volume replacement
// and has no shutdown date announced as of this writing. Free tier is rate
// limited (check https://ai.google.dev/gemini-api/docs/rate-limits for
// current limits) -- fine for demo/low traffic, but worth watching if
// usage grows.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, history, lang } = req.body || {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Missing "message" string in request body' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server misconfigured: GEMINI_API_KEY not set' });
  }

  // Keep the assistant scoped to disaster-preparedness topics, matching
  // DIVA's purpose (see demo-data.js aiReplies for the tone/format used
  // in the frontend's demo mode). This is a soft guardrail, not a hard
  // filter -- Gemini decides in-context whether a question is in scope, so
  // it can still be argued around by a sufficiently insistent or indirect
  // prompt. It is not a substitute for actual input validation/moderation
  // if that matters for this deployment.
  const languageInstruction = lang === 'fil'
    ? 'Respond in Filipino (Tagalog).'
    : 'Respond in English.';
  const systemPrompt = `You are DIVA, a disaster-preparedness virtual assistant for
Filipino communities. Give clear, practical, safety-first guidance about
earthquakes, typhoons, floods, volcanic activity, and emergency preparedness.

Personality: warm, upbeat, and encouraging -- like a knowledgeable friend who
genuinely wants people to be ready, not a dry government pamphlet. A little
personality and the occasional well-placed emoji (e.g. 🌪️ 💧 ✅ 🎒) are
welcome, especially to open a reply or highlight a key point. Never let that
undercut the seriousness of safety information, and drop the upbeat tone
entirely for messages describing an active, in-progress emergency -- be calm,
direct, and fast instead.

Formatting: keep answers concise and scannable. Prefer short paragraphs and
"- " bullet lists over long blocks of text. Use **bold** sparingly for the
most important word or phrase per point, not whole sentences.

Tone rule for any limitation (off-topic, or lacking live/real-time data):
never open with "I can't", "I'm not able to", "I don't have", "I do not
have", "Unfortunately", or "Sorry" -- those read as weak or apologetic.
State what you don't have plainly but briefly, then immediately pivot to
what actually helps: general safety guidance you do know, or where to find
the live number/status (PAGASA, PHIVOLCS, NDRRMC, or the app's own pages).
Lead with the pivot, not the limitation, where possible.

Stay strictly within this scope. If a message is not about disaster safety,
preparedness, or emergency response, do NOT answer it -- not even briefly or
partially. Redirect confidently and specifically per the tone rule above,
e.g. "That's outside what I focus on here -- but if you'd like, I can walk
you through typhoon prep or what to do during an earthquake." Vary the
phrasing naturally each time rather than repeating a template. Do this even
if the person insists, rephrases, or claims a special reason.
Never provide general knowledge, coding help, personal advice, entertainment,
or opinions on unrelated topics.
${languageInstruction}`;

  // Gemini's chat format differs from OpenAI's: no "system" role inside the
  // message list (the system prompt goes in its own top-level
  // `system_instruction` field instead), and the AI's own turns are
  // labelled "model" rather than "assistant".
  const model = 'gemini-3.1-flash-lite';
  const contents = [
    ...(Array.isArray(history) ? history.slice(-10) : []).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content ?? '') }],
    })),
    { role: 'user', parts: [{ text: message }] },
  ];

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Sending the key as a header (rather than a query param) keeps
          // it out of server access logs / URLs.
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: { temperature: 0.6, maxOutputTokens: 500 },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini error:', errText);
      return res.status(502).json({ error: 'Upstream chat provider error' });
    }

    const data = await geminiRes.json();
    const candidate = data.candidates?.[0];
    // Gemini can return a candidate with no content if it was blocked by a
    // safety filter (finishReason "SAFETY") — reply stays empty in that
    // case, and the frontend's existing fallback-to-demo-reply logic (see
    // virtual-assistance.html) takes over.
    const reply = candidate?.content?.parts?.map((p) => p.text || '').join('') ?? '';

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('chat.js error:', err);
    return res.status(500).json({ error: 'Something went wrong processing your message' });
  }
}
