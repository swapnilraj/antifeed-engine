#!/usr/bin/env node
// Give link-family cards (rss / link / hackernews / ft) their article's lead image.
//
// Visuals earn attention (Swapnil, 2026-08-19: "visual stuff grabs my attention
// quick"), and the linkcard renderer has always supported an `image` — but the
// sweep pipeline never fetched one for articles: feeds rarely carry usable
// media tags, and nothing downloaded the article page's og:image. This tool
// closes that gap deterministically: for each target card it fetches the
// article, reads og:image / twitter:image, downloads the bytes to
// media/link/<id>.<ext>, and repoints the card via the items store. The build
// step copies media/ into public/, so nothing hotlinks (article images move,
// die, or block hotlinking).
//
// Junk guard: lead images narrower than 300px (favicons, site logos) are
// discarded and the card left unchanged. No gate needed — articles are public.
//
//   node wall.mjs localize-links             every link/rss/HN card without a local image
//   node wall.mjs localize-links <id> ...    only the given card ids (re-pulls even if local)
import { existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { delimiter, join } from "node:path";
import { loadItems, saveItems } from "../core/items-store.mjs";
import { createFetchClient } from "../collectors/lib/fetch.mjs";
import { instancePath } from "../core/paths.mjs";

const MEDIA_DIR = instancePath("media", "link") + "/";
// "ft" included: ft.com usually CAPTCHAs plain fetches (see the archive.ph
// playbook), so FT pulls often no-op — but any article that does serve an
// og:image benefits, and misses leave the card unchanged.
const LINK_SOURCES = new Set(["rss", "link", "hackernews", "ft"]);
const MIN_WIDTH = 300;

const isLocal = u => typeof u === "string" && u.startsWith("/media/");
const { getResponse } = createFetchClient({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) social-wall-localizer",
});

// The article's own choice of lead image, from its meta tags.
async function leadImageUrl(articleUrl) {
  const response = await getResponse(articleUrl, "text/html").catch(() => null);
  if (!response?.ok) return null;
  const html = (await response.text()).slice(0, 200_000);
  for (const pattern of [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ]) {
    const m = html.match(pattern);
    if (m) return new URL(m[1].replace(/&amp;/g, "&"), articleUrl).href;
  }
  return null;
}

// Image tool: macOS sips, else ImageMagick (7: magick, 6: identify/mogrify).
// With none available, width is unknown (-1): keep the image, skip guard + resize.
const has = name => (process.env.PATH || "").split(delimiter).some(dir => dir && existsSync(join(dir, name)));
const IMG = has("sips") ? "sips" : has("magick") ? "magick" : has("identify") ? "im6" : null;
function widthOf(file) {
  try {
    if (IMG === "sips") return Number(execFileSync("sips", ["-g", "pixelWidth", file], { encoding: "utf8" }).match(/pixelWidth: (\d+)/)?.[1] || 0);
    if (IMG === "magick") return Number(execFileSync("magick", ["identify", "-format", "%w", `${file}[0]`], { encoding: "utf8" })) || 0;
    if (IMG === "im6") return Number(execFileSync("identify", ["-format", "%w", `${file}[0]`], { encoding: "utf8" })) || 0;
    return -1;
  } catch { return IMG ? 0 : -1; }
}
function resizeTo(file, width) {
  if (IMG === "sips") execFileSync("sips", ["--resampleWidth", String(width), file], { stdio: "pipe" });
  else if (IMG === "magick") execFileSync("magick", [file, "-resize", `${width}x`, file], { stdio: "pipe" });
  else if (IMG === "im6") execFileSync("mogrify", ["-resize", `${width}x`, file], { stdio: "pipe" });
  else throw new Error("no image tool");
}

async function download(imageUrl, id) {
  const response = await getResponse(imageUrl, "image/*").catch(() => null);
  if (!response?.ok) return null;
  const type = response.headers.get("content-type") || "";
  if (!/image\//i.test(type)) return null;
  const ext = /png/i.test(type) ? "png" : /webp/i.test(type) ? "webp" : /gif/i.test(type) ? "gif" : "jpg";
  const rel = `media/link/${id}.${ext}`;
  const file = instancePath(rel);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  let width = widthOf(file);
  if (width >= 0 && width < MIN_WIDTH) { rmSync(file); return { junk: true, width }; }
  // Cap at 1440px wide (same as the IG localizer) — cards don't need camera-res files.
  if (width > 1440 && ext !== "gif") {
    try { resizeTo(file, 1440); width = 1440; } catch {}
  }
  return { path: `/${rel}`, width };
}

const wanted = new Set(process.argv.slice(2));
const items = loadItems();
const targets = items.filter(i =>
  LINK_SOURCES.has(i.source) && i.url &&
  (wanted.size ? wanted.has(i.id) : !isLocal(i.image)));

if (!targets.length) {
  console.log("no link-family cards need a lead image.");
  process.exit(0);
}

mkdirSync(MEDIA_DIR, { recursive: true });
let done = 0;

for (const item of targets) {
  process.stdout.write(`• ${item.id} … `);
  const lead = await leadImageUrl(item.url) ||
    (/^https?:\/\//.test(item.image || "") ? item.image : null);
  if (!lead) { console.log("no lead image found"); continue; }
  const saved = await download(lead, item.id);
  if (!saved) { console.log("image fetch failed"); continue; }
  if (saved.junk) { console.log(`skipped (only ${saved.width}px wide — likely a logo)`); continue; }
  item.image = saved.path;
  console.log(`→ ${saved.path} (${saved.width}px)`);
  done++;
  await new Promise(r => setTimeout(r, 300)); // politeness between article fetches
}

saveItems(items);
console.log(`\nlocalized lead images for ${done}/${targets.length} card(s). Run: npm run validate && npm run build`);
