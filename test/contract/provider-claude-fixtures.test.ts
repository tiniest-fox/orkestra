// The contract, run against the REAL claude spec — its argv, its normalizer and
// the shared `cli-provider` harness — with only the subprocess replaced. The
// stand-in replays `test/fixtures/claude/*.jsonl`, which is the same material
// `normalize.test.ts` reads: captured where a real run has produced the shape,
// hand-written where it has not.
//
// It exists for the case the scripted fake structurally cannot declare. A
// provider reports an error two ways, and the in-band one — a `result` line
// saying `is_error` while the process exits 0 — was silently discarded until
// nothing failed the turn. The scripted provider fails by construction
// (`Stream.fail`), so it can never pin how a real provider's failure *shape*
// becomes `ProviderFailed`. A fixture can, offline and for free.

import { readFileSync } from "node:fs"
import { Deferred, Effect, type Either, Fiber, Layer, Queue, Ref, Stream } from "effect"
import { describe, expect, it } from "vitest"
import type { ElicitFailed, ProviderFailed } from "../../src/agent/types/errors.js"
import { Places } from "../../src/agent/types/place.js"
import { Process, type ProcessShape, type Spawned } from "../../src/agent/ports/process.js"
import { Provider } from "../../src/agent/ports/provider.js"
import { ProviderEvent } from "../../src/agent/types/provider-event.js"
import { SessionId, type SessionRequest } from "../../src/agent/types/session.js"
import { cliProviderLayer, makeCliProvider } from "../../src/agent/adapters/cli-provider.js"
import { answerOf } from "../../src/agent/logic/answer.js"
import { claudePromptLine, claudeStopTaskLine } from "../../src/agent/providers/claude/argv.js"
import { claudeSpec } from "../../src/agent/providers/claude/index.js"
import { providerContract } from "./provider.js"

