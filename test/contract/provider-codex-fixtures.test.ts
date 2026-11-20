// The contract, run against the REAL codex spec — its argv, its dialogue, its
// normalizer and the shared `cli-provider` harness — with only the subprocess
// replaced. The stand-in replays `test/fixtures/codex/*.jsonl`: the captured runs,
// plus two written by hand for the shapes the contract asks for and no run produced.
//
// Beside the contract, this file pins what the second CLI tests in the harness: the
// registry selecting an adapter by the model's qualifier, the dialogue driven down a
// held pipe that closes once the answer is in, the brief travelling in the prompt
// body and only when owed, and a re-ask resuming by the id Codex announced rather
// than the one the request carried. And a person's message: steered into the turn by
// the id the turn was requested under, and the pipe held until Codex has answered for it.

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, type Either, Layer, Queue, Ref, Schema, Stream } from "effect"
import { describe, expect, it } from "vitest"
import type { ElicitFailed, ProviderFailed } from "../../src/agent/types/errors.js"
import { elicit } from "../../src/agent/interactions/elicit.js"
import { Process, type ProcessShape } from "../../src/agent/ports/process.js"
import { Provider } from "../../src/agent/ports/provider.js"
import type { ProviderEvent } from "../../src/agent/types/provider-event.js"
import { SessionId, type SessionRequest } from "../../src/agent/types/session.js"
import { Transcript } from "../../src/agent/ports/transcript.js"
import { cliProviderLayer } from "../../src/agent/adapters/cli-provider.js"
import { claudeSpec } from "../../src/agent/providers/claude/index.js"
import { codexSpec } from "../../src/agent/providers/codex/index.js"
import { BuiltinPromptsLayer } from "../../src/prompts/adapters/builtin.js"
import { TEMPLATES } from "../../src/app/packaged.js"
import { StepOutput } from "../../src/workflow/domain/outputs/step-output.js"
import { providerContract } from "./provider.js"

