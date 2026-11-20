// Why an iteration exists. Selects which resume prompt a step gets.

import { Schema } from "effect"
import { type Attachment, Attached, attachedField } from "./attachment.js"

const InitialTrigger = Schema.TaggedStruct("Initial", {})
/**
 * What the human said. Not "feedback": there is no verdict attached to it. `attachments`
 * are the files sent with it, listed in the prompt and, for an image, handed over inline.
 */
const MessageTrigger = Schema.TaggedStruct("Message", {
  text: Schema.String,
  attachments: Attached,
})
/**
 * What a person answered, and whatever they wanted to say alongside.
 *
 * `note` answers no question — it is the framing a person adds to their answers —
 * so it renders under a heading of its own rather than as another number. An extra
 * number would be an answer to a question that was never asked, and nothing but
 * position joins an answer to its question.
 */
const AnswersTrigger = Schema.TaggedStruct("Answers", {
  answers: Schema.NonEmptyArray(Schema.String),
  note: Schema.optional(Schema.String),
})
/**
 * Questions were asked and nobody is going to answer them: the trak is running
 * unattended, so it says so and asks for the agent's own judgement instead.
 *
 * **Its own trigger rather than `Answers` carrying a canned string per question**,
 * and the difference is what the agent is told. Fake answers arrive under a heading
 * that says *answers to your questions*, which is a person's voice — an agent
 * reading "1. Use your best judgement" is entitled to take it for one, and would
 * carry it into its output as something it was told. This says what actually
 * happened. It is also what keeps the words themselves in a template, where every
 * word sent to an agent lives.
 *
 * The two dials are set as `Answers` sets them. The session is **resumed**: the
 * questions are in that conversation and re-asking from scratch would lose what
 * prompted them. And it is **not a conversation** — nobody is waiting to read a
 * reply, which is the whole of why it exists — so `elicit` holds the turn to
 * producing its output rather than letting it answer in prose.
 *
 * **It carries the asking agent's own recommendation per question, and nothing a
 * person said.** Where an option was marked `recommended`, that option is taken, so
 * the turn starts from a choice rather than from the question again and the choice is
 * on the command that ran it; where none was, the question is left to the agent. The
 * label is the agent's own word coming back to it — which is why this still renders
 * under *nobody is standing here* rather than as `Answers`. The questions themselves
 * are in the session, so a pick is positional, as an answer is.
 */
const UnansweredTrigger = Schema.TaggedStruct("Unanswered", {
  picks: Schema.NonEmptyArray(Schema.Struct({ recommended: Schema.optional(Schema.String) })),
})

/**
 * A step ended on a conversational note and there is nobody to reply: the trak is
 * running unattended, so it is told to carry on and file what the step owes.
 *
 * **`Unanswered`'s twin, and two triggers rather than one for the reason the repo
 * keeps one body per trigger**: unanswered questions and unread prose are the same
 * situation and want different words, and one body carrying both paragraphs would
 * say something irrelevant on every turn it ran.
 *
 * **It overrides `conversational`** — see `overridesConversational`. That flag says
 * the artifact is not owed *yet*, which is a promise about a conversation somebody is
 * having; on a trak with nobody in it there is no conversation to defer to, so
 * `runCommand` puts this turn through `elicit` rather than `converse`. That is also
 * what bounds it without a counter — prose is not in the elicited union at all, so
 * a step cannot answer this the way it answered the turn before, and there is
 * exactly one of these per conversation.
 *
 * The session is **resumed** and it is **not a conversation**, on `Unanswered`'s
 * reasoning. It carries no payload: what was said is in the session, and the one
 * thing this adds is the same sentence every time.
 */
