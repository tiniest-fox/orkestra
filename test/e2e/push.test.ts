// Push: what the feed subscriber sends, what the routes keep, and what survives a
// restart.
//
// The subscriber test drives a real trak through its gates with the sender faked, which
// is the only way to hold the claim that matters: a phone is buzzed once per thing that
// newly wants a person, never per event. The fake's `sent` is a queue, so the test
// *waits* for a notification instead of sleeping — a payload that never comes fails by
// timeout, and one that comes twice fails the next `take`'s assertion.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Fiber, Logger, Queue, Ref, TestClock, TestContext } from "effect"
import webpush from "web-push"
import { describe, expect, it } from "vitest"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerRequest from "@effect/platform/HttpServerRequest"
import type { PushSubscriptionDto } from "@orkestra/shared/dto/host-engine"
import { composer, composerAsks, runFlow, runFlowWithAgentLog, step } from "../support/flow.js"
import { act, create, human, idle, workWaitingOn } from "../support/scenario.js"
import { memoryPush, type MemoryPush } from "../support/push-memory.js"
import { onPrompt, reply } from "../support/scripted-agent.js"
import { fail, pass } from "../support/scripted-checks.js"
import { settableClock } from "../support/clock.js"
import { Conditions } from "../../src/app/conditions.js"
import { apiRouter } from "../../src/app/server.js"
import {
  StoredPushLayer,
  forwardToPush,
  Push,
  type PushShape,
  type PushTransport,
} from "../../src/app/push.js"
import { openSqliteLines, sqliteStorePath } from "../../src/workflow/adapters/store-sqlite.js"
import { Feed } from "../../src/workflow/ports/feed.js"
import { Events } from "../../src/workflow/domain/event.js"
import { advance } from "../../src/workflow/runtime.js"

const call = (request: Request) =>
  Router.toHttpApp(apiRouter()).pipe(
    Effect.flatMap((app) =>
      Effect.provideService(app, ServerRequest.HttpServerRequest, ServerRequest.fromWeb(request)),
    ),
    Effect.scoped,
    Effect.orDie,
  )

const subscription = (endpoint: string): PushSubscriptionDto => ({
  endpoint,
  keys: { p256dh: "BPd-p256dh", auth: "auth-secret" },
})

