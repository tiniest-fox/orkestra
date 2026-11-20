// The HTTP routes, against the real engine with faked edges.
//
// `apiRouter` is driven as an Effect with an `HttpServerRequest` provided, rather
// than over a socket: the statuses these handlers own (200 / 202 / 404 / 409) are
// values in the success channel, so they are assertable without binding a port.
// The platform's own mappings — a body that fails `ActRequestDto` becoming a 400
// — are its contract rather than this code's, and `dto.test.ts` pins the Schema
// that decides them.
//
// The theme is *what this surface owes*, which is mostly refusals: a request that
// must not reach `advance`, and the one that must. The exception is the fan-out at
// the end — a spawn's children exist because this daemon starts them, and nothing
// else in the repository asserts that it does.
//
// **An accepted action is two assertions, not one.** It answers 202 and forks, so a
// status alone says only that nothing was refused; `drove` waits for the drive and
// reads the log it wrote. A refusal stays synchronous and needs neither — which is
// the split this file is now organised around.
//
// The refusal cases seed the event log through `Store` rather than driving the
// engine into position. That is not a shortcut: these routes read the log and
// replay it, so a log IS the fixture, and it is the only way to hold a trak
// mid-turn without a hanging agent making the test depend on scheduling.

import { seedLog } from "../support/seed.js"
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Cause, Effect, Exit, Fiber, Option, Ref, Schedule, Schema } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerRequest from "@effect/platform/HttpServerRequest"
import { toWeb, type HttpServerResponse } from "@effect/platform/HttpServerResponse"
import { CreatedDto, MergePreviewDto, ResumePreviewDto } from "@orkestra/shared/dto/actions"
import { ChangesDto } from "@orkestra/shared/dto/changes"
import { RefusalDto } from "@orkestra/shared/dto/common"
import { AgentDto, McpConnectionNamesDto, ModelsDto } from "@orkestra/shared/dto/fleet"
import type { EntryDto } from "@orkestra/shared/dto/log"
import { OpenersDto, SandboxShellDto } from "@orkestra/shared/dto/openers"
import { EngineFrameDto } from "@orkestra/shared/dto/stream"
import {
  ArchivedTrakListDto,
  TrakDetailDto,
  TrakListDto,
  type TrakSummaryDto,
} from "@orkestra/shared/dto/trak"
import type { TranscriptEntryDto } from "@orkestra/shared/dto/transcript"
import { SessionId, type SessionRequest } from "../../src/agent/types/session.js"
import { ToolEntry } from "../../src/agent/types/transcript-entry.js"
import type { Usage } from "../../src/agent/types/usage.js"
import {
  afterRaised,
  afterReentry,
  afterReplan,
  child,
  childStep,
  childStepHangs,
  composer,
  composerRuns,
  type FlowDeps,
  onGit,
  runFlow,
  runFlowWithAgentLog,
  spawn,
  step,
  stepHangs,
  stepHangsAfterSpending,
  stepRuns,
} from "../support/flow.js"
import {
  create,
  createAndStart,
  expectState,
  human,
  act,
  idle,
  logged,
  logTags,
  workWaitingOn,
} from "../support/scenario.js"
import { library, workDeclaring } from "../support/library.js"
import { git, inWorktree, repoOf, worktreeOf, writeWork } from "../support/git.js"
import { parseMcpFile } from "../../src/library/logic/mcp-file.js"
import { fail, hangs, pass } from "../support/scripted-checks.js"
import { hangsOn, onPrompt, onResume, reply } from "../support/scripted-agent.js"
import { Checks } from "../../src/workflow/ports/checks.js"
import { GoalStore } from "../../src/workflow/ports/goal-store.js"
import { type InFlightTurn, Runs } from "../../src/workflow/ports/runs.js"
import { Store } from "../../src/workflow/ports/store.js"
import { StoreFailed } from "../../src/workflow/ports/store-errors.js"
import { Vcs } from "../../src/vcs/ports/vcs.js"
import type { GitFailed } from "../../src/vcs/types/errors.js"
import { FileStoreLayer } from "../../src/workflow/adapters/store-file.js"
import { GoalId, slotAt, TrakId } from "../../src/workflow/domain/trak.js"
import { GoalEvents } from "../../src/workflow/domain/goal.js"
import { replayHistory } from "../../src/workflow/domain/replay.js"
import { apiRouter } from "../../src/app/server.js"
import { projectDir } from "../../src/app/discovery.js"
import { advance, intend } from "../../src/workflow/runtime.js"
import { serving } from "../support/http.js"
import { countingStore, noReads, timesRead } from "../support/counting-store.js"
import { HostProject, NO_LOCAL_PATH } from "../../src/app/handoff.js"
import {
  Openers,
  type OpenOutcome,
  type OpenersShape,
  type RunOutcome,
} from "../../src/app/openers.js"
import { Sandboxes, type SandboxesShape } from "../../src/vcs/ports/sandboxes.js"
import { BUILD_COMMAND, bundleId, bundleState, clientRoute } from "../../src/app/client-bundle.js"
import { Drives, stopDrive } from "../../src/app/drive.js"
import { type Event, Events } from "../../src/workflow/domain/event.js"
import { Actions } from "../../src/workflow/domain/human-action.js"
import { proposal } from "../../src/workflow/domain/outputs/proposal.js"
import { artifact as makeArtifact } from "../../src/workflow/domain/outputs/artifact.js"
import { BranchName, CommitSha, WorktreePath } from "../../src/vcs/index.js"

// The whole API: this file is about how the routes fit together.
const { call, get, post } = serving(apiRouter())

const sid = SessionId.make("00000000-0000-4000-8000-000000000001")

const ONE_STEP = proposal("Add a --json flag", [
  { agent: "plan", instruction: "Produce the plan." },
])

/** The newest thing the agent did, for the two cases about what the list slot shows. */
const edited = ToolEntry.make({ name: "Edit", kind: "Edit", detail: "src/app/dto.ts" })

/** The trak the undecodable-log cases write a bad line into. */
const broken = TrakId.make("written-by-an-older-build")

/** A fresh directory that looks like a project — `orkestraDir` needs a marker. */
const newRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "orkestra-http-"))
  mkdirSync(join(dir, ".orkestra"), { recursive: true })
  return dir
}

const logIn = (dir: string, id: string): string =>
  join(dir, ".orkestra", ".database", "traks", id, "log.jsonl")

/**
 * A log that leaves the trak in `AgentWorking` with a remembered gate — the exact
 * shape the shipped bug needed: `state` says a turn is in flight, `Trak.lastGate`
 * still names the proposal gate it passed through. Sliced to 3 it is the same
 * trak parked at the proposal, which is how the custody case gets a request the
 * state check would otherwise allow.
 */
const midTurnLog = [
  Events.trakCreated("d"),
  Events.worktreeReady({
    path: WorktreePath.make("/tmp/wt"),
    branch: BranchName.make("trak/t"),
    base: CommitSha.make("base000"),
  }),
  Events.composerReturned(sid, ONE_STEP),
  Events.humanActed(0, human.approve()),
  Events.conditionsMet(0, []),
]

/** The same log as tags — what a refusal must leave untouched. */
const MID_TURN_TAGS: readonly string[] = midTurnLog.map((e) => e._tag)

/** `POST /api/traks` — a new trak, from a plan or from one agent. */
const start = (body: unknown) =>
  call(
    new Request("http://localhost/api/traks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )

const del = (path: string) =>
  call(new Request(`http://localhost/api/traks${path}`, { method: "DELETE" }))

const openers = (init?: RequestInit) => call(new Request("http://localhost/api/openers", init))

/** `POST /api/open` — a terminal or an editor at the project checkout. */
const openProject = (kind: "terminal" | "editor") =>
  call(
    new Request("http://localhost/api/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind }),
    }),
  )

/**
 * Open the stream, and leave the subscription open.
 *
 * **No `Effect.scoped`, and that is the whole point of a separate helper.** `call`
 * closes the request scope as it returns, which for every other route is right and for
 * this one shuts the subscription down before a single frame is read. The caller's
 * scope holds it instead — which is also what the platform does for a streaming
 * response, so the test and the server keep the subscription alive the same way.
 */
const openStream = (lastEventId?: string) =>
  Router.toHttpApp(apiRouter()).pipe(
    Effect.flatMap((app) =>
      Effect.provideService(
        app,
        ServerRequest.HttpServerRequest,
        ServerRequest.fromWeb(
          new Request("http://localhost/api/stream", {
            headers: lastEventId === undefined ? {} : { "last-event-id": lastEventId },
          }),
        ),
      ),
    ),
    Effect.orDie,
  )

/**
 * Read SSE blocks off a streamed response until `count` events have arrived.
 *
 * Hand-parsed because the point is the wire format: a client is going to read exactly
 * these bytes, and asserting on a decoded object the server never wrote would test the
 * helper. Comment blocks (`: open`, `: beat`) are skipped rather than counted — they
 * carry no data and a test that counted them would pass on heartbeats alone.
 */
const sseEvents = (
  response: HttpServerResponse,
  count: number,
  wanted: (frame: EngineFrameDto) => boolean = () => true,
): Effect.Effect<readonly EngineFrameDto[]> =>
  Effect.promise(async () => {
    // oxlint-disable-next-line unicorn/no-null -- the Web Streams API answers with it
    const body: ReadableStream<Uint8Array> | null = toWeb(response).body
    if (body === null) return []
    const reader = body.getReader()
    const decoder = new TextDecoder()
    const seen: EngineFrameDto[] = []
    let buffered = ""
    while (seen.length < count) {
      // A reader is sequential by definition — there is no set of promises to run at once.
      // oxlint-disable-next-line no-await-in-loop -- reading a stream is inherently serial
      const chunk = await reader.read()
      if (chunk.done) break
      buffered += decoder.decode(chunk.value, { stream: true })
      const blocks = buffered.split("\n\n")
      buffered = blocks.pop() ?? ""
      for (const block of blocks) {
        const data = block.split("\n").find((line) => line.startsWith("data: "))
        if (data === undefined) continue
        const frame = Schema.decodeUnknownSync(EngineFrameDto)(JSON.parse(data.slice(6)))
        if (wanted(frame)) seen.push(frame)
      }
    }
    await reader.cancel()
    return seen
  })

/**
 * The response body as it went out. `toWeb` is how a response becomes readable
 * here; `unknown` is an annotation rather than an assertion, the same shape
 * `extract.ts` and `store-file.ts` use for `JSON.parse`.
 */
const jsonOf = (response: HttpServerResponse): Effect.Effect<unknown> =>
  Effect.promise(async (): Promise<unknown> => {
    const text = await toWeb(response).text()
    const parsed: unknown = JSON.parse(text)
    return parsed
  })

/**
 * The same body, through the published contract. Decoding is an assertion in its
 * own right: a payload that does not satisfy `TrakDetailDto` throws here rather
 * than being read field by field. Use `jsonOf` instead when the point is what the
 * payload does NOT contain — decode strips unknown keys, so it cannot see them.
 */
const detailOf = (response: HttpServerResponse) =>
  Effect.map(jsonOf(response), Schema.decodeUnknownSync(TrakDetailDto))

/** The same, for the list route — the whole answer, rows and count. */
const listOf = (response: HttpServerResponse) =>
  Effect.map(jsonOf(response), Schema.decodeUnknownSync(TrakListDto))

/** The archive's answer to a search for `q`. */
const archived = (q: string) =>
  Effect.flatMap(get(`/archived?q=${encodeURIComponent(q)}`), (response) =>
    Effect.map(jsonOf(response), Schema.decodeUnknownSync(ArchivedTrakListDto)),
  )

/** The rows of the list route, which is what almost every case here reads. */
const summariesOf = (response: HttpServerResponse) => Effect.map(listOf(response), (l) => l.traks)

/** The summary fields the list route projects, hoisted for the same reason. */
const titlesOf = (
  listed: readonly (typeof TrakSummaryDto.Type)[],
): readonly (string | undefined)[] => listed.map((t) => t.title)

const instructionsOf = (
  listed: readonly (typeof TrakSummaryDto.Type)[],
): readonly (string | undefined)[] => listed.map((t) => t.instruction)

const agentsOf = (
  listed: readonly (typeof TrakSummaryDto.Type)[],
): readonly (string | undefined)[] => listed.map((t) => t.agent)

const activitiesOf = (
  listed: readonly (typeof TrakSummaryDto.Type)[],
): readonly (readonly TranscriptEntryDto[] | undefined)[] => listed.map((t) => t.activity)

/**
 * Log frames only.
 *
 * A turn writes to both of a trak's files, so its transcript lines arrive on the same
 * stream interleaved with its events — which is the feed working, and is why a test
 * about the log has to say which frames it means rather than counting whatever came
 * next.
 */
const isAppended = (frame: EngineFrameDto): boolean => frame._tag === "Appended"

/** What a log frame says, hoisted: a `.map` inside a flow body is one callback too many. */
const appendedAs = (frames: readonly EngineFrameDto[]): readonly (readonly unknown[])[] =>
  frames.map((f) => (f._tag === "Appended" ? [f.seq, f.event._tag, f.state._tag] : [f._tag]))

const tagsOf = (frames: readonly EngineFrameDto[]): readonly string[] => frames.map((f) => f._tag)

/** What a log frame says about how the trak is run, hoisted for `appendedAs`'s reason. */
const settingsOf = (frames: readonly EngineFrameDto[]): readonly (readonly unknown[])[] =>
  frames.map((f) => (f._tag === "Appended" ? [f.event._tag, f.mode, f.holding] : [f._tag]))

/** How many steps the plan on each log frame has — absent before the composer returns. */
const plansOf = (frames: readonly EngineFrameDto[]): readonly (number | undefined)[] =>
  frames.map((f) => (f._tag === "Appended" ? f.plan?.steps.length : undefined))

/** Custody frames only, for the same reason `isAppended` exists. */
const isDrive = (frame: EngineFrameDto): boolean => frame._tag === "Drive"

const isInFlight = (frame: EngineFrameDto): boolean => frame._tag === "InFlight"

/** What a custody frame says, hoisted for `appendedAs`'s reason. */
const custodyOf = (frames: readonly EngineFrameDto[]): readonly unknown[] =>
  frames.map((f) => (f._tag === "Drive" ? f.custody : f._tag))

const traksOf = (frames: readonly EngineFrameDto[]): readonly string[] =>
  frames.flatMap((f) =>
    f._tag === "Resync" || f._tag === "Goal" || f._tag === "Usage" || f.trak === undefined
      ? []
      : [f.trak],
  )

/** Hoisted: a predicate inline at the call site is one callback past the limit. */
const hasHumanActed = (tags: readonly string[]): boolean => tags.includes("HumanActed")
/** A `smart` trak's first event, for a drive forked past a plan gate the mode takes. */
const bornSmart = (): Event => Events.trakCreated("d", undefined, "smart")

/** The same on `manual`, for a drive that parks at the plan gate and lets go there. */
const bornManual = (): Event => Events.trakCreated("d")

/** The trak has reached its first gate — hoisted for the same reason. */
const hasComposed = (tags: readonly string[]): boolean => tags.includes("ComposerReturned")

/** A turn has come back. What an agent-first trak reaches with no composer in front. */
const hasReturned = (tags: readonly string[]): boolean => tags.includes("AgentReturned")

/** The step's conditions have been asked and met — the last append before its turn. */
const hasAsked = (tags: readonly string[]): boolean => tags.includes("ConditionsMet")

/** A streamed body as text, and the event a seeded trak is restarted with. Both
 *  hoisted: a lambda inside a flow body is one callback past the limit. */
const textOf = (response: HttpServerResponse): Effect.Effect<string> =>
  Effect.promise(() => toWeb(response).text())

const restart = (): Event => Events.restarted(undefined)

/** The ending, saying nothing — hoisted for the reason `restart` is. */
const endIt = (): Event => Events.abandoned("")

/**
 * Take a trak's drive over without going through the route.
 *
 * The one thing this file reaches past the surface for, because the window it pins
 * is *inside* the take-over: between the route's at-rest check and the fork, which
 * no request can be timed to land in.
 */
const takeOver = (id: TrakId): Effect.Effect<void, never, Drives> =>
  Effect.flatMap(Drives, (drives) => drives.takeOver(id, endIt)).pipe(Effect.orDie)

/** The log as the store holds it, for a case that reads the trak back after a drive. */
const eventsOf = (id: TrakId) => Effect.flatMap(Store, (store) => store.events(id))

/** The plan's shape at a glance — which entries stand, and in what order. */
const entryKinds = (detail: typeof TrakDetailDto.Type): readonly string[] | undefined =>
  detail.plan?.steps.map((s) => s.type)

/**
 * Accept an action and wait for what it started, then hand back the log it wrote.
 *
 * The pair is one helper because they are one assertion: `202` alone says nothing
 * happened yet, and a log read without the wait is a race. What the old synchronous
 * response promised — the state *and* the events that explain it — is now this.
 */
const drove = (
  id: TrakId,
  path: string,
  body: unknown,
): Effect.Effect<readonly string[], never, FlowDeps> =>
  Effect.gen(function* () {
    const response = yield* post(id, path, body)
    expect(response.status).toBe(202)
    yield* idle(id)
    const events = yield* Effect.flatMap(Store, (store) => store.events(id))
    return events.map((e) => e._tag)
  }).pipe(Effect.orDie)

/**
 * Press Stop and wait for the kill to land. The press is answered once its intent is on
 * the log, and the drive that kills is taken over in the background — so `idle` alone
 * can read the moment between the interrupted drive and the one that replaces it.
 */
const stoppedBy = (id: TrakId): Effect.Effect<readonly string[], never, FlowDeps> =>
  Effect.gen(function* () {
    const response = yield* post(id, "stop", {})
    expect(response.status).toBe(202)
    yield* logged(id, endsStopped)
    yield* idle(id)
    return yield* logTags(id)
  }).pipe(Effect.orDie)

/** Which traks the list drew at all — hoisted for the reason the two above are. */
const idsOf = (listed: readonly (typeof TrakSummaryDto.Type)[]): readonly string[] =>
  listed.map((t) => t.id)

/**
 * The ids a spawn minted, read off the parent's own log.
 *
 * Read rather than assumed. `FixedIds` makes them nameable, but a test that spelled
 * them out would still pass if the daemon drove a trak the parent had never heard of,
 * and the log is the only thing that says which two it is waiting on.
 */
const childrenOf = (id: TrakId): Effect.Effect<readonly TrakId[], never, Store> =>
  Effect.gen(function* () {
    const store = yield* Store
    const events = yield* store.events(id)
    return events.flatMap((e) => (e._tag === "ChildrenSpawned" ? e.ids : []))
  }).pipe(Effect.orDie)

/**
 * Wait out a drive **nothing here asked for**: first for the log to prove it began,
 * then for the fiber to be gone.
 *
 * **The order is the whole helper.** `idle` answers *nobody is driving this*, which is
 * equally true a moment before a drive that has not been forked yet — so a fan-out
 * test that read it then would assert against an empty log and pass for exactly the
 * reason the bug it guards existed. A log predicate is monotone and cannot be won
 * early, and a trak that has appended is one the map already holds, so `idle` after it
 * means finished rather than not started.
 *
 * `drove` is the same pair for a drive a request forked, and needs no log wait: the
 * map entry is in place before the 202 comes back.
 */
const daemonDrove = (
  id: TrakId,
  began: (tags: readonly string[]) => boolean,
): Effect.Effect<readonly string[], never, Drives | Store> =>
  Effect.gen(function* () {
    yield* logged(id, began)
    yield* idle(id)
    return yield* logTags(id)
  }).pipe(Effect.orDie)

/** Whether this daemon holds a fiber for a trak — the question the list route asks. */
const driving = (id: TrakId): Effect.Effect<boolean, never, Drives> =>
  Effect.flatMap(Drives, (drives) => drives.driving(id))

/**
 * Wait until a turn is recorded as in flight for this trak, and hand it back.
 *
 * **The wait `logged` cannot do, and the stop cases need it.** A turn's record is written
 * inside `SpawnStep`, after the event that entered the position is already on the log — so
 * a test that stopped as soon as `HumanActed` landed would sometimes read the record
 * before the turn wrote it and file a stop carrying no session, which is precisely the
 * bug these cases exist to catch. It is also the value: the session `Stopped` must carry
 * is this record's, and asserting against it is what says the two are the same.
 */
const turnInFlight = (id: TrakId): Effect.Effect<InFlightTurn, never, Runs> =>
  Effect.gen(function* () {
    const runs = yield* Runs
    // Read again after the wait rather than using what `repeat` hands back: with a
    // `schedule` it returns the schedule's own output, which is a repetition count —
    // the same trap `logged` records.
    yield* runs
      .inFlight(id)
      .pipe(Effect.repeat({ until: (t) => t !== undefined, schedule: Schedule.spaced("1 millis") }))
    return (yield* runs.inFlight(id)) ?? (yield* Effect.die("no turn in flight"))
  }).pipe(Effect.timeout("20 seconds"), Effect.orDie)

/** Wait until the turn in flight has announced its session on the transcript. */
const announcedIn = (id: TrakId): Effect.Effect<void, never, Store> =>
  Effect.flatMap(Store, (store) => store.transcript(id)).pipe(
    Effect.repeat({
      until: (entries) => entries.some((e) => e._tag === "Session"),
      schedule: Schedule.spaced("1 millis"),
    }),
    Effect.asVoid,
    Effect.timeout("20 seconds"),
    Effect.orDie,
  )

/** Wait until the turn in flight has a spend on its record, and hand that back. */
const reportedOn = (id: TrakId): Effect.Effect<Usage, never, Runs> =>
  Effect.gen(function* () {
    const runs = yield* Runs
    yield* runs.inFlight(id).pipe(
      Effect.repeat({
        until: (t) => t?.usage !== undefined,
        schedule: Schedule.spaced("1 millis"),
      }),
    )
    return (yield* runs.inFlight(id))?.usage ?? (yield* Effect.die("no spend recorded"))
  }).pipe(Effect.timeout("20 seconds"), Effect.orDie)

/** A mid-turn context reading, as Claude's `assistant` frame carries one. */
const midTurnReading = {
  model: "claude-haiku-4-5-20251001",
  call: "msg_011CfNMcRBoNb5vQTJnkudnN",
  inputTokens: 2,
  outputTokens: 16,
  cacheReadTokens: 83_327,
  cacheWriteTokens: 601,
}

/** Wait until the turn in flight has a context reading on its record, and hand that back. */
const readOn = (id: TrakId) =>
  Effect.gen(function* () {
    const runs = yield* Runs
    yield* runs.inFlight(id).pipe(
      Effect.repeat({
        until: (t) => t?.usage?.context !== undefined,
        schedule: Schedule.spaced("1 millis"),
      }),
    )
    return (yield* runs.inFlight(id))?.usage?.context ?? (yield* Effect.die("no reading recorded"))
  }).pipe(Effect.timeout("20 seconds"), Effect.orDie)

/**
 * What is recorded in flight right now — `turnInFlight`'s twin, without the wait.
 *
 * The case that needs it is the one where the answer must be `undefined`: waiting for
 * that would be waiting forever, and the point is to read the window rather than sit it
 * out.
 */
const recordedTurn = (id: TrakId): Effect.Effect<InFlightTurn | undefined, never, Runs> =>
  Effect.flatMap(Runs, (runs) => runs.inFlight(id)).pipe(Effect.orDie)

/** Every stop on a log, with the store's `at` dropped so a whole event compares. */
/** Every event of one tag on the log, with the clock's stamp taken off for comparison. */
const endingsOn = (id: TrakId, tag: Event["_tag"]): Effect.Effect<readonly Event[], never, Store> =>
  Effect.gen(function* () {
    const store = yield* Store
    const log = yield* store.events(id)
    return log.flatMap((e) => (e._tag === tag ? [{ ...e, at: undefined }] : []))
  }).pipe(Effect.orDie)

/** Every stop's intent — the event that carries the turn's ending. */
const stopsOn = (id: TrakId): Effect.Effect<readonly Event[], never, Store> =>
  endingsOn(id, "StopRequested")

/** Hoisted predicates, for the reason `hasHumanActed` is. */
const hasChecksPassed = (tags: readonly string[]): boolean => tags.includes("ChecksPassed")
const endsStopped = (tags: readonly string[]): boolean => tags.at(-1) === "Stopped"
const hasWorktreeReady = (tags: readonly string[]): boolean => tags.includes("WorktreeReady")
const hasRestarted = (tags: readonly string[]): boolean => tags.includes("Restarted")
const hasWorktreeRemoved = (tags: readonly string[]): boolean => tags.includes("WorktreeRemoved")

interface ChildRow {
  readonly id: string
  readonly of: string
  readonly step: number
  readonly child: number
}

/**
 * The rows that came out of a spawn, in the spawn's own order.
 *
 * Sorted rather than taken as listed: the store lists by directory and two children
 * born on two fibers do not agree on which of them was first. `child` is the position
 * in the spawn, which is the order that means something — and is the field the list
 * route carries for exactly this reason.
 */
const childRows = (listed: readonly (typeof TrakSummaryDto.Type)[]): readonly ChildRow[] =>
  listed
    .flatMap((t) =>
      t.parent === undefined
        ? []
        : [{ id: t.id, of: t.parent.id, step: t.parent.step, child: t.parent.child }],
    )
    .toSorted((a, b) => a.child - b.child)

/**
 * A plan whose middle entry is a spawn of two, and the turn each child's own trak
 * runs.
 *
 * The same builders `spawn.test.ts` uses, deliberately: a second set of fixtures for
 * one shape is how two files start disagreeing about what a spawn is. Positions are
 * the parent's — the composer's own entry is 0, so `work` is 1, the spawn is 2, and
 * the step after it is 3.
 *
 * **A child runs no composer.** Its first event is `TrakCreated` carrying the one-step
 * plan its entry describes, which is why nothing here matches the composer for a
 * child — and why `childStep` matches on the instruction rather than on an artifact
 * key, since both lenses are `review` and the key is identical.
 */
const lenses = spawn(child("review", "security"), child("review", "performance"))

const FAN_OUT = [
  composer("work", lenses, "plan"),
  step(1, "work", reply.artifact("the change")),
  childStep("review", "security", reply.artifact("no injection")),
  childStep("review", "performance", reply.artifact("one N+1")),
  step(3, "plan", reply.artifact("both addressed")),
]

/**
 * The same, with the first lens' turn started and never answered — which is what makes
 * *one child still running* a state rather than a race. The step after the spawn is
 * absent because nothing reaches it: one child never lands.
 */
const ONE_HANGS = [
  composer("work", lenses, "plan"),
  step(1, "work", reply.artifact("the change")),
  childStepHangs("review", "security"),
  childStep("review", "performance", reply.artifact("one N+1")),
]

describe("acting on a trak that is not parked", () => {
  it("refuses mid-turn with 409 rather than appending an event the engine will reject", async () => {
    // The defect this exists for: `Trak.lastGate` still names the proposal gate here,
    // so a guard reading it accepted the approval, `decide` refused the event as
    // unexpected, and a healthy trak went to `Failed{engine}`.
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, midTurnLog)

        const response = yield* post(id, "act", { action: "approve" })
        expect(response.status).toBe(409)

        // The refusal has to leave the log alone. A 409 that still appended would
        // fail the trak exactly as the bug did, just with a tidier status code.
        const after = yield* store.events(id)
        expect(after.length).toBe(midTurnLog.length)
      }),
    )
  })

  it("keeps a chat sent mid-turn as a waiting message, where every other action is refused", async () => {
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, midTurnLog)

        const response = yield* post(id, "act", { action: "chat", message: "keep --json" })
        expect(response.status).toBe(202)
        // One event and no drive: nothing was killed, and nothing answered it yet.
        const after = yield* store.events(id)
        expect(after.length).toBe(midTurnLog.length + 1)
        expect(after.at(-1)?._tag).toBe("MessageWaiting")
        expect(replayHistory(id, after).messages).toMatchObject([{ message: "keep --json" }])
      }),
    )
  })

  it("refuses a settled trak with 409", async () => {
    await runFlow([composer("plan"), step(1, "plan", reply.artifact("the work"))], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        // Approving the plan enters step 0; approving its artifact is the last
        // gate, so the trak settles.
        yield* act(id, 0, human.approve())
        const settled = yield* act(id, 1, human.approve())
        expect(settled.state._tag).toBe("Finished")

        const response = yield* post(id, "act", { action: "approve" })
        expect(response.status).toBe(409)
        // A chat too: at rest nothing is ahead to read it.
        expect((yield* post(id, "act", { action: "chat", message: "hi" })).status).toBe(409)
      }),
    )
  })
})

