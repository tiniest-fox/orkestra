// adapter: the ONE place that turns a CliProviderSpec into a running process.
// Every provider shares this; none of them re-implements spawning, stdin
// delivery, or exit handling.

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { Deferred, Effect, type Layer, Ref, type Scope, Stream } from "effect"
import { Process, type ProcessShape, type ProcessSpec, type Spawned } from "../ports/process.js"
import type {
  CliProviderSpec,
  McpWire,
  PromptDelivery,
  Provider,
  ProviderAdapter,
  SessionLog,
} from "../ports/provider.js"
import type { Dialogue } from "../types/dialogue.js"
import { McpFailed, ProcessFailed, ProviderFailed } from "../types/errors.js"
import type { McpReply } from "../types/mcp.js"
import { Places } from "../types/place.js"
import { ProviderEvent } from "../types/provider-event.js"
import type {
  PromptImage,
  SessionId,
  SessionRequest,
  Settles,
  SteeredMessage,
} from "../types/session.js"
import { providersLayer } from "./provider-registry.js"

/**
 * A spawn or an exit that failed, as the turn's failure — keeping the runner verb that
 * caused it, so the trak's screen can lead with the runner's sentence.
 */
const spawnFailed = (provider: string, e: ProcessFailed): ProviderFailed =>
  new ProviderFailed({
    provider,
    reason: e.reason,
    ...(e.runner === undefined ? {} : { runner: e.runner }),
    ...(e.runnersOnly === undefined ? {} : { runnersOnly: e.runnersOnly }),
    ...(e.carried === undefined ? {} : { carried: e.carried }),
    ...(e.gone === undefined ? {} : { gone: e.gone }),
  })

/**
 * A CLI reports an error two ways, and until now only one of them failed a turn.
 *
 * A non-zero exit is caught below. The other way is *in-band*: claude writes a
 * `result` line with `is_error` and exits 0, which `normalize.ts` turns into an
 * `ApiError` event in the stream. Nothing consumed it — `CollectText`'s fold
 * dropped it into the accumulator — so an erroring session produced empty or
 * partial text, `elicit` re-prompted it three times, and the give-up was
 * recorded as the *agent's* own `failed` output. That is exactly the laundering
 * Decision 53 was written about, reached by the other of the two paths.
 *
 * It lives here rather than in `CollectText` deliberately. This is the harness
 * every CLI provider shares and it already owns the `ProviderFailed` mapping, so
 * one edit covers every provider present and future; and the scripted provider,
 * which is not a CLI provider, keeps its own meaning for a turn the script does
 * not match — several tests rely on that, and a per-call conversion in `elicit`
 * would have changed it.
 *
 * The event is emitted BEFORE the stream fails, so `withTranscript` in
 * `runtime.ts` still records it. A failure that leaves no trace of itself is
 * worse than one that does, and the message here is often the only description
 * of what went wrong — which is why it becomes `reason` rather than being
 * replaced by a summary.
 *
 * **Every in-band error is classified `provider`, including the ones that are
 * arguably the agent's own doing** — a max-turns stop reports `is_error` too,
 * and the normalized event carries no subtype to tell them apart. That is the
 * safer direction on purpose: a `provider` failure is retryable and keeps its
 * worktree, where a terminal classification loses the run.
 */
const failOnApiError = (
  provider: string,
  event: ProviderEvent,
): Stream.Stream<ProviderEvent, ProviderFailed> =>
  event._tag === "ApiError"
    ? Stream.concat(
        Stream.make(event),
        // The kind rides with the sentence. It is the only thing downstream can branch
        // on without re-reading the provider's prose, and after this the event is gone.
        Stream.fail(new ProviderFailed({ provider, reason: event.message, kind: event.kind })),
      )
    : Stream.make(event)

/**
 * One turn's held-open pipe, and the messages steered down it so far.
 *
 * `steered` is why a message is written once and how its delivery is recognised. A
 * CLI that names the message's key on the report is paired by it. One that echoes a
 * user message back and names nothing but the text is paired with the oldest message
 * of that text still unheard; the turn's own prompt is echoed the same way and is in
 * no list, which is what keeps it from being reported as delivered. Both live exactly
 * as long as the turn.
 *
 * `framed` is a message in the provider's own framing: the lines to write for it now,
 * which is none where a dialogue holds it for a turn the CLI has not named yet.
 */
interface Pipe {
  readonly send: Spawned["send"]
  readonly framed: (message: SteeredMessage) => readonly string[]
  readonly steered: Ref.Ref<readonly Steered[]>
  /**
   * The session the CLI announced on this pipe, which is not the one the pipe is held
   * under where the CLI mints its own. The first announcement; a re-announcement
   * carries the same id.
   */
  readonly announced: Ref.Ref<SessionId | undefined>
  /** Each MCP request written and not yet answered, by the count it was framed with. */
  readonly asks: Ref.Ref<ReadonlyMap<number, Deferred.Deferred<McpReply>>>
  /**
   * What to run each time a request leaves `asks` — a turn's own decision whether its
   * pipe may now close. Nothing for a pipe that holds no turn.
   *
   * **Every way out runs it, not only an answer.** A waiting request holds the pipe
   * open past the turn's result, and the CLI exits only when the pipe closes. A request
   * given up on — its wait ran out, or whoever asked was interrupted — leaves no line
   * on the stream to re-decide at, so a close decided only on lines would never come
   * and the turn would never end.
   */
  readonly settle: Ref.Ref<Effect.Effect<void>>
}

