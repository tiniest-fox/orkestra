// The only module that knows a loop exists.
//
// advance() is the single way trak state ever changes. The command runner table
// is a Match with no logic: decisions live in domain/decide.ts, doing lives in
// interactions (inlined here for the spike).

import { readFile } from "node:fs/promises"
import { join } from "node:path"
import {
  Clock,
  Data,
  Effect,
  Either,
  Exit,
  Fiber,
  Option,
  Ref,
  Schedule,
  Schema,
  Scope,
} from "effect"
import { calledTool, isViewKey, openToViews } from "../agent/logic/mcp.js"
import {
  CheckEntry,
  NoteEntry,
  ViewEntry,
  type TranscriptEntry,
  type TurnPosition,
} from "../agent/types/transcript-entry.js"
import { Diagrams, type DiagramsShape } from "../agent/ports/diagrams.js"
import { isUnreached } from "../agent/logic/runner-failure.js"
import { McpRequest, type McpTool, McpView } from "../agent/types/mcp.js"
import { mermaidSources } from "../agent/logic/mermaid-fences.js"
import { Transcript } from "../agent/ports/transcript.js"
import { type Vet, converse, elicit, type Elicited } from "../agent/interactions/elicit.js"
import { entryOf } from "../agent/logic/transcript-entry.js"
import { metered, type Metering, unmetered } from "../agent/logic/meter.js"
import { Provider, type ProviderRegistry } from "../agent/ports/provider.js"
import { refusalReason } from "../agent/logic/refusal.js"
import { rejoinedLine, writtenBy } from "../agent/logic/rejoined.js"
import { render, type Templates } from "../prompts/index.js"
import { Prompts } from "../prompts/ports/prompts.js"
import { type ElicitFailed, ProviderFailed } from "../agent/types/errors.js"
import type {
  McpServer,
  PromptImage,
  SessionId,
  SessionRequest,
  SignIn,
  SetupGate,
  SteeredMessage,
} from "../agent/types/session.js"
import type { ProviderEvent } from "../agent/types/provider-event.js"
import { type Place, Places } from "../agent/types/place.js"
import { agentIndex } from "../library/logic/index-summary.js"
import { agentNamed } from "../library/logic/resolve.js"
import { type Check, engineCondition, WAIT_UNTIL } from "../library/types/check.js"
import { connectionsOf } from "../library/logic/mcp-resolve.js"
import { GENERIC, type Agent, declaredTitles, requiredTitles } from "../library/types/agent.js"
import { Lib } from "../library/ports/library.js"
import type { Library } from "../library/types/library.js"
import { urlVariable } from "../library/types/process.js"
import {
  BranchName,
  branchFor,
  carriedRefFor,
  CommitSha,
  type KeptWork,
  MergeInto,
  MergeOutcome,
  Removal,
  type Worktree,
  WorktreePath,
} from "../vcs/index.js"
import type { CheckoutPlace } from "../vcs/logic/paths.js"
import { GitFailed } from "../vcs/types/errors.js"
import { HostTraks } from "../vcs/ports/host-traks.js"
import { Sandboxes, type SandboxesShape } from "../vcs/ports/sandboxes.js"
import { runnerFilesNow } from "../vcs/ports/runners.js"
import { duringWith, Preparation } from "../vcs/ports/preparation.js"
import { PreparingPhase } from "../vcs/types/preparing.js"
import { Vcs } from "../vcs/ports/vcs.js"
import { Forge } from "../vcs/ports/forge.js"
import { type ConditionAnswer, conditionAnswer } from "./domain/condition.js"
import { commitMessage, mergeMessage } from "./domain/git-message.js"
import { atLastCommit, keptWork } from "./domain/kept-work.js"
import {
  type AfterMerge,
  ComposerOutputFor,
  landedRefusal,
  MeantAsComposerOutput,
} from "./domain/outputs/composer-output.js"
import { type Failed, failed } from "./domain/outputs/failed.js"
import { amended, type Document } from "./domain/outputs/artifact.js"
import { message } from "./domain/outputs/message.js"
import {
  type AgentStep,
  artifactKey,
  childPlan,
  isCompose,
  isConversational,
  isSpawn,
  type Spawn,
  splitOf,
  waitForOf,
} from "./domain/outputs/proposal.js"
import { MeantAsStepOutput, type StepOutput, StepOutputFor } from "./domain/outputs/step-output.js"
import {
  type Event,
  Events,
  type RanEffect,
  type Refiled,
  stamped,
  versioned,
} from "./domain/event.js"
import {
  isConversation,
  overridesConversational,
  type Trigger,
  Triggers,
} from "./domain/trigger.js"
import { applyEvent, replayHistory } from "./domain/replay.js"
import {
  buildStepPrompt,
  buildComposerPrompt,
  buildSystemPrompt,
  type TurnProcess,
} from "./domain/prompt.js"
import {
  handedDecisions,
  inheritedDecisions,
  pieceOn,
  projection,
  supersedable,
  TRAK_DIR,
  visibleArtifacts,
} from "./domain/projection.js"
import { Command, decide, Decision, heldChat } from "./domain/decide.js"
import {
  buildGoalPrompt,
  type Goal,
  type GoalEvent,
  GoalEvents,
  type GoalTrak,
  goalAttachments,
  handsOffToGoal,
  replayGoal,
  type TrakStanding,
} from "./domain/goal.js"
import { type Attachment, attachedView, isImage } from "./domain/attachment.js"
import {
  asGate,
  atRest,
  borrowedSession,
  type Landing,
  effortAt,
  modelAt,
  type Slot,
  slotAt,
  standingArtifact,
  type StoppedTask,
  stoppedOn,
  type Trak,
  type TrakId,
  type UserId,
  type TrakState,
  waitUntilAt,
} from "./domain/trak.js"
import { spellLocal } from "./domain/wait-until.js"
import { type CheckOutcome, type CheckUnits, Checks } from "./ports/checks.js"
import { EngineVersion } from "./ports/engine-version.js"
import {
  declaredServers,
  Environment,
  EnvironmentFailed,
  type GivenCredential,
  type TurnCredential,
} from "./ports/environment.js"
import { GoalStore, type GoalStoreShape } from "./ports/goal-store.js"
import { HostedProcesses, type HostedRun } from "./ports/hosted-processes.js"
import { Ids } from "./ports/ids.js"
import { Locks, type LocksShape } from "./ports/locks.js"
import { Observer } from "./ports/observer.js"
import { Outages, throughOutage, waitingOutOutages } from "./ports/outages.js"
import { Leaving } from "./ports/leaving.js"
import { type SeamStatus, SeamStatuses } from "./ports/seam-status.js"
import { Passes } from "./ports/passes.js"
import { withProjectFiles } from "./ports/project-files.js"
import { Runs, type RunsShape } from "./ports/runs.js"
import { Setups } from "./ports/setups.js"
import { Uploads } from "./ports/uploads.js"
import { Store, type StoreShape } from "./ports/store.js"
import { StoredSessions } from "./ports/stored-sessions.js"
import {
  readAgainOnConflict,
  type AppendFailed,
  type StoreFailed,
  type StoreUndecodable,
} from "./ports/store-errors.js"
import {
  type GoalServers,
  type ReachedTools,
  type LiveHeard,
  TurnTools,
} from "./ports/turn-tools.js"
import { Workspace, type WorkspaceFailed } from "./ports/workspace.js"

// `GitFailed` is deliberately absent: every git failure is caught at its command
// and recorded as `WorktreeFailed`, for the reason `orGiveUp` catches an
// exhausted `elicit` — see the note there.
//
// `ElicitFailed` and `ProviderFailed` are absent by the same rule, and it is the
// rule rather than an oversight: `orGiveUp` catches the first and `orRecordFailure`
// the second, at the command that produced it, so neither can reach `advance`'s
// error channel. Listing an error nothing can raise reads as a failure mode a
// caller has to handle, and there is none.
// A failed name lookup is absent for the same reason: an agent name is narrowed by
// `ComposerOutputFor` at decode time, and every other name an agent carries is
// validated when the library loads. What is left is what a command genuinely
// cannot absorb: the store not answering, the store answering with a log this
// build cannot read, and an append refused because the log moved under it. They
// reach a caller because only a caller can decide — a surface listing many traks
// may leave an undecodable one out, and one driving *this* trak cannot — and a
// refused append in particular is never retried here: it names a second writer.
export type RuntimeError = AppendFailed | StoreUndecodable
export type RuntimeDeps =
  | Provider
  | Diagrams
  | Store
  | Locks
  | Lib
  | Observer
  | Ids
  | Prompts
  | Checks
  | Environment
  | Vcs
  | GoalStore
  | Forge
  | Runs
  | Passes
  | Workspace
  | EngineVersion
  | HostedProcesses
  | TurnTools
  | Setups

// ============================================================================
// Transcript wiring — tier 2, scoped to one trak
// ============================================================================

/**
 * The model has read one message, so it stops waiting. Appended under the log permit
 * as `advance` appends, and without it: the event moves nothing, so there is no decision
 * to make, and this runs inside the turn `advance` is waiting on. A failed append leaves
 * the message waiting, and it is then said again at the gate — the cheap direction to be
 * wrong in.
 */
const markHeard = (
  store: StoreShape,
  locks: LocksShape,
  engineVersion: string,
  id: TrakId,
  key: string,
) =>
  Effect.gen(function* () {
    const heard = stamped(
      versioned(Events.messageDelivered(key), engineVersion),
      yield* Clock.currentTimeMillis,
    )
    yield* locks
      .withLog(id)(
        readAgainOnConflict(
          Effect.flatMap(store.events(id), (log) =>
            Effect.flatMap(locks.fenced(id, log.length), (at) => store.append(id, [heard], at)),
          ),
        ),
      )
      .pipe(Effect.ignoreLogged)
  })

/**
 * `agent/` requires a Transcript but knows nothing about traks. Workflow closes
 * the gap by providing a per-trak implementation at the call site.
 *
 * Three destinations, because they answer different questions: the Store keeps
 * the turn for later, the Observer is how anything watches it happen, and
 * `Runs` is where the agent's pid becomes a recorded fact — the one place a
 * `ProviderEvent.Spawned` goes, since this is already the per-trak interception
 * point for every provider event. Recording only `_tag` made the transcript
 * useless for the common question — "what is it doing right now" — so the store
 * gets `entryOf`, which keeps the tool's name and what it acted on.
 *
 * `announced` is a fact about this turn: the session the CLI said it was running
 * in, set by the one event that says it got as far as making one, and written to
 * `Runs` for the turn that is cut off before its event is built. It is set here because this is already the interception point, and
 * read where the turn's event is built — see `orRecordFailure` for why a failure
 * must not claim a session that never existed, and `recordedSession` below for why
 * the announced id and not the minted one is what the log keeps.
 *
 * **The Store gets one `Thinking` per burst and one `SessionStarted` per session; the
 * Observer gets every one.** That is the one place the two destinations disagree, and
 * it is the difference between them stated as code: the Observer is watching it happen,
 * so a tick is the signal; the Store is keeping the turn for later, and 38 ticks of a
 * model thinking is not 38 things that happened. Dropping the ticks entirely would be
 * the other reasonable answer and is worse in one specific way — a UI polling the
 * transcript would have nothing at all to show for the longest stretch of a turn.
 * A burst is ticks saying the same thing: two `Thinking`s carrying different summaries
 * are two thoughts, and the second is a line of its own.
 *
 * **`position` comes from the command, because it is the one thing the stream
 * cannot say.** `entryOf` turns a provider event into a line and knows nothing
 * about a plan — `agent/` runs turns. Stamping here is what lets a reader
 * attribute a line to a position without joining it back through a session id,
 * which is a join that cannot work for the turn currently running.
 */
const withTranscript = <A, E, R>(
  id: TrakId,
  position: TurnPosition,
  /**
   * The turn's request: its session is what the provider keys the turn's pipe by, and its
   * model is what a view kept from this turn is filed with.
   */
  request: SessionRequest,
  announced: Ref.Ref<SessionId | undefined>,
  usage: Ref.Ref<Metering>,
  /**
   * The command this turn rejoins, whose lines the dead engine already wrote are not
   * written again by the replay of its stream — see `rejoinedLine`. Absent on every other turn.
   */
  rejoin: Rejoin | undefined,
  effect: Effect.Effect<A, E, R | Transcript>,
): Effect.Effect<
  A,
  E,
  | Exclude<R, Transcript>
  | Store
  | Observer
  | Runs
  | Provider
  | Locks
  | EngineVersion
  | TurnTools
  | Prompts
  | Scope.Scope
> =>
  Effect.gen(function* () {
    // On the live list for the length of the turn's scope, which `turn_status` reads.
    const onLive = yield* (yield* TurnTools).live({ kind: "trak", id, position })
    const store = yield* Store
    const observer = yield* Observer
    const runs = yield* Runs
    const provider = yield* Provider
    const locks = yield* Locks
    const engineVersion = yield* EngineVersion
    const prompts = yield* Prompts
    // The last event's summary where the last event was a `Thinking`, `undefined` where
    // it was anything else — two facts in one Ref, since a tick with no text after a
    // tick with no text is the repeat, and after a `ToolUse` it is not.
    const thinking = yield* Ref.make<{ readonly text: string | undefined } | undefined>(undefined)
    const session = yield* Ref.make<SessionId | undefined>(undefined)
    const level = yield* Ref.make<string | undefined>(undefined)
    // Each view being kept runs beside the turn, never inside `record`: its answers
    // are lines of the same stream `record` is called from, so waiting for one here
    // would stop the stream that carries it. The turn waits for them at its end.
    const keepView = yield* viewKeeper(id, position, request.sessionId, request.model)
    const views = yield* Scope.make()
    const keeping = yield* Ref.make<readonly Fiber.RuntimeFiber<void>[]>([])
    // How many of `rejoined` the replay has passed. While some are left, the events are
    // the dead engine's: metered, but neither written down nor sent to the Observer again,
    // and a view they left is not kept twice.
    const matched = yield* Ref.make(0)
    const rejoined = rejoin?.written ?? []
    const minted = request.sessionId
    const record = (e: ProviderEvent): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* onLive(e)
        const replaying = (yield* Ref.get(matched)) < rejoined.length
        if (e._tag === "McpReturned") {
          if (replaying) return
          const fiber = yield* Effect.forkIn(keepView(e), views)
          yield* Ref.update(keeping, (all) => [...all, fiber])
          return yield* observer.agentEvent(e)
        }
        // Three events repeat inside one turn without anything having happened twice: a
        // burst of thinking ticks, the session Claude re-announces each time it picks
        // it back up to drain background work — three times on the captured background
        // turn, all the same id — and a background level naming the set the last one
        // already named, which teardown emits as a same-millisecond burst, one per task
        // it is stopping. Each is one line. The level's memory survives the events
        // between two levels, unlike `thinking`'s: REPLACE semantics make an unchanged
        // set say nothing whatever arrived in the gap.
        const lastThought = yield* Ref.get(thinking)
        const repeat =
          (e._tag === "Thinking" && lastThought !== undefined && lastThought.text === e.text) ||
          (e._tag === "SessionStarted" && (yield* Ref.get(session)) === e.id) ||
          (e._tag === "BackgroundTasks" && (yield* Ref.get(level)) === levelKey(e.tasks))
        yield* Ref.set(thinking, e._tag === "Thinking" ? { text: e.text } : undefined)
        if (e._tag === "SessionStarted") yield* Ref.set(session, e.id)
        if (e._tag === "BackgroundTasks") yield* Ref.set(level, levelKey(e.tasks))
        // Metered before the de-duplication below, and off the event rather than
        // the line: what a turn spent must not depend on how the transcript
        // chooses to write it down. Updated per event rather than summed at the
        // end because a turn that dies mid-flight still spent what it spent, and
        // `orRecordFailure` reads this Ref to say so.
        const spent = yield* Ref.updateAndGet(usage, (m) => metered(m, e))
        // And onto the run record at each report, because a stop interrupts this
        // fiber and the Ref dies with it: the stop route reads the record before
        // the kill, and that read is the only place the killed turn's spend survives.
        // A context reading writes it too, so a stopped turn says how full its
        // window was at its last call.
        if (e._tag === "Usage" || e._tag === "Occupancy") {
          yield* runs.spent(id, spent.usage, spent.estimate).pipe(Effect.ignore)
        }
        // A reading is metered and not written down: one arrives per model call, and
        // a line per call would be a transcript of readings around the turn's rows.
        // What the turn spent is on its ending; the last reading rides there too.
        const reading = e._tag === "Occupancy" || e._tag === "ContextWindow"
        let unsaid = replaying
        if (!repeat && !reading) {
          const line = entryOf(e)
          const against = rejoinedLine(rejoined, yield* Ref.get(matched), line)
          yield* Ref.set(matched, against.matched)
          unsaid = against.skip
          const now = yield* Clock.currentTimeMillis
          if (!against.skip) {
            yield* store.appendTranscript(id, carried(line, position, now)).pipe(Effect.ignore)
          }
        }
        if (!unsaid) yield* observer.agentEvent(e)
        if (e._tag === "Spawned") yield* recordSpawned(runs, id, e)
        // **Every message still waiting is handed to the process the moment it
        // exists**: the pipe is registered before `Spawned` is emitted, so this is
        // the first point a write can land, and it is one delivery path for a message
        // sent a second ago and one a restart found on the log. A re-ask spawns
        // again and is handed whatever the last process did not hear. The answer is
        // not read: heard is `MessageDelivered` below, and unheard stays waiting.
        if (e._tag === "Spawned") {
          const waiting = replayHistory(
            id,
            yield* store.events(id).pipe(Effect.orElseSucceed(() => [])),
          )
          const steer = steerInto(prompts, provider, minted, request.cwd)
          yield* Effect.forEach(waiting.messages, steer, { discard: true })
        }
        if (e._tag === "MessageDelivered" && e.key !== undefined) {
          yield* markHeard(store, locks, engineVersion, id, e.key)
        }
        // The first announcement is the session; a re-announcement carries the same id.
        // It goes onto the run record too, because a turn that never ends on its own —
        // an engine death, a stop, a filing — files its session from the record, and
        // the minted id there names nothing a CLI that mints its own can resume.
        if (e._tag === "SessionStarted" && (yield* Ref.get(announced)) === undefined) {
          yield* Ref.set(announced, e.id)
          yield* runs.announced(id, e.id).pipe(Effect.ignore)
        }
      })
    return yield* Effect.provideService(effect, Transcript, { record }).pipe(
      // A turn that answered waits for its views: each is a request the CLI answers
      // before it exits, or one the closing pipe has already failed. A turn that did
      // not answer leaves them to the scope.
      Effect.tap(() => Effect.flatMap(Ref.get(keeping), Fiber.joinAll)),
      Effect.ensuring(Scope.close(views, Exit.void)),
    )
  })

/**
 * Keep the view an MCP tool's call left, for one turn: the tool's HTML read through
 * the CLI that made the call, stored with the call's arguments and its result, and a
 * `View` line written once all of it is on disk.
 *
 * **The tool list is asked for at the first call rather than at the spawn**, and asked
 * again for a call it does not name: a server still connecting when the turn starts
 * lists nothing, and a server whose tool was just called has connected. Most turns
 * call no MCP tool and ask nothing.
 *
 * **Nothing here fails the turn.** A CLI that will not answer, a tool with no view and
 * a store that cannot write all leave the call drawn as the ordinary call it also is.
 */
const viewKeeper = (id: TrakId, position: TurnPosition, minted: SessionId, model: string) =>
  Effect.gen(function* () {
    const store = yield* Store
    const provider = yield* Provider
    const listed = yield* Ref.make<readonly McpTool[]>([])
    const relist = Effect.gen(function* () {
      const answer = yield* provider.mcp(minted, McpRequest.ListTools())
      const tools = answer?._tag === "Tools" ? answer.tools : []
      yield* Ref.set(listed, tools)
      return tools
    })
    return (e: Extract<ProviderEvent, { readonly _tag: "McpReturned" }>): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (!isViewKey(e.call)) return
        const tool =
          calledTool(yield* Ref.get(listed), e.server, e.tool) ??
          calledTool(yield* relist, e.server, e.tool)
        if (tool?.view === undefined) return
        const read = yield* provider.mcp(
          minted,
          McpRequest.ReadResource({ server: tool.server, uri: tool.view }),
        )
        if (read?._tag !== "Resource") return
        yield* store.saveView(
          id,
          e.call,
          McpView.make({
            server: tool.server,
            tool: tool.name,
            uri: tool.view,
            html: read.resource.text,
            ...(read.resource.policy === undefined ? {} : { policy: read.resource.policy }),
            arguments: e.arguments,
            result: e.result,
            callable: openToViews(yield* Ref.get(listed), tool.server).map((t) => ({
              name: t.name,
              callName: t.callName,
            })),
            model,
          }),
        )
        const line = ViewEntry.make({
          call: e.call,
          server: tool.server,
          tool: tool.name,
          uri: tool.view,
        })
        yield* store.appendTranscript(id, carried(line, position, yield* Clock.currentTimeMillis))
      }).pipe(
        Effect.catchTags({
          McpFailed: (why) => Effect.logDebug(`view for ${e.call} not kept: ${why.reason}`),
          StoreFailed: (why) => Effect.logDebug(`view for ${e.call} not kept: ${why.reason}`),
        }),
      )
  })

/**
 * How a store write a turn cannot do without is tried again: three more times, a tenth
 * of a second apart and doubling. The waits between tries add under a second to the turn's
 * stream; each try still waits for its own answer, up to the store's request timeout.
 */
const STORE_WRITE_RETRIES = Schedule.intersect(
  Schedule.exponential("100 millis"),
  Schedule.recurs(3),
)

/**
 * The agent's pid and exec id onto the run record, tried again on a refusal. **A record
 * without them reads, after a restart, as a turn whose command nothing is attached to**,
 * and the boot sweep stops a detached command that was still working — so a write that
 * still fails is logged rather than dropped, and the turn goes on: the agent is already
 * running, and failing the turn would stop it for certain. Exported for the e2e tier.
 */
export const recordSpawned = (
  runs: RunsShape,
  id: TrakId,
  e: { readonly pid: number; readonly execId?: string; readonly detached?: boolean },
): Effect.Effect<void> =>
  runs.spawned(id, e.pid, e.execId, e.detached).pipe(
    Effect.retry(STORE_WRITE_RETRIES),
    Effect.catchTag("StoreFailed", (why) =>
      Effect.logError(
        `trak ${id}: agent pid ${String(e.pid)}${e.execId === undefined ? "" : `, exec ${e.execId}`} is not on the run record, so a restart may stop it as nobody's: ${why.reason}`,
      ),
    ),
  )

/**
 * The session a finished turn is recorded under: the one the provider announced,
 * and the minted one only where it announced none.
 *
 * A CLI that takes the id it is given announces that same id back, so for it the two
 * are one. A CLI that mints its own (`ResumeStrategy.ReportedId`) never knew the minted
 * id, and a log carrying it would name a conversation nothing can resume — not a
 * retry, not a person in a terminal. The runtime does not ask which kind it is talking
 * to: the announcement is the fact, and the strategy is what says why it may differ.
 */
const recordedSession = (
  announced: Ref.Ref<SessionId | undefined>,
  minted: SessionId,
): Effect.Effect<SessionId> => Effect.map(Ref.get(announced), (s) => s ?? minted)

/**
 * A turn in a sandboxed checkout, or in the project's sandbox — refused on a CLI that signs in through a file, which
 * would put the credential in the sandbox — with its session kept on this machine as well: copied
 * in first where this machine's copy is newer — a sandbox made again after it was lost —
 * and back after the turn however it ends, so a session outlives the sandbox it ran in.
 * Under an external store the store keeps a copy too: put after the copy back, and taken into
 * this machine's home before the copy in where it is newer, so an engine copy on another
 * machine resumes the session.
 * **A copy that fails is logged and the turn's outcome stands**, as a fetch's does: the
 * session in the sandbox is intact, and the next turn's copy carries it. A sandbox that
 * cannot be readied is not a copy failing, and fails the turn before it spawns.
 * The put in the store is tried again with backoff, and one that still fails is also a
 * `note` on the transcript: until a later turn stores it, a copy on another machine
 * resumes from an older session, and the person is the one who would resume there.
 * Exported for the contract tier, which holds it to a real sandbox.
 */
