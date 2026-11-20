/**
 * The agent's transcript, cut into turns and attributed to the plan entry each one ran
 * for.
 *
 * **Each entry carries the position its turn ran for**, stamped by the runtime from the
 * command it was running — so the attribution is read, not recovered.
 *
 * **Three things cut a turn, and `Spawned` is only one of them.** One `claude` is one
 * turn, so a `Spawned` starts one — but it is written on some paths and not others, which
 * `agent/types/transcript-entry.ts` says outright and is why every entry carries a stamp
 * at all. A transcript where only the composer's turns carry a `Spawned` put every step's
 * lines into the composer turn ahead of them and labelled the lot `"composer"`, which is
 * one row holding the whole file. So a change of stamp cuts as well, and so does a
 * `Session` naming a second id — that last is what separates two turns that ran at the
 * same position under different sessions, which is the ordinary shape after a splice.
 *
 * **A `Reask` is the one thing that stops a `Spawned` cutting.** `elicit` re-prompts a
 * malformed response by resuming the session, which spawns another `claude` — so the
 * rule above would make a re-ask its own turn, while the log records one ending for the
 * whole loop. `filed.ts` pairs endings with turns by counting, so the mismatch put a
 * position's document on the turn before the one that produced it and left the gate's
 * press on a turn with no document to hang it on. The engine writes the entry; this
 * reads it, rather than inferring a retry from two documents that look alike.
 *
 * **The session join is the fallback, and it is for old transcripts only.** A line
 * written before the engine stamped a position has none, and `AgentReturned` /
 * `TurnFailed` / `ComposerReturned` each carry that turn's `sessionId` *and* its step —
 * which is right for every turn that has **ended**, and that is every turn in every file
 * written before the stamp existed. So nothing already on disk loses its attribution.
 *
 * That join is what could not answer the turn happening *right now*: the agent has
 * spawned and started a session, and the event naming its step is not written until it
 * returns. The stamp answers it, which is why the live turn no longer borrows the
 * position the trak happens to be standing at.
 *
 * A turn with neither is left unplaced rather than guessed at.
 */

import type {
  ComposerOutputDto,
  EventDto,
  PlaceDto,
  StepOutputDto,
  TranscriptEntryDto,
} from "../../../api/types"

/** One run of the CLI, as the transcript wrote it down. */
export interface Turn {
  /**
   * The CLI session, or `undefined` when the turn died before one existed — a spawn
   * that failed to start writes a `Spawned` entry and never a `Session`.
   */
  readonly session: string | undefined
  /**
   * Where it ran: a plan position, or the composer, which has none. `undefined` when
   * nothing says. The wire's own vocabulary rather than a sentinel — the composer is not
   * a position, and a number pretending it is was only ever wide enough for one of them.
   */
  readonly at: number | "composer" | undefined
  readonly entries: readonly TranscriptEntryDto[]
}

/**
 * Where a turn's CLI ran, off the `Spawned` that opened it — `undefined` for a turn that
 * opened on anything else and for one written before places were recorded. A `Reask`'s
 * second `Spawned` inside the same turn is not asked: the turn is the first spawn's.
 */
export const placeOfTurn = (turn: Turn | undefined): PlaceDto | undefined => {
  const head = turn?.entries[0]
  return head?._tag === "Spawned" ? head.place : undefined
}

/**
 * Which position each session ran at, from the events that carry both.
 *
 * Later wins, deliberately: a session resumed at a `conversation` gate produces a
 * second `AgentReturned` under the same id, and the step is the same both times — but a
 * `TurnFailed` followed by a retry that succeeded should read as the successful one.
 */
const sessionSteps = (log: readonly EventDto[]): ReadonlyMap<string, number | "composer"> => {
  const at = new Map<string, number | "composer">()
  for (const event of log) {
    if (event._tag === "ComposerReturned") at.set(event.sessionId, "composer")
    if (event._tag === "AgentReturned") at.set(event.sessionId, event.step)
    if (event._tag === "TurnFailed" && event.sessionId !== undefined && event.step !== undefined)
      at.set(event.sessionId, event.step)
  }
  return at
}

/**
 * The transcript as turns, each one placed.
 *
 * Anything before the first cut — there is normally nothing — becomes a leading turn with
 * no session, so no entry is dropped on the way to being grouped.
 */
export const splitTurns = (
  transcript: readonly TranscriptEntryDto[],
  log: readonly EventDto[],
): readonly Turn[] => {
  const steps = sessionSteps(log)

  const turns: {
    session: string | undefined
    position: number | "composer" | undefined
    entries: TranscriptEntryDto[]
  }[] = []

  // Whether the next `Spawned` is `elicit` asking again rather than a turn beginning.
  // Consumed by that spawn and by nothing else, so a re-ask absorbs exactly one.
  let reasked = false

  for (const entry of transcript) {
    const open = turns.at(-1)
    // A stamp or a session only cuts against one already recorded — the entries before
    // the first of either belong to the turn that is opening, not to a new one.
    const cut =
      open === undefined ||
      (entry._tag === "Spawned" && !reasked) ||
      (entry.position !== undefined &&
        open.position !== undefined &&
        entry.position !== open.position) ||
      (entry._tag === "Session" && open.session !== undefined && entry.id !== open.session)
    if (entry._tag === "Spawned") reasked = false
    if (entry._tag === "Reask") reasked = true
    if (cut) turns.push({ session: undefined, position: undefined, entries: [] })

    const turn = turns.at(-1)
    if (turn === undefined) continue
    turn.entries.push(entry)
    // The first of each answers for the whole turn: every line of one turn carries the
    // same values, which is what the cut above is for.
    turn.position ??= entry.position
    if (entry._tag === "Session") turn.session ??= entry.id
  }

  return turns.map((turn) => {
    // Two sources, both the engine's, neither a guess: what it stamped, and — for a
    // line written before it stamped anything — what the log says that session ran at.
    const at = turn.position ?? (turn.session === undefined ? undefined : steps.get(turn.session))
    return { session: turn.session, at, entries: turn.entries }
  })
}

