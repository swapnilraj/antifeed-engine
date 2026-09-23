# Setting up an antifeed — playbook for the agent

The owner will usually say "set this up for me" — or hand you the link <https://github.com/swapnilraj/antifeed>
and nothing else. Either way, this is the ordered, verifiable procedure; if nothing exists on the
machine yet, start at step 0.
Do the steps in order; each ends with a check. **Stop and ask the owner** at every point
marked 🙋 — logins, `sudo`, secrets, and anything installed system-wide (`brew`, `pipx`, `npm -g`) are
theirs to approve. Never paste a secret into chat, a commit,
or any file other than the instance's gitignored `.env`; never read a password back.

Everything after step 3 is optional. Tell the owner which layers you are setting up and why,
and skip any they don't want. `antifeed doctor` is the single source of truth for what is
working; run it after every step.

## 0. Prerequisites

- Node 20+ (`node -v`), git, and either the `claude` or `codex` CLI (whichever is running you).
- macOS: Homebrew (`brew -v`). Linux: `apt`/`dnf`. Windows: winget/scoop; the browser
  keep-alive and hosts gate are not available there (use Task Scheduler / skip).

## 1. The instance

Either the owner already cloned their repo (Deploy-button path), or create one:

```bash
npx github:swapnilraj/antifeed-engine#v1.1.0 init my-antifeed && cd my-antifeed
npm install
cp .env.example .env
npx antifeed doctor     # expect: ✗ interest profile is empty — that's step 2
```

Check: `node_modules/antifeed/AGENTS.md` exists; `doctor` lists the data files as ✓.

`config/sources.json` and `config/knowledge-sources.json` start nearly empty (Hacker News only).
Add the feeds and knowledge topics the interview in step 2 surfaces; don't leave them empty if the
owner named newsletters, blogs, or subjects they want taught.

## 2. The algorithm (required)

The sweep refuses an empty profile, and you must **never invent one**. Interview the owner —
five questions, plain language — and write `algorithm/interests.md` from the answers:

1. What should this feed be *for*? (the north-star paragraph)
2. 6–12 topics they want more of, each with a 1–5 weight and the *angle* they care about.
3. What must never appear (mutes: topics, formats, bait).
4. 3–5 accounts, writers or posts that nail it (exemplars).
5. How adventurous: discovery `low|medium|high`, keep threshold (default 6/10), cap (~15).

Fill the template's sections in place (keep the HTML comments' structure; delete the example).
Check: `npx antifeed doctor` → `✓ interest profile filled in`.

## 3. First local sweep (proves the core)

Run a sweep yourself (`AGENTS.md`), public sources only. Then `npx antifeed build && open
public/index.html`. Check: cards render with `why` lines. Commit: `git add -A && git commit -m
"first sweep"`. If the instance has no remote yet (the `npx … init` path), 🙋 offer to create a
private GitHub repo — `gh repo create <name> --private --source=. --push` — the hosted wall in
step 4 deploys from it.

## 4. Hosted wall on Vercel (phone access, feedback + read sync, the archive clock)

**Preferred:** the owner clicks the Deploy button in the README (🙋 it runs in their browser:
Vercel copies the template into their GitHub, prompts for the four env vars, attaches a Blob
store). If they already did, just collect the URL and token into `.env` (below).

**CLI alternative** (🙋 `vercel login` is interactive; do it with the owner present):

```bash
npm i -g vercel                                    # 🙋 system-wide install
vercel login
vercel link                                        # create/pick the project, accept defaults
vercel blob create-store antifeed                  # Blob store; link it to the project when prompted
# generate the two secrets locally; the owner picks user/password
COOKIE=$(openssl rand -hex 32); SYNC=$(openssl rand -hex 32)
printf '%s' "$COOKIE" | vercel env add WALL_COOKIE_SECRET production
printf '%s' "$SYNC"   | vercel env add WALL_SYNC_TOKEN production
printf '%s' "<user>"     | vercel env add WALL_USER production          # 🙋 owner's choice
printf '%s' "<password>" | vercel env add WALL_PASSWORD production      # 🙋 owner types it; don't echo it
git push -u origin main                            # the connected repo deploys; or: vercel --prod
```

Then in `.env`: `WALL_URL=https://<project>.vercel.app` and `WALL_SYNC_TOKEN=<the same SYNC>`.
Check: `npx antifeed doctor` → `✓ hosted wall — … sync API answers with the token`. Open the
URL in a browser: Basic-auth prompt, then the wall.

