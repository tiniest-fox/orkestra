// Goals, as the daemon runs them: the tool calls a composer's session makes, the watcher
// that wakes it, and the routes a person starts, answers, pauses and drops one through. The
// composer's turns themselves are `goal-drives.ts`.
//
// **Nothing here drives a trak by itself.** A goal reaches its traks through the same
// doors a person's presses do — `openTrak`, `holdMessage`, `startDrive`, `takeOverDrive`
// and `appendSetting` in `drive.ts` — so a trak the composer opened is an ordinary trak
// from its first event, and its gates are its person's.
//
// **One permit per goal orders every write to its log** (`Locks.withGoal`): a tool call,
// a press and the watcher each read the goal, check, and append under it. A composer turn
// takes no permit while it runs — its tool calls append beside it — and appends its own
// ending under the permit when it is over.

import { randomUUID } from "node:crypto"
import { Clock, Effect, Either, Option, type ParseResult, Schema, Stream } from "effect"
import { absurd } from "effect/Function"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerRequest from "@effect/platform/HttpServerRequest"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import { CreatedDto } from "@orkestra/shared/dto/actions"
import {
  AtRestDto,
  DrivingDto,
  GoalBranchRefusedDto,
  SubgoalConflictedDto,
  NotAtRestDto,
  NotParkedDto,
  NotOwnerDto,
  NothingToStopDto,
  type RefusalDto,
  SubgoalsLiveDto,
  AttachmentRefusedDto,
} from "@orkestra/shared/dto/common"
import {
  DropGoalRequestDto,
  GoalActionDto,
  GoalSettingsDto,
  type GoalDetailDto,
  type GoalListDto,
  McpToolCallDto,
  type McpToolListDto,
  type McpToolResultDto,
  StartGoalRequestDto,
} from "@orkestra/shared/dto/goals"
import { refusalReason } from "../agent/logic/refusal.js"
import { goalDraftRefusal } from "../library/logic/goal-file.js"
import type { GoalFile } from "../library/types/goal.js"
import { Lib } from "../library/ports/library.js"
import { Sandboxes } from "../vcs/ports/sandboxes.js"
import type { Attachment } from "../workflow/domain/attachment.js"
import { render, type TemplateName } from "../prompts/index.js"
import { Prompts } from "../prompts/ports/prompts.js"
import { BranchName, MergeInto } from "../vcs/index.js"
import { Forge } from "../vcs/ports/forge.js"
import { Vcs } from "../vcs/ports/vcs.js"
import { Events } from "../workflow/domain/event.js"
import {
  approvedDraft,
  type Goal,
  goalAtRest,
  type GoalBudget,
  type GoalEvent,
  GoalEvents,
  goalChatWith,
  goalHandOffs,
  goalName,
  goalOwed,
  goalOffers,
  type GoalLimits,
  type GoalSpec,
  liveSubgoals,
  liveTraks,
  outcomeOf,
  outcomeSince,
  PlannedSubgoal,
  PlannedTrak,
  proposalCall,
  sharedBudget,
  subgoalBranch,
  subgoalSpec,
} from "../workflow/domain/goal.js"
import { Actions } from "../workflow/domain/human-action.js"
import { Question } from "../workflow/domain/outputs/question.js"
import { replayHistory } from "../workflow/domain/replay.js"
import { atRest, GoalId, type TrakId, type Trak, type TrakState } from "../workflow/domain/trak.js"
import { Feed, type Framed } from "../workflow/ports/feed.js"
import { GoalStore } from "../workflow/ports/goal-store.js"
import { heldJob, Locks } from "../workflow/ports/locks.js"
import { Runs } from "../workflow/ports/runs.js"
import { Store } from "../workflow/ports/store.js"
import {
  type AppendFailed,
  readAgainOnConflict,
  type StoreFailed,
  type StoreUndecodable,
} from "../workflow/ports/store-errors.js"
import {
  abandonChildren,
  appendSetting,
  holdMessage,
  noteGoalOpened,
  openTrak,
  reenterDrive,
  startDrive,
  steeredMessage,
  takeOverDrive,
  workdir,
} from "./drive.js"
import { placeUploads } from "./attachments.js"
import { pressedBy } from "./guard.js"
import { GoalDrives, goalOf } from "./goal-drives.js"
import { goalReadToolNames, READ_TOOLS, readCall, type ReadTool } from "./read-tools.js"
import { hidingAnswers, inputSchemaOf, refused } from "./tool-answer.js"
import { toGoalDto, toGoalLogDto, toSummaryDto, toTranscriptEntryDto } from "./dto.js"
import { hiddenUnseen, levelsHere, ownershipHere, refusedPress } from "./people.js"

const refuse = (status: number, refusal: RefusalDto) =>
  ServerResponse.json(refusal, { status, statusText: refusal._tag })

/** The `403 NotOwner` for a press that would start a composer turn on `goal`, or `undefined`. */
const goalOwnerOnly = (goal: Goal) =>
  Effect.flatMap(refusedPress(goal.owner, "goal"), (reason) =>
    reason === undefined ? Effect.succeed(undefined) : refuse(403, NotOwnerDto.make({ reason })),
  )

// ============================================================================
// Tool calls — every move the composer makes
// ============================================================================

/**
 * Each tool's arguments. The name is the tool's, as the composer calls it; its description
 * is the template `goal/tool-<name>`, so the words live where every other prompt does.
 */
const TOOLS = {
  draft_goal: Schema.Struct({
    name: Schema.NonEmptyTrimmedString,
    title: Schema.NonEmptyTrimmedString,
    line: Schema.NonEmptyTrimmedString,
    finished: Schema.NonEmptyTrimmedString,
    parallel: Schema.optional(Schema.Int.pipe(Schema.positive())),
    traks_per_hour: Schema.optional(Schema.Int.pipe(Schema.positive())),
    traks_per_day: Schema.optional(Schema.Int.pipe(Schema.positive())),
    branch: Schema.optional(Schema.NonEmptyTrimmedString),
  }),
  open_trak: Schema.extend(
    PlannedTrak,
    Schema.Struct({ auto_merge: Schema.optional(Schema.Boolean) }),
  ),
  open_subgoal: Schema.Struct({ title: Schema.NonEmptyTrimmedString }),
  message_trak: Schema.Struct({ trak: Schema.String, message: Schema.NonEmptyTrimmedString }),
  recompose_trak: Schema.Struct({ trak: Schema.String, why: Schema.NonEmptyTrimmedString }),
  drop_trak: Schema.Struct({ trak: Schema.String, reason: Schema.NonEmptyTrimmedString }),
  message_subgoal: Schema.Struct({
    subgoal: Schema.String,
    message: Schema.NonEmptyTrimmedString,
  }),
  drop_subgoal: Schema.Struct({ subgoal: Schema.String, reason: Schema.NonEmptyTrimmedString }),
  replan: Schema.Struct({
    traks: Schema.Array(PlannedTrak),
    subgoals: Schema.optional(Schema.Array(PlannedSubgoal)),
    why: Schema.NonEmptyTrimmedString,
  }),
  escalate: Schema.Struct({
    trak: Schema.optional(Schema.String),
    questions: Schema.NonEmptyArray(Question),
  }),
  request_action: Schema.Struct({
    trak: Schema.optional(Schema.String),
    title: Schema.NonEmptyTrimmedString,
    steps: Schema.NonEmptyArray(Schema.NonEmptyTrimmedString),
    why: Schema.NonEmptyTrimmedString,
  }),
  merge_default_branch: Schema.Struct({}),
  propose_done: Schema.Struct({ summary: Schema.NonEmptyTrimmedString }),
} as const

type ToolName = keyof typeof TOOLS

const isTool = (name: string): name is ToolName => Object.hasOwn(TOOLS, name)

const toolNames = (): readonly ToolName[] => Object.keys(TOOLS).filter(isTool)

const descriptionOf = (name: ToolName): TemplateName => `goal/tool-${name}`

/** What a call answers: one outcome key of `goal/tool-result`, and whether it was refused. */
interface Outcome {
  readonly said: Readonly<Record<string, unknown>>
  readonly refused: boolean
}

const refusedFor = (said: Readonly<Record<string, unknown>>): Outcome => ({ said, refused: true })
const did = (said: Readonly<Record<string, unknown>>): Outcome => ({ said, refused: false })

const HOUR = 3_600_000

/**
 * The goals that share one budget, read now: a top goal and every sub-goal it opened.
 * `budget` is what this goal opens under — its own limits tightened by its parent's — and
 * is what its modes and auto-merge are judged by. The counted limits are two: the top
 * goal's, measured against every trak in the family, and a sub-goal's own, measured against
 * its own traks alone, so a parent's traks never use up a sub-goal's tighter number.
 */
interface Family {
  readonly budget: GoalBudget
  readonly members: readonly Goal[]
  readonly shared: GoalLimits
  readonly own: GoalLimits | undefined
}

const familyOf = (goal: Goal) =>
  Effect.gen(function* () {
    const store = yield* GoalStore
    const parent = goal.parent === undefined ? undefined : yield* goalOf(store, goal.parent.goal)
    const top = parent ?? goal
    const subs = yield* Effect.forEach(
      top.subgoals.filter((s) => s.id !== goal.id),
      (s) => goalOf(store, s.id),
    )
    const members = [top, ...(top === goal ? [] : [goal]), ...subs.filter((g) => g !== undefined)]
    const family: Family = {
      budget: sharedBudget(goal.spec?.limits ?? {}, parent?.spec?.limits),
      members,
      shared: top.spec?.limits ?? {},
      own: parent === undefined ? undefined : (goal.spec?.limits ?? {}),
    }
    return family
  })

const allowedOf = (modes: readonly string[]) => (modes.length === 0 ? "none" : modes.join(", "))

