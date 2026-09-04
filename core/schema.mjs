// Canonical item schema for collection, validation, and publishing.
// The browser derives filter values from the data, so it does not need a second
// copy of these enums.
export const SOURCES = ["twitter", "instagram", "hackernews", "rss", "ft", "wikipedia", "arxiv", "youtube", "thesis", "link"];
export const CATEGORIES = ["ai", "crypto", "markets", "engineering", "events", "ideas", "fun", "meta"];
const STAT_KEYS = ["replies", "reposts", "likes", "views"];

export const isString = value => typeof value === "string";
const str = value => isString(value) ? null : "must be a string";
const nonEmptyStr = value => isString(value) && value.trim() ? null : "must be a non-empty string";
const isoDate = value => isString(value) && /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : 'must be an ISO date "YYYY-MM-DD"';
const httpUrl = value => isString(value) && /^https?:\/\//i.test(value) ? null : "must be an http(s) URL";
// Media may be remote (http-s) OR self-hosted at a rooted "/media/…" path — we
// localize Instagram covers/avatars because fbcdn signed URLs 403 off-platform
// and expire within days. Reject protocol-relative "//" and backslashes.
const mediaUrl = value => isString(value) && (/^https?:\/\//i.test(value) || /^\/[^/\\]/.test(value)) ? null : 'must be an http(s) URL or a rooted "/media/…" path';
const urlOrEmpty = value => !isString(value) ? "must be a string" : (value === "" || /^https?:\/\//i.test(value)) ? null : 'must be an http(s) URL or "" (house cards)';
const mdPath = value => isString(value) && value.endsWith(".md") ? null : 'must be a vault path ending in ".md"';
const stringArray = value => Array.isArray(value) && value.every(isString) ? null : "must be an array of strings";
// A carousel/gallery: a non-empty array where every entry is a valid media URL
// (remote http-s or a self-hosted "/media/…" path), same rule as `image`.
const mediaUrlArray = value => Array.isArray(value) && value.length > 0 && value.every(v => mediaUrl(v) === null) ? null : "must be a non-empty array of media URLs (http(s) or /media/…)";
const score0to10 = value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10 ? null : "must be a number 0–10";
const oneOf = (list, label) => value => list.includes(value) ? null : `must be one of ${label || list.join(" | ")}`;
const lowerCategory = value => {
  if (!isString(value) || !value.trim()) return "must be a non-empty string";
  return value === value.toLowerCase() ? null : "must be lowercase";
};
const statsObject = value => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "must be an object";
  for (const key of Object.keys(value)) {
    if (!STAT_KEYS.includes(key)) return `has unknown key "${key}" (allowed: ${STAT_KEYS.join(", ")})`;
    if (!isString(value[key])) return `stats.${key} must be a string as displayed, e.g. "1.2M"`;
  }
  return null;
};
const explorationObject = value => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "must be an object";
  const allowed = new Set(["kind", "bridge", "credibility"]);
  for (const key of Object.keys(value))
    if (!allowed.has(key)) return `has unknown key "${key}" (allowed: ${[...allowed].join(", ")})`;
  if (!["adjacent", "wildcard", "counterpoint"].includes(value.kind))
    return "kind must be adjacent | wildcard | counterpoint";
  if (!isString(value.bridge) || !value.bridge.trim()) return "bridge must be a non-empty string";
  if (value.kind === "counterpoint" && (!isString(value.credibility) || !value.credibility.trim()))
    return "counterpoint credibility must be a non-empty string";
  if ("credibility" in value && !isString(value.credibility)) return "credibility must be a string";
  return null;
};