type Steered = SteeredMessage & { readonly heard: boolean }

/**
 * Where one turn stands on ending, which is three questions with three answers.
 *
 * - `answered` — a result is in hand. The exit code stops being evidence about the
 *   turn, a reply that cannot be written no longer fails it, and a later `ApiError` is
 *   some other turn's.
 * - `enveloped` — a result held the caller's envelope (`SessionRequest.settles`). The
 *   background work still running is stopped rather than waited for.
 * - `complete` — no later result is part of the answer.
 *
 * `outstanding` is the background tasks the provider says are alive — the level's set
 * as it last stood, empty for a provider that never says. REPLACE semantics: each level
 * is the whole answer. `stopped` is the ones this harness has already written a stop
 * for, so a level repeated while a task dies does not write it a second.
 */
interface TurnEnd {
  readonly answered: boolean
  readonly enveloped: boolean
  readonly complete: boolean
  readonly outstanding: readonly string[]
  readonly stopped: readonly string[]
}

const turnOpen: TurnEnd = {
  answered: false,
  enveloped: false,
  complete: false,
  outstanding: [],
  stopped: [],
}

/**
 * `TurnEnd` once a result has passed, `settles` being whether it held the envelope.
 *
 * **A first result with nothing outstanding completes the answer**, envelope or not:
 * the agent has nothing to wait for, so a result after it is the reply to a message
 * that arrived too late to steer the turn, written in a second turn of the same
 * process. A first result written while a task runs leaves the turn open for good —
 * the report that task's ending prompts arrives after the level has emptied, so the
 * level reaching zero cannot be what says the answer is whole.
 */
const afterResult = (end: TurnEnd, settles: boolean): TurnEnd => ({
  ...end,
  answered: true,
  enveloped: settles,
  complete: settles || (!end.answered && end.outstanding.length === 0),
})

/** The level the provider reported, as the ids of the tasks it says are alive. */
const alive = (end: Ref.Ref<TurnEnd>, tasks: readonly { readonly id: string }[]) =>
  Ref.update(end, (at) => ({ ...at, outstanding: tasks.map((task) => task.id) }))

/**
 * Stop every background task still alive once a result has held the envelope — the
 * step has filed, and nothing is left to read what the work would report.
 *
 * **A stop line per task, not the pipe closing.** Stdin EOF does not end a task that
 * is running: the CLI goes on waiting for it with the pipe closed, and by then there
 * is no pipe to write a stop down either. So the tasks are stopped by name and the
 * pipe closes on the empty level that follows, as it does for a turn that waited.
 *
 * A write that fails is a pipe the child has stopped reading, which is the process
 * going — the outcome wanted. A provider with no stop line has no level to stop.
 */
const stopWhatRuns = (
  end: Ref.Ref<TurnEnd>,
  delivery: PromptDelivery,
  send: Spawned["send"],
  controlSeq: Ref.Ref<number>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (delivery._tag !== "StreamJson") return
    const ids = yield* Ref.modify(end, (at) => {
      const fresh = at.enveloped ? at.outstanding.filter((id) => !at.stopped.includes(id)) : []
      return [fresh, { ...at, stopped: [...at.stopped, ...fresh] }]
    })
    for (const id of ids) {
      const n = yield* Ref.updateAndGet(controlSeq, (c) => c + 1)
      yield* send(delivery.stopTaskLine(id, `ork-${n}`)).pipe(
        Effect.catchTag("ProcessFailed", () => Effect.void),
      )
    }
  })

/**
 * What one normalized event becomes on the way out of the harness — itself, except
 * for the three this turn's own state decides.
 *
 * **A delivery is paired or dropped** — see `Pipe`.
 *
 * **Once the answer is complete, a further `Result` is nothing** — see `afterResult`.
 * It is the reply to a late message, or the provider's own turn about a task the
 * harness stopped. The one that passes moves the turn's state here rather than in a
 * later stage, so the next line is judged against it however the stream is chunked.
 *
 * **Once any result is in hand, an `ApiError` is nothing.** Our own turn cannot fail
 * after its result, so the error is a later turn's, and passed through it would fail a
 * turn whose answer is in hand. Its spend still arrives, as `Usage`.
 */