/** Which of `limits`' counts the traks of `goals` already reach, and the limit reached. */
const countBroken = (
  limits: GoalLimits,
  goals: readonly Goal[],
  now: number,
):
  | { readonly parallel: number }
  | { readonly perHour: number }
  | { readonly perDay: number }
  | undefined => {
  const live = goals.reduce((n, g) => n + liveTraks(g).length, 0)
  if (limits.parallel !== undefined && live >= limits.parallel) return { parallel: limits.parallel }
  const opened = goals.flatMap((g) => g.traks)
  const openedSince = (ago: number) =>
    opened.filter((t) => t.openedAt !== undefined && t.openedAt > now - ago).length
  if (limits.perHour !== undefined && openedSince(HOUR) >= limits.perHour) {
    return { perHour: limits.perHour }
  }
  if (limits.perDay !== undefined && openedSince(24 * HOUR) >= limits.perDay) {
    return { perDay: limits.perDay }
  }
  return undefined
}

/**
 * Why opening one more trak would break a limit, or `undefined` where none: the shared
 * limits over the whole family's traks, then a sub-goal's own over its own traks — a
 * refusal of the second says so, since it counted fewer traks than the first would.
 */
const limitBroken = (
  goal: Goal,
  family: Family,
  mode: string,
  now: number,
): Outcome | undefined => {
  const { budget, members, shared, own } = family
  if (goal.paused) return refusedFor({ paused: true })
  if (budget.modes !== undefined && !budget.modes.some((m) => m === mode)) {
    return refusedFor({ mode, allowed: allowedOf(budget.modes) })
  }
  const all = countBroken(shared, members, now)
  if (all !== undefined) return refusedFor({ ...all, family: own !== undefined })
  const mine = own === undefined ? undefined : countBroken(own, [goal], now)
  return mine === undefined ? undefined : refusedFor({ ...mine, own: true })
}

/** A planned trak on a mode the goal does not allow — refused whole rather than trimmed. */
const modesBroken = (budget: GoalBudget, planned: readonly PlannedTrak[]): Outcome | undefined => {
  const allowed = budget.modes
  const wrong = planned.find((p) => allowed !== undefined && !allowed.includes(p.mode))
  return wrong === undefined || allowed === undefined
    ? undefined
    : refusedFor({ mode: wrong.mode, allowed: allowedOf(allowed) })
}

/**
 * What a replan cannot hold: a sub-goal on a goal that is itself one, or a trak on a mode
 * the goal does not allow.
 */
const planBroken = (
  goal: Goal,
  traks: readonly PlannedTrak[],
  subgoals: readonly PlannedSubgoal[],
) =>
  Effect.map(familyOf(goal), ({ budget }): Outcome | undefined => {
    if (goal.parent !== undefined && subgoals.length > 0) return refusedFor({ nested: true })
    return modesBroken(budget, traks)
  })

/**
 * The trak a call names, read from its own log — or the refusal, where it is not one of
 * the goal's running traks. A landed or dropped one is not the composer's to touch again.
 *
 * `Finished` is at rest but has not landed: its pull request can still be open, and a
 * conflict with the base is exactly what the composer has to tell it about.
 */
const goalTrak = (goal: Goal, named: string) =>
  Effect.gen(function* () {
    const known = liveTraks(goal).find((t) => t.id === named)
    if (known === undefined) return Either.left(refusedFor({ notYours: named }))
    const trak = replayHistory(known.id, yield* (yield* Store).events(known.id))
    if (atRest(trak.state) && trak.state._tag !== "Finished") {
      return Either.left(refusedFor({ notYours: named }))
    }
    return Either.right(trak)
  })

/**
 * The gates a trak's person answers and the composer does not: a plan, an artifact to
 * approve, questions, and a conversation. A goal's moves reach a trak that has stopped
 * stuck or on a failing check, and one that is running.
 */
const persons = (state: TrakState): boolean =>
  state._tag === "AwaitingProposal" ||
  state._tag === "AwaitingComposerAnswers" ||
  (state._tag === "AwaitingHuman" && state.kind !== "stuck" && state.kind !== "checks")

/**
 * Send a message: kept and read by the turn running, or sent at the gate it waits at. A
 * finished trak is sent back with it, as a person's Send it back does — a held message
 * there has no turn to read it — and refused where its merged pull request leaves a branch
 * that cannot be moved (`Drives.reenter`). Where something already drives the trak, that drive's
 * turn is the one to read it, so it is held instead.
 */
const messageTrak = (trak: Trak, message: string) =>
  Effect.gen(function* () {
    if (persons(trak.state)) return refusedFor({ persons: trak.id })
    if (trak.state._tag === "Finished") {
      const sent = yield* reenterDrive(trak.id, (moved) =>
        Events.reentered(message, undefined, undefined, moved),
      )
      if (sent !== "busy" && Either.isRight(sent)) return did({ messaged: trak.id })
      if (sent !== "busy" && sent.left._tag === "BranchNotMoved") {
        return refusedFor({ notMoved: { trak: trak.id, why: sent.left.why } })
      }
    }
    yield* holdMessage(trak.id, message, undefined, workdir(trak))
    // A failed trak is resumed with the message waiting, which its next turn is handed.
    if (trak.state._tag === "Failed") {
      yield* startDrive(trak.id, (resuming) => Events.restarted(resuming?.sessionId))
    }
    return did({ messaged: trak.id })
  })

const recomposeTrak = (trak: Trak, why: string) =>
  Effect.gen(function* () {
    const state = trak.state
    if (persons(state)) return refusedFor({ persons: trak.id })
    if (state._tag !== "AwaitingHuman") return refusedFor({ notStopped: trak.id })
    yield* startDrive(trak.id, () => Events.humanActed(state.step, Actions.replan(why)))
    return did({ recomposed: trak.id })
  })

/** Archive it the way a person's press does: closed where it finished, abandoned otherwise. */
const dropTrak = (trak: Trak, reason: string) =>
  Effect.gen(function* () {
    if (trak.state._tag === "Finished") {
      yield* startDrive(trak.id, () => Events.closed())
      return did({ dropped: trak.id })
    }
    const turn = yield* (yield* Runs).inFlight(trak.id)
    yield* takeOverDrive(trak.id, () =>
      Events.abandoned(reason, turn?.sessionId, turn?.step, turn?.usage),
    )
    yield* abandonChildren(trak, reason)
    return did({ dropped: trak.id })
  })

/**
 * The sub-goal a call names, read under its own permit — taken while the parent's is held,
 * the one order the two are taken in — then the move made on it. Refused on a goal that is
 * itself a sub-goal, for one this goal did not open, and for one done or dropped: by the
 * parent's log, or by the sub-goal's own where the parent has not filed its end yet.
 */
const withSubgoal = <E, R>(
  goal: Goal,
  named: string,
  move: (sub: Goal) => Effect.Effect<Outcome, E, R>,
) =>
  Effect.gen(function* () {
    if (goal.parent !== undefined) return refusedFor({ noSubgoals: true })
    const known = goal.subgoals.find((s) => s.id === named)
    if (known === undefined) return refusedFor({ notYourSubgoal: named })
    if (known.status !== "live") return refusedFor({ subgoalOver: named })
    const goals = yield* GoalStore
    return yield* (yield* Locks).withGoal(known.id)(
      Effect.flatMap(goalOf(goals, known.id), (sub) =>
        sub === undefined || goalAtRest(sub.state)
          ? Effect.succeed(refusedFor({ subgoalOver: named }))
          : move(sub),
      ),
    )
  })

/**
 * Wake a sub-goal's composer with a message, by a person's Chat's two doors: held for the
 * turn running, or a chat that owes it a turn. Its gates are its person's, so one standing
 * at a gate is refused, as `message_trak` refuses a trak's. Its composer is told who wrote.
 */
const messageSubgoal = (parent: Goal, sub: Goal, message: string) =>
  Effect.gen(function* () {
    if (sub.state._tag === "AtGate") return refusedFor({ subgoalPersons: sub.id })
    const text = render(yield* Prompts, "goal/subgoal-message", {
      parent: goalName(parent),
      message,
    })
    if (sub.state._tag === "Composing") {
      yield* holdGoalMessage(sub, text)
      return did({ messaged: sub.id })
    }
    // Watching or failed, both of which take a Chat — what a stuck sub-goal is retried by.
    const chat = GoalEvents.acted(goalChatWith(sub, text))
    yield* (yield* GoalStore).append(sub.id, [chat], { after: sub.logged })
    yield* (yield* GoalDrives).kick(sub.id)
    return did({ messaged: sub.id })
  })

const badArguments = (e: ParseResult.ParseError): Outcome =>
  refusedFor({ badArguments: refusalReason(e) })

/** Decode a tool's arguments, then make the move — the refusal where they do not fit. */
const withArgs = <A, I, B, E, R>(
  schema: Schema.Schema<A, I>,
  args: unknown,
  move: (a: A) => Effect.Effect<B, E, R>,
): Effect.Effect<B | Outcome, E, R> =>
  Either.match(Schema.decodeUnknownEither(schema)(args), {
    onLeft: (e) => Effect.succeed(badArguments(e)),
    onRight: move,
  })

/** The trak a call names, then the move made on it — or the refusal where it is not the goal's. */
const withTrak = <B, E, R>(
  goal: Goal,
  named: string,
  move: (trak: Trak) => Effect.Effect<B, E, R>,
): Effect.Effect<B | Outcome, E | StoreFailed | StoreUndecodable, R | Store> =>
  Effect.flatMap(
    goalTrak(goal, named),
    (found): Effect.Effect<B | Outcome, E, R> =>
      Either.isLeft(found) ? Effect.succeed(found.left) : move(found.right),
  )

/**
 * The composer's draft as the goal will hold it. The run modes are the person's, chosen
 * at the start — written only where they leave one out, since a file naming all three
 * says no more than one naming none.
 */
const draftOf = (goal: Goal, a: typeof TOOLS.draft_goal.Type): GoalSpec => {
  const modes = goal.askedModes
  return {
    file: a.name,
    title: a.title,
    line: a.line,
    finished: a.finished,
    limits: {
      ...(a.parallel === undefined ? {} : { parallel: a.parallel }),
      ...(a.traks_per_hour === undefined ? {} : { perHour: a.traks_per_hour }),
      ...(a.traks_per_day === undefined ? {} : { perDay: a.traks_per_day }),
      ...(modes === undefined || modes.length === 3 ? {} : { modes }),
    },
    ...(a.branch === undefined ? {} : { branch: a.branch }),
  }
}

