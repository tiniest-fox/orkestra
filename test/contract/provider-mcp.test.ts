// The harness's half of MCP: a request written down a held pipe, paired with the line
// that answers it — on a turn's own pipe, and on a process started with no prompt.
//
// The process is a fake that prints what the test offers it, so every line here is one
// the test wrote: what is under test is the pairing, the pipe staying open for an
// answer still owed, and what a caller is told when there is nothing to ask.

import { describe, expect, it } from "vitest"
import { Deferred, Effect, Either, Fiber, Layer, Queue, Ref, Stream } from "effect"
import { makeCliProvider } from "../../src/agent/adapters/cli-provider.js"
import { McpRequest } from "../../src/agent/types/mcp.js"
import { SessionId, type SessionRequest } from "../../src/agent/types/session.js"
import { Process, type ProcessShape } from "../../src/agent/ports/process.js"
import { claudeSpec } from "../../src/agent/providers/claude/index.js"
import { codexSpec } from "../../src/agent/providers/codex/index.js"

const CLOSE = " close"
const OUR_RESULT = JSON.stringify({ type: "result", is_error: false, result: "done" })

const until = (check: Effect.Effect<boolean>): Effect.Effect<void> =>
  Effect.flatMap(check, (ok) =>
    ok ? Effect.void : Effect.zipRight(Effect.sleep("10 millis"), until(check)),
  )

const req = (model: string): SessionRequest => ({
  prompt: "go",
  cwd: process.cwd(),
  model,
  effort: undefined,
  sessionId: SessionId.make("55555555-5555-4555-8555-555555555555"),
  toolAccess: "read-only",
  permission: "read",
  resumeFrom: undefined,
  inherited: false,
  brief: undefined,
  env: {},
})

/**
 * Ask, and ask again while the answer is *no pipe*: a forked turn registers its pipe on
 * its own schedule, and a request that beat it would be told there is nothing to ask.
 */
const asked = (
  provider: Effect.Effect.Success<ReturnType<typeof makeCliProvider>>,
  sessionId: SessionId,
  request: McpRequest,
): ReturnType<typeof provider.mcp> =>
  Effect.flatMap(provider.mcp(sessionId, request), (answer) =>
    answer === undefined
      ? Effect.zipRight(Effect.sleep("10 millis"), asked(provider, sessionId, request))
      : Effect.succeed(answer),
  )

interface Fake {
  readonly sent: Ref.Ref<readonly string[]>
  readonly ends: Ref.Ref<number>
}

/** Wait until a line holding `needle` has been written to the process. */
const wrote = (fake: Fake, needle: string): Effect.Effect<void> =>
  until(Effect.map(Ref.get(fake.sent), (lines) => lines.some((line) => line.includes(needle))))

/** Wait until the harness has closed the process's input. */
const closed = (fake: Fake): Effect.Effect<void> =>
  until(Effect.map(Ref.get(fake.ends), (n) => n > 0))

/** A process that prints whatever is offered to `lines`, and records what it is sent. */
const fakeProcess = Effect.gen(function* () {
  const lines = yield* Queue.unbounded<string>()
  const sent = yield* Ref.make<readonly string[]>([])
  const ends = yield* Ref.make(0)
  const exited = yield* Deferred.make<number>()
  const spawns = yield* Ref.make<readonly { readonly args: readonly string[] }[]>([])
  const proc: ProcessShape = {
    spawn: (spec) =>
      Effect.as(
        Ref.update(spawns, (all) => [...all, { args: spec.args }]).pipe(
          Effect.zipRight(Ref.update(sent, (s) => [...s, spec.stdin ?? ""])),
        ),
        {
          pid: 4242,
          lines: Stream.fromQueue(lines).pipe(Stream.takeWhile((l) => l !== CLOSE)),
          exited: Effect.map(Deferred.await(exited), (code) => ({
            code,
            signal: undefined,
            stderr: "",
          })),
          send: (line: string) => Ref.update(sent, (s) => [...s, line]),
          endInput: Ref.update(ends, (n) => n + 1),
        },
      ),
    isAlive: () => Effect.succeed(false),
    kill: () => Effect.void,
    startTime: () => Effect.succeed(undefined),
    killExec: () => Effect.void,
  }
  return { lines, sent, ends, exited, layer: Layer.succeed(Process, proc) }
})