const fixture = (name: string): readonly string[] =>
  readFileSync(new URL(`../fixtures/codex/${name}`, import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")

const MODEL = "codex/gpt-5.6-sol"
const ARTIFACT_PROMPT = "produce an artifact"
const IN_BAND_FAILURE_PROMPT = "produce an artifact, but the usage limit is reached"

/** What one stand-in process was spawned with, and every line the harness wrote down its pipe. */
interface Served {
  readonly command: string
  readonly args: readonly string[]
  readonly stdin: string | undefined
  readonly held: boolean
  readonly sent: readonly string[]
  readonly closed: boolean
}

/** One request the harness wrote, as far as these tests read it. */
const Request = Schema.Struct({
  method: Schema.String,
  params: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})
const requestIn = Schema.decodeUnknownSync(Schema.parseJson(Request))

const TurnInput = Schema.Struct({
  input: Schema.Tuple(Schema.Struct({ text: Schema.String })),
})

/** The prompt a turn was started with, read off the `turn/start` among the lines written. */
const promptIn = (sent: readonly string[]): string | undefined =>
  sent
    .map((line) => requestIn(line))
    .filter((request) => request.method === "turn/start")
    .map((request) => Schema.decodeUnknownSync(TurnInput)(request.params).input[0].text)[0]

/** A fixture cut after the thread request's answer — the last line the turn's own request waits on. */
const cutAtThread = (lines: readonly string[]): readonly [readonly string[], readonly string[]] => {
  const at = lines.findIndex((line) => line.startsWith('{"id":2,'))
  return [lines.slice(0, at + 1), lines.slice(at + 1)]
}

/**
 * A stand-in `codex app-server`. It prints `opening` — a fixture up to the thread
 * request's answer — and then whatever `rest` returns for the prompt the harness
 * started the turn with, which is `undefined` where it started none. The second half
 * is chosen only once the first has been read, because the prompt travels in the
 * harness's reply to it; that is the whole of how this differs from replaying a file.
 *
 * It **exits 0** unless told otherwise, as the Claude stand-in does: the non-zero
 * exit check is the only other mechanism that fails a turn, so a clean exit is what
 * proves the in-band path stands on its own.
 */
const serving = (
  log: Ref.Ref<readonly Served[]>,
  opening: readonly string[],
  rest: (prompt: string | undefined) => readonly string[],
  exit: { readonly code: number; readonly stderr: string } = { code: 0, stderr: "" },
): ProcessShape => ({
  spawn: (spec) =>
    Effect.gen(function* () {
      const at = (yield* Ref.get(log)).length
      const mine = (change: (served: Served) => Served) =>
        Ref.update(log, (all) => all.map((served, i) => (i === at ? change(served) : served)))
      yield* Ref.update(log, (all) => [
        ...all,
        {
          command: spec.command,
          args: spec.args,
          stdin: spec.stdin,
          held: spec.holdStdin,
          sent: [],
          closed: false,
        },
      ])
      const sent = Effect.map(Ref.get(log), (all) => all[at]?.sent ?? [])
      return {
        pid: 4243,
        lines: Stream.concat(
          Stream.fromIterable(opening),
          Stream.unwrap(Effect.map(sent, (lines) => Stream.fromIterable(rest(promptIn(lines))))),
        ),
        exited: Effect.succeed({ code: exit.code, signal: undefined, stderr: exit.stderr }),
        send: (line) => mine((served) => ({ ...served, sent: [...served.sent, line] })),
        endInput: mine((served) => ({ ...served, closed: true })),
      }
    }),
  isAlive: () => Effect.succeed(false),
  kill: () => Effect.void,
  startTime: () => Effect.succeed(undefined),
  killExec: () => Effect.void,
})

/** One fixture, start to finish, whatever the prompt. */
const replaying = (
  log: Ref.Ref<readonly Served[]>,
  lines: readonly string[],
  exit?: { readonly code: number; readonly stderr: string },
): ProcessShape => {
  const [opening, rest] = cutAtThread(lines)
  return serving(log, opening, () => rest, exit)
}

/**
 * The contract's two prompts each pick a fixture. The two open identically — the
 * same handshake and the same thread — which is what lets the stand-in print the
 * opening before it knows which prompt is coming.
 */
const byPrompt = (prompt: string | undefined): readonly string[] => {
  if (prompt?.includes(IN_BAND_FAILURE_PROMPT) === true) {
    return cutAtThread(fixture("rate-limited.synthetic.jsonl"))[1]
  }
  if (prompt?.includes(ARTIFACT_PROMPT) === true) {
    return cutAtThread(fixture("artifact-reply.synthetic.jsonl"))[1]
  }
  // Loud rather than empty: an unmatched prompt means the contract grew a case
  // this file has no fixture for.
  throw new Error(`no codex fixture for prompt: ${prompt ?? "(no turn was started)"}`)
}

const FixtureProcess: Layer.Layer<Process> = Layer.effect(
  Process,
  Effect.map(Ref.make<readonly Served[]>([]), (log) =>
    serving(log, cutAtThread(fixture("artifact-reply.synthetic.jsonl"))[0], byPrompt),
  ),
)

providerContract({
  label: "codex (fixture-replayed)",
  layer: cliProviderLayer(codexSpec).pipe(Layer.provide(FixtureProcess)),
  model: MODEL,
  artifactPrompt: ARTIFACT_PROMPT,
  timeoutMs: 1000,
  // A `reasoning` item carries a summary only with `model_reasoning_summary` set, which
  // `codexDialogue` does; the artifact fixture carries one in the shape the runs produced.
  reportsThinking: true,
  inBandFailure: {
    prompt: IN_BAND_FAILURE_PROMPT,
    // Verbatim from the fixture's message: the whole thing reaches
    // `ProviderFailed.reason`, so a person reads Codex's own words.
    reasonIncludes: "You've hit your usage limit",
    // Read off `codexErrorInfo` beside the message — see `codexApiErrorKind`.
    errorKind: "rate_limit",
  },
})

// ============================================================================
// The registry: which CLI a model name selects
// ============================================================================

const req = (over: Partial<SessionRequest> = {}): SessionRequest => ({
  prompt: ARTIFACT_PROMPT,
  cwd: process.cwd(),
  model: MODEL,
  sessionId: SessionId.make("55555555-5555-4555-8555-555555555555"),
  toolAccess: "write",
  permission: "full",
  resumeFrom: undefined,
  inherited: false,
  effort: undefined,
  brief: undefined,
  env: {},
  ...over,
})

const outcome = (
  request: SessionRequest,
): Promise<{
  readonly collected: readonly Either.Either<ProviderEvent, ProviderFailed>[]
  readonly spawns: readonly Served[]
}> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const log = yield* Ref.make<readonly Served[]>([])
      const process = replaying(log, fixture("artifact-reply.synthetic.jsonl"))
      const collected = yield* Effect.gen(function* () {
        const provider = yield* Provider
        return [...(yield* Stream.runCollect(Stream.either(provider.run(request))))]
      }).pipe(
        Effect.provide(
          cliProviderLayer(claudeSpec, codexSpec).pipe(
            Layer.provide(Layer.succeed(Process, process)),
          ),
        ),
      )
      return { collected, spawns: yield* Ref.get(log) }
    }),
  )

