// What the forge half owes: the route, and the `gh` behind it.
//
// Two halves, and the fake moves between them. The route runs against the real
// engine with a scripted `Forge`, which is where *what crosses the wire* and
// *which traks may be asked about* are settled. The adapter runs against the
// real `GhForgeLayer` with a scripted `Process`, which is the only place the
// promises that make this safe to poll can be shown at all: one spawn per
// request, and every way of not reaching the forge arriving as one answer rather
// than as a 500 on a route a pane refetches.
//
// Nothing here reaches a network and nothing spawns `gh`. What each turn of the
// mapping means is settled in `src/vcs/logic/forge-answer.test.ts`, against a
// captured payload — this file asserts the plumbing around it.

import { seedLog } from "../support/seed.js"
import { Duration, Effect, Fiber, Layer, Schema, Stream, TestClock, TestContext } from "effect"
import { describe, expect, it } from "vitest"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerRequest from "@effect/platform/HttpServerRequest"
import { toWeb, type HttpServerResponse } from "@effect/platform/HttpServerResponse"
import { RefusalDto } from "@orkestra/shared/dto/common"
import {
  ForgeListingDto,
  PullRequestDto,
  PULL_REQUEST_BRANCH_LIMIT,
} from "@orkestra/shared/dto/forge"
import {
  Process,
  type ProcessShape,
  type ProcessSpec,
  type Spawned,
} from "../../src/agent/ports/process.js"
import { ProcessFailed } from "../../src/agent/types/errors.js"
import { GhForgeLayer } from "../../src/vcs/adapters/forge-gh.js"
import { OriginForgeLayer } from "../../src/vcs/adapters/forge-origin.js"
import { NoVcsLayer } from "../../src/vcs/adapters/none.js"
import { GitFailed } from "../../src/vcs/types/errors.js"
import type { HostStatus } from "../../src/vcs/types/host-status.js"
import { Forge } from "../../src/vcs/ports/forge.js"
import { Vcs } from "../../src/vcs/ports/vcs.js"
import {
  BranchName,
  ForgeAnswer,
  ForgeListing,
  ForgeMerge,
  ForgeOpen,
  type MergeMethod,
} from "../../src/vcs/index.js"
import { apiRouter } from "../../src/app/server.js"
import { Events } from "../../src/workflow/domain/event.js"
import { Store } from "../../src/workflow/ports/store.js"
import type { TrakId } from "../../src/workflow/domain/trak.js"
import { advance, type RuntimeError } from "../../src/workflow/runtime.js"
import { composer, type FlowDeps, runFlow, step } from "../support/flow.js"
import { forgeSaying, refusesMerge, refusesOpen } from "../support/forge.js"
import { recordingAfterMerge } from "../support/host-git.js"
import { act, create, expectState, human } from "../support/scenario.js"
import { reply } from "../support/scripted-agent.js"

// ============================================================================
// The route
// ============================================================================

/** As `http-api.test.ts` drives one: an Effect with a request provided, no socket. */
const get = (path: string) =>
  Router.toHttpApp(apiRouter()).pipe(
    Effect.flatMap((app) =>
      Effect.provideService(
        app,
        ServerRequest.HttpServerRequest,
        ServerRequest.fromWeb(new Request(`http://localhost/api/traks${path}`)),
      ),
    ),
    Effect.scoped,
    Effect.orDie,
  )

/**
 * The body through the published contract, which is an assertion in itself: an
 * answer the client's own decoder would reject fails here rather than being read
 * field by field.
 */
const pullRequestOf = (response: HttpServerResponse) =>
  Effect.map(
    Effect.promise(async (): Promise<unknown> => JSON.parse(await toWeb(response).text())),
    Schema.decodeUnknownSync(PullRequestDto),
  )

/** The listing's route, which takes no id and so hangs off `/api` rather than a trak. The
 *  branches ride on the query string, repeated. */
const getListing = (branches: readonly string[] = []) => {
  const query = new URLSearchParams(branches.map((branch) => ["branch", branch])).toString()
  return Router.toHttpApp(apiRouter()).pipe(
    Effect.flatMap((app) =>
      Effect.provideService(
        app,
        ServerRequest.HttpServerRequest,
        ServerRequest.fromWeb(
          new Request(`http://localhost/api/pull-requests${query === "" ? "" : `?${query}`}`),
        ),
      ),
    ),
    Effect.scoped,
    Effect.orDie,
  )
}

const listingOf = (response: HttpServerResponse) =>
  Effect.map(
    Effect.promise(async (): Promise<unknown> => JSON.parse(await toWeb(response).text())),
    Schema.decodeUnknownSync(ForgeListingDto),
  )

const ONE_STEP = [composer("plan"), step(1, "plan", reply.artifact("the work"))]

/** Enough of a pull request to see every part of it cross. */
const OPEN = ForgeAnswer.Found({
  pullRequest: {
    number: 7,
    url: "https://forge/pr/7",
    title: "Add a --json flag",
    state: "open",
    isDraft: false,
    merging: "behind",
    decision: "changesRequested",
    rollup: "failed",
    checks: [
      {
        id: "run:CR_1",
        name: "verify",
        verdict: "failed",
        at: 1_755_600_000_000,
        url: "https://forge/r/9",
      },
    ],
    reviews: [
      {
        id: "PRR_1",
        who: "ali",
        verdict: "changesRequested",
        at: 1_755_600_000_000,
        url: "https://forge/rev/1",
        body: "a few things",
        threads: [
          {
            path: "src/app/server.ts",
            line: 12,
            resolved: true,
            outdated: false,
            comments: [
              {
                who: "ali",
                body: "this reads oddly",
                url: "https://forge/c/1",
                at: 1_755_600_000_000,
              },
            ],
          },
        ],
      },
    ],
    conversation: [
      { who: "sam", body: "shipping this", url: "https://forge/c/2", at: 1_755_600_000_000 },
    ],
    truncated: ["threads"],
    mergeMethods: [],
  },
})