const claudeAnswer = (n: number, response: unknown): string =>
  JSON.stringify({
    type: "control_response",
    response: { subtype: "success", request_id: `ork-mcp-${String(n)}`, response },
  })

describe("an MCP request on a turn's pipe", () => {
  it("is answered by the line that names it, and holds the pipe open until then", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeProcess
        const provider = yield* makeCliProvider(claudeSpec).pipe(Effect.provide(fake.layer))
        const request = req("haiku")
        const turn = yield* Effect.fork(Stream.runCollect(provider.run(request)))

        const asking = yield* Effect.fork(
          Effect.either(
            asked(
              provider,
              request.sessionId,
              McpRequest.ReadResource({ server: "scratch", uri: "ui://scratch/a.html" }),
            ),
          ),
        )
        yield* wrote(fake, "mcp_read_resource")
        // Our result arrives with the answer still owed: the pipe must not close.
        yield* Queue.offer(fake.lines, OUR_RESULT)
        yield* Effect.sleep("50 millis")
        expect(yield* Ref.get(fake.ends)).toBe(0)

        yield* Queue.offer(
          fake.lines,
          claudeAnswer(1, {
            contents: [
              {
                uri: "ui://scratch/a.html",
                text: "<p>hi</p>",
                _meta: { ui: { csp: { connectDomains: ["https://api.example.com"] } } },
              },
            ],
          }),
        )
        const answer = yield* Fiber.join(asking)
        expect(Either.getOrThrow(answer)).toEqual({
          _tag: "Resource",
          resource: {
            text: "<p>hi</p>",
            policy: {
              connect: ["https://api.example.com"],
              resource: [],
              frame: [],
              baseUri: [],
            },
          },
        })
        // Nothing is owed any more, so the pipe closes.
        yield* closed(fake)

        yield* Queue.offer(fake.lines, CLOSE)
        yield* Deferred.succeed(fake.exited, 0)
        const events = yield* Fiber.join(turn)
        // The answer is a line of the stream and earns no event on it.
        expect([...events].map((e) => e._tag)).toEqual(["Spawned", "Result"])
        // The turn is over: no pipe, which is an absence and not a failure.
        expect(yield* provider.mcp(request.sessionId, McpRequest.ListTools())).toBeUndefined()
      }),
    )
  }, 15_000)

  it("fails a request the CLI refuses, and one still waiting when the pipe goes", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeProcess
        const provider = yield* makeCliProvider(claudeSpec).pipe(Effect.provide(fake.layer))
        const request = req("haiku")
        const turn = yield* Effect.fork(Stream.runCollect(provider.run(request)))
        const ask = Effect.fork(
          Effect.either(asked(provider, request.sessionId, McpRequest.ListTools())),
        )
        const written = (n: number) => wrote(fake, `ork-mcp-${String(n)}`)

        const refused = yield* ask
        yield* written(1)
        yield* Queue.offer(
          fake.lines,
          JSON.stringify({
            type: "control_response",
            response: { subtype: "error", request_id: "ork-mcp-1", error: "no such server" },
          }),
        )
        expect(yield* Fiber.join(refused)).toEqual(
          Either.left(expect.objectContaining({ _tag: "McpFailed", reason: "no such server" })),
        )

        const stranded = yield* ask
        yield* written(2)
        yield* Queue.offer(fake.lines, CLOSE)
        yield* Deferred.succeed(fake.exited, 1)
        yield* Fiber.join(turn).pipe(Effect.either)
        expect(Either.isLeft(yield* Fiber.join(stranded))).toBe(true)
      }),
    )
  }, 15_000)
})

describe("an MCP request given up on after the turn's result", () => {
  it("closes the pipe it was holding open, with no answer and no further line", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeProcess
        const provider = yield* makeCliProvider(claudeSpec).pipe(Effect.provide(fake.layer))
        const request = req("haiku")
        const turn = yield* Effect.fork(Stream.runCollect(provider.run(request)))
        const asking = yield* Effect.fork(
          asked(provider, request.sessionId, McpRequest.ListTools()),
        )
        yield* wrote(fake, "ork-mcp-1")

        // The result lands with the request still waiting, so the pipe stays open.
        yield* Queue.offer(fake.lines, OUR_RESULT)
        yield* Effect.sleep("50 millis")
        expect(yield* Ref.get(fake.ends)).toBe(0)

        // Whoever asked goes away — a dropped press, which is also the route a wait
        // that ran out takes. Nothing is printed after it: the close cannot wait for
        // a line, because the CLI prints none until its input ends.
        yield* Fiber.interrupt(asking)
        yield* closed(fake)

        yield* Queue.offer(fake.lines, CLOSE)
        yield* Deferred.succeed(fake.exited, 0)
        expect([...(yield* Fiber.join(turn))].map((e) => e._tag)).toEqual(["Spawned", "Result"])
      }),
    )
  }, 15_000)
})