const UnreadTrigger = Schema.TaggedStruct("Unread", {})
/**
 * A person asked the step to file what it has, without saying anything else.
 *
 * `Unread`'s deliberate twin: the same deadline landing on the same session, and
 * two triggers rather than one because what the agent is told differs. `Unread`
 * says nobody is there; this says somebody is, and that they want the document
 * rather than another turn of the conversation. A body claiming the first would be
 * false the moment a person pressed a button.
 *
 * Reached from two places and the turn is the same from both — a running turn
 * killed and re-entered, or a conversation the step had parked in. Either way the
 * session is **resumed** — what the step has worked out so far is the whole of what
 * it is being asked to file — and it is **not a conversation**: a person pressed
 * rather than typed, so nobody is waiting on prose, and `elicit` holds the turn to
 * its output. It overrides `conversational` for `Unread`'s reason, and is bounded
 * the same way.
 *
 * Carries no payload: a press says nothing, and the sentence is the same every time.
 * The output is whatever the step's union allows, so a forced turn can still ask a
 * question or report itself stuck; the trigger asks for the document and promises
 * nothing about getting one.
 */
const FilingTrigger = Schema.TaggedStruct("Filing", {})
/**
 * The composer is being asked what the rest of this plan should be.
 *
 * **One trigger for all four reasons** — a step raised something the plan has to
 * answer, a person replanned in their own words, the world came back to finished
 * work, or the plan ran out where the composer had said it would. They ask the same
 * question from different positions, and the position is on the trak rather than
 * here. What differs is a paragraph of the prompt, not a turn.
 *
 * It carries no payload for the reason `Interrupted` doesn't: what it is answering
 * is on the trak, durably, where the splice and the prompt both read it. A trigger
 * that copied it would be a second source for one fact.
 *
 * Two things follow, and they are the same thing twice. The session is **fresh**:
 * a resumed composer defends the plan it wrote, and — this is the half that is not
 * merely taste — it was handed the intent on its first turn and cannot be handed
 * the decisions filed since, because those ride the fresh-session body only. And
 * the prompt is therefore the **full** one, which is where what is being asked and
 * the work so far are stated.
 *
 * **A step in the new plan needs no trigger of its own.** It is an ordinary first
 * run of a plan entry, on `Initial`, carrying the composer's instruction — so a
 * "run this step again with these words" trigger would be a second way to say what
 * `Initial` plus a new plan already says.
 */
const ReconsultedTrigger = Schema.TaggedStruct("Reconsulted", {})

/**
 * A check the step declared came back non-zero. Fix it and produce the artifact
 * again.
 *
 * It needs no new mechanism, only a third setting of the two dials the others
 * already turn. The session is **resumed**: the conversation that produced the
 * artifact is exactly the context needed to repair it. The prompt is therefore the
 * **resume** prompt. And `isConversation` is false, unlike `Message`: nobody is waiting to
 * read a reply, so `elicit` holds the step to producing an artifact rather than
 * letting it answer in prose.
 */
const CheckFailureTrigger = Schema.TaggedStruct("CheckFailure", {
  name: Schema.String,
  output: Schema.String,
})

/**
 * A turn was cut off mid-flight — the process died before it produced an
 * output — and a human chose to re-run it rather than let it sit interrupted.
 *
 * The third setting of the two dials the others already turn, not a new
 * mechanism. The session is **resumed**, like `CheckFailure`: whatever the agent
 * was doing lives in that conversation, and starting fresh would throw away
 * exactly the context a restart wants back. And it is **not a conversation**,
 * also like `CheckFailure`: nobody was waiting to read a reply from *this* turn
 * — a human is choosing to re-spend on work that never finished, not asking a
 * question — so `elicit` still holds the step to producing an artifact.
 *
 * Carries no payload, and needs none: there is no instruction here, only "carry
 * on". `restartFrom` issues it for every position that had a turn in flight, so it
 * names no cause — a crash and a retry of a failed trak arrive identically.
 */
const InterruptedTrigger = Schema.TaggedStruct("Interrupted", {})

/**
 * A person allowed the command a step asked permission for.
 *
 * **The body names `command` verbatim, and that is the whole mechanism.** Under
 * Claude's auto mode the classifier clears a refused call when the person's own
 * message names it; a bare yes leaves the agent to guess, and it works around the
 * refusal instead of retrying it. So the engine writes the yes, from the command the
 * step's envelope named, rather than letting a person or a recommendation word it.
 *
 * The session is **resumed** — the refused call is in it — and it is **not a
 * conversation**: the step owes what it owed before it asked.
 */
