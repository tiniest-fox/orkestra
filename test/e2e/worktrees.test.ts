// Where the work happens: a trak gets its own git worktree, every agent turn
// runs inside it, finishing the trak keeps what was written, and archiving it is
// what takes the checkout — and the branch — away.
//
// These assertions need real git — that is the point of the fixture. A fake Vcs
// can only confirm its own bookkeeping, so it would have gone on reporting a
// tidy `WorktreeReady` while the directory it named did not exist, which is
// exactly the state the suite was in.

import { seedLog } from "../support/seed.js"
import * as fs from "node:fs"
import * as path from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import type { Check } from "../../src/library/types/check.js"
import type { Worktree } from "../../src/vcs/index.js"
import { afterReentry, composer, onGit, step, stepRuns } from "../support/flow.js"
import { git, repoOf, worktreeOf, writeWork } from "../support/git.js"
import {
  act,
  countTag,
  create,
  createAndStart,
  expectAwaiting,
  expectAwaitingProposal,
  expectState,
  human,
  logTags,
  logged,
} from "../support/scenario.js"
import { library } from "../support/library.js"
import { fail, heldBack, pass } from "../support/scripted-checks.js"
import { forgeSaying } from "../support/forge.js"
import { crashesOn, onPrompt, reply } from "../support/scripted-agent.js"
import { ForgeAnswer } from "../../src/vcs/index.js"
import { Events } from "../../src/workflow/domain/event.js"
import { Actions } from "../../src/workflow/domain/human-action.js"
import { Store } from "../../src/workflow/ports/store.js"
import type { TrakId } from "../../src/workflow/domain/trak.js"
import { advance } from "../../src/workflow/runtime.js"
import { Drives } from "../../src/app/drive.js"
import { recordLeftBehind } from "../../src/app/layers.js"
import { replayHistory } from "../../src/workflow/domain/replay.js"
import { GitFailed } from "../../src/vcs/types/errors.js"
import { recordingPreparation } from "../support/preparation.js"

// The subject here is git, so every flow runs on it.
const { runFlow, runFlowWithAgentLog } = onGit

/** What `pnpm ork archive` files for a finished trak: a human is done with it. */
const close = (id: TrakId) => advance(id, Events.closed())

/** How many times the project's setup script has run, out of the checks log. */
const ranSetup = (log: { readonly ran: readonly string[] }): number =>
  log.ran.filter((name) => name === "setup").length

/** The same, for the teardown script. */
const ranTeardown = (log: { readonly ran: readonly string[] }): number =>
  log.ran.filter((name) => name === "teardown").length

