#!/usr/bin/env node
// Assemble the small static Vercel bundle. Collection, profiles, archives, and
// private operating instructions never leave the machine.
import { mkdirSync, copyFileSync, cpSync, existsSync } from "node:fs";
import { loadItems, report } from "../core/validate-items.mjs";
import { loadRuns, reportRuns } from "../core/validate-runs.mjs";
import { loadLearning, reportLearning } from "../core/validate-learning.mjs";
import { loadOpenness, reportOpenness } from "../core/validate-openness.mjs";
import { enginePath, instancePath } from "../core/paths.mjs";

// Gate: never build a bundle from malformed data.
if (!report(loadItems())) {
  console.error("\nbuild aborted — fix the schema errors above before deploying.");
  process.exit(1);
}
if (!reportRuns(loadRuns())) {
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
copyFileSync(enginePath("wall.html"), out("index.html"));
for (const asset of ["wall.css", "wall-renderers.js", "wall-state.js", "wall-read-tracker.js", "wall-media.js", "wall-feedback.js", "wall-learning-template.js", "wall-learning-schedule.js", "wall-learning.js", "wall-openness-model.js", "wall-openness.js", "wall-app.js"])
  copyFileSync(enginePath("web", asset), out("web", asset));
copyFileSync(instancePath("data", "items.js"), out("data", "items.js"));
copyFileSync(instancePath("data", "runs.js"), out("data", "runs.js"));
copyFileSync(instancePath("data", "learning.js"), out("data", "learning.js"));
copyFileSync(instancePath("data", "openness.js"), out("data", "openness.js"));

// Self-hosted media (localized Instagram covers/avatars) ships as static assets.
const mediaSrc = instancePath("media");
if (existsSync(mediaSrc)) cpSync(mediaSrc, out("media"), { recursive: true });

console.log("built public/ (wall assets + active items/runs + learning and openness tracks)");