describe("recomposing a step while its turn runs", () => {
  it("takes the drive over, keeps the work, and runs the composer with the reason", async () => {
    // The one action that lands off a gate. The turn is hanging, the person recomposes,
    // and the route kills it and forks the replan in its place — one `HumanActed`, the
    // commit before the composer as at a gate, and the reason on the composer's prompt.
    await runFlowWithAgentLog(
      [
        composer("work"),
        stepHangs(1, "work"),
        afterReplan("work"),
        step(3, "work", reply.artifact("the other shape")),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* create(id, "d")
          expect((yield* post(id, "act", { action: "approve" })).status).toBe(202)
          const turn = yield* turnInFlight(id)

          const tags = yield* drove(id, "act", { action: "replan", reason: "do it the other way" })
          expect(tags.slice(-4)).toStrictEqual([
            "HumanActed",
            "WorkCommitted",
            "EffectsRan",
            "ComposerReturned",
          ])
          const detail = yield* detailOf(yield* get(`/${id}`))
          expect(detail.state).toStrictEqual({ _tag: "AwaitingProposal" })
          expect(composerRuns(yield* agentLog).at(-1)?.prompt).toContain("do it the other way")
          // The killed step stays in the plan and the ask lands after it: the press
          // carried the killed turn's session, so the position reads as run. Without it
          // the ask was written over the `work` entry and the plan read compose, compose.
          expect(entryKinds(detail)).toStrictEqual(["compose", "agent", "compose", "agent"])
          const trak = replayHistory(id, yield* eventsOf(id))
          expect(slotAt(trak, 1).session).toBe(turn.sessionId)
        }),
    )
  })

  it("records what the killed turn had spent, on the press and in the trak's total", async () => {
    // `stopRoute`'s read, on the one press that kills a turn: the spend the provider had
    // reported by the kill rides the `HumanActed`, and the list row's total folds it.
    const reported = {
      inputTokens: 2,
      outputTokens: 96_166,
      cacheReadTokens: 30_000,
      cacheWriteTokens: 4_000,
      runCostUsd: 1.5,
    }
    await runFlow(
      [composer("work"), stepHangsAfterSpending(1, "work", reported), afterReplan("work")],
      (id) =>
        Effect.gen(function* () {
          yield* create(id, "d")
          expect((yield* post(id, "act", { action: "approve" })).status).toBe(202)
          const turn = yield* turnInFlight(id)
          const spent = yield* reportedOn(id)

          yield* drove(id, "act", { action: "replan", reason: "do it the other way" })
          expect((yield* endingsOn(id, "HumanActed")).at(-1)).toStrictEqual({
            ...Events.humanActed(1, Actions.replan("do it the other way"), turn.sessionId, spent),
            at: undefined,
          })
        }),
    )
  })

  it("keeps the entry a chat was opened on, and the model picked with it", async () => {
    // The case that surfaced it: New Chat puts the pick on the one entry of a plan of
    // one, and the composer may never write a model — so an ask that landed on that
    // entry took the pick with it, silently. `opus` is nothing but the pick here.
    await runFlowWithAgentLog([stepHangs(0, "generic"), afterReplan("work")], (_, agentLog) =>
      Effect.gen(function* () {
        const id = yield* started(
          yield* start({ description: "Add a --json flag", agent: "generic", model: "opus" }),
        )
        const turn = yield* turnInFlight(id)
        expect(modelsOf(stepRuns(yield* agentLog))).toStrictEqual(["opus"])

        yield* drove(id, "act", { action: "replan", reason: "do it the other way" })
        const detail = yield* detailOf(yield* get(`/${id}`))
        expect(entryKinds(detail)).toStrictEqual(["agent", "compose", "agent"])
        const opened = detail.plan?.steps[0]
        expect(opened !== undefined && modelDrawn(opened)).toBe("opus")
        const trak = replayHistory(id, yield* eventsOf(id))
        expect(slotAt(trak, 0).session).toBe(turn.sessionId)
      }),
    )
  })

  it("refuses in the window where the state says a turn is running and none is recorded", async () => {
    // `midTurnLog` is the seeded window: the wire says `AgentWorking`, no fiber holds it
    // and no record names a turn. A recompose there takes a drive over with nothing to
    // kill, so it refuses exactly as a file does, and appends nothing. A stop is the one
    // press accepted there — see `what a stop refuses`.
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, midTurnLog)
        const response = yield* post(id, "act", { action: "replan", reason: "something else" })
        expect([response.status, response.statusText]).toStrictEqual([409, "NothingToStop"])
        expect((yield* store.events(id)).length).toBe(midTurnLog.length)
      }),
    )
  })
})

describe("acting on a trak this daemon is already driving", () => {
  it("refuses with 409 rather than putting a second agent on one log", async () => {
    // The assertion `testing-tiers` calls load-bearing, at its new altitude. A
    // second driver used to be another *process*, kept out by custody; one writer
    // means it is another *fiber*, kept out by the map of drives in flight. If
    // this ever passes for the wrong reason, two turns are appending to one log.
    //
    // `hangs` is what makes it deterministic: a scripted turn is otherwise
    // instantaneous, so the first drive would be finished before the second
    // request arrived and the race would decide the result. The hanging fiber is
    // interrupted when `runFlow`'s scope closes.
    await runFlow([composer("plan"), stepHangs(1, "plan")], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* create(id, "d")

        const first = yield* post(id, "act", { action: "approve" })
        expect(first.status).toBe(202)
        // The drive is in flight once its own `HumanActed` is down; the step it
        // then enters never answers, so the log stops growing there.
        const before = yield* logged(id, hasHumanActed)

        const second = yield* post(id, "act", { action: "approve" })
        expect(second.status).toBe(409)
        // A tidy status code that still appended is the bug wearing a hat.
        expect((yield* store.events(id)).length).toBe(before.length)
      }),
    )
  })
})

describe("ending a trak this daemon is already driving", () => {
  it("interrupts the turn in flight and abandons it, where every other action is refused", async () => {
    // The one action that takes the drive over rather than being turned away by it.
    // `stepHangs` is what makes it a state rather than a race: the turn is genuinely
    // in flight when the abandon arrives, so the 202 is the take-over and not a
    // request that happened to find the map empty.
    await runFlow([composer("plan"), stepHangs(1, "plan")], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        expect((yield* post(id, "act", { action: "approve" })).status).toBe(202)
        yield* logged(id, hasHumanActed)

        // The contrast, on the same trak in the same breath: acting is refused
        // here, and ending is not.
        expect((yield* post(id, "act", { action: "approve" })).status).toBe(409)

        // No reason: interrupting an agentic session never required an explanation.
        const tags = yield* drove(id, "abandon", { reason: "" })
        // The interrupted turn appends nothing on its way out — an interruption is
        // not a failure, so there is no `TurnFailed` between the two.
        expect(tags.slice(-3)).toStrictEqual(["Abandoned", "WorkCommitted", "WorktreeRemoved"])
        expect((yield* detailOf(yield* get(`/${id}`))).state._tag).toBe("Abandoned")
      }),
    )
  })

  it("records the killed turn's session, position and spend on the ending", async () => {
    // The same read a stop makes, before the kill: the interrupted turn appends nothing
    // on its way out, so this ending is the only place its spend can be kept — and an
    // archived trak still draws its total.
    const reported = {
      inputTokens: 2,
      outputTokens: 96_166,
      cacheReadTokens: 30_000,
      cacheWriteTokens: 4_000,
      runCostUsd: 1.5,
    }
    await runFlow([composer("plan"), stepHangsAfterSpending(1, "plan", reported)], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        expect((yield* post(id, "act", { action: "approve" })).status).toBe(202)
        const turn = yield* turnInFlight(id)
        const spent = yield* reportedOn(id)

        yield* drove(id, "abandon", { reason: "enough" })
        expect(yield* endingsOn(id, "Abandoned")).toStrictEqual([
          { ...Events.abandoned("enough", turn.sessionId, 1, spent), at: undefined },
        ])
      }),
    )
  })

  it("leaves an ending already running alone, because a host merge has no re-run", async () => {
    // `Merging` runs its `git merge` in the *host's* checkout, which is the one
    // command interrupting has no story for — so the endings keep the refusal every
    // other route gives. Seeded rather than driven: no ending here can be held in
    // flight, because git is real in these tests and answers instantly. The hanging
    // step is what puts a fiber under the key; the append is what puts the state in
    // front of the route.
    await runFlow([composer("plan"), stepHangs(1, "plan")], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* create(id, "d")
        yield* post(id, "act", { action: "approve" })
        yield* logged(id, hasHumanActed)
        yield* seedLog(store, id, [Events.abandoned("the first one")])
        const before = yield* store.events(id)

        const response = yield* post(id, "abandon", { reason: "and again" })
        expect(response.status).toBe(409)
        expect(Schema.decodeUnknownSync(RefusalDto)(yield* jsonOf(response))).toStrictEqual({
          _tag: "Driving",
        })
        expect((yield* store.events(id)).length).toBe(before.length)
      }),
    )
  })

  it("lands one ending under a double press, rather than failing the trak it ended", async () => {
    // The refusal that used to make this safe is the one the take-over removes: a
    // second press used to be `409 Driving` and then `409 AtRest`, both decided
    // before anything forked. Now the loser reaches the map, and `decide` answers an
    // ending at a trak already over with `Failed{engine}` — so the second press has
    // to find the trak at rest *after* the wait and stand down.
    await runFlow([composer("plan"), stepHangs(1, "plan")], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        yield* post(id, "act", { action: "approve" })
        yield* logged(id, hasHumanActed)

        const [first, second] = yield* Effect.all(
          [post(id, "abandon", { reason: "" }), post(id, "abandon", { reason: "" })],
          { concurrency: 2 },
        )
        expect([first.status, second.status]).toStrictEqual([202, 202])
        yield* idle(id)
        expect((yield* detailOf(yield* get(`/${id}`))).state._tag).toBe("Abandoned")
      }),
    )
  })

  it("stands down when the drive it interrupted was the one that ended the trak", async () => {
    // The window the press above races for, held still. Reached through `Drives`
    // because that is where it lives: the route's at-rest check is made before the
    // wait, and what the wait can produce is a trak already over. A `202` that
    // appended here would be the loser of a double press failing the trak the
    // winner ended.
    await runFlow([composer("plan"), step(1, "plan", reply.artifact("the work"))], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* create(id, "d")
        yield* act(id, 0, human.approve())
        expect((yield* act(id, 1, human.approve())).state._tag).toBe("Finished")
        const before = yield* store.events(id)

        yield* takeOver(id)
        yield* idle(id)
        expect((yield* store.events(id)).length).toBe(before.length)
        expect((yield* detailOf(yield* get(`/${id}`))).state._tag).toBe("Finished")
      }),
    )
  })

  it("finishes an ending that stopped, because nothing is driving that one", async () => {
    // The same state with no fiber under its key: a trak left in `Abandoning` by a
    // crash. The refusal above is about a drive, not about a tag, and this is the
    // half that keeps its sentence true — a person finishing what stopped is not a
    // person racing a `git merge`.
    await runFlow([composer("plan")], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* create(id, "d")
        yield* seedLog(store, id, [Events.abandoned("stopped halfway")])

        const tags = yield* drove(id, "abandon", { reason: "" })
        expect(tags.slice(-3)).toStrictEqual(["Abandoned", "WorkCommitted", "WorktreeRemoved"])
        expect((yield* detailOf(yield* get(`/${id}`))).state._tag).toBe("Abandoned")
      }),
    )
  })
})

describe("archiving a spawn", () => {
  it("takes the children with the parent, with no checkout and no branch left on either", async () => {
    // One child mid-turn and one parked at its gate, so the cascade reaches a drive to
    // kill and a trak with none. The parent settles `Abandoned` rather than `Failed`:
    // each child lands on it as it ends, and `landOnParent` files nothing for a parent
    // that has already left `AwaitingChildren`.
    // On git, because what is asserted is git's own branch and worktree lists.
    await onGit.runFlow(ONE_HANGS, (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "Rate-limit the public API")
        yield* drove(id, "act", { action: "approve" })
        const [security, performance] = yield* childrenOf(id)
        if (security === undefined || performance === undefined) {
          return yield* Effect.die("a spawn of two spawned otherwise")
        }
        yield* logged(security, hasWorktreeReady)
        yield* daemonDrove(performance, hasChecksPassed)
        const branches = [
          worktreeOf(yield* replayed(security)),
          worktreeOf(yield* replayed(performance)),
        ]
        const repoDir = repoOf(worktreeOf(yield* replayed(id)).path)

        const tags = yield* drove(id, "abandon", { reason: "" })
        // On the children's logs rather than `idle`: the cascade reaches each child on a
        // forked fiber, and `driving` reads false before that fiber has appended.
        yield* logged(security, hasWorktreeRemoved)
        yield* logged(performance, hasWorktreeRemoved)

        expect(tags.slice(-3)).toStrictEqual(["Abandoned", "WorkCommitted", "WorktreeRemoved"])
        expect((yield* detailOf(yield* get(`/${id}`))).state._tag).toBe("Abandoned")
        expect((yield* logTags(security)).slice(-3)).toStrictEqual([
          "Abandoned",
          "WorkCommitted",
          "WorktreeRemoved",
        ])
        expect((yield* logTags(performance)).slice(-3)).toStrictEqual([
          "Abandoned",
          "WorkCommitted",
          "WorktreeRemoved",
        ])
        // The parent's log carries no landing: a child coming back to a parent that is
        // ending has nothing to file, and a `ChildLanded` there would have failed it.
        expect(yield* logTags(id)).not.toContain("ChildLanded")
        for (const branch of branches) {
          expect(git(repoDir, "branch", "--list", branch.branch)).toBe("")
          expect(git(repoDir, "worktree", "list")).not.toContain(branch.path)
        }
      }),
    )
  })

  it("lands a piece archived on its own as a drop, and the parent joins what the rest produced", async () => {
    await runFlow(FAN_OUT, (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "Rate-limit the public API")
        yield* drove(id, "act", { action: "approve" })
        const [security, performance] = yield* childrenOf(id)
        if (security === undefined || performance === undefined) {
          return yield* Effect.die("a spawn of two spawned otherwise")
        }
        yield* daemonDrove(security, hasChecksPassed)
        yield* daemonDrove(performance, hasChecksPassed)

        yield* drove(security, "act", { action: "approve" })
        yield* drove(security, "merge", {})
        // Archived from its own band, at its gate: the route that used to refuse a child.
        const tags = yield* drove(performance, "abandon", { reason: "not this one" })

        expect(tags.slice(-3)).toStrictEqual(["Abandoned", "WorkCommitted", "WorktreeRemoved"])
        const landing = slotAt(yield* replayed(id), 2).children[1]?.landing
        expect(landing).toBeDefined()
        expect(landing?.sha).toBeUndefined()
        expect((yield* logTags(id)).slice(-8)).toStrictEqual([
          "ChildLanded",
          "ChildLanded",
          "ChildrenJoined",
          "WorkCommitted",
          "EffectsRan",
          "ConditionsMet",
          "AgentReturned",
          "ChecksPassed",
        ])
        expect((yield* detailOf(yield* get(`/${id}`))).state).toStrictEqual({
          _tag: "AwaitingHuman",
          step: 3,
          kind: "approval",
        })
      }),
    )
  })
})

describe("stopping the turn a trak has in flight", () => {
  it("kills it, ends it at its position, and parks where a person can redirect it", async () => {
    // `stepHangs` is what makes this a state rather than a race: the turn is genuinely
    // running when the stop arrives, so the `202` is the take-over and not a request that
    // found the map empty. The kill is the drive's scope closing, which is what
    // `takeOver` waits for before this returns.
    await runFlow([composer("plan"), stepHangs(1, "plan")], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        expect((yield* post(id, "act", { action: "approve" })).status).toBe(202)
        const turn = yield* turnInFlight(id)

        const tags = yield* stoppedBy(id)
        // The intent is the interrupted turn's only ending — nothing writes a `TurnFailed`,
        // because the process that would have is the one that was killed — and it names
        // the position, which is what keeps a filed document paired with the turn that
        // filed it. It is on the log before the kill, whose `Stopped` carries nothing.
        expect(tags.slice(-2)).toStrictEqual(["StopRequested", "Stopped"])
        expect(yield* stopsOn(id)).toStrictEqual([
          { ...Events.stopRequested(turn.sessionId, turn.step), at: undefined },
        ])
        expect((yield* detailOf(yield* get(`/${id}`))).state).toStrictEqual({
          _tag: "AwaitingHuman",
          step: 1,
          kind: "conversation",
        })
      }),
    )
  })

  it("records what the killed turn had spent, on the stop and in the trak's total", async () => {
    // The turn's own count dies with the fiber the stop interrupts, so the only spend
    // a stop can carry is what the provider had reported by then — read off the run
    // record with the session, before the kill. The list row's total is the other
    // reader of it: a stopped turn's tokens are the trak's tokens.
    const reported = {
      inputTokens: 2,
      outputTokens: 96_166,
      cacheReadTokens: 30_000,
      cacheWriteTokens: 4_000,
      runCostUsd: 1.5,
    }
    await runFlow([composer("plan"), stepHangsAfterSpending(1, "plan", reported)], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        expect((yield* post(id, "act", { action: "approve" })).status).toBe(202)
        const turn = yield* turnInFlight(id)
        // The record fills in as the provider reports, and the wait above returns
        // on the record's first write — before the report has landed on it.
        const spent = yield* reportedOn(id)
        expect(spent).toMatchObject({ outputTokens: 96_166, costUsd: 1.5, tools: {} })

        yield* stoppedBy(id)
        expect(yield* stopsOn(id)).toStrictEqual([
          { ...Events.stopRequested(turn.sessionId, turn.step, spent), at: undefined },
        ])
      }),
    )
  })

  it("resumes the conversation it killed, rather than starting the step over", async () => {
    // The whole feature in one assertion. The guidance rides the `Message` trigger that
    // already exists, so what reaches the agent is the sentence and nothing else — and
    // `resumeFrom` is what says it reaches the agent that had already read the code.
    await runFlow(
      [
        composer("plan"),
        stepHangs(1, "plan"),
        onPrompt(/do the other thing instead/, reply.artifact("the other work")),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* create(id, "d")
          yield* post(id, "act", { action: "approve" })
          const turn = yield* turnInFlight(id)
          yield* stoppedBy(id)

          yield* drove(id, "act", { action: "chat", message: "do the other thing instead" })
          const resumed = stepRuns(yield* agentLog).at(-1)
          expect(resumed?.resumeFrom).toBe(turn.sessionId)
          // Nothing framed around it: `step-message.md` is the message and the engine
          // prepends nothing about having been interrupted.
          expect(resumed?.prompt).toBe("do the other thing instead")
        }),
    )
  })

  it("stops a composer that has a plan, and taking that plan is still one press", async () => {
    // The second position a stop reaches. A person typed at the plan gate, the composer
    // started revising, and they changed their mind — so what they get back is the plan
    // they already had, on the gate they were standing at.
    await runFlow(
      [
        composer("plan"),
        hangsOn(/try it the other way/, "composer-hangs"),
        step(1, "plan", reply.artifact("the work")),
      ],
      (id) =>
        Effect.gen(function* () {
          yield* create(id, "d")
          yield* post(id, "act", { action: "chat", message: "try it the other way" })
          const turn = yield* turnInFlight(id)
          // The composer has no position, and absent is what says so — the same
          // convention `TurnFailed.step` uses.
          expect(turn.step).toBeUndefined()

          yield* stoppedBy(id)
          expect((yield* detailOf(yield* get(`/${id}`))).state).toStrictEqual({
            _tag: "AwaitingProposal",
          })

          const tags = yield* drove(id, "act", { action: "approve" })
          expect(tags.slice(-3)).toStrictEqual(["ConditionsMet", "AgentReturned", "ChecksPassed"])
        }),
    )
  })
})

