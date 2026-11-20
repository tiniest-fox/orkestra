// Does this gate want a person?
//
// **Every gate decision for all four modes, and the only file in the engine that reads
// `Trak.mode` or `Trak.holding`.** The point is that the reasons a trak stops are a list
// you can read top to bottom and add a line to: a rule spread across nine predicates in
// `decide.ts` was one nobody could answer *what does `smart` skip* from without reading
// the whole state machine.
//
// Named for the question rather than for the mode, because it answers both directions:
// `manual` stands at every gate, `auto` at none, and `smart` at the ones where either
// the turn said the work was unsettled or the record shows the person was already in it.
// `decider` takes every document as `auto` does and stands where the work could go
// different ways: questions, conversations, and a plan that hands work off.
// An entry planned as a conversation stops on every mode, and a pending hold stands at
// every gate the step it holds reaches, whatever the mode says, until that step is
// accepted.
//
// `decide.ts` asks and branches; nothing else in here decides where a trak goes.

import { complaintSignature } from "./check-progress.js"
import { Ambiguity, ambiguityOf } from "./outputs/ambiguity.js"
import { isCompose, isConversational, type Plan, type ReconsultWhy } from "./outputs/proposal.js"
import {
  composeBefore,
  firstUnrun,
  Mark,
  planEntryOf,
  slotAt,
  type Trak,
  type Warrant,
} from "./trak.js"

// ============================================================================
// The two numbers, and neither is a setting
// ============================================================================

/**
 * The rung at which `smart` stops reading past a document.
 *
 * **A named constant and deliberately not a per-trak control.** How much a mode skips is
 * one decision about what the word means, not a dial each trak carries — three modes are
 * three words a person can hold in their head, and a fourth axis on top of them is a
 * confidence number wearing a setting. Moving what `smart` skips is this line.
 *
 * Rungs have no order of their own, so the comparison is written down once, next to the
 * value that reads it — see `atLeast`.
 */
const AMBIGUITY_STOPS_AT: Ambiguity = "some"

/**
 * How many rounds of fixing one trak may spend with nobody reading them.
 *
 * **The backstop, and not the rule that does the work.** `sameComplaintTwice` is what
 * says a fix is not landing, and it says it on the words: a loop that is genuinely
 * getting somewhere complains about something new each time and is not charged for it.
 * This is the other half of `check-progress.ts`, for what normalizing cannot see — a
 * reviewer that rephrases the same objection round after round never repeats exactly, so
 * *the complaint changed* stays true while nothing is being fixed.
 *
 * `CHECK_FAILURE_LIMIT`'s number for `CHECK_FAILURE_LIMIT`'s reason, one loop further
 * out. **A setting is what it must not become**: a dial for how many unread rounds a
 * trak may buy is a confidence number wearing a count, and nothing that keeps failing
 * should pass at any value of it.
 *
 * **These two are now the whole of what bounds a complaint-and-fix loop**, since a
 * verdict that only sends a document back takes its own gate — see
 * `raisedUnplannedWork`. The number stayed at four when that changed: it was chosen
 * against nothing, and a different one would be chosen against nothing too.
 *
 * **Counted over the trak rather than over the document being fixed**, which is the only
 * place it can be counted honestly: every round complains about the document the round
 * before it wrote, so a count keyed on a document is a count the composer resets by
 * naming a different one. Spent is spent — a trak that has used its rounds reads every
 * artifact after them, and a person who wants more starts a trak.
 */
const FIXING_ROUND_LIMIT = 4

/**
 * How many turns one position may spend before its questions stop being answered
 * for it and a person is asked after all.
 *
 * **A backstop, not a setting** — `CHECK_FAILURE_LIMIT`'s shape and its reasoning
 * one gate along. An agent told *nobody is coming, decide it yourself* and asking
 * again has not been helped by being told a second time, and the round after that is
 * a turn nobody would have bought.
 */
const UNANSWERED_LIMIT = 2