export const withSessionCopies =
  (
    request: SessionRequest,
    announced: Ref.Ref<SessionId | undefined>,
    note: (text: string) => Effect.Effect<void>,
  ) =>
  <A, E, R>(turn: Effect.Effect<A, E, R>): Effect.Effect<A, E | ProviderFailed, R | Provider> =>
    Effect.gen(function* () {
      const sandboxes = Option.getOrUndefined(yield* Effect.serviceOption(Sandboxes))
      const place =
        sandboxes === undefined
          ? undefined
          : request.inProject === true
            ? yield* sandboxes.project
            : yield* sandboxes.placeOf(request.cwd)
      if (sandboxes === undefined || place === undefined) return yield* turn
      const provider = yield* Provider
      const signIn = provider.signInFileFor(request.model)
      if (signIn !== undefined) {
        const cli = provider.cliFor(request.model) ?? request.model
        return yield* new ProviderFailed({
          provider: cli,
          reason: `${cli} signs in through ~/${signIn}, a file, and a sandbox is never handed a credential in a file — so a turn on ${request.model} cannot run under this project's runner. Give this agent a model that is not ${cli}'s.`,
        })
      }
      const fileOf = (id: SessionId) => provider.sessionFileFor(request.model, place.path, id)
      const logged = (what: string, copy: Effect.Effect<void, GitFailed>): Effect.Effect<void> =>
        Effect.catchTag(copy, "GitFailed", (e) =>
          Effect.logWarning(`${place.trak}: the session was not ${what}: ${e.reason}`),
        )
      const stored = Option.getOrUndefined(yield* Effect.serviceOption(StoredSessions))
      const kept = (what: string, copy: Effect.Effect<void, StoreFailed>): Effect.Effect<void> =>
        Effect.catchTag(copy, "StoreFailed", (e) =>
          Effect.logWarning(`${place.trak}: the session was not ${what}: ${e.reason}`),
        )
      // A rejoined command is writing its session in the sandbox now, and the copy here is
      // older: copying it in would put the dead engine's last copy over the live file.
      const from = request.reattach === undefined ? request.resumeFrom : undefined
      const resumed = from === undefined ? undefined : fileOf(from)
      if (from !== undefined && resumed !== undefined) {
        // Awake first and outside `logged`: this may be the work that finds the sandbox
        // lost, and a remake that fails fails the turn rather than reading as a session
        // that was not copied.
        yield* Effect.scoped(sandboxes.awake(place.trak)).pipe(
          Effect.mapError(
            (e) =>
              new ProviderFailed({
                provider: provider.cliFor(request.model) ?? request.model,
                reason: `the sandbox for ${place.trak} could not be readied: ${e.op}: ${e.reason}`,
                ...(e.runner === undefined ? {} : { runner: e.runner }),
                ...(e.carried === undefined ? {} : { carried: e.carried }),
              }),
          ),
        )
        // Before the copy in, which then carries the store's copy into a sandbox that has
        // none or an older one.
        if (stored !== undefined) yield* kept("taken from the store", stored.restore(resumed))
        const held = yield* sandboxes
          .copyHomeIn(place.trak, resumed)
          .pipe(
            Effect.catchTag("GitFailed", (e) =>
              Effect.as(
                Effect.logWarning(`${place.trak}: the session was not copied in: ${e.reason}`),
                true,
              ),
            ),
          )
        // Said before the turn, so the person reads why it is about to fail before the CLI's
        // own error arrives. Nothing starts a new session here: that is a person's press.
        if (!held) {
          const missing = `The session ${from} has no file at ~/${resumed} on this machine or in the sandbox, so this turn has nothing to resume.`
          yield* Effect.logWarning(`${place.trak}: ${missing}`)
          yield* note(missing)
        }
      }
      const back = Effect.flatMap(Ref.get(announced), (id) => {
        const file = fileOf(id ?? request.sessionId)
        if (file === undefined) return Effect.void
        const copied = logged("copied back", sandboxes.copyHomeBack(place.trak, file))
        if (stored === undefined) return copied
        const put = stored.save(file).pipe(
          Effect.retry(STORE_WRITE_RETRIES),
          Effect.tapError((e) =>
            note(
              `The session was not put in the store: ${e.reason}. An engine copy on another machine resumes this trak from the last session it stored until a later turn here stores this one.`,
            ),
          ),
        )
        return Effect.zipRight(copied, kept("put in the store", put))
      })
      return yield* Effect.ensuring(turn, back)
    })

/**
 * The MCP servers one session dials, as the request's `mcpServers`: what `mcp.yaml`
 * declares, filled from the engine's own environment, with the engine's servers laid
 * over them. The key is left out where there is no server at all.
 *
 * **Every line is written before the turn, on every turn** — a server left out and why,
 * and every problem with the file — through `note`, into the transcript a person reads
 * the turn in. None of them fails the session: a missing tool is the whole cost.
 */
const sessionServers = <R>(
  lib: Library,
  own: Readonly<Record<string, McpServer>>,
  note: (text: string) => Effect.Effect<void, never, R>,
  reached?: ReachedTools,
) =>
  Effect.gen(function* () {
    const resolved = yield* declaredServers(yield* Environment, lib)
    yield* Effect.forEach(resolved.lines, note, { discard: true })
    const servers = {
      ...resolved.servers,
      ...reachedConnections(lib, resolved.servers, reached),
      ...own,
    }
    return Object.keys(servers).length === 0 ? {} : { mcpServers: servers }
  })

/**
 * Each `connection:` server the host would hand a token for, as the engine's route that
 * proxies it, for a session in a sandbox — where the stdio proxy's command is not. One the
 * host refused is already left out, with its line.
 */
const reachedConnections = (
  lib: Library,
  servers: Readonly<Record<string, McpServer>>,
  reached: ReachedTools | undefined,
): Readonly<Record<string, McpServer>> =>
  reached === undefined
    ? {}
    : Object.fromEntries(
        connectionsOf(lib.mcp).flatMap((s) =>
          s.name in servers ? [[s.name, reached.connection(s.name)]] : [],
        ),
      )

/** A `sessionServers` note on a trak's transcript; one that could not be written is logged. */
const trakNote =
  (id: TrakId, position: TurnPosition) =>
  (text: string): Effect.Effect<void, never, Store> =>
    Effect.gen(function* () {
      const line = carried(NoteEntry.make({ text }), position, yield* Clock.currentTimeMillis)
      yield* (yield* Store).appendTranscript(id, line)
    }).pipe(Effect.catchTag("StoreFailed", (e) => Effect.logDebug(`mcp note: ${e.reason}`)))

/** `trakNote` with the store already in hand, for a callback that runs outside this context. */
const noteOn = (id: TrakId, position: TurnPosition) =>
  Effect.map(
    Store,
    (store) => (text: string) => Effect.provideService(trakNote(id, position)(text), Store, store),
  )

/**
 * A step's servers, merged before the key is decided: a declared server must never cost
 * the step its check tool, nor a step with no check tool its declared servers.
 */
const stepServers = (
  lib: Library,
  trak: Trak,
  step: number,
  checks: McpServer | undefined,
  reached: ReachedTools | undefined,
) =>
  sessionServers(
    lib,
    checks === undefined ? {} : { [TRAK_TOOLS]: checks },
    trakNote(trak.id, step),
    reached,
  )

/**
 * The same entry, with the two things the stream cannot say: the position the turn ran
 * for, and when the line was written.
 *
 * A spread rather than a constructor, for the reason `stamped` in `event.ts` is
 * one: there are nine tags and no arm would do anything but copy its own fields.
 *
 * **Here rather than inside a `Store`**, which is where the log's own `recorded` is
 * stamped. Both files are written through one port, but only the transcript is also
 * *published* — `store-publishing` hands a watcher the entry it was given, so a stamp
 * applied deeper would reach the file and not the frame, and a live row would have no
 * time until somebody reloaded it. There is exactly one caller, and it is this one.
 */
const carried = (entry: TranscriptEntry, position: TurnPosition, at: number): TranscriptEntry => ({
  ...entry,
  position,
  at,
})

/**
 * A background level's set as one comparable string — order-free, because the level is a
 * set and the provider promises nothing about the order it lists one in.
 */
const levelKey = (tasks: readonly { readonly id: string }[]): string =>
  tasks
    .map((t) => t.id)
    .sort()
    .join(" ")

// ============================================================================
// Command runners — each returns the single Event its completion produces
// ============================================================================

/**
 * An exhausted `elicit` becomes the agent's own `Failed` output.
 *
 * Letting `ElicitFailed` escape would fail `advance` *after* the state had moved,
 * leaving the trak in `AgentWorking` with no agent and no event able to move it.
 * A command must always produce its event, so "the agent never returned anything
 * usable" is recorded as what it is: the agent failing.
 *
 * This catches `ElicitFailed` **only**, and that is the point. Catching a dropped
 * connection here too would record a transport failure as the agent's verdict on
 * its own work — a different claim about a different party. `orRecordFailure`
 * below is where that half goes.
 *
 * `B` is separate from `A` because `failed` is not a shape a step may return:
 * `AgentStepOutput` does not carry it and `StepOutput` does, so what
 * comes back here is the union of what the agent could have written and what we
 * write when it wrote nothing usable. Which is the honest type — the two have
 * different authors.
 */
const orGiveUp = <A, B, R>(
  effect: Effect.Effect<A, ElicitFailed | ProviderFailed, R>,
  giveUp: (reason: string) => B,
): Effect.Effect<A | B, ProviderFailed, R> =>
  Effect.catchTag(effect, "ElicitFailed", (e) =>
    Effect.succeed(giveUp(`no usable output after ${e.attempts} attempts: ${e.reason}`)),
  )

/**
 * The `Failed` output in the shape a turn comes back in, so the two endings are one
 * value the caller reads the same way.
 *
 * No envelope, and it is not a detail: we wrote this output, the agent did not, so
 * there is no text of the agent's for a surface to take out. Whatever it did write
 * stays on screen whole — which on a turn that gave up is the only account of why.
 */
const wroteNothingUsable = (reason: string): Elicited<Failed> => ({
  value: failed(reason),
  envelope: undefined,
  stopped: [],
})

/** A task the turn's filing stopped, as the log keeps it: named where the provider named it. */
const stoppedTask = (task: Elicited<unknown>["stopped"][number]): StoppedTask => ({
  id: task.id,
  ...(task.description === undefined ? {} : { description: task.description }),
})

/**
 * A provider that failed mid-turn becomes a recorded fact, not a verdict.
 *
 * The same rule `orGiveUp` follows — a command must always produce its event —
 * applied to the other half of what can go wrong in a turn. What differs is
 * *whose* failure it is: nothing about the work was wrong, the world got in the
 * way, so the event says `TurnFailed` and the trak keeps both its worktree and,
 * through `Trak.failedFrom`, the position a human can retry from.
 *
 * `sessionId` rides along because after this the conversation exists nowhere
 * else: a trak that settles cleanly releases its `Runs` custody scope, which
 * clears the `run.json` turn that would otherwise have remembered it.
 *
 * **Only when the session actually started, and under the id it started as.**
 * `ProviderFailed` also covers a non-zero exit at startup — a missing binary,
 * expired auth, a usage limit rejected before the first line — where the CLI never
 * created the session the runtime had already minted an id for. Recording that id
 * anyway makes the retry pass `--resume <id>` for a conversation that does not
 * exist, which fails, which records the same id again: a trak that can never be
 * retried, produced by the very field that exists to make retrying cheap.
 * `announced` is set by `ProviderEvent.SessionStarted` in `withTranscript`, which
 * is the only signal that says the session is real, and absent stays absent —
 * `Events.turnFailed` leaves the key off rather than writing `undefined` into it.
 */
/**
 * What an agent spawn for a turn `owner` owns signs in with, on the CLI `model` selects, or
 * why it may not run — which the turn records as failing before anything is spent, and so
 * parks. The owner is read off the log at each spawn — the trak's or the goal's, as its
 * birth or its last `OwnerChanged` names them — so a turn the engine starts by itself runs on
 * the same credential as one a person started, and a turn after a takeover on the new
 * owner's. `server` is whether the turn runs on this machine rather than in a sandbox.
 */
const credentialFor = (owner: UserId | undefined, model: string, server: boolean) =>
  Effect.gen(function* () {
    const provider = yield* Provider
    return yield* (yield* Environment).credential({
      owner,
      cli: provider.cliFor(model) ?? model,
      signInFile: provider.signInFileFor(model) !== undefined,
      server,
    })
  })

/**
 * Whether no project checkout is in a sandbox: no runner file, or no `Sandboxes` at all. The
 * goal composer's answer, which has no checkout of its own and runs here under a runner too —
 * what the first-user-only rule reads is the project's runner file.
 */
const noRunner: Effect.Effect<boolean> = Effect.flatMap(
  Effect.serviceOption(Sandboxes),
  (sandboxes) =>
    Option.isNone(sandboxes)
      ? Effect.succeed(true)
      : Effect.map(sandboxes.value.inUse, (on) => !on),
)

/**
 * Where a turn with no checkout runs under an external store — the project's sandbox, at the
 * cache checkout's path — or `undefined`, with no external store or no runner, where it runs on
 * this machine as it always has (`Sandboxes.project`).
 */
const projectPlace: Effect.Effect<CheckoutPlace | undefined> = Effect.flatMap(
  Effect.serviceOption(Sandboxes),
  (sandboxes) => (Option.isNone(sandboxes) ? Effect.succeed(undefined) : sandboxes.value.project),
)

/**
 * The project's sandbox started, by placing no files at its checkout's path — for a turn
 * that opens its `reach` tunnel before its spawn's first exec would start the sandbox. The
 * runner refuses `reach` on a stopped sandbox, and the turn then runs without its engine
 * tools. A failure is logged and left to the spawn, which starts the sandbox again and
 * fails with its own reason.
 */
const startedProject = (at: CheckoutPlace): Effect.Effect<void> =>
  Effect.flatMap(Effect.serviceOption(Sandboxes), (sandboxes) =>
    Option.isNone(sandboxes)
      ? Effect.void
      : Effect.catchTag(sandboxes.value.place(at, new Map(), false), "GitFailed", (e) =>
          Effect.logWarning(`the project's sandbox did not start: ${e.reason}`),
        ),
  )

/** The request's share of `credential`: nothing where the spawn runs on what it inherits. */
const signInOf = (credential: TurnCredential): { readonly signIn?: SignIn } =>
  credential.signIn === undefined ? {} : { signIn: credential.signIn }

/**
 * Tell the host a turn failed on authentication with the user's credential it ran on, so the
 * credential reads as refused until it is replaced. The failure itself goes on as it was.
 */
const reportRefused =
  (given: GivenCredential | undefined) =>
  <A, R>(
    turn: Effect.Effect<A, ProviderFailed, R>,
  ): Effect.Effect<A, ProviderFailed, R | Environment> =>
    given === undefined
      ? turn
      : Effect.tapError(turn, (e) =>
          e.kind === "auth"
            ? Effect.flatMap(Environment, (environment) => environment.credentialRefused(given))
            : Effect.void,
        )

/**
 * A rejoined turn whose command its sandbox no longer held at the first attach: this engine
 * read nothing of it, so there is no ending to record and nothing is appended. It never
 * leaves this file — `appended` stops the drive on it, which leaves the trak where the turn
 * began with nothing carrying it: the stopped notice and Resume a dead engine leaves. A `TurnFailed` instead would say the provider failed,
 * and offer Restart, about a turn nobody can say anything of.
 */
class TurnLeft extends Data.TaggedError("TurnLeft")<{ readonly reason: string }> {}

const orRecordFailure =
  (step: number | undefined, announced: Ref.Ref<SessionId | undefined>, usage: Ref.Ref<Metering>) =>
  <R>(effect: Effect.Effect<Event, ProviderFailed, R>): Effect.Effect<Event, TurnLeft, R> =>
    Effect.catchTag(effect, "ProviderFailed", (e) =>
      Effect.gen(function* () {
        if (e.gone === true) return yield* new TurnLeft({ reason: e.reason })
        // The spend is recorded on the way out, not written off. A turn that ran
        // for forty minutes and then lost its connection cost exactly what it
        // cost, and a record that counted only the turns that finished would
        // report the cheap half of a trak's bill.
        return Events.turnFailed(
          step,
          yield* Ref.get(announced),
          e.reason,
          (yield* Ref.get(usage)).usage,
          // Absent when the CLI never reported an in-band error to classify — a
          // missing binary, a non-zero exit — where a kind would be a claim nobody
          // made. See `ProviderFailed`.
          e.kind,
          e,
        )
      }),
    )

/**
 * Where a command runs.
 *
 * `"."` is not a fallback for "the worktree failed" — that path settles the trak
 * — but for a caller running a command *outside* `advance`: `pnpm real:compose`
 * composes against the current directory with no `Vcs` layer at all. Inside the
 * engine every one of these runs after `WorktreeReady`, which is what
 * `test/e2e/worktrees.test.ts` asserts turn by turn.
 */
export const workdir = (trak: Trak): string => trak.worktree?.path ?? "."

/**
 * What a trak's checks and effects are told beyond their checkout: the branch its pull
 * request targets, for a trak on a goal branch, so a script opening one can say so. Unset
 * for every other trak, whose scripts run exactly as they would without a goal.
 */
const targetEnv = (trak: Trak): Readonly<Record<string, string>> =>
  trak.goalBranch === undefined ? {} : { ORKESTRA_TARGET_BRANCH: trak.goalBranch }

/**
 * The trak's own paperwork, written into the worktree on the way into a turn.
 *
 * Rebuilt from the log every time rather than maintained as a lifecycle: it
 * cannot drift, a restart or a replay recreates it for free, and removing the
 * checkout takes it with it.
 *
 * **No worktree, no projection.** `pnpm real:compose` runs with no `Vcs` layer
 * at all and a working directory of `"."` — the human's own checkout, which is
 * the last place this belongs. An offline demo has a worktree of `"."` for the
 * same reason and is covered by `NoWorkspaceLayer` instead, which is where that
 * decision belongs: which world a trak runs in is wiring.
 *
 * `step` is the position about to run, so the projection carries what a step
 * before it filed and nothing later — see `visibleArtifacts`. The composer has
 * no position and passes `undefined`.
 */
const projectTrak = (
  trak: Trak,
  step: number | undefined,
): Effect.Effect<void, WorkspaceFailed, Workspace> =>
  Effect.gen(function* () {
    const worktree = trak.worktree
    if (worktree === undefined) return
    const workspace = yield* Workspace
    yield* workspace.project(`${worktree.path}/${TRAK_DIR}`, projection(trak, step))
  })

/**
 * What a turn needs in its worktree before it may spawn — the paperwork written, and
 * the environment the spawn is given over the inherited one — or the event the turn
 * settles on instead. The projection comes first because the prompt tells the turn to
 * read it; the env script comes just before the spawn, in the worktree — or in the
 * project's sandbox, for a turn `inProject` places there — and is never cached, so this
 * turn and the checks after it resolve it the same way. Last, the host is asked which
 * credential a spawn on `model` runs on (`credentialFor`).
 *
 * Every failure is `TurnFailed` with no session, and `orRecordFailure` records one
 * for the same reason: nothing about the work was wrong, no session was ever started,
 * and a command must always produce its event or the trak strands mid-state.
 */
const readyFor = (
  trak: Trak,
  step: number | undefined,
  model: string,
  inProject?: CheckoutPlace,
): Effect.Effect<
  Either.Either<
    { readonly env: Readonly<Record<string, string>>; readonly credential: TurnCredential },
    Event
  >,
  never,
  Workspace | Environment | Provider
> =>
  Effect.gen(function* () {
    yield* projectTrak(trak, step)
    const environment = yield* Environment
    // In the project's sandbox where the turn runs there. Captured here, the dump of this
    // machine's whole environment would reach the sandbox as the turn's explicit `env`,
    // and `--runners-only` refuses the capture outright.
    const env =
      inProject === undefined
        ? yield* environment.capture(workdir(trak))
        : yield* environment.capture(inProject.path, undefined, { inProject: true })
    // On the server wherever the checkout is not in a sandbox: no runner file, or a trak
    // placed on the host.
    const credential = yield* credentialFor(trak.owner, model, !(yield* underRunner(trak.id)))
    if (credential._tag === "Left") return yield* new EnvironmentFailed({ reason: credential.left })
    return { env, credential: credential.right }
  }).pipe(
    Effect.mapError((e) =>
      Events.turnFailed(
        step,
        undefined,
        e.reason,
        undefined,
        undefined,
        "runnersOnly" in e ? e : undefined,
      ),
    ),
    Effect.either,
  )

/**
 * The branch the trak's latest conflicted merge was aimed at, while no merge has gone in
 * or been dropped since — `undefined` where there is none, or where the conflict named
 * no branch.
 */
const conflictTarget = (history: readonly Event[]): BranchName | undefined => {
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i]
    if (e === undefined) continue
    if (e._tag === "WorkMerged" || e._tag === "Merged" || e._tag === "ChangesDropped") {
      return undefined
    }
    if (e._tag === "Conflicted") return e.into === undefined ? undefined : BranchName.make(e.into)
  }
  return undefined
}

/**
 * `readyFor`, for a step: first the branch a conflict was aimed at, put where a step
 * resolving it can `git merge` it — see `Vcs.carryTarget` — and a failure there is a
 * `TurnFailed` with no session, for `readyFor`'s reason. **Before every step's turn
 * while the conflict stands**, not only the resolving one's: which step resolves it is
 * the composer's choice, and a target that moved since the last turn is brought again.
 * The composer is not given it — it merges nothing.
 */
const stepReady = (trak: Trak, step: number, model: string) =>
  Effect.gen(function* () {
    if (trak.worktree === undefined) return
    const target = conflictTarget(yield* (yield* Store).events(trak.id))
    if (target !== undefined) yield* (yield* Vcs).carryTarget(trak.id, target)
  }).pipe(
    Effect.mapError((e) =>
      Events.turnFailed(
        step,
        undefined,
        "op" in e ? e.message : e.reason,
        undefined,
        undefined,
        "runner" in e ? e : undefined,
      ),
    ),
    Effect.either,
    Effect.flatMap((brought) =>
      brought._tag === "Left"
        ? Effect.succeed(Either.left(brought.left))
        : readyFor(trak, step, model),
    ),
  )

/**
 * The trigger the *prompt* is built from, which is not always the one `decide`
 * asked for.
 *
 * `Interrupted` and `Filing` presume a session: their resume prompts say
 * "Continue." and "file what you have", which is only meaningful to an agent that
 * already holds the request. There is a path where neither has one — a provider
 * that failed before the CLI ever created a session records no session to resume,
 * and a `Stopped` written without one leaves a conversation gate whose slot names
 * none — and sending either sentence into a fresh conversation asks for work from
 * an agent that has not been told what the work is. So a turn with nothing to
 * continue is what it actually is: a first attempt, on the full prompt.
 *
 * Here rather than in `decide` because the domain cannot see it: whether a
 * session survived is a fact about the provider, not about the state machine.
 */
const promptTrigger = (trigger: Trigger, resumeFrom: SessionId | undefined): Trigger =>
  (trigger._tag === "Interrupted" || trigger._tag === "Filing") && resumeFrom === undefined
    ? Triggers.initial()
    : trigger

/**
 * The files a turn's prompt names: what the message it carries was sent with, and — on a
 * fresh session, whose body holds the request — what the request was sent with.
 */
const turnAttachments = (
  trak: Trak,
  trigger: Trigger,
  resumeFrom: SessionId | undefined,
): readonly Attachment[] => [
  ...(resumeFrom === undefined ? trak.attachments : []),
  ...(trigger._tag === "Message" ? (trigger.attachments ?? []) : []),
]

/**
 * The images among `attachments`, read out of the checkout at `cwd` for the turn to carry
 * beside its prompt — through the sandbox where the checkout is in one. Read when the turn
 * starts rather than when the file arrived, because the checkout holds the only copy.
 *
 * **A picture that cannot be read is left off, never the turn failed**: the prompt still
 * names its path, and the agent can open it or say it is gone. The warning is the only
 * other trace, so it names the file.
 */
export const promptImages = (
  cwd: string,
  attachments: readonly Attachment[],
  at?: CheckoutPlace,
): Effect.Effect<readonly PromptImage[]> =>
  Effect.gen(function* () {
    const shown = attachments.filter(isImage)
    if (shown.length === 0) return []
    const sandboxes = Option.getOrUndefined(yield* Effect.serviceOption(Sandboxes))
    const place = at ?? (sandboxes === undefined ? undefined : yield* sandboxes.placeOf(cwd))
    const bytesOf = (a: Attachment): Effect.Effect<Uint8Array | undefined, unknown> =>
      sandboxes === undefined || place === undefined
        ? Effect.tryPromise(() => readFile(join(cwd, a.path)))
        : Effect.map(sandboxes.readInside(place, a.path), (read) =>
            read instanceof Uint8Array ? read : undefined,
          )
    const read = yield* Effect.forEach(shown, (a) =>
      bytesOf(a).pipe(
        Effect.map((bytes) =>
          bytes === undefined
            ? undefined
            : {
                path: join(place?.path ?? cwd, a.path),
                mediaType: a.type,
                data: Buffer.from(bytes).toString("base64"),
              },
        ),
        Effect.catchAll((cause) =>
          Effect.as(
            Effect.logWarning(`attachment ${a.path} in ${cwd} could not be read`, cause),
            undefined,
          ),
        ),
      ),
    )
    return read.filter((image) => image !== undefined)
  })

/**
 * `cwd` for a `SessionRequest`, and `images` beside it where any of `attachments` could be
 * read as one out of the checkout there.
 */
const turnCwd = (cwd: string, attachments: readonly Attachment[], at?: CheckoutPlace) =>
  Effect.map(promptImages(cwd, attachments, at), (images) =>
    images.length === 0 ? { cwd } : { cwd, images },
  )

/** Hand one waiting message to the turn whose pipe `session` holds, running in `cwd`. */
const steerInto =
  (templates: Templates, provider: ProviderRegistry, session: SessionId, cwd: string) =>
  (m: {
    readonly id: string
    readonly message: string
    readonly attachments: readonly Attachment[]
  }) =>
    Effect.flatMap(steeredMessage(templates, m.id, m.message, m.attachments, cwd), (steered) =>
      provider.steer(session, steered),
    )

/**
 * A person's message as a running turn is handed it: the words with the `steered`
 * template's list of their files after them, and the images among those files read out
 * of the checkout at `cwd`.
 */