const fixture = (name: string): readonly string[] =>
  readFileSync(new URL(`../fixtures/claude/${name}`, import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")

const ARTIFACT_PROMPT = "produce an artifact"
const IN_BAND_FAILURE_PROMPT = "produce an artifact, but the API is out of credit"
const DROPPED_PROMPT = "produce an artifact, but the connection goes mid-reply"

/**
 * The prompt travels as claude's stream-json user-message line now, so a fixture
 * is matched on the line the harness actually writes — which also pins that the
 * harness wraps the prompt rather than sending it raw.
 */
const linesFor = (stdin: string): readonly string[] => {
  if (stdin === claudePromptLine(ARTIFACT_PROMPT)) return fixture("artifact-reply.synthetic.jsonl")
  if (stdin === claudePromptLine(IN_BAND_FAILURE_PROMPT)) return fixture("is-error.synthetic.jsonl")
  if (stdin === claudePromptLine(DROPPED_PROMPT))
    return fixture("connection-dropped.synthetic.jsonl")
  // Loud rather than empty: an unmatched prompt means the contract grew a case
  // this file has no fixture for, and a silent empty session would show up as a
  // confusing schema failure three layers away.
  throw new Error(`no claude fixture for stdin: ${stdin}`)
}

/**
 * A `Process` that replays a fixture and **exits 0**, which is the point: the
 * only other mechanism that fails a turn is the non-zero exit check, so a clean
 * exit is what proves the in-band path stands on its own.
 */
const FixtureProcess: Layer.Layer<Process> = Layer.succeed(Process, {
  spawn: (spec) =>
    Effect.sync(() => ({
      pid: 4242,
      lines: Stream.fromIterable(linesFor(spec.stdin ?? "")),
      exited: Effect.succeed({ code: 0, signal: undefined, stderr: "" }),
      send: () => Effect.void,
      endInput: Effect.void,
    })),
  isAlive: () => Effect.succeed(false),
  kill: () => Effect.void,
  startTime: () => Effect.succeed(undefined),
  killExec: () => Effect.void,
} satisfies ProcessShape)

providerContract({
  label: "claude (fixture-replayed)",
  layer: cliProviderLayer(claudeSpec).pipe(Layer.provide(FixtureProcess)),
  model: "haiku",
  artifactPrompt: ARTIFACT_PROMPT,
  timeoutMs: 1000,
  // The thinking fixture is not replayed for `artifactPrompt`, and adding it there
  // would make every other assertion in the suite carry an event it does not care
  // about. `normalize.test.ts` pins the mapping against the captured file instead.
  reportsThinking: false,
  inBandFailure: {
    prompt: IN_BAND_FAILURE_PROMPT,
    // Verbatim from the fixture's `result` field. A message a human reads at
    // `ork resume` is often the only description of what went wrong, so the
    // contract pins that it survives rather than being replaced by a summary.
    reasonIncludes: "Credit balance is too low",
    // An empty balance is `rate_limit`: the provider will not spend, and the fix is
    // time or money rather than another request. See `ApiErrorKind`.
    errorKind: "rate_limit",
  },
})

describe("a connection that drops mid-reply", () => {
  const run = <A, E>(effect: Effect.Effect<A, E, Provider>): Promise<A> =>
    Effect.runPromise(
      Effect.provide(effect, cliProviderLayer(claudeSpec).pipe(Layer.provide(FixtureProcess))),
    )

  const outcome = (): Promise<
    readonly Either.Either<ProviderEvent, ProviderFailed | ElicitFailed>[]
  > =>
    run(
      Effect.gen(function* () {
        const provider = yield* Provider
        return [
          ...(yield* Stream.runCollect(
            Stream.either(
              provider.run({
                prompt: DROPPED_PROMPT,
                cwd: process.cwd(),
                model: "haiku",
                sessionId: SessionId.make("33333333-3333-4333-8333-333333333333"),
                toolAccess: "read-only",
                permission: "read",
                resumeFrom: undefined,
                inherited: false,
                effort: undefined,
                brief: undefined,
                env: {},
              }),
            ),
          )),
        ]
      }),
    )

  it("names it interrupted rather than leaving it unclassified", async () => {
    // The failure this whole surface exists for. It carries no status code — there was
    // no HTTP response to carry one — so `statusKind` cannot see it and the pattern
    // table is the only thing that can.
    const events = (await outcome()).flatMap((e) => (e._tag === "Right" ? [e.right] : []))
    const reported = events.find((e) => e._tag === "ApiError")
    expect(reported?._tag === "ApiError" ? reported.kind : undefined).toBe("interrupted")
  })

  it("carries the kind onto the failure, beside the sentence the CLI wrote", async () => {
    // The step that used to lose it: `ProviderEvent.ApiError` is gone by the time the
    // engine records anything, so a kind the failure does not hold is one no log can
    // keep and no surface can ever read.
    const failures = (await outcome()).flatMap((e) => (e._tag === "Left" ? [e.left] : []))
    expect(failures[0]?._tag).toBe("ProviderFailed")
    expect(failures[0]?._tag === "ProviderFailed" ? failures[0].kind : undefined).toBe(
      "interrupted",
    )
    expect(failures[0]?.reason).toContain("Connection closed mid-response")
  })

  it("keeps the agent's own half-written words as their own event", async () => {
    // Two `text` blocks reach the stream and only one of them is the error. The client
    // folds the duplicate by matching that string; a normalizer that dropped either
    // would leave it nothing to match, or nothing of the turn to read.
    const events = (await outcome()).flatMap((e) => (e._tag === "Right" ? [e.right] : []))
    expect(events.flatMap((e) => (e._tag === "TextDelta" ? [e.text] : []))).toEqual([
      "I have read the file and am part-way through",
      "API Error: Connection closed mid-response. The response above may be incomplete.",
    ])
  })
})

// ============================================================================
// The held-open pipe: what keeps background work alive, and what closes it
// ============================================================================

const LEVEL_ONE = JSON.stringify({
  type: "system",
  subtype: "background_tasks_changed",
  tasks: [{ task_id: "task-1", task_type: "local_bash", description: "sleep 300" }],
})
const LEVEL_EMPTY = JSON.stringify({
  type: "system",
  subtype: "background_tasks_changed",
  tasks: [],
})
const OUR_RESULT = JSON.stringify({ type: "result", is_error: false, result: "done" })
/** The lines stream's terminator — the fake's EOF, not a frame claude writes. */
const CLOSE = " close"

/** Re-check every 10ms until the condition holds; the suite's timeout is the cap. */
const until = (check: Effect.Effect<boolean>): Effect.Effect<void> =>
  Effect.flatMap(check, (ok) =>
    ok ? Effect.void : Effect.zipRight(Effect.sleep("10 millis"), until(check)),
  )

const req = (prompt: string): SessionRequest => ({
  prompt,
  cwd: process.cwd(),
  model: "haiku",
  sessionId: SessionId.make("44444444-4444-4444-8444-444444444444"),
  toolAccess: "read-only",
  permission: "read",
  resumeFrom: undefined,
  inherited: false,
  effort: undefined,
  brief: undefined,
  env: {},
})

const exitsWith = (
  code: number,
  replay: readonly string[],
  placed: Pick<Spawned, "place" | "execId"> = {},
): Layer.Layer<Process> =>
  Layer.succeed(Process, {
    spawn: () =>
      Effect.succeed({
        pid: 4242,
        lines: Stream.fromIterable(replay),
        exited: Effect.succeed({ code, signal: undefined, stderr: "the last turn failed" }),
        send: () => Effect.void,
        endInput: Effect.void,
        ...placed,
      }),
    isAlive: () => Effect.succeed(false),
    kill: () => Effect.void,
    startTime: () => Effect.succeed(undefined),
    killExec: () => Effect.void,
  } satisfies ProcessShape)

describe("a session whose stdin is held open", () => {
  it("keeps the pipe open past our result while work is outstanding, closes it when the level empties, and carries a per-task stop meanwhile", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const lines = yield* Queue.unbounded<string>()
        const ends = yield* Ref.make(0)
        const sent = yield* Ref.make<readonly string[]>([])
        const exitCode = yield* Deferred.make<number>()
        const proc: ProcessShape = {
          spawn: (spec) =>
            Effect.succeed({
              pid: 4242,
              lines: Stream.fromQueue(lines).pipe(Stream.takeWhile((l) => l !== CLOSE)),
              exited: Effect.map(Deferred.await(exitCode), (code) => ({
                code,
                signal: undefined,
                stderr: "",
              })),
              send: (line: string) =>
                spec.holdStdin
                  ? Ref.update(sent, (s) => [...s, line])
                  : Effect.die("send on a closed pipe"),
              endInput: Ref.update(ends, (n) => n + 1),
            }),
          isAlive: () => Effect.succeed(false),
          kill: () => Effect.void,
          startTime: () => Effect.succeed(undefined),
          killExec: () => Effect.void,
        }
        const provider = yield* makeCliProvider(claudeSpec).pipe(
          Effect.provide(Layer.succeed(Process, proc)),
        )
        const request = req("hold it open")

        const turn = yield* Effect.fork(Stream.runCollect(provider.run(request)))
        // The task registers, then our answer arrives with it still outstanding.
        yield* Queue.offer(lines, LEVEL_ONE)
        yield* Queue.offer(lines, OUR_RESULT)

        // The stop control rides the same pipe and spends nothing. Polled, because
        // the pipe registers on the forked fiber's own schedule.
        yield* until(provider.stopBackgroundTask(request.sessionId, "task-1"))
        expect(yield* Ref.get(sent)).toContain(claudeStopTaskLine("task-1", "ork-1"))

        // Our result is in and the task is still on the level: the pipe must stay open.
        expect(yield* Ref.get(ends)).toBe(0)

        // The level goes quiet, and only then does the harness end input.
        yield* Queue.offer(lines, LEVEL_EMPTY)
        yield* until(Ref.get(ends).pipe(Effect.map((n) => n > 0)))

        yield* Queue.offer(lines, CLOSE)
        yield* Deferred.succeed(exitCode, 0)
        yield* Fiber.join(turn)

        // The turn is over, so its pipe is gone and a stop has nowhere to go.
        expect(yield* provider.stopBackgroundTask(request.sessionId, "task-1")).toBe(false)
      }),
    )
  }, 15_000)

  const outcome = (
    code: number,
    replay: readonly string[],
    placed: Pick<Spawned, "place" | "execId"> = {},
  ): Promise<readonly Either.Either<ProviderEvent, ProviderFailed | ElicitFailed>[]> =>
    Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* Provider
        return [...(yield* Stream.runCollect(Stream.either(provider.run(req("exit codes")))))]
      }).pipe(
        Effect.provide(
          cliProviderLayer(claudeSpec).pipe(Layer.provide(exitsWith(code, replay, placed))),
        ),
      ),
    )

  const spawnedOf = async (placed: Pick<Spawned, "place" | "execId">) =>
    (await outcome(0, [OUR_RESULT], placed)).flatMap((e) =>
      e._tag === "Right" && e.right._tag === "Spawned" ? [e.right] : [],
    )

  it("says the turn ran on this machine where the spawn names no place", async () => {
    expect(await spawnedOf({})).toEqual([
      ProviderEvent.Spawned({ pid: 4242, place: Places.local() }),
    ])
  })

  it("carries the sandbox a spawn ran in, with its exec id", async () => {
    const place = Places.remote("a sandbox", "sbx-1", "exec-1")
    expect(await spawnedOf({ place, execId: "exec-1" })).toEqual([
      ProviderEvent.Spawned({ pid: 4242, execId: "exec-1", place }),
    ])
  })

  it("does not fail a turn whose own result frame arrived, whatever the exit code says", async () => {
    // The exit code reports the session's last turn — a self-given turn draining
    // background work can fail after our answer is in hand.
    const collected = await outcome(1, [OUR_RESULT])
    expect(collected.filter((e) => e._tag === "Left")).toEqual([])
  })

  it("still fails a turn the process ended without answering", async () => {
    const failures = (await outcome(1, [])).flatMap((e) => (e._tag === "Left" ? [e.left] : []))
    expect(failures.map((e) => e._tag)).toEqual(["ProviderFailed"])
  })
})