const VERDICTS = ["✓", "✗", "~"];
const objectArray = (value, required, label) => {
  if (!Array.isArray(value) || value.length === 0) return `must be a non-empty array of ${label} objects`;
  for (const [index, object] of value.entries()) {
    if (!object || typeof object !== "object" || Array.isArray(object)) return `[${index}] must be an object`;
    for (const key of required)
      if (!isString(object[key]) || !object[key].trim()) return `[${index}].${key} must be a non-empty string`;
  }
  return null;
};
const thesisObject = value => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "must be an object";
  for (const key of ["asset", "spot", "bias", "reasoning"])
    if (!isString(value[key]) || !value[key].trim()) return `thesis.${key} must be a non-empty string`;
  for (const key of ["conviction", "flip"])
    if (key in value && !isString(value[key])) return `thesis.${key} must be a string`;
  const provenanceError = objectArray(value.provenance, ["handle", "url"], "provenance");
  if (provenanceError) return `thesis.provenance ${provenanceError}`;
  for (const [index, source] of value.provenance.entries())
    if (!/^https?:\/\//i.test(source.url)) return `thesis.provenance[${index}].url must be an http(s) URL`;
  const factcheckError = objectArray(value.factcheck, ["claim", "verdict"], "factcheck");
  if (factcheckError) return `thesis.factcheck ${factcheckError}`;
  for (const [index, fact] of value.factcheck.entries())
    if (!VERDICTS.includes(fact.verdict)) return `thesis.factcheck[${index}].verdict must be one of ${VERDICTS.join(" ")}`;
  if ("levels" in value) {
    const levelsError = objectArray(value.levels, ["level", "role"], "levels");
    if (levelsError) return `thesis.levels ${levelsError}`;
  }
  if ("bracket" in value) {
    const bracket = value.bracket;
    if (!bracket || typeof bracket !== "object" || Array.isArray(bracket)) return "thesis.bracket must be an object";
    for (const key of ["trigger", "invalidation"])
      if (!isString(bracket[key]) || !bracket[key].trim()) return `thesis.bracket.${key} must be a non-empty string`;
    if (!Array.isArray(bracket.targets) || !bracket.targets.length || !bracket.targets.every(isString))
      return "thesis.bracket.targets must be a non-empty array of strings";
  }
  return null;
};

export const ITEM_SCHEMA = {
  id:          { required: true,  check: nonEmptyStr,    desc: "a stable unique slug derived from the post URL", example: "ionet-2078401135874912764" },
  url:         { required: true,  check: urlOrEmpty,     desc: 'the original post link (or "" for house cards)', example: "https://x.com/ionet/status/2078401135874912764" },
  source:      { required: true,  check: oneOf(SOURCES), desc: "the platform, which also picks the card style", example: "twitter" },
  kind:        { required: false, check: oneOf(["reel", "photo", "carousel"]), desc: "the Instagram media type", example: "reel" },
  author:      { required: true,  check: nonEmptyStr,    desc: "the author's display name", example: "io.net" },
  text:        { required: true,  check: nonEmptyStr,    desc: "the distilled 1–3 sentence summary", example: "Four companies control accessible AI compute…" },
  category:    { required: true,  check: lowerCategory,  desc: "exactly one lowercase topic label", example: "ai" },
  postedAt:    { required: true,  check: isoDate,        desc: "the publication date", example: "2026-07-18" },
  handle:      { required: false, check: str,            desc: "the @handle", example: "@ionet" },
  avatar:      { required: false, check: mediaUrl,       desc: 'the author profile image — an http(s) URL or self-hosted "/media/…" path', example: "https://example.com/avatar.jpg" },
  note:        { required: false, check: str,            desc: "one line on why it matters", example: "A useful compute-market framing." },
  image:       { required: false, check: mediaUrl,       desc: 'the post media — an http(s) URL or self-hosted "/media/…" path', example: "https://example.com/image.jpg" },
  images:      { required: false, check: mediaUrlArray,   desc: 'multiple media for a carousel/gallery card — each an http(s) URL or "/media/…" path; the frontend renders a swipeable carousel', example: ["https://example.com/1.jpg", "https://example.com/2.jpg"] },
  video:       { required: false, check: httpUrl,        desc: "self-hosted reel video URL (R2); plays inline with image as poster", example: "https://pub-xxxx.r2.dev/reels/id.mp4" },
  stats:       { required: false, check: statsObject,    desc: "displayed engagement counts", example: { likes: "1.2K" } },
  tags:        { required: false, check: stringArray,    desc: "free-form string labels", example: ["compute", "gpu"] },
  thesis:      { required: false, check: thesisObject,   desc: "the structured fact-checked analysis payload", example: { asset: "BTC/USD", spot: "$66,267", bias: "neutral", reasoning: "…", provenance: [{ handle: "@source", url: "https://x.com/source/status/1" }], factcheck: [{ claim: "BTC touched $60K", verdict: "✓" }] } },
  score:       { required: false, check: score0to10,     desc: "the algorithm's 0–10 ranking", example: 7 },
  why:         { required: false, check: nonEmptyStr,    desc: "the one-line match reason", example: "matched 'Compute & AI economics' [w4]" },
  via:         { required: false, check: nonEmptyStr,    desc: "how it was found", example: "for-you" },
  exploration: { required: false, check: explorationObject, desc: "structured openness-pilot provenance", example: { kind: "adjacent", bridge: "Connects nuclear physics to materials science." } },
  collectedAt: { required: false, check: isoDate,        desc: "the collection date", example: "2026-07-18" },
  kbNote:      { required: false, check: mdPath,         desc: "the Obsidian vault path", example: "Social Wall/Posts/2026-07-18 io.net - AI compute.md" },
};