describe("what the route will say about a trak", () => {
  it("404s for a trak nothing has heard of", async () => {
    await runFlow(ONE_STEP, () =>
      Effect.gen(function* () {
        expect((yield* get("/no-such-trak/pull-request")).status).toBe(404)
      }),
    )
  })

  it("hands the forge's answer over whole, in the shape the client decodes", async () => {
    await runFlow(
      ONE_STEP,
      (id) =>
        Effect.gen(function* () {
          yield* create(id, "d")
          const body = yield* pullRequestOf(yield* get(`/${id}/pull-request`))
          // Compared against the answer itself rather than field by field: what
          // this route owes is the whole of what the forge said, and a check per
          // field is a check that stops covering the field somebody adds next.
          // `branch` rides beside it, and it is the route's own — the question
          // that was asked, not part of what the forge answered.
          expect(body).toStrictEqual({
            _tag: "PullRequest",
            branch: `trak/${id}`,
            ...OPEN.pullRequest,
          })
        }),
      undefined,
      undefined,
      forgeSaying(OPEN),
    )
  })

  /** The answering members name the branch they are about, so a browser can file either
   *  into its by-branch store — *there is none* included, which is an answer, not silence. */
  it("names the branch on an answer that there is no pull request", async () => {
    await runFlow(
      ONE_STEP,
      (id) =>
        Effect.gen(function* () {
          yield* create(id, "d")
          expect(yield* pullRequestOf(yield* get(`/${id}/pull-request`))).toStrictEqual({
            _tag: "NoPullRequest",
            branch: `trak/${id}`,
          })
        }),
      undefined,
      undefined,
      forgeSaying(ForgeAnswer.None()),
    )
  })

  it("says nothing at all where the forge could not be reached", async () => {
    await runFlow(
      ONE_STEP,
      (id) =>
        Effect.gen(function* () {
          yield* create(id, "d")
          expect(yield* pullRequestOf(yield* get(`/${id}/pull-request`))).toStrictEqual({
            _tag: "ForgeUnavailable",
            why: "gh could not be run: spawn gh ENOENT",
          })
        }),
      undefined,
      undefined,
      forgeSaying(ForgeAnswer.Unavailable({ why: "gh could not be run: spawn gh ENOENT" })),
    )
  })

  /**
   * The one case where the forge is never asked, and it has to be told apart from
   * an unreachable one: a trak with no branch has nothing anybody could have
   * opened a pull request from.
   */
  it("answers none for a trak that never got a checkout, without reaching the forge", async () => {
    await runFlow(
      ONE_STEP,
      (id) =>
        Effect.gen(function* () {
          const store = yield* Store
          yield* seedLog(store, id, [Events.trakCreated("d")])
          expect(yield* pullRequestOf(yield* get(`/${id}/pull-request`))).toStrictEqual({
            _tag: "NoPullRequest",
          })
        }),
      undefined,
      undefined,
      // Would answer `PullRequest` if it were consulted, which is what makes the
      // assertion above the assertion that it was not.
      forgeSaying(OPEN),
    )
  })

  it("changes nothing by being asked", async () => {
    await runFlow(
      ONE_STEP,
      (id) =>
        Effect.gen(function* () {
          const store = yield* Store
          yield* create(id, "d")
          const before = yield* store.events(id)
          yield* get(`/${id}/pull-request`)
          expect((yield* store.events(id)).length).toBe(before.length)
        }),
      undefined,
      undefined,
      forgeSaying(OPEN),
    )
  })
})

/**
 * Where a pull-request trak spends the rest of its life. The branch outlives the
 * checkout deliberately — see `replayHistory` — and this route is what depends on
 * it: by the time anybody is reading a review, the directory has gone.
 */
describe("a trak that is already over", () => {
  const overBy = async (
    ending: () => ReturnType<typeof Events.closed>,
    landed: "Closed" | "Merged",
  ): Promise<string> => {
    let answered = "the route was never asked"
    await runFlow(
      ONE_STEP,
      (id) =>
        Effect.gen(function* () {
          yield* create(id, "d")
          yield* act(id, 0, human.approve())
          yield* act(id, 1, human.approve())
          const over = yield* advance(id, ending())
          expectState(over, landed)
          // The checkout has gone and the branch has not, which is the whole of
          // why there is still something to ask about. `orDie`: git failing to
          // answer here would be a broken fixture, not an outcome under test.
          expect(yield* Effect.orDie((yield* Vcs).hasCheckout(id))).toBe(false)
          expect(over.worktree?.branch).toBeDefined()
          answered = (yield* pullRequestOf(yield* get(`/${id}/pull-request`)))._tag
        }),
      undefined,
      undefined,
      forgeSaying(OPEN),
    )
    return answered
  }

  it("still answers once the trak is closed and its checkout is gone", async () => {
    expect(await overBy(Events.closed, "Closed")).toBe("PullRequest")
  })

  it("still answers once the trak is merged and its checkout is gone", async () => {
    expect(await overBy(Events.merged, "Merged")).toBe("PullRequest")
  })
})