const settledBy =
  (end: Ref.Ref<TurnEnd>, settles: Settles, pipe: Pipe | undefined) =>
  (e: ProviderEvent): Effect.Effect<readonly ProviderEvent[]> =>
    Effect.gen(function* () {
      if (e._tag === "ApiError") return (yield* Ref.get(end)).answered ? [] : [e]
      if (e._tag === "Result") {
        return yield* Ref.modify(end, (was) =>
          was.complete ? [[], was] : [[e], afterResult(was, settles(e.text))],
        )
      }
      if (e._tag !== "MessageDelivered") return [e]
      if (pipe === undefined) return []
      const key = yield* Ref.modify(pipe.steered, (all) => {
        const at = all.findIndex(
          (m) => !m.heard && (e.key === undefined ? m.text === e.text : m.key === e.key),
        )
        const found = all[at]
        return found === undefined
          ? [undefined, all]
          : [found.key, all.map((m, i) => (i === at ? { ...m, heard: true } : m))]
      })
      return key === undefined ? [] : [ProviderEvent.MessageDelivered({ text: e.text, key })]
    })

/** `SessionRequest.settles` for a request that carries none. */
const neverSettles: Settles = () => false

/** How long one MCP request waits for its answer. A tool call is a server doing work. */
const MCP_ANSWER_WAIT = "2 minutes"

const PIPE_CLOSED = "the pipe closed before the answer arrived"

/**
 * Every request still waiting is told the pipe is gone. Run where a pipe is released
 * and where its process stops printing, so a waiter learns at once rather than at the
 * end of its own wait.
 */
const unanswered = (pipe: Pipe): Effect.Effect<void> =>
  Effect.gen(function* () {
    const waiting = yield* Ref.getAndSet(pipe.asks, new Map())
    yield* Effect.forEach(
      waiting,
      ([n, waiter]) => Deferred.succeed(waiter, { n, body: undefined, error: PIPE_CLOSED }),
      { discard: true },
    )
  })

/** One turn's pipe, registered under its session for as long as the turn's scope lives. */
const heldPipe = (
  pipes: Ref.Ref<ReadonlyMap<SessionId, Pipe>>,
  sessionId: SessionId,
  send: Spawned["send"],
  framed: Pipe["framed"],
): Effect.Effect<Pipe, never, Scope.Scope> =>
  Effect.gen(function* () {
    const pipe: Pipe = {
      send,
      framed,
      steered: yield* Ref.make<readonly Steered[]>([]),
      announced: yield* Ref.make<SessionId | undefined>(undefined),
      asks: yield* Ref.make<ReadonlyMap<number, Deferred.Deferred<McpReply>>>(new Map()),
      settle: yield* Ref.make<Effect.Effect<void>>(Effect.void),
    }
    yield* Effect.acquireRelease(
      Ref.update(pipes, (m) => new Map(m).set(sessionId, pipe)),
      () =>
        Ref.update(pipes, (m) => {
          const next = new Map(m)
          next.delete(sessionId)
          return next
        }).pipe(Effect.zipRight(unanswered(pipe))),
    )
    return pipe
  })

/**
 * One line, taken as the answer to a waiting MCP request where it is one — before the
 * line is normalized, because the normalizer drops it.
 *
 * **Read only while something waits.** Recognising an answer parses the line, and
 * every line of every turn would otherwise be parsed twice for a question nearly no
 * turn asks.
 */
const answeredBy =
  (wire: McpWire, pipe: Pipe | undefined) =>
  (line: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (wire._tag === "None" || pipe === undefined) return
      if ((yield* Ref.get(pipe.asks)).size === 0) return
      const reply = wire.reply(line)
      if (reply === undefined) return
      const waiter = yield* left(pipe, reply.n)
      if (waiter !== undefined) yield* Deferred.succeed(waiter, reply)
    })

/**
 * Take one request out of `asks`, by whatever route it is leaving, and let the pipe's
 * owner re-decide — see `Pipe.settle`. Hands back the waiter where one was still there.
 */
const left = (pipe: Pipe, n: number): Effect.Effect<Deferred.Deferred<McpReply> | undefined> =>
  Ref.modify(pipe.asks, (all) => {
    const next = new Map(all)
    next.delete(n)
    return [all.get(n), next]
  }).pipe(Effect.zipLeft(Effect.flatten(Ref.get(pipe.settle))))

/** How many MCP requests a pipe still owes an answer to; none where no pipe is held. */
const waitingOn = (pipe: Pipe | undefined): Effect.Effect<number> =>
  pipe === undefined ? Effect.succeed(0) : Effect.map(Ref.get(pipe.asks), (asks) => asks.size)

/**
 * A turn's close decision, registered as what its pipe runs when a request leaves —
 * and handed back, for the places the turn itself re-decides.
 */
const settling = (
  pipe: Pipe | undefined,
  decide: Effect.Effect<void>,
): Effect.Effect<Effect.Effect<void>> =>
  pipe === undefined ? Effect.succeed(decide) : Effect.as(Ref.set(pipe.settle, decide), decide)

