// A file a person attaches: the upload route's limits, the file placed in the checkout the
// turn runs in — on this machine or through a sandbox — and what the turn is handed of it.

import { randomUUID } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Ref, Schema } from "effect"
import { toWeb, type HttpServerResponse } from "@effect/platform/HttpServerResponse"
import { describe, expect, it } from "vitest"
import { CreatedDto } from "@orkestra/shared/dto/actions"
import { AttachmentUploadedDto } from "@orkestra/shared/dto/attachments"
import { RefusalDto } from "@orkestra/shared/dto/common"
import { GoalDetailDto } from "@orkestra/shared/dto/goals"
import { TrakDetailDto } from "@orkestra/shared/dto/trak"
import { goalRoutes } from "../../src/app/goals.js"
import { placeUploads, UploadsLayer } from "../../src/app/attachments.js"
import { attachmentRoutes } from "../../src/app/routes/attachments.js"
import { actionRoutes } from "../../src/app/routes/actions.js"
import { trakRoutes } from "../../src/app/routes/trak.js"
import { promptImages, steeredMessage } from "../../src/workflow/runtime.js"
import { replayHistory } from "../../src/workflow/domain/replay.js"
import type { Event } from "../../src/workflow/domain/event.js"
import type { PromptImage } from "../../src/agent/types/session.js"
import { TrakId } from "../../src/workflow/domain/trak.js"
import { Store } from "../../src/workflow/ports/store.js"
import { Uploads } from "../../src/workflow/ports/uploads.js"
import type { CheckoutPlace } from "../../src/vcs/logic/paths.js"
import { Sandboxes, type SandboxesShape } from "../../src/vcs/ports/sandboxes.js"
import { Prompts } from "../../src/prompts/ports/prompts.js"
import { Lib } from "../../src/library/ports/library.js"
import {
  composer,
  composerRuns,
  onGit,
  runFlowWithAgentLog,
  step,
  stepRuns,
} from "../support/flow.js"
import { act, create, human, idle, logged } from "../support/scenario.js"
import { hangsOn, onPrompt, reply } from "../support/scripted-agent.js"
import { git, worktreeOf } from "../support/git.js"
import { mount } from "../support/http.js"

const { call, post } = mount(attachmentRoutes, actionRoutes, trakRoutes, goalRoutes)

/** The eight bytes every PNG opens with, which is all a test picture needs to be. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const upload = (name: string, type: string, bytes: Uint8Array) =>
  call(
    new Request(`http://localhost/api/attachments?name=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "content-type": type },
      body: bytes,
    }),
  )

const jsonOf = (response: HttpServerResponse): Effect.Effect<unknown> =>
  Effect.promise(async (): Promise<unknown> => {
    const parsed: unknown = JSON.parse(await toWeb(response).text())
    return parsed
  })

/** Upload one file and answer its id, failing the test where it is refused. */
const uploaded = (name: string, type: string, bytes: Uint8Array) =>
  Effect.gen(function* () {
    const response = yield* upload(name, type, bytes)
    expect(response.status).toBe(201)
    return Schema.decodeUnknownSync(AttachmentUploadedDto)(yield* jsonOf(response)).id
  })

const refusalOf = (response: HttpServerResponse) =>
  Effect.map(jsonOf(response), Schema.decodeUnknownSync(RefusalDto))

const ELEVEN = Array.from({ length: 11 }, String)

/** A body that never yields a byte. */
const neverEnds = (): Promise<void> => new Promise(() => undefined)

/** A body that yields 64 KB at a time, forever. */
const endlessChunks = (controller: ReadableStreamDefaultController<Uint8Array>): void => {
  controller.enqueue(new Uint8Array(64 * 1024))
}
const freshId = (): string => randomUUID()
const hasComposed = (tags: readonly string[]): boolean => tags.includes("ComposerReturned")
const isPress = (e: Event): boolean => e._tag === "HumanActed"
const isPressDto = (e: TrakDetailDto["log"][number]): boolean => e._tag === "HumanActed"
const isAskedDto = (e: GoalDetailDto["log"][number]): boolean => e._tag === "GoalAsked"
const mediaTypeOf = (image: PromptImage): string => image.mediaType

