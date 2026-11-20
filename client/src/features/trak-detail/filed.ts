/**
 * What a position filed, and why it ran again — both read off the log.
 *
 * **Nothing here is a new field on the wire.** `TrakDetailDto.log` already carries every
 * `AgentReturned`, every `ComposerReturned`, every `CheckFailed` and every `HumanActed`,
 * and the drawer already holds the whole thing. The two questions the step pane needs
 * answering — *what did this position produce* and *why did it run a second time* — are
 * projections over that list, so they cost a pure function each and no schema change.
 *
 * The alternative was a `trigger` on the wire. `Trigger` is engine-internal: it selects
 * which resume prompt a turn gets, it is matched exhaustively in `prompt.ts`, and putting
 * it on a DTO would make a client field of something the engine reserves the right to
 * re-shape. The events are the durable record; the trigger is the engine's reading of
 * them, and the client is entitled to its own.
 */

import type {
  AttachmentDto,
  ComposerOutputDto,
  EventDto,
  PlaceDto,
  StepOutputDto,
} from "../../api/types"

type HumanAction = Extract<EventDto, { _tag: "HumanActed" }>["action"]

/**
 * What a position filed, in log order.
 *
 * A position can file more than once — a check failure re-enters the agent and it returns
 * again — so this is a list rather than a value, and **the last one is the live one**.
 * Everything before it is superseded and a surface that shows them all shows a step
 * arguing with itself.
 *
 * `ComposerReturned` carries no `step`, which is why the composer's outputs are a
 * separate accessor below rather than this function taking `number | "composer"`: one
 * function over two events with different shapes would need a cast at the only point that
 * matters.
 */
export const filedAt = (log: readonly EventDto[], step: number): readonly StepOutputDto[] =>
  log.flatMap((e) => (e._tag === "AgentReturned" && e.step === step ? [e.output] : []))

/** The newest thing a position filed, or `undefined` where it has filed nothing. */
export const lastFiledAt = (log: readonly EventDto[], step: number): StepOutputDto | undefined =>
  filedAt(log, step).at(-1)

/**
 * What a person sent at an answers gate: the positional answers, and the note that
 * belongs to none of them.
 *
 * **One value rather than two maps keyed the same way.** Both are read off the same
 * `HumanActed` in the same window, and a second projection pairing notes to asks would
 * be the same arithmetic written twice — which drifts silently, on exactly the logs it
 * was shaped for, into a note drawn against somebody else's answers.
 */
export interface Answered {
  readonly answers: readonly string[]
  /** Absent where nothing was typed alongside. Never blank — `actFromDto` drops those. */
  readonly note?: string
}

/**
 * What came back to the ask filed at each index of the log, for one kind of ask.
 *
 * **The join is log order, and deliberately not `HumanActed.step`.** The server writes a
 * nominal `step: 0` at a composer gate, so keying on the position reads the composer's
 * answers as position zero's. What actually pairs the two is the gate: a reply is
 * submitted at the gate the newest ask opened, so an ask's reply is the one recorded
 * after it and before the next ask — the same windowing `whyRan` does for a cause.
 *
 * **An ask nobody answered is absent, not empty.** Skipped, superseded and replanned-past
 * asks all leave a window with nothing in it, and on screen that is a different card from
 * one answered with a list of nothing. `AnswerQuestionsActionDto` refuses an empty list
 * anyway, so the two can never be confused by a real log — only by this function
 * flattening them.
 */
const repliesByAsk = <R>(
  log: readonly EventDto[],
  asks: "questions" | "permission",
  reply: (action: HumanAction) => R | undefined,
): ReadonlyMap<number, R> => {
  const replies = new Map<number, R>()
  // The newest ask with nothing against it yet. A second ask closes the first unanswered,
  // which is what keeps a composer ask nobody answered from taking the step's answers:
  // a person answers what is on the table, and what is on the table is the last ask.
  let open: number | undefined

  for (const [i, e] of log.entries()) {
    if ((e._tag === "AgentReturned" || e._tag === "ComposerReturned") && e.output.type === asks) {
      open = i
    } else if (e._tag === "HumanActed" && open !== undefined) {
      const r = reply(e.action)
      if (r === undefined) continue
      replies.set(open, r)
      open = undefined
    }
  }

  return replies
}

