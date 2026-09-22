// Reference AI endpoint for FocusSpace's learning companion.
//
// The extension never contains an API key. Run this on your machine or server;
// it keeps the key in an environment variable and forwards only the compact
// context of the current moment (title, timestamp, concept outline, a short
// transcript excerpt, your question) to OpenAI.
//
//   OPENAI_API_KEY=sk-... node scripts/ai-endpoint/server.mjs
//   → FocusSpace Settings → Learning companion → My endpoint → http://127.0.0.1:8787/v1/moment
//
// Env: PORT (8787), HOST (127.0.0.1), OPENAI_MODEL (gpt-4o-mini), MAX_TOKENS (700).
//
// The FocusSpace endpoint contract is unchanged by which upstream this forwards
// to: POST { prompt: { system, user }, ... } in, { answer: string } out. The
// extension has no idea OpenAI is involved — see docs/V5_CONTRACT.md §F.
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 700);
const KEY = process.env.OPENAI_API_KEY;
const MAX_BODY = 64 * 1024;

if (!KEY) {
  console.error('Set OPENAI_API_KEY (it stays on this server, never in the extension).');
  process.exit(1);
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function send(res, status, body) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end();
  if (req.method !== 'POST' || req.url !== '/v1/moment') return send(res, 404, { error: 'POST /v1/moment' });
  try {
    const body = await readJson(req);
    const system = body?.prompt?.system;
    const user = body?.prompt?.user;
    if (typeof system !== 'string' || typeof user !== 'string' || user.length > 20_000) return send(res, 400, { error: 'Expected { prompt: { system, user } }' });

    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    const json = await upstream.json();
    if (!upstream.ok) return send(res, 502, { error: json?.error?.message ?? `Upstream HTTP ${upstream.status}` });
    const answer = (json.choices ?? []).map((c) => c?.message?.content ?? '').join('\n').trim();
    return send(res, 200, { answer });
  } catch (err) {
    return send(res, err.status ?? 500, { error: err.message });
  }
}).listen(PORT, HOST, () => console.log(`FocusSpace AI endpoint on http://${HOST}:${PORT}/v1/moment (model ${MODEL})`));
