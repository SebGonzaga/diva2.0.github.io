// /api/chat.js
// Serverless function (Vercel Node.js runtime). Proxies chat messages to
// OpenAI so the API key stays server-side. Called from virtual-assistance.html
// instead of the current localStorage-only simulation.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, history } = req.body || {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Missing "message" string in request body' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server misconfigured: OPENAI_API_KEY not set' });
  }

  // Keep the assistant scoped to disaster-preparedness topics, matching
  // DIVA's purpose (see demo-data.js aiReplies for the tone/format used
  // in the frontend's demo mode).
  const systemPrompt = `You are DIVA, a disaster-preparedness virtual assistant for
Filipino communities. Give clear, practical, safety-first guidance about
earthquakes, typhoons, floods, volcanic activity, and emergency preparedness.
Keep answers concise and actionable. If asked something unrelated to
disaster safety, gently redirect to how you can help with that instead.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...(Array.isArray(history) ? history.slice(-10) : []),
    { role: 'user', content: message },
  ];

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.4,
        max_tokens: 500,
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error('OpenAI error:', errText);
      return res.status(502).json({ error: 'Upstream chat provider error' });
    }

    const data = await openaiRes.json();
    const reply = data.choices?.[0]?.message?.content ?? '';

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('chat.js error:', err);
    return res.status(500).json({ error: 'Something went wrong processing your message' });
  }
}