/** The request of one method among the lines a spawn was sent, parsed. */
const requestOf = (
  served: Served | undefined,
  method: string,
): Schema.Schema.Type<typeof Request> | undefined =>
  (served?.sent ?? []).map((line) => requestIn(line)).find((request) => request.method === method)

describe("the registry, given both specs with Claude first", () => {
  it("runs a codex-qualified model on codex, handing it the bare name", async () => {
    const { spawns } = await outcome(req())
    expect(spawns.map((s) => s.command)).toEqual(["codex"])
    expect(requestOf(spawns[0], "thread/start")?.params?.["model"]).toBe("gpt-5.6-sol")
    expect(spawns[0]?.sent.join("\n")).not.toContain("codex/")
  })

  it("runs a bare model name on the first adapter registered", async () => {
    const { spawns } = await outcome(req({ model: "haiku" }))
    expect(spawns.map((s) => s.command)).toEqual(["claude"])
  })

  it("fails a turn whose qualifier names no adapter, and spawns nothing", async () => {
    const { collected, spawns } = await outcome(req({ model: "opencode/big" }))
    expect(spawns).toEqual([])
    const failures = collected.flatMap((e) => (e._tag === "Left" ? [e.left] : []))
    expect(failures).toHaveLength(1)
    expect(failures[0]?.provider).toBe("opencode")
    expect(failures[0]?.reason).toContain("claude, codex")
  })

  it("reports the announced session, not the one the request carried", async () => {
    const { collected } = await outcome(req())
    const events = collected.flatMap((e) => (e._tag === "Right" ? [e.right] : []))
    expect(events).toContainEqual({
      _tag: "SessionStarted",
      id: "01a0afb0-0000-7000-8000-000000000001",
    })
  })
})

// ============================================================================
// The dialogue, down a pipe the harness holds and then closes
// ============================================================================