const answersByAsk = (log: readonly EventDto[]): ReadonlyMap<number, Answered> =>
  repliesByAsk(log, "questions", (action) =>
    action._tag === "AnswerQuestions" ? { answers: action.answers, note: action.note } : undefined,
  )

/** Whether each permission ask was allowed — `true` — or refused. */
const permitsByAsk = (log: readonly EventDto[]): ReadonlyMap<number, boolean> =>
  repliesByAsk(log, "permission", (action) =>
    action._tag === "Permit" ? action.granted : undefined,
  )

/**
 * Where each turn at a position ended, as indices into the log.
 *
 * **Every turn ends exactly once, in log order, in the order the turns ran** — so the
 * k-th ending is the k-th turn's, and that one fact places both a turn's outcome and the
 * next turn's cause. `filedByTurn` and `whyRan` are the same arithmetic asked twice, which
 * is why they read one list rather than counting separately: a position cannot have had
 * one number of turns for its documents and another for its headings.
 *
 * - `AgentReturned`, or `ComposerReturned` for a run of the composer — it filed. The only
 *   ending with an output. Which of the two is a position's is `mine`'s answer, below.
 * - `TurnFailed` — it launched and died, and the engine said so.
 * - `Restarted` — it launched and the *engine* died, so nothing said so at the time. The
 *   process that writes a `TurnFailed` is the process that was killed, so this is the
 *   turn's only ending, written when somebody picked the trak back up. Two interruptions
 *   at one position is what put a document two turns above the turn that filed it and
 *   left an approval gate with no card to hang its press on.
 * - `Stopped` — a person killed it, and the same thing follows for the same reason: the
 *   process that would have written an ending is the one they killed. It is read exactly
 *   as a restart is, and the two never disagree about a turn — a stop is written in the
 *   drive that replaces the one it interrupted, so nothing else can have closed it.
 * - `FilingAsked` **with a `sessionId`** — a person asked the step for what it has while
 *   a turn was running, and the turn was killed for it. Without one, nothing was killed:
 *   the step was parked in a conversation, its turn already ended by the `AgentReturned`
 *   that parked it, and counting the ask as a second ending would invent a turn. `step`
 *   is on both shapes, so the session is what tells them apart.
 * - `HumanActed` **with a `sessionId`** — a `Replan` pressed while the step's turn ran,
 *   which the route killed to fork the replan in its place. The same test as a filing,
 *   for the same reason: every press at a gate carries the step and no session, and
 *   killed nothing.
 * - `Abandoned` **with a `sessionId`** — the archive found a turn running and killed it.
 *   The step is on it where the turn was a step's, and absent for the composer's, which
 *   is how `mine` tells whose it was; a trak archived while parked carries none of the
 *   three and ends no turn.
 *
 * **`step` on either is the engine saying a turn was in flight.** The record it is
 * stamped from is written inside the turn's bracket and released before *either* of that
 * turn's endings is appended, so a restart following a turn the engine closed has no step
 * to carry and a stepped one names a turn nothing else closed. The shape that lies is a
 * release that did not take — the write is swallowed rather than raised, and a log an
 * older engine left cannot be rewritten — which leaves a stepped restart standing behind
 * a `TurnFailed` for the same turn. Counting that restart as a second ending invents a
 * turn between the two attempts, and puts the second attempt's heading and its document
 * one section below its own rows.
 *
 * So the suppression is keyed on the engine having already written that turn's other
 * ending, and on nothing else. **Never on the client believing no turn could have
 * started**, which it cannot work out: `decide` spawns a turn on five triggers, and the
 * ones a person's answers or a replan start write no per-position event for this function
 * to read — so a rule inferring openness from re-entries drops the ending of every turn
 * those began.
 */
