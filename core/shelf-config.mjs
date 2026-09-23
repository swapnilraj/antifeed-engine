// Loads the instance's shelf-life config (config/shelf-life.json, falling back to
// the engine default) and applies it to the shared model in web/wall-shelf-life.js.
import { existsSync, readFileSync } from "node:fs";
import shelfLife from "../web/wall-shelf-life.js";
import { configPath } from "./paths.mjs";

export function loadShelfConfig() {
  const file = configPath("shelf-life.json");
  const raw = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  return shelfLife.configure(raw);
}

export { shelfLife };

// Cards carded before shelf life existed carry no `shelf` and never expire
// unread. Labelling them is optional — this only makes sure owners know.
// Addressed to the sweep agent, which acts on it (AGENTS.md sweep step 10a).
export function unshelvedNotice(count, { unread = true } = {}) {
  return `${count} ${unread ? "unread" : "live"} card(s) have no shelf life and will never expire unread — ` +
    "sweep agent: label the next batch this sweep (antifeed shelf todo → antifeed shelf apply; AGENTS.md step 10a, docs/shelf-life.md)";
}