describe("a codex turn's pipe", () => {
  it("opens with initialize on a held pipe, and carries no prompt on the command line", async () => {
    const { spawns } = await outcome(req())
    expect(spawns[0]?.args).toEqual(["app-server"])
    expect(spawns[0]?.held).toBe(true)
    expect(spawns[0]?.stdin).toContain('"method":"initialize"')
    expect(spawns[0]?.stdin).not.toContain(ARTIFACT_PROMPT)
  })

  it("writes each request as the answer to the one before arrives", async () => {
    const { spawns } = await outcome(req())
    expect(spawns[0]?.sent.map((line) => requestIn(line).method)).toEqual([
      "initialized",
      "thread/start",
      "turn/start",
    ])
  })

  it("closes the pipe once the answer is in, which is what ends a server that never exits on its own", async () => {
    const { spawns } = await outcome(req())
    expect(spawns[0]?.closed).toBe(true)
  })

  it("fails the turn on a thread Codex will not open, and starts no turn on it", async () => {
    const { collected, sent } = await Effect.runPromise(
      Effect.gen(function* () {
        const log = yield* Ref.make<readonly Served[]>([])
        const events = yield* Effect.gen(function* () {
          const provider = yield* Provider
          const resumed = req({
            resumeFrom: SessionId.make("01a12cbb-0000-7000-8000-000000000000"),
          })
          return [...(yield* Stream.runCollect(Stream.either(provider.run(resumed))))]
        }).pipe(
          Effect.provide(
            cliProviderLayer(codexSpec).pipe(
              Layer.provide(
                Layer.succeed(Process, replaying(log, fixture("resume-miss.captured.jsonl"))),
              ),
            ),
          ),
        )
        return { collected: events, sent: (yield* Ref.get(log))[0]?.sent ?? [] }
      }),
    )
    const failures = collected.flatMap((e) => (e._tag === "Left" ? [e.left] : []))
    expect(failures.map((e) => e.reason)).toEqual([
      "no rollout found for thread id 01a12cbb-0000-7000-8000-000000000000",
    ])
    expect(sent.join("\n")).toContain('"method":"thread/resume"')
    expect(sent.join("\n")).not.toContain('"method":"turn/start"')
  })
})

// ============================================================================
// The brief in the prompt body, and only when owed
// ============================================================================

describe("the standing brief under codex", () => {
  const brief = { core: "CORE OF THE BRIEF", contract: "CONTRACT OF THE BRIEF" }
  const promptArg = async (request: SessionRequest): Promise<string> =>
    promptIn((await outcome(request)).spawns[0]?.sent ?? []) ?? ""

  it("opens a conversation with both halves ahead of the prompt", async () => {
    const arg = await promptArg(req({ brief }))
    expect(arg.indexOf("CORE OF THE BRIEF")).toBeLessThan(arg.indexOf("CONTRACT OF THE BRIEF"))
    expect(arg.indexOf("CONTRACT OF THE BRIEF")).toBeLessThan(arg.indexOf(ARTIFACT_PROMPT))
  })

  it("re-sends nothing on a resume of the conversation's own", async () => {
    const arg = await promptArg(
      req({ brief, resumeFrom: SessionId.make("01a0afa1-c237-7380-9bad-2c0a466452f2") }),
    )
    expect(arg).not.toContain("CORE OF THE BRIEF")
    expect(arg).not.toContain("CONTRACT OF THE BRIEF")
    expect(arg).toContain(ARTIFACT_PROMPT)
  })

  it("re-sends the contract alone when a turn takes over another position's conversation", async () => {
    const arg = await promptArg(
      req({
        brief,
        resumeFrom: SessionId.make("01a0afa1-c237-7380-9bad-2c0a466452f2"),
        inherited: true,
        effort: undefined,
      }),
    )
    expect(arg).not.toContain("CORE OF THE BRIEF")
    expect(arg.indexOf("CONTRACT OF THE BRIEF")).toBeLessThan(arg.indexOf(ARTIFACT_PROMPT))
  })

  it("states a read-only turn's restriction in the body, naming the editing tool", async () => {
    const arg = await promptArg(req({ toolAccess: "read-only" }))
    expect(arg).toContain("## Tools you must not use")
    expect(arg).toContain("- apply_patch")
  })
})

// ============================================================================
// A re-ask resumes by the id Codex announced
// ============================================================================

