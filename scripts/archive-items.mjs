#!/usr/bin/env node
// Reconcile the deployed wall against authoritative first-read timestamps.
// A card stays active until five full days after its first read; unread cards
// never age out. Existing count-based archives are reconciled by the same rule,
// so unread/recently-read cards are restored to the wall.
//
// Usage: node scripts/archive-items.mjs [--dry-run] [--reads PATH] [--now ISO]
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readArchivePartition, READ_GRACE_DAYS } from "../core/read-archive.mjs";
import { loadItems, validate } from "../core/validate-items.mjs";
import { saveItems } from "../core/items-store.mjs";
import { instancePath, WALL_URL } from "../core/paths.mjs";

const itemsFile = instancePath("data", "items.js");
const archiveDir = instancePath("data", "archive") + "/";
const args = process.argv.slice(2);
const valueOf = flag => {
  const inline = args.find(arg => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const dryRun = args.includes("--dry-run");
const readsFile = valueOf("--reads");
const now = valueOf("--now") || Date.now();
const readsUrl = process.env.WALL_READS_URL || (WALL_URL ? `${WALL_URL}/api/reads` : "");

function syncToken() { return process.env.WALL_SYNC_TOKEN || ""; }

async function loadReadState() {
  if (readsFile) return JSON.parse(readFileSync(resolve(readsFile), "utf8"));
  const token = syncToken();
  if (!token || !readsUrl) throw new Error("no WALL_SYNC_TOKEN / WALL_URL (set them in .env); leaving every card active");
  const response = await fetch(readsUrl, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`read-state request returned HTTP ${response.status}; leaving every card active`);
  return response.json();
}

function archiveFiles() {
  if (!existsSync(archiveDir)) return [];
  return readdirSync(archiveDir)
    .filter(name => /^\d{4}-\d{2}\.json$/.test(name))
    .sort()
    .reverse();
}

function groupByMonth(items) {
  const groups = new Map();
  for (const item of items) {
    const date = item.collectedAt || item.postedAt;
    const month = /^\d{4}-\d{2}/.test(date || "") ? date.slice(0, 7) : "unknown";
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(item);
  }
  return groups;
}

function validateGroups(groups) {
  for (const [month, items] of groups) {
    const { errors } = validate(items);
    if (errors.length) throw new Error(`refusing to write ${month}.json: ${errors.join("; ")}`);
  }
}

function writeArchives(items, existingFiles) {
  const groups = groupByMonth(items);
  validateGroups(groups);
  mkdirSync(archiveDir, { recursive: true });
  for (const [month, cards] of groups)
    writeFileSync(`${archiveDir}${month}.json`, JSON.stringify(cards, null, 2) + "\n");
  for (const name of existingFiles) {
    const month = name.replace(/\.json$/, "");
    if (!groups.has(month)) unlinkSync(`${archiveDir}${name}`);
  }
}

let state;
try {
  state = await loadReadState();
} catch (error) {
  const live = loadItems(itemsFile);
  console.warn(`read archive skipped: ${error.message}`);
  console.log(`${live.length} total cards → ${live.length} active, 0 archived`);
  process.exit(0);
}
if (!state || !state.reads || typeof state.reads !== "object" || Array.isArray(state.reads))
  throw new Error("read state must contain { reads: { id: ISO } }");

const files = archiveFiles();
const live = loadItems(itemsFile);
const previouslyArchived = files.flatMap(name =>
  JSON.parse(readFileSync(`${archiveDir}${name}`, "utf8")));
const corpus = [...new Map([...live, ...previouslyArchived].map(item => [item.id, item])).values()];
const { active, archived, cutoff } = readArchivePartition(corpus, state.reads, { now });
const liveIds = new Set(live.map(item => item.id));
const oldArchiveIds = new Set(previouslyArchived.map(item => item.id));
const restored = active.filter(item => !liveIds.has(item.id)).length;
const newlyArchived = archived.filter(item => !oldArchiveIds.has(item.id)).length;

console.log(`${corpus.length} total cards → ${active.length} active, ${archived.length} archived`);
console.log(`rule: first read on or before ${cutoff} (${READ_GRACE_DAYS} full days)`);
console.log(`${restored} restored from old count-based archives, ${newlyArchived} newly eligible`);
if (dryRun) process.exit(0);

// Two-phase reconciliation keeps every card recoverable if the process is
// interrupted: stage all prior archive entries plus newly eligible cards,
// write the active wall, then remove restored cards from the archives.
const stagedArchive = [...new Map([...archived, ...previouslyArchived].map(item => [item.id, item])).values()];
writeArchives(stagedArchive, files);
saveItems(active, itemsFile);
writeArchives(archived, files);
