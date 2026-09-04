(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.Wall ||= {}).opennessModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const OUTCOMES = ["familiar", "new", "surprised", "updated", "test", "enough"];
  const EXPLORATION_KINDS = ["adjacent", "wildcard", "counterpoint"];
  const PRACTICE_STATUSES = ["accepted", "completed", "skipped"];
  const RETENTION = ["none", "gist", "specific"];
  const PHASES = ["baseline", "midpoint", "final"];

  const isObject = value => value && typeof value === "object" && !Array.isArray(value);
  const isISO = value => typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
  const shortId = value => typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,119}$/i.test(value);
  const clipped = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
  const safeUrl = value => typeof value === "string" && (value === "" || /^https?:\/\//i.test(value)) ? value : "";

  function cleanSnapshot(value) {
    if (!isObject(value) || !shortId(value.id)) return null;
    const kind = EXPLORATION_KINDS.includes(value.explorationKind) ? value.explorationKind : "adjacent";
    return {
      id: value.id,
      label: clipped(value.label, 160),
      url: safeUrl(value.url),
      category: clipped(value.category, 40),
      explorationKind: kind,
    };
  }

  function cleanEntry(key, value) {
    if (!isObject(value) || !isISO(value.at) || typeof value.kind !== "string") return null;
    if (key === "experiment" && value.kind === "experiment") {
      if (!["active", "completed", "withdrawn"].includes(value.status) || !isISO(value.startedAt)) return null;
      return { kind: "experiment", status: value.status, startedAt: value.startedAt, at: value.at };
    }
    if (value.kind === "survey" && /^survey:(baseline|midpoint|final)$/.test(key)) {
      const phase = key.split(":")[1];
      if (value.phase !== phase || !PHASES.includes(value.phase) || !Array.isArray(value.responses) ||
          value.responses.length !== 10 || value.responses.some(answer => !Number.isInteger(answer) || answer < 1 || answer > 5)) return null;
      return { kind: "survey", phase, responses: value.responses.slice(), at: value.at };
    }
    if (value.kind === "prediction" && key.startsWith("prediction:") && shortId(value.cardId)) {
      const text = clipped(value.text, 280);
      const snapshot = cleanSnapshot(value.snapshot);
      if (!text || !snapshot || key !== `prediction:${value.cardId}`) return null;
      return { kind: "prediction", cardId: value.cardId, text, snapshot, at: value.at };
    }
    if (value.kind === "reflection" && key.startsWith("reflection:") && shortId(value.cardId)) {
      const text = clipped(value.text, 500);
      const snapshot = cleanSnapshot(value.snapshot);
      if (!OUTCOMES.includes(value.outcome) || !snapshot || key !== `reflection:${value.cardId}`) return null;
      if (["updated", "test"].includes(value.outcome) && !text) return null;
      return { kind: "reflection", cardId: value.cardId, outcome: value.outcome, text, snapshot, at: value.at };
    }
    if (value.kind === "revisit" && /^revisit:[a-z0-9._-]+:4$/i.test(key) && shortId(value.cardId)) {
      const transfer = clipped(value.transfer, 500);
      if (!RETENTION.includes(value.retention) || key !== `revisit:${value.cardId}:4`) return null;
      return { kind: "revisit", cardId: value.cardId, retention: value.retention, transfer, at: value.at };
    }
    if (value.kind === "practice" && /^practice:[1-6]$/.test(key)) {
      const week = Number(key.split(":")[1]);
      const sourceIds = Array.isArray(value.sourceIds) ? [...new Set(value.sourceIds.filter(shortId))].slice(0, 2) : [];
      const plan = clipped(value.plan, 500);
      const reflection = clipped(value.reflection, 500);
      if (value.week !== week || !PRACTICE_STATUSES.includes(value.status)) return null;
      if (value.status === "accepted" && !plan) return null;
      if (value.status === "completed" && !reflection) return null;
      return { kind: "practice", week, status: value.status, sourceIds, plan, reflection, at: value.at };
    }
    return null;
  }

  function mergeEntries(...groups) {
    const merged = {};
    for (const group of groups) {
      if (!isObject(group)) continue;
      for (const [key, raw] of Object.entries(group)) {
        const entry = cleanEntry(key, raw);
        if (!entry) continue;
        if (!merged[key] || entry.at > merged[key].at) merged[key] = entry;
      }
    }
    return merged;
  }

  function scoreSurvey(responses, items) {
    if (!Array.isArray(responses) || !Array.isArray(items) || responses.length !== items.length) return null;
    let total = 0;
    for (let index = 0; index < items.length; index++) {
      const answer = responses[index];
      if (!Number.isInteger(answer) || answer < 1 || answer > 5) return null;
      total += items[index].key === "-" ? 6 - answer : answer;
    }
    return { total, mean: total / items.length };
  }

  const elapsedDays = (startedAt, now = Date.now()) => {
    const start = Date.parse(startedAt);
    const clock = typeof now === "number" ? now : Date.parse(now);
    return Number.isFinite(start) && Number.isFinite(clock) ? Math.max(0, (clock - start) / DAY_MS) : null;
  };
  const currentWeek = (startedAt, now = Date.now()) => {
    const days = elapsedDays(startedAt, now);
    return days == null ? null : Math.min(6, Math.floor(days / 7) + 1);
  };
  function dueSurvey(entries, config, now = Date.now()) {
    const experiment = entries?.experiment;
    if (!experiment) return "baseline";
    if (experiment.status !== "active") return null;
    const days = elapsedDays(experiment.startedAt, now);
    if (days >= config.midpointDay && !entries["survey:midpoint"]) return "midpoint";
    if (days >= config.durationDays && !entries["survey:final"]) return "final";
    return null;
  }
  function dueRevisits(entries, config, now = Date.now()) {
    const experiment = entries?.experiment;
    if (!experiment || experiment.status !== "active") return [];
    const end = Date.parse(experiment.startedAt) + config.durationDays * DAY_MS;
    const clock = typeof now === "number" ? now : Date.parse(now);
    if (!Number.isFinite(clock) || clock >= end) return [];
    return Object.values(entries)
      .filter(entry => entry?.kind === "reflection" && ["updated", "test"].includes(entry.outcome))
      .map(entry => ({ entry, dueAt: Date.parse(entry.at) + config.revisitAfterDays * DAY_MS }))
      .filter(({ entry, dueAt }) => dueAt <= clock && dueAt <= end &&
        clock <= dueAt + config.revisitExpiresAfterDays * DAY_MS && !entries[`revisit:${entry.cardId}:4`])
      .sort((a, b) => a.dueAt - b.dueAt);
  }

  return {
    DAY_MS, OUTCOMES, EXPLORATION_KINDS, cleanEntry, mergeEntries, scoreSurvey,
    elapsedDays, currentWeek, dueSurvey, dueRevisits,
  };
});
