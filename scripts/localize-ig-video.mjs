#!/usr/bin/env node
// Self-host Instagram reel video on Cloudflare R2 so reels play inline on the
// wall. Companion to localize-ig-media.mjs (which handles covers + avatars).
//
// Why R2, not the repo or Vercel: reels are multi-MB, and Instagram's own mp4
// URLs 403 off-platform and expire in days (same failure as the images). R2 has
// a free tier and zero egress fees, so streaming stays free. The object keys are
// unguessable and the wall itself is password-gated → "private enough".
//
// For each reel card without a `video`, this downloads the mp4 with yt-dlp
// (anonymous — public reels need no cookies; the download reaches instagram.com
// only while the gate is open), uploads it to R2 under an unguessable key via
// `wrangler r2 object put`, and points the card's `video` at the public URL.
//
// Requires: `wrangler login` done once; the Instagram gate OPEN for the yt-dlp
// step; and R2 config in .env.r2 (R2_ACCOUNT_ID, R2_BUCKET, R2_PUBLIC_BASE).
//   node scripts/localize-ig-video.mjs           every reel missing video
//   node scripts/localize-ig-video.mjs <id> ...   only the given card ids

import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { loadItems, saveItems } from "../core/items-store.mjs";

import "../core/paths.mjs"; // loads .env / .env.r2 from the instance into process.env
const { R2_ACCOUNT_ID, R2_BUCKET, R2_PUBLIC_BASE } = process.env;
if (!R2_ACCOUNT_ID || !R2_BUCKET || !R2_PUBLIC_BASE) {
  console.error("missing R2 config — set R2_ACCOUNT_ID, R2_BUCKET, R2_PUBLIC_BASE in .env (or .env.r2).");
  process.exit(1);
}

const wanted = new Set(process.argv.slice(2));
const items = loadItems();
const targets = items.filter(i =>
  i.source === "instagram" && i.kind === "reel" && !i.video &&
  /^https?:\/\/(www\.)?instagram\.com/i.test(i.url || "") &&
  (wanted.size === 0 || wanted.has(i.id)));

if (!targets.length) {
  console.log("no reel cards need video localizing.");
  process.exit(0);
}

let done = 0;

for (const item of targets) {
  process.stdout.write(`• ${item.id} … `);
  const dir = mkdtempSync(join(tmpdir(), "reel-"));
  const out = join(dir, "v.mp4");
  try {
    // yt-dlp: anonymous, single video, force mp4. Reaches instagram.com — gate must be open.
    execFileSync("yt-dlp", ["-f", "mp4/best", "--no-playlist", "-o", out, item.url], { stdio: "pipe" });
    const key = `reels/${item.id}-${randomBytes(3).toString("hex")}.mp4`;
    // wrangler uploads to R2 with our OAuth session; --remote hits the real bucket.
    execFileSync("wrangler", ["r2", "object", "put", `${R2_BUCKET}/${key}`, `--file=${out}`, "--content-type=video/mp4", "--remote"],
      { stdio: "pipe", env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: R2_ACCOUNT_ID } });
    const url = `${R2_PUBLIC_BASE}/${key}`;
    item.video = url;
    console.log(`→ ${url}`);
    done++;
  } catch (e) {
    console.log(`failed: ${String(e.message || e).split("\n")[0]}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

saveItems(items);
console.log(`\nlocalized video for ${done}/${targets.length} reel(s). Run: npm run validate && npm run build`);
