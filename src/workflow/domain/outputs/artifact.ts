// The step's primary output: the thing it was asked to produce.

import { Schema } from "effect"
import { Ambiguity } from "./ambiguity.js"
import { Correction } from "./correction.js"
import { Decided } from "./decided.js"

/**
 * Section title -> that section's markdown. A record rather than prose with
 * headings, because then a missing section is a missing *key* — caught at decode
 * and re-prompted — instead of a heading we would have to find by searching the
 * text and hoping the agent used our exact wording.
 *
 * The whole of what a `Document` is: every agent declares an output, so a document
 * that is one blob of markdown is an agent with one section — the degenerate case
 * rather than a second shape with its own branch everywhere.
 */
const documentSections = Schema.Record({ key: Schema.String, value: Schema.String })

/**
 * `type`, not `_tag`, because this shape crosses the agent boundary.
 *
 * `_tag` is Effect's internal discriminator and stays that way for everything the
 * engine talks to itself about — Decision, Command, TrakState, Event. But an agent
 * writes this JSON by hand, and `type` is the convention it has seen everywhere
 * (JSON Schema, tool-use payloads, and `../orkestra` itself, which tagged these
 * with `#[serde(tag = "type", rename_all = "snake_case")]`). Asking a model for a
 * leading underscore is asking it to be unusual for our convenience.
 *
 * `Schema.tag` keeps `.make` filling the field, so the literal is still written
 * exactly once — here, beside the schema.
 */
export const Artifact = Schema.Struct({
  type: Schema.tag("artifact"),
  sections: documentSections,
  /**
   * What this turn settled about the work. See `decided.ts`.
   *
   * **One channel where there were two.** It carries both what a step decided and
   * work the step found that the plan does not have, because the two split on
   * nothing an agent could answer differently: *would this still be true after
   * someone fixed it?* is yes for both, and both accumulate onto `Trak.decisions`
   * and put the plan back in front of the composer. What genuinely dies when a
   * round passes is `corrections`, below.
   *
   * It sits here and deliberately not in `Document`, because it describes the
   * conversation rather than the document. `Stuck` declares its own for the same
   * reason: *"ruled out the queue-based approach; it can't preserve ordering"* is
   * often the most valuable thing a turn that failed produces, and it is a fact
   * about the turn rather than about a document nobody filed.
   *
   * Optional, and absent is the common case: most steps record nothing, and the
   * output contract says so in as many words. `NonEmptyArray` so `[]` is a decode
   * failure instead of a second way to say nothing, leaving absence one shape.
   *
   * **That is stricter than `decisions` was, and it costs a turn.** The old field
   * was a plain `Array`, so a step writing `[]` — which agents do, which is why the
   * legacy field below still has to accept it — was taken silently. Now it is
   * re-prompted. Kept anyway, and the reason is `corrections`: that list has always
   * refused `[]`, so loosening this one alone would leave two adjacent fields on one
   * struct disagreeing about how to say nothing, and would not even save the turn —
   * an agent that writes one empty list writes both. Both prompt blocks state it in
   * as many words, and `elicit` re-prompts with the decode error, so it costs one
   * retry inside the step rather than anything durable.
   */
  requirements: Schema.optional(Schema.NonEmptyArray(Decided)),
  /**
   * Documents this step says are not good enough to work from, one entry each.
   *
   * **On the artifact and nowhere else**, which is what keeps the two envelopes
   * apart: a step that could not do the work must not have a channel for
   * complaining about someone else's, or the rule it is given stops being a
   * question it can answer — *can you satisfy the artifact shape?* — and becomes a
   * judgment. The argument that puts `requirements` on `Stuck` too, that a turn
   * which failed has usually just learned something directional, does not reach
   * this far, because this is a claim about work rather than about understanding.
   */
  corrections: Schema.optional(Schema.NonEmptyArray(Correction)),
  /**
   * How much of the work was unsettled when this turn met it. See `ambiguity.ts`.
   *
   * **Optional here and required at the turn** — `StepOutputFor` is where a live
   * agent that leaves it out is re-prompted. The two cannot be one rule: `decodeEvent`
   * replays every trak in `.orkestra/.database/` through this schema, so a required
   * key here would stop all of them dead, including the one running now. Absent is
   * read as `none`, by `ambiguityOf` and nothing else.
   *
   * On the artifact rather than in `Document`, for `requirements`' reason: it
   * describes the turn rather than the document. `Stuck` and `Questions` carry none —
   * both already stop for a person, so there is no gate for a rung to bear on.
   */
  ambiguity: Schema.optional(Ambiguity),
  /**
   * What `requirements` was called before it absorbed `uncovered_work`, and what
   * every log written so far carries. Read, never written — `requirementsIn`.
   *
   * `Array` rather than `NonEmptyArray` because logs exist that carry `[]`.
   */
  decisions: Schema.optional(Schema.Array(Decided)),
  /**
   * The other half of what `requirements` replaced: prose units of work the plan
   * did not have. Read, never written.
   *
   * **It routes as it always did — to the composer, and not onto the intent.** A
   * replay that folded these into the standing channel would give a stored trak an
   * intent it never had, which is the one thing replay may not do. `replay.ts` is
   * where the two routes stay apart.
   */
  uncovered_work: Schema.optional(Schema.NonEmptyArray(Schema.String)),
})
export type Artifact = Schema.Schema.Type<typeof Artifact>

