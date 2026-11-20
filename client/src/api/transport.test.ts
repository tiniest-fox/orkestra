// @vitest-environment node
//
// The one file that opts out of the package's happy-dom default, because this tier is
// defined by touching no DOM.

/**
 * Tier 2 (`testing-tiers`): the real transport against a faked edge. MSW answers
 * the request the seam actually makes, so the URL, the method, the headers and the
 * decode are all under test — everything except a socket.
 *
 * **The fixtures are annotated with `@orkestra/shared` types**, which is
 * regression-checklist item 2: a handler returning a shape the DTO rejects is a
 * `tsc` failure, so a mock cannot drift from the contract. They are hand-written
 * wire literals rather than built with `.make` — the wire shape *is* the thing
 * under test, and `src/app/dto.test.ts` hand-writes the same literals on the
 * assertion side for the same reason.
 *
 * Handlers match on method and URL, never on call order.
 *
 * `document` is stubbed rather than mounted: `http.ts` resolves every path
 * against `document.baseURI`, and Node has no document. That is one line here instead
 * of a base-URL branch in shipped code — see `client/vite.config.ts` on why there
 * is no base URL to configure.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { vi } from "vitest"
import { setupServer } from "msw/node"
import { http, HttpResponse } from "msw"
import { ParseResult } from "effect"
import type { CreatedDto, MergePreviewDto } from "@orkestra/shared/dto/actions"
import type { ChangesDto } from "@orkestra/shared/dto/changes"
import type { RefusalDto } from "@orkestra/shared/dto/common"
import type { ForgeListingDto, PullRequestDto } from "@orkestra/shared/dto/forge"
import type { HealthDto } from "@orkestra/shared/dto/host-engine"
import type { OpenersDto } from "@orkestra/shared/dto/openers"
import type { EngineFrameDto } from "@orkestra/shared/dto/stream"
import type { DriveFrameDto } from "@orkestra/shared/dto/trak-frames"
import type {
  ViewDto,
  ViewResultDto,
  TrakDetailDto,
  TrakSummaryDto,
} from "@orkestra/shared/dto/trak"
import { ENGINE_FRAME_TAGS, EngineFrameDto as EngineFrameSchema } from "@orkestra/shared/dto/stream"
import {
  answer,
  approve,
  archiveTrak,
  archiveUnfinishedTrak,
  mergePreview,
  mergeTrak,
  commitAndMergeTrak,
  reenterTrak,
  resume,
  fileTrak,
  replan,
  sendChat,
  setHold,
  skipWait,
  setAutoMerge,
  setMergeMethod,
  setSkipChecks,
  setMode,
  stopTrak,
} from "./actions"
import { trakChanges } from "./changes"
import { engineBuild } from "./engine"
import { pullRequest, pullRequests } from "./forge"
import { ApiError, RefusedError, login, session } from "./http"
import { chooseOpener, listOpeners, openCheckout } from "./openers"
import { openEngineStream } from "./stream"
import { listTraks, fetchView, callViewTool, trakDetail, trakImageUrl } from "./trak"

const ORIGIN = "http://localhost"
const ID = "trak-1"

const SUMMARY: TrakSummaryDto = {
  id: ID,
  description: "add a client",
  state: { _tag: "AwaitingHuman", step: 2, kind: "approval" },
  running: false,
  mode: "manual",
  branchMoved: false,
}

const DETAIL: TrakDetailDto = {
  id: ID,
  description: "add a client",
  mode: "manual",
  holding: false,
  skippingChecks: false,
  messages: [],
  returned: [],
  state: { _tag: "AwaitingHuman", step: 2, kind: "approval" },
  decisions: [
    { text: "the admin view is out of scope", source: "stated", at: "0-plan", id: "0-plan.1" },
  ],
  marks: [],
  nextChecks: [],
  deployScript: false,
  log: [
    { _tag: "TrakCreated", description: "add a client" },
    { _tag: "WorkCommitted" },
    {
      _tag: "AgentReturned",
      step: 2,
      sessionId: "s-1",
      output: { type: "artifact", sections: { Summary: "x" } },
    },
  ],
  transcript: [
    { _tag: "Spawned", pid: 123 },
    { _tag: "Tool", name: "Read", kind: "Read", detail: "src/a.ts" },
  ],
  custody: {},
}

const server = setupServer()

beforeAll(() => {
  // `onUnhandledRequest: "error"` is not optional. Without it a typo'd path leaves
  // the process and fails as a timeout somewhere unrelated.
  vi.stubGlobal("document", { baseURI: `${ORIGIN}/` })
  server.listen({ onUnhandledRequest: "error" })
})
afterEach(() => {
  server.resetHandlers()
})
afterAll(() => {
  server.close()
  vi.unstubAllGlobals()
})

/** Answers one path with a bare status and reason phrase, the way the engine does. */
const refuses = (path: string, status: number, statusText: string) =>
  http.get(`${ORIGIN}${path}`, () => new HttpResponse(null, { status, statusText }))

describe("listTraks", () => {
  it("GETs the same-origin /api/traks and returns the live rows and the archived count", async () => {
    let seen = ""
    server.use(
      http.get(`${ORIGIN}/api/traks`, ({ request }) => {
        seen = request.url
        return HttpResponse.json({ traks: [SUMMARY], archived: 134 })
      }),
    )

    expect(await listTraks()).toEqual({ traks: [SUMMARY], archived: 134 })
    expect(seen).toBe(`${ORIGIN}/api/traks`)
  })

  it("rejects with a ParseError when the server sends a shape the DTO refuses", async () => {
    // A bare array is the shape an older engine sends, and it is refused whole.
    server.use(http.get(`${ORIGIN}/api/traks`, () => HttpResponse.json([SUMMARY])))

    // The whole reason `effect` is a value import in the seam: a stale server is
    // one legible failure here, not an undefined field in a component later.
    await expect(listTraks()).rejects.toBeInstanceOf(ParseResult.ParseError)
    await expect(listTraks()).rejects.not.toBeInstanceOf(ApiError)
  })
})

