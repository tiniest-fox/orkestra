// The report routes over memory stores and a fake `Reports` that keeps what it was sent:
// refused where the host has no destination, a preview and a send that carry no secret the
// engine holds and no token-shaped string, the host's reference or reason as the answer,
// and the log left out where the list of secrets cannot be read. The cleaning and the cut
// themselves are `src/app/report.test.ts`'s.

import { Effect, Layer, Ref, Schema, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { toWeb, type HttpServerResponse } from "@effect/platform/HttpServerResponse"
import {
  type ReportDto,
  ReportDto as ReportSchema,
  ReportSendAnswerDto,
} from "@orkestra/shared/dto/report"
import { Provider, type ProviderRegistry } from "../../src/agent/ports/provider.js"
import { PublicPeopleLayer } from "../../src/app/people.js"
import { NoReportsLayer, Reports, type ReportSent } from "../../src/app/reports.js"
import { reportRoutes } from "../../src/app/routes/report.js"
import { PubSubFeedLayer } from "../../src/workflow/adapters/feed-pubsub.js"
import { MemoryGoalStoreLayer } from "../../src/workflow/adapters/goal-store-memory.js"
import { MemoryStoreLayer } from "../../src/workflow/adapters/store-memory.js"
import { Events } from "../../src/workflow/domain/event.js"
import { TrakId } from "../../src/workflow/domain/trak.js"
import { EngineLog } from "../../src/workflow/ports/engine-log.js"
import { EngineVersion } from "../../src/workflow/ports/engine-version.js"
import { Environment } from "../../src/workflow/ports/environment.js"
import { Store } from "../../src/workflow/ports/store.js"
import { mount } from "../support/http.js"
import { inheritedEnvironment } from "../support/scripted-environment.js"

const { get, post } = mount(reportRoutes)

const ID = TrakId.make("reported-trak")
/** The engine's own GitHub token, which it holds as a secret whoever started it. */
const HELD = "gho-held-by-the-engine-0123"
const SHAPED = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123"
const REQUEST = `Push fails with ${SHAPED} and ${HELD} set`

/** A provider that is never run: the routes read only its sign-in variables. */
const provider = Layer.succeed(Provider, {
  run: () => Stream.empty,
  stopBackgroundTask: () => Effect.succeed(false),
  steer: () => Effect.succeed(false),
  mcp: () => Effect.succeed(undefined),
  attend: () => Effect.die("unused"),
  cliFor: () => "claude",
  resumeFor: () => undefined,
  sessionFileFor: () => undefined,
  signInFileFor: () => undefined,
  resumeLineFor: () => undefined,
  credentials: [],
  gatesCommandsFor: () => false,
} satisfies ProviderRegistry)

/** The engine's environment holding `GH_TOKEN`, or one that cannot be read at all. */
const environment = (readable: boolean) =>
  Layer.effect(
    Environment,
    Effect.map(Environment, (env) => ({
      ...env,
      engine: readable ? Effect.succeed({ GH_TOKEN: HELD }) : Effect.die("unreadable"),
    })),
  ).pipe(Layer.provide(inheritedEnvironment))

/** A destination named `inbox` that keeps every report and answers `answer`. */
const keeping = (sent: Ref.Ref<readonly ReportDto[]>, answer: ReportSent) =>
  Layer.succeed(Reports, {
    destination: Effect.succeed({ name: "inbox" }),
    send: (report) =>
      Effect.as(
        Ref.update(sent, (all) => [...all, report]),
        answer,
      ),
  })

const seed = Effect.gen(function* () {
  const store = yield* Store
  // The request itself holds a token shape and a held value, as a pasted error would.
  yield* store.append(ID, [Events.trakCreated(REQUEST)], { after: 0 })
  yield* store.append(ID, [Events.mergeFailed(`refused near ${HELD} and ${SHAPED}`)], { after: 1 })
})

/** The engine a report route reads, under `reports` and an environment readable or not. */
const world = (reports: Layer.Layer<Reports>, secretsReadable: boolean) =>
  Layer.mergeAll(
    reports,
    provider,
    environment(secretsReadable),
    Layer.succeed(EngineVersion, "0.41.2"),
    Layer.succeed(EngineLog, {
      lines: Effect.succeed([{ at: 1, level: "WARN", message: `${ID} printed ${HELD}` }]),
    }),
    PublicPeopleLayer,
  ).pipe(
    Layer.provideMerge(Layer.mergeAll(MemoryStoreLayer, MemoryGoalStoreLayer)),
    Layer.provideMerge(PubSubFeedLayer),
  )

type World = Layer.Layer.Success<ReturnType<typeof world>>

const run = <A, E>(
  body: Effect.Effect<A, E, World>,
  reports: Layer.Layer<Reports>,
  secretsReadable = true,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* seed
      return yield* body
    }).pipe(Effect.provide(world(reports, secretsReadable)), Effect.orDie),
  )

const jsonOf = (response: HttpServerResponse): Effect.Effect<unknown> =>
  Effect.promise(async (): Promise<unknown> => {
    const parsed: unknown = await toWeb(response).json()
    return parsed
  })