// ============================================================================
// The `gh` behind it
// ============================================================================

const BRANCH = BranchName.make("trak/abc")

const EMPTY = JSON.stringify({ data: { repository: { pullRequests: { nodes: [] } } } })

const exits = (code: number, stdout: string, stderr = ""): Spawned => ({
  pid: 4242,
  lines: Stream.fromIterable(stdout === "" ? [] : stdout.split("\n")),
  exited: Effect.succeed({ code, signal: undefined, stderr }),
  // `gh` is never spawned with stdin held, so nothing here reaches either.
  send: () => Effect.void,
  endInput: Effect.void,
})

/**
 * A `gh` that is spawned and then never says anything — the shape a network that
 * has stopped answering leaves, and the one failure a timeout is the only defence
 * against.
 */
const NEVER: Spawned = {
  pid: 4242,
  lines: Stream.never,
  exited: Effect.never,
  send: () => Effect.void,
  endInput: Effect.void,
}

const scriptedGh = (
  behaviour: Effect.Effect<Spawned, ProcessFailed>,
): { readonly layer: Layer.Layer<Forge>; readonly spawns: ProcessSpec[] } => {
  const spawns: ProcessSpec[] = []
  const proc = Layer.succeed(Process, {
    spawn: (spec) =>
      Effect.sync(() => {
        spawns.push(spec)
      }).pipe(Effect.zipRight(behaviour)),
    isAlive: () => Effect.succeed(false),
    kill: () => Effect.void,
    startTime: () => Effect.succeed(undefined),
    killExec: () => Effect.void,
  } satisfies ProcessShape)
  return { layer: GhForgeLayer("/repo").pipe(Layer.provide(proc)), spawns }
}

const asked = (gh: { readonly layer: Layer.Layer<Forge> }): Promise<ForgeAnswer> =>
  Effect.runPromise(
    Effect.provide(
      Effect.flatMap(Forge, (forge) => forge.pullRequest(BRANCH)),
      gh.layer,
    ),
  )

const listed = (
  gh: { readonly layer: Layer.Layer<Forge> },
  branches: readonly string[] = [BRANCH],
): Promise<ForgeListing> =>
  Effect.runPromise(
    Effect.provide(
      Effect.flatMap(Forge, (forge) => forge.listing(branches.map((b) => BranchName.make(b)))),
      gh.layer,
    ),
  )

/** What the listing query's own answer looks like — one aliased connection per branch. */
const noPulls = (howMany: number): string =>
  JSON.stringify({
    data: {
      repository: Object.fromEntries(
        Array.from({ length: howMany }, (_, i) => [`b${String(i)}`, { nodes: [] }]),
      ),
    },
  })

// ============================================================================
// A project with no `origin`
// ============================================================================

/** A forge that fails the test if anything asks it: with no `origin`, `gh` is never run. */
const neverAsked = Layer.succeed(Forge, {
  pullRequest: () => Effect.die("the forge was asked about a project with no origin"),
  listing: () => Effect.die("the forge was asked about a project with no origin"),
  merge: () => Effect.die("the forge was asked about a project with no origin"),
  openPullRequest: () => Effect.die("the forge was asked about a project with no origin"),
})

/** A `Vcs` whose host status is `status`, and otherwise the offline one. */
const hostSaying = (status: Effect.Effect<HostStatus, GitFailed>) =>
  Layer.effect(
    Vcs,
    Effect.map(Vcs, (vcs) => ({ ...vcs, hostStatus: () => status })),
  ).pipe(Layer.provide(NoVcsLayer))

const withOrigin = (origin: boolean) =>
  Effect.map(
    Effect.flatMap(Vcs, (vcs) => vcs.hostStatus()),
    (status): HostStatus => ({ ...status, origin }),
  ).pipe(Effect.provide(NoVcsLayer))

const guarded = (inner: Layer.Layer<Forge>, status: Effect.Effect<HostStatus, GitFailed>) =>
  OriginForgeLayer(inner).pipe(Layer.provide(hostSaying(status)))

describe("a project with no origin", () => {
  it("answers both forge routes NoOrigin without asking the forge", async () => {
    await runFlow(
      ONE_STEP,
      (id) =>
        Effect.gen(function* () {
          yield* create(id, "d")
          expect(yield* pullRequestOf(yield* get(`/${id}/pull-request`))).toStrictEqual({
            _tag: "NoOrigin",
          })
          expect(yield* listingOf(yield* getListing([`trak/${id}`]))).toStrictEqual({
            _tag: "NoOrigin",
          })
        }),
      undefined,
      undefined,
      guarded(neverAsked, withOrigin(false)),
    )
  })

  const listedThrough = (status: Effect.Effect<HostStatus, GitFailed>) =>
    Effect.runPromise(
      Effect.provide(
        Effect.flatMap(Forge, (forge) => forge.listing([BranchName.make(BRANCH)])),
        guarded(forgeSaying(ForgeAnswer.None(), ForgeListing.Listed({ entries: [] })), status),
      ),
    )

  it("asks the forge as before where there is an origin", async () => {
    expect(await listedThrough(withOrigin(true))).toStrictEqual(
      ForgeListing.Listed({ entries: [] }),
    )
  })

  /** *I could not tell whether there is a remote* is not *there is none*. */
  it("asks the forge where git cannot say whether there is an origin", async () => {
    const unread = Effect.fail(new GitFailed({ op: "read host status", reason: "no repository" }))
    expect(await listedThrough(unread)).toStrictEqual(ForgeListing.Listed({ entries: [] }))
  })
})

