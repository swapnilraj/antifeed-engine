(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WallLearningTemplate = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_REVIEW_DAYS = Object.freeze([1, 4, 10, 30]);

  const copyQuestions = questions => (Array.isArray(questions) ? questions : []).map(question => ({
    ...question,
    choices: Array.isArray(question?.choices) ? [...question.choices] : question?.choices,
  }));

  function sourceIds(source, concept) {
    if (Array.isArray(source.cardIds)) return [...source.cardIds];
    if (source.cardId) return [source.cardId];
    return Array.isArray(concept.sourceIds) ? [...concept.sourceIds] : [];
  }

  function defineTrack(definition = {}) {
    const topic = definition.topic || {};
    const review = definition.review || {};
    const concepts = Array.isArray(definition.concepts) ? definition.concepts : [];
    return {
      id: topic.id,
      title: topic.title,
      category: topic.category || "ideas",
      unitLabel: topic.unitLabel || "Unit",
      scheduleDays: [...(review.days || DEFAULT_REVIEW_DAYS)],
      retryDays: review.retryAfterDays ?? 1,
      interleaveEvery: review.interleaveEvery ?? 7,
      concepts: concepts.map((concept, index) => {
        const source = concept.source || {};
        return {
          id: concept.id,
          rung: concept.rung ?? index + 1,
          title: concept.title,
          sourceIds: sourceIds(source, concept),
          sourceUrl: source.url || concept.sourceUrl,
          questions: copyQuestions(concept.questions),
        };
      }),
    };
  }

  function defineProgram(...definitions) {
    return { tracks: definitions.flat().map(defineTrack) };
  }

  return { DEFAULT_REVIEW_DAYS, defineTrack, defineProgram };
});