// ============================================================================
// Which result ends the turn
// ============================================================================

/**
 * One turn on a pipe the test feeds a line at a time, keeping what the harness writes
 * down it and counting the closes. `settles` is the caller's envelope test, as `elicit`
 * puts it on the request.
 */
const fedTurn = (settles: (text: string) => boolean) =>
  Effect.gen(function* () {
    const lines = yield* Queue.unbounded<string>()
    const ends = yield* Ref.make(0)
    const sent = yield* Ref.make<readonly string[]>([])
    const proc: ProcessShape = {
      spawn: () =>
        Effect.succeed({
          pid: 4242,
          lines: Stream.fromQueue(lines).pipe(Stream.takeWhile((l) => l !== CLOSE)),
          exited: Effect.succeed({ code: 0, signal: undefined, stderr: "" }),
          send: (line: string) => Ref.update(sent, (s) => [...s, line]),
          endInput: Ref.update(ends, (n) => n + 1),
        }),
      isAlive: () => Effect.succeed(false),
      kill: () => Effect.void,
      startTime: () => Effect.succeed(undefined),
      killExec: () => Effect.void,
    }
    const provider = yield* makeCliProvider(claudeSpec).pipe(
      Effect.provide(Layer.succeed(Process, proc)),
    )
    const turn = yield* Effect.fork(
      Stream.runCollect(Stream.either(provider.run({ ...req("feed it"), settles }))),
    )
    const closed = Ref.get(ends).pipe(Effect.map((n) => n > 0))
    return { lines, closed, sent, turn }
  })