export const turnEndings = (
  log: readonly EventDto[],
  mine: (e: EventDto) => boolean,
): readonly number[] => {
  const ends: number[] = []
  // Whether the newest ending at this position was a `TurnFailed` nothing has passed yet
  // — the one state in which a stepped `Restarted` is re-ending a closed turn.
  let stated = false

  for (const [i, e] of log.entries()) {
    if ((e._tag === "AgentReturned" || e._tag === "ComposerReturned") && mine(e)) {
      ends.push(i)
      stated = false
    } else if (e._tag === "TurnFailed" && mine(e)) {
      ends.push(i)
      stated = true
    } else if (
      e._tag === "Restarted" ||
      e._tag === "StopRequested" ||
      e._tag === "Stopped" ||
      ((e._tag === "FilingAsked" ||
        e._tag === "HumanActed" ||
        e._tag === "Abandoned" ||
        e._tag === "SetupFailed") &&
        e.sessionId !== undefined)
    ) {
      if (!stated && mine(e)) ends.push(i)
      // Cleared whether or not it counted: the turn either of them began is a new one, and
      // the engine death that ends *it* writes another stepped restart, which is a real
      // ending.
      stated = false
    }
  }

  return ends
}

/**
 * Whether an event ends a turn of *this* position — the one thing that differs between a
 * step's turns and one run of the composer's.
 *
 * A step is keyed by `step`, which every ending that can name a position carries.
 *
 * The composer has no position at all, so a run's endings are keyed by the session the run
 * *is*: `ComposerReturned` carries one, and so do the `TurnFailed` and the `Restarted`
 * that end a composer turn. The absent `step` is what tells them from a step's endings —
 * `AgentReturned` carries the same session id at a position resumed from that
 * conversation, and a stepped `Restarted` names the turn it interrupted.
 *
 * A composer turn that died before a session existed is attributed to no run, which is the
 * same answer `composerRuns` gives it and for the same reason: filing a launch failure
 * under a conversation it was never part of is worse than losing it.
 */
export const atStep =
  (step: number) =>
  (e: EventDto): boolean =>
    "step" in e && e.step === step

export const inRun =
  (session: string | undefined) =>
  (e: EventDto): boolean =>
    session !== undefined &&
    "sessionId" in e &&
    e.sessionId === session &&
    !("step" in e && e.step !== undefined)

/** One thing a position filed, and which of its attempts it was. */
export interface Filed {
  readonly output: StepOutputDto
  /** Which attempt this was, counting from one. */
  readonly nth: number
  /** How many attempts the position has made in total. */
  readonly of: number
  /**
   * What a person sent, where this output was an ask and somebody answered it.
   *
   * `undefined` on every other kind of output, and on an ask that was never answered.
   * It rides on `Filed` rather than being its own projection because the placement is
   * the same arithmetic — a second function pairing answers to turns would be a second
   * copy of it, and the two would drift on exactly the logs this one was shaped for.
   */
  readonly answered?: Answered
  /**
   * Whether a person allowed the command, where this output was a permission ask and
   * somebody answered it. Paired the way `answered` is, for its reason.
   */
  readonly permitted?: boolean
}

