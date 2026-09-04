const DEFAULT_TIMEOUT_MS = 15_000;

export function createFetchClient({
  userAgent,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  textAccept = "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
}) {
  // Timeout covers the request/headers; body reads on a returned raw Response
  // are the caller's concern.
  async function raw(url, accept) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        headers: { "user-agent": userAgent, accept },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function request(url, accept, parse) {
    const response = await raw(url, accept);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return await response[parse]();
  }

  return {
    getJSON(url) {
      return request(url, "application/json", "json");
    },
    getText(url) {
      return request(url, textAccept, "text");
    },
    // Raw Response for callers that need headers/binary (e.g. image downloads);
    // the caller checks .ok itself.
    getResponse(url, accept = "*/*") {
      return raw(url, accept);
    },
  };
}