/**
 * Is this rung at or above the one that stops a `smart` trak?
 *
 * The order comes off the schema's own literals rather than a list here, for the reason
 * every closed set in this codebase is read off its declaration: a second copy is one
 * that can disagree about which rung is worse.
 */
const atLeast = (reported: Ambiguity, floor: Ambiguity): boolean =>
  Ambiguity.literals.indexOf(reported) >= Ambiguity.literals.indexOf(floor)

// ============================================================================
// The reasons a `smart` trak still stops
// ============================================================================

/**
 * What this position reported about what its turn ran into.
 *
 * The one clause an agent writes, and the only one that can be wrong on purpose. What
 * keeps it honest is that it cannot buy anything: on `smart` the gate goes past by
 * default, so `none` grants no passage the mode had not, and a rung is only ever a
 * reason to stop. See `ambiguity.ts`.
 */
const reportedAmbiguity = (t: Trak, i: number): boolean =>
  atLeast(ambiguityOf(slotAt(t, i).ambiguity), AMBIGUITY_STOPS_AT)

/**
 * Has this position taken more than one turn?
 *
 * **The record's answer to *were you already in this*.** A step that asked a question
 * and was answered, one whose check failed and was sent back, and a composer a person
 * chatted with have all spent a second turn here — so the document on the table is one
 * a person has already been pulled into, and reading it is the cheap end of that.
 *
 * One question for both kinds of entry, because both count their landing turn:
 * `onAgentReturned` bumps when an artifact or an account arrives, and `landCompose`
 * bumps when a plan does.
 */
const moreThanOneTurn = (t: Trak, i: number): boolean => slotAt(t, i).iterations > 1

/**
 * Did this position put work nobody planned in front of the composer?
 *
 * **The requirements half of a `Raised` entry, and deliberately not the corrections
 * half.** A step that sends an earlier document back has found a defect in work the plan
 * already has a step for, and answering it is the loop running; a step that raises
 * unplanned work has found the plan short one, which is the shape of the trak moving
 * under somebody who has not seen it. Both arrive on one entry as two fields — see
 * `ReconsultWhy` — and only the second is a person's to read.
 *
 * **The split is on the field and never on who filed it**, because nothing in the engine
 * may know which agents a project's `.orkestra/` holds: there is no reviewer here to
 * exempt, only a channel. An artifact that filed both stops, on the requirements.
 *
 * **Read off the plan, where it is durable.** `withAsk` writes the ask in as a compose
 * entry the moment it is made and nothing that ran is ever replaced, so this stays true
 * for the life of the trak — where `Trak.reconsult` is cleared two turns later, by the
 * plan that answers it.
 *
 * A round of fixing does not stop at its own re-cut for this: the entry names the step
 * that raised, which is the one that stops.
 *
 * Through `raisedIn` rather than off the entry's tag: a recompose that raced the raise
 * carries it inside the person's reason, and the step still stops.
 */
const raisedUnplannedWork = (t: Trak, i: number): boolean =>
  (t.plan?.steps ?? []).some((s) => {
    const raised = isCompose(s) ? raisedIn(s.why) : undefined
    return raised !== undefined && raised.step === i && raised.requirements.length > 0
  })

/**
 * Was this entry planned as a conversation with the person?
 *
 * An entry that says the artifact is not owed on the first turn is one somebody was
 * expected to be in the room for, and a step that turns out to have enough to go on and
 * files immediately has not changed what the plan asked for.
 *
 * **Asked ahead of every mode, not only in `STOPS`.** A person's question of a trak at
 * rest and New Chat's named agent both arrive as such an entry — see `conversationWith`
 * — and an answer the mode took for them was one the person who asked never saw.
 * Nothing on the entry tells those from one the composer planned, so every
 * conversational entry stops.
 */
const plannedAsConversation = (t: Trak, i: number): boolean => {
  const step = t.plan?.steps[i]
  return step !== undefined && isConversational(step)
}