describe("the feed subscriber", () => {
  it("sends one notification per gate, one at the end, and none for a re-parked gate", async () => {
    await runFlow([composer("work"), step(1, "work", reply.artifact("Added --json"))], (id) =>
      Effect.scoped(
        Effect.gen(function* () {
          const push = yield* memoryPush
          // Subscribe before anything appends, exactly as `serve.ts` does at boot.
          const feed = yield* Feed
          const replay = yield* feed.since(0)
          yield* Effect.forkScoped(Effect.provide(forwardToPush(replay.frames), push.layer))

          // Creating runs the composer and parks at the plan gate — one notification,
          // however many events it took to get there. The composer has returned by
          // then, so the body names the plan's title, not the request it was asked
          // with — the two differ here so the assertion can tell them apart.
          yield* create(id, "Please put the --json flag on the list command")
          expect(yield* Queue.take(push.sent)).toEqual({
            title: "Orkestra",
            body: "Add a --json flag is waiting on you",
            url: `/traks/${id}`,
            tag: `trak:${id}`,
          })

          // Approving runs the step, which files and parks again — the second.
          yield* act(id, 0, human.approve())
          expect((yield* Queue.take(push.sent)).body).toBe("Add a --json flag is waiting on you")

          // A restart at a gate re-parks it unchanged. The next payload taken below is
          // the ending, which is what says this appended no notification of its own.
          yield* advance(id, Events.restarted(undefined))

          yield* act(id, 1, human.approve())
          expect((yield* Queue.take(push.sent)).body).toBe("Add a --json flag finished")
          expect(yield* Queue.size(push.sent)).toBe(0)
        }),
      ),
    )
  })

  it("says failed when a turn fails", async () => {
    await runFlow(
      [composer("work"), onPrompt(/Produce the work\./, reply.failed("cannot"), "step")],
      (id) =>
        Effect.scoped(
          Effect.gen(function* () {
            const push = yield* memoryPush
            const feed = yield* Feed
            const replay = yield* feed.since(0)
            yield* Effect.forkScoped(Effect.provide(forwardToPush(replay.frames), push.layer))

            yield* create(id, "Add a --json flag")
            expect((yield* Queue.take(push.sent)).body).toBe("Add a --json flag is waiting on you")
            yield* act(id, 0, human.approve())
            expect((yield* Queue.take(push.sent)).body).toBe("Add a --json flag failed")
          }),
        ),
    )
  })

  it("falls back to the request while no plan exists", async () => {
    // A composer that asks parks the trak before any plan has landed, so there is no
    // title yet — the body names the request instead, exactly as a list row would.
    await runFlow([composerAsks("Which commands take the flag?")], (id) =>
      Effect.scoped(
        Effect.gen(function* () {
          const push = yield* memoryPush
          const feed = yield* Feed
          const replay = yield* feed.since(0)
          yield* Effect.forkScoped(Effect.provide(forwardToPush(replay.frames), push.layer))

          yield* create(id, "Please put the --json flag on the list command")
          expect((yield* Queue.take(push.sent)).body).toBe(
            "Please put the --json flag on the list command is waiting on you",
          )
        }),
      ),
    )
  })

  it("cuts a long name so the verb survives a lock screen", async () => {
    // A lock screen shows the opening of a body and cuts the rest, so the name is
    // capped and the whole body — verb included — is what the assertion holds.
    await runFlow([composerAsks("Which commands take the flag?")], (id) =>
      Effect.scoped(
        Effect.gen(function* () {
          const push = yield* memoryPush
          const feed = yield* Feed
          const replay = yield* feed.since(0)
          yield* Effect.forkScoped(Effect.provide(forwardToPush(replay.frames), push.layer))

          yield* create(
            id,
            "Please rework the whole of the settings surface so every toggle explains itself",
          )
          expect((yield* Queue.take(push.sent)).body).toBe(
            "Please rework the whole of the settings surface so every tog… is waiting on you",
          )
        }),
      ),
    )
  })

  it("flattens every run of whitespace in a name, and trims the ends", async () => {
    // One request carrying each whitespace shape a pasted one arrives with — a leading
    // and trailing space, a newline, two spaces, a newline against a tab — because the
    // clamp collapses runs rather than newlines, and a narrower rule would pass a test
    // that only holds `\n`. All five collapse to the same single-line body, which is
    // under the cap, so nothing here is also asserting the cut.
    await runFlow([composerAsks("Which commands take the flag?")], (id) =>
      Effect.scoped(
        Effect.gen(function* () {
          const push = yield* memoryPush
          const feed = yield* Feed
          const replay = yield* feed.since(0)
          yield* Effect.forkScoped(Effect.provide(forwardToPush(replay.frames), push.layer))

          yield* create(id, " We need two fixes:\n1.  loading on the main screen\n\t2. errors ")
          expect((yield* Queue.take(push.sent)).body).toBe(
            "We need two fixes: 1. loading on the main screen 2. errors is waiting on you",
          )
        }),
      ),
    )
  })
})

/**
 * A plan whose last entry waits on a condition, as `conditions.test.ts` builds one: the
 * step before it runs at once, and the wait rests the trak at `Finished` with the entry
 * still to run — the one rest that is not an ending.
 */
const ASKED_EVERY = 60

const waitingFleet = workWaitingOn(["pr-merged"], {
  checks: new Map([
    [
      "pr-merged",
      {
        name: "pr-merged",
        description: "Whether this branch's pull request has merged.",
        timeoutSeconds: 30,
        askedEverySeconds: ASKED_EVERY,
        exclusive: false,
        cache: true,
        ignoresLinguistGenerated: false,
        units: undefined,
        cacheAcross: "platform" as const,
        path: "/repo/.orkestra/checks/pr-merged.sh",
      },
    ],
  ]),
})

const held = [
  composer("plan", "work"),
  step(1, "plan", reply.artifact("the plan")),
  step(2, "work", reply.artifact("posted the update")),
]

const notYet = fail("pull request #7 is open", 1)
const gaveUp = fail("pull request #7 was closed without merging", 2)

/** Through the plan gate and the first step's gate to the rest, taking the two buzzes
 *  those gates earn on the way — the same path every held case walks. */
