#!/usr/bin/env node
// Small orchestration CLI for the mechanical parts of a wall sweep.
// Qualitative scoring/distillation remains an agent task; collection, data
// lifecycle, validation, and building are deterministic here.
import { execFile, execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { promisify } from "node:util";
import { buildIndex, findCarded } from "./core/dedup.mjs";
import { ENGINE_ROOT, WALL_HOME, enginePath, instancePath, WALL_URL } from "./core/paths.mjs";
import { flagValue } from "./collectors/lib/values.mjs";

const runFile = promisify(execFile);
const args = process.argv.slice(3);
const command = process.argv[2];
const valueOf = flag => flagValue(args, flag);
// Every helper script is an engine file, run against the instance (cwd + WALL_HOME).
const childEnv = { ...process.env, WALL_HOME };

async function node(script, scriptArgs = [], options = {}) {
  const { stdout, stderr } = await runFile(process.execPath, [enginePath(script), ...scriptArgs], {
    cwd: WALL_HOME, env: childEnv, maxBuffer: 20 * 1024 * 1024, ...options,
  });
  if (stderr?.trim()) process.stderr.write(stderr);
  return stdout;
}

// Like node(), but streams output live — for commands that report per-card
// progress over minutes (localizers) rather than returning a result.
function nodeLive(script, scriptArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [enginePath(script), ...scriptArgs], { cwd: WALL_HOME, env: childEnv, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`${script} exited with code ${code}`)));
  });
}

function normalize(candidate) {
  const known = new Set(["id", "source", "url", "author", "handle", "text", "title", "snippet", "image", "stats", "postedAt"]);
  const source = String(candidate.source || "link");
  let url = String(candidate.url || candidate.permalink || "");
  if (url.startsWith("/") && source === "twitter") url = `https://x.com${url}`;
  if (url.startsWith("/") && source === "instagram") url = `https://www.instagram.com${url}`;
  return {
    id: String(candidate.id || ""),
    source,
    url,
    author: String(candidate.author || "Unknown"),
    handle: String(candidate.handle || ""),
    publishedAt: String(candidate.postedAt || ""),
    rawText: String(candidate.snippet || candidate.caption || candidate.text || candidate.alt || candidate.title || ""),
    title: String(candidate.title || candidate.text || ""),
    image: String(candidate.image || ""),
    stats: candidate.stats && typeof candidate.stats === "object" ? candidate.stats : {},
    metadata: Object.fromEntries(Object.entries(candidate).filter(([key]) => !known.has(key))),
  };
}

async function collect() {
  let instagramCollected = 0;
  const jobs = [
    node("collectors/sources.mjs", ["all"]).then(stdout => JSON.parse(stdout)),
    node("collectors/knowledge.mjs", ["all"]).then(stdout => JSON.parse(stdout)),
  ];
  const xTab = valueOf("--x-tab");
  if (xTab) jobs.push(node("collectors/cdp.mjs", ["harvest", xTab, valueOf("--rounds") || "15"]).then(stdout =>
    JSON.parse(stdout).map(candidate => ({ ...candidate, source: "twitter" }))));

  const instagramFlag = args.includes("--instagram") || args.some(arg => arg.startsWith("--instagram="));
  const instagramSurfaces = valueOf("--instagram");
  if (instagramFlag) {
    // Default to BOTH surfaces: the wall is meant to reclaim attention from IG,
    // so harvest timeline + reels unless a specific surface set is requested.
    // Reels still require enrichment (docs/reels.md) before they can be ranked.
    const surfaces = !instagramSurfaces || instagramSurfaces.startsWith("--") ? "timeline,reels" : instagramSurfaces;
    jobs.push(node("collectors/instagram-web.mjs", ["collect", "--surfaces", surfaces,
      "--amount", valueOf("--ig-amount") || "30",
      "--rounds", valueOf("--ig-rounds") || "8"]).then(stdout => {
      const collected = JSON.parse(stdout);
      if (!Array.isArray(collected) || !collected.length)
        throw new Error("Instagram pipeline returned zero candidates");
      instagramCollected = collected.length;
      return collected.map(candidate => ({ ...candidate, source: "instagram" }));
    }));
  }

  const batches = await Promise.all(jobs);
  // Deterministic dedup: drop candidates whose URL (or platform raw id) is
  // already carded, live or archived. Same-story-different-URL stays a
  // ranking-time judgment call — this only kills exact re-cards.
  const cardedIndex = buildIndex();
  const candidates = new Map();
  const alreadyCarded = [];
  let instagramNormalized = 0;
  for (const candidate of batches.flat()) {
    const item = normalize(candidate);
    if (!item.id || !item.url) continue;
    if (item.source === "instagram") instagramNormalized++;
    const hit = findCarded(cardedIndex, item.url);
    if (hit) { alreadyCarded.push(`${item.source}:${item.id} → ${hit.id} (${hit.where})`); continue; }
    candidates.set(`${item.source}:${item.id}`, item);
  }
  if (alreadyCarded.length) {
    console.log(`dedup index dropped ${alreadyCarded.length} already-carded candidate(s):`);
    for (const line of alreadyCarded) console.log(`  ${line}`);
  }
  if (instagramFlag && !instagramNormalized)
    throw new Error("Instagram candidates were collected but none survived normalization");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const output = valueOf("--output") || `scratch/candidates-${stamp}.json`;
  const outputFile = resolve(WALL_HOME, output);
  const profile = {
    interests: await readFile(instancePath("algorithm", "interests.md"), "utf8"),
    boosts: await readFile(instancePath("algorithm", "boosts.md"), "utf8"),
  };
  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, JSON.stringify({ collectedAt: new Date().toISOString(), profile, candidates: [...candidates.values()] }, null, 2) + "\n");
  console.log(`collected ${candidates.size} normalized candidates → ${output}`);
  if (instagramFlag)
    console.log(`instagram pipeline verified: ${instagramCollected} collected, ${instagramNormalized} normalized`);
  if (!xTab && !instagramFlag)
    console.log("external and knowledge sources only; pass --x-tab ID and/or --instagram[=SURFACES] to include social feeds");
}