describe("trakDetail", () => {
  it("GETs /api/traks/:id and decodes the log, transcript and custody", async () => {
    server.use(http.get(`${ORIGIN}/api/traks/${ID}`, () => HttpResponse.json(DETAIL)))

    const detail = await trakDetail(ID)
    // The log round-tripping is what `planView` and `turns.ts` both read.
    expect(detail.log).toEqual(DETAIL.log)
    expect(detail.transcript).toEqual(DETAIL.transcript)
    expect(detail.custody).toEqual({})
  })

  it("leaves an optional field the wire omitted absent, not undefined", async () => {
    server.use(http.get(`${ORIGIN}/api/traks/${ID}`, () => HttpResponse.json(DETAIL)))

    const detail = await trakDetail(ID)
    expect("proposal" in detail).toBe(false)
    expect("worktree" in detail).toBe(false)
    // `toStrictEqual`, not `toEqual`: the latter treats an explicit `sha: undefined`
    // as equal to no `sha` at all, which is the distinction being asserted.
    expect(detail.log.filter((e) => e._tag === "WorkCommitted")).toStrictEqual([
      { _tag: "WorkCommitted" },
    ])
  })

  it("rejects with a 404 ApiError for an unknown id", async () => {
    server.use(refuses(`/api/traks/nope`, 404, "Not Found"))

    await expect(trakDetail("nope")).rejects.toBeInstanceOf(ApiError)
    await expect(trakDetail("nope")).rejects.toMatchObject({ status: 404 })
  })
})

describe("approve", () => {
  const CREATED: CreatedDto = { id: ID }

  it("POSTs the Approve action as JSON, with the content-type the server requires", async () => {
    let seen: { url: string; type: string | null; body: unknown } | undefined
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/act`, async ({ request }) => {
        seen = {
          url: request.url,
          type: request.headers.get("content-type"),
          body: await request.json(),
        }
        return HttpResponse.json(CREATED, { status: 202 })
      }),
    )

    await approve(ID)

    // The body is `ActRequestDto`'s `approve` member. The header is load-bearing:
    // `schemaBodyJson` refuses a body without it, and that arrives as a 400 nothing
    // in the UI can explain.
    expect(seen?.body).toEqual({ action: "approve" })
    expect(seen?.type).toBe("application/json")
    expect(seen?.url).toBe(`${ORIGIN}/api/traks/${ID}/act`)
  })

  it("escapes the id rather than pasting it into the path", async () => {
    let seen = ""
    server.use(
      http.post(`${ORIGIN}/api/traks/:id/act`, ({ request }) => {
        seen = request.url
        return HttpResponse.json(CREATED, { status: 202 })
      }),
    )

    await approve("a/b")
    expect(seen).toBe(`${ORIGIN}/api/traks/a%2Fb/act`)
  })

  /**
   * The two the server answers an approval with, and both are `409` — told apart by the
   * body, never by the reason phrase. This is the case `RefusedError` exists for: a
   * surface switching on a phrase breaks the day the engine is not reached over HTTP/1.1.
   */
  it("hands back the refusal the engine explained, not a bare status", async () => {
    const driving: RefusalDto = { _tag: "Driving" }
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/act`, () =>
        HttpResponse.json(driving, { status: 409, statusText: "Driving" }),
      ),
    )

    await expect(approve(ID)).rejects.toBeInstanceOf(RefusedError)
    await expect(approve(ID)).rejects.toMatchObject({ status: 409, refusal: driving })
  })

  it("falls back to ApiError when the refusal carries no body to read", async () => {
    server.use(
      http.post(
        `${ORIGIN}/api/traks/${ID}/act`,
        () => new HttpResponse(null, { status: 404, statusText: "Not Found" }),
      ),
    )

    await expect(approve(ID)).rejects.toBeInstanceOf(ApiError)
  })
})

describe("setMode", () => {
  it("POSTs its own route with the mode, and nothing else", async () => {
    let seen: { url: string; body: unknown } | undefined
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/mode`, async ({ request }) => {
        seen = { url: request.url, body: await request.json() }
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await setMode(ID, "auto")
    // `204` and no body: nothing was forked, and the stream carries the new mode.
    expect(seen?.body).toEqual({ mode: "auto" })
    expect(seen?.url).toBe(`${ORIGIN}/api/traks/${ID}/mode`)
  })

  it("hands back the refusal the engine explained, as an approval does", async () => {
    const atRest: RefusalDto = { _tag: "AtRest" }
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/mode`, () =>
        HttpResponse.json(atRest, { status: 409, statusText: "AtRest" }),
      ),
    )

    await expect(setMode(ID, "manual")).rejects.toMatchObject({ status: 409, refusal: atRest })
  })
})

describe("setHold", () => {
  it("POSTs its own route with the switch's new position", async () => {
    let seen: unknown
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/hold`, async ({ request }) => {
        seen = await request.json()
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await setHold(ID, true)
    expect(seen).toEqual({ holding: true })
  })

  it("hands back the refusal a manual trak answers with", async () => {
    const onManual: RefusalDto = { _tag: "OnManual" }
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/hold`, () =>
        HttpResponse.json(onManual, { status: 409, statusText: "OnManual" }),
      ),
    )

    await expect(setHold(ID, true)).rejects.toBeInstanceOf(RefusedError)
    await expect(setHold(ID, true)).rejects.toMatchObject({ status: 409, refusal: onManual })
  })
})

