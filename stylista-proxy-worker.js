// Stylista AI Proxy — Cloudflare Worker (token di accesso + rate limiting per token+IP)
// Segreti: GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, ACCESS_TOKEN. Opzionale: KV binding RATE_KV.
const CORS = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Stylista-Token'};
const RATE_LIMIT_PER_HOUR = 30;
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') return new Response('Metodo non consentito', { status: 405, headers: CORS });
    const token = request.headers.get('X-Stylista-Token') || '';
    const expected = env.ACCESS_TOKEN || '';
    if (!expected || token !== expected) return json({ error: 'Token di accesso non valido o mancante.' }, 401);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const tokenHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)).then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2,'0')).join(''));
    const key = 'rl:' + tokenHash + ':' + ip;
    let count = 0;
    if (env.RATE_KV) {
      const raw = await env.RATE_KV.get(key);
      count = raw ? parseInt(raw, 10) : 0;
      if (count >= RATE_LIMIT_PER_HOUR) return json({ error: 'Limite di richieste raggiunto per questa ora. Riprova più tardi.' }, 429);
      await env.RATE_KV.put(key, String(count + 1), { expirationTtl: 3600 });
    } else {
      globalThis.__rate = globalThis.__rate || {};
      count = globalThis.__rate[key] || 0;
      if (count >= RATE_LIMIT_PER_HOUR) return json({ error: 'Limite di richieste raggiunto per questa ora. Riprova più tardi.' }, 429);
      globalThis.__rate[key] = count + 1;
    }
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'JSON non valido' }, 400); }
    if (!String(body.prompt || '')) return json({ error: 'Prompt mancante' }, 400);
    try {
      if (body.provider === 'gemini') return json(await callGemini(env, body));
      if (body.provider === 'groq' || body.provider === 'openrouter') return json(await callOpenAICompatible(env, body, body.provider));
      return json({ error: 'Provider non supportato' }, 400);
    } catch (e) { return json({ error: String(e && e.message ? e.message : e) }, 502); }
  },
};
function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } }); }
async function callGemini(env, body) {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY non configurata sul proxy');
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: body.prompt }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 2048 } }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || ('Gemini HTTP ' + res.status));
  const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts || [];
  return { answer: parts.map(p => p.text || '').join('') };
}
async function callOpenAICompatible(env, body, provider) {
  const key = provider === 'groq' ? env.GROQ_API_KEY : env.OPENROUTER_API_KEY;
  if (!key) throw new Error((provider === 'groq' ? 'GROQ_API_KEY' : 'OPENROUTER_API_KEY') + ' non configurata sul proxy');
  const url = provider === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
  const model = provider === 'groq' ? 'llama-3.3-70b-versatile' : 'openrouter/auto';
  const messages = [];
  if (body.systemPrompt) messages.push({ role: 'system', content: body.systemPrompt });
  messages.push({ role: 'user', content: body.prompt });
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 2048 }) });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || (provider + ' HTTP ' + res.status));
  return { answer: data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '' };
}
