# antifeed

A feed where **your own algorithm decides what you see** — and the algorithm is a markdown file.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fswapnilraj%2Fantifeed&project-name=antifeed&repository-name=antifeed&env=WALL_USER,WALL_PASSWORD,WALL_COOKIE_SECRET,WALL_SYNC_TOKEN&envDescription=Basic-auth%20user%2Fpassword%20for%20your%20private%20wall%2C%20a%20random%20cookie%20secret%2C%20and%20a%20random%20machine%20token%20the%20sweep%20uses%20to%20sync%20(put%20the%20same%20token%20in%20your%20local%20.env)&envLink=https%3A%2F%2Fgithub.com%2Fswapnilraj%2Fantifeed%23hosted-wall&stores=%5B%7B%22type%22%3A%22blob%22%7D%5D)

You write `algorithm/interests.md` (what you want, weighted; what to mute; who nails it). A coding
agent — **Claude Code or Codex, interchangeably** — runs a *sweep*: it harvests X, Instagram, Hacker
News, RSS, Wikipedia, arXiv and curated YouTube, ranks every candidate 0–10 against your file,
keeps only what clears your threshold, writes each keeper up with a `why`, and publishes a private
wall. Tap ＋/－ on cards and the next sweep folds that back into your file. `git log algorithm/`
is the history of your taste.

This package is the deterministic **engine** around the agent: collectors, dedup, schema
validation, media self-hosting, the read tracker, the sync API, and the build. The ranking itself
is the agent reading [`AGENTS.md`](AGENTS.md) — no API keys, no model lock-in.

## Get a wall running (≈3 minutes)

**Hosted (recommended):** click the Deploy button. Vercel copies the
[template](https://github.com/swapnilraj/antifeed) into your GitHub, asks for a username/password
for your private wall plus two random secrets, attaches a Blob store, and deploys an empty wall.
Then:

```bash
git clone git@github.com:<you>/antifeed.git && cd antifeed && npm install
cp .env.example .env               # WALL_URL = your Vercel URL, WALL_SYNC_TOKEN = the token you gave Vercel
$EDITOR algorithm/interests.md     # your algorithm — required; the sweep refuses an empty profile
npx antifeed doctor                # checks the profile, the data files, and that the hosted wall answers
claude                             # or: codex   → then say "run a sweep"
```

The sweep commits and pushes; Vercel redeploys. That's the loop — every later sweep is the same.

**Local only (no Vercel):**

```bash
npx github:swapnilraj/antifeed-engine#v1.1.1 init my-antifeed
cd my-antifeed && npm install && $EDITOR algorithm/interests.md
claude                             # or: codex   → "run a sweep"
npx antifeed build && open public/index.html
```

**Or just tell your agent.** Open the instance in `claude` / `codex` and say *"set this up"* — the
agent follows [docs/setup.md](docs/setup.md): it interviews you for the profile, then installs each
optional layer below with a verification step, asking only for logins, `sudo`, and secrets.

Either way you get a working wall from public sources (HN, RSS, knowledge feeds). Everything
else is optional and one `.env` line each:

| Layer | Needs | Gives |
|---|---|---|
| Hosted, private wall | the Deploy button (or: your own Vercel project with `WALL_USER` / `WALL_PASSWORD` / `WALL_COOKIE_SECRET` / `WALL_SYNC_TOKEN` env vars and a Blob store), plus `WALL_URL` + `WALL_SYNC_TOKEN` in `.env` | phone access, ＋/－ feedback sync, read-state across devices, the read-age archive clock |
| X / Instagram | `npx antifeed browser` — launches Brave/Chrome with its own profile on the CDP port; log into X and Instagram there once; `--install` keeps it alive across logins | your real feeds, read-only; `antifeed collect --x-tab ID --instagram` |
| Hosts gate (macOS) | `sudo launchd/install.sh` | the social hosts blocked except during a sweep — for people who want the wall to *replace* the apps |
| Reels | `yt-dlp` + `ffmpeg` (enrichment); `parakeet-mlx` for transcripts (Apple Silicon — elsewhere reels rank on caption + OCR); Cloudflare R2 (`R2_*`) + `wrangler` to self-host video | reels are ranked on real evidence and play inline instead of linking out |

## Running the sweep on a schedule

Any agent that can read a repo can run it. `npx antifeed prompt` prints the kickoff prompt:

```bash
claude -p "$(npx antifeed prompt)"        # Claude Code
codex exec "$(npx antifeed prompt)"       # Codex CLI
```

Put one of those on cron / launchd / a scheduled task — see [docs/scheduling.md](docs/scheduling.md).
Repeat sweeps in a day are fine — the agent reports saturation instead of padding.

## Commands

```bash
antifeed init [DIR]                 # scaffold an instance
antifeed doctor                     # check the instance + optional integrations
antifeed prompt                     # the sweep kickoff prompt, for any agent
antifeed browser [--install]        # dedicated logged-in browser on the CDP port; --install keeps it alive at login
antifeed collect [--x-tab ID] [--instagram[=timeline,reels]]
antifeed enrich-reels --input BUNDLE --ids ID,… --output BUNDLE
antifeed dedup check <url> | grep <term>
antifeed prepend <cards.json>       # validate + prepend kept cards (each needs a shelf life)
antifeed shelf status | todo | apply # shelf-life backfill for cards carded before v1.1.0
antifeed localize-media | localize-video | localize-links
antifeed archive [--dry-run]        # read cards 5 days after first read; unread cards when their shelf life runs out (fails safe without read state)
antifeed build                      # validate + build public/
antifeed publish                    # archive + build; then commit & push
```

Inside this repository the same commands run as `node wall.mjs …` (`wall` remains an alias of `antifeed`).

## Updating

An instance depends on the engine as the `antifeed` package (`github:swapnilraj/antifeed-engine`).
`npm update antifeed` pulls the latest engine — this contract, the collectors, the frontend —
without touching your `algorithm/`, `data/` or media. Pin a tag
(`github:swapnilraj/antifeed-engine#v1.2.0`) if you want to choose when. A Vercel-hosted wall picks
the new engine up on its next deploy.

**v1.1.0 — shelf life.** Unread cards no longer stay forever: each card carries a shelf life
(dated / news / analysis / evergreen) and leaves the wall unread when it runs out. Upgrading
changes nothing for existing cards until they're labelled, and your sweep agent does that itself,
a batch per sweep. Tune or switch it off in `config/shelf-life.json`; see `docs/shelf-life.md`.

## Layout

- `AGENTS.md` — the operating contract the agent follows (`CLAUDE.md` just imports it)
- `wall.mjs` — the `antifeed` CLI; `core/` — schema, dedup, validators, the instance-root resolver
- `collectors/` — public-source, knowledge, market, and read-only browser collectors
- `scripts/` — archive, localizers, build, private experiment report
- `web/`, `wall.html` — the static wall; `api/`, `middleware.js` — the Vercel sync API and auth
- `template/` — what `antifeed init` scaffolds; published as [swapnilraj/antifeed](https://github.com/swapnilraj/antifeed) for the Deploy button. The engine itself is published to [swapnilraj/antifeed-engine](https://github.com/swapnilraj/antifeed-engine) by `antifeed release`; this repository is the private workshop it is built from; `docs/` — the playbooks the contract references
- `launchd/`, `gate.sh` — the optional macOS hosts gate

Read-only on every account, always: the wall never likes, follows, mutes, or posts.