/**
 * `ProviderAdapter.mcp` over the pipes this harness holds — a module function for
 * `steerDown`'s reason, and found by the same id: the one the turn was requested under.
 *
 * Registered before the write, so an answer that beats the write's return finds its
 * waiter; taken back out where the write fails, which is the pipe having closed and
 * the same answer as a pipe that was never there — and where the wait runs out or the
 * asker is interrupted, through `left`, so the turn's close is decided again.
 */
const askedDown =
  (
    spec: CliProviderSpec,
    pipes: Ref.Ref<ReadonlyMap<SessionId, Pipe>>,
    seq: Ref.Ref<number>,
  ): ProviderAdapter["mcp"] =>
  (sessionId, request) =>
    Effect.gen(function* () {
      const wire = spec.mcp
      const pipe = (yield* Ref.get(pipes)).get(sessionId)
      if (wire._tag === "None" || pipe === undefined) return undefined
      const n = yield* Ref.updateAndGet(seq, (c) => c + 1)
      const line = wire.request(request, n, yield* Ref.get(pipe.announced))
      if (line === undefined) {
        return yield* new McpFailed({ reason: `${spec.name} cannot be asked that yet` })
      }
      const waiter = yield* Deferred.make<McpReply>()
      yield* Ref.update(pipe.asks, (all) => new Map(all).set(n, waiter))
      const forget = Effect.asVoid(left(pipe, n))
      const wrote = yield* Effect.either(pipe.send(line))
      if (wrote._tag === "Left") {
        yield* forget
        return undefined
      }
      const reply = yield* Deferred.await(waiter).pipe(
        Effect.timeoutFail({
          duration: MCP_ANSWER_WAIT,
          onTimeout: () => new McpFailed({ reason: `${spec.name} did not answer` }),
        }),
        Effect.onError(() => forget),
      )
      if (reply.error !== undefined) return yield* new McpFailed({ reason: reply.error })
      const answer = wire.answer(request, reply.body)
      if (answer === undefined) {
        return yield* new McpFailed({ reason: `${spec.name} answered with nothing readable` })
      }
      return answer
    })

/**
 * Write a file `argv` names for one spawn — `spec.mcpConfigFile`'s text, or the settings
 * `spec.setupGate` makes — and the path `argv` is handed. `undefined` writes nothing.
 *
 * Mode 0600 inside a fresh 0700 directory, so only this user reads the credentials an MCP
 * configuration holds. Acquired before the spawn, so the scope's finalizers run in
 * reverse: the process group is killed first and the file removed after, on an exit and
 * on a kill alike. An engine that is itself killed runs no finalizer, and leaves the file
 * behind under the same mode.
 */
const spawnFile = (
  spec: CliProviderSpec,
  text: string | undefined,
  name: string,
): Effect.Effect<string | undefined, ProviderFailed, Scope.Scope> => {
  if (text === undefined) return Effect.succeed(undefined)
  return Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        const dir = await mkdtemp(join(tmpdir(), "orkestra-mcp-"))
        const path = join(dir, name)
        await writeFile(path, text, { mode: 0o600, flag: "wx" })
        return path
      },
      catch: (cause) =>
        new ProviderFailed({
          provider: spec.name,
          reason: `could not write ${name}: ${String(cause)}`,
        }),
    }),
    (path) =>
      Effect.tryPromise(() => rm(dirname(path), { recursive: true, force: true })).pipe(
        Effect.ignore,
      ),
  )
}

/** The settings a CLI that holds commands is handed for a turn beside a setup still running. */
const settingsText = (spec: CliProviderSpec, req: SessionRequest): string | undefined =>
  spec.setupGate._tag === "SettingsFile" && req.setupGate !== undefined
    ? spec.setupGate.text(req.setupGate)
    : undefined

/**
 * The spawn's command line, with its MCP configuration and settings files written, and
 * those files as the spawn's `carries` — so a CLI run on another machine finds each at the
 * path it is handed — beside the request's `allowedOnHost` and `inProject`.
 */
const configured = (spec: CliProviderSpec, req: SessionRequest) =>
  Effect.gen(function* () {
    const config = yield* spawnFile(spec, spec.mcpConfigFile(req), "mcp.json")
    const settings = yield* spawnFile(spec, settingsText(spec, req), "settings.json")
    const carries = [config, settings].filter((path) => path !== undefined)
    return {
      argv: spec.argv(req, spec.readOnlyTools, config, settings),
      placed: {
        ...(carries.length === 0 ? {} : { carries }),
        ...(req.allowedOnHost === true ? { allowedOnHost: true as const } : {}),
        ...(req.inProject === true ? { inProject: true as const } : {}),
      },
    }
  })

/** How long a process started with no prompt has to become ready to be asked. */
const ATTEND_WAIT = "30 seconds"