describe("two stop presses on one turn", () => {
  it("lets a second press that re-parks in Stopping leave the first press's kill alone", async () => {
    // Two presses that both read `AgentWorking`: the first one's intent lands, and the
    // second's `StopRequested` re-parks in `Stopping`. Only the press that moved the trak
    // takes the drive over, so the turn is still running after the second press and is
    // ended once, by the first press's take-over.
    await runFlow([composer("plan"), stepHangs(1, "plan")], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        expect((yield* post(id, "act", { action: "approve" })).status).toBe(202)
        const turn = yield* turnInFlight(id)
        const pressed = Events.stopRequested(turn.sessionId, turn.step)

        yield* intend(id, pressed)
        const second = yield* stopDrive(id, pressed, undefined).pipe(Effect.orDie)
        expect(second.status).toBe(202)
        expect(yield* recordedTurn(id)).toBeDefined()
        expect(yield* driving(id)).toBe(true)

        yield* (yield* Drives).stopping(id, undefined)
        yield* logged(id, endsStopped)
        yield* idle(id)
        expect((yield* logTags(id)).slice(-3)).toStrictEqual([
          "StopRequested",
          "StopRequested",
          "Stopped",
        ])
      }),
    )
  })
})

describe("stopping a turn on a provider that mints its own session", () => {
  it("resumes the conversation a provider that mints its own id announced, not the minted one", async () => {
    // Codex takes no session id: it mints a thread and announces it, so the id the
    // runtime minted names nothing on Codex's side. The run record is what a stop — and
    // a restart after the engine died — reads the session from, and a record holding the
    // minted id sends `codex exec resume <minted>`, which fails `no rollout found for
    // thread id`, and fails again on every retry.
    const thread = SessionId.make("01a1170a-032b-7a91-90b4-d2cab7772db1")
    await runFlow(
      [
        composer("plan"),
        { ...stepHangs(1, "plan"), announces: thread },
        onPrompt(/do the other thing instead/, reply.artifact("the other work")),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* create(id, "d")
          yield* post(id, "act", { action: "approve" })
          yield* announcedIn(id)
          // The record a restart reads through `adopt` and a stop reads through `inFlight`.
          expect((yield* turnInFlight(id)).sessionId).toBe(thread)

          yield* stoppedBy(id)
          yield* drove(id, "act", { action: "chat", message: "do the other thing instead" })
          expect(stepRuns(yield* agentLog).at(-1)?.resumeFrom).toBe(thread)
        }),
    )
  })
})

describe("stopping one background task of the turn in flight", () => {
  it("refuses a trak that does not exist", async () => {
    await runFlow([], (id) =>
      Effect.gen(function* () {
        expect((yield* post(`${id}-missing`, "background/b1/stop", {})).status).toBe(404)
      }),
    )
  })

  it("refuses where no turn is in flight, and appends nothing", async () => {
    // A finished wait included: once the level has emptied and the turn ended, the task
    // a stale screen still shows has nothing left to stop.
    await runFlow([composer("plan"), step(1, "plan", reply.artifact("the work"))], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        const before = yield* logTags(id)
        const response = yield* post(id, "background/b1/stop", {})
        expect([response.status, response.statusText]).toStrictEqual([409, "NothingToStop"])
        expect(Schema.decodeUnknownSync(RefusalDto)(yield* jsonOf(response))).toStrictEqual({
          _tag: "NothingToStop",
        })
        // A tidy status code that still appended is the bug wearing a hat.
        expect(yield* logTags(id)).toStrictEqual(before)
      }),
    )
  })

  it("refuses where the turn's provider holds no pipe — a turn another process owns", async () => {
    // The scripted provider never holds one, which is exactly the shape of a turn a dead
    // daemon left in flight: `run.json` names a session and this process has no pipe for
    // it. The 204 half — a line written down a real pipe — is pinned in
    // `provider-claude-fixtures.test.ts` against the same route's provider call.
    await runFlow([composer("plan"), stepHangs(1, "plan")], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        expect((yield* post(id, "act", { action: "approve" })).status).toBe(202)
        yield* turnInFlight(id)
        const response = yield* post(id, "background/b1/stop", {})
        expect([response.status, response.statusText]).toStrictEqual([409, "NothingToStop"])
      }),
    )
  })
})

/**
 * File it at a step gate with nothing filed: the step is re-entered on the session its
 * asking turn held, told to settle what is open and file. Hoisted so the two gates it is
 * asserted over — a question and a stuck account — stay one short `it` rather than a loop.
 */
const filesFromParkedGate = (gate: {
  readonly output: string
  readonly kind: "answers" | "stuck"
}) =>
  runFlowWithAgentLog(
    [
      composer("plan"),
      step(1, "plan", gate.output),
      onPrompt(/File what you have/, reply.artifact("settled and filed"), "filed on request"),
    ],
    (id, agentLog) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        yield* drove(id, "act", { action: "approve" })
        expect((yield* detailOf(yield* get(`/${id}`))).state).toStrictEqual({
          _tag: "AwaitingHuman",
          step: 1,
          kind: gate.kind,
        })

        const tags = yield* drove(id, "file", {})
        expect(tags.slice(-3)).toStrictEqual(["FilingAsked", "AgentReturned", "ChecksPassed"])
        expect((yield* detailOf(yield* get(`/${id}`))).state).toStrictEqual({
          _tag: "AwaitingHuman",
          step: 1,
          kind: "approval",
        })
        // The forced turn resumed the session the asking turn was holding.
        const runs = stepRuns(yield* agentLog)
        expect(runs.at(-1)?.resumeFrom).toBe(runs[0]?.sessionId)
        expect(runs.at(-1)?.prompt).toMatch(/^## File what you have/)
      }),
  )

describe("asking the step to file what it has", () => {
  it("kills a running turn and re-enters the step on its session, asking for the document", async () => {
    // `stopRoute`'s take-over with the opposite ending: no gate opens for a person to
    // type at, the step runs again at once, and the session it runs on is the one the
    // killed turn was holding. What reaches the agent is the one body, and it is not
    // the bare sentence a person's message is.
    await runFlowWithAgentLog(
      [
        composer("plan"),
        stepHangs(1, "plan"),
        onPrompt(/File what you have/, reply.artifact("what there was"), "filed on request"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* create(id, "d")
          expect((yield* post(id, "act", { action: "approve" })).status).toBe(202)
          const turn = yield* turnInFlight(id)

          const tags = yield* drove(id, "file", {})
          expect(tags.slice(-3)).toStrictEqual(["FilingAsked", "AgentReturned", "ChecksPassed"])
          expect((yield* detailOf(yield* get(`/${id}`))).state).toStrictEqual({
            _tag: "AwaitingHuman",
            step: 1,
            kind: "approval",
          })
          const filing = stepRuns(yield* agentLog).at(-1)
          expect(filing?.resumeFrom).toBe(turn.sessionId)
          expect(filing?.prompt).toMatch(/^## File what you have/)
        }),
    )
  })

  it("ends a parked conversation the same way, with nothing to kill and nothing typed", async () => {
    // The first case the press exists for: a conversational step that would otherwise
    // have to be talked into filing. Prose on the forced turn is re-prompted rather than
    // read as another turn of the conversation — the turn goes through `elicit` on a
    // conversational step too, which is what makes the press mean something.
    await runFlowWithAgentLog(
      [
        composer({ agent: "plan", conversational: true }, "work"),
        step(1, "plan", reply.prose("What are we optimising for?")),
        onPrompt(/File what you have/, reply.prose("One more thought first —"), "still talking"),
        onResume(reply.artifact("filed on request"), "the retry files"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* create(id, "d")
          const parked = yield* drove(id, "act", { action: "approve" })
          expect(parked.at(-1)).toBe("AgentReturned")
          expect((yield* detailOf(yield* get(`/${id}`))).state).toStrictEqual({
            _tag: "AwaitingHuman",
            step: 1,
            kind: "conversation",
          })

          const tags = yield* drove(id, "file", {})
          expect(tags.slice(-3)).toStrictEqual(["FilingAsked", "AgentReturned", "ChecksPassed"])
          expect((yield* detailOf(yield* get(`/${id}`))).state).toStrictEqual({
            _tag: "AwaitingHuman",
            step: 1,
            kind: "approval",
          })
          // Three step turns: the conversation, the forced one, and the re-prompt that
          // filed. Under `converse` there would be two, and the trak would still be in
          // the conversation.
          const runs = stepRuns(yield* agentLog)
          expect(runs).toHaveLength(3)
          expect(runs[1]?.resumeFrom).toBe(runs[0]?.sessionId)
        }),
    )
  })

  // oxlint-disable-next-line vitest/expect-expect -- the assertions are in filesFromParkedGate
  it("re-enters a step that asked questions to settle and file", async () => {
    await filesFromParkedGate({ output: reply.questions("which port?"), kind: "answers" })
  })

  // oxlint-disable-next-line vitest/expect-expect -- the assertions are in filesFromParkedGate
  it("re-enters a step that is stuck to settle and file", async () => {
    await filesFromParkedGate({ output: reply.stuck("both attempts timed out"), kind: "stuck" })
  })

  it("refuses everywhere else, and appends nothing", async () => {
    // A composer writing a plan, a trak parked at its plan gate, and the window where the
    // state says a turn is running and no record names one — each `NothingToStop`, for
    // the reasons that refusal names. A document on the table refuses too, below.
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        const seeds: readonly (readonly Event[])[] = [
          midTurnLog.slice(0, 2),
          midTurnLog.slice(0, 3),
          midTurnLog,
        ]
        for (const [i, seed] of seeds.entries()) {
          const at = TrakId.make(`${id}-${String(i)}`)
          yield* seedLog(store, at, seed)
          const response = yield* post(at, "file", {})
          expect([response.status, response.statusText]).toStrictEqual([409, "NothingToStop"])
          expect((yield* store.events(at)).length).toBe(seed.length)
        }
      }),
    )
  })

  it("refuses a step that has already filed", async () => {
    await runFlow([composer("plan"), step(1, "plan", reply.artifact("the work"))], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        yield* drove(id, "act", { action: "approve" })
        const response = yield* post(id, "file", {})
        expect([response.status, response.statusText]).toStrictEqual([409, "NothingToStop"])
      }),
    )
  })
})

/**
 * The other half: the positions a stop must not reach, and the drives it must not touch.
 *
 * Its own `describe` for the reason the whole file is split this way — a refusal is
 * synchronous and needs neither the wait nor the log read an accepted action does.
 */
describe("what a stop refuses, and what it leaves running", () => {
  it("refuses a position that is not an agent turn, and appends nothing", async () => {
    // Two seeded shapes, for the reason every refusal case here is seeded: a log IS the
    // fixture. A trak writing its *first* plan has no plan gate to wait beside, and a
    // trak already at a gate has no turn to interrupt — and both would otherwise be
    // killed mid-drive with nowhere to land. `controls.test.ts` is where the same
    // refusal is asserted over every state at once.
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        const seeds: readonly (readonly Event[])[] = [
          midTurnLog.slice(0, 2),
          midTurnLog.slice(0, 3),
        ]
        for (const [i, seed] of seeds.entries()) {
          const at = TrakId.make(`${id}-${String(i)}`)
          yield* seedLog(store, at, seed)
          const response = yield* post(at, "stop", {})
          expect([response.status, response.statusText]).toStrictEqual([409, "NothingToStop"])
          expect(Schema.decodeUnknownSync(RefusalDto)(yield* jsonOf(response))).toStrictEqual({
            _tag: "NothingToStop",
          })
          // A tidy status code that still appended is the bug wearing a hat.
          expect((yield* store.events(at)).length).toBe(seed.length)
        }
      }),
    )
  })

  it("accepts a press before the turn is recorded, and the spawn it was waiting for never happens", async () => {
    // **The window, seeded rather than waited out**: the state says a turn is running and
    // `run.json` names none — under a runner, the minutes of waking the sandbox, copying
    // the session in and opening `reach` before `inFlight` writes the record. A refusal
    // there promised a second press a moment later; across minutes the person never got
    // it. So the press is accepted: the intent goes on the log, the kill finds nothing
    // running, and the trak parks at the conversation gate.
    //
    // A first turn has no session for the stop to carry, and that is the whole of what
    // this case costs: the message at the gate starts the step's first turn with the full
    // prompt and the message as guidance — `promptTrigger` renders a turn with nothing to
    // continue as `Initial`.
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, midTurnLog)
        expect((yield* detailOf(yield* get(`/${id}`))).state).toStrictEqual({
          _tag: "AgentWorking",
          step: 1,
        })
        expect(yield* recordedTurn(id)).toBeUndefined()

        const tags = yield* stoppedBy(id)
        expect(tags).toStrictEqual([...MID_TURN_TAGS, "StopRequested", "Stopped"])
        expect(yield* stopsOn(id)).toStrictEqual([
          { ...Events.stopRequested(undefined, 1), at: undefined },
        ])
        expect((yield* detailOf(yield* get(`/${id}`))).state).toStrictEqual({
          _tag: "AwaitingHuman",
          step: 1,
          kind: "conversation",
        })
      }),
    )
  })

  it("stops one piece of a spawn and leaves its siblings and its parent alone", async () => {
    // A drive is keyed by trak, so interrupting one takes exactly one fiber — which is
    // what makes *you stop a child on the child* true rather than merely intended. The
    // parent is refused for its own reason: it holds no turn while it waits.
    await runFlow(ONE_HANGS, (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "Rate-limit the public API")
        yield* drove(id, "act", { action: "approve" })
        const [security, performance] = yield* childrenOf(id)
        if (security === undefined || performance === undefined) {
          return yield* Effect.die("a spawn of two spawned otherwise")
        }
        yield* logged(security, hasWorktreeReady)
        const waiting = yield* daemonDrove(performance, hasChecksPassed)

        expect((yield* post(id, "stop", {})).status).toBe(409)
        const tags = yield* stoppedBy(security)

        expect(tags).toStrictEqual([
          "TrakCreated",
          "WorktreeReady",
          "ConditionsMet",
          "StopRequested",
          "Stopped",
        ])
        expect((yield* detailOf(yield* get(`/${security}`))).state).toStrictEqual({
          _tag: "AwaitingHuman",
          step: 0,
          kind: "conversation",
        })
        expect(yield* logTags(performance)).toStrictEqual(waiting)
        expect((yield* detailOf(yield* get(`/${id}`))).state).toStrictEqual({
          _tag: "AwaitingChildren",
          step: 2,
        })
      }),
    )
  })
})

describe("changing how a trak is run, part-way through", () => {
  it("lands while a turn is running, without a 409 and without touching the drive", async () => {
    // The whole point of the door: every other action is refused or kills the turn,
    // and this one is neither. `stepHangs` holds the turn open, so the `204` is a change
    // that landed *beside* a running agent rather than one that found the map empty.
    await runFlow([composer("plan"), stepHangs(1, "plan")], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        expect((yield* post(id, "act", { action: "approve" })).status).toBe(202)
        yield* logged(id, hasHumanActed)
        yield* turnInFlight(id)

        const response = yield* post(id, "mode", { mode: "auto" })
        expect(response.status).toBe(204)
        // On the log already, and read straight back — nothing was forked.
        expect((yield* logTags(id)).at(-1)).toBe("ModeChanged")
        const detail = yield* detailOf(yield* get(`/${id}`))
        expect([detail.mode, detail.state._tag]).toStrictEqual(["auto", "AgentWorking"])
        // The drive is still the one that was running: nothing killed, nothing re-forked.
        const drives = yield* Drives
        expect(yield* drives.driving(id)).toBe(true)
        expect(yield* recordedTurn(id)).toBeDefined()
      }),
    )
  })

  it("refuses a hold on manual, and appends nothing", async () => {
    // `midTurnLog` is a `manual` trak: the mode stands at every gate already, so a
    // hold is refused rather than recorded with nowhere on screen to draw it.
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, midTurnLog)
        const response = yield* post(id, "hold", { holding: true })
        expect([response.status, response.statusText]).toStrictEqual([409, "OnManual"])
        expect(Schema.decodeUnknownSync(RefusalDto)(yield* jsonOf(response))).toStrictEqual({
          _tag: "OnManual",
        })
        expect(yield* logTags(id)).toStrictEqual(MID_TURN_TAGS)
      }),
    )
  })

  it("refuses both on a trak at rest, where there is no next gate to reach", async () => {
    await runFlow([composer("plan"), step(1, "plan", reply.artifact("v1"))], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* create(id, "d")
        yield* act(id, 0, human.approve())
        yield* act(id, 1, human.approve())
        yield* drove(id, "close", {})
        const before = yield* store.events(id)

        for (const [path, body] of [
          ["mode", { mode: "auto" }],
          ["hold", { holding: true }],
        ] as const) {
          const response = yield* post(id, path, body)
          expect([response.status, response.statusText]).toStrictEqual([409, "AtRest"])
          expect((yield* store.events(id)).length).toBe(before.length)
        }
        expect((yield* post("nobody", "mode", { mode: "auto" })).status).toBe(404)
      }),
    )
  })

  it("carries the mode and the hold on every frame, so a screen patches rather than re-reads", async () => {
    await runFlow([composer("plan"), stepHangs(1, "plan")], (id) =>
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* openStream()
          const reading = yield* Effect.fork(sseEvents(response, 6, isAppended))
          // Forked, because on `smart` the plan gate goes past and the step hangs.
          const drives = yield* Drives
          yield* drives.start(id, bornSmart)
          yield* logged(id, hasComposed)
          expect((yield* post(id, "hold", { holding: true })).status).toBe(204)
          expect((yield* post(id, "mode", { mode: "manual" })).status).toBe(204)
          const frames = yield* Fiber.join(reading).pipe(Effect.timeout("20 seconds"), Effect.orDie)
          // The hold frame says it is pending; the mode frame says `manual` cleared it —
          // a fact the `ModeChanged` event on that frame does not carry.
          expect(settingsOf(frames).slice(-2)).toStrictEqual([
            ["HoldChanged", "smart", true],
            ["ModeChanged", "manual", false],
          ])
        }),
      ),
    )
  })
})

describe("starting a trak", () => {
  it("answers with the id and drives it, without waiting for the turn", async () => {
    await runFlow([composer("plan"), stepHangs(1, "plan")], () =>
      Effect.gen(function* () {
        const response = yield* start({ description: "Add a --json flag" })
        expect(response.status).toBe(202)

        // The id and nothing else: the drive was forked, so any state here would be a
        // guess about a turn that has not run. `FixedIds` is what makes it nameable.
        const created = Schema.decodeUnknownSync(CreatedDto)(yield* jsonOf(response))
        const id = TrakId.make(created.id)
        yield* logged(id, hasComposed)

        const detail = yield* detailOf(yield* get(`/${id}`))
        expect(detail.description).toBe("Add a --json flag")
        // No host named who pressed, so the trak belongs to nobody, as every trak did
        // before there were users.
        const [born] = yield* (yield* Store).events(id)
        expect(born).not.toHaveProperty("owner")
      }),
    )
  })

  it("starts on a dirty tree, from the last commit, and leaves the uncommitted work alone", async () => {
    await onGit.runFlow(
      [composer("plan"), stepHangs(1, "plan")],
      (_id, _agentLog, _checksLog, repoDir) =>
        Effect.gen(function* () {
          writeFileSync(join(repoDir, "half-done.ts"), "export const x = 1\n")

          const response = yield* start({ description: "Add a --json flag" })
          expect(response.status).toBe(202)
          const id = TrakId.make(Schema.decodeUnknownSync(CreatedDto)(yield* jsonOf(response)).id)
          yield* logged(id, hasComposed)

          // The trak's checkout is the commit and nothing else; the project checkout keeps
          // its work, untouched and still uncommitted.
          expect(git(worktreeOf(yield* replayed(id)).path, "status", "--porcelain")).toBe("")
          expect(git(repoDir, "status", "--porcelain")).toBe("?? half-done.ts")
        }),
    )
  })
})

/**
 * Starting a trak by naming an agent instead of describing work for the composer.
 *
 * **Nothing about the engine is new here, which is the point of asserting on it.**
 * `decide`'s `WorktreeReady` arm has entered step 0 of any trak born holding a plan
 * since spawn landed; all this route does is build one. What these cases pin is that
 * the route builds the *right* one — one entry, that agent, conversational — and that
 * the composer is genuinely not consulted rather than merely quiet.
 *
 * No composer turn is scripted in either flow. That is an assertion in itself: the
 * scripted agent fails loudly on a prompt it has no turn for, so a route that fell
 * through to `Compose` could not pass silently.
 */
/** The id the route minted, which is the only thing the 202 carries. */
const started = (response: HttpServerResponse) =>
  Effect.map(jsonOf(response), (body) => TrakId.make(Schema.decodeUnknownSync(CreatedDto)(body).id))

/** The model each request was handed — what spawns the CLI, so what the pick has to reach. */
const modelsOf = (requests: readonly SessionRequest[]): readonly string[] =>
  requests.map((r) => r.model)

/** What the header would draw for a plan entry: an agent step's resolved model. */
const modelDrawn = (s: EntryDto): string | undefined => (s.type === "agent" ? s.model : undefined)

/**
 * A step's turn, told from a composer's by the one line only a step's prompt carries —
 * rather than by the composer's marker, because a reconsult is a composer turn too.
 */
