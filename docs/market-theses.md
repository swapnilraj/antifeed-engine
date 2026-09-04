# Market-thesis synthesis

Market commentary should become a single fact-checked, provenance-rich thesis when several harvested sources imply a tradeable view. Do not promote isolated vibes, self-reported wins, or funnel marketing into ordinary cards.

## Scope and folding rule

Consider all harvested sources and asset classes: crypto, equities/ADRs, ETFs, indices, FX, and commodities. Cluster tradeable observations by asset or theme. Emit one `source: "thesis"` card only where there is enough independent substance; retain raw source items only as provenance. Drop a lone low-content take.

## Process

1. Record what each source contributes: macro framing, price level, bracket, catalyst, probability, or claim.
2. Verify every price-settleable claim with real data, not the source's assertion:

   ```bash
   node collectors/market.mjs check <symbol> <levels>
   node collectors/market.mjs price <symbol>
   node collectors/market.mjs history <symbol>
   ```

3. Mark each fact check `✓` true, `✗` false, or `~` partial/unverifiable. Cite real price/date evidence. Qualitative or self-reported timing claims remain `~` when data cannot establish them.
4. Build the object according to `core/schema.mjs`: `asset`, `spot`, `bias`, `conviction`, `bracket`, `levels`, `factcheck`, `provenance`, `reasoning`, and `flip`.
5. Prefer confluence, where independent methods or sources point to the same level. Make trigger, invalidation, targets, uncertainty, and thesis-flip conditions explicit.
6. Use `category: "markets"`, `via: "synthesis:<source>"`, and an ID like `thesis-<asset>-<date>`.

## Guardrails

- Price-data verdicts override promotional claims.
- Paid-community funnels may contribute sentiment only and must be identified as marketing.
- Flag unfalsifiable scenario trees rather than dressing them up as targets.
- Preserve every source URL and describe its contribution.
- The card synthesizes others' commentary; it is not the owner's call and not personalized investment advice.

## Staleness — theses expire on time/price, not just the read-clock

A market thesis is a time-bound object: its `spot`, `levels`, and `bracket` were true on `postedAt`. Once price or events overtake them, the card is misinformation dressed as analysis (Swapnil, 2026-08-24 note on `thesis-btc-2026-07-22`: *"this is invalid with the latest data right? some of these should expire because the time invalidates them"*). So, in addition to the normal read-age archive clock:

- **Every sweep, re-check live theses against `node collectors/market.mjs price <symbol>`.** If spot has left the stated range, or a stated `invalidation`/`trigger` has since been hit, the thesis is spent.
- **A spent thesis is pruned, not left live** — remove it from `data/items.js` (its Obsidian note stays as the record). Do not wait on the 5-day read-age gate for a thesis whose numbers are already wrong; the read-age gate governs ordinary cards, but a stale price call actively misleads.
- A thesis that merely aged without being invalidated (still inside its range, no level hit) may stay until its read-clock archives it — staleness is about the *numbers being wrong*, not the date being old.