/**
 * Is the round of fixing this entry belongs to one that has stopped getting anywhere —
 * the same complaint said again, or one round past the trak's budget?
 *
 * Both bounds are on the round rather than on the entry, so the re-cut and the fix it
 * plans answer alike: a round nobody should be buying unread is not one whose plan
 * should go by unread either.
 */
const fixingIsNotLanding = (t: Trak, i: number): boolean => {
  const p = t.plan
  if (p === undefined) return false
  return sameComplaintTwice(p, i) || roundOfFixing(p, i) > FIXING_ROUND_LIMIT
}

/**
 * Did the compose run at this position hand work off to a new trak?
 *
 * **The one clause about work outside this trak.** Every other reason here is about
 * this trak's own plan going past unread, which costs at most this trak; approving a
 * hand-off opens traks that run on the main line and never come back, and `smart`
 * promises a person at anything that asks for one. `auto` opens them unread — that is
 * what the mode means, and `approvedInAdvance` is asked before this list.
 *
 * Read off the slot, where `landCompose` and `landFinish` put the run's answer, so a
 * hand-off withdrawn by a chat reads as none. **Never on a goal's trak**: its hand-off
 * opens nothing, and goes to the goal's composer to place. Whether that goal is still
 * going is on the goal's log, which this cannot read — so the trak of a goal done or
 * dropped goes past this on `smart` too, and its hand-off then opens unread.
 */
const handedOff = (t: Trak, i: number): boolean =>
  i >= 0 && t.goal === undefined && slotAt(t, i).handOffs.length > 0

/**
 * Did the compose run at this position propose a goal? `handedOff`'s clause for the
 * other work outside this trak: a goal's composer spends from its first turn, so
 * `smart` and `decider` stop for it and `auto` lets it start unread.
 */
const proposedGoal = (t: Trak, i: number): boolean => i >= 0 && slotAt(t, i).goal !== undefined

/**
 * Every reason a `smart` trak still stops, in the order they are asked.
 *
 * **A list, so amending it is one entry and one test row.** The first three are about
 * this position, the fourth about the round it belongs to, and the last two about work
 * outside the trak. An entry planned as a conversation stops too, ahead of the modes —
 * see `plannedAsConversation`. Nothing here is an exception to anything — a gate goes past when
 * none of them fires.
 */
const STOPS: readonly ((t: Trak, i: number) => boolean)[] = [
  reportedAmbiguity,
  moreThanOneTurn,
  raisedUnplannedWork,
  fixingIsNotLanding,
  handedOff,
  proposedGoal,
]

// ============================================================================
// The round a fix belongs to
// ============================================================================

/** The one reason a complaint can put in front of the composer. See `ReconsultWhy`. */
type Raised = Extract<ReconsultWhy, { readonly _tag: "Raised" }>

/**
 * The raise inside a reason, if there is one — the reason itself, or the one a person's
 * recompose displaced when it landed after the turn had ended.
 *
 * **The one place this module tells a `Raised` from the entry it stands on**, and both
 * readers below come through it. Each used to test `why._tag === "Raised"` on the entry
 * directly, and both went quiet the moment a raise was nested: a `smart` trak walked past
 * the step that raised, and the same-complaint-twice rule stopped seeing a round. The
 * fact is the same wherever it sits; only the person's words were written around it.
 */
const raisedIn = (why: ReconsultWhy | undefined): Raised | undefined => {
  if (why === undefined) return undefined
  if (why._tag === "Raised") return why
  return why._tag === "Replanned" ? raisedIn(why.displaced) : undefined
}

/**
 * The compose entry the entry at `i` belongs to — itself where it is one, and the last
 * one before it otherwise.
 *
 * `-1` before the first compose of a trak, which is every entry of a plan nothing has
 * asked about yet.
 */
const roundEntry = (p: Plan, i: number): number => {
  const here = p.steps[i]
  return here !== undefined && isCompose(here) ? i : composeBefore(p, i)
}