describe("reaching the forge", () => {
  it("spawns gh exactly once for the whole answer", async () => {
    const gh = scriptedGh(Effect.succeed(exits(0, EMPTY)))
    expect(await asked(gh)).toStrictEqual({ _tag: "None" })
    expect(gh.spawns.length).toBe(1)
  })

  it("asks for the branch, and lets gh name the repository from the directory", async () => {
    const gh = scriptedGh(Effect.succeed(exits(0, EMPTY)))
    await asked(gh)
    const [spec] = gh.spawns
    expect(spec?.command).toBe("gh")
    expect(spec?.args).toContain(`branch=${BRANCH}`)
    expect(spec?.args).toContain("owner={owner}")
    expect(spec?.args).toContain("name={repo}")
    // Ignored, so a `gh` with nobody logged in refuses instead of waiting for an
    // answer nobody is there to type. A prompt on a route is a request that never
    // returns.
    expect(spec?.stdin).toBeUndefined()
  })

  /**
   * The whole point of the listing, at the layer where it can be shown: one process for
   * every branch on a page, where asking per branch was one process each.
   */
  it("spawns gh exactly once however many branches it is asked about", async () => {
    const many = Array.from({ length: 30 }, (_, i) => `trak/${String(i)}`)
    const gh = scriptedGh(Effect.succeed(exits(0, noPulls(many.length))))
    const listing = await listed(gh, many)
    expect(listing._tag === "Listed" && listing.entries.map((entry) => entry.branch)).toStrictEqual(
      many,
    )
    expect(gh.spawns.length).toBe(1)
  })

  /** The branches it was handed and no others, each once — which is what makes an entry's
   *  absence readable as *nobody asked about you*. */
  it("names every branch it was handed, and nothing else", async () => {
    const many = ["trak/a", "trak/b", "trak/c"]
    const gh = scriptedGh(Effect.succeed(exits(0, noPulls(many.length))))
    await listed(gh, many)
    const [spec] = gh.spawns
    const named = (spec?.args ?? []).filter((arg) => /^b\d+=/.test(arg))
    expect(named).toStrictEqual(["b0=trak/a", "b1=trak/b", "b2=trak/c"])
    expect(spec?.args).toContain("owner={owner}")
    expect(spec?.stdin).toBeUndefined()
  })

  /** Nothing to ask about is not a call. A page with nothing finished on it is the
   *  ordinary case, and it must not cost a process. */
  it("spawns nothing at all when it is handed no branches", async () => {
    const gh = scriptedGh(Effect.succeed(exits(0, noPulls(0))))
    expect(await listed(gh, [])).toStrictEqual({ _tag: "Listed", entries: [] })
    expect(gh.spawns.length).toBe(0)
  })

  /**
   * The bound announces itself by leaving branches out rather than by answering about them:
   * a branch past it has no entry, which a caller draws as *we could not ask*.
   */
  it("asks about at most the wire's branch limit, and says nothing about the rest", async () => {
    // The limit is read rather than written down again: the surface asking cuts its own
    // list at the same number, and the two must not be able to drift apart.
    const limit = PULL_REQUEST_BRANCH_LIMIT
    const many = Array.from({ length: limit + 50 }, (_, i) => `trak/${String(i)}`)
    const gh = scriptedGh(Effect.succeed(exits(0, noPulls(limit))))
    const listing = await listed(gh, many)
    expect(listing._tag === "Listed" && listing.entries.length).toBe(limit)
    expect(gh.spawns.length).toBe(1)
    expect((gh.spawns[0]?.args ?? []).filter((arg) => /^b\d+=/.test(arg)).length).toBe(limit)
  })

  /** The same three ways of not reaching it, through the same call — and it must arrive as
   *  *we could not ask* rather than as an empty listing, which a caller reads as a fact
   *  about every branch it was drawing. */
  it("reads a gh it could not run as a listing it could not ask for", async () => {
    const gh = scriptedGh(
      Effect.fail(new ProcessFailed({ command: "gh", reason: "spawn gh ENOENT" })),
    )
    expect((await listed(gh))._tag).toBe("Unavailable")
  })

  it("reads a gh that is not installed as unreachable, not as an error", async () => {
    const gh = scriptedGh(
      Effect.fail(new ProcessFailed({ command: "gh", reason: "spawn gh ENOENT" })),
    )
    const answer = await asked(gh)
    expect(answer._tag).toBe("Unavailable")
    expect(answer._tag === "Unavailable" && answer.why).toContain("spawn gh ENOENT")
  })

  /**
   * One answer for every refusal `gh` has, and deliberately: a login that has
   * expired, a repository on no forge at all and a network that is down all come
   * back the same way, and a heuristic over its prose would file one of them
   * under a verdict somebody acts on.
   */
  it("reads every refusal gh has as the same answer, carrying what it said", async () => {
    const gh = scriptedGh(
      Effect.succeed(exits(1, "", "gh: To get started with GitHub CLI, please run: gh auth login")),
    )
    const answer = await asked(gh)
    expect(answer._tag).toBe("Unavailable")
    expect(answer._tag === "Unavailable" && answer.why).toContain("gh auth login")
  })

  it("does not wait on a gh that never answers", async () => {
    const gh = scriptedGh(Effect.succeed(NEVER))
    const answer = await Effect.runPromise(
      Effect.gen(function* () {
        const forge = yield* Forge
        const fiber = yield* Effect.fork(forge.pullRequest(BRANCH))
        yield* TestClock.adjust(Duration.minutes(1))
        return yield* Fiber.join(fiber)
      }).pipe(Effect.provide(gh.layer), Effect.provide(TestContext.TestContext)),
    )
    expect(answer._tag).toBe("Unavailable")
    expect(answer._tag === "Unavailable" && answer.why).toContain("did not answer")
  })
})