const untilHeld = (id: Parameters<typeof create>[0], sent: MemoryPush["sent"]) =>
  Effect.gen(function* () {
    yield* create(id, "Add a --json flag")
    expect((yield* Queue.take(sent)).body).toBe("Add a --json flag is waiting on you")
    yield* act(id, 0, human.approve())
    expect((yield* Queue.take(sent)).body).toBe("Add a --json flag is waiting on you")
    yield* act(id, 1, human.approve())
    yield* idle(id)
  })

/**
 * One sweep, one interval past now — the ask that changes the held trak's answer.
 * Suspended, so *now* is the moment of the sweep: a clock fixed when the file loaded is
 * behind the rest's own stamp once earlier files have run, and a sweep on it asks nothing.
 */
const sweepPastInterval = Effect.suspend(() =>
  Effect.flatMap(Conditions, (c) => c.sweep).pipe(
    Effect.withClock(settableClock(Date.now() + ASKED_EVERY * 1000).clock),
  ),
)

describe("the feed subscriber and a step held behind a condition", () => {
  it("says nothing at the rest, and says which condition gave up", async () => {
    await runFlowWithAgentLog(
      held,
      (id) =>
        Effect.scoped(
          Effect.gen(function* () {
            const push = yield* memoryPush
            const feed = yield* Feed
            const replay = yield* feed.since(0)
            yield* Effect.forkScoped(Effect.provide(forwardToPush(replay.frames), push.layer))

            yield* untilHeld(id, push.sent)
            // At `Finished` holding the entry: not finished, and not said to be. Nobody
            // owes the trak anything yet, so the phone hears nothing.
            expect(yield* Queue.size(push.sent)).toBe(0)

            // A restart re-parks the same rest, which is the same phase: still nothing.
            yield* advance(id, Events.restarted(undefined))
            yield* idle(id)
            expect(yield* Queue.size(push.sent)).toBe(0)

            // The sweep asks again and the script gives up. The tag has not moved, and
            // this is the one thing on a held trak a person has to be told.
            yield* sweepPastInterval
            expect((yield* Queue.take(push.sent)).body).toBe(
              "Add a --json flag gave up waiting on pr-merged",
            )
            expect(yield* Queue.size(push.sent)).toBe(0)
          }),
        ),
      waitingFleet,
      { "pr-merged": [notYet, gaveUp] },
    )
  })

  it("buzzes the gate and the ending as ever once the condition is met", async () => {
    await runFlowWithAgentLog(
      held,
      (id) =>
        Effect.scoped(
          Effect.gen(function* () {
            const push = yield* memoryPush
            const feed = yield* Feed
            const replay = yield* feed.since(0)
            yield* Effect.forkScoped(Effect.provide(forwardToPush(replay.frames), push.layer))

            yield* untilHeld(id, push.sent)
            expect(yield* Queue.size(push.sent)).toBe(0)

            // Met: the step runs by itself and parks at its own gate, which is worth a
            // buzz exactly as a gate reached by an approval is.
            yield* sweepPastInterval
            expect((yield* Queue.take(push.sent)).body).toBe("Add a --json flag is waiting on you")

            // And the plan running out with nothing held is the ending it always was.
            yield* act(id, 2, human.approve())
            expect((yield* Queue.take(push.sent)).body).toBe("Add a --json flag finished")
            expect(yield* Queue.size(push.sent)).toBe(0)
          }),
        ),
      waitingFleet,
      { "pr-merged": [notYet, pass] },
    )
  })
})

describe("the push routes", () => {
  it("hands out the key, keeps a subscription, and forgets it on DELETE", async () => {
    await runFlow([], () =>
      Effect.gen(function* () {
        const push = yield* memoryPush
        const routed = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          Effect.provide(effect, push.layer)

        const key = yield* routed(call(new Request("http://localhost/api/push")))
        expect(key.status).toBe(200)

        const kept = yield* routed(
          call(
            new Request("http://localhost/api/push", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(subscription("https://push.example/one")),
            }),
          ),
        )
        expect(kept.status).toBe(204)
        expect(yield* push.subscriptions).toEqual([subscription("https://push.example/one")])

        const gone = yield* routed(
          call(
            new Request(
              `http://localhost/api/push?endpoint=${encodeURIComponent("https://push.example/one")}`,
              { method: "DELETE" },
            ),
          ),
        )
        expect(gone.status).toBe(204)
        expect(yield* push.subscriptions).toEqual([])
      }),
    )
  })

  it("refuses a DELETE that names no endpoint", async () => {
    await runFlow([], () =>
      Effect.gen(function* () {
        const response = yield* call(new Request("http://localhost/api/push", { method: "DELETE" }))
        expect(response.status).toBe(400)
      }),
    )
  })
})

