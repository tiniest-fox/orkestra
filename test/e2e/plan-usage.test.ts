// The usage service keeps what each CLI's quota broadcasts say, counts the turns running
// on each, and sends every change to every screen.
//
// The provider is scripted: each turn writes the events it is given, then runs until the
// test releases it. A Codex turn's events are a captured stream read by the Codex
// normalizer. The `Feed` is a list, so what every screen would be sent is asserted.

import { readFileSync } from "node:fs"
import { Deferred, Effect, Fiber, Layer, Ref, Stream, TestClock, TestContext } from "effect"
import { describe, expect, it } from "vitest"
import { toWeb, type HttpServerResponse } from "@effect/platform/HttpServerResponse"
import { Provider, type ProviderRegistry } from "../../src/agent/ports/provider.js"
import { ProviderEvent } from "../../src/agent/types/provider-event.js"
import { SessionId, type SessionRequest } from "../../src/agent/types/session.js"
import type { CliUsage, PlanWindow, UsageCli } from "../../src/agent/types/plan-usage.js"
import { codexNormalizer } from "../../src/agent/providers/codex/normalize.js"
import { UsageMemory, UsageMemoryLayer, usageWatching } from "../../src/app/plan-usage.js"
import { usageRoutes } from "../../src/app/routes/usage.js"
import { Lib } from "../../src/library/ports/library.js"
import type { Library } from "../../src/library/types/library.js"
import { Feed, type Frame } from "../../src/workflow/ports/feed.js"
import { serving } from "../support/http.js"
import { library } from "../support/library.js"

const WINDOWS: readonly PlanWindow[] = [
  { kind: "five_hour", utilization: 8, resetsAt: 1_790_101_800_000 },
  { kind: "seven_day", utilization: 19, resetsAt: 1_790_398_800_000 },
]

const report = (windows: readonly PlanWindow[] | undefined) =>
  ProviderEvent.RateLimit({ exhausted: false, usingOverage: false, resetsAt: undefined, windows })

const request: SessionRequest = {
  prompt: "go",
  cwd: "/repo",
  model: "m",
  effort: undefined,
  sessionId: SessionId.make("minted"),
  toolAccess: "read-only",
  permission: "read",
  resumeFrom: undefined,
  inherited: false,
  brief: undefined,
  env: {},
}

/** A provider on `cli` whose turns write `events`, then run until `release`. */
const provider = (
  cli: string | ((model: string) => string),
  events: readonly ProviderEvent[],
  release: Deferred.Deferred<void>,
) =>
  Layer.succeed(Provider, {
    run: () =>
      Stream.concat(
        Stream.fromIterable(events),
        Stream.drain(Stream.fromEffect(Deferred.await(release))),
      ),
    stopBackgroundTask: () => Effect.succeed(false),
    steer: () => Effect.succeed(false),
    mcp: () => Effect.succeed(undefined),
    attend: () => Effect.die("unused"),
    cliFor: (model) => (typeof cli === "string" ? cli : cli(model)),
    resumeFor: () => undefined,
    sessionFileFor: () => undefined,
    signInFileFor: () => undefined,
    resumeLineFor: () => undefined,
    credentials: [],
    gatesCommandsFor: () => false,
  } satisfies ProviderRegistry)

const settle = Effect.yieldNow().pipe(Effect.repeatN(20))

