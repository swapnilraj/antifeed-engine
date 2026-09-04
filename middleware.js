// Gates the whole wall behind HTTP Basic Auth so the personal feed stays private
// on Vercel's free plan (native Vercel Authentication is Pro-only for production).
// Credentials live in the WALL_USER / WALL_PASSWORD env vars — never in the repo.
//
// Basic Auth alone re-prompts on every new browser session (the browser holds the
// credentials in memory only), so a successful Basic entry is upgraded to a signed,
// stateless cookie: value = "<expiry>.<hmac(WALL_COOKIE_SECRET, expiry)>", verified
// with WebCrypto on each request. No storage; rotating the secret revokes everyone.
// If WALL_COOKIE_SECRET is unset, behavior falls back to plain per-session Basic.
export const config = { matcher: "/(.*)" };

const COOKIE_NAME = "wall_auth";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days between prompts, per device

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time compare so the signature can't be guessed byte-by-byte.
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hasValidCookie(request, secret) {
  const match = /(?:^|;\s*)wall_auth=([^;]+)/.exec(request.headers.get("cookie") || "");
  if (!match) return false;
  const [expiry, signature] = match[1].split(".");
  if (!/^\d+$/.test(expiry || "") || !signature) return false;
  if (Number(expiry) * 1000 < Date.now()) return false;
  return safeEqual(signature, await hmacHex(secret, expiry));
}

async function cookieRedirect(request, secret) {
  const expiry = String(Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS);
  const value = `${expiry}.${await hmacHex(secret, expiry)}`;
  return new Response(null, {
    status: 307,
    headers: {
      Location: request.url,
      "Cache-Control": "no-store",
      "Set-Cookie": `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SECONDS}`,
    },
  });
}

export default async function middleware(request) {
  const secret = process.env.WALL_COOKIE_SECRET;
  if (secret && await hasValidCookie(request, secret)) {
    return; // cookie session — let the static asset through, no prompt
  }

  const user = process.env.WALL_USER || "wall";
  const pass = process.env.WALL_PASSWORD;
  const header = request.headers.get("authorization") || "";

  // Machine token for Claude's feedback sync (same access as basic auth, no
  // human creds involved). Lives in the WALL_SYNC_TOKEN env var on Vercel and
  // in the local (gitignored) .env.sync on Swapnil's machine. Checked before
  // Basic so sync clients never touch the cookie path.
  const sync = process.env.WALL_SYNC_TOKEN;
  if (sync && header === "Bearer " + sync) {
    return;
  }

  if (pass && header === "Basic " + btoa(user + ":" + pass)) {
    // Upgrade the Basic entry to the durable cookie — but only for browser page
    // loads (Accept: text/html) so curl/scripts pass straight through, and a
    // cookie-blocking client can only loop on the page itself, never on assets.
    const isPageLoad = ["GET", "HEAD"].includes(request.method)
      && (request.headers.get("accept") || "").includes("text/html");
    if (secret && isPageLoad) {
      return cookieRedirect(request, secret);
    }
    return; // authenticated — let the static asset through
  }

  return new Response("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Swapnil\'s Wall"' },
  });
}