/** `GET` one route and answer its JSON. */
const read = (path: string) => Effect.flatMap(call(new Request(`http://localhost${path}`)), jsonOf)

const startTrak = (body: unknown) =>
  call(
    new Request("http://localhost/api/traks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )

/** A runner that holds every checkout: keeps each `place`, and reads back what was placed. */
const sandboxed = (placed: Ref.Ref<ReadonlyMap<string, string | Uint8Array>>): SandboxesShape => {
  const unreached = Effect.die("an attachment reaches no sandbox method but these")
  return {
    inUse: Effect.succeed(true),
    holds: () => Effect.succeed(true),
    placeOf: (path) => Effect.succeed({ trak: "t", path }),
    project: Effect.succeed(undefined),
    place: (_at: CheckoutPlace, files) =>
      Ref.update(placed, (held) => new Map([...held, ...files])),
    readInside: (_at, requested) =>
      Effect.map(Ref.get(placed), (held) => {
        const file = held.get(requested)
        return typeof file === "string" ? new TextEncoder().encode(file) : file
      }),
    shell: () => unreached,
    create: () => unreached,
    status: () => unreached,
    idOf: () => Effect.succeed(undefined),
    list: unreached,
    expose: () => unreached,
    reach: () => unreached,
    healthThrough: () => unreached,
    release: () => unreached,
    kill: () => unreached,
    transfer: () => unreached,
    retried: () => unreached,
    write: () => unreached,
    collect: () => unreached,
    moveOut: () => unreached,
    stats: () => unreached,
    copyHomeBack: () => unreached,
    copyHomeIn: () => unreached,
    awake: () => unreached,
    lost: () => unreached,
    resuming: () => Effect.succeed(false),
    remakeWith: () => unreached,
    stopIdleUnder: () => unreached,
    waitingBy: () => unreached,
    rebuild: () => unreached,
    rebuildOf: () => unreached,
    leftBehindTo: () => Effect.void,
    asWork: (work) => work,
  }
}

describe("the upload route", () => {
  it("refuses a disallowed type and a file over its limit, naming the limit", async () => {
    await runFlowWithAgentLog([], () =>
      Effect.gen(function* () {
        const svg = yield* upload("logo.svg", "image/svg+xml", new Uint8Array([60]))
        expect(svg.status).toBe(415)
        expect(yield* refusalOf(svg)).toStrictEqual({
          _tag: "AttachmentRefused",
          reason: "only PNG, JPEG, GIF and WebP images, PDFs and text files can be attached",
        })

        const big = yield* upload("shot.png", "image/png", new Uint8Array(5 * 1024 * 1024 + 1))
        expect(big.status).toBe(413)
        expect(yield* refusalOf(big)).toStrictEqual({
          _tag: "AttachmentRefused",
          reason: "an image can be at most 5 MB",
        })

        const binary = yield* upload("app.zip", "application/zip", new Uint8Array([1]))
        expect(binary.status).toBe(415)
      }),
    )
  })

  it("refuses a body its content-length says is too large, reading none of it", async () => {
    await runFlowWithAgentLog([], () =>
      Effect.gen(function* () {
        // The header claims 2 MB of text; the body is never offered, so a read would hang.
        const response = yield* call(
          new Request("http://localhost/api/attachments?name=log.txt", {
            method: "POST",
            headers: { "content-type": "text/plain", "content-length": String(2 * 1024 * 1024) },
            body: new ReadableStream({ pull: neverEnds }),
            duplex: "half",
          }),
        )
        expect(response.status).toBe(413)
        expect(yield* refusalOf(response)).toStrictEqual({
          _tag: "AttachmentRefused",
          reason: "a text file can be at most 1 MB",
        })
      }),
    )
  })

  it("stops reading a body with no content-length once it passes the limit", async () => {
    await runFlowWithAgentLog([], () =>
      Effect.gen(function* () {
        // 64 KB chunks without end: answered once 1 MB has passed, not when the body ends.
        const response = yield* call(
          new Request("http://localhost/api/attachments?name=log.txt", {
            method: "POST",
            headers: { "content-type": "text/plain" },
            body: new ReadableStream({ pull: endlessChunks }),
            duplex: "half",
          }),
        )
        expect(response.status).toBe(413)
      }),
    )
  })

  it("refuses a message carrying more than ten files, or one it does not hold", async () => {
    await runFlowWithAgentLog([], () =>
      Effect.gen(function* () {
        const ids = ELEVEN.map(freshId)
        const response = yield* startTrak({ description: "too many", attachments: ids })
        expect(response.status).toBe(422)
        expect(yield* refusalOf(response)).toStrictEqual({
          _tag: "AttachmentRefused",
          reason: "a message can carry at most 10 files",
        })
        const unknown = yield* startTrak({ description: "x", attachments: [crypto.randomUUID()] })
        expect(unknown.status).toBe(422)
      }),
    )
  })
})

describe("a file sent with a new trak", () => {
  it("lands in its checkout out of git's sight, and the composer is handed it", async () => {
    await onGit.runFlowWithAgentLog(
      [composer("plan"), step(1, "plan", reply.artifact("the work"))],
      (_id, agentLog) =>
        Effect.gen(function* () {
          const shot = yield* uploaded("shot.png", "image/png", PNG)
          const spec = yield* uploaded("spec.pdf", "application/pdf", new Uint8Array([37, 80]))
          const response = yield* startTrak({
            description: "fix the button",
            attachments: [shot, spec],
          })
          expect(response.status).toBe(202)
          const id = TrakId.make(Schema.decodeUnknownSync(CreatedDto)(yield* jsonOf(response)).id)
          yield* logged(id, hasComposed)

          const trak = replayHistory(id, yield* (yield* Store).events(id))
          const shotPath = `.orkestra/.attachments/${shot.slice(0, 8)}-shot.png`
          const specPath = `.orkestra/.attachments/${spec.slice(0, 8)}-spec.pdf`
          expect(trak.attachments).toStrictEqual([
            { name: "shot.png", type: "image/png", size: 8, path: shotPath },
            { name: "spec.pdf", type: "application/pdf", size: 2, path: specPath },
          ])
          const checkout = worktreeOf(trak).path
          expect(new Uint8Array(readFileSync(join(checkout, shotPath)))).toStrictEqual(PNG)
          expect(existsSync(join(checkout, specPath))).toBe(true)
          expect(git(checkout, "status", "--porcelain")).toBe("")

          const first = composerRuns(yield* agentLog)[0]
          expect(first?.prompt).toContain(`- \`${shotPath}\` (image/png)`)
          expect(first?.prompt).toContain(`- \`${specPath}\` (application/pdf)`)
          // The picture alone goes inline; the PDF is named by its path and nothing else.
          expect(first?.images).toStrictEqual([
            {
              path: join(checkout, shotPath),
              mediaType: "image/png",
              data: Buffer.from(PNG).toString("base64"),
            },
          ])
        }),
    )
  })
})

describe("a file held for a new trak", () => {
  it("is placed only by its own project's trak, not by another's of the same id", async () => {
    await runFlowWithAgentLog([], () =>
      Effect.gen(function* () {
        const shot = yield* uploaded("shot.png", "image/png", PNG)
        const path = `.orkestra/.attachments/${shot.slice(0, 8)}-shot.png`
        // Every engine on the machine shares the temporary folder, and a trak's id is
        // unique only in its project: two projects' traks may both be `child-1`.
        const ours = yield* Effect.provide(Uploads, UploadsLayer(mkdtempSync(join(tmpdir(), "a-"))))
        const theirs = yield* Effect.provide(
          Uploads,
          UploadsLayer(mkdtempSync(join(tmpdir(), "b-"))),
        )
        expect(yield* Effect.orDie(ours.hold([shot], "child-1"))).toMatchObject({
          attachments: [{ name: "shot.png", path }],
        })

        const elsewhere = mkdtempSync(join(tmpdir(), "elsewhere-"))
        yield* Effect.orDie(theirs.settle("child-1", elsewhere))
        expect(existsSync(join(elsewhere, path))).toBe(false)

        const checkout = mkdtempSync(join(tmpdir(), "checkout-"))
        yield* Effect.orDie(ours.settle("child-1", checkout))
        expect(new Uint8Array(readFileSync(join(checkout, path)))).toStrictEqual(PNG)
      }),
    )
  })
})

describe("a file sent in a chat at a step's gate", () => {
  it("is placed before the press is appended, and the resumed step is handed it", async () => {
    await runFlowWithAgentLog(
      [
        composer("plan"),
        step(1, "plan", reply.artifact("the work")),
        onPrompt(/look at this/u, reply.artifact("the work, fixed")),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          const trakId = id
          yield* create(trakId, "d")
          expect((yield* post(trakId, "act", { action: "approve" })).status).toBe(202)
          yield* idle(trakId)

          const shot = yield* uploaded("image.png", "image/png", PNG)
          const said = yield* post(trakId, "act", {
            action: "chat",
            message: "look at this",
            attachments: [shot],
          })
          expect(said.status).toBe(202)
          yield* idle(trakId)

          const events = yield* (yield* Store).events(trakId)
          const path = `.orkestra/.attachments/${shot.slice(0, 8)}-image.png`
          const chat = events.findLast(isPress)
          expect(chat).toMatchObject({
            action: {
              _tag: "Chat",
              message: "look at this",
              attachments: [{ name: "image.png", type: "image/png", size: 8, path }],
            },
          })
          const resumed = stepRuns(yield* agentLog).at(-1)
          expect(resumed?.prompt).toBe(
            `look at this\n\nAttached, in this checkout:\n- \`${path}\` (image/png)`,
          )
          expect(resumed?.images?.map(mediaTypeOf)).toStrictEqual(["image/png"])
        }),
    )
  })
})

describe("what the API answers for a sent message", () => {
  it("carries a trak chat's files on its action, read back through the trak's log", async () => {
    await runFlowWithAgentLog(
      [
        composer("plan"),
        step(1, "plan", reply.artifact("the work")),
        onPrompt(/look at this/u, reply.artifact("the work, fixed")),
      ],
      (id) =>
        Effect.gen(function* () {
          yield* create(id, "d")
          expect((yield* post(id, "act", { action: "approve" })).status).toBe(202)
          yield* idle(id)
          const shot = yield* uploaded("image.png", "image/png", PNG)
          const said = yield* post(id, "act", {
            action: "chat",
            message: "look at this",
            attachments: [shot],
          })
          expect(said.status).toBe(202)
          yield* idle(id)

          const detail = Schema.decodeUnknownSync(TrakDetailDto)(yield* read(`/api/traks/${id}`))
          const chat = detail.log.findLast(isPressDto)
          expect(chat).toMatchObject({
            action: {
              _tag: "Chat",
              message: "look at this",
              attachments: [
                {
                  name: "image.png",
                  type: "image/png",
                  size: 8,
                  path: `.orkestra/.attachments/${shot.slice(0, 8)}-image.png`,
                },
              ],
            },
          })
        }),
    )
  })

  it("carries a new goal's files on its opening sentence, read back through the goal's log", async () => {
    // On git, with the library rooted at the repository: a goal's files go where its
    // composer runs, which is the project's own root.
    await onGit.runFlowWithAgentLog(
      [hangsOn(/weigh what the sentence leaves open/)],
      (_id, _agents, _checks, repoDir) =>
        Effect.gen(function* () {
          const notes = yield* uploaded("notes.txt", "text/plain", new TextEncoder().encode("hi"))
          const started = yield* call(
            new Request("http://localhost/api/goals", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                asked: "Make search work",
                modes: ["smart"],
                attachments: [notes],
              }),
            }),
          )
          expect(started.status).toBe(202)
          const goal = Schema.decodeUnknownSync(CreatedDto)(yield* jsonOf(started)).id

          const detail = Schema.decodeUnknownSync(GoalDetailDto)(yield* read(`/api/goals/${goal}`))
          expect(detail.log.find(isAskedDto)).toMatchObject({
            asked: "Make search work",
            attachments: [
              {
                name: "notes.txt",
                type: "text/plain",
                size: 2,
                path: `.orkestra/.attachments/${notes.slice(0, 8)}-notes.txt`,
              },
            ],
          })
        }).pipe(
          Effect.provideServiceEffect(
            Lib,
            Effect.map(Lib, (held) => ({ ...held, root: repoDir })),
          ),
        ),
    )
  })
})

