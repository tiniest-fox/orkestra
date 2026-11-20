// The git bar's routes: the project checkout's branch and counts, the fetch a poll starts
// when the last one is stale, and the four presses with what each refuses.
//
// Against the scenario's real repository and a real bare `origin` beside it. What the
// git does is pinned by the `Vcs` contract; what is pinned here is the surface — the one
// status shape every route answers with, a refusal as a `409` body, a git failure carried
// on the bar rather than thrown, and the five-minute fetch, on a clock the test moves.

import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { Duration, Effect, Schedule, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { RefusalDto } from "@orkestra/shared/dto/common"
import { GitPressedDto, HostGitDto } from "@orkestra/shared/dto/git"
import { toWeb, type HttpServerResponse } from "@effect/platform/HttpServerResponse"
import { FETCH_STALE_AFTER } from "../../src/app/host-git.js"
import { settableClock, type SettableClock } from "../support/clock.js"
import { type FlowDeps, onGit } from "../support/flow.js"
import { addOrigin, commitOnHost, git, landElsewhere, type Origin } from "../support/git.js"
import { mount } from "../support/http.js"
import { gitRoutes } from "../../src/app/routes/git.js"

const { call } = mount(gitRoutes)

// The subject here is git, so every flow runs on it.
const { runFlow } = onGit

const NOW = Date.UTC(2026, 9, 9, 12)

const jsonOf = (response: HttpServerResponse) =>
  Effect.promise(async (): Promise<unknown> => JSON.parse(await toWeb(response).text()))

type Action = "fetch" | "pull" | "reconcile" | "push"

/** One request to the bar's routes, with its status and its body decoded as `decode` says. */
const ask = <A, I>(
  decode: Schema.Schema<A, I>,
  method: "GET" | "POST",
  path: string,
  payload?: unknown,
) =>
  Effect.gen(function* () {
    const init = payload === undefined ? { method } : { method, body: JSON.stringify(payload) }
    const response = yield* call(new Request(`http://localhost/api/git${path}`, init))
    return {
      status: response.status,
      body: Schema.decodeUnknownSync(decode)(yield* jsonOf(response)),
    }
  })

const read = ask(HostGitDto, "GET", "")
const press = (action: Action, payload?: unknown) =>
  ask(GitPressedDto, "POST", `/${action}`, payload)
const refused = (action: Action, payload?: unknown) =>
  ask(RefusalDto, "POST", `/${action}`, payload)

/** Somebody else's edit to a file the repository already holds, pushed and not fetched. */
const landEdit = (from: Origin, name: string, content: string): void => {
  git(from.elsewhere, "pull", "--quiet", "--ff-only")
  commitOnHost(from.elsewhere, name, content)
  git(from.elsewhere, "push", "--quiet", "origin", "main")
}

/** Poll the bar, as a screen does, until no fetch is running — and hand back that read. */
const settled = (clock: SettableClock) =>
  read.pipe(
    Effect.withClock(clock.clock),
    Effect.filterOrFail(
      ({ body }) => !body.fetching,
      () => "still fetching",
    ),
    Effect.retry(Schedule.spaced("5 millis")),
    Effect.timeout("10 seconds"),
    Effect.orDie,
  )

/** A flow whose body has an `origin` beside the scenario's repository. */
const withOrigin = (
  body: (repoDir: string, from: Origin) => Effect.Effect<void, never, FlowDeps>,
) =>
  runFlow([], (_id, _agent, _checks, repoDir) =>
    Effect.acquireUseRelease(
      Effect.sync(() => addOrigin(repoDir)),
      (from) => body(repoDir, from),
      (from) => Effect.sync(from.remove),
    ),
  )

describe("the git bar", () => {
  it("reads the branch and counts, fetching on the first read and not again until stale", async () => {
    const clock = settableClock(NOW)
    await withOrigin((_repoDir, from) =>
      Effect.gen(function* () {
        // The first read since boot has no fetch behind it, so it starts one.
        const first = yield* read.pipe(Effect.withClock(clock.clock))
        expect(first.body.fetching).toBe(true)
        const fetched = yield* settled(clock)
        expect(fetched.body).toStrictEqual({
          head: { _tag: "Branch", name: "main" },
          origin: true,
          upstream: { name: "origin/main", ahead: 0, behind: 0 },
          fetchedAt: NOW,
          fetching: false,
        })

        // A commit lands on origin. Inside five minutes, the bar does not fetch.
        landElsewhere(from, "theirs.txt")
        clock.advance(Duration.toMillis(FETCH_STALE_AFTER) - 1)
        const early = yield* read.pipe(Effect.withClock(clock.clock))
        expect(early.body.fetching).toBe(false)
        expect(early.body.upstream?.behind).toBe(0)

        // At five minutes the next read starts a fetch, and the poll after it shows
        // the new commit — five minutes plus one poll.
        clock.advance(1)
        expect((yield* read.pipe(Effect.withClock(clock.clock))).body.fetching).toBe(true)
        const later = yield* settled(clock)
        expect(later.body.upstream?.behind).toBe(1)
        expect(later.body.fetchedAt).toBe(NOW + Duration.toMillis(FETCH_STALE_AFTER))
      }),
    )
  })

  it("fetches nothing and refuses a fetch where there is no origin", async () => {
    await runFlow([], () =>
      Effect.gen(function* () {
        const bar = yield* read
        expect(bar.body).toStrictEqual({
          head: { _tag: "Branch", name: "main" },
          origin: false,
          fetching: false,
        })
        expect(yield* refused("fetch")).toStrictEqual({ status: 409, body: { _tag: "NoOrigin" } })
      }),
    )
  })
})

describe("the git bar's presses", () => {
  it("pulls a branch that is behind, answering with the bar as it now stands", async () => {
    await withOrigin((repoDir, from) =>
      Effect.gen(function* () {
        landElsewhere(from, "theirs.txt")

        const pulled = yield* press("pull")

        expect(pulled.status).toBe(200)
        expect(pulled.body.upstream).toStrictEqual({ name: "origin/main", ahead: 0, behind: 0 })
        expect(git(repoDir, "rev-parse", "HEAD")).toBe(git(from.origin, "rev-parse", "main"))
      }),
    )
  })

  it("refuses a pull over uncommitted work with every file, and moves nothing", async () => {
    await withOrigin((repoDir, from) =>
      Effect.gen(function* () {
        landElsewhere(from, "theirs.txt")
        const before = git(repoDir, "rev-parse", "HEAD")
        writeFileSync(join(repoDir, "README.md"), "# edited\n")
        writeFileSync(join(repoDir, "new.txt"), "new\n")

        expect(yield* refused("pull")).toStrictEqual({
          status: 409,
          body: { _tag: "Dirty", files: ["M README.md", "?? new.txt"] },
        })
        expect(git(repoDir, "rev-parse", "HEAD")).toBe(before)
      }),
    )
  })

  it("refuses a pull on a diverged branch, and moves nothing", async () => {
    await withOrigin((repoDir, from) =>
      Effect.gen(function* () {
        landElsewhere(from, "theirs.txt")
        commitOnHost(repoDir, "mine.txt", "mine\n")
        const before = git(repoDir, "rev-parse", "HEAD")

        expect(yield* refused("pull")).toStrictEqual({
          status: 409,
          body: { _tag: "Diverged", ahead: 1, behind: 1 },
        })
        expect(git(repoDir, "rev-parse", "HEAD")).toBe(before)
      }),
    )
  })

  it("pushes what is ahead, and refuses a push that is behind", async () => {
    await withOrigin((repoDir, from) =>
      Effect.gen(function* () {
        commitOnHost(repoDir, "mine.txt", "mine\n")
        const pushed = yield* press("push")
        expect(pushed.status).toBe(200)
        expect(git(from.origin, "rev-parse", "main")).toBe(git(repoDir, "rev-parse", "HEAD"))

        landElsewhere(from, "theirs.txt")
        yield* press("fetch")
        expect(yield* refused("push")).toStrictEqual({
          status: 409,
          body: { _tag: "Behind", behind: 1 },
        })
      }),
    )
  })

  it("carries an unreachable origin as a failure on the bar, and clears it once a fetch lands", async () => {
    await withOrigin((repoDir, from) =>
      Effect.gen(function* () {
        git(repoDir, "remote", "set-url", "origin", join(repoDir, "no-such-remote.git"))

        const failed = yield* press("fetch")

        expect(failed.status).toBe(200)
        expect(failed.body.failure).toMatchObject({ action: "fetch" })
        expect(failed.body.failure?.message).toContain("fetch origin")
        expect(failed.body.fetchedAt).toBeUndefined()
        expect((yield* read).body.failure).toMatchObject({ action: "fetch" })

        git(repoDir, "remote", "set-url", "origin", from.origin)
        const fetched = yield* press("fetch")
        expect(fetched.body.failure).toBeUndefined()
        expect(fetched.body.fetchedAt).toBeDefined()
      }),
    )
  })
})

describe("the git bar's way through a diverged branch and a dirty tree", () => {
  it("reconciles a diverged branch with a merge, leaving Push as what applies", async () => {
    await withOrigin((repoDir, from) =>
      Effect.gen(function* () {
        landElsewhere(from, "theirs.txt")
        commitOnHost(repoDir, "mine.txt", "mine\n")

        const merged = yield* press("reconcile")

        expect(merged.status).toBe(200)
        expect(merged.body.upstream).toStrictEqual({ name: "origin/main", ahead: 2, behind: 0 })
        expect(git(repoDir, "status", "--porcelain")).toBe("")
      }),
    )
  })

  it("refuses a reconcile that would conflict with the files and the request for a trak", async () => {
    await withOrigin((repoDir, from) =>
      Effect.gen(function* () {
        landEdit(from, "README.md", "# theirs\n")
        commitOnHost(repoDir, "README.md", "# mine\n")
        const before = git(repoDir, "rev-parse", "HEAD")

        const stopped = yield* refused("reconcile")

        expect(stopped.status).toBe(409)
        expect(stopped.body).toMatchObject({ _tag: "Conflict", files: ["README.md"] })
        // The engine's words, from its template: both branches and every file.
        const description = stopped.body._tag === "Conflict" ? stopped.body.description : ""
        expect(description).toContain("Merge `origin/main` into `main`")
        expect(description).toContain("- `README.md`")
        expect(git(repoDir, "rev-parse", "HEAD")).toBe(before)
        expect(git(repoDir, "status", "--porcelain")).toBe("")
      }),
    )
  })

  it("pulls around a stash when asked, and says nothing more where the changes went back", async () => {
    await withOrigin((repoDir, from) =>
      Effect.gen(function* () {
        landElsewhere(from, "theirs.txt")
        writeFileSync(join(repoDir, "new.txt"), "new\n")

        const pulled = yield* press("pull", { stash: true })

        expect(pulled.status).toBe(200)
        expect(pulled.body.stashed).toBeUndefined()
        expect(pulled.body.upstream).toStrictEqual({ name: "origin/main", ahead: 0, behind: 0 })
        expect(git(repoDir, "status", "--porcelain")).toBe("?? new.txt")
      }),
    )
  })

  it("answers a pull whose restore would conflict with the files, on that answer only", async () => {
    await withOrigin((repoDir, from) =>
      Effect.gen(function* () {
        landEdit(from, "README.md", "# theirs\n")
        writeFileSync(join(repoDir, "README.md"), "# mine\n")

        const pulled = yield* press("pull", { stash: true })

        expect(pulled.status).toBe(200)
        expect(pulled.body.stashed).toStrictEqual({ files: ["README.md"] })
        expect(git(repoDir, "status", "--porcelain")).toBe("")
        expect(git(repoDir, "stash", "list").split("\n")).toHaveLength(1)
        // The poll after it is the bar and nothing else: the engine keeps no memory of it.
        expect((yield* read).body).not.toHaveProperty("stashed")
      }),
    )
  })
})
