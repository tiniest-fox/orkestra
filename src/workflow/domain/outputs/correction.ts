// The corrections channel: a step saying an earlier document is not good enough to
// work from, and naming which one.
//
// It splits from the requirements channel on **lifetime**. A requirement is about
// the finished work and stands forever; a correction is about work that exists and
// dies the moment it is answered. That is why they are two lists rather than one
// list with a discriminator inside it — a bit saying which kind this is would be the
// same design with the difference hidden.
//
// A correction reaches the composer rather than a person, which is what a step
// blocked on someone else's document gains: it can say *that document is the
// problem* and let the plan grow a fix, where the only alternative was `stuck`,
// which stops the trak dead.

import { Schema } from "effect"

/**
 * One complaint, as an agent writes it.
 *
 * **`at` is the one thing here that cannot be derived.** Every other provenance in
 * this codebase is stamped by replay — see `Recorded` — because the log already
 * knows which step produced what. This points the other way, at a document the
 * filing step chose, and nothing about the event says which. The agent picks it out
 * of the plan it is shown, where every entry is listed under exactly this key.
 *
 * A key that names nothing is not rejected here. Decode is the wrong place to hold
 * an agent to a fact about the *trak* — the schema knows the shape and not the plan
 * — and the cost of a wrong key is bounded: the composer reads a name it can see is
 * not in the plan, and a step continuing that document's conversation finds no
 * session to continue and starts fresh.
 */
export const Correction = Schema.Struct({
  /** The artifact key of the document this is against — `2-build`. */
  at: Schema.String,
  /** What is wrong with it, and what would settle it. */
  text: Schema.String,
})
export type Correction = Schema.Schema.Type<typeof Correction>

/**
 * The channel as markdown — one line each, the document it is against first.
 *
 * Here rather than at the surface that prints it, for the reason `decisionsText`
 * lives beside `Decided`: how a domain value reads is the domain's, and the second
 * reader should not have to invent it again.
 */
export const correctionsText = (items: readonly Correction[]): string =>
  items.map((c) => `- \`${c.at}\` — ${c.text.trim()}`).join("\n")