const PermittedTrigger = Schema.TaggedStruct("Permitted", { command: Schema.String })
/**
 * A person refused the command a step asked permission for. `Permitted`'s twin, and a
 * trigger of its own for the reason `Unread` is `Unanswered`'s: the two want different
 * words. The step carries on without the command.
 */
const RefusedTrigger = Schema.TaggedStruct("Refused", { command: Schema.String })

export const Trigger = Schema.Union(
  InitialTrigger,
  MessageTrigger,
  AnswersTrigger,
  UnansweredTrigger,
  UnreadTrigger,
  FilingTrigger,
  ReconsultedTrigger,
  CheckFailureTrigger,
  InterruptedTrigger,
  PermittedTrigger,
  RefusedTrigger,
)
export type Trigger = Schema.Schema.Type<typeof Trigger>

/** One question's share of an `Unanswered` turn: the option its asker recommended, if any. */
type Pick = (typeof UnansweredTrigger.Type)["picks"][number]

/**
 * Is this turn a conversation — a human typed something and is waiting to read
 * the answer?
 *
 * `Message` only, and deliberately not `Reconsulted`, which a human also causes but
 * which starts a fresh session on the full prompt with nobody reading its reply.
 * Nor `CheckFailure`, which does resume a session but on nobody's behalf: a script
 * complained, and what it is owed is a fixed artifact rather than an explanation.
 * Nor `Unanswered` and `Unread`, which are the strongest case of all: they exist
 * precisely because there is nobody there.
 *
 * It is a function rather than something read off the prompt view because the
 * two answer different questions and only coincide for one trigger: this one
 * picks `converse` over `elicit`, while `prompt.ts` picks which template to
 * render. **Do not collapse them into a shared flag** — `prompt.ts` is an
 * exhaustive `Match` with one body per trigger, so there is no single boolean both
 * can be derived from.
 */
export const isConversation = (t: Trigger): boolean => t._tag === "Message"

/**
 * Does this turn take a `conversational` step's deferred deadline away?
 *
 * The two triggers that say the conversation is over and the document is due now:
 * `Unread` because nobody is on the other side, `Filing` because the person on it
 * pressed rather than typed. `runCommand` puts either through `elicit` on a step
 * whose entry would otherwise let it answer in prose, which is what makes the press
 * mean something — a turn that went through `converse` could reply *sure, in a
 * moment* and the button would look broken with nothing failing.
 *
 * A function beside `isConversation` rather than a list in `runtime.ts`, so a trigger
 * added to the union above is written a line from the question rather than three files
 * away from it. Nothing on this file tests it: what holds it is the end-to-end filing
 * of a parked conversation, which counts the step's turns — under `converse` there are
 * two and the trak is still in the conversation.
 */
export const overridesConversational = (t: Trigger): boolean =>
  t._tag === "Unread" || t._tag === "Filing"

export const Triggers = {
  initial: (): Trigger => InitialTrigger.make({}),
  message: (text: string, attachments?: readonly Attachment[]): Trigger =>
    MessageTrigger.make({ text, ...attachedField(attachments) }),
  answers: (answers: readonly [string, ...string[]], note?: string): Trigger =>
    AnswersTrigger.make({ answers, note }),
  unanswered: (picks: readonly [Pick, ...Pick[]]): Trigger => UnansweredTrigger.make({ picks }),
  unread: (): Trigger => UnreadTrigger.make({}),
  filing: (): Trigger => FilingTrigger.make({}),
  reconsulted: (): Trigger => ReconsultedTrigger.make({}),
  checkFailure: (name: string, output: string): Trigger =>
    CheckFailureTrigger.make({ name, output }),
  interrupted: (): Trigger => InterruptedTrigger.make({}),
  permitted: (command: string): Trigger => PermittedTrigger.make({ command }),
  refused: (command: string): Trigger => RefusedTrigger.make({ command }),
}
