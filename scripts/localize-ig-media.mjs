#!/usr/bin/env node
// Localize Instagram media so cards keep their visuals.
//
// Instagram/fbcdn covers and avatars use *signed* URLs that (a) return 403 to
// any off-platform request and (b) expire within days — so hotlinking them from
// the wall renders broken. This tool fetches the bytes *inside* the logged-in
// browser session (where the request is valid), saves them as static assets under
// media/ig/, and repoints each card at the self-hosted copy. The build step
// copies media/ into public/, and the schema/renderer accept a "/media/…" path.
//
// Media comes from the post page's structured hydration JSON (the same
// image_versions2 candidates the web app renders from), NOT from og:image:
// og:image is a square ~640px feed crop, which both loses the original aspect
// ratio and hides every carousel slide past the first. From hydration we get
// each slide at its largest original-aspect rendition, so a carousel card ends
// up with a full local `images` gallery (and `kind` upgraded from "photo" if a
// sweep misfiled it). og:image remains only a last-resort fallback when the
// hydration payload can't be found.
//
// Read-only w.r.t. the account: it only fetches public media bytes already
// loaded on the post page. It never likes/follows/comments or touches cookies.
//
// Requires: the Instagram gate open (./gate.sh open instagram) and a logged-in
// instagram.com session in the CDP browser. Usage:
//   node scripts/localize-ig-media.mjs                localize every remote IG card
//   node scripts/localize-ig-media.mjs <id> ...       only the given card ids
//   node scripts/localize-ig-media.mjs --refresh <id> ...
//     re-pull already-localized cards (fixes legacy square-crop covers and
//     cover-only carousels; requires explicit ids)

import { writeFileSync, mkdirSync } from "node:fs";
import { loadItems, saveItems } from "../core/items-store.mjs";
import { createCDPClient } from "../collectors/browser/cdp-client.mjs";
import { instancePath } from "../core/paths.mjs";

const MEDIA_DIR = instancePath("media", "ig") + "/";
const REMOTE = /fbcdn\.net|cdninstagram\.com/i;
const isRemote = u => typeof u === "string" && REMOTE.test(u);

// In-page capture, parameterized by the post author's username and the post
// shortcode. Runs in the post page's own origin, so the signed fbcdn requests
// carry valid session context.
//   slides — every image of the post at its largest original-aspect rendition,
//     located by shortcode in the hydration JSON (carousel_media for galleries,
//     the post's own image_versions2 otherwise); falls back to the square
//     og:image crop only if hydration is missing.
//   avatar — the img whose alt names this author ("<user>'s profile picture"),
//     falling back to the profile-link image in the post header (a post page
//     preloads *neighbouring* posts, so "largest image" grabs wrong elements).
const CAPTURE = (user, code) => `(async () => {
  const toB64 = async (url) => {
    if (!url) return null;
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    let s = ""; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return { b64: btoa(s), type: r.headers.get("content-type") || "image/jpeg", src: url };
  };
  const code = ${JSON.stringify(code || "")};
  // Instagram's candidate list mixes square feed crops in with true-aspect
  // renditions, so: keep only candidates matching the media's original aspect
  // (original_width/height, else the largest candidate — always uncropped),
  // then take the largest capped at 1440px wide (IG always serves ~1080) so
  // the wall doesn't store multi-MB camera-resolution files.
  const best = m => {
    const c = ((m.image_versions2 && m.image_versions2.candidates) || []).slice()
      .sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0));
    if (!c.length) return null;
    const ref = (m.original_width && m.original_height)
      ? m.original_width / m.original_height
      : (c[0].width || 1) / (c[0].height || 1);
    const uncropped = c.filter(x => x.width && x.height && Math.abs(x.width / x.height - ref) / ref < 0.02);
    const pool = uncropped.length ? uncropped : c;
    return pool.find(x => (x.width || 0) <= 1440) || pool[pool.length - 1];
  };
  let urls = null;
  if (code) {
    for (const script of document.querySelectorAll('script[type="application/json"]')) {
      const t = script.textContent || "";
      if (!t.includes(code) || !t.includes("image_versions2")) continue;
      let data; try { data = JSON.parse(t); } catch { continue; }
      const stack = [data];
      while (stack.length) {
        const o = stack.pop();
        if (!o || typeof o !== "object") continue;
        if (o.code === code && (o.carousel_media || o.image_versions2)) {
          const found = (o.carousel_media || [o])
            .map(m => best(m)?.url)
            .filter(Boolean);
          if (found.length) { urls = found; break; }
        }
        for (const v of Object.values(o)) if (v && typeof v === "object") stack.push(v);
      }
      if (urls) break;
    }
  }
  const og = document.querySelector('meta[property="og:image"]')?.content || null;
  const fromHydration = !!urls;
  if (!urls) urls = og ? [og] : [];
  const slides = [];
  for (const u of urls) { const a = await toB64(u); if (a) slides.push(a); }
  const u = ${JSON.stringify(user || "")}.toLowerCase();
  const imgs = [...document.querySelectorAll("img")];
  const byAlt = u && imgs.find(i => (i.alt || "").toLowerCase().includes(u));
  const byHref = u && document.querySelector('a[href*="/' + u + '/"] img');
  const avatar = byAlt || byHref || null;
  return JSON.stringify({
    slides, fromHydration,
    avatar: avatar ? await toB64(avatar.currentSrc || avatar.src) : null,
  });
})()`;