describe("a CLI started with no prompt", () => {
  it("opens claude with one control request and no user message, and answers a tool call", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* fakeProcess
          const provider = yield* makeCliProvider(claudeSpec).pipe(Effect.provide(fake.layer))
          const request = req("haiku")
          const attending = yield* Effect.fork(provider.attend(request))
          yield* wrote(fake, "")
          yield* Queue.offer(
            fake.lines,
            JSON.stringify({
              type: "control_response",
              response: { subtype: "success", request_id: "ork-attend", response: {} },
            }),
          )
          yield* Fiber.join(attending)
          const opening = yield* Ref.get(fake.sent)
          expect(opening).toHaveLength(1)
          expect(opening[0]).toContain('"subtype":"initialize"')
          expect(opening.join("\n")).not.toContain('"type":"user"')

          const calling = yield* Effect.fork(
            provider.mcp(
              request.sessionId,
              McpRequest.CallTool({
                server: "scratch",
                tool: "press",
                callName: "mcp__scratch__press",
                arguments: { by: 1 },
              }),
            ),
          )
          yield* wrote(fake, "mcp_call")
          expect((yield* Ref.get(fake.sent)).at(-1)).toContain('"tool":"mcp__scratch__press"')
          // The string `content` claude hands back, which the reader wraps as a block.
          yield* Queue.offer(
            fake.lines,
            claudeAnswer(1, { content: '{"count":1}', structuredContent: { count: 1 } }),
          )
          expect(yield* Fiber.join(calling)).toEqual({
            _tag: "Result",
            result: {
              content: [{ type: "text", text: '{"count":1}' }],
              structured: { count: 1 },
              isError: false,
            },
          })
        }),
      ),
    )
  }, 15_000)
})

describe("codex started with no prompt", () => {
  it("opens with a handshake and a thread, starts no turn, and names the thread on a call", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* fakeProcess
          const provider = yield* makeCliProvider(codexSpec).pipe(Effect.provide(fake.layer))
          const request = req("gpt")
          const attending = yield* Effect.fork(provider.attend(request))
          yield* wrote(fake, "")
          yield* Queue.offer(fake.lines, JSON.stringify({ id: 1, result: {} }))
          yield* wrote(fake, "thread/start")
          yield* Queue.offer(
            fake.lines,
            JSON.stringify({ id: 2, result: { thread: { id: "th-1" } } }),
          )
          yield* Fiber.join(attending)
          expect((yield* Ref.get(fake.sent)).join("\n")).not.toContain("turn/start")

          const calling = yield* Effect.fork(
            provider.mcp(
              request.sessionId,
              McpRequest.CallTool({
                server: "scratch",
                tool: "press",
                callName: "press",
                arguments: {},
              }),
            ),
          )
          yield* wrote(fake, "mcpServer/tool/call")
          const line: unknown = JSON.parse((yield* Ref.get(fake.sent)).at(-1) ?? "{}")
          expect(line).toMatchObject({
            id: 1_000_001,
            params: { server: "scratch", threadId: "th-1", tool: "press" },
          })
          yield* Queue.offer(
            fake.lines,
            JSON.stringify({
              id: 1_000_001,
              result: { content: [{ type: "text", text: "count is 1" }] },
            }),
          )
          expect(yield* Fiber.join(calling)).toEqual({
            _tag: "Result",
            result: { content: [{ type: "text", text: "count is 1" }], isError: false },
          })
        }),
      ),
    )
  }, 15_000)
})

describe("a start that never becomes ready", () => {
  it("fails where the process exits first", async () => {
    const outcome = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* fakeProcess
          const provider = yield* makeCliProvider(claudeSpec).pipe(Effect.provide(fake.layer))
          const attending = yield* Effect.fork(Effect.either(provider.attend(req("haiku"))))
          yield* Queue.offer(fake.lines, CLOSE)
          return yield* Fiber.join(attending)
        }),
      ),
    )
    expect(Either.isLeft(outcome)).toBe(true)
  }, 15_000)
})