const ranStep = (r: SessionRequest): boolean => r.prompt.includes("artifact named")
const ranComposer = (r: SessionRequest): boolean => !ranStep(r)

describe("starting a trak with one agent rather than a plan", () => {
  it("is born holding the one entry, runs it first, and never asks the composer", async () => {
    await runFlow([step(0, "plan", reply.prose("What are we optimising for?"))], () =>
      Effect.gen(function* () {
        const response = yield* start({ description: "Sketch the drawer", agent: "plan" })
        expect(response.status).toBe(202)
        const id = yield* started(response)

        // No `ComposerReturned`, and no `HumanActed` approving a plan: the two events
        // every other trak's log opens with are the ones this path is defined by not
        // having.
        expect(yield* logged(id, hasReturned)).toEqual([
          "TrakCreated",
          "WorktreeReady",
          "ConditionsMet",
          "AgentReturned",
        ])

        const detail = yield* detailOf(yield* get(`/${id}`))
        // One entry, that agent, and `conversational` — which is what makes prose an
        // ordinary answer above rather than a decode failure. The title is the request
        // verbatim, so a row reads as it would with no plan at all.
        expect(detail.plan).toStrictEqual({
          title: "Sketch the drawer",
          steps: [
            {
              type: "agent",
              agent: "plan",
              instruction: "Sketch the drawer",
              conversational: true,
              // The agent file's own, resolved by the engine — the header's readback.
              model: "opus",
            },
          ],
        })
        // Standing *in* the conversation, not at a gate approving anything.
        expect(detail.state).toMatchObject({ _tag: "AwaitingHuman", kind: "conversation", step: 0 })
      }),
    )
  })

  it("comes to rest at Finished once its one artifact is approved", async () => {
    await runFlow([step(0, "plan", reply.artifact("the work"))], () =>
      Effect.gen(function* () {
        const id = yield* started(yield* start({ description: "Sketch it", agent: "plan" }))
        yield* logged(id, hasReturned)

        // The plan runs out after the entry it was born with, so approving is the
        // whole of the trak. Nothing here is agent-first behaviour — it is the
        // ordinary end of an ordinary plan, which is the claim worth pinning.
        expect(yield* drove(id, "act", { action: "approve" })).toContain("WorkCommitted")
        expect((yield* detailOf(yield* get(`/${id}`))).state._tag).toBe("Finished")
      }),
    )
  })

  it("refuses a name the fleet does not offer, before touching the tree", async () => {
    // `review` is the fixture's unstartable agent. A 400 rather than a refusal body:
    // the screen only ever sends what `/api/agents` gave it, so a name that got here
    // is a malformed request, which is what the platform already answers 400 for.
    await runFlow([], () =>
      Effect.gen(function* () {
        const store = yield* Store
        const response = yield* start({ description: "Sketch it", agent: "review" })
        expect(response.status).toBe(400)
        expect(response.statusText).toContain("review")
        expect(yield* store.list()).toStrictEqual([])
      }),
    )
  })

  it("refuses a name no agent has at all", async () => {
    await runFlow([], () =>
      Effect.gen(function* () {
        const response = yield* start({ description: "Sketch it", agent: "nonesuch" })
        expect(response.status).toBe(400)
      }),
    )
  })

  it("starts a chat: the engine's own agent, held beside the fleet, is startable", async () => {
    // `generic` is not in `lib.agents`, so a guard reading the fleet alone would answer
    // `400` to it. The route resolves the name the way a running step does, and the
    // trak it opens is the same one-entry conversational plan any named agent gets —
    // nothing about a chat is a special kind of trak.
    await runFlow([step(0, "generic", reply.prose("Which flag?"))], () =>
      Effect.gen(function* () {
        const response = yield* start({
          description: "How does the export work?",
          agent: "generic",
        })
        expect(response.status).toBe(202)
        const id = yield* started(response)
        // Driven rather than only created. Birth writing the right plan is what the
        // fleet-agent test above already pins; what only this name can go wrong at is
        // the spawn, where the step's agent is resolved a second time — and a scripted
        // turn nothing consumes would leave that untested with the plan still right.
        expect(yield* logged(id, hasReturned)).toContain("AgentReturned")
        const detail = yield* detailOf(yield* get(`/${id}`))
        expect(detail.plan?.steps).toMatchObject([
          {
            type: "agent",
            agent: "generic",
            instruction: "How does the export work?",
            conversational: true,
          },
        ])
        // Standing in the conversation, which is what `conversational` bought.
        expect(detail.state).toMatchObject({ _tag: "AwaitingHuman", kind: "conversation", step: 0 })
      }),
    )
  })
})

/**
 * The one field on the create request that is New Chat's alone. The pick rides the entry
 * the route builds and is read at the spawn site, so what these cases pin is that it
 * reaches the CLI for the chat's own turn and for nothing the chat grows into.
 */
describe("the model a chat is opened with", () => {
  it("runs the chat on the model picked, at the one site an entry's model meets its agent's", async () => {
    // `generic`'s model in the fixture is the composer's `haiku`, so `sonnet` is a pick
    // that can only have come from the entry. Asserted on the request the provider was
    // handed, because that is what spawns the CLI.
    await runFlowWithAgentLog([step(0, "generic", reply.prose("Which flag?"))], (_, agentLog) =>
      Effect.gen(function* () {
        const response = yield* start({
          description: "How does the export work?",
          agent: "generic",
          model: "sonnet",
        })
        expect(response.status).toBe(202)
        const id = yield* started(response)
        expect(yield* logged(id, hasReturned)).toContain("AgentReturned")
        expect(modelsOf(stepRuns(yield* agentLog))).toStrictEqual(["sonnet"])
        // The pick is on the entry, and nowhere else: it is what a replay reads back.
        const detail = yield* detailOf(yield* get(`/${id}`))
        expect(detail.plan?.steps).toMatchObject([{ agent: "generic", conversational: true }])
      }),
    )
  })

  it("runs the steps a replanned chat grows on their own agents' models, never the pick", async () => {
    // The chat raises work and is approved; the composer plans `work`, whose file names
    // `sonnet`; the plan is approved. `opus` is the pick because nothing else in the
    // flow names it — so a second `opus` anywhere would be the pick leaking.
    await runFlowWithAgentLog(
      [
        step(0, "generic", reply.raising("the answer", ["the export wants a --json flag"])),
        afterRaised("work"),
        // Index 2: the composer's own reconsult stands at 1, between the chat and the work.
        step(2, "work", reply.artifact("added the flag")),
      ],
      (_, agentLog) =>
        Effect.gen(function* () {
          const id = yield* started(
            yield* start({ description: "Add a --json flag", agent: "generic", model: "opus" }),
          )
          yield* logged(id, hasReturned)
          expect(yield* drove(id, "act", { action: "approve" })).toContain("ComposerReturned")
          expect(yield* drove(id, "act", { action: "approve" })).toContain("WorkCommitted")
          const log = yield* agentLog
          expect(log.matched).toStrictEqual(["step:0-generic", "raised", "step:2-work"])
          expect(modelsOf(log.requests.filter(ranStep))).toStrictEqual(["opus", "sonnet"])
          expect(modelsOf(log.requests.filter(ranComposer))).toStrictEqual(["haiku"])
        }),
    )
  })

  it("runs a step continuing the chat's session on the pick, never its own agent's", async () => {
    // The same flow, with the composer's `work` step continuing the chat's session. Its
    // file names `sonnet`; `opus` is the pick. Both turns read `opus` because the
    // second is the first's conversation resumed, and a session never changes model —
    // which is also what keeps a `claude` id from being handed to `codex`.
    await runFlowWithAgentLog(
      [
        step(0, "generic", reply.raising("the answer", ["the export wants a --json flag"])),
        afterRaised({ agent: "work", instruction: "Add it.", continues: "0-generic" }),
        step(2, "work", reply.artifact("added the flag")),
      ],
      (_, agentLog) =>
        Effect.gen(function* () {
          const id = yield* started(
            yield* start({ description: "Add a --json flag", agent: "generic", model: "opus" }),
          )
          yield* logged(id, hasReturned)
          expect(yield* drove(id, "act", { action: "approve" })).toContain("ComposerReturned")
          expect(yield* drove(id, "act", { action: "approve" })).toContain("WorkCommitted")
          const runs = stepRuns(yield* agentLog)
          expect(runs.at(-1)?.resumeFrom).toBe(runs.at(0)?.sessionId)
          expect(modelsOf(runs)).toStrictEqual(["opus", "opus"])
          // And the header says so: the detail carries the same answer the CLI got.
          const detail = yield* detailOf(yield* get(`/${id}`))
          expect(detail.plan?.steps.map(modelDrawn)).toEqual(["opus", undefined, "opus"])
        }),
    )
  })

  it("refuses a model the list does not hold, before touching the tree", async () => {
    // A 400 for the agent's reason: the screen sends only what `/api/models` listed,
    // so a name that reaches here is a hand-written request.
    await runFlow([], () =>
      Effect.gen(function* () {
        const store = yield* Store
        const response = yield* start({
          description: "Sketch it",
          agent: "generic",
          model: "gpt-9",
        })
        expect(response.status).toBe(400)
        expect(response.statusText).toContain("gpt-9")
        expect(yield* store.list()).toStrictEqual([])
      }),
    )
  })

  it("refuses a model sent with no agent — the composer's plan has no entry to carry it", async () => {
    await runFlow([], () =>
      Effect.gen(function* () {
        const store = yield* Store
        const response = yield* start({ description: "Sketch it", model: "sonnet" })
        expect(response.status).toBe(400)
        expect(yield* store.list()).toStrictEqual([])
      }),
    )
  })
})

describe("the model list", () => {
  it("sends `models.yaml` as loaded — the list in file order, and the default", async () => {
    await runFlow([], () =>
      Effect.gen(function* () {
        const response = yield* call(new Request("http://localhost/api/models"))
        expect(response.status).toBe(200)
        // `default` is the composer's model, which is also what the engine's own agent
        // runs on — so it is what a chat runs on when nobody picks.
        expect(Schema.decodeUnknownSync(ModelsDto)(yield* jsonOf(response))).toStrictEqual({
          default: "haiku",
          allowed: ["opus", "sonnet", "haiku"],
        })
      }),
    )
  })
})

describe("the declared MCP connections", () => {
  /** What the route answers for a project whose `.orkestra/mcp.yaml` holds `text`. */
  const answerFor = async (text: string | undefined): Promise<unknown> => {
    let answer: unknown
    await runFlow(
      [],
      () =>
        Effect.gen(function* () {
          const response = yield* call(new Request("http://localhost/api/mcp/connections"))
          expect(response.status).toBe(200)
          answer = yield* jsonOf(response)
        }),
      library({ mcp: parseMcpFile(".orkestra/mcp.yaml", text) }),
    )
    return answer
  }
  const namesOf = async (text: string | undefined): Promise<readonly string[]> =>
    Schema.decodeUnknownSync(McpConnectionNamesDto)(await answerFor(text)).names

  it("sends each `connection:` name once, in file order, and nothing else of any server", async () => {
    const file = [
      "servers:",
      "  linear: { url: https://mcp.linear.app/mcp, connection: linear-work }",
      "  drive: { url: https://mcp.drive.example/mcp, connection: drive }",
      "  linear-again: { url: https://mcp.linear.app/v2, connection: linear-work }",
      "  search: { url: https://search.example/mcp, headers: { Authorization: 'Bearer ${SEARCH_KEY}' } }",
      "  local: { command: ./serve, env: { TOKEN: '${LOCAL_TOKEN}' } }",
    ].join("\n")
    // Every server is declared, so the two left out are left out by the route.
    expect(parseMcpFile(".orkestra/mcp.yaml", file).servers).toHaveLength(5)
    expect(await answerFor(file)).toStrictEqual({ names: ["linear-work", "drive"] })
  })

  it("sends no names for a project with no file, or none that names a connection", async () => {
    expect(await namesOf(undefined)).toStrictEqual([])
    expect(await namesOf("servers:\n  local: { command: ./serve }")).toStrictEqual([])
  })
})

/** The fleet's two columns, hoisted for the reason every `.map` here is. */
const namesOf = (agents: readonly AgentDto[]): readonly string[] => agents.map((a) => a.name)

const describedAs = (agents: readonly AgentDto[]): readonly string[] =>
  agents.map((a) => a.description)

const named = (agents: readonly AgentDto[], name: string): AgentDto | undefined =>
  agents.find((a) => a.name === name)

describe("the agent library", () => {
  it("carries every agent, with `start` saying which may open a trak", async () => {
    await runFlow([], () =>
      Effect.gen(function* () {
        const response = yield* call(new Request("http://localhost/api/agents"))
        expect(response.status).toBe(200)
        const agents = Schema.decodeUnknownSync(Schema.Array(AgentDto))(yield* jsonOf(response))

        // `review` is the fixture's unstartable one and it is **here**, flagged rather
        // than omitted: a plan entry may name any agent, so a surface drawing a step
        // running one has to be able to resolve its name. Which agents a person may open
        // a trak with is still the engine's answer — it is now a field.
        expect(namesOf(agents)).toContain("review")
        expect(named(agents, "review")?.start).toBe(false)
        expect(named(agents, "work")?.start).toBe(true)

        // The engine's own is here too — a re-entry can put it on a plan, and a row
        // that could not resolve it would draw the fallback mark, which is the failure
        // no test sees. Its glyph is what makes that concrete. `start: true`: New Chat
        // opens a trak with it, and New Trak's shelf, filtering on the field, draws it.
        expect(named(agents, "generic")).toMatchObject({ start: true, icon: "bot" })

        // What the plan gate's swap reads: each agent's own model, and whether a plan may
        // name it. The engine's own is on no composer's plan, so a swap may not offer it.
        expect(named(agents, "work")).toMatchObject({ model: "sonnet", plannable: true })
        expect(named(agents, "review")?.plannable).toBe(true)
        expect(named(agents, "generic")).toMatchObject({ model: "haiku", plannable: false })
      }),
    )
  })

  it("sends the description whole, leaving how much of it to show to the surface", async () => {
    await runFlow([], () =>
      Effect.gen(function* () {
        const response = yield* call(new Request("http://localhost/api/agents"))
        const agents = Schema.decodeUnknownSync(Schema.Array(AgentDto))(yield* jsonOf(response))
        expect(describedAs(agents)).toContain("Decides how to build it, in sections.")
      }),
    )
  })

  it("carries each agent's `conditions:` verbatim, so a plan gate can mark the steps that wait", async () => {
    await runFlow(
      [],
      () =>
        Effect.gen(function* () {
          const response = yield* call(new Request("http://localhost/api/agents"))
          const agents = Schema.decodeUnknownSync(Schema.Array(AgentDto))(yield* jsonOf(response))
          // In the file's order, engine names and project scripts alike — which agents wait
          // is the project's to say, and the surface draws the names it is given.
          expect(named(agents, "work")?.conditions).toStrictEqual(["merged", "staging-ready"])
          expect(named(agents, "plan")?.conditions).toStrictEqual([])
        }),
      workWaitingOn(["merged", "staging-ready"]),
    )
  })
})

describe("skipping a wait", () => {
  it("refuses a trak nothing is holding, and appends nothing", async () => {
    // The accepted press is `conditions.test.ts`'s and `deploy.test.ts`'s: what it
    // owes here is the refusal, and that a refusal leaves the log as it was.
    await runFlow([composer("plan")], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* create(id, "d")
        const before = yield* store.events(id)
        const response = yield* post(id, "run-now", {})
        expect(response.status).toBe(409)
        expect(Schema.decodeUnknownSync(RefusalDto)(yield* jsonOf(response))).toStrictEqual({
          _tag: "NotWaiting",
        })
        expect((yield* store.events(id)).length).toBe(before.length)
        expect((yield* post("nobody", "run-now", {})).status).toBe(404)
      }),
    )
  })
})

/**
 * What a dead engine leaves when its pid is reissued: `run.json` names a holder that reads
 * as alive, and nothing drives the trak. Held open by an adoption in a scope of the test's
 * own — a holder with no drive behind it. The list said stopped and the page hid Resume,
 * because the page took custody from the record.
 */
const heldWithNoDrive = (id: TrakId) =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* seedLog(yield* Store, id, midTurnLog)
      const runs = yield* Runs
      yield* runs.adopt(id).pipe(Effect.orDie)
      const preview = Schema.decodeUnknownSync(ResumePreviewDto)(
        yield* jsonOf(yield* get(`/${id}/resume`)),
      )
      return {
        record: yield* runs.holder(id).pipe(Effect.orDie),
        detail: yield* detailOf(yield* get(`/${id}`)),
        interrupted: preview.interrupted,
        listed: (yield* summariesOf(yield* get(""))).find((t) => t.id === id)?.running,
      }
    }),
  )

describe("a holder on the record with no drive behind it", () => {
  it("reads as stopped on the page, the resume preview and the list", async () => {
    await runFlow([], (id) =>
      Effect.map(heldWithNoDrive(id), (seen) => {
        expect(seen.record).toBeDefined()
        expect(seen.detail.state).toStrictEqual({ _tag: "AgentWorking", step: 1 })
        expect(seen.detail.custody).toStrictEqual({})
        expect(seen.interrupted).toBe(true)
        expect(seen.listed).toBe(false)
      }),
    )
  })
})

describe("the rest of what a command line needs", () => {
  const refusalOf = (response: HttpServerResponse) =>
    Effect.map(jsonOf(response), Schema.decodeUnknownSync(RefusalDto))

  it("says what resuming would cost, without spending it", async () => {
    await runFlow([composer("plan"), step(1, "plan", reply.artifact("the work"))], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        // Parked at the proposal: `restartFrom` re-parks a gate unchanged, so picking
        // this up costs nothing — and a caller that could not tell would ask a spend
        // question about a free re-park.
        const preview = Schema.decodeUnknownSync(ResumePreviewDto)(
          yield* jsonOf(yield* get(`/${id}/resume`)),
        )
        expect(preview.retry).toBe("gate")
        expect(preview.interrupted).toBe(false)
        expect(preview.failure).toBeUndefined()
      }),
    )
  })

  it("names the branch a merge would go into, rather than merging", async () => {
    await runFlow([composer("plan"), step(1, "plan", reply.artifact("the work"))], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* create(id, "d")
        yield* act(id, 0, human.approve())
        yield* act(id, 1, human.approve())
        const before = yield* store.events(id)

        const preview = Schema.decodeUnknownSync(MergePreviewDto)(
          yield* jsonOf(yield* get(`/${id}/merge`)),
        )
        // The destination is shown and confirmed — that is the whole of why merging
        // cannot be a control that just does it.
        expect(preview.branch).toContain("trak/")
        expect(preview.into).toBe("main")
        // A preview that moved anything would not be one.
        expect((yield* store.events(id)).length).toBe(before.length)
      }),
    )
  })

  it("refuses to abandon a trak that has already come to rest", async () => {
    await runFlow([composer("plan"), step(1, "plan", reply.artifact("the work"))], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* create(id, "d")
        yield* act(id, 0, human.approve())
        yield* act(id, 1, human.approve())
        yield* drove(id, "close", {})
        const before = yield* store.events(id)

        const response = yield* post(id, "abandon", { reason: "not worth it" })
        expect(response.status).toBe(409)
        expect(yield* refusalOf(response)).toStrictEqual({ _tag: "AtRest" })
        expect((yield* store.events(id)).length).toBe(before.length)
      }),
    )
  })

  it("refuses to re-enter one that has not stopped", async () => {
    await runFlow([composer("plan")], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        const response = yield* post(id, "reenter", { what: "CI went red" })
        expect(response.status).toBe(409)
        expect(yield* refusalOf(response)).toStrictEqual({ _tag: "NotAtRest" })
      }),
    )
  })

  it("writes a record without touching the trak", async () => {
    await runFlow([composer("plan")], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        const response = yield* get(`/${id}/record`)
        expect(response.status).toBe(200)
        const text = yield* textOf(response)
        expect(text).toContain(id)
      }),
    )
  })

  it("forgets a trak, and forgets all of them", async () => {
    await runFlow([composer("plan")], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* create(id, "d")
        expect(yield* store.list()).toStrictEqual([id])

        expect((yield* del(`/${id}`)).status).toBe(204)
        expect(yield* store.list()).toStrictEqual([])
        // Wiping is not an event: it is the trak ceasing to have happened.
        expect((yield* del("")).status).toBe(204)
      }),
    )
  })

  it("will not forget a trak it is driving", async () => {
    // The directory would be removed from under the fiber writing to it.
    await runFlow([composer("plan"), stepHangs(1, "plan")], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* create(id, "d")
        yield* post(id, "act", { action: "approve" })
        yield* logged(id, hasHumanActed)

        const response = yield* del(`/${id}`)
        expect(response.status).toBe(409)
        expect(yield* refusalOf(response)).toStrictEqual({ _tag: "Driving" })
        expect(yield* store.list()).toStrictEqual([id])
      }),
    )
  })
})

describe("the stream", () => {
  it("carries every append as it lands, with the state each one produced", async () => {
    await runFlow([composer("plan"), stepHangs(1, "plan")], (id) =>
      Effect.scoped(
        Effect.gen(function* () {
          // Opened before anything is driven, so nothing has to be replayed: a
          // subscriber that misses the frames it was opened to watch is the bug the
          // subscribe-before-read ordering in the feed exists to prevent.
          const response = yield* openStream()
          const reading = yield* Effect.fork(sseEvents(response, 3, isAppended))
          yield* create(id, "d")
          const frames = yield* Fiber.join(reading).pipe(Effect.timeout("20 seconds"), Effect.orDie)

          // `seq` counts lines in this trak's own log, 1-based, and `state` is what
          // each event produced in turn — the two things a watcher cannot work out
          // for itself without keeping a second copy of the state machine.
          expect(appendedAs(frames)).toStrictEqual([
            [1, "TrakCreated", "Preparing"],
            [2, "WorktreeReady", "Composing"],
            [3, "ComposerReturned", "AwaitingProposal"],
          ])
          expect(new Set(traksOf(frames))).toStrictEqual(new Set([id]))
          // The rest of the projection rides with the state: the plan appears on the
          // frame whose event cut it, so a drawer draws the new step off the frame
          // rather than off a re-read that never comes while frames keep arriving.
          expect(plansOf(frames)).toStrictEqual([undefined, undefined, 2])
        }),
      ),
    )
  })

  it("says when a drive takes a trak and when it lets go", async () => {
    // Custody is on no log, so no append can carry it — and the release is what every
    // press on a trak's screen waits for. The second frame says nobody, and it is
    // published after the record is cleared, so a re-read on it agrees with it.
    await runFlow([composer("plan"), stepHangs(1, "plan")], (id) =>
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* openStream()
          const reading = yield* Effect.fork(sseEvents(response, 2, isDrive))
          // Through `Drives`, which is the only thing that takes custody: `create` is
          // `advance` bare, the way a flow test drives, and takes none.
          const drives = yield* Drives
          yield* drives.start(id, bornManual)
          const frames = yield* Fiber.join(reading).pipe(Effect.timeout("20 seconds"), Effect.orDie)
          // `since: 0` is the memory adapter's fixed `startedAt`.
          expect(custodyOf(frames)).toStrictEqual([{ holder: { since: 0 } }, {}])
          expect((yield* detailOf(yield* get(`/${id}`))).custody).toStrictEqual({})
        }),
      ),
    )
  })

  it("tells a subscriber that asked from before the buffer to start again", async () => {
    // The one thing a bounded ring owes its readers. A stream that silently began in
    // the middle looks identical to one that is complete, and a projection built from
    // it would be wrong with nothing to notice it by.
    await runFlow([], (id) =>
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* Store
          yield* seedLog(store, id, [Events.trakCreated("d")])
          // Far past anything published, which is the same position as far behind it:
          // either way the buffer cannot show what came next.
          const response = yield* openStream("99999")
          const frames = yield* sseEvents(response, 1).pipe(
            Effect.timeout("20 seconds"),
            Effect.orDie,
          )
          expect(tagsOf(frames)).toStrictEqual(["Resync"])
        }),
      ),
    )
  })
})

