// What a turn ran into, on its way to what it produced.
//
// **The one field an agent writes that opens a gate**, and the two things that make
// that allowable are not the ones `clearance` claimed. `none` buys no passage the
// trak's mode had not already granted — on `smart` a gate goes past by default, so
// only the two rungs above it change anything, and the field can therefore cost a
// stop but never grant one. And a false `none` is checkable: the calls a turn did not
// mention are in the document it filed, where a confidence rating was checkable
// against nothing. See the head of `proposal.ts`.

import { Schema } from "effect"

/**
 * How much of the work was unsettled when the turn met it, least first.
 *
 * **A claim about what the turn ran into, not about how it feels about its output.**
 * *Was the request settled; was there a fork nobody had decided* is answerable only by
 * revisiting the work, and what it reports is checkable against the document. *How
 * confident are you* is answerable from nothing, so every value of it is defensible and
 * none of it is evidence.
 *
 * The order is the vocabulary's own and is read as one — see `atLeast` in
 * `attention.ts`, which is the only thing that compares two rungs.
 */
export const Ambiguity = Schema.Literal("none", "some", "a_lot")
export type Ambiguity = Schema.Schema.Type<typeof Ambiguity>

/**
 * What a turn reported, with absent read as `none`.
 *
 * A function rather than a field read, for the reason `isUnplanned` is one: the field
 * is optional on both schemas that carry it — every log already on disk has to keep
 * replaying — and *absent is the lowest rung* is exactly the rule two readers can
 * disagree about.
 *
 * **Absent reads as the lowest rung and that is safe here**, unlike the same shape one
 * field over: reading it as the highest would stop every stored trak at every gate it
 * has left, and the rung buys nothing anyway. What stops a live turn saying nothing is
 * the refinement at the turn — `StepOutputFor` and `ComposerOutputFor` — not a default.
 */
export const ambiguityOf = (a: Ambiguity | undefined): Ambiguity => a ?? "none"

/**
 * The rung a live turn owes, as the re-prompt an agent that left it out reads.
 *
 * **Required at the turn and optional on the schema**, which is `checkSections`'
 * device and here for a second reason as well: `decodeEvent` reads every trak in the
 * database through `Artifact` and `Proposal`, so required *there* would stop them all
 * replaying. Required is only enforceable where `elicit` can hand the reason back.
 *
 * One message for both roles, because it is one question. It names the three rungs,
 * since the failure it answers is a turn that omitted the key — a turn that wrote a
 * word nobody defined gets the literal's own decode error, which already lists them.
 */
export const checkAmbiguity = (reported: Ambiguity | undefined): string | undefined =>
  reported === undefined
    ? `no "ambiguity": say what this turn ran into, as one of ${Ambiguity.literals.map((r) => `"${r}"`).join(", ")}.`
    : undefined
