// Provider smoke test. NOT part of `pnpm verify` — it spawns a real agent,
// needs auth, and costs tokens.
//
//   pnpm smoke                     verify claude still invokes and finishes, and that
//                                  it reads and calls an MCP server's view
//   pnpm smoke --refresh-fixtures  also re-capture test/fixtures/claude/*.captured.jsonl
//   pnpm smoke --codex             verify codex instead: one turn on `codex app-server`,
//                                  a second on the thread the first announced, and a
//                                  third steered while its command runs
//
// Asserts shape, never content, so model chattiness cannot flake it.

import { BuiltinPromptsLayer } from "./prompts/adapters/builtin.js"
import { TEMPLATES } from "./app/packaged.js"
import { randomUUID } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { Console, Duration, Effect, Either, Fiber, Layer, Option, Schema, Stream } from "effect"
import { McpRequest, type McpTool } from "./agent/types/mcp.js"
import { NodeProcessLayer } from "./agent/adapters/process-node.js"
import { Provider, type CliProviderSpec } from "./agent/ports/provider.js"
import { SessionId, type SessionRequest } from "./agent/types/session.js"
import { Transcript } from "./agent/ports/transcript.js"
import { calledTool, openToViews } from "./agent/logic/mcp.js"
import { elicit } from "./agent/interactions/elicit.js"
import { rawKind } from "./agent/logic/event-line.js"
import { cliProviderLayer } from "./agent/adapters/cli-provider.js"
import { claudeSpec } from "./agent/providers/claude/index.js"
import { codexSpec } from "./agent/providers/codex/index.js"
import { VIEW_MARKER, VIEW_SERVER, VIEW_SERVER_COMMAND } from "../test/fixtures/mcp/view-server.js"
import type { ElicitFailed, ProviderFailed } from "./agent/types/errors.js"
import { StepOutput } from "./workflow/domain/outputs/step-output.js"

const REFRESH = process.argv.includes("--refresh-fixtures")
const CODEX = process.argv.includes("--codex")

/**
 * Read from `test/smoke/known-kinds.json` rather than restated here. Two copies
 * of the list drift, and the file is the one `testing-tiers` points at.
 *
 * Decoded rather than trusted: it is a hand-edited file, and a typo'd shape should
 * say so here rather than turn every kind into a novel one.
 */
const KnownKinds = Schema.Struct({
  // A kind is a key and its reason is the value, so an entry with no reason for
  // staying unmodelled cannot be written down. The reason is not read here.
  claude: Schema.Record({ key: Schema.String, value: Schema.String }),
})
const KNOWN_KINDS = new Set(
  Object.keys(
    Schema.decodeUnknownSync(KnownKinds)(
      JSON.parse(readFileSync(new URL("../test/smoke/known-kinds.json", import.meta.url), "utf8")),
    ).claude,
  ),
)

const request = (prompt: string, resumeFrom?: SessionId): SessionRequest => ({
  prompt,
  // **Not the repository.** These checks ask for one JSON block back; sat in this
  // checkout under `--permission-mode plan`, a model reads that as a task about the
  // repo and answers the question it invented instead — one run came back with
  // `"Summary": "not run — no smoke tests were executed"`, which is a legal artifact
  // and the wrong one. An empty directory leaves nothing to be helpful about, and
  // costs the probe nothing: what it is asserting is that claude invokes, streams,
  // and can be resumed by id.
  cwd: tmpdir(),
  model: "haiku",
  sessionId: resumeFrom ?? SessionId.make(randomUUID()),
  toolAccess: "read-only",
  permission: "read",
  resumeFrom,
  inherited: false,
  effort: undefined,
  // The smoke checks probe the provider, not our framing — an unadorned session
  // is what makes "claude behaved this way" a claim about claude.
  brief: undefined,
  env: {},
})

/**
 * Ask for one artifact, by the shape the decoder actually takes.
 *
 * It asked for `content` for a while after the prose-artifact path was deleted, so
 * `elicit` re-prompted three times and the model settled on `{"type":"message"}` —
 * which is a legal `StepOutput`, so the resume check below went on reporting `ok`
 * while decoding the wrong variant. **Both call sites read this**, because two
 * copies of a shape are what let one of them go stale unnoticed.
 */
