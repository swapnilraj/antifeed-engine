#!/usr/bin/env node
// Shelf-life backfill for walls carded before shelf life existed. The sweep agent
// labels a bounded batch per sweep (AGENTS.md sweep step 10a):
//
//   antifeed shelf status                      how many live cards still lack a shelf
//   antifeed shelf todo [--limit N] [--output PATH]
//                                              the next batch to label, oldest-carded first
//                                              (slim JSON: id, source, category, author, dates, via, why, text)
//   antifeed shelf apply <labels.json>         { "<id>": { life, until?, reason }, … } → data/items.js
//
// `apply` validates every label against the schema before writing (through
// core/items-store.mjs), and gives cards with no collectedAt their real carding
// date from data/items.js git history — or today, which grants the full window —
// so the shelf clock never falls back to the content's publish date.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadItems, updateItems } from "../core/items-store.mjs";
import { validate } from "../core/validate-items.mjs";
import { loadShelfConfig } from "../core/shelf-config.mjs";
import { WALL_HOME } from "../core/paths.mjs";

const [command, ...rest] = process.argv.slice(2);
const valueOf = flag => {
  const index = rest.indexOf(flag);
  return index >= 0 ? rest[index + 1] : undefined;
};
const DEFAULT_LIMIT = 150;
const clockOf = item => item.collectedAt || item.postedAt || "";

function unlabelled(items) {
  return items.filter(item => !item.shelf).sort((a, b) => clockOf(a).localeCompare(clockOf(b)));
}

// First commit date that added each id to data/items.js; {} when there's no git history.
function cardingDatesFromGit(ids) {
  const wanted = new Set(ids);
  const found = {};
  if (!wanted.size) return found;
  let log;
  try {
    log = execFileSync("git", ["log", "--reverse", "-p", "--format=@@COMMIT %cs", "--", "data/items.js"],
      { cwd: WALL_HOME, encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"] });
  } catch { return found; }
  let date = null;
  for (const line of log.split("\n")) {
    if (line.startsWith("@@COMMIT ")) { date = line.slice(9).trim(); continue; }
    const match = line.startsWith("+") && line.match(/"id": "([^"]+)"/);
    if (match && wanted.has(match[1]) && !found[match[1]]) found[match[1]] = date;
  }
  return found;
}

if (command === "status") {
  const config = loadShelfConfig();
  const items = loadItems();
  const left = unlabelled(items).length;
  if (!config.expireUnread) console.log("shelf life is off (config/shelf-life.json expireUnread: false) — nothing to label");
  else console.log(left
    ? `${left} of ${items.length} live card(s) have no shelf — label them in batches: antifeed shelf todo`
    : `all ${items.length} live cards have a shelf`);
} else if (command === "todo") {
  const limit = Number(valueOf("--limit") || DEFAULT_LIMIT);
  const all = unlabelled(loadItems());
  const batch = all.slice(0, limit).map(item => ({
    id: item.id, source: item.source, category: item.category, author: item.author,
    postedAt: item.postedAt, collectedAt: item.collectedAt, via: item.via, why: item.why,
    text: item.text, ...(item.thesis ? { thesis: { asset: item.thesis.asset, bracket: item.thesis.bracket } } : {}),
  }));
  const json = JSON.stringify(batch, null, 1);
  const output = valueOf("--output");
  if (output) {
    writeFileSync(resolve(output), json + "\n");
    console.log(`wrote ${batch.length} card(s) to ${output} — ${all.length - batch.length} more after this batch`);
  } else console.log(json);
} else if (command === "apply" && rest[0]) {
  const labels = JSON.parse(readFileSync(resolve(rest[0]), "utf8"));
  if (!labels || typeof labels !== "object" || Array.isArray(labels))
    throw new Error(`${rest[0]} must be an object keyed by card id: { "<id>": { life, until?, reason } }`);
  const items = loadItems();
  const byId = new Map(items.map(item => [item.id, item]));
  const unknown = Object.keys(labels).filter(id => !byId.has(id));
  if (unknown.length) throw new Error(`not live cards: ${unknown.join(", ")}`);
  // Validate each labelled card on its own first, so one bad label names itself.
  const problems = Object.entries(labels).flatMap(([id, shelf]) =>
    validate([{ ...byId.get(id), shelf }]).errors.map(error => `${id}: ${error.replace(/^item 0 \([^)]*\): /, "")}`));
  if (problems.length) throw new Error(`refusing to write — fix these labels:\n  ${problems.join("\n  ")}`);
  const undated = Object.keys(labels).filter(id => !byId.get(id).collectedAt);
  const fromGit = cardingDatesFromGit(undated);
  const today = new Date().toISOString().slice(0, 10);
  updateItems(all => all.map(item => {
    if (!labels[item.id]) return item;
    const next = { ...item, shelf: labels[item.id] };
    if (!next.collectedAt) next.collectedAt = fromGit[item.id] || today;
    return next;
  }));
  const left = unlabelled(loadItems()).length;
  const recovered = undated.filter(id => fromGit[id]).length;
  console.log(`labelled ${Object.keys(labels).length} card(s)` +
    (undated.length ? `; carding date set on ${undated.length} (${recovered} from git history, ${undated.length - recovered} today)` : "") +
    `; ${left} still unlabelled. Preview the effect: antifeed archive --dry-run`);
} else {
  console.error("usage: antifeed shelf status | todo [--limit N] [--output PATH] | apply <labels.json>");
  process.exit(1);
}
