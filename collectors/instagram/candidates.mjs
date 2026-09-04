const SURFACE_FEED_KEYS = {
  timeline: ["xdt_api__v1__feed__timeline__connection"],
  reels: ["xdt_api__v1__clips__home__connection_v2", "xdt_injected_reels_units"],
};

function walk(value, visit, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  visit(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child, visit, seen);
}

function captionOf(media) {
  if (typeof media.caption === "string") return media.caption;
  if (media.caption?.text) return media.caption.text;
  return media.edge_media_to_caption?.edges?.[0]?.node?.text || media.accessibility_caption || "";
}

function largest(candidates) {
  return [...candidates].sort((a, b) =>
    (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0))[0];
}

function imageOf(media) {
  // Prefer the first carousel slide over the parent's own image_versions2: the
  // parent entry is often a square feed crop, while slides keep the original
  // aspect ratio.
  const slide = media.carousel_media?.[0]?.image_versions2?.candidates;
  if (Array.isArray(slide) && slide.length) return largest(slide)?.url || "";
  const candidates = media.image_versions2?.candidates;
  if (Array.isArray(candidates) && candidates.length) return largest(candidates)?.url || "";
  return media.display_url || media.thumbnail_src || media.thumbnail_url || "";
}

// Every slide of a carousel at its largest (original-aspect) rendition, so a
// kept card can carry the full gallery instead of just a cover.
function imagesOf(media) {
  if (!Array.isArray(media.carousel_media)) return undefined;
  const urls = media.carousel_media
    .map(slide => largest(slide.image_versions2?.candidates || [])?.url || slide.display_url || "")
    .filter(Boolean);
  return urls.length > 1 ? urls : undefined;
}

function videoOf(media) {
  const versions = media.video_versions;
  if (Array.isArray(versions) && versions.length) return largest(versions)?.url || "";
  return media.video_url || "";
}

function timestampOf(media) {
  const raw = media.taken_at ?? media.taken_at_timestamp ?? media.device_timestamp;
  if (!raw) return "";
  if (typeof raw === "string" && /[T:-]/.test(raw)) return raw;
  const seconds = Number(raw) > 1e12 ? Number(raw) / 1e6 : Number(raw);
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.valueOf()) ? "" : date.toISOString();
}

function statsOf(media) {
  const stats = {};
  const values = {
    likes: media.like_count ?? media.edge_media_preview_like?.count,
    replies: media.comment_count ?? media.edge_media_to_comment?.count ??
      media.edge_media_preview_comment?.count,
    views: media.play_count ?? media.view_count ?? media.video_view_count ?? media.video_play_count,
  };
  for (const [name, value] of Object.entries(values)) {
    if (Number.isFinite(Number(value)) && Number(value) > 0) stats[name] = Number(value);
  }
  return stats;
}

function mediaKind(media) {
  const typename = String(media.__typename || "").toLowerCase();
  if (Number(media.media_type) === 8 || typename.includes("sidecar") || Array.isArray(media.carousel_media))
    return "carousel";
  if (Number(media.media_type) === 2 || typename.includes("video") || media.video_versions || media.video_url)
    return "reel";
  return "photo";
}

function normalizeMedia(media, via) {
  const code = String(media.code || media.shortcode || "");
  const user = media.user || media.owner || {};
  const username = String(user.username || media.owner_username || "");
  if (!code || !username) return null;
  const kind = mediaKind(media);
  return {
    id: code,
    permalink: `https://www.instagram.com/${kind === "reel" ? "reel" : "p"}/${code}/`,
    kind,
    author: String(user.full_name || username),
    handle: `@${username}`,
    avatar: String(user.profile_pic_url || user.profile_pic_url_hd || ""),
    caption: captionOf(media),
    alt: String(media.accessibility_caption || ""),
    image: imageOf(media),
    images: imagesOf(media),
    videoUrl: videoOf(media),
    postedAt: timestampOf(media),
    stats: statsOf(media),
    via,
    pk: String(media.pk || media.id || ""),
  };
}

function containsFeed(response, keys) {
  let found = false;
  walk(response.body, value => {
    if (!found && keys.some(key => Object.hasOwn(value, key))) found = true;
  });
  return found;
}

function looksLikeMedia(value) {
  return !Array.isArray(value) && (value.code || value.shortcode) && (value.user || value.owner) &&
    (value.media_type || value.__typename || value.image_versions2 || value.display_url);
}

export function candidatesForSurface(responses, surface, via, amount) {
  const feedKeys = SURFACE_FEED_KEYS[surface];
  if (!feedKeys) throw new Error(`unknown Instagram surface: ${surface}`);
  const candidates = new Map();
  for (const response of responses.filter(value => containsFeed(value, feedKeys))) {
    walk(response.body, value => {
      if (candidates.size >= amount || !looksLikeMedia(value)) return;
      const candidate = normalizeMedia(value, via);
      if (candidate) candidates.set(candidate.id, candidate);
    });
    if (candidates.size >= amount) break;
  }
  return [...candidates.values()].slice(0, amount);
}