describe("setSkipChecks", () => {
  it("POSTs its own route with the switch's new position", async () => {
    let seen: unknown
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/skip-checks`, async ({ request }) => {
        seen = await request.json()
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await setSkipChecks(ID, true)
    expect(seen).toEqual({ skipping: true })
  })
})

describe("setAutoMerge", () => {
  it("POSTs its own route with the switch's new position", async () => {
    let seen: unknown
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/auto-merge`, async ({ request }) => {
        seen = await request.json()
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await setAutoMerge(ID, false)
    expect(seen).toEqual({ on: false })
  })
})

describe("setMergeMethod", () => {
  it("POSTs its own route with the picked method", async () => {
    let seen: unknown
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/merge-method`, async ({ request }) => {
        seen = await request.json()
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await setMergeMethod(ID, "rebase")
    expect(seen).toEqual({ method: "rebase" })
  })
})

describe("sendChat", () => {
  it("POSTs the Chat action with the message, and names no step", async () => {
    let seen: unknown
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/act`, async ({ request }) => {
        seen = await request.json()
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )

    await sendChat(ID, "smaller, and skip the migration", [])

    // `ActRequestDto`'s `chat` member, whole. The position is deliberately absent: the
    // server reads the gate off `state` and takes the step from it, so a client that has
    // fallen behind is refused rather than landing an event at the wrong index.
    expect(seen).toEqual({ action: "chat", message: "smaller, and skip the migration" })
  })

  it("names the attached files by their upload ids, and sends no field where there are none", async () => {
    let seen: unknown
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/act`, async ({ request }) => {
        seen = await request.json()
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )

    await sendChat(ID, "this overlaps", ["up-1", "up-2"])

    expect(seen).toEqual({
      action: "chat",
      message: "this overlaps",
      attachments: ["up-1", "up-2"],
    })
  })

  it("hands back the refusal the engine explained, as an approval does", async () => {
    const parked: RefusalDto = { _tag: "NotParked" }
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/act`, () =>
        HttpResponse.json(parked, { status: 409, statusText: "NotParked" }),
      ),
    )

    await expect(sendChat(ID, "hello", [])).rejects.toMatchObject({ status: 409, refusal: parked })
  })
})