// oxlint-disable-next-line unicorn/no-null -- the forge's own spelling of a refused field
const NOTHING = null

/** A check run as the detail query asks for it, its `workflowRun` refused. */
const REFUSED_RUN = {
  id: "CR_1",
  databaseId: 1,
  name: "test",
  status: "COMPLETED",
  conclusion: "SUCCESS",
  checkSuite: { workflowRun: NOTHING },
}

const PULL_41 = {
  number: 41,
  url: "https://forge/pr/41",
  title: "Partly refused",
  state: "OPEN",
  isDraft: false,
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  comments: { nodes: [] },
  reviews: { nodes: [] },
  reviewThreads: { nodes: [] },
  commits: {
    nodes: [
      { commit: { statusCheckRollup: { state: "SUCCESS", contexts: { nodes: [REFUSED_RUN] } } } },
    ],
  },
}

/**
 * What an App token without `actions: read` gets back: every field but a check suite's
 * `workflowRun`, nulled with an error beside it — and `gh` exits 1 on that, data and all.
 */
const PARTIAL = JSON.stringify({
  data: { repository: { pullRequests: { nodes: [PULL_41] } } },
  errors: [
    {
      type: "FORBIDDEN",
      path: [
        "repository",
        "pullRequests",
        "nodes",
        0,
        "commits",
        "nodes",
        0,
        "commit",
        "statusCheckRollup",
        "contexts",
        "nodes",
        0,
        "checkSuite",
        "workflowRun",
      ],
      message: "Resource not accessible by integration",
    },
  ],
})

describe("an answer the forge gave in part", () => {
  /** One refused field must not hide the pull request. */
  it("keeps the pull request, and the checks the refused field sat under", async () => {
    const gh = scriptedGh(
      Effect.succeed(exits(1, PARTIAL, "gh: Resource not accessible by integration")),
    )
    const answer = await asked(gh)
    expect(answer._tag).toBe("Found")
    if (answer._tag !== "Found") return
    expect(answer.pullRequest.number).toBe(41)
    expect(answer.pullRequest.checks.map((check) => check.name)).toStrictEqual(["test"])
  })

  /** An error with no data beside it is a refusal, whatever shape it arrives in. */
  it("reads an answer refused whole as unavailable, carrying what gh said", async () => {
    const refused = JSON.stringify({
      data: { repository: NOTHING },
      errors: [{ type: "NOT_FOUND", message: "Could not resolve to a Repository" }],
    })
    const gh = scriptedGh(
      Effect.succeed(exits(1, refused, "gh: Could not resolve to a Repository")),
    )
    const answer = await asked(gh)
    expect(answer._tag).toBe("Unavailable")
    expect(answer._tag === "Unavailable" && answer.why).toContain("Could not resolve")
  })

  /**
   * A refused connection decodes as an empty one, which is *no pull request* — a verdict
   * that offers the local merge. Only `workflowRun` is tolerated; this has to stay a refusal.
   */
  it("reads a refused pull request connection as unavailable, not as none", async () => {
    const refused = JSON.stringify({
      data: { repository: { pullRequests: { nodes: NOTHING } } },
      errors: [
        {
          type: "FORBIDDEN",
          path: ["repository", "pullRequests", "nodes"],
          message: "Resource not accessible by integration",
        },
      ],
    })
    const gh = scriptedGh(
      Effect.succeed(exits(1, refused, "gh: Resource not accessible by integration")),
    )
    const answer = await asked(gh)
    expect(answer._tag).toBe("Unavailable")
    expect(answer._tag === "Unavailable" && answer.why).toContain("not accessible")
  })

  /** The same for one branch of the listing: a refused alias is not *no pull request*. */
  it("reads a listing with one branch's connection refused as unavailable", async () => {
    const refused = JSON.stringify({
      data: { repository: { b0: { nodes: [] }, b1: { nodes: NOTHING } } },
      errors: [
        {
          type: "FORBIDDEN",
          path: ["repository", "b1", "nodes"],
          message: "Resource not accessible by integration",
        },
      ],
    })
    const gh = scriptedGh(
      Effect.succeed(exits(1, refused, "gh: Resource not accessible by integration")),
    )
    const listing = await listed(gh, ["trak/a", "trak/b"])
    expect(listing._tag).toBe("Unavailable")
  })
})

/** `gh` answering each spawn with the next of `answers`, in order. */
const ghAnswering = (...answers: readonly Spawned[]) => {
  const left = [...answers]
  return scriptedGh(
    Effect.suspend(() => {
      const next = left.shift()
      return next === undefined
        ? Effect.die("gh was spawned more often than scripted")
        : Effect.succeed(next)
    }),
  )
}

