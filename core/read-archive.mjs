export const READ_GRACE_DAYS = 5;
export const READ_GRACE_MS = READ_GRACE_DAYS * 24 * 60 * 60 * 1000;

export function readArchivePartition(items, reads, { now = Date.now() } = {}) {
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error("now must be a valid date or timestamp");
  const cutoff = nowMs - READ_GRACE_MS;
  const active = [];
  const archived = [];

  for (const item of items) {
    const readAt = reads && typeof reads === "object" ? reads[item.id] : null;
    const readMs = typeof readAt === "string" ? Date.parse(readAt) : NaN;
    if (Number.isFinite(readMs) && readMs <= cutoff) archived.push(item);
    else active.push(item);
  }

  return { active, archived, cutoff: new Date(cutoff).toISOString() };
}
