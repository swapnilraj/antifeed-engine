#!/usr/bin/env node
// Keep only recent sweep diagnostics in the deployed UI; retain older runs as JSON.
// Usage: node scripts/archive-runs.mjs [max-active=20] [--dry-run]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadRuns, validateRuns } from "../core/validate-runs.mjs";

const root = new URL("../", import.meta.url);
const runsFile = new URL("./data/runs.js", root);
const archiveDir = new URL("./data/archive/runs/", root);
const maxArg = process.argv.slice(2).find(arg => /^\d+$/.test(arg));
const maxActive = Number(maxArg || 20);
const dryRun = process.argv.includes("--dry-run");

if (!Number.isInteger(maxActive) || maxActive < 1)
  throw new Error("max-active must be a positive integer");

const all = loadRuns(fileURLToPath(runsFile));
const active = all.slice(0, maxActive);
const leaving = all.slice(maxActive);
const groups = new Map();
for (const run of leaving) {
  const month = /^\d{4}-\d{2}/.test(run.date || "") ? run.date.slice(0, 7) : "unknown";
  if (!groups.has(month)) groups.set(month, []);
  groups.get(month).push(run);
}

console.log(`${all.length} total runs → ${active.length} active, ${leaving.length} archived`);
for (const [month, runs] of groups) console.log(`  ${month}: ${runs.length}`);
if (dryRun || leaving.length === 0) process.exit(0);

mkdirSync(archiveDir, { recursive: true });
for (const [month, runs] of groups) {
  const url = new URL(`./data/archive/runs/${month}.json`, root);
  let previous = [];
  try { previous = JSON.parse(readFileSync(url, "utf8")); } catch {}
  const merged = [...runs, ...previous];
  const unique = merged.filter((run, index) => merged.findIndex(other =>
    other.date === run.date && other.seen === run.seen && other.kept === run.kept && other.notes === run.notes) === index);
  const { errors } = validateRuns(unique);
  if (errors.length) throw new Error(`refusing to write run archive ${month}: ${errors.join("; ")}`);
  writeFileSync(url, JSON.stringify(unique, null, 2) + "\n");
}

writeFileSync(runsFile,
  "// Recent collection runs, newest first. Older history lives in data/archive/runs/.\n" +
  `window.WALL_RUNS = ${JSON.stringify(active, null, 2)};\n`);
