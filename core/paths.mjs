// Where things live. The ENGINE is this package (code, frontend assets, default
// config). The INSTANCE is a wall's own directory (profile, cards, media,
// secrets) — `WALL_HOME`, defaulting to the current working directory. Running
// the engine from its own checkout keeps engine === instance, so nothing
// changes for a single-repo setup; an instance scaffolded by `wall init` has
// the engine in node_modules/social-wall instead.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ENGINE_ROOT = fileURLToPath(new URL("../", import.meta.url));
export const WALL_HOME = resolve(process.env.WALL_HOME || process.cwd());

export const enginePath = (...parts) => join(ENGINE_ROOT, ...parts);
export const instancePath = (...parts) => join(WALL_HOME, ...parts);

// Instance config overrides the engine default of the same name.
export function configPath(name) {
  const own = instancePath("config", name);
  return existsSync(own) ? own : enginePath("config", name);
}

// Minimal KEY=VALUE loader (no dependency). Fills process.env without
// overriding values already set. `.env` is the one file a new instance needs;
// `.env.sync` / `.env.r2` are honoured for existing setups.
export function loadEnv(files = [".env", ".env.sync", ".env.r2"]) {
  for (const name of files) {
    const file = instancePath(name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m || line.trim().startsWith("#")) continue;
      let value = m[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
        value = value.slice(1, -1);
      else value = value.replace(/\s+#.*$/, "");
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
  }
  return process.env;
}
loadEnv();

// The deployed wall's origin (sync API base). Unset means "no remote": scripts
// that need it must fail safe, never guess.
export const WALL_URL = (process.env.WALL_URL || "").replace(/\/$/, "");
