# Instagram reel enrichment

Never rank a reel from grid alt text alone. Metadata chooses what is worth inspecting; caption, audio, and visual evidence determine whether it is worth keeping.

## Bounded pipeline

1. Collect Instagram home/Reels through `collectors/instagram-web.mjs`. Use caption, author, thumbnail, and stats to prescore topic relevance and hard-drop mute matches.
2. Advance at most about 10 promising reels per run.
3. Use the structured candidate returned by `node collectors/instagram-web.mjs collect --surfaces reels --amount 10 --rounds 8`. Reel candidates include the full caption, author, stats, posted date, thumbnail, and a short-lived signed `videoUrl` when Instagram supplies one.
4. Give a content pass to only the best 5–10 with `node wall.mjs enrich-reels --input <candidate-bundle> --ids <id,...> --output <enriched-bundle>`. The command downloads each selected `videoUrl` with `yt-dlp` (the full muxed video, once), extracts the audio track with `ffmpeg`, transcribes it with `parakeet-mlx`, and attaches the transcript as `metadata.transcript` in a normalized wall bundle. All temporary media (video, audio, frames) is deleted even on failure.
   - For talking heads, explainers, or interviews, use the attached transcript.
   - **Text-on-screen reels (an OCR fallback runs automatically):** a large share of high-signal "informational" reels are text-on-screen over music with no voiceover, so `parakeet` correctly returns an empty transcript. When (and only when) the transcript comes back empty, the enricher samples up to 8 frames evenly across the clip with `ffmpeg` and OCRs them — macOS Vision first (best on stylized reel text), falling back to `tesseract` — then attaches the de-duplicated on-screen text as `metadata.onScreenText` (with `metadata.onScreenTextSource` set to `macos-vision` or `tesseract`). This is real per-reel visual evidence: rank on it exactly as you would a transcript. Talking-head reels never trigger it, keeping the frame/OCR work bounded to the reels that need it.
   - For demos, charts, and product shots not captured by `onScreenText`, inspect the thumbnail or extract a few more bounded frames from the downloaded video with `ffmpeg`.
5. Rank caption, hashtags, transcript, author, stats, and visual evidence together. Apply the mute list to all textual evidence and use a sensible view floor against spam.
6. If no usable text or visual evidence survives, drop the reel as undecidable—do not guess.

## Cookie and scratch discipline

Authentication stays in the CDP browser. Never export the browser cookie jar, `sessionid`, GraphQL request bodies, or CSRF values to scripts, logs, candidate files, or the repository.

Keep downloads, transcripts, and frames outside the repo and delete scratch artifacts after the run — each reel enriches in its own `mkdtemp` scratch dir that is removed in a `finally` block regardless of outcome. `yt-dlp`, `ffmpeg`, `ffprobe`, and `parakeet-mlx` are the expected local dependencies; the OCR fallback additionally uses the macOS `swift`/Vision toolchain (`collectors/mac-vision-ocr.swift`), with `tesseract` as the fallback engine. Signed CDN URLs expire, so enrich promptly, keep volume to the bounded shortlist, and work only while the Instagram gate is open.

Example handoff:

```bash
node wall.mjs collect --instagram=reels --ig-amount 10 --output /tmp/ig-candidates.json
node wall.mjs enrich-reels --input /tmp/ig-candidates.json --ids REEL_ID --output /tmp/ig-enriched.json
```

## Card output

Use `source: "instagram"`, `kind: "reel"`, the thumbnail as `image`, views in `stats.views`, and truthful `via` such as `reels` or `ig-home`. The card text must summarize the actual enriched content, and `why` must name the matched interest or boost.

## Localize media before publishing

Instagram/fbcdn `image` and `avatar` URLs cannot be hotlinked from the wall: they 403 to any off-platform request and their signed `oe` param expires within days. After the kept IG cards are in `data/items.js` (with their original remote URLs), while the Instagram gate is still open, run:

```bash
node wall.mjs localize-media            # every remote IG card
node wall.mjs localize-media <id> ...   # only specific card ids
```

It fetches each card's cover (the page `og:image` — post-specific, unlike a reel viewer's preloaded-neighbour covers) and the author avatar (the username-matched profile pic) *inside* the logged-in browser session where the signed request is valid, saves them under `media/ig/`, and repoints the card at the self-hosted `/media/ig/…` path. This is read-only w.r.t. the account — it captures only already-loaded public media bytes and never touches cookies, tokens, or request bodies. `build-site.mjs` copies `media/` into the deployed bundle, and the schema/renderer accept a rooted `/media/…` path. Cards whose media can't be localized fall back to the branded text card automatically.

## Self-host reel video (required for every kept reel — plays inline)

Every kept reel must play inline; a cover that only links out to Instagram is a defect, not an acceptable default. This is a standard step of the sweep (CLAUDE.md step 10), run **before the gate closes**, not an optional extra. A reel is only done when its card carries a `video` field.

To make a reel play, self-host its mp4 on Cloudflare R2 (chosen for a free tier + zero egress; the repo/Vercel would bloat, and Instagram's own mp4 URLs 403 off-platform and expire in days). One-time setup: `wrangler login`, then a public R2 bucket whose `R2_ACCOUNT_ID`/`R2_BUCKET`/`R2_PUBLIC_BASE` live in gitignored `.env.r2`. Then, **with the Instagram gate open**:

```bash
node wall.mjs localize-video            # every reel missing video
node wall.mjs localize-video <id> ...   # only specific card ids
```

For each reel it downloads the mp4 with `yt-dlp` (anonymous — public reels need no cookies), uploads it to R2 under an unguessable key, and sets the card's `video` to the public URL. The renderer then shows a cover facade that swaps in an inline `<video>` on click (like the YouTube cards); the video files never enter the repo or Vercel. Object keys are unguessable and the wall is password-gated, so a public bucket is private enough. Run it for every kept reel with no exceptions — at ~10–20 MB each on R2's free/zero-egress tier, storage is not a reason to skip. Run `node wall.mjs localize-video` with no args as a catch-all so no kept reel slips through cover-only. If a reel's mp4 genuinely can't be fetched (deleted/private), drop the card rather than shipping a link-out.