describe("answer", () => {
  it("POSTs the AnswerQuestions action as a bare positional list", async () => {
    let seen: unknown
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/act`, async ({ request }) => {
        seen = await request.json()
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )

    await answer(ID, ["list only", "yes, behind the flag"])

    // `ActRequestDto`'s `answer` member, whole. **No question id, no option index and no
    // step**: `AnswerQuestionsActionDto` is `Array(String)` and the engine numbers it
    // against the questions it still holds in its session, so the order is the only thing
    // joining an answer to what it answers.
    expect(seen).toEqual({ action: "answer", answers: ["list only", "yes, behind the flag"] })
  })

  it("carries a note beside the list, and omits the key when there is none", async () => {
    const bodies: unknown[] = []
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/act`, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )

    await answer(ID, ["list only"], "we ship this on Friday")
    await answer(ID, ["list only"])

    // Not appended to `answers`: the list is numbered against the questions, so a note
    // inside it is an answer to one that was never asked. And absent rather than empty,
    // so a send without one is the body this route took before the field existed.
    expect(bodies).toEqual([
      { action: "answer", answers: ["list only"], note: "we ship this on Friday" },
      { action: "answer", answers: ["list only"] },
    ])
  })

  it("hands back the refusal the engine explained, as an approval does", async () => {
    const driving: RefusalDto = { _tag: "Driving" }
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/act`, () =>
        HttpResponse.json(driving, { status: 409, statusText: "Driving" }),
      ),
    )

    await expect(answer(ID, ["list only"])).rejects.toMatchObject({ status: 409, refusal: driving })
  })
})

describe("resume", () => {
  it("POSTs its own route with an empty body, naming no session", async () => {
    let seen: { url: string; type: string | null; body: unknown } | undefined
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/resume`, async ({ request }) => {
        seen = {
          url: request.url,
          type: request.headers.get("content-type"),
          body: await request.json(),
        }
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )

    await resume(ID)

    // `ResumeRequestDto` with its one optional field left off, which is the whole of the
    // decision: only the drive can say which session an interrupted turn was on, so a
    // client naming one would be guessing at a fact it has never been told. The header is
    // still load-bearing — `schemaBodyJson` refuses a body without it, empty or not.
    expect(seen?.body).toEqual({})
    expect(seen?.type).toBe("application/json")
    expect(seen?.url).toBe(`${ORIGIN}/api/traks/${ID}/resume`)
  })

  /** The only one this route can answer with — there is no parked check to refuse. */
  it("hands back the refusal the engine explained, as an approval does", async () => {
    const driving: RefusalDto = { _tag: "Driving" }
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/resume`, () =>
        HttpResponse.json(driving, { status: 409, statusText: "Driving" }),
      ),
    )

    await expect(resume(ID)).rejects.toMatchObject({ status: 409, refusal: driving })
  })
})

describe("skipWait", () => {
  it("POSTs its own route with no fields, because which step is held is the log's to say", async () => {
    let seen: { url: string; body: unknown } | undefined
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/run-now`, async ({ request }) => {
        seen = { url: request.url, body: await request.json() }
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )

    await skipWait(ID)

    expect(seen?.body).toEqual({})
    expect(seen?.url).toBe(`${ORIGIN}/api/traks/${ID}/run-now`)
  })

  /** The one refusal beyond custody: a press on a trak nothing holds. */
  it("hands back the refusal the engine explained", async () => {
    const notWaiting: RefusalDto = { _tag: "NotWaiting" }
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/run-now`, () =>
        HttpResponse.json(notWaiting, { status: 409, statusText: "NotWaiting" }),
      ),
    )

    await expect(skipWait(ID)).rejects.toMatchObject({ status: 409, refusal: notWaiting })
  })
})

/**
 * The diff surface's one read, and the one seam where the two halves of this feature can
 * drift apart: the client builds `at` and the route parses it, and nothing but this holds
 * the two forms against each other.
 *
 * **All three slice forms the picker can produce**, rather than the one that was never
 * going to move. `slicesFor` writes `all`, `uncommitted` and a position's index as a
 * string, and `requestedAt` on the engine side names exactly those three.
 */
describe("trakChanges", () => {
  const CHANGES: ChangesDto = {
    at: "2",
    files: [
      {
        path: "client/src/api/client.ts",
        change: "modified",
        additions: 1,
        deletions: 1,
        binary: false,
        hunks: [
          {
            oldStart: 12,
            oldCount: 2,
            newStart: 12,
            newCount: 2,
            heading: "const trakChanges",
            // Each `text` is the line without its `+`/`-`/space marker, which is what the
            // engine sends: `kind` is what that marker said, so a body carrying one here
            // would be a wire value nothing produces and would draw its sign twice.
            lines: [
              { kind: "context", text: "const at = 'all'", oldLine: 12, newLine: 12 },
              { kind: "del", text: "const url = path", oldLine: 13 },
              { kind: "add", text: "const url = `${path}?at=${at}`", newLine: 13 },
            ],
          },
        ],
      },
    ],
  }

  /** Answers the changes route whatever slice it is asked for, and hands back the URL seen. */
  const answers = (): (() => string) => {
    let seen = ""
    server.use(
      http.get(`${ORIGIN}/api/traks/${ID}/changes`, ({ request }) => {
        seen = request.url
        return HttpResponse.json(CHANGES)
      }),
    )
    return () => seen
  }

  it.each(["all", "uncommitted", "2"])("GETs the changes route asking for %s", async (at) => {
    const url = answers()

    await trakChanges(ID, at)

    expect(url()).toBe(`${ORIGIN}/api/traks/${ID}/changes?at=${at}`)
  })

  it("escapes the slice rather than pasting it into the query string", async () => {
    const url = answers()

    await trakChanges(ID, "a&at=b")

    // Pasted, this would reach the route as two `at` parameters and be answered about the
    // wrong slice — which is a wrong diff rather than a failure anybody would see.
    expect(url()).toBe(`${ORIGIN}/api/traks/${ID}/changes?at=a%26at%3Db`)
    expect(new URL(url()).searchParams.getAll("at")).toEqual(["a&at=b"])
  })

  it("leaves the file cap's count absent when the wire omitted it, not undefined", async () => {
    answers()

    const changes = await trakChanges(ID, "2")

    // Absent, not `undefined`: `omittedFiles` is optional on the DTO because *no files
    // were dropped* has no number to report, and a decode that materialised the key would
    // put one there. `toStrictEqual` on the files for the reason the detail test gives.
    expect("omittedFiles" in changes).toBe(false)
    expect(changes.files).toStrictEqual(CHANGES.files)
  })

  it("rejects with a 404 ApiError for a trak the engine does not know", async () => {
    server.use(refuses(`/api/traks/nope/changes`, 404, "Not Found"))

    await expect(trakChanges("nope", "all")).rejects.toBeInstanceOf(ApiError)
    await expect(trakChanges("nope", "all")).rejects.toMatchObject({ status: 404 })
  })
})

/**
 * The three endings, and the one read in front of them.
 *
 * Two of the four spend nothing — a merge and a close are `git` and a log line — and all
 * four are still the same seam: one route each, the refusal read off the body rather than
 * the reason phrase, and the id escaped rather than pasted in.
 */
describe("mergePreview", () => {
  it("GETs where a merge would go, and decodes a detached HEAD as an absent branch", async () => {
    const detached: MergePreviewDto = { branch: "trak/auto-commit" }
    server.use(http.get(`${ORIGIN}/api/traks/${ID}/merge`, () => HttpResponse.json(detached)))

    const preview = await mergePreview(ID)
    // Absent, not `undefined`: nowhere to merge to is a different fact from a branch
    // called nothing, and the DTO's own comment says so.
    expect("into" in preview).toBe(false)
    expect(preview.branch).toBe("trak/auto-commit")
  })

  it("carries the parent id that says this is a spawn's child", async () => {
    const child: MergePreviewDto = { branch: "trak/auto-commit-3-1", parentId: "parent-1" }
    server.use(http.get(`${ORIGIN}/api/traks/${ID}/merge`, () => HttpResponse.json(child)))

    expect((await mergePreview(ID)).parentId).toBe("parent-1")
  })
})

/**
 * The forge's answer, which is three answers — and two of them are ordinary rather than
 * failures. A `gh` that is missing, unauthenticated or pointed at a remote that is not a
 * forge comes back as `ForgeUnavailable` with a `200`, so nothing here rejects for any of
 * them; a rejection from this route means the engine itself broke.
 */
describe("pullRequest", () => {
  it("GETs the forge's answer and keeps the union apart", async () => {
    const none: PullRequestDto = { _tag: "NoPullRequest" }
    server.use(http.get(`${ORIGIN}/api/traks/${ID}/pull-request`, () => HttpResponse.json(none)))

    expect((await pullRequest(ID))._tag).toBe("NoPullRequest")
  })

  it("decodes a forge that could not be asked as an answer, not an error", async () => {
    const down: PullRequestDto = { _tag: "ForgeUnavailable", why: "gh is not authenticated" }
    server.use(http.get(`${ORIGIN}/api/traks/${ID}/pull-request`, () => HttpResponse.json(down)))

    expect(await pullRequest(ID)).toEqual(down)
  })

  it("decodes a whole pull request — its checks, its nested threads and its truncation", async () => {
    const found: PullRequestDto = {
      _tag: "PullRequest",
      branch: "trak/t1",
      number: 41,
      url: "https://github.com/o/r/pull/41",
      title: "Show a branch's pull request",
      state: "open",
      isDraft: false,
      merging: "conflicting",
      decision: "changesRequested",
      rollup: "failed",
      checks: [
        {
          id: "run:CR_1",
          name: "verify",
          verdict: "failed",
          at: 1_000,
          url: "https://example.invalid/9",
        },
      ],
      reviews: [
        {
          id: "PRR_1",
          who: "reviewer",
          verdict: "changesRequested",
          at: 1_000,
          url: "https://example.invalid/r",
          threads: [
            {
              path: "src/a.ts",
              line: 4,
              resolved: false,
              outdated: false,
              comments: [
                { who: "reviewer", body: "why here?", url: "https://example.invalid/c", at: 1_000 },
              ],
            },
          ],
        },
      ],
      conversation: [],
      truncated: ["checks"],
      mergeMethods: [],
    }
    server.use(http.get(`${ORIGIN}/api/traks/${ID}/pull-request`, () => HttpResponse.json(found)))

    expect(await pullRequest(ID)).toEqual(found)
  })

  /** A body this build cannot read is one error at the boundary rather than an undefined
   *  field reached for inside some component. */
  it("throws a parse error on a member it does not know", async () => {
    server.use(
      http.get(`${ORIGIN}/api/traks/${ID}/pull-request`, () =>
        HttpResponse.json({ _tag: "SomethingElse" }),
      ),
    )

    await expect(pullRequest(ID)).rejects.toBeInstanceOf(ParseResult.ParseError)
  })

  it("escapes the id rather than pasting it into the path", async () => {
    let seen = ""
    server.use(
      http.get(`${ORIGIN}/api/traks/:id/pull-request`, ({ request }) => {
        seen = request.url
        return HttpResponse.json({ _tag: "NoPullRequest" })
      }),
    )

    await pullRequest("a b/c")
    expect(seen).toBe(`${ORIGIN}/api/traks/a%20b%2Fc/pull-request`)
  })
})

/**
 * The list's half of the same seam, and a different route: one answer about every branch
 * rather than one per trak.
 *
 * The two members are what this tier exists to keep apart. *We could not ask* arrives with
 * a `200` like any other answer, and a caller that could not tell it from *here is
 * everything* would read a branch's absence — which means *no pull request* — off a body
 * that never named a branch at all.
 */
describe("pullRequests", () => {
  it("GETs one answer about the branches it names, keyed by branch", async () => {
    const listing: ForgeListingDto = {
      _tag: "PullRequests",
      entries: [
        {
          branch: "trak/a",
          pull: {
            number: 41,
            title: "Remember the last thing GitHub said about a branch",
            url: "https://github.com/o/r/pull/41",
            state: "open",
            isDraft: false,
            merging: "conflicting",
            decision: "changesRequested",
            checks: "failed",
          },
        },
        { branch: "trak/b" },
      ],
    }
    server.use(http.get(`${ORIGIN}/api/pull-requests`, () => HttpResponse.json(listing)))

    expect(await pullRequests(["trak/a", "trak/b"])).toEqual(listing)
  })

  it("decodes a forge that could not be asked as an answer, not an error", async () => {
    const down: ForgeListingDto = { _tag: "ForgeUnavailable", why: "gh is not installed" }
    server.use(http.get(`${ORIGIN}/api/pull-requests`, () => HttpResponse.json(down)))

    expect(await pullRequests(["trak/a"])).toEqual(down)
  })

  /** The entries are what makes a branch's absence readable, so a body without them is one
   *  error here rather than a page of rows quietly claiming nothing is in their way. */
  it("throws a parse error on an answer that carries no entries at all", async () => {
    server.use(
      http.get(`${ORIGIN}/api/pull-requests`, () => HttpResponse.json({ _tag: "PullRequests" })),
    )

    await expect(pullRequests(["trak/a"])).rejects.toBeInstanceOf(ParseResult.ParseError)
  })

  /** Not under `/api/traks` because it is not about one — and the branches ride on the
   *  query string, repeated, because the caller is what knows which rows are on screen. */
  it("names every branch on the query string, and asks no trak route", async () => {
    let seen = ""
    server.use(
      http.get(`${ORIGIN}/api/pull-requests`, ({ request }) => {
        seen = request.url
        return HttpResponse.json({ _tag: "PullRequests", entries: [] })
      }),
    )

    await pullRequests(["trak/a", "trak/b"])
    expect(seen).toBe(`${ORIGIN}/api/pull-requests?branch=trak%2Fa&branch=trak%2Fb`)
  })
})

describe("the actions that take no parameters", () => {
  // `mergeTrak`'s route reads the host branch itself, which is the same read `mergePreview`
  // showed before the press — `closing.md` decision 3 is that the two must not be two reads.
  it.each([
    ["mergeTrak", "the destination is not the caller's to name", "merge", mergeTrak],
    [
      "commitAndMergeTrak",
      "the parent is the route's to find",
      "commit-and-merge",
      commitAndMergeTrak,
    ],
    ["archiveTrak", "done with it has no parameters", "close", archiveTrak],
    ["stopTrak", "which turn and which session are the engine's", "stop", stopTrak],
    ["fileTrak", "the stop's twin, and the same reason", "file", fileTrak],
  ])("%s POSTs its route with an empty body — %s", async (_name, _why, route, call) => {
    let seen: { url: string; type: string | null; body: unknown } | undefined
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/${route}`, async ({ request }) => {
        seen = {
          url: request.url,
          type: request.headers.get("content-type"),
          body: await request.json(),
        }
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )

    await call(ID)

    expect(seen?.body).toEqual({})
    expect(seen?.type).toBe("application/json")
    expect(seen?.url).toBe(`${ORIGIN}/api/traks/${ID}/${route}`)
  })
})