/** A drafted goal's spec as the library writes and checks a file. A draft always names one. */
const fileOf = (spec: GoalSpec): GoalFile => {
  const { parallel, perHour, perDay, modes, autoMerge } = spec.limits
  return {
    name: spec.file ?? "",
    title: spec.title,
    line: spec.line,
    finished: spec.finished,
    limits: {
      ...(parallel === undefined ? {} : { parallel }),
      ...(perHour === undefined ? {} : { perHour }),
      ...(perDay === undefined ? {} : { perDay }),
      ...(modes === undefined ? {} : { modes }),
      ...(autoMerge === undefined ? {} : { autoMerge }),
    },
    ...(spec.branch === undefined ? {} : { branch: spec.branch }),
  }
}

/** The goal's branch, where its file names one — what its traks are cut from and land on. */
const goalBranchOf = (goal: Goal): BranchName | undefined =>
  goal.spec?.branch === undefined ? undefined : BranchName.make(goal.spec.branch)

/** The appending half of a move: its event on the goal's log, and what the call answers. */
const recorded = (goal: Goal, event: GoalEvent, outcome: Outcome) =>
  Effect.as(
    Effect.flatMap(GoalStore, (goals) => goals.append(goal.id, [event], { after: goal.logged })),
    outcome,
  )

/**
 * The sub-goal this goal's composer already opened with this call, where it did: a retried
 * `open_subgoal` answers with that one rather than opening a second. `goalOpenedBy`'s read.
 */
const subgoalOpenedBy = (parent: GoalId, call: string) =>
  Effect.gen(function* () {
    const store = yield* GoalStore
    for (const id of yield* store.list()) {
      const goal = yield* goalOf(store, id).pipe(
        Effect.catchTag("StoreUndecodable", () => Effect.succeed(undefined)),
      )
      if (goal?.parent?.goal === parent && goal.parent.call === call) return goal
    }
    return undefined
  })

/**
 * Whether another goal in the store already holds `name`, in its spec or its waiting
 * draft — what a draft is refused a name for. The drafting goal itself is left out, so a
 * redraft keeps its name. One goal whose log will not decode is that goal's problem.
 */
const goalNameTaken = (drafting: GoalId, name: string) =>
  Effect.gen(function* () {
    const store = yield* GoalStore
    for (const id of yield* store.list()) {
      if (id === drafting) continue
      const goal = yield* goalOf(store, id).pipe(
        Effect.catchTag("StoreUndecodable", () => Effect.succeed(undefined)),
      )
      if (goal?.spec?.file === name || goal?.draft?.file === name) return true
    }
    return false
  })

/**
 * Open a planned sub-goal: a log of its own, opening with the spec its entry in the plan
 * carried, and its first composer turn kicked — which opens its first traks, and never
 * stops at a file gate. Where this goal has a goal branch, the
 * sub-goal's is made on `origin` from it first, and a refusal there opens nothing.
 */
const openSubgoal = (goal: Goal, call: string, title: string) =>
  Effect.gen(function* () {
    if (goal.parent !== undefined) return refusedFor({ nested: true })
    if (goal.paused) return refusedFor({ paused: true })
    const drives = yield* GoalDrives
    const already = yield* subgoalOpenedBy(goal.id, call)
    if (already !== undefined) {
      yield* drives.kick(already.id)
      const answer = did({ subgoalOpened: already.id })
      if (goal.subgoals.some((s) => s.id === already.id)) return answer
      const opened = GoalEvents.subgoalOpened(call, already.id, goalName(already))
      return yield* recorded(goal, opened, answer)
    }
    const planned = goal.subgoalPlan.find((p) => p.title === title)
    if (planned === undefined) return refusedFor({ notPlanned: title })
    if (goal.subgoals.some((s) => s.title === title && s.status !== "dropped")) {
      return refusedFor({ subgoalTaken: title })
    }
    const parentBranch = goal.spec?.branch
    const started = yield* appendStarted("subgoal", (id) => {
      const branch = parentBranch === undefined ? undefined : subgoalBranch(parentBranch, id)
      const opener = { parent: goal.id, call }
      const first = GoalEvents.started(subgoalSpec(planned, branch), goal.owner, opener)
      return Effect.map(goalBranchMade(branch, parentBranch), (branchRefused) =>
        branchRefused === undefined ? Either.right(first) : Either.left(branchRefused.reason),
      )
    })
    if (Either.isLeft(started)) return refusedFor({ branchRefused: started.left })
    const opened = GoalEvents.subgoalOpened(call, started.right, planned.title)
    const answer = yield* recorded(goal, opened, did({ subgoalOpened: started.right }))
    yield* drives.kick(started.right)
    return answer
  })

/**
 * The goal's sub-goals still going, named for a refusal — or `undefined` where there are
 * none. A goal is not done while one of its sub-goals may still land on its branch: done
 * is the one way to rest that does not reach them, as pause and drop do.
 */
const subgoalsLive = (goal: Goal): string | undefined => {
  const live = liveSubgoals(goal)
  return live.length === 0 ? undefined : live.map((s) => `${s.title} (\`${s.id}\`)`).join(", ")
}

/**
 * `origin`'s default branch merged into the goal branch, in the engine's checkout of it,
 * and pushed — no trak, and no event: the answer in the composer's transcript and the
 * merge commit on `origin` are the record. A conflict changes nothing, since `merge`
 * aborts it before anything is pushed, and is answered with the paths and the default
 * branch's commit for the trak the composer opens to resolve it. One way only: the goal
 * branch reaches the default branch through the pull request Confirm done opens.
 *
 * A sub-goal is refused: its base is its parent's goal branch, not the default branch.
 */
const mergeDefaultBranch = (goal: Goal) =>
  Effect.gen(function* () {
    const branch = goalBranchOf(goal)
    if (branch === undefined) return refusedFor({ noGoalBranch: true })
    if (goal.parent !== undefined) return refusedFor({ subgoalBranch: true })
    if (goal.paused) return refusedFor({ paused: true })
    const vcs = yield* Vcs
    const merged = yield* Effect.either(
      Effect.gen(function* () {
        const base = yield* vcs.defaultBranch()
        if (base === undefined) return undefined
        yield* vcs.fetch()
        const tip = yield* vcs.originTip(base)
        const theirs = BranchName.make(`origin/${base}`)
        const into = MergeInto.Goal({ goal: goal.id, branch })
        if (yield* vcs.contains(into, theirs)) return { base, tip, outcome: undefined }
        const outcome = yield* vcs.merge(into, theirs, `Merge ${base} into ${branch}`)
        // `merge` pushes a merge that went in, and leaves a refused push for the next
        // one; pushing again here is what tells the composer the push failed.
        if (outcome._tag === "Merged") yield* vcs.pushGoal(goal.id, branch)
        return { base, tip, outcome }
      }),
    )
    if (Either.isLeft(merged)) {
      return refusedFor({ mergeFailed: { branch, reason: merged.left.reason } })
    }
    if (merged.right === undefined) return refusedFor({ noDefaultBranch: true })
    const { base, tip, outcome } = merged.right
    if (outcome === undefined) return did({ upToDate: { base, branch } })
    return outcome._tag === "Merged"
      ? did({ mergedDefault: { base, branch } })
      : did({
          mergeConflicted: {
            base,
            branch,
            commit: tip ?? `origin/${base}`,
            paths: outcome.paths.map((path) => `\`${path}\``).join(", "),
          },
        })
  })

/**
 * One handler per tool. Each decodes its own arguments, checks what the goal allows, makes
 * the move, and appends the event that records it under the call's id.
 */