const merged = (
  gh: { readonly layer: Layer.Layer<Forge> },
  pick?: MergeMethod,
): Promise<ForgeMerge> =>
  Effect.runPromise(
    Effect.provide(
      Effect.flatMap(Forge, (forge) => forge.merge(BRANCH, pick)),
      gh.layer,
    ),
  )

/** The merge query's answer: the default, every method allowed, and the base's rulesets. */
const METHOD = (method: string, rules: readonly unknown[] = []): string =>
  JSON.stringify({
    data: {
      repository: {
        viewerDefaultMergeMethod: method,
        mergeCommitAllowed: true,
        squashMergeAllowed: true,
        rebaseMergeAllowed: true,
        pullRequests: { nodes: [{ baseRef: { rules: { nodes: rules } } }] },
      },
    },
  })

describe("merging on the forge", () => {
  it("asks the repository's own first method, then merges the branch's pull request by it", async () => {
    const gh = ghAnswering(exits(0, METHOD("SQUASH")), exits(0, ""))
    expect(await merged(gh)).toStrictEqual({ _tag: "Merged" })
    expect(gh.spawns.map((s) => s.args.slice(0, 2))).toStrictEqual([
      ["api", "graphql"],
      ["pr", "merge"],
    ])
    // The branch stays for the archive to remove with its checkout.
    expect(gh.spawns[1]?.args).toStrictEqual(["pr", "merge", BRANCH, "--squash"])
  })

  it("merges by the method picked on the trak, where the repository allows it", async () => {
    const gh = ghAnswering(exits(0, METHOD("SQUASH")), exits(0, ""))
    expect(await merged(gh, "rebase")).toStrictEqual({ _tag: "Merged" })
    expect(gh.spawns[1]?.args).toStrictEqual(["pr", "merge", BRANCH, "--rebase"])
    // The rules are the base branch's, so the query names the branch.
    expect(gh.spawns[0]?.args).toContain(`branch=${BRANCH}`)
  })

  it("merges by the repository's default where the base's rules no longer allow the pick", async () => {
    const onlySquash = { type: "PULL_REQUEST", parameters: { allowedMergeMethods: ["SQUASH"] } }
    const gh = ghAnswering(exits(0, METHOD("SQUASH", [onlySquash])), exits(0, ""))
    expect(await merged(gh, "rebase")).toStrictEqual({ _tag: "Merged" })
    expect(gh.spawns[1]?.args).toStrictEqual(["pr", "merge", BRANCH, "--squash"])
  })

  it("answers a refusal, with gh's words, rather than failing", async () => {
    const gh = ghAnswering(exits(0, METHOD("MERGE")), exits(1, "", "Pull request is not mergeable"))
    const answer = await merged(gh)
    expect(answer._tag).toBe("Refused")
    expect(answer._tag === "Refused" && answer.why).toContain("not mergeable")
  })

  it("merges nothing where the method cannot be read", async () => {
    const gh = ghAnswering(exits(0, "{}"))
    expect((await merged(gh))._tag).toBe("Refused")
    expect(gh.spawns.length).toBe(1)
  })
})

/**
 * The listing route — one answer about every branch, and the reason the list stopped
 * asking per trak.
 *
 * What it owes is narrower than the route above: it never touches the store, so there is
 * no trak for it to 404 on and nothing about it that depends on a log. What it must not
 * do is turn *we could not ask* into an empty answer, because a caller reads a branch's
 * absence from one of those as a fact about that branch.
 */
describe("what the listing route will say", () => {
  const LISTED = ForgeListing.Listed({
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
  })

  it("hands the forge's answer over whole, in the shape the client decodes", async () => {
    await runFlow(
      ONE_STEP,
      () =>
        Effect.gen(function* () {
          expect(yield* listingOf(yield* getListing())).toStrictEqual({
            _tag: "PullRequests",
            entries: LISTED.entries,
          })
        }),
      undefined,
      undefined,
      forgeSaying(ForgeAnswer.None(), LISTED),
    )
  })

  /** The branches are the caller's to name, and the route hands them on untouched: it
   *  replays no log and holds no idea of its own about which traks are finished. */
  it("asks the forge about exactly the branches the query string named", async () => {
    let handedOn: readonly string[] = []
    const spy = Layer.succeed(Forge, {
      pullRequest: () => Effect.succeed(ForgeAnswer.None()),
      merge: refusesMerge,
      openPullRequest: refusesOpen,
      listing: (branches) => {
        handedOn = branches
        return Effect.succeed(ForgeListing.Listed({ entries: [] }))
      },
    })
    await runFlow(
      ONE_STEP,
      () =>
        Effect.gen(function* () {
          yield* listingOf(yield* getListing(["trak/a", "trak/b"]))
          expect(handedOn).toStrictEqual(["trak/a", "trak/b"])
        }),
      undefined,
      undefined,
      spy,
    )
  })

  it("says it could not ask rather than answering that there are none", async () => {
    await runFlow(
      ONE_STEP,
      () =>
        Effect.gen(function* () {
          expect(yield* listingOf(yield* getListing())).toStrictEqual({
            _tag: "ForgeUnavailable",
            why: "gh could not be run: spawn gh ENOENT",
          })
        }),
      undefined,
      undefined,
      forgeSaying(
        ForgeAnswer.None(),
        ForgeListing.Unavailable({ why: "gh could not be run: spawn gh ENOENT" }),
      ),
    )
  })

  /** An entry with no pull request crosses as an entry, not as a missing one: the first is
   *  a fact about that branch and the second is a branch nobody asked about. */
  it("keeps a branch with no pull request apart from a branch it never heard of", async () => {
    await runFlow(
      ONE_STEP,
      () =>
        Effect.gen(function* () {
          const body = yield* listingOf(yield* getListing(["trak/a", "trak/b"]))
          expect(body._tag === "PullRequests" && body.entries).toStrictEqual([{ branch: "trak/a" }])
        }),
      undefined,
      undefined,
      forgeSaying(ForgeAnswer.None(), ForgeListing.Listed({ entries: [{ branch: "trak/a" }] })),
    )
  })
})