const result = (text: string, more: Readonly<Record<string, unknown>> = {}): string =>
  JSON.stringify({ type: "result", is_error: false, result: text, ...more })
/** A turn Claude gave itself because a background task reported. */
const SELF_GIVEN = { origin: { kind: "task-notification" } }
const ENVELOPE = '```json\n{"type":"artifact"}\n```'
const isEnvelope = (text: string): boolean => text.includes('"type":"artifact"')
const resultsOf = (
  collected: Iterable<Either.Either<ProviderEvent, ProviderFailed>>,
): readonly string[] =>
  [...collected].flatMap((e) =>
    e._tag === "Right" && e.right._tag === "Result" ? [e.right.text] : [],
  )

describe("a turn that ends more than once", () => {
  it("stops the task still on the level when a result holds the envelope, and reads no result after it", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { lines, closed, sent, turn } = yield* fedTurn(isEnvelope)
        yield* Queue.offer(lines, LEVEL_ONE)
        yield* Queue.offer(lines, result(ENVELOPE))
        // The task is stopped by name, not waited for. The pipe stays open until the
        // CLI says it is gone: EOF does not end a running task, and closes the only
        // way to stop one.
        yield* until(Ref.get(sent).pipe(Effect.map((s) => s.length > 0)))
        expect(yield* Ref.get(sent)).toEqual([claudeStopTaskLine("task-1", "ork-1")])
        expect(yield* closed).toBe(false)

        // The level repeats while the task dies, and it is stopped once.
        yield* Queue.offerAll(lines, [LEVEL_ONE, LEVEL_EMPTY])
        yield* until(closed)
        expect(yield* Ref.get(sent)).toHaveLength(1)

        // A turn the CLI gives itself about the task that was stopped. Neither its
        // words nor its failing is the step's.
        yield* Queue.offerAll(lines, [
          result("The task was stopped.", SELF_GIVEN),
          JSON.stringify({ type: "result", is_error: true, result: "API Error: 529" }),
          CLOSE,
        ])
        const collected = yield* Fiber.join(turn)
        expect(resultsOf(collected)).toEqual([ENVELOPE])
        expect([...collected].filter((e) => e._tag === "Left")).toEqual([])
      }),
    )
  }, 15_000)

  it("keeps the pipe open on prose while a task is outstanding, and reads every result after it", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { lines, closed, turn } = yield* fedTurn(isEnvelope)
        yield* Queue.offer(lines, LEVEL_ONE)
        yield* Queue.offer(lines, result("Waiting for verify."))
        yield* Queue.offer(lines, result("Still waiting.", SELF_GIVEN))
        yield* Queue.offer(lines, LEVEL_EMPTY)
        yield* until(closed)

        // The report the task's ending prompts arrives after the level has emptied,
        // and it is the one the step was waiting to write.
        yield* Queue.offerAll(lines, [result(`Verify passed.\n\n${ENVELOPE}`, SELF_GIVEN), CLOSE])
        expect(resultsOf(yield* Fiber.join(turn))).toEqual([
          "Waiting for verify.",
          "Still waiting.",
          `Verify passed.\n\n${ENVELOPE}`,
        ])
      }),
    )
  }, 15_000)
})