const artifactPrompt = (body: string): string =>
  "Echo the following block back exactly as written. Change nothing, use no tools, " +
  "and reply with the block and nothing else:\n" +
  `\`\`\`json\n{ "type": "artifact", "ambiguity": "none", "sections": { "Summary": "${body}" } }\n\`\`\``

/**
 * Why a turn did not produce a value.
 *
 * `String(e)` on a tagged error prints the tag alone — this line said
 * "ElicitFailed" and nothing about what came back instead, which is the only
 * detail that tells a stale prompt from a broken provider.
 */
const failureText = (e: ElicitFailed | ProviderFailed): string =>
  e._tag === "ElicitFailed"
    ? `after ${e.attempts}: ${e.reason.slice(0, 140)}`
    : `${e.provider}: ${e.reason.slice(0, 140)}`

interface Check {
  readonly name: string
  readonly pass: boolean
  readonly detail: string
}

const check = (name: string, pass: boolean, detail = ""): Check => ({ name, pass, detail })

/**
 * The held-open pipe end to end: the result frame arrives while the task is still on
 * the level, the completion is drained rather than torn down at stdin EOF, and the
 * stream ends only once the level has gone quiet.
 */
const backgroundOutlivesAnswer = Effect.gen(function* () {
  const provider = yield* Provider
  const bg = {
    ...request(
      "Using the Bash tool with run_in_background set to true, start `sleep 8`. " +
        "As soon as the tool result comes back, reply with exactly OK and nothing else. " +
        "Do not check on the task or wait for it.",
    ),
    // `read` is plan mode, which would hold the Bash call for an approval nobody
    // is there to give. The command is a sleep in a temp directory.
    permission: "full" as const,
  }
  const collected = [...(yield* Stream.runCollect(Stream.either(provider.run(bg))))]
  const events = collected.flatMap((e) => (Either.isRight(e) ? [e.right] : []))
  const resultAt = events.findIndex((e) => e._tag === "Result")
  const landedAt = events.findIndex((e) => e._tag === "SubagentResult" && e.outcome === "completed")
  const levels = events.flatMap((e) => (e._tag === "BackgroundTasks" ? [e.tasks.length] : []))
  return check(
    "a backgrounded command outlives the answer; its completion is drained",
    resultAt >= 0 && landedAt > resultAt && levels.some((n) => n > 0) && levels.at(-1) === 0,
    `result@${resultAt} landing@${landedAt} levels=${levels.join(">")}`,
  )
})

/**
 * A message written to the turn's open pipe while a tool call runs is read when that
 * call ends, in the same turn — the CLI says so, Claude by echoing it and Codex by an
 * item carrying its key, and the turn still files one answer.
 *
 * Steered as the first tool call starts, so a call is still to come back. Asserts the
 * order and the count and nothing the model wrote: whether it obeyed the message is
 * content, and content flakes.
 */
const steeredMidTurn = (turn: SessionRequest) =>
  Effect.gen(function* () {
    const provider = yield* Provider
    const key = randomUUID()
    const collected = [
      ...(yield* Stream.runCollect(
        Stream.either(
          provider.run(turn).pipe(
            Stream.tap((e) =>
              e._tag === "ToolUse"
                ? provider.steer(turn.sessionId, {
                    key,
                    text: "Then also say the word TANGERINE.",
                  })
                : Effect.void,
            ),
          ),
        ),
      )),
    ]
    const events = collected.flatMap((e) => (Either.isRight(e) ? [e.right] : []))
    const heardAt = events.findIndex((e) => e._tag === "MessageDelivered" && e.key === key)
    const answeredAt = events.findIndex((e) => e._tag === "Result")
    const answers = events.filter((e) => e._tag === "Result").length
    const calledAt = events.findIndex((e) => e._tag === "ToolResult")
    return check(
      "a message steered mid-turn is read at the tool boundary; one answer",
      calledAt >= 0 && heardAt > calledAt && answeredAt > heardAt && answers === 1,
      `tool@${calledAt} heard@${heardAt} result@${answeredAt} results=${answers}`,
    )
  })

/** Raw lines, so we can both assert on kinds and refresh fixtures. */
const rawLines: string[] = []

/**
 * `claude` dialing the fixture server and no other. The engine itself never names a
 * server — a turn runs under whatever the checkout and the person's own settings
 * configure — so the flag is added here, on a spread of the spec, and everything after
 * it is the argv a real turn gets. `--strict-mcp-config` keeps the person's own servers
 * out of a run that lists tools.
 */
