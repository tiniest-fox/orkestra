// A step saying it could not do the work — and that nothing should be planned
// from it.
//
// **This is where a trak stops.** It is not a request for a different plan and it
// does not reach the composer: it is *"I have no idea what is going on"*, and the
// only thing that answers it is a person reading the account and jumping in. What
// they do next is theirs — talk to the agent, carry on without it, or replan in
// their own words.
//
// So the rule an agent is given is a question it can answer rather than a
// judgment: *can you produce your declared output?* No → this. Work the plan is
// merely missing is a `requirement` on an ordinary artifact, and a document that is
// not good enough to work from is a `correction` on one — both claims a step that
// succeeded makes, and both reach the composer rather than stopping here.

import { Schema } from "effect"
import { artifactText, type Document } from "./artifact.js"
import { Decided } from "./decided.js"

/**
 * Four named fields, not a section map.
 *
 * **This is the shape the agent is held to, not the shape it is stored in.** Three
 * constant engine-owned titles are a struct rather than a map because nothing about
 * them ever varies per role: an artifact's sections are declared by the agent's own
 * file, where these are the same three questions every time, and a map would make the
 * contract look negotiable. Filing it *is* filing a document — see `stuckDocument` —
 * so the two are not in tension: this holds the turn to three answers, and what gets
 * written down is the document those answers make.
 *
 * `diagnosis` is named for what it is. An agent is usually stuck *because* it is
 * wrong about the cause, so what it believes is a hypothesis, and the field that
 * carries it should not read as a finding.
 *
 * `requirements` stays, deliberately rather than by inheritance: a step that ruled
 * out three approaches before hitting the wall has learned something later steps
 * need, and what a turn settled is a fact about the conversation rather than a
 * property of the document that happened to carry it. See `artifact.ts`.
 *
 * **It lands on the intent and asks nobody for a plan.** A requirement filed by a
 * step that finished puts the plan back in front of the composer; one filed here
 * does not, because this envelope is a trak stopping in front of a person and
 * planning past it is the thing it exists to prevent. Widening what the account may
 * say is not widening where it goes.
 */
export const Stuck = Schema.Struct({
  type: Schema.tag("stuck"),
  /** What was attempted, so nobody repeats it. */
  tried: Schema.String,
  /** What actually happened — errors verbatim, not paraphrased. */
  happened: Schema.String,
  /** Where the agent thinks the real problem is, and it is a guess. */
  diagnosis: Schema.String,
  /** Same shape as the artifact's, including what refusing `[]` costs. */
  requirements: Schema.optional(Schema.NonEmptyArray(Decided)),
  /** What `requirements` was called before. Read, never written — `requirementsIn`. */
  decisions: Schema.optional(Schema.Array(Decided)),
})
export type Stuck = Schema.Schema.Type<typeof Stuck>

export const stuck = (
  tried: string,
  happened: string,
  diagnosis: string,
  requirements?: readonly [Decided, ...Decided[]],
): Stuck =>
  Stuck.make({
    tried,
    happened,
    diagnosis,
    ...(requirements === undefined ? {} : { requirements }),
  })

/**
 * The account as the document it is: three named prose fields are three sections.
 *
 * What a step produced is what gets filed, and a stuck account is what a step
 * produced. The judgment that used to keep it out of `Trak.artifacts` — that a later
 * agent reading it under the step's name would be misled — is a judgment about
 * *readers*, and it is made where readers are chosen (`visibleArtifacts`) rather than
 * at the moment of writing, where getting it wrong is unrecoverable.
 *
 * The headings are the engine's, because the fields are.
 */
export const stuckDocument = (s: Stuck): Document => ({
  sections: {
    "What I tried": s.tried.trim(),
    "What happened": s.happened.trim(),
    "What I think is wrong": s.diagnosis.trim(),
  },
})

/**
 * The account as one markdown document.
 *
 * Here rather than at the surface that prints it, for the reason `artifactText`
 * lives beside `Artifact`: how a domain value reads is the domain's, and the
 * second reader should not have to invent it again. Through `stuckDocument` so the
 * headings have one source.
 */
export const stuckText = (s: Stuck): string => artifactText(stuckDocument(s))