/** The turns that ran for one plan position. Empty is ordinary — a step can be untouched. */
export const stepTurns = (turns: readonly Turn[], at: number): readonly Turn[] =>
  turns.filter((turn) => turn.at === at)

/** One run of the composer: one session's worth of its turns, in transcript order. */
export interface ComposerRun {
  /** `undefined` when the turn died before a session existed. */
  readonly session: string | undefined
  readonly turns: readonly Turn[]
}

/**
 * The composer's turns, cut into the runs that produced them.
 *
 * **One session is one run.** Being asked for a different plan mints a fresh session,
 * where a `Chat` or an `AnswerQuestions` at the plan gate resumes the one already there —
 * so asking for another plan starts a run and talking about this one does not. A retry
 * after a failure resumes as well, which is the same rule reading correctly: one ask, two
 * attempts, one run.
 *
 * A turn that died before a `Session` line gets a run of its own rather than joining a
 * neighbour's, because filing a launch failure under a conversation it was never part of
 * is worse than a run of one.
 *
 * Order is transcript order, which is append-only — so a run's index never moves once it
 * has been given, and a surface can hold one across a refresh.
 */
export const composerRuns = (turns: readonly Turn[]): readonly ComposerRun[] => {
  const runs: { session: string | undefined; turns: Turn[] }[] = []
  for (const turn of turns) {
    if (turn.at !== "composer") continue
    const open = runs.at(-1)
    // An unknown session differs from every other, itself included.
    if (open === undefined || open.session === undefined || open.session !== turn.session)
      runs.push({ session: turn.session, turns: [] })
    runs.at(-1)?.turns.push(turn)
  }
  return runs
}

/**
 * The prose a card below the log draws word for word.
 *
 * **A turn's last words are its return value, so the pane held them twice.** A
 * conversational step ends its turn in prose; the runtime wraps that text in a `message`
 * and the pane draws it at the bottom of the position — but the same text is also a `Text`
 * entry in the transcript. Both are `AgentMessage` now, so what was on screen was the same
 * bubble twice over, reading as an agent that said its piece and then said it again.
 *
 * Which is also why this drops the *entry* rather than the output: the copy at the end is
 * the one still on the table, the one a person is answering, and the one a gate's press
 * sits beside.
 *
 * **Matched by text rather than by position, and that is the conservative direction.** The
 * alternative — "drop the last `Text` of a turn" — needs to know which turn produced which
 * output, and that correspondence is not sound: a turn that failed files nothing, an
 * `elicit` retry puts two `Text` entries in one turn, and only the *last* of a composer
 * run's outputs is drawn at all. Getting it wrong there deletes something no card is
 * showing. Here the worst case is a duplicate that survives, which is where this started.
 *
 * Only `message` carries prose. Every other output is an envelope, so its `Text` entry is
 * the JSON — a different string, which `withoutEnvelopes` is what takes out.
 */
export const spokenBelow = (
  outputs: readonly (StepOutputDto | ComposerOutputDto)[],
): ReadonlySet<string> =>
  new Set(outputs.flatMap((o) => (o.type === "message" ? [o.text.trim()] : [])))

/** A turn's entries, without the words a card below is already showing. */
export const withoutSpoken = (
  entries: readonly TranscriptEntryDto[],
  spoken: ReadonlySet<string>,
): readonly TranscriptEntryDto[] =>
  entries.filter((e) => !(e._tag === "Text" && spoken.has(e.text.trim())))

/**
 * A turn's entries without the two rows something else is already saying.
 *
 * A dropped connection arrives twice: Claude writes its error prose as an assistant
 * message, which becomes a `Text` entry drawn as an agent bubble, and then a `result`
 * line saying `is_error`, which becomes `Note{"ApiError(interrupted: …)"}`. The pane says
 * it once, in words — as a line at the foot of the turn, or as the notice below where the
 * trak is still standing at it — so both go.
 *
 * **Matched by text, which is `withoutSpoken`'s conservative direction and for the same
 * reason.** The alternative — drop the last `Text` of the turn that died — deletes a
 * half-written reply that no card is showing. Here the worst case is a duplicate that
 * survives.
 *
 * `error` is the `reason` off *this turn's own* `TurnFailed`, and the scoping is what that
 * buys: a position interrupted, restarted and interrupted again writes the identical
 * string twice, and a string handed to every section folded both — leaving the earlier
 * attempt reading as a turn that stopped for no reason. `filed.ts` pairs each ending with
 * the turn that earned it, so nothing here has to guess which turn a string belongs to.
 *
 * `undefined` is a turn that ended some other way — it filed, it is still running, or the
 * engine died during it, none of which writes these rows. `TurnSection` carries where the
 * pair comes from.
 */
export const withoutFailure = (
  entries: readonly TranscriptEntryDto[],
  error: string | undefined,
): readonly TranscriptEntryDto[] => {
  if (error === undefined) return entries
  const said = error.trim()
  return entries.filter(
    (e) =>
      !(e._tag === "Text" && e.text.trim() === said) &&
      !(e._tag === "Note" && e.text.startsWith("ApiError(") && e.text.includes(said)),
  )
}