describe("a re-ask under codex", () => {
  it("resumes the announced thread, which the request's minted id never named", async () => {
    // The first spawn answers in prose only, so `elicit` asks again; the second must
    // be a `thread/resume` of the thread the first announced, with the minted id
    // nowhere in anything written to either.
    const spawns = await Effect.runPromise(
      Effect.gen(function* () {
        const log = yield* Ref.make<readonly Served[]>([])
        const prose = replaying(log, fixture("launch-shell-call.captured.jsonl"))
        const artifact = replaying(log, fixture("artifact-reply.synthetic.jsonl"))
        const process: ProcessShape = {
          ...prose,
          spawn: (spec) =>
            Effect.flatMap(Ref.get(log), (all) =>
              (all.length === 0 ? prose : artifact).spawn(spec),
            ),
        }
        yield* elicit(StepOutput, req()).pipe(
          Effect.provide(
            Layer.mergeAll(
              cliProviderLayer(codexSpec).pipe(Layer.provide(Layer.succeed(Process, process))),
              Layer.succeed(Transcript, { record: () => Effect.void }),
              BuiltinPromptsLayer(TEMPLATES),
            ),
          ),
        )
        return yield* Ref.get(log)
      }),
    )
    expect(spawns).toHaveLength(2)
    expect(requestOf(spawns[0], "thread/start")).toBeDefined()
    expect(requestOf(spawns[1], "thread/resume")?.params?.["threadId"]).toBe(
      "01a12cbb-f6f2-7870-80d4-38be064756ea",
    )
    expect(spawns.flatMap((s) => s.sent).join("\n")).not.toContain(
      "55555555-5555-4555-8555-555555555555",
    )
  })
})

// ============================================================================
// Exit codes: evidence only where no answer arrived
// ============================================================================

describe("a codex process's exit code", () => {
  const exiting = (
    code: number,
    replay: readonly string[],
  ): Promise<readonly Either.Either<ProviderEvent, ProviderFailed | ElicitFailed>[]> =>
    Effect.runPromise(
      Effect.gen(function* () {
        const log = yield* Ref.make<readonly Served[]>([])
        return yield* Effect.gen(function* () {
          const provider = yield* Provider
          return [...(yield* Stream.runCollect(Stream.either(provider.run(req()))))]
        }).pipe(
          Effect.provide(
            cliProviderLayer(codexSpec).pipe(
              Layer.provide(
                Layer.succeed(Process, replaying(log, replay, { code, stderr: "killed" })),
              ),
            ),
          ),
        )
      }),
    )

  it("fails a turn the stream cut off before any answer — an interrupt, or a crash", async () => {
    const failures = (await exiting(137, fixture("sigkill.captured.jsonl"))).flatMap((e) =>
      e._tag === "Left" ? [e.left] : [],
    )
    expect(failures.map((e) => e._tag)).toEqual(["ProviderFailed"])
    expect(failures[0]?.reason).toContain("exit 137")
  })

  it("does not fail a turn that answered, whatever a command inside it exited", async () => {
    // A failed `ls` inside the turn, and the answer in hand all the same.
    const collected = await exiting(0, fixture("file-change.captured.jsonl"))
    expect(collected.filter((e) => e._tag === "Left")).toEqual([])
  })
})

// ============================================================================
// The session log beside the stream, read after the exit
// ============================================================================

