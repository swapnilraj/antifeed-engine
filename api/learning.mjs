// Cross-device state for adaptive learning cards. The wall records only whether
// a retrieval attempt was correct, not free-text answers. Scheduling remains a
// transparent client-side rule defined by data/learning.js.
//
// State shape: { attempts: [{ track, concept, question, correct, at }], updatedAt }
//   GET                   → current attempts
//   POST { attempts: [] } → merge new attempts (track + concept + timestamp id)
import { put, get } from "@vercel/blob";

const KEY = "wall-learning.json";
const EMPTY = () => ({ attempts: [], updatedAt: null });

async function load() {
  try {
    const response = await get(KEY, { access: "private", useCache: false });
    if (!response || response.statusCode !== 200) return EMPTY();
    const state = JSON.parse(await new Response(response.stream).text());
    return { attempts: Array.isArray(state.attempts) ? state.attempts.map(clean).filter(Boolean) : [], updatedAt: state.updatedAt || null };
  } catch {
    return EMPTY();
  }
}

const save = state => put(KEY, JSON.stringify(state), {
  access: "private", addRandomSuffix: false, allowOverwrite: true,
  contentType: "application/json",
});

const shortId = value => typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/i.test(value);
const isISO = value => typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));

function clean(attempt) {
  if (!attempt || typeof attempt !== "object" || !shortId(attempt.track) || !shortId(attempt.concept) ||
      !Number.isInteger(attempt.question) || attempt.question < 0 || typeof attempt.correct !== "boolean" || !isISO(attempt.at))
    return null;
  return {
    track: attempt.track,
    concept: attempt.concept,
    question: attempt.question,
    correct: attempt.correct,
    at: attempt.at,
  };
}

const keyOf = attempt => `${attempt.track}\u0000${attempt.concept}\u0000${attempt.at}`;

export default async function handler(req, res) {
  const state = await load();
  if (req.method === "GET") return res.status(200).json(state);

  if (req.method === "POST") {
    const incoming = Array.isArray(req.body?.attempts) ? req.body.attempts.map(clean).filter(Boolean) : null;
    if (!incoming) return res.status(400).json({ error: "expected { attempts: [] }" });
    const merged = new Map(state.attempts.map(attempt => [keyOf(attempt), attempt]));
    for (const attempt of incoming) merged.set(keyOf(attempt), attempt);
    state.attempts = [...merged.values()].sort((a, b) => a.at.localeCompare(b.at));
    state.updatedAt = new Date().toISOString();
    await save(state);
    return res.status(200).json(state);
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "method not allowed" });
}