/**
 * `ProviderAdapter.attend`: the CLI with no prompt, its pipe held under the request's
 * session for as long as the scope lives.
 *
 * Every line is read for three things and nothing else: the opening conversation's
 * reply, the answer to a waiting request, and the session the CLI announces. No event
 * leaves here — this is not a turn, so there is nothing to record and nothing to meter.
 * A process that stops printing is one that has gone: whoever waits on it is told, and
 * the next request finds the pipe closed.
 */
const attendWith =
  (
    spec: CliProviderSpec,
    proc: ProcessShape,
    pipes: Ref.Ref<ReadonlyMap<SessionId, Pipe>>,
  ): ProviderAdapter["attend"] =>
  (req) =>
    Effect.gen(function* () {
      const wire = spec.mcp
      if (wire._tag === "None") {
        return yield* new ProviderFailed({
          provider: spec.name,
          reason: `${spec.name} cannot be asked about its MCP servers`,
        })
      }
      const opening = wire.attending(req)
      const normalizeLine = spec.normalizer()
      const failed = (reason: string): ProviderFailed =>
        new ProviderFailed({ provider: spec.name, reason })
      const { argv, placed } = yield* configured(spec, req)
      const spawned = yield* proc
        .spawn({
          command: spec.command,
          args: argv,
          cwd: req.cwd,
          env: { ...spec.env, ...req.env },
          credentials: spec.credentials,
          stdin: opening.opening,
          holdStdin: true,
          ...placed,
        })
        .pipe(Effect.mapError((e) => failed(e.reason)))
      const pipe = yield* heldPipe(pipes, req.sessionId, spawned.send, () => [])
      const ready = yield* Deferred.make<void, ProviderFailed>()
      const read = (line: string): Effect.Effect<void, ProcessFailed> =>
        Effect.gen(function* () {
          yield* Effect.forEach(opening.replyTo(line), spawned.send, { discard: true })
          yield* answeredBy(wire, pipe)(line)
          for (const e of normalizeLine(line)) {
            if (e._tag === "SessionStarted") yield* Ref.update(pipe.announced, (s) => s ?? e.id)
          }
          if (opening.settled()) yield* Deferred.succeed(ready, undefined)
        })
      yield* spawned.lines.pipe(
        Stream.runForEach(read),
        Effect.ignore,
        Effect.ensuring(unanswered(pipe)),
        Effect.ensuring(Deferred.fail(ready, failed("it exited before it could be asked"))),
        Effect.forkScoped,
      )
      yield* Deferred.await(ready).pipe(
        Effect.timeoutFail({
          duration: ATTEND_WAIT,
          onTimeout: () => failed("it did not become ready to be asked"),
        }),
      )
    })

/**
 * How a steered message is framed for one spawn's pipe — see `Pipe.framed`. A
 * provider with no held pipe frames nothing, and nothing asks it to.
 */
const framing = (spec: CliProviderSpec, dialogue: Dialogue | undefined): Pipe["framed"] => {
  if (dialogue !== undefined) return dialogue.steer
  const delivery = spec.promptDelivery
  return delivery._tag === "StreamJson"
    ? (message) => [delivery.promptLine(message.text, message.images ?? [])]
    : () => []
}

/** `ProviderAdapter.stopBackgroundTask` over the pipes this harness holds, for `steerDown`'s reason. */
const stopDown =
  (
    spec: CliProviderSpec,
    pipes: Ref.Ref<ReadonlyMap<SessionId, Pipe>>,
    controlSeq: Ref.Ref<number>,
  ): ProviderAdapter["stopBackgroundTask"] =>
  (sessionId, taskId) =>
    Effect.gen(function* () {
      const delivery = spec.promptDelivery
      if (delivery._tag !== "StreamJson") return false
      const pipe = (yield* Ref.get(pipes)).get(sessionId)
      if (pipe === undefined) return false
      const n = yield* Ref.updateAndGet(controlSeq, (c) => c + 1)
      // A pipe that closed between the read and the write is the same answer
      // as one that was never there: nothing was stopped.
      const wrote = yield* Effect.either(pipe.send(delivery.stopTaskLine(taskId, `ork-${n}`)))
      return wrote._tag === "Right"
    })

/**
 * `ProviderAdapter.steer` over the pipes this harness holds — a module function rather
 * than a closure in `makeCliProvider`, which is at its length.
 *
 * **The pipe is found by the id the turn was requested under**, which is the one a
 * pipe is registered by. A CLI that mints its own session announces another, and no
 * pipe is under that one.
 */
const steerDown =
  (pipes: Ref.Ref<ReadonlyMap<SessionId, Pipe>>): ProviderAdapter["steer"] =>
  (sessionId, message) =>
    Effect.gen(function* () {
      const pipe = (yield* Ref.get(pipes)).get(sessionId)
      if (pipe === undefined) return false
      // Listed before the write, so a second caller with the same key finds it and
      // the echo of a fast write finds it too; taken back out if the write fails,
      // which is the pipe having closed at the turn's own result.
      const fresh = yield* Ref.modify(pipe.steered, (all) =>
        all.some((m) => m.key === message.key)
          ? [false, all]
          : [true, [...all, { ...message, heard: false }]],
      )
      if (!fresh) return true
      const wrote = yield* Effect.either(
        Effect.forEach(pipe.framed(message), pipe.send, { discard: true }),
      )
      if (wrote._tag === "Right") return true
      yield* Ref.update(pipe.steered, (all) => all.filter((m) => m.key !== message.key))
      return false
    })

