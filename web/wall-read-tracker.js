(() => {
  "use strict";
  const Wall = window.Wall ||= {};

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  // This is a confidence threshold, not an estimate of full reading time — but it
  // must scale with how much there is to read (2026-08-18: long cards were marking
  // read mid-paragraph at 35ms/word). 2026-08-20: Swapnil finishes reading before
  // the card marks read, so trimmed ~20% — 90ms/word ≈ under half a ~250wpm pace:
  // a 30-word card needs ~5s of settled attention, 100 words ~12s, 200 words ~21s,
  // capped at 26s so very dense cards still mark eventually.
  function requiredReadMs(item = {}) {
    const words = `${item.text || ""} ${item.note || ""}`.trim().split(/\s+/).filter(Boolean).length;
    const density = words * 90;
    const formatCost = item.source === "thesis" ? 2000 : item.image ? 800 : 0;
    return clamp(3000 + density + formatCost, 5000, 26000);
  }

  const wordCount = item =>
    `${item.text || ""} ${item.note || ""}`.trim().split(/\s+/).filter(Boolean).length;

  function createReadTracker({ container, selector, getId, itemById, markRead, wasRead }) {
    const visible = new Set();
    const progress = new Map();
    let observer = null;
    let activeId = null;
    let lastTick = performance.now();
    let lastScroll = performance.now();

    // ---- read-timing telemetry — how long each card actually took to read,
    // with the card's features, pushed to /api/read-events (debounced). Lets us
    // fit the dwell threshold above to real reading speed instead of guessing.
    // Best-effort, http(s) only (the file:// wall stays purely local), never
    // throws into the wall. `ms` is the accumulated focused dwell at commit: for
    // a read-button tap that's the real reading time; for a dwell auto-commit
    // it's ~the threshold (censored, but still a labelled data point).
    const EVENT_ENDPOINT = "/api/read-events";
    const onHttp = () => /^https?:$/.test(location.protocol);
    let pendingEvents = [];
    let eventTimer = null;
    function flushEvents() {
      eventTimer = null;
      if (!onHttp()) { pendingEvents = []; return; }
      if (!pendingEvents.length) return;
      const batch = pendingEvents;
      pendingEvents = [];
      fetch(EVENT_ENDPOINT, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: batch }),
      }).then(r => { if (!r.ok) pendingEvents.unshift(...batch); })   // requeue on failure
        .catch(() => pendingEvents.unshift(...batch));
    }
    function recordReadEvent(item, id, ms, by) {
      if (!onHttp()) return;
      pendingEvents.push({
        id, ms, words: wordCount(item),
        src: item.source || "", cat: item.category || "",
        img: item.image ? 1 : 0,
        score: typeof item.score === "number" ? item.score : null,
        by, at: new Date().toISOString(),
      });
      if (!eventTimer) eventTimer = setTimeout(flushEvents, 4000);
    }
    window.addEventListener("pagehide", () => {
      if (!onHttp() || !pendingEvents.length) return;
      const batch = pendingEvents;
      pendingEvents = [];
      try { navigator.sendBeacon(EVENT_ENDPOINT, new Blob([JSON.stringify({ events: batch })], { type: "application/json" })); } catch {}
    });

    const pageIsAttended = () => document.visibilityState === "visible" && document.hasFocus();

    // The pointer is a bias, not a trigger (v1's hover-only rule produced false
    // reads): dwell time still marks cards read, but a recently-moved mouse
    // resting inside a card outweighs centre-of-viewport when picking WHICH
    // visible card is being read. Weight decays so a parked mouse stops voting.
    let mouse = null;
    const onMouse = e => { mouse = { x: e.clientX, y: e.clientY, at: performance.now() }; };
    window.addEventListener("mousemove", onMouse, { passive: true });

    function pointerBonus(rect) {
      if (!mouse) return 0;
      const age = performance.now() - mouse.at;
      if (age > 45000) return 0;
      const inside = mouse.x >= rect.left && mouse.x <= rect.right &&
                     mouse.y >= rect.top && mouse.y <= rect.bottom;
      if (!inside) return 0;
      // Fresh pointer beats any coverage/centre difference (those sit in ~[0,1]);
      // as it ages it degrades into a mere tiebreaker.
      return age < 10000 ? 1.2 : 1.2 * (1 - (age - 10000) / 35000);
    }

    function visibilityScore(element) {
      const rect = element.getBoundingClientRect();
      const viewport = window.innerHeight || document.documentElement.clientHeight;
      const top = Math.max(rect.top, 0);
      const bottom = Math.min(rect.bottom, viewport);
      const visiblePixels = Math.max(0, bottom - top);
      const neededPixels = Math.min(rect.height * 0.52, viewport * 0.48);
      if (visiblePixels < neededPixels) return -Infinity;

      // Prefer the card occupying the reading line near the viewport centre,
      // with a small top-to-bottom reading-order nudge. Only one card earns
      // dwell credit at a time.
      const visibleCentre = (top + bottom) / 2;
      const centreDistance = Math.abs(visibleCentre - viewport / 2) / viewport;
      const coverage = visiblePixels / Math.min(rect.height, viewport);
      const readingOrderBias = (1 - top / viewport) * 0.06;
      return coverage - centreDistance * 0.45 + readingOrderBias + pointerBonus(rect);
    }

    function primaryCard() {
      let best = null, bestScore = -Infinity;
      for (const element of visible) {
        const id = getId(element);
        if (!id) continue;
        const score = visibilityScore(element);
        if (score > bestScore) { best = { id, element }; bestScore = score; }
      }
      return best;
    }

    // Cards the dwell threshold auto-committed THIS session. The auto-commit
    // logs a censored row (ms ≈ threshold) but the stopwatch keeps running while
    // the card stays primary, so a later ✓ press can record the true, longer
    // reading time — the algorithm deciding "read" early must not silence the
    // reader's own measurement (Swapnil, 2026-08-20). Per-id the analysis rule
    // is: a read-button row supersedes the dwell row.
    const dwellLogged = new Set();
    // Stop accruing after this much focused dwell on one card — keeps a card
    // left under a parked, focused viewport from logging an absurd outlier.
    const MAX_TRACK_MS = 180000;

    function commit(id, by = "read-button") {
      if (!id) return;
      const ms = Math.round(progress.get(id) || 0);
      if (by === "dwell") {
        // Threshold reached: mark read + log the censored row ONCE, but keep the
        // card observed and its clock running for a possible correcting ✓ press.
        if (!dwellLogged.has(id)) {
          dwellLogged.add(id);
          recordReadEvent(itemById[id] || {}, id, ms, by);
          markRead(id);
        }
        return;
      }
      // Explicit commits (✓ press / engagement) are terminal. Record when we have
      // a live measurement this session (ms > 0 — including the press that
      // corrects an earlier dwell row), or when the card was never read before;
      // skip only the junk 0ms re-tap on a card read in some earlier session.
      if (ms > 0 || !wasRead || !wasRead(id))
        recordReadEvent(itemById[id] || {}, id, ms, by);
      markRead(id);
      progress.delete(id);
      dwellLogged.delete(id);
      for (const element of visible) {
        if (getId(element) !== id) continue;
        visible.delete(element);
        observer?.unobserve(element);
      }
      if (activeId === id) activeId = null;
    }

    function tick(now) {
      const delta = Math.min(now - lastTick, 500);
      lastTick = now;
      const settled = now - lastScroll >= 850;
      const primary = pageIsAttended() && settled ? primaryCard() : null;
      activeId = primary?.id || null;

      if (activeId) {
        const elapsed = Math.min((progress.get(activeId) || 0) + delta, MAX_TRACK_MS);
        progress.set(activeId, elapsed);
        if (elapsed >= requiredReadMs(itemById[activeId]) && !dwellLogged.has(activeId))
          commit(activeId, "dwell");
      }
    }

    setInterval(() => tick(performance.now()), 250);
    const onScroll = () => { lastScroll = performance.now(); activeId = null; };
    window.addEventListener("scroll", onScroll, { passive: true });

    function arm() {
      observer?.disconnect();
      visible.clear();
      activeId = null;
      lastTick = performance.now();
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target);
          else visible.delete(entry.target);
        }
      }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
      container.querySelectorAll(selector).forEach(element => {
        const id = getId(element);
        if (id && !Wall.state.wasRead(id)) observer.observe(element);
      });
    }

    return {
      arm,
      // by: "read-button" (the ✓ tap — real end-of-reading time) vs "engage"
      // (share/±/ask/note/play — engagement implies read, but the dwell-so-far
      // may undershoot the true reading time, so label it apart)
      markExplicit: (id, by = "engage") => commit(id, by),
    };
  }

  Wall.readTracking = { createReadTracker };
})();
