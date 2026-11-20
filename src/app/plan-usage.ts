// How much of each CLI's plan is used, as this engine's own turns on that CLI report it.
//
// **Every reading comes off a turn's stream.** `claude` writes a `rate_limit_event` line
// from the response headers of the turn's own requests, and `codex` writes
// `account/rateLimits/updated` after each model call. Either way it works with whatever
// token the CLI holds, costs nothing beyond the turn, and describes the account this
// engine's CLI runs as — nothing here asks a CLI for its quota. Every turn goes through
// `Provider.run`, so `usageWatching` sees each event on the registry's way out; a model's
// `<provider>/` qualifier says which CLI a turn runs on, and a bare name is the
// registry's first, Claude.
//
// **Nothing here is an error.** An event with no windows is `Unavailable` until a reading
// arrives, and never replaces one. The memory is this process's alone: a restart is
// `NotRead` until the next turn on that CLI reports.

import { Clock, Context, Effect, Layer, Ref, type Scope, Stream } from "effect"
import {
  type CliUsage,
  isUsageCli,
  PlanUsage,
  type PlanWindow,
  type UsageCli,
} from "../agent/types/plan-usage.js"
import { Provider } from "../agent/ports/provider.js"
import { Feed, Frame } from "../workflow/ports/feed.js"

export interface UsageMemoryShape {
  /** Where `cli`'s plan usage stands now — what `GET /api/usage` answers for it. */
  readonly current: (cli: UsageCli) => Effect.Effect<CliUsage>
  /** Count one turn on `cli` as running for the length of the scope. */
  readonly running: (cli: UsageCli) => Effect.Effect<void, never, Scope.Scope>
  /** Keep what one `RateLimit` event on `cli` said; `undefined` is an event that carried no windows. */
  readonly reported: (
    cli: UsageCli,
    windows: readonly PlanWindow[] | undefined,
  ) => Effect.Effect<void>
}

export class UsageMemory extends Context.Tag("app/UsageMemory")<UsageMemory, UsageMemoryShape>() {}

interface Memory {
  readonly usage: PlanUsage
  readonly turns: number
}

type Memories = Readonly<Record<UsageCli, Memory>>

const viewOf = (cli: UsageCli, memory: Memory): CliUsage => ({
  cli,
  polling: memory.turns > 0,
  usage: memory.usage,
})

/**
 * What an event reported at `at` makes of the usage held. An event without windows keeps
 * a reading: it says nothing about the windows, and a CLI that wrote them once is not
 * shown as one that cannot.
 */
const afterReport = (
  held: PlanUsage,
  windows: readonly PlanWindow[] | undefined,
  at: number,
): PlanUsage => {
  if (windows !== undefined) return PlanUsage.Read({ at, windows })
  return held._tag === "Read" ? held : PlanUsage.Unavailable({ at, why: { reason: "shape" } })
}

const unread: Memory = { usage: PlanUsage.NotRead(), turns: 0 }

export const UsageMemoryLayer: Layer.Layer<UsageMemory, never, Feed> = Layer.effect(
  UsageMemory,
  Effect.gen(function* () {
    const feed = yield* Feed
    const held = yield* Ref.make<Memories>({ claude: unread, codex: unread })

    const publish = (cli: UsageCli) =>
      Effect.flatMap(Ref.get(held), (memories) =>
        feed.publish(Frame.Usage({ usage: viewOf(cli, memories[cli]) })),
      )

    // A frame only where the count crosses zero: a second turn starting changes nothing
    // a screen draws.
    const count = (cli: UsageCli, by: 1 | -1) =>
      Effect.flatMap(
        Ref.modify(held, (memories): [boolean, Memories] => {
          const memory = memories[cli]
          const turns = memory.turns + by
          return [
            (turns === 0) !== (memory.turns === 0),
            { ...memories, [cli]: { ...memory, turns } },
          ]
        }),
        (changed) => (changed ? publish(cli) : Effect.void),
      )

    return {
      current: (cli) => Effect.map(Ref.get(held), (memories) => viewOf(cli, memories[cli])),
      running: (cli) => Effect.acquireRelease(count(cli, 1), () => count(cli, -1)),
      reported: (cli, windows) =>
        Effect.gen(function* () {
          const at = yield* Clock.currentTimeMillis
          yield* Ref.update(held, (memories) => ({
            ...memories,
            [cli]: { ...memories[cli], usage: afterReport(memories[cli].usage, windows, at) },
          }))
          yield* publish(cli)
        }),
    }
  }),
)

/**
 * Wrap a provider so each turn on a CLI whose usage is read is counted for the length of
 * its stream, and every quota broadcast it writes is kept. Takes the inner layer, for
 * `publishingRuns`' reason: a test wraps a scripted provider rather than a CLI.
 */
export const usageWatching = <E, R>(
  inner: Layer.Layer<Provider, E, R>,
): Layer.Layer<Provider, E, R | UsageMemory> =>
  Layer.effect(
    Provider,
    Effect.gen(function* () {
      const provider = yield* Provider
      const usage = yield* UsageMemory
      return {
        ...provider,
        run: (req) => {
          const cli = provider.cliFor(req.model)
          if (cli === undefined || !isUsageCli(cli)) return provider.run(req)
          const watched = Stream.tap(provider.run(req), (event) =>
            event._tag === "RateLimit" ? usage.reported(cli, event.windows) : Effect.void,
          )
          return Stream.unwrapScoped(Effect.as(usage.running(cli), watched))
        },
      }
    }),
  ).pipe(Layer.provide(inner))