/**
 * What each turn at a position filed, in turn order — `undefined` where a turn filed
 * nothing, which is a turn still running or one that died before it could.
 *
 * **A turn's output is the newest thing that turn did, so it belongs to that turn**, and
 * drawing every one of them after every turn would put two of an agent's messages on
 * top of each other with the human's reply and a whole second turn's log above them. On a
 * one-turn position this changes nothing: the document is still the last thing in the pane.
 *
 * **The pairing is counting, and the count is over every way a turn can end** —
 * `turnEndings` above, which is where the endings and the rule about a restart are.
 * Every ending but a return files nothing, and those are what make this sound rather
 * than nearly sound: skipping one shifts every card after it up by one turn.
 *
 * `whyRan` reads the same list to place a *cause*, and a `Restarted` is both — which is
 * why it is read twice and means different things: the end of the turn before it, and the
 * reason for the turn after.
 *
 * **The counting only holds because a re-ask is not a turn.** `elicit` re-prompts by
 * resuming, which spawns another `claude` and files nothing — a start with no ending, so
 * every card after it landed a turn early. `turns.ts` folds it back into the turn it
 * belongs to off the `Reask` entry the engine writes, and that is what makes "every turn
 * ends exactly once" true rather than nearly true.
 *
 * A `Restarted` with no `step` ends no turn, and that is the engine's statement rather
 * than this function giving up on one: the stamp comes off the run record at the append,
 * so absent means nothing was in flight — a gate re-parked, a sibling re-driven for
 * nothing, a failure the engine already recorded an ending for. A `TurnFailed` with no
 * step is the one that cannot be attributed, and there the result is a card drawn one
 * turn late, which is the same thing that happens today.
 *
 * Longer than `turns` when the transcript is missing a turn the log knows about, which is
 * every file written before the engine stamped positions. The extra entries are still
 * returned, and the caller still draws them: a pane silently dropping the one thing it
 * exists to show is indistinguishable from a step that filed nothing.
 */
export const filedByTurn = (
  log: readonly EventDto[],
  step: number,
  turns: number,
): readonly (Filed | undefined)[] => {
  const answers = answersByAsk(log)
  const permits = permitsByAsk(log)
  const ended = turnEndings(log, atStep(step)).map((i) => {
    const e = log[i]
    // Every ending that files nothing keeps its slot, which is the whole point of
    // counting endings rather than outputs.
    return e?._tag === "AgentReturned"
      ? { output: e.output, answered: answers.get(i), permitted: permits.get(i) }
      : undefined
  })
  const of = ended.filter((o) => o !== undefined).length
  let nth = 0
  const placed = ended.map((filed) => {
    if (filed === undefined) return undefined
    nth += 1
    return { output: filed.output, answered: filed.answered, permitted: filed.permitted, nth, of }
  })
  return Array.from({ length: Math.max(turns, placed.length) }, (_, i) => placed[i])
}

/**
 * What one run of the composer returned.
 *
 * Keyed by session rather than by position, because that is what a composer run *is*:
 * `ComposerReturned` carries no `step`, and `rows.ts` already zips one run per compose
 * entry off the same fact. Latest wins within a session — a run that was asked again
 * returns twice under the same id.
 *
 * Three of the composer's four outputs are shapes a step can file too, so the pane draws
 * them with the same components. The fourth is the proposal, and that is the one the
 * drawer's Map already draws.
 */
export const composerFiledIn = (
  log: readonly EventDto[],
  session: string | undefined,
): ComposerOutputDto | undefined => {
  if (session === undefined) return undefined
  return log
    .flatMap((e) => (e._tag === "ComposerReturned" && e.sessionId === session ? [e.output] : []))
    .at(-1)
}

/**
 * What a person answered the ask a compose run ended on, or `undefined` where the run
 * ended on something else or nobody answered.
 *
 * Keyed by session for the reason `composerFiledIn` is, and asked of the *last* output in
 * that session for the same reason: a run that asked and then, resumed, proposed has one
 * card on screen and it is the proposal's. Latest wins, and a proposal has no answers.
 */
export const composerAnswersIn = (
  log: readonly EventDto[],
  session: string | undefined,
): Answered | undefined => {
  if (session === undefined) return undefined
  const answers = answersByAsk(log)
  let last: Answered | undefined
  for (const [i, e] of log.entries())
    if (e._tag === "ComposerReturned" && e.sessionId === session) last = answers.get(i)
  return last
}

