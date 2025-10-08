import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const API_KEY = process.env.GEMINI_API_KEY || "";
const PORT = Number(process.env.PORT || 5175);

// ---------- v1 REST helpers ----------
const V1 = "https://generativelanguage.googleapis.com/v1";

async function v1ListModels(): Promise<any> {
  const r = await fetch(`${V1}/models?key=${API_KEY}`);
  if (!r.ok) throw new Error(`models list failed: ${r.status} ${await r.text()}`);
  return r.json();
}

/**
 * Call v1 generateContent.
 * NOTE: requests must use role "user" only (no "system" role, no systemInstruction).
 */
async function v1Generate(
  model: string,
  userTexts: string[], // one or more user messages
) {
  const payload = {
    contents: userTexts.map((t) => ({ role: "user", parts: [{ text: t }] })),
    generationConfig: {
      // Keep minimal; 2.x/2.5 v1 REST is picky.
      temperature: 0.2,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 2048,
    },
  };

  const r = await fetch(
    `${V1}/models/${model}:generateContent?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  const txt = await r.text();
  if (!r.ok) throw new Error(`generateContent ${model} -> ${r.status} ${txt}`);

  const data = JSON.parse(txt);
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ??
    data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("\n") ??
    "";

  return text ?? "";
}

// ---------- Model selection ----------
const MODEL_CANDIDATES = [
  process.env.LLM_MODEL || "",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash-lite",
  "gemini-2.5-flash-lite",
].filter(Boolean);

let SELECTED_MODEL = "";

async function pickWorkingModel(): Promise<string> {
  if (SELECTED_MODEL) return SELECTED_MODEL;

  let available: string[] = [];
  try {
    const ml = await v1ListModels();
    available = (ml?.models || []).map((m: any) =>
      m.name?.replace("models/", "")
    );
  } catch (e) {
    console.warn("Could not list models from v1:", (e as Error).message);
  }

  for (const m of MODEL_CANDIDATES) {
    if (available.length && !available.includes(m)) {
      console.log(`Skip ${m} (not in /v1/models list)`);
      continue;
    }
    try {
      const t = await v1Generate(m, ["ping"]); // single user message
      if (typeof t === "string") {
        SELECTED_MODEL = m;
        console.log(`✅ Using v1 model: ${m}`);
        return m;
      }
    } catch (e: any) {
      console.log(`Probe failed for ${m} -> ${e.message}`);
    }
  }
  throw new Error("No compatible Gemini v1 model found for this API key/project.");
}

// ---------- Routes ----------
app.get("/", (_req, res) => {
  res
    .type("text/plain")
    .send("OptiPath Gemini API (v1). Try /health, /models-list");
});

app.get("/health", async (_req, res) => {
  try {
    const model = await pickWorkingModel();
    res.json({ ok: true, model });
  } catch (e: any) {
    res.json({ ok: false, error: e.message });
  }
});

app.get("/models-list", async (_req, res) => {
  try {
    const models = await v1ListModels();
    res.json(models);
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Instruction we’ll inline as the first "user" message
const SYSTEM_INLINE = `
You are a planner that must return STRICT JSON only (no prose, no code fences).
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
- "stops" is the ordered list from the user's sentence.
- If a final destination is implied, set finish_*; else finish_hint="none" and finish_value=null.
- Output nothing outside the JSON object.
`;

// JSON recovery helper
function extractJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}$/m);
    if (m) return JSON.parse(m[0]);
    throw new Error("LLM returned non-JSON");
  }
}

app.post("/chat/parse-itinerary", async (req, res) => {
  try {
    const { text } = req.body as { text?: string };
    if (!text || typeof text !== "string")
      return res.status(400).json({ ok: false, error: "missing text" });

    const model = await pickWorkingModel();

    // Inline the "system" instruction as the first user message.
    const firstMsg =
      SYSTEM_INLINE.trim() +
      `

User request:
"""${text}"""

Return ONLY the JSON object.`;

    const raw = await v1Generate(model, [firstMsg]);
    const json = extractJson(raw);
    if (!Array.isArray(json.stops)) json.stops = [];
    if (!Array.isArray(json.constraints)) json.constraints = [];

    res.json({ ok: true, plan: json, model });
  } catch (e: any) {
    console.error("[/chat/parse-itinerary] error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () =>
  console.log(`✅ Gemini API (v1) listening at http://localhost:${PORT}`)
);
