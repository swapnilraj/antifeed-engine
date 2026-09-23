#!/usr/bin/env node
// The single write path for data/items.js: load → modify item objects → save.
// Scripts must mutate cards as data and save through here, never edit the
// file's text (string surgery on items.js was a recurring fragility class).
//
// Serialization is canonical — the same header + JSON.stringify(items, null, 2)
// that archive-items.mjs always used — so a load→save round-trip is
// byte-identical and diffs stay minimal. Every save re-validates against the
// schema and refuses to write invalid data.
//
//   import { loadItems, saveItems, updateItems } from "./core/items-store.mjs"
//
// CLI (the sweep's prepend step):
//   node core/items-store.mjs prepend <cards.json>   validate + prepend new cards
import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadItems, validate } from "./validate-items.mjs";
import { instancePath } from "./paths.mjs";
import { loadShelfConfig } from "./shelf-config.mjs";
export { loadItems } from "./validate-items.mjs";

const ITEMS_FILE = instancePath("data", "items.js");
const HEADER = `// Active wall cards, newest collected first. Complete older history lives in\n` +
  `// data/archive/YYYY-MM.json. Validate with: npm run validate\n`;

export function serializeItems(items) {
  return HEADER + `window.WALL_ITEMS = ${JSON.stringify(items, null, 2)};\n`;
}

// Deterministic fixups applied on every write, so a card lands in canonical form
// no matter who wrote it — the writer doesn't have to remember the rule. Currently:
// FT cards must link through archive.ph for privacy (Swapnil, 2026-08-20). A bare
// ft.com url is auto-wrapped as archive.ph/newest/<ft-url> here rather than failing
// validation, so carding an FT item with its plain ft.com link just works.
export function normalizeItem(item) {
  if (item && item.source === "ft" && typeof item.url === "string") {
    const u = item.url.trim().replace(/^http:\/\//i, "https://");
    if (/^https:\/\/(www\.|m\.)?ft\.com\//i.test(u))
      item.url = `https://archive.ph/newest/${u}`;
  }
  return item;
}

// Validate, then write. Throws (writing nothing) if the items don't pass the
// schema, so no code path can persist a broken items.js. Normalization runs first,
// so deterministic fixups (e.g. FT → archive.ph) never surface as validation errors.
export function saveItems(items, file = ITEMS_FILE) {
  if (Array.isArray(items)) items.forEach(normalizeItem);
  const { errors } = validate(items);
  if (errors.length)
    throw new Error(`refusing to write invalid items:\n  ${errors.join("\n  ")}`);
  writeFileSync(file, serializeItems(items));
}

// Load → apply fn → save. fn may mutate the array/items in place or return a
// replacement array. Returns the saved array.
export function updateItems(fn, file = ITEMS_FILE) {
  const items = loadItems(file);
  const result = fn(items);
  const next = Array.isArray(result) ? result : items;
  saveItems(next, file);
  return next;
}

// ---- CLI ----
const isMain = process.argv[1] && existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [command, arg] = process.argv.slice(2);
  if (command === "prepend" && arg) {
    const cards = JSON.parse(readFileSync(arg, "utf8"));
    if (!Array.isArray(cards) || !cards.length)
      throw new Error(`${arg} must be a non-empty JSON array of cards`);
    // New cards must say how long they stay worth showing unread (AGENTS.md card
    // contract) unless the instance turned unread expiry off; the schema keeps
    // it optional so older walls stay valid.
    const unshelved = cards.filter(card => !card?.shelf).map(card => card?.id ?? "?");
    if (unshelved.length && loadShelfConfig().expireUnread)
      throw new Error(`every new card needs a shelf { life, until?, reason } — missing on: ${unshelved.join(", ")} (or set expireUnread: false in config/shelf-life.json)`);
    // The shelf-life clock runs from collectedAt; stamp it so a card never falls
    // back to its content's publish date.
    const today = new Date().toISOString().slice(0, 10);
    for (const card of cards) if (card && !card.collectedAt) card.collectedAt = today;
    const saved = updateItems(items => [...cards, ...items]);
    console.log(`prepended ${cards.length} card(s) — ${saved.length} active items. Run: npm run validate && npm run build`);
  } else {
    console.error("usage: node core/items-store.mjs prepend <cards.json>");
    process.exit(1);
  }
}