describe("mergeTrak", () => {
  /**
   * The refusal this call exists to hand back whole. `Dirty` carries the files, and a
   * surface that only had the sentence could not tell somebody which ones to commit.
   */
  it("hands back the dirty host checkout with its file list intact", async () => {
    const dirty: RefusalDto = { _tag: "Dirty", files: ["src/a.ts", "src/b.ts"] }
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/merge`, () =>
        HttpResponse.json(dirty, { status: 409, statusText: "Dirty" }),
      ),
    )

    await expect(mergeTrak(ID)).rejects.toBeInstanceOf(RefusedError)
    await expect(mergeTrak(ID)).rejects.toMatchObject({ status: 409, refusal: dirty })
  })
})

describe("commitAndMergeTrak", () => {
  it("hands back the refusal for a child that is neither finished nor at a refused merge", async () => {
    const notFinished: RefusalDto = { _tag: "NotFinished" }
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/commit-and-merge`, () =>
        HttpResponse.json(notFinished, { status: 409, statusText: "NotFinished" }),
      ),
    )

    await expect(commitAndMergeTrak(ID)).rejects.toMatchObject({
      status: 409,
      refusal: notFinished,
    })
  })
})

describe("archiveTrak", () => {
  it("hands back the refusal for a trak that has already moved", async () => {
    const notFinished: RefusalDto = { _tag: "NotFinished" }
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/close`, () =>
        HttpResponse.json(notFinished, { status: 409, statusText: "NotFinished" }),
      ),
    )

    await expect(archiveTrak(ID)).rejects.toMatchObject({ status: 409, refusal: notFinished })
  })
})

describe("archiveUnfinishedTrak", () => {
  it("POSTs the reason the wire requires, empty — the confirmation is a press", async () => {
    let seen: { url: string; body: unknown } | undefined
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/abandon`, async ({ request }) => {
        seen = { url: request.url, body: await request.json() }
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )

    await archiveUnfinishedTrak(ID)

    // `AbandonRequestDto`'s field is required and the empty string satisfies it. Omitting
    // it would be a 400 from `schemaBodyJson` that nothing in the UI could explain.
    expect(seen?.body).toEqual({ reason: "" })
    expect(seen?.url).toBe(`${ORIGIN}/api/traks/${ID}/abandon`)
  })

  it("hands back the refusal for a trak that has already come to rest", async () => {
    const atRest: RefusalDto = { _tag: "AtRest" }
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/abandon`, () =>
        HttpResponse.json(atRest, { status: 409, statusText: "AtRest" }),
      ),
    )

    await expect(archiveUnfinishedTrak(ID)).rejects.toMatchObject({ status: 409, refusal: atRest })
  })
})

describe("stopTrak", () => {
  it("hands back the refusal for a position that is not an agent turn", async () => {
    const nothingToStop: RefusalDto = { _tag: "NothingToStop" }
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/stop`, () =>
        HttpResponse.json(nothingToStop, { status: 409, statusText: "NothingToStop" }),
      ),
    )

    await expect(stopTrak(ID)).rejects.toMatchObject({ status: 409, refusal: nothingToStop })
  })
})

