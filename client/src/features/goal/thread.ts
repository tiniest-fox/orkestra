/**
 * The goal's Chat tab as one thread: the composer's session, with its moves on traks and
 * the goal's own lines laid into it where they happened.
 *
 * **A move is joined to its call by the call's id.** Each tool event on the goal's log
 * carries `call`, the id the CLI gave the `tool_use`, and the transcript's `Tool` entry
 * carries the same id — so the call row is drawn where the composer made it, and opened
 * it shows what the engine recorded for it. A call the engine refused left no event, so it
 * stays an ordinary call in the run around it. A move no transcript line answers — a call
 * the CLI gave no id — is drawn where its log line falls instead.
 *
 * **The goal's lines are placed by their `at`.** A landing, a press or a pause is on the
 * goal's log rather than the session's, so it goes in before the first transcript line
 * stamped after it. A line with no `at` takes the one before it.
 *
 * A drop the composer made is a move, with its call; one a person made by archiving the
 * trak has no call, and is a line.
 */

import type {
  GoalDto,
  GoalEventDto,
  PlannedTrakDto,
  ToolEntryDto,
  TranscriptEntryDto,
} from "../../api/types"

type TrakDroppedDto = Extract<GoalEventDto, { readonly _tag: "TrakDropped" }>

/** The composer's own `drop_trak`: a drop that carries the call that made it. */
export type DropMoveDto = TrakDroppedDto & { readonly call: string }

/** A goal event made by one of the composer's tool calls, drawn as that call's view. */
export type GoalMoveDto =
  | DropMoveDto
  | Extract<
      GoalEventDto,
      {
        readonly _tag:
          | "GoalDrafted"
          | "PlanProposed"
          | "Replanned"
          | "TrakOpened"
          | "SubgoalOpened"
          | "TrakMessaged"
          | "TrakRecomposed"
          | "Escalated"
          | "ActionRequested"
          | "DoneProposed"
      }
    >

/**
 * A move that opens a gate: drawn as the gate's card in place of a call row, so the
 * person answers it where it was asked.
 */
export type GateMoveDto = Extract<
  GoalMoveDto,
  {
    readonly _tag: "GoalDrafted" | "PlanProposed" | "Escalated" | "ActionRequested" | "DoneProposed"
  }
>

/** Every other move, drawn as its call row opening into its view. */
export type CallMoveDto = Exclude<GoalMoveDto, GateMoveDto>

export const isGateMove = (move: GoalMoveDto): move is GateMoveDto =>
  move._tag === "GoalDrafted" ||
  move._tag === "PlanProposed" ||
  move._tag === "Escalated" ||
  move._tag === "ActionRequested" ||
  move._tag === "DoneProposed"

/** A goal event drawn as a line of the thread rather than as a call. */
export type GoalLineDto = Extract<
  GoalEventDto,
  {
    readonly _tag:
      | "GoalStarted"
      | "GoalAsked"
      | "GoalTurnFailed"
      | "GoalTurnStopped"
      | "TrakWoke"
      | "SubgoalWoke"
      | "TrakHandedOff"
      | "GoalActed"
      | "GoalPaused"
      | "GoalResumed"
      | "GoalDropped"
      | "TrakDropped"
  }
>

export type ThreadItem =
  | { readonly _tag: "Work"; readonly entries: readonly TranscriptEntryDto[] }
  | { readonly _tag: "Move"; readonly event: GoalMoveDto; readonly call: ToolEntryDto | undefined }
  | { readonly _tag: "Line"; readonly event: GoalLineDto }

