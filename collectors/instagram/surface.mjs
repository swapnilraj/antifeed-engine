import { createCDPClient } from "../browser/cdp-client.mjs";
import {
  capturedInstagramResponsesExpression,
  embeddedInstagramFeedsExpression,
  instagramCaptureScript,
} from "../browser/instagram-web-capture.mjs";
import { candidatesForSurface } from "./candidates.mjs";

export const INSTAGRAM_SURFACES = {
  timeline: { url: "https://www.instagram.com/", via: "ig-home", settleMs: 8_000 },
  reels: { url: "https://www.instagram.com/reels/", via: "reels", settleMs: 10_000 },
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function evaluator(session) {
  return async (expression, timeoutMs = 15_000) => {
    const result = await session.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }, timeoutMs);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result?.value;
  };
}

async function readResponses(evaluate, embedded) {
  const captured = JSON.parse(await evaluate(capturedInstagramResponsesExpression, 30_000) || "[]");
  return [...captured, ...embedded.map(body => ({ path: "embedded", body }))];
}

async function assertAuthenticated(evaluate) {
  const auth = JSON.parse(await evaluate(`JSON.stringify({
    hasLoginForm: Boolean(document.querySelector("input[name=username],input[name=password]")),
    hasAuthenticatedNav: Boolean(document.querySelector("a[href^='/direct/inbox'],a[href^='/explore']"))
  })`));
  if (auth.hasLoginForm || !auth.hasAuthenticatedNav)
    throw new Error("the CDP browser is not logged into Instagram; log in normally in that browser first");
}

async function debugSummary(evaluate, surface, responses, candidates) {
  const state = JSON.parse(await evaluate(`JSON.stringify({
    url: location.href,
    visibility: document.visibilityState,
    focused: document.hasFocus(),
    graphqlResources: performance.getEntriesByType("resource").filter(entry => {
      try { return ["/api/graphql", "/graphql/query"].includes(new URL(entry.name).pathname); }
      catch { return false; }
    }).length,
    scrollY,
    documentHeight: document.documentElement.scrollHeight,
    responseCount: window.__socialWallInstagramResponses?.length || 0
  })`));
  console.error(`${surface}: ${JSON.stringify(state)} responses=${responses.length} candidates=${candidates.length}`);
}

export async function collectInstagramSurface({ surface, amount, rounds, debug = false }) {
  const config = INSTAGRAM_SURFACES[surface];
  if (!config) throw new Error(`unknown Instagram surface: ${surface}`);
  const { browserSend, connectTarget, http } = createCDPClient();
  const { targetId } = await browserSend("Target.createTarget", { url: "about:blank", background: true });
  let session;
  try {
    session = await connectTarget(targetId);
    const evaluate = evaluator(session);
    await session.send("Page.enable");
    await session.send("Page.addScriptToEvaluateOnNewDocument", { source: instagramCaptureScript() });
    try { await session.send("Emulation.setFocusEmulationEnabled", { enabled: true }); } catch {}
    try { await session.send("Page.setWebLifecycleState", { state: "active" }); } catch {}
    await session.send("Page.navigate", { url: config.url });
    await sleep(config.settleMs);
    await assertAuthenticated(evaluate);

    const embedded = JSON.parse(await evaluate(embeddedInstagramFeedsExpression, 30_000) || "[]");
    let responses = await readResponses(evaluate, embedded);
    let candidates = candidatesForSurface(responses, surface, config.via, amount);
    for (let round = 0; round < rounds && candidates.length < amount; round++) {
      await evaluate("window.scrollTo(0, document.documentElement.scrollHeight); true");
      await sleep(2_500);
      responses = await readResponses(evaluate, embedded);
      candidates = candidatesForSurface(responses, surface, config.via, amount);
    }
    if (debug) await debugSummary(evaluate, surface, responses, candidates);
    return candidates;
  } finally {
    session?.close();
    await http(`/json/close/${targetId}`).catch(() => {});
  }
}