export const steeredMessage = (
  templates: Templates,
  key: string,
  said: string,
  attachments: readonly Attachment[],
  cwd: string,
  at?: CheckoutPlace,
): Effect.Effect<SteeredMessage> =>
  Effect.gen(function* () {
    if (attachments.length === 0) return { key, text: said }
    const text = render(templates, "steered", { message: said, ...attachedView(attachments) })
    const images = yield* promptImages(cwd, attachments, at)
    return { key, text, ...(images.length === 0 ? {} : { images }) }
  })

/**
 * `work` with the trak at `phase` for its length — see `Preparation`. As it is with no
 * `Preparation` in the context, which is what an offline demo and most tests have.
 */
const preparing = <A, E, R>(trakId: string, phase: PreparingPhase, work: Effect.Effect<A, E, R>) =>
  Effect.flatMap(Effect.serviceOption(Preparation), (held) =>
    duringWith(held)(trakId, phase, () => work),
  )

/**
 * The project's own setup script, if it declares one, in a checkout made again — run
 * before the work that needs it, as `checkoutRemade` and `remakeSandbox` run it.
 *
 * Over the `Checks` port rather than a second way to run a shell script: the
 * contract is identical — a path, a directory, and `exit 0` — and that port
 * already promises never to fail the command it runs from.
 */
const runSetup = (trakId: string, worktree: Worktree): Effect.Effect<Event, never, Lib | Checks> =>
  Effect.gen(function* () {
    const lib = yield* Lib
    const place = yield* checkoutPlace(trakId)
    if (lib.setup === undefined) return Events.worktreeReady(worktree, place)
    const runner = yield* Checks
    const outcome = yield* preparing(
      trakId,
      PreparingPhase.SettingUp(),
      runner.run(lib.setup, worktree.path),
    )
    return outcome.passed
      ? Events.worktreeReady(worktree, place)
      : // The checkout is left behind on purpose. Setup failing is exactly when
        // someone wants to look at what it left half-done.
        Events.worktreeFailed(setupReason(worktree, outcome), outcome, outcome.output)
  })

/**
 * Where the trak's checkout is: in its sandbox, named by the runner's description and the
 * provider's id, under a runner file, and on this machine otherwise. No exec id — this is
 * the checkout's place, not one command's.
 */
const checkoutPlace = (trakId: string): Effect.Effect<Place> =>
  Effect.gen(function* () {
    const { runner } = yield* runnerFilesNow
    const sandboxes = Option.getOrUndefined(yield* Effect.serviceOption(Sandboxes))
    if (runner === undefined || sandboxes === undefined || !(yield* sandboxes.holds(trakId))) {
      return Places.local()
    }
    return Places.remote(runner.description, yield* sandboxes.idOf(trakId))
  })

/** What a failed setup says, as the trak's error. */
const setupReason = (worktree: Worktree, outcome: CheckOutcome): string =>
  `setup failed in ${worktree.path}:\n${outcome.output}`

/** Where under a checkout the setup hook reads — ignored, as `IGNORED_PATHS` says. */
const SETUP_DIR = ".orkestra/.setup"

/** The file `SetupGate.statusFile` names in a checkout. */
const setupStatusOf = (worktree: Worktree): string => `${worktree.path}/${SETUP_DIR}/status`

/**
 * What the setup hook reads, replaced whole: `SetupGate`'s first line, and on a failure
 * what the hook refuses a command with. **A write that fails is logged and the work goes
 * on** — the hook lets a command through where the file is missing, and the engine still
 * stops a turn when setup fails, so a lost write costs a command run early and nothing the
 * trak records.
 */
const statusWritten = (worktree: Worktree, status: string) =>
  Effect.flatMap(Workspace, (workspace) =>
    workspace.project(`${worktree.path}/${SETUP_DIR}`, new Map([["status", status]])),
  ).pipe(
    Effect.catchTag("WorkspaceFailed", (e) =>
      Effect.logWarning(`the setup status in ${worktree.path} was not written: ${e.reason}`),
    ),
  )

/**
 * Whether no command is running for a trak standing here, or about to — a gate, a spawn
 * waiting on its children, a failure or rest. Anywhere else the next command in the
 * checkout is coming, and it reads a failed setup and reports it itself.
 */
const standingStill = (state: TrakState): boolean =>
  asGate(state) !== undefined ||
  state._tag === "AwaitingChildren" ||
  state._tag === "Failed" ||
  atRest(state)

/**
 * A failure nothing waiting will report, appended by the run itself — under the trak's
 * drive key, so it lands once a drive has let go rather than under a command that would
 * then arrive at `Failed`. Only where the trak stands still and the log does not already
 * say how setup ended; a trak still moving reports it from its next work in the checkout.
 * A failure to append is logged, and that same work reports it.
 */
const unreportedFailure = (id: TrakId, worktree: Worktree, outcome: CheckOutcome) =>
  Effect.flatMap(Locks, (locks) =>
    locks.withDrive(id)(
      Effect.gen(function* () {
        const trak = replayHistory(id, yield* (yield* Store).events(id))
        if (trak.setup !== "running" || !standingStill(trak.state)) return
        yield* record(id, Events.setupFailed(setupReason(worktree, outcome), outcome))
      }),
    ),
  ).pipe(
    Effect.catchAll((e) =>
      Effect.logWarning(`${id}: setup's failure was not recorded: ${e.message}`),
    ),
  )

/**
 * The setup script, run in the background: its outcome written where the hook reads it,
 * then handed to whatever waits on it. A pass is appended first, so a turn that waited on
 * it ends after `SetupPassed` on the log. A failure is handed over first, so a turn racing
 * it is killed and reports it as its own ending — with the session it was holding — and the
 * run appends it only where nothing waiting will.
 */
const setupRun = (id: TrakId, worktree: Worktree, setup: Check) =>
  Effect.gen(function* () {
    const outcome = yield* (yield* Checks).run(setup, worktree.path)
    const setups = yield* Setups
    if (outcome.passed) {
      yield* statusWritten(worktree, "passed\n")
      yield* record(id, Events.setupPassed()).pipe(
        Effect.catchAll((e) =>
          Effect.logWarning(`${id}: setup's pass was not recorded: ${e.message}`),
        ),
      )
      yield* setups.settle(id, outcome)
      return
    }
    const refusal = render(yield* Prompts, "setup-failed", { output: outcome.output })
    yield* statusWritten(worktree, `failed\n${refusal}`)
    if (!(yield* setups.settle(id, outcome))) yield* unreportedFailure(id, worktree, outcome)
  })

/**
 * Start the setup script in the background for a trak whose checkout is `worktree`.
 * `announce` writes `SetupStarted` first: the first run, and the retry of a failed one. A
 * run started again for a log that already says it is running — an engine went while it
 * ran — announces nothing.
 */
const beginSetup = Effect.fn("beginSetup")(function* (
  id: TrakId,
  worktree: Worktree,
  setup: Check,
  announce: boolean,
) {
  if (announce) yield* record(id, Events.setupStarted(yield* checkoutPlace(id)))
  yield* statusWritten(worktree, "running\n")
  const context = yield* Effect.context<RuntimeDeps>()
  const run = preparing(id, PreparingPhase.SetupBeside(), setupRun(id, worktree, setup))
  yield* (yield* Setups).start(id, Effect.provide(alone(id, worktree, run), context))
})

/** How often a run waiting on another copy's run of the same setup asks again. */
const SETUP_HELD_POLL = "250 millis"

/**
 * `run` as the one engine copy running this trak's setup. A copy that takes a trak over
 * can start before the copy it took it from has stopped its run — that copy stops it on
 * seeing the lease move, a moment later — so the job's lease is waited for, and two runs
 * never share a checkout. The status goes back to `running` once it is held, over anything
 * the stopped run wrote. With no leases it runs at once.
 */
const alone = <R>(id: TrakId, worktree: Worktree, run: Effect.Effect<void, never, R>) =>
  Effect.flatMap(Locks, (locks) =>
    Effect.asVoid(
      Effect.repeat(
        locks.withJob(`setup/${id}`)(
          Effect.as(Effect.andThen(statusWritten(worktree, "running\n"), run), true),
        ),
        { until: (ran) => ran === true, schedule: Schedule.spaced(SETUP_HELD_POLL) },
      ),
    ),
  )

/**
 * A setup running beside a trak's work in its checkout: how to wait for its outcome, and
 * what a turn's commands are handed to wait on it themselves.
 */
interface SetupBeside {
  readonly worktree: Worktree
  /** Wait for the outcome; `reports` as `Setups.outcome` takes it. */
  readonly outcome: (reports: boolean) => Effect.Effect<CheckOutcome | undefined>
  readonly gate: SetupGate
}

/**
 * The setup this work in the checkout goes on beside, or `undefined` where nothing is
 * left to wait for: no setup script, a log written before setup ran in the background, or
 * a setup that passed.
 *
 * **Started again where the log says it is owed and nothing here runs it** — a failed
 * setup, which is the retry of one, and one the log says is running that this engine
 * never started, which is a restart after the engine went. A `reaches: external` setup is
 * run again too: what it made may not be there, which is the risk a crash before
 * `WorktreeReady` always carried.
 */
const setupBeside = (trak: Trak) =>
  Effect.gen(function* () {
    const setup = (yield* Lib).setup
    const worktree = trak.worktree
    if (setup === undefined || worktree === undefined) return undefined
    if (trak.setup === undefined || trak.setup === "passed") return undefined
    const setups = yield* Setups
    const again = trak.setup === "failed"
    if (again || !(yield* setups.started(trak.id))) {
      yield* beginSetup(trak.id, worktree, setup, again)
    }
    return {
      worktree,
      outcome: (reports: boolean) => setups.outcome(trak.id, reports),
      // A command may wait as long as the script may run, and a minute more for the
      // script's own ending to reach the file.
      gate: { statusFile: setupStatusOf(worktree), waitSeconds: setup.timeoutSeconds + 60 },
    } satisfies SetupBeside
  })

/** `work` once setup has passed, or the `SetupFailed` it ends on instead. */
const afterSetup = <E, R>(beside: SetupBeside | undefined, work: Effect.Effect<Event, E, R>) =>
  beside === undefined
    ? work
    : Effect.flatMap(beside.outcome(true), (outcome) =>
        outcome === undefined || outcome.passed
          ? work
          : Effect.succeed(Events.setupFailed(setupReason(beside.worktree, outcome), outcome)),
      )

/**
 * How a turn meets a setup still running. On a CLI that holds a shell command while setup
 * runs, the turn starts at once with the gate on its request — `Right` of the gate. On any
 * other it waits here for setup first: `Right` of nothing once it passed, `Left` of the
 * `SetupFailed` the turn ends on before it starts.
 */
const turnGate = (beside: SetupBeside | undefined, model: string) =>
  Effect.gen(function* () {
    if (beside === undefined) return Either.right(undefined)
    if ((yield* Provider).gatesCommandsFor(model)) return Either.right(beside.gate)
    const outcome = yield* beside.outcome(true)
    return outcome === undefined || outcome.passed
      ? Either.right(undefined)
      : Either.left(Events.setupFailed(setupReason(beside.worktree, outcome), outcome))
  })

/**
 * A turn started beside a setup still running, raced against that setup failing: the
 * failure kills the turn — its scope closing is what ends the CLI, as a stop's does — and
 * is the turn's ending, carrying the session it held. That is read off the run record
 * before the kill, which destroys it. The turn as it is where no gate was handed out.
 */
const raceSetup = <E, R>(
  id: TrakId,
  beside: SetupBeside | undefined,
  gate: SetupGate | undefined,
  turn: Effect.Effect<Event, E, R>,
): Effect.Effect<Event, E | StoreFailed, R | Runs> => {
  if (beside === undefined || gate === undefined) return turn
  const failure = Effect.flatMap(beside.outcome(true), (outcome) =>
    outcome === undefined || outcome.passed
      ? Effect.never
      : Effect.map(
          Effect.flatMap(Runs, (runs) => runs.inFlight(id)),
          (held) => Events.setupFailed(setupReason(beside.worktree, outcome), outcome, held),
        ),
  )
  return Effect.raceFirst(turn, failure)
}

/**
 * A turn on `model` beside the setup its checkout runs: waited for, or started at once
 * with the gate and raced against setup failing — see `turnGate` and `raceSetup`.
 */
const besideSetup = <E, R, E2, R2>(
  trak: Trak,
  beside: SetupBeside | undefined,
  model: Effect.Effect<string, E2, R2>,
  turn: (gate: SetupGate | undefined) => Effect.Effect<Event, E, R>,
) =>
  Effect.gen(function* () {
    const gate = yield* turnGate(beside, yield* model)
    if (gate._tag === "Left") return gate.left
    return yield* raceSetup(trak.id, beside, gate.right, turn(gate.right))
  })

/** The model the turn at `step` runs on, as `SpawnStep` resolves it. */
const stepModel = (trak: Trak, step: number) =>
  Effect.flatMap(Lib, (lib) =>
    Effect.map(turnAgent(lib, trak, step), (agent) => modelAt(trak, step, lib) ?? agent.model),
  )

/**
 * Git declining, as the `WorktreeFailed` the trak records — with the runner verb behind it,
 * where there was one. Exported for the contract tier, which drives it from a real sandbox.
 */
export const gaveUp = (e: GitFailed): Effect.Effect<Event> =>
  Effect.succeed(Events.worktreeFailed(`${e.op}: ${e.reason}`, e))

/**
 * The trak recorded as placed on this machine where its starting agent — the agent of its
 * first step — sets `place: host` and the host allows it (`vcs/ports/host-traks.ts`).
 * Nothing where either is missing, and nothing with no `HostTraks` in the context.
 */
const placeOnHost = (trak: Trak): Effect.Effect<void, GitFailed, Lib> =>
  Effect.gen(function* () {
    const first = trak.plan?.steps[0]
    if (first === undefined || isSpawn(first) || isCompose(first)) return
    if (agentNamed(yield* Lib, first.agent)?.place !== "host") return
    const hostTraks = Option.getOrUndefined(yield* Effect.serviceOption(HostTraks))
    if (hostTraks === undefined) return
    const placed = yield* hostTraks.place(trak.id)
    yield* Effect.logInfo(
      placed
        ? `${trak.id}: its checkout is on this machine — \`${first.agent}\` sets \`place: host\``
        : `${trak.id}: \`${first.agent}\` sets \`place: host\`, which the host does not allow for this project, so its checkout is where every other trak's is`,
    )
  })

/**
 * Somewhere to work. Nothing runs before this.
 *
 * **Issued three times over a trak's life**, and only one of them is creation:
 * a trak being made, a restart that finds `WorktreeReady` was never written, and
 * a re-entry. `createWorktree` is idempotent for exactly that reason, and the
 * project's setup script is the half that should not be.
 *
 * Two facts decide whether it runs, each honest about what it knows and neither
 * sufficient alone:
 *
 *   · `trak.worktree` is set — **a checkout was prepared at least once**, because
 *     `WorktreeReady` is written only once it is. A crash between `worktree add` and
 *     that leaves this unset, which is what stops a restart skipping a preparation that
 *     never happened.
 *   · `hasCheckout` — **the directory is there now.** Nothing else can say so: the
 *     log knows what the engine did, and a human with `rm -rf` is not the engine.
 *
 * So a re-entered `Finished` trak skips a `pnpm install` into a checkout that
 * already has one, and a re-entered `Closed` trak — or a held one somebody
 * deleted by hand — gets a real preparation. That is the cheap path holding a
 * checkout buys.
 *
 * **A real preparation does not wait for setup.** `SetupStarted` is written and the
 * script started in the background, then `WorktreeReady`, so the first turn starts at
 * once — see `setupBeside` for what waits on it.
 */
const SetupWorktree = Effect.fn("SetupWorktree")(function* (trak: Trak) {
  const vcs = yield* Vcs
  return yield* Effect.gen(function* () {
    // Placed once, before the first checkout is made, so the checkout stays where it began.
    if (trak.worktree === undefined) yield* placeOnHost(trak)
    const prepared = trak.worktree !== undefined && (yield* vcs.hasCheckout(trak.id))
    // `trak.base` is `undefined` for everything a human asked for and for a
    // `standalone` child, which is the host `HEAD` either way.
    const worktree = yield* vcs.createWorktree(trak.id, trak.base)
    // The files sent with the request, which had no checkout to go in until now.
    const uploads = yield* Effect.serviceOption(Uploads)
    if (Option.isSome(uploads)) yield* uploads.value.settle(trak.id, worktree.path)
    const setup = (yield* Lib).setup
    if (!prepared && setup !== undefined) yield* beginSetup(trak.id, worktree, setup, true)
    return Events.worktreeReady(worktree, yield* checkoutPlace(trak.id))
  }).pipe(Effect.catchTag("GitFailed", gaveUp))
})

/**
 * A trak's sandbox made again after its provider lost it: the checkout seeded from this
 * machine's copy of `trak/<id>` — the last fetch, so everything committed — then the
 * project's setup script, as `SetupWorktree` runs it for a checkout that is not there.
 * Uncommitted work since the last fetch is gone. Handed to `Sandboxes.remakeWith` at
 * boot, and run by the first work after the loss, before that work's own command.
 *
 * **An `external` setup is not run again**, and the line says so: the sandbox is new and
 * the resource the script made is not, so running it a second time makes a second one
 * rather than finding the first. A `local` setup — and one with no key, which is every
 * setup written before the key existed — runs on every sandbox the trak is given,
 * because nothing of what it made survived the one before. See `Check.reaches`.
 *
 * Nothing calls this without a runner: it is what `remakeWith` is handed.
 */
export const remakeSandbox = Effect.fn("remakeSandbox")(function* (trakId: string) {
  const worktree = yield* (yield* Vcs).createWorktree(trakId)
  const lib = yield* Lib
  if (lib.setup === undefined) return
  if (lib.setup.reaches === "external") {
    return yield* Effect.logInfo(
      `${trakId}: the setup is not run in the sandbox made for it — it declares \`reaches: external\`, so what it made the first time is still there`,
    )
  }
  const outcome = yield* preparing(
    trakId,
    PreparingPhase.SettingUp(),
    (yield* Checks).run(lib.setup, worktree.path),
  )
  if (!outcome.passed) {
    return yield* new GitFailed({
      op: "set up remade sandbox",
      reason: `setup failed in ${worktree.path}:\n${outcome.output}`,
    })
  }
})

/**
 * A prepared trak's checkout made again where it went missing — deleted by hand, or
 * not restored with the rest of the project — as `remakeSandbox` makes a lost sandbox:
 * from `trak/<id>`, then the setup script. `undefined` where the work can go ahead, and
 * otherwise the `WorktreeFailed` it ends on. A checkout that is there is never touched,
 * and under a runner `Vcs.remakeCheckout` leaves it to the sandboxes.
 *
 * **A remade checkout whose setup failed is taken away again**, unlike the first
 * preparation's: the trak has a `WorktreeReady` already, so nothing else would run
 * setup on the retry, and the next work would run in a checkout with nothing installed.
 * Its branch and refs stay, so the retry makes it again.
 */
const checkoutRemade = Effect.fn("checkoutRemade")(function* (trak: Trak) {
  if (trak.worktree === undefined) return undefined
  const vcs = yield* Vcs
  return yield* Effect.gen(function* () {
    const worktree = yield* vcs.remakeCheckout(trak.id)
    if (worktree === undefined) return undefined
    yield* Effect.logWarning(
      `${trak.id}: the checkout at ${worktree.path} was gone, and is made again from ${worktree.branch}`,
    )
    const setup = yield* runSetup(trak.id, worktree)
    if (setup._tag === "WorktreeReady") return undefined
    // The checkout alone: `removeWorktree` would take an empty branch with it, and the
    // retry would have nothing to make the checkout from.
    yield* vcs.removeCheckout(worktree)
    return setup
  }).pipe(Effect.catchTag("GitFailed", gaveUp))
})

/**
 * Work that runs in the trak's checkout, once there is one — see `checkoutRemade` — handed
 * the setup it goes on beside — see `setupBeside`.
 */
const inCheckout = <E, R>(
  trak: Trak,
  work: (beside: SetupBeside | undefined) => Effect.Effect<Event, E, R>,
) =>
  Effect.flatMap(checkoutRemade(trak), (refused) =>
    refused === undefined ? Effect.flatMap(setupBeside(trak), work) : Effect.succeed(refused),
  )

/**
 * A trak's sandbox made again as `remakeSandbox` makes a lost one — because another engine
 * version seeded it, or because a person pressed Rebuild. Its branch is fetched to this
 * machine first, so the new sandbox starts from every commit, then the sandbox released.
 * **Uncommitted and untracked files are carried across**: kept by `Vcs.carryOut` before
 * the release and put back by `Vcs.carryIn` once the setup has run, so what the setup
 * writes cannot overwrite them. Files git ignores are not carried — the setup makes the
 * installed ones again. Kept as it is where its checkout could not be read, and where
 * `refs/orkestra/carried/<trak>` still holds changes an earlier remake left behind — a
 * capture would overwrite them, so `carryOut` refuses.
 *
 * A failure after the release fails the work, as a lost sandbox's remake does, and the
 * next work makes it again from the branch — so changes that did not apply are not in the
 * checkout after that, and the failure names the ref that still holds them.
 */
export const renewSandbox = (trakId: string, checkout: string) =>
  preparing(trakId, PreparingPhase.Rebuilding(), renewed(trakId, checkout))

const renewed = Effect.fn("renewSandbox")(function* (trakId: string, checkout: string) {
  const vcs = yield* Vcs
  const read = yield* Effect.gen(function* () {
    const changed = yield* vcs.dirty({
      path: WorktreePath.make(checkout),
      branch: branchFor(trakId),
    })
    if (changed.length > 0) yield* vcs.carryOut(trakId)
    yield* vcs.fetchWork(trakId)
    return { carried: changed.length > 0 } as const
  }).pipe(Effect.catchTag("GitFailed", (e) => Effect.succeed({ kept: `${e.op}: ${e.reason}` })))
  if ("kept" in read) {
    return yield* Effect.logWarning(
      `${trakId}: the sandbox is not made again and is kept as it is: ${read.kept}`,
    )
  }
  yield* (yield* Sandboxes).release(trakId)
  if (!read.carried) return yield* remakeSandbox(trakId)
  yield* remakeSandbox(trakId).pipe(
    Effect.mapError(
      (e) =>
        new GitFailed({
          op: e.op,
          reason: `${e.reason} — the sandbox's uncommitted changes were not put back, and are kept at ${carriedRefFor(trakId)}`,
          carried: carriedRefFor(trakId),
        }),
    ),
  )
  yield* vcs.carryIn(trakId)
  yield* Effect.logInfo(
    `${trakId}: the sandbox is made again, its uncommitted changes carried across`,
  )
})

/**
 * Keep the work: everything in the checkout, onto the branch. The checkout stays
 * — taking it away is `RemoveWorktree`, which a person asks for and, for a child,
 * the trak's run mode asks for on their behalf. See `endsUnattended`.
 */
const CommitWork = Effect.fn("CommitWork")(function* (
  trak: Trak,
  cmd: Extract<Command, { _tag: "CommitWork" }>,
) {
  const worktree = trak.worktree
  // No worktree to commit: a caller that ran the engine without a real `Vcs`,
  // which is what the offline demos do.
  if (worktree === undefined) return Events.workCommitted(undefined, cmd.step)
  const vcs = yield* Vcs
  return yield* vcs.commitWork(worktree, commitMessage(trak, cmd.step)).pipe(
    Effect.map((sha) => Events.workCommitted(sha, cmd.step)),
    Effect.catchTag("GitFailed", (e) => droppedUnreached(trak, worktree, e)),
  )
})

/**
 * A drop's commit whose sandbox could not be reached. Where nothing ran in the checkout
 * since the last commit there is nothing for it to commit, so the drop carries on to the
 * removal at that commit — and the removal releases the sandbox only once this machine's
 * branch is confirmed there. Anything else gives up, as every other commit does.
 */
const droppedUnreached = Effect.fn("droppedUnreached")(function* (
  trak: Trak,
  worktree: Worktree,
  e: GitFailed,
) {
  if (trak.state._tag !== "Abandoning" || !isUnreached(e.runner)) return yield* gaveUp(e)
  const kept = atLastCommit(trak, yield* (yield* Store).events(trak.id))
  if (kept._tag !== "At") return yield* gaveUp(e)
  yield* Effect.logWarning(
    `${trak.id}: the drop's commit could not reach the sandbox, and nothing ran in it since ${kept.head}; the removal checks this machine holds that commit: ${e.reason}`,
  )
  return Events.workCommitted(kept.head === worktree.base ? undefined : kept.head)
})

/**
 * What GitHub says this branch's pull request merged as, asked **once, at the
 * press**. Only a person's plain close still owes the answer: a local merge, a
 * landed wait and the forge sweep's close each already put the sha on `Closing`,
 * and an abandon ends `Abandoned` whatever the forge says, so none of them spends
 * the call.
 *
 * `Unavailable` and `None` both come back as *no sha*, and neither gates the
 * deletion — GitHub's answer decides what the trak ends as, never how much is
 * deleted. The trak then ends `Closed`, and the row is still there for another
 * press once the forge answers again.
 */
const mergedOnForge = Effect.fn("mergedOnForge")(function* (trak: Trak, branch: BranchName) {
  if (trak.state._tag !== "Closing" || trak.state.merged !== undefined) return undefined
  const answer = yield* (yield* Forge).pullRequest(branch)
  if (answer._tag !== "Found") return undefined
  const pull = answer.pullRequest
  return pull.state === "merged" && pull.mergeCommit !== undefined
    ? CommitSha.make(pull.mergeCommit)
    : undefined
})