/** `Spawned`, carrying where the CLI runs, and the runner's exec id where that is a sandbox. */
const spawnedEvent = (spawned: Spawned): ProviderEvent =>
  ProviderEvent.Spawned({
    pid: spawned.pid,
    ...(spawned.execId === undefined ? {} : { execId: spawned.execId }),
    place: spawned.place ?? Places.local(),
    ...(spawned.detached === undefined ? {} : { detached: spawned.detached }),
  })

/**
 * The stdin content for one spawn, by where the spec says the prompt goes. Under a
 * dialogue that is its opening line: the prompt follows in a reply.
 */
const stdinFor = (
  spec: CliProviderSpec,
  prompt: string,
  images: readonly PromptImage[],
  dialogue: Dialogue | undefined,
): string | undefined => {
  if (dialogue !== undefined) return dialogue.opening
  if (spec.promptDelivery._tag === "Stdin") return prompt
  if (spec.promptDelivery._tag === "StreamJson") {
    return spec.promptDelivery.promptLine(prompt, images)
  }
  return undefined
}

/**
 * The dialogue's answer to one line, written before the line is normalized. A write
 * that fails before the answer is in is not caught: the prompt travels in one of
 * these, so a reply that went nowhere is a turn that never starts, on a process that
 * waits for it without end. Once the answer is in, a reply carries only a person's
 * message, and one that cannot be written leaves the message waiting — it must not
 * fail a turn whose answer is in hand.
 *
 * `after` runs once the reply is down, which is the only point a line that earns no
 * event can close the pipe: a refused follow-on turn settles the dialogue and
 * normalizes to nothing.
 */
const replyDown =
  (
    dialogue: Dialogue | undefined,
    send: Spawned["send"],
    end: Ref.Ref<TurnEnd>,
    after: Effect.Effect<void>,
  ) =>
  (line: string): Effect.Effect<void, ProcessFailed> =>
    dialogue === undefined
      ? Effect.void
      : Effect.forEach(dialogue.replyTo(line), send, { discard: true }).pipe(
          Effect.catchTag("ProcessFailed", (e) =>
            Effect.flatMap(Ref.get(end), (at) => (at.answered ? Effect.void : Effect.fail(e))),
          ),
          Effect.zipRight(after),
        )

/**
 * The prompt with the tools a read-only turn must not use written under it, for a
 * provider that only asks. A `PromptOnly` provider enforces nothing, so the
 * restrictions have to reach the agent as text; without this the strategy would be
 * decorative.
 */
const restrictedPrompt = (spec: CliProviderSpec, req: SessionRequest): string =>
  spec.toolRestriction._tag === "PromptOnly" && req.toolAccess === "read-only"
    ? `${req.prompt}\n\n## Tools you must not use\n\n${spec.readOnlyTools.map((t) => `- ${t}`).join("\n")}`
    : req.prompt

/**
 * The part of the standing brief this turn's prompt body has to carry, for a CLI
 * with no session prompt to put it on — see `BriefDelivery`. The whole brief when
 * the conversation opens; the contract alone when the turn picks up a conversation
 * another position held, whose core it already has; nothing on a resume of its own.
 */
const briefInBody = (spec: CliProviderSpec, req: SessionRequest): string | undefined => {
  if (spec.brief._tag !== "PromptBody" || req.brief === undefined) return undefined
  if (req.resumeFrom === undefined) return `${req.brief.core}\n\n${req.brief.contract}`
  return req.inherited ? req.brief.contract : undefined
}

/**
 * The events in the log a CLI keeps beside its stream — see `SessionLog`. Read once
 * the process has exited, so the file is whole, and by the id the provider announced,
 * which is the only name the file has.
 *
 * **Nothing here fails the turn.** The answer is already in hand; a home with no
 * `sessions/`, a file not yet written, or one that cannot be read is a meter with no
 * reading, which is what absent means to every consumer. The one thing lost is said
 * at debug, since a person looking for the reading is the only one who cares why.
 */
const sessionLogEvents = (
  log: SessionLog,
  sessionId: SessionId | undefined,
  env: Readonly<Record<string, string | undefined>>,
): Effect.Effect<readonly ProviderEvent[]> => {
  if (log._tag === "None" || sessionId === undefined) return Effect.succeed([])
  const dir = log.under(env, homedir())
  return Effect.tryPromise(async () => {
    const names = await readdir(dir, { recursive: true })
    const own = names.filter((name) => log.isFor(sessionId, basename(name)))
    // Two files for one thread would be the CLI's doing; the last by name is the
    // latest, since the name opens with when it started.
    const file = own.sort().at(-1)
    if (file === undefined) return []
    const path = join(dir, file)
    const text = await readFile(path, "utf8")
    return [...text.split("\n").flatMap(log.read), ProviderEvent.SessionLogRead({ path })]
  }).pipe(
    Effect.catchAll((e) =>
      Effect.as(Effect.logDebug(`session log under ${dir} not read: ${String(e)}`), []),
    ),
  )
}

