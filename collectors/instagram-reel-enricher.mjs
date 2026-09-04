#!/usr/bin/env node
// Bounded reel content pass: download signed Instagram media, transcribe it
// locally with Parakeet MLX, and — for the many text-on-screen reels that carry
// no spoken narration — OCR a few sampled frames so the ranker still gets real
// visual evidence. Attach transcript + onScreenText, then delete all media scratch.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { flagValue } from "./lib/values.mjs";

const runFile = promisify(execFile);
// The macOS Vision OCR helper ships next to this script.
const visionHelper = fileURLToPath(new URL("./mac-vision-ocr.swift", import.meta.url));
// A few evenly spaced frames are enough for text-on-screen reels: on-screen text
// changes at most a handful of times, and duplicate lines are collapsed after.
const MAX_FRAMES = 8;
const [command, ...args] = process.argv.slice(2);
const valueOf = flag => flagValue(args, flag);

async function stdinText() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function readDocument(input) {
  const text = !input || input === "-" ? await stdinText() : await readFile(resolve(input), "utf8");
  const document = JSON.parse(text);
  const candidates = Array.isArray(document) ? document : document?.candidates;
  if (!Array.isArray(candidates)) throw new Error("input must be a candidate array or a wall candidate bundle");
  return { document, candidates };
}

function reelMedia(candidate) {
  const metadata = candidate?.metadata && typeof candidate.metadata === "object" ? candidate.metadata : {};
  return {
    kind: candidate?.kind || metadata.kind,
    videoUrl: candidate?.videoUrl || metadata.videoUrl,
  };
}

function allowedMediaUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && ["cdninstagram.com", "fbcdn.net", "instagram.com"]
      .some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}

function withEnrichment(candidate, enrichment) {
  if (candidate.metadata && typeof candidate.metadata === "object") {
    return { ...candidate, metadata: { ...candidate.metadata, ...enrichment } };
  }
  return { ...candidate, ...enrichment };
}

