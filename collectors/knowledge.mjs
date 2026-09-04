#!/usr/bin/env node
// Knowledge harvester for the social wall — the third source family, alongside
// cdp.mjs (social) and sources.mjs (HN/RSS). Pulls EVERGREEN + authoritative
// knowledge — Wikipedia explainers, arXiv research, curated YouTube channels —
// about the topics in algorithm/interests.md + boosts.md, and prints candidate
// JSON for Claude to rank exactly like any other card.
//
// WHY THIS EXISTS: social search for a topic like geoengineering returns mostly
// conspiracy noise. Curated, authoritative sources give quality BY CONSTRUCTION —
// you pick the wells, the algorithm still decides what's worth keeping. The point
// is to feed real knowledge in the same addictive card format the platforms use.
//
// Dependency-free, Node >= 22 (global fetch). Read-only, no login, NOT hosts-gated.
// Usage:
//   node collectors/knowledge.mjs all                     every topic in config/knowledge-sources.json
//   node collectors/knowledge.mjs topic <name>            one topic (all its wells)
//   node collectors/knowledge.mjs wikipedia "<query>" [n] Wikipedia search -> summaries
//   node collectors/knowledge.mjs arxiv "<query>" [n]     arXiv recent papers
//   node collectors/knowledge.mjs youtube <channelId> [n] one YouTube channel's uploads
//
// Candidate shape is a superset of the item schema (see data/items.js): source is
// one of wikipedia | arxiv | youtube; Claude maps it into a final card and — this
// matters — writes a punchy, curiosity-gap `text`/`note` (ACCENTUATE the hook;
// the raw extract is dry, the card should not be). See CLAUDE.md "Knowledge feed".

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createFetchClient } from "./lib/fetch.mjs";
import { isoDay } from "./lib/values.mjs";
import { attr, stripTags, tag } from "./lib/xml.mjs";
import { configPath } from "../core/paths.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const UA = "social-wall/1.0 (personal knowledge feed harvester)";
const { getJSON, getText } = createFetchClient({
  userAgent: UA,
  textAccept: "application/atom+xml, application/xml, text/xml, */*",
});

// ---------- Wikipedia (public API + REST summary, no key) ----------
// Search -> top page titles -> REST summary (extract + thumbnail + canonical url).
// Disambiguation pages are dropped. Evergreen: postedAt = last-revision day.
async function wikiSummary(title) {
  const t = encodeURIComponent(title.replace(/ /g, "_"));
  const s = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${t}?redirect=true`);
  if (!s || s.type === "disambiguation" || !s.extract) return null;
  return {
    source: "wikipedia",
    id: "wiki-" + (s.pageid ? String(s.pageid) : encodeURIComponent(s.title || title)),
    url: s.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${t}`,
    author: "Wikipedia",
    handle: "en.wikipedia.org",
    text: s.title,
    title: s.title,
    snippet: stripTags(s.extract).slice(0, 600),
    description: s.description || "",
    image: s.thumbnail?.source || s.originalimage?.source || "",
    postedAt: isoDay(s.timestamp) || "",
  };
}
async function harvestWikipedia(query, n = 4) {
  const q = encodeURIComponent(query);
  const data = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&srnamespace=0&srlimit=${n}&format=json&origin=*`);
  const titles = (data?.query?.search || []).map(h => h.title);
  const out = [];
  for (const title of titles) {
    try { const c = await wikiSummary(title); if (c) out.push(c); }
    catch (e) { console.error(`wiki summary "${title}" failed:`, e.message); }
  }
  return out;
}

// ---------- arXiv (Atom API, no key) ----------
function arxivEntry(xml) {
  const id = tag(xml, "id");                       // http://arxiv.org/abs/2501.01234v1
  const abs = id.replace(/v\d+$/, "");
  const title = stripTags(tag(xml, "title"));
  const summary = stripTags(tag(xml, "summary")).slice(0, 600);
  const published = tag(xml, "published");
  const names = [...xml.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)].map(m => stripTags(m[1]));
  const author = names.length ? (names[0] + (names.length > 1 ? ` +${names.length - 1}` : "")) : "arXiv";
  return {
    source: "arxiv",
    id: "arxiv-" + (abs.split("/abs/")[1] || abs).replace(/[^\w.]/g, "-"),
    url: abs,
    author,
    handle: "arxiv.org",
    text: title,
    title,
    snippet: summary,
    image: "",
    postedAt: isoDay(published) || "",
  };
}
async function harvestArxiv(query, n = 5) {
  // Quote multi-word queries into a phrase; a bare `all:marine cloud brightening`
  // is an OR across terms and, sorted by date, returns recent UNRELATED papers.
  const phrase = /\s/.test(query.trim()) ? `"${query.trim()}"` : query.trim();
  const q = encodeURIComponent(`all:${phrase}`);
  const xml = await getText(`http://export.arxiv.org/api/query?search_query=${q}&sortBy=submittedDate&sortOrder=descending&max_results=${n}`);
  const blocks = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.map(arxivEntry).filter(c => c.url && c.title);
}