const asMove = (e: GoalEventDto): GoalMoveDto | undefined => {
  switch (e._tag) {
    case "TrakDropped":
      return e.call === undefined ? undefined : { ...e, call: e.call }
    case "GoalDrafted":
    case "PlanProposed":
    case "Replanned":
    case "TrakOpened":
    case "SubgoalOpened":
    case "TrakMessaged":
    case "TrakRecomposed":
    case "Escalated":
    case "ActionRequested":
    case "DoneProposed":
      return e
    case "GoalStarted":
    case "GoalAsked":
    case "GoalDismissed":
    case "GoalTurnEnded":
    case "GoalTurnFailed":
    case "GoalTurnStopped":
    case "TrakWoke":
    case "TrakHandedOff":
    case "GoalActed":
    case "GoalPaused":
    case "GoalResumed":
    case "GoalDropped":
    case "GoalSettingsChanged":
    case "SubgoalWoke":
      return undefined
  }
}

const asLine = (e: GoalEventDto): GoalLineDto | undefined => {
  switch (e._tag) {
    case "TrakDropped":
      return e.call === undefined ? e : undefined
    case "GoalStarted":
    case "GoalAsked":
    case "GoalTurnFailed":
    case "GoalTurnStopped":
    case "TrakWoke":
    case "SubgoalWoke":
    case "TrakHandedOff":
    case "GoalActed":
    case "GoalPaused":
    case "GoalResumed":
    case "GoalDropped":
      return e
    case "GoalSettingsChanged":
    case "GoalDismissed":
    case "GoalDrafted":
    case "GoalTurnEnded":
    case "PlanProposed":
    case "Replanned":
    case "TrakOpened":
    case "TrakMessaged":
    case "TrakRecomposed":
    case "Escalated":
    case "ActionRequested":
    case "DoneProposed":
    case "SubgoalOpened":
      return undefined
  }
}

const callOf = (e: TranscriptEntryDto): string | undefined =>
  e._tag === "Tool" ? e.call : undefined

/** The log's own items — lines, and moves no transcript line joins — each with where it falls. */
interface Placed {
  readonly at: number
  readonly item: ThreadItem
}

const logItems = (log: readonly GoalEventDto[], joined: ReadonlySet<string>): readonly Placed[] => {
  let at = 0
  return log.flatMap((e): readonly Placed[] => {
    at = e.at ?? at
    const move = asMove(e)
    if (move !== undefined)
      return joined.has(move.call)
        ? []
        : [{ at, item: { _tag: "Move", event: move, call: undefined } }]
    const line = asLine(e)
    return line === undefined ? [] : [{ at, item: { _tag: "Line", event: line } }]
  })
}

export const threadOf = (
  log: readonly GoalEventDto[],
  transcript: readonly TranscriptEntryDto[],
): readonly ThreadItem[] => {
  const moves = new Map(
    log.flatMap((e) => {
      const move = asMove(e)
      return move === undefined ? [] : [[move.call, move] as const]
    }),
  )
  const joined = new Set(
    transcript.flatMap((e) => {
      const call = callOf(e)
      return call !== undefined && moves.has(call) ? [call] : []
    }),
  )
  const placed = logItems(log, joined)
  const out: ThreadItem[] = []
  let work: TranscriptEntryDto[] = []
  let next = 0
  const close = (): void => {
    if (work.length > 0) out.push({ _tag: "Work", entries: work })
    work = []
  }
  /** Every log item that happened by `at`, ahead of the line stamped then. */
  const placeBy = (at: number): void => {
    for (let held = placed[next]; held !== undefined && held.at <= at; held = placed[next]) {
      close()
      out.push(held.item)
      next += 1
    }
  }
  for (const entry of transcript) {
    if (entry.at !== undefined) placeBy(entry.at)
    const call = callOf(entry)
    const move = call === undefined ? undefined : moves.get(call)
    if (move === undefined || entry._tag !== "Tool") {
      work.push(entry)
      continue
    }
    close()
    out.push({ _tag: "Move", event: move, call: entry })
  }
  close()
  return [...out, ...placed.slice(next).map((p) => p.item)]
}

