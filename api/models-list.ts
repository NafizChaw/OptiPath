import type { VercelRequest, VercelResponse } from '@vercel/node';
const V1 = 'https://generativelanguage.googleapis.com/v1';
const KEY = process.env.GEMINI_API_KEY || '';
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const r = await fetch(`${V1}/models?key=${KEY}`);
    res.status(r.ok ? 200 : r.status).send(await r.text());
  } catch (e: any) { res.status(500).json({ ok:false, error:e?.message || 'models error' }); }
}
