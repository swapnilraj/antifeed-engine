#!/usr/bin/env node
// Read-only Instagram collector using the logged-in web session in the CDP browser.
// Post data comes from Instagram's structured hydration and GraphQL responses;
// cookies and request credentials never leave the browser.
import { collectInstagramSurface, INSTAGRAM_SURFACES } from "./instagram/surface.mjs";
import {
  auditInstagramCollection,
  instagramFailureKind,
  requireOpenInstagramGate,
} from "./instagram/state.mjs";

import { flagValue } from "./lib/values.mjs";

const [command, ...args] = process.argv.slice(2);
const valueOf = flag => flagValue(args, flag);

function boundedNumber(flag, fallback, min, max) {
  const raw = valueOf(flag);
  const number = raw === undefined ? fallback : Number(raw);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
}

function requestedSurfaces() {
  const surfaces = String(valueOf("--surfaces") || "timeline")
    .split(",").map(value => value.trim()).filter(Boolean);
  const unknown = surfaces.filter(surface => !INSTAGRAM_SURFACES[surface]);
  if (unknown.length) throw new Error(`unknown Instagram surfaces: ${unknown.join(", ")}`);
  return surfaces;
}

async function collect() {
  const surfaces = requestedSurfaces();
  const amount = boundedNumber("--amount", 15, 1, 40);
  const rounds = boundedNumber("--rounds", 8, 0, 8);
  try {
    await requireOpenInstagramGate();
    const batches = [];
    for (const surface of surfaces) {
      batches.push(await collectInstagramSurface({
        surface,
        amount,
        rounds,
        debug: args.includes("--debug"),
      }));
    }
    const candidates = new Map(batches.flat().map(candidate => [candidate.id, candidate]));
    await auditInstagramCollection({ status: "success", surfaces, requestedAmount: amount,
      rounds, candidateCount: candidates.size });
    console.log(JSON.stringify([...candidates.values()]));
  } catch (error) {
    await auditInstagramCollection({ status: "failure", surfaces, requestedAmount: amount,
      rounds, failure: instagramFailureKind(error) });
    throw error;
  }
}

try {
  if (command === "collect") await collect();
  else {
    console.error("usage: node collectors/instagram-web.mjs collect [--surfaces timeline,reels] [--amount N] [--rounds N] [--debug]");
    process.exit(2);
  }
} catch (error) {
  console.error(`instagram web collector failed: ${error.message}`);
  process.exit(1);
}