// ============================================================================
// The merge press's route
// ============================================================================

const postMerge = (id: string) =>
  Router.toHttpApp(apiRouter()).pipe(
    Effect.flatMap((app) =>
      Effect.provideService(
        app,
        ServerRequest.HttpServerRequest,
        ServerRequest.fromWeb(
          new Request(`http://localhost/api/traks/${id}/merge-pull-request`, { method: "POST" }),
        ),
      ),
    ),
    Effect.scoped,
    Effect.orDie,
  )

const refusalOf = (response: HttpServerResponse) =>
  Effect.map(
    Effect.promise(async (): Promise<unknown> => JSON.parse(await toWeb(response).text())),
    Schema.decodeUnknownSync(RefusalDto),
  )

/** `OPEN`, as GitHub would take it: clean, green, nobody holding it. */
const READY = ForgeAnswer.Found({
  pullRequest: {
    ...OPEN.pullRequest,
    merging: "clean",
    decision: "approved",
    rollup: "passed",
    mergeMethod: "squash",
    base: "main",
  },
})

/** A forge that says `answer` and records every branch it is asked to merge, and the pick. */
const forgeMerging = (answer: ForgeAnswer, outcome: ForgeMerge = ForgeMerge.Merged()) => {
  const merges: string[] = []
  const picks: (MergeMethod | undefined)[] = []
  const layer = Layer.succeed(Forge, {
    pullRequest: () => Effect.succeed(answer),
    listing: () => Effect.succeed(ForgeListing.Listed({ entries: [] })),
    merge: (branch, pick) =>
      Effect.sync(() => {
        merges.push(branch)
        picks.push(pick)
        return outcome
      }),
    openPullRequest: refusesOpen,
  })
  return { merges, picks, layer }
}

/** Runs `then` against a trak that has run its plan out, with `forge` behind the route. */
const atFinished = async (
  forge: Layer.Layer<Forge>,
  then: (id: TrakId, events: number) => Effect.Effect<void, RuntimeError, FlowDeps>,
) =>
  runFlow(
    ONE_STEP,
    (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        yield* act(id, 0, human.approve())
        expectState(yield* act(id, 1, human.approve()), "Finished")
        yield* then(id, (yield* (yield* Store).events(id)).length)
      }),
    undefined,
    undefined,
    forge,
  )

describe("merging a finished trak's pull request from the band", () => {
  it("merges the branch's pull request on the forge, and writes nothing to the log", async () => {
    const forge = forgeMerging(READY)
    await atFinished(forge.layer, (id, before) =>
      Effect.gen(function* () {
        const { answer, bases } = yield* recordingAfterMerge(postMerge(id))
        expect(answer.status).toBe(204)
        // The checkout is brought up to the base the pull request went into.
        expect(bases).toStrictEqual(["main"])
        expect(forge.merges).toStrictEqual([`trak/${id}`])
        // The forge's next answer is the record, as for a merge made on GitHub.
        expect((yield* (yield* Store).events(id)).length).toBe(before)
      }),
    )
  })

  it("leaves the verdict to the forge: a failing check it would let through is merged", async () => {
    const forge = forgeMerging(
      ForgeAnswer.Found({ pullRequest: { ...READY.pullRequest, rollup: "failed" } }),
    )
    await atFinished(forge.layer, (id) =>
      Effect.gen(function* () {
        expect((yield* postMerge(id)).status).toBe(204)
        expect(forge.merges).toStrictEqual([`trak/${id}`])
      }),
    )
  })

  it("hands the forge no pick where nobody made one, so it merges by its default", async () => {
    const forge = forgeMerging(READY)
    await atFinished(forge.layer, (id) =>
      Effect.gen(function* () {
        yield* postMerge(id)
        expect(forge.picks).toStrictEqual([undefined])
      }),
    )
  })

  it("hands the forge's own refusal back in its words", async () => {
    const forge = forgeMerging(
      READY,
      ForgeMerge.Refused({ why: "gh exited 1: Required status check is expected" }),
    )
    await atFinished(forge.layer, (id) =>
      Effect.gen(function* () {
        const { answer: response, bases } = yield* recordingAfterMerge(postMerge(id))
        expect(response.status).toBe(409)
        expect(bases).toStrictEqual([])
        expect(yield* refusalOf(response)).toStrictEqual({
          _tag: "PullNotMerged",
          why: "gh exited 1: Required status check is expected",
        })
      }),
    )
  })

  it("refuses a branch with no pull request, without trying to merge", async () => {
    const forge = forgeMerging(ForgeAnswer.None())
    await atFinished(forge.layer, (id) =>
      Effect.gen(function* () {
        const response = yield* postMerge(id)
        expect(yield* refusalOf(response)).toStrictEqual({
          _tag: "PullNotMerged",
          why: "there is no pull request",
        })
        expect(forge.merges).toStrictEqual([])
      }),
    )
  })

  it("refuses a trak that has not finished", async () => {
    const forge = forgeMerging(READY)
    await runFlow(
      ONE_STEP,
      (id) =>
        Effect.gen(function* () {
          yield* create(id, "d")
          const response = yield* postMerge(id)
          expect(response.status).toBe(409)
          expect((yield* refusalOf(response))._tag).toBe("NotFinished")
          expect(forge.merges).toStrictEqual([])
        }),
      undefined,
      undefined,
      forge.layer,
    )
  })

  it("404s for a trak nothing has heard of", async () => {
    await atFinished(forgeMerging(READY).layer, () =>
      Effect.gen(function* () {
        expect((yield* postMerge("no-such-trak")).status).toBe(404)
      }),
    )
  })
})