/**
 * The text each turn at a position wrote its output as, for the log above to subtract.
 *
 * Every turn's, not the newest — a position that filed twice has two entries on screen
 * and both hold JSON. Turns that reported none contribute nothing, which is what leaves
 * a prose answer and a malformed envelope drawn whole.
 *
 * A set rather than a list: `withoutEnvelopes` asks which of them an entry holds, and
 * the same string filed twice is one answer.
 */
export const envelopesAt = (log: readonly EventDto[], step: number): ReadonlySet<string> =>
  new Set(
    log.flatMap((e) =>
      e._tag === "AgentReturned" && e.step === step && e.envelope !== undefined ? [e.envelope] : [],
    ),
  )

/**
 * The same, for a run of the composer — keyed by session, because `ComposerReturned`
 * carries no position. See `composerFiledIn`.
 */
export const composerEnvelopesIn = (
  log: readonly EventDto[],
  session: string | undefined,
): ReadonlySet<string> =>
  new Set(
    session === undefined
      ? []
      : log.flatMap((e) =>
          e._tag === "ComposerReturned" && e.sessionId === session && e.envelope !== undefined
            ? [e.envelope]
            : [],
        ),
  )

/**
 * Why a turn ran, when something caused it.
 *
 * Absent on a position's **first** turn, and that is the point: a mark saying *first
 * attempt* announces something ordinary, where a reader's real question at a second turn
 * is why there was one. So this answers only for turns after the first.
 *
 * The four causes are the four events that can sit between two turns at one position:
 *
 * - `CheckFailed` — a declared check came back non-zero, and the agent was re-entered
 * - `HumanActed` with a `Chat` — a person typed something, and it resumed the session
 * - `Restarted` — a turn was cut off and somebody picked it back up
 * - `FilingAsked` — a person asked the step for what it has, and it was re-entered to file
 *
 * `Approve` and `Skip` are deliberately not causes: both move the trak *past* this
 * position, so a turn cannot follow them here.
 *
 * **`Stopped` is not one either, and it is the interesting absence.** It ends a turn, so
 * it opens the window below — but nothing runs at that position again until the person
 * who stopped it says something, and that `Chat` is later in the same window and wins.
 * Naming the stop as well would head the resumed turn with *a turn was cut off* over the
 * sentence that actually caused it.
 */
export type Why =
  | { readonly _tag: "CheckFailed"; readonly name: string }
  | {
      readonly _tag: "Said"
      readonly text: string
      readonly attachments: readonly AttachmentDto[]
    }
  | { readonly _tag: "Restarted" }
  | { readonly _tag: "Filing" }

/**
 * The cause of the `n`th turn at a position, counting from zero.
 *
 * The window is the one `turnEndings` draws: turn `n`'s cause is whatever was recorded
 * after turn `n - 1` ended and before turn `n` did, and the newest such thing wins. What
 * sits between them and means nothing here — `WorkCommitted`, another position's turn, a
 * spawn's children landing — is passed over, which is the point of naming the causes
 * rather than taking the last event before the turn.
 *
 * **Bounded by whatever *ended* the previous turn, not by `AgentReturned` alone.** A turn
 * the provider cut off ends in a `TurnFailed`, so counting returns left every cause after
 * one of those in a window that never opened — and the restart this trak's failure notice
 * offers is always in that position. It headed the second attempt with nothing at all, on
 * every log an interruption writes.
 *
 * Asked one past the last turn as well, for a cause the turn it will head has not started
 * for yet: `to` falls to the end of the log, which is the window still filling up.
 * `undefined` past that — a transcript holding turns the log has no endings for has no
 * window to read.
 */
