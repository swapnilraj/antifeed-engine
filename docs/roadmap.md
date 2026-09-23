# Inactive roadmap

These ideas are not active sweep behavior. Do not implement or enable them without an explicit user request and the required safety review.

## Account-shaping actions — ACTIVATED (gated), 2026-08-06

Following, unfollowing, muting, saving, and “not interested” actions change the owner's
real accounts. **Now authorized in scope** (private levers + follow-graph, X + IG;
likes still excluded) under the manifest-approval model in
[`account-shaping.md`](account-shaping.md). Still outside read-only collection and
still requiring explicit per-manifest approval before any execution. Phase 1 (the
read-only `shape.mjs propose` manifest generator) is built; execution phases run only
against an approved manifest. **Likes remain roadmap-only** (public endorsement) pending
a separate opt-in.

## Interest-memory expansion

LLM memory and platform data-export analyses are special, approval-gated workflows. Their privacy procedure lives in `feedback-and-private-imports.md`.

## Search and tags

A small client-side search and useful tag chips could expose existing metadata without changing selection semantics.

## Automated sweep

A daily job could gather public sources and perform a carefully gated social sweep, then validate, deploy, and leave a run report. It needs reliable gate cleanup and failure reporting before enablement.

## Digest push

A finite morning digest could link the best 3–5 cards back to the wall. It should remain ranking-driven and must not become an urgency or notification loop.

## Shipped or superseded

- Hacker News, RSS, Wikipedia, arXiv, and curated YouTube are active sources, not roadmap items.
- Obsidian note creation is an active required output.
- Dedicated adaptive quiz cards use a reusable parameterized topic template; nuclear basics is the first active track, with cross-device attempts and spaced retrieval.
- Monthly archives retain cards once they are five days past their first read, or once an unread card's shelf life runs out.
- Vercel is the supported private remote/phone delivery path; the old phone artifact is removed.