describe("a view", () => {
  const view: ViewDto = {
    server: "metrics",
    tool: "show_dashboard",
    html: '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'"><p>x</p>',
    arguments: {},
    result: { content: [{ type: "text", text: "ok" }], isError: false },
    cli: "claude",
    answers: true,
  }

  it("is fetched whole by its call", async () => {
    server.use(http.get(`${ORIGIN}/api/traks/${ID}/views/toolu_01`, () => HttpResponse.json(view)))
    expect(await fetchView(ID, "toolu_01")).toEqual(view)
  })

  it("sends a press as a bare tool name and its arguments, and hands back the result", async () => {
    let body: unknown
    const result: ViewResultDto = { content: [], structured: { count: 1 }, isError: false }
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/views/toolu_01/call`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(result)
      }),
    )
    expect(await callViewTool(ID, "toolu_01", "press", { by: 1 })).toEqual(result)
    expect(body).toEqual({ tool: "press", arguments: { by: 1 } })
  })

  it("hands back the refusal for a tool the server does not open to views", async () => {
    const refusal: RefusalDto = { _tag: "ToolNotOpen" }
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/views/toolu_01/call`, () =>
        HttpResponse.json(refusal, { status: 403, statusText: "ToolNotOpen" }),
      ),
    )
    await expect(callViewTool(ID, "toolu_01", "reset", {})).rejects.toMatchObject({
      status: 403,
      refusal,
    })
  })
})

