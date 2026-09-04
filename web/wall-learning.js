(() => {
  "use strict";
  const Wall = window.Wall ||= {};
  const config = window.WALL_LEARNING || { tracks: [] };
  const schedule = Wall.learningSchedule;
  const ENDPOINT = "/api/learning";
  const STOREKEY = "wall-learning-v1";
  const onHttp = () => /^https?:$/.test(location.protocol);

  const loadLocal = () => {
    try {
      const state = JSON.parse(localStorage.getItem(STOREKEY) || "{}");
      return { attempts: Array.isArray(state.attempts) ? state.attempts : [] };
    } catch { return { attempts: [] }; }
  };
  const saveLocal = state => {
    try { localStorage.setItem(STOREKEY, JSON.stringify(state)); } catch {}
  };
  const keyOf = attempt => `${attempt.track}\u0000${attempt.concept}\u0000${attempt.at}`;
  const mergeAttempts = (...groups) => [...new Map(groups.flat().map(attempt => [keyOf(attempt), attempt])).values()]
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));

  let state = loadLocal();
  let statePromise = null;
  const answeredCards = new Set();
  async function loadState() {
    if (statePromise) return statePromise;
    statePromise = (async () => {
      if (!onHttp()) return state;
      try {
        const response = await fetch(ENDPOINT);
        const remote = response.ok ? await response.json() : null;
        if (Array.isArray(remote?.attempts)) {
          state.attempts = mergeAttempts(state.attempts, remote.attempts);
          saveLocal(state);
        }
      } catch { /* offline: local attempts still drive the schedule */ }
      return state;
    })();
    return statePromise;
  }

  const attemptsFor = (track, concept) => state.attempts.filter(attempt =>
    attempt.track === track && attempt.concept === concept);

  function firstRead(sourceIds) {
    return sourceIds.map(id => Wall.state.getReadAt(id)).filter(Boolean).sort()[0] || null;
  }

  function questionFor(concept, attempts) {
    return attempts.length % concept.questions.length;
  }

  async function createCards({ items }) {
    await Promise.all([Wall.state.readsReady, loadState()]);
    const baseById = Object.fromEntries(items.map(item => [item.id, item]));
    const due = [];
    for (const track of config.tracks || []) {
      const trackDue = [];
      for (const concept of track.concepts || []) {
        const attempts = attemptsFor(track.id, concept.id);
        const status = schedule.reviewStatus({
          introducedAt: firstRead(concept.sourceIds || []),
          attempts,
          scheduleDays: track.scheduleDays,
          retryDays: track.retryDays,
        });
        if (!status.due) continue;
        const questionIndex = questionFor(concept, attempts);
        const source = baseById[(concept.sourceIds || [])[0]];
        trackDue.push({
          id: `learning-${track.id}-${concept.id}`,
          source: "learning",
          category: track.category || "ideas",
          postedAt: status.dueAt.slice(0, 10),
          learning: {
            trackId: track.id,
            trackTitle: track.title,
            conceptId: concept.id,
            conceptTitle: concept.title,
            unitLabel: track.unitLabel,
            rung: concept.rung,
            interleaveEvery: track.interleaveEvery,
            questionIndex,
            question: concept.questions[questionIndex],
            reviewNumber: status.reviewNumber,
            reviewTotal: track.scheduleDays.length,
            sourceUrl: concept.sourceUrl || source?.url || "",
          },
          dueAt: status.dueAt,
        });
      }
      trackDue.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
      due.push(...trackDue);
    }
    return due.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  }

  function recordAttempt(attempt) {
    state.attempts = mergeAttempts(state.attempts, [attempt]);
    saveLocal(state);
    if (!onHttp()) return;
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attempts: [attempt] }),
    }).then(async response => {
      if (!response.ok) return;
      const remote = await response.json();
      if (Array.isArray(remote?.attempts)) {
        state.attempts = mergeAttempts(state.attempts, remote.attempts);
        saveLocal(state);
      }
    }).catch(() => {});
  }

  function findTrack(id) {
    return (config.tracks || []).find(track => track.id === id);
  }

  function install({ feed }) {
    feed.addEventListener("click", event => {
      const choice = event.target.closest(".quiz-choice");
      const card = choice?.closest(".quizcard");
      if (!choice || !card || card.dataset.answered) return;
      const track = findTrack(card.dataset.track);
      const concept = track?.concepts.find(candidate => candidate.id === card.dataset.concept);
      const questionIndex = Number(card.dataset.question);
      const question = concept?.questions[questionIndex];
      const picked = Number(choice.dataset.choice);
      if (!question || !Number.isInteger(picked)) return;

      card.dataset.answered = "true";
      const correct = picked === question.answer;
      card.querySelectorAll(".quiz-choice").forEach((button, index) => {
        button.disabled = true;
        if (index === question.answer) button.classList.add("correct");
        else if (index === picked) button.classList.add("wrong");
      });
      const result = card.querySelector(".quiz-result");
      result.hidden = false;
      result.querySelector(".quiz-result-title").textContent = correct ? "Got it." : "Not yet—good miss.";

      const attempt = {
        track: track.id,
        concept: concept.id,
        question: questionIndex,
        correct,
        at: new Date().toISOString(),
      };
      answeredCards.add(card.dataset.itemId);
      recordAttempt(attempt);
      const status = schedule.reviewStatus({
        introducedAt: firstRead(concept.sourceIds || []),
        attempts: attemptsFor(track.id, concept.id),
        scheduleDays: track.scheduleDays,
        retryDays: track.retryDays,
      });
      const next = card.querySelector(".quiz-next");
      next.textContent = status.mastered
        ? `${track.scheduleDays.length} successful recalls—this concept is maintained.`
        : `${correct ? "Next spaced review" : "Retry"}: ${new Date(status.dueAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}.`;
    });
  }

  Wall.learning = { createCards, install, wasAnswered: id => answeredCards.has(id) };
})();