export const whyRan = (log: readonly EventDto[], step: number, turn: number): Why | undefined => {
  if (turn <= 0) return undefined

  const ends = turnEndings(log, atStep(step))
  const from = ends[turn - 1]
  if (from === undefined) return undefined
  const to = ends[turn] ?? log.length

  let pending: Why | undefined
  // From the boundary itself rather than past it. A `Restarted` is the only ending that is
  // also a cause — it closes the turn it interrupted and is the reason for the one after —
  // so the window that skipped it drew the restart nowhere. The ending that *shuts* this
  // window is excluded for the mirror of that reason: where it is a `Restarted`, it belongs
  // to the next turn's heading.
  for (const e of log.slice(from, to)) {
    if (e._tag === "CheckFailed" && e.step === step) pending = { _tag: "CheckFailed", name: e.name }
    if (e._tag === "Restarted") pending = { _tag: "Restarted" }
    // Both shapes: a turn killed for it is an ending and a cause, as a restart is; a
    // parked conversation asked to file is a cause alone.
    if (e._tag === "FilingAsked" && e.step === step) pending = { _tag: "Filing" }
    if (e._tag === "HumanActed" && e.step === step && e.action._tag === "Chat")
      pending = { _tag: "Said", text: e.action.message, attachments: e.action.attachments ?? [] }
  }

  return pending
}

/**
 * How a turn ended, where the engine wrote a `TurnFailed` for it.
 *
 * Two fields because a stopped turn is two facts — `reason` is what the provider said and
 * `apiKind` is what it called it — and `format/failure.ts` turns the pair into the words
 * the notice already uses. `apiKind` is `undefined` wherever nothing was classified, which
 * is every non-zero exit and every log written before the field existed; it is *nobody
 * said* and never `unclassified`.
 */
export interface Ending {
  readonly reason: string
  readonly apiKind: Extract<EventDto, { readonly _tag: "TurnFailed" }>["apiKind"]
  /** The runner verb under the turn's spawn, where one failed — a sandbox that would not start. */
  readonly runner?: Extract<EventDto, { readonly _tag: "TurnFailed" }>["runner"]
}

/**
 * How each turn at a position ended, in turn order — `undefined` for a turn that filed,
 * one still running, and one the *engine* died during, none of which has anything to say.
 *
 * **The question the trak's state cannot answer.** A `Failed` state names the newest
 * ending and nothing else, so a restart takes the only account of an interruption off the
 * screen with it: the notice goes, the two rows the provider wrote come back raw, and a
 * turn that was cut off reads as one that stopped for no reason. This is the same list
 * `filedByTurn` and `whyRan` read, asked a third time — the k-th ending is the k-th turn's
 * — so the answer is per turn rather than per trak and survives everything after it.
 *
 * Padded to `turns` for the reason `filedByTurn` is, and longer than it where the log
 * knows about a turn the transcript does not.
 */
const endedByTurn = (
  log: readonly EventDto[],
  mine: (e: EventDto) => boolean,
  turns: number,
): readonly (Ending | undefined)[] => {
  const ended = turnEndings(log, mine).map((i) => {
    const e = log[i]
    if (e?._tag !== "TurnFailed") return undefined
    const ending: Ending = { reason: e.reason, apiKind: e.apiKind }
    return e.runner === undefined ? ending : Object.assign(ending, { runner: e.runner })
  })
  return Array.from({ length: Math.max(turns, ended.length) }, (_, i) => ended[i])
}

export const endedAt = (
  log: readonly EventDto[],
  step: number,
  turns: number,
): readonly (Ending | undefined)[] => endedByTurn(log, atStep(step), turns)

/**
 * The same, for one run of the composer — keyed by session, because `ComposerReturned`
 * carries no position. See `composerFiledIn`, and `inRun` for what a run's endings are.
 */
export const composerEndedIn = (
  log: readonly EventDto[],
  session: string | undefined,
  turns: number,
): readonly (Ending | undefined)[] => endedByTurn(log, inRun(session), turns)