const viewSpec: CliProviderSpec = {
  ...claudeSpec,
  argv: (req, readOnlyTools, mcpConfigPath) => [
    "--mcp-config",
    JSON.stringify({
      mcpServers: { [VIEW_SERVER]: VIEW_SERVER_COMMAND },
    }),
    "--strict-mcp-config",
    ...claudeSpec.argv(req, readOnlyTools, mcpConfigPath),
  ],
}

/** What the fixture's `press` hands back under `structuredContent`. */
const Counted = Schema.Struct({ count: Schema.Number, via: Schema.String })

/**
 * The three requests the engine makes for a view, in its order, against whichever
 * process holds `session`'s pipe: the tool list, the view's HTML, and a call of a tool
 * open to views. None is a model turn.
 *
 * The list is asked again until the fixture is on it: a CLI started with no prompt
 * answers before it has finished dialing its servers.
 */
const viewAsked = (
  session: SessionId,
  called: (tools: readonly McpTool[]) => McpTool | undefined,
) =>
  Effect.gen(function* () {
    const provider = yield* Provider
    const list = provider.mcp(session, McpRequest.ListTools()).pipe(
      Effect.map((a) => (a?._tag === "Tools" ? a.tools : [])),
      Effect.orElseSucceed((): readonly McpTool[] => []),
    )
    let tools = yield* list
    for (let tries = 0; tries < 40 && !tools.some((t) => t.server === VIEW_SERVER); tries++) {
      yield* Effect.sleep("400 millis")
      tools = yield* list
    }
    const tool = called(tools)
    const read =
      tool?.view === undefined
        ? undefined
        : yield* Effect.either(
            provider.mcp(session, McpRequest.ReadResource({ server: tool.server, uri: tool.view })),
          )
    const press = openToViews(tools, VIEW_SERVER).find((t) => t.name === "press")
    const pressed =
      press === undefined
        ? undefined
        : yield* Effect.either(
            provider.mcp(
              session,
              McpRequest.CallTool({
                server: press.server,
                tool: press.name,
                callName: press.callName,
                arguments: { by: 1 },
              }),
            ),
          )
    return { tools, tool, read, pressed }
  })

type ViewAsked = Effect.Effect.Success<ReturnType<typeof viewAsked>>

const readCheck = (name: string, asked: ViewAsked | undefined): Check => {
  const read = asked?.read
  if (read === undefined) return check(name, false, "not asked")
  if (read._tag === "Left") return check(name, false, read.left.reason)
  const text = read.right?._tag === "Resource" ? read.right.resource.text : undefined
  return check(name, text?.includes(VIEW_MARKER) === true, `${text?.length ?? 0} chars`)
}

const pressCheck = (name: string, asked: ViewAsked | undefined): Check => {
  const pressed = asked?.pressed
  if (pressed === undefined) return check(name, false, "press is not open to views")
  if (pressed._tag === "Left") return check(name, false, pressed.left.reason)
  const result = pressed.right?._tag === "Result" ? pressed.right.result : undefined
  const counted = Schema.decodeUnknownOption(Counted)(result?.structured)
  return check(
    name,
    result?.isError === false && Option.isSome(counted) && counted.value.via === "press",
    JSON.stringify(result?.structured ?? result?.content ?? "no result"),
  )
}

/**
 * A view during a turn: the model calls the fixture's tool, and at that call's return —
 * with the turn still running — the tool list names the view, the HTML is read and a
 * tool is called, all down the turn's own pipe. The turn still files one answer.
 *
 * The list is the check on `CLAUDE_CODE_MCP_APPS_HOST`: the fixture offers the view only
 * to a client that says it understands one. `reset` is the fixture's tool a view may not
 * call, so its absence from the open ones is the server's `visibility` surviving the CLI.
 */
