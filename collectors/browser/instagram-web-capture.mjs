// Installed before Instagram's application JavaScript runs. It copies bounded
// feed-only GraphQL data into page memory without exporting request credentials.
export const INSTAGRAM_FEED_KEYS = [
  "xdt_api__v1__feed__timeline__connection",
  "xdt_api__v1__clips__home__connection_v2",
  "xdt_injected_reels_units",
];

export function instagramCaptureScript() {
  return `(() => {
    const STORE = "__socialWallInstagramResponses";
    const LIMIT = 30;
    const MAX_BODY = 5 * 1024 * 1024;
    const FEED_KEYS = new Set(${JSON.stringify(INSTAGRAM_FEED_KEYS)});
    window[STORE] = [];
    const relevant = value => {
      try {
        const url = new URL(String(value), location.origin);
        return url.origin === location.origin &&
          (url.pathname === "/api/graphql" || url.pathname === "/graphql/query");
      } catch { return false; }
    };
    const remember = (url, text) => {
      if (!relevant(url) || typeof text !== "string" || text.length > MAX_BODY) return;
      const store = window[STORE];
      if (!Array.isArray(store) || store.length >= LIMIT) return;
      try {
        const clean = text.replace(/^for \(;;\);/, "");
        if (![...FEED_KEYS].some(key => clean.includes('"' + key + '"'))) return;
        const parsed = JSON.parse(clean);
        const selected = [];
        const seen = new Set();
        const scan = value => {
          if (!value || typeof value !== "object" || seen.has(value)) return;
          seen.add(value);
          for (const key of FEED_KEYS) {
            if (Object.prototype.hasOwnProperty.call(value, key)) selected.push({ [key]: value[key] });
          }
          for (const child of Array.isArray(value) ? value : Object.values(value)) scan(child);
        };
        scan(parsed);
        if (!selected.length) return;
        store.push({ path: new URL(String(url), location.origin).pathname,
          body: selected });
      } catch {}
    };

    const nativeFetch = window.fetch;
    window.fetch = async function(...args) {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
      const response = await nativeFetch.apply(this, args);
      if (relevant(url)) response.clone().text().then(text => remember(url, text)).catch(() => {});
      return response;
    };

    const nativeOpen = XMLHttpRequest.prototype.open;
    const nativeSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this.__socialWallUrl = url;
      return nativeOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function(...args) {
      if (relevant(this.__socialWallUrl)) {
        this.addEventListener("load", () => {
          try {
            const text = !this.responseType || this.responseType === "text"
              ? this.responseText : JSON.stringify(this.response);
            remember(this.__socialWallUrl, text);
          } catch {}
        }, { once: true });
      }
      return nativeSend.apply(this, args);
    };
  })();`;
}

export const capturedInstagramResponsesExpression = `
  JSON.stringify(Array.isArray(window.__socialWallInstagramResponses)
    ? window.__socialWallInstagramResponses : [])
`;

export const embeddedInstagramFeedsExpression = `JSON.stringify((() => {
  const keys = new Set(${JSON.stringify(INSTAGRAM_FEED_KEYS)});
  const selected = [];
  const seen = new Set();
  const scan = value => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    for (const key of keys) {
      if (Object.hasOwn(value, key)) selected.push({ [key]: value[key] });
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) scan(child);
  };
  for (const script of document.scripts) {
    const text = script.textContent || "";
    if (script.type !== "application/json" || ![...keys].some(key => text.includes(key))) continue;
    try { scan(JSON.parse(text)); } catch {}
  }
  return selected;
})())`;