const preview = Effect.flatMap(get(`/${ID}/report`), (r) =>
  Effect.map(jsonOf(r), Schema.decodeUnknownSync(ReportSchema)),
)

const send = (body: unknown) =>
  Effect.flatMap(post(ID, "report", body), (r) =>
    Effect.map(jsonOf(r), Schema.decodeUnknownSync(ReportSendAnswerDto)),
  )

describe("with no destination", () => {
  it("refuses the preview and the send as routes that do not exist", async () => {
    const statuses = await run(
      Effect.all([
        Effect.map(get(`/${ID}/report`), (r) => r.status),
        Effect.map(post(ID, "report", { includeLog: true }), (r) => r.status),
      ]),
      NoReportsLayer,
    )
    expect(statuses).toEqual([404, 404])
  })
})

describe("with a destination", () => {
  it("previews the cleaned log, with no note and no secret", async () => {
    const sent = Ref.unsafeMake<readonly ReportDto[]>([])
    const report = await run(preview, keeping(sent, { reference: "FB-1" }))
    expect(report.note).toBeUndefined()
    expect(report.log._tag).toBe("Included")
    expect(JSON.stringify(report)).not.toContain(HELD)
    expect(JSON.stringify(report)).not.toContain(SHAPED)
    expect(await Effect.runPromise(Ref.get(sent))).toEqual([])
  })

  it("sends the rebuilt report through the host and answers its reference", async () => {
    const sent = Ref.unsafeMake<readonly ReportDto[]>([])
    const answer = await run(
      send({ note: `It stopped; my key is ${SHAPED}`, includeLog: true }),
      keeping(sent, { reference: "https://reports.example/42" }),
    )
    expect(answer).toEqual({ _tag: "Sent", reference: "https://reports.example/42" })
    const [report, ...more] = await Effect.runPromise(Ref.get(sent))
    expect(more).toEqual([])
    expect(report?.trak.id).toBe(ID)
    expect(report?.note).toBe("It stopped; my key is [redacted]")
    expect(report?.log._tag).toBe("Included")
    for (const secret of [HELD, SHAPED]) expect(JSON.stringify(report)).not.toContain(secret)
  })

  it("sends no log where the person turned it off", async () => {
    const sent = Ref.unsafeMake<readonly ReportDto[]>([])
    await run(send({ includeLog: false }), keeping(sent, { reference: "FB-2" }))
    const [report] = await Effect.runPromise(Ref.get(sent))
    expect(report?.log).toEqual({ _tag: "LeftOut", reason: "turned-off" })
    expect(report?.note).toBeUndefined()
  })

  it("sends the trak's title and description cleaned, where its request holds a token", async () => {
    const sent = Ref.unsafeMake<readonly ReportDto[]>([])
    await run(send({ includeLog: true }), keeping(sent, { reference: "FB-5" }))
    const [report] = await Effect.runPromise(Ref.get(sent))
    expect(report?.trak.title).toBe("Push fails with [redacted] and [redacted] set")
    expect(report?.trak.description).toBe("Push fails with [redacted] and [redacted] set")
    for (const secret of [HELD, SHAPED]) expect(JSON.stringify(report)).not.toContain(secret)
  })

  it("withholds the request and the note where the secrets cannot be read", async () => {
    const sent = Ref.unsafeMake<readonly ReportDto[]>([])
    await run(
      send({ note: `pasted ${HELD}`, includeLog: true }),
      keeping(sent, { reference: "FB-6" }),
      false,
    )
    const [report] = await Effect.runPromise(Ref.get(sent))
    expect(report?.log).toEqual({ _tag: "LeftOut", reason: "secrets-unreadable" })
    expect(report?.withheld).toBe("secrets-unreadable")
    expect(report?.note).toBeUndefined()
    for (const secret of [HELD, SHAPED]) expect(JSON.stringify(report)).not.toContain(secret)
  })

  it("answers the host's reason where the send did not go", async () => {
    const sent = Ref.unsafeMake<readonly ReportDto[]>([])
    const answer = await run(
      send({ includeLog: true }),
      keeping(sent, { reason: "The receiver did not answer." }),
    )
    expect(answer).toEqual({ _tag: "NotSent", reason: "The receiver did not answer." })
  })

  it("leaves the log out of the preview and the send where the secrets cannot be read", async () => {
    const sent = Ref.unsafeMake<readonly ReportDto[]>([])
    const report = await run(
      Effect.zipLeft(preview, send({ includeLog: true })),
      keeping(sent, { reference: "FB-3" }),
      false,
    )
    expect(report.log).toEqual({ _tag: "LeftOut", reason: "secrets-unreadable" })
    const [delivered] = await Effect.runPromise(Ref.get(sent))
    expect(delivered?.log).toEqual({ _tag: "LeftOut", reason: "secrets-unreadable" })
  })

  it("answers 404 for a trak that does not exist", async () => {
    const sent = Ref.unsafeMake<readonly ReportDto[]>([])
    const status = await run(
      Effect.map(get("/no-such-trak/report"), (r) => r.status),
      keeping(sent, { reference: "FB-4" }),
    )
    expect(status).toBe(404)
  })
})