const viewDuringTurn = Effect.gen(function* () {
  const provider = yield* Provider
  const turn: SessionRequest = {
    ...request(
      `Call the show_counter tool of the ${VIEW_SERVER} MCP server exactly once, with no ` +
        "arguments. Then reply with exactly OK and nothing else.",
    ),
    // Plan mode would hold the tool call for an approval nobody is there to give.
    permission: "full",
  }
  // Forked, never awaited inside the stream: the answers are lines of the stream this
  // tap is holding up.
  const asking: Fiber.RuntimeFiber<ViewAsked>[] = []
  const collected = [
    ...(yield* Stream.runCollect(
      Stream.either(
        provider
          .run(turn)
          .pipe(
            Stream.tap((e) =>
              e._tag === "McpReturned"
                ? Effect.forkDaemon(
                    viewAsked(turn.sessionId, (tools) => calledTool(tools, e.server, e.tool)),
                  ).pipe(Effect.map((fiber) => asking.push(fiber)))
                : Effect.void,
            ),
          ),
      ),
    )),
  ]
  const events = collected.flatMap((e) => (Either.isRight(e) ? [e.right] : []))
  const failure = collected.find(Either.isLeft)?.left
  const first = asking[0]
  const asked = first === undefined ? undefined : yield* Fiber.join(first)
  const open = openToViews(asked?.tools ?? [], VIEW_SERVER).map((t) => t.name)
  const answers = events.filter((e) => e._tag === "Result").length
  const cost = events.reduce(
    (most, e) => (e._tag === "Usage" ? Math.max(most, e.runCostUsd) : most),
    0,
  )
  // A turn that calls an MCP tool is the one place its stream kinds are seen.
  for (const e of events) if (e._tag === "Unknown") rawLines.push(JSON.stringify(e.raw))
  return [
    check(
      "a view's tool call is reported, and its tool lists the view",
      asked?.tool?.view !== undefined && !open.includes("reset"),
      first === undefined
        ? (failure?.reason ?? "no McpReturned")
        : `${asked?.tool?.view ?? "no view"}; open to views: ${open.join(", ")}`,
    ),
    readCheck("the view's HTML is read down the turn's pipe", asked),
    pressCheck("a view's call is answered during the turn", asked),
    check(
      "the turn with a view files one answer",
      failure === undefined && answers === 1,
      `results=${answers} $${cost.toFixed(4)}`,
    ),
  ]
})

/**
 * A view after its turn: `claude` started with no prompt, asked the same three things.
 * No user message is written, so no model runs and nothing is spent — `attend` has no
 * stream to meter, and the fixture answering is the whole of the evidence.
 */
const viewAfterTurn = Effect.scoped(
  Effect.gen(function* () {
    const provider = yield* Provider
    const idle = request("")
    const started = yield* Effect.either(provider.attend(idle))
    if (started._tag === "Left") {
      return [check("claude starts with no prompt", false, started.left.reason)]
    }
    const asked = yield* viewAsked(idle.sessionId, (tools) =>
      tools.find((t) => t.server === VIEW_SERVER && t.name === "show_counter"),
    )
    return [
      check(
        "claude starts with no prompt and lists the view",
        asked.tool?.view !== undefined,
        asked.tool?.view ?? `${asked.tools.length} tools, none with a view`,
      ),
      readCheck("the view's HTML is read with no turn running", asked),
      pressCheck("a view's call is answered with no turn running", asked),
    ]
  }),
)

/** Both halves, on a `claude` that dials the fixture. */
const viewChecks = Effect.all([viewDuringTurn, viewAfterTurn]).pipe(
  Effect.map((halves) => halves.flat()),
  Effect.provide(cliProviderLayer(viewSpec).pipe(Layer.provide(NodeProcessLayer))),
)

