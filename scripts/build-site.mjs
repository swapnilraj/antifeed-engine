#!/usr/bin/env node
// Assemble the small static Vercel bundle. Collection, profiles, archives, and
// private operating instructions never leave the machine.
import { mkdirSync, copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { loadShelfConfig } from "../core/shelf-config.mjs";
import { loadItems, report } from "../core/validate-items.mjs";
import { loadRuns, reportRuns } from "../core/validate-runs.mjs";
import { loadLearning, reportLearning } from "../core/validate-learning.mjs";
import { loadOpenness, reportOpenness } from "../core/validate-openness.mjs";
import { enginePath, instancePath } from "../core/paths.mjs";

// Gate: never build a bundle from malformed data.
const items = loadItems();
if (!report(items)) {
  console.error("\nbuild aborted — fix the schema errors above before deploying.");
  process.exit(1);
}
const runs = loadRuns();
if (!reportRuns(runs)) {
  console.error("\nbuild aborted — fix the run-log schema errors above before deploying.");
  process.exit(1);
}
if (!reportLearning(loadLearning())) {
  console.error("\nbuild aborted — fix the learning-track errors above before deploying.");
  process.exit(1);
}
if (!reportOpenness(loadOpenness())) {
  console.error("\nbuild aborted — fix the openness-experiment errors above before deploying.");
  process.exit(1);
}

const out = (...p) => instancePath("public", ...p);
mkdirSync(out("data"), { recursive: true });
mkdirSync(out("web"), { recursive: true });

// wall.html -> public/index.html; copy only the assets it references.
// The instance's shelf-life config is inlined ahead of the shared model so the
// feed's chips and weighting match what the archive step enforces.
const shelfTag = '<script src="web/wall-shelf-life.js"></script>';
const html = readFileSync(enginePath("wall.html"), "utf8");
if (!html.includes(shelfTag)) throw new Error("wall.html no longer loads web/wall-shelf-life.js");
writeFileSync(out("index.html"), html.replace(shelfTag,
  `<script>window.WALL_SHELF_CONFIG = ${JSON.stringify(loadShelfConfig()).replace(/</g, "\\u003c")};</script>\n${shelfTag}`));
for (const asset of ["wall.css", "wall-renderers.js", "wall-state.js", "wall-read-tracker.js", "wall-media.js", "wall-feedback.js", "wall-learning-template.js", "wall-learning-schedule.js", "wall-learning.js", "wall-shelf-life.js", "wall-openness-model.js", "wall-openness.js", "wall-app.js"])
  copyFileSync(enginePath("web", asset), out("web", asset));
copyFileSync(instancePath("data", "items.js"), out("data", "items.js"));
// The UI only displays the latest sweep. Keep the full run history in the
// instance, but do not make every visit download and parse it.
writeFileSync(out("data", "runs.js"), `window.WALL_RUNS = ${JSON.stringify(runs.slice(0, 1))};\n`);
copyFileSync(instancePath("data", "learning.js"), out("data", "learning.js"));
copyFileSync(instancePath("data", "openness.js"), out("data", "openness.js"));

// Ship only media used by active cards. Archived cards are not in this bundle,
// and copying their media into every deployment needlessly grows storage.
rmSync(out("media"), { recursive: true, force: true });
const mediaSrc = instancePath("media");
const localMedia = new Set();
for (const item of items) {
  for (const value of [item.avatar, item.image, ...(item.images || [])]) {
    if (typeof value === "string" && value.startsWith("/media/")) localMedia.add(value);
  }
}
for (const url of localMedia) {
  const source = resolve(mediaSrc, url.slice("/media/".length));
  const path = relative(mediaSrc, source);
  if (!path || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path) || !existsSync(source))
    throw new Error(`missing or invalid local media: ${url}`);
  const target = out("media", path);
  mkdirSync(resolve(target, ".."), { recursive: true });
  copyFileSync(source, target);
}

console.log(`built public/ (wall assets + active items/runs + ${localMedia.size} media files + learning and openness tracks)`);
