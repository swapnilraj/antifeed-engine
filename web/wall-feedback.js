(() => {
  "use strict";
  const Wall = window.Wall ||= {};
  const PROVIDERS = [
    { name: "Claude", url: prompt => `https://claude.ai/new?q=${prompt}` },
    { name: "ChatGPT", url: prompt => `https://chatgpt.com/?q=${prompt}` },
    { name: "Grok", url: prompt => `https://grok.com/?q=${prompt}` },
  ];

  function create({ feed, items, readTracker }) {
    const { esc } = Wall.renderers;
    const { fbLoad, fbSave, syncFb, fbText } = Wall.state;
    const itemById = Object.fromEntries(items.filter(item => item.id).map(item => [item.id, item]));

    // Deleted signals live on as { removed: true, at } tombstones so removal
    // syncs across devices (the server merges by newest `at`; a plain delete
    // would just resurrect on the next pull). Everywhere the UI reads the
    // store, a tombstone counts as "no signal".
    const live = signal => signal && !signal.removed ? signal : undefined;

    function paint() {
      const store = fbLoad();
      feed.querySelectorAll(".fb").forEach(el => {
        const signal = live(store[el.dataset.id]);
        el.querySelector(".fb-more").classList.toggle("on", signal?.dir === "more");
        el.querySelector(".fb-less").classList.toggle("on", signal?.dir === "less");
        el.querySelector(".fb-note").classList.toggle("on", !!live(store[`${el.dataset.id}#note`]));
        // one-way: only an actual press lights the ✓, never dwell/engage/synced reads
        el.querySelector(".fb-read")?.classList.toggle("on", Wall.state.wasPressed(el.dataset.id));
      });
      const count = Object.values(store).filter(live).length;
      const countEl = document.getElementById("fbcount");
      if (countEl) countEl.textContent = count
        ? `${count} signal${count === 1 ? "" : "s"} pending — synced automatically; the next sweep folds them in.`
        : "Tap ＋ / － on any card to teach your algorithm. Signals sync on their own — nothing to copy.";
      Wall.openness?.paintDashboard?.();
    }

    function promptFor(item) {
      return encodeURIComponent([
        "I'm reading my personal knowledge feed and want to go deeper on this item:",
        `"${(item.text || "").slice(0, 1200)}"`,
        `— ${item.author || "?"}${item.handle ? ` (${item.handle})` : ""}, ${item.source || ""}, ${item.postedAt || ""}`,
        item.note ? `Why it's on my wall: ${item.note}` : "",
        item.url ? `Source: ${item.url}` : "",
        "Explain the key ideas simply, add the context I'm probably missing, give the strongest counterargument, and suggest what to explore next.",
      ].filter(Boolean).join("\n\n"));
    }

    const closePanels = except => feed.querySelectorAll(".askpop, .notebox").forEach(el => {
      if (el !== except) el.remove();
    });

    function toggleAsk(feedbackEl, item) {
      const host = feedbackEl.closest(".why");
      const open = host.nextElementSibling?.matches(".askpop") ? host.nextElementSibling : null;
      closePanels(open);
      if (open) return open.remove();
      const panel = document.createElement("div");
      panel.className = "askpop";
      panel.innerHTML = PROVIDERS.map(provider => `<button class="provider" data-provider="${esc(provider.name)}">${esc(provider.name)}</button>`).join("")
        + `<span class="hint">opens with this card as context — uses your subscription</span>`;
      panel.addEventListener("click", event => {
        const button = event.target.closest(".provider");
        if (!button) return;
        const provider = PROVIDERS.find(candidate => candidate.name === button.dataset.provider);
        if (!provider) return;
        readTracker.markExplicit(item.id);
        window.open(provider.url(promptFor(item)), "_blank", "noopener");
        panel.remove();
      });
      host.after(panel);
    }

    function toggleNote(feedbackEl, item) {
      const host = feedbackEl.closest(".why");
      const open = host.nextElementSibling?.matches(".notebox") ? host.nextElementSibling : null;
      closePanels(open);
      if (open) return open.remove();
      const key = `${item.id}#note`;
      const box = document.createElement("div");
      box.className = "notebox";
      box.innerHTML = `<input type="text" maxlength="500" placeholder="tell your algorithm anything — e.g. 'more of this, but UK-focused'" value="${esc(live(fbLoad()[key])?.text || "")}"><button>save</button>`;
      const input = box.querySelector("input");
      const save = () => {
        const text = input.value.trim();
        const store = fbLoad();
        if (text) store[key] = { kind: "note", text, at: new Date().toISOString() };
        else if (live(store[key])) store[key] = { removed: true, at: new Date().toISOString() };
        if (text) readTracker.markExplicit(item.id);
        fbSave(store);
        paint();
        syncFb(true);
        box.remove();
      };
      box.querySelector("button").addEventListener("click", save);
      input.addEventListener("keydown", event => { if (event.key === "Enter") save(); });
      host.after(box);
      input.focus();
    }

    feed.addEventListener("click", event => {
      const button = event.target.closest(".fb button");
      if (!button) return;
      event.preventDefault();
      const feedbackEl = button.closest(".fb");
      const id = feedbackEl.dataset.id;
      const item = itemById[id] || { id };
      if (button.classList.contains("fb-ask")) return toggleAsk(feedbackEl, item);
      if (button.classList.contains("fb-note")) return toggleNote(feedbackEl, item);
      // The read button just marks the card read (records the timing event and
      // paints it read) — it is not an algorithm signal, so it returns early.
      // One-way: the press itself is what lights the button (and persists that),
      // so reads arriving any other way never activate it.
      if (button.classList.contains("fb-read")) {
        Wall.state.markPressed(id);
        button.classList.add("on");
        return readTracker.markExplicit(id, "read-button");
      }
      readTracker.markExplicit(id);
      const direction = button.classList.contains("fb-more") ? "more" : "less";
      const store = fbLoad();
      if (live(store[id])?.dir === direction) store[id] = { removed: true, at: new Date().toISOString() };
      else store[id] = { dir: direction, at: new Date().toISOString() };
      fbSave(store);
      paint();
      syncFb(true);
    });

    function panelHtml() {
      const scored = items.filter(item => typeof item.score === "number");
      const average = scored.length ? (scored.reduce((sum, item) => sum + item.score, 0) / scored.length).toFixed(1) : "–";
      const counts = Array(11).fill(0);
      scored.forEach(item => counts[Math.max(0, Math.min(10, Math.round(item.score)))]++);
      const max = Math.max(...counts, 1);
      const histogram = counts.map((count, score) => count
        ? `<div class="hrow"><span class="hlbl">${score}</span><span class="htrack"><span class="hfill" style="width:${Math.round(count / max * 100)}%"></span></span><span class="hn">${count}</span></div>`
        : "").reverse().join("");
      const tally = key => {
        const totals = {};
        items.forEach(item => { if (item[key]) totals[item[key]] = (totals[item[key]] || 0) + 1; });
        return Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([value, count]) => `${esc(value)} ×${count}`).join(" · ") || "–";
      };
      const run = (window.WALL_RUNS || [])[0];
      const runHtml = run
        ? `<div><h3>last sweep — ${esc(run.date)}</h3><div>${Number(run.seen) || 0} candidates ranked → <b>${Number(run.kept) || 0}</b> kept</div>${(run.drops || []).map(drop => `<div class="drop"><b>${esc(String(drop.score))}/10</b> ${esc(drop.text)}${drop.why ? ` <span class="dim">— ${esc(drop.why)}</span>` : ""}</div>`).join("")}${run.notes ? `<div class="dim">${esc(run.notes)}</div>` : ""}</div>`
        : `<div class="dim">No sweep log yet — the next collection run records what was seen and dropped, not just what was kept.</div>`;
      const opennessHtml = Wall.openness?.dashboardHtml?.() || "";
      return `<div><h3>on the wall</h3><div>${items.length} cards · avg score <b>${average}</b>/10 · sources: ${tally("source")}</div><div class="hist">${histogram}</div></div><div><h3>found via</h3><div>${tally("via")}</div></div>${opennessHtml}${runHtml}<div><h3>feedback</h3><div class="dim" id="fbcount"></div><div class="algo-actions"><button id="fbcopy">copy for your AI</button><button id="fbclear">clear</button></div></div>`;
    }

    document.getElementById("algoBody").innerHTML = panelHtml();
    document.getElementById("fbcopy").addEventListener("click", async event => {
      try { await navigator.clipboard.writeText(fbText()); }
      catch { window.prompt("Copy this for your AI:", fbText()); }
      event.target.textContent = "copied ✓";
      setTimeout(() => event.target.textContent = "copy for your AI", 1500);
    });
    document.getElementById("fbclear").addEventListener("click", () => {
      const store = fbLoad();
      const at = new Date().toISOString();
      for (const [key, signal] of Object.entries(store))
        if (live(signal)) store[key] = { removed: true, at };
      fbSave(store);
      paint();
      syncFb(true);
    });
    syncFb(false);
    Wall.onFeedbackChange = paint;
    document.addEventListener("visibilitychange", () => { if (!document.hidden) syncFb(false); });

    return { paint };
  }

  Wall.feedback = { create };
})();
