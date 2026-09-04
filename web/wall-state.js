(() => {
  "use strict";
  const Wall = window.Wall ||= {};
  const items = window.WALL_ITEMS || [];

  // ---- read-state ordering ------------------------------------------------
  // Problem: strict newest-first meant the same top cards greeted you every
  // visit, so the ones below never got a look. Fix: UNREAD cards float to the
  // top in a per-visit shuffle (so a different slice surfaces each time), and
  // cards you've READ sink below them in the normal newest-first order.
  // "Read" = the attention tracker saw settled, focused dwell on the primary
  // viewport card, or the visitor explicitly engaged with it. Crucially, the
  // order is SNAPSHOTTED from the read-set as it was at page load, so the
  // wall never reflows under you mid-scroll; what you dwell on today sinks on
  // your NEXT visit. The data in items.js stays newest-first — only the
  // DISPLAY reorders by read-state.
  // v2 intentionally starts clean: v1's pointer-hover rule produced false reads.
  // The old key remains untouched in localStorage as a harmless backup.
  const READKEY = "wall-read-v2";
  const READTIMEKEY = "wall-read-times-v1";
  let readIds;
  try { readIds = new Set(JSON.parse(localStorage.getItem(READKEY) || "[]")); }
  catch { readIds = new Set(); }
  let readTimes;
  try {
    const stored = JSON.parse(localStorage.getItem(READTIMEKEY) || "{}");
    readTimes = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  } catch { readTimes = {}; }
  const saveReadTimes = () => {
    try { localStorage.setItem(READTIMEKEY, JSON.stringify(readTimes)); } catch {}
  };
  const wasRead = id => readIds.has(id);
  const markRead = id => {
    if (!id || readIds.has(id)) return;
    const at = new Date().toISOString();
    readIds.add(id);
    try { localStorage.setItem(READKEY, JSON.stringify([...readIds].slice(-2000))); } catch {}
    readTimes[id] = readTimes[id] && readTimes[id] < at ? readTimes[id] : at;
    saveReadTimes();
    scheduleReadPush(id, at);
  };

  // ---- read-button presses — one-way, device-local. The ✓ button lights ONLY
  // when it was pressed (Swapnil 2026-08-20: "pressing the read button should be
  // the only thing that activates it"); dwell/engage reads mark the card read
  // but never light the button. Cosmetic state, so no server sync.
  const PRESSKEY = "wall-read-button";
  let pressedIds;
  try { pressedIds = new Set(JSON.parse(localStorage.getItem(PRESSKEY) || "[]")); }
  catch { pressedIds = new Set(); }
  const wasPressed = id => pressedIds.has(id);
  const markPressed = id => {
    if (!id || pressedIds.has(id)) return;
    pressedIds.add(id);
    try { localStorage.setItem(PRESSKEY, JSON.stringify([...pressedIds].slice(-2000))); } catch {}
  };

  // ---- read-state server sync — a lighter mirror of the feedback sync below.
  // Push newly-read ids to /api/reads (debounced) so the read set follows across
  // devices AND the sweep can grade itself on read-vs-kept, not just kept — the
  // one signal that answers "is the wall actually being looked at?". Best-effort:
  // never blocks a render, never throws into the wall. Only on the deployed
  // http(s) wall; the file:// wall stays purely local. First-read timestamps
  // are durable lifecycle state: publishing uses them to enforce the five-day
  // grace period before a card can be archived.
  const READ_ENDPOINT = "/api/reads";
  const onHttp = () => /^https?:$/.test(location.protocol);
  let pendingReads = Object.create(null);
  let readTimer = null;
  function flushReads() {
    readTimer = null;
    if (!onHttp()) { pendingReads = Object.create(null); return; }
    const batch = pendingReads;
    pendingReads = Object.create(null);
    if (!Object.keys(batch).length) return;
    fetch(READ_ENDPOINT, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ reads: batch }),
    }).then(r => { if (!r.ok) Object.assign(pendingReads, batch); })   // requeue on failure
      .catch(() => Object.assign(pendingReads, batch));
  }
  function scheduleReadPush(id, at = new Date().toISOString()) {
    if (!onHttp()) return;
    pendingReads[id] = at;
    if (!readTimer) readTimer = setTimeout(flushReads, 4000);
  }
  // Pull the server read set once at load and fold it into local read-state, so
  // a card read on another device is already "read" on your NEXT visit here.
  // (This resolves after `ordered` is computed, so it never reflows the current
  // view — it just seeds the snapshot for next time, matching the model above.)
  async function pullReads() {
    if (!onHttp()) return readTimes;
    try {
      const response = await fetch(READ_ENDPOINT);
      const st = response.ok ? await response.json() : null;
      const server = st && st.reads;
      if (!server || typeof server !== "object") return readTimes;
      let changed = false;
      let timesChanged = false;
      for (const [id, at] of Object.entries(server)) {
        if (!readIds.has(id)) { readIds.add(id); changed = true; }
        if (typeof at === "string" && (!readTimes[id] || at < readTimes[id])) {
          readTimes[id] = at;
          timesChanged = true;
        }
      }
      if (changed) { try { localStorage.setItem(READKEY, JSON.stringify([...readIds].slice(-2000))); } catch {} }
      if (timesChanged) saveReadTimes();
      return readTimes;
    } catch { return readTimes; }
  }
  // On unload, beacon whatever is still pending — the debounce timer may never fire.
  addEventListener("pagehide", () => {
    if (!onHttp()) return;
    const batch = pendingReads;
    pendingReads = Object.create(null);
    if (!Object.keys(batch).length) return;
    try { navigator.sendBeacon(READ_ENDPOINT, new Blob([JSON.stringify({ reads: batch })], { type: "application/json" })); } catch {}
  });
  const readsReady = pullReads();

  // per-visit shuffle key, fixed at load so scrolling/filtering never reorders
  const shuffleRank = new Map(items.map(i => [i.id, Math.random()]));
  // unread (as of load) first & shuffled; read below, kept newest-first (stable sort)
  const ordered = items.slice().sort((a, b) => {
    const ra = wasRead(a.id), rb = wasRead(b.id);
    if (ra !== rb) return ra ? 1 : -1;                                  // unread before read
    if (ra) return 0;                                                   // both read → keep newest-first
    return (shuffleRank.get(a.id) ?? 0) - (shuffleRank.get(b.id) ?? 0); // both unread → shuffle
  });

  // unseen-since-last-visit: which ids are new to *this* visitor (localStorage)
  let seenIds;
  try { seenIds = new Set(JSON.parse(localStorage.getItem("wall-seen") || "[]")); }
  catch { seenIds = new Set(); }
  const firstRun = seenIds.size === 0;                      // don't flag EVERYTHING new on a first-ever visit
  const newIds = new Set(firstRun ? [] : items.filter(i => !seenIds.has(i.id)).map(i => i.id));
  // Remember the full active wall so an uncapped feed does not repeatedly mark
  // older cards "new" merely because they fell outside an arbitrary id limit.
  try { localStorage.setItem("wall-seen", JSON.stringify(items.map(i => i.id))); } catch {}


  // ---- feedback store (localStorage) — signals the sweep folds back into
  // algorithm/interests.md. { "<item id>": { dir: "more"|"less", at: ISO } } ----
  const FBKEY = "wall-feedback";
  const fbLoad = () => { try { return JSON.parse(localStorage.getItem(FBKEY) || "{}"); } catch { return {}; } };
  const fbSave = o => { try { localStorage.setItem(FBKEY, JSON.stringify(o)); } catch {} };

  // ---- server sync (Vercel deploy only; file:// wall is read via collectors/cdp.mjs) ----
  // Push the local store after every tap; pull+merge on load and on refocus.
  // Signals the sweep has processed (at <= processedAt) are pruned automatically,
  // which is what clears the pills on every device after a sweep ingests them.
  async function syncFb(push) {
    if (!/^https?:$/.test(location.protocol)) return;
    try {
      const r = await fetch("/api/feedback", push
        ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signals: fbLoad() }) }
        : undefined);
      if (!r.ok) return;
      const st = await r.json();
      if (!st || typeof st !== "object") return;
      const local = fbLoad();
      let dirty = false;
      if (st.processedAt) for (const [id, f] of Object.entries(local))
        if (!f?.at || f.at <= st.processedAt) { delete local[id]; dirty = true; }
      for (const [id, f] of Object.entries(st.signals || {})) {
        if (st.processedAt && f.at <= st.processedAt) continue;
        if (!local[id] || f.at > local[id].at) { local[id] = f; dirty = true; }
      }
      if (dirty) { fbSave(local); Wall.onFeedbackChange?.(); }
    } catch { /* offline or local — stays device-local until next sync */ }
  }
  function fbText() {
    const store = fbLoad();
    const byId = Object.fromEntries(items.map(x => [x.id, x]));
    const lines = Object.entries(store)
      .filter(([, f]) => f && !f.removed)   // tombstones are sync plumbing, not feedback
      .sort((a, b) => (a[1].at || "").localeCompare(b[1].at || ""))
      .map(([key, f]) => {
        const id = key.split("#")[0];
        const it = byId[id];
        const card = it ? ` — "${(it.text || "").slice(0, 80)}" [${it.category}${it.why ? `; ${it.why}` : ""}]` : "";
        if (f.kind === "note") return `✎ note on ${id}: "${f.text}"${card}`;
        return `${f.dir === "more" ? "+" : "-"} ${f.dir} like ${id}${card}`;
      });
    return `wall feedback (${new Date().toISOString().slice(0, 16)})\n${lines.join("\n")}`;
  }


  Wall.state = {
    ordered,
    newIds,
    wasRead,
    markRead,
    getReadAt: id => readTimes[id] || null,
    readsReady,
    wasPressed,
    markPressed,
    fbLoad,
    fbSave,
    syncFb,
    fbText
  };
})();
