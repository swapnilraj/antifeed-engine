// Read-state sync for the wall. Sits behind the same auth as the wall
// (middleware.js matches every path — Basic Auth for the browser, Bearer
// WALL_SYNC_TOKEN for the sweep), stores one small JSON blob in the project's
// PRIVATE Vercel Blob store (wall-reads).
//
// Why this exists: wall-read-tracker.js measures settled, focused dwell on each
// card and marks it "read". That was localStorage-only, so the sweep could grade
// itself on what it KEPT but never on what actually got READ. This endpoint lets
// the read set follow across devices AND lets the sweep report read-vs-kept —
// the only signal that answers "is the wall actually being looked at?".
//
// The first-read time is also the archive clock: a card cannot leave the live
// wall until that timestamp is at least five full days old. Keep every entry;
// dropping old timestamps could strand or incorrectly classify cards.
//
// State shape: { reads: { "<item id>": "<ISO first-read>" }, updatedAt: ISO|null }
//
//   GET                          → current state (devices merge this on load)
//   POST { reads: { id: ISO } }  → merge a batch of newly-read ids (earliest
//                                  read wins per id).
//
// This is durable lifecycle state, not a work queue: unlike feedback there is
// nothing to mark processed or clear.
import { put, get } from "@vercel/blob";

const KEY = "wall-reads.json";
const EMPTY = () => ({ reads: {}, updatedAt: null });

async function load() {
  try {
    const r = await get(KEY, { access: "private", useCache: false });
    if (!r || r.statusCode !== 200) return EMPTY();
    const state = JSON.parse(await new Response(r.stream).text());
    return { reads: state.reads || {}, updatedAt: state.updatedAt || null };
  } catch {
    return EMPTY(); // first run: blob doesn't exist yet
  }
}

const save = state => put(KEY, JSON.stringify(state), {
  access: "private", addRandomSuffix: false, allowOverwrite: true,
  contentType: "application/json",
});

const isISO = v => typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v);

export default async function handler(req, res) {
  const state = await load();

  if (req.method === "GET") return res.status(200).json(state);

  if (req.method === "POST") {
    const body = req.body || {};
    if (body.reads && typeof body.reads === "object" && !Array.isArray(body.reads)) {
      for (const [id, at] of Object.entries(body.reads)) {
        if (typeof id !== "string" || !id || !isISO(at)) continue;
        const prev = state.reads[id];
        if (!prev || at < prev) state.reads[id] = at; // earliest read wins
      }
      state.updatedAt = new Date().toISOString();
      await save(state);
      return res.status(200).json({ ok: true, count: Object.keys(state.reads).length });
    }
    return res.status(400).json({ error: "expected { reads: { id: ISO } }" });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "method not allowed" });
}
