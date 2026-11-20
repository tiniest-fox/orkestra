// A scripted provider. Stands in for `claude` / `opencode` so the whole engine
// runs deterministically with no subprocess, no auth, and no network.
//
// Two shapes: one list every turn draws from in order, for the walkthrough and the
// spike; and one queue per working directory, for the simulated engine, where every
// trak has a checkout of its own and is pressed in whatever order a person likes.

import { Effect, type Layer, Ref, Stream } from "effect"
import type { Provider, ProviderAdapter } from "../ports/provider.js"
import { ProviderFailed } from "../types/errors.js"
import { ProviderEvent } from "../types/provider-event.js"
import type { SessionRequest } from "../types/session.js"
import { providersLayer } from "./provider-registry.js"

export interface ScriptedTurn {
  /** Raw text the "agent" emits. May be malformed to exercise the retry loop. */
  readonly text: string
  /**
   * Run inside the turn, before it answers — where a CLI's tool calls land. Handed the
   * request, so it can reach the servers the session was given the way the CLI would.
   */
  readonly during?: (req: SessionRequest) => Effect.Effect<void>
}

/**
 * A queue of turns per `cwd`, and what answers once a queue is spent or a directory has
 * none.
 *
 * `repeat` is tried in order against the request's `settles`, and the first it accepts
 * answers: so one list can hold a plan for a composer and a document for each role, and
 * a turn always gets the one its schema wants. A turn none of them settles — a goal's
 * composer, whose answer is prose — gets the last.
 */
export interface ScriptedQueues {
  readonly queues: ReadonlyMap<string, readonly ScriptedTurn[]>
  readonly repeat: readonly [string, ...string[]]
  /** Start a turn beside a setup still running, as a CLI that holds its commands does. */
  readonly gatesCommands?: true
}

const answering = (req: SessionRequest, turn: ScriptedTurn): Stream.Stream<ProviderEvent> =>
  Stream.concat(
    Stream.fromEffect(turn.during?.(req) ?? Effect.void).pipe(Stream.drain),
    Stream.make(
      ProviderEvent.SessionStarted({ id: req.sessionId }),
      // A real activity, not a bare name: a fake that emits less than a provider
      // owes is a fake the display half cannot be exercised against.
      ProviderEvent.ToolUse({
        name: "Read",
        kind: "Read",
        detail: "README.md",
        command: undefined,
        backgrounded: undefined,
        call: undefined,
        parent: undefined,
      }),
      ProviderEvent.Result({ text: turn.text }),
    ),
  )

const adapterOver = (run: ProviderAdapter["run"], gatesCommands?: true): ProviderAdapter => ({
  name: "fake",
  run,
  ...(gatesCommands === undefined ? {} : { gatesCommands }),
  resume: { _tag: "SuppliedId" },
  // No process and no pipe, so there is never anything to write a stop down.
  stopBackgroundTask: () => Effect.succeed(false),
  // And nothing to write a message down: it stays the caller's, for the next gate.
  steer: () => Effect.succeed(false),
  // No CLI, so no MCP server behind one: nothing to ask and nothing to start.
  mcp: () => Effect.succeed(undefined),
  attend: () => Effect.fail(new ProviderFailed({ provider: "fake", reason: "nothing to start" })),
})

const makeScriptedProvider = (
  turns: readonly ScriptedTurn[],
  log: (line: string) => Effect.Effect<void> = () => Effect.void,
): Effect.Effect<ProviderAdapter> =>
  Effect.gen(function* () {
    const remaining = yield* Ref.make<readonly ScriptedTurn[]>(turns)
    return adapterOver((req) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const turn = yield* Ref.modify(remaining, (ts) => [ts[0], ts.slice(1)] as const)
          const label = req.resumeFrom === undefined ? "spawn" : "resume"
          yield* log(`    [fake ${label}] model=${req.model} session=${req.sessionId}`)
          if (turn === undefined) return Stream.make(ProviderEvent.Result({ text: "" }))
          return answering(req, turn)
        }),
      ),
    )
  })

const repeated = (req: SessionRequest, repeat: ScriptedQueues["repeat"]): ScriptedTurn => ({
  text: repeat.find((text) => req.settles?.(text) === true) ?? repeat[repeat.length - 1] ?? "",
})

const makeQueuedProvider = (script: ScriptedQueues): Effect.Effect<ProviderAdapter> =>
  Effect.gen(function* () {
    const remaining = yield* Ref.make(script.queues)
    return adapterOver(
      (req) =>
        Stream.unwrap(
          Effect.map(
            Ref.modify(remaining, (queues) => {
              const [turn, ...rest] = queues.get(req.cwd) ?? []
              return [turn, new Map(queues).set(req.cwd, rest)] as const
            }),
            (turn) => answering(req, turn ?? repeated(req, script.repeat)),
          ),
        ),
      script.gatesCommands,
    )
  })

export const ScriptedProviderLayer = (
  turns: readonly ScriptedTurn[],
  log?: (line: string) => Effect.Effect<void>,
): Layer.Layer<Provider> => providersLayer(makeScriptedProvider(turns, log))

export const ScriptedQueuesLayer = (script: ScriptedQueues): Layer.Layer<Provider> =>
  providersLayer(makeQueuedProvider(script))