describe("the rollout under CODEX_HOME", () => {
  // The thread `outcome` announces (`artifact-reply.synthetic.jsonl`'s), and the
  // rollout Codex kept for a launch with one shell call, filed where Codex files one:
  // `sessions/<y>/<m>/<d>/rollout-<started>-<thread>.jsonl`. The file is named for the
  // stdout fixture's thread so the two join; its contents are the captured rollout.
  const THREAD = "01a0afb0-0000-7000-8000-000000000001"
  const homeWith = (fileName: string | undefined): string => {
    const home = mkdtempSync(join(tmpdir(), "codex-home-"))
    const day = join(home, "sessions", "2026", "09", "17")
    mkdirSync(day, { recursive: true })
    if (fileName !== undefined) {
      writeFileSync(
        join(day, fileName),
        fixture("rollout-launch-shell-call.captured.jsonl").join("\n"),
      )
    }
    return home
  }

  const eventsUnder = async (home: string): Promise<readonly ProviderEvent[]> => {
    const { collected } = await outcome(req({ env: { CODEX_HOME: home } }))
    expect(collected.filter((e) => e._tag === "Left")).toEqual([])
    return collected.flatMap((e) => (e._tag === "Right" ? [e.right] : []))
  }

  it("reads the per-call reading and the window off the announced thread's file, after the answer", async () => {
    const name = `rollout-2026-09-17T09-53-53-${THREAD}.jsonl`
    const home = homeWith(name)
    const events = await eventsUnder(home)
    const tags = events.map((e) => e._tag)
    expect(tags.slice(tags.indexOf("Result"))).toEqual([
      "Result",
      "ContextWindow",
      "Occupancy",
      "ContextWindow",
      "Occupancy",
      "SessionLogRead",
    ])
    expect(events).toContainEqual({ _tag: "ContextWindow", model: undefined, tokens: 258_400 })
    // The file it read, named for the backup's list of this project's rollouts.
    expect(events.at(-1)).toEqual({
      _tag: "SessionLogRead",
      path: join(home, "sessions", "2026", "09", "17", name),
    })
  })

  it("reads nothing, and fails nothing, where the thread has no file", async () => {
    const tags = (
      await eventsUnder(homeWith(`rollout-2026-09-17T09-53-53-someone-else.jsonl`))
    ).map((e) => e._tag)
    expect(tags).not.toContain("Occupancy")
    expect(tags).not.toContain("SessionLogRead")
    expect(tags).toContain("Result")
  })

  it("reads nothing, and fails nothing, where the home has no sessions at all", async () => {
    const tags = (await eventsUnder(join(tmpdir(), "no-such-codex-home"))).map((e) => e._tag)
    expect(tags).not.toContain("Occupancy")
    expect(tags).toContain("Result")
  })
})

// ============================================================================
// A person's message, down the same pipe
// ============================================================================

const Asked = Schema.Struct({
  method: Schema.String,
  id: Schema.optional(Schema.Number),
  params: Schema.optional(
    Schema.Struct({
      clientUserMessageId: Schema.optional(Schema.String),
      input: Schema.optional(Schema.Array(Schema.Struct({ text: Schema.String }))),
    }),
  ),
})
type Asked = Schema.Schema.Type<typeof Asked>
const askedIn = Schema.decodeUnknownSync(Schema.parseJson(Asked))

const SERVED_THREAD = "01a12d57-0000-7000-8000-000000000001"

/** The lines a stand-in server prints for one turn of its thread, in the captured runs' shapes. */
const said = {
  answer: (id: number | undefined, result: unknown): string => JSON.stringify({ id, result }),
  refusal: (id: number | undefined, message: string): string =>
    JSON.stringify({ id, error: { code: -32_600, message } }),
  heard: (turn: string, asked: Asked): string =>
    JSON.stringify({
      method: "item/started",
      params: {
        threadId: SERVED_THREAD,
        turnId: turn,
        item: {
          type: "userMessage",
          id: "item-heard",
          clientId: asked.params?.clientUserMessageId,
          content: asked.params?.input,
        },
      },
    }),
  message: (turn: string, text: string): string =>
    JSON.stringify({
      method: "item/completed",
      params: {
        threadId: SERVED_THREAD,
        turnId: turn,
        item: { type: "agentMessage", id: `m-${turn}`, text },
      },
    }),
  ended: (turn: string): string =>
    JSON.stringify({
      method: "turn/completed",
      params: { threadId: SERVED_THREAD, turn: { id: turn, status: "completed" } },
    }),
}

/**
 * A stand-in `codex app-server` that answers what it is asked, where the fixtures only
 * replay: `serve` returns the lines one request earns. It prints nothing unasked and
 * ends only when its pipe closes, as the server does — so a turn that completes here
 * is one whose pipe the harness closed, and what it wrote before that is in `log`.
 */