const HANDLERS = {
  draft_goal: (goal: Goal, call: string, args: unknown) =>
    withArgs(TOOLS.draft_goal, args, (a) =>
      Effect.gen(function* () {
        const draft = draftOf(goal, a)
        const refusal = goalDraftRefusal(fileOf(draft))
        if (refusal !== undefined) return refusedFor({ badFile: refusal })
        if (yield* goalNameTaken(goal.id, a.name)) return refusedFor({ taken: a.name })
        return yield* recorded(goal, GoalEvents.drafted(call, draft), did({ drafted: true }))
      }),
    ),
  open_trak: (goal: Goal, call: string, args: unknown) =>
    withArgs(TOOLS.open_trak, args, (a) =>
      Effect.gen(function* () {
        const family = yield* familyOf(goal)
        const broken = limitBroken(goal, family, a.mode, yield* Clock.currentTimeMillis)
        if (broken !== undefined) return broken
        const setting = family.budget.autoMerge
        const autoMerge = setting === "always" || a.auto_merge === true
        if (autoMerge && setting === "never") {
          return refusedFor({ autoMergeRefused: true })
        }
        const opening = yield* openTrak(
          a.description,
          a.mode,
          goal.id,
          autoMerge,
          goalBranchOf(goal),
          goal.owner,
        )
        if (opening._tag === "Busy") return refusedFor({ busy: true })
        return yield* recorded(
          goal,
          GoalEvents.trakOpened(call, opening.id, a.title, a.mode),
          did({ opened: opening.id }),
        )
      }),
    ),
  open_subgoal: (goal: Goal, call: string, args: unknown) =>
    withArgs(TOOLS.open_subgoal, args, (a) => openSubgoal(goal, call, a.title)),
  message_trak: (goal: Goal, call: string, args: unknown) =>
    withArgs(TOOLS.message_trak, args, (a) =>
      withTrak(goal, a.trak, (trak) =>
        Effect.flatMap(messageTrak(trak, a.message), (outcome) =>
          outcome.refused
            ? Effect.succeed(outcome)
            : recorded(goal, GoalEvents.trakMessaged(call, trak.id, a.message), outcome),
        ),
      ),
    ),
  recompose_trak: (goal: Goal, call: string, args: unknown) =>
    withArgs(TOOLS.recompose_trak, args, (a) =>
      withTrak(goal, a.trak, (trak) =>
        Effect.flatMap(recomposeTrak(trak, a.why), (outcome) =>
          outcome.refused
            ? Effect.succeed(outcome)
            : recorded(goal, GoalEvents.trakRecomposed(call, trak.id, a.why), outcome),
        ),
      ),
    ),
  drop_trak: (goal: Goal, call: string, args: unknown) =>
    withArgs(TOOLS.drop_trak, args, (a) =>
      withTrak(goal, a.trak, (trak) =>
        // Recorded before the archive runs, so the watcher seeing the trak end finds it
        // already dropped and reads nothing into it.
        Effect.andThen(
          recorded(goal, GoalEvents.trakDropped(call, trak.id, a.reason), did({})),
          dropTrak(trak, a.reason),
        ),
      ),
    ),
  message_subgoal: (goal: Goal, call: string, args: unknown) =>
    withArgs(TOOLS.message_subgoal, args, (a) =>
      withSubgoal(goal, a.subgoal, (sub) =>
        Effect.flatMap(messageSubgoal(goal, sub, a.message), (outcome) =>
          outcome.refused
            ? Effect.succeed(outcome)
            : recorded(goal, GoalEvents.subgoalMessaged(call, sub.id, a.message), outcome),
        ),
      ),
    ),
  drop_subgoal: (goal: Goal, call: string, args: unknown) =>
    withArgs(TOOLS.drop_subgoal, args, (a) =>
      withSubgoal(goal, a.subgoal, (sub) =>
        // Recorded before the drop, as `drop_trak` is, so the sub-goal settling as dropped
        // finds it no longer live and wakes nobody: the drop is this composer's own news.
        Effect.as(
          Effect.andThen(
            recorded(goal, GoalEvents.subgoalDropped(call, sub.id, a.reason), did({})),
            dropGoal(sub, a.reason),
          ),
          did({ dropped: sub.id }),
        ),
      ),
    ),
  replan: (goal: Goal, call: string, args: unknown) =>
    withArgs(TOOLS.replan, args, (a) =>
      Effect.gen(function* () {
        const subgoals = a.subgoals ?? []
        const broken = yield* planBroken(goal, a.traks, subgoals)
        if (broken !== undefined) return broken
        const replanned = GoalEvents.replanned(call, a.traks, a.why, subgoals)
        return yield* recorded(goal, replanned, did({ replanned: true }))
      }),
    ),
  escalate: (goal: Goal, call: string, args: unknown) =>
    withArgs(TOOLS.escalate, args, (a) => {
      // Any trak the goal opened, landed or dropped included — a question can be about
      // one that is over — and never one it did not.
      const about = goal.traks.find((t) => t.id === a.trak)
      return a.trak !== undefined && about === undefined
        ? Effect.succeed(refusedFor({ notOpened: a.trak }))
        : recorded(
            goal,
            GoalEvents.escalated(call, about?.id, a.questions),
            did({ escalated: true }),
          )
    }),
  request_action: (goal: Goal, call: string, args: unknown) =>
    withArgs(TOOLS.request_action, args, (a) => {
      // Any trak the goal opened, as `escalate` takes one, and never one it did not.
      const about = goal.traks.find((t) => t.id === a.trak)
      return a.trak !== undefined && about === undefined
        ? Effect.succeed(refusedFor({ notOpened: a.trak }))
        : recorded(
            goal,
            GoalEvents.actionRequested(call, {
              trak: about?.id,
              title: a.title,
              steps: a.steps,
              why: a.why,
            }),
            did({ actionRequested: true }),
          )
    }),
  merge_default_branch: (goal: Goal, _call: string, args: unknown) =>
    withArgs(TOOLS.merge_default_branch, args, () => mergeDefaultBranch(goal)),
  propose_done: (goal: Goal, call: string, args: unknown) =>
    withArgs(TOOLS.propose_done, args, (a) => {
      const live = subgoalsLive(goal)
      return live !== undefined
        ? Effect.succeed(refusedFor({ subgoalsLive: live }))
        : recorded(goal, GoalEvents.doneProposed(call, a.summary), did({ doneProposed: true }))
    }),
} satisfies Record<ToolName, unknown>

const DRAFTING_TOOLS: ReadonlySet<ToolName> = new Set(["draft_goal", "escalate", "request_action"])

/**
 * One tool call, as the composer's server forwards it: the goal read under its permit,
 * the move made if the goal allows it, and what the model is told either way.
 *
 * **Only inside a composer turn.** A call that arrives when the goal is not composing
 * belongs to no turn — a server left over from a killed CLI — and is refused rather than
 * moving a goal nobody is asking.
 *
 * `call` is the CLI's own id for the call where the server was given one, which is what a
 * surface joins the transcript's line for it to; a call with none is filed under one
 * minted here, and draws as an ordinary call.
 */
export const callTool = (id: GoalId, name: ToolName, call: string, args: unknown) =>
  Effect.flatMap(Locks, (locks) =>
    locks.withGoal(id)(
      Effect.gen(function* () {
        const goal = yield* goalOf(yield* GoalStore, id)
        if (goal === undefined || goalAtRest(goal.state)) return refusedFor({ over: true })
        if (goal.state._tag !== "Composing") return refusedFor({ notComposing: true })
        // A goal with no approved file can only draft one, or ask the person something —
        // setting up access can come before the file. One with a file never drafts again.
        if (goal.spec === undefined && !DRAFTING_TOOLS.has(name)) {
          return refusedFor({ drafting: true })
        }
        if (goal.spec !== undefined && name === "draft_goal") return refusedFor({ filed: true })
        const outcome: Outcome = yield* HANDLERS[name](goal, call, args)
        return outcome
      }),
    ),
  )

const answered = (outcome: Outcome) =>
  Effect.map(
    Prompts,
    (prompts): McpToolResultDto => ({
      text: render(prompts, "goal/tool-result", outcome.said),
      isError: outcome.refused,
    }),
  )

// ============================================================================
// Pause, resume and drop — a person's presses that reach the goal's traks
// ============================================================================

/** The goal's traks still going, read off their own logs. */
const goingTraks = (goal: Goal) =>
  Effect.flatMap(Store, (store) =>
    Effect.forEach(liveTraks(goal), (t) =>
      Effect.map(store.events(t.id), (events) => replayHistory(t.id, events)),
    ),
  ).pipe(Effect.map((traks) => traks.filter((t) => !atRest(t.state))))

/**
 * Run `move` on each of the goal's sub-goals still going, each read under its own permit —
 * taken while the parent's is held, which is the one order the two are ever taken in.
 * `move` answers whether it moved one, and the ids it moved are the answer.
 */
const eachSubgoal = <E, R>(
  ids: readonly GoalId[],
  move: (sub: Goal) => Effect.Effect<boolean, E, R>,
) =>
  Effect.gen(function* () {
    const goals = yield* GoalStore
    const locks = yield* Locks
    const moved = yield* Effect.forEach(ids, (id) =>
      locks.withGoal(id)(
        Effect.flatMap(goalOf(goals, id), (sub) =>
          sub === undefined || goalAtRest(sub.state) ? Effect.succeed(false) : move(sub),
        ),
      ),
    )
    return ids.filter((_, i) => moved[i] === true)
  })

/**
 * Hold every live trak at its next gate, and take no composer turn until resumed. Each live
 * sub-goal not already paused is paused with it, and named on the pause, so resuming
 * resumes only those.
 */
const pauseGoal = (goal: Goal) =>
  Effect.gen(function* () {
    const subgoals = yield* eachSubgoal(
      liveSubgoals(goal).map((s) => s.id),
      (sub) => (sub.paused ? Effect.succeed(false) : Effect.as(pauseOne(sub, []), true)),
    )
    yield* pauseOne(goal, subgoals)
  })

/**
 * Pause one goal, with the sub-goals its pause paused.
 *
 * **A `manual` trak is passed over, not refused**: it already stands at every gate, and
 * the hold route turns one away. One already holding is passed over too, so resume takes
 * off only the holds the pause put on.
 */
const pauseOne = (goal: Goal, subgoals: readonly GoalId[]) =>
  Effect.gen(function* () {
    const holding = (yield* goingTraks(goal)).filter((t) => t.mode !== "manual" && !t.holding)
    yield* Effect.forEach(holding, (t) => appendSetting(t.id, Events.holdChanged(true)), {
      discard: true,
    })
    const paused = GoalEvents.paused(
      holding.map((t) => t.id),
      subgoals,
    )
    yield* (yield* GoalStore).append(goal.id, [paused], { after: goal.logged })
  })

/**
 * Take off each hold the pause put on that is still standing. One already spent — the
 * trak stood at the gate it held and a person has not accepted it — stays spent: that
 * trak waits at its gate for its person, which is what a hold is.
 */
const releaseHolds = (goal: Goal) =>
  Effect.gen(function* () {
    const going = yield* goingTraks(goal)
    const releasing = going.filter((t) => goal.held.includes(t.id) && t.holding)
    yield* Effect.forEach(releasing, (t) => appendSetting(t.id, Events.holdChanged(false)), {
      discard: true,
    })
    return releasing.map((t) => t.id)
  })

/** Resume, and resume each sub-goal the pause paused that is paused still. */
const resumeGoal = (goal: Goal) =>
  Effect.gen(function* () {
    const drives = yield* GoalDrives
    const subgoals = yield* eachSubgoal(goal.heldSubgoals, (sub) =>
      sub.paused
        ? Effect.as(Effect.zipRight(resumeOne(sub, []), drives.kick(sub.id)), true)
        : Effect.succeed(false),
    )
    yield* resumeOne(goal, subgoals)
  })

const resumeOne = (goal: Goal, subgoals: readonly GoalId[]) =>
  Effect.gen(function* () {
    const released = yield* releaseHolds(goal)
    yield* (yield* GoalStore).append(goal.id, [GoalEvents.resumed(released, subgoals)], {
      after: goal.logged,
    })
  })

/** Drop a goal, and each of its live sub-goals with it, for the same reason. */
const dropGoal = (goal: Goal, reason: string) =>
  Effect.gen(function* () {
    yield* eachSubgoal(
      liveSubgoals(goal).map((s) => s.id),
      (sub) => Effect.as(dropOne(sub, reason), true),
    )
    yield* dropOne(goal, reason)
  })

