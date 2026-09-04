# Feedback and private-interest imports

## Wall feedback

At the start of every sweep, pull synced more/less taps and written notes with the machine token in `.env` (`WALL_SYNC_TOKEN`; a legacy `.env.sync` is honoured too):

```bash
set -a; source .env; set +a   # WALL_URL + WALL_SYNC_TOKEN
curl -s -H "Authorization: Bearer $WALL_SYNC_TOKEN" \
  $WALL_URL/api/feedback
```

A signal of shape `{ "removed": true, "at": … }` is a deletion tombstone (a toggled-off tap or cleared note) — sync plumbing, not feedback: skip it when interpreting, but still count its `at` toward the newest processed timestamp so it gets pruned. Interpret each real signal in its card context by looking up the card ID in `data/items.js`:

- More: strengthen a matching interest/keyword or consider the author as an exemplar.
- Less: weaken the interest, refine keywords, or add a mute when the intent is categorical.
- Written note: treat as the authoritative plain-language instruction; it may also request a card correction or answer.

Update `algorithm/interests.md` or `algorithm/boosts.md`, then append the quoted request and exact change to `algorithm/feedback-log.md`. Only after changes land, mark through the newest processed timestamp:

```bash
curl -s -H "Authorization: Bearer $WALL_SYNC_TOKEN" -X POST \
  -H "content-type: application/json" \
  -d '{"processedAt":"<newest signal at>"}' \
  $WALL_URL/api/feedback
```

For a local `file://` wall that cannot sync, use `node collectors/cdp.mjs feedback <id>` on its open tab. The ask-an-AI control is a client-side deep link and creates no sweep work.

If `.env` is lost, mint a new random token, replace the Vercel `WALL_SYNC_TOKEN`, rewrite the local file, and redeploy. Never print, commit, or place the token in documentation.

## Read-state (read-vs-kept)

`wall-read-tracker.js` marks a card read after settled, focused dwell; `/api/reads` persists the authoritative first-read timestamp. It drives cross-device ordering, read-vs-kept reporting, and archive eligibility. Pull it at the start of a sweep with the same machine token:

```bash
set -a; source .env; set +a   # WALL_URL + WALL_SYNC_TOKEN
curl -s -H "Authorization: Bearer $WALL_SYNC_TOKEN" \
  $WALL_URL/api/reads
```

The response is `{ reads: { "<item id>": "<ISO first-read>" }, updatedAt }`. Intersect the ids with `data/items.js` to judge the wall by what is actually looked at, not only what was kept:

- Report read-vs-kept in `data/runs.js`: how many live cards were read, and the read-rate broken down by category and by matched interest.
- Treat the timestamp as durable lifecycle state. `node wall.mjs publish` archives a card only after five full days have elapsed since this first read; an absent or malformed timestamp never makes a card eligible.
- Treat reads as a **revealed-preference** signal complementary to explicit ±: a card read to completion is a soft "more"; a whole category left unread across sweeps is a soft "less" worth raising with the owner before reweighting. Reads never auto-tune the profile on their own.
- This is telemetry, not a queue — there is no processed-timestamp round-trip, so nothing to POST back.

## Read-timing events (how long a card takes to read)

`/api/read-events` (same token) stores per-read timing rows the tracker pushes when a card
commits as read: `{ id, ms, words, src, cat, img, score, by, at }`. `by` is `read-button`
(the ✓ tap — true end-of-reading time), `dwell` (auto-commit, so `ms` ≈ the threshold:
censored), or `engage` (share/±/ask/note/play committed it; `ms` may undershoot). A dwell
auto-commit does NOT stop the clock: the card keeps accruing focused dwell while it stays
primary, so a later ✓ press on the same card logs the true, longer time. **Per id, a
`read-button` row supersedes a `dwell` row** — dedupe that way before fitting.

```bash
set -a; source .env; set +a   # WALL_URL + WALL_SYNC_TOKEN
curl -s -H "Authorization: Bearer $WALL_SYNC_TOKEN" \
  $WALL_URL/api/read-events
```

