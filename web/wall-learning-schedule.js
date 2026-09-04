(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.Wall ||= {}).learningSchedule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const DAY_MS = 24 * 60 * 60 * 1000;

  function validTime(value) {
    const time = typeof value === "number" ? value : Date.parse(value);
    return Number.isFinite(time) ? time : null;
  }

  function reviewStatus({ introducedAt, attempts = [], scheduleDays = [1, 4, 10, 30], retryDays = 1, now = Date.now() }) {
    const introduced = validTime(introducedAt);
    const clock = validTime(now);
    if (introduced == null || clock == null) return { eligible: false, mastered: false, due: false };
    const clean = attempts
      .filter(attempt => attempt && typeof attempt.correct === "boolean" && validTime(attempt.at) != null)
      .sort((a, b) => validTime(a.at) - validTime(b.at));
    const correct = clean.filter(attempt => attempt.correct).length;
    if (correct >= scheduleDays.length)
      return { eligible: true, mastered: true, due: false, correct, total: clean.length };

    const latest = clean.at(-1);
    const intervalDays = !latest ? scheduleDays[0]
      : latest.correct ? scheduleDays[correct]
      : retryDays;
    const anchor = latest ? validTime(latest.at) : introduced;
    const dueAtMs = anchor + intervalDays * DAY_MS;
    return {
      eligible: true,
      mastered: false,
      due: clock >= dueAtMs,
      dueAt: new Date(dueAtMs).toISOString(),
      correct,
      total: clean.length,
      reviewNumber: correct + 1,
    };
  }

  return { DAY_MS, reviewStatus };
});