/**
 * Drop one goal: its turn killed, the holds its pause put on taken off, and nothing more
 * asked of it. Its traks are left as they are — each is an ordinary trak, and its person's
 * from here.
 */
const dropOne = (goal: Goal, reason: string) =>
  Effect.gen(function* () {
    yield* (yield* GoalDrives).halt(goal.id)
    if (goal.paused) yield* releaseHolds(goal)
    yield* (yield* GoalStore).append(goal.id, [GoalEvents.dropped(reason)], { after: goal.logged })
    yield* leaveGoalCheckout(goal)
  })

/**
 * The engine's checkout of the goal branch goes once the goal has ended; the branch stays
 * on `origin`, the person's from here. A failure is logged: a checkout left behind is
 * removed by the next goal end that asks, and a merge after this one makes it again.
 */
const leaveGoalCheckout = (goal: Goal) =>
  goal.spec?.branch === undefined
    ? Effect.void
    : Effect.flatMap(Vcs, (vcs) => vcs.removeGoalCheckout(goal.id)).pipe(
        Effect.catchTag("GitFailed", (e) =>
          Effect.logWarning(`goal ${goal.id}: its goal checkout was not removed: ${e.reason}`),
        ),
      )

// ============================================================================
// The watcher — a goal's traks ending or stopping, as the feed reports them
// ============================================================================

/**
 * File what a trak's own log says has happened to it, on its goal's log, and wake the
 * composer where that is owed a turn.
 *
 * **The trak's log is the authority, never a frame.** The watcher and the reconcile pass
 * both come here, and a wake is filed only where the line the trak reached its outcome at
 * differs from the one the goal last filed — so a frame lost, a frame seen twice and a
 * restart in between all file it exactly once. Compared under the goal's permit: the goal
 * may have dropped the trak itself, or come to rest, since the log was read.
 */
const settleTrak = (goalId: GoalId, trak: TrakId) =>
  Effect.gen(function* () {
    const { outcome, since } = outcomeSince(trak, yield* (yield* Store).events(trak))
    if (outcome === undefined) return
    const goals = yield* GoalStore
    const woke = yield* (yield* Locks).withGoal(goalId)(
      readAgainOnConflict(
        Effect.gen(function* () {
          const goal = yield* goalOf(goals, goalId)
          if (goal === undefined || goalAtRest(goal.state)) return false
          const known = liveTraks(goal).find((t) => t.id === trak)
          if (known === undefined) return false
          if (outcome === "ended") {
            yield* goals.append(
              goalId,
              [GoalEvents.trakDropped(undefined, trak, "archived by a person")],
              { after: goal.logged },
            )
            return false
          }
          if (known.filed === since) return false
          yield* goals.append(goalId, [GoalEvents.trakWoke(trak, outcome, since)], {
            after: goal.logged,
          })
          return true
        }),
      ),
    )
    if (woke) yield* (yield* GoalDrives).kick(goalId)
  })

/**
 * File each hand-off a trak's own log says went to its goal and the goal has not filed,
 * and wake the composer with the descriptions.
 *
 * `settleTrak`'s rule — the trak's log is the authority, compared under the goal's permit
 * — with its own memory: `GoalTrak.handedOff`, the compose entries already filed. Over
 * every trak the goal opened rather than its live ones, since a trak that hands off as it
 * finishes can land before a reconcile reads it.
 */
const settleHandOffs = (goalId: GoalId, trak: TrakId) =>
  Effect.gen(function* () {
    const handed = goalHandOffs(replayHistory(trak, yield* (yield* Store).events(trak)))
    if (handed.length === 0) return
    const goals = yield* GoalStore
    const woke = yield* (yield* Locks).withGoal(goalId)(
      readAgainOnConflict(
        Effect.gen(function* () {
          const goal = yield* goalOf(goals, goalId)
          if (goal === undefined || goalAtRest(goal.state)) return false
          const known = goal.traks.find((t) => t.id === trak)
          if (known === undefined) return false
          const unfiled = handed.filter((h) => !known.handedOff.includes(h.step))
          if (unfiled.length === 0) return false
          yield* goals.append(
            goalId,
            unfiled.map((h) => GoalEvents.trakHandedOff(trak, h.step, h.handOff)),
            { after: goal.logged },
          )
          return true
        }),
      ),
    )
    if (woke) yield* (yield* GoalDrives).kick(goalId)
  })

/**
 * Start each goal a finished trak's composer proposed and nothing has started, and write
 * on the trak's log which goal it became.
 *
 * **Once each.** The trak's `GoalOpened` is the memory, and a start cut off before it
 * was written finds its goal by `proposalCall` rather than opening a second. One watcher
 * runs this, a frame at a time, so two never race for one proposal.
 */
const openProposedGoals = (id: TrakId) =>
  Effect.gen(function* () {
    const trak = replayHistory(id, yield* (yield* Store).events(id))
    yield* Effect.forEach(
      goalOwed(trak),
      (owed) =>
        Effect.gen(function* () {
          const call = proposalCall(owed.step)
          const already = yield* goalOpenedBy(id, call)
          const goal =
            already?.id ??
            (yield* startGoal(
              "goal",
              // On the trak's mode and its owner's, as `open_goal` opens one.
              GoalEvents.asked(
                owed.asked,
                [trak.mode],
                { from: id, call },
                trak.owner,
                owed.documents,
              ),
            ))
          yield* noteGoalOpened(id, owed.step, goal)
        }),
      { discard: true },
    )
  })

/** `openProposedGoals`, with a failure kept to a log line about the one trak. */
const openProposedGoalsOf = (id: TrakId) =>
  openProposedGoals(id).pipe(
    Effect.catchAllCause((cause) =>
      Effect.logError(`trak ${id}: its proposed goal is not started`, cause),
    ),
  )

/**
 * Start every goal a finished trak proposed and nothing started, check every going goal's
 * live traks against their own logs, file whatever was missed, and kick each goal — which
 * runs a turn where one is owed and nothing where none is.
 *
 * What makes the watcher's memory unnecessary: run at boot, and again whenever the feed
 * shows the watcher a gap, so a landing published just before the engine stopped, or a
 * frame the sliding feed shed, still reaches the goal. One goal's unreadable log does not
 * stop the others'.
 */
export const reconcileGoals = Effect.gen(function* () {
  const goals = yield* GoalStore
  const drives = yield* GoalDrives
  // A goal a trak proposed and that never started — the engine stopped between the trak
  // finishing and the watcher reading it. Every trak, since nothing else lists them.
  yield* Effect.forEach(yield* (yield* Store).list(), openProposedGoalsOf, { discard: true })
  yield* Effect.forEach(
    yield* goals.list(),
    (id) =>
      Effect.gen(function* () {
        const goal = yield* goalOf(goals, id)
        if (goal === undefined || goalAtRest(goal.state)) return
        yield* Effect.forEach(goal.traks, (t) => settleHandOffs(id, t.id), { discard: true })
        yield* Effect.forEach(liveTraks(goal), (t) => settleTrak(id, t.id), { discard: true })
        yield* Effect.forEach(goal.subgoals, (s) => drives.settleSubgoal(s.id), { discard: true })
        yield* drives.kick(id)
      }).pipe(
        Effect.catchAllCause((cause) => Effect.logError(`goal ${id}: not reconciled`, cause)),
      ),
    { discard: true },
  )
})

/**
 * The drain: every `Appended` frame for a trak a goal opened, at an outcome its goal could
 * be owed or recording a hand-off, and for a finished trak owing the goal it proposed. It
 * keeps no memory of what it filed — `settleTrak` and `settleHandOffs` ask the goal's log,
 * `openProposedGoals` the trak's — and only the highest frame id it has seen, so a
 * skipped id runs the reconcile pass. Frames of two traks can arrive out of id order, so a
 * gap may be a frame still on its way; the extra pass then files nothing. The caller
 * subscribes, for `forwardToPush`'s reason.
 */
export const watchGoalTraks = (frames: Stream.Stream<Framed>) =>
  Effect.gen(function* () {
    let highest: number | undefined
    yield* Stream.runForEach(frames, ({ id, frame }) =>
      Effect.gen(function* () {
        const gap = highest !== undefined && id > highest + 1
        highest = Math.max(highest ?? id, id)
        if (gap) yield* reconcileGoals
        if (frame._tag !== "Appended") return
        const goal = frame.trak.goal
        if (goal === undefined) {
          if (goalOwed(frame.trak).length > 0) yield* openProposedGoalsOf(frame.id)
          return
        }
        if (frame.event._tag === "HandedOff") {
          yield* settleHandOffs(goal, frame.id).pipe(
            Effect.catchAllCause((cause) =>
              Effect.logError(`goal ${goal}: ${frame.id}'s hand-off not filed`, cause),
            ),
          )
        }
        // `true` for `committed` because the frame cannot say, and it only picks which
        // wake a `Closed` trak is: `settleTrak` reads the log and settles which. A stop of
        // auto-merge moves no state, so its own event is what says a wake may be due.
        const stopped = frame.event._tag === "AutoMergeStopped"
        if (!stopped && outcomeOf(frame.trak.state, true) === undefined) return
        yield* settleTrak(goal, frame.id).pipe(
          Effect.catchAllCause((cause) =>
            Effect.logError(`goal ${goal}: ${frame.id} not filed`, cause),
          ),
        )
      }),
    )
  })

/**
 * Subscribe, reconcile, then fork the drain — the one line `serve.ts` calls. The pass runs
 * after the subscription, so an append landing during it is in the drain as well; filing
 * it twice is what `settleTrak` refuses.
 *
 * **Under an external store it runs on one copy**, the one holding the `goal-watch` job, for
 * `startPushForwarding`'s reason. A copy taking the job over reconciles as it takes it,
 * which files whatever the drain it replaces had not.
 */
export const startGoalWatching = Effect.gen(function* () {
  const feed = yield* Feed
  if ((yield* Locks).expiresAfter !== undefined) {
    const watching = Effect.scoped(
      Effect.gen(function* () {
        const replay = yield* feed.since(0)
        yield* reconcileGoals
        yield* watchGoalTraks(replay.frames)
      }),
    ).pipe(Effect.catchAllCause((cause) => Effect.logError("goal watch ended", cause)))
    yield* Effect.forkScoped(heldJob("goal-watch", watching))
    return
  }
  const replay = yield* feed.since(0)
  yield* reconcileGoals
  yield* Effect.forkScoped(watchGoalTraks(replay.frames))
})