function cleanFailure(error, tool) {
  const detail = String(error?.stderr || error?.stdout || error?.message || "unknown error")
    .replace(/https:\/\/\S+/g, "[media URL redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  return new Error(`${tool} failed${error?.code ? ` (exit ${error.code})` : ""}: ${detail}`);
}

async function downloadVideo(videoUrl, scratch) {
  try {
    // Download the full muxed video (not audio-only): its audio track feeds the
    // transcriber, and the video frames feed the OCR fallback below — one fetch.
    await runFile("yt-dlp", [
      "--quiet", "--no-warnings", "--no-playlist", "--force-overwrites",
      "--output", join(scratch, "video.%(ext)s"), "--", videoUrl,
    ], { maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    throw cleanFailure(error, "yt-dlp");
  }
  const videoName = (await readdir(scratch)).find(name => /^video\./.test(name) && !name.endsWith(".part"));
  if (!videoName) throw new Error("yt-dlp produced no video file");
  return join(scratch, videoName);
}

async function transcribeAudio(videoPath, scratch) {
  const audioPath = join(scratch, "audio.m4a");
  // Pull the audio track locally rather than re-fetching. A reel with no audio
  // track at all makes ffmpeg fail — treat that as an empty transcript, not an
  // error, so the OCR fallback still runs on the frames.
  try {
    await runFile("ffmpeg", [
      "-y", "-loglevel", "error", "-i", videoPath, "-vn", "-c:a", "aac", audioPath,
    ], { maxBuffer: 10 * 1024 * 1024 });
  } catch {
    return "";
  }
  // No speech recogniser installed (parakeet-mlx is Apple-Silicon only): treat
  // as an empty transcript so the reel is still rankable on caption + OCR.
  if (!(process.env.PATH || "").split(delimiter).some(dir => dir && existsSync(join(dir, "parakeet-mlx")))) return "";
  try {
    await runFile("parakeet-mlx", [
      audioPath, "--output-format", "txt", "--output-dir", scratch,
      "--output-template", "transcript",
    ], { maxBuffer: 20 * 1024 * 1024 });
  } catch (error) {
    throw cleanFailure(error, "parakeet-mlx");
  }
  const transcriptName = (await readdir(scratch)).find(name => name === "transcript.txt") ||
    (await readdir(scratch)).find(name => name.endsWith(".txt"));
  if (!transcriptName) throw new Error("parakeet-mlx produced no transcript");
  // An empty transcript is a NORMAL result, not a failure: a large share of
  // reels are music- or text-on-screen with no spoken narration, and parakeet
  // (a speech recogniser) correctly returns nothing for them. Return "" so the
  // OCR fallback can supply visual evidence and the reel is still rankable.
  return (await readFile(join(scratch, transcriptName), "utf8")).trim();
}

async function videoDuration(videoPath) {
  try {
    const { stdout } = await runFile("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", videoPath,
    ], { maxBuffer: 1024 * 1024 });
    const seconds = Number.parseFloat(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch { return null; }
}

async function extractFrames(videoPath, scratch) {
  const framesDir = join(scratch, "frames");
  await mkdir(framesDir, { recursive: true });
  // Spread the frame samples across the whole clip so late text screens are
  // caught, not just the opening seconds. Fall back to a 2s cadence when the
  // duration is unknown; MAX_FRAMES caps the work either way.
  const duration = await videoDuration(videoPath);
  const interval = duration ? Math.max(1, duration / MAX_FRAMES) : 2;
  try {
    await runFile("ffmpeg", [
      "-y", "-loglevel", "error", "-i", videoPath,
      "-vf", `fps=1/${interval}`, "-frames:v", String(MAX_FRAMES),
      join(framesDir, "frame_%02d.png"),
    ], { maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    throw cleanFailure(error, "ffmpeg");
  }
  return (await readdir(framesDir)).filter(name => name.endsWith(".png")).sort()
    .map(name => join(framesDir, name));
}

function dedupeLines(raw) {
  const seen = new Set();
  const lines = [];
  for (const line of raw.split("\n").map(value => value.trim()).filter(Boolean)) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  // Bound the attached text: a legible cap keeps a pathological OCR result from
  // bloating the candidate bundle.
  return lines.join("\n").slice(0, 2000).trim();
}

async function ocrFrames(framePaths) {
  if (!framePaths.length) return { onScreenText: "", onScreenTextSource: "" };
  // macOS Vision reads stylized reel text far better than tesseract; fall back
  // to tesseract only if the Vision helper is unavailable or errors out.
  try {
    const { stdout } = await runFile("swift", [visionHelper, ...framePaths], { maxBuffer: 10 * 1024 * 1024 });
    return { onScreenText: dedupeLines(stdout), onScreenTextSource: "macos-vision" };
  } catch (visionError) {
    try {
      const outputs = [];
      for (const framePath of framePaths) {
        const { stdout } = await runFile("tesseract", [framePath, "-"], { maxBuffer: 4 * 1024 * 1024 });
        outputs.push(stdout);
      }
      return { onScreenText: dedupeLines(outputs.join("\n")), onScreenTextSource: "tesseract" };
    } catch {
      // Neither OCR engine worked — surface the primary reason and give up on
      // visual evidence for this reel, leaving the transcript-only result.
      throw cleanFailure(visionError, "swift (macOS Vision OCR)");
    }
  }
}

async function enrichReel(candidate) {
  const { videoUrl } = reelMedia(candidate);
  if (!allowedMediaUrl(videoUrl)) throw new Error("reel is missing an allowed Instagram CDN videoUrl");
  const scratch = await mkdtemp(join(tmpdir(), "social-wall-reel-"));
  try {
    const videoPath = await downloadVideo(videoUrl, scratch);
    const transcript = await transcribeAudio(videoPath, scratch);
    const enrichment = { transcript, transcriptSource: "parakeet-mlx" };
    // Only reach for OCR when speech recognition came back empty: talking-head
    // reels are already covered by the transcript, and this keeps frame work
    // bounded to the reels that actually need visual evidence.
    if (!transcript) {
      const frames = await extractFrames(videoPath, scratch);
      const { onScreenText, onScreenTextSource } = await ocrFrames(frames);
      enrichment.onScreenText = onScreenText;
      enrichment.onScreenTextSource = onScreenTextSource;
    }
    return enrichment;
  } finally {
    // The media scratch (video, audio, frames) is always removed, success or not.
    await rm(scratch, { recursive: true, force: true });
  }
}

async function enrich() {
  const input = valueOf("--input");
  const output = valueOf("--output");
  const ids = new Set(String(valueOf("--ids") || "").split(",").map(value => value.trim()).filter(Boolean));
  const rawLimit = Number(valueOf("--limit"));
  const limit = Math.max(1, Math.min(10, Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 5));
  const { document, candidates } = await readDocument(input);
  const eligible = candidates.filter(candidate => {
    const media = reelMedia(candidate);
    return media.kind === "reel" && allowedMediaUrl(media.videoUrl) && (!ids.size || ids.has(String(candidate.id)));
  }).slice(0, limit);
  if (!eligible.length) throw new Error("no selected reel candidates have an Instagram CDN videoUrl");
  if (ids.size) {
    const found = new Set(eligible.map(candidate => String(candidate.id)));
    const missing = [...ids].filter(id => !found.has(id));
    // Missing/ineligible ids (wrong kind, or no allowed CDN videoUrl — e.g. an
    // expired signed URL) are warned, not fatal: one un-fetchable reel must not
    // sink the rest of the shortlist.
    if (missing.length) console.error(`skipping reel ids unavailable or missing videoUrl: ${missing.join(", ")}`);
  }
  const enriched = new Map();
  const failed = [];
  for (const candidate of eligible) {
    console.error(`enriching Instagram reel ${candidate.id}`);
    try {
      // Isolate each reel: a genuine download/transcode failure on one must not
      // discard the enrichment already gathered for the others.
      enriched.set(String(candidate.id), withEnrichment(candidate, await enrichReel(candidate)));
    } catch (error) {
      failed.push(String(candidate.id));
      console.error(`  skipped ${candidate.id}: ${error.message}`);
    }
  }
  const updatedCandidates = candidates.map(candidate => enriched.get(String(candidate.id)) || candidate);
  const updated = Array.isArray(document) ? updatedCandidates : { ...document, candidates: updatedCandidates };
  const json = JSON.stringify(updated, null, 2) + "\n";
  if (output) {
    const outputPath = resolve(output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, json);
    const skipNote = failed.length ? ` (${failed.length} skipped: ${failed.join(", ")})` : "";
    console.log(`enriched ${enriched.size} Instagram reels${skipNote} → ${output}`);
  } else {
    process.stdout.write(json);
  }
}

try {
  if (command === "enrich") await enrich();
  else {
    console.error(`usage: node ${basename(process.argv[1])} enrich --input PATH|- [--ids ID,...] [--limit 1..10] [--output PATH]`);
    process.exit(2);
  }
} catch (error) {
  console.error(`Instagram reel enrichment failed: ${error.message}`);
  process.exit(1);
}