describe("fileTrak", () => {
  it("hands back the refusal for a parked conversation something else is driving", async () => {
    const driving: RefusalDto = { _tag: "Driving" }
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/file`, () =>
        HttpResponse.json(driving, { status: 409, statusText: "Driving" }),
      ),
    )

    await expect(fileTrak(ID)).rejects.toMatchObject({ status: 409, refusal: driving })
  })
})

describe("replan", () => {
  it("POSTs the act route with the reason as typed", async () => {
    let seen: unknown
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/act`, async ({ request }) => {
        seen = await request.json()
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )

    await replan(ID, "take the other approach")
    expect(seen).toEqual({ action: "replan", reason: "take the other approach" })
  })

  it("hands back the refusal for a trak that has moved past its gate", async () => {
    const notParked: RefusalDto = { _tag: "NotParked" }
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/act`, () =>
        HttpResponse.json(notParked, { status: 409, statusText: "NotParked" }),
      ),
    )

    await expect(replan(ID, "why")).rejects.toMatchObject({ status: 409, refusal: notParked })
  })
})

describe("reenterTrak", () => {
  it("POSTs the sentence the composer is going to be handed", async () => {
    let seen: unknown
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/reenter`, async ({ request }) => {
        seen = await request.json()
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )

    await reenterTrak(ID, "name the step by its instruction")

    // `ReenterRequestDto`, whose one required field is the sentence — which is why the
    // surface that sends this asks for one before it will press. **And no `agent` key at
    // all**, not one carrying `null`: absent is what the route reads as *the composer*, so
    // the plan door has to send the body it always sent.
    expect(seen).toEqual({ what: "name the step by its instruction" })
  })

  /** The second door. `generic` is the only name the route takes, and a name rather than a
   *  flag because it is what the log keeps — see `ReenterRequestDto`. */
  it("POSTs the agent's name when the press that fired named one", async () => {
    let seen: unknown
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/reenter`, async ({ request }) => {
        seen = await request.json()
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )

    await reenterTrak(ID, "why did the review step reject the first attempt?", "generic")

    expect(seen).toEqual({
      what: "why did the review step reject the first attempt?",
      agent: "generic",
    })
  })

  it("hands back the refusal for a trak that is still going", async () => {
    const notAtRest: RefusalDto = { _tag: "NotAtRest" }
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/reenter`, () =>
        HttpResponse.json(notAtRest, { status: 409, statusText: "NotAtRest" }),
      ),
    )

    await expect(reenterTrak(ID, "again")).rejects.toMatchObject({
      status: 409,
      refusal: notAtRest,
    })
  })
})