// ============================================================================
// Routes
// ============================================================================

const pathGoal = Effect.gen(function* () {
  const raw = (yield* Router.params)["id"]
  if (raw === undefined) return yield* Effect.fail(ServerResponse.empty({ status: 400 }))
  return GoalId.make(raw)
})

/** The goal, or the 404 a route answers for one that does not exist. */
const foundGoal = Effect.gen(function* () {
  const id = yield* pathGoal
  const goal = yield* goalOf(yield* GoalStore, id)
  if (goal === undefined) return yield* Effect.fail(ServerResponse.empty({ status: 404 }))
  return goal
})

/** The goal on the wire, with its parent's name read where it is a sub-goal. */
const goalDto = (goal: Goal) =>
  Effect.gen(function* () {
    const running = yield* (yield* GoalDrives).running(goal.id)
    const parent =
      goal.parent === undefined
        ? undefined
        : yield* goalOf(yield* GoalStore, goal.parent.goal).pipe(
            Effect.catchTag("StoreUndecodable", () => Effect.succeed(undefined)),
          )
    return toGoalDto(goal, running, parent)
  })

/** Each sub-goal the goal opened, off its own log; one that will not decode is left out. */
const subgoalDtos = (goal: Goal) =>
  Effect.gen(function* () {
    const store = yield* GoalStore
    const found = yield* Effect.forEach(goal.subgoals, (s) =>
      goalOf(store, s.id).pipe(
        Effect.catchTag("StoreUndecodable", () => Effect.succeed(undefined)),
      ),
    )
    const drives = yield* GoalDrives
    return yield* Effect.forEach(
      found.filter((g) => g !== undefined),
      (sub) => Effect.map(drives.running(sub.id), (running) => toGoalDto(sub, running, goal)),
    )
  })

/**
 * The one check in front of every per-goal route — `/api/goals/:id` and everything under it,
 * here and the composer's MCP endpoint in `trak-mcp.ts`: a goal the viewer does not see
 * answers the 404 of a missing one (`hiddenUnseen` in `people.ts`).
 */
export const goalGate = hiddenUnseen("/api/goals/:id", (id) => ({ goal: GoalId.make(id) }))

/** Every goal this project has started that the viewer sees, newest first. */
const goalsRoute = Router.get(
  "/api/goals",
  Effect.gen(function* () {
    const store = yield* GoalStore
    const levelOf = yield* levelsHere
    const seen = yield* Effect.filter(yield* store.list(), (id) =>
      Effect.map(levelOf({ goal: id }), (level) => level !== undefined),
    )
    const found = yield* Effect.forEach(seen, (id) => goalOf(store, id))
    const goals = found
      .flatMap((g) => (g === undefined ? [] : [g]))
      .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
    const list: GoalListDto = { goals: yield* Effect.forEach(goals, goalDto) }
    return yield* ServerResponse.json(list)
  }),
)

/**
 * A row for each trak the goal is done with — landed or dropped — off its own log, so a
 * trak put away still draws as the real row whose page opens. Nothing drives one, so the
 * row carries nothing a drive would; a log that will not decode is left out.
 */
const settledRows = (goal: Goal) =>
  Effect.gen(function* () {
    const store = yield* Store
    const lib = yield* Lib
    const rows = yield* Effect.forEach(
      goal.traks.filter((t) => t.status !== "live"),
      (t) =>
        Effect.map(store.events(t.id), (history) =>
          history.length === 0
            ? []
            : [toSummaryDto({ trak: replayHistory(t.id, history), history, running: false, lib })],
        ).pipe(Effect.catchTag("StoreUndecodable", () => Effect.succeed([]))),
    )
    return rows.flat()
  })

const goalRoute = Router.get(
  "/api/goals/:id",
  Effect.gen(function* () {
    const goal = yield* foundGoal
    const store = yield* GoalStore
    // Asked of who is looking: whose the goal is, where it is not theirs.
    const ownership = yield* ownershipHere(goal.owner)
    const detail: GoalDetailDto = {
      goal: { ...(yield* goalDto(goal)), ...(ownership === undefined ? {} : { ownership }) },
      log: toGoalLogDto(yield* store.events(goal.id)),
      settled: yield* settledRows(goal),
      subgoals: yield* subgoalDtos(goal),
      transcript: (yield* store.transcript(goal.id)).map(toTranscriptEntryDto),
    }
    return yield* ServerResponse.json(detail)
  }),
)

/**
 * Append the goal's first event under a fresh id: the name and the time, a millisecond on
 * where that id already has a log. Checked under the id's own permit, so two starts under
 * one name in one millisecond take two ids rather than one log between them.
 */
const appendStarted = <L, R>(
  name: string,
  first: (id: GoalId) => Effect.Effect<Either.Either<GoalEvent, L>, never, R>,
): Effect.Effect<
  Either.Either<GoalId, L>,
  AppendFailed | StoreUndecodable,
  GoalStore | Locks | R
> =>
  Effect.gen(function* () {
    const store = yield* GoalStore
    const locks = yield* Locks
    for (let at = yield* Clock.currentTimeMillis; ; at += 1) {
      const id = GoalId.make(`${name}-${at.toString(36)}`)
      // `first` runs under the id's permit, so what it makes for the id — a sub-goal's
      // branch — is made once, by the start that takes it.
      const appended = yield* locks.withGoal(id)(
        Effect.gen(function* () {
          if ((yield* store.events(id)).length > 0) return undefined
          const event = yield* first(id)
          if (Either.isLeft(event)) return Either.left(event.left)
          yield* store.append(id, [event.right], { after: 0 })
          return Either.right(id)
        }),
      )
      if (appended !== undefined) return appended
    }
  })

/**
 * Start a goal from its first event and kick its composer: New Goal's start and a step's
 * `open_goal` both come through here. **Spends**: the composer's first turn starts at once.
 */
export const startGoal = (name: string, first: GoalEvent) =>
  Effect.gen(function* () {
    const started = yield* appendStarted<never, never>(name, () =>
      Effect.succeed(Either.right(first)),
    )
    const id = Either.getOrElse(started, absurd<GoalId>)
    yield* (yield* GoalDrives).kick(id)
    return id
  })

/**
 * The goal a trak's agent already opened with this call, where it did: a retried
 * `open_goal` answers with that one rather than opening a second. Reads every goal's log,
 * which is a handful, and only for a call the CLI gave an id.
 */
export const goalOpenedBy = (from: TrakId, call: string) =>
  Effect.gen(function* () {
    const store = yield* GoalStore
    for (const id of yield* store.list()) {
      // One goal whose log will not decode is that goal's problem, not this call's.
      const goal = yield* goalOf(store, id).pipe(
        Effect.catchTag("StoreUndecodable", () => Effect.succeed(undefined)),
      )
      if (goal?.openedBy?.from === from && goal.openedBy.call === call) return goal
    }
    return undefined
  })

/**
 * Start a goal from a person's sentence, which the composer drafts a spec from for them to
 * approve. Any number go at once, and any other body — a goal file's name among them — is
 * a 400 that starts nothing. **Spends**: the composer's first turn starts at once.
 */
const startGoalRoute = Router.post(
  "/api/goals",
  Effect.gen(function* () {
    const request = yield* ServerRequest.schemaBodyJson(StartGoalRequestDto).pipe(
      Effect.catchTag("ParseError", () => Effect.succeed(undefined)),
    )
    if (request === undefined) {
      return ServerResponse.empty({
        status: 400,
        statusText: "a goal starts from a sentence: send `asked` and `modes`",
      })
    }
    // Whose goal it is, and so whose every trak it opens: the host user who pressed.
    const owner = yield* pressedBy
    const files = yield* placeUploads(request.attachments, ...(yield* composerCheckout))
    if (typeof files === "string") {
      return yield* refuse(422, AttachmentRefusedDto.make({ reason: files }))
    }
    const first = GoalEvents.asked(
      request.asked,
      request.modes,
      undefined,
      owner,
      undefined,
      files.attachments,
    )
    const id = yield* startGoal("goal", first)
    yield* files.release
    return yield* ServerResponse.json(CreatedDto.make({ id }), { status: 202 })
  }),
)

/**
 * The goal branch on `origin`, made where it is not there yet — before a goal naming one
 * is started, so no trak is ever cut from a branch that does not exist. Cut from `from`,
 * the parent's goal branch, for a sub-goal. The refusal where git refuses, and nothing
 * appended.
 */
const goalBranchMade = (branch: string | undefined, from?: string) =>
  branch === undefined
    ? Effect.succeed(undefined)
    : Effect.flatMap(Vcs, (vcs) =>
        vcs.createGoalBranch(
          BranchName.make(branch),
          from === undefined ? undefined : BranchName.make(from),
        ),
      ).pipe(
        Effect.as(undefined),
        Effect.catchTag("GitFailed", (e) =>
          Effect.succeed(
            GoalBranchRefusedDto.make({
              reason: `the goal branch \`${branch}\` could not be made: ${e.reason}`,
            }),
          ),
        ),
      )

/**
 * Confirm done on a goal with a goal branch: the engine's checkout of it pushed, where a
 * push after a merge failed, then one pull request from it into the default branch opened
 * or updated, under the goal's title and its finished state. Nothing is merged — that is
 * a person's. The refusal where any of it fails, so the goal stays at its done gate and
 * the next Confirm tries again.
 */
const refusedBranch = (reason: string) => GoalBranchRefusedDto.make({ reason })

/**
 * Confirm done on a sub-goal with a branch: the engine's checkout of that branch pushed,
 * where a push after a merge failed, then the branch as `origin` holds it merged into the
 * parent's goal branch through the engine's checkout of that. No pull request: only a top
 * goal opens one. The refusal where any of it fails, or `SubgoalConflicted` with the paths
 * where the merge conflicts, so the sub-goal stays at its done gate and the next Confirm
 * tries again.
 */
