// /api/chat.js
// Serverless function (Vercel Node.js runtime). Proxies chat messages to
// Google's Gemini API so the API key stays server-side. Called from
// virtual-assistance.html instead of the current localStorage-only
// simulation.
//
// Uses the free-tier-eligible Gemini 2.5 Flash model. Free tier is rate
// limited (roughly 10 requests/min, 250/day per Google Cloud project as of
// 2026) — fine for demo/low traffic, but worth watching if usage grows.

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
  // in the frontend's demo mode).
  const languageInstruction = lang === 'fil'
    ? 'Respond in Filipino (Tagalog).'
    : 'Respond in English.';
  const systemPrompt = `You are DIVA, a disaster-preparedness virtual assistant for
Filipino communities. Give clear, practical, safety-first guidance about
earthquakes, typhoons, floods, volcanic activity, and emergency preparedness.
Keep answers concise and actionable. If asked something unrelated to
disaster safety, gently redirect to how you can help with that instead.
${languageInstruction}`;

  // Gemini's chat format differs from OpenAI's: no "system" role inside the
  // message list (the system prompt goes in its own top-level
  // `system_instruction` field instead), and the AI's own turns are
  // labelled "model" rather than "assistant".
  const model = 'gemini-2.5-flash';
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
          generationConfig: { temperature: 0.4, maxOutputTokens: 500 },
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
