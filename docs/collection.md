# Collection playbook

This is the source-specific detail behind the bounded sweep in `CLAUDE.md`. Prefer the unified CLI for routine work:

Run a full sweep every time it is invoked — there is no per-day cap. Repeat same-day runs are expected to yield fewer keepers as the HN/RSS/knowledge wells mine out; lean on live X and fresh HN, dedupe hard against already-carded items, and report saturation honestly instead of padding with weak keepers.

```bash
node wall.mjs collect
node wall.mjs collect --x-tab ID --instagram
node wall.mjs collect --instagram=timeline,reels --ig-amount 15 --ig-rounds 8
```

By default it runs public sources and writes a timestamped normalized candidate bundle under `scratch/`. `--x-tab` harvests an already-open X tab; `--instagram` uses the authenticated Brave web session and now harvests **both `timeline` and `reels`** by default (pass `--instagram=timeline` to restrict), at `--ig-amount 30` per surface — Instagram is a first-class surface the wall exists to reclaim, not an afterthought. Use `--rounds N` for X, `--ig-rounds N` and `--ig-amount N` for Instagram, or `--output PATH` when needed. The low-level commands below remain useful for diagnosis and targeted sweeps.

An Instagram-enabled `wall.mjs collect` verifies the batch after normalization and prints the collected and normalized Instagram counts. A zero-result or fully rejected Instagram batch fails the collection instead of being silently treated as a successful public-source-only sweep. This post-run check replaces any separate scheduled monitor.

## Safety and gates

**Optional (macOS).** The owner may keep X/Twitter and Instagram mapped to `127.0.0.1` by a root LaunchDaemon (`launchd/install.sh`) so the feeds are reachable only during a sweep. When that gate is installed, control it only with:

```bash
./gate.sh open twitter|instagram|all
./gate.sh status
./gate.sh close
```

Opening is time-limited, but always close explicitly in cleanup. Never edit `/etc/hosts`. If the daemon is not installed, ask the owner to open the hosts manually (or run without a gate). The blocked-domain redirect is implemented in `launchd/`; keep its certificate domain list synchronized with gated hosts.

Social collection needs a logged-in Chromium-family browser answering on the CDP port (`CDP_PORT`, default 9222). `antifeed browser` launches Brave/Chrome/Chromium/Edge/Vivaldi/Opera (auto-detected, or `--browser PATH` / `ANTIFEED_BROWSER`) with a **dedicated profile** (`~/.antifeed/browser`) and the port open — log into X and Instagram there once. Any Chromium-family browser started with `--remote-debugging-port` works the same way; **Firefox and Safari do not speak CDP.** The dedicated profile is not just hygiene: recent Chrome refuses to open the debugging port on its *default* user-data-dir, so a separate `--user-data-dir` is required anyway. `collectors/cdp.mjs` may navigate, scroll, inspect, and capture evidence. It must never like, follow, mute, save, comment, post, or click account controls. Tabs open in the background; hidden X feeds can be shallow, so accept the bounded sample rather than stealing focus.

Instagram uses the logged-in web session in the CDP browser. `collectors/instagram-web.mjs` creates a temporary background tab, keeps it active through CDP focus emulation, and captures only Instagram's structured hydration JSON and the response bodies produced by the web app's own `/api/graphql` and `/graphql/query` reads. Candidate data is never parsed from rendered cards. The collector does not read or export cookies, request bodies, CSRF values, or session tokens, and it does not impersonate the private mobile API.

There is no collector login or session setup. Log into `instagram.com` normally in the CDP browser, then run the collector while the Instagram gate is open. The web endpoints and response shapes are unofficial and can change, so keep runs bounded and stop if Instagram presents a challenge or rate limit.

## Browser sources

Use `node collectors/cdp.mjs harvest <id> [rounds]` for X, not a large `scroll` followed by `text`; harvest advances the virtualized feed in small steps and deduplicates structured posts.

- **X home — prefer Following.** The **Following** tab is the owner's highest-signal X source: the accounts they actually chose to follow, versus the algorithmic For-You feed that reliably returns spam/ads. Open `x.com/home`, switch with `node collectors/cdp.mjs select <id> following`, confirm the returned `{ ok, selected }`, then `harvest` that tab and label it `via: following`. Switching the feed tab is **read-only navigation** (it likes/follows/posts nothing) and is allowed. Harvest **For-You as a noisy secondary** only (`select <id> for-you`), labelled `via: for-you`. X has no distinct Following URL, so the `select` step is how you choose the feed; if the switch reports `ok:false`, harvest whatever is selected and note the gap truthfully.
- **X searches:** at medium/high discovery, use top/default search for high-weight interests and boosts. Live search is often noisy; use engagement floors where helpful. Exemplars may seed additional bounded searches.
- **Instagram home:** `timeline` returns the personalized feed with captions, authors, timestamps, media, and stats. It is labeled `via: "ig-home"`.
- **Instagram Reels:** `reels` returns the connected Reels feed from its clips GraphQL connection. Keep it bounded and follow `docs/reels.md` before ranking video content.
- **Instagram Explore:** intentionally unsupported until its web client exposes a reliable structured connection. Do not relabel home-feed hydration as Explore data.