/**
 * The `CheckFailed` a parked trak carries, narrowed.
 *
 * `flatMap` rather than `find`, which answers the whole union and leaves the two
 * optional fields unreachable — and out here rather than in the case, because a callback
 * inside a `describe` inside an `it` inside an `Effect.gen` is one level past the limit.
 */
const checkFailedIn = (detail: typeof TrakDetailDto.Type) =>
  detail.log.flatMap((e) => (e._tag === "CheckFailed" ? [e] : []))[0]

describe("the check a step ran", () => {
  const VERIFY = new Map([
    [
      "verify",
      {
        name: "verify",
        description: "Runs the project's own verification.",
        timeoutSeconds: 300,
        askedEverySeconds: undefined,
        exclusive: false,
        cache: true,
        ignoresLinguistGenerated: false,
        units: undefined,
        cacheAcross: "platform" as const,
        path: "/repo/.orkestra/checks/verify.sh",
      },
    ],
  ])

  /** A fleet whose `work` agent declares `verify`. Checks are policy, not plan. */
  const declaring = workDeclaring(["verify"], { checks: VERIFY })

  it("reaches the detail, because nothing else a screen could re-read holds it", async () => {
    // The one thing on the detail with no file behind it. A check's output is never
    // written down, so a screen drawing a live console has only this to be caught up
    // from — and it refetches on its own poll, which would blank the console if the
    // route answered nothing.
    await runFlowWithAgentLog(
      [composer("work"), step(1, "work", reply.artifact("Added --json"))],
      (id) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const detail = yield* detailOf(yield* get(`/${id}`))
          expect(detail.check).toMatchObject({
            step: 1,
            name: "verify",
            finished: { verdict: "passed" },
          })
        }),
      declaring,
      {},
    )
  })

  it("names the next step's checks on the detail, off the library rather than the log", async () => {
    // What the run-mode panel's foot says will not run. `work` declares `verify` and
    // `plan` declares nothing, so the two steps tell the field's source apart: the log
    // holds no check name until one has run, and this is asked before any has.
    await runFlowWithAgentLog(
      [composer("work"), stepHangs(1, "work")],
      (id) =>
        Effect.gen(function* () {
          yield* create(id, "Add a --json flag")
          expect((yield* post(id, "act", { action: "approve" })).status).toBe(202)
          yield* logged(id, hasHumanActed)
          const detail = yield* detailOf(yield* get(`/${id}`))
          expect([detail.state._tag, detail.nextChecks]).toStrictEqual(["AgentWorking", ["verify"]])
        }),
      declaring,
      {},
    )
    await runFlowWithAgentLog(
      [composer("plan"), stepHangs(1, "plan")],
      (id) =>
        Effect.gen(function* () {
          yield* create(id, "Add a --json flag")
          expect((yield* post(id, "act", { action: "approve" })).status).toBe(202)
          yield* logged(id, hasHumanActed)
          expect((yield* detailOf(yield* get(`/${id}`))).nextChecks).toStrictEqual([])
        }),
      declaring,
      {},
    )
  })

  it("says what a failing one exited with, and the line that was spawned", async () => {
    // The run in memory does not survive a restart and a parked failure can outlive
    // one, so the log carries the same two facts — this asserts the pair crosses.
    await runFlowWithAgentLog(
      [composer("work"), step(1, "work", reply.artifact("v1")), onResume(reply.artifact("v2"))],
      (id) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const failed = checkFailedIn(yield* detailOf(yield* get(`/${id}`)))
          expect(failed).toMatchObject({ name: "verify", exitCode: 1 })
          expect(failed?.command).toContain("check.sh")
        }),
      declaring,
      { verify: [fail("two problems")] },
    )
  })
})

describe("closing a finished trak", () => {
  it("takes the checkout away and answers with the log that says so", async () => {
    await runFlow([composer("plan"), step(1, "plan", reply.artifact("the work"))], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        yield* act(id, 0, human.approve())
        expect((yield* act(id, 1, human.approve())).state._tag).toBe("Finished")

        // The two events the close produced, at the end of the trak's own log —
        // asserted as the tail rather than the whole sequence, because what this
        // route owns is the ending.
        expect((yield* drove(id, "close", {})).slice(-2)).toStrictEqual([
          "Closed",
          "WorktreeRemoved",
        ])
        expect((yield* detailOf(yield* get(`/${id}`))).state).toStrictEqual({ _tag: "Closed" })
      }),
    )
  })

  it("finds a put-away trak by its title or id, without a row on the list", async () => {
    await runFlow([composer("plan"), step(1, "plan", reply.artifact("the work"))], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        yield* act(id, 0, human.approve())
        yield* act(id, 1, human.approve())
        // Live, it is a row and no search of the archive finds it.
        expect((yield* archived(id)).traks).toStrictEqual([])

        yield* drove(id, "close", {})
        // The title a row would draw — the scripted composer's plan names it.
        const entry = { id, title: "Add a --json flag" }
        expect((yield* archived(id.toUpperCase())).traks).toStrictEqual([entry])
        expect((yield* archived("json FLAG")).traks).toStrictEqual([entry])
        expect((yield* archived("frobnicate")).traks).toStrictEqual([])
        expect((yield* archived("")).traks).toStrictEqual([])
        expect((yield* get("/archived")).status).toBe(400)
      }),
    )
  })

  it("refuses a trak that has not finished with 409, and leaves its log alone", async () => {
    await runFlow([composer("plan"), step(1, "plan", reply.artifact("the work"))], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* create(id, "d")
        const before = yield* store.events(id)

        // Parked at the proposal gate: still going, still holding nothing anybody
        // chose to keep. `decide` would file this as `Failed{engine}`, so the
        // refusal has to be the route's and it has to append nothing.
        const response = yield* post(id, "close", {})
        expect(response.status).toBe(409)
        expect((yield* store.events(id)).length).toBe(before.length)
      }),
    )
  })
})

describe("the list — the archive", () => {
  it("sends no row for a trak that is put away, and counts it instead", async () => {
    await runFlow([composer("plan"), step(1, "plan", reply.artifact("the work"))], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        yield* act(id, 0, human.approve())
        yield* act(id, 1, human.approve())
        expect(yield* listOf(yield* get(""))).toMatchObject({ archived: 0 })
        expect(idsOf(yield* summariesOf(yield* get("")))).toStrictEqual([id])

        // Closed, the trak is a number on the list and nothing else — no row is built
        // for it, and the count is of it. Its page still answers: the detail is a
        // read of one log, and nothing about the set reaches it.
        yield* drove(id, "close", {})
        const listed = yield* listOf(yield* get(""))
        expect(listed.traks).toStrictEqual([])
        expect(listed.archived).toBe(1)
        expect((yield* detailOf(yield* get(`/${id}`))).state).toStrictEqual({ _tag: "Closed" })
      }),
    )
  })

  it("counts only the parentless archived traks, as a header counts groups", async () => {
    await runFlow(FAN_OUT, (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "Rate-limit the public API")
        yield* drove(id, "act", { action: "approve" })
        const [security, performance] = yield* childrenOf(id)
        if (security === undefined || performance === undefined) {
          return yield* Effect.die("a spawn of two spawned otherwise")
        }
        yield* daemonDrove(security, hasChecksPassed)
        yield* daemonDrove(performance, hasChecksPassed)

        // A piece put away leaves the list — it was a band column, never a row — and
        // counts under nothing: an archived child is not a group.
        yield* drove(security, "abandon", { reason: "not needed after all" })
        yield* idle(id)
        const listed = yield* listOf(yield* get(""))
        expect(idsOf(listed.traks)).not.toContain(security)
        expect(idsOf(listed.traks)).toContain(performance)
        expect(listed.archived).toBe(0)
      }),
    )
  })
})

describe("the detail — its files", () => {
  it("is answered off memory while neither file has moved, and off the file once one has", async () => {
    // A page polls this route, and every poll was both files read and decoded whole.
    // Counted at the store's two read methods, so the seed read the publishing
    // decorator makes is in the count too — what is asserted is the difference.
    const reads = noReads()
    await runFlow(
      [],
      (id) =>
        Effect.gen(function* () {
          const store = yield* Store
          yield* seedLog(store, id, midTurnLog)
          yield* store.appendTranscript(id, edited)

          const first = yield* detailOf(yield* get(`/${id}`))
          const logRead = timesRead(reads.events, id)
          const transcriptRead = timesRead(reads.transcript, id)

          // The same again, and nothing was opened for it.
          const second = yield* detailOf(yield* get(`/${id}`))
          expect(second).toStrictEqual(first)
          expect([timesRead(reads.events, id), timesRead(reads.transcript, id)]).toStrictEqual([
            logRead,
            transcriptRead,
          ])

          // The transcript moved, as it does on every tool call: it is read again and
          // the log is not, and the page sees the new line.
          yield* store.appendTranscript(id, edited)
          const third = yield* detailOf(yield* get(`/${id}`))
          expect(third.transcript).toHaveLength(2)
          expect([timesRead(reads.events, id), timesRead(reads.transcript, id)]).toStrictEqual([
            logRead,
            transcriptRead + 1,
          ])

          // The log moved: read again, and the page sees the event. Appended from the
          // seeded count rather than through `seedLog`, whose read would count here.
          yield* store.append(id, [Events.checksPassed(0, [])], { after: midTurnLog.length })
          const fourth = yield* detailOf(yield* get(`/${id}`))
          expect(fourth.log.at(-1)).toMatchObject({ _tag: "ChecksPassed" })
          expect(timesRead(reads.events, id)).toBe(logRead + 1)
        }),
      undefined,
      countingStore(reads),
    )
  })

  it("stops answering once the trak is wiped, rather than off what it remembered", async () => {
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, midTurnLog)
        expect((yield* get(`/${id}`)).status).toBe(200)
        yield* store.remove(id)
        expect((yield* get(`/${id}`)).status).toBe(404)
      }),
    )
  })
})

describe("what a turn in flight has reported", () => {
  it("reaches the list row and the detail before the turn ends", async () => {
    // A real Claude turn reports its window at every model call and its spend once, on
    // the `result` line that ends it. The reading lands on the run record at once —
    // `withTranscript` writes it — and on no transcript line. Neither route reads the
    // record: both fold the endings on the log, so no surface learns what the running
    // agent holds until its turn stops. Read field-blind, because which field carries
    // it is the fix's to choose; 83327 is a figure nothing else in the fixture has.
    await runFlow([composer("plan"), { ...stepHangs(1, "plan"), reads: midTurnReading }], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        expect((yield* post(id, "act", { action: "approve" })).status).toBe(202)
        const held = yield* readOn(id)
        expect(held.cacheReadTokens).toBe(83_327)

        const listed = yield* jsonOf(yield* get(""))
        const detail = yield* jsonOf(yield* get(`/${id}`))
        expect(JSON.stringify(listed)).toContain("83327")
        expect(JSON.stringify(detail)).toContain("83327")
      }),
    )
  })

  it("reaches an open stream as a frame, so a drawer grows without a re-read", async () => {
    // The reading is on no log and no transcript line, so no `Appended` or `Activity`
    // can carry it; the frame is the record's turn, published once the window has
    // passed, and it names the step so a meter lays it on the right position.
    await runFlow([composer("plan"), { ...stepHangs(1, "plan"), reads: midTurnReading }], (id) =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* create(id, "d")
          const response = yield* openStream()
          const reading = yield* Effect.fork(sseEvents(response, 1, isInFlight))
          expect((yield* post(id, "act", { action: "approve" })).status).toBe(202)
          const frames = yield* Fiber.join(reading).pipe(Effect.timeout("20 seconds"), Effect.orDie)
          expect(frames).toMatchObject([
            {
              _tag: "InFlight",
              trak: id,
              turn: { step: 1, usage: { context: { cacheReadTokens: 83_327 } } },
            },
          ])
        }),
      ),
    )
  })
})

describe("the list", () => {
  it("carries the composer's instruction for the entry the trak is at", async () => {
    // The middle line of a row. It is a projection off the `Trak` this route was
    // already replaying — no extra read — and its absence is as meaningful as its
    // presence: a trak before its plan, or past the end of one, has no entry to
    // read a sentence off and draws two lines instead of three.
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, midTurnLog)

        const listed = yield* summariesOf(yield* get(""))
        expect(instructionsOf(listed)).toStrictEqual(["Produce the plan."])
      }),
    )
  })

  it("names no agent at a turn nothing is carrying", async () => {
    // What a row's mark is drawn from. `midTurnLog` leaves the trak `AgentWorking` at an
    // entry `plan` runs, but nothing drives it here — the log a dead engine leaves. The
    // list files that row as stopped, and a name would put a face on it. The name sent
    // while a drive holds the turn is `dto.test.ts`'s.
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, midTurnLog)
        expect(agentsOf(yield* summariesOf(yield* get("")))).toStrictEqual([undefined])
      }),
    )
  })

  it("names no agent at a gate, where the trak stands at a position nobody is running", async () => {
    // The same log one event shorter: parked at the proposal, which is `AwaitingHuman` at
    // entry zero. It stands at `plan`'s position and `plan` is not running, which is the
    // distinction the field carries and the whole reason it is not simply the entry's agent.
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, midTurnLog.slice(0, 3))
        expect(agentsOf(yield* summariesOf(yield* get("")))).toStrictEqual([undefined])
      }),
    )
  })

  it("carries the time a person last touched the trak, off the store's own stamps", async () => {
    // The field the list orders on. Here rather than only in `dto.test.ts`
    // because the tier-1 test hand-stamps its events: this is what proves the
    // `at` a real `Store.append` writes is the one that reaches the wire, and
    // that it survives `TrakSummaryDto`. Which events count is the unit test's.
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        const before = Date.now()
        yield* seedLog(store, id, midTurnLog)

        const listed = yield* summariesOf(yield* get(""))
        const touched = listed[0]?.touched
        expect(touched).toBeGreaterThanOrEqual(before)
        expect(touched).toBeLessThanOrEqual(Date.now())
      }),
    )
  })

  it("names each trak by its plan's title, and leaves the field off before there is one", async () => {
    // The top line of a row. `description` rides along beside it — the two answer
    // different questions, and the detail page wants the request word for word.
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, midTurnLog.slice(0, 2))

        expect(titlesOf(yield* summariesOf(yield* get("")))).toStrictEqual([undefined])

        yield* seedLog(store, id, midTurnLog.slice(2))
        const planned = yield* summariesOf(yield* get(""))
        expect(planned).toMatchObject([{ title: "Add a --json flag", description: "d" }])
      }),
    )
  })

  it("holds back the last transcript entry when nothing is holding the trak", async () => {
    // Unheld, the last entry is not what is happening but the last thing that
    // happened before the run stopped — a row drawing it says a trak is busy when
    // it is not. It is also what keeps the read cheap: the file is never opened.
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, midTurnLog)
        yield* store.appendTranscript(id, edited)

        const listed = yield* summariesOf(yield* get(""))
        expect(activitiesOf(listed)).toStrictEqual([undefined])
      }),
    )
  })

  it("sends the newest stretch of the turn while something is, since the agent last spoke", async () => {
    // The right-hand slot's activity: enough of the turn for the row to name its last run
    // the way the live log does — `Read 1 file, and edited 1 file` is two entries. The
    // whole transcript is the detail route's answer, and the words before the stretch are
    // where it starts.
    await runFlow([stepHangs(1, "plan")], (id) =>
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* Store
          const drives = yield* Drives
          yield* seedLog(store, id, midTurnLog)
          yield* store.appendTranscript(id, ToolEntry.make({ name: "Read", kind: "Read" }))
          yield* store.appendTranscript(id, { _tag: "Text", text: "Now the mapper." })
          yield* store.appendTranscript(id, ToolEntry.make({ name: "Read", kind: "Read" }))
          yield* store.appendTranscript(id, edited)

          // Running means a drive of this daemon's is in flight — the row's slot
          // reports what a turn is doing, and a turn nobody is running is not doing
          // anything. `restarted` re-issues the position the seeded log stopped at,
          // and the step hangs, so the drive is still in flight for the assertion.
          yield* drives.start(id, restart)
          const listed = yield* summariesOf(yield* get(""))
          expect(activitiesOf(listed)).toStrictEqual([
            [
              { _tag: "Text", text: "Now the mapper." },
              { _tag: "Tool", name: "Read", kind: "Read" },
              { _tag: "Tool", name: "Edit", kind: "Edit", detail: "src/app/dto.ts" },
            ],
          ])
        }),
      ),
    )
  })
})

describe("a trak named before names were three words", () => {
  it("lists and opens under a UUID, exactly as it did when every id was one", async () => {
    // The whole migration story, asserted rather than assumed: `TrakId` is a brand
    // over a bare string with no refinement, and every read-back site mints one
    // from raw input — a directory name here, a URL path param below. So the traks,
    // worktrees and branches already named with a UUID keep resolving forever, and
    // adding validation of an id's shape is what would break them.
    await runFlow([], () =>
      Effect.gen(function* () {
        const store = yield* Store
        const old = TrakId.make("1dd2b03b-a627-457d-a44c-43b1240d0528")
        yield* seedLog(store, old, midTurnLog)

        // Off the directory listing, unchanged.
        expect(yield* store.list()).toStrictEqual([old])
        const listed = yield* summariesOf(yield* get(""))
        expect(listed).toHaveLength(1)
        expect(listed[0]?.id).toBe(old)
        // And off the URL, which is the half a store round-trip does not cover.
        expect((yield* detailOf(yield* get(`/${old}`))).id).toBe(old)
      }),
    )
  })
})

describe("a trak whose stored log this build cannot read", () => {
  // On disk rather than in memory, because the subject is a file written by a
  // build that no longer exists — which is not a thing the memory store can be
  // put into. `escalate` is verbatim what shipped: an `AgentReturned` output
  // variant deleted when `stuck` replaced it, still sitting in a real database.
  const ESCALATE = JSON.stringify({
    _tag: "AgentReturned",
    step: 0,
    sessionId: sid,
    output: { type: "escalate", reason: "over my head" },
  })

  it("is left out of the list, and the traks beside it are still listed", async () => {
    // The shipped bug: one bad log failed the *request*, so the UI drew
    // "Could not reach the engine" and retried forever — with every other
    // trak invisible behind it.
    const dir = newRepo()
    await runFlow(
      [],
      (id) =>
        Effect.gen(function* () {
          const store = yield* Store
          yield* seedLog(store, id, midTurnLog)
          yield* seedLog(store, broken, [Events.trakCreated("written by an older build")])
          appendFileSync(logIn(dir, broken), `${ESCALATE}\n`)

          const response = yield* get("")
          expect(response.status).toBe(200)
          const listed = yield* summariesOf(response)
          expect(idsOf(listed)).toStrictEqual([id])
        }),
      undefined,
      FileStoreLayer(dir),
    )
  })

  it("says why on a direct fetch, rather than claiming there is no such trak", async () => {
    // 404 would be false — the person holding this URL is the one who most
    // needs the reason, and the trak does exist.
    const dir = newRepo()
    await runFlow(
      [],
      () =>
        Effect.gen(function* () {
          const store = yield* Store
          yield* seedLog(store, broken, [Events.trakCreated("written by an older build")])
          appendFileSync(logIn(dir, broken), `${ESCALATE}\n`)

          const response = yield* get(`/${broken}`)
          expect(response.status).toBe(422)
          expect(response.statusText).toContain(broken)
        }),
      undefined,
      FileStoreLayer(dir),
    )
  })

  it("does not shorten the list when it is the store itself that will not answer", async () => {
    // The other half of the split. Dropping this row would report "there is one
    // trak" when the honest answer is "I could not tell" — so the request fails,
    // and `orDie` in `call` makes that a defect.
    //
    // Read the defect off the cause rather than awaiting a rejection: `orDie`
    // renders as "An error has occurred", so `.rejects.toThrow` could only
    // assert *that* it failed. Which tag got here is the whole assertion — a
    // `StoreUndecodable` reaching this point would mean the catch had taken
    // both, which is exactly the silently shortened list the split prevents.
    const dir = newRepo()
    await runFlow(
      [],
      (id) =>
        Effect.gen(function* () {
          const store = yield* Store
          yield* seedLog(store, id, midTurnLog)
          yield* seedLog(store, broken, [Events.trakCreated("on an unreadable disk")])
          const path = logIn(dir, broken)
          rmSync(path)
          mkdirSync(path)

          const exit = yield* Effect.exit(get(""))
          expect(Exit.isFailure(exit)).toBe(true)
          const defect = Exit.isFailure(exit) ? Cause.dieOption(exit.cause) : Option.none()
          expect(Option.isSome(defect)).toBe(true)
          if (Option.isSome(defect)) expect(defect.value).toBeInstanceOf(StoreFailed)
        }),
      undefined,
      FileStoreLayer(dir),
    )
  })
})

/**
 * A one-pixel PNG. The bytes are the point: the route decides a content type from the
 * extension, so a file that is not really an image would still be served — which is what
 * `nosniff` is for, and is why the allowlist is by extension rather than by contents.
 */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)

/** A checkout with a shot in it, a file that is not one, and a link out of the tree. */
const checkoutWithAShot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "orkestra-shot-"))
  mkdirSync(join(dir, ".shots"), { recursive: true })
  writeFileSync(join(dir, ".shots", "pane.png"), PNG)
  writeFileSync(join(dir, "notes.md"), "not a picture")
  const elsewhere = mkdtempSync(join(tmpdir(), "orkestra-elsewhere-"))
  writeFileSync(join(elsewhere, "secret.png"), PNG)
  symlinkSync(join(elsewhere, "secret.png"), join(dir, "linked.png"))
  return dir
}

const withCheckout = (dir: string): readonly Event[] => [
  Events.trakCreated("a step that took a picture"),
  Events.worktreeReady({
    path: WorktreePath.make(dir),
    branch: BranchName.make("trak/shot"),
    base: CommitSha.make("base000"),
  }),
]