const subgoalMerged = (goal: Goal) =>
  Effect.gen(function* () {
    const branch = goalBranchOf(goal)
    if (goal.parent === undefined || branch === undefined) return undefined
    const parent = yield* goalOf(yield* GoalStore, goal.parent.goal)
    const into = parent === undefined ? undefined : goalBranchOf(parent)
    if (into === undefined) {
      return refusedBranch(`the parent goal's branch to merge \`${branch}\` into could not be read`)
    }
    const vcs = yield* Vcs
    const merged = yield* Effect.either(
      Effect.gen(function* () {
        yield* vcs.pushGoal(goal.id, branch)
        yield* vcs.fetch()
        return yield* vcs.merge(
          MergeInto.Goal({ goal: goal.parent?.goal ?? "", branch: into }),
          BranchName.make(`origin/${branch}`),
          `Merge sub-goal: ${goalName(goal)}`,
        )
      }),
    )
    if (Either.isLeft(merged)) {
      return refusedBranch(
        `\`${branch}\` could not be merged into \`${into}\`: ${merged.left.reason}`,
      )
    }
    return merged.right._tag === "Merged"
      ? undefined
      : SubgoalConflictedDto.make({ into, paths: [...merged.right.paths] })
  })

const goalPullOpened = (goal: Goal) =>
  Effect.gen(function* () {
    const spec = goal.spec
    const branch = goalBranchOf(goal)
    if (spec === undefined || branch === undefined) return undefined
    const vcs = yield* Vcs
    const sent = yield* Effect.either(
      Effect.zipRight(vcs.pushGoal(goal.id, branch), vcs.defaultBranch()),
    )
    if (Either.isLeft(sent))
      return refusedBranch(`\`${branch}\` could not be pushed: ${sent.left.reason}`)
    const base = sent.right
    if (base === undefined) {
      return refusedBranch("`origin` names no default branch to open the goal's pull request into")
    }
    const opened = yield* (yield* Forge).openPullRequest(branch, base, spec.title, spec.finished)
    return opened._tag === "Opened"
      ? undefined
      : refusedBranch(
          `the pull request from \`${branch}\` into \`${base}\` could not be opened: ${opened.why}`,
        )
  })

/**
 * Approving the draft makes it the goal's spec, on the goal's log and nowhere else: no file
 * is written and nothing is committed, so approval works the same whichever checkout the
 * engine's store keeps. A goal branch the draft names is made on `origin` first — the
 * refusal where git refuses, and nothing appended. Nothing at any other gate.
 *
 * `limits` and `branch` are what the person set on the gate card, laid over the draft's by
 * the same `approvedDraft` the goal's replay takes.
 */
const fileDraft = (goal: Goal, limits: GoalLimits | undefined, branch: string | undefined) =>
  Effect.gen(function* () {
    const draft = approvedDraft(
      goal.state._tag === "AtGate" && goal.state.gate === "file" ? goal.draft : undefined,
      limits,
      branch,
    )
    if (draft === undefined) return undefined
    return yield* goalBranchMade(draft.branch)
  })

/**
 * A chat sent while a composer turn runs or is owed: written to the log as waiting, then
 * one attempt down the running turn's pipe — `holdMessage`'s two halves. What the turn
 * does not read is handed to the next one when it starts, or is the chat the goal owes
 * itself once a turn ends. Owes nothing by itself, so the turn already owed keeps its reason.
 */
const holdGoalMessage = (goal: Goal, message: string, attachments?: readonly Attachment[]) =>
  Effect.gen(function* () {
    const key = randomUUID()
    const waiting = GoalEvents.messageWaiting(key, message, attachments)
    yield* (yield* GoalStore).append(goal.id, [waiting], { after: goal.logged })
    const [cwd, at] = yield* composerCheckout
    const steered = yield* steeredMessage(yield* Prompts, key, message, attachments ?? [], cwd, at)
    yield* (yield* GoalDrives).steer(goal.id, steered)
  })

/**
 * Where a goal's composer runs, as `placeUploads` takes it: the project's place in its
 * sandbox under an external store with a runner, and the project checkout otherwise —
 * `ComposeGoal`'s `cwd`.
 */
const composerCheckout = Effect.gen(function* () {
  const sandboxes = Option.getOrUndefined(yield* Effect.serviceOption(Sandboxes))
  const project = sandboxes === undefined ? undefined : yield* sandboxes.project
  return [project?.path ?? (yield* Lib).root, project] as const
})

/**
 * A person's press on a goal: approve the draft, answer an escalation, report on work asked
 * of them by hand, confirm done, talk
 * to the composer, or retry a turn that failed, in its session or a new one. Refused where
 * the goal does not offer it, and a `Retry` or `NewSession` while a turn is running. Every press but `Confirm` owes a turn, which
 * starts at once unless the goal is paused — and a chat while one is owed or running,
 * which waits for that turn instead.
 */
const actGoalRoute = Router.post(
  "/api/goals/:id/act",
  Effect.gen(function* () {
    const id = yield* pathGoal
    const action = yield* ServerRequest.schemaBodyJson(GoalActionDto)
    // Confirm done owes no turn, so it stays open to everyone; every other press owes one.
    const before = yield* goalOf(yield* GoalStore, id)
    if (before !== undefined && action._tag !== "Confirm") {
      const notOwner = yield* goalOwnerOnly(before)
      if (notOwner !== undefined) return notOwner
    }
    const drives = yield* GoalDrives
    const running = yield* drives.running(id)
    const outcome = yield* (yield* Locks).withGoal(id)(
      Effect.gen(function* () {
        const goal = yield* goalOf(yield* GoalStore, id)
        if (goal === undefined) return "missing" as const
        if (goalAtRest(goal.state)) return "rest" as const
        if (running && (action._tag === "Retry" || action._tag === "NewSession"))
          return "running" as const
        if (!goalOffers(goal.state).includes(action._tag)) return "refused" as const
        if (action._tag === "Approve") {
          const branchRefused = yield* fileDraft(goal, action.limits, action.branch)
          if (branchRefused !== undefined) return branchRefused
        }
        if (action._tag === "Confirm") {
          // A sub-goal opened after done was proposed is live still: refused as the
          // proposal would have been.
          const live = subgoalsLive(goal)
          if (live !== undefined) return SubgoalsLiveDto.make({ subgoals: live })
          // Only a top goal opens a pull request; a sub-goal lands on its parent's branch.
          const landing =
            goal.parent === undefined ? yield* goalPullOpened(goal) : yield* subgoalMerged(goal)
          if (landing !== undefined) return landing
        }
        // A chat's files go where the composer runs before anything is appended.
        // Every refusal above has passed, so only an append that fails can follow; the
        // uploads are released once the event naming them is on the log.
        const files =
          action._tag === "Chat"
            ? yield* placeUploads(action.attachments, ...(yield* composerCheckout))
            : undefined
        if (typeof files === "string") return AttachmentRefusedDto.make({ reason: files })
        const attachments = files?.attachments ?? []
        if (action._tag === "Chat" && goal.state._tag === "Composing") {
          yield* holdGoalMessage(goal, action.message, attachments)
          if (files !== undefined) yield* files.release
          return "acted" as const
        }
        // A chat takes every message still waiting with it, said first.
        const pressed =
          action._tag === "Chat" ? goalChatWith(goal, action.message, attachments) : action
        yield* (yield* GoalStore).append(id, [GoalEvents.acted(pressed)], { after: goal.logged })
        if (files !== undefined) yield* files.release
        if (action._tag === "Confirm") yield* leaveGoalCheckout(goal)
        return "acted" as const
      }),
    )
    if (typeof outcome === "object") {
      return yield* refuse(outcome._tag === "AttachmentRefused" ? 422 : 409, outcome)
    }
    if (outcome === "missing") return ServerResponse.empty({ status: 404 })
    if (outcome === "rest") return yield* refuse(409, AtRestDto.make({}))
    if (outcome === "running") return yield* refuse(409, DrivingDto.make({}))
    if (outcome === "refused") return yield* refuse(409, NotParkedDto.make({}))
    yield* drives.kick(id)
    // Under no permit of the sub-goal's: waking a parent takes the parent's.
    if (action._tag === "Confirm") yield* drives.settleSubgoal(id)
    return yield* ServerResponse.json(CreatedDto.make({ id }), { status: 202 })
  }),
)

/** Pause or resume: the holds go on or come off, and `204` once they have. Spends nothing — a resume's turn excepted. */
const pauseRoute = (paused: boolean) =>
  Router.post(
    paused ? "/api/goals/:id/pause" : "/api/goals/:id/resume",
    Effect.gen(function* () {
      const id = yield* pathGoal
      // Resuming owes the composer a turn; pausing owes nothing and stays open to everyone.
      const found = paused ? undefined : yield* goalOf(yield* GoalStore, id)
      if (found !== undefined) {
        const notOwner = yield* goalOwnerOnly(found)
        if (notOwner !== undefined) return notOwner
      }
      const outcome = yield* (yield* Locks).withGoal(id)(
        Effect.gen(function* () {
          const goal = yield* goalOf(yield* GoalStore, id)
          if (goal === undefined) return "missing" as const
          if (goalAtRest(goal.state)) return "rest" as const
          if (goal.paused === paused) return "already" as const
          yield* paused ? pauseGoal(goal) : resumeGoal(goal)
          return "done" as const
        }),
      )
      if (outcome === "missing") return ServerResponse.empty({ status: 404 })
      if (outcome === "rest") return yield* refuse(409, AtRestDto.make({}))
      if (!paused) yield* (yield* GoalDrives).kick(id)
      return ServerResponse.empty({ status: 204 })
    }),
  )

/**
 * The goal's traks a change of its auto-merge reaches: every one still live to the goal,
 * `Finished` among them — that is where a pull request waits to be merged — and none at
 * rest otherwise. Each is turned on or off only where it is not already.
 */