const program = Effect.gen(function* () {
  const checks: Check[] = []
  yield* Console.log("\n╭─ provider smoke: claude (haiku)")

  // 1-3: a plain invocation produces a session, a result, and no error
  const provider = yield* Provider
  const first = request(artifactPrompt("smoke ok"))
  const started = Date.now()
  // Collected through `Stream.either`, not straight: an in-band `is_error` now
  // fails the stream (see `failOnApiError` in adapters/cli-provider.ts), and a
  // bare `runCollect` would take the whole smoke run down with it — reporting
  // nothing, where the entire point of this file is to report a list. The
  // `ApiError` is emitted before the failure, so both halves are still here.
  const collected = [...(yield* Stream.runCollect(Stream.either(provider.run(first))))]
  const elapsed = Date.now() - started
  const events = collected.flatMap((e) => (Either.isRight(e) ? [e.right] : []))
  const failure = collected.find(Either.isLeft)?.left

  const tags = new Set(events.map((e) => e._tag))
  const sessionId = events.reduce<SessionId | undefined>(
    (found, e) => found ?? (e._tag === "SessionStarted" ? e.id : undefined),
    undefined,
  )

  // Was hardcoded `true` — a check that could not fail, because the only thing
  // able to stop the stream also stopped the program before it was pushed. Now
  // that a failed turn is a value, it is a real assertion.
  checks.push(
    check(
      "process ran and stream completed",
      failure === undefined,
      failure?.reason ?? `${elapsed}ms`,
    ),
  )
  checks.push(
    check(
      "SessionStarted carries a UUID",
      sessionId !== undefined &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(sessionId),
      sessionId ?? "missing",
    ),
  )
  checks.push(check("a Result arrived", tags.has("Result")))
  checks.push(check("no ApiError", !tags.has("ApiError")))

  const cost = events.reduce<number | undefined>(
    (found, e) => found ?? (e._tag === "Usage" ? e.runCostUsd : undefined),
    undefined,
  )
  checks.push(check("usage and cost reported", cost !== undefined, `$${(cost ?? 0).toFixed(4)}`))

  // 4: elicit decodes a schema-valid value
  const decoded = yield* Effect.either(elicit(StepOutput, request(artifactPrompt("smoke ok"))))
  checks.push(
    check(
      "elicit decodes a schema-valid StepOutput",
      decoded._tag === "Right" && decoded.right.value.type === "artifact",
      decoded._tag === "Right"
        ? JSON.stringify(decoded.right.value).slice(0, 60)
        : failureText(decoded.left),
    ),
  )

  // 5: THE important one — resume. Bidirectional handoff is the product
  // requirement and the most likely thing to break under a Claude Code upgrade.
  if (sessionId !== undefined) {
    const resumed = yield* Effect.either(
      elicit(StepOutput, request(artifactPrompt("resumed ok"), sessionId)),
    )
    checks.push(
      check(
        // Not merely `Right`: a `message` decodes too, and accepting one is how this
        // check reported `ok` against a prompt asking for a shape that no longer existed.
        "a named session can be resumed (--resume <id>)",
        resumed._tag === "Right" && resumed.right.value.type === "artifact",
        resumed._tag === "Right" ? "ok" : failureText(resumed.left),
      ),
    )
  }

  // 6: background work outlives the answer — see `backgroundOutlivesAnswer`.
  checks.push(yield* backgroundOutlivesAnswer)

  // 7: a message steered into a running turn — see `steeredMidTurn`.
  checks.push(
    yield* steeredMidTurn({
      ...request("Run `sleep 6` with the Bash tool, then reply with exactly OK and nothing else."),
      // Plan mode would hold the Bash call for an approval nobody is there to give.
      permission: "full",
    }),
  )

  // 8: an MCP tool's view, during a turn and after one — see `viewDuringTurn`.
  checks.push(...(yield* viewChecks))

  // 9: no unrecognised stream-json kinds. A new kind currently disappears into
  // Unknown; this is what makes it visible.
  const kinds = new Set<string>()
  for (const line of rawLines) {
    try {
      const parsed: unknown = JSON.parse(line)
      // `rawKind` and not a second copy of the convention here: it is the same
      // question every `Unknown(...)` transcript line answers, and two spellings of
      // "how a stream kind is named" would drift without either being wrong.
      kinds.add(rawKind(parsed))
    } catch {
      /* non-json line, already ignored by the normalizer */
    }
  }
  const novel = [...kinds].filter((k) => !KNOWN_KINDS.has(k))
  checks.push(
    check(
      "no unrecognised stream-json kinds",
      novel.length === 0,
      novel.length === 0 ? [...kinds].join(", ") : `NEW: ${novel.join(", ")}`,
    ),
  )

  if (REFRESH && rawLines.length > 0) {
    const path = new URL("../test/fixtures/claude/simple-reply.captured.jsonl", import.meta.url)
    writeFileSync(path, `${rawLines.join("\n")}\n`)
    yield* Console.log(`│ refreshed fixture: ${path.pathname}`)
  }

  yield* reported(checks, `~$${(cost ?? 0).toFixed(4)}`)
})

/** Print every check, then fail the run if any did not pass. */
const reported = (checks: readonly Check[], spent: string) =>
  Effect.gen(function* () {
    for (const c of checks) {
      yield* Console.log(`│ ${c.pass ? "✓" : "✗"} ${c.name.padEnd(48)} ${c.detail}`)
    }
    const failed = checks.filter((c) => !c.pass)
    yield* Console.log(
      `╰─ ${failed.length === 0 ? "all checks passed" : `${failed.length} FAILED`}  (${spent})\n`,
    )
    if (failed.length > 0) yield* Effect.fail(new Error(`${failed.length} smoke checks failed`))
  })

