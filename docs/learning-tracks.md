# Learning-track template

Adaptive learning is topic-agnostic. `web/wall-learning-template.js` converts a compact topic
definition into the runtime shape used by the scheduler, feed renderer, validator, and
cross-device `/api/learning` state. `data/learning.js` contains the active definitions; nuclear
basics is the first instance.

## Add a topic

Pass another object to `defineProgram`:

```js
window.WALL_LEARNING = defineProgram(
  nuclearBasics,
  {
    topic: {
      id: "market-microstructure-basics",
      title: "Market microstructure basics",
      category: "markets",
      unitLabel: "Lesson",
    },
    review: {
      days: [1, 4, 10, 30],
      retryAfterDays: 1,
      interleaveEvery: 7,
    },
    concepts: [
      {
        id: "spread",
        title: "Bid–ask spread",
        source: {
          cardId: "an-existing-wall-card-id",
          url: "https://example.com/source",
        },
        questions: [
          {
            prompt: "What does the bid–ask spread measure?",
            choices: ["...", "...", "..."],
            answer: 0,
            explanation: "Explain the mental model, not merely the correct letter.",
          },
          {
            prompt: "A second retrieval variant for the same concept",
            choices: ["...", "...", "..."],
            answer: 1,
            explanation: "Use a different angle so recall is not tied to one wording.",
          },
        ],
      },
    ],
  },
);
```

The parameters are:

- `topic`: stable id, display title, feed category, and the label shown before concept numbers.
- `review.days`: expanding intervals after successful recalls.
- `review.retryAfterDays`: interval after a miss.
- `review.interleaveEvery`: normal feed cards placed between due reviews.
- `concepts`: ordered learning units. Omit `rung` to use their array position.
- `source.cardId`: an existing live or archived wall card. Reading it unlocks the concept.
- `source.url`: the durable review link retained after the source card archives.
- `questions`: at least two multiple-choice retrieval variants with explanatory feedback.

Run `npm test` and `npm run validate` after adding a track. Validation rejects duplicate ids,
bad schedules, missing source cards, mismatched source URLs, and malformed questions.

Wrong answers affect only review timing. They must never become negative interest feedback.