/**
 * A drive's command, as the trak's own work in its sandbox — see `Sandboxes.asWork`. As it
 * is with no `Sandboxes` in the context, which is what an offline demo has.
 */
const asWork = <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.flatMap(Effect.serviceOption(Sandboxes), (sandboxes) =>
    Option.isNone(sandboxes) ? work : sandboxes.value.asWork(work),
  )

/**
 * Whether `trak`'s checkout is in a sandbox now — `false` with no runner file, for a trak
 * placed on this machine, and with no `Sandboxes` in the context at all, which is what an
 * offline demo has.
 */
const underRunner = (trak: TrakId): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const sandboxes = Option.getOrUndefined(yield* Effect.serviceOption(Sandboxes))
    return sandboxes === undefined ? false : yield* sandboxes.holds(trak)
  })

/**
 * The project's teardown script, if it declares one, in the checkout about to go: `blocked`
 * is the removal refused, and its absence is *go ahead*. `place` is where the script ran,
 * absent where it did not run.
 *
 * A failure blocks rather than warns: removing anyway deletes the one directory
 * the script can run in, and whatever it was meant to drop is leaked for good.
 * `Closing` has git in flight, so the trak parks `Failed{archive}` with the
 * checkout and branch intact, and a resume re-issues `RemoveWorktree` — the retry.
 *
 * No checkout, no script: `env.sh` derives per-worktree names from the directory,
 * and running from anywhere else could drop another worktree's database.
 *
 * **Under a runner the script's `reaches:` decides whether it runs at all.** The
 * release that follows destroys the sandbox whole, so a `local` teardown is skipped
 * before anything is asked of the sandbox — one fewer `exec` to fail an archive on,
 * which is the point. An `external` one still runs here, before the release, because
 * what it drops is somewhere the release cannot reach. A script with no key runs, with
 * the line that says declaring one would have skipped it. See `Check.reaches`.
 *
 * Takes the id rather than the trak: it reads nothing else, and the contract tier
 * drives it from a real sandbox with no trak in the log.
 */
export const runTeardown = Effect.fn("runTeardown")(function* (trak: TrakId, worktree: Worktree) {
  const lib = yield* Lib
  const teardown = lib.teardown
  const skipped: Teardown = {}
  if (teardown === undefined) return skipped
  const sandboxed = yield* underRunner(trak)
  if (sandboxed && teardown.reaches === "local") {
    yield* Effect.logInfo(
      `${trak}: the teardown is not run — it declares \`reaches: local\`, and releasing the sandbox takes everything it would have undone`,
    )
    return skipped
  }
  if (!(yield* (yield* Vcs).hasCheckout(trak))) return skipped
  if (sandboxed && teardown.reaches === undefined) {
    yield* Effect.logInfo(
      `${trak}: the teardown runs in the sandbox before it is released; declare \`reaches: local\` on it to skip it, or \`reaches: external\` to say it drops something the release cannot reach`,
    )
  }
  const outcome = yield* (yield* Checks).run(teardown, worktree.path)
  const ran: Teardown = outcome.place === undefined ? {} : { place: outcome.place }
  return outcome.passed
    ? ran
    : {
        ...ran,
        blocked: Events.worktreeFailed(
          `teardown failed in ${worktree.path}:\n${outcome.output}`,
          outcome,
        ),
      }
})

/** What `runTeardown` answers. */
interface Teardown {
  readonly blocked?: Event
  readonly place?: Place
}

/**
 * What the removal runs in the trak's sandbox: `Held` where there is nothing to run
 * there at all, and the release takes the lot. Everything the archive would have sent
 * in — the process stops, the teardown, the last fetch — is then skipped, which is one
 * fewer way for it to fail on a sandbox that cannot be reached.
 *
 * A teardown still due in the checkout makes it `Reach` however safe the work is: what an
 * `external` one drops is somewhere the release cannot. `removalFor` answers `Held` only
 * under a runner, so a `local` teardown here is one `runTeardown` is about to skip.
 */
const removalOf = Effect.fn("removalOf")(function* (worktree: Worktree, kept: KeptWork) {
  const removal = yield* (yield* Vcs).removalFor(worktree, kept)
  if (removal._tag !== "Held") return removal
  const teardown = (yield* Lib).teardown
  return teardown === undefined || teardown.reaches === "local" ? removal : Removal.Reach({ kept })
})

/**
 * Take the checkout away — and the branch, its recorded base ref and its copy on
 * `origin` with it, whatever is on them. This is the archive: a person confirmed
 * it, and the confirmation is the whole of the guard. `CommitWork` has already
 * run, so everything tracked was on the branch when they did.
 *
 * Its hosted processes are stopped first, then `teardown.sh`, while there is still a
 * checkout to run it in; then
 * `removeWorktree`, for its conditional cleanup and its pruning;
 * `deleteBranch` after, unconditionally. The forge is asked before anything is
 * deleted, so the sha is in hand however GitHub treats a pull request whose
 * branch has just gone — and before the teardown, because what it answers is half of
 * whether anything runs in the sandbox at all.
 *
 * Exported for the contract tier, which drives it over a real sandbox to count what it
 * sent in there.
 */
export const RemoveWorktree = Effect.fn("RemoveWorktree")(function* (trak: Trak) {
  // Before anything takes the checkout away: a setup still running in it is ended, and
  // writes nothing after. A close or a merge from `Finished` reaches here with one going.
  yield* (yield* Setups).stop(trak.id)
  const hosted = yield* HostedProcesses
  const worktree = trak.worktree
  // Same guard as `CommitWork`, and the same caller: nothing to remove is the
  // whole of what an offline demo's `Vcs` has.
  if (worktree === undefined) {
    yield* hosted.stopAll(trak.id)
    return Events.worktreeRemoved()
  }
  const vcs = yield* Vcs
  return yield* Effect.gen(function* () {
    const sha = yield* mergedOnForge(trak, worktree.branch)
    const history = yield* (yield* Store).events(trak.id)
    const removal = yield* removalOf(worktree, keptWork(trak, history, sha !== undefined))
    // Before `teardown.sh`, which may drop what a server is still using, and before the
    // checkout goes from under a process whose working directory it is. Not where the
    // sandbox is released untouched: a process there goes with it, and stopping one
    // reads its declaration out of the checkout, which is an `exec` into the sandbox.
    if (removal._tag === "Reach") yield* hosted.stopAll(trak.id)
    const torn = yield* runTeardown(trak.id, worktree)
    if (torn.blocked !== undefined) return torn.blocked
    yield* vcs.removeWorktree(worktree, removal)
    yield* vcs.deleteBranch(worktree)
    return Events.worktreeRemoved(sha, torn.place)
  }).pipe(Effect.catchTag("GitFailed", gaveUp))
})

/**
 * The titles a chat's envelope may name when a document stands: the document's, so
 * an edit replaces the section it meant rather than appending beside it, and the
 * agent's declared ones, so an optional section the first filing left out can still
 * arrive. See `StepOutputFor`.
 */
const amendableTitles = (standing: Document, agent: Agent): readonly string[] => [
  ...new Set([...Object.keys(standing.sections), ...declaredTitles(agent)]),
]

/** What a step turn is decoded against: the whole shape, or an amendment where a document stands. */
const stepSchema = (agent: Agent, standing: Document | undefined, visible: readonly string[]) =>
  StepOutputFor(
    requiredTitles(agent),
    visible,
    standing === undefined ? undefined : amendableTitles(standing, agent),
  )

/**
 * Whether a `permission: write` agent is refused on this trak: its branch has landed,
 * or it is a spawn's child and its parent's has. One reading for the two places that
 * refuse — the composer's decode and the step's entry — and for the one that narrows
 * instead: the engine's own agent, asked a question through the re-entry door, runs
 * read-only here rather than being refused.
 *
 * **The parent's log is read now, never copied onto the child.** A child is cut and
 * can merge back before its parent reaches a `merged` wait, and the parent lands
 * afterwards; a fact recorded at the child's birth would say `false` for good, and a
 * re-entry on that child would write into the parent's merged checkout — the same
 * read `mergeDestination` makes, for the same reason.
 */
const writesRefused = (trak: Trak): Effect.Effect<boolean, StoreFailed | StoreUndecodable, Store> =>
  Effect.gen(function* () {
    if (trak.landed !== undefined) return true
    const parent = trak.parent
    if (parent === undefined) return false
    const store = yield* Store
    return replayHistory(parent.id, yield* store.events(parent.id)).landed !== undefined
  })

/**
 * What the composer is refused on the merge's account: the project's writers, the
 * agents that wait on the branch merging, whether this trak's already has, and whether
 * a step may wait for `deployed` — there is a deploy script to ask. Read
 * off `lib.agents` alone, as the composer's set is — the engine's own `generic` is
 * on no plan.
 */
const afterMergeOf = (lib: Library, landed: boolean): AfterMerge => ({
  landed,
  deploys: lib.deploy !== undefined,
  writes: new Set(
    [...lib.agents.values()].filter((a) => a.permission === "write").map((a) => a.name),
  ),
  waits: new Set(
    [...lib.agents.values()]
      .filter((a) => a.conditions.some((c) => engineCondition(c) !== undefined))
      .map((a) => a.name),
  ),
})

/**
 * The decode a composer's answer is held to on this trak: the project's agents, the
 * depth ceiling, whether it has a parent or a goal, and what the branch's merge refuses. See
 * `ComposerOutputFor`, and `Compose` below for why each argument is what it is.
 */
const composerOutputOn = (trak: Trak) =>
  Effect.gen(function* () {
    const lib = yield* Lib
    const child = trak.parent !== undefined
    return ComposerOutputFor(
      new Set(lib.agents.keys()),
      !child,
      child,
      trak.goal !== undefined,
      afterMergeOf(lib, yield* writesRefused(trak)),
    )
  })

/**
 * Why a proposal would be refused on this trak now, in the decode's own words, or
 * `undefined` where it passes.
 *
 * **The composer's decode, run a second time over a plan a person edited at its gate.**
 * One set of rules for a plan whoever last touched it, and read now rather than when the
 * composer answered: a branch that landed since then refuses a writer the proposal was
 * allowed.
 */
export const proposalRefusal = (trak: Trak, proposal: unknown) =>
  Effect.gen(function* () {
    const decoded = Schema.decodeUnknownEither(yield* composerOutputOn(trak))(proposal)
    return decoded._tag === "Left" ? refusalReason(decoded.left) : undefined
  })

/**
 * Exported, unlike the other runner, so a caller can compose *without* running
 * the pipeline that follows — `pnpm real:compose`, and eventually `ork plan`,
 * which is a real command: "show me what you would do, don't do it".
 *
 * Deliberately the same function `advance` calls rather than a second assembly of
 * prompt + schema + session. A probe that builds its own wiring stops being
 * evidence about the engine.
 */
export const Compose = Effect.fn("Compose")(function* (
  trak: Trak,
  cmd: Extract<Command, { _tag: "Compose" }>,
  setupGate?: SetupGate,
) {
  const lib = yield* Lib
  const ids = yield* Ids
  const prompts = yield* Prompts

  // One session for composing, reused when answers come back — so the composer
  // still holds why it asked rather than re-deriving it from the answers alone.
  //
  // Being asked what the rest of the plan should be is the exception, and it
  // starts over. A resumed composer defends the plan it wrote, and — the half that
  // is not taste — it was handed the intent on its first turn and cannot be handed
  // the decisions filed since, because those ride the fresh-session body only. So
  // a new id is minted and nothing is resumed; recording it via `ComposerReturned`
  // makes it the composer's session from then on, which is what a chat at the new
  // plan's gate resumes.
  const restart = cmd.trigger._tag === "Reconsulted"
  const existing = restart ? undefined : trak.composerSession
  const sessionId = existing ?? (yield* ids.newSessionId)
  // ComposerOutputFor, not ComposerOutput: an agent name that doesn't exist is
  // decoded as a parse failure, so elicit re-prompts with the reason. Left to
  // resolve at spawn time it escaped through the error channel AFTER the proposal
  // was committed, stranding the trak in AgentWorking with nothing to move it.
  // The second argument is the depth ceiling: a trak that was itself spawned may
  // not spawn again, refused here so `elicit` re-prompts rather than at spawn
  // time, where it would escape after the proposal was committed.
  //
  // **`lib.agents`, never `agentNamed` or `fleet`.** This set and the index above are
  // the composer's whole world, and both are the project's files alone — which is the
  // only thing keeping the engine's own `generic` off a plan. A role-less write agent
  // the composer could place would be one nothing here refuses.
  // The third is the mirror: `handUp` on a `finished` is a message to a parent, and a
  // trak with none is refused it here for the same reason.
  const schema = yield* composerOutputOn(trak)
  const resumeFrom = cmd.trigger._tag === "Initial" ? undefined : existing
  const trigger = promptTrigger(cmd.trigger, resumeFrom)
  // Before the prompt is built, because the prompt tells the turn to read what this
  // writes — see `readyFor` for why either half failing is a turn that failed.
  // The composer runs in the trak's checkout, which under a runner is in its sandbox, so
  // it reaches `connection:` servers over HTTP and holds the tunnel as a step does. A
  // trak with no checkout yet composes in the project's sandbox under an external store, and on
  // this machine otherwise — its env script captured where it composes.
  const inProject = trak.worktree === undefined ? yield* projectPlace : undefined
  const ready = yield* readyFor(trak, undefined, lib.models.composer, inProject)
  if (ready._tag === "Left") return ready.left
  const reached =
    trak.worktree === undefined ? undefined : yield* (yield* TurnTools).reached(trak.id)
  const servers = yield* sessionServers(lib, {}, trakNote(trak.id, "composer"), reached)
  const { rejoin, execId } = yield* spawnedAs(trak.id, undefined, cmd.trigger)
  const request: SessionRequest = {
    prompt: buildComposerPrompt(prompts, {
      description: cmd.description,
      trak,
      agentIndex: agentIndex(lib),
      composition: lib.composition,
      trigger,
      now: yield* Clock.currentTimeMillis,
      deployed: lib.deploy !== undefined,
      stopped: stoppedOn(trak, resumeFrom),
    }),
    ...(yield* turnCwd(
      inProject?.path ?? workdir(trak),
      turnAttachments(trak, trigger, resumeFrom),
      inProject,
    )),
    // `default:` in models.yaml: the composer's model, and the one every shipped
    // role runs on — the library fills that in, so no agent falls back here.
    model: lib.models.composer,
    effort: lib.models.efforts.get(lib.models.composer),
    sessionId,
    // Deliberately unrestricted. Composing is judgment, not research, and the
    // template says so — but a quick grep to confirm a guess is cheaper than a
    // wrong three-step proposal, so the limit is guidance, not a deny list.
    toolAccess: "write",
    // Composing is a planning turn — it reads the repo, it never edits it. But
    // `read` is plan mode, which confines it to `cwd`, and a composer routinely
    // needs to look at a sibling checkout to plan against it. We have no way to
    // widen that yet, so the wide mode is the one we can express. Narrow it back
    // to `read` the day a SessionRequest can carry extra readable roots
    // (`claude --add-dir`). Not `auto`: a composer has no envelope to ask a person
    // for a refused call with, and its own MCP calls must not meet a classifier.
    permission: "full",
    // The composer's contract does not vary — same shapes on every trak — so this
    // is the same text every turn, and every turn of every trak.
    brief: buildSystemPrompt(prompts, { role: "composer" }),
    resumeFrom,
    // The composer's conversation is its own on every turn; nothing hands it one.
    inherited: false,
    // In the sandbox, under a host's GitHub App, the helper that asks the engine for a token.
    env: { ...ready.right.env, ...reached?.env },
    ...servers,
    ...signInOf(ready.right.credential),
    ...(rejoin === undefined ? {} : { reattach: rejoin.execId }),
    ...(setupGate === undefined ? {} : { setupGate }),
    ...(execId === undefined ? {} : { execId }),
    ...(inProject === undefined ? {} : { inProject: true as const }),
  }
  // The session this turn's provider announced, for `recordedSession` and
  // `orRecordFailure`. Starts absent every turn, including a resume: an id is
  // minted before the spawn, so only the provider saying `SessionStarted` makes
  // it real — and a resumed session that never got that far is already on the
  // trak anyway, which is where `existing` came from.
  const announced = yield* Ref.make<SessionId | undefined>(undefined)
  // What this turn spends, accumulated as the provider reports it. Fresh per turn
  // — a resumed session's earlier turns are already on the log with their own.
  const usage = yield* Ref.make(unmetered)
  // The turn is recorded as in flight for exactly as long as it runs, so a
  // crash mid-turn leaves `run.json` pointing at this session — which is the
  // one thing the log could not have recorded itself. Cleared on release
  // however the turn ends, success or `orGiveUp`'s catch. Failing to write the
  // record must not fail the turn itself — custody bookkeeping losing this
  // write costs the session-id hint on recovery, not the work `store.append`
  // has already durably committed to.
  return yield* Effect.scoped(
    Effect.gen(function* () {
      if (reached !== undefined) yield* reached.reach(yield* noteOn(trak.id, "composer"))
      yield* inFlight(trak.id, undefined, sessionId, rejoin, execId)
      const returned = yield* orGiveUp(
        withTranscript(
          trak.id,
          // The composer is not a step: it has no position and its own session.
          "composer",
          request,
          announced,
          usage,
          rejoin,
          // A human typed at the plan gate and is waiting to read the answer, so
          // the composer may just answer. Every other trigger owes us a plan.
          isConversation(trigger)
            ? converse(schema, MeantAsComposerOutput, message, request)
            : elicit(schema, request),
        ),
        wroteNothingUsable,
      )
      return Events.composerReturned(
        yield* recordedSession(announced, sessionId),
        returned.value,
        (yield* Ref.get(usage)).usage,
        returned.envelope,
        returned.stopped.map(stoppedTask),
      )
    }),
    // The composer has no step index — `undefined` is what says so, here and in
    // `run.json`.
  ).pipe(
    withSessionCopies(request, announced, yield* noteOn(trak.id, "composer")),
    reportRefused(ready.right.credential.given),
    orRecordFailure(undefined, announced, usage),
  )
})

/**
 * The agent turn at `step`: the entry and the agent it names, for the two commands
 * that run one — the turn itself, and its checks.
 *
 * Every other shape is a die, and every one is unreachable. `enterStep` routes a
 * spawn position to `SpawnChildren`, a different command with a different state, and
 * refuses to enter the composer's own entry at all — loud rather than skipped, because
 * a spawn silently run as a turn would be one agent doing N pieces of work. An unknown
 * agent takes both halves of `agentNamed` to say so: an entry the composer proposed
 * names an agent narrowed at decode, and the one entry no composer wrote — the turn a
 * re-entry splices in — names the agent the engine itself ships. Loud rather than
 * defaulted for the reason an unknown check is: a step that silently ran a substitute
 * agent would produce competent work against the wrong contract.
 */
const turnAt = (
  lib: Library,
  trak: Trak,
  step: number,
): Effect.Effect<{ readonly stepDef: AgentStep; readonly agent: Agent }> => {
  const proposal = trak.plan
  if (proposal === undefined) return Effect.die("a turn without a proposal")
  const stepDef = proposal.steps[step]
  if (stepDef === undefined) return Effect.die(`no step at index ${step}`)
  if (isSpawn(stepDef)) return Effect.die(`step ${step} is a spawn, not a turn`)
  if (isCompose(stepDef)) return Effect.die(`step ${step} is a compose, not a turn`)
  const agent = agentNamed(lib, stepDef.agent)
  return agent === undefined
    ? Effect.die(`step ${step} names unknown agent ${stepDef.agent}`)
    : Effect.succeed({ stepDef, agent })
}

/** The agent at a position, for a caller outside the turn — `turnAt`'s, and its dies. */
export const turnAgent = (lib: Library, trak: Trak, step: number): Effect.Effect<Agent> =>
  Effect.map(turnAt(lib, trak, step), (t) => t.agent)

/**
 * The session this turn carries on, or `undefined` where it mints a fresh one.
 *
 * An interrupted turn resumes even on its first attempt: `attempt` counts
 * completed runs, which is 0 for the very turn a crash cut off, but the
 * session it was talking to still exists and is exactly what should continue.
 *
 * A `Message` resumes for the same reason and needs saying separately: a
 * conversational reply does not bump `attempt` (see `replay.ts`), so a step
 * whose first turn was prose would otherwise mint a fresh session for the
 * human's reply and lose the conversation they are replying to — every turn,
 * silently. The slot's own session is still the guard; there is nothing to
 * resume into on a turn that never minted one.
 *
 * `Unread` is that case with nobody in the room, and `Filing` is it with a person
 * pressing rather than typing, so both are on the list for the same reason and
 * would fail the same way. `Unanswered` is listed beside them rather than left to
 * `attempt > 0`: a question does bump the counter today, and relying on that is
 * relying on a fact recorded somewhere else about a different shape. `Permitted` and
 * `Refused` are listed for the same reason: the refused call they answer is in the
 * session. All of them say *this turn continues a conversation that exists*, which is
 * what this is asking.
 * Named `resumes` rather than `continues` because the entry's borrowed session
 * already holds that name at the call site, and it answers a different question —
 * *whose* conversation, not *whether* there is one to carry on.
 *
 * **A borrowed session only ever applies to a position's first turn**, which is
 * what the first branch says: once this step has a session of its own, that is the
 * conversation a retry or a reply belongs in, and the entry it borrowed from is
 * behind it. The two positions then share one session id, which nothing keys on —
 * slots are per position, and `composeAt` asks its question of compose entries.
 */
const resumedSession = (
  slot: Slot,
  attempt: number,
  trigger: Trigger,
  inherited: SessionId | undefined,
): SessionId | undefined => {
  const resumes: readonly Trigger["_tag"][] = [
    "Interrupted",
    "Message",
    "Unanswered",
    "Unread",
    "Filing",
    "Permitted",
    "Refused",
  ]
  if (slot.session === undefined) return inherited
  return attempt > 0 || resumes.includes(trigger._tag) ? slot.session : undefined
}

/**
 * Refuses an artifact holding a mermaid block that does not parse, so the agent is
 * re-asked rather than a person being handed a diagram that draws as its source.
 *
 * Only an artifact, and only on `elicit`: a `stuck` or `questions` envelope is not a
 * document anyone draws as one, and a chat turn falls back to prose rather than
 * failing, so a refusal there would have nothing to spend it on. The first bad block
 * is enough — the agent is told where it is and fixes the rest on the same reading.
 */
const diagramsParse =
  (diagrams: DiagramsShape, prompts: Templates): Vet<StepOutput> =>
  (out) =>
    out.type !== "artifact"
      ? Effect.succeed(undefined)
      : Effect.gen(function* () {
          for (const [title, body] of Object.entries(out.sections)) {
            for (const source of mermaidSources(body)) {
              const refused = yield* diagrams.refusal(source)
              if (refused !== undefined)
                return render(prompts, "diagram-refused", { section: title, reason: refused })
            }
          }
          return undefined
        })

/**
 * One session per step. `claude --session-id` requires a UUID, so the id is
 * minted rather than derived, and recorded in the log via AgentReturned —
 * which is what lets a later iteration resume the same conversation, and lets
 * a human pick it up with `claude --resume <id>`. A CLI that mints its own
 * ignores this one, and the log then carries the id it announced instead.
 *
 * A step re-entered by a revised plan starts over unless the entry says
 * otherwise: nothing at a new position holds a session, so a fresh id is minted
 * and a rescuing agent arrives outside the conversation it is rescuing. An entry
 * carrying `continues` is the composer saying it wants the opposite — the agent
 * that wrote the document being fixed, still holding what it wrote. See
 * `AgentStep.continues`, and `borrowedSession` for the four ways a name resolves to
 * nothing, all of which mean *start fresh*.
 */
const sessionAt = (trak: Trak, step: number, lib: Library) =>
  Effect.gen(function* () {
    const slot = slotAt(trak, step)
    const inherited = borrowedSession(trak, step, lib)
    const sessionId = slot.session ?? inherited ?? (yield* (yield* Ids).newSessionId)
    return { slot, inherited, sessionId, attempt: slot.iterations }
  })

/** The agent the turn at `step` runs as, narrowed where it may not write — or the `StepRefused` it ends on. */
const runningAgent = (lib: Library, trak: Trak, step: number, declared: Agent) =>
  Effect.gen(function* () {
    const refused = declared.permission === "write" && (yield* writesRefused(trak))
    if (refused && declared.name !== lib.generic.name) {
      return Either.left(Events.stepRefused(step, landedRefusal(declared.name)))
    }
    const agent: Agent = refused ? { ...declared, permission: "read-only" } : declared
    return Either.right(agent)
  })

/** The session id the provider announced and the usage it reported, empty at the start of a turn. */
const freshTurnRefs = Effect.all([Ref.make<SessionId | undefined>(undefined), Ref.make(unmetered)])

/** What a turn carries of a command it rejoins and a setup it waits beside. */
const carriedOver = (
  rejoin: Rejoin | undefined,
  setupGate: SetupGate | undefined,
  execId: string | undefined,
) => ({
  ...(rejoin === undefined ? {} : { reattach: rejoin.execId }),
  ...(setupGate === undefined ? {} : { setupGate }),
  ...(execId === undefined ? {} : { execId }),
})

