// Read-timing telemetry for the wall. Same auth as everything else
// (middleware.js: Basic Auth for the browser, Bearer WALL_SYNC_TOKEN for the
// sweep), stores one small JSON blob in the project's PRIVATE Vercel Blob store.
//
// Why this exists: /api/reads records WHICH cards were read (id → first-read
// date) so the sweep can grade read-vs-kept. This endpoint records HOW LONG a
// card took to read, alongside the card's features (word count, source,
// category, whether it has an image, its score). With enough rows we can stop
// guessing the dwell threshold in wall-read-tracker.js (currently ~90ms/word)
// and fit it to Swapnil's actual reading speed and what actually slows him down.
//
// Each event row: { id, ms, words, src, cat, img, score, by, at }
//   ms    measured focused dwell in milliseconds (real reading time)
//   words text + note word count
//   img   1 if the card carries an image, else 0
//   by    "read-button" (✓ tap — true end-of-reading time) | "dwell" (auto-marked
//         at threshold, so ms ≈ threshold: censored) | "engage" (share/±/ask/
//         note/play committed the read; ms may undershoot true reading time)
//         A dwell auto-mark keeps the card's clock running, so one id may carry
//         both a dwell row and a later read-button row with the true longer time:
//         per id, read-button supersedes dwell when fitting.
//   at    ISO timestamp the read committed
//
// State shape: { events: [ …row ], updatedAt: ISO|null }
//
//   GET                            → current state (for the sweep / analysis)
//   POST { events: [ …row ] }      → append a batch; store capped to newest N.
//
// Append-only cumulative telemetry — nothing to process or prune.
import { put, get } from "@vercel/blob";

const KEY = "wall-read-events.json";
const CAP = 4000; // keep the newest N events; plenty for a finite personal wall
const EMPTY = () => ({ events: [], updatedAt: null });

async function load() {
  try {
    const r = await get(KEY, { access: "private", useCache: false });
    if (!r || r.statusCode !== 200) return EMPTY();
    const state = JSON.parse(await new Response(r.stream).text());
    return { events: Array.isArray(state.events) ? state.events : [], updatedAt: state.updatedAt || null };
  } catch {
    return EMPTY(); // first run: blob doesn't exist yet
  }
}

const save = state => put(KEY, JSON.stringify(state), {
  access: "private", addRandomSuffix: false, allowOverwrite: true,
  contentType: "application/json",
});

const isISO = v => typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v);
const num = v => (typeof v === "number" && Number.isFinite(v)) ? v : null;

// Keep only the fields we defined, coerced to safe types; drop anything malformed.
function clean(row) {
  if (!row || typeof row !== "object" || typeof row.id !== "string" || !row.id) return null;
  const ms = num(row.ms);
  if (ms == null || ms < 0) return null;
  const at = isISO(row.at) ? row.at : new Date().toISOString();
  return {
    id: row.id,
    ms: Math.round(ms),
    words: num(row.words) ?? 0,
    src: typeof row.src === "string" ? row.src.slice(0, 40) : "",
    cat: typeof row.cat === "string" ? row.cat.slice(0, 40) : "",
    img: row.img ? 1 : 0,
    score: num(row.score),
    by: ["read-button", "engage", "dwell"].includes(row.by) ? row.by : "dwell",
    at,
  };
}

export default async function handler(req, res) {
  const state = await load();

  if (req.method === "GET") return res.status(200).json(state);

  if (req.method === "POST") {
    const body = req.body || {};
    const incoming = Array.isArray(body.events) ? body.events : null;
    if (!incoming) return res.status(400).json({ error: "expected { events: [ … ] }" });
    const rows = incoming.map(clean).filter(Boolean);
    if (rows.length) {
      state.events.push(...rows);
      if (state.events.length > CAP) state.events = state.events.slice(-CAP);
      state.updatedAt = new Date().toISOString();
      await save(state);
    }
    return res.status(200).json({ ok: true, added: rows.length, total: state.events.length });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "method not allowed" });
}