const { browserSend, targetSend, evalInTab, http } = createCDPClient();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function capture(url, user, code) {
  const expr = CAPTURE(user, code);
  const { targetId } = await browserSend("Target.createTarget", { url, background: true });
  try {
    try { await targetSend(targetId, "Page.setWebLifecycleState", { state: "active" }); } catch {}
    // Poll until hydration slides and the author avatar are in (or give up ~20s
    // and take whatever hydrated — possibly the og:image fallback).
    let out = null;
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      const raw = await evalInTab(targetId, expr).catch(() => null);
      out = raw ? JSON.parse(raw) : null;
      if (out?.fromHydration && out.slides.length && out.avatar) break;
    }
    return out;
  } finally {
    await http(`/json/close/${targetId}`).catch(() => {});
  }
}

// The account username drives avatar matching; derive it from @handle.
const usernameOf = item => (item.handle || "").replace(/^@/, "").trim();
// The shortcode locates the post inside the page's hydration JSON.
const shortcodeOf = item => (String(item.url || "").match(/\/(?:p|reel|reels)\/([^/?#]+)/) || [])[1] || "";

function save(id, suffix, asset) {
  if (!asset) return null;
  const ext = /png/i.test(asset.type) ? "png" : "jpg";
  const rel = `media/ig/${id}${suffix}.${ext}`;
  writeFileSync(instancePath(rel), Buffer.from(asset.b64, "base64"));
  return `/${rel}`;
}

const args = process.argv.slice(2);
const refresh = args.includes("--refresh");
const wanted = new Set(args.filter(a => a !== "--refresh"));
if (refresh && !wanted.size) {
  console.error("--refresh requires explicit card ids");
  process.exit(1);
}

const items = loadItems();
const targets = items.filter(i =>
  i.source === "instagram" &&
  (refresh || isRemote(i.image) || isRemote(i.avatar) || (i.images || []).some(isRemote)) &&
  (wanted.size === 0 || wanted.has(i.id)));

if (!targets.length) {
  console.log("no Instagram cards with remote media to localize.");
  process.exit(0);
}

mkdirSync(MEDIA_DIR, { recursive: true });
let done = 0;

for (const item of targets) {
  process.stdout.write(`• ${item.id} … `);
  const grabbed = await capture(item.url, usernameOf(item), shortcodeOf(item));
  if (!grabbed || (!grabbed.slides?.length && !grabbed.avatar)) { console.log("no media captured (skipped)"); continue; }
  const slides = grabbed.slides || [];
  const paths = slides
    .map((asset, i) => save(item.id, slides.length > 1 ? `-${i + 1}` : "", asset))
    .filter(Boolean);
  if (paths.length && (refresh || isRemote(item.image) || paths.length > 1)) {
    item.image = paths[0];
    if (paths.length > 1) {
      item.images = paths;
      // A multi-slide post misfiled as photo is a carousel — upgrade it.
      if (item.kind === "photo") item.kind = "carousel";
    } else if (item.images) {
      delete item.images;
    }
  }
  const avatarPath = isRemote(item.avatar) ? save(item.id, "-avatar", grabbed.avatar) : null;
  if (avatarPath) item.avatar = avatarPath;
  const what = [
    paths.length > 1 ? `${paths.length} slides` : paths.length ? "cover" : null,
    avatarPath && "avatar",
    grabbed.fromHydration ? null : "(og:image fallback — square crop)",
  ].filter(Boolean).join(" + ");
  console.log(what || "nothing matched");
  if (paths.length || avatarPath) done++;
}

saveItems(items);
console.log(`\nlocalized ${done}/${targets.length} card(s) → media/ig/. Run: npm run validate && npm run build`);