/** The tool a move came from, as the composer called it — what a row names when it has no call. */
export const toolOf = (move: GoalMoveDto): string => {
  switch (move._tag) {
    case "GoalDrafted":
      return "draft_goal"
    case "TrakDropped":
      return "drop_trak"
    case "PlanProposed":
      return "propose_plan"
    case "Replanned":
      return "replan"
    case "TrakOpened":
      return "open_trak"
    case "SubgoalOpened":
      return "open_subgoal"
    case "TrakMessaged":
      return "message_trak"
    case "TrakRecomposed":
      return "recompose_trak"
    case "Escalated":
      return "escalate"
    case "ActionRequested":
      return "request_action"
    case "DoneProposed":
      return "propose_done"
  }
}

export interface PlanChange {
  readonly added: readonly PlannedTrakDto[]
  readonly dropped: readonly PlannedTrakDto[]
}

/**
 * What a replan added to the plan and took off it, by title, against the plan that stood
 * before it — the last proposal or replan earlier in the log.
 */
export const planChange = (
  log: readonly GoalEventDto[],
  replan: Extract<GoalEventDto, { readonly _tag: "Replanned" }>,
): PlanChange => {
  const at = log.indexOf(replan)
  const before = log
    .slice(0, at === -1 ? log.length : at)
    .findLast((e) => e._tag === "PlanProposed" || e._tag === "Replanned")
  const old = before?._tag === "PlanProposed" || before?._tag === "Replanned" ? before.traks : []
  const had = new Set(old.map((t) => t.title))
  const has = new Set(replan.traks.map((t) => t.title))
  return {
    added: replan.traks.filter((t) => !had.has(t.title)),
    dropped: old.filter((t) => !has.has(t.title)),
  }
}

const GATE_MOVE = {
  file: "GoalDrafted",
  plan: "PlanProposed",
  escalation: "Escalated",
  action: "ActionRequested",
  done: "DoneProposed",
} as const

/**
 * Whether this move is what the goal stands at a gate over now: the newest proposal at
 * the plan gate, the newest escalation at the escalation gate, the newest request at the
 * action gate, the newest proposed done at the done gate. Only its card carries the gate's
 * presses; every earlier one is a record.
 */
export const asksNow = (
  goal: Pick<GoalDto, "state">,
  log: readonly GoalEventDto[],
  move: GateMoveDto,
): boolean => {
  if (goal.state._tag !== "AtGate") return false
  const tag = GATE_MOVE[goal.state.gate]
  return move._tag === tag && log.findLast((e) => e._tag === tag) === move
}

/** What a `drop_trak` did to the plan: its length before and after, and traks landed by then. */
export interface DropCount {
  readonly before: number
  readonly after: number
  readonly landed: number
}

/**
 * Read off the log as it stood at the drop: the plan then in force, the dropped trak's
 * title taken off it as the engine takes it, and the landings already filed.
 */
export const dropCount = (
  log: readonly GoalEventDto[],
  drop: DropMoveDto,
  title: string | undefined,
): DropCount => {
  const at = log.findIndex((e) => e._tag === "TrakDropped" && e.call === drop.call)
  const earlier = log.slice(0, at === -1 ? log.length : at)
  const from = earlier.findLastIndex((e) => e._tag === "PlanProposed" || e._tag === "Replanned")
  const plan = earlier[from]
  const proposed = plan?._tag === "PlanProposed" || plan?._tag === "Replanned" ? plan.traks : []
  // The composer's drops since that plan took their traks off it, as this one does.
  const titles = new Map(
    log.flatMap((e) => (e._tag === "TrakOpened" ? [[e.trak, e.title] as const] : [])),
  )
  const gone = new Set(
    earlier
      .slice(from + 1)
      .flatMap((e) =>
        e._tag === "TrakDropped" && e.call !== undefined ? [titles.get(e.trak) ?? ""] : [],
      ),
  )
  const traks = proposed.filter((t) => !gone.has(t.title))
  return {
    before: traks.length,
    after: traks.filter((t) => t.title !== title).length,
    landed: earlier.filter((e) => e._tag === "TrakWoke" && e.kind === "landed").length,
  }
}