/**
 * The check that came back non-zero over one turn's document, with what it printed.
 *
 * The `checks` gate is the one place a reader cannot judge without the evidence — you are
 * being asked to accept work its own check disagrees with — and `CheckFailed` carries
 * every half of it. `command` and `exitCode` are optional on the event and stay optional
 * here: a log written before they existed has neither, and a timeout has no exit code to
 * report.
 */
export interface FailedCheck {
  readonly name: string
  readonly output: string
  /** How many times this check has come back non-zero at this position, counting this one. */
  readonly attempts: number
  /** The line as spawned, absolute path and all. Shortening it for display is the surface's. */
  readonly command?: string
  readonly exitCode?: number
  /** Where the run happened, off the event. Absent on a log written before it was recorded. */
  readonly place?: PlaceDto
}

/** One effect this position ran, and what it printed. */
export interface RanEffect {
  readonly name: string
  readonly output: string
  /** It exited non-zero, which is what stopped the trak. */
  readonly failed: boolean
}

/**
 * What this position's effects did, and when they did it.
 *
 * **The only record that anything happened outside this checkout.** An effect acts —
 * it opens a pull request, it posts somewhere — and nothing here can look again to
 * find out, so the bytes it printed are the whole of what a reader gets, and a link
 * among them exists nowhere else on the surface.
 *
 * **`at` is not decoration.** What is drawn is what a script saw at the moment it
 * ran; nothing polls and nothing re-asks, so a card without the time on it would be
 * making a claim about now that the client has no way to stand behind.
 *
 * The newest run wins whole. A restart re-issues the effects, and what the run before
 * it printed is a description of a world that has moved — where a check's superseded
 * output is merely an attempt the agent replaced.
 *
 * `undefined` where nothing ran, **including where the engine wrote `ran: []`**: every
 * step boundary passes through `Effecting` and almost none declares an effect, so a
 * card saying *nothing acted* would be on nearly every position in the app. A skip is the
 * exception: nothing ran there either, and the card is the note that says which effects.
 */
export const effectsAt = (
  log: readonly EventDto[],
  step: number,
):
  | {
      readonly effects: readonly RanEffect[]
      /** What a person's skip kept from running, where one did — the note on the step. */
      readonly skipped?: readonly string[]
      readonly at: number | undefined
    }
  | undefined => {
  const last = log.findLast(
    (e) => (e._tag === "EffectsRan" || e._tag === "EffectFailed") && e.step === step,
  )
  // `findLast` does not narrow the union, so each tag is re-checked rather than asserted.
  if (last?._tag === "EffectFailed") {
    return { effects: [{ name: last.name, output: last.output, failed: true }], at: last.at }
  }
  if (last?._tag === "EffectsRan" && last.skipped !== undefined) {
    return { effects: [], skipped: last.skipped, at: last.at }
  }
  if (last?._tag !== "EffectsRan" || last.ran.length === 0) return undefined
  return {
    effects: last.ran.map((r) => ({ name: r.name, output: r.output, failed: false })),
    at: last.at,
  }
}

/**
 * How the check over one turn's document came out, where it ran at all.
 *
 * **Both outcomes, not just the failure**, and that is the whole point of the type: the
 * daemon holds one run in memory with no turn on it, and *which document did this judge*
 * has exactly one answer on the log — the turn whose window holds the settlement matching
 * it. A shape that named only failures could answer that question for a failed run and
 * had to guess for a passed one, which is how a green verdict landed over work no check
 * had run on. `check.ts` does the matching.
 *
 * `Passed` carries nothing because there is nothing to carry: `ChecksPassed{step, ran}`
 * has no output, no duration and no exit code, so everything a passed run can show comes
 * from the daemon's memory of it or from nowhere.
 *
 * **`Skipped` is the same event with `skipped` on it** — a person's switch kept the named
 * checks from running, and the step was accepted as a pass accepts it. Its own tag rather
 * than a field on `Passed`, because the card has to say so twice and a pass that reads as
 * one is exactly how a step nobody checked comes to look like a step that passed.
 * `Cancelled` is a person ending the run: no verdict, no strike, and the name of the check
 * where the engine had it.
 *
 * **`Reused` is a pass where nothing ran**: every check was accepted on an earlier pass
 * over exactly these files. Its own tag for `Skipped`'s reason — the daemon holds no run
 * for it, so a `Passed` here would pair with whatever older run it still remembers and
 * draw that run's console over a document it never judged. A pass where some checks ran
 * and others were reused is `Passed`: the run the daemon holds is this one.
 */