const SpawnStep = Effect.fn("SpawnStep")(function* (
  trak: Trak,
  cmd: Extract<Command, { _tag: "SpawnStep" }>,
  setupGate: SetupGate | undefined,
) {
  const lib = yield* Lib
  const prompts = yield* Prompts
  const { stepDef, agent: declared } = yield* turnAt(lib, trak, cmd.step)
  // `ComposerOutputFor` refuses this shape at decode, and a top-level trak cannot
  // land between the plan being accepted and the step starting — its own `merged`
  // wait is a step. A spawn's child can: its parent lands on its own schedule, so a
  // plan accepted before that holds a writer this step must not run. Not a die, which
  // would leave the child in `AgentWorking` with nothing to move it: the composer is
  // asked again from here, with the sentence the decode would have used.
  //
  // **The engine's own agent is narrowed instead of refused.** It reaches a plan only
  // through the re-entry door — a question about the trak — and a merged trak is
  // exactly the one somebody has a question about, so the turn runs with the tools
  // that edit denied and the prompt saying so. The one place a declaration is read
  // down rather than obeyed, and it is the engine's own file, never a project's.
  const running = yield* runningAgent(lib, trak, cmd.step, declared)
  if (running._tag === "Left") return running.left
  const agent = running.right
  const { slot, inherited, sessionId, attempt } = yield* sessionAt(trak, cmd.step, lib)

  // Narrowed to the sections this agent declares, so a document that cannot fill
  // them is a decode failure `elicit` re-prompts on rather than something
  // discovered after the event was committed — the same reason ComposerOutputFor
  // exists. Only an artifact is held to them: a `stuck` account has four named
  // fields of its own, so an agent cannot dress one up as the other.
  //
  // A chat on a step whose artifact already stands — at whichever gate — is the one
  // turn held to less: the envelope carries only the sections the reply edited, and
  // `amended` below lays them over the document filed. Every other turn — the
  // first, a retry, a failing check, a person asking it to file — owes the whole
  // shape. `standingArtifact` is what tells a filed artifact from a stuck account.
  const standing = isConversation(cmd.trigger) ? standingArtifact(trak, cmd.step) : undefined
  const schema = stepSchema(agent, standing, supersedable(trak, cmd.step))
  const resumeFrom = resumedSession(slot, attempt, cmd.trigger, inherited)
  const trigger = promptTrigger(cmd.trigger, resumeFrom)
  // Same rule as `Compose`, and the same reason it comes first: the plan in the
  // prompt below names paths, and a path that is not there is worse than no path.
  const ready = yield* stepReady(trak, cmd.step, modelAt(trak, cmd.step, lib) ?? agent.model)
  if (ready._tag === "Left") return ready.left
  const hosted = yield* hostedFor(trak, agent)
  // Under a runner the CLI runs in the sandbox, and reaches the engine over HTTP.
  const reached = yield* (yield* TurnTools).reached(trak.id)
  const turnTools = yield* turnToolsFor(lib, trak, agent, reached)
  const { rejoin, execId } = yield* spawnedAs(trak.id, cmd.step, cmd.trigger)
  const request: SessionRequest = {
    prompt: buildStepPrompt(prompts, {
      trak,
      step: stepDef,
      agent,
      trigger,
      guidance: lib.guidance,
      index: cmd.step,
      checks: yield* scriptsNamed(lib, agent.name, agent.checks),
      checkTool: turnTools.names,
      processes: hosted.told,
      processTools: turnTools.server !== undefined,
      stopped: stoppedOn(trak, resumeFrom),
    }),
    ...(yield* turnCwd(workdir(trak), turnAttachments(trak, trigger, resumeFrom))),
    // The entry carries a model only where a person picked it on New Chat, so a plan
    // that chat grows into runs every added step on its own agent file —
    // `ComposerOutputFor` keeps it that way — except one that inherits a session, which
    // runs on the model that session was minted with, its own `model:` overridden for
    // the turn. A session never changes model, and so never CLI, mid-conversation:
    // `codex` would be handed a `claude` id to resume, or the reverse. `modelAt` is the
    // one place an entry's model and its agent's meet, and it answers with `inherited`
    // above rather than beside it — a borrow it cannot price is a borrow neither takes.
    // Its `undefined` is this step's own agent unnamed, which `turnAt` already refused.
    model: modelAt(trak, cmd.step, lib) ?? agent.model,
    // Off the same entry as the model, so a borrowed conversation keeps its effort too.
    effort: effortAt(trak, cmd.step, lib),
    sessionId,
    // The agent's own declaration, translated into a deny list by the provider.
    toolAccess: agent.permission,
    // A step that writes runs under auto mode, where the CLI's classifier refuses a
    // risky call with nobody asked; the step returns `permission` naming a call it
    // needs, and a person's yes clears it on the resumed session. Everything else
    // keeps `full`: a read-only step has nothing the classifier guards, and a writer
    // whose writes are refused was narrowed to read-only above. `edit` is no option
    // for either — it stops at the workspace boundary and prompts for the rest, which
    // nobody answers in a non-interactive session (see PermissionMode). `toolAccess`
    // is enforced independently of the mode, which is why the read-only clamp in
    // `real:trak` still holds.
    permission: agent.permission === "write" ? "auto" : "full",
    // The same declaration `StepOutputFor` is built from, said in prose. It is
    // fixed for the life of this step's session, which is why it goes here rather
    // than at the end of every prompt body — see `SystemContext`.
    brief: buildSystemPrompt(prompts, {
      role: "step",
      sections: agent.sections,
      conversational: isConversational(stepDef),
      skills: agent.skills,
    }),
    resumeFrom,
    // A borrowed session's first turn: the conversation holds another agent's
    // contract, so a CLI that carries the brief in the body says this one's again.
    inherited: slot.session === undefined && inherited !== undefined,
    env: yield* stepEnv(ready.right.env, trak, reached),
    ...(yield* stepServers(lib, trak, cmd.step, turnTools.server, reached)),
    ...signInOf(ready.right.credential),
    ...carriedOver(rejoin, setupGate, execId),
  }
  // Same rules as `Compose`: only the provider can say the session is real, and the usage is
  // fresh per turn, whatever the session did before.
  const [announced, usage] = yield* freshTurnRefs
  // Same bracket as `Compose`, and the same non-fatal rule: recorded in flight
  // only for the length of this turn, so a crash here — and only here — leaves
  // `run.json` pointing at it, but a failure to write that record must not
  // fail the turn itself.
  return yield* Effect.scoped(
    Effect.gen(function* () {
      yield* (yield* TurnTools).open(trak.id, cmd.step)
      if (reached !== undefined) yield* reached.reach(yield* noteOn(trak.id, cmd.step))
      yield* inFlight(trak.id, cmd.step, sessionId, rejoin, execId)
      const returned = yield* orGiveUp(
        withTranscript(
          trak.id,
          cmd.step,
          request,
          announced,
          usage,
          rejoin,
          // Two ways a turn may answer in prose, and they are different
          // questions. `isConversation` asks whether a human is waiting on *this
          // turn* — a first spawn, a restart and a turn resumed with answers all
          // owe us an artifact, and `elicit` is what holds them to it.
          // `isConversational` asks whether this plan entry owes one *yet*, which
          // is a property of the step for the life of its session.
          //
          // The relaxation is scoped to "this turn was not an envelope", never to
          // "artifacts are loose here": `schema` is the same either way, so a
          // document that does arrive is decoded exactly as strictly.
          //
          // **`overridesConversational` names the two triggers that take the
          // entry's own flag away.** That flag defers the artifact for the life of
          // a conversation; `Unread` is the engine saying there is nobody on the
          // other side of it and `Filing` is the person on it asking for the
          // document — so the deadline lands here. It is also what bounds the
          // nudge: prose is not in the elicited union, so a step cannot answer
          // either the way it answered the turn before.
          isConversation(trigger) ||
            (isConversational(stepDef) && !overridesConversational(trigger))
            ? converse(schema, MeantAsStepOutput, message, request)
            : elicit(schema, request, diagramsParse(yield* Diagrams, prompts)),
        ),
        wroteNothingUsable,
      )
      // The log carries the whole document, so nothing that replays it has to know
      // a chat sent part of one. `envelope` is still what the agent wrote.
      const value =
        standing !== undefined && returned.value.type === "artifact"
          ? amended(standing, returned.value)
          : returned.value
      return Events.agentReturned(
        cmd.step,
        yield* recordedSession(announced, sessionId),
        value,
        (yield* Ref.get(usage)).usage,
        returned.envelope,
        returned.stopped.map(stoppedTask),
      )
    }),
  ).pipe(
    withSessionCopies(request, announced, yield* noteOn(trak.id, cmd.step)),
    reportRefused(ready.right.credential.given),
    orRecordFailure(cmd.step, announced, usage),
    loggedTurn(
      `trak ${trak.id}: step ${artifactKey(stepDef, cmd.step)} turn`,
      sessionId,
      announced,
    ),
  )
})

/**
 * Record the turn as in flight, with nothing of its process known yet — but the command it
 * rejoins, where it rejoins one.
 */
const inFlight = (
  trak: TrakId,
  step: number | undefined,
  sessionId: SessionId,
  rejoin: Rejoin | undefined,
  execId: string | undefined,
) =>
  Effect.flatMap(Runs, (runs) =>
    runs.turn(trak, {
      step,
      sessionId,
      agentPid: undefined,
      agentStart: undefined,
      usage: undefined,
      estimate: undefined,
      ...(rejoin === undefined ? {} : { rejoin: rejoin.execId }),
      ...(execId === undefined ? {} : { execId }),
    }),
  ).pipe(Effect.ignoreLogged)

/**
 * The id a turn's command runs under in its sandbox, minted here so `inFlight` records it
 * before the spawn: an engine that dies between the spawn and the provider reporting it
 * leaves a record a restart in `Stopping` can kill by, and `reap` too. Nothing where the
 * turn rejoins a command, which has its id, or where no checkout is in a sandbox.
 */
const execIdFor = (rejoin: Rejoin | undefined): Effect.Effect<string | undefined, never, Ids> =>
  Effect.gen(function* () {
    if (rejoin !== undefined) return undefined
    const sandboxes = yield* Effect.serviceOption(Sandboxes)
    if (Option.isNone(sandboxes) || !(yield* sandboxes.value.inUse)) return undefined
    return yield* (yield* Ids).newExecId
  })

/** What a turn's command runs as: the command it rejoins, or the exec id it is spawned under. */
const spawnedAs = (id: TrakId, step: number | undefined, trigger: Trigger) =>
  Effect.flatMap(rejoinable(id, step, trigger), (rejoin) =>
    Effect.map(execIdFor(rejoin), (execId) => ({ rejoin, execId })),
  )

/** A command a dead engine left running detached, and the lines of it already written. */
interface Rejoin {
  readonly execId: string
  readonly written: readonly TranscriptEntry[]
}

/**
 * The command this turn rejoins rather than starts: the one the run record names as still
 * running detached at the same position, where the turn is the restart that picks the
 * position back up. **Only a restart rejoins.** Any other turn there — a person's message
 * after a stop — owes the agent what it was sent, and `Runs.turn` stops the old command
 * for it. A record or a transcript that cannot be read rejoins nothing.
 */
const rejoinable = (id: TrakId, step: number | undefined, trigger: Trigger) =>
  Effect.gen(function* () {
    if (trigger._tag !== "Interrupted") return undefined
    const turn = yield* (yield* Runs).inFlight(id).pipe(Effect.orElseSucceed(() => undefined))
    if (turn?.rejoin === undefined || turn.step !== step) return undefined
    const entries = yield* (yield* Store).transcript(id).pipe(Effect.orElseSucceed(() => []))
    const rejoin: Rejoin = { execId: turn.rejoin, written: writtenBy(entries, turn.rejoin) }
    return rejoin
  })

/** How long a turn has run, as the engine's log says it: `840ms`, `12.3s`. */
const tookSince = (started: number): Effect.Effect<string> =>
  Effect.map(Clock.currentTimeMillis, (now) => {
    const ms = now - started
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
  })

/**
 * A step's turn in the engine's log: one INFO line as it starts, and one as it ends, fails
 * or is interrupted, with the session and how long it ran. The session closing it is the
 * one the CLI announced, which is the one a person resumes.
 */
const loggedTurn =
  (turn: string, sessionId: SessionId, announced: Ref.Ref<SessionId | undefined>) =>
  <E extends { readonly reason: string }, R>(
    effect: Effect.Effect<Event, E, R>,
  ): Effect.Effect<Event, E, R> =>
    Effect.gen(function* () {
      const started = yield* Clock.currentTimeMillis
      yield* Effect.logInfo(`${turn} started, session ${sessionId}`)
      const closing = (how: string, why = "") =>
        Effect.gen(function* () {
          const session = (yield* Ref.get(announced)) ?? sessionId
          const took = yield* tookSince(started)
          yield* Effect.logInfo(`${turn} ${how}, session ${session}, after ${took}${why}`)
        })
      return yield* effect.pipe(
        Effect.tap((event) =>
          event._tag === "TurnFailed" ? closing("failed", `: ${event.reason}`) : closing("ended"),
        ),
        Effect.tapError((e) => closing("left", `: ${e.reason}`)),
        Effect.onInterrupt(() => closing("interrupted")),
      )
    })

/** Why a process is not up, for `step.md` to say; nothing where it is up. */
const notUpOf = (run: HostedRun): TurnProcess["notUp"] => {
  switch (run.state._tag) {
    case "Running":
      return undefined
    case "DidNotComeUp":
      return "didNotComeUp"
    case "Exited":
      return "exited"
    case "Stopped":
      return "stopped"
    case "StoppedByRestart":
      return "stoppedByRestart"
    case "NotStarted":
    case "Preparing":
    case "Starting":
      return "notStarted"
  }
}

/**
 * Start every process the agent lists, and say what the turn is to be told: those, and
 * any other already running at the trak. **A process that does not come up does not
 * stop the turn** — the step may be about fixing exactly that — so a failed start is a
 * line in the prompt rather than an event.
 */
const hostedFor = Effect.fn("hostedFor")(function* (trak: Trak, agent: Agent) {
  const hosted = yield* HostedProcesses
  // A name the trak's checkout no longer declares, or declares in a file that does not
  // parse, is told as a start that failed: `assembleLibrary` checked the agent's
  // `processes:` against the project, and the checkout can differ from it.
  const unknown = yield* Effect.forEach(
    agent.processes,
    (name) =>
      hosted.start(trak.id, workdir(trak), name).pipe(
        Effect.as(undefined),
        Effect.catchTag("UnknownProcess", (e) => Effect.succeed(e)),
      ),
    { concurrency: "unbounded" },
  )
  const { runs: declared } = yield* hosted.survey(trak.id, workdir(trak))
  const listed: readonly TurnProcess[] = declared
    .filter((run) => agent.processes.includes(run.name) || run.state._tag === "Running")
    .map((run) => ({
      name: run.name,
      description: run.description,
      url: run.state._tag === "Running" ? run.state.url : undefined,
      notUp: notUpOf(run),
      reason: run.state._tag === "DidNotComeUp" ? run.state.reason : undefined,
      exitCode: run.state._tag === "Exited" ? run.state.code : undefined,
      variable: urlVariable(run.name),
    }))
  const told = [
    ...listed,
    ...unknown.flatMap((e): TurnProcess[] =>
      e === undefined
        ? []
        : [
            {
              name: e.name,
              description: "",
              url: undefined,
              notUp: "didNotComeUp",
              reason: e.reason,
              exitCode: undefined,
              variable: urlVariable(e.name),
            },
          ],
    ),
  ]
  return { told }
})

/**
 * The scripts an agent names, as definitions rather than names. One registry backs
 * `checks:` and `effects:`, so one lookup serves both.
 *
 * `Effect.die` on a name the library does not have, for the same reason
 * `SpawnStep` dies on an unknown agent: `assembleLibrary` rejects it at load,
 * before a trak starts, so reaching here means the library was built by
 * something that skipped its own validation.
 */
const scriptsNamed = (
  lib: Library,
  agent: string,
  names: readonly string[],
): Effect.Effect<readonly Check[]> =>
  Effect.forEach(names, (name) => {
    const script = lib.checks.get(name)
    return script === undefined
      ? Effect.die(`agent ${agent} names unknown script ${name}`)
      : Effect.succeed(script)
  })

/**
 * The tree this trak's checkout holds as `check` would be kept against, or `undefined`
 * where there is none: a trak working in no checkout of its own, or a tree git could not
 * hash.
 */
const checkoutTree = (trak: Trak, check: Check): Effect.Effect<string | undefined, never, Vcs> =>
  Effect.gen(function* () {
    const worktree = trak.worktree
    if (worktree === undefined || worktree.path === ".") return undefined
    return yield* (yield* Vcs)
      .workingTree(worktree, check.ignoresLinguistGenerated)
      .pipe(Effect.catchTag("GitFailed", () => Effect.succeed(undefined)))
  })

/**
 * What a pass of `check` over `tree` would be kept under, or `undefined` where none can
 * be: a check that opted out, or no tree. Every one of those runs the check, which is the
 * safe direction to be wrong in — a run costs time, and a pass reused against the wrong
 * files is a verdict nobody gave.
 */
const passKey = (
  check: Check,
  tree: string | undefined,
): Effect.Effect<string | undefined, never, Passes> =>
  !check.cache || tree === undefined
    ? Effect.succeed(undefined)
    : Effect.flatMap(Passes, (p) => p.keyOf(check, tree))

/**
 * What `check` runs with: `targetEnv`; the commit the trak's checkout was cut from as
 * `ORKESTRA_BASE_COMMIT`, wherever it has one; and the tree it last passed on in this
 * checkout as `ORKESTRA_PASSED_TREE` — see `Passes.lastPassed`. No tree where there is
 * none to keep a pass against, or the store will not answer: the check then chooses as if
 * it had never passed here, which runs more rather than less.
 *
 * The base commit, not the default branch, is where a trak's own changes begin: a trak cut
 * from a goal branch or a parent's branch measured from the default branch would count
 * everything that branch already changed as its own.
 */
const checkEnv = (
  trak: Trak,
  check: Check,
  tree: string | undefined,
): Effect.Effect<Readonly<Record<string, string>>, never, Passes> =>
  Effect.gen(function* () {
    const env = {
      ...targetEnv(trak),
      ...(trak.worktree === undefined ? {} : { ORKESTRA_BASE_COMMIT: trak.worktree.base }),
    }
    if (tree === undefined) return env
    const passed = yield* (yield* Passes)
      .lastPassed(check, workdir(trak))
      .pipe(Effect.catchTag("StoreFailed", () => Effect.succeed(undefined)))
    return passed === undefined ? env : { ...env, ORKESTRA_PASSED_TREE: passed }
  })

/** Keep `tree` as the one `check` last passed on in this checkout. Lost, it costs a wider run. */
const keepPassedTree = (
  trak: Trak,
  check: Check,
  tree: string | undefined,
): Effect.Effect<void, never, Passes> =>
  tree === undefined
    ? Effect.void
    : Effect.flatMap(Passes, (p) =>
        p
          .passedOn(check, workdir(trak), tree)
          .pipe(Effect.catchTag("StoreFailed", () => Effect.void)),
      )

/**
 * The units a check with `units:` is handed, and the record of what it proves, kept
 * however its run ends. `undefined` for a check that keeps none.
 *
 * `agentAlive` is `run_check`'s case: an agent can edit files while the check runs, so
 * the units are kept only if the tree is still the one they were proven on. With no
 * agent, the key taken before the run is the one they are kept under, as a pass's is.
 *
 * A check with `fingerprint:` is also handed the units whose print leans on nothing this
 * machine does not trust and the checkout still agrees with, and keeps a print of each unit
 * it ran. Those skipped units are never proven on this tree: `finished` proves only what
 * the script wrote, which is what ran.
 */
const nothing = () => Effect.succeed<readonly string[]>([])

const unitsFor = (
  trak: Trak,
  check: Check,
  tree: string | undefined,
  agentAlive: boolean,
): Effect.Effect<CheckUnits | undefined, never, Vcs | Passes> =>
  Effect.gen(function* () {
    if (tree === undefined) return undefined
    const passes = yield* Passes
    const key = yield* passes.unitKeyOf(check, tree)
    if (key === undefined) return undefined
    // A store that will not answer has proven nothing, so every unit runs.
    const proven = yield* passes.proven(key).pipe(Effect.catchTag("StoreFailed", nothing))
    const printKey = yield* passes.printKeyOf(check)
    const printed =
      printKey === undefined
        ? []
        : yield* passes
            .printed(printKey, workdir(trak))
            .pipe(Effect.catchTag("StoreFailed", nothing))
    const context = yield* Effect.context<Vcs | Passes>()
    const finished = (units: readonly string[], recording?: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (agentAlive && (yield* checkoutTree(trak, check)) !== tree) return
        yield* passes.prove(key, units).pipe(Effect.catchTag("StoreFailed", () => Effect.void))
        if (printKey === undefined || recording === undefined) return
        // A print that could not be kept costs the next run that unit, and nothing else.
        yield* passes
          .print(printKey, workdir(trak), recording, units)
          .pipe(Effect.catchTag("StoreFailed", () => Effect.void))
      }).pipe(Effect.provide(context))
    return {
      proven: [...new Set([...proven, ...printed])],
      ...(check.fingerprint === undefined ? {} : { sealed: check.fingerprint }),
      finished,
    }
  })

/**
 * Run a step's checks in order and stop at the first failure.
 *
 * Fail-fast because the first complaint is the one worth acting on: an agent
 * handed five reports fixes the easy ones, and the run after it says the same
 * thing about the hard one. Whether the later checks would also have failed is
 * something the next run finds out for free.
 *
 * **A check that already passed on exactly these files is not run**, and is named under
 * `reused` instead. Asked here rather than inside `Checks`, because that adapter also
 * runs effects, conditions and setup, none of which may be reused — and asked before
 * `run`, so a reused `exclusive:` check never waits in the queue.
 */
const RunChecks = Effect.fn("RunChecks")(function* (
  trak: Trak,
  cmd: Extract<Command, { _tag: "RunChecks" }>,
) {
  const lib = yield* Lib
  const runner = yield* Checks

  const { agent } = yield* turnAt(lib, trak, cmd.step)

  // Empty for an agent that declares none, which is the common case for anything
  // read-only — the loop runs zero times and reports that nothing failed. See
  // `decide`'s `artifact` arm for why this command runs regardless.
  const checks = yield* scriptsNamed(lib, agent.name, agent.checks)
  // **The one place the skip is honoured**, because it is the one place the check list
  // is read — `decide` issues this command unconditionally and cannot see the list. The
  // same passing event, naming what did not run, so the step is accepted exactly as a
  // pass accepts it. Only where there is something to skip: a run of nothing spends no
  // switch, and `ChecksPassed{ran: []}` with no `skipped` is what leaves it armed.
  const [first] = checks
  if (trak.skippingChecks && first !== undefined) {
    return Events.checksPassed(
      cmd.step,
      [],
      checks.map((c) => c.name),
    )
  }
  const passes = yield* Passes
  const ran: string[] = []
  const reused: string[] = []
  const places: Record<string, Place> = {}
  for (const check of checks) {
    // A check that keeps no pass keeps no units either, so its tree is never hashed.
    const tree = check.cache ? yield* checkoutTree(trak, check) : undefined
    const key = yield* passKey(check, tree)
    // Not knowing whether it passed before is a miss: the check runs.
    const before =
      key !== undefined &&
      (yield* passes.has(key).pipe(Effect.catchTag("StoreFailed", () => Effect.succeed(false))))
    if (before) {
      yield* keepPassedTree(trak, check, tree)
      reused.push(check.name)
      continue
    }
    // The position goes in so the run reaches a watcher while it happens — a `verify`
    // is minutes long, and `Checks` publishes nothing for a run nobody can name.
    const at = { trak: trak.id, step: cmd.step }
    const units = yield* unitsFor(trak, check, tree, false)
    const env = yield* checkEnv(trak, check, tree)
    const outcome = yield* runner.run(check, workdir(trak), at, [], units, env)
    if (!outcome.passed) {
      return Events.checkFailed(
        cmd.step,
        check.name,
        outcome.output,
        outcome.command,
        outcome.exitCode,
        outcome,
      )
    }
    // A record that could not be written costs the next lookup a run, and nothing else.
    if (key !== undefined)
      yield* passes.record(key).pipe(Effect.catchTag("StoreFailed", () => Effect.void))
    yield* keepPassedTree(trak, check, tree)
    ran.push(check.name)
    if (outcome.place !== undefined) places[check.name] = outcome.place
  }
  return Events.checksPassed(
    cmd.step,
    ran,
    undefined,
    reused.length === 0 ? undefined : reused,
    places,
  )
})

/** The server a step session's engine tools are under, and its check tool. */
export const TRAK_TOOLS = "orkestra-trak"
export const RUN_CHECK = "run_check"

/**
 * The checks an agent may run through `run_check` during its turn: every script of the
 * project's that keeps a pass, its own `checks:` first — so a step that declares none
 * still runs one whole and keeps the pass a later step's checks reuse, rather than
 * running the command itself and keeping nothing. Not a script any agent runs as an
 * effect or a condition: those act outside the checkout or answer a wait, `open-pr`
 * keeps a pass by default, and a turn calling it would push a body nobody approved.
 * None for a trak working in no checkout of its own, where no pass can be kept — and an
 * agent offered none is handed no server.
 */
export const offeredChecks = (lib: Library, trak: Trak, agent: Agent): readonly Check[] => {
  if (trak.worktree === undefined || trak.worktree.path === ".") return []
  const acting = new Set(
    [...lib.agents.values(), lib.generic].flatMap((a) => a.effects.concat(a.conditions)),
  )
  const others = [...lib.checks.keys()].filter(
    (name) => !agent.checks.includes(name) && !acting.has(name),
  )
  return [...agent.checks, ...others].flatMap((name) => {
    const check = lib.checks.get(name)
    return check?.cache === true ? [check] : []
  })
}