/**
 * What a step wrote, without which envelope it arrived in. `Trak.artifacts` holds
 * these: the envelope is a routing decision the log records, not a property of the
 * document, and every reader so far wants the document.
 *
 * **`requirements` is deliberately not in here**, for exactly the reason `reason`
 * isn't: it describes the conversation rather than the document. That is what
 * makes the asymmetry work — a `stuck` account is never filed at all, and what it
 * settled still lands in the intent, because it accumulates onto `Trak.decisions`
 * rather than travelling with the document. *"We're staying on the current auth
 * library"* is still true after the step that wrote it down is replanned away, and
 * the replan is often because of it.
 *
 * A schema rather than `Pick<Artifact, "sections">` because it also travels: every
 * document a child filed rides `ChildLanded` onto its parent's log, and the log
 * is decoded.
 */
export const Document = Schema.Struct({ sections: documentSections })
export type Document = Schema.Schema.Type<typeof Document>

export const artifact = (
  sections: Readonly<Record<string, string>>,
  requirements?: readonly [Decided, ...Decided[]],
  corrections?: readonly [Correction, ...Correction[]],
  /** Last, and absent on most of them: `ambiguityOf` reads that as `none`. */
  ambiguity?: Ambiguity,
): Artifact =>
  Artifact.make({
    sections,
    ...(requirements === undefined ? {} : { requirements }),
    ...(corrections === undefined ? {} : { corrections }),
    ...(ambiguity === undefined ? {} : { ambiguity }),
  })

/** The document out of whatever envelope carried it. */
export const documentOf = (d: Document): Document => ({ sections: d.sections })

/**
 * The document a chat's envelope amounts to: every section it carries laid over
 * the one standing, and every section it left out kept as filed.
 *
 * Order is the standing document's, with anything new at the end — a section
 * re-sent keeps its place, so the projection a later step reads does not reorder
 * under an edit. The envelope's own channels (`requirements`, `corrections`, the
 * rung) are this turn's and travel unchanged: they describe the reply, not the
 * document.
 */
export const amended = (standing: Document, edit: Artifact): Artifact => ({
  ...edit,
  sections: { ...standing.sections, ...edit.sections },
})

/**
 * The artifact as one markdown document.
 *
 * Rendering lives here rather than in `recordFacts`, and the trak keeps the
 * `Artifact` itself: absorbing an event should not throw away what the log
 * knows, and joining sections into prose is a *view*. A later reader — the next
 * step's prompt, a gate, eventually a UI — asks for the view it needs.
 */
export const artifactText = (a: Document): string =>
  Object.entries(a.sections)
    .map(([title, body]) => `## ${title}\n\n${body.trim()}`)
    .join("\n\n")
