#!/usr/bin/env node
// Render private Openness Mode state into idempotent weekly Obsidian notes.
// Personal reflections go only to the local vault, never into the repository.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import model from "../web/wall-openness-model.js";
import { loadOpenness } from "../core/validate-openness.mjs";
import { WALL_URL } from "../core/paths.mjs";

const START = "<!-- openness:auto:start -->";
const END = "<!-- openness:auto:end -->";
const DEFAULT_VAULT = process.env.WALL_OBSIDIAN_VAULT || "";

function argValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}
async function loadState({ stateFile, wallUrl, token }) {
  if (stateFile) return JSON.parse(await readFile(stateFile, "utf8"));
  if (!wallUrl) throw new Error("WALL_URL is required (set it in .env, or pass --state <json>)");
  if (!token) throw new Error("WALL_SYNC_TOKEN is required (or pass --state <json>)");
  const response = await fetch(`${wallUrl.replace(/\/$/, "")}/api/openness`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`openness API returned ${response.status}`);
  return response.json();
}
function weekOf(entry, startedAt) {
  const offset = Date.parse(entry.at) - Date.parse(startedAt);
  return Math.max(1, Math.min(6, Math.floor(offset / (7 * model.DAY_MS)) + 1));
}
function replaceGenerated(existing, title, generated) {
  const block = `${START}\n${generated.trim()}\n${END}`;
  if (!existing) return `# ${title}\n\n${block}\n\n## Notes\n\n`;
  const start = existing.indexOf(START), end = existing.indexOf(END);
  if (start >= 0 && end >= start) return existing.slice(0, start) + block + existing.slice(end + END.length);
  return `${existing.trimEnd()}\n\n${block}\n`;
}
async function updateNote(file, title, generated) {
  let existing = "";
  try { existing = await readFile(file, "utf8"); } catch {}
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, replaceGenerated(existing, title, generated));
}
const linkFor = snapshot => snapshot?.url ? `[${snapshot.label || snapshot.id}](${snapshot.url})` : (snapshot?.label || snapshot?.id || "Unknown card");

export function renderWeek(entries, week, startedAt) {
  const values = Object.values(entries).filter(entry => entry?.at && weekOf(entry, startedAt) === week);
  const predictions = values.filter(entry => entry.kind === "prediction");
  const reflections = values.filter(entry => entry.kind === "reflection");
  const practices = values.filter(entry => entry.kind === "practice");
  const revisits = values.filter(entry => entry.kind === "revisit");
  const lines = [
    `- Predictions: ${predictions.length}`,
    `- Reflections: ${reflections.length}`,
    `- Practices completed: ${practices.filter(entry => entry.status === "completed").length}`,
    `- Revisits: ${revisits.length}`,
  ];
  if (predictions.length) lines.push("", "## Predictions", ...predictions.map(entry => `- ${linkFor(entry.snapshot)} — ${entry.text}`));
  if (reflections.length) lines.push("", "## Reflections", ...reflections.map(entry => `- ${linkFor(entry.snapshot)} — **${entry.outcome}**${entry.text ? ` — ${entry.text}` : ""}`));
  if (practices.length) lines.push("", "## Practice", ...practices.map(entry => `- Week ${entry.week}: **${entry.status}**${entry.plan ? ` — plan: ${entry.plan}` : ""}${entry.reflection ? ` — result: ${entry.reflection}` : ""}`));
  if (revisits.length) lines.push("", "## Revisits", ...revisits.map(entry => `- ${entry.cardId}: **${entry.retention}**${entry.transfer ? ` — ${entry.transfer}` : ""}`));
  return lines.join("\n");
}

export function renderIndex(entries, config, now = Date.now()) {
  const exp = entries.experiment;
  const reflections = Object.values(entries).filter(entry => entry?.kind === "reflection");
  const completed = Object.values(entries).filter(entry => entry?.kind === "practice" && entry.status === "completed");
  const categories = new Set(reflections.map(entry => entry.snapshot?.category).filter(Boolean));
  const meaningful = reflections.filter(entry => ["surprised", "updated", "test"].includes(entry.outcome));
  const currentWeek = model.currentWeek(exp.startedAt, now);
  const lines = [
    `- Status: **${exp.status}**`, `- Started: ${exp.startedAt}`, `- Current week: ${currentWeek}`,
    `- Reflections: ${reflections.length}/${config.success.reflections}`,
    `- Completed practices: ${completed.length}/${config.success.practices}`,
    `- Categories explored: ${categories.size}/${config.success.categories}`,
    `- Meaningful outcomes: ${meaningful.length}/${config.success.meaningfulOutcomes}`,
    "", "## Weeks", ...Array.from({ length: currentWeek }, (_, index) => `- [[Week ${String(index + 1).padStart(2, "0")}]]`),
  ];
  if (entries["survey:final"]) {
    lines.push("", "## Final survey trajectory");
    const scores = ["baseline", "midpoint", "final"].map(phase => {
      const survey = entries[`survey:${phase}`];
      const score = survey && model.scoreSurvey(survey.responses, config.survey.items);
      return `- ${phase}: ${score ? `${score.total}/50 · mean ${score.mean.toFixed(2)}` : "not completed"}`;
    });
    lines.push(...scores, "", "These values are descriptive self-report, not a causal or biological measure.");
  } else {
    lines.push("", "Survey scores remain hidden until the final check-in.");
  }
  return lines.join("\n");
}

export async function writeReport({ state, vault = DEFAULT_VAULT, now = Date.now() }) {
  if (!vault) throw new Error("no Obsidian vault configured — set WALL_OBSIDIAN_VAULT in .env or pass --vault");
  const config = loadOpenness();
  const entries = model.mergeEntries(state?.entries);
  const exp = entries.experiment;
  if (!exp) return { written: [], reason: "experiment not started" };
  const base = join(vault, "Social Wall", "Experiments", "Openness");
  const currentWeek = model.currentWeek(exp.startedAt, now);
  const written = [];
  for (let week = 1; week <= currentWeek; week++) {
    const file = join(base, `Week ${String(week).padStart(2, "0")}.md`);
    await updateNote(file, `Openness experiment · Week ${week}`, renderWeek(entries, week, exp.startedAt));
    written.push(file);
  }
  const index = join(vault, "Social Wall", "Experiments", "Openness.md");
  await updateNote(index, "Openness experiment", renderIndex(entries, config, now));
  written.push(index);
  return { written };
}

const isMain = process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  try {
    const state = await loadState({
      stateFile: argValue(args, "--state"),
      wallUrl: argValue(args, "--url") || WALL_URL,
      token: process.env.WALL_SYNC_TOKEN,
    });
    const result = await writeReport({ state, vault: argValue(args, "--vault") || DEFAULT_VAULT, now: argValue(args, "--now") || Date.now() });
    if (!result.written.length) console.log(result.reason);
    else console.log(`updated ${result.written.length} openness note(s)`);
  } catch (error) {
    console.error(`openness report failed: ${error.message}`);
    process.exit(1);
  }
}
