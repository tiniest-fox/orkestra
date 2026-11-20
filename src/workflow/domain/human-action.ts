// What a human can do to a parked trak. Each is one CLI command.
//
// There is no "reject". A human does not fill in a verdict form; they either
// accept what is in front of them or they say something, and the agent produces
// something new in response. `Reject{feedback}` was the earlier shape and it was a
// UI widget pretending to be a domain concept: it forced the engine to decide what
// "rejected" routes to, when the only honest answer is whatever the agent does
// with what it was told.

import { Schema } from "effect"
import { type Attachment, Attached, attachedField } from "./attachment.js"
import { PlanEdit } from "./plan-edit.js"

/**
 * Take what is in front of you and move on.
 *
 * **One meaning, everywhere**, and it needs something to take: `decide` refuses it
 * at the two gates where the step has filed nothing, because there advancing would
 * step past work that has not happened. A gate where approving routed *backward*
 * would be the other exception, which is why nothing routes backward.
 *
 * `edits` is what a person changed about a proposed plan before taking it, and exists
 * only at the plan gate — see `plan-edit.ts`. On this press rather than an event of its
 * own, so the edits and the acceptance cannot be split: a plan edited and never
 * approved was never anything. Absent is the ordinary case and every press before the
 * field existed; `recordFacts` lays the edits over the plan the moment it is taken.
 */
const ApproveAction = Schema.TaggedStruct("Approve", {
  edits: Schema.optional(Schema.NonEmptyArray(PlanEdit)),
})
/**
 * Anything the human says. Resumes the step's own session; a new output follows.
 * `attachments` are the files sent with it, already in the checkout.
 */
const ChatAction = Schema.TaggedStruct("Chat", { message: Schema.String, attachments: Attached })
/**
 * Kept apart from Chat because answers are positional — they render numbered.
 *
 * `note` is one thought sent alongside them, belonging to none of the questions —
 * the thing a person wants to say to frame their answers, which otherwise costs a
 * whole `Chat` turn and arrives instead of them. It rides here rather than as an
 * action of its own so that it costs no turn at all.
 *
 * **It carries what an answer carries.** Nothing tells the agent to weigh it more
 * lightly, so it may redirect the turn and may be recorded as a decision the person
 * made. Blank never reaches here — `actFromDto` drops it — so absence is the one
 * representation of *nothing was said*.
 */
const AnswerAction = Schema.TaggedStruct("AnswerQuestions", {
  answers: Schema.NonEmptyArray(Schema.String),
  note: Schema.optional(Schema.String),
})
/**
 * The rest of this plan should be something else. Say what, and the composer
 * proposes it.
 *
 * **Offered at every step gate**, which is one rule rather than a list to
 * remember: whatever a person is looking at, wanting the plan changed is a thing
 * they can want, and the gate they are standing at is where the new plan joins on.
 *
 * `reason` is required and is the whole action. It is what a person says having
 * read what is in front of them, and it is the only thing the composer is told —
 * which is deliberate at a `stuck` gate, where the account on the table is a
 * hypothesis by an agent that is stuck *because* it is wrong about the cause. A
 * sentence from someone who read it beats the account itself.
 *
 * Refused at the **plan** gate, and only there: the composer is who just spoke, so
 * re-asking it for a plan it has already given is `Chat` with the reason in it.
 */
const ReplanAction = Schema.TaggedStruct("Replan", { reason: Schema.String })
/**
 * This step is not going to produce anything. Move on without it.
 *
 * **Offered only where the step has filed nothing** — an `answers` gate, a
 * `conversation` gate and a `stuck` gate — which is what keeps it from being a
 * second way to say `Approve`. Everywhere else there is a document on the table,
 * and taking it is the thing a human does; `decide` refuses a skip there rather
 * than quietly treating the two as the same.
 *
 * **It advances; it does not replan.** A skip asserts the plan is still right
 * minus one step, and that is not breakage, so the composer is not consulted.
 *
 * `message` is optional and becomes the next step's instruction — the same
 * channel a composer's instruction uses, rather than a new one. Recorded
 * verbatim either way: *"review skipped on nine of the last twelve traks"* is a
 * finding about review that nothing else in the log would produce.
 */
const SkipAction = Schema.TaggedStruct("Skip", { message: Schema.optional(Schema.String) })

/**
 * A person's yes or no to a step asking to run one command the CLI refused.
 *
 * **Offered at a `permission` gate and refused everywhere else.** It carries no
 * command: the yes `decide` writes quotes the one the step named, read off the slot,
 * so what a person allowed is exactly what was asked. Either answer resumes the step's
 * session — a no is not a skip, and the step carries on without the command.
 */
const PermitAction = Schema.TaggedStruct("Permit", { granted: Schema.Boolean })

export const HumanAction = Schema.Union(
  ApproveAction,
  ChatAction,
  AnswerAction,
  ReplanAction,
  SkipAction,
  PermitAction,
)
export type HumanAction = Schema.Schema.Type<typeof HumanAction>

export const Actions = {
  approve: (edits?: readonly [PlanEdit, ...PlanEdit[]]): HumanAction =>
    ApproveAction.make(edits === undefined ? {} : { edits }),
  chat: (message: string, attachments?: readonly Attachment[]): HumanAction =>
    ChatAction.make({ message, ...attachedField(attachments) }),
  answer: (answers: readonly [string, ...string[]], note?: string): HumanAction =>
    AnswerAction.make({ answers, note }),
  replan: (reason: string): HumanAction => ReplanAction.make({ reason }),
  skip: (message?: string): HumanAction => SkipAction.make({ message }),
  permit: (granted: boolean): HumanAction => PermitAction.make({ granted }),
}