export type Settled =
  | { readonly _tag: "Passed" }
  | { readonly _tag: "Skipped"; readonly names: readonly string[] }
  | { readonly _tag: "Reused"; readonly names: readonly string[] }
  | { readonly _tag: "Failed"; readonly failed: FailedCheck }
  | { readonly _tag: "Cancelled"; readonly name: string | undefined }

/**
 * How each turn's check came out, in turn order — `undefined` for a turn no check ran
 * over, one still waiting for its check, and one that filed nothing.
 *
 * **Per turn, because a verdict belongs to the document it is about.** A position that
 * failed a check and was re-entered files twice, and the failure is about the first of
 * them: it is the reason the second exists. The pairing is the window arithmetic `whyRan`
 * and `filedByTurn` already use — turn `n`'s settlement is whatever was recorded after
 * turn `n` ended and before turn `n + 1` did — asked a fourth time, so nothing here can
 * disagree with them about how many turns a position had.
 *
 * **At most one settlement per window**, so the search takes the first rather than the
 * last: `RunChecks` runs a position's declared checks in one pass and returns either at
 * the first that comes back non-zero or with one `ChecksPassed` naming all of them, so a
 * position declaring three still writes one event.
 *
 * **A settlement before the first ending belongs to no turn and is dropped.** It cannot
 * happen against a real log — a check runs on what a turn filed, so an `AgentReturned` is
 * always in front of it — and attributing it to turn zero would put an earlier position's
 * verdict on this one's first document.
 *
 * A failure is deliberately not withdrawn when a later run passes. It is a fact about the
 * attempt that earned it, and the attempt keeps it: what stops a resolved failure reading
 * as the reason you are being asked now is that the card carrying it is a superseded one,
 * folded under `Attempt 1 of 2`.
 */
export const settledByTurn = (
  log: readonly EventDto[],
  step: number,
  turns: number,
): readonly (Settled | undefined)[] => {
  const ends = turnEndings(log, atStep(step))
  const attempts = new Map<string, number>()
  const settled = ends.map((from, turn) => {
    const to = ends[turn + 1] ?? log.length
    const event = log
      .slice(from + 1, to)
      .find(
        (e) =>
          (e._tag === "CheckFailed" || e._tag === "ChecksPassed" || e._tag === "ChecksCancelled") &&
          e.step === step,
      )
    if (event === undefined) return undefined
    if (event._tag === "ChecksPassed") {
      if (event.skipped !== undefined) return { _tag: "Skipped" as const, names: event.skipped }
      return event.ran.length === 0 && event.reused !== undefined
        ? { _tag: "Reused" as const, names: event.reused }
        : { _tag: "Passed" as const }
    }
    if (event._tag === "ChecksCancelled") return { _tag: "Cancelled" as const, name: event.name }
    if (event._tag !== "CheckFailed") return undefined
    const nth = (attempts.get(event.name) ?? 0) + 1
    attempts.set(event.name, nth)
    return {
      _tag: "Failed" as const,
      failed: {
        name: event.name,
        output: event.output,
        attempts: nth,
        command: event.command,
        exitCode: event.exitCode,
        place: event.place,
      },
    }
  })
  return Array.from({ length: Math.max(turns, settled.length) }, (_, i) => settled[i])
}
