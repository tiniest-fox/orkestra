// Where a credential an MCP server carries goes when the harness spawns a CLI: into the
// server's own configuration, and never onto the command line or into the environment
// the CLI — and every command its agent runs — inherits. And where a host user's own
// Claude credential goes: into that spawn's environment alone, with no other beside it.
//
// The process is a fake that records what it was spawned with and, at that moment, the
// configuration file the command line names: the file exists only while the spawn's
// scope does, so it has to be read from inside it.

import { readFileSync, statSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { Deferred, Effect, Exit, Fiber, Layer, Queue, Ref, Stream } from "effect"
import { makeCliProvider } from "../../src/agent/adapters/cli-provider.js"
import { McpServer, SessionId, type SessionRequest } from "../../src/agent/types/session.js"
import { Process, type ProcessShape, type ProcessSpec } from "../../src/agent/ports/process.js"
import type { CliProviderSpec } from "../../src/agent/ports/provider.js"
import { claudeSpec } from "../../src/agent/providers/claude/index.js"
import { codexSpec } from "../../src/agent/providers/codex/index.js"
import { fakeProxy } from "../support/scripted-environment.js"

const CLOSE = " close"
const OUR_RESULT = JSON.stringify({ type: "result", is_error: false, result: "done" })

const KEY = "engine-key-123"
const HOST = "http://127.0.0.1:7000"
const SECRETS = ["lin_secret", "goal-token-456", KEY, HOST]

const SERVERS = {
  linear: fakeProxy({
    connection: "linear-work",
    url: "https://mcp.linear.app/mcp",
    key: KEY,
    host: HOST,
  }),
  remote: McpServer.Http({
    url: "https://x.io/mcp",
    headers: { Authorization: "Bearer lin_secret" },
  }),
  "orkestra-goal": McpServer.Stdio({
    command: "/bin/orkestra",
    args: ["goal-tools"],
    env: { ORK_GOAL_TOKEN: "goal-token-456" },
  }),
}

const req = (model: string, mcpServers?: SessionRequest["mcpServers"]): SessionRequest => ({
  prompt: "go",
  cwd: process.cwd(),
  model,
  effort: undefined,
  sessionId: SessionId.make("66666666-6666-4666-8666-666666666666"),
  toolAccess: "write",
  permission: "read",
  resumeFrom: undefined,
  inherited: false,
  brief: undefined,
  env: {},
  ...(mcpServers === undefined ? {} : { mcpServers }),
})

/** What a spawn was handed, and the configuration file its argv named, as it stood then. */
interface Spawn {
  readonly spec: ProcessSpec
  readonly file: { readonly path: string; readonly mode: number; readonly text: string } | undefined
}

const fileNamedBy = (args: readonly string[]): Spawn["file"] => {
  const at = args.indexOf("--mcp-config")
  const path = at === -1 ? undefined : args[at + 1]
  if (path === undefined) return undefined
  return { path, mode: statSync(path).mode & 0o777, text: readFileSync(path, "utf8") }
}

const fakeProcess = Effect.gen(function* () {
  const lines = yield* Queue.unbounded<string>()
  const exited = yield* Deferred.make<number>()
  const spawns = yield* Ref.make<readonly Spawn[]>([])
  const sent = yield* Ref.make<readonly string[]>([])
  const proc: ProcessShape = {
    spawn: (spec) =>
      Effect.as(
        Ref.update(spawns, (all) => [...all, { spec, file: fileNamedBy(spec.args) }]).pipe(
          Effect.zipRight(Ref.update(sent, (s) => [...s, spec.stdin ?? ""])),
        ),
        {
          pid: 4243,
          lines: Stream.fromQueue(lines).pipe(Stream.takeWhile((l) => l !== CLOSE)),
          exited: Effect.map(Deferred.await(exited), (code) => ({
            code,
            signal: undefined,
            stderr: "",
          })),
          send: (line: string) => Ref.update(sent, (s) => [...s, line]),
          endInput: Effect.void,
        },
      ),
    isAlive: () => Effect.succeed(false),
    kill: () => Effect.void,
    startTime: () => Effect.succeed(undefined),
    killExec: () => Effect.void,
  }
  return { lines, exited, spawns, sent, layer: Layer.succeed(Process, proc) }
})

const until = (check: Effect.Effect<boolean>): Effect.Effect<void> =>
  Effect.flatMap(check, (ok) =>
    ok ? Effect.void : Effect.zipRight(Effect.sleep("10 millis"), until(check)),
  )

/** Start a turn of `spec` and wait for its spawn; the fiber is the turn. */
const started = (spec: CliProviderSpec, request: SessionRequest) =>
  Effect.gen(function* () {
    const fake = yield* fakeProcess
    const provider = yield* makeCliProvider(spec).pipe(Effect.provide(fake.layer))
    const turn = yield* Effect.fork(Stream.runCollect(provider.run(request)))
    yield* until(Effect.map(Ref.get(fake.spawns), (all) => all.length > 0))
    const [spawn] = yield* Ref.get(fake.spawns)
    if (spawn === undefined) throw new Error("no spawn")
    return { fake, turn, spawn }
  })

const exists = (path: string): boolean => {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

describe("a claude spawn handed MCP servers that carry credentials", () => {
  it("names a 0600 file holding them, and puts none on argv or in the CLI's environment", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { fake, turn, spawn } = yield* started(claudeSpec, req("haiku", SERVERS))
        const argv = spawn.spec.args.join(" ")
        const env = JSON.stringify(spawn.spec.env)
        for (const secret of SECRETS) {
          expect(argv).not.toContain(secret)
          expect(env).not.toContain(secret)
        }
        expect(spawn.spec.env).not.toHaveProperty("ORK_MCP_KEY")
        expect(spawn.spec.env).not.toHaveProperty("ORK_MCP_HOST")
        expect(spawn.file?.mode).toBe(0o600)
        const config: unknown = JSON.parse(spawn.file?.text ?? "{}")
        expect(config).toMatchObject({
          mcpServers: {
            linear: { env: { ORK_MCP_KEY: KEY, ORK_MCP_HOST: HOST } },
            remote: { headers: { Authorization: "Bearer lin_secret" } },
            "orkestra-goal": { env: { ORK_GOAL_TOKEN: "goal-token-456" } },
          },
        })

        yield* Queue.offer(fake.lines, OUR_RESULT)
        yield* Queue.offer(fake.lines, CLOSE)
        yield* Deferred.succeed(fake.exited, 0)
        yield* Fiber.join(turn)
        expect(exists(spawn.file?.path ?? "")).toBe(false)
      }),
    )
  }, 15_000)

  it("removes the file when the turn is killed", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { turn, spawn } = yield* started(claudeSpec, req("haiku", SERVERS))
        const path = spawn.file?.path ?? ""
        expect(exists(path)).toBe(true)
        expect(Exit.isInterrupted(yield* Fiber.interrupt(turn))).toBe(true)
        expect(exists(path)).toBe(false)
      }),
    )
  }, 15_000)

  it("writes no file and names none for a session handed no server", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { turn, spawn } = yield* started(claudeSpec, req("haiku"))
        expect(spawn.spec.args).not.toContain("--mcp-config")
        yield* Fiber.interrupt(turn)
      }),
    )
  }, 15_000)
})

