# Validation, viewing, and deployment

## Completion path

Prepare a release locally with the unified command:

```bash
node wall.mjs publish
```

It pulls authoritative first-read timestamps, archives only cards read at least
five full days ago, validates cards, run logs, and adaptive learning tracks, then
builds `public/`. Unread cards never age out, regardless of feed length.
If that succeeds, deploy through the connected GitHub integration:

```bash
git add <intended files>
git commit -m "Describe the release"
git push origin main
```

Vercel automatically creates previews for branch pushes and a production
deployment for pushes to `main`. The Vercel CLI is not part of the release
path. Never push after a validation or build failure, and confirm the social
gate is closed before reporting completion.

For diagnosis, run `npm run validate` and `node scripts/build-site.mjs`
separately.

## Viewing and privacy

- Local: open `wall.html`; it remains usable from `file://`.
- Private hosted wall: the origin in `WALL_URL` (`.env`).
- `middleware.js` enforces Basic Auth; `WALL_USER` and `WALL_PASSWORD` are Vercel environment variables and must never enter the repo.
- A successful Basic page load is upgraded to a 30-day stateless cookie (`wall_auth=<expiry>.<hmac>`, signed with the `WALL_COOKIE_SECRET` Vercel env var) via a one-time 307, so the browser prompt appears at most once a month per device. Rotating the secret logs every browser out; if it is unset the wall falls back to plain per-session Basic. The secret also lives in the local gitignored `.env` so a sweep can mint a cookie to smoke-test the flow (`WALL_USER`/`WALL_PASSWORD` are Sensitive-type and cannot be pulled). Env-var changes require a redeploy to reach the middleware.
- The sync API also accepts the private `WALL_SYNC_TOKEN` Bearer token — checked before the cookie/Basic path, so machine clients never touch cookies. Keep `.env` local and gitignored.
- The deployment contains the built `public/` site and middleware, not the algorithm profile, operator manuals, gates, or browser automation.

`scripts/build-site.mjs` is the one supported site builder. The older standalone phone-artifact path has been removed; Vercel is the phone/remote delivery path.

## Data lifecycle

To reconcile the wall and archives without building, run:

```bash
node wall.mjs archive
```

The command reads `/api/reads` using `WALL_SYNC_TOKEN` (from the instance `.env`, or the local, gitignored
`.env.sync`). A card is eligible only when its first-read timestamp is at least
120 hours old. If read state cannot be loaded, it fails safe by leaving every
card active. Existing count-based archives are reconciled too, restoring any
unread or recently-read cards to the wall.

## Recovery notes

- Authentication change: update the relevant Vercel environment variable and redeploy; never paste credentials into tracked files.
- Missing remote images: verify source/CDN URLs and build output. Do not reintroduce a standalone artifact as a workaround.
- Failed Git deployment: keep the last production version, inspect the Vercel check attached to the commit, fix locally, rerun validation/build, then push the fix.
- Interrupted collection: close collection tabs and run `./gate.sh close` before resuming publish work.