const answering = (
  log: Ref.Ref<readonly string[]>,
  serve: (asked: Asked) => readonly string[],
): ProcessShape => ({
  spawn: (spec) =>
    Effect.gen(function* () {
      const printed = yield* Queue.unbounded<string>()
      const take = (line: string) =>
        Effect.gen(function* () {
          const asked = askedIn(line)
          yield* Ref.update(log, (all) => [...all, asked.method])
          yield* Queue.offerAll(printed, serve(asked))
        })
      yield* take(spec.stdin ?? "")
      return {
        pid: 4244,
        lines: Stream.fromQueue(printed),
        exited: Effect.succeed({ code: 0, signal: undefined, stderr: "" }),
        send: take,
        endInput: Effect.zipRight(
          Ref.update(log, (all) => [...all, "(closed)"]),
          Queue.shutdown(printed),
        ),
      }
    }),
  isAlive: () => Effect.succeed(false),
  kill: () => Effect.void,
  startTime: () => Effect.succeed(undefined),
  killExec: () => Effect.void,
})

/** The three opening requests, answered; `undefined` for anything after them. */
const opened = (asked: Asked): readonly string[] | undefined => {
  if (asked.method === "initialize") return [said.answer(asked.id, {})]
  if (asked.method === "initialized") return []
  if (asked.method === "thread/start") {
    return [said.answer(asked.id, { thread: { id: SERVED_THREAD } })]
  }
  // The step's turn is named and then says nothing: what ends it is the case's own.
  if (asked.method === "turn/start" && asked.id === 3) {
    return [said.answer(asked.id, { turn: { id: "turn-1" } })]
  }
  return undefined
}

/**
 * One turn against `serve`, steered once as the session is announced, by the id the
 * request carried. The turn is not named yet at that point, so the dialogue holds it.
 */
const steered = (serve: (asked: Asked) => readonly string[]) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const log = yield* Ref.make<readonly string[]>([])
      const wrote = yield* Ref.make<readonly boolean[]>([])
      const request = req({ env: { CODEX_HOME: join(tmpdir(), "no-such-codex-home") } })
      const collected = yield* Effect.gen(function* () {
        const provider = yield* Provider
        const steerOnce = (e: ProviderEvent): Effect.Effect<void> =>
          e._tag === "SessionStarted"
            ? Effect.flatMap(
                provider.steer(request.sessionId, { key: "key-1", text: "also say QUINCE" }),
                (ok) => Ref.set(wrote, [ok]),
              )
            : Effect.void
        const turn = provider.run(request).pipe(Stream.tap(steerOnce))
        return [...(yield* Stream.runCollect(Stream.either(turn)))]
      }).pipe(
        Effect.provide(
          cliProviderLayer(codexSpec).pipe(
            Layer.provide(Layer.succeed(Process, answering(log, serve))),
          ),
        ),
      )
      return {
        events: collected.flatMap((e) => (e._tag === "Right" ? [e.right] : [])),
        failures: collected.flatMap((e) => (e._tag === "Left" ? [e.left] : [])),
        log: yield* Ref.get(log),
        wrote: yield* Ref.get(wrote),
      }
    }),
  )

/** A server that takes the steer: the model hears it, answers, and the turn ends. */
const taking = (asked: Asked): readonly string[] =>
  opened(asked) ??
  (asked.method === "turn/steer"
    ? [
        said.answer(asked.id, { turnId: "turn-1" }),
        said.heard("turn-1", asked),
        said.message("turn-1", "OK QUINCE"),
        said.ended("turn-1"),
      ]
    : [])

/**
 * A server whose turn ends as the steer arrives: it answers the step, refuses the
 * steer, and then does `then` with the `turn/start` the harness sends in its place.
 */
const tooLate =
  (then: (asked: Asked) => readonly string[]) =>
  (asked: Asked): readonly string[] => {
    const opening = opened(asked)
    if (opening !== undefined) return opening
    if (asked.method === "turn/steer") {
      return [
        said.message("turn-1", "OK"),
        said.ended("turn-1"),
        said.refusal(asked.id, "no active turn to steer"),
      ]
    }
    return asked.method === "turn/start" ? then(asked) : []
  }

