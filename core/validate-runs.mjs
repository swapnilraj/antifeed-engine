#!/usr/bin/env node
// Schema guard for data/runs.js. Run logs are user-facing observability data, so
// malformed entries should block a publish just like malformed feed cards do.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { existsSync, realpathSync } from "node:fs";
import { instancePath } from "./paths.mjs";

const DEFAULT_RUNS = instancePath("data", "runs.js");
const isObject = value => value && typeof value === "object" && !Array.isArray(value);

export function validateRuns(runs) {
  const errors = [];
  if (!Array.isArray(runs)) return { errors: ["window.WALL_RUNS must be an array"] };

  runs.forEach((run, index) => {
    const ref = `run ${index}`;
    if (!isObject(run)) { errors.push(`${ref}: must be an object`); return; }
    if (typeof run.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(run.date))
      errors.push(`${ref}: date must be YYYY-MM-DD`);
    for (const key of ["seen", "kept"])
      if (!Number.isInteger(run[key]) || run[key] < 0) errors.push(`${ref}: ${key} must be a non-negative integer`);
    if (Number.isInteger(run.seen) && Number.isInteger(run.kept) && run.kept > run.seen)
      errors.push(`${ref}: kept cannot exceed seen`);
    if ("hist" in run && (!Array.isArray(run.hist) || run.hist.length !== 11 || run.hist.some(n => !Number.isInteger(n) || n < 0)))
      errors.push(`${ref}: hist must contain 11 non-negative integer buckets for scores 0..10`);
    for (const key of ["via", "interests"])
      if (key in run && (!isObject(run[key]) || Object.values(run[key]).some(n => !Number.isInteger(n) || n < 0)))
        errors.push(`${ref}: ${key} must map labels to non-negative integer counts`);
    if ("drops" in run && (!Array.isArray(run.drops) || run.drops.some(drop =>
      !isObject(drop) || typeof drop.text !== "string" || typeof drop.score !== "number" ||
      ("why" in drop && typeof drop.why !== "string"))))
      errors.push(`${ref}: drops must contain { text, score, why? } objects`);
    if ("notes" in run && typeof run.notes !== "string") errors.push(`${ref}: notes must be a string`);
  });
  return { errors };
}

export function loadRuns(file = DEFAULT_RUNS) {
  const require = createRequire(import.meta.url);
  globalThis.window = {};
  const resolved = require.resolve(file);
  delete require.cache[resolved];
  require(resolved);
  return globalThis.window.WALL_RUNS || [];
}

export function reportRuns(runs, label = "data/runs.js") {
  const { errors } = validateRuns(runs);
  console.log(`Validating ${label} — ${Array.isArray(runs) ? runs.length : "?"} runs\n`);
  for (const error of errors) console.log(`  ✗ ${error}`);
  if (errors.length) console.log("");
  console.log(`${errors.length} error${errors.length === 1 ? "" : "s"}${errors.length ? "" : " — schema OK"}`);
  return errors.length === 0;
}

const isMain = process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const file = process.argv[2] ? realpathSync(process.argv[2]) : DEFAULT_RUNS;
  process.exit(reportRuns(loadRuns(file), process.argv[2] || "data/runs.js") ? 0 : 1);
}