/** The events a captured Codex run reads as, through one reader as the harness builds per spawn. */
const codexTurn = (name: string): readonly ProviderEvent[] =>
  readFileSync(new URL(`../fixtures/codex/${name}`, import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap(codexNormalizer())

/** A response's body, parsed. */
const jsonOf = (response: HttpServerResponse): Effect.Effect<unknown> =>
  Effect.promise(async (): Promise<unknown> => {
    const parsed: unknown = await toWeb(response).json()
    return parsed
  })

// A bare name is the registry's first, Claude, as the real registry reads it.
const cliOf = (model: string): string => (model.startsWith("codex/") ? "codex" : "claude")

/**
 * Run each turn in `turns` on `cli` to its end, one after another, under one service, and
 * return what the service held for `read` mid-turn and after, every CLI's state after,
 * and every frame it sent.
 */
const turnsOn = (
  cli: string,
  turns: readonly (readonly ProviderEvent[])[],
  read: UsageCli = cli === "codex" ? "codex" : "claude",
) =>
  Effect.gen(function* () {
    const frames = yield* Ref.make<readonly Frame[]>([])
    const feed = Layer.succeed(Feed, {
      publish: (frame) => Ref.update(frames, (held) => [...held, frame]),
      since: () => Effect.succeed({ complete: true, frames: Stream.empty }),
    })
    const service = UsageMemoryLayer.pipe(Layer.provide(feed))
    return yield* Effect.gen(function* () {
      const usage = yield* UsageMemory
      const during: CliUsage[] = []
      for (const events of turns) {
        const release = yield* Deferred.make<void>()
        const watched = usageWatching(provider(cli, events, release)).pipe(
          Layer.provide(Layer.succeed(UsageMemory, usage)),
        )
        const run = Effect.flatMap(Provider, (p) => Stream.runDrain(p.run(request)))
        const turn = yield* Effect.fork(Effect.provide(run, watched))
        yield* settle
        during.push(yield* usage.current(read))
        yield* TestClock.adjust("1 minute")
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(turn)
      }
      return {
        during,
        after: yield* usage.current(read),
        claude: yield* usage.current("claude"),
        frames: yield* Ref.get(frames),
      }
    }).pipe(Effect.provide(service))
  }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise)

describe("what a turn reports", () => {
  it("keeps the windows a Claude turn's quota broadcast carries, stamped when it arrived", async () => {
    const { during, after } = await turnsOn("claude", [[], [report(WINDOWS)]])
    expect(during[0]?.usage).toEqual({ _tag: "NotRead" })
    // The second turn starts a minute in, after the first turn's minute.
    expect(after.usage).toEqual({ _tag: "Read", at: 60_000, windows: WINDOWS })
  })

  it("reads a broadcast with no windows as the shape it is, while nothing was read", async () => {
    const { after } = await turnsOn("claude", [[report(undefined)]])
    expect(after.usage).toMatchObject({ _tag: "Unavailable", why: { reason: "shape" } })
  })

  it("keeps a reading through a broadcast with no windows", async () => {
    const { after } = await turnsOn("claude", [[report(WINDOWS)], [report(undefined)]])
    expect(after.usage).toEqual({ _tag: "Read", at: 0, windows: WINDOWS })
  })

  it("takes the latest of several readings", async () => {
    const later: readonly PlanWindow[] = [{ kind: "five_hour", utilization: 40 }]
    const { after } = await turnsOn("claude", [[report(WINDOWS)], [report(later)]])
    expect(after.usage).toEqual({ _tag: "Read", at: 60_000, windows: later })
  })
})

describe("a Codex turn", () => {
  it("keeps the five-hour and weekly windows of the last quota line, resets in milliseconds", async () => {
    const { after } = await turnsOn("codex", [codexTurn("hooks.captured.jsonl")])
    // The capture's last line: `primary` 43% of 300 minutes, `secondary` 13% of 10080.
    expect(after).toEqual({
      cli: "codex",
      polling: false,
      usage: {
        _tag: "Read",
        at: 0,
        windows: [
          { kind: "five_hour", utilization: 43, resetsAt: 1_793_128_086_000 },
          { kind: "seven_day", utilization: 13, resetsAt: 1_793_633_175_000 },
        ],
      },
    })
  })

  it.each(["unknown-model.captured.jsonl", "sigkill.captured.jsonl"])(
    "leaves the reading as it was after a turn with no quota line (%s)",
    async (name) => {
      const read = await turnsOn("codex", [codexTurn("launch-shell-call.captured.jsonl")])
      const { after } = await turnsOn("codex", [
        codexTurn("launch-shell-call.captured.jsonl"),
        codexTurn(name),
      ])
      expect(after.usage).toEqual(read.after.usage)
    },
  )

  it("leaves Claude's memory unread", async () => {
    const { claude } = await turnsOn("codex", [codexTurn("launch-shell-call.captured.jsonl")])
    expect(claude).toEqual({ cli: "claude", polling: false, usage: { _tag: "NotRead" } })
  })
})

describe("which turns count", () => {
  it.each([
    ["claude", true, "Read"],
    ["codex", true, "Read"],
    ["gemini", false, "NotRead"],
  ])("a turn on %s is polling %s, and its report comes to %s", async (cli, polling, tag) => {
    const { during, after } = await turnsOn(cli, [[report(WINDOWS)]])
    expect(during[0]?.polling).toBe(polling)
    expect(after.polling).toBe(false)
    expect(after.usage._tag).toBe(tag)
  })

  it("sends every change to every screen, a turn starting and ending included", async () => {
    const { frames } = await turnsOn("claude", [[report(WINDOWS)]])
    expect(
      frames.map((f) => (f._tag === "Usage" ? [f.usage.polling, f.usage.usage._tag] : f._tag)),
    ).toEqual([
      [true, "NotRead"],
      [true, "Read"],
      [false, "Read"],
    ])
  })
})

describe("GET /api/usage", () => {
  const { call } = serving(usageRoutes)
  const base = library()
  const withCodex = (): Library => {
    const work = base.agents.get("work")
    if (work === undefined) throw new Error("the fixture fleet lost its `work` agent")
    return {
      ...base,
      agents: new Map(base.agents).set("lean", { ...work, name: "lean", model: "codex/gpt-5.6" }),
    }
  }
  /**
   * The route's answer before a Codex turn, while one runs, and after it, over `lib`. The
   * turn writes `events`, then runs until released.
   */
  const answersOver = (lib: Library, events: readonly ProviderEvent[]) =>
    Effect.gen(function* () {
      const feed = Layer.succeed(Feed, {
        publish: () => Effect.void,
        since: () => Effect.succeed({ complete: true, frames: Stream.empty }),
      })
      const release = yield* Deferred.make<void>()
      const memory = UsageMemoryLayer.pipe(Layer.provide(feed))
      return yield* Effect.gen(function* () {
        const watched = usageWatching(provider(cliOf, events, release)).pipe(
          Layer.provide(Layer.succeed(UsageMemory, yield* UsageMemory)),
        )
        const answer = Effect.flatMap(call(new Request("http://localhost/api/usage")), jsonOf).pipe(
          Effect.provide(watched),
          Effect.provideService(Lib, lib),
        )
        const before = yield* answer
        const run = Effect.flatMap(Provider, (p) =>
          Stream.runDrain(p.run({ ...request, model: "codex/gpt-5.6" })),
        )
        const turn = yield* Effect.fork(Effect.provide(run, watched))
        yield* settle
        const during = yield* answer
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(turn)
        return { before, during, after: yield* answer }
      }).pipe(Effect.provide(memory))
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise)

  it("lists Claude alone where no agent names a Codex model", async () => {
    const { before, after } = await answersOver(base, [report(WINDOWS)])
    const claudeOnly = {
      clis: [{ cli: "claude", polling: false, usage: { _tag: "NotRead" } }],
    }
    expect(before).toEqual(claudeOnly)
    expect(after).toEqual(claudeOnly)
  })

  it("lists Codex after Claude, not read and not polling until a Codex turn reports", async () => {
    const { before, during, after } = await answersOver(withCodex(), [report(WINDOWS)])
    const claude = { cli: "claude", polling: false, usage: { _tag: "NotRead" } }
    expect(before).toEqual({
      clis: [claude, { cli: "codex", polling: false, usage: { _tag: "NotRead" } }],
    })
    expect(during).toEqual({
      clis: [
        claude,
        { cli: "codex", polling: true, usage: { _tag: "Read", at: 0, windows: WINDOWS } },
      ],
    })
    expect(after).toEqual({
      clis: [
        claude,
        { cli: "codex", polling: false, usage: { _tag: "Read", at: 0, windows: WINDOWS } },
      ],
    })
  })
})