/**
 * Whether an agent is offered `open_goal`, the one engine tool that acts — it starts a goal,
 * which spends. Only the engine's `generic` agent, decided by its name: the name is the
 * engine's, so no project's fleet is read to answer it. The read tools are every agent's.
 */
export const offersEngineTools = (agent: Agent): boolean => agent.name === GENERIC

/**
 * A step turn's environment: its env script's, then its declared processes', then — in the
 * sandbox, under a host's GitHub App — the helper that asks the engine for a token.
 */
const stepEnv = (
  captured: Readonly<Record<string, string>>,
  trak: Trak,
  reached: ReachedTools | undefined,
) =>
  Effect.map(
    Effect.flatMap(HostedProcesses, (hosted) => hosted.turnEnv(trak.id)),
    (processes): Record<string, string> => ({ ...captured, ...processes, ...reached?.env }),
  )

/**
 * The server a step's session is handed for the engine's tools, and the names `run_check`
 * takes. Every session is handed it wherever an engine is listening: the read tools and the
 * process tools are every agent's, so an agent can investigate another trak, or declare a
 * process mid-turn and start it, whatever its checks.
 *
 * The turn holds itself open to the tools before the agent can call anything, in the
 * scope `SpawnStep` runs it in: what a call started is interrupted when that scope closes.
 */
const turnToolsFor = (lib: Library, trak: Trak, agent: Agent, reached: ReachedTools | undefined) =>
  Effect.map(TurnTools, (tools) => {
    const offered = offeredChecks(lib, trak, agent)
    const server = reached?.tools ?? tools.server?.(trak.id)
    return { server, names: server === undefined ? [] : offered.map((c) => c.name) }
  })

/**
 * How a call on `run_check` came out. `NoTurn` and `NotOffered` ran nothing; `Ended` is
 * a run the turn's end interrupted, waiting or running, and it recorded no pass.
 */
export type CheckCall = Data.TaggedEnum<{
  NoTurn: {}
  NotOffered: { readonly offered: readonly string[] }
  Reused: {}
  Failed: { readonly output: string; readonly exitCode: number | undefined }
  Passed: { readonly output: string; readonly recorded: boolean }
  Ended: {}
}>
export const CheckCall = Data.taggedEnum<CheckCall>()

type CheckLineOutcome = Schema.Schema.Type<typeof CheckEntry>["outcome"]

/** The outcome a `Check` line records for a call that reached the check. */
const lineOutcome = (call: CheckCall): CheckLineOutcome =>
  CheckCall.$match(call, {
    NoTurn: () => undefined,
    NotOffered: () => undefined,
    Reused: () => "reused" as const,
    Failed: () => "failed" as const,
    Passed: (p) => (p.recorded ? ("passed" as const) : ("unrecorded" as const)),
    Ended: () => "ended" as const,
  })

/**
 * One check an agent asked for during its turn, through `run_check`: `RunChecks`' loop
 * for one check, so a pass recorded here is the pass `RunChecks` finds after the turn.
 *
 * **Recorded only on the tree the key was built from.** `RunChecks` runs with no agent
 * alive; here the agent is, and a background command or a parallel call can edit files
 * while the check runs. The key is taken again after the run, and a pass whose files
 * moved is answered and kept nowhere — the engine runs the check after the turn.
 *
 * **The run is forked into the turn's scope**, so the turn ending — a filing, a stop, a
 * kill — interrupts it, waiting in the exclusive queue or running, and no pass is
 * recorded; the units it finished are, on the tree they were proven on. The request waiting on it is not what ends it: a CLI may hold its tool
 * server's connection past the turn, or drop it while the turn goes on.
 *
 * Two `Check` lines bracket it on the transcript, joined to the call by `call`: one when
 * the call is taken and one with the outcome, written by the forked run so a request
 * that went away still leaves the second.
 */
export const runCheckForTurn = Effect.fn("runCheckForTurn")(function* (
  id: TrakId,
  name: string,
  call: string,
) {
  const turn = yield* (yield* TurnTools).current(id)
  if (turn === undefined) return CheckCall.NoTurn()
  const store = yield* Store
  const lib = yield* Lib
  const trak = replayHistory(id, yield* store.events(id))
  const { agent } = yield* turnAt(lib, trak, turn.step)
  const offered = offeredChecks(lib, trak, agent)
  const check = offered.find((c) => c.name === name)
  if (check === undefined) return CheckCall.NotOffered({ offered: offered.map((c) => c.name) })

  // A line that could not be written costs the card, never the call.
  const line = (outcome: CheckLineOutcome) =>
    Effect.gen(function* () {
      const entry = CheckEntry.make({
        call,
        server: TRAK_TOOLS,
        tool: RUN_CHECK,
        name,
        ...(outcome === undefined ? {} : { outcome }),
      })
      yield* store.appendTranscript(id, carried(entry, turn.step, yield* Clock.currentTimeMillis))
    }).pipe(Effect.catchTag("StoreFailed", (e) => Effect.logDebug(`check line: ${e.reason}`)))
  yield* line(undefined)

  const passes = yield* Passes
  const run = Effect.gen(function* () {
    // It waits for setup, as every script in the checkout does. A failure is the turn's to
    // report — the turn is killed for it — so the call answers with what setup printed.
    const setup = trak.setup === "running" ? yield* (yield* Setups).outcome(id, false) : undefined
    if (setup !== undefined && !setup.passed)
      return CheckCall.Failed({ output: setup.output, exitCode: setup.exitCode })
    const tree = yield* checkoutTree(trak, check)
    const key = yield* passKey(check, tree)
    // `RunChecks`' reading of a store that will not answer: not knowing is a miss.
    const before =
      key !== undefined &&
      (yield* passes.has(key).pipe(Effect.catchTag("StoreFailed", () => Effect.succeed(false))))
    if (before) {
      yield* keepPassedTree(trak, check, tree)
      return CheckCall.Reused()
    }
    const at = { trak: id, step: turn.step, call }
    const units = yield* unitsFor(trak, check, tree, true)
    const env = yield* checkEnv(trak, check, tree)
    const outcome = yield* (yield* Checks).run(check, workdir(trak), at, [], units, env)
    if (!outcome.passed)
      return CheckCall.Failed({ output: outcome.output, exitCode: outcome.exitCode })
    const recorded = key !== undefined && (yield* checkoutTree(trak, check)) === tree
    if (recorded) {
      yield* passes.record(key).pipe(Effect.catchTag("StoreFailed", () => Effect.void))
      yield* keepPassedTree(trak, check, tree)
    }
    return CheckCall.Passed({ output: outcome.output, recorded })
  }).pipe(
    Effect.tap((done) => line(lineOutcome(done))),
    Effect.onInterrupt(() => line("ended")),
  )
  const exit = yield* Fiber.await(yield* Effect.forkIn(run, turn.scope))
  if (Exit.isSuccess(exit)) return exit.value
  if (Exit.isInterrupted(exit)) return CheckCall.Ended()
  return yield* Effect.failCause(exit.cause)
})

/**
 * A condition as it is asked: a project's own script, or one of the two the engine
 * answers itself. `Deployed` carries the script it runs once the branch is in.
 */
type Condition =
  | { readonly _tag: "Time"; readonly until: number }
  | { readonly _tag: "Script"; readonly check: Check }
  | { readonly _tag: "Merged" }
  | { readonly _tag: "Deployed"; readonly script: Check }

/**
 * The conditions a position's agent declares, resolved, or none.
 *
 * `declaredEffects` without the skip: a condition is asked on the way *into* a
 * position, and nothing has been skipped at one nobody has reached. The other two
 * absences hold — `decide` asks at every first entry, and a compose or a spawn entry
 * has no agent to declare anything.
 *
 * Resolved to a union rather than through `scriptsNamed`, because two of the names
 * back onto no script: `merged` never, and `deployed` onto `deploy.sh` rather than
 * onto the registry. The dies are `scriptsNamed`'s, for its reason — `assembleLibrary`
 * refuses an unknown name and a `deployed` with no script before a trak starts, and
 * `ComposerOutputFor` refuses an entry's `wait_for: "deployed"` with no script.
 */
const declaredConditions = (
  lib: Library,
  trak: Trak,
  step: number,
): Effect.Effect<readonly Condition[]> => {
  const entry = trak.plan?.steps[step]
  if (entry === undefined || isSpawn(entry) || isCompose(entry)) return Effect.succeed([])
  const agent = agentNamed(lib, entry.agent)
  if (agent === undefined) return Effect.die(`step ${step} names unknown agent ${entry.agent}`)
  // The entry's own time first, ahead of the agent's conditions: it is known up front
  // and usually already past by the time the plan arrives, so asking it first costs
  // nothing — and where it is not past, it is the wait a person can see the end of.
  const until = waitUntilAt(trak, step)
  const time: readonly Condition[] = until === undefined ? [] : [{ _tag: "Time", until }]
  // Then the entry's own `wait_for`, and the agent's conditions after it less any name
  // the entry already asked: one name asked twice would log a second not-yet for a
  // wait that never moved.
  const waitFor = waitForOf(entry)
  const names = [...(waitFor === undefined ? [] : [waitFor]), ...agent.conditions]
  const declared = Effect.forEach([...new Set(names)], (name): Effect.Effect<Condition> => {
    const engine = engineCondition(name)
    if (engine === "merged") return Effect.succeed({ _tag: "Merged" })
    if (engine === "deployed") {
      return lib.deploy === undefined
        ? Effect.die(`step ${step} waits on \`deployed\` and the project has no deploy.sh`)
        : Effect.succeed({ _tag: "Deployed", script: lib.deploy })
    }
    const check = lib.checks.get(name)
    return check === undefined
      ? Effect.die(`agent ${agent.name} names unknown script ${name}`)
      : Effect.succeed({ _tag: "Script", check })
  })
  return Effect.map(declared, (own) => [...time, ...own])
}

/** One condition's answer: what it is called, what it said, and the commit the branch landed as, where known. */
interface Asked {
  readonly name: string
  readonly answer: ConditionAnswer
  readonly output: string
  readonly merged?: CommitSha
}

/**
 * Whether the trak's branch has gone in — the engine's own answer.
 *
 * **Met by the log first.** A trak that has landed is not asked about again, and
 * that is what makes a merge made from this machine pass the wait: `recordFacts` has
 * folded its sha onto the trak by the time this runs, so the forge is never consulted
 * about a merge the forge cannot see.
 *
 * Otherwise the forge's coarse listing, asked about this one branch — scalars only,
 * where the detailed query pays for pages nothing here reads. Every way of not
 * getting an answer is *not yet*, never a verdict: the forge unreachable, the branch
 * left out of the listing, a merged pull request the forge names no commit for. The
 * one answer that gives up is a pull request closed without merging, because the
 * branch is never going in that way and a person has to decide what happens instead.
 */
const notMergedYet = (output: string): Asked => ({ name: "merged", answer: "unmet", output })

/**
 * Whether the entry's own time has come — the engine's clock against the instant
 * `waitUntilAt` resolved. Never gives up: a clock cannot say *this is never happening*.
 * What it printed is the instant on the local clock, so the log reads as a person
 * would have written it.
 */
const timeAnswer = (until: number): Effect.Effect<Asked> =>
  Effect.map(
    Clock.currentTimeMillis,
    (now): Asked => ({
      name: WAIT_UNTIL,
      answer: now >= until ? "met" : "unmet",
      output: `until ${spellLocal(until)}`,
    }),
  )

const mergedAnswer = Effect.fn("mergedAnswer")(function* (trak: Trak) {
  const landed = trak.landed?.sha
  if (landed !== undefined) {
    return {
      name: "merged",
      answer: "met",
      output: `merged as ${landed}`,
      merged: landed,
    } satisfies Asked
  }
  const branch = trak.worktree?.branch
  if (branch === undefined) return notMergedYet("this trak has no branch to ask about")
  const listing = yield* (yield* Forge).listing([branch])
  if (listing._tag === "Unavailable") {
    return notMergedYet(`could not ask the forge: ${listing.why}`)
  }
  // A local merge is `trak.landed`, read above; with no remote nothing else can land it.
  if (listing._tag === "NoOrigin") return notMergedYet("there is no `origin` remote to ask")
  const pull = listing.entries.find((entry) => entry.branch === branch)?.pull
  if (pull === undefined) return notMergedYet(`no pull request on ${branch}`)
  const called = `pull request #${String(pull.number)}`
  if (pull.state === "closed") {
    return {
      name: "merged",
      answer: "stopped",
      output: `${called} was closed without merging`,
    } satisfies Asked
  }
  if (pull.state === "open") return notMergedYet(`${called} is open`)
  const sha = pull.mergeCommit
  return sha === undefined
    ? notMergedYet(`${called} merged, and the forge does not yet say as which commit`)
    : ({
        name: "merged",
        answer: "met",
        output: `${called} merged as ${sha}`,
        merged: CommitSha.make(sha),
      } satisfies Asked)
})

/**
 * The commit the branch has merged as, or nothing — `merged` asked once more, on its
 * own, as a person skips a wait: what refuses a write agent from a branch that has
 * gone in is the only thing worth learning before a held step is forced, and one
 * forge listing is what it costs. A wait on a project's own script is not asked
 * again — the press is the person saying not to wait for it.
 */
export const askMerged = (trak: Trak): Effect.Effect<CommitSha | undefined, never, Forge> =>
  Effect.map(mergedAnswer(trak), (asked) => asked.merged)

/**
 * `merged`, and then the project's deploy script with the merge commit as `$1` — run
 * from the project root, never a checkout: a deploy is of a commit that is on no
 * branch of ours, and a trak that has landed may have no checkout left at all. Under an
 * external store that is the project's sandbox, where the script is handed only the runner's
 * `pass:` of the engine's environment (`Checks.run`'s `inProject`).
 *
 * Not merged yet is the deploy not being live yet, said under this condition's own
 * name so the wait a surface draws is the one the agent declared. A pull request
 * closed without merging gives up here as it does there.
 */
const deployedAnswer = Effect.fn("deployedAnswer")(function* (
  trak: Trak,
  script: Check,
  root: string,
) {
  const merged = yield* mergedAnswer(trak)
  if (merged.answer !== "met" || merged.merged === undefined) {
    return {
      ...merged,
      name: "deployed",
      output: `not merged yet: ${merged.output}`,
    } satisfies Asked
  }
  const runner = yield* Checks
  const outcome = yield* runner.run(script, root, undefined, [merged.merged], undefined, {}, true)
  return {
    name: "deployed",
    answer: conditionAnswer(outcome.exitCode),
    output: outcome.output,
    merged: merged.merged,
  } satisfies Asked
})

/**
 * Ask whether the step at `step` may start: its agent's conditions in order, stopping
 * at the first that is not met, and the answer as the event `decide` routes on.
 *
 * **Exported, because the daemon asks too.** `AskConditions` runs this once on the
 * way into the step; `app/drive.ts` runs it again on the interval for a trak resting
 * on a not-yet, and appends what it returns only where the answer changed. One
 * function, so the two askers cannot read an exit code differently.
 *
 * No position goes to the runner, on `RunEffects`'s argument: a published run stands
 * in for this position's check in the daemon's memory, and a condition is not a
 * verdict on the work. `conditionAnswer` is where the exit code is read, and it is
 * read off the code alone — a script that timed out has none, and none is not yet.
 *
 * The commit the branch landed as rides either event whenever an answer found it, so
 * the log records the merge the moment a wait learns of it — `Trak.landed` is folded
 * from that, and a `deployed` wait learns it before the deploy is live.
 */
export const askConditions = Effect.fn("askConditions")(function* (trak: Trak, step: number) {
  const lib = yield* Lib
  const conditions = yield* declaredConditions(lib, trak, step)
  const runner = yield* Checks
  const ran: string[] = []
  let merged: CommitSha | undefined = trak.landed?.sha
  for (const condition of conditions) {
    const asked: Asked =
      condition._tag === "Time"
        ? yield* timeAnswer(condition.until)
        : condition._tag === "Merged"
          ? yield* mergedAnswer(trak)
          : condition._tag === "Deployed"
            ? yield* deployedAnswer(trak, condition.script, lib.root)
            : yield* Effect.map(
                runner.run(condition.check, workdir(trak)),
                (outcome): Asked => ({
                  name: condition.check.name,
                  answer: conditionAnswer(outcome.exitCode),
                  output: outcome.output,
                }),
              )
    merged = asked.merged ?? merged
    if (asked.answer !== "met") {
      return Events.conditionsUnmet(
        step,
        asked.name,
        asked.output,
        asked.answer === "stopped",
        merged,
      )
    }
    ran.push(asked.name)
  }
  return Events.conditionsMet(step, ran, merged)
})

const AskConditions = (
  trak: Trak,
  cmd: Extract<Command, { _tag: "AskConditions" }>,
): Effect.Effect<Event, never, Lib | Checks | Forge> => askConditions(trak, cmd.step)

/**
 * The scripts a position's agent declares as effects, or none.
 *
 * **Three positions legitimately have none, and none of them is an error** — which
 * is what makes this a lookup rather than `RunChecks`'s pair of `die`s. `decide`
 * enters `Effecting` at *every* step boundary, and a boundary is also what a spawn's
 * children joining and a person's `Skip` produce.
 *
 * A **skipped** position is the one worth stating: the entry still names an agent, so
 * its effects would resolve — and running them would send a document nobody wrote,
 * on the strength of a gate where a person said *carry on without this step*. Nothing
 * was filed, so there is nothing to act on.
 */
const declaredEffects = (
  lib: Library,
  trak: Trak,
  step: number,
): Effect.Effect<readonly Check[]> => {
  const entry = trak.plan?.steps[step]
  if (entry === undefined || isSpawn(entry) || isCompose(entry)) return Effect.succeed([])
  if (slotAt(trak, step).skipped) return Effect.succeed([])
  const agent = agentNamed(lib, entry.agent)
  // Unreachable for `SpawnStep`'s reason, and resolved the same way. Loud rather than
  // defaulted, because silently running no effects is a step that reported success and
  // sent nothing.
  if (agent === undefined) return Effect.die(`step ${step} names unknown agent ${entry.agent}`)
  return scriptsNamed(lib, agent.name, agent.effects)
}

/**
 * Run a step's effects in order and stop at the first failure, once its work is on
 * the branch.
 *
 * **The projection is rebuilt first, and nothing else here would work without it.**
 * `projection` filters at `i >= step` and is written only on the way into a turn, so
 * at this boundary `.orkestra/.trak/` still holds what the turn *before* this step
 * was given — the document this step just filed is not among them. Asking for
 * `step + 1` is what puts it there, and it is the only reason a script that sends
 * what was approved sends the thing that was approved.
 *
 * Fail-fast for `RunChecks`' reason, and one more of its own: an effect acts, so a
 * later one running after an earlier one could not is a partial send nobody asked
 * for.
 */
const RunEffects = Effect.fn("RunEffects")(function* (
  trak: Trak,
  cmd: Extract<Command, { _tag: "RunEffects" }>,
) {
  const lib = yield* Lib
  const effects = yield* declaredEffects(lib, trak, cmd.step)
  const [first] = effects
  // Nothing to send, so nothing to prepare: the common boundary, and the one where
  // writing the projection would be work no script is going to read.
  if (first === undefined) return Events.effectsRan(cmd.step, [])
  const projected = yield* Effect.either(projectTrak(trak, cmd.step + 1))
  // Its inputs could not be written, so the first effect could not run — which is
  // the same sentence a script that cannot be spawned produces, and it must be an
  // event rather than an escape or the trak strands in `Effecting`.
  if (projected._tag === "Left") {
    return Events.effectFailed(cmd.step, first.name, projected.left.reason)
  }

  const runner = yield* Checks
  const ran: RanEffect[] = []
  for (const effect of effects) {
    const outcome = yield* runner.run(
      effect,
      workdir(trak),
      undefined,
      [],
      undefined,
      targetEnv(trak),
    )
    if (!outcome.passed) return Events.effectFailed(cmd.step, effect.name, outcome.output, outcome)
    // Kept, where a passing check's output is thrown away: an effect acted outside
    // this checkout, so what it printed is the only record that it did.
    ran.push({
      name: effect.name,
      output: outcome.output,
      ...(outcome.place === undefined ? {} : { place: outcome.place }),
    })
  }
  return Events.effectsRan(cmd.step, ran)
})

/**
 * The spawn entry at a position, or a die. Every caller here has already been
 * routed to a spawn by `decide`, so anything else is an engine bug.
 */
const spawnAt = (trak: Trak, step: number): Effect.Effect<Spawn> => {
  const entry = trak.plan?.steps[step]
  return entry === undefined || !isSpawn(entry)
    ? Effect.die(`step ${step} is not a spawn`)
    : Effect.succeed(entry)
}

/**
 * An id per child, and nothing else. It creates them; it does not drive them.
 *
 * **Idempotent**, which is what `restartFrom` re-issues it on: the ids are on
 * this trak's log from the first time, so a restart hands back the same ones
 * rather than minting a second set of traks nobody would ever drive.
 *
 * **The batch is minted before any of it is in the store**, which is why naming
 * is the `Ids` layer's whole job rather than a call here: four children drawing
 * against what the log holds would all draw against the same empty answer.
 *
 * Git can refuse to say whether a name is taken, and that is the one failure
 * here — absorbed into an event on the rule this file states at the top, because
 * a command that escapes leaves the trak in flight with nothing able to move it.
 */
const SpawnChildren = Effect.fn("SpawnChildren")(
  function* (trak: Trak, cmd: Extract<Command, { _tag: "SpawnChildren" }>) {
    const spawn = yield* spawnAt(trak, cmd.step)
    // Empty rather than absent now that the slot is total — the same question,
    // since a recorded spawn always holds at least one run.
    const existing = slotAt(trak, cmd.step).children
    const ids = yield* Ids
    const minted =
      existing.length === 0
        ? yield* Effect.forEach(spawn.children, () => ids.newTrakId)
        : existing.map((r) => r.id)
    const [first, ...rest] = minted
    // Unreachable: `children` is a NonEmptyArray, so `forEach` over it produces at
    // least one id and a recorded list holds at least one run.
    return first === undefined
      ? yield* Effect.die(`spawn at step ${cmd.step} has no children`)
      : Events.childrenSpawned(cmd.step, [first, ...rest])
  },
  Effect.catchTag("GitFailed", gaveUp),
)

/**
 * What a hand-off is refused with where the repository cannot say what its default
 * branch is. A person reads it on the failed trak, and the fix is the command it names.
 */
const NO_DEFAULT_BRANCH =
  "no default branch: `origin/HEAD` is not set, so there is nothing to cut the handed-off trak from. Run `git remote set-head origin --auto` and resume"

/**
 * A trak for every description the compose entry handed off, named and nothing else.
 *
 * `SpawnChildren` one door over, and idempotent on its terms: the ids are on this
 * trak's log from the first time, so a restart hands back the same set rather than
 * naming a second one nobody would ever open. The base is read once, here, and rides
 * the event — a restart that finds it recorded does not ask git again, so the branch
 * a person read on the card is the branch the traks are cut from.
 *
 * **It names the traks; the daemon opens them** — `driveHandOff`, forked by
 * `app/drive.ts` once the drive that took the gate ends, one per id with no log. On the
 * trak of a goal still going it names none, and the goal's composer is woken with the
 * descriptions.
 *
 * Two ways git can refuse, both absorbed into `WorktreeFailed` on this file's rule:
 * the mint asking whether a name is taken, and a repository with no default branch
 * to cut from, which is the one refusal with a fix a person can be told.
 */
const HandOff = Effect.fn("HandOff")(
  function* (trak: Trak, cmd: Extract<Command, { _tag: "HandOff" }>) {
    // A going goal's trak opens nothing: the goal's watcher reads the descriptions off
    // this slot and wakes the goal composer, which decides whether they open. Read at the
    // moment the gate goes past, because a goal at rest has no composer to place them.
    if (trak.goal !== undefined) {
      const goal = replayGoal(trak.goal, yield* (yield* GoalStore).events(trak.goal))
      if (handsOffToGoal(goal)) return Events.handedToGoal(cmd.step)
    }
    const slot = slotAt(trak, cmd.step)
    const named = slot.handedOff
    const vcs = yield* Vcs
    const base = named?.base ?? (yield* vcs.defaultBranch())
    if (base === undefined)
      return yield* gaveUp(new GitFailed({ op: "read default branch", reason: NO_DEFAULT_BRANCH }))
    const ids = yield* Ids
    const minted =
      named === undefined ? yield* Effect.forEach(slot.handOffs, () => ids.newTrakId) : named.ids
    const [first, ...rest] = minted
    // Unreachable: `decide` issues this only where `handOffPending`, which needs at
    // least one description, and a recorded set holds at least one id.
    return first === undefined
      ? yield* Effect.die(`compose entry ${String(cmd.step)} handed nothing off`)
      : Events.handedOff(cmd.step, base, [first, ...rest])
  },
  Effect.catchTag("GitFailed", gaveUp),
)