describe("a chat with a file that is refused", () => {
  it("keeps its upload, so the same id is taken when it is sent again", async () => {
    await runFlowWithAgentLog(
      [composer("plan"), step(1, "plan", reply.artifact("the work")), composer("plan")],
      (id) =>
        Effect.gen(function* () {
          yield* create(id, "d")
          yield* act(id, 0, human.approve())
          expect((yield* act(id, 1, human.approve())).state._tag).toBe("Finished")
          const shot = yield* uploaded("image.png", "image/png", PNG)

          // At rest nothing is ahead to read a chat: refused, and nothing written.
          const refused = yield* post(id, "act", {
            action: "chat",
            message: "look",
            attachments: [shot],
          })
          expect(refused.status).toBe(409)
          const checkout = worktreeOf(replayHistory(id, yield* (yield* Store).events(id))).path
          expect(existsSync(join(checkout, ".orkestra/.attachments"))).toBe(false)

          // The same id, sent with a new trak, is still held and is taken.
          const resent = yield* startTrak({ description: "look", attachments: [shot] })
          expect(resent.status).toBe(202)
          const other = TrakId.make(Schema.decodeUnknownSync(CreatedDto)(yield* jsonOf(resent)).id)
          yield* logged(other, hasComposed)
          expect(
            replayHistory(other, yield* (yield* Store).events(other)).attachments,
          ).toMatchObject([
            { name: "image.png", path: `.orkestra/.attachments/${shot.slice(0, 8)}-image.png` },
          ])
        }),
    )
  })
})

