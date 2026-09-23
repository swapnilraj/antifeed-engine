// Feedback sync for the wall's ＋/－ signals. Sits behind the same Basic Auth
// as the wall (middleware.js matches every path, /api included), stores one
// small JSON blob in the project's PRIVATE Vercel Blob store (wall-feedback).
//
// State shape: { signals: { "<item id>":       { dir: "more"|"less", at: ISO },
//                           "<item id>#note":  { kind: "note", text, at: ISO },
//                           "<item id>#shelf": { kind: "shelf", life: "evergreen"|"stale", at: ISO },
//                           "<any key>":       { removed: true, at: ISO } },
//                processedAt: ISO|null }
//
//   GET                        → current state (devices merge this on load/focus)
//   POST { signals }           → MERGE the pushed store, newest `at` wins per key.
//                                Merge (not replace) so two devices pushing in the
//                                same window can't clobber each other's taps.
//                                Deletions travel as { removed: true } tombstones
//                                (a toggled-off tap, a cleared note, the "clear"
//                                button), so removal syncs without a replace.
//   POST { processedAt: ISO }  → Claude calls this after folding signals into
//                                algorithm/interests.md; anything at<=processedAt
//                                (tombstones included) is pruned here and
//                                auto-clears on devices.
import { put, get } from "@vercel/blob";

const KEY = "wall-feedback.json";
const EMPTY = () => ({ signals: {}, processedAt: null });

async function load() {
  try {
    const r = await get(KEY, { access: "private", useCache: false });
    if (!r || r.statusCode !== 200) return EMPTY();
    const state = JSON.parse(await new Response(r.stream).text());
    return { signals: state.signals || {}, processedAt: state.processedAt || null };
  } catch {
    return EMPTY(); // first run: blob doesn't exist yet
  }
}

const save = state => put(KEY, JSON.stringify(state), {
  access: "private", addRandomSuffix: false, allowOverwrite: true,
  contentType: "application/json",
});

function prune(state) {
  if (!state.processedAt) return state;
  for (const [id, f] of Object.entries(state.signals))
    if (!f?.at || f.at <= state.processedAt) delete state.signals[id];
  return state;
}

// Four signal shapes: a ± tap { dir, at } (keyed by item id), a free-text
// note { kind:"note", text, at } (keyed "<item id>#note"), a shelf-life
// correction { kind:"shelf", life:"evergreen"|"stale", at } (keyed
// "<item id>#shelf"), and a deletion tombstone { removed: true, at }. Notes are
// Swapnil's plain-language tuning instructions, actioned by Claude into
// algorithm/; sweeps IGNORE tombstones.
const validSignal = f => f && typeof f.at === "string" &&
  (f.dir === "more" || f.dir === "less" || f.removed === true ||
   (f.kind === "note" && typeof f.text === "string" && f.text.trim().length > 0) ||
   (f.kind === "shelf" && (f.life === "evergreen" || f.life === "stale")));

const storedShape = f => f.removed === true
  ? { removed: true, at: f.at }
  : f.kind === "note"
    ? { kind: "note", text: String(f.text).slice(0, 500), at: f.at }
    : f.kind === "shelf"
      ? { kind: "shelf", life: f.life, at: f.at }
      : { dir: f.dir, at: f.at };

export default async function handler(req, res) {
  const state = prune(await load());

  if (req.method === "GET") return res.status(200).json(state);

  if (req.method === "POST") {
    const body = req.body || {};

    if (typeof body.processedAt === "string") {
      state.processedAt = body.processedAt;
      prune(state);
      await save(state);
      return res.status(200).json(state);
    }

    if (body.signals && typeof body.signals === "object" && !Array.isArray(body.signals)) {
      for (const [id, f] of Object.entries(body.signals)) {
        if (!validSignal(f)) continue;
        if (state.processedAt && f.at <= state.processedAt) continue; // already handled
        const prev = state.signals[id];
        if (!prev || f.at > prev.at) state.signals[id] = storedShape(f);
      }
      await save(state);
      return res.status(200).json(state);
    }

    return res.status(400).json({ error: "expected { signals } or { processedAt }" });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "method not allowed" });
}