// ============================================================================
// The merge method's route
// ============================================================================

const postPick = (id: string, method: string) =>
  Router.toHttpApp(apiRouter()).pipe(
    Effect.flatMap((app) =>
      Effect.provideService(
        app,
        ServerRequest.HttpServerRequest,
        ServerRequest.fromWeb(
          new Request(`http://localhost/api/traks/${id}/merge-method`, {
            method: "POST",
            body: JSON.stringify({ method }),
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    ),
    Effect.scoped,
    Effect.orDie,
  )

describe("picking the method a finished trak's pull request merges by", () => {
  it("records the pick on the trak's log and merges nothing", async () => {
    const forge = forgeMerging(READY)
    await atFinished(forge.layer, (id) =>
      Effect.gen(function* () {
        expect((yield* postPick(id, "rebase")).status).toBe(204)
        const log = yield* (yield* Store).events(id)
        expect(log.at(-1)).toMatchObject({ _tag: "MergeMethodPicked", method: "rebase" })
        expect(forge.merges).toStrictEqual([])
      }),
    )
  })

  it("is the method the press then merges by, the latest pick standing", async () => {
    const forge = forgeMerging(READY)
    await atFinished(forge.layer, (id) =>
      Effect.gen(function* () {
        yield* postPick(id, "rebase")
        yield* postPick(id, "merge")
        expect((yield* postMerge(id)).status).toBe(204)
        expect(forge.picks).toStrictEqual(["merge"])
      }),
    )
  })

  it("404s for a trak nothing has heard of", async () => {
    await atFinished(forgeMerging(READY).layer, () =>
      Effect.gen(function* () {
        expect((yield* postPick("no-such-trak", "squash")).status).toBe(404)
      }),
    )
  })
})

/**
 * A `gh` answering each call by its first two arguments — `pr list` with `found`, `pr
 * create` with progress then the URL — and keeping every call's arguments.
 */
const ghFinding = (found: string) => {
  const calls: (readonly string[])[] = []
  const proc = Layer.succeed(Process, {
    spawn: (spec) =>
      Effect.sync(() => {
        calls.push(spec.args)
        const [verb, sub] = spec.args
        if (verb === "pr" && sub === "list") return exits(0, found)
        if (verb === "pr" && sub === "create")
          return exits(0, "Creating…\nhttps://example.invalid/9")
        return exits(0, "")
      }),
    isAlive: () => Effect.succeed(false),
    kill: () => Effect.void,
    startTime: () => Effect.succeed(undefined),
    killExec: () => Effect.void,
  } satisfies ProcessShape)
  return { layer: GhForgeLayer("/repo").pipe(Layer.provide(proc)), calls }
}

const openGoalPull = (gh: { readonly layer: Layer.Layer<Forge> }) =>
  Effect.runPromise(
    Effect.provide(
      Effect.flatMap(Forge, (forge) =>
        forge.openPullRequest(
          BranchName.make("goal/ship"),
          BranchName.make("main"),
          "Ship goals",
          "Goals ship.",
        ),
      ),
      gh.layer,
    ),
  )

describe("opening a goal's pull request on the forge", () => {
  it("edits the open pull request it finds, and opens none", async () => {
    const gh = ghFinding("https://example.invalid/3")
    expect(await openGoalPull(gh)).toStrictEqual(
      ForgeOpen.Opened({ url: "https://example.invalid/3" }),
    )
    const verbs = gh.calls.map((args) => args.slice(0, 2).join(" "))
    expect(verbs).toEqual(["pr list", "pr edit"])
    expect(gh.calls[0]?.slice(2, 6)).toEqual(["--head", "goal/ship", "--base", "main"])
    expect(gh.calls[1]?.[2]).toBe("https://example.invalid/3")
  })

  it("opens one from the goal branch into the base where it finds none, and answers its URL", async () => {
    const gh = ghFinding("")
    expect(await openGoalPull(gh)).toStrictEqual(
      ForgeOpen.Opened({ url: "https://example.invalid/9" }),
    )
    expect(gh.calls.map((args) => args.slice(0, 2).join(" "))).toEqual(["pr list", "pr create"])
    expect(gh.calls[1]?.slice(2, 6)).toEqual(["--head", "goal/ship", "--base", "main"])
  })
})