/** `sessionLogEvents` as a stream, read by the id announced by the time it runs. */
const sessionLogStream = (
  log: SessionLog,
  announced: Ref.Ref<SessionId | undefined>,
  env: Readonly<Record<string, string | undefined>>,
): Stream.Stream<ProviderEvent> =>
  Stream.unwrap(
    Effect.map(
      Effect.flatMap(Ref.get(announced), (id) => sessionLogEvents(log, id, env)),
      Stream.fromIterable,
    ),
  )

/**
 * A spawn's environment and the credentials it carries. A turn handed its own `signIn` runs
 * on that alone: it is laid over everything, each name it withholds is dropped from the
 * turn's `env` and from what the spawn inherits, and the spec's own credentials are not
 * forwarded into a sandbox, where the explicit `env` already carries the one chosen.
 */
const signedIn = (
  spec: CliProviderSpec,
  req: SessionRequest,
): Pick<ProcessSpec, "env" | "credentials" | "withhold"> => {
  const env = { ...spec.env, ...req.env }
  if (req.signIn === undefined) return { env, credentials: spec.credentials }
  const { withhold } = req.signIn
  const kept = Object.fromEntries(Object.entries(env).filter(([n]) => !withhold.includes(n)))
  return { env: { ...kept, ...req.signIn.env }, credentials: [], withhold }
}

/**
 * What the adapter repeats of its spec: where the session lives, the file the CLI signs in
 * through, and whether it holds a command while setup runs.
 */
const filesOf = (spec: CliProviderSpec) => ({
  sessionFile: spec.sessionFile,
  ...(spec.signInFile === undefined ? {} : { signInFile: spec.signInFile }),
  resumeLine: spec.resumeLine,
  credentials: spec.credentials,
  ...(spec.setupGate._tag === "None" ? {} : { gatesCommands: true as const }),
})

