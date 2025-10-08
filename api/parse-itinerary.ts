import type { VercelRequest, VercelResponse } from '@vercel/node';

const API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.LLM_MODEL || 'gemini-2.5-flash';
const V1 = 'https://generativelanguage.googleapis.com/v1';

async function v1Generate(userTexts: string[]) {
  const payload = {
    contents: userTexts.map((t) => ({ role: 'user', parts: [{ text: t }] })),
    generationConfig: { temperature: 0.2, topP: 0.95, topK: 40, maxOutputTokens: 2048 },
  };

  const r = await fetch(`${V1}/models/${MODEL}:generateContent?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });

  const txt = await r.text();
  if (!r.ok) throw new Error(`generateContent ${MODEL} -> ${r.status} ${txt}`);

  const data = JSON.parse(txt);
  return (
    data?.candidates?.[0]?.content?.parts?.[0]?.text ??
    data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('\n') ??
    ''
  );
}

const SYSTEM_INLINE = `
You are a planner that must return STRICT JSON only (no prose).
Schema:
{
  "origin_hint": "current location" | "home" | "address",
  "origin_value": string|null,
  "stops": string[],
  "finish_hint": "none" | "address" | "place_query",
  "finish_value": string|null,
  "constraints": [ [number, number], ... ]
}
Rules:
- "stops" keep the order from the user text.
- If a final destination is implied, set finish_*; else finish_hint="none", finish_value=null.
- Output ONLY the JSON object.
`;

function extractJson(text: string): any {
  try { return JSON.parse(text); }
  catch {
    const m = text.match(/\{[\s\S]*\}$/m);
    if (m) return JSON.parse(m[0]);
    throw new Error('LLM returned non-JSON');
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
    const { text } = (req.body || {}) as { text?: string };
    if (!text || typeof text !== 'string') return res.status(400).json({ ok: false, error: 'missing text' });

    const firstMsg =
      SYSTEM_INLINE.trim() +
      `

User request:
"""${text}"""

Return ONLY the JSON object.`;

    const raw = await v1Generate([firstMsg]);
    const plan = extractJson(raw);
    if (!Array.isArray(plan.stops)) plan.stops = [];
    if (!Array.isArray(plan.constraints)) plan.constraints = [];

    res.status(200).json({ ok: true, plan, model: MODEL });
  } catch (e: any) {
    console.error('[parse-itinerary] error:', e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || 'server error' });
  }
}
