// The agent asked the person something. The bar is that the answer would change
// what it does — not that it is blocked, which read as a last resort and pushed
// agents into asking in prose instead. See `system/questions-shape.md`.

import { Array as Arr, Schema } from "effect"
import { Question } from "./question.js"

export const Questions = Schema.Struct({
  type: Schema.tag("questions"),
  questions: Schema.NonEmptyArray(Question),
})
export type Questions = Schema.Schema.Type<typeof Questions>

/** Shorthand for the common case: a question with no context and no options. */
export const askPlainly = (...questions: readonly [string, ...string[]]): Questions =>
  Questions.make({
    questions: [
      { question: questions[0], options: [] },
      ...questions.slice(1).map((question) => ({ question, options: [] })),
    ],
  })

/**
 * The option the asker recommended on each question, by position — what an
 * unattended trak takes for it. A question with no recommendation is left `{}`, for
 * the agent to decide.
 */
export const recommendations = (q: Questions) =>
  Arr.map(q.questions, (question) => {
    const label = question.options.find((o) => o.recommended === true)?.label
    return label === undefined ? {} : { recommended: label }
  })