/**
 * The complaints that bought the compose entry at `at`, and `undefined` where that entry
 * is not a round of fixing at all — a first plan, a person's replan, a re-entry, a merge
 * that conflicted, or a round that raised only work nobody planned.
 *
 * Read off the entry rather than off `Trak.reconsult`, which is cleared the moment the
 * plan answering it begins. The entry keeps the reason for good, because nothing that
 * ran is ever replaced — and through `raisedIn`, because a round whose complaints a raced
 * recompose absorbed is still a round of fixing.
 */
const complaintsAt = (p: Plan, at: number): Raised | undefined => {
  const entry = p.steps[at]
  const raised = entry !== undefined && isCompose(entry) ? raisedIn(entry.why) : undefined
  return raised !== undefined && raised.corrections.length > 0 ? raised : undefined
}

/**
 * Has this round already been round — the same complaint, said again?
 *
 * **The rule that decides whether a loop is getting anywhere**, and the reason the count
 * beside it can be as loose as it is. A review that finds something new each round is a
 * loop doing its job however long it runs; one that files the same objection against the
 * fix that was supposed to answer it has shown the work is not the small thing this rule
 * is for, and it has shown it on the first repeat rather than on the fourth round.
 *
 * Compared on the words and never on the document — see `complaintSignature`, which is
 * `failureSignature`'s rule one loop out. Both rounds are in the plan for good.
 */
const sameComplaintTwice = (p: Plan, i: number): boolean => {
  const at = roundEntry(p, i)
  const here = complaintsAt(p, at)
  const before = complaintsAt(p, composeBefore(p, at))
  return (
    here !== undefined &&
    before !== undefined &&
    complaintSignature(here.corrections) === complaintSignature(before.corrections)
  )
}

/**
 * Which round of fixing the entry at `i` belongs to, counting from one over the whole
 * trak — and `1` for an entry in no round at all, which is what leaves the first plan
 * and every step of it well inside the budget.
 */
const roundOfFixing = (p: Plan, i: number): number => {
  const at = roundEntry(p, i)
  return p.steps.filter((_, j) => j <= at && complaintsAt(p, j) !== undefined).length || 1
}

// ============================================================================
// What decide asks
// ============================================================================

/**
 * Is this trak running with nobody at its gates?
 *
 * **`auto` and nothing else**, for the whole trak and every gate below. `smart` answers
 * the same question one entry at a time, and `runsUnattended` is where the two meet.
 * `decider` is not here: it shares the first bullet below through `warrantFor` and the
 * last through `endsUnattended`, and stands at the questions and the conversation.
 *
 * What it changes at each gate, and the differences are the whole of it:
 *
 * - the **plan** and a filed **artifact** — the press is taken. Something is on the
 *   table and taking it is what approving means, so this is the press a person made
 *   in advance rather than a new decision. Not an artifact an entry planned as a
 *   conversation filed: `warrantFor` stops there on every mode.
 * - **questions** — answered, by saying nobody is going to answer them and taking
 *   the option the agent recommended where it marked one. See `unanswered`, which
 *   is where the bound on that lives.
 * - **conversation** — the step is told the conversation has no other side and to
 *   file what it owes. See `Trigger.Unread`.
 * - **checks** — parks, and this is the one it deliberately does not reach. The
 *   artifact is there and a script already knows it is wrong; approving past that is
 *   taking work nothing vouches for, and it is the gate worth standing at even for
 *   somebody who said they would stand at none.
 * - **stuck** — parks. Nothing has been filed and there is nothing to say on the
 *   trak's behalf: a step that reports it could not do the work is the case a person
 *   exists for, and no sentence from the engine changes what it found.
 * - a **child's ending** — taken, whatever its branch holds. See `endsUnattended`,
 *   which is where `smart` answers the same question more narrowly, and `decider` as `auto` does.
 *
 * **A pending hold answers no to all of it.** The person asked to hold the current
 * step until they accept it — a spawn, which has no gate, is passed over — and *every*
 * gate above is one that step can reach — a
 * hold that let the questions be answered unattended and stood only at the artifact
 * would be a hold on one kind of gate. It is spent by the acceptance, never by a gate
 * opening, so the step's gates all stand and the one after it is the mode's again.
 * See `accepted` in `replay.ts`.
 *
 * **A conflict the engine sent the trak back for answers yes on every mode**, until the
 * trak rests — see `Trak.resolving`. The fix is a merge of the base and a push, and a
 * person who turned auto-merge on asked for that to go through; a red CI is not this,
 * and follows the mode.
 */
