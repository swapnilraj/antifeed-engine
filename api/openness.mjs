// Durable, private state for the six-week Openness Mode experiment.
// The endpoint is protected by the wall's existing Basic/Bearer auth middleware.
import { put, get } from "@vercel/blob";
import model from "../web/wall-openness-model.js";

const KEY = "wall-openness.json";
const EMPTY = () => ({ entries: {}, updatedAt: null });

async function load() {
  try {
    const response = await get(KEY, { access: "private", useCache: false });
    if (!response || response.statusCode !== 200) return EMPTY();
    const raw = JSON.parse(await new Response(response.stream).text());
    return { entries: model.mergeEntries(raw.entries), updatedAt: raw.updatedAt || null };
  } catch {
    return EMPTY();
  }
}

const save = state => put(KEY, JSON.stringify(state), {
  access: "private", addRandomSuffix: false, allowOverwrite: true,
  contentType: "application/json",
});

export default async function handler(req, res) {
  const state = await load();
  if (req.method === "GET") return res.status(200).json(state);
  if (req.method === "POST") {
    const incoming = req.body?.entries;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming))
      return res.status(400).json({ error: "expected { entries: { ... } }" });
    if (Object.keys(incoming).length > 100)
      return res.status(413).json({ error: "at most 100 entries per request" });
    state.entries = model.mergeEntries(state.entries, incoming);
    state.updatedAt = new Date().toISOString();
    await save(state);
    return res.status(200).json(state);
  }
  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "method not allowed" });
}