describe("a picture out of a trak's own checkout", () => {
  it("serves an image that is in it", async () => {
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, withCheckout(checkoutWithAShot()))

        const response = yield* get(`/${id}/image?path=.shots%2Fpane.png`)
        expect(response.status).toBe(200)
        expect(response.headers["content-type"]).toBe("image/png")
        // Named rather than inferred: without it a browser is free to read a `.png` full
        // of markup as a document, in the origin the surface is served from.
        expect(response.headers["x-content-type-options"]).toBe("nosniff")
      }),
    )
  })

  it("refuses a path that climbs out, a link that points out, and a file that is not an image", async () => {
    // The three ways a path a model wrote lands somewhere it may not. The link is the one
    // that decides *where* the confinement happens: it is inside the checkout by name and
    // outside it once resolved, so a check made before `realpath` would serve it.
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, withCheckout(checkoutWithAShot()))

        const climbed = yield* get(`/${id}/image?path=..%2F..%2Fetc%2Fpasswd.png`)
        const linked = yield* get(`/${id}/image?path=linked.png`)
        const prose = yield* get(`/${id}/image?path=notes.md`)
        expect([climbed.status, linked.status, prose.status]).toStrictEqual([404, 404, 404])
      }),
    )
  })

  it("is a 404 for a path no file could have, rather than the engine's own failure", async () => {
    // One test for the whole set, because the set is the point: a name longer than a name
    // may be and a symlink cycle say *there is no such picture* exactly as `ENOENT` does,
    // and a 500 would report an engine failure for a filename a model made up. What stays
    // in the error channel is a file that exists and could not be read.
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const dir = checkoutWithAShot()
        symlinkSync(join(dir, "cycle.png"), join(dir, "cycle.png"))
        const store = yield* Store
        yield* seedLog(store, id, withCheckout(dir))

        const overlong = yield* get(`/${id}/image?path=${"a".repeat(300)}.png`)
        const cycle = yield* get(`/${id}/image?path=cycle.png`)
        expect([overlong.status, cycle.status]).toStrictEqual([404, 404])
      }),
    )
  })

  it("is a 404 for a trak with no checkout, and for one that does not exist", async () => {
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, [Events.trakCreated("nothing has been cut yet")])

        const cutless = yield* get(`/${id}/image?path=shot.png`)
        const unknown = yield* get("/no-such-trak/image?path=shot.png")
        expect([cutless.status, unknown.status]).toStrictEqual([404, 404])
      }),
    )
  })
})

/**
 * An `Openers` that opens nothing and writes what it was asked into `opened` — the
 * theme's own shape, provided over the scenario's default so a body can watch which
 * kind and which directory the route resolved. `outcome` is what the press finds there.
 */
const openingInto = (
  opened: Ref.Ref<readonly string[]>,
  outcome: OpenOutcome = "opened",
): OpenersShape => ({
  list: Effect.succeed(undefined),
  choose: () => Effect.succeed("unknown"),
  openAt: (kind, directory) =>
    Effect.as(
      Ref.update(opened, (dirs) => [...dirs, `${kind} ${directory}`]),
      outcome,
    ),
  runInTerminal: () => Effect.die("no checkout here is sandboxed"),
})

/** One kind's ids, hoisted for the reason every `.map` here is. */
const openerIds = (listing: OpenersDto, kind: "terminal" | "editor"): readonly string[] =>
  listing[kind].apps.map((app) => app.id)

/** A machine with nothing to detect — what every platform but macOS answers. */
const noOpeners: OpenersShape = {
  list: Effect.succeed(undefined),
  choose: () => Effect.succeed("unsupported"),
  openAt: () => Effect.succeed("unsupported"),
  runInTerminal: () => Effect.succeed("unsupported"),
}

describe("the terminal and the editor at a trak's checkout", () => {
  const pick = (kind: "terminal" | "editor", id: string) =>
    openers({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, id }),
    })

  it("lists the machine's terminals and editors with the one of each a press would open", async () => {
    await runFlow([], () =>
      Effect.gen(function* () {
        const response = yield* openers()
        expect(response.status).toBe(200)
        const listing = Schema.decodeUnknownSync(OpenersDto)(yield* jsonOf(response))
        expect(openerIds(listing, "terminal")).toStrictEqual([
          "com.mitchellh.ghostty",
          "com.apple.Terminal",
        ])
        expect(openerIds(listing, "editor")).toStrictEqual(["dev.zed.Zed"])
        expect(listing.terminal.chosen).toBe("com.mitchellh.ghostty")
        expect(listing.editor.chosen).toBe("dev.zed.Zed")
      }),
    )
  })

  it("stores an explicit pick for one kind, and refuses an identifier the scan did not return under it", async () => {
    await runFlow([], () =>
      Effect.gen(function* () {
        const stored = yield* pick("terminal", "com.apple.Terminal")
        expect(stored.status).toBe(204)
        const after = Schema.decodeUnknownSync(OpenersDto)(yield* jsonOf(yield* openers()))
        expect(after.terminal.chosen).toBe("com.apple.Terminal")
        // The other kind's pick is untouched by it.
        expect(after.editor.chosen).toBe("dev.zed.Zed")

        // Not installed, so not offered — a hand-written request, refused like the
        // create route refuses an agent nothing listed. An id installed under the
        // *other* kind is the same refusal: a terminal is not an editor.
        const unknown = yield* pick("terminal", "com.googlecode.iterm2")
        const crossed = yield* pick("editor", "com.apple.Terminal")
        expect([unknown.status, crossed.status]).toStrictEqual([400, 400])
      }),
    )
  })

  it("refuses both presses with a 404 on a platform that detects nothing", async () => {
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, withCheckout("/tmp/wt"))

        const chose = yield* pick("terminal", "com.apple.Terminal").pipe(
          Effect.provideService(Openers, noOpeners),
        )
        const open = yield* post(id, "open", { kind: "editor" }).pipe(
          Effect.provideService(Openers, noOpeners),
        )
        expect([chose.status, open.status]).toStrictEqual([404, 404])
      }),
    )
  })

  it("opens the kind asked for at the trak's own checkout", async () => {
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, withCheckout("/tmp/wt-opener"))

        const opened = yield* Ref.make<readonly string[]>([])
        const terminal = yield* post(id, "open", { kind: "terminal" }).pipe(
          Effect.provideService(Openers, openingInto(opened)),
        )
        const editor = yield* post(id, "open", { kind: "editor" }).pipe(
          Effect.provideService(Openers, openingInto(opened)),
        )
        expect([terminal.status, editor.status]).toStrictEqual([204, 204])
        expect(yield* Ref.get(opened)).toStrictEqual([
          "terminal /tmp/wt-opener",
          "editor /tmp/wt-opener",
        ])
      }),
    )
  })

  it("is a 404 for a trak with no checkout, an unknown one, and a checkout that is gone", async () => {
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, [Events.trakCreated("nothing has been cut yet")])

        const cutless = yield* post(id, "open", { kind: "terminal" })
        const unknown = yield* post("no-such-trak", "open", { kind: "terminal" })
        expect([cutless.status, unknown.status]).toStrictEqual([404, 404])
      }),
    )
    // The archive deletes the checkout and `Trak.worktree` keeps naming it, so the
    // press can outlive the directory — the service answers `no-directory` and the
    // route turns it into the same nothing-to-open the surface already handles.
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, withCheckout("/tmp/wt-archived"))

        const opened = yield* Ref.make<readonly string[]>([])
        const response = yield* post(id, "open", { kind: "editor" }).pipe(
          Effect.provideService(Openers, openingInto(opened, "no-directory")),
        )
        expect(response.status).toBe(404)
      }),
    )
  })
})

describe("the openers listing off macOS", () => {
  // Every route's chrome asks for the listing, and a browser logs any 4xx a fetch gets as
  // "Failed to load resource" whether the page handles it or not. So a 404 here is a
  // console error on every page load off macOS — what failed the browser tier's
  // "nothing in the console" case on the Linux runner (CI run 39825683501). The presses
  // only fire on a control that is hidden, so only the listing has to stay quiet.
  it("answers the listing without an error status on a platform that detects nothing", async () => {
    await runFlow([], () =>
      Effect.gen(function* () {
        const list = yield* openers().pipe(Effect.provideService(Openers, noOpeners))
        expect(list.status).toBeLessThan(400)
        // An empty 204 is what the surface reads as "unsupported" and hides both controls on.
        expect(list.status).toBe(204)
      }),
    )
  })
})

describe("the terminal and the editor at the project checkout", () => {
  it("opens the kind asked for at the project checkout, and is a 404 where nothing can open", async () => {
    // The root `/api/health` reports, resolved the same way — never a trak's checkout.
    const root = projectDir(process.argv.slice(2)).root
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, withCheckout("/tmp/wt-not-this-one"))

        const opened = yield* Ref.make<readonly string[]>([])
        const terminal = yield* openProject("terminal").pipe(
          Effect.provideService(Openers, openingInto(opened)),
        )
        const editor = yield* openProject("editor").pipe(
          Effect.provideService(Openers, openingInto(opened)),
        )
        expect([terminal.status, editor.status]).toStrictEqual([204, 204])
        expect(yield* Ref.get(opened)).toStrictEqual([`terminal ${root}`, `editor ${root}`])

        const unsupported = yield* openProject("terminal").pipe(
          Effect.provideService(Openers, noOpeners),
        )
        expect(unsupported.status).toBe(404)
      }),
    )
  })
})

/** A step that took no turn here, for `sandboxing`'s methods no route reaches. */
const unreached = Effect.die("a handoff reaches no sandbox method but placeOf and shell")

/**
 * Every trak's checkout in a sandbox, with a runner whose shell line names the carried
 * variables as the real one does — `ORKESTRA_RUNNER_PASS`, and the runner's key beside
 * them as inherited — so a test can see what the route asked it to carry.
 */
const sandboxing: SandboxesShape = {
  inUse: Effect.succeed(true),
  holds: () => Effect.succeed(true),
  placeOf: (path) => Effect.succeed({ trak: "sandboxed", path }),
  project: Effect.succeed(undefined),
  shell: (at, carried) =>
    Effect.succeed({
      command: ["/project/.orkestra/runner.sh", "shell", at.trak, at.path],
      env: { ORKESTRA_RUNNER_PROJECT: "/project", ORKESTRA_RUNNER_PASS: carried.join(" ") },
      inherited: ["RUNNER_KEY", ...carried],
    }),
  create: () => unreached,
  status: () => unreached,
  idOf: () => Effect.succeed(undefined),
  list: unreached,
  expose: () => unreached,
  reach: () => unreached,
  healthThrough: () => unreached,
  release: () => unreached,
  kill: () => unreached,
  transfer: () => unreached,
  retried: () => unreached,
  place: () => unreached,
  write: () => unreached,
  collect: () => unreached,
  moveOut: () => unreached,
  readInside: () => unreached,
  stats: () => unreached,
  copyHomeBack: () => unreached,
  copyHomeIn: () => unreached,
  awake: () => unreached,
  lost: () => unreached,
  resuming: () => Effect.succeed(false),
  remakeWith: () => unreached,
  stopIdleUnder: () => unreached,
  waitingBy: () => unreached,
  rebuild: () => unreached,
  rebuildOf: () => Effect.succeed(undefined),
  leftBehindTo: () => Effect.void,
  asWork: (work) => work,
}

interface Ran {
  readonly command: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly cwd: string
}

/** An `Openers` that writes each command it was asked to run in a terminal into `ran`, and opens nothing. */
const runningInto = (ran: Ref.Ref<readonly Ran[]>): OpenersShape => ({
  list: Effect.succeed(undefined),
  choose: () => Effect.succeed("unknown"),
  openAt: () => Effect.die("a sandboxed checkout has no local path to open"),
  runInTerminal: (command, env, cwd) =>
    Effect.as(
      Ref.update(ran, (r) => [...r, { command, env, cwd }]),
      "opened" satisfies RunOutcome,
    ),
})

describe("handing a sandboxed trak's session to a person", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("runs the runner's shell in the terminal with the CLI's token, and refuses the editor", async () => {
    const root = projectDir(process.argv.slice(2)).root
    vi.stubEnv("SCRIPTED_TOKEN", "token-value")
    vi.stubEnv("RUNNER_KEY", "runner-key")
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, withCheckout("/tmp/wt-sandboxed"))
        const before = (yield* store.events(id)).length

        const ran = yield* Ref.make<readonly Ran[]>([])
        const press = (kind: "terminal" | "editor") =>
          post(id, "open", { kind }).pipe(
            Effect.provideService(Openers, runningInto(ran)),
            Effect.provideService(Sandboxes, sandboxing),
          )
        expect((yield* press("terminal")).status).toBe(204)
        const editor = yield* press("editor")
        expect([editor.status, editor.statusText]).toStrictEqual([409, NO_LOCAL_PATH])

        expect(yield* Ref.get(ran)).toMatchObject([
          {
            command: ["/project/.orkestra/runner.sh", "shell", "sandboxed", "/tmp/wt-sandboxed"],
            env: {
              RUNNER_KEY: "runner-key",
              SCRIPTED_TOKEN: "token-value",
              ORKESTRA_RUNNER_PROJECT: "/project",
              ORKESTRA_RUNNER_PASS: "SCRIPTED_TOKEN",
            },
            cwd: root,
          },
        ])
        // A press is no drive: nothing is appended.
        expect((yield* store.events(id)).length).toBe(before)
      }),
    )
  })

  it("puts the latest session's resume line on the detail, and the host's line under a host", async () => {
    await runFlow([composer("plan"), step(1, "plan", reply.artifact("the work"))], (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "d")
        const session = slotAt(replayHistory(id, yield* (yield* Store).events(id)), 1).session
        const sandboxed = Effect.provideService(Sandboxes, sandboxing)

        // The host's id reaches the route from the seams, never from the environment.
        vi.stubEnv("ORKESTRA_HOST_PROJECT", "from-the-environment")
        const served = yield* detailOf(yield* sandboxed(get(`/${id}`)))
        expect(served.handoff).toStrictEqual({ resume: `scripted --resume ${String(session)}` })

        const asHost = Effect.provideService(HostProject, "orkestra")
        const hosted = yield* detailOf(yield* asHost(sandboxed(get(`/${id}`))))
        expect(hosted.handoff).toStrictEqual({
          resume: `scripted --resume ${String(session)}`,
          host: `pnpm host shell orkestra ${id}`,
        })
      }),
    )
  })

  it("sends no handoff and no shell line where no checkout is in a sandbox", async () => {
    await runFlow([], (id) =>
      Effect.gen(function* () {
        yield* seedLog(yield* Store, id, withCheckout("/tmp/wt-here"))
        const body = yield* jsonOf(yield* get(`/${id}`))
        expect(body).not.toHaveProperty("handoff")
        expect((yield* get(`/${id}/shell`)).status).toBe(404)
      }),
    )
  })

  it("answers the host the shell line with no value in it, and 404 for a trak with no checkout", async () => {
    vi.stubEnv("SCRIPTED_TOKEN", "token-value")
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, withCheckout("/tmp/wt-sandboxed"))
        const sandboxed = Effect.provideService(Sandboxes, sandboxing)

        const response = yield* sandboxed(get(`/${id}/shell`))
        expect(response.status).toBe(200)
        const text = JSON.stringify(yield* jsonOf(response))
        expect(Schema.decodeUnknownSync(SandboxShellDto)(JSON.parse(text))).toStrictEqual({
          command: ["/project/.orkestra/runner.sh", "shell", "sandboxed", "/tmp/wt-sandboxed"],
          env: { ORKESTRA_RUNNER_PROJECT: "/project", ORKESTRA_RUNNER_PASS: "SCRIPTED_TOKEN" },
          inherited: ["RUNNER_KEY", "SCRIPTED_TOKEN"],
        })
        expect(text).not.toContain("token-value")

        const unknown = yield* sandboxed(get("/no-such-trak/shell"))
        expect(unknown.status).toBe(404)
      }),
    )
  })
})

/**
 * A person's Rebuild of a sandboxed trak's sandbox. No custody and no event: the press is
 * handed to `Sandboxes.rebuild`, which queues it or starts it, and the detail reads back
 * where it stands. The queue itself is the `Sandboxes` provider's to test.
 */
describe("rebuilding a sandboxed trak's sandbox", () => {
  const CARRIED = "refs/orkestra/carried/sandboxed"

  /** `sandboxing`, with a Rebuild that waits once pressed, and the traks it was pressed for. */
  const rebuilding = (pressed: Ref.Ref<readonly string[]>): SandboxesShape => ({
    ...sandboxing,
    rebuild: (trak) =>
      Effect.as(
        Ref.update(pressed, (p) => [...p, trak]),
        "waiting" as const,
      ),
    rebuildOf: () =>
      Effect.map(Ref.get(pressed), (p) => (p.length === 0 ? undefined : ("waiting" as const))),
  })

  it("takes the press, answers that it waits, and the detail says so, appending nothing", async () => {
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, withCheckout("/tmp/wt-sandboxed"))
        const before = (yield* store.events(id)).length
        const pressed = yield* Ref.make<readonly string[]>([])
        const sandboxed = Effect.provideService(Sandboxes, rebuilding(pressed))

        expect(yield* jsonOf(yield* sandboxed(get(`/${id}`)))).not.toHaveProperty("rebuild")
        const response = yield* sandboxed(post(id, "sandbox/rebuild", {}))
        expect(response.status).toBe(200)
        expect(yield* jsonOf(response)).toStrictEqual({ rebuild: "waiting" })
        expect(yield* Ref.get(pressed)).toStrictEqual(["sandboxed"])
        expect((yield* detailOf(yield* sandboxed(get(`/${id}`)))).rebuild).toBe("waiting")
        expect((yield* store.events(id)).length).toBe(before)
      }),
    )
  })

  it("refuses with 409 while an earlier remake's changes are still kept, pressing nothing", async () => {
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, withCheckout("/tmp/wt-sandboxed"))
        const before = (yield* store.events(id)).length
        const pressed = yield* Ref.make<readonly string[]>([])
        const kept = { ...(yield* Vcs), leftBehind: () => Effect.succeed(CARRIED) }
        const response = yield* post(id, "sandbox/rebuild", {}).pipe(
          Effect.provideService(Sandboxes, rebuilding(pressed)),
          Effect.provideService(Vcs, kept),
        )
        expect(response.status).toBe(409)
        expect(response.statusText).toContain(CARRIED)
        expect(yield* Ref.get(pressed)).toStrictEqual([])
        expect((yield* store.events(id)).length).toBe(before)
      }),
    )
  })

  it("refuses a trak whose checkout is on this machine, and an unknown one, with 404", async () => {
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, withCheckout("/tmp/wt-here"))
        const before = (yield* store.events(id)).length

        expect((yield* post(id, "sandbox/rebuild", {})).status).toBe(404)
        const pressed = yield* Ref.make<readonly string[]>([])
        const unknown = yield* post("no-such-trak", "sandbox/rebuild", {}).pipe(
          Effect.provideService(Sandboxes, rebuilding(pressed)),
        )
        expect(unknown.status).toBe(404)
        expect(yield* Ref.get(pressed)).toStrictEqual([])
        expect((yield* store.events(id)).length).toBe(before)
      }),
    )
  })
})

/**
 * What the work did to the files.
 *
 * **`Vcs` here is a real one**, which is what makes these end to end rather than a
 * check on the mapper: the range is resolved off the log, the `Vcs` is asked, its
 * patch is parsed and the answer comes back through the published Schema. The test
 * that reads hunk lines runs on `GitCliLayer`, because those are git's patch; the
 * rest run on the snapshot fake. The port's own promises — renames, binary files, a
 * checkout that has gone — are `test/contract/vcs.ts`.
 */
/** The changes body, through the published contract — `detailOf`'s reasoning. */
const changesOf = (response: HttpServerResponse) =>
  Effect.map(jsonOf(response), Schema.decodeUnknownSync(ChangesDto))

/** Which files, and what happened to each — hoisted so the assertions stay flat. */
const changedIn = (changes: ChangesDto): readonly { path: string; change: string }[] =>
  changes.files.map((f) => ({ path: f.path, change: f.change }))

/**
 * A `git` call made to build a fixture, on `call`'s reasoning: a repository that
 * will not answer while the test is setting itself up is a broken test, not an
 * outcome this file is about.
 */
const setUp = <A>(effect: Effect.Effect<A, GitFailed>): Effect.Effect<A> => Effect.orDie(effect)

describe("reading one file of what a trak changed", () => {
  it("answers one file of the slice where `path` names it", async () => {
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const vcs = yield* Vcs
        const worktree = yield* setUp(vcs.createWorktree(id))
        writeFileSync(join(worktree.path, "half-done.ts"), "export const wip = true\n")
        writeFileSync(join(worktree.path, "other.ts"), "export const other = true\n")

        const store = yield* Store
        yield* seedLog(store, id, [
          Events.trakCreated("a turn still going"),
          Events.worktreeReady(worktree),
        ])

        const one = yield* changesOf(
          yield* get(`/${id}/changes?at=uncommitted&path=${encodeURIComponent("other.ts")}`),
        )
        expect(changedIn(one)).toStrictEqual([{ path: "other.ts", change: "added" }])
        expect(one.files[0]?.hunks).toHaveLength(1)
      }),
    )
  })
})

describe("reading what a trak changed", () => {
  it("shows the whole branch, and one step on its own", async () => {
    // On git, because the hunk lines are git's patch read back.
    await onGit.runFlow([], (id) =>
      Effect.gen(function* () {
        const vcs = yield* Vcs
        const worktree = yield* setUp(vcs.createWorktree(id))
        writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
        const first = yield* setUp(vcs.commitWork(worktree, "1-work"))
        writeFileSync(join(worktree.path, "docs.md"), "# json flag\n")
        const second = yield* setUp(vcs.commitWork(worktree, "2-work"))

        const store = yield* Store
        yield* seedLog(store, id, [
          Events.trakCreated("two steps that each wrote a file"),
          Events.worktreeReady(worktree),
          Events.workCommitted(first, 1),
          Events.workCommitted(second, 2),
        ])

        const all = yield* changesOf(yield* get(`/${id}/changes?at=all`))
        expect(all.at).toBe("all")
        expect(changedIn(all)).toStrictEqual([
          { path: "docs.md", change: "added" },
          { path: "flag.ts", change: "added" },
        ])

        // The second position alone: the file the first one wrote is not in it,
        // which is the whole of what makes the picker worth having.
        const step2 = yield* changesOf(yield* get(`/${id}/changes?at=2`))
        expect(step2.at).toBe("2")
        expect(changedIn(step2)).toStrictEqual([{ path: "docs.md", change: "added" }])
        expect(step2.files[0]?.hunks[0]?.lines).toStrictEqual([
          { kind: "add", text: "# json flag", newLine: 1 },
        ])
      }),
    )
  })

  it("shows what the agent has written and not yet committed", async () => {
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const vcs = yield* Vcs
        const worktree = yield* setUp(vcs.createWorktree(id))
        writeFileSync(join(worktree.path, "half-done.ts"), "export const wip = true\n")

        const store = yield* Store
        yield* seedLog(store, id, [
          Events.trakCreated("a turn still going"),
          Events.worktreeReady(worktree),
        ])

        const pending = yield* changesOf(yield* get(`/${id}/changes?at=uncommitted`))
        expect(changedIn(pending)).toStrictEqual([{ path: "half-done.ts", change: "added" }])
      }),
    )
  })

  it("is an empty answer for a position that kept nothing, not an error", async () => {
    // A step that changed no files, a compose, a spawn whose pieces have not
    // joined — none has a sha of its own, and a screen that showed an error
    // there would report a broken engine for an ordinary step.
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, [
          Events.trakCreated("nothing was kept"),
          Events.worktreeReady({
            path: WorktreePath.make("/tmp/wt"),
            branch: BranchName.make("trak/nothing-here"),
            base: CommitSha.make("base000"),
          }),
        ])

        const response = yield* get(`/${id}/changes?at=4`)
        expect(response.status).toBe(200)
        expect(yield* changesOf(response)).toStrictEqual({ at: "4", files: [] })
      }),
    )
  })

  it("refuses a slice it does not have a name for, and changes nothing doing it", async () => {
    // The one 400: a value this route does not accept, which its own UI cannot
    // produce. Every other emptiness above is a fact about the work.
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, id, [Events.trakCreated("d")])

        const response = yield* get(`/${id}/changes?at=HEAD~1`)
        expect(response.status).toBe(400)
        expect(yield* logTags(id)).toStrictEqual(["TrakCreated"])
      }),
    )
  })

  it("is a 404 for a trak that does not exist", async () => {
    await runFlow([], () =>
      Effect.gen(function* () {
        expect((yield* get("/no-such-trak/changes?at=all")).status).toBe(404)
      }),
    )
  })
})

