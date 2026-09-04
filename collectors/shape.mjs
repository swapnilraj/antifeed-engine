#!/usr/bin/env node
// Account-shaping PROPOSER — read-only. Turns algorithm/interests.md (+ an optional
// harvest bundle) into a reviewable manifest of the follow / not-interested / mute
// actions that would improve the X + Instagram algorithms. Writes NOTHING to any
// account and makes no network calls. Execution of an approved manifest is a
// separate, guarded step. See docs/account-shaping.md.
//
//   node collectors/shape.mjs propose [--input scratch/candidates-*.json]
//
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { flagValue } from "./lib/values.mjs";
import { instancePath } from "../core/paths.mjs";

const root = new URL("../", import.meta.url);
const args = process.argv.slice(2);
const valueOf = flag => flagValue(args, flag);

const CAPS = { follows: 8, unfollows: 3, notInterested: 20, mutes: 10 };

const interests = readFileSync(instancePath("algorithm", "interests.md"), "utf8");

// --- section helpers ---------------------------------------------------------
const section = (md, heading) => {
  const lines = md.split("\n");
  const start = lines.findIndex(l => l.trim().toLowerCase().startsWith(heading.toLowerCase()));
  if (start < 0) return "";
  let end = lines.slice(start + 1).findIndex(l => /^##\s/.test(l));
  end = end < 0 ? lines.length : start + 1 + end;
  return lines.slice(start + 1, end).join("\n");
};

// FOLLOW candidates = @handles named in the Exemplars section (accounts that, by
// definition, nail what Swapnil wants). Execution verifies current follow state.
const exemplarSection = section(interests, "## Exemplars");
const followCandidates = [...new Set((exemplarSection.match(/@[A-Za-z0-9_]{2,}/g) || []))];

// MUTE keywords = quoted terms in the Mute section (high precision). The broader
// term set (quoted + notable unigrams) is what NOT-INTERESTED matches post text on.
const muteSection = section(interests, "## Mute");
const quoted = [...muteSection.matchAll(/[""«]?"([^"""]+)"/g)].map(m => m[1].trim()).filter(Boolean);
const extraTerms = ["airdrop", "giveaway", "pump", "shill", "ragebait", "dunk", "course", "cohort"];
const muteKeywords = [...new Set(quoted)];
const matchTerms = [...new Set([...quoted.map(s => s.toLowerCase()), ...extraTerms])];

// NOT-INTERESTED candidates from a harvest bundle (social posts matching a mute term).
let notInterested = [];
const input = valueOf("--input");
if (input) {
  try {
    const bundle = JSON.parse(readFileSync(input, "utf8"));
    const cands = bundle.candidates || bundle.items || bundle || [];
    for (const c of cands) {
      if (!["twitter", "instagram"].includes(c.source)) continue;
      const text = (c.text || c.title || "").toLowerCase();
      const hit = matchTerms.find(t => text.includes(t));
      if (hit) notInterested.push({ ref: c.permalink || c.url || c.id, handle: c.handle || c.author || "", term: hit, source: c.source });
    }
  } catch (e) { console.error(`(could not read --input ${input}: ${e.message})`); }
}

// --- render manifest ---------------------------------------------------------
const today = new Date().toISOString().slice(0, 10);
const cap = (arr, n) => arr.slice(0, n);
const over = (arr, n) => arr.length > n ? ` [+${arr.length - n} over cap, dropped]` : "";

const out = [];
out.push(`PROPOSED — X + Instagram — ${today}   (source: ${input ? input : "profile-only"})`);
out.push(`# Read-only proposal. No account was touched. Approve lines, then execute.`);
out.push("");
out.push("## FOLLOW (X — verify not-already-followed at execution)");
if (followCandidates.length) for (const h of cap(followCandidates, CAPS.follows))
  out.push(`  FOLLOW    ${h.padEnd(20)} — exemplar in interests.md (feeds the Following harvest)`);
else out.push("  (none)");
out.push(`  ${over(followCandidates, CAPS.follows)}`.trimEnd());
out.push("");
out.push("## MUTE-KW (X + IG — from interests.md Mute)");
if (muteKeywords.length) for (const t of cap(muteKeywords, CAPS.mutes))
  out.push(`  MUTE-KW   "${t}"`.padEnd(28) + " — Mute list");
else out.push("  (none)");
out.push("");
out.push("## NOT-INTERESTED (served posts matching a mute term)");
if (notInterested.length) for (const n of cap(notInterested, CAPS.notInterested))
  out.push(`  NOT-INT   [${n.source}] ${n.handle} ${n.ref} — matched "${n.term}"`);
else out.push(`  (none — ${input ? "no matching social posts in bundle" : "pass --input <harvest> to populate"})`);
out.push("");
out.push("  (no likes — not authorized)");
out.push(`CAPS: follows ${Math.min(followCandidates.length, CAPS.follows)}/${CAPS.follows} · ` +
  `mutes ${Math.min(muteKeywords.length, CAPS.mutes)}/${CAPS.mutes} · ` +
  `not-int ${Math.min(notInterested.length, CAPS.notInterested)}/${CAPS.notInterested}`);

console.log(out.join("\n"));
