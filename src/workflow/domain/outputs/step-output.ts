// Layer 2: what a STEP agent is allowed to return.
//
// The two layers exist because the sets genuinely differ. A step produces work,
// asks about it, or says it could not; the composer plans. Giving each role its
// own union means `elicit` rejects an off-role shape at decode time — a step
// cannot return a Proposal, and the schema says so rather than a runtime check.

import { Schema } from "effect"
import { checkAmbiguity } from "./ambiguity.js"
import { Artifact, type Document } from "./artifact.js"
import { type Decided, requirementsIn, supersededBy } from "./decided.js"
import { Failed } from "./failed.js"
import { Message } from "./message.js"
import { Permission } from "./permission.js"
import { Questions } from "./questions.js"
import { Stuck } from "./stuck.js"

/**
 * What a step agent may WRITE. This is the set the output contract describes and
 * the set `elicit` decodes against.
 *
 * `Artifact` and `Stuck` are the two answers to *did the work happen?*, and they
 * share no shape at all — an artifact is a document the agent declared and this is
 * an account of why there isn't one. There is no third "approve": an artifact IS
 * one, which is why a reviewer writes its findings the same way every other step
 * writes its output, and a review that sends work back does it with
 * `corrections`.
 *
 * **`Failed` is deliberately absent**, and that is the whole of *nothing an agent
 * judges ends a trak*: `stuck` stops the trak in front of a person rather than
 * ending it, and every failure stays retryable. It survives one level up, in
 * `StepOutput`, for the same reason `Message` does — see below.
 */
export const AgentStepOutput = Schema.Union(Artifact, Stuck, Questions, Permission)

/**
 * The loose shape of *this JSON was written as one of the above*: the discriminator
 * and nothing else. What `converse` uses to tell an envelope that was meant and
 * got something wrong — re-prompted — from a block of JSON a reply happened to end
 * with, which is an answer. `step-output.test.ts` holds it to every member of the
 * union, so a shape added above cannot be left out of it silently.
 */
export const MeantAsStepOutput = Schema.Struct({
  type: Schema.Literal("artifact", "stuck", "questions", "permission"),
})

/**
 * What the LOG carries — the above plus two shapes the RUNTIME constructs:
 * `Message` from a prose reply on a chat turn, and `Failed` from an `elicit` that
 * never got anything usable.
 *
 * The two sets are separate so the wider one can never be elicited. An agent able
 * to return `message` on its first spawn would have a way to skip the work; an
 * agent able to return `failed` would have the terminal state this phase took
 * away. *"Produced nothing usable after three attempts"* is still a real dead end,
 * and it is `orGiveUp`'s to record — not a verdict an agent gets to write about
 * its own work.
 */
export const StepOutput = Schema.Union(AgentStepOutput, Message, Failed)
export type StepOutput = Schema.Schema.Type<typeof StepOutput>

/**
 * Why the document is checked here rather than read leniently later: a section
 * that goes missing in prose is invisible until a human notices the plan is
 * short. As a key it is a decode failure, and `elicit` re-prompts with the list.
 * That is the whole argument for declaring sections as data.
 */
const checkSections = (out: Document, required: readonly string[]): string | undefined => {
  const missing = required.filter((title) => (out.sections[title] ?? "").trim() === "")
  if (missing.length > 0) {
    return `missing or empty section(s): ${missing.join(", ")}. Every required section needs content — say what you found, or say plainly that there is nothing.`
  }
  // Only reachable for an agent whose every section is optional, and the reason it
  // is checked at all is that a document with nothing in it gives the person at the
  // gate nothing to read.
  return Object.values(out.sections).every((body) => body.trim() === "")
    ? "nothing was returned: every section is empty. Write the work into the sections you were given."
    : undefined
}

/**
 * What a chat may send back when a document already stands: the sections it
 * edited and nothing else. Each one carried has to say something — a blank one
 * would lay a blank over a section that was filed — and one is the floor, because
 * an envelope that edits nothing is a reply that should have been prose.
 *
 * **Unless it settles something.** A requirement or a correction reached in
 * conversation has no shape of its own — `Questions` carries neither, and prose
 * lands nowhere — so an envelope with no sections and one of those is the way it
 * is filed. The document is re-filed unchanged, which is what `amended` does with
 * an empty edit.
 *
 * Every title has to be one of `allowed`: a section the document already has, or
 * one the agent declares and the first filing left out. On a first turn a
 * misspelt title is caught as a missing required one; on this turn nothing is
 * missing, so without this check `findings` would be appended beside the
 * `Findings` it meant to replace, and the stale one is the one that reads as
 * current.
 */