describe("a claude spawn handed one user's credential", () => {
  it("carries it alone: laid over the turn's env, the other withheld, and nothing forwarded by name", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const signed: SessionRequest = {
          ...req("haiku"),
          env: { ANTHROPIC_API_KEY: "from-env-sh", RUBY_ROOT: "/opt/ruby" },
          signIn: {
            env: { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-mine" },
            withhold: ["ANTHROPIC_API_KEY"],
          },
        }
        const { turn, spawn } = yield* started(claudeSpec, signed)
        expect(spawn.spec.env).toMatchObject({
          CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-mine",
          RUBY_ROOT: "/opt/ruby",
        })
        expect(spawn.spec.env).not.toHaveProperty("ANTHROPIC_API_KEY")
        expect(spawn.spec.withhold).toEqual(["ANTHROPIC_API_KEY"])
        // A sandbox is handed the explicit env, which already carries the one chosen.
        expect(spawn.spec.credentials).toEqual([])
        expect(spawn.spec.args.join(" ")).not.toContain("sk-ant-oat01-mine")
        yield* Fiber.interrupt(turn)
      }),
    )
  }, 15_000)

  it("forwards the spec's own credential by name where the turn is handed none", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { turn, spawn } = yield* started(claudeSpec, req("haiku"))
        expect(spawn.spec.credentials).toEqual(claudeSpec.credentials)
        expect(spawn.spec.withhold).toBeUndefined()
        yield* Fiber.interrupt(turn)
      }),
    )
  }, 15_000)
})

/** The `thread/start` request among the lines written to codex, which carries its servers. */
const threadStart = (sent: readonly string[]): string | undefined =>
  sent.find((line) => line.includes("thread/start"))

describe("a codex spawn handed MCP servers that carry credentials", () => {
  it("hands them down the pipe to each server's own env, and never to the CLI's environment", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { fake, turn, spawn } = yield* started(codexSpec, req("codex/gpt-5", SERVERS))
        const argvAndEnv = `${spawn.spec.args.join(" ")} ${JSON.stringify(spawn.spec.env)}`
        for (const secret of SECRETS) expect(argvAndEnv).not.toContain(secret)
        expect(spawn.file).toBeUndefined()

        yield* Queue.offer(fake.lines, '{"id":1,"result":{"userAgent":"orkestra/0.154.0"}}')
        yield* until(Effect.map(Ref.get(fake.sent), (all) => threadStart(all) !== undefined))
        const thread: unknown = JSON.parse(threadStart(yield* Ref.get(fake.sent)) ?? "{}")
        expect(thread).toMatchObject({
          params: {
            config: { "mcp_servers.linear": { env: { ORK_MCP_KEY: KEY, ORK_MCP_HOST: HOST } } },
          },
        })
        yield* Fiber.interrupt(turn)
      }),
    )
  }, 15_000)
})