/** A directory that looks like a project — `orkestraDir` needs the marker. */
const newRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "orkestra-push-"))
  mkdirSync(join(dir, ".orkestra"), { recursive: true })
  return dir
}

const withPush = <A>(dir: string, body: (push: PushShape) => Effect.Effect<A, Error>): Promise<A> =>
  Effect.runPromise(Effect.flatMap(Push, body).pipe(Effect.provide(StoredPushLayer(dir))))

/** The push record the SQLite store under `dir` keeps, parsed. */
const kept = async (dir: string): Promise<unknown> => {
  const path = sqliteStorePath(join(dir, ".orkestra"))
  const text = await Effect.runPromise(
    Effect.scoped(Effect.flatMap(openSqliteLines(path), (db) => db.kept("push"))),
  )
  return text === undefined ? undefined : JSON.parse(text)
}

describe("the SQLite store", () => {
  it("mints the key once, and a subscription survives a rebuild", async () => {
    const dir = newRepo()
    const first = await withPush(dir, (push) =>
      Effect.as(push.subscribe(subscription("https://push.example/phone")), push.publicKey),
    )

    // A second build of the layer is an engine restart: same key, subscription intact.
    const second = await withPush(dir, (push) => Effect.succeed(push.publicKey))
    expect(second).toBe(first)
    expect(await kept(dir)).toMatchObject({
      publicKey: first,
      subscriptions: [subscription("https://push.example/phone")],
    })
    expect(existsSync(join(dir, ".orkestra", ".database", "push.json"))).toBe(false)

    await withPush(dir, (push) => push.unsubscribe("https://push.example/phone"))
    expect(await kept(dir)).toMatchObject({ subscriptions: [] })
  })

  it("takes the push.json an older engine wrote, mints nothing, and leaves the file", async () => {
    const dir = newRepo()
    const older = {
      ...webpush.generateVAPIDKeys(),
      subscriptions: [subscription("https://push.example/phone")],
    }
    mkdirSync(join(dir, ".orkestra", ".database"), { recursive: true })
    const path = join(dir, ".orkestra", ".database", "push.json")
    writeFileSync(path, JSON.stringify(older))

    const key = await withPush(dir, (push) => Effect.succeed(push.publicKey))

    expect(key).toBe(older.publicKey)
    expect(await kept(dir)).toEqual(older)
    expect(readFileSync(path, "utf8")).toBe(JSON.stringify(older))
  })

  it("refuses to regenerate over a record it cannot read", async () => {
    const dir = newRepo()
    mkdirSync(join(dir, ".orkestra", ".database"), { recursive: true })
    const path = join(dir, ".orkestra", ".database", "push.json")
    writeFileSync(path, "not json")
    const outcome = await Effect.runPromise(
      Effect.flatMap(Push, (push) => Effect.succeed(push.publicKey)).pipe(
        Effect.provide(StoredPushLayer(dir)),
        Effect.either,
      ),
    )
    expect(outcome._tag).toBe("Left")
    // The unreadable record is still there — a regenerated key would orphan every
    // subscription it held, silently.
    expect(readFileSync(path, "utf8")).toBe("not json")
    expect(await kept(dir)).toBeUndefined()
  })
})

/**
 * A push service per endpoint, answering by the endpoint's last path segment: `ok`
 * accepts, `gone` has forgotten the subscription, `bad` refuses it, and `slow` never
 * answers.
 */
const fakeService: PushTransport = (target) => {
  const last = target.endpoint.split("/").at(-1)
  if (last === "ok") return Promise.resolve({ statusCode: 201, body: "", headers: {} })
  if (last === "slow") return new Promise(() => undefined)
  const status = last === "gone" ? 410 : 400
  return Promise.reject(
    new webpush.WebPushError("unexpected", status, {}, '{"reason":"BadJwtToken"}', "x"),
  )
}

