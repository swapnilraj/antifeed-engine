# antifeed

> ## 🤖 If you are an AI agent reading this because someone handed you this link
> You're being asked to set up **antifeed** — a feed where *their own algorithm*, a markdown file,
> decides what they see — and to onboard them. Do this, in order, in the directory they want it in
> (ask if unclear; a new folder called `antifeed` is a fine default):
>
> 1. Read the full playbook first: <https://raw.githubusercontent.com/swapnilraj/antifeed-engine/main/docs/setup.md>
> 2. Create the instance: `npx -y github:swapnilraj/antifeed-engine#v1.0.2 init antifeed && cd antifeed && npm install`
>    (or, if they already cloned this repo: `npm install` in it). The playbook is then also at
>    `node_modules/antifeed/docs/setup.md`, and `AGENTS.md` in the instance points at the engine contract.
> 3. Follow the playbook end to end. It is written for you: exact commands, an `npx antifeed doctor`
>    check after every step, and 🙋 markers where you must **stop and ask the person** — logins, `sudo`,
>    secrets. Interview them for `algorithm/interests.md`; never invent a profile. Secrets go only in
>    the gitignored `.env`; never echo them.
> 4. Finish with the `doctor` readout, run their first sweep, and hand over.
>
> Everything after the profile is optional (hosted wall, X/Instagram, reels, scheduling). Say which
> layers you're setting up and why; skip any they don't want.

A feed where **my own algorithm** — `algorithm/interests.md`, a markdown file — decides what I
see. A coding agent runs the sweep; the [antifeed-engine](https://github.com/swapnilraj/antifeed-engine)
engine does the deterministic parts. This repo holds only what is mine.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fswapnilraj%2Fantifeed&project-name=antifeed&repository-name=antifeed&env=WALL_USER,WALL_PASSWORD,WALL_COOKIE_SECRET,WALL_SYNC_TOKEN&envDescription=Basic-auth%20user%2Fpassword%20for%20your%20private%20wall%2C%20a%20random%20cookie%20secret%2C%20and%20a%20random%20machine%20token%20the%20sweep%20uses%20to%20sync%20(put%20the%20same%20token%20in%20your%20local%20.env)&envLink=https%3A%2F%2Fgithub.com%2Fswapnilraj%2Fantifeed%23hosted-wall&stores=%5B%7B%22type%22%3A%22blob%22%7D%5D)

**Easiest:** open this directory in `claude` or `codex` and say **"set this up"** — the agent follows
the engine's setup playbook (Vercel, browser, toolchain, R2, scheduling), asking you only for logins
and secrets. By hand:

```bash
npm install                      # pulls the engine
$EDITOR algorithm/interests.md   # your algorithm (required — the sweep refuses an empty profile)
cp .env.example .env             # fill WALL_URL + WALL_SYNC_TOKEN only if you have a hosted wall
npx antifeed doctor              # what works, what's optional
claude                           # or: codex — then say: run a sweep
npx antifeed build && open public/index.html
```

`npx antifeed prompt` prints a kickoff prompt if you'd rather script it: `claude -p "$(npx antifeed prompt)"` /
`codex exec "$(npx antifeed prompt)"`. Put that on a cron for a recurring sweep.

Optional layers, each a line or two in `.env` (see `.env.example`): a private hosted wall on
Vercel (`WALL_URL` + `WALL_SYNC_TOKEN`, read-state sync across devices), self-hosted reel video (R2), and X / Instagram collection through `npx antifeed browser`
(a dedicated logged-in Brave/Chrome profile on the CDP port). The engine README covers each.

## Hosted wall

The Deploy button creates the Vercel project with `WALL_USER` / `WALL_PASSWORD` (your login),
`WALL_COOKIE_SECRET` (any long random string) and `WALL_SYNC_TOKEN` (another — the sweep's machine
token), and attaches a Blob store. Copy the deployment URL into `.env` as `WALL_URL` and the same
`WALL_SYNC_TOKEN` next to it; `npx antifeed doctor` confirms the two sides agree. Each sweep ends
with a push to `main`, which redeploys.

Updating the engine: `npm update antifeed` (or pin a tag in `package.json`).