const followedOn = (asked: Asked): readonly string[] => [
  said.answer(asked.id, { turn: { id: "turn-2" } }),
  said.heard("turn-2", asked),
  said.message("turn-2", "QUINCE"),
  said.ended("turn-2"),
]

describe("a message steered into a codex turn", () => {
  it("is written as turn/steer once the turn is named, and reported under its key before the answer", async () => {
    const { events, failures, log, wrote } = await steered(taking)
    expect(failures).toEqual([])
    expect(wrote).toEqual([true])
    expect(log).toEqual([
      "initialize",
      "initialized",
      "thread/start",
      "turn/start",
      "turn/steer",
      "(closed)",
    ])
    const tags = events.map((e) => e._tag)
    expect(events).toContainEqual({
      _tag: "MessageDelivered",
      key: "key-1",
      text: "also say QUINCE",
    })
    expect(tags.indexOf("MessageDelivered")).toBeLessThan(tags.indexOf("Result"))
    expect(tags.filter((tag) => tag === "Result")).toHaveLength(1)
  })

  it("finds no pipe under the id Codex announced — the pipe is held by the one requested", async () => {
    // Nothing is steered, so the turn the stand-in is waiting to be steered never
    // ends; the announced id answering `false` is the whole assertion.
    const answers = await Effect.runPromise(
      Effect.gen(function* () {
        const log = yield* Ref.make<readonly string[]>([])
        const provider = yield* Effect.provide(
          Provider,
          cliProviderLayer(codexSpec).pipe(
            Layer.provide(
              Layer.succeed(
                Process,
                answering(log, (asked) => opened(asked) ?? []),
              ),
            ),
          ),
        )
        const request = req()
        return yield* provider.run(request).pipe(
          Stream.filter((e) => e._tag === "SessionStarted"),
          Stream.take(1),
          Stream.mapEffect((e) =>
            Effect.all([
              provider.steer(e.id, { key: "key-1", text: "x" }),
              provider.steer(request.sessionId, { key: "key-1", text: "x" }),
            ]),
          ),
          Stream.runCollect,
        )
      }),
    )
    expect([...answers]).toEqual([[false, true]])
  })

  it("holds the pipe past the answer for a refused steer, and starts the message as a turn of its own", async () => {
    const { events, failures, log } = await steered(tooLate(followedOn))
    expect(failures).toEqual([])
    // The close comes after the second `turn/start`: closed at the first `Result`,
    // the server would have exited with the message it had just refused. Closing is
    // idempotent and re-decided per line, so only the first one is pinned.
    expect(log.slice(4, 7)).toEqual(["turn/steer", "turn/start", "(closed)"])
    // The step keeps its first answer; the reply is drawn and files nothing.
    expect(events.flatMap((e) => (e._tag === "Result" ? [e.text] : []))).toEqual(["OK"])
    expect(events.flatMap((e) => (e._tag === "TextDelta" ? [e.text] : []))).toEqual([
      "OK",
      "QUINCE",
    ])
    const tags = events.map((e) => e._tag)
    expect(tags.indexOf("MessageDelivered")).toBeGreaterThan(tags.indexOf("Result"))
    expect(events).toContainEqual({
      _tag: "MessageDelivered",
      key: "key-1",
      text: "also say QUINCE",
    })
  })

  it("closes the pipe and fails nothing where Codex refuses the follow-on turn too", async () => {
    const { events, failures, log } = await steered(
      tooLate((asked) => [said.refusal(asked.id, "thread is busy")]),
    )
    expect(failures).toEqual([])
    expect(log.at(-1)).toBe("(closed)")
    const tags = events.map((e) => e._tag)
    expect(tags).toContain("Result")
    // Nobody heard it, so it is still waiting as far as the engine is told.
    expect(tags).not.toContain("MessageDelivered")
    expect(tags).not.toContain("ApiError")
  })
})