export const approvedInAdvance = (t: Trak): boolean =>
  (t.mode === "auto" || t.resolving) && !t.holding

/**
 * Does this trak end itself when its plan runs out, rather than holding at `Finished`
 * for a person to merge or archive it?
 *
 * **A child's, or a goal's trak that committed nothing — never another trak at the
 * top.** The ending is not a gate inside the plan: it is the press that puts a branch
 * into a checkout, and for a trak at the top that checkout is the one a person is
 * standing in. A child's destination is its parent's checkout, which Orkestra made, so
 * ending it is the one case where the engine has somewhere of its own to land the work
 * — and a parent on `auto` that never joins is a parent that waits forever, since
 * nothing but this press lands a child.
 *
 * `moved` is whether anything was ever committed on the branch. On `auto` and `decider`
 * — a parent that never joins waits forever, and no question is involved — it decides
 * *which* ending a child takes; on `smart` it decides *whether*: a piece that only wrote
 * documents has nothing for a person to look at before it goes, where a piece holding
 * code is what the mode stands at. `manual` holds every child, as it holds every gate.
 *
 * **A goal's trak with nothing on its branch ends on every mode.** There is no branch
 * to merge and no pull request to wait on, so the archive is the whole of what is left,
 * and its goal hears it as a landing — see `outcomeOf`. One that committed holds at
 * `Finished` for its pull request, which the forge sweep watches.
 *
 * **A pending hold holds the ending on every mode.** Read once, ahead of the modes,
 * rather than inside each arm: `approvedInAdvance` reads it for `auto`, but the `smart`
 * arm did not, and a `smart` child with nothing on its branch archived itself —
 * checkout gone — with the person's hold still pending.
 */
export const endsUnattended = (t: Trak, moved: boolean): boolean => {
  if (t.holding) return false
  if (t.parent !== undefined)
    return approvedInAdvance(t) || t.mode === "decider" || (t.mode === "smart" && !moved)
  return t.goal !== undefined && !moved
}

/**
 * May this turn be told to answer its own questions, or has that stopped working?
 *
 * **The budget is the position's whole attempt count, not a question counter.**
 * `iterations` is what a position has spent on anything — questions, re-runs after a
 * failing check, the artifact itself — and reusing it means no second counter with
 * its own lifetime to keep straight. It errs toward asking a person: a step already
 * on its third turn that starts asking questions gets none of this, which is the
 * right direction for a mistake to go. It is in the slot, so a splice drops it and a
 * re-planned position starts over.
 *
 * **The composer's counter is at the position its entry will land at**, which is why
 * this takes an index rather than reading it off the state: `recordFacts` bumps
 * `firstUnrun` when a composer run asks, and that is where `landCompose` writes the
 * run when it finally proposes. Nothing runs in between, so within one run's rounds
 * of asking the index does not move.
 *
 * **`auto` alone.** On `smart` a question is a person's to answer, and the step that
 * asked it stops at its own gate afterwards — see `moreThanOneTurn`. On `decider` it is
 * the person's too, which is what that mode keeps.
 */
export const unanswered = (t: Trak, at: number): boolean =>
  approvedInAdvance(t) && slotAt(t, at).iterations <= UNANSWERED_LIMIT

