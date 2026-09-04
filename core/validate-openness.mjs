#!/usr/bin/env node
import { createRequire } from "node:module";
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { instancePath } from "./paths.mjs";

const DEFAULT_FILE = instancePath("data", "openness.js");
const nonEmpty = value => typeof value === "string" && value.trim().length > 0;

export function loadOpenness(file = DEFAULT_FILE) {
  const require = createRequire(import.meta.url);
  const previousWindow = globalThis.window;
  try {
    globalThis.window = {};
    const resolved = require.resolve(file);
    delete require.cache[resolved];
    require(resolved);
    return globalThis.window.WALL_OPENNESS;
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

export function validateOpenness(config) {
  const errors = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) return ["config must be an object"];
  if (config.version !== 1) errors.push("version must be 1");
  for (const key of ["durationDays", "midpointDay", "revisitAfterDays", "revisitExpiresAfterDays", "practiceAfter", "revisitAfter", "unreadDoseCap"])
    if (!Number.isInteger(config[key]) || config[key] < 1) errors.push(`${key} must be a positive integer`);
  if (config.midpointDay >= config.durationDays) errors.push("midpointDay must be before durationDays");
  if (!config.survey || !Array.isArray(config.survey.items) || config.survey.items.length !== 10)
    errors.push("survey must contain exactly 10 items");
  else config.survey.items.forEach((item, index) => {
    if (!nonEmpty(item.text)) errors.push(`survey item ${index}: text must be non-empty`);
    if (!["+", "-"].includes(item.key)) errors.push(`survey item ${index}: key must be + or -`);
  });
  if (!Array.isArray(config.survey?.labels) || config.survey.labels.length !== 5 || !config.survey.labels.every(nonEmpty))
    errors.push("survey labels must contain five non-empty strings");
  if (!Array.isArray(config.practices) || config.practices.length !== 6) errors.push("practices must contain exactly six weeks");
  else config.practices.forEach((practice, index) => {
    if (practice.week !== index + 1) errors.push(`practice ${index}: week must be ${index + 1}`);
    if (!nonEmpty(practice.title) || !nonEmpty(practice.prompt)) errors.push(`practice ${index}: title and prompt must be non-empty`);
  });
  for (const key of ["reflections", "practices", "categories", "meaningfulOutcomes"])
    if (!Number.isInteger(config.success?.[key]) || config.success[key] < 1) errors.push(`success.${key} must be a positive integer`);
  return errors;
}

export function reportOpenness(config, label = "data/openness.js") {
  const errors = validateOpenness(config);
  console.log(`Validating ${label}\n`);
  for (const error of errors) console.log(`  ✗ ${error}`);
  if (errors.length) console.log("");
  console.log(`${errors.length} error${errors.length === 1 ? "" : "s"}${errors.length ? "" : " — schema OK"}`);
  return errors.length === 0;
}

const isMain = process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exit(reportOpenness(loadOpenness()) ? 0 : 1);