describe("a trak works in its own worktree", () => {
  it("creates a real linked worktree on its own branch", async () => {
    await runFlow([composer("work"), step(1, "work", reply.artifact("done"))], (id) =>
      Effect.gen(function* () {
        const worktree = worktreeOf(yield* create(id, "Add a --json flag"))

        expect(fs.existsSync(worktree.path)).toBe(true)
        expect(worktree.branch).toBe(`trak/${id}`)

        // A *linked* worktree, not merely a directory that happens to hold a
        // checkout: it is its own top level, but shares the repo it came from.
        expect(git(worktree.path, "rev-parse", "--show-toplevel")).toBe(
          fs.realpathSync(worktree.path),
        )
        expect(git(worktree.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe(worktree.branch)

        // The commit the fixture made — so this is the test repo's history, and
        // the worktree is not an empty `git init` somewhere convenient.
        expect(fs.existsSync(path.join(worktree.path, "README.md"))).toBe(true)
      }),
    )
  })

  it("runs every agent turn inside the worktree, never the host directory", async () => {
    await runFlowWithAgentLog(
      [
        composer("plan", "work"),
        step(1, "plan", reply.artifact("p")),
        step(2, "work", reply.artifact("s")),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          const first = yield* createAndStart(id, "Add a --json flag")
          const done = yield* act(id, 0, human.approve())
          expectState(done, "AwaitingHuman", 2)

          const worktree = worktreeOf(first)
          const log = yield* agentLog

          // The composer's turn included. `cwd` falls back to "." for a caller
          // outside `advance`, which would silently point a real agent — and
          // real `git` — at whatever directory the process started in. Assert
          // the fallback is never what a turn inside the engine used.
          expect(log.requests.length).toBeGreaterThan(0)
          for (const req of log.requests) expect(req.cwd).toBe(worktree.path)
        }),
    )
  })

  it("keeps the branch it works on out of the repo it came from", async () => {
    await runFlow([composer("work"), step(1, "work", reply.artifact("done"))], (id) =>
      Effect.gen(function* () {
        const worktree = worktreeOf(yield* create(id, "Add a --json flag"))

        // `--git-common-dir` is the parent repo's `.git`, which is how a linked
        // worktree is told from an unrelated checkout.
        const repoDir = repoOf(worktree.path)

        expect(git(repoDir, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main")
        expect(git(repoDir, "worktree", "list")).toContain(worktree.branch)
      }),
    )
  })
})

const trakDir = (worktree: Worktree): string => path.join(worktree.path, ".orkestra", ".trak")

describe("the artifacts, projected into the worktree", () => {
  const projected = (worktree: Worktree): readonly string[] =>
    fs.existsSync(trakDir(worktree)) ? fs.readdirSync(trakDir(worktree)).sort() : []

  it("writes trak.md before the first turn, and one file per step that finishes", async () => {
    await runFlow(
      [
        composer("plan", "work"),
        step(1, "plan", reply.artifact("the plan")),
        step(2, "work", reply.artifact("done")),
      ],
      (id) =>
        Effect.gen(function* () {
          const worktree = worktreeOf(yield* create(id, "Add a --json flag"))
          // The composer's turn has run and parked at the plan gate. Nothing has
          // been produced yet, so the request is all there is.
          expect(projected(worktree)).toEqual(["trak.md"])
          expect(fs.readFileSync(path.join(trakDir(worktree), "trak.md"), "utf8")).toContain(
            "Add a --json flag",
          )

          yield* act(id, 0, human.approve())
          yield* act(id, 1, human.approve())
          // Written on the way INTO step 1, so `0-plan.md` is there and the file
          // for the step now running is not.
          expect(projected(worktree)).toEqual(["1-plan.md", "trak.md"])
          expect(fs.readFileSync(path.join(trakDir(worktree), "1-plan.md"), "utf8")).toContain(
            "the plan",
          )
        }),
    )
  })

  it("gains the composer's title once there is a proposal", async () => {
    await runFlow([composer("work"), step(1, "work", reply.artifact("done"))], (id) =>
      Effect.gen(function* () {
        const worktree = worktreeOf(yield* createAndStart(id, "Add a --json flag"))
        // `composer()` proposes under this title — the one line `ork list` and
        // every gate want to show, written once and never revised.
        expect(fs.readFileSync(path.join(trakDir(worktree), "trak.md"), "utf8")).toContain(
          "# Add a --json flag",
        )
      }),
    )
  })

  it("never carries a step's account of why it could not work — only what it filed", async () => {
    // The account of being stuck is a document, and it is the one document that
    // must not appear here: a later agent reading "here is why I could not do the
    // review" in `1-review.md` is a trap of the confident kind, work grounded in a
    // file that is not the thing its name says it is.
    await runFlow(
      [
        composer("work", "review"),
        step(1, "work", reply.artifact("v1")),
        step(2, "review", reply.stuck("two passes over the diff")),
      ],
      (id) =>
        Effect.gen(function* () {
          const worktree = worktreeOf(yield* createAndStart(id, "Add a --json flag"))
          const gaveUp = yield* act(id, 1, human.approve())
          expectAwaiting(gaveUp, "stuck")
          expect(projected(worktree)).toEqual(["1-work.md", "trak.md"])
        }),
    )
  })

  it("keeps the decisions of a step whose document nothing files", async () => {
    // The asymmetry someone will later "fix". A decision is a fact about the
    // conversation, not a property of the document that carried it — "we're
    // staying on the current auth library" is still true when the turn that wrote
    // it down could not finish, and is often WHY it could not.
    const staying = {
      text: "we are staying on the current auth library",
      source: "stated",
    } as const
    await runFlow(
      [
        composer("work", "review"),
        step(1, "work", reply.artifact("v1")),
        step(2, "review", reply.decidingStuck("swapping the library first", [staying])),
        onPrompt(/have another go/, reply.artifact("no blockers after all"), "reviewer retries"),
      ],
      (id) =>
        Effect.gen(function* () {
          const worktree = worktreeOf(yield* createAndStart(id, "Add a --json flag"))
          const escalated = yield* act(id, 1, human.approve())
          expect(escalated.decisions).toEqual([{ ...staying, at: "2-review" }])

          // The projection is rebuilt on the way into a turn, so it is the next
          // turn that shows this — here, the reviewer resumed by a human.
          yield* act(id, 2, human.chat("have another go"))

          // The reviewer's own file was never written; what it decided is in the
          // intent, and in the file every turn is told to re-read.
          expect(projected(worktree)).toEqual(["1-work.md", "trak.md"])
          expect(fs.readFileSync(path.join(trakDir(worktree), "trak.md"), "utf8")).toContain(
            "- **stated** — we are staying on the current auth library",
          )
        }),
    )
  })

  it("is not committed with the work — it is the tool's paperwork, not the trak's output", async () => {
    // The failure that would be silent and embarrassing: `finishWorktree` runs
    // `git add -A`, so without the host's committed `.gitignore` every trak would
    // land Orkestra's own bookkeeping on the branch beside the change.
    await runFlow([composer("work"), step(1, "work", reply.artifact("done"))], (id) =>
      Effect.gen(function* () {
        const worktree = worktreeOf(yield* createAndStart(id, "Add a --json flag"))
        const repoDir = repoOf(worktree.path)
        writeWork(worktree, "flag.ts", "export const json = true\n")
        expect(projected(worktree)).toContain("trak.md")

        expectState(yield* act(id, 1, human.approve()), "Finished")

        expect(git(repoDir, "show", "--name-only", "--format=", worktree.branch)).toBe("flag.ts")
      }),
    )
  })
})

describe("finishing a trak", () => {
  it("commits what the step wrote and keeps the checkout, because nobody has closed it", async () => {
    await runFlow([composer("work"), step(1, "work", reply.artifact("done"))], (id) =>
      Effect.gen(function* () {
        const worktree = worktreeOf(yield* create(id, "Add a --json flag"))
        const repoDir = repoOf(worktree.path)

        // Stands in for a step that writes code: the scripted agent returns an
        // artifact rather than editing files, and what has to survive teardown
        // is the files.
        writeWork(worktree, "flag.ts", "export const json = true\n")

        yield* act(id, 0, human.approve())
        expectState(yield* act(id, 1, human.approve()), "Finished")

        // The work is on the branch and the checkout is still there. The commit
        // is not there because the checkout is about to go — it is there because
        // work living only in a directory is work a disk failure loses, and the
        // directory goes when a human says so.
        expect(fs.existsSync(worktree.path)).toBe(true)
        expect(git(repoDir, "worktree", "list")).toContain(worktree.branch)
        expect(git(repoDir, "branch", "--list", worktree.branch)).not.toBe("")
        expect(git(repoDir, "show", `${worktree.branch}:flag.ts`)).toBe("export const json = true")
        expect(git(repoDir, "log", "-1", "--format=%B", worktree.branch)).toContain(
          `Orkestra-Trak: ${id}`,
        )
        // The repo it came from is untouched — the commit is on the branch only.
        expect(git(repoDir, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main")
        expect(git(repoDir, "status", "--porcelain")).toBe("")
      }),
    )
  })

  it("archiving removes the checkout, the branch and its recorded base", async () => {
    await runFlow([composer("work"), step(1, "work", reply.artifact("done"))], (id) =>
      Effect.gen(function* () {
        // The archive deletes on purpose — commits and all — and the confirmation
        // upstream is the whole of the guard. The log is what remains.
        const worktree = worktreeOf(yield* create(id, "Add a --json flag"))
        const repoDir = repoOf(worktree.path)
        writeWork(worktree, "flag.ts", "export const json = true\n")

        yield* act(id, 0, human.approve())
        expectState(yield* act(id, 1, human.approve()), "Finished")

        expectState(yield* close(id), "Closed")

        expect(fs.existsSync(worktree.path)).toBe(false)
        expect(git(repoDir, "worktree", "list")).not.toContain(worktree.branch)
        expect(git(repoDir, "branch", "--list", worktree.branch)).toBe("")
        expect(git(repoDir, "for-each-ref", `refs/orkestra/base/${worktree.branch}`)).toBe("")
      }),
    )
  })

  it("merging puts the work on the branch the host is on, and clears up after", async () => {
    await runFlow([composer("work"), step(1, "work", reply.artifact("done"))], (id) =>
      Effect.gen(function* () {
        const worktree = worktreeOf(yield* create(id, "Add a --json flag"))
        const repoDir = repoOf(worktree.path)
        writeWork(worktree, "flag.ts", "export const json = true\n")

        yield* act(id, 0, human.approve())
        expectState(yield* act(id, 1, human.approve()), "Finished")
        // Not before: holding is the whole point, and a trak that merged itself on
        // the way past would be the thing this phase exists to stop.
        expect(git(repoDir, "log", "-1", "--format=%s", "main")).toBe("initial")

        expectState(yield* advance(id, Events.merged()), "Merged")

        expect(fs.readFileSync(path.join(repoDir, "flag.ts"), "utf8")).toBe(
          "export const json = true\n",
        )
        // The checkout goes with it — the work is in the host's branch now, so what
        // was holding it is litter. The branch goes too: a merge ends in the
        // archive, and the merge commit on the host's branch is what remains.
        expect(fs.existsSync(worktree.path)).toBe(false)
        expect(git(repoDir, "branch", "--list", worktree.branch)).toBe("")
        expect(git(repoDir, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main")
      }),
    )
  })

  it("takes the branch with it when the trak wrote nothing — at the close, not before", async () => {
    await runFlow([composer("work"), step(1, "work", reply.artifact("done"))], (id) =>
      Effect.gen(function* () {
        const worktree = worktreeOf(yield* create(id, "Summarise the README"))
        const repoDir = repoOf(worktree.path)

        yield* act(id, 0, human.approve())
        expectState(yield* act(id, 1, human.approve()), "Finished")

        // An empty branch is litter, but only once nobody is going to commit to
        // it — and a trak holding its checkout is exactly somebody who still
        // might, whether by hand or by re-entering it.
        expect(fs.existsSync(worktree.path)).toBe(true)
        expect(git(repoDir, "branch", "--list", worktree.branch)).not.toBe("")

        expectState(yield* close(id), "Closed")

        // Nothing was committed, so the branch is the base commit under another
        // name. A repo full of those is the litter this avoids.
        expect(fs.existsSync(worktree.path)).toBe(false)
        expect(git(repoDir, "branch", "--list", worktree.branch)).toBe("")
      }),
    )
  })
})

/**
 * The archive asks GitHub once, at the press — and the answer names the ending, never
 * how much is deleted. The deletion itself is unconditional, which the three cases
 * below say from three sides: a merged pull request, no answer at all, and a trak
 * declared over mid-flight.
 */
describe("archiving and the forge", () => {
  const ARCHIVE_FLOW = [composer("work"), step(1, "work", reply.artifact("done"))]

  /** GitHub's whole answer for a merged pull request, at the size the engine reads. */
  const MERGED_ON_FORGE = ForgeAnswer.Found({
    pullRequest: {
      number: 14,
      url: "https://forge/pr/14",
      title: "Add a --json flag",
      state: "merged",
      mergeCommit: "9f31c07aa11",
      isDraft: false,
      merging: "unknown",
      rollup: "passed",
      checks: [],
      reviews: [],
      conversation: [],
      truncated: [],
      mergeMethods: [],
    },
  })

  it("ends a trak whose pull request merged as Merged, carrying GitHub's sha", async () => {
    await runFlow(
      ARCHIVE_FLOW,
      (id) =>
        Effect.gen(function* () {
          const worktree = worktreeOf(yield* create(id, "Add a --json flag"))
          const repoDir = repoOf(worktree.path)
          writeWork(worktree, "flag.ts", "export const json = true\n")
          yield* act(id, 0, human.approve())
          expectState(yield* act(id, 1, human.approve()), "Finished")

          const done = yield* close(id)
          // GitHub's word is the whole test — no ancestry check gates this, because a
          // squash-merged branch is not reachable from its base.
          expect(done.state).toEqual({ _tag: "Merged", sha: "9f31c07aa11" })
          expect(git(repoDir, "branch", "--list", worktree.branch)).toBe("")
        }),
      undefined,
      undefined,
      forgeSaying(MERGED_ON_FORGE),
    )
  })

  it("still deletes and ends Closed when GitHub cannot be asked", async () => {
    await runFlow(
      ARCHIVE_FLOW,
      (id) =>
        Effect.gen(function* () {
          const worktree = worktreeOf(yield* create(id, "Add a --json flag"))
          const repoDir = repoOf(worktree.path)
          writeWork(worktree, "flag.ts", "export const json = true\n")
          yield* act(id, 0, human.approve())
          expectState(yield* act(id, 1, human.approve()), "Finished")

          // The answer decides only what the trak ends as. The deletion is the press's.
          expectState(yield* close(id), "Closed")
          expect(fs.existsSync(worktree.path)).toBe(false)
          expect(git(repoDir, "branch", "--list", worktree.branch)).toBe("")
        }),
      undefined,
      undefined,
      forgeSaying(ForgeAnswer.Unavailable({ why: "gh could not be run" })),
    )
  })

  it("deletes the branch's copy on origin, where there is one", async () => {
    await runFlow(ARCHIVE_FLOW, (id, _agentLog, _checksLog, repoDir) =>
      Effect.gen(function* () {
        const worktree = worktreeOf(yield* create(id, "Add a --json flag"))
        writeWork(worktree, "flag.ts", "export const json = true\n")
        yield* act(id, 0, human.approve())
        expectState(yield* act(id, 1, human.approve()), "Finished")

        // A bare repository standing in for GitHub's git half — `push --delete` is
        // plain git, so nothing here needs a network to prove the call is made.
        const origin = fs.mkdtempSync(path.join(repoDir, "origin-"))
        git(origin, "init", "--bare", "--initial-branch=main")
        git(repoDir, "remote", "add", "origin", origin)
        git(repoDir, "push", "--quiet", "origin", worktree.branch)
        expect(git(repoDir, "ls-remote", "origin", `refs/heads/${worktree.branch}`)).not.toBe("")

        expectState(yield* close(id), "Closed")
        expect(git(repoDir, "ls-remote", "origin", `refs/heads/${worktree.branch}`)).toBe("")
      }),
    )
  })

  it("abandoning deletes the same four things, once what exists is committed", async () => {
    await runFlow([composer("work"), step(1, "work", reply.artifact("done"))], (id) =>
      Effect.gen(function* () {
        // Declared over at the first gate — mid-flight, not finished. The branch and
        // its base ref go exactly as at a finished trak's archive: work that exists
        // nowhere else goes with them, and the confirmation upstream was the guard.
        const worktree = worktreeOf(yield* createAndStart(id, "Add a --json flag"))
        const repoDir = repoOf(worktree.path)
        writeWork(worktree, "half.ts", "export const half = true\n")

        expectState(yield* advance(id, Events.abandoned("changed direction")), "Abandoned")
        expect(fs.existsSync(worktree.path)).toBe(false)
        expect(git(repoDir, "branch", "--list", worktree.branch)).toBe("")
        expect(git(repoDir, "for-each-ref", `refs/orkestra/base/${worktree.branch}`)).toBe("")
      }),
    )
  })
})

describe("committing at each step boundary", () => {
  it("commits each step's work at its own boundary, in plan order", async () => {
    await runFlow(
      [
        composer("plan", "work"),
        step(1, "plan", reply.artifact("the plan")),
        step(2, "work", reply.artifact("the work")),
      ],
      (id) =>
        Effect.gen(function* () {
          const worktree = worktreeOf(yield* create(id, "Add a --json flag"))
          const repoDir = repoOf(worktree.path)

          yield* act(id, 0, human.approve()) // the plan
          writeWork(worktree, "plan.md", "# the plan\n")
          expectState(yield* act(id, 1, human.approve()), "AwaitingHuman", 2)

          writeWork(worktree, "flag.ts", "export const json = true\n")
          expectState(yield* act(id, 2, human.approve()), "Finished")

          // Two commits, in plan order, one per step — not three: the tail's
          // catch-all commit at `Integrating` finds a clean tree and makes no
          // new one, on the same re-runnability `Vcs.commitWork` promises a
          // retry.
          const range = `main..${worktree.branch}`
          const shas = git(repoDir, "log", "--format=%H", "--reverse", range).split("\n")
          expect(shas).toHaveLength(2)

          const subjects = git(repoDir, "log", "--format=%s", "--reverse", range).split("\n")
          expect(subjects).toEqual(["1-plan: Produce the plan.", "2-work: Produce the work."])

          for (const sha of shas) {
            expect(git(repoDir, "show", "-s", "--format=%B", sha)).toContain(`Orkestra-Trak: ${id}`)
          }

          // Each commit carries only its own step's file.
          expect(git(repoDir, "show", "--name-only", "--format=", shas[0] ?? "").trim()).toBe(
            "plan.md",
          )
          expect(git(repoDir, "show", "--name-only", "--format=", shas[1] ?? "").trim()).toBe(
            "flag.ts",
          )
        }),
    )
  })

  it("leaves the branch with no commits when every step is document-only", async () => {
    await runFlow(
      [
        composer("plan", "work"),
        step(1, "plan", reply.artifact("the plan")),
        step(2, "work", reply.artifact("the work")),
      ],
      (id) =>
        Effect.gen(function* () {
          const worktree = worktreeOf(yield* create(id, "Add a --json flag"))
          const repoDir = repoOf(worktree.path)

          // No `writeWork` at either step: both artifacts are documents alone.
          yield* act(id, 0, human.approve()) // the plan
          yield* act(id, 1, human.approve()) // step 0's artifact
          expectState(yield* act(id, 2, human.approve()), "Finished")

          expect(git(repoDir, "rev-list", "--count", `main..${worktree.branch}`)).toBe("0")
        }),
    )
  })

  it("keeps an earlier step's commit and its checkout when a later step fails", async () => {
    await runFlow(
      [
        composer("plan", "work"),
        step(1, "plan", reply.artifact("the plan")),
        crashesOn(/Produce the work/, "connection closed"),
      ],
      (id) =>
        Effect.gen(function* () {
          const worktree = worktreeOf(yield* create(id, "Add a --json flag"))
          const repoDir = repoOf(worktree.path)

          yield* act(id, 0, human.approve()) // the plan
          writeWork(worktree, "plan.md", "# the plan\n")
          const failed = yield* act(id, 1, human.approve()) // step 0's artifact
          expect(failed.state._tag).toBe("Failed")
          if (failed.state._tag === "Failed") expect(failed.state.kind).toBe("provider")

          // Step 0's commit is on the branch — kept at its own boundary, not lost
          // with the step that crashed after it.
          expect(git(repoDir, "rev-list", "--count", `main..${worktree.branch}`)).toBe("1")
          expect(git(repoDir, "show", `${worktree.branch}:plan.md`)).toBe("# the plan")
          // And the failed step's checkout is still there, for a human to look at.
          expect(fs.existsSync(worktree.path)).toBe(true)
        }),
    )
  })
})

describe("the project's setup script, on the way back in", () => {
  const setup: Check = {
    name: "setup",
    description: "Installs dependencies.",
    timeoutSeconds: 60,
    askedEverySeconds: undefined,
    exclusive: false,
    cache: true,
    ignoresLinguistGenerated: false,
    units: undefined,
    cacheAcross: "platform" as const,
    path: "/nowhere/setup.sh",
  }
  /** A trak that finished, then something came back about it. */
  const turns = [
    composer("work"),
    step(1, "work", reply.artifact("done")),
    afterReentry("review"),
    step(2, "review", reply.artifact("checked")),
  ]

  it("does not run again for a held trak — the checkout it needs is the one it has", async () => {
    // A held trak keeps its directory and its `node_modules` across a re-entry.
    // The alternative — commit, remove the checkout, re-create it from the branch,
    // re-install — pays a full setup every cycle. The setup script is the thing
    // that notices if this stops being true.
    await runFlowWithAgentLog(
      turns,
      (id, _agentLog, checksLog) =>
        Effect.gen(function* () {
          const worktree = worktreeOf(yield* createAndStart(id, "Add a --json flag"))
          expectState(yield* act(id, 1, human.approve()), "Finished")
          expect(ranSetup(yield* checksLog)).toBe(1)

          yield* advance(id, Events.reentered("CI failed on main"))
          expect(fs.existsSync(worktree.path)).toBe(true)
          expect(ranSetup(yield* checksLog)).toBe(1)
        }),
      library({ setup }),
      { setup: [pass] },
    )
  })

  it("runs again for a closed one, whose checkout it has to rebuild", async () => {
    // The inverse, and the reason the answer cannot be read off the log alone: a
    // closed trak's directory is gone, so the re-created one is genuinely fresh
    // and everything the project needs has to be put back into it.
    await runFlowWithAgentLog(
      turns,
      (id, _agentLog, checksLog) =>
        Effect.gen(function* () {
          const worktree = worktreeOf(yield* createAndStart(id, "Add a --json flag"))
          expectState(yield* act(id, 1, human.approve()), "Finished")
          expectState(yield* close(id), "Closed")
          expect(fs.existsSync(worktree.path)).toBe(false)

          yield* advance(id, Events.reentered("CI failed on main"))
          expect(fs.existsSync(worktree.path)).toBe(true)
          expect(ranSetup(yield* checksLog)).toBe(2)
        }),
      library({ setup }),
      { setup: [pass] },
    )
  })

  it("runs again for a held trak whose checkout somebody deleted by hand", async () => {
    // **Why the log cannot answer this on its own.** `WorktreeReady` says setup
    // completed once and `TrakState` says the engine has not removed anything —
    // both true here, and both wrong. Only `hasCheckout` knows, and getting it
    // wrong means re-entering into a directory with nothing installed in it.
    await runFlowWithAgentLog(
      turns,
      (id, _agentLog, checksLog) =>
        Effect.gen(function* () {
          const worktree = worktreeOf(yield* createAndStart(id, "Add a --json flag"))
          expectState(yield* act(id, 1, human.approve()), "Finished")
          fs.rmSync(worktree.path, { recursive: true, force: true })

          yield* advance(id, Events.reentered("CI failed on main"))
          expect(fs.existsSync(worktree.path)).toBe(true)
          expect(ranSetup(yield* checksLog)).toBe(2)
        }),
      library({ setup }),
      { setup: [pass] },
    )
  })
})

/** The setup script both themes below count runs of. */
const remadeSetup: Check = {
  name: "setup",
  description: "Installs dependencies.",
  timeoutSeconds: 60,
  askedEverySeconds: undefined,
  exclusive: false,
  cache: true,
  ignoresLinguistGenerated: false,
  units: undefined,
  cacheAcross: "platform" as const,
  path: "/nowhere/setup.sh",
}

describe("a held checkout somebody deleted, picked up where the trak stands", () => {
  // After a restore with no runner, every held checkout is
  // missing. Work that runs in one makes it again first, from the trak's branch, and
  // runs setup there; the log is not told, because nothing about the trak changed.
  const setup = remadeSetup

  it("is made again from the branch when a person acts at a gate", async () => {
    await runFlowWithAgentLog(
      [
        composer("plan", "work", "review"),
        step(1, "plan", reply.artifact("the plan")),
        step(2, "work", reply.artifact("done")),
        step(3, "review", reply.artifact("checked")),
      ],
      (id, agentLog, checksLog) =>
        Effect.gen(function* () {
          const worktree = worktreeOf(yield* createAndStart(id, "Add a --json flag"))
          writeWork(worktree, "plan.md", "# the plan\n")
          expectAwaiting(yield* act(id, 1, human.approve()), "approval") // keeps plan.md
          fs.rmSync(worktree.path, { recursive: true, force: true })

          const preparing = recordingPreparation()
          const trak = yield* Effect.provide(act(id, 2, human.approve()), preparing.layer)
          expectAwaiting(trak, "approval")
          // Setup runs before the work that needs it, and is named so while it does.
          expect(preparing.seen).toEqual([`${id}:SettingUp`])
          expect(trak.worktree).toEqual(worktree)
          expect(fs.readFileSync(path.join(worktree.path, "plan.md"), "utf8")).toBe("# the plan\n")
          expect(git(worktree.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe(worktree.branch)
          expect(ranSetup(yield* checksLog)).toBe(2)
          expect((yield* agentLog).requests.at(-1)?.cwd).toBe(worktree.path)
          expect(yield* countTag(id, "WorktreeReady")).toBe(1)
        }),
      library({ setup }),
      { setup: [pass, pass] },
    )
  })

  it("is made again when a trak cut off mid-step is restarted", async () => {
    await runFlowWithAgentLog(
      [composer("work"), step(1, "work", reply.artifact("done"))],
      (id, agentLog, checksLog) =>
        Effect.gen(function* () {
          const worktree = worktreeOf(yield* create(id, "Add a --json flag"))
          // The log a process killed after the approval and before the turn ended
          // leaves: the plan entered, the step under way, nothing back from it.
          const store = yield* Store
          yield* seedLog(store, id, [Events.humanActed(0, Actions.approve())])
          fs.rmSync(worktree.path, { recursive: true, force: true })

          const trak = yield* advance(id, Events.restarted(undefined))
          expectAwaiting(trak, "approval")
          expect(fs.existsSync(worktree.path)).toBe(true)
          expect(ranSetup(yield* checksLog)).toBe(2)
          const requests = stepRuns(yield* agentLog)
          expect(requests).toHaveLength(1)
          expect(requests[0]?.cwd).toBe(worktree.path)
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "SetupStarted",
            "WorktreeReady",
            "SetupPassed",
            "ComposerReturned",
            "HumanActed",
            "Restarted",
            "ConditionsMet",
            "AgentReturned",
            "ChecksPassed",
          ])
        }),
      library({ setup }),
      { setup: [pass, pass] },
    )
  })

  it("fails the work, saying why, when the branch is gone too", async () => {
    await runFlowWithAgentLog(
      [composer("work"), step(1, "work", reply.artifact("done"))],
      (id, agentLog) =>
        Effect.gen(function* () {
          const worktree = worktreeOf(yield* create(id, "Add a --json flag"))
          const repoDir = repoOf(worktree.path)
          fs.rmSync(worktree.path, { recursive: true, force: true })
          git(repoDir, "worktree", "prune")
          git(repoDir, "branch", "-D", worktree.branch)

          const trak = yield* act(id, 0, human.approve())
          expectState(trak, "Failed")
          expect(trak.state).toMatchObject({ kind: "worktree" })
          expect(trak.state._tag === "Failed" ? trak.state.error : "").toContain(
            `so is ${worktree.branch}`,
          )
          // Nothing was made in its place: no checkout, no branch forked afresh.
          expect(fs.existsSync(worktree.path)).toBe(false)
          expect(git(repoDir, "branch", "--list", worktree.branch)).toBe("")
          expect(stepRuns(yield* agentLog)).toHaveLength(0)
        }),
    )
  })
})

describe("a remade checkout whose setup fails", () => {
  // Taken away again, its branch and refs kept, so the retry makes it once more.
  const setup = remadeSetup

  it("keeps the branch when setup fails on a remade checkout with commits, and the retry carries on", async () => {
    await runFlowWithAgentLog(
      [
        composer("plan", "work", "review"),
        step(1, "plan", reply.artifact("the plan")),
        step(2, "work", reply.artifact("done")),
        step(3, "review", reply.artifact("checked")),
      ],
      (id, agentLog, checksLog) =>
        Effect.gen(function* () {
          const worktree = worktreeOf(yield* createAndStart(id, "Add a --json flag"))
          const repoDir = repoOf(worktree.path)
          writeWork(worktree, "plan.md", "# the plan\n")
          yield* act(id, 1, human.approve()) // keeps plan.md
          fs.rmSync(worktree.path, { recursive: true, force: true })

          const failed = yield* act(id, 2, human.approve())
          expect(failed.state).toMatchObject({
            _tag: "Failed",
            kind: "worktree",
            setup: "no network",
          })
          expect(fs.existsSync(worktree.path)).toBe(false)
          expect(git(repoDir, "show", `${worktree.branch}:plan.md`)).toBe("# the plan")

          const trak = yield* advance(id, Events.restarted(undefined))
          expectAwaiting(trak, "approval")
          expect(fs.readFileSync(path.join(worktree.path, "plan.md"), "utf8")).toBe("# the plan\n")
          expect(ranSetup(yield* checksLog)).toBe(3)
          expect((yield* agentLog).requests.at(-1)?.cwd).toBe(worktree.path)
        }),
      library({ setup }),
      { setup: [pass, fail("no network"), pass] },
    )
  })

  it("keeps the branch when setup fails on a remade checkout with nothing committed, and the retry carries on", async () => {
    await runFlowWithAgentLog(
      [composer("work"), step(1, "work", reply.artifact("done"))],
      (id, agentLog, checksLog) =>
        Effect.gen(function* () {
          const worktree = worktreeOf(yield* create(id, "Add a --json flag"))
          const repoDir = repoOf(worktree.path)
          const store = yield* Store
          yield* seedLog(store, id, [Events.humanActed(0, Actions.approve())])
          fs.rmSync(worktree.path, { recursive: true, force: true })

          const failed = yield* advance(id, Events.restarted(undefined))
          expect(failed.state).toMatchObject({
            _tag: "Failed",
            kind: "worktree",
            setup: "no network",
          })
          expect(failed.state._tag === "Failed" ? failed.state.error : "").toContain("no network")
          expect(fs.existsSync(worktree.path)).toBe(false)
          // The branch is the base under another name, which `removeWorktree` would delete.
          expect(git(repoDir, "rev-parse", worktree.branch)).toBe(worktree.base)
          expect(git(repoDir, "for-each-ref", `refs/orkestra/base/${worktree.branch}`)).not.toBe("")

          const trak = yield* advance(id, Events.restarted(undefined))
          expectAwaiting(trak, "approval")
          expect(trak.worktree).toEqual(worktree)
          expect(ranSetup(yield* checksLog)).toBe(3)
          const requests = stepRuns(yield* agentLog)
          expect(requests).toHaveLength(1)
          expect(requests[0]?.cwd).toBe(worktree.path)
        }),
      library({ setup }),
      { setup: [pass, fail("no network"), pass] },
    )
  })
})

describe("a setup script that fails", () => {
  const setup: Check = {
    name: "setup",
    description: "Installs dependencies.",
    timeoutSeconds: 60,
    askedEverySeconds: undefined,
    exclusive: false,
    cache: true,
    ignoresLinguistGenerated: false,
    units: undefined,
    cacheAcross: "platform" as const,
    path: "/nowhere/setup.sh",
  }

  it("fails the trak with what it printed, before a turn on a CLI that cannot wait for it", async () => {
    // The scripted CLI holds no command for setup, as Codex holds none: its turn starts
    // only once setup has ended, so a failure stops the trak with nothing spawned.
    await runFlowWithAgentLog(
      [composer("work"), step(1, "work", reply.artifact("done"))],
      (id, agentLog) =>
        Effect.gen(function* () {
          const trak = yield* create(id, "Add a --json flag")

          expect(trak.state).toMatchObject({
            _tag: "Failed",
            kind: "worktree",
            setup: "no lockfile",
          })
          if (trak.state._tag === "Failed") {
            // What the script said, and — because the checkout is left where it
            // is — where to go and look at what it left half-done.
            expect(trak.state.error).toContain("no lockfile")
            expect(trak.state.error).toContain(`.orkestra/.worktrees/${id}`)
          }
          expect(trak.failedFrom).toMatchObject({ _tag: "Composing" })
          expect(trak.setup).toBe("failed")
          expect((yield* agentLog).requests).toHaveLength(0)
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "SetupStarted",
            "WorktreeReady",
            "SetupFailed",
          ])
        }),
      library({ setup }),
      { setup: [fail("no lockfile")] },
    )
  })

  it("runs again on the retry, and the turn starts once it passes", async () => {
    await runFlowWithAgentLog(
      [composer("work"), step(1, "work", reply.artifact("done"))],
      (id, agentLog, checksLog) =>
        Effect.gen(function* () {
          expectState(yield* create(id, "Add a --json flag"), "Failed")

          expectAwaitingProposal(yield* advance(id, Events.restarted(undefined)))
          expect(ranSetup(yield* checksLog)).toBe(2)
          expect((yield* agentLog).requests).toHaveLength(1)
          expect((yield* logTags(id)).slice(3)).toEqual([
            "SetupFailed",
            "Restarted",
            "SetupStarted",
            "SetupPassed",
            "ComposerReturned",
          ])
        }),
      library({ setup }),
      { setup: [fail("no lockfile"), pass] },
    )
  })
})

describe("the project's teardown script", () => {
  const teardown: Check = {
    name: "teardown",
    description: "Drops the worktree's database.",
    timeoutSeconds: 60,
    askedEverySeconds: undefined,
    exclusive: false,
    cache: true,
    ignoresLinguistGenerated: false,
    units: undefined,
    cacheAcross: "platform" as const,
    path: "/nowhere/teardown.sh",
  }
  const turns = [composer("work"), step(1, "work", reply.artifact("done"))]

  it("runs in the checkout while it is still there, then the archive removes it", async () => {
    // Read when the script runs rather than after: the only way to tell *before* the
    // removal from *instead of* it. `reaches: local` is the value a sandbox would skip,
    // and with no runner file it runs like any other — the other cases here declare none.
    const seen: boolean[] = []
    let checkout = ""
    await runFlowWithAgentLog(
      turns,
      (id, _agentLog, checksLog) =>
        Effect.gen(function* () {
          const worktree = worktreeOf(yield* createAndStart(id, "Add a --json flag"))
          checkout = worktree.path
          expectState(yield* act(id, 1, human.approve()), "Finished")
          expect(ranTeardown(yield* checksLog)).toBe(0)

          expectState(yield* close(id), "Closed")
          expect(seen).toEqual([true])
          expect((yield* checksLog).calls).toEqual([
            { name: "teardown", cwd: worktree.path, args: [] },
          ])
          expect(fs.existsSync(worktree.path)).toBe(false)
        }),
      library({ teardown: { ...teardown, reaches: "local" } }),
      {
        teardown: [
          heldBack(
            Effect.sync(() => {
              seen.push(fs.existsSync(checkout))
            }),
            pass,
          ),
        ],
      },
    )
  })

  it("blocks the removal when it fails, and a resume runs it again", async () => {
    // A failure or a timeout is the same `passed: false` from the port, so one case
    // covers both. Removing anyway would delete the only place the script can run.
    await runFlowWithAgentLog(
      turns,
      (id, _agentLog, checksLog) =>
        Effect.gen(function* () {
          const worktree = worktreeOf(yield* createAndStart(id, "Add a --json flag"))
          const repoDir = repoOf(worktree.path)
          expectState(yield* act(id, 1, human.approve()), "Finished")

          const blocked = yield* close(id)
          expect(blocked.state).toMatchObject({ _tag: "Failed", kind: "archive" })
          expect(blocked.state._tag === "Failed" ? blocked.state.error : "").toContain(
            "database is in use",
          )
          expect(fs.existsSync(worktree.path)).toBe(true)
          expect(git(repoDir, "branch", "--list", worktree.branch)).not.toBe("")

          expectState(yield* advance(id, Events.restarted(undefined)), "Closed")
          expect(ranTeardown(yield* checksLog)).toBe(2)
          expect(fs.existsSync(worktree.path)).toBe(false)
          expect(git(repoDir, "branch", "--list", worktree.branch)).toBe("")
          expect((yield* logTags(id)).slice(-4)).toEqual([
            "Closed",
            "WorktreeFailed",
            "Restarted",
            "WorktreeRemoved",
          ])
        }),
      library({ teardown }),
      { teardown: [fail("database is in use"), pass] },
    )
  })

  it("does not run for a checkout somebody already deleted, and the archive goes ahead", async () => {
    // Its per-worktree names come from the checkout's directory, and running it from
    // anywhere else could drop another worktree's database.
    await runFlowWithAgentLog(
      turns,
      (id, _agentLog, checksLog) =>
        Effect.gen(function* () {
          const worktree = worktreeOf(yield* createAndStart(id, "Add a --json flag"))
          expectState(yield* act(id, 1, human.approve()), "Finished")
          fs.rmSync(worktree.path, { recursive: true, force: true })

          expectState(yield* close(id), "Closed")
          expect(ranTeardown(yield* checksLog)).toBe(0)
        }),
      library({ teardown }),
      { teardown: [fail("should not have run")] },
    )
  })
})

/**
 * A remake that left the sandbox's uncommitted changes behind, met by something that is
 * not a step — a process start, or a Rebuild pressed at rest. The sandboxes tell the
 * recorder, as whatever provides them must; here the recorder
 * fails the trak naming the ref, and a restart takes it back where it was parked.
 */
/** The recorder's append has landed. */
const hasWorktreeFailed = (tags: readonly string[]): boolean => tags.includes("WorktreeFailed")

describe("a remake that left the uncommitted changes behind, off a step", () => {
  const carried = "refs/orkestra/carried/t1"
  const failure = new GitFailed({
    op: "put back uncommitted changes",
    reason: "did not apply",
    carried,
  })

  it("fails a trak parked at a gate with the ref, and a restart parks it again", async () => {
    await runFlow([composer("work")], (id) =>
      Effect.gen(function* () {
        // `create` leaves it at the plan gate: no drive is moving it.
        yield* create(id, "Add a --json flag")
        const record = recordLeftBehind(yield* Drives)
        expect(yield* record(id, failure)).toBe(true)
        yield* logged(id, hasWorktreeFailed)
        const trak = replayHistory(id, yield* (yield* Store).events(id))
        expect(trak.state).toMatchObject({ _tag: "Failed", kind: "worktree", carried })
        expect(trak.failedFrom?._tag).toBe("AwaitingProposal")

        yield* advance(id, Events.restarted(undefined))
        expect(replayHistory(id, yield* (yield* Store).events(id)).state._tag).toBe(
          "AwaitingProposal",
        )
      }),
    )
  })
})
