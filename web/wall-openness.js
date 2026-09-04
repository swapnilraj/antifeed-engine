(() => {
  "use strict";
  const Wall = window.Wall ||= {};
  const config = window.WALL_OPENNESS;
  const model = Wall.opennessModel;
  const ENDPOINT = "/api/openness";
  const STOREKEY = "wall-openness-v1";
  const onHttp = () => /^https?:$/.test(location.protocol);
  const safeUrl = value => /^https?:\/\//i.test(String(value || "")) ? String(value) : "";

  let items = [];
  let itemById = {};
  let state = loadLocal();
  let statePromise = null;
  let pending = state.pending || {};
  delete state.pending;
  const pendingOutcomes = new Map();

  function loadLocal() {
    try {
      const raw = JSON.parse(localStorage.getItem(STOREKEY) || "{}");
      return { entries: model.mergeEntries(raw.entries), updatedAt: raw.updatedAt || null, pending: model.mergeEntries(raw.pending) };
    } catch { return { entries: {}, updatedAt: null }; }
  }
  function saveLocal() {
    try { localStorage.setItem(STOREKEY, JSON.stringify({ ...state, pending })); } catch {}
  }
  async function pushPatch(patch) {
    if (!onHttp() || !Object.keys(patch).length) return null;
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entries: patch }),
    });
    return response.ok ? response.json() : null;
  }
  async function flushPending() {
    const keys = Object.keys(pending);
    if (!onHttp() || !keys.length) return;
    for (let index = 0; index < keys.length; index += 100) {
      const patch = Object.fromEntries(keys.slice(index, index + 100).map(key => [key, pending[key]]));
      try {
        const remote = await pushPatch(patch);
        if (!remote?.entries) continue;
        state.entries = model.mergeEntries(state.entries, remote.entries);
        state.updatedAt = remote.updatedAt || state.updatedAt;
        for (const [key, sent] of Object.entries(patch))
          if (pending[key]?.at === sent.at) delete pending[key];
        saveLocal();
      } catch { return; }
    }
  }
  async function pullState() {
    if (!onHttp()) return state;
    try {
      const response = await fetch(ENDPOINT);
      const remote = response.ok ? await response.json() : null;
      if (remote?.entries) {
        state.entries = model.mergeEntries(state.entries, remote.entries);
        state.updatedAt = remote.updatedAt || state.updatedAt;
        saveLocal();
      }
      await flushPending();
    } catch { /* local state remains authoritative while offline */ }
    return state;
  }
  async function loadState() {
    if (!statePromise) statePromise = pullState();
    return statePromise;
  }
  async function saveEntries(patch) {
    state.entries = model.mergeEntries(state.entries, patch);
    pending = model.mergeEntries(pending, patch);
    state.updatedAt = new Date().toISOString();
    saveLocal();
    paintDashboard();
    if (!onHttp()) return state;
    try {
      const remote = await pushPatch(patch);
      if (remote?.entries) {
        state.entries = model.mergeEntries(state.entries, remote.entries);
        state.updatedAt = remote.updatedAt || state.updatedAt;
        for (const [key, sent] of Object.entries(patch))
          if (pending[key]?.at === sent.at) delete pending[key];
        saveLocal();
      }
    } catch { /* sync retries naturally on a later edit/focus */ }
    return state;
  }

  const snapshotOf = item => ({
    id: item.id,
    label: String(item.text || item.note || item.id).slice(0, 160),
    url: safeUrl(item.url),
    category: String(item.category || "ideas").slice(0, 40),
    explorationKind: item.exploration?.kind || "adjacent",
  });
  const experiment = () => state.entries.experiment;
  const active = () => experiment()?.status === "active";
  const entryValues = kind => Object.values(state.entries).filter(entry => entry?.kind === kind);
  const outcomeLabel = value => ({
    familiar: "Familiar", new: "New to me", surprised: "Surprised me",
    updated: "Updated my view", test: "I want to test this", enough: "Useful, but enough",
  })[value] || value;

  function recentSources() {
    const candidates = [];
    for (const item of items) {
      if (!item.exploration) continue;
      const at = Wall.state.getReadAt(item.id);
      if (at) candidates.push({ ...snapshotOf(item), at });
    }
    for (const reflection of entryValues("reflection"))
      candidates.push({ ...reflection.snapshot, at: reflection.at });
    const deduped = new Map();
    candidates.sort((a, b) => b.at.localeCompare(a.at)).forEach(candidate => {
      if (!deduped.has(candidate.id)) deduped.set(candidate.id, candidate);
    });
    return [...deduped.values()].slice(0, 3);
  }

  function surveyCard(phase) {
    return {
      id: `openness-survey-${phase}`,
      source: "openness",
      category: "ideas",
      postedAt: new Date().toISOString().slice(0, 10),
      insertAfter: 0,
      openness: { type: "survey", phase },
    };
  }
  function practiceCard(week) {
    return {
      id: `openness-practice-${week}`,
      source: "openness",
      category: "ideas",
      postedAt: new Date().toISOString().slice(0, 10),
      insertAfter: config.practiceAfter,
      openness: { type: "practice", week },
    };
  }
  function revisitCard(candidate) {
    return {
      id: `openness-revisit-${candidate.entry.cardId}`,
      source: "openness",
      category: candidate.entry.snapshot.category || "ideas",
      postedAt: new Date(candidate.dueAt).toISOString().slice(0, 10),
      insertAfter: config.revisitAfter,
      openness: { type: "revisit", reflection: candidate.entry },
    };
  }
  function createCards(now = Date.now()) {
    const entries = state.entries;
    if (!entries.experiment) return [surveyCard("baseline")];
    if (!active()) return [];
    const phase = model.dueSurvey(entries, config, now);
    if (phase) return [surveyCard(phase)];
    const cards = [];
    const week = model.currentWeek(entries.experiment.startedAt, now);
    if (week && !["completed", "skipped"].includes(entries[`practice:${week}`]?.status)) cards.push(practiceCard(week));
    const revisit = model.dueRevisits(entries, config, now)[0];
    if (revisit) cards.push(revisitCard(revisit));
    return cards;
  }

  function surveyHtml(phase) {
    const esc = Wall.renderers.esc;
    const title = phase === "baseline" ? "Start the six-week openness experiment"
      : phase === "midpoint" ? "Halfway check-in" : "Final check-in";
    const note = phase === "baseline"
      ? "This starts the 42-day clock. The wall will add deliberate novelty, reflection, and one practice each week."
      : phase === "midpoint" ? "Your score remains hidden until the end to reduce anchoring."
      : "Complete the same measure once more to reveal the three-point trajectory.";
    const rows = config.survey.items.map((item, index) => `<fieldset class="op-survey-row">
      <legend>${index + 1}. ${esc(item.text)}</legend>
      <div class="op-scale">${config.survey.labels.map((label, answer) => `<label title="${esc(label)}"><input type="radio" name="op-survey-${index}" value="${answer + 1}" required><span>${answer + 1}</span></label>`).join("")}</div>
      <div class="op-scale-ends"><span>${esc(config.survey.labels[0])}</span><span>${esc(config.survey.labels[4])}</span></div>
    </fieldset>`).join("");
    return `<article class="op-card op-survey-card" data-openness-card="true" data-item-id="openness-survey-${phase}">
      <div class="op-head"><span class="op-badge">openness</span><span>${esc(title)}</span><span class="op-progress">${phase}</span></div>
      <p class="op-intro">${esc(note)}</p>
      <details${phase === "baseline" ? "" : " open"}><summary>${phase === "baseline" ? "Review and start" : "Answer check-in"}</summary>
        <form class="op-survey" data-phase="${phase}"><p class="op-cue">${esc(config.survey.prompt)}</p>${rows}
          <div class="op-error" role="alert"></div><button class="op-primary" type="submit">${phase === "baseline" ? "Start experiment" : "Save check-in"}</button>
          <a class="op-source" href="${esc(config.survey.sourceUrl)}" target="_blank" rel="noopener">${esc(config.survey.source)} ↗</a>
        </form>
      </details>
    </article>`;
  }

  function sourceChoicesHtml(sources, selected = []) {
    const esc = Wall.renderers.esc;
    if (!sources.length) return `<p class="op-cue">No recent structured exploration card is available, so use the prompt generically.</p>`;
    return `<div class="op-sources">${sources.map(source => `<label><input type="checkbox" name="op-source" value="${esc(source.id)}" ${selected.includes(source.id) ? "checked" : ""}><span>${esc(source.label || source.id)}</span></label>`).join("")}</div>`;
  }
  function practiceHtml(week) {
    const esc = Wall.renderers.esc;
    const definition = config.practices[week - 1];
    const saved = state.entries[`practice:${week}`];
    const sources = recentSources();
    if (saved?.status === "accepted") return `<article class="op-card" data-openness-card="true" data-item-id="openness-practice-${week}">
      <div class="op-head"><span class="op-badge">practice</span><span>Week ${week} · ${esc(definition.title)}</span></div>
      <p class="op-prompt">${esc(definition.prompt)}</p><p class="op-plan"><b>Your plan:</b> ${esc(saved.plan)}</p>
      <form class="op-practice-complete" data-week="${week}"><textarea maxlength="500" required placeholder="What happened? Record one concrete observation."></textarea>
        <div class="op-error" role="alert"></div><div class="op-buttons"><button class="op-primary" type="submit">Complete practice</button><button class="op-skip" type="button" data-week="${week}">Skip</button></div>
      </form></article>`;
    return `<article class="op-card" data-openness-card="true" data-item-id="openness-practice-${week}">
      <div class="op-head"><span class="op-badge">practice</span><span>Week ${week} · ${esc(definition.title)}</span></div>
      <p class="op-prompt">${esc(definition.prompt)}</p>
      <form class="op-practice-start" data-week="${week}">${sourceChoicesHtml(sources)}
        <textarea maxlength="500" required placeholder="Write a small, concrete plan. An if-then form works well."></textarea>
        <div class="op-error" role="alert"></div><div class="op-buttons"><button class="op-primary" type="submit">Accept practice</button><button class="op-skip" type="button" data-week="${week}">Skip</button></div>
      </form></article>`;
  }
  function revisitHtml(reflection) {
    const esc = Wall.renderers.esc;
    const source = reflection.snapshot;
    const link = source.url ? `<a href="${esc(source.url)}" target="_blank" rel="noopener">review source ↗</a>` : "";
    return `<article class="op-card" data-openness-card="true" data-item-id="openness-revisit-${esc(reflection.cardId)}">
      <div class="op-head"><span class="op-badge">revisit</span><span>Four-day transfer check</span></div>
      <p class="op-prompt">Without rereading first, what remains from “${esc(source.label)}”?</p>
      <form class="op-revisit" data-card-id="${esc(reflection.cardId)}"><div class="op-retention">
        <label><input type="radio" name="retention" value="none" required>Not much</label>
        <label><input type="radio" name="retention" value="gist" required>The gist</label>
        <label><input type="radio" name="retention" value="specific" required>A specific model</label>
      </div><textarea maxlength="500" placeholder="Where else could this idea apply? (optional)"></textarea>
        <div class="op-error" role="alert"></div><button class="op-primary" type="submit">Save revisit</button> ${link}
      </form></article>`;
  }
  function renderRuntimeCard(item) {
    const payload = item.openness || {};
    if (payload.type === "survey") return surveyHtml(payload.phase);
    if (payload.type === "practice") return practiceHtml(payload.week);
    if (payload.type === "revisit") return revisitHtml(payload.reflection);
    return "";
  }

  function cardAddon(item) {
    if (!item.exploration || !active()) return "";
    const esc = Wall.renderers.esc;
    const prediction = state.entries[`prediction:${item.id}`];
    const reflection = state.entries[`reflection:${item.id}`];
    const pendingOutcome = pendingOutcomes.get(item.id);
    const selectedOutcome = pendingOutcome || reflection?.outcome;
    const credibility = item.exploration.credibility
      ? `<div class="op-cred"><b>Credibility:</b> ${esc(item.exploration.credibility)}</div>` : "";
    const predictionHtml = prediction
      ? `<div class="op-saved"><b>Prediction:</b> ${esc(prediction.text)}</div>`
      : `<form class="op-prediction" data-card-id="${esc(item.id)}"><input maxlength="280" placeholder="Optional: before opening, what do you expect?"><button type="submit">save prediction</button></form>`;
    const outcomes = model.OUTCOMES.map(outcome => `<button type="button" data-outcome="${outcome}" class="${selectedOutcome === outcome ? "on" : ""}">${esc(outcomeLabel(outcome))}</button>`).join("");
    const needsText = ["updated", "test"].includes(selectedOutcome);
    const detail = reflection?.text && !pendingOutcome ? `<div class="op-saved"><b>Reflection:</b> ${esc(reflection.text)}</div>`
      : `<form class="op-reflection-text" data-card-id="${esc(item.id)}" ${needsText ? "" : "hidden"}><input maxlength="500" required placeholder="What changed, or what will you test?"><button type="submit">save</button></form>`;
    return `<div class="openness-addon" data-openness-id="${esc(item.id)}">
      <div class="op-explore-head"><span class="op-badge op-kind-${esc(item.exploration.kind)}">${esc(item.exploration.kind)}</span><span>${esc(item.exploration.bridge)}</span></div>
      ${credibility}${predictionHtml}
      <div class="op-after"><div class="op-cue">After reading, what happened?</div><div class="op-outcomes" data-card-id="${esc(item.id)}">${outcomes}</div>${detail}<div class="op-error" role="alert"></div></div>
    </div>`;
  }

  function metrics() {
    const reflections = entryValues("reflection");
    const practices = entryValues("practice").filter(entry => entry.status === "completed");
    const revisits = entryValues("revisit");
    const meaningful = reflections.filter(entry => ["surprised", "updated", "test"].includes(entry.outcome));
    const categories = new Set(reflections.map(entry => entry.snapshot.category).filter(Boolean));
    const readExplorations = items.filter(item => item.exploration && Wall.state.getReadAt(item.id));
    const readKinds = Object.fromEntries(model.EXPLORATION_KINDS.map(kind => [kind, readExplorations.filter(item => item.exploration.kind === kind).length]));
    return { reflections, practices, revisits, meaningful, categories, readExplorations, readKinds };
  }
  function dashboardHtml() {
    const esc = Wall.renderers.esc;
    const exp = experiment();
    if (!exp) return `<div class="op-dashboard" id="opennessSummary"><h3>openness experiment</h3><div>Not started · baseline is available in the feed.</div></div>`;
    const data = metrics();
    const day = Math.min(config.durationDays, Math.floor(model.elapsedDays(exp.startedAt) || 0) + 1);
    const finalDone = !!state.entries["survey:final"];
    let scoreHtml = "";
    if (finalDone) {
      const phases = ["baseline", "midpoint", "final"].map(phase => {
        const survey = state.entries[`survey:${phase}`];
        return [phase, survey ? model.scoreSurvey(survey.responses, config.survey.items) : null];
      });
      scoreHtml = `<div class="op-scores">${phases.map(([phase, score]) => `<span><b>${esc(phase)}</b> ${score ? `${score.total}/50 · ${score.mean.toFixed(2)}` : "—"}</span>`).join("")}</div>`;
      const baseline = phases[0][1], final = phases[2][1];
      if (baseline && final) scoreHtml += `<div class="op-delta">Descriptive change: ${(final.mean - baseline.mean >= 0 ? "+" : "") + (final.mean - baseline.mean).toFixed(2)} mean points. This is not a causal or biological measure.</div>`;
    }
    const status = exp.status === "active" ? `day ${day} of ${config.durationDays} · week ${model.currentWeek(exp.startedAt)}` : exp.status;
    return `<div class="op-dashboard" id="opennessSummary"><h3>openness experiment</h3><div><b>${esc(status)}</b></div>
      <div>${data.reflections.length}/${config.success.reflections} reflections · ${data.practices.length}/${config.success.practices} practices · ${data.categories.size}/${config.success.categories} categories · ${data.meaningful.length}/${config.success.meaningfulOutcomes} meaningful outcomes · ${data.revisits.length} revisits</div>
      <div class="op-delta">Exploration read: ${data.readExplorations.length} · adjacent ${data.readKinds.adjacent} · wildcard ${data.readKinds.wildcard} · counterpoint ${data.readKinds.counterpoint}</div>
      ${scoreHtml}${exp.status === "active" ? `<button class="op-withdraw" type="button">withdraw from experiment</button>` : ""}</div>`;
  }
  function paintDashboard() {
    const current = document.getElementById("opennessSummary");
    if (!current) return;
    const host = document.createElement("div");
    host.innerHTML = dashboardHtml();
    current.replaceWith(host.firstElementChild);
  }
  function paintAddon(cardId) {
    const item = itemById[cardId];
    const escaped = window.CSS?.escape ? CSS.escape(cardId) : cardId.replace(/[^a-z0-9_-]/gi, "\\$&");
    const current = document.querySelector(`.openness-addon[data-openness-id="${escaped}"]`);
    if (!item || !current) return;
    const host = document.createElement("div");
    host.innerHTML = cardAddon(item);
    current.replaceWith(host.firstElementChild);
  }
  const showError = (form, text) => { const el = form.querySelector(".op-error"); if (el) el.textContent = text; };

  function install({ feed }) {
    feed.addEventListener("submit", async event => {
      const form = event.target;
      if (!form.matches(".op-survey, .op-prediction, .op-reflection-text, .op-practice-start, .op-practice-complete, .op-revisit")) return;
      event.preventDefault();
      const at = new Date().toISOString();
      if (form.matches(".op-survey")) {
        const responses = config.survey.items.map((_, index) => Number(new FormData(form).get(`op-survey-${index}`)));
        if (responses.some(answer => !Number.isInteger(answer) || answer < 1 || answer > 5)) return showError(form, "Answer all ten items.");
        const phase = form.dataset.phase;
        const patch = { [`survey:${phase}`]: { kind: "survey", phase, responses, at } };
        if (phase === "baseline") patch.experiment = { kind: "experiment", status: "active", startedAt: at, at };
        if (phase === "final") patch.experiment = { kind: "experiment", status: "completed", startedAt: experiment().startedAt, at };
        await saveEntries(patch);
        location.reload();
        return;
      }
      if (form.matches(".op-prediction")) {
        const cardId = form.dataset.cardId, item = itemById[cardId];
        const text = form.querySelector("input").value.trim();
        if (!text || !item) return;
        await saveEntries({ [`prediction:${cardId}`]: { kind: "prediction", cardId, text, snapshot: snapshotOf(item), at } });
        paintAddon(cardId);
        return;
      }
      if (form.matches(".op-reflection-text")) {
        const cardId = form.dataset.cardId, item = itemById[cardId];
        const current = state.entries[`reflection:${cardId}`];
        const outcome = pendingOutcomes.get(cardId) || current?.outcome;
        const text = form.querySelector("input").value.trim();
        if (!text || !outcome || !item) return showError(form.closest(".op-after"), "Add one concrete sentence.");
        await saveEntries({ [`reflection:${cardId}`]: { kind: "reflection", cardId, outcome, text, snapshot: snapshotOf(item), at } });
        pendingOutcomes.delete(cardId);
        paintAddon(cardId);
        return;
      }
      if (form.matches(".op-practice-start")) {
        const week = Number(form.dataset.week);
        const sourceIds = [...form.querySelectorAll('input[name="op-source"]:checked')].map(input => input.value);
        const need = week === 4 && form.querySelectorAll('input[name="op-source"]').length >= 2 ? 2 : (form.querySelector('input[name="op-source"]') ? 1 : 0);
        if (sourceIds.length < need) return showError(form, `Choose ${need === 2 ? "two sources" : "a source"}.`);
        const plan = form.querySelector("textarea").value.trim();
        if (!plan) return showError(form, "Write a concrete plan first.");
        await saveEntries({ [`practice:${week}`]: { kind: "practice", week, status: "accepted", sourceIds: sourceIds.slice(0, 2), plan, reflection: "", at } });
        location.reload();
        return;
      }
      if (form.matches(".op-practice-complete")) {
        const week = Number(form.dataset.week), current = state.entries[`practice:${week}`];
        const reflection = form.querySelector("textarea").value.trim();
        if (!reflection || !current) return showError(form, "Record one concrete observation.");
        await saveEntries({ [`practice:${week}`]: { ...current, status: "completed", reflection, at } });
        location.reload();
        return;
      }
      if (form.matches(".op-revisit")) {
        const cardId = form.dataset.cardId;
        const retention = new FormData(form).get("retention");
        if (!retention) return showError(form, "Choose how much you retained.");
        const transfer = form.querySelector("textarea").value.trim();
        await saveEntries({ [`revisit:${cardId}:4`]: { kind: "revisit", cardId, retention, transfer, at } });
        location.reload();
      }
    });

    feed.addEventListener("click", async event => {
      const outcome = event.target.closest(".op-outcomes button");
      if (outcome) {
        const cardId = outcome.closest(".op-outcomes").dataset.cardId;
        const item = itemById[cardId];
        if (!item) return;
        const value = outcome.dataset.outcome;
        const previous = state.entries[`reflection:${cardId}`];
        const text = previous?.outcome === value ? previous.text : "";
        if (["updated", "test"].includes(value) && !text) {
          pendingOutcomes.set(cardId, value);
          paintAddon(cardId);
          document.querySelector(`.openness-addon[data-openness-id="${cardId}"] .op-reflection-text input`)?.focus();
          return;
        }
        await saveEntries({ [`reflection:${cardId}`]: { kind: "reflection", cardId, outcome: value, text, snapshot: snapshotOf(item), at: new Date().toISOString() } });
        paintAddon(cardId);
        return;
      }
      const skip = event.target.closest(".op-skip");
      if (skip) {
        const week = Number(skip.dataset.week), previous = state.entries[`practice:${week}`];
        await saveEntries({ [`practice:${week}`]: { kind: "practice", week, status: "skipped", sourceIds: previous?.sourceIds || [], plan: previous?.plan || "", reflection: "", at: new Date().toISOString() } });
        location.reload();
      }
    });

    document.getElementById("algoBody")?.addEventListener("click", async event => {
      if (!event.target.closest(".op-withdraw")) return;
      if (!confirm("Withdraw from the experiment? Existing private data will be kept.")) return;
      const current = experiment();
      await saveEntries({ experiment: { kind: "experiment", status: "withdrawn", startedAt: current.startedAt, at: new Date().toISOString() } });
      location.reload();
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) { statePromise = null; loadState().then(paintDashboard); }
    });
  }

  async function init({ items: feedItems }) {
    items = feedItems;
    itemById = Object.fromEntries(items.filter(item => item.id).map(item => [item.id, item]));
    await Promise.all([Wall.state.readsReady, loadState()]);
    return createCards();
  }

  Wall.openness = { init, install, renderRuntimeCard, cardAddon, dashboardHtml, paintDashboard };
})();