/**
 * Bring back what the children made.
 *
 * **The git already happened.** A child's branch is merged into this checkout at
 * the moment a human closes that child as *merge* — see `MergeWork` — so by the
 * time every child has landed there is nothing left to bring in. What this does
 * is the other half `JoinChildren` always did: it is the one moment the batch
 * enters the trak, and `recordFacts` is what folds the artifacts and decisions.
 *
 * The fold keeps its single position for the reason it always had: children run
 * at the same time, so *latest wins* has nothing to rank them by, and two of them
 * deciding contradictory things is a fact a human should see together. That
 * argument never applied to the git, where the order is now a person's choice.
 *
 * `merged` is what actually went in, read off the landings — a dropped child has
 * no sha, which is the whole of what dropping it recorded.
 */
const JoinChildren = Effect.fn("JoinChildren")(function* (
  trak: Trak,
  cmd: Extract<Command, { _tag: "JoinChildren" }>,
) {
  yield* spawnAt(trak, cmd.step)
  const merged = slotAt(trak, cmd.step).children.flatMap((run) =>
    run.landing?.sha === undefined ? [] : [run.landing.sha],
  )
  return Events.childrenJoined(cmd.step, merged)
})

/**
 * Where a merge goes, which is the one thing a trak's own log decides.
 *
 * A **child** goes into its parent's checkout: that is where its branch came
 * from, it is the one destination Orkestra put there itself, and a piece coming
 * back is how the parent ends up sitting on work that shipped separately.
 * A goal's trak with a goal branch goes into the engine's checkout of that branch.
 * Anything else goes into the host repository, on whatever branch the human is
 * standing on.
 *
 * Reading the parent's log rather than carrying its checkout on the command: the
 * command names no destination on purpose, and the parent's worktree is a fact
 * about the parent that this trak's own log does not hold.
 */
const mergeDestination = (
  trak: Trak,
): Effect.Effect<MergeInto | undefined, StoreFailed | StoreUndecodable, Store> =>
  Effect.gen(function* () {
    const parent = trak.parent
    if (parent === undefined && trak.goal !== undefined && trak.goalBranch !== undefined) {
      return MergeInto.Goal({ goal: trak.goal, branch: trak.goalBranch })
    }
    if (parent === undefined) return MergeInto.Host()
    const store = yield* Store
    const worktree = replayHistory(parent.id, yield* store.events(parent.id)).worktree
    return worktree === undefined ? undefined : MergeInto.Checkout({ worktree })
  })

/**
 * Whether a spawn child's branch is dropped rather than merged: its parent has
 * landed, and the merge would bring in a commit the parent does not hold.
 *
 * The decode and the step entry refuse a writer once the parent has landed, but a
 * turn already running when the parent lands, or one that finished before it, has
 * left its edits on the child — and whichever commit carried them, a write step's,
 * a read-only step's after a chat or a replan took the writer's gate to the composer,
 * the commit past the last step, or one a person made by hand in the checkout, they
 * reach the merged branch at the merge. So nothing is attributed: the branch's
 * changes are dropped whole, and the child's documents land without them.
 *
 * **Git is asked, never the log.** The log misses a commit `CommitWork` never made,
 * and reads a checkout kept after a merge as moved whatever was committed since,
 * because its recorded base stays where the branch was cut. `Vcs.contains` reads
 * the graph: a branch the parent already holds merges as it always did, which is
 * what a child whose steps only read leaves, and what a child merged before the
 * landing and kept leaves when nothing changed after.
 */
const droppedUnderLanded = Effect.fn("droppedUnderLanded")(function* (
  trak: Trak,
  into: MergeInto,
  branch: BranchName,
) {
  const parent = trak.parent
  if (parent === undefined) return false
  const store = yield* Store
  if (replayHistory(parent.id, yield* store.events(parent.id)).landed === undefined) {
    return false
  }
  return !(yield* (yield* Vcs).contains(into, branch))
})

/** What the log says when a child's branch is dropped — see `droppedUnderLanded`. */
const CHANGES_DROPPED =
  "its parent's branch has merged, and nothing may go into a branch after it has merged: the changes on this branch were dropped, and what this piece filed reaches the parent without them. Take the change to a new trak"

/**
 * What the merge was aimed at, by name, for the record a conflict leaves.
 *
 * **The name, and only the name** — which is exactly what makes it safe to record.
 * A branch's name is settled for the life of the conflict where its tip is not, so
 * this travels to the composer and onto the resolving step's instruction, while what
 * is *on* the branch is read again when that step runs. Nothing here is a snapshot
 * of the destination's contents, so nothing here can go stale.
 *
 * `undefined` for a host on a detached `HEAD`, which is the one destination with
 * no name — `hostBranch` answers the same way and for the same reason.
 *
 * A goal branch is named `origin/<branch>`, never the bare name: the engine's goal
 * checkout is detached, so no local branch carries that name for the resolving step
 * to merge, and the remote tip is what the merge started from once levelled.
 */
const destinationName = (into: MergeInto): Effect.Effect<string | undefined, GitFailed, Vcs> =>
  MergeInto.$match(into, {
    Checkout: (c) => Effect.succeed<string | undefined>(c.worktree.branch),
    Host: () => Effect.flatMap(Vcs, (vcs) => vcs.hostBranch()),
    Goal: (g) => Effect.succeed<string | undefined>(`origin/${g.branch}`),
  })

/**
 * This trak's branch into wherever it belongs — the branch the host is standing
 * on, or, for a spawn's child, the parent's own checkout.
 *
 * **A child merges here rather than at the join**, which is what makes `Merged`
 * true when it is written: the epic's first sketch had a child sitting in
 * `Merged` while the git waited for `JoinChildren`, so the state claimed
 * something that had not happened and might never. Merging when a human says so
 * also puts a conflict in front of the person looking at the child that caused
 * it, rather than failing the parent once every child is done.
 *
 * **A conflict is its own event and the two outcomes here do not share one.**
 * Nothing was merged either way, but a conflict is the work disagreeing — which
 * routes to the composer — and a `GitFailed` is git declining to answer, which
 * still ends the trak with a sentence naming what a person can go and fix.
 */
const MergeWork = Effect.fn("MergeWork")(function* (trak: Trak) {
  const worktree = trak.worktree
  // Nothing to merge and nothing to merge into: the offline demos, on the guard
  // `CommitWork` shares.
  if (worktree === undefined) return Events.mergeFailed("no branch to merge")
  const into = yield* mergeDestination(trak)
  if (into === undefined) return Events.mergeFailed("its parent has no checkout to merge into")
  const vcs = yield* Vcs
  return yield* Effect.gen(function* () {
    if (yield* droppedUnderLanded(trak, into, worktree.branch)) {
      return Events.changesDropped(CHANGES_DROPPED)
    }
    // Every runner call it makes waits a short outage out on the trak's reattach window, as
    // a turn's ending does, rather than failing the merge on one timeout of the provider.
    const outcome = yield* waitingOutOutages(
      vcs.merge(into, worktree.branch, mergeMessage(trak, worktree.branch)),
    )
    return yield* MergeOutcome.$match(outcome, {
      Merged: (m) => Effect.succeed(Events.workMerged(m.sha)),
      // Asked only here, so a merge that goes in pays for no extra git.
      Conflicted: (c) =>
        Effect.map(destinationName(into), (name) => Events.conflicted(c.paths, name)),
    })
    // `mergeFailed` and not `gaveUp`: the checkout is fine, and the sentence names
    // what is in the way in a tree this trak does not own. The ancestry read above
    // is covered by the same catch — git declining to answer about the destination
    // is a fact about that tree too.
  }).pipe(
    Effect.catchTag("GitFailed", (e) => Effect.succeed(Events.mergeFailed(`${e.op}: ${e.reason}`))),
  )
})

/**
 * The turn that ended the last time this trak stood where it stands now, where it failed
 * as `unfetched`: its answer was dropped for want of the commits behind it, which a
 * restart fetches before anything else.
 */
const unfetchedBefore = (id: TrakId) =>
  Effect.map(
    Effect.flatMap(Store, (store) => store.events(id)),
    (history) => {
      const last = history.findLast((e) => e._tag !== "Restarted")
      return last?._tag === "TurnFailed" && last.unfetched === true ? last : undefined
    },
  )

/** Why a turn's answer is dropped: the fetch of its commits that `e` failed. */
const unfetchedReason = (e: GitFailed): string =>
  `the turn's commits could not be fetched from its sandbox, so its answer is dropped until they are: ${e.reason}`

/**
 * A turn, then its trak's branch brought into this repository from wherever the checkout
 * is — commits an agent made itself included. A fetch that fails is logged and the turn's
 * outcome stands: the next one carries the commits, and a merge fetches for itself.
 * **Not where the sandbox stayed out of reach for the whole reattach window after a turn
 * that answered** — the answer is dropped as `TurnFailed{unfetched}`, since no trak moves
 * on without its turn's commits, and the restart after it fetches first and starts
 * nothing until that fetch lands. `step` is the position the turn ran at.
 */
const fetchedAfter = <E, R>(
  trak: Trak,
  step: number | undefined,
  trigger: Trigger,
  turn: Effect.Effect<Event, E, R>,
) =>
  Effect.gen(function* () {
    if (trak.worktree === undefined) return yield* turn
    const vcs = yield* Vcs
    const owed = trigger._tag === "Interrupted" ? yield* unfetchedBefore(trak.id) : undefined
    if (owed !== undefined) {
      const first = yield* Effect.either(waitingOutOutages(vcs.fetchWork(trak.id)))
      if (first._tag === "Left") {
        return Events.turnUnfetched(
          step,
          owed.sessionId,
          unfetchedReason(first.left),
          undefined,
          first.left.runner,
        )
      }
    }
    const event = yield* turn
    const fetched = yield* Effect.either(waitingOutOutages(vcs.fetchWork(trak.id)))
    if (fetched._tag === "Right") return event
    const e = fetched.left
    if (isUnreached(e.runner) && event._tag === "AgentReturned") {
      return Events.turnUnfetched(step, event.sessionId, unfetchedReason(e), event.usage, e.runner)
    }
    if (isUnreached(e.runner) && event._tag === "ComposerReturned") {
      return Events.turnUnfetched(step, event.sessionId, unfetchedReason(e), event.usage, e.runner)
    }
    yield* Effect.logWarning(`${trak.id}: the turn's commits were not fetched: ${e.message}`)
    return event
  })

/**
 * Exhaustive Command -> runner. A new Command is a compile error until handled.
 * If this ever grows an `if`, the logic belongs in decide or an interaction.
 */
// ============================================================================
// The seam operation — every engine action that crosses into a sandbox
// ============================================================================

/**
 * What crossing the seam came to: the action ran, or there was nothing there for it.
 * `nothing-running` is a success: an action that ends something has nothing to end in a
 * sandbox that is stopped or gone.
 */
type Crossed = "done" | "nothing-running"

/**
 * Cross into the trak's sandbox for `action`: ask its state, cross, and wait a transport
 * failure out — the runner's `lost`, or the provider `unreachable` — on the outage's
 * backoff until the runner's `reattach_minutes` window is spent. Any other failure, a
 * `limited` among them, fails at once: nothing ran. Every step publishes one status for
 * the trak — see `SeamStatuses` — and the status is cleared however the crossing ends.
 *
 * **One window per outage, shared with every other caller of it** — `Outages` keeps it,
 * so an action after a turn that gave up on the same outage tries once rather than
 * waiting a second window. A spent window is the failure, carried on `GitFailed.runner`
 * for the caller to park the trak with.
 *
 * `cross` is the action's repeatable form, which this may run more than once. A sandbox
 * that is not running answers `nothing-running` without crossing: only an action that
 * ends something comes through here today, and a stopped sandbox has nothing running.
 * With no runner, or no checkout in a sandbox, there is no seam to cross.
 */
const crossSeam = (
  trak: TrakId,
  action: string,
  cross: (sandboxes: SandboxesShape) => Effect.Effect<void, GitFailed>,
): Effect.Effect<Crossed, GitFailed> =>
  Effect.gen(function* () {
    const sandboxes = Option.getOrUndefined(yield* Effect.serviceOption(Sandboxes))
    if (sandboxes === undefined || !(yield* sandboxes.holds(trak)))
      return "nothing-running" as const
    const statuses = Option.getOrUndefined(yield* Effect.serviceOption(SeamStatuses))
    const outages = Option.getOrUndefined(yield* Effect.serviceOption(Outages))
    const { runner, reattachMs } = yield* runnerFilesNow
    const since = yield* Clock.currentTimeMillis
    const say = (status: Omit<SeamStatus, "action" | "since">) =>
      statuses === undefined ? Effect.void : statuses.set(trak, { action, since, ...status })
    const crossings = yield* Ref.make(0)
    const retried = <A>(call: Effect.Effect<A, GitFailed>): Effect.Effect<A, GitFailed> =>
      outages === undefined || runner === undefined
        ? call
        : throughOutage(
            outages,
            trak,
            reattachMs,
            (e: GitFailed) => e.runner,
            (e, attempt, waitMs) =>
              Effect.zipRight(
                Effect.flatMap(Ref.get(crossings), (n) =>
                  say({
                    phase: "waiting",
                    attempt: n,
                    ...(e.runner?.kind === "lost" || e.runner?.kind === "unreachable"
                      ? { lastError: { kind: e.runner.kind, said: e.runner.said } }
                      : {}),
                  }),
                ),
                Effect.logWarning(
                  `${trak}: ${action} could not reach the sandbox, trying again in ${String(Math.round(waitMs / 1000))}s (try ${String(attempt + 1)}): ${e.runner?.said ?? e.reason}`,
                ),
              ),
          )(call)
    return yield* Effect.gen(function* () {
      yield* say({ phase: "readying", attempt: 0 })
      const state = yield* retried(sandboxes.status(trak))
      if (state !== "running") return "nothing-running" as const
      yield* retried(
        Effect.zipRight(
          Effect.flatMap(
            Ref.updateAndGet(crossings, (n) => n + 1),
            (n) => say({ phase: "crossing", attempt: n }),
          ),
          cross(sandboxes),
        ),
      )
      return "done" as const
    }).pipe(Effect.ensuring(statuses === undefined ? Effect.void : statuses.clear(trak)))
  })

/**
 * End the turn a person stopped, and say how: `Stopped`, or the trak parked `Failed` with
 * the runner's failure once the kill's window is spent.
 *
 * **Locally there is nothing left to do here.** The drive that runs this took the trak
 * over first, and that interruption's scope release is the kill — SIGTERM to the process
 * group, the grace period, then SIGKILL, which `provider-hazards` says must not be
 * shortened. A turn that had not spawned yet had its pending spawn cancelled the same
 * way. The run record is then clear, and there is nothing running.
 *
 * **Remotely the kill is `runner.sh kill`, through the seam operation**, for the exec the
 * record still names: a detached command the press kept past its close so this kill is
 * the one that ends it — see `stopDrive` in `src/app/drive.ts` — or one a dead engine
 * left, which a restart in `Stopping` issues this again for. The exec id was recorded
 * before the spawn, so a record always has one to kill by. Once the kill has answered,
 * nothing keeps the command any more and the record forgets the turn.
 */
const StopTurn = Effect.fn("StopTurn")(function* (
  trak: Trak,
  cmd: Extract<Command, { _tag: "StopTurn" }>,
) {
  const runs = yield* Runs
  const turn = yield* runs.inFlight(trak.id)
  const execId = turn?.rejoin ?? turn?.execId
  if (execId === undefined) return Events.stopped(undefined, undefined)
  const killed = yield* Effect.either(
    crossSeam(trak.id, "stop", (sandboxes) => sandboxes.kill(trak.id, execId)),
  )
  if (Either.isLeft(killed)) {
    const e = killed.left
    return Events.turnFailed(
      cmd.step,
      undefined,
      `the stop could not end the turn's command (exec ${execId}): ${e.reason}`,
      undefined,
      undefined,
      { runner: e.runner },
    )
  }
  const leaving = Option.getOrUndefined(yield* Effect.serviceOption(Leaving))
  if (leaving !== undefined) yield* leaving.rejoined(execId)
  yield* runs.ended(trak.id, execId)
  return Events.stopped(undefined, undefined)
})

const runCommand = (
  trak: Trak,
  cmd: Command,
): Effect.Effect<Event, RuntimeError | TurnLeft, RuntimeDeps> =>
  Command.$match(cmd, {
    SetupWorktree: () => SetupWorktree(trak),
    CommitWork: (c) => CommitWork(trak, c),
    RemoveWorktree: () => RemoveWorktree(trak),
    MergeWork: () => MergeWork(trak),
    // The five that run in the checkout. `CommitWork` and `RemoveWorktree` already
    // answer a checkout that is gone, and the rest work on branches.
    // A turn meets a setup still running in `Compose` and `SpawnStep`, and a check or an
    // effect waits for it to pass. A condition does not: it says whether a step starts,
    // not what the step builds on, and waiting there would hold the first turn of every
    // trak that opens on a step behind setup.
    Compose: (c) =>
      inCheckout(trak, (beside) =>
        fetchedAfter(
          trak,
          undefined,
          c.trigger,
          besideSetup(
            trak,
            beside,
            Effect.map(Lib, (lib) => lib.models.composer),
            (gate) => Compose(trak, c, gate),
          ),
        ),
      ),
    SpawnStep: (c) =>
      inCheckout(trak, (beside) =>
        fetchedAfter(
          trak,
          c.step,
          c.trigger,
          besideSetup(trak, beside, stepModel(trak, c.step), (gate) => SpawnStep(trak, c, gate)),
        ),
      ),
    RunChecks: (c) => inCheckout(trak, (beside) => afterSetup(beside, RunChecks(trak, c))),
    RunEffects: (c) => inCheckout(trak, (beside) => afterSetup(beside, RunEffects(trak, c))),
    AskConditions: (c) => inCheckout(trak, () => AskConditions(trak, c)),
    SpawnChildren: (c) => SpawnChildren(trak, c),
    HandOff: (c) => HandOff(trak, c),
    JoinChildren: (c) => JoinChildren(trak, c),
    StopTurn: (c) => StopTurn(trak, c),
  })

// ============================================================================
// advance — replayHistory, decide, append, act
// ============================================================================

/**
 * A `Restarted` carrying the turn it is ending, taken from the run record.
 *
 * **Which turn a restart ends is the engine's fact, not the caller's**, so it is
 * stamped at the append rather than passed in. A turn a dead process left in flight
 * has no ending on the log — the process that would have written one is the process
 * that went — so the restart picking the trak back up is that turn's only ending, and
 * a surface pairing a turn with what it filed can only do the arithmetic if the
 * restart names the position. Three sites write a `Restarted`, they reach `advance`
 * by three different routes, and the one that dropped the value on the way left an
 * interrupted turn with no ending at all. Here there is no value to drop.
 *
 * **The session stays the caller's**, and that is the line rather than an omission:
 * stamping it would change what a retry *does* — carry on the dead conversation
 * instead of starting a fresh one — where this changes only what the log records, and
 * `resume` lets a person name a session of their own.
 * the deferred entry *a child cut off before its first reply loses the session it was using*
 * holds that half.
 *
 * Safe to read at the append, because a `Restarted` is never written while a turn of
 * ours is running: one permit per trak serializes drives, and `runs.turn`'s scope
 * closes before either ending is appended. A record still naming a turn here belongs
 * to a process that is gone.
 */
const stampRestart = (id: TrakId, event: Event): Effect.Effect<Event, StoreFailed, Runs> =>
  event._tag === "Restarted"
    ? Effect.map(
        Effect.flatMap(Runs, (runs) => runs.inFlight(id)),
        (turn) => (turn === undefined ? event : Events.restarted(event.sessionId, turn.step)),
      )
    : Effect.succeed(event)

export const advance = (id: TrakId, event: Event): Effect.Effect<Trak, RuntimeError, RuntimeDeps> =>
  appended(id, event, "driving")

/**
 * Put one event on the log and run nothing a park would owe — `advance` for a caller
 * that is not driving the trak.
 *
 * A trak that parks with messages nobody read sends them as the gate's chat, which is
 * a turn, and a turn belongs to whatever holds the trak's drive key. A route appending
 * a setting or a waiting message holds none, so it records and leaves the chat to the
 * drive: the one in flight asks at its own park, and `app/drive.ts` starts one where
 * none is.
 */
export const record = (id: TrakId, event: Event): Effect.Effect<Trak, RuntimeError, RuntimeDeps> =>
  appended(id, event, "recording")

/**
 * Put one event on the log and run **none** of the commands its decision issues — the
 * person's intent, written before the work, for a drive to carry out.
 *
 * For an action whose outcome must survive an engine restart: the state it enters is on
 * the log before anything is done, so a restart reads it and `Restarted` re-issues the
 * command from there. `StopRequested` is the one caller. The drive that does the work
 * runs it with `owedStop`. `moved` says whether the event moved the trak, so only the
 * press that did takes the drive over.
 */
export const intend = (
  id: TrakId,
  event: Event,
): Effect.Effect<{ readonly trak: Trak; readonly moved: boolean }, RuntimeError, RuntimeDeps> =>
  Effect.map(onLog(id, event), ({ trak, decision }) => ({
    trak,
    // Whether the event moved the trak and owes a command — an `Advance` — rather than
    // re-parking where it already was.
    moved: decision._tag === "Advance",
  })).pipe(withProjectFiles)

/**
 * Run what a stopped trak owes, on the drive that took it over — the half of
 * `StopRequested` that `intend` left for it. `kept` is the exec the press kept past its
 * close, for this kill to end.
 *
 * **A trak no longer `Stopping` is carried on from where it is**, as a resume would carry
 * it. The turn's own ending raced the press and moved it — into `CheckRunning`, say — and
 * the take-over that brought this here interrupted the drive that was running what that
 * state owes. Handing the trak back would leave the checks unrun with nothing driving
 * them, so `Restarted` re-issues the command, and only where there is one: a gate or a
 * rest the ending reached owes nothing, and is left without an event. The exec the press
 * kept belongs to a turn that has ended, so nothing keeps it any more and the record lets
 * it go.
 */
export const owedStop = (
  id: TrakId,
  kept: string | undefined,
): Effect.Effect<Trak, RuntimeError, RuntimeDeps> =>
  Effect.gen(function* () {
    const trak = replayHistory(id, yield* (yield* Store).events(id))
    if (trak.state._tag === "Stopping") {
      const cmd = Command.StopTurn({ step: trak.state.step })
      return yield* asWork(runCommand(trak, cmd)).pipe(
        Effect.flatMap((event) => advance(id, event)),
        // A stop runs no turn, so none is left: see `TurnLeft`.
        Effect.catchTag("TurnLeft", () => Effect.succeed(trak)),
      )
    }
    if (kept !== undefined) {
      const leaving = Option.getOrUndefined(yield* Effect.serviceOption(Leaving))
      if (leaving !== undefined) yield* leaving.rejoined(kept)
      yield* (yield* Runs).ended(id, kept)
    }
    const resumed = Events.restarted(undefined)
    return decide(trak, resumed)._tag === "Advance" ? yield* advance(id, resumed) : trak
  }).pipe(withProjectFiles)

/**
 * The read, the decision and the append, under the trak's log permit — released before
 * any command runs, because a command re-enters `advance` for the same id. It is what lets
 * a person change how the trak is run *during* a turn: their append and this one cannot
 * interleave, so the decision made here is the one the log replays.
 */
const onLog = (
  id: TrakId,
  event: Event,
): Effect.Effect<{ readonly trak: Trak; readonly decision: Decision }, RuntimeError, RuntimeDeps> =>
  Effect.gen(function* () {
    const store = yield* Store
    const observer = yield* Observer
    const locks = yield* Locks

    const onTheLog = yield* locks.withLog(id)(
      readAgainOnConflict(
        Effect.gen(function* () {
          // Three parts of an event that are not the caller's to state: which turn a
          // restart ends — see `stampRestart` — which engine a turn ran under, and when. The time goes on here, before
          // the event is applied, so the trak handed to the commands below and the trak
          // the log replays agree about it: `Trak.planAt` is read off the event, and on
          // `auto` the plan that just landed is entered in this very call. The store
          // keeps the stamp — see `stamped` and `versioned`.
          const restart = yield* stampRestart(id, event)
          const entry = stamped(
            versioned(restart, yield* EngineVersion),
            yield* Clock.currentTimeMillis,
          )
          const history = yield* store.events(id)
          const applied = applyEvent(replayHistory(id, history), entry)
          // With the drive's fence where this fiber drives under one, and none from a press.
          yield* store.append(id, [entry], yield* locks.fenced(id, history.length))
          return applied
        }),
      ),
    )
    yield* observer.transition(onTheLog.trak, onTheLog.decision._tag)
    return onTheLog
  })

const appended = (
  id: TrakId,
  event: Event,
  mode: "driving" | "recording",
): Effect.Effect<Trak, RuntimeError, RuntimeDeps> =>
  Effect.gen(function* () {
    const { trak, decision } = yield* onLog(id, event)
    return yield* carriedOn(id, trak, decision, mode)
  }).pipe(
    // Each event takes the project files held now, so a turn finishes on the pair it
    // started with and the event its ending appends decides on whatever a reload left.
    withProjectFiles,
    Effect.withSpan("advance", { attributes: { trakId: id, event: event._tag } }),
  )

/**
 * `advance`, with the event chosen by `choose` — an effect with consequences of its own
 * outside the log — and nothing appended where it chooses none.
 *
 * **`choose` and the append run as one, past any interruption from outside**: a fiber
 * stopped between them would leave something done that no event records. What the
 * decision owes after the append is interruptible as any drive is. So `choose` holds back
 * a take-over, a stop or a shutdown for as long as it runs, and has to be bounded.
 *
 * **`choose` runs on a fiber of its own, interruptible, and this one waits for it**, which
 * is what lets its own bounds fire. Run here, inside the mask, a timeout could not
 * interrupt what it bounds and would wait for it to end; made interruptible here instead,
 * the drive's own interruption would land in it too. A daemon, so the drive being
 * interrupted does not reach it either.
 */
