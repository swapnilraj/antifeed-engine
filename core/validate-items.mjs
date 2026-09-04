#!/usr/bin/env node
// Schema guard for data/items.js. Keeps items in shape no matter who (or what
// LLM) writes them. Dependency-free, Node >= 22.
//
//   node core/validate-items.mjs            validate data/items.js, print a report
//   node core/validate-items.mjs <file>     validate another items file
//
// Exits 0 if clean (warnings allowed), 1 if any ERROR. build-site.mjs imports
// validate()/loadItems() and refuses to build on errors, so bad data can't ship.
//
// schema.mjs is the single source of truth for item fields and source values.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { existsSync, realpathSync } from "node:fs";
import { ITEM_SCHEMA as SCHEMA, SOURCES, isString as isStr } from "./schema.mjs";
import { instancePath } from "./paths.mjs";
export { SOURCES } from "./schema.mjs";

// Render a received value compactly for error messages: shows type + value so
// the writer can see what they actually passed (e.g. a number where a string was wanted).
function got(v) {
  const type = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
  let shown;
  try { shown = JSON.stringify(v); } catch { shown = String(v); }
  if (shown === undefined) shown = String(v);
  if (shown.length > 80) shown = shown.slice(0, 77) + "…";
  return `got ${type} ${shown}`;
}

// Suggest the closest real field name for an unknown one (typo help).
function nearestField(name) {
  const dist = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  let best = null, bestD = Infinity;
  for (const f of Object.keys(SCHEMA)) {
    const d = dist(name.toLowerCase(), f.toLowerCase());
    if (d < bestD) { bestD = d; best = f; }
  }
  return bestD <= 3 ? best : null; // only suggest when reasonably close
}

// Validate an array of items. Returns { errors, warnings } — arrays of strings.
export function validate(items) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(items))
    return { errors: [`window.WALL_ITEMS must be an array of item objects — ${got(items)}. The file should read: window.WALL_ITEMS = [ { …item… }, … ];`], warnings };

  const seenIds = new Map();

  items.forEach((item, i) => {
    const ref = `item ${i}` + (item && isStr(item.id) ? ` (id "${item.id}")` : "");
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      errors.push(`${ref}: each item must be an object with fields like id/url/source/author/text/category/postedAt — ${got(item)}.`);
      return;
    }

    // missing required fields — say what the field is and give a value to copy
    for (const [field, spec] of Object.entries(SCHEMA)) {
      if (spec.required && !(field in item))
        errors.push(`${ref}: missing required field "${field}" — ${spec.desc}. Add it, e.g. ${field}: ${JSON.stringify(spec.example)}`);
    }

    // unknown fields — likely a typo; point at the intended field
    for (const field of Object.keys(item)) {
      if (field in SCHEMA) continue;
      const near = nearestField(field);
      errors.push(`${ref}: unknown field "${field}" (${got(item[field])}) is not in the schema. ` +
        (near ? `Did you mean "${near}"? ` : "") +
        `Fix the name, remove it, or — if the field is genuinely new — add it to validate-items.mjs and the schema doc in data/items.js.`);
    }

    // wrong type/shape on a present field — show the reason, the bad value, and a fix
    for (const [field, spec] of Object.entries(SCHEMA)) {
      if (!(field in item)) continue;
      const msg = spec.check(item[field]);
      if (msg) errors.push(`${ref}: field "${field}" ${msg} — ${got(item[field])}. It should be ${spec.desc}; example: ${JSON.stringify(spec.example)}`);
    }

    // FT cards must link through archive.ph, never ft.com directly. Swapnil reads FT
    // only via archive.ph for privacy, and a card click must not touch FT's servers.
    // Enforced here (not left to whoever writes the card) so a direct ft.com link
    // can never ship — this gate also covers `wall.mjs prepend` and the build.
    if (item.source === "ft" && isStr(item.url) && !/^https:\/\/archive\.ph\//i.test(item.url))
      errors.push(`${ref}: an "ft" card's "url" must go through archive.ph for privacy, not ft.com directly — ${got(item.url)}. Use "https://archive.ph/newest/https://www.ft.com/content/…".`);

    // duplicate id
    if (isStr(item.id)) {
      if (seenIds.has(item.id))
        errors.push(`${ref}: duplicate id — item ${seenIds.get(item.id)} already uses "${item.id}". Each item needs a unique id (it's the dedupe key); derive it from this post's URL.`);
      else seenIds.set(item.id, i);
    }

    // ---- soft warnings (won't block the build) ----
    // score/why/via travel together
    const rank = ["score", "why", "via"].filter(f => f in item);
    if (rank.length > 0 && rank.length < 3)
      warnings.push(`${ref}: has ${rank.join("+")} but not all of score+why+via — algorithm-collected items should carry the whole ranking triad (add ${["score", "why", "via"].filter(f => !(f in item)).join(", ")}).`);

    // Kept reels must play inline. A reel with no `video` falls back to a cover
    // that just links out to Instagram (with a ▶ badge implying play) — a defect,
    // not a default. Localize it: `node wall.mjs localize-video <id>`.
    if (item.kind === "reel" && !item.video)
      warnings.push(`${ref}: reel has no "video" — it will link out to Instagram instead of playing inline. Run \`node wall.mjs localize-video ${item.id}\` with the gate open (see docs/reels.md), or drop the card if the mp4 can't be fetched.`);
  });

  // NB: no ordering check. "Newest first" means newest-COLLECTED (prepend order),
  // not newest postedAt — a months-old post collected today sits at the top. That
  // invariant isn't recoverable from the data, so validating it would only misfire.

  return { errors, warnings };
}

// Load window.WALL_ITEMS from an items.js file (it's a browser script, not a module).
const DEFAULT_ITEMS = instancePath("data", "items.js");
export function loadItems(file = DEFAULT_ITEMS) {
  const require = createRequire(import.meta.url);
  globalThis.window = {};
  const resolved = require.resolve(file);
  delete require.cache[resolved];
  require(resolved);
  return globalThis.window.WALL_ITEMS || [];
}

// Print a human report. Returns true if clean (no errors).
export function report(items, label = "data/items.js") {
  const { errors, warnings } = validate(items);
  console.log(`Validating ${label} — ${Array.isArray(items) ? items.length : "?"} items\n`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  for (const e of errors)   console.log(`  ✗ ${e}`);
  if (errors.length || warnings.length) console.log("");
  console.log(`${errors.length} error${errors.length === 1 ? "" : "s"}, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` +
    (errors.length ? "" : " — schema OK"));
  return errors.length === 0;
}

// CLI entry (only when run directly, not when imported by build-site.mjs)
const isMain = process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const file = process.argv[2] ? realpathSync(process.argv[2]) : DEFAULT_ITEMS;
  const label = process.argv[2] || "data/items.js";
  const ok = report(loadItems(file), label);
  process.exit(ok ? 0 : 1);
}