const changeAutoMerge = (goal: Goal, on: boolean) =>
  Effect.gen(function* () {
    const store = yield* Store
    const traks = yield* Effect.forEach(liveTraks(goal), (t) =>
      Effect.map(store.events(t.id), (events) => replayHistory(t.id, events)),
    )
    const reached = traks.filter(
      (t) =>
        (!atRest(t.state) || t.state._tag === "Finished") && (t.autoMerge !== undefined) !== on,
    )
    yield* Effect.forEach(reached, (t) => appendSetting(t.id, Events.autoMergeChanged(on)), {
      discard: true,
    })
  })

/**
 * Turn auto-merge off or on for the live traks of each goal whose shared auto-merge a change
 * of `goal`'s limits moves: the goal itself, and for a top goal each live sub-goal, read
 * under no permit of its own. What decides is the budget — the goal's own setting under its
 * parent's — before and after, so a sub-goal set to `always` under a parent at `never` turns
 * nothing on, and a parent set to `never` turns its sub-goals' traks off too. A budget that
 * moves to the composer deciding leaves each trak as it is.
 */
const shareAutoMerge = (goal: Goal, limits: GoalLimits) =>
  Effect.gen(function* () {
    const store = yield* GoalStore
    const own = goal.spec?.limits ?? {}
    const parent = goal.parent === undefined ? undefined : yield* goalOf(store, goal.parent.goal)
    const above = parent?.spec?.limits
    const subs = yield* Effect.forEach(liveSubgoals(goal), (s) => goalOf(store, s.id))
    const moves = [
      { goal, before: sharedBudget(own, above), after: sharedBudget(limits, above) },
      ...subs
        .filter((sub): sub is Goal => sub !== undefined && !goalAtRest(sub.state))
        .map((sub) => ({
          goal: sub,
          before: sharedBudget(sub.spec?.limits ?? {}, own),
          after: sharedBudget(sub.spec?.limits ?? {}, limits),
        })),
    ]
    yield* Effect.forEach(
      moves.filter(
        (m) => m.after.autoMerge !== undefined && m.after.autoMerge !== m.before.autoMerge,
      ),
      (m) => changeAutoMerge(m.goal, m.after.autoMerge === "always"),
      { discard: true },
    )
  })

/**
 * Change a running goal's limits, modes and auto-merge: `limits` replaces the spec's
 * whole, on the goal's log alone — the goal file is never rewritten. **Spends nothing**:
 * no turn starts, and the composer reads the new limits on its next one, as `open_trak`
 * does on its next call. Where the change moves the auto-merge a goal's traks open under
 * to `never` or `always`, its live traks are turned off or on too — `shareAutoMerge`.
 *
 * 404 unknown id · 409 at rest · 409 while the file is still a draft, whose limits ride
 * Approve instead.
 */
const settingsRoute = Router.post(
  "/api/goals/:id/settings",
  Effect.gen(function* () {
    const id = yield* pathGoal
    const limits = yield* ServerRequest.schemaBodyJson(GoalSettingsDto)
    const outcome = yield* (yield* Locks).withGoal(id)(
      Effect.gen(function* () {
        const goal = yield* goalOf(yield* GoalStore, id)
        if (goal === undefined) return "missing" as const
        if (goalAtRest(goal.state)) return "rest" as const
        if (goal.spec === undefined) return "drafting" as const
        yield* (yield* GoalStore).append(id, [GoalEvents.settingsChanged(limits)], {
          after: goal.logged,
        })
        yield* shareAutoMerge(goal, limits)
        return "changed" as const
      }),
    )
    if (outcome === "missing") return ServerResponse.empty({ status: 404 })
    if (outcome === "rest") return yield* refuse(409, AtRestDto.make({}))
    if (outcome === "drafting") return yield* refuse(409, NotParkedDto.make({}))
    return ServerResponse.empty({ status: 204 })
  }),
)

/** Take a goal at rest off the traks list, for every device. Spends nothing. */
const dismissRoute = Router.post(
  "/api/goals/:id/dismiss",
  Effect.gen(function* () {
    const id = yield* pathGoal
    const outcome = yield* (yield* Locks).withGoal(id)(
      Effect.gen(function* () {
        const goal = yield* goalOf(yield* GoalStore, id)
        if (goal === undefined) return "missing" as const
        if (!goalAtRest(goal.state)) return "going" as const
        if (!goal.dismissed) {
          yield* (yield* GoalStore).append(id, [GoalEvents.dismissed()], { after: goal.logged })
        }
        return "dismissed" as const
      }),
    )
    if (outcome === "missing") return ServerResponse.empty({ status: 404 })
    if (outcome === "going") return yield* refuse(409, NotAtRestDto.make({}))
    return ServerResponse.empty({ status: 204 })
  }),
)

/**
 * Stop the running composer turn: killed, and the goal settled where the turn would have
 * left it — the gate it asked for, the file gate while a draft waits, or watching. Owes no
 * turn, even for wakes the turn never read; the next turn a chat or a press starts reads
 * them. Under the goal's permit throughout, so no kick starts the stopped turn again
 * between the kill and its event. `409 NothingToStop` where no turn is running, or where
 * it had already ended and the driver is waiting on this permit to append its ending.
 */
const stopRoute = Router.post(
  "/api/goals/:id/stop",
  Effect.gen(function* () {
    const id = yield* pathGoal
    const outcome = yield* (yield* Locks).withGoal(id)(
      Effect.gen(function* () {
        const goal = yield* goalOf(yield* GoalStore, id)
        if (goal === undefined) return "missing" as const
        if (goalAtRest(goal.state)) return "rest" as const
        const halted = yield* (yield* GoalDrives).halt(id)
        if (halted === undefined) return "idle" as const
        const store = yield* GoalStore
        yield* store.append(id, [GoalEvents.turnStopped(halted.session)], { after: goal.logged })
        return "stopped" as const
      }),
    )
    if (outcome === "missing") return ServerResponse.empty({ status: 404 })
    if (outcome === "rest") return yield* refuse(409, AtRestDto.make({}))
    if (outcome === "idle") return yield* refuse(409, NothingToStopDto.make({}))
    return ServerResponse.empty({ status: 204 })
  }),
)

const dropRoute = Router.post(
  "/api/goals/:id/drop",
  Effect.gen(function* () {
    const id = yield* pathGoal
    const request = yield* ServerRequest.schemaBodyJson(DropGoalRequestDto)
    const outcome = yield* (yield* Locks).withGoal(id)(
      Effect.gen(function* () {
        const goal = yield* goalOf(yield* GoalStore, id)
        if (goal === undefined) return "missing" as const
        if (goalAtRest(goal.state)) return "rest" as const
        yield* dropGoal(goal, request.reason)
        return "dropped" as const
      }),
    )
    if (outcome === "missing") return ServerResponse.empty({ status: 404 })
    if (outcome === "rest") return yield* refuse(409, AtRestDto.make({}))
    yield* (yield* GoalDrives).settleSubgoal(id)
    return yield* ServerResponse.json(CreatedDto.make({ id }), { status: 202 })
  }),
)

const isGoalReadTool = (name: string): name is ReadTool =>
  goalReadToolNames().some((read) => read === name)

/**
 * One call on a read tool, answered as a trak's is — by the same owner rule, worded by
 * `trak/tool-result`, every secret value the engine holds taken out.
 *
 * **No permit, and in any state.** The `Composing`-only refusal in `callTool` stops a stale
 * server from moving a goal; a read moves nothing, so it is answered whenever it arrives.
 */
const readToolCall = (id: GoalId, name: ReadTool, args: unknown) =>
  Effect.gen(function* () {
    const { hide, answer } = yield* hidingAnswers
    const goal = yield* goalOf(yield* GoalStore, id)
    if (goal === undefined) return answer(refused({ noGoal: id }))
    return answer(yield* readCall({ kind: "goal", goal }, name, args, hide))
  })

/**
 * The goal's tools as MCP lists them, the descriptions rendered from their templates: its
 * own, then the read tools a trak's turn has, but for `snapshot_logs`. What the shim's
 * route and the HTTP endpoint a session in the project's sandbox dials both answer.
 */
export const goalToolList = Effect.map(
  Prompts,
  (prompts): McpToolListDto => ({
    tools: [
      ...toolNames().map((name) => ({
        name,
        description: render(prompts, descriptionOf(name), {}),
        inputSchema: inputSchemaOf(TOOLS[name]),
      })),
      ...goalReadToolNames().map((name) => ({
        name,
        description: render(prompts, `trak/tool-${name}`, {}),
        inputSchema: inputSchemaOf(READ_TOOLS[name]),
      })),
    ],
  }),
)

const toolsRoute = Router.get(
  "/api/goals/:id/tools",
  Effect.flatMap(goalToolList, (list) => ServerResponse.json(list)),
)

/** One call on the goal's tool `name`, answered — or `undefined` where it names none. */
export const goalToolCall = (id: GoalId, name: string, request: McpToolCallDto) =>
  Effect.gen(function* () {
    if (isGoalReadTool(name)) return yield* readToolCall(id, name, request.arguments)
    if (!isTool(name)) return undefined
    // Random rather than timed: two calls with no id of the CLI's can land in one millisecond.
    const call = request.call ?? `goal-${randomUUID()}`
    return yield* answered(yield* callTool(id, name, call, request.arguments))
  })

const toolCallRoute = Router.post(
  "/api/goals/:id/tools/:name",
  Effect.gen(function* () {
    const id = yield* pathGoal
    const name = (yield* Router.params)["name"] ?? ""
    if (!isGoalReadTool(name) && !isTool(name)) return ServerResponse.empty({ status: 404 })
    const request = yield* ServerRequest.schemaBodyJson(McpToolCallDto)
    const answer = yield* goalToolCall(id, name, request)
    return answer === undefined
      ? ServerResponse.empty({ status: 404 })
      : yield* ServerResponse.json(answer)
  }),
)

export const goalRoutes = Router.empty
  .pipe(
    goalsRoute,
    goalRoute,
    startGoalRoute,
    actGoalRoute,
    pauseRoute(true),
    pauseRoute(false),
    settingsRoute,
    stopRoute,
    dropRoute,
    dismissRoute,
    toolsRoute,
    toolCallRoute,
  )
  .pipe(Router.use(goalGate))