Useful commands:

```bash
node collectors/cdp.mjs tabs
node collectors/cdp.mjs open <url>
node collectors/cdp.mjs select <id> following   # switch x.com/home to Following (or for-you); read-only
node collectors/cdp.mjs harvest <id> 24
node collectors/cdp.mjs shot <id> <path>
node collectors/cdp.mjs close <id>
node collectors/instagram-web.mjs collect --surfaces timeline --amount 15 --rounds 8
node collectors/instagram-web.mjs collect --surfaces reels --amount 10 --rounds 8
```

## Public sources

These require neither the hosts gate nor a logged-in session and can run first:

```bash
node collectors/sources.mjs all
node collectors/sources.mjs hn-search "<interest keywords>" <minPoints>
node collectors/knowledge.mjs all
node collectors/knowledge.mjs topic <name>
```

- Hacker News and feeds are configured in `config/sources.json`. Map headline to card text, points to likes, comments to replies, and site/submitter to handle; use `source: "hackernews"` or `"rss"`.
- Wikipedia, arXiv, and curated YouTube are configured in `config/knowledge-sources.json`; use `source: "wikipedia"`, `"arxiv"`, or `"youtube"` and `via: "knowledge:<topic>"`.
- Curated YouTube uses channel RSS IDs, not open-ended topic search. Add a channel's `UC…` ID to the appropriate topic configuration.
- Rewrite dry extracts and abstracts into honest hooks with substantive payoff.

## Bounds, ranking, and discovery

Target roughly 40–60 candidates total, then apply the profile threshold and per-run cap (normally about 15 keepers). Start from weighted interest matches, add signal/depth/originality, and hard-drop mute matches and engagement bait. Record `score`, legible `why`, and truthful `via` for every keeper.

At medium/high discovery, derive one or two follow-up rounds from the top 2–3 keepers, exemplars, and all active boosts. Boosts have first discovery priority and should be named in `why`; do not spiral into exhaustive crawling.

## Dedup

`wall.mjs collect` consults the deterministic dedup index (`core/dedup.mjs`) after normalization and drops any candidate whose URL — or platform raw id extracted from it (tweet status number, IG shortcode, bare arXiv id, YouTube video id, HN item id) — matches a card in `data/items.js` **or** `data/archive/*.json`. URL matching is normalized (https forced, `www.`/`m.` stripped, twitter→x, tracking params removed), so protocol and share-link variants can't slip through. Dropped candidates are logged with the card they matched.

For anything discovered outside the bundle (follow-up rounds, exemplar searches), check before carding:

```bash
node wall.mjs dedup check <url-or-card-id> ...
node wall.mjs dedup grep <term> ...
```

`check` is the key lookup; `grep` is a fixed-string, case-insensitive scan over id/url/text/note/author/handle/via/tags across live + archive (use it for handle/topic content checks instead of shell grep, which historically missed the archive and hit ERE quoting bugs). The index only kills exact re-cards — "same story, different URL" remains a ranking-time judgment call, as does the fold-in rule for items already inside a thesis card's provenance.

## Troubleshooting

- Empty X virtualized feed: wait, harvest again in small steps, and accept a shallow sample; never foreground the tab just to force volume.
- A freshly opened `x.com/home` tab can vanish between separate CLI invocations. Open, `select`, and `harvest` it in **one** shell invocation rather than relying on a tab id across calls.
- "Logged out" results from X *and* Instagram at once usually mean something else took the CDP port: `lsof -nP -iTCP:9222 -sTCP:LISTEN` should show your logged-in browser, not a stray headless Chrome. Kill the squatter (or restart the browser on the port) before assuming sessions expired.
- Instagram returns zero while X harvests fine and the real browser owns the port: that is a genuine Instagram session expiry — the owner logs in again normally in the browser; the collector never handles credentials.
- Heavy X tabs time out at high `harvest` round counts; ~5 rounds per tab is the reliable ceiling.
- Instagram authentication missing: log in normally in the CDP browser. Never paste or import a `sessionid` into the collector.
- Shallow Instagram sample: increase `--ig-rounds` up to 8. The collector keeps the tab in the background and accepts the bounded result rather than foregrounding it.
- Instagram challenge/rate limit: stop the sweep, close the gate, and resolve the account challenge normally. Do not retry in a tight loop.
- Gate daemon unavailable: do not bypass it by editing hosts; ask the owner for a manual toggle, or run without a gate.
- Any interrupted run: close all collection tabs you opened and run `./gate.sh close` before doing anything else.