## 5. X / Instagram collection — the CDP browser

```bash
npx antifeed browser            # launches Brave/Chrome/Chromium/Edge (auto-detected; --browser PATH for others) with its own profile on port 9222
```

🙋 The owner logs into X and Instagram **in that window** (once; the profile persists under
`~/.antifeed/browser`). You never handle credentials or cookies. Then keep it alive across
logins and crashes so scheduled sweeps always find it:

```bash
npx antifeed browser --install  # macOS LaunchAgent / Linux systemd --user unit; --uninstall to remove
```

Check: `doctor` → `✓ browser CDP` and `✓ browser keep-alive`. Then `npx antifeed collect
--instagram` prints `instagram pipeline verified: N collected`. If X is wanted, open
`x.com/home` in that browser and pass its tab id (`node node_modules/antifeed/collectors/cdp.mjs
tabs`) as `--x-tab`. Add to the instance `AGENTS.md` whether every sweep should include
`--instagram` / X, or only on request.

## 6. Reel toolchain (rank reels on real evidence)

```bash
# 🙋 all system-wide installs — confirm first
# macOS
brew install yt-dlp ffmpeg tesseract
pipx install parakeet-mlx        # Apple Silicon only; or: uv tool install parakeet-mlx
# Debian/Ubuntu
sudo apt install ffmpeg tesseract-ocr imagemagick && pipx install yt-dlp
```

Check: `doctor` → `✓ reel toolchain`, `✓ OCR`, and (Apple Silicon) `✓ speech-to-text`. Without
`parakeet-mlx` reels are ranked on caption + on-screen text — say so in the report, don't fake
transcripts.

## 7. Reel video hosting — Cloudflare R2 (reels play inline)

🙋 Needs a Cloudflare account and an interactive `wrangler login`.

```bash
npm i -g wrangler                                  # 🙋 system-wide install
wrangler login
wrangler r2 bucket create antifeed-reels
wrangler r2 bucket dev-url enable antifeed-reels     # prints https://pub-<hash>.r2.dev
wrangler whoami                                      # shows the Account ID
```

In `.env`: `R2_ACCOUNT_ID=<account id>`, `R2_BUCKET=antifeed-reels`,
`R2_PUBLIC_BASE=https://pub-<hash>.r2.dev`. Object keys are unguessable and the wall is
password-gated, so a public dev URL is acceptable; tell the owner that trade-off.
Check: `doctor` → `✓ R2 (reel video hosting)` and no `✗ wrangler missing`.

## 8. Hosts gate (optional, macOS, needs sudo) — make the wall *replace* the apps

Blocks x.com / instagram.com in `/etc/hosts` except while a sweep opens them, and (redirect
daemon) bounces a blocked visit to the wall. 🙋 Both installers need `sudo`; explain what they
change and let the owner run them:

```bash
sudo node_modules/antifeed/launchd/install.sh              # gate daemon; then ./gate.sh open|close|status
sudo node_modules/antifeed/launchd/install-redirect.sh     # optional bounce-to-wall
```

Copy `node_modules/antifeed/gate.sh` into the instance (`cp … ./gate.sh`) so `./gate.sh` works
from the instance directory, and add "open the gate before collection, close it after" to the
instance `AGENTS.md`. Check: `doctor` → `✓ hosts gate daemon`; `./gate.sh status`.

## 9. Scheduling

Follow `docs/scheduling.md` — one cron/launchd line running `claude -p "$(npx antifeed prompt)"`
(or `codex exec …`) from the instance directory. 🙋 Confirm the cadence with the owner (every
4–6 hours is typical). Check: the next scheduled run appends to `data/runs.js` and the hosted
wall updates.

## 10. Hand-off

Run `npx antifeed doctor` one last time and report every line to the owner: what is on, what
is off and why — and **where things live outside the instance**: the browser profile
(`~/.antifeed/browser`), the keep-alive (`~/Library/LaunchAgents/com.antifeed.browser.plist` or
the systemd user unit), the gate's request file (`~/.wall-gate/`), any cron/launchd entry. Record
owner-specific choices (feeds in scope, gate, cadence) in the instance `AGENTS.md` under "My
rules", commit, and push if a remote exists.
