#!/usr/bin/env node
// External-source harvester for the social wall — the non-social counterpart to
// cdp.mjs. Pulls candidates from Hacker News and RSS/Atom feeds and prints them
// as a JSON array (same role as `collectors/cdp.mjs harvest`): a SAMPLE for Claude to rank
// against algorithm/interests.md, not a finished set of cards. Read-only, no
// login, and NOT hosts-gated — these run without ./gate.sh.
//
// Dependency-free, Node >= 22 (uses global fetch). Usage:
//   node collectors/sources.mjs all                         everything in config/sources.json
//   node collectors/sources.mjs hn [minPoints] [count]      HN front page, points >= minPoints
//   node collectors/sources.mjs hn-search "<query>" [minPoints] [count]
//   node collectors/sources.mjs rss <feedUrl> [count]       one RSS/Atom feed
//
// Each candidate is a superset of the item schema (see data/items.js) with a few
// helper fields (title/snippet/discussion) to aid distillation. Claude ranks,
// keeps >= the keep threshold, and writes the final card mapping into the schema:
//   source, id, url, author, handle, text, image, stats, postedAt.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createFetchClient } from "./lib/fetch.mjs";
import { domain, isoDayOrThrow } from "./lib/values.mjs";
import { decodeEntities, stripTags, tag } from "./lib/xml.mjs";
import { configPath } from "../core/paths.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const UA = "social-wall/1.0 (personal feed harvester)";
const { getJSON, getText } = createFetchClient({ userAgent: UA });

// ---------- Hacker News (Algolia public API, no key) ----------
// Story => candidate. points -> stats.likes, comments -> stats.replies,
// external article -> url (falls back to the HN discussion), discussion kept separately.
function hnCandidate(hit) {
  const discussion = `https://news.ycombinator.com/item?id=${hit.objectID}`;
  const url = hit.url || discussion;
  return {
    source: "hackernews",
    id: `hn-${hit.objectID}`,
    url,
    author: hit.url ? domain(hit.url) || "Hacker News" : "Hacker News",
    handle: `@${hit.author}`,            // the submitter
    text: hit.title,
    title: hit.title,
    snippet: hit.story_text ? stripTags(decodeEntities(hit.story_text)).slice(0, 400) : "",
    image: "",                           // HN has no thumbnail; Claude can leave image unset
    stats: { likes: String(hit.points ?? 0), replies: String(hit.num_comments ?? 0) },
    postedAt: hit.created_at ? hit.created_at.slice(0, 10) : isoDayOrThrow(hit.created_at_i * 1000),
    discussion,
  };
}

async function harvestHN(minPoints = 50, count = 30) {
  const data = await getJSON(`https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=${count}`);
  return (data.hits || []).filter(h => (h.points ?? 0) >= minPoints).map(hnCandidate);
}

async function searchHN(query, minPoints = 50, count = 30) {
  const q = encodeURIComponent(query);
  const data = await getJSON(`https://hn.algolia.com/api/v1/search?query=${q}&tags=story&numericFilters=points>=${minPoints}&hitsPerPage=${count}`);
  return (data.hits || []).map(hnCandidate);
}

// ---------- RSS / Atom (minimal, dependency-free parser) ----------
function rssItem(xml, feedTitle, feedUrl) {
  const title = stripTags(tag(xml, "title"));
  // link: RSS <link>text</link>, or Atom <link href="..." rel="alternate">
  let link = tag(xml, "link");
  if (!link) {
    const alt = xml.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) || xml.match(/<link[^>]*href=["']([^"']+)["']/i);
    link = alt ? alt[1] : "";
  }
  const rawDesc = tag(xml, "content:encoded") || tag(xml, "description") || tag(xml, "summary") || tag(xml, "content");
  const snippet = stripTags(rawDesc).slice(0, 400);
  const date = tag(xml, "pubDate") || tag(xml, "published") || tag(xml, "updated") || tag(xml, "dc:date");
  let postedAt = "";
  if (date) { const d = new Date(date); if (!isNaN(d)) postedAt = d.toISOString().slice(0, 10); }
  const guid = tag(xml, "guid") || tag(xml, "id") || link;
  const author = stripTags(tag(xml, "dc:creator") || tag(xml, "author").replace(/<[^>]*>/g, "") || feedTitle);
  // image: media/enclosure, else first <img> in the description
  const media = xml.match(/<(?:media:content|media:thumbnail|enclosure)[^>]*url=["']([^"']+)["']/i);
  const imgInDesc = rawDesc.match(/<img[^>]*src=["']([^"']+)["']/i);
  const image = media ? media[1] : imgInDesc ? imgInDesc[1] : "";

  return {
    source: "rss",
    id: "rss-" + Buffer.from(guid || link || title).toString("base64url").slice(0, 24),
    url: link,
    author: author || domain(feedUrl) || "RSS",
    handle: domain(link || feedUrl),
    text: title,
    title,
    snippet,
    image,
    postedAt,
    feed: feedTitle,
  };
}

async function harvestRSS(feedUrl, count = 20) {
  const xml = await getText(feedUrl);
  // decode BEFORE stripping: CDATA-wrapped titles (Substack) would otherwise be
  // eaten whole by the tag-stripper (<![CDATA[...]]> has no early ">").
  const feedTitle = stripTags(decodeEntities((xml.split(/<item[\s>]|<entry[\s>]/i)[0].match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ""])[1]));
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.slice(0, count).map(b => rssItem(b, decodeEntities(feedTitle).trim(), feedUrl)).filter(c => c.url && c.title);
}

// ---------- all: read sources.json and harvest every configured source ----------
async function harvestAll() {
  const cfgPath = configPath("sources.json");
  let cfg;
  try { cfg = JSON.parse(readFileSync(cfgPath, "utf8")); }
  catch (e) { throw new Error(`can't read sources.json: ${e.message}`); }
  const out = [];
  if (cfg.hackernews?.enabled) {
    try { out.push(...await harvestHN(cfg.hackernews.minPoints ?? 50, cfg.hackernews.count ?? 30)); }
    catch (e) { console.error("HN front page failed:", e.message); }
  }
  for (const feed of cfg.rss || []) {
    try { out.push(...await harvestRSS(feed)); }
    catch (e) { console.error(`RSS ${feed} failed:`, e.message); }
  }
  return out;
}

// ---------- CLI ----------
try {
  let out;
  switch (cmd) {
    case "all":        out = await harvestAll(); break;
    case "hn":         out = await harvestHN(Number(rest[0]) || 50, Number(rest[1]) || 30); break;
    case "hn-search":  out = await searchHN(rest[0] || "", Number(rest[1]) || 50, Number(rest[2]) || 30); break;
    case "rss":        if (!rest[0]) throw new Error("usage: collectors/sources.mjs rss <feedUrl> [count]");
                       out = await harvestRSS(rest[0], Number(rest[1]) || 20); break;
    default:
      console.error("commands: all | hn [minPoints] [count] | hn-search <query> [minPoints] [count] | rss <feedUrl> [count]");
      process.exit(1);
  }
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error("fetch failed:", e.message);
  process.exit(1);
}