describe("acting on a trak that does not exist", () => {
  it("is a 404 on every action route — an empty log and no such id are one fact", async () => {
    await runFlow([], () =>
      Effect.gen(function* () {
        const acted = yield* post("no-such-trak", "act", { action: "approve" })
        const resumed = yield* post("no-such-trak", "resume", {})
        const closed = yield* post("no-such-trak", "close", {})
        expect([acted.status, resumed.status, closed.status]).toStrictEqual([404, 404, 404])
      }),
    )
  })

  it("is a 404 on the detail route", async () => {
    await runFlow([], () =>
      Effect.gen(function* () {
        const response = yield* get("/no-such-trak")
        expect(response.status).toBe(404)
      }),
    )
  })
})

describe("acting at a real gate", () => {
  it("accepts the action and drives the trak on a fiber of its own", async () => {
    await runFlow([composer("plan"), step(1, "plan", reply.artifact("the work"))], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        // The whole sequence, per `testing-tiers`, so an extra spawn shows up too.
        // It is read from the store rather than off the response because the drive
        // outlives the request now — which is the point of the change, and is why
        // the assertion this file used to make (the response carries the log the
        // drive produced) has moved to the stream.
        expect(yield* drove(id, "act", { action: "approve" })).toStrictEqual([
          "TrakCreated",
          "WorktreeReady",
          "ComposerReturned",
          "HumanActed",
          "ConditionsMet",
          "AgentReturned",
          "ChecksPassed",
        ])
        const detail = yield* detailOf(yield* get(`/${id}`))
        expect(detail.state).toStrictEqual({ _tag: "AwaitingHuman", step: 1, kind: "approval" })
      }),
    )
  })

  it("takes a skip where the gate offers one, and drives past the step", async () => {
    await runFlow(
      [
        composer("plan", "work"),
        step(1, "plan", reply.questions("Which subcommands?")),
        step(2, "work", reply.artifact("the work")),
      ],
      (id) =>
        Effect.gen(function* () {
          yield* create(id, "d")
          yield* act(id, 0, human.approve())

          const tags = yield* drove(id, "act", { action: "skip", message: "docs only" })
          const detail = yield* detailOf(yield* get(`/${id}`))
          expect(detail.state).toStrictEqual({ _tag: "AwaitingHuman", step: 2, kind: "approval" })
          expect(tags).toStrictEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "HumanActed",
            "ConditionsMet",
            "AgentReturned",
            "HumanActed",
            "WorkCommitted", // step 0's own work kept
            "EffectsRan", // and its effects run, of which this agent declares none
            "ConditionsMet",
            "AgentReturned",
            "ChecksPassed",
          ])
        }),
    )
  })

  it("does not quietly approve when a skip aims at filed work", async () => {
    // Accepted and not 409: the gate is real, so the route lets it through and
    // `decide` is what refuses the action — the same treatment `Replan` gets outside
    // an escalation gate, and for the same reason. The route cannot tell the two
    // apart without a second copy of the gate table, which is exactly what
    // `actionView` says the client must not grow either.
    //
    // The outcome is `Failed{engine}`, which is retryable like every failure. What
    // must not happen is the plan advancing: `Skip` and `Approve` route
    // identically, so an unguarded skip here would be an approval nobody gave.
    //
    // A refusal by `decide` now lands on the log rather than in the response, which
    // is the honest place for it: nothing was wrong with the *request*.
    await runFlow([composer("plan"), step(1, "plan", reply.artifact("the work"))], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        yield* act(id, 0, human.approve())

        expect(yield* drove(id, "act", { action: "skip" })).not.toContain("WorkCommitted")
        expect((yield* detailOf(yield* get(`/${id}`))).state._tag).toBe("Failed")
      }),
    )
  })

  it("reports no gate field — a client asks `state`, never a remembered gate", async () => {
    // On the detail route, which is where the promise now lives: an action's own
    // response is an acknowledgement and could not carry a gate if it tried.
    await runFlow([composer("plan"), step(1, "plan", reply.artifact("the work"))], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        yield* drove(id, "act", { action: "approve" })
        expect(yield* jsonOf(yield* get(`/${id}`))).not.toHaveProperty("gate")
      }),
    )
  })
})

// Two children run at once, so their prompts reach the log in either order: the
// `<invocation>` blocks for the pair in `logs/http-api/*.xml` can swap between runs,
// and their session ids with them. A swapped diff there is scheduling, not a change in
// what an agent was told. Nothing below asserts on a child's session id for the same
// reason — `FixedIds` is one counter.
describe("a spawn gate approved over HTTP", () => {
  it("births every child the spawn named, and leaves the parent waiting on them", async () => {
    // The regression, exactly. This 202 minted two ids, parked the parent at
    // `AwaitingChildren` and stopped there: `driveChild` had lost its only caller in
    // `src/`, so the children were ids in a log nobody would ever drive. Nothing
    // failed, because the only test that drove one drove it by hand.
    await runFlow(FAN_OUT, (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "Rate-limit the public API")

        expect(yield* drove(id, "act", { action: "approve" })).toStrictEqual([
          "TrakCreated",
          "WorktreeReady",
          "ComposerReturned",
          "HumanActed",
          "ConditionsMet",
          "AgentReturned",
          "ChecksPassed",
          "HumanActed",
          "WorkCommitted", // step 1's own work kept
          "EffectsRan", // and its effects run, of which this agent declares none
          "ChildrenSpawned",
        ])

        const [security, performance] = yield* childrenOf(id)
        // Unreachable: the spawn named two. Stated because the pair is what every
        // assertion below is about.
        if (security === undefined || performance === undefined) {
          return yield* Effect.die("a spawn of two spawned otherwise")
        }

        // One drive per child, under the child's own key — which is why each wait is
        // the child's. Waiting on the parent proves nothing: its drive ended at
        // `ChildrenSpawned` and it is idle for the whole fan-out.
        //
        // The whole log per child, per `testing-tiers`: no `ComposerReturned` is the
        // half a state check misses. A child is born with the one-step plan its entry
        // describes, and re-deciding a plan a human already approved is a tax.
        const born = [
          "TrakCreated",
          "WorktreeReady",
          "ConditionsMet",
          "AgentReturned",
          "ChecksPassed",
        ]
        expect(yield* daemonDrove(security, hasChecksPassed)).toStrictEqual(born)
        expect(yield* daemonDrove(performance, hasChecksPassed)).toStrictEqual(born)

        // Born, not merely named: rows in the list, each carrying the parent it came
        // from and its position in the spawn. Drawn flat they would read as two
        // unrelated pieces of work.
        expect(childRows(yield* summariesOf(yield* get("")))).toStrictEqual([
          { id: security, of: id, step: 2, child: 0 },
          { id: performance, of: id, step: 2, child: 1 },
        ])

        // And the parent has not moved: two children owe it an event, and neither has
        // been answered for.
        expect((yield* detailOf(yield* get(`/${id}`))).state).toStrictEqual({
          _tag: "AwaitingChildren",
          step: 2,
        })
      }),
    )
  })

  it("lands each child by its own id, and the parent joins and moves on", async () => {
    await runFlow(FAN_OUT, (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "Rate-limit the public API")
        yield* drove(id, "act", { action: "approve" })
        const [security, performance] = yield* childrenOf(id)
        if (security === undefined || performance === undefined) {
          return yield* Effect.die("a spawn of two spawned otherwise")
        }
        yield* daemonDrove(security, hasChecksPassed)
        yield* daemonDrove(performance, hasChecksPassed)

        // A child is a trak: it holds its own artifact at its own gate, and the routes
        // that move it are the ones that move any other. Nothing about these four
        // requests knows it is addressing a child. One is kept and one is dropped,
        // which is the whole of what a verdict is — both land, only one carries a sha.
        yield* drove(security, "act", { action: "approve" })
        yield* drove(security, "merge", {})
        yield* drove(performance, "act", { action: "approve" })
        yield* drove(performance, "close", {})

        // **No wait on the parent, and that is the point.** `landOnParent` runs on the
        // child's own fiber, so the drive `drove` just waited out is the one that
        // appended every event below — waiting on the parent would be waiting on a
        // trak nothing is driving.
        //
        // The tail rather than the sequence: what these routes own is the landing and
        // what it releases. The whole log of a spawn is `spawn.test.ts`'s assertion,
        // where the engine is the subject.
        expect((yield* logTags(id)).slice(-8)).toStrictEqual([
          "ChildLanded",
          "ChildLanded",
          "ChildrenJoined",
          "WorkCommitted", // the spawn position's own work kept
          "EffectsRan", // a spawn names no agent, so there is nothing to run
          "ConditionsMet",
          "AgentReturned",
          "ChecksPassed",
        ])
        expect((yield* detailOf(yield* get(`/${id}`))).state).toStrictEqual({
          _tag: "AwaitingHuman",
          step: 3,
          kind: "approval",
        })
      }),
    )
  })
})

describe("a spawn parked with children nobody started", () => {
  it("births them on a resume of the parent, minting no new ids", async () => {
    // The shipped bug, as a fixture: `act` here is the engine, not the daemon, so the
    // spawn parks with two ids and nothing carrying them — which is the state every
    // trak that reached a spawn was left in while `driveChild` had no caller. What has
    // to get them out is the one press a person has.
    await runFlow(FAN_OUT, (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "Rate-limit the public API")
        const parked = yield* act(id, 1, human.approve())
        expect(parked.state).toStrictEqual({ _tag: "AwaitingChildren", step: 2 })
        const before = yield* childrenOf(id)

        yield* drove(id, "resume", {})

        const [security, performance] = yield* childrenOf(id)
        if (security === undefined || performance === undefined) {
          return yield* Effect.die("a spawn of two spawned otherwise")
        }
        // The same two ids: `SpawnChildren` reuses what the log already names, so a
        // resume picks up the children that were promised rather than minting a
        // second set nobody would ever drive.
        expect([security, performance]).toStrictEqual(before)

        const born = [
          "TrakCreated",
          "WorktreeReady",
          "ConditionsMet",
          "AgentReturned",
          "ChecksPassed",
        ]
        expect(yield* daemonDrove(security, hasChecksPassed)).toStrictEqual(born)
        expect(yield* daemonDrove(performance, hasChecksPassed)).toStrictEqual(born)
      }),
    )
  })
})

/** The trak as it stands, off its log — `current` in `test/support/spawn.ts`. */
const replayed = (id: TrakId) =>
  Effect.gen(function* () {
    const store = yield* Store
    return replayHistory(id, yield* store.events(id))
  })

/**
 * The first child of a spawn, finished over HTTP and holding one committed file — the
 * shape every case about a dirty parent starts from. The parent parks at
 * `AwaitingChildren` with a clean checkout, because the gate before the spawn kept
 * its work; what dirties it afterwards is the case's own doing, as a person's would be.
 */
const finishedChild = (id: TrakId) =>
  Effect.gen(function* () {
    yield* createAndStart(id, "Rate-limit the public API")
    yield* drove(id, "act", { action: "approve" })
    const [security] = yield* childrenOf(id)
    if (security === undefined) return yield* Effect.die("a spawn of two spawned otherwise")
    yield* daemonDrove(security, hasChecksPassed)
    writeWork(worktreeOf(yield* replayed(security)), "shared.md", "the child's copy\n")
    yield* drove(security, "act", { action: "approve" })
    expect((yield* replayed(security)).state._tag).toBe("Finished")
    return security
  })

describe("merging a child into a parent whose checkout is dirty", () => {
  const refusalOf = (response: HttpServerResponse) =>
    Effect.map(jsonOf(response), Schema.decodeUnknownSync(RefusalDto))

  it("refuses the merge naming the files, and leaves the child at Finished", async () => {
    // `blank-white-booby`: git refuses to merge over an uncommitted copy, and a merge
    // issued anyway fails the child with the finishing card gone. Asked of the parent's
    // checkout first, the child keeps its press and the refusal names the same files.
    await runFlow(FAN_OUT, (id) =>
      Effect.gen(function* () {
        const security = yield* finishedChild(id)
        writeWork(worktreeOf(yield* replayed(id)), "shared.md", "the parent's own copy\n")
        const before = yield* logTags(security)

        const response = yield* post(security, "merge", {})
        expect(response.status).toBe(409)
        expect(yield* refusalOf(response)).toStrictEqual({ _tag: "Dirty", files: ["?? shared.md"] })
        expect(yield* logTags(security)).toStrictEqual(before)
        expect((yield* replayed(security)).state._tag).toBe("Finished")
      }),
    )
  })

  it("commits the parent's checkout under the parent's name, then merges the child", async () => {
    // On git, because the parent's status and log are read from git.
    await onGit.runFlow(FAN_OUT, (id) =>
      Effect.gen(function* () {
        const security = yield* finishedChild(id)
        const parent = worktreeOf(yield* replayed(id))
        writeWork(parent, "shared.md", "the child's copy\n")
        writeWork(parent, "mine.md", "a person's own edit\n")

        const tags = yield* drove(security, "commit-and-merge", {})
        expect(tags.slice(-3)).toStrictEqual(["Merged", "WorkMerged", "WorktreeRemoved"])
        expect((yield* replayed(security)).state._tag).toBe("Merged")

        // The parent's edits are on its branch, titled by the parent's own description,
        // and the checkout is clean afterwards — nothing is left for the next merge to
        // collide with.
        expect(git(parent.path, "status", "--porcelain")).toBe("")
        expect(git(parent.path, "log", "--format=%s", "-3")).toContain("Rate-limit the public API")
        expect(inWorktree(parent, "mine.md")).toBe(true)
        // And nothing was written to the parent's log for it.
        expect((yield* logTags(id)).slice(-1)).toStrictEqual(["ChildLanded"])
      }),
    )
  })

  it("lands a child whose merge git already refused, from the failure", async () => {
    // The resume path issues the merge without the pre-check, so the failure stays
    // reachable; the same press from `Failed{merge}` re-issues it once the parent is
    // committed. No terminal, no `Restart` that re-runs the identical refusal.
    await runFlow(FAN_OUT, (id) =>
      Effect.gen(function* () {
        const security = yield* finishedChild(id)
        // The same bytes the child committed: git refuses to overwrite an untracked copy
        // even when it is identical, which is what the incident's three children hit.
        writeWork(worktreeOf(yield* replayed(id)), "shared.md", "the child's copy\n")
        const refused = yield* advance(security, Events.merged())
        expect(refused.state).toMatchObject({ _tag: "Failed", kind: "merge" })
        if (refused.state._tag === "Failed") expect(refused.state.error).toContain("shared.md")

        const tags = yield* drove(security, "commit-and-merge", {})
        expect(tags.slice(-3)).toStrictEqual(["Restarted", "WorkMerged", "WorktreeRemoved"])
        expect((yield* replayed(security)).state._tag).toBe("Merged")
      }),
    )
  })

  it("takes the Merge press from the failure too, and pre-checks the parent first", async () => {
    // The finishing card keeps its Merge press at `Failed{merge}`, and that press is
    // `/merge`: refused with the files while the parent is still dirty — one refusal
    // rather than a second failure — and a re-issued merge once it is clean. On git,
    // because the parent's copy is committed the way a person would, outside the port.
    await onGit.runFlow(FAN_OUT, (id) =>
      Effect.gen(function* () {
        const security = yield* finishedChild(id)
        const parent = worktreeOf(yield* replayed(id))
        writeWork(parent, "shared.md", "the child's copy\n")
        const refused = yield* advance(security, Events.merged())
        expect(refused.state).toMatchObject({ _tag: "Failed", kind: "merge" })
        const before = yield* logTags(security)

        const response = yield* post(security, "merge", {})
        expect(response.status).toBe(409)
        expect(yield* refusalOf(response)).toStrictEqual({ _tag: "Dirty", files: ["?? shared.md"] })
        expect(yield* logTags(security)).toStrictEqual(before)

        git(parent.path, "add", "-A")
        git(parent.path, "commit", "-q", "-m", "keep my copy")
        const tags = yield* drove(security, "merge", {})
        expect(tags.slice(-3)).toStrictEqual(["Restarted", "WorkMerged", "WorktreeRemoved"])
        expect((yield* replayed(security)).state._tag).toBe("Merged")
      }),
    )
  })

  it("refuses a child that has not finished, and appends nothing", async () => {
    await runFlow(FAN_OUT, (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "Rate-limit the public API")
        yield* drove(id, "act", { action: "approve" })
        const [security] = yield* childrenOf(id)
        if (security === undefined) return yield* Effect.die("a spawn of two spawned otherwise")
        yield* daemonDrove(security, hasChecksPassed)
        const before = yield* logTags(security)

        const response = yield* post(security, "commit-and-merge", {})
        expect(response.status).toBe(409)
        expect(yield* refusalOf(response)).toStrictEqual({ _tag: "NotFinished" })
        expect(yield* logTags(security)).toStrictEqual(before)
      }),
    )
  })

  it("refuses a trak with no parent, whose tree is a person's own", async () => {
    // The host repository keeps its refusal at `/merge`: there is no trak to name a
    // person's files by. A 400, because the client never offers the press there.
    await runFlow([composer("plan"), step(1, "plan", reply.artifact("the work"))], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        yield* act(id, 0, human.approve())
        yield* act(id, 1, human.approve())
        const before = yield* logTags(id)

        const response = yield* post(id, "commit-and-merge", {})
        expect(response.status).toBe(400)
        expect(yield* logTags(id)).toStrictEqual(before)
      }),
    )
  })
})

/** The prediction the Merge press's label reads, at the one failure that keeps the press. */
describe("the merge preview at a merge git refused", () => {
  it("still predicts a conflict for the press kept at the failure", async () => {
    // The Merge press stays on the card at `Failed{merge}`, so its label has to be
    // told whether the merge would go in — the same question the preview answers at
    // `Finished`, on the one state a person is most likely to press from twice.
    await runFlow(FAN_OUT, (id) =>
      Effect.gen(function* () {
        const security = yield* finishedChild(id)
        writeWork(worktreeOf(yield* replayed(id)), "shared.md", "the child's copy\n")
        const refused = yield* advance(security, Events.merged())
        expect(refused.state).toMatchObject({ _tag: "Failed", kind: "merge" })

        const preview = Schema.decodeUnknownSync(MergePreviewDto)(
          yield* jsonOf(yield* get(`/${security}/merge`)),
        )
        expect(preview.parentId).toBe(id)
        expect(preview.conflicts).toBe(false)
      }),
    )
  })
})

describe("a second driver for a child the daemon is already driving", () => {
  it("accepts a resume of the parent, and touches neither child", async () => {
    await runFlow(ONE_HANGS, (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "Rate-limit the public API")
        yield* drove(id, "act", { action: "approve" })
        const [security, performance] = yield* childrenOf(id)
        if (security === undefined || performance === undefined) {
          return yield* Effect.die("a spawn of two spawned otherwise")
        }

        // The first lens' turn starts and never answers, so its drive is genuinely in
        // flight rather than nearly finished — the same device the mid-turn refusals
        // above use, and the only thing that makes this a state instead of a race.
        yield* logged(security, hasWorktreeReady)
        expect(yield* driving(security)).toBe(true)
        const waiting = yield* daemonDrove(performance, hasChecksPassed)

        // A person pressing Resume on the parent. Accepted — the parent's own drive
        // ended at the spawn — and the fan-out runs on the fiber `drove` waits out, so
        // by the time it returns every child has been considered and decided about.
        yield* drove(id, "resume", {})

        // Neither child moves, for two different reasons, and both matter. The one
        // still running has a fiber, so `onlyIfMissing` refuses a second: a
        // `Restarted` here — let alone a second `TrakCreated` — would be two fibers
        // appending to one log. The one parked at its own gate is waiting for a
        // person, and re-driving it would append a `Restarted` that changes nothing,
        // end, and start the fan-out again — two siblings answering each other for as
        // long as the daemon is up.
        expect(yield* logTags(security)).toStrictEqual([
          "TrakCreated",
          "WorktreeReady",
          "ConditionsMet",
        ])
        expect(yield* logTags(performance)).toStrictEqual(waiting)
        expect(hasRestarted(waiting)).toBe(false)
      }),
    )
  })

  it("refuses a resume aimed at the running child with 409, and appends nothing", async () => {
    // The same claim from the other side, and the one `testing-tiers` calls
    // load-bearing: a child the daemon is driving is a trak with a driver, so the
    // surface has to turn the second one away by the child's own key.
    await runFlow(ONE_HANGS, (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "Rate-limit the public API")
        yield* drove(id, "act", { action: "approve" })
        const [security, performance] = yield* childrenOf(id)
        if (security === undefined || performance === undefined) {
          return yield* Effect.die("a spawn of two spawned otherwise")
        }
        yield* logged(security, hasWorktreeReady)
        // The sibling is waited out rather than left racing the end of the test.
        // It says the 409 is refused because *this* child has a driver and not
        // because the spawn had barely started — and a test that returned while
        // its turn was still in flight recorded a different number of invocations
        // per run, which is the one thing `prompt-log.ts` must not do.
        yield* daemonDrove(performance, hasChecksPassed)

        const response = yield* post(security, "resume", {})
        expect([response.status, response.statusText]).toStrictEqual([409, "Driving"])
        // A tidy status code that still appended is the bug wearing a hat.
        expect(yield* logTags(security)).toStrictEqual([
          "TrakCreated",
          "WorktreeReady",
          "ConditionsMet",
        ])
      }),
    )
  })
})

/**
 * How many of one event a log holds — hoisted because a `.filter` inside a flow body
 * is one callback past the limit.
 */
const countOf = (tags: readonly string[], tag: string): number =>
  tags.filter((t) => t === tag).length

/** compose -> one step -> the question, so one flow reaches the second door. */
const ASKING = [
  composer("plan"),
  step(1, "plan", reply.artifact("the work")),
  step(2, "generic", reply.artifact("it does not — the offline path is untouched")),
]

const QUESTION = "does this cover the offline case?"

/** A trak run to `Finished` over HTTP, which is the only state this door opens on. */
const untilFinished = (id: TrakId) =>
  Effect.gen(function* () {
    yield* create(id, "d")
    yield* act(id, 0, human.approve())
    yield* act(id, 1, human.approve())
    expect((yield* detailOf(yield* get(`/${id}`))).state._tag).toBe("Finished")
  })

