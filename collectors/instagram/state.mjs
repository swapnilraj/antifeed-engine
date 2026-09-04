import { appendFile, chmod, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const STATE_DIR = process.env.SOCIAL_WALL_STATE_DIR ||
  join(homedir(), ".local", "state", "antifeed");
const AUDIT_PATH = join(STATE_DIR, "instagram-collections.jsonl");

function gateIsClosed(hosts) {
  return hosts.split("\n").some(line => {
    const fields = line.trim().split(/\s+/);
    if (!fields[0] || fields[0].startsWith("#") || !["127.0.0.1", "::1"].includes(fields[0]))
      return false;
    return fields.slice(1).some(host => host === "instagram.com" || host.endsWith(".instagram.com"));
  });
}

export async function requireOpenInstagramGate() {
  if (gateIsClosed(await readFile("/etc/hosts", "utf8")))
    throw new Error("Instagram gate is closed; run `./gate.sh open instagram` first");
}

export async function auditInstagramCollection(event) {
  try {
    await mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
    await chmod(STATE_DIR, 0o700);
    await appendFile(AUDIT_PATH, JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n",
      { mode: 0o600 });
    await chmod(AUDIT_PATH, 0o600);
  } catch {
    console.error("instagram collector warning: could not write the local audit event");
  }
}

export function instagramFailureKind(error) {
  const message = String(error?.message || "");
  if (message.includes("gate is closed")) return "gate_closed";
  if (message.includes("not logged into Instagram")) return "authentication_missing";
  if (/CDP|websocket|tab with id/i.test(message)) return "browser_control_error";
  return "collector_error";
}