describe("the environment a turn is given", () => {
  it("hands the request's variables to the spawn, laid over what the harness inherits", async () => {
    // What `Environment` captured from the project's env script reaches the CLI
    // through this one field; a harness that dropped it would run every agent on
    // the engine's own toolchain with nothing failing.
    const seen = await Effect.runPromise(
      Effect.gen(function* () {
        const spawnedWith = yield* Ref.make<Readonly<Record<string, string>>>({})
        const proc: ProcessShape = {
          spawn: (spec) =>
            Effect.as(Ref.set(spawnedWith, spec.env), {
              pid: 4242,
              lines: Stream.fromIterable([OUR_RESULT]),
              exited: Effect.succeed({ code: 0, signal: undefined, stderr: "" }),
              send: () => Effect.void,
              endInput: Effect.void,
            }),
          isAlive: () => Effect.succeed(false),
          kill: () => Effect.void,
          startTime: () => Effect.succeed(undefined),
          killExec: () => Effect.void,
        }
        const provider = yield* makeCliProvider(claudeSpec).pipe(
          Effect.provide(Layer.succeed(Process, proc)),
        )
        yield* Stream.runDrain(provider.run({ ...req("with env"), env: { RUBY_ROOT: "/r" } }))
        return yield* Ref.get(spawnedWith)
      }),
    )
    // Over the one variable every `claude` spawn carries, which is what makes the CLI
    // tell an MCP server that views are understood.
    expect(seen).toEqual({ CLAUDE_CODE_MCP_APPS_HOST: "1", RUBY_ROOT: "/r" })
  })
})