export const advanceAfter = <E, R>(
  id: TrakId,
  choose: Effect.Effect<Event | undefined, E, R>,
): Effect.Effect<Trak | undefined, RuntimeError | E, RuntimeDeps | R> =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const event = yield* Effect.flatMap(
        Effect.forkDaemon(Effect.interruptible(choose)),
        Fiber.join,
      )
      if (event === undefined) return undefined
      const { trak, decision } = yield* onLog(id, event)
      return yield* restore(carriedOn(id, trak, decision, "driving"))
    }),
  ).pipe(withProjectFiles)

/** What a decision owes once its event is on the log — `advance`'s second half. */
const carriedOn = (
  id: TrakId,
  trak: Trak,
  decision: Decision,
  mode: "driving" | "recording",
): Effect.Effect<Trak, RuntimeError, RuntimeDeps> =>
  Effect.suspend(() =>
    Decision.$match(decision, {
      // Each command's completion re-enters advance with the resulting event.
      // A turn left with no ending stops the rest: see `TurnLeft`.
      Advance: (r) =>
        Effect.map(
          Effect.reduce(r.commands, { trak, left: false }, (at, cmd) =>
            at.left
              ? Effect.succeed(at)
              : asWork(runCommand(at.trak, cmd)).pipe(
                  Effect.flatMap((next) => advance(id, next)),
                  Effect.map((t) => ({ trak: t, left: false })),
                  Effect.catchTag("TurnLeft", () => Effect.succeed({ trak: at.trak, left: true })),
                ),
          ),
          (at) => at.trak,
        ),
      // Parked. Nothing polls; the named party owes us an event — unless a person
      // already said it: messages nobody read are the chat at this gate. See `heldChat`.
      Await: () => {
        const chat = mode === "driving" ? heldChat(trak) : undefined
        return chat === undefined ? Effect.succeed(trak) : advance(id, chat)
      },
      Settle: () => Effect.succeed(trak),
    }),
  )

// ============================================================================
// Children — the two rules everything driving a spawn shares
// ============================================================================

/**
 * Drive one child of a parked spawn from wherever it is, and hand it back.
 *
 * **The engine does not drive children; the daemon does** — this is the shared
 * rule rather than the driving. `app/drive.ts` forks one of these per child that
 * needs one, four at a time, and a flow test calls it directly; both get the same
 * two behaviours:
 *
 *   · a child with no log is *born* — its request, its origin, the plan the spawn
 *     entry describes, and the parent's decisions so far;
 *   · a child that already has one is *re-driven*, which is what picks up one
 *     that a crash cut off, and re-parks one already sitting at its own gate.
 *
 * `Restarted` is the second, and it is the honest event for it: a human asked for
 * this trak to carry on, one level up. Nothing else in the log could say so. Which
 * turn it ends — where a killed daemon left one in flight — is `advance`'s to stamp
 * and not named here; the session that turn was using is nobody's yet, and
 * the deferred entry *a child cut off before its first reply loses the session it was using*
 * holds why.
 */
export const driveChild = Effect.fn("driveChild")(function* (
  parent: Trak,
  step: number,
  index: number,
) {
  const spawn = yield* spawnAt(parent, step)
  const run = slotAt(parent, step).children[index]
  const entry = spawn.children[index]
  if (run === undefined || entry === undefined) {
    return yield* Effect.die(`no child ${index} at step ${step} of trak ${parent.id}`)
  }
  const store = yield* Store
  const log = yield* store.events(run.id)
  if (log.length > 0) return yield* advance(run.id, Events.restarted(undefined))
  // The **parent's** request, not the child's instruction, which is what makes a
  // child's `trak.md` open with the same request-plus-decisions every other turn
  // reads. The instructions are what its plan entries say, where a step's
  // instruction always goes — a lens with no idea what it is a lens on would be
  // the whole of what a spawn got wrong.
  return yield* advance(
    run.id,
    Events.trakCreated(
      parent.description,
      {
        // The parent's own depth plus one. Carried rather than derived because
        // replay is per-log: this trak will never see its parent's events.
        parent: { id: parent.id, step, child: index, depth: (parent.parent?.depth ?? 0) + 1 },
        plan: childPlan(entry),
        // The parent's branch as it stands *now*, which is what makes bases
        // incremental without anything declaring a dependency: a child created
        // after a sibling merged back starts from that sibling's work. Every child
        // branches from it — a piece that ships on its own still has to come back,
        // or the parent is building against a world that moved.
        base: parent.worktree?.branch,
        // Under the keys the child files the documents by, so a note a parent's step
        // left on one lands on the copy the child opens rather than on nothing.
        decisions: inheritedDecisions(parent.decisions),
        // Everything the spawn position could see, which is what the step that
        // decided the split was reading. Not just the one before it: a piece is
        // often specified by one document and scoped by an earlier one, and the
        // child has no other way to reach either — the projection is gitignored, so
        // its branch carries neither.
        artifacts: visibleArtifacts(parent, step),
        // The whole spawn rather than this child's entry: what the *other* pieces
        // were asked to do is the only thing that says a topic is somebody else's,
        // and it exists nowhere a child can reach — `childPlan` takes the `Child`,
        // and a child never replays its parent's log.
        split: splitOf(spawn, step),
      },
      // How much of a piece its person wants to stand at is the answer they already
      // gave about the work it is a piece of. A child that dropped back to `manual`
      // would park a trak running unattended at every position of every spawn, which
      // is the one shape where the setting matters most.
      parent.mode,
      false,
      // Whose work it is follows the work: a piece of a trak is its owner's.
      parent.owner,
    ),
  )
})

/**
 * Open one trak a compose entry handed off, and hand it back.
 *
 * `driveChild`'s shape with half of its job: a hand-off with no log is *born* — the
 * description in the composer's own words, the base the `HandedOff` recorded, the mode
 * the trak that handed it off runs under, and which trak that was. One with a log is
 * handed back as it stands and driven no further: a handed-off trak is a trak a person
 * owns from its first gate, and nothing here waits on it, re-parks it or picks it up.
 *
 * Born holding nothing else, deliberately. A child inherits its parent's documents,
 * decisions and split because it is a piece of that work; this is not — it works from
 * a different base and reads what it needs fresh. The link is the whole of what
 * crosses, and it is what says why the trak exists.
 */
export const driveHandOff = Effect.fn("driveHandOff")(function* (
  from: Trak,
  step: number,
  index: number,
) {
  const slot = slotAt(from, step)
  const description = slot.handOffs[index]
  const id = slot.handedOff?.ids[index]
  const base = slot.handedOff?.base
  if (description === undefined || id === undefined || base === undefined) {
    return yield* Effect.die(
      `no hand-off ${String(index)} at step ${String(step)} of trak ${from.id}`,
    )
  }
  const store = yield* Store
  const log = yield* store.events(id)
  if (log.length > 0) return replayHistory(id, log)
  // The mode is the one answer the person already gave about this work: a trak
  // opened on their behalf while they said they would stand at nothing would park at
  // its plan gate with nobody coming, and one opened while they stand at everything
  // would run unread.
  // The owner, likewise: the work was handed off by their trak.
  return yield* advance(id, Events.trakHandedOff(description, base, from.id, from.mode, from.owner))
})

/**
 * A child that has been answered for lands on its parent, carrying the verdict.
 *
 * **`Merged`, `Closed` or `Abandoned`, never `Finished`.** A finished child is one
 * nobody has decided about yet — it holds its checkout like any other trak, and the
 * parent goes on waiting. What ends that wait is a person: *merge*, which has already
 * put the branch into the parent's checkout by the time this runs, or *close*,
 * which is the drop — pressed at the screen, or in advance by the trak's run mode,
 * which `endsUnattended` reads as the plan runs out. An *archive* of a child that
 * has not finished is the drop too, from wherever the child was standing. `sha` is
 * that difference and nothing else — where the work landed on the parent, or absent
 * because it did not.
 *
 * **A dropped child still folds.** Every document it filed and its decisions reach
 * the parent exactly as a merged one's do: a ruled-out approach is often the most
 * valuable thing a dropped piece produces, and `phase-2-intent.md` decision 5 says
 * so. Its branch does not — archiving deletes it, so what folds here is the whole
 * of what a drop keeps, and the confirmation on the press is what stood between a
 * person and that.
 *
 * One function, called by every surface that can move a trak, so a child closed
 * from the UI by its own id lands exactly as one closed from the CLI does. The
 * append is serialized by the parent's claim, which the caller must be holding —
 * two concurrent `advance` calls on one id would interleave `events` and `append`
 * and lose one.
 *
 * **A child that has already landed files what is new, as a `ChildRefiled`**, and
 * nothing when there is nothing new. A second `ChildLanded` would arrive in a state
 * that has moved past `AwaitingChildren` and fail the parent as an engine bug; and a
 * `resume` of the parent re-drives every child, so one answered for last week ends
 * its drive back where it was, with nothing the parent lacks — `filedSince`. A no-op
 * for anything else.
 */
export const landOnParent = Effect.fn("landOnParent")(function* (trak: Trak) {
  const parent = trak.parent
  const state = trak.state
  if (parent === undefined || !LANDS.has(state._tag)) return
  const store = yield* Store
  const before = replayHistory(parent.id, yield* store.events(parent.id))
  const log = yield* store.events(trak.id)
  const at = { step: parent.step, child: parent.child, id: trak.id }
  const landing = slotAt(before, parent.step).children[parent.child]?.landing
  const piece = pieceOn(before, parent)
  if (landing !== undefined) {
    const since = filedSince(trak, log, landing, piece)
    if (since !== undefined) yield* advance(parent.id, Events.childRefiled({ ...at, ...since }))
    return
  }
  // A parent not waiting on its children has nowhere to file a first landing: `decide`
  // answers `ChildLanded` at every other state as an engine bug and fails the trak.
  // The ordinary way here is the cascade — a parent being archived archives its
  // children, and each one comes back to a parent already `Abandoning`.
  if (before.state._tag !== "AwaitingChildren") return
  yield* advance(
    parent.id,
    Events.childLanded({
      ...at,
      // A child archived before `SetupWorktree` finished has no checkout and never had
      // a branch, so the name is the one `worktreeFor` would have given it rather than
      // one holding work the log does not — nothing is on it, and the landing is a
      // drop either way.
      branch: trak.worktree?.branch ?? branchFor(trak.id),
      // The merge commit on the parent's branch, which `Merged` holds because
      // `MergeWork` put it there. A close is a drop, and absent is what says so —
      // and so is an abandonment, whatever its branch held before the archive.
      sha: state._tag === "Merged" ? state.sha : undefined,
      // Keyed as the child filed them; the join puts them under the piece's name.
      artifacts: visibleArtifacts(trak, undefined),
      // What this child decided, not what it inherited. The parent's entries were
      // written into its `TrakCreated` and are already on the parent — sending
      // them back would duplicate the whole channel once per child. Through
      // `handedDecisions` rather than as they stand, or a `supersedes` naming one
      // of the child's own entries folds whatever the parent calls by that id.
      decisions: handedDecisions(trak, inherited(log), inherited(log), piece),
      handUp: handedUp(log),
    }),
  )
})

/**
 * The endings a child lands from. `Finished` is not one: the child is waiting for a
 * verdict, and the verdict is what lands it. Typed on the tag so a renamed state fails
 * here rather than quietly never landing.
 */
const LANDS: ReadonlySet<TrakState["_tag"]> = new Set<TrakState["_tag"]>([
  "Merged",
  "Closed",
  "Abandoned",
])

/**
 * What a landed child has filed that the parent does not yet hold, or `undefined` for
 * nothing — the child's own documents, decisions and hand-up, in the shape the
 * refiling carries.
 *
 * **Read against the landing, never the child's log**, because the landing is the
 * record of what was delivered and `recordRefiled` keeps it whole — so landing one
 * ending twice files once. Documents by key: an entry that has run is never touched,
 * so a key the landing carries still holds the document it carried. Decisions by
 * count: the child's own channel only appends, and the landing holds every one
 * delivered. The hand-up where the child's latest judgment is not the one that
 * landed — `handedUp` reads only the last.
 */
const filedSince = (
  trak: Trak,
  log: readonly Event[],
  landing: Landing,
  piece: ReturnType<typeof pieceOn>,
): Pick<Refiled, "artifacts" | "decisions" | "handUp"> | undefined => {
  const delivered = new Set(landing.artifacts.map(([key]) => key))
  const artifacts = visibleArtifacts(trak, undefined).filter(([key]) => !delivered.has(key))
  const decisions = handedDecisions(
    trak,
    inherited(log),
    inherited(log) + landing.decisions.length,
    piece,
  )
  const latest = handedUp(log)
  const handUp = latest === landing.handUp ? undefined : latest
  return artifacts.length === 0 && decisions.length === 0 && handUp === undefined
    ? undefined
    : { artifacts, decisions, handUp }
}

/**
 * What this trak's composer handed up to its parent, if anything.
 *
 * Off the last `finished` in the log, and only the last: a child that finished, was
 * sent back and finished again has had its composer judge twice, and the later judgment
 * is the one that stands. Absent when it never finished — a closed child — or finished
 * with nothing to say.
 */
const handedUp = (log: readonly Event[]): string | undefined => {
  const last = log.findLast((e) => e._tag === "ComposerReturned" && e.output.type === "finished")
  return last?._tag === "ComposerReturned" && last.output.type === "finished"
    ? last.output.handUp
    : undefined
}

/**
 * How many of a trak's decisions it was born holding.
 *
 * They are written first and the channel only ever appends, so a count is an
 * exact split rather than a heuristic — and it is the only one available: an
 * inherited entry and one this trak recorded are the same shape by design.
 */
const inherited = (log: readonly Event[]): number => {
  const first = log[0]
  return first?._tag === "TrakCreated" ? (first.decisions?.length ?? 0) : 0
}

// ============================================================================
// resume — startup only, derived from where the trak is parked
// ============================================================================

export const resume = Effect.fn("resume")(function* (id: TrakId) {
  const store = yield* Store
  // Spike only models Await{Human}: correct to sit forever, someone owes us an
  // action. The Process / Children / External branches go here.
  return replayHistory(id, yield* store.events(id))
})

// ============================================================================
// A goal's composer — one turn, outside any trak
// ============================================================================

/** The name a goal composer's session dials its tools under — `mcp__orkestra-goal__…` to Claude. */
const GOAL_TOOLS = "orkestra-goal"

/**
 * Where one of a goal's traks stands, off its own log: the state's tag, and a gate's
 * kind beside it. A log that will not read is said to be, rather than failing a turn that
 * is about the other traks too.
 */
const standingOf = (store: StoreShape, t: GoalTrak): Effect.Effect<TrakStanding> =>
  store.events(t.id).pipe(
    Effect.map((events) => {
      const state = replayHistory(t.id, events).state
      return state._tag === "AwaitingHuman" ? `${state._tag} (${state.kind})` : state._tag
    }),
    Effect.catchTags({
      StoreFailed: (e) => Effect.succeed(`unreadable: ${e.reason}`),
      StoreUndecodable: (e) => Effect.succeed(`unreadable: ${e.reason}`),
    }),
    Effect.map((state) => ({ id: t.id, title: t.title, mode: t.mode, state })),
  )

/**
 * Every goal in the project whose log reads, as the composer's pointer to the others is
 * built from. A log that will not read — or a list that will not — leaves that goal out
 * rather than failing a turn that is about this goal: the pointer is a courtesy.
 */
const everyGoal = (goals: GoalStoreShape): Effect.Effect<readonly Goal[]> =>
  goals.list().pipe(
    Effect.flatMap((ids) =>
      Effect.forEach(ids, (id) =>
        goals.events(id).pipe(
          Effect.map((log) => replayGoal(id, log)),
          Effect.catchTags({
            StoreFailed: () => Effect.succeed(undefined),
            StoreUndecodable: () => Effect.succeed(undefined),
          }),
        ),
      ),
    ),
    Effect.map((all) => all.filter((g) => g !== undefined)),
    Effect.catchTag("StoreFailed", () => Effect.succeed([])),
  )

/**
 * The composer read a waiting message: `markHeard`'s append, on the goal's log. A failed
 * append leaves the message waiting, and it is then the chat the goal owes itself — the
 * cheap direction to be wrong in.
 */
const goalHeard = (goals: GoalStoreShape, locks: LocksShape, goal: Goal, key: string) =>
  locks
    .withGoal(goal.id)(
      readAgainOnConflict(
        Effect.flatMap(goals.events(goal.id), (log) =>
          Effect.flatMap(locks.goalFenced(goal.id, log.length), (at) =>
            goals.append(goal.id, [GoalEvents.messageHeard(key)], at),
          ),
        ),
      ),
    )
    .pipe(Effect.ignoreLogged)

/**
 * What a composer turn does about the messages a person sent it, per provider event — a
 * trak turn's two rules. On `Spawned`, every message waiting on the goal's log goes down
 * the new process's pipe, read off the log rather than the goal the turn began from, so a
 * message sent a moment ago is handed over with one a restart found. On `MessageDelivered`,
 * the message is marked heard.
 */
const goalSteering = (
  goals: GoalStoreShape,
  goal: Goal,
  sessionId: SessionId,
  cwd: string,
  at: CheckoutPlace | undefined,
) =>
  Effect.gen(function* () {
    const provider = yield* Provider
    const locks = yield* Locks
    const prompts = yield* Prompts
    return (e: ProviderEvent): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (e._tag === "MessageDelivered" && e.key !== undefined) {
          yield* goalHeard(goals, locks, goal, e.key)
        }
        if (e._tag !== "Spawned") return
        const log = yield* goals.events(goal.id).pipe(Effect.orElseSucceed(() => []))
        yield* Effect.forEach(
          replayGoal(goal.id, log)?.messages ?? [],
          (m) =>
            Effect.flatMap(
              steeredMessage(prompts, m.id, m.message, m.attachments, cwd, at),
              (steered) => provider.steer(sessionId, steered),
            ),
          { discard: true },
        )
      })
  })

/**
 * What a goal composer's turn keeps while it runs: the session its provider announced, its
 * usage, the live list's listener, and the line that records each event into the goal's
 * transcript.
 */
const goalRecorder = Effect.fn("goalRecorder")(function* (
  goals: GoalStoreShape,
  goal: Goal["id"],
  announced: Ref.Ref<SessionId | undefined>,
  steering: (e: ProviderEvent) => Effect.Effect<void>,
) {
  const usage = yield* Ref.make(unmetered)
  // One line per burst of thinking, as a trak's transcript keeps it.
  const thought = yield* Ref.make<string | undefined>(undefined)
  // A ref rather than the live list's own answer, because the list is opened in the turn's
  // scope below and `recordLine` is built before it.
  const heard = yield* Ref.make<LiveHeard>(() => Effect.void)
  const recordLine = (e: ProviderEvent): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* Effect.flatMap(Ref.get(heard), (h) => h(e))
      yield* Ref.update(usage, (m) => metered(m, e))
      if (e._tag === "SessionStarted" && (yield* Ref.get(announced)) === undefined) {
        yield* Ref.set(announced, e.id)
      }
      yield* steering(e)
      if (e._tag === "Occupancy" || e._tag === "ContextWindow") return
      const last = yield* Ref.getAndSet(thought, e._tag === "Thinking" ? (e.text ?? "") : undefined)
      if (e._tag === "Thinking" && last === (e.text ?? "")) return
      const now = yield* Clock.currentTimeMillis
      yield* goals.appendTranscript(goal, carried(entryOf(e), "composer", now)).pipe(Effect.ignore)
    })
  return { usage, heard, recordLine }
})

/**
 * One turn of a goal's composer, ending in the event that says how it ended.
 *
 * **A conversation that ends in prose.** Everything the composer decides it decides by
 * calling a tool on the server `tools` names — appended to the goal's log by the daemon
 * while this turn is still running — so the turn's own words are only ever drawn, and
 * nothing here reads them. `converse` over a schema nothing decodes is exactly that: no
 * envelope settles the turn, and the text is the answer whole.
 *
 * **In the project checkout, and read-only.** A goal has no worktree; it plans from the
 * code and changes none. Under an external store that checkout is the project's sandbox's,
 * fetched from `origin` before the spawn, and the session reaches the goal's tools over
 * HTTP through a tunnel; otherwise it is the directory the engine started in, on this
 * machine. `full` rather than `read` for the composer's reason: `read` is
 * plan mode, and a tool call from the session's own MCP server must not stop on a
 * permission prompt nobody can answer — nor, under `auto`, on a classifier's refusal
 * nobody can clear. `read-only` is what still keeps the edit tools off.
 *
 * One session for the goal's life, resumed by every turn after the first, so the
 * composer keeps what it read and why it planned what it did.
 *
 * `tools` is absent where no engine is listening for its calls — a flow test that answers
 * them itself — and the session is then handed no server.
 *
 * **`sessionId` and `announced` are the caller's**, because a person reaches a running
 * turn through them: a message is steered down the pipe held by the id the turn was
 * requested under, and a stop files the session the CLI announced, which this sets.
 */
export const ComposeGoal = Effect.fn("ComposeGoal")(function* (
  goal: Goal,
  tools: GoalServers | undefined,
  sessionId: SessionId,
  announced: Ref.Ref<SessionId | undefined>,
) {
  const lib = yield* Lib
  const prompts = yield* Prompts
  const store = yield* Store
  const goals = yield* GoalStore
  // Counted before the turn, so a wake that lands while it runs is still owed one.
  const read = goal.wakes.length
  const traks = yield* Effect.forEach(goal.traks, (t) => standingOf(store, t))
  const signed = yield* credentialFor(goal.owner, lib.models.composer, yield* noRunner)
  if (signed._tag === "Left") {
    const parked: GoalEvent = GoalEvents.turnFailed(undefined, read, signed.left, unmetered.usage)
    return parked
  }
  const inProject = yield* projectPlace
  const cwd = inProject?.path ?? lib.root
  const steering = yield* goalSteering(goals, goal, sessionId, cwd, inProject)
  const images = yield* promptImages(cwd, goalAttachments(goal), inProject)
  const note = (text: string) =>
    Effect.gen(function* () {
      const line = carried(NoteEntry.make({ text }), "composer", yield* Clock.currentTimeMillis)
      yield* goals.appendTranscript(goal.id, line).pipe(Effect.ignore)
    })
  const own =
    tools === undefined ? undefined : inProject === undefined ? tools.here : tools.reached.tools
  const servers = yield* sessionServers(lib, own === undefined ? {} : { [GOAL_TOOLS]: own }, note)
  const request: SessionRequest = {
    prompt: buildGoalPrompt(prompts, goal, traks, yield* everyGoal(goals), lib.goals),
    ...(images.length === 0 ? {} : { images }),
    cwd,
    model: lib.models.composer,
    effort: lib.models.efforts.get(lib.models.composer),
    sessionId,
    toolAccess: "read-only",
    permission: "full",
    resumeFrom: goal.session,
    inherited: false,
    brief: { core: render(prompts, "goal/brief", {}), contract: "" },
    env: {},
    // With no external store this turn has no sandbox: a host that runs project work only
    // through a runner still runs it on its own machine.
    ...(inProject === undefined ? { allowedOnHost: true as const } : { inProject: true as const }),
    ...servers,
    ...signInOf(signed.right),
  }
  const { usage, heard, recordLine } = yield* goalRecorder(goals, goal.id, announced, steering)
  const turnTools = yield* TurnTools
  const turn = `goal ${goal.id}: composer turn`
  const started = yield* Clock.currentTimeMillis
  yield* Effect.logInfo(`${turn} started, session ${sessionId}`)
  const run = Effect.scoped(
    Effect.gen(function* () {
      yield* Ref.set(heard, yield* turnTools.live({ kind: "goal", id: goal.id }))
      if (inProject !== undefined && tools !== undefined) {
        yield* startedProject(inProject)
        yield* tools.reached.reach(note)
      }
      return yield* converse(Schema.Never, Schema.Never, (text) => text, request)
    }),
  )
  return yield* run.pipe(
    Effect.provideService(Transcript, { record: recordLine }),
    withSessionCopies(request, announced, note),
    reportRefused(signed.right.given),
    Effect.flatMap(() =>
      Effect.gen(function* () {
        const session = (yield* Ref.get(announced)) ?? sessionId
        const took = yield* tookSince(started)
        yield* Effect.logInfo(`${turn} ended, session ${session}, after ${took}`)
        const ended: GoalEvent = GoalEvents.turnEnded(session, read, (yield* Ref.get(usage)).usage)
        return ended
      }),
    ),
    Effect.catchTag("ProviderFailed", (e) =>
      Effect.gen(function* () {
        const session = yield* Ref.get(announced)
        const took = yield* tookSince(started)
        yield* Effect.logInfo(
          `${turn} failed, session ${session ?? sessionId}, after ${took}: ${e.reason}`,
        )
        const lost: GoalEvent = GoalEvents.turnFailed(
          session,
          read,
          e.reason,
          (yield* Ref.get(usage)).usage,
        )
        return lost
      }),
    ),
    // A drop or a stop interrupts the turn, and its route appends what it means.
    Effect.onInterrupt(() =>
      Effect.flatMap(tookSince(started), (took) =>
        Effect.logInfo(`${turn} interrupted, session ${sessionId}, after ${took}`),
      ),
    ),
  )
})