/**
 * The cheapest model the Codex catalog lists, at its lowest effort that still
 * answers. Named here and in no `models.yaml`: the smoke run goes straight to the
 * registry, which checks a qualifier and never a model name.
 */
const CODEX_MODEL = "codex/gpt-5.6-luna"

const codexRequest = (prompt: string, resumeFrom?: SessionId): SessionRequest => ({
  ...request(prompt, resumeFrom),
  model: CODEX_MODEL,
  effort: "low",
})

/**
 * Codex end to end on `codex app-server`: the dialogue reaches a turn, the turn
 * answers and the server exits when the pipe closes, the rollout it left is read for
 * the context reading, a second process picks the thread up by the id the first
 * announced, and a third takes a message while its command runs. `codex exec resume
 * <id>` by hand reads the same rollout; nothing here can type that for a person.
 */
const codexProgram = Effect.gen(function* () {
  yield* Console.log(`\n╭─ provider smoke: ${CODEX_MODEL}`)
  const provider = yield* Provider
  const started = Date.now()
  const collected = [
    ...(yield* Stream.runCollect(
      Stream.either(provider.run(codexRequest(artifactPrompt("smoke ok")))),
    )),
  ]
  const elapsed = Date.now() - started
  const events = collected.flatMap((e) => (Either.isRight(e) ? [e.right] : []))
  const failure = collected.find(Either.isLeft)?.left
  const tags = new Set(events.map((e) => e._tag))
  const sessionId = events.reduce<SessionId | undefined>(
    (found, e) => found ?? (e._tag === "SessionStarted" ? e.id : undefined),
    undefined,
  )
  const tokens = events.reduce(
    (sum, e) => (e._tag === "Usage" ? sum + e.inputTokens + e.cacheReadTokens : sum),
    0,
  )
  const unknown = events.flatMap((e) => (e._tag === "Unknown" ? [rawKind(e.raw)] : []))
  const checks: Check[] = [
    check(
      "the server ran, answered and exited",
      failure === undefined,
      failure?.reason ?? `${elapsed}ms`,
    ),
    check("the thread request's answer named a session", sessionId !== undefined, sessionId ?? ""),
    check("a Result arrived", tags.has("Result")),
    check("no ApiError", !tags.has("ApiError")),
    check("the turn's calls were counted", tokens > 0, `${tokens} tokens in`),
    check(
      "the rollout gave a context reading after the exit",
      tags.has("Occupancy") && tags.has("ContextWindow"),
    ),
    check("no unrecognised app-server kinds", unknown.length === 0, unknown.join(", ")),
  ]
  if (sessionId !== undefined) {
    const resumed = yield* Effect.either(
      elicit(StepOutput, codexRequest(artifactPrompt("resumed ok"), sessionId)),
    )
    checks.push(
      check(
        "the announced thread can be resumed (thread/resume)",
        resumed._tag === "Right" && resumed.right.value.type === "artifact",
        resumed._tag === "Right" ? "ok" : failureText(resumed.left),
      ),
    )
  }
  // A message steered into a running turn, as the Claude run checks it.
  checks.push(
    yield* steeredMidTurn({
      ...codexRequest("Run the shell command `sleep 6`, then reply with exactly OK."),
      permission: "full",
    }),
  )
  yield* reported(checks, "Codex reports no cost")
})

/** Captures every normalized event's raw payload for the kinds check. */
const CapturingTranscript = Layer.succeed(Transcript, {
  record: (e) =>
    Effect.sync(() => {
      if (e._tag === "Unknown") rawLines.push(JSON.stringify(e.raw))
    }),
})

await Effect.runPromise(
  (CODEX ? codexProgram : program).pipe(
    Effect.timeout(Duration.minutes(5)),
    Effect.provide(
      Layer.mergeAll(
        BuiltinPromptsLayer(TEMPLATES),
        CapturingTranscript,
        cliProviderLayer(claudeSpec, codexSpec).pipe(Layer.provide(NodeProcessLayer)),
      ),
    ),
    Effect.scoped,
  ),
)
