// Invoke the real `claude` CLI through the real Process port, and show what
// comes back — raw normalized events, then the schema-validated output.
//
//   pnpm real
//
// Costs a real Claude invocation. Kept to one, at low effort.

import { BuiltinPromptsLayer } from "./prompts/adapters/builtin.js"
import { TEMPLATES } from "./app/packaged.js"
import { randomUUID } from "node:crypto"
import { NodeProcessLayer } from "./agent/adapters/process-node.js"
import { Provider } from "./agent/ports/provider.js"
import { SessionId, type SessionRequest } from "./agent/types/session.js"
import { Transcript } from "./agent/ports/transcript.js"
import { elicit } from "./agent/interactions/elicit.js"
import { ClaudeProviderLayer } from "./agent/providers/claude/index.js"
import { Console, Effect, Either, Layer, Stream } from "effect"
import { StepOutput } from "./workflow/domain/outputs/step-output.js"

const request = (prompt: string): SessionRequest => ({
  prompt,
  cwd: process.cwd(),
  model: "haiku",
  // --session-id requires a UUID. Not a derived string — see findings.
  sessionId: SessionId.make(randomUUID()),
  toolAccess: "read-only",
  permission: "read",
  resumeFrom: undefined,
  inherited: false,
  effort: undefined,
  brief: undefined,
  env: {},
})

const program = Effect.gen(function* () {
  const req = request(
    "Reply with a single fenced block and nothing else:\n" +
      '```json\n{ "type": "artifact", "content": "hello from a real claude session" }\n```',
  )

  yield* Console.log(`\n╭─ spawning claude ── session ${req.sessionId}`)

  // 1. the raw normalized stream
  const provider = yield* Provider
  const started = Date.now()
  // Through `Stream.either`, because an in-band `is_error` now fails the stream
  // (see `failOnApiError` in adapters/cli-provider.ts). A bare `runCollect`
  // would throw away every event it had already seen and print nothing — which
  // is the opposite of what this file is for. The `ApiError` is emitted before
  // the failure, so the listing below still shows what went wrong.
  const collected = [...(yield* Stream.runCollect(Stream.either(provider.run(req))))]
  const elapsed = Date.now() - started
  const events = collected.flatMap((e) => (Either.isRight(e) ? [e.right] : []))
  const failure = collected.find(Either.isLeft)?.left

  yield* Console.log(`│ normalized events (${events.length}) in ${elapsed}ms:`)
  for (const e of events) {
    const detail =
      e._tag === "Spawned"
        ? `pid=${e.pid}`
        : e._tag === "TextDelta"
          ? JSON.stringify(e.text.slice(0, 60))
          : e._tag === "ToolUse"
            ? `${e.name} ${e.kind}${e.detail === undefined ? "" : ` ${e.detail}`}`
            : e._tag === "SessionStarted"
              ? e.id
              : e._tag === "Result"
                ? JSON.stringify(e.text.slice(0, 60))
                : e._tag === "Usage"
                  ? `in=${e.inputTokens} out=${e.outputTokens} $${e.runCostUsd.toFixed(4)} this run`
                  : e._tag === "ApiError"
                    ? `${e.kind}: ${e.message}`
                    : e._tag === "Thinking"
                      ? (e.text ?? `~${e.tokens ?? 0} tokens`)
                      : e._tag === "RateLimit"
                        ? `exhausted=${String(e.exhausted)} overage=${String(e.usingOverage)}`
                        : e._tag === "ToolResult"
                          ? e.ok
                            ? "ok"
                            : "error"
                          : e._tag === "Reask"
                            ? e.reason
                            : e._tag === "SubagentStarted"
                              ? `${e.agentType ?? "?"} ${e.description ?? ""} call=${e.call}`
                              : e._tag === "SubagentResult"
                                ? `${e.ok ? "ok" : "error"} call=${e.call}`
                                : e._tag === "ApiRetry"
                                  ? `${e.status ?? "no status"} attempt ${e.attempt}/${e.of}`
                                  : e._tag === "BackgroundTasks"
                                    ? `outstanding=[${e.tasks.map((t) => t.id).join(", ")}]`
                                    : e._tag === "BackgroundStarted"
                                      ? `task=${e.taskId} call=${e.call}`
                                      : e._tag === "Occupancy"
                                        ? `held=${e.inputTokens + e.cacheReadTokens + e.cacheWriteTokens + e.outputTokens}`
                                        : e._tag === "ContextWindow"
                                          ? `${String(e.tokens)} tokens`
                                          : e._tag === "MessageDelivered"
                                            ? e.text
                                            : e._tag === "McpReturned"
                                              ? `${e.tool} call=${e.call}`
                                              : e._tag === "HookRan"
                                                ? `${e.event} ${e.status} call=${e.call ?? "none"}`
                                                : e._tag === "PermissionDenied"
                                                  ? `${e.tool} ${e.reason ?? ""} call=${e.call ?? "none"}`
                                                  : e._tag === "SessionLogRead"
                                                    ? e.path
                                                    : JSON.stringify(e.raw).slice(0, 70)
    yield* Console.log(`│   ${e._tag.padEnd(15)} ${detail}`)
  }

  // A failed turn is the end of the demo: the second half spends money on a
  // second session, and a provider that just failed is the one thing that says
  // not to. Reported rather than thrown so the listing above is still the last
  // thing on screen.
  if (failure !== undefined) {
    yield* Console.log(`│`)
    yield* Console.log(`│ the turn failed: ${failure.reason}`)
    yield* Console.log("╰─────────────────────────────────────────────────────────\n")
    return
  }

  // 2. the same thing through elicit, which must produce a valid StepOutput
  yield* Console.log(`│`)
  yield* Console.log(`│ now via elicit(StepOutput, …) — a second session`)
  const out = yield* elicit(StepOutput, request(req.prompt))
  yield* Console.log(`│   decoded: ${JSON.stringify(out.value)}`)
  yield* Console.log("╰─────────────────────────────────────────────────────────\n")
})

const CountingTranscript = Layer.succeed(Transcript, { record: () => Effect.void })

await Effect.runPromise(
  program.pipe(
    Effect.provide(
      Layer.mergeAll(
        BuiltinPromptsLayer(TEMPLATES),
        CountingTranscript,
        ClaudeProviderLayer.pipe(Layer.provide(NodeProcessLayer)),
      ),
    ),
    Effect.scoped,
  ),
)
