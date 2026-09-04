# Openness Mode experiment

The wall hosts an opt-in, six-week personal experiment in deliberate novelty,
reflection, cognitive flexibility, and real-world practice. It is a behavioural
self-experiment, not a clinical intervention or a direct measure of neuroplasticity.

## Activation and private state

The experiment is off until the baseline survey is submitted. Browser state syncs
through authenticated `/api/openness`; the sweep can inspect the same endpoint with
the local bearer token:

```bash
set -a; source .env; set +a   # WALL_URL + WALL_SYNC_TOKEN
curl -s -H "Authorization: Bearer $WALL_SYNC_TOKEN" \
  $WALL_URL/api/openness
```

Only apply the rules below while `entries.experiment.status` is `active`. Reflections,
survey answers, practices, and revisits are independent experiment state: never turn
them into `more`, `less`, or an interest-profile edit. A user may separately press
the normal ＋/－ controls when they want to tune the feed.

## Active sweep dose

- Keep the normal 6/10 threshold and all existing mutes and quality gates.
- Hunt and keep 3–4 qualified exploration cards in a roughly 15-card sweep. **Priority order
  (owner, 2026-08-25 — "nothing challenging my thesis… nothing opening my mind"):** first a
  credible `counterpoint` that challenges a thesis he holds, then a genuinely off-map
  `wildcard` that disorients, and only then `adjacent` picks as the floor. Still at most one
  `counterpoint` per sweep, but that one should almost always be present when a credible
  thesis-challenge exists — the empty-counterpoint sweeps are the failure being corrected.
- Every new pilot exploration card carries `exploration: { kind, bridge }` and retains
  `via`, `why`, and `score`. A counterpoint also requires `credibility`, naming the
  author's expertise or the evidence that makes the challenge worth attention.
- Counterpoints steelman a credible view. Do not use ragebait, a random contrarian,
  false balance, or agreement as a ranking signal.
- Never pad to hit the target. Report which vectors came up dry.
- Dose cap: if six structured exploration cards are already unread, keep at most one
  additional exploration card while continuing to hunt and report saturation.

The normal finite-wall and read-state rules still apply. The experiment does not
authorize notifications, streaks, time-spent optimisation, or account-shaping writes.

## Weekly private report

During an active sweep, update the local Obsidian experiment notes after pulling state:

```bash
set -a; source .env; set +a   # WALL_URL + WALL_SYNC_TOKEN
node wall.mjs openness-report
```

The command replaces only generated marker blocks in
`Social Wall/Experiments/Openness*.md`, preserving manual notes. Raw reflections stay
in the private Blob and local vault; never copy them into the repository, run log, or
deployed card data. Survey scores remain hidden in reports until the final check-in.
