#!/usr/bin/env node
// Deterministic dedup index over the whole card corpus — live data/items.js
// AND data/archive/*.json (cards moved by the read-age archive operation must
// still participate in dedup, so live-only checks re-card already-seen items).
//
// Cards use human slug ids while sources use raw identifiers (tweet status
// numbers, IG shortcodes, arXiv ids, YouTube video ids, HN item ids), so the
// index keys every card by all of: its id, its normalized URL, and any platform
// raw id extracted from that URL. `wall.mjs collect` consults it after
// normalization and drops exact already-carded candidates before they reach
// sampling. This kills the exact-re-card bug class; "same story, different
// URL" remains a ranking-time judgment call.
//
//   node core/dedup.mjs check <url-or-id> ...   key lookup (is this carded?)
//   node core/dedup.mjs grep <term> ...         fixed-string scan of id/url/
//                                               text/author/handle/tags/via
//                                               across live + archive
import { readdirSync, readFileSync, existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadItems } from "./validate-items.mjs";
import { instancePath } from "./paths.mjs";

const ARCHIVE_DIR = instancePath("data", "archive") + "/";

// ---- canonical keys ---------------------------------------------------------

const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|igsh$|ref$|ref_src$|si$|s$|t$)/;

// Normalized URL: https, lowercase host without www./m./mobile., twitter→x,
// no hash, no tracking params (rest sorted), no trailing slash. Path case is
// preserved — IG shortcodes and YouTube ids are case-sensitive.
export function normalizeUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return ""; }
  let host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
  if (host === "twitter.com") host = "x.com";
  const params = [...u.searchParams].filter(([k]) => !TRACKING_PARAM.test(k.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? "?" + params.map(([k, v]) => `${k}=${v}`).join("&") : "";
  const path = u.pathname.replace(/\/+$/, "");
  return `https://${host}${path}${query}`;
}

// Platform raw ids survive URL-shape changes (share links, ?igsh=, /reels/ vs
// /reel/, abs vs pdf), so they're the strongest keys.
const RAW_ID_PATTERNS = [
  [/(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/, "tweet"],
  [/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/, "ig"],
  [/arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5})/, "arxiv"],
  [/(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{6,})/, "yt"],
  [/news\.ycombinator\.com\/item\?id=(\d+)/, "hn"],
];

export function keysForUrl(raw) {
  const keys = [];
  const normalized = normalizeUrl(raw);
  if (normalized) keys.push(`url:${normalized}`);
  for (const [pattern, tag] of RAW_ID_PATTERNS) {
    const m = String(raw).match(pattern);
    if (m) keys.push(`${tag}:${m[1]}`);
  }
  return keys;
}

export function keysForItem(item) {
  const keys = item.id ? [`id:${item.id}`] : [];
  return keys.concat(keysForUrl(item.url || ""));
}

// ---- corpus + index ---------------------------------------------------------

// Every card that has ever been on the wall: live items plus archive months.
export function loadCorpus() {
  const corpus = loadItems().map(item => ({ item, where: "live" }));
  let files = [];
  try {
    files = readdirSync(ARCHIVE_DIR, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith(".json")).map(e => e.name);
  } catch { /* no archive yet */ }
  for (const name of files) {
    const cards = JSON.parse(readFileSync(ARCHIVE_DIR + name, "utf8"));
    for (const item of cards) corpus.push({ item, where: name.replace(/\.json$/, "") });
  }
  return corpus;
}

// Map of every canonical key → { id, where }. Live wins over archive on
// collisions, including temporary overlap during a safe archive reconciliation.
export function buildIndex(corpus = loadCorpus()) {
  const index = new Map();
  for (const { item, where } of [...corpus].reverse()) // reverse: live entries come first in corpus, set last → win
    for (const key of keysForItem(item)) index.set(key, { id: item.id, where });
  return index;
}

// First carded match for a URL (or null).
export function findCarded(index, url) {
  for (const key of keysForUrl(url)) {
    const hit = index.get(key);
    if (hit) return { ...hit, key };
  }
  return null;
}

// ---- CLI --------------------------------------------------------------------

const isMain = process.argv[1] && existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [command, ...terms] = process.argv.slice(2);
  if (!terms.length || !["check", "grep"].includes(command)) {
    console.error("usage: node core/dedup.mjs check <url-or-id> ...\n       node core/dedup.mjs grep <term> ...");
    process.exit(1);
  }
  if (command === "check") {
    const index = buildIndex();
    for (const term of terms) {
      const keys = /^[a-z][a-z0-9+.-]*:\/\//i.test(term) ? keysForUrl(term) : [`id:${term}`];
      const hit = keys.map(k => index.get(k) && { ...index.get(k), key: k }).find(Boolean);
      console.log(hit ? `CARDED  ${term} → ${hit.id} (${hit.where}, matched ${hit.key})` : `new     ${term}`);
    }
  } else {
    // Fixed-string, case-insensitive scan — replaces ad-hoc grep over items.js
    // (which missed the archive and was prone to ERE quoting bugs).
    const corpus = loadCorpus();
    for (const term of terms) {
      const needle = term.toLowerCase();
      const hits = [];
      for (const { item, where } of corpus) {
        const field = ["id", "url", "text", "note", "author", "handle", "via", "tags"].find(f =>
          JSON.stringify(item[f] ?? "").toLowerCase().includes(needle));
        if (field) hits.push(`  ${item.id} (${where}, in ${field})`);
      }
      console.log(`${term}: ${hits.length} match(es)`);
      for (const hit of hits) console.log(hit);
    }
  }
}