async function archive() {
  process.stdout.write(await node("scripts/archive-items.mjs", args));
}

async function enrichReels() {
  const input = valueOf("--input");
  if (!input) throw new Error("--input PATH is required for enrich-reels");
  const enrichArgs = ["enrich", "--input", input];
  for (const flag of ["--ids", "--limit", "--output"]) {
    const value = valueOf(flag);
    if (value) enrichArgs.push(flag, value);
  }
  process.stdout.write(await node("collectors/instagram-reel-enricher.mjs", enrichArgs));
}

async function build() {
  // build-site is the validation gate for every data file.
  process.stdout.write(await node("scripts/build-site.mjs"));
}

async function publish() {
  if (args.includes("--deploy"))
    throw new Error("--deploy was removed; commit and push main to deploy through GitHub");
  await archive();
  await build();
  console.log("release ready — commit and push to main; Vercel deploys it through GitHub");
}

// The engine's operating contract, for any agent (Claude Code, Codex, …).
const CONTRACT = enginePath("AGENTS.md");

// PATH lookup without a shell (cross-platform `which`).
function whichBin(name) {
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of (process.env.PATH || "").split(delimiter))
    for (const ext of exts) { const p = join(dir, name + ext); if (dir && existsSync(p)) return p; }
  return null;
}

// Chromium-family browser for X / Instagram collection, in preference order.
function findBrowser() {
  if (process.env.ANTIFEED_BROWSER) return process.env.ANTIFEED_BROWSER;
  if (process.platform === "darwin")
    for (const app of ["Brave Browser", "Google Chrome", "Chromium", "Microsoft Edge", "Vivaldi", "Opera", "Arc"]) {
      const p = `/Applications/${app}.app/Contents/MacOS/${app}`;
      if (existsSync(p)) return p;
    }
  for (const bin of ["brave-browser", "brave", "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "vivaldi", "opera"]) {
    const p = whichBin(bin); if (p) return p;
  }
  return null;
}

async function cdpVersion(port) {
  try { const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) }); return (await r.json()).Browser || "reachable"; }
  catch { return null; }
}