Purpose: fit the dwell threshold
in `web/wall-read-tracker.js` (`requiredReadMs`, currently ~90ms/word after the 2026-08-20
"too long" feedback) to the owner's measured reading pace and per-feature costs, instead of
guessing. Prefer `read-button` rows as ground truth. Cumulative telemetry — nothing to
process; report on it only when the sample is worth acting on.

**EXCLUDE "read-elsewhere" re-marks before fitting (owner, 2026-08-25: "some posts i mark
read really quickly… i am marking those read because i read them somewhere else — those should
not be used for reading-speed calibration").** Some ✓ taps are not in-session reading at all —
he already read the item on another platform and is just clearing it. These log a tiny `ms`
regardless of length, so their implied pace is superhuman. In the 2026-08-25 sample this was a
large, distinct cluster: **~46 of 144 usable rows implied faster than ~1500 wpm** (e.g. 190
words "read" in 254 ms ≈ 45,000 wpm), a ~30% contamination that drags any naive mean far too
short, while the genuine reads centred at a **median ~77 ms/word**. So, at fit time only:
- **Drop any row implying a pace faster than a real skim can reach** — as a hard floor,
  `ms/words < ~40` (≈1500 wpm) is not physically read here; the observed spurious cluster sits
  at **1–6 ms/word**, so this is a wide, safe margin. Optionally also drop rows with an
  implausibly small absolute `ms` (≲1.2 s), which can't be a genuine focused read of even a
  headline-length card.
- These excluded rows are **still valid read-state** (they belong in `/api/reads` for ordering
  and the archive clock) — the exclusion is *only* for the reading-speed fit, never for read
  status.
- Fit `requiredReadMs` on the surviving distribution (prefer its median/robust centre over the
  mean, since even after the floor the fast tail is heavier than the slow one). Do **not** lower
  the live 90 ms/word on the strength of a fit that still includes the re-marks.

## Adaptive learning state

`/api/learning` stores cross-device retrieval attempts as
`{ track, concept, question, correct, at }`. It deliberately stores no free-text answer.
The transparent curriculum and schedule live in `data/learning.js`; reusable topic parameters
are documented in `docs/learning-tracks.md`, and the first active track is Nuclear basics. A
source card's first-read timestamp unlocks its concept, then successful
retrievals space reviews across 1, 4, 10, and 30 days. An incorrect answer retries after one
day. Every due review enters the finite feed, interleaved with normal cards rather than hidden
behind a fixed queue cap.

Learning attempts are their own state, not interest feedback: do not translate a wrong answer
into a “less nuclear” signal. Use performance only to schedule reinforcement.

## Openness experiment state

`/api/openness` stores the opt-in six-week experiment's surveys, predictions,
reflections, practices, and revisits in a separate private blob. Pull it with the same
bearer token and follow `docs/openness-experiment.md`. This state is durable measurement,
not a feedback queue: never mark it processed and never translate its outcomes into
interest changes. The normal ＋/－ controls remain the only explicit card-level tuning
signal. Run `node wall.mjs openness-report` during active sweeps to update private,
local Obsidian summaries.

## Platform data exports

This is an explicit, user-requested workflow, never part of a normal sweep. The owner requests and supplies the archives; Claude never enters passwords. Exports contain highly sensitive data, so keep them outside the repo, local-only, and delete raw files after the approved distillation.

Read only interest-relevant files—never DMs/messages, contacts, or location history:

- X: inferred interests/ad audiences, likes, and following lists.
- Instagram/Meta: ad interests, topics, liked posts, and saved posts.
- Google Takeout: YouTube watch and search history.

Aggregate topic/author frequencies, then propose—not apply—a diff to `algorithm/interests.md` with evidence for weights, new interests, mutes, and exemplars. The owner approves the diff before it lands. Log what was adopted in `algorithm/feedback-log.md`; never put private source content in cards or the interest profile.

## LLM memory imports

ChatGPT, Claude, Gemini, and local Claude memory may be read only with explicit approval per source. Work locally, extract interest-level signals rather than personal content, and present a proposed profile diff for approval. Never deploy memory material, write it into cards, or treat access to one source as permission to inspect another.