describe("a message steered into a running turn", () => {
  /**
   * A captured turn replayed through a held pipe: `steer` is written before any line
   * arrives, as a person's message is written while the model works, and the fixture's
   * own echo of it is what reports it heard.
   */
  const steered = (fixtureName: string, text: string) =>
    Effect.gen(function* () {
      const lines = yield* Queue.unbounded<string>()
      const sent = yield* Ref.make<readonly string[]>([])
      const proc: ProcessShape = {
        spawn: () =>
          Effect.succeed({
            pid: 4242,
            lines: Stream.fromQueue(lines).pipe(Stream.takeWhile((l) => l !== CLOSE)),
            exited: Effect.succeed({ code: 0, signal: undefined, stderr: "" }),
            send: (line: string) => Ref.update(sent, (s) => [...s, line]),
            endInput: Effect.void,
          }),
        isAlive: () => Effect.succeed(false),
        kill: () => Effect.void,
        startTime: () => Effect.succeed(undefined),
        killExec: () => Effect.void,
      }
      const provider = yield* makeCliProvider(claudeSpec).pipe(
        Effect.provide(Layer.succeed(Process, proc)),
      )
      const request = req("steer it")
      const turn = yield* Effect.fork(Stream.runCollect(provider.run(request)))
      // Polled, because the pipe registers on the forked fiber's own schedule.
      yield* until(provider.steer(request.sessionId, { key: "m1", text }))
      // The press and the turn's own start both hand over a waiting message; the
      // second is told it went and writes nothing.
      const again = yield* provider.steer(request.sessionId, { key: "m1", text })
      yield* Queue.offerAll(lines, [...fixture(fixtureName), CLOSE])
      const events = [...(yield* Fiber.join(turn))]
      const after = yield* provider.steer(request.sessionId, { key: "m2", text })
      return { events, again, after, sent: yield* Ref.get(sent) }
    })

  it("writes it once as a user line, and reports the delivery the stream echoes under its key", async () => {
    const text = "End your final answer with the word TANGERINE."
    const ran = await Effect.runPromise(steered("steered.captured.jsonl", text))
    expect(ran.again).toBe(true)
    expect(ran.sent).toStrictEqual([claudePromptLine(text)])
    // Two user lines come back as replays — the turn's own prompt first — and only
    // the one the harness steered is a delivery.
    expect(ran.events.filter((e) => e._tag === "MessageDelivered")).toStrictEqual([
      ProviderEvent.MessageDelivered({ text, key: "m1" }),
    ])
    // Read at the tool boundary and obeyed in the same turn: one answer.
    expect(ran.events.filter((e) => e._tag === "Result")).toStrictEqual([
      ProviderEvent.Result({ text: "DONE\n\nTANGERINE" }),
    ])
    // The turn is over, so its pipe is gone and the message stays the caller's.
    expect(ran.after).toBe(false)
  })

  it("keeps the first answer when a late message is answered in a second turn of the process", async () => {
    const text = "What is the capital of France? Answer in one word."
    const { events } = await Effect.runPromise(steered("late-message.captured.jsonl", text))
    // Two `result` lines with no `origin` on either. The first is the step's.
    const results = events.flatMap((e) => (e._tag === "Result" ? [e.text] : []))
    expect(results).toHaveLength(1)
    expect(results[0]).toMatch(/^Rivers/)
    expect(answerOf(events)).toBe(results[0])
    // The reply is on the stream for the conversation, after the answer and after
    // the delivery that asked for it.
    const tags = events.map((e) => e._tag)
    const said = events.flatMap((e) => (e._tag === "TextDelta" ? [e.text] : []))
    expect(said.at(-1)).toBe("Paris")
    expect(tags.indexOf("MessageDelivered")).toBeGreaterThan(tags.indexOf("Result"))
    expect(events.filter((e) => e._tag === "MessageDelivered")).toStrictEqual([
      ProviderEvent.MessageDelivered({ text, key: "m1" }),
    ])
    // Its spend still counts: a `Usage` per result line.
    expect(events.filter((e) => e._tag === "Usage")).toHaveLength(2)
  })
})
