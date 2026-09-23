# Shelf life — bounding the unread pile

Before shelf life, an unread card never left the wall: the only archive clock was "five full
days after first read". A wall that cards faster than its owner reads grows without bound, and
stale news keeps getting shuffled back in next to today's cards.

Shelf life gives every card an unread expiry that the sweep judges when it cards it, from what
the piece *is* (not its category):

| `shelf.life` | For | Leaves the wall unread after |
|---|---|---|
| `dated` | a real end date — event, booking window, deadline, market call | the day after `until` (required) |
| `news` | a take on something that just happened | 14 days |
| `analysis` | an explainer of a current situation | 45 days |
| `evergreen` | ideas, history, science, craft | 120 days (a ceiling, so it can't become the new pile) |

Days count from `collectedAt` (when the card joined the wall), not the content's publish date.
A card's own `until` always wins. Read cards keep the read clock. The feed also weights its
unread shuffle by shelf life left, so older unread cards surface less often but don't vanish
before their time. Each card shows a shelf chip; tapping it sends a `<id>#shelf` correction
("keep longer" / "already stale") that the next sweep applies to that card.

Archiving moves cards to `data/archive/`, it never deletes them: dedup still sees them, and
relabelling an archived card with a later `until` or longer life restores it on the next
`antifeed archive` (the archive step reconciles in both directions).

## Tuning or opting out — `config/shelf-life.json`

```json
{ "expireUnread": true, "days": { "news": 14, "analysis": 45, "evergreen": 120 } }
```

Change the day counts to match your reading pace. Set `"expireUnread": false` to keep the
original rule: nothing unread ever expires, `prepend` stops requiring a `shelf`, the feed shows
no chips, and the sweep may skip labelling. The instance file overrides the engine default;
the build inlines it into the page so the feed and the archive step agree.

## Upgrading an existing wall

Nothing changes for cards that have no `shelf`: they never expire. So upgrading the engine pin
is safe on its own. Each new card from then on is labelled (the card contract requires it and
`prepend` refuses cards without one), so your backlog stays until you label it. You don't have
to do anything about the backlog: your sweep agent handles it (`AGENTS.md` sweep step 10a).

Each sweep, the agent labels one batch of up to 150 unlabelled cards, oldest first:

1. `antifeed shelf todo --output batch.json` lists the next batch.
2. It judges each card from its text, `why` and source by the card-contract rules and writes
   `{ "<id>": { life, until?, reason } }`.
3. `antifeed shelf apply labels.json` validates every label before writing, and gives cards with
   no `collectedAt` their real carding date from `data/items.js` git history (or today, which grants
   the full window), so the clock never falls back to an old publish date.
4. `antifeed archive --dry-run` previews what the batch expires; the run report says how many
   cards left the wall, by life, and how many remain unlabelled.

A 1,300-card wall is done in about nine sweeps, and no single sweep archives more than one batch's
worth of backlog. `antifeed doctor` and every archive run print the remaining count, addressed to
the agent. To stop it, tell your agent, or set `expireUnread: false`. If a batch expires more than
you want, lengthen `days` and the next archive run restores those cards.

The archive step fails safe: if read state can't be loaded, it archives nothing, because it
can't tell unread from read.