/** Every line the effect logs, as `LEVEL message`. */
const logged = <A>(effect: Effect.Effect<A, Error>): Promise<[A, readonly string[]]> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const lines = yield* Ref.make<readonly string[]>([])
      const logger = Logger.make(({ logLevel, message }) => {
        Effect.runSync(Ref.update(lines, (l) => [...l, `${logLevel.label} ${String(message)}`]))
      })
      const value = yield* Effect.provide(effect, Logger.replace(Logger.defaultLogger, logger))
      return [value, yield* Ref.get(lines)] as const
    }),
  )

const alicesOnly = (user: string | undefined): boolean => user === "gh:1"

describe("the sender", () => {
  it("logs one line per subscription naming the outcome, never the endpoint, and drops a gone one", async () => {
    const dir = newRepo()
    const [tried, lines] = await logged(
      Effect.flatMap(Push, (push) =>
        Effect.gen(function* () {
          yield* push.subscribe(subscription("https://web.push.apple.com/secret/ok"))
          yield* push.subscribe(subscription("https://fcm.googleapis.com/secret/gone"))
          yield* push.subscribe(subscription("https://updates.push.services.mozilla.com/bad"))
          return yield* push.sendTest
        }),
      ).pipe(Effect.provide(StoredPushLayer(dir, fakeService))),
    )
    expect(tried).toEqual([
      { service: "web.push.apple.com", accepted: true, said: "accepted (201)" },
      { service: "fcm.googleapis.com", accepted: false, said: "gone (410), dropped" },
      {
        service: "updates.push.services.mozilla.com",
        accepted: false,
        said: 'refused (400: {"reason":"BadJwtToken"}), kept',
      },
    ])
    expect(lines).toEqual([
      'INFO push: "A test notification from this engine" (test) to subscription 1 of 3: accepted (201)',
      'INFO push: "A test notification from this engine" (test) to subscription 2 of 3: gone (410), dropped',
      'INFO push: "A test notification from this engine" (test) to subscription 3 of 3: refused (400: {"reason":"BadJwtToken"}), kept',
    ])
    expect(lines.join("\n")).not.toContain("secret")
    expect(await kept(dir)).toMatchObject({
      subscriptions: [
        subscription("https://web.push.apple.com/secret/ok"),
        subscription("https://updates.push.services.mozilla.com/bad"),
      ],
    })
  })

  it("keeps whose device each subscription is, and sends to one user's devices alone", async () => {
    const dir = newRepo()
    const [, lines] = await logged(
      Effect.flatMap(Push, (push) =>
        Effect.gen(function* () {
          yield* push.subscribe(subscription("https://push.example/alice/ok"), "gh:1")
          yield* push.subscribe(subscription("https://push.example/bob/ok"), "gh:2")
          yield* push.sendTo({ title: "Orkestra", body: "x", url: "/", tag: "trak:t" }, alicesOnly)
        }),
      ).pipe(Effect.provide(StoredPushLayer(dir, fakeService))),
    )
    expect(lines).toEqual(['INFO push: "x" (trak:t) to subscription 1 of 1: accepted (201)'])
    expect(await kept(dir)).toMatchObject({
      subscriptions: [
        { ...subscription("https://push.example/alice/ok"), user: "gh:1" },
        { ...subscription("https://push.example/bob/ok"), user: "gh:2" },
      ],
    })
  })

  it("says so when there is nobody to send to", async () => {
    const [, lines] = await logged(
      Effect.flatMap(Push, (push) =>
        push.sendTo({ title: "Orkestra", body: "x", url: "/", tag: "trak:t" }, () => true),
      ).pipe(Effect.provide(StoredPushLayer(newRepo(), fakeService))),
    )
    expect(lines).toEqual(['INFO push: "x" (trak:t) has no subscription to go to'])
  })

  it("gives up on a push service that never answers, and keeps the subscription", async () => {
    const tried = await Effect.runPromise(
      Effect.flatMap(Push, (push) =>
        Effect.gen(function* () {
          yield* push.subscribe(subscription("https://push.example/slow"))
          const sending = yield* Effect.fork(push.sendTest)
          yield* TestClock.adjust("16 seconds")
          return yield* Fiber.join(sending)
        }),
      ).pipe(
        Effect.provide(StoredPushLayer(newRepo(), fakeService)),
        Effect.provide(TestContext.TestContext),
      ),
    )
    expect(tried).toEqual([
      { service: "push.example", accepted: false, said: "failed (no answer in 15s), kept" },
    ])
  })
})