describe("a checkout in a sandbox", () => {
  it("is handed the file through the port, and a steered message reads it back", async () => {
    await runFlowWithAgentLog([], () =>
      Effect.gen(function* () {
        const placed = yield* Ref.make<ReadonlyMap<string, string | Uint8Array>>(new Map())
        const shot = yield* uploaded("shot.png", "image/png", PNG)
        const notes = yield* uploaded("notes.txt", "text/plain", new TextEncoder().encode("hi"))
        const run = Effect.provideService(Sandboxes, sandboxed(placed))

        const files = yield* run(placeUploads([shot, notes], "/sandboxed/checkout")).pipe(
          Effect.orDie,
        )
        expect(typeof files).not.toBe("string")
        if (typeof files === "string") return
        const { attachments } = files
        const shotPath = `.orkestra/.attachments/${shot.slice(0, 8)}-shot.png`
        const held = (yield* Ref.get(placed)).get(shotPath)
        expect(held instanceof Uint8Array ? new Uint8Array(held) : held).toStrictEqual(PNG)
        // Nothing was written on this machine: the checkout is the sandbox's.
        expect(existsSync("/sandboxed/checkout")).toBe(false)

        expect(yield* run(promptImages("/sandboxed/checkout", attachments))).toStrictEqual([
          {
            path: `/sandboxed/checkout/${shotPath}`,
            mediaType: "image/png",
            data: Buffer.from(PNG).toString("base64"),
          },
        ])
        const templates = yield* Prompts
        const steered = yield* run(
          steeredMessage(templates, "k", "also this", attachments, "/sandboxed/checkout"),
        )
        expect(steered.text).toContain(`- \`${shotPath}\` (image/png)`)
        expect(steered.images).toHaveLength(1)
      }),
    )
  })
})
