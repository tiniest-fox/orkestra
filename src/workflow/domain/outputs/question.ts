// One clarifying question an agent asks before it can produce its artifact.
//
// Ported deliberately close to `../orkestra`'s `domain/question.rs`. The spike
// first flattened this to a bare string and lost the two fields that make a
// question answerable rather than just readable. `recommended` is this port's own
// addition: the advice an agent used to write into `context` as prose, as a fact a
// surface can draw on the option it is about.

import { Schema } from "effect"

/**
 * A pre-defined choice. `label` is what the human picks; `description` explains
 * the consequence, which is what makes a choice decidable without reading code.
 *
 * `recommended` marks the one the asking agent would pick. Absent and `false` both
 * mean not recommended — an agent writes this by hand, and `"recommended": false`
 * is the obvious thing to write for *not this one*, so refusing it would spend a
 * paid retry on a slip that meant nothing.
 */
export const QuestionOption = Schema.Struct({
  label: Schema.String,
  description: Schema.optional(Schema.String),
  recommended: Schema.optional(Schema.Boolean),
})
export type QuestionOption = Schema.Schema.Type<typeof QuestionOption>

/**
 * Questions and options are identified by their text, never by id — the Rust
 * implementation made that choice and it is why answers correspond by position
 * and nothing has to mint or reconcile identifiers. The mark rides on the option
 * for the same reason: nothing refers to an option from outside it.
 *
 * `options` may be empty for a genuinely open question, but the strong default is
 * to offer them: a caller UI adds its own "Other" escape hatch, so options
 * narrow the answer space without closing it. This is the same shape as Claude
 * Code's own AskUserQuestion, which keeps the two systems interchangeable.
 *
 * **At most one option may be recommended**, refused at decode time because that
 * is where `elicit` can still re-prompt with the reason — later would strand a
 * trak that had already committed the event. The message is what the agent is
 * sent back, so it says what to do rather than only what is wrong.
 */
export const Question = Schema.Struct({
  question: Schema.String,
  /** Extra detail to help answer it. */
  context: Schema.optional(Schema.String),
  options: Schema.Array(QuestionOption),
}).pipe(
  Schema.filter((q) =>
    q.options.filter((o) => o.recommended === true).length > 1
      ? `more than one option of "${q.question}" is recommended. At most one option per question may be recommended: mark the one you would pick and leave the rest.`
      : undefined,
  ),
)
export type Question = Schema.Schema.Type<typeof Question>