export const makeCliProvider = (
  spec: CliProviderSpec,
): Effect.Effect<ProviderAdapter, never, Process> =>
  Effect.gen(function* () {
    const proc = yield* Process
    // The held-open pipes, keyed by the session each turn runs in. This is what
    // the per-task stop and a steered message are written down, and an entry lives
    // exactly as long as its turn's scope — a pipe that is gone answers `false`.
    const pipes = yield* Ref.make<ReadonlyMap<SessionId, Pipe>>(new Map())
    // Correlation ids for control lines, unique within this process. The
    // provider echoes one back in its acknowledgement and nothing else reads it.
    const controlSeq = yield* Ref.make(0)

    const run: ProviderAdapter["run"] = (req: SessionRequest) =>
      Stream.unwrapScoped(
        Effect.gen(function* () {
          const restricted = restrictedPrompt(spec, req)
          const brief = briefInBody(spec, req)
          const prompt = brief === undefined ? restricted : `${brief}\n\n${restricted}`
          const { argv, placed } = yield* configured(spec, req)
          // Once per spawn, before the first line: a reader that settles the answer at
          // the end of the turn keeps what it saw, and it must not keep it across turns.
          const normalizeLine = spec.normalizer()
          // Once per spawn, as the normalizer is: it closes over this turn's prompt.
          const delivery = spec.promptDelivery
          const dialogue = delivery._tag === "Dialogue" ? delivery.dialogue(req, prompt) : undefined
          const held = spec.promptDelivery._tag === "StreamJson" || dialogue !== undefined
          const spawned = yield* proc.spawn({
            command: spec.command,
            args: spec.promptDelivery._tag === "LastArg" ? [...argv, prompt] : argv,
            cwd: req.cwd,
            ...signedIn(spec, req),
            stdin: stdinFor(spec, prompt, req.images ?? [], dialogue),
            holdStdin: held,
            ...placed,
            ...(req.execId === undefined ? {} : { execId: req.execId }),
            // Detached only under stream-json input. A dialogue answers each line it reads
            // with a request, so a stream replayed from its start would open the thread and
            // the turn a second time on the live server.
            ...(spec.promptDelivery._tag === "StreamJson"
              ? { detached: true, ...(req.reattach === undefined ? {} : { attach: req.reattach }) }
              : {}),
          })
          yield* Effect.logDebug(`${spec.name} pid=${spawned.pid} session=${req.sessionId}`)
          const pipe = held
            ? yield* heldPipe(pipes, req.sessionId, spawned.send, framing(spec, dialogue))
            : undefined

          const end = yield* Ref.make(turnOpen)
          // The session the provider announced, which names its side file — the
          // minted id is not it under `ReportedId`. The first announcement; a
          // re-announcement carries the same id.
          const announced = pipe?.announced ?? (yield* Ref.make<SessionId | undefined>(undefined))

          /**
           * Close the held pipe once a result is in, no background work is
           * outstanding and the dialogue owes nothing. Until then the pipe stays
           * open: it is what a stop is written down, and under a dialogue it is what
           * keeps a message the CLI has not answered for, and the turn that message
           * became, from dying with the process — and an MCP request still waiting,
           * whose answer is a line of this process. A turn that filed its envelope has
           * its work stopped first (`stopWhatRuns`); one that answered in prose
           * leaves it running with no limit on the wait, by decision — the escape
           * hatch there is the per-task stop, not a timer. Idempotent, so re-deciding
           * on every event, every reply and every request that stops waiting costs
           * nothing.
           */
          const drain = Effect.gen(function* () {
            const at = yield* Ref.get(end)
            const drained = at.answered && at.outstanding.length === 0
            if (!drained || dialogue?.settled() === false || (yield* waitingOn(pipe)) > 0) return
            // A close that fails is a pipe the child already stopped reading — it is
            // going, or gone, and `exited` below says how. Failing the stream here
            // would turn a clean exit with the answer in hand into a failed turn,
            // which is the verdict `assertCleanExit` exists to refuse.
            yield* spawned.endInput.pipe(Effect.catchTag("ProcessFailed", () => Effect.void))
          })
          const closeIfDrained = yield* settling(pipe, drain)
          const closeWhenDrained = (e: ProviderEvent): Effect.Effect<void> =>
            Effect.gen(function* () {
              if (e._tag === "SessionStarted") yield* Ref.update(announced, (s) => s ?? e.id)
              if (e._tag === "BackgroundTasks") yield* alive(end, e.tasks)
              yield* stopWhatRuns(end, delivery, spawned.send, controlSeq)
              yield* closeIfDrained
            })

          // Without this a broken invocation is indistinguishable from an empty
          // successful one.
          const assertCleanExit = Effect.gen(function* () {
            const ex = yield* spawned.exited
            if (!spec.failOnNonZeroExit || ex.code === 0) return
            // The exit code reports the session's last turn, never ours: the
            // provider gives itself another turn per background report, a failed
            // turn is followed by a clean exit when a later one succeeds, and the
            // reverse. Once our own result frame is in hand, `is_error` on it —
            // which `failOnApiError` already acts on — is the only verdict.
            if ((yield* Ref.get(end)).answered) return
            return yield* Effect.fail(
              new ProcessFailed({
                command: spec.command,
                reason: `exit ${ex.code ?? "?"}${ex.signal === undefined ? "" : ` (${ex.signal})`}: ${ex.stderr.trim().slice(0, 400)}`,
              }),
            )
          })

          // The side file after the exit, so it is whole — and after a clean one, since
          // a failed stream ends there and a reading for a failed turn has no meter.
          const sideFile = sessionLogStream(spec.sessionLog, announced, {
            ...process.env,
            ...req.env,
          })

          return Stream.concat(
            Stream.make(spawnedEvent(spawned)),
            Stream.concat(
              spawned.lines.pipe(
                Stream.tap(answeredBy(spec.mcp, pipe)),
                Stream.tap(replyDown(dialogue, spawned.send, end, closeIfDrained)),
                Stream.mapConcat(normalizeLine),
                Stream.mapConcatEffect(settledBy(end, req.settles ?? neverSettles, pipe)),
                Stream.tap(closeWhenDrained),
                Stream.flatMap((e) => failOnApiError(spec.name, e)),
              ),
              Stream.concat(Stream.fromEffect(assertCleanExit).pipe(Stream.drain), sideFile),
            ),
          )
        }),
      ).pipe(
        // Spawning and exiting fail as `ProcessFailed`; an in-band error already
        // arrives as the thing every caller sees, so it passes through unchanged
        // rather than being re-wrapped with a different reason.
        Stream.mapError((e) => (e._tag === "ProviderFailed" ? e : spawnFailed(spec.name, e))),
      )

    const stopBackgroundTask = stopDown(spec, pipes, controlSeq)
    const steer = steerDown(pipes)
    const mcp = askedDown(spec, pipes, controlSeq)
    const attend = attendWith(spec, proc, pipes)
    return {
      name: spec.name,
      run,
      resume: spec.resume,
      stopBackgroundTask,
      steer,
      mcp,
      attend,
      ...filesOf(spec),
    }
  })

/**
 * One adapter per spec, in one registry. The first spec is what a bare model name
 * selects — see `registryOf`.
 */
export const cliProviderLayer = (
  first: CliProviderSpec,
  ...rest: readonly CliProviderSpec[]
): Layer.Layer<Provider, never, Process> =>
  providersLayer(makeCliProvider(first), ...rest.map(makeCliProvider))