describe("the session", () => {
  it("is in on a 204, and out on a 401 — which is an answer rather than an error", async () => {
    server.use(http.get(`${ORIGIN}/api/session`, () => new HttpResponse(null, { status: 204 })))
    expect(await session()).toBe(true)
    server.use(http.get(`${ORIGIN}/api/session`, () => new HttpResponse(null, { status: 401 })))
    expect(await session()).toBe(false)
  })

  it("is an error for anything else, so an engine that is down is not a login screen", async () => {
    server.use(http.get(`${ORIGIN}/api/session`, () => new HttpResponse(null, { status: 500 })))
    await expect(session()).rejects.toBeInstanceOf(ApiError)
  })

  it("posts the passphrase as the wire's own shape, and a 401 is the refusal", async () => {
    let sent: unknown
    server.use(
      http.post(`${ORIGIN}/api/session`, async ({ request }) => {
        sent = await request.json()
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await login("correct horse")
    expect(sent).toEqual({ passphrase: "correct horse" })

    server.use(http.post(`${ORIGIN}/api/session`, () => new HttpResponse(null, { status: 401 })))
    await expect(login("wrong")).rejects.toMatchObject({ name: "ApiError", status: 401 })
  })
})

describe("listOpeners", () => {
  it("GETs the machine's terminals and editors and decodes the listing", async () => {
    const listing: OpenersDto = {
      terminal: {
        apps: [
          { id: "com.mitchellh.ghostty", name: "Ghostty", icon: "data:image/png;base64,AA==" },
          { id: "com.apple.Terminal", name: "Terminal" },
        ],
        chosen: "com.mitchellh.ghostty",
      },
      editor: { apps: [{ id: "dev.zed.Zed", name: "Zed" }], chosen: "dev.zed.Zed" },
    }
    server.use(http.get(`${ORIGIN}/api/openers`, () => HttpResponse.json(listing)))

    expect(await listOpeners()).toEqual(listing)
  })

  it("reads the platform's empty 204 as an answer, not an error", async () => {
    server.use(http.get(`${ORIGIN}/api/openers`, () => new HttpResponse(null, { status: 204 })))

    expect(await listOpeners()).toBe("unsupported")
  })
})

describe("chooseOpener", () => {
  it("POSTs the kind and the pick as the wire's own shape", async () => {
    let sent: unknown
    server.use(
      http.post(`${ORIGIN}/api/openers`, async ({ request }) => {
        sent = await request.json()
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await chooseOpener("editor", "dev.zed.Zed")
    expect(sent).toEqual({ kind: "editor", id: "dev.zed.Zed" })
  })

  it("rejects with the 400 an id the scan never returned earns", async () => {
    server.use(http.post(`${ORIGIN}/api/openers`, () => new HttpResponse(null, { status: 400 })))

    await expect(chooseOpener("terminal", "com.example.gone")).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
    })
  })
})

describe("openCheckout", () => {
  it("POSTs the trak's own route with the kind to open it with", async () => {
    let seen: { url: string; body: unknown } | undefined
    server.use(
      http.post(`${ORIGIN}/api/traks/${ID}/open`, async ({ request }) => {
        seen = { url: request.url, body: await request.json() }
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await openCheckout(ID, "editor")
    expect(seen?.body).toEqual({ kind: "editor" })
    expect(seen?.url).toBe(`${ORIGIN}/api/traks/${ID}/open`)
  })

  it("rejects with the 404 a deleted checkout answers", async () => {
    server.use(
      http.post(
        `${ORIGIN}/api/traks/${ID}/open`,
        () => new HttpResponse(null, { status: 404, statusText: "no-directory" }),
      ),
    )

    await expect(openCheckout(ID, "terminal")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
    })
  })
})

/**
 * A stand-in for the browser's `EventSource`, recording what is registered on it.
 *
 * MSW does not fake a server-sent stream, and the thing under test here is not the
 * wire but the registration: an `EventSource` dispatches a named event only to a
 * listener registered under that exact name, so a frame whose tag nothing registered
 * for is dropped before the seam sees it — silently, because nothing else is listening.
 */
class FakeEventSource {
  static readonly opened: FakeEventSource[] = []
  readonly listeners = new Map<string, (event: MessageEvent<string>) => void>()
  readonly href: string
  constructor(href: string) {
    this.href = href
    FakeEventSource.opened.push(this)
  }
  addEventListener(name: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(name, listener)
  }
  close(): void {}
}

describe("openEngineStream", () => {
  const DRIVE: DriveFrameDto = { _tag: "Drive", trak: ID, custody: { holder: { since: 1 } } }

  it("registers a listener for every tag the frame union has", () => {
    vi.stubGlobal("EventSource", FakeEventSource)
    openEngineStream(
      () => {},
      () => {},
      () => {},
    )
    const source = FakeEventSource.opened.at(-1)
    expect(source?.href).toBe(`${ORIGIN}/api/stream`)
    const registered = [...(source?.listeners.keys() ?? [])].filter(
      (n) => n !== "error" && n !== "open",
    )
    expect(registered).toEqual([...ENGINE_FRAME_TAGS])
    // The derivation is total over the union, and the regression that motivated it.
    expect(ENGINE_FRAME_TAGS).toHaveLength(EngineFrameSchema.members.length)
    expect(ENGINE_FRAME_TAGS).toContain("Drive")
  })

  it("hands a Drive frame to the caller decoded", () => {
    vi.stubGlobal("EventSource", FakeEventSource)
    const frames: EngineFrameDto[] = []
    openEngineStream(
      (frame) => frames.push(frame),
      () => {},
      () => {},
    )
    const source = FakeEventSource.opened.at(-1)
    source?.listeners.get("Drive")?.(new MessageEvent("Drive", { data: JSON.stringify(DRIVE) }))
    expect(frames).toEqual([DRIVE])
  })
})

describe("engineBuild", () => {
  it("reads an answer with no client field as no build id", async () => {
    // An engine from before the field, or one with no bundle to report.
    const old: HealthDto = { cwd: "/repo", version: "1" }
    server.use(http.get(`${ORIGIN}/api/health`, () => HttpResponse.json(old)))
    expect(await engineBuild()).toBeUndefined()
  })
})

describe("openEngineStream connecting", () => {
  it("calls onOpen on each connection the source makes", () => {
    vi.stubGlobal("EventSource", FakeEventSource)
    let opened = 0
    openEngineStream(
      () => {},
      () => {},
      () => {
        opened += 1
      },
    )
    const source = FakeEventSource.opened.at(-1)
    source?.listeners.get("open")?.(new MessageEvent("open"))
    source?.listeners.get("open")?.(new MessageEvent("open"))
    expect(opened).toBe(2)
  })
})

describe("under a path prefix", () => {
  // What a host serving this engine at `/p/x/` writes into the page's `<base>`.
  const PREFIXED = `${ORIGIN}/p/x/`
  beforeEach(() => {
    vi.stubGlobal("document", { baseURI: PREFIXED })
  })
  afterEach(() => {
    vi.stubGlobal("document", { baseURI: `${ORIGIN}/` })
  })

  it("GETs /api/traks under the prefix", async () => {
    let seen = ""
    server.use(
      http.get(`${PREFIXED}api/traks`, ({ request }) => {
        seen = request.url
        return HttpResponse.json({ traks: [SUMMARY], archived: 0 })
      }),
    )
    await listTraks()
    expect(seen).toBe(`${PREFIXED}api/traks`)
  })

  it("opens the stream under the prefix", () => {
    vi.stubGlobal("EventSource", FakeEventSource)
    openEngineStream(
      () => {},
      () => {},
      () => {},
    )
    expect(FakeEventSource.opened.at(-1)?.href).toBe(`${PREFIXED}api/stream`)
  })

  it("asks /api/health under the prefix, so a host reaches this project's engine", async () => {
    let seen = ""
    server.use(
      http.get(`${PREFIXED}api/health`, ({ request }) => {
        seen = request.url
        return HttpResponse.json({ cwd: "/repo", version: "1", client: "b1" })
      }),
    )
    expect(await engineBuild()).toBe("b1")
    expect(seen).toBe(`${PREFIXED}api/health`)
  })

  it("writes an image's address under the prefix", () => {
    expect(trakImageUrl(ID, "shot.png", 3)).toBe(
      `${PREFIXED}api/traks/${ID}/image?path=shot.png&v=3`,
    )
  })
})

describe("trakImageUrl with no prefix", () => {
  it("is the engine's own /api/ path", () => {
    expect(trakImageUrl(ID, "shot.png", 3)).toBe(
      `${ORIGIN}/api/traks/${ID}/image?path=shot.png&v=3`,
    )
  })
})