// Launch a DEDICATED browser profile with the debugging port open, so the
// collectors never depend on how the user's daily browser was started and the
// port can't be taken by a stray headless instance. Log into X / Instagram once
// in that window; the profile persists under ~/.antifeed/browser.
// Keep-alive for the CDP browser: a user-level launchd agent (macOS) or a
// systemd --user unit (Linux) that starts it at login and relaunches it if it
// is closed, so scheduled sweeps always find a logged-in browser on the port.
const KEEPALIVE = { label: "com.antifeed.browser", unit: "antifeed-browser" };
function keepAlivePath() {
  return process.platform === "darwin" ? join(homedir(), "Library", "LaunchAgents", `${KEEPALIVE.label}.plist`)
    : process.platform === "linux" ? join(homedir(), ".config", "systemd", "user", `${KEEPALIVE.unit}.service`) : null;
}
function installKeepAlive(exe, flags) {
  const file = keepAlivePath();
  if (!file) throw new Error("keep-alive install supports macOS (launchd) and Linux (systemd --user); on Windows add the printed command as a logon task in Task Scheduler");
  mkdirSync(dirname(file), { recursive: true });
  const xml = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  if (process.platform === "darwin") {
    writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n  <key>Label</key><string>${KEEPALIVE.label}</string>\n  <key>ProgramArguments</key><array>\n${[exe, ...flags].map(a => `    <string>${xml(a)}</string>`).join("\n")}\n  </array>\n  <key>RunAtLoad</key><true/>\n  <key>KeepAlive</key><true/>\n  <key>ProcessType</key><string>Interactive</string>\n</dict></plist>\n`);
    try { execFileSync("launchctl", ["bootout", `gui/${process.getuid()}/${KEEPALIVE.label}`], { stdio: "ignore" }); } catch {}
    execFileSync("launchctl", ["bootstrap", `gui/${process.getuid()}`, file], { stdio: "inherit" });
  } else {
    const q = a => `"${a.replace(/"/g, '\\"')}"`;
    writeFileSync(file, `[Unit]\nDescription=antifeed CDP browser (logged-in X / Instagram session)\nAfter=graphical-session.target\n\n[Service]\nExecStart=${[exe, ...flags].map(q).join(" ")}\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n`);
    execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
    execFileSync("systemctl", ["--user", "enable", "--now", KEEPALIVE.unit], { stdio: "inherit" });
  }
  console.log(`installed keep-alive: ${file}\nThe browser now starts at login and relaunches if closed. Remove with: antifeed browser --uninstall`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function launchdLoaded() {
  try { execFileSync("launchctl", ["print", `gui/${process.getuid()}/${KEEPALIVE.label}`], { stdio: "ignore" }); return true; } catch { return false; }
}
async function uninstallKeepAlive() {
  const file = keepAlivePath();
  if (!file) { console.log("keep-alive is only installed on macOS/Linux"); return; }
  if (process.platform === "darwin") {
    // bootout returns before the unload completes (and exits non-zero while "in
    // progress"), so poll; fall back to the legacy `remove` if it's still there.
    if (launchdLoaded()) {
      try { execFileSync("launchctl", ["bootout", `gui/${process.getuid()}/${KEEPALIVE.label}`], { stdio: "ignore" }); } catch {}
      for (let i = 0; i < 20 && launchdLoaded(); i++) await sleep(250);
      if (launchdLoaded()) { try { execFileSync("launchctl", ["remove", KEEPALIVE.label], { stdio: "ignore" }); } catch {} }
      for (let i = 0; i < 20 && launchdLoaded(); i++) await sleep(250);
      if (launchdLoaded()) throw new Error(`launchd still has ${KEEPALIVE.label} loaded — run: launchctl bootout gui/$(id -u)/${KEEPALIVE.label}`);
    }
  } else {
    try { execFileSync("systemctl", ["--user", "disable", "--now", KEEPALIVE.unit], { stdio: "ignore" }); } catch {}
  }
  if (existsSync(file)) { rmSync(file, { force: true }); console.log(`removed ${file}`); }
  else console.log("no keep-alive file; launchd entry cleared");
}

async function browser() {
  const port = process.env.CDP_PORT || 9222;
  const profile = process.env.ANTIFEED_BROWSER_PROFILE || join(homedir(), ".antifeed", "browser");
  if (args.includes("--uninstall")) { await uninstallKeepAlive(); return; }
  const exe = valueOf("--browser") || findBrowser();
  if (!exe) throw new Error("no Chromium-family browser found — install Brave/Chrome/Chromium/Edge, or pass --browser <path> (or set ANTIFEED_BROWSER). Firefox and Safari don't speak CDP.");
  const base = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check"];
  const flags = [...base, "https://x.com/home", "https://www.instagram.com/"];
  if (args.includes("--print")) { console.log([exe, ...flags].map(a => /\s/.test(a) ? JSON.stringify(a) : a).join(" ")); return; }
  if (args.includes("--install")) { mkdirSync(profile, { recursive: true }); installKeepAlive(exe, base); return; }
  const running = await cdpVersion(port);
  if (running) { console.log(`a browser already answers on CDP ${port} (${running}) — nothing to launch. Log into X / Instagram in it if you haven't.`); return; }
  mkdirSync(profile, { recursive: true });
  const child = spawn(exe, flags, { detached: true, stdio: "ignore" });
  child.unref();
  console.log(`launched ${basename(exe)} on CDP ${port} with its own profile at ${profile}\n` +
    "Log into X and Instagram in that window (once — the profile persists) and keep it open during sweeps.\n" +
    "`antifeed doctor` reports it as \"browser CDP\"; `antifeed collect --instagram` and `--x-tab` use it.");
}

function prompt() {
  process.stdout.write(
    `Run one full sweep of the antifeed wall in ${WALL_HOME}. ` +
    `Read AGENTS.md in that directory first (it points at the engine contract, ${CONTRACT}) — it is the authority. ` +
    "Harvest → rank against algorithm/interests.md and algorithm/boosts.md → keep only what clears the threshold → " +
    "card, knowledge-base, run record, publish. Read-only on every external account. Finish with the run report.\n");
}

// Scaffold a new instance directory from the bundled template.
function init() {
  const target = resolve(args.find(a => !a.startsWith("--")) || ".");
  if (existsSync(join(target, "algorithm", "interests.md")))
    throw new Error(`${target} already looks like a wall instance (algorithm/interests.md exists)`);
  mkdirSync(target, { recursive: true });
  cpSync(enginePath("template"), target, { recursive: true, filter: src => !src.endsWith(".DS_Store") });
  // Dotfiles can't be published inside an npm tarball under their real name.
  for (const [from, to] of [["_gitignore", ".gitignore"], ["_env.example", ".env.example"]])
    if (existsSync(join(target, from))) { cpSync(join(target, from), join(target, to)); rmSync(join(target, from), { force: true }); }
  // Source configs come from the template (neutral starters), never from the
  // engine checkout's own — those are the maintainer's curated feeds.
  // Pin the new instance to THIS engine's release, so every tag is self-consistent.
  const { version, repository } = JSON.parse(readFileSync(enginePath("package.json"), "utf8"));
  const spec = valueOf("--engine") || `${repository}#v${version}`;
  const pkgFile = join(target, "package.json");
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
  pkg.dependencies["antifeed"] = spec;
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");
  try { execFileSync("git", ["init", "-q"], { cwd: target, stdio: "ignore" }); } catch { /* git optional */ }
  console.log(`created antifeed instance at ${target}

next:
  cd ${target}
  npm install
  edit algorithm/interests.md   # your algorithm — the sweep refuses to run while it is empty
  claude    # or: codex   — then say "run a sweep"    (or: npx antifeed prompt | pbcopy)
  npx antifeed build && open public/index.html   # local, no deploy needed
See README.md there for the hosted (Vercel) and social-feed (X / Instagram) setup.`);
}

// Cut an engine release in one step: bump version, retarget every `#v<old>` pin
// in the engine's own docs, commit, tag, push, and move the template repo's pin
// (via gh) so the Deploy-button path installs the new engine. Only from a clean
// main with green tests.
async function release() {
  const pkgFile = enginePath("package.json");
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
  const dry = args.includes("--dry-run");
  const level = args.find(a => !a.startsWith("--")) || "patch";
  const [ma, mi, pa] = pkg.version.split(".").map(Number);
  const next = /^\d+\.\d+\.\d+$/.test(level) ? level
    : level === "major" ? `${ma + 1}.0.0` : level === "minor" ? `${ma}.${mi + 1}.0` : level === "patch" ? `${ma}.${mi}.${pa + 1}`
    : (() => { throw new Error(`release: expected patch | minor | major | x.y.z, got "${level}"`); })();
  const git = (...a) => execFileSync("git", a, { cwd: ENGINE_ROOT, encoding: "utf8" }).trim();
  if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") throw new Error("release: run from main");
  if (git("status", "--porcelain")) throw new Error("release: working tree is not clean");
  console.log(`release: v${pkg.version} → v${next}${dry ? " (dry run)" : ""}`);
  execFileSync("npm", ["test"], { cwd: ENGINE_ROOT, stdio: "inherit" });
  const pack = execFileSync("npm", ["pack", "--dry-run"], { cwd: ENGINE_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (/npm notice [\d.]+[kMB]+ +(data|media|algorithm)\//.test(pack)) throw new Error("release: the package would ship instance data — fix .npmignore");
  const pin = `${pkg.repository}#v`;
  const files = ["README.md", "docs/setup.md", "AGENTS.md", "template/README.md", "template/AGENTS.md"].map(f => enginePath(f)).filter(existsSync);
  const touched = [];
  for (const f of files) {
    const before = readFileSync(f, "utf8");
    const after = before.split(`${pin}${pkg.version}`).join(`${pin}${next}`);
    if (after !== before) { touched.push(f); if (!dry) writeFileSync(f, after); }
  }
  console.log(`retargeted pins in: ${touched.map(f => f.slice(ENGINE_ROOT.length)).join(", ") || "(none)"}`);
  if (dry) return;
  pkg.version = next; writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");
  git("add", "-A"); git("commit", "-q", "-m", `Release v${next}`);
  git("tag", "-a", `v${next}`, "-m", `antifeed engine v${next}`);
  git("push", "-q", "origin", "main"); git("push", "-q", "origin", `v${next}`);
  console.log(`pushed main + tag v${next}`);

  // 1. Public engine repo: exactly the file set `npm pack` ships (leak-checked
  //    above), as a fresh commit + the same tag. This dev repo stays private —
  //    it doubles as the maintainer's own wall — so this is the install target.
  const tmp = mkdtempSync(join(tmpdir(), "antifeed-release-"));
  const gitIn = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const engineRepo = pkg.config?.engineRepo;
  if (engineRepo) {
    execFileSync("npm", ["pack", "--pack-destination", tmp], { cwd: ENGINE_ROOT, stdio: "ignore" });
    const tgz = readdirSync(tmp).find(f => f.endsWith(".tgz"));
    execFileSync("tar", ["-xzf", join(tmp, tgz), "-C", tmp]);
    const pub = join(tmp, "engine");
    execFileSync("git", ["clone", "-q", `git@github.com:${engineRepo}.git`, pub], { stdio: "ignore" });
    for (const e of readdirSync(pub)) if (e !== ".git") rmSync(join(pub, e), { recursive: true, force: true });
    cpSync(join(tmp, "package"), pub, { recursive: true });
    writeFileSync(join(pub, ".gitignore"), "node_modules\npublic/\nscratch/\n.env*\n.DS_Store\n");
    gitIn(pub, "add", "-A");
    if (gitIn(pub, "status", "--porcelain")) gitIn(pub, "commit", "-q", "-m", `antifeed engine v${next}`);
    gitIn(pub, "tag", "-a", `v${next}`, "-m", `antifeed engine v${next}`);
    gitIn(pub, "push", "-q", "origin", "HEAD:main"); gitIn(pub, "push", "-q", "origin", `v${next}`);
    console.log(`engine ${engineRepo}: published v${next} (${readdirSync(join(tmp, "package")).length} top-level entries)`);
  }
  // 2. Template repo: the whole template/ dir (so README/AGENTS/config stay one
  //    source of truth), with its engine pin at this release.
  const templateRepo = pkg.config?.templateRepo;
  if (templateRepo) {
    const tpl = join(tmp, "template");
    execFileSync("git", ["clone", "-q", `git@github.com:${templateRepo}.git`, tpl], { stdio: "ignore" });
    for (const e of readdirSync(tpl)) if (e !== ".git") rmSync(join(tpl, e), { recursive: true, force: true });
    cpSync(enginePath("template"), tpl, { recursive: true, filter: src => !src.endsWith(".DS_Store") });
    for (const [from, to] of [["_gitignore", ".gitignore"], ["_env.example", ".env.example"]])
      if (existsSync(join(tpl, from))) { cpSync(join(tpl, from), join(tpl, to)); rmSync(join(tpl, from), { force: true }); }
    const tp = JSON.parse(readFileSync(join(tpl, "package.json"), "utf8"));
    tp.dependencies.antifeed = `${pin}${next}`; writeFileSync(join(tpl, "package.json"), JSON.stringify(tp, null, 2) + "\n");
    gitIn(tpl, "add", "-A");
    if (gitIn(tpl, "status", "--porcelain")) { gitIn(tpl, "commit", "-q", "-m", `antifeed template for engine v${next}`); gitIn(tpl, "push", "-q", "origin", "HEAD:main"); console.log(`template ${templateRepo}: synced, pinned to v${next}`); }
    else console.log(`template ${templateRepo}: already current`);
  }
  rmSync(tmp, { recursive: true, force: true });
}

// Quick health check for onboarding: what works, what is optional and unset.
async function doctor() {
  const ok = (label, detail = "") => console.log(`  ✓ ${label}${detail ? " — " + detail : ""}`);
  const warn = (label, detail = "") => console.log(`  · ${label}${detail ? " — " + detail : ""}`);
  const bad = (label, detail = "") => { console.log(`  ✗ ${label}${detail ? " — " + detail : ""}`); failures++; };
  let failures = 0;
  console.log(`antifeed doctor — instance ${WALL_HOME}${WALL_HOME === ENGINE_ROOT.replace(/\/$/, "") ? " (engine checkout)" : ""}`);
  const major = Number(process.versions.node.split(".")[0]);
  major >= 20 ? ok(`node ${process.versions.node}`) : bad(`node ${process.versions.node}`, "need 20+");
  for (const name of ["algorithm/interests.md", "algorithm/boosts.md", "data/items.js", "data/runs.js", "data/learning.js", "data/openness.js", "AGENTS.md"])
    existsSync(instancePath(name)) ? ok(name) : bad(name, "missing — run `antifeed init`");
  if (existsSync(instancePath("algorithm", "interests.md"))) {
    const md = readFileSync(instancePath("algorithm", "interests.md"), "utf8");
    const body = (md.split(/^## Interests/m)[1] || "").split(/^## /m)[0].replace(/<!--[\s\S]*?-->/g, "");
    /^\s*-\s+\*\*/m.test(body) ? ok("interest profile filled in") : bad("interest profile is empty", "the sweep will stop and ask for it");
  }
  try { await node("core/validate-items.mjs"); await node("core/validate-runs.mjs"); await node("core/validate-learning.mjs"); await node("core/validate-openness.mjs"); ok("data files validate"); }
  catch (e) { bad("data validation", e.message.split("\n")[0]); }
  if (WALL_URL && process.env.WALL_SYNC_TOKEN) {
    try {
      const r = await fetch(`${WALL_URL}/api/reads`, { headers: { authorization: `Bearer ${process.env.WALL_SYNC_TOKEN}` }, signal: AbortSignal.timeout(8000) });
      r.ok ? ok("hosted wall", `${WALL_URL} — sync API answers with the token`) : bad("hosted wall", `${WALL_URL}/api/reads returned ${r.status} — WALL_SYNC_TOKEN must match the Vercel env var`);
    } catch (e) { bad("hosted wall", `${WALL_URL} unreachable (${e.message})`); }
  } else if (WALL_URL || process.env.WALL_SYNC_TOKEN) bad("hosted wall", "set BOTH WALL_URL and WALL_SYNC_TOKEN in .env (the token must equal the Vercel env var)");
  else warn("no hosted wall", "local-only: no feedback/read sync or archive clock until you deploy (see README: Deploy to Vercel)");
  if (process.env.WALL_OBSIDIAN_VAULT) ok("Obsidian vault", process.env.WALL_OBSIDIAN_VAULT); // opt-in extra, not part of setup
  (process.env.R2_ACCOUNT_ID && process.env.R2_BUCKET && process.env.R2_PUBLIC_BASE) ? ok("R2 (reel video hosting)") : warn("R2 unset", "optional: Instagram reels can't be self-hosted");
  const cdp = await cdpVersion(process.env.CDP_PORT || 9222);
  cdp ? ok("browser CDP", cdp) : warn("no browser on CDP " + (process.env.CDP_PORT || 9222), "optional: X/Instagram collection — run `antifeed browser`, log into X/IG there");
  const ka = keepAlivePath();
  (ka && existsSync(ka)) ? ok("browser keep-alive", ka) : warn("no browser keep-alive", "optional: `antifeed browser --install` starts the CDP browser at login and relaunches it, so scheduled sweeps always find it");
  const has = n => !!whichBin(n);
  (has("yt-dlp") && has("ffmpeg") && has("ffprobe")) ? ok("reel toolchain", "yt-dlp + ffmpeg + ffprobe") : warn("reel toolchain incomplete", "optional: Instagram reels need yt-dlp, ffmpeg, ffprobe");
  has("parakeet-mlx") ? ok("speech-to-text", "parakeet-mlx") : warn("no speech-to-text", "optional: reels are ranked on caption + on-screen text only (parakeet-mlx is Apple-Silicon only)");
  ((process.platform === "darwin" && has("swift")) || has("tesseract")) ? ok("OCR", process.platform === "darwin" && has("swift") ? "macOS Vision" : "tesseract") : warn("no OCR", "optional: text-on-screen reels can't be read — install tesseract");
  (has("sips") || has("magick") || has("identify")) ? ok("image tool", has("sips") ? "sips" : "ImageMagick") : warn("no image tool", "link lead images are kept unguarded/unresized — install ImageMagick");
  if (process.env.R2_BUCKET && !has("wrangler")) bad("wrangler missing", "R2 is configured but wrangler isn't on PATH (npm i -g wrangler; wrangler login)");
  existsSync(join(process.env.HOME || "", ".wall-gate", "request")) ? ok("hosts gate daemon") : warn("hosts gate not installed", "optional, macOS: launchd/install.sh — collection works without it");
  console.log(failures ? `\n${failures} problem(s) to fix.` : "\nready — public sources work now; the rest is optional.");
  if (failures) process.exit(1);
}

try {
  if (command === "collect") await collect();
  else if (command === "enrich-reels") await enrichReels();
  else if (command === "localize-media") await nodeLive("scripts/localize-ig-media.mjs", args);
  else if (command === "localize-video") await nodeLive("scripts/localize-ig-video.mjs", args);
  else if (command === "localize-links") await nodeLive("scripts/localize-link-media.mjs", args);
  else if (command === "dedup") await nodeLive("core/dedup.mjs", args);
  else if (command === "prepend") await nodeLive("core/items-store.mjs", ["prepend", ...args]);
  else if (command === "openness-report") await nodeLive("scripts/openness-report.mjs", args);
  else if (command === "archive") await archive();
  else if (command === "build") await build();
  else if (command === "publish") await publish();
  else if (command === "init") init();
  else if (command === "prompt") prompt();
  else if (command === "doctor") await doctor();
  else if (command === "browser") await browser();
  else if (command === "release") await release();
  else {
    console.error("usage: antifeed init [DIR] [--engine SPEC]                    (scaffold a new wall instance)\n" +
      "       antifeed doctor                                           (check the instance + optional integrations)\n" +
      "       antifeed browser [--browser PATH] [--print|--install|--uninstall]   (dedicated logged-in browser on the CDP port; --install keeps it alive at login)\n" +
      "       antifeed prompt                                           (print the sweep kickoff prompt for any agent)\n" +
      "       antifeed collect [--x-tab ID] [--instagram[=timeline,reels]] [--ig-amount N] [--ig-rounds N] [--rounds N] [--output PATH]\n" +
      "       antifeed enrich-reels --input PATH [--ids ID,...] [--limit N] [--output PATH]\n" +
      "       antifeed localize-media [--refresh] [id ...]     (IG gate open; covers, carousel slides, avatars)\n" +
      "       antifeed localize-video [id ...]                 (IG gate open; self-host reel mp4s on R2)\n" +
      "       antifeed localize-links [id ...]                 (no gate; article lead images for link/rss/HN cards)\n" +
      "       antifeed dedup check|grep <term> ...             (is this already carded, live or archived?)\n" +
      "       antifeed prepend <cards.json>                    (validate + prepend kept cards to items.js)\n" +
      "       antifeed openness-report [--state JSON] [--vault PATH] [--now ISO]\n" +
      "       antifeed archive [--dry-run] [--reads PATH] [--now ISO]\n" +
      "       antifeed build                                            (validate + build public/)\n" +
      "       antifeed release [patch|minor|major|x.y.z] [--dry-run]     (engine maintainers: bump, retarget pins, tag, push, move the template pin)\n" +
      "       antifeed publish                                          (archive + build; then commit & push)");
    process.exit(2);
  }
} catch (error) {
  console.error(`wall ${command || ""} failed:`, error.message);
  process.exit(1);
}
