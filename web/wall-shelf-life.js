// Shelf life: how long an UNREAD card stays worth showing. The sweep sets it per
// card at carding time (it knows what the piece is); the archive retires unread
// cards whose shelf life has run out, and the feed shows older unread cards less
// often. Read cards still follow the read clock (core/read-archive.mjs) — shelf
// life only bounds the unread pile. Shared by the browser and Node.
//
//   dated      worthless after a real end date (event, booking window, market
//              call) — `until` is required and is the last useful day
//   news       a take on something that just happened
//   analysis   an explainer of a current situation
//   evergreen  ideas/history/science/craft — a long ceiling so it can't become
//              the new pile
//
// Any life may carry `until`; a hard end date always wins. Cards with no shelf
// (older walls) never expire, preserving the original "unread stays" rule.
// Durations and the on/off switch come from the instance's config/shelf-life.json
// (Node: core/shelf-config.mjs; browser: inlined by the build as WALL_SHELF_CONFIG).
(function (root, factory) {
  const api = factory(root && root.WALL_SHELF_CONFIG);
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.Wall ||= {}).shelfLife = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (initial) {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const LIVES = ["dated", "news", "analysis", "evergreen"];
  const DEFAULT_DAYS = { news: 14, analysis: 45, evergreen: 120 };
  let DAYS = { ...DEFAULT_DAYS };
  let enabled = true;

  // Apply an instance config { expireUnread?, days? }; unknown or invalid values
  // fall back to the defaults. Returns the effective config.
  function configure(config) {
    const days = config && typeof config.days === "object" ? config.days : {};
    DAYS = { ...DEFAULT_DAYS };
    for (const life of Object.keys(DEFAULT_DAYS))
      if (Number.isFinite(days[life]) && days[life] > 0) DAYS[life] = days[life];
    enabled = !(config && config.expireUnread === false);
    return { expireUnread: enabled, days: { ...DAYS } };
  }
  if (initial) configure(initial);

  const dayStart = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? Date.parse(`${iso}T00:00:00.000Z`) : NaN;

  // The clock starts when the card joined the wall, not the content's pub date:
  // a July essay carded yesterday gets its full window.
  function startOf(item) {
    const start = dayStart(item.collectedAt);
    return Number.isFinite(start) ? start : dayStart(item.postedAt);
  }

  // Epoch ms at which the unread card expires, or null when it never does.
  function expiresAt(item) {
    const shelf = item && item.shelf;
    if (!enabled || !shelf || typeof shelf !== "object") return null;
    const until = dayStart(shelf.until);
    if (Number.isFinite(until)) return until + DAY_MS;           // the day after the last useful day
    const days = DAYS[shelf.life];
    const start = startOf(item);
    return days && Number.isFinite(start) ? start + days * DAY_MS : null;
  }

  function isExpired(item, now) {
    const at = expiresAt(item);
    return at != null && at <= now;
  }

  // Fraction of the shelf life still left (1 = fresh, 0 = due), or null when the
  // card has no shelf. Drives how often an unread card surfaces in the feed.
  function remaining(item, now) {
    const at = expiresAt(item), start = startOf(item);
    if (at == null || !Number.isFinite(start) || at <= start) return null;
    return Math.max(0, Math.min(1, (at - now) / (at - start)));
  }

  return { DAY_MS, LIVES, DEFAULT_DAYS, configure, days: () => ({ ...DAYS }), enabled: () => enabled,
    startOf, expiresAt, isExpired, remaining };
});