const checkAmendment = (out: Artifact, allowed: readonly string[]): string | undefined => {
  const titles = Object.keys(out.sections)
  const settles = out.requirements !== undefined || out.corrections !== undefined
  if (titles.length === 0 && !settles) {
    return "an envelope with no sections: return only the sections you changed, or answer in prose and send no envelope."
  }
  const unknown = titles.filter((title) => !allowed.includes(title))
  if (unknown.length > 0) {
    return `unknown section(s): ${unknown.join(", ")}. A section you send replaces the one filed under exactly that title, so the title has to be one the document has or one you declare: ${allowed.join(", ")}.`
  }
  const blank = titles.filter((title) => (out.sections[title] ?? "").trim() === "")
  return blank.length > 0
    ? `empty section(s): ${blank.join(", ")}. Leave out a section you did not change; a section you send replaces the one filed.`
    : undefined
}

/**
 * A `supersedes` has to name what this turn was shown — a document it can open or a
 * requirement on the list it read — or the note it carries lands on no file, the
 * fold takes nothing out, and the agent believes it replaced something. Held here,
 * at decode, for the reason a missing section is: the agent is re-prompted with the
 * list while it can still pick from it. A correction's `at` is not held the same
 * way, because a wrong one reaches a composer that can see it is wrong; a wrong
 * name here reaches nobody.
 *
 * `filed` is `requirementsIn(out)` — the same list replay records from, so an entry
 * filed under the legacy `decisions` name is held to this exactly as one under
 * `requirements` is. Read `out.requirements` alone and the alias skips the guard.
 */
const checkSupersedes = (
  filed: readonly Decided[],
  visible: readonly string[],
): string | undefined => {
  const named = filed.flatMap(supersededBy)
  const missing = named.filter((k) => !visible.includes(k))
  if (missing.length === 0) return undefined
  const list =
    visible.length === 0
      ? "nothing has been filed before this step, so there is nothing to supersede"
      : `what this step may name is: ${visible.join(", ")}`
  return `supersedes names something that is not there: ${missing.join(", ")}. It would replace nothing — ${list}.`
}

/**
 * `AgentStepOutput`, narrowed to the sections this step owes and the documents it
 * can see.
 *
 * The same device as `ComposerOutputFor`, for the same reason: a document missing
 * what it declared is the agent producing an unusable response, so it belongs at
 * decode time where `elicit` re-prompts with the reason — not later, where it
 * would strand a trak that had already committed the event.
 *
 * **Only an artifact is checked**, and that is what keeps the two envelopes
 * honest. A `stuck` account has four named fields of its own, none of them the
 * agent's declared titles, so a step that could not do the work cannot dress the
 * account up as the work — and a step reaching for `stuck` to avoid the sections
 * gets a gate with a person at it rather than a plan. It is also why none of the
 * other three owes a rung: each stops for a person whatever it says, or is answered
 * by the one turn that follows.
 *
 * `required` is the titles of the agent's required sections — empty only for an
 * agent whose every section is optional.
 *
 * `visible` is every name a `supersedes` may use at this position — `supersedable`.
 * Required rather than defaulted, because a caller that leaves it out is the
 * silent failure this check exists to close. Both envelopes that carry
 * requirements are held to it.
 *
 * `amending`, when given, makes this the one turn the required titles are not owed
 * by the envelope: a chat on a step whose artifact already stands. The document
 * owes them and already has them, so the envelope carries only the sections the
 * reply edited and `amended` lays those over what was filed. It is what lets a
 * one-line change cost a one-section envelope rather than the whole document
 * again. Its value is every title the envelope may name — the standing document's
 * and the agent's declared ones — so an edit lands on the section it meant and an
 * optional section left out of the first filing can still be added. The rung is
 * still owed — it is about the turn, not the document.
 */
export const StepOutputFor = (
  required: readonly string[],
  visible: readonly string[],
  amending?: readonly string[],
) =>
  AgentStepOutput.pipe(
    Schema.filter((out) => {
      if (out.type === "questions") return undefined
      // The yes quotes this back as the command to run, so a blank one would ask a
      // person to allow nothing.
      if (out.type === "permission") {
        return out.command.trim() === ""
          ? "a permission envelope with no command: name the exact command that was refused."
          : undefined
      }
      const named = checkSupersedes(requirementsIn(out), visible)
      if (out.type === "stuck") return named
      return (
        (amending === undefined ? checkSections(out, required) : checkAmendment(out, amending)) ??
        checkAmbiguity(out.ambiguity) ??
        named
      )
    }),
  )
