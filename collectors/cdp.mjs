#!/usr/bin/env node
// Minimal CDP client for any Chromium-family browser started with --remote-debugging-port (default 9222). No dependencies.
// Read-only collection helper for the social wall. Usage:
//   node collectors/cdp.mjs tabs                    list open tabs (id, url, title)
//   node collectors/cdp.mjs open <url>              open a new tab IN THE BACKGROUND, prints its id
//   node collectors/cdp.mjs text <id>               dump the tab's visible text (innerText)
//   node collectors/cdp.mjs scroll <id> [px]        scroll down (default 2000px) and settle
//   node collectors/cdp.mjs harvest <id> [rounds]
//                                        incrementally scroll a feed and extract
//                                        structured posts, deduped by post id. Prints
//   node collectors/cdp.mjs shot <id> [path]        save a JPEG screenshot of the tab (default
//                                        shot-<id>.jpg). Read-only.
//   node collectors/cdp.mjs close <id>              close the tab
import { writeFileSync } from "node:fs";
import { createCDPClient } from "./browser/cdp-client.mjs";
import { harvestExpression, selectFeedExpression } from "./browser/feed-extractor.mjs";

const [cmd, arg1, arg2] = process.argv.slice(2);
const { browserSend, evalInTab, http, targetSend } = createCDPClient();

switch (cmd) {
  case "tabs": {
    const targets = await http("/json/list");
    for (const t of targets.filter(t => t.type === "page"))
      console.log(`${t.id}\t${t.url}\t${t.title}`);
    break;
  }
  case "open": {
    if (!arg1) { console.error("usage: cdp.mjs open <url>"); process.exit(1); }
    // background:true opens the tab WITHOUT foregrounding it — Swapnil's active tab
    // and focus are untouched while collection scrolls in the background.
    const { targetId } = await browserSend("Target.createTarget", { url: arg1, background: true });
    // Keep the hidden tab from being frozen/discarded so virtualized feeds still
    // load and scroll while it stays in the background. Best-effort.
    try { await targetSend(targetId, "Page.setWebLifecycleState", { state: "active" }); } catch {}
    console.log(targetId);
    break;
  }
  case "text": {
    const text = await evalInTab(arg1, "document.body.innerText");
    console.log(text);
    break;
  }
  case "feedback": {
    // Read the wall's pending more/less signals from an open wall tab (any of
    // file://…wall.html, localhost, or the Vercel deploy). Purpose-built and
    // read-only — deliberately NOT a general eval command. Prints the JSON
    // stored under localStorage["wall-feedback"].
    const json = await evalInTab(arg1, `localStorage.getItem("wall-feedback") || "{}"`);
    console.log(json);
    break;
  }
  case "scroll": {
    const px = Number(arg2) || 2000;
    await evalInTab(arg1, `window.scrollBy(0, ${px}); new Promise(r => setTimeout(r, 1500))`);
    console.log("scrolled");
    break;
  }
  case "select": {
    // Switch the x.com/home timeline between "for-you" and "following" tabs.
    // Read-only navigation — no like/follow/post. Prints the resulting tab so the
    // caller labels `via` truthfully and notes a gap if the switch didn't take.
    if (!arg1) { console.error("usage: cdp.mjs select <id> <following|for-you>"); process.exit(1); }
    const want = (arg2 || "following").toLowerCase() === "for-you" ? "for-you" : "following";
    const json = await evalInTab(arg1, selectFeedExpression(want), 8000);
    console.log(json);
    break;
  }
  case "harvest": {
    if (!arg1) { console.error("usage: cdp.mjs harvest <id> [rounds]"); process.exit(1); }
    // Default 15 rounds ≈ a 30-tweet sample in ~25s. Feeds are virtualized, so each
    // ~900px step surfaces roughly one screen of new posts; more rounds = deeper sample.
    // Bump it (e.g. 24) for the For You feed where a deep sample matters most.
    const rounds = Math.max(1, Math.min(40, Number(arg2) || 15));
    const settle = 1200;
    const step = 900;
    // Budget: initial extract + each round's scroll+settle, plus a network/parse buffer.
    const timeoutMs = rounds * (settle + 600) + 8000;
    const json = await evalInTab(arg1, harvestExpression(rounds, step, settle), timeoutMs);
    console.log(json);
    break;
  }
  case "shot": {
    if (!arg1) { console.error("usage: cdp.mjs shot <id> [path]"); process.exit(1); }
    const path = arg2 || `shot-${arg1}.jpg`;
    const { data } = await targetSend(arg1, "Page.captureScreenshot", { format: "jpeg", quality: 72 });
    writeFileSync(path, Buffer.from(data, "base64"));
    console.log(path);
    break;
  }
  case "close": {
    await http(`/json/close/${arg1}`);
    console.log("closed");
    break;
  }
  default:
    console.error("commands: tabs | open <url> | text <id> | scroll <id> [px] | select <id> <following|for-you> | harvest <id> [rounds] | shot <id> [path] | feedback <id> | close <id>");
    process.exit(1);
}