/**
 * Does the entry at `i` go past its gate without anybody reading what it files, and on
 * what grounds?
 *
 * **The one place all four modes are answered**, and the same call that produces the
 * record: `applyEvent` stamps what this returns onto `Trak.marks` at the moment
 * `decide` takes the gate, so a surface drawing why a gate went past is reading what
 * the rule read *then*, not a second reading of the plan that can disagree with it.
 * `undefined` is *a person is wanted here*.
 *
 * **`decider` takes every gate here on the mode's account but a hand-off's, a proposed
 * goal's and a conversation's.** Its
 * questions and conversations never reach this call — `approvedInAdvance` says no, so
 * `decide` parks them at their own gates — and once they are answered the document
 * filed after them is a standard one, so the second turn that stops `smart` does not
 * stop it. A hand-off opens traks outside this one and a proposed goal opens a goal, and
 * either is the person's call on every mode but `auto`.
 *
 * **The hold is asked first**, ahead of the mode, because it is the one answer that
 * overrides every mode: a person who pressed it on an `auto` trak is standing at this
 * gate whatever they said when the trak started. **An entry planned as a conversation
 * is asked ahead of the mode too**, after a conflict the engine sent back — see
 * `plannedAsConversation`.
 */
export const warrantFor = (t: Trak, i: number): Warrant | undefined => {
  if (t.holding) return undefined
  if (t.resolving) return Mark.Resolving()
  if (plannedAsConversation(t, i)) return undefined
  if (approvedInAdvance(t)) return Mark.Mode()
  if (t.mode === "decider") return handedOff(t, i) || proposedGoal(t, i) ? undefined : Mark.Mode()
  if (t.mode !== "smart" || t.plan === undefined || i < 0) return undefined
  return STOPS.some((stops) => stops(t, i))
    ? undefined
    : Mark.Uneventful({ ambiguity: ambiguityOf(slotAt(t, i).ambiguity) })
}

/** Does the entry at `i` go past its gate with nobody reading what it filed? */
export const runsUnattended = (t: Trak, i: number): boolean => warrantFor(t, i) !== undefined

/**
 * The same question at the plan gate, asked about the compose run that just landed —
 * the entry it is about, and what the rule read.
 *
 * **The run that happened, not the entry approving would enter.** An entry that has not
 * run has an empty slot, which reads as clean — so asking about it would take a gate on
 * a plan nobody has seen, on the strength of a step that has done nothing. The compose
 * position has its own record: what the run reported, whether it asked anything, and
 * which round of fixing it belongs to.
 *
 * The compose entry is the last one before the join, which `landCompose` guarantees by
 * appending the steps it proposed straight after it. A plan with no compose entry at all
 * is a person's to read: nothing here can name the run that wrote it.
 */
export const planRunsUnattended = (t: Trak): boolean => {
  const p = t.plan
  return p !== undefined && runsUnattended(t, composeBefore(p, firstUnrun(t)))
}

/**
 * The same, as the record: the compose entry the plan gate belongs to, and what the
 * rule read to take it — or nothing, where a person is wanted or where there is no
 * entry to stamp. The second is `auto` with no compose run behind the plan, which
 * takes the gate on the mode's account and has no entry of its own to say so on.
 */
export const planWarrant = (t: Trak): readonly [at: number, why: Warrant] | undefined => {
  const at = planEntryOf(t)
  if (at === undefined) return undefined
  const why = warrantFor(t, at)
  return why === undefined ? undefined : [at, why]
}

// ============================================================================
// Auto-merge
// ============================================================================

/**
 * How many times the engine sends an auto-merging trak back without a merge before it
 * stops and leaves the trak to its person. **A count that is the constraint, not a
 * setting**: each send is a composer turn and a push, and a pull request three of those
 * did not fix wants somebody to read it.
 */
export const AUTO_MERGE_SENDS = 3

/**
 * May the engine still merge this trak's pull request on its own, or send it back once
 * more? `false` for a trak without auto-merge, and for one it has stopped on.
 */
export const autoMerging = (t: Trak): boolean =>
  t.autoMerge !== undefined && t.autoMerge.stopped === undefined

/** Has the engine sent this auto-merging trak back as many times as it may? */
export const sendsSpent = (t: Trak): boolean =>
  t.autoMerge !== undefined && t.autoMerge.sentBack >= AUTO_MERGE_SENDS