describe("asking a trak that has come to rest", () => {
  it("runs the engine's own agent on the question, with no composer turn behind it", async () => {
    await runFlow(ASKING, (id) =>
      Effect.gen(function* () {
        yield* untilFinished(id)
        const tags = yield* drove(id, "reenter", { what: QUESTION, agent: "generic" })
        // One composer run: the one that planned the original work. The question did
        // not buy a second, which is the whole of what this door is for.
        expect(countOf(tags, "ComposerReturned")).toBe(1)

        // The turn stands in the plan that already ran, at the end of it, and nothing
        // that ran was renumbered to make room for it.
        const detail = yield* detailOf(yield* get(`/${id}`))
        expect(detail.plan?.steps).toMatchObject([
          { type: "compose" },
          { type: "agent", agent: "plan" },
          { type: "agent", agent: "generic", instruction: QUESTION, conversational: true },
        ])
        // Standing at that turn's own gate, with its answer on the table.
        expect(detail.state).toMatchObject({ _tag: "AwaitingHuman", step: 2 })
      }),
    )
  })

  it("refuses any agent but that one, without appending anything", async () => {
    await runFlow(ASKING, (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* untilFinished(id)
        const before = yield* store.events(id)

        // `work` is a real agent of the fixture's fleet, and that is the point: the
        // fleet is roles a plan places, not turns to drop onto finished work. A 400
        // rather than a refusal body, mirroring the create route — the screen only
        // sends what the engine offered it, so another name is a hand-written request.
        const response = yield* post(id, "reenter", { what: "have a look", agent: "work" })
        expect(response.status).toBe(400)
        expect(response.statusText).toContain("work")
        expect((yield* store.events(id)).length).toBe(before.length)
      }),
    )
  })
})

const isReentry = (e: Event): boolean => e._tag === "Reentered"

describe("sending a trak back past the forge's refusal to merge", () => {
  it("tells the composer to merge the remote's base and plan the push", async () => {
    await runFlowWithAgentLog(
      [composer("plan"), step(1, "plan", reply.artifact("the work")), afterReentry("plan")],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* untilFinished(id)
          yield* drove(id, "reenter", { what: "Pull request #7 cannot merge.", base: "main" })

          const reentry = (yield* eventsOf(id)).find(isReentry)
          expect(reentry).toMatchObject({ what: "Pull request #7 cannot merge.", base: "main" })
          const prompt = composerRuns(yield* agentLog).at(-1)?.prompt ?? ""
          expect(prompt).toContain("Plan the merge of `origin/main` into this branch")
          expect(prompt).toContain("plan the step that pushes")
          // A person's press, not the engine's send-back: the plan gate is theirs.
          expect((yield* detailOf(yield* get(`/${id}`))).state._tag).toBe("AwaitingProposal")
        }),
    )
  })
})

// ============================================================================
// The built client
// ============================================================================

/** A bundle as Vite lays one out: `index.html` and hashed files under `assets/`. */
const builtClient = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "orkestra-dist-"))
  mkdirSync(join(dir, "assets"))
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>Orkestra</title>")
  writeFileSync(join(dir, "assets", "index-abc123.js"), "console.log('app')")
  const elsewhere = mkdtempSync(join(tmpdir(), "orkestra-elsewhere-"))
  writeFileSync(join(elsewhere, "secret.txt"), "not in the bundle")
  symlinkSync(join(elsewhere, "secret.txt"), join(dir, "leak.txt"))
  return dir
}

/** The wildcard on its own, over a bundle the test wrote. Needs nothing provided. */
const serveClient = (dist: string, path: string) =>
  Router.toHttpApp(Router.empty.pipe(clientRoute(dist))).pipe(
    Effect.flatMap((app) =>
      Effect.provideService(
        app,
        ServerRequest.HttpServerRequest,
        ServerRequest.fromWeb(new Request(`http://localhost${path}`)),
      ),
    ),
    Effect.scoped,
    Effect.orDie,
  )

const bodyOf = (response: HttpServerResponse): Promise<string> => toWeb(response).text()

describe("the built client", () => {
  it("serves a file that is in the bundle, and the app for a path that is not", async () => {
    const dist = builtClient()
    const asset = await Effect.runPromise(serveClient(dist, "/assets/index-abc123.js"))
    expect(asset.status).toBe(200)
    expect(asset.headers["content-type"]).toBe("text/javascript; charset=utf-8")
    // Content-hashed, so the bytes at that name never change and may be kept for ever.
    expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable")
    expect(asset.headers["x-content-type-options"]).toBe("nosniff")

    // A deep link: the path is the app's to route, so the app is what comes back —
    // under a name a rebuild changes, so it is not cached.
    const deep = await Effect.runPromise(serveClient(dist, "/traks/some-trak"))
    expect(deep.status).toBe(200)
    expect(deep.headers["content-type"]).toBe("text/html; charset=utf-8")
    expect(deep.headers["cache-control"]).toBe("no-cache")
    expect(await bodyOf(deep)).toContain("<title>Orkestra</title>")

    const root = await Effect.runPromise(serveClient(dist, "/"))
    expect(root.status).toBe(200)
    expect(root.headers["content-type"]).toBe("text/html; charset=utf-8")
  })

  it("never answers the app under /api/, so a route nothing names is still a 404", async () => {
    // Through the whole router, because the point is precedence: the wildcard is what
    // reaches `/api/nope` once no named route has, and it must not turn that into HTML.
    await runFlow([], () =>
      Effect.gen(function* () {
        const nope = yield* call(new Request("http://localhost/api/nope"))
        expect(nope.status).toBe(404)
        expect(nope.headers["content-type"]).toBeUndefined()
      }),
    )
    const dist = builtClient()
    const bare = await Effect.runPromise(serveClient(dist, "/api"))
    expect(bare.status).toBe(404)
  })

  it("refuses every spelling of an API path the router accepts, not just the canonical", async () => {
    // The wildcard sees the raw target, so `startsWith("api/")` here would answer the
    // app for each of these: the URL parser reads `//api/nope` as the host `api` and the
    // path `/nope`, and neither the case nor the inner slashes survive a string test
    // either. `targetOf` is asked instead, so what the router calls the API this calls
    // the API. The guard in front refuses these too once a passphrase is set; this is
    // the other half — that with none set they stay a 404 rather than becoming HTML.
    const dist = builtClient()
    const spellings = ["//api/nope", "///api//nope", "/API/nope", "/%61pi/nope", "/api/"]
    const answered = await Promise.all(
      spellings.map(async (spelling) => {
        const response = await Effect.runPromise(serveClient(dist, spelling))
        return `${spelling} ${response.status}`
      }),
    )
    expect(answered).toEqual(spellings.map((spelling) => `${spelling} 404`))
  })

  it("keeps to the bundle: a link out of it and a climb get the app, not the file", async () => {
    const dist = builtClient()
    const linked = await Effect.runPromise(serveClient(dist, "/leak.txt"))
    expect(linked.headers["content-type"]).toBe("text/html; charset=utf-8")
    expect(await bodyOf(linked)).not.toContain("not in the bundle")
    // Encoded so the URL parser does not fold it away before the route sees it.
    const climbed = await Effect.runPromise(serveClient(dist, "/%2e%2e/%2e%2e/etc/passwd"))
    expect(climbed.headers["content-type"]).toBe("text/html; charset=utf-8")
  })

  it("serves the manifest and the service worker as what they are", async () => {
    // Chromium refuses to install from a manifest served as octet-stream, and a
    // service worker must arrive as JavaScript to register — both are copied into the
    // bundle root out of `client/public`, outside `assets/`, so neither may be cached
    // under its unchanging name.
    const dist = builtClient()
    writeFileSync(join(dist, "manifest.webmanifest"), `{"name":"Orkestra"}`)
    writeFileSync(join(dist, "sw.js"), "self.addEventListener('push', () => {})")

    const manifest = await Effect.runPromise(serveClient(dist, "/manifest.webmanifest"))
    expect(manifest.status).toBe(200)
    expect(manifest.headers["content-type"]).toBe("application/manifest+json")
    expect(manifest.headers["cache-control"]).toBe("no-cache")

    const worker = await Effect.runPromise(serveClient(dist, "/sw.js"))
    expect(worker.status).toBe(200)
    expect(worker.headers["content-type"]).toBe("text/javascript; charset=utf-8")
    expect(worker.headers["cache-control"]).toBe("no-cache")
  })

  it("is a 503 naming the build command until the client is built", async () => {
    const empty = mkdtempSync(join(tmpdir(), "orkestra-nodist-"))
    const response = await Effect.runPromise(serveClient(empty, "/"))
    expect(response.status).toBe(503)
    expect(await bodyOf(response)).toContain(BUILD_COMMAND)
  })

  it("reports at boot whether the bundle is missing, current, or older than a source", async () => {
    const checkout = mkdtempSync(join(tmpdir(), "orkestra-checkout-"))
    const dist = join(checkout, "client", "dist")
    mkdirSync(join(checkout, "client", "src"), { recursive: true })
    mkdirSync(join(checkout, "shared", "src"), { recursive: true })
    const source = join(checkout, "client", "src", "main.tsx")
    writeFileSync(source, "export {}")
    writeFileSync(join(checkout, "client", "index.html"), "<!doctype html>")
    utimesSync(source, 1_000, 1_000)
    utimesSync(join(checkout, "client", "index.html"), 1_000, 1_000)

    expect(await Effect.runPromise(bundleState(dist, checkout))).toMatchObject({ _tag: "Missing" })

    mkdirSync(dist)
    writeFileSync(join(dist, "index.html"), "<!doctype html>")
    utimesSync(join(dist, "index.html"), 2_000, 2_000)
    expect(await Effect.runPromise(bundleState(dist, checkout))).toMatchObject({
      _tag: "Built",
      newer: undefined,
    })

    utimesSync(source, 3_000, 3_000)
    expect(await Effect.runPromise(bundleState(dist, checkout))).toMatchObject({
      _tag: "Built",
      newer: source,
    })

    // `client/public` is copied into the bundle verbatim, so an icon or a service
    // worker edited there is a stale bundle exactly as an edited component is.
    mkdirSync(join(checkout, "client", "public"), { recursive: true })
    const icon = join(checkout, "client", "public", "icon-192.png")
    writeFileSync(icon, "png")
    utimesSync(icon, 4_000, 4_000)
    expect(await Effect.runPromise(bundleState(dist, checkout))).toMatchObject({
      _tag: "Built",
      newer: icon,
    })
  })
})

describe("the built client's id", () => {
  it("is read on every ask, and is none where it cannot tell", async () => {
    const dist = builtClient()
    // A bundle built before the id existed, or one mid-rebuild, has no file.
    expect(await bundleId(dist)).toBeUndefined()

    writeFileSync(join(dist, "build.json"), JSON.stringify({ id: "first" }))
    expect(await bundleId(dist)).toBe("first")

    // A rebuild under a running engine is the case it exists for: the next ask sees it.
    writeFileSync(join(dist, "build.json"), JSON.stringify({ id: "second" }))
    expect(await bundleId(dist)).toBe("second")

    writeFileSync(join(dist, "build.json"), "{ half written")
    expect(await bundleId(dist)).toBeUndefined()
    writeFileSync(join(dist, "build.json"), JSON.stringify({ id: 7 }))
    expect(await bundleId(dist)).toBeUndefined()
  })
})

/** Wait until the daemon remembers a run at this trak — the check has started. */
const checkInFlight = (id: TrakId): Effect.Effect<void, never, Checks> =>
  Effect.flatMap(Checks, (checks) =>
    Effect.repeat(checks.live(id), {
      until: (run) => run !== undefined,
      schedule: Schedule.spaced("1 millis"),
    }),
  ).pipe(Effect.timeout("20 seconds"), Effect.orDie, Effect.asVoid)

describe("ending the check a trak has in flight", () => {
  const VERIFY = new Map([
    [
      "verify",
      {
        name: "verify",
        description: "Runs the project's own verification.",
        timeoutSeconds: 300,
        askedEverySeconds: undefined,
        exclusive: false,
        cache: true,
        ignoresLinguistGenerated: false,
        units: undefined,
        cacheAcross: "platform" as const,
        path: "/repo/.orkestra/checks/verify.sh",
      },
    ],
  ])
  const declaring = workDeclaring(["verify"], { checks: VERIFY })

  it("kills it, parks at the checks gate for no strike, and settles the console", async () => {
    // The same press as the stop, on the one script state with a gate to land at. `hangs`
    // is what makes the check genuinely running when the press arrives.
    await runFlowWithAgentLog(
      [composer("work"), step(1, "work", reply.artifact("v1"))],
      (id) =>
        Effect.gen(function* () {
          yield* create(id, "Add a --json flag")
          expect((yield* post(id, "act", { action: "approve" })).status).toBe(202)
          yield* checkInFlight(id)

          const tags = yield* drove(id, "stop", {})
          expect(tags.slice(-2)).toStrictEqual(["AgentReturned", "ChecksCancelled"])
          const detail = yield* detailOf(yield* get(`/${id}`))
          expect(detail.state).toStrictEqual({ _tag: "AwaitingHuman", step: 1, kind: "checks" })
          // Named off the daemon's memory before the kill, and that memory is settled
          // rather than left running for every reload to draw.
          expect(detail.log.at(-1)).toMatchObject({
            _tag: "ChecksCancelled",
            step: 1,
            name: "verify",
          })
          expect(detail.check?.finished).toMatchObject({ verdict: "cancelled" })
          // No strike: the failure budget is what a `CheckFailed` fills, and none was written.
          const store = yield* Store
          expect(
            slotAt(replayHistory(id, yield* store.events(id)), 1).checkFailures,
          ).toBeUndefined()

          // And the gate is the failing one: approving takes the work.
          expectState(yield* act(id, 1, human.approve()), "Finished")
        }),
      declaring,
      { verify: [hangs] },
    )
  })

  it("carries a turn's own ending that raced a stop on to its checks, rather than stranding it", async () => {
    // The race the note names. The press writes its intent, the turn answers before the
    // take-over reaches it — decided as from `AgentWorking`, so into `CheckRunning` — and
    // the take-over then interrupts the drive that was about to run the checks. Seeded
    // as the press's two halves with the ending between them: `intend` for the ending is
    // the old drive's append with its checks cut off by that interruption.
    await runFlowWithAgentLog(
      [composer("work"), stepHangs(1, "work")],
      (id) =>
        Effect.gen(function* () {
          yield* create(id, "Add a --json flag")
          expect((yield* post(id, "act", { action: "approve" })).status).toBe(202)
          const turn = yield* turnInFlight(id)

          yield* intend(id, Events.stopRequested(turn.sessionId, turn.step))
          yield* intend(
            id,
            Events.agentReturned(1, turn.sessionId, makeArtifact({ Summary: "v1" })),
          )
          yield* (yield* Drives).stopping(id, undefined)
          yield* logged(id, hasChecksPassed)
          yield* idle(id)

          // Carried on as a resume carries it: the checks the interruption cut off run
          // again, and the trak reaches the gate they open.
          expect((yield* logTags(id)).slice(-4)).toStrictEqual([
            "StopRequested",
            "AgentReturned",
            "Restarted",
            "ChecksPassed",
          ])
          expect((yield* detailOf(yield* get(`/${id}`))).state).toStrictEqual({
            _tag: "AwaitingHuman",
            step: 1,
            kind: "approval",
          })
        }),
      declaring,
      { verify: [pass] },
    )
  })

  it("refuses a check nothing of this daemon's is driving, and appends nothing", async () => {
    // A crashed daemon leaves `CheckRunning` on the log with no fiber behind it. With
    // nothing to interrupt, a cancel would park the trak while the script — if any —
    // ran on to an ending nothing routes; the resume is what that trak wants.
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        const seed = [...midTurnLog, Events.agentReturned(1, sid, makeArtifact({ Summary: "v1" }))]
        yield* seedLog(store, id, seed)
        expect((yield* detailOf(yield* get(`/${id}`))).state).toStrictEqual({
          _tag: "CheckRunning",
          step: 1,
        })
        const response = yield* post(id, "stop", {})
        expect([response.status, response.statusText]).toStrictEqual([409, "NothingToStop"])
        expect((yield* store.events(id)).length).toBe(seed.length)
      }),
    )
  })
})

describe("skipping the next step's checks, part-way through", () => {
  it("lands while a turn is running, on every mode, without touching the drive", async () => {
    // `midTurnLog` is a `manual` trak, which is exactly where a hold is refused and this
    // is not: every mode runs its checks.
    await runFlow([composer("plan"), stepHangs(1, "plan")], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        expect((yield* post(id, "act", { action: "approve" })).status).toBe(202)
        yield* logged(id, hasHumanActed)

        const response = yield* post(id, "skip-checks", { skipping: true })
        expect(response.status).toBe(204)
        expect((yield* logTags(id)).at(-1)).toBe("SkipChecksChanged")
        const detail = yield* detailOf(yield* get(`/${id}`))
        expect([detail.mode, detail.skippingChecks, detail.state._tag]).toStrictEqual([
          "manual",
          true,
          "AgentWorking",
        ])
        const drives = yield* Drives
        expect(yield* drives.driving(id)).toBe(true)
      }),
    )
  })

  it("refuses a trak at rest, where there is no next run to reach, and appends nothing", async () => {
    await runFlow([composer("plan"), step(1, "plan", reply.artifact("v1"))], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* create(id, "d")
        yield* act(id, 0, human.approve())
        yield* act(id, 1, human.approve())
        yield* drove(id, "close", {})
        const before = yield* store.events(id)
        const response = yield* post(id, "skip-checks", { skipping: true })
        expect([response.status, response.statusText]).toStrictEqual([409, "AtRest"])
        expect((yield* store.events(id)).length).toBe(before.length)
        expect((yield* post("nobody", "skip-checks", { skipping: true })).status).toBe(404)
      }),
    )
  })

  it("carries the switch on every frame, so the readout patches rather than re-reads", async () => {
    await runFlow([composer("plan"), stepHangs(1, "plan")], (id) =>
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* openStream()
          const reading = yield* Effect.fork(sseEvents(response, 5, isAppended))
          const drives = yield* Drives
          yield* drives.start(id, bornSmart)
          // Past the ask as well as the compose: the press has to be the last append,
          // and `ConditionsMet` lands on the drive's own fiber after `ComposerReturned`.
          yield* logged(id, hasAsked)
          expect((yield* post(id, "skip-checks", { skipping: true })).status).toBe(204)
          const frames = yield* Fiber.join(reading).pipe(Effect.timeout("20 seconds"), Effect.orDie)
          const last = frames.at(-1)
          expect(
            last?._tag === "Appended" ? [last.event._tag, last.skippingChecks] : last,
          ).toStrictEqual(["SkipChecksChanged", true])
        }),
      ),
    )
  })
})

describe("turning auto-merge on or off", () => {
  it("is taken at Finished, starts it afresh, and turns it off again", async () => {
    await runFlow([composer("plan"), step(1, "plan", reply.artifact("v1"))], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        yield* act(id, 0, human.approve())
        yield* act(id, 1, human.approve())
        expect((yield* post(id, "auto-merge", { on: true })).status).toBe(204)
        expect((yield* logTags(id)).at(-1)).toBe("AutoMergeChanged")
        const on = yield* detailOf(yield* get(`/${id}`))
        expect([on.state._tag, on.autoMerge]).toStrictEqual(["Finished", { sentBack: 0, limit: 3 }])
        expect((yield* post(id, "auto-merge", { on: false })).status).toBe(204)
        expect((yield* detailOf(yield* get(`/${id}`))).autoMerge).toBeUndefined()
      }),
    )
  })

  it("refuses an archived trak and an unknown one, and appends nothing", async () => {
    await runFlow([composer("plan"), step(1, "plan", reply.artifact("v1"))], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* create(id, "d")
        yield* act(id, 0, human.approve())
        yield* act(id, 1, human.approve())
        yield* drove(id, "close", {})
        const before = yield* store.events(id)
        const response = yield* post(id, "auto-merge", { on: true })
        expect([response.status, response.statusText]).toStrictEqual([409, "Archived"])
        expect((yield* store.events(id)).length).toBe(before.length)
        expect((yield* post("nobody", "auto-merge", { on: true })).status).toBe(404)
      }),
    )
  })

  it("refuses a child, which has no pull request of its own", async () => {
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        const born = Events.trakCreated("d", {
          parent: { id: TrakId.make("parent"), step: 1, child: 0, depth: 1 },
          plan: proposal("one piece", [{ agent: "plan", instruction: "one" }]),
          base: undefined,
          decisions: [],
          artifacts: [],
          split: { instruction: "one piece", pieces: [{ name: "1.0-plan", instruction: "one" }] },
        })
        yield* seedLog(store, id, [born])
        const response = yield* post(id, "auto-merge", { on: true })
        expect([response.status, response.statusText]).toStrictEqual([409, "ChildTrak"])
        expect((yield* store.events(id)).length).toBe(1)
      }),
    )
  })

  it("refuses turning it on where the trak's goal forbids it, and lets it be turned off", async () => {
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const goal = GoalId.make("held")
        yield* seedLog(yield* GoalStore, goal, [
          GoalEvents.started({
            file: "held",
            title: "Held",
            line: "l",
            finished: "done",
            limits: { autoMerge: "never" },
          }),
        ])
        yield* seedLog(yield* Store, id, [Events.trakForGoal("d", "smart", goal)])
        const response = yield* post(id, "auto-merge", { on: true })
        expect([response.status, response.statusText]).toStrictEqual([409, "GoalForbidsAutoMerge"])
        expect((yield* post(id, "auto-merge", { on: false })).status).toBe(204)
      }),
    )
  })
})

/**
 * `FAN_OUT` with the step after the spawn started and never answered, so the stretch a
 * landing carries the parent through is a state rather than a race.
 */
const LANDING_HANGS = [
  composer("work", lenses, "plan"),
  step(1, "work", reply.artifact("the change")),
  childStep("review", "security", reply.artifact("no injection")),
  childStep("review", "performance", reply.artifact("one N+1")),
  stepHangs(3, "plan"),
]

/** The parent's row off the list route — hoisted for `summariesOf`'s reason. */
const rowOf = (listed: readonly (typeof TrakSummaryDto.Type)[], id: TrakId) =>
  listed.find((t) => t.id === id)

describe("a parent a child's landing is carrying", () => {
  it("reads as running on the list, though no fiber of its own is driving it", async () => {
    // The landing runs the parent's next step on the *child's* fiber, so the map of
    // drives holds nothing under the parent's id. The list used to ask only that map,
    // and drew the parent idle for the whole of the step.
    await runFlow(LANDING_HANGS, (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "Rate-limit the public API")
        yield* drove(id, "act", { action: "approve" })
        const children = yield* childrenOf(id)
        for (const lens of children) {
          yield* daemonDrove(lens, hasChecksPassed)
          yield* drove(lens, "act", { action: "approve" })
          expect(yield* post(lens, "merge", {})).toMatchObject({ status: 202 })
        }
        // The last merge's landing has entered step 3, whose turn never answers.
        expect(yield* turnInFlight(id)).toMatchObject({ step: 3 })

        expect(yield* driving(id)).toBe(false)
        const row = rowOf(yield* summariesOf(yield* get("")), id)
        expect(row).toMatchObject({ running: true })
      }),
    )
  })
})