// ---------- YouTube (per-channel Atom feed, no key) ----------
// Curated channels only (quality by construction). Thumbnail is derived from the
// video id (i.ytimg.com is a CDN, not hosts-gated). views come from the feed when
// present. Get a channel_id from a channel's page source (…"channelId":"UC…") or
// its RSS at youtube.com/feeds/videos.xml?channel_id=UC…
function youtubeEntry(xml, channelTitle) {
  const vid = tag(xml, "yt:videoId");
  if (!vid) return null;
  const title = stripTags(tag(xml, "title"));
  const desc = stripTags(tag(xml, "media:description")).slice(0, 600);
  const published = tag(xml, "published");
  const views = attr(xml, "media:statistics", "views");
  const chan = stripTags(tag(xml, "name")) || channelTitle;
  return {
    source: "youtube",
    id: "yt-" + vid,
    url: `https://www.youtube.com/watch?v=${vid}`,
    author: chan,
    handle: "youtube.com",
    text: title,
    title,
    snippet: desc,
    image: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
    stats: views ? { views: Number(views).toLocaleString("en-US") } : undefined,
    postedAt: isoDay(published) || "",
  };
}
async function harvestYouTube(channelId, n = 5) {
  const xml = await getText(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`);
  const channelTitle = stripTags((xml.split(/<entry[\s>]/i)[0].match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ""])[1]);
  const blocks = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.slice(0, n).map(b => youtubeEntry(b, channelTitle)).filter(Boolean);
}

// ---------- topic / all: driven by knowledge-sources.json ----------
function loadConfig() {
  const cfgPath = configPath("knowledge-sources.json");
  try { return JSON.parse(readFileSync(cfgPath, "utf8")); }
  catch (e) { throw new Error(`can't read knowledge-sources.json: ${e.message}`); }
}
async function harvestTopic(name, cfg = loadConfig()) {
  const topic = cfg.topics?.[name];
  if (!topic) throw new Error(`unknown topic "${name}" — known: ${Object.keys(cfg.topics || {}).join(", ")}`);
  const out = [];
  const wN = cfg.wikipedia?.perQuery ?? 3, aN = cfg.arxiv?.perQuery ?? 5, yN = cfg.youtube?.perChannel ?? 4;
  if (cfg.wikipedia?.enabled !== false) for (const q of topic.wikipedia || []) {
    try { out.push(...await harvestWikipedia(q, wN)); } catch (e) { console.error(`wiki "${q}":`, e.message); }
  }
  if (cfg.arxiv?.enabled !== false) for (const q of topic.arxiv || []) {
    try { out.push(...await harvestArxiv(q, aN)); } catch (e) { console.error(`arxiv "${q}":`, e.message); }
  }
  if (cfg.youtube?.enabled !== false) for (const ch of topic.youtube || []) {
    try { out.push(...await harvestYouTube(ch, yN)); } catch (e) { console.error(`youtube "${ch}":`, e.message); }
  }
  // dedupe by id within the topic (Wikipedia searches overlap)
  const seen = new Map();
  for (const c of out) if (!seen.has(c.id)) seen.set(c.id, { ...c, topic: name, matchInterest: topic.match || name });
  return [...seen.values()];
}
async function harvestAllTopics() {
  const cfg = loadConfig();
  const out = [];
  for (const name of Object.keys(cfg.topics || {})) {
    try { out.push(...await harvestTopic(name, cfg)); } catch (e) { console.error(`topic "${name}":`, e.message); }
  }
  return out;
}

// ---------- CLI ----------
try {
  let out;
  switch (cmd) {
    case "all":       out = await harvestAllTopics(); break;
    case "topic":     if (!rest[0]) throw new Error("usage: collectors/knowledge.mjs topic <name>");
                      out = await harvestTopic(rest[0]); break;
    case "wikipedia": if (!rest[0]) throw new Error("usage: collectors/knowledge.mjs wikipedia \"<query>\" [n]");
                      out = await harvestWikipedia(rest[0], Number(rest[1]) || 4); break;
    case "arxiv":     if (!rest[0]) throw new Error("usage: collectors/knowledge.mjs arxiv \"<query>\" [n]");
                      out = await harvestArxiv(rest[0], Number(rest[1]) || 5); break;
    case "youtube":   if (!rest[0]) throw new Error("usage: collectors/knowledge.mjs youtube <channelId> [n]");
                      out = await harvestYouTube(rest[0], Number(rest[1]) || 5); break;
    default:
      console.error("commands: all | topic <name> | wikipedia \"<query>\" [n] | arxiv \"<query>\" [n] | youtube <channelId> [n]");
      process.exit(1);
  }
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error("fetch failed:", e.message);
  process.exit(1);
}
