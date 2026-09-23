import shelfLife from "../web/wall-shelf-life.js";

export const READ_GRACE_DAYS = 5;
export const READ_GRACE_MS = READ_GRACE_DAYS * 24 * 60 * 60 * 1000;

// A card leaves the wall five full days after its first read, or — while still
// unread — once its shelf life runs out (web/wall-shelf-life.js). Cards without
// a shelf never expire unread.
export function readArchivePartition(items, reads, { now = Date.now() } = {}) {
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error("now must be a valid date or timestamp");
  const cutoff = nowMs - READ_GRACE_MS;
  const active = [];
  const archived = [];
  const expired = [];

  for (const item of items) {
    const readAt = reads && typeof reads === "object" ? reads[item.id] : null;
    const readMs = typeof readAt === "string" ? Date.parse(readAt) : NaN;
    if (Number.isFinite(readMs)) {
      if (readMs <= cutoff) archived.push(item);
      else active.push(item);
    } else if (shelfLife.isExpired(item, nowMs)) {
      archived.push(item);
      expired.push(item);
    } else active.push(item);
  }

  return { active, archived, expired, cutoff: new Date(cutoff).toISOString() };
}
