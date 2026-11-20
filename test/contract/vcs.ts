// The Vcs port's contract, written once and run against every implementation.
//
// Everything here is about the promise the port makes rather than about git:
// that a trak gets somewhere isolated to work, that asking twice does not cost
// it the first one, that a child starts from its parent's work and lands back on
// it, that committing keeps the work — the one that matters most — and that
// clearing up afterwards is a second thing, asked for separately.
//
// Each case gets a repository of its own, because every method here changes one.
// The assertions run INSIDE its scope: a suite that lets the repo be removed
// first goes on passing against directories that are no longer there, which is
// the bug this port's own fixture shipped with once already.
//
// Two groups. `vcsContract` reads every answer through the port and the files on
// disk, so any implementation can run it. `vcsGitContract` also reads git itself,
// and runs against git alone.

import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, type Layer, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { forkRefFor, IGNORE_HEADER, IGNORED_PATHS } from "../../src/vcs/logic/paths.js"
import type { GitFailed } from "../../src/vcs/types/errors.js"
import { HostHead, StashedSync, SyncRefusal } from "../../src/vcs/types/host-status.js"
import {
  BranchName,
  ChangeRange,
  CommitSha,
  KeptWork,
  MergeInto,
  MergeOutcome,
  Removal,
} from "../../src/vcs/types/worktree.js"
import { Vcs, type VcsShape } from "../../src/vcs/ports/vcs.js"
import { addOrigin, commitOnHost, landElsewhere, type Origin } from "../support/git.js"

export interface VcsUnderTest {
  readonly label: string
  /** A fresh project directory per case, removed when the scope closes. */
  readonly repository: Effect.Effect<string, never, Scope.Scope>
  /** Per test, because each case needs a repository of its own. */
  readonly layer: (repoDir: string) => Layer.Layer<Vcs, GitFailed>
  /** Real subprocesses need a moment; a fake is instant. */
  readonly timeoutMs: number
}

/** No runner here: every removal reaches in, and nothing judges a fetch that never runs. */
const REACH = Removal.Reach({ kept: KeptWork.Unsure({ why: "this contract runs no sandbox" }) })

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim()

/**
 * The ignore file `ensureIgnored` maintains: the common directory's `info/exclude`,
 * which for a main checkout is under its own `.git`.
 */
const ignoreFile = (repo: string): string => join(repo, ".git", "info", "exclude")

/** `info/` may not exist yet in a fixture with no `.git` of its own. */
const writeIgnoreFile = (repo: string, text: string): void => {
  mkdirSync(join(repo, ".git", "info"), { recursive: true })
  writeFileSync(ignoreFile(repo), text)
}

/**
 * The agent committing inside its own checkout — which nothing stops a step from
 * doing, and which several cases here are about the consequences of.
 */
const commitIn = (checkout: string, message: string): void => {
  git(checkout, "add", "-A")
  git(checkout, "commit", "--no-verify", "-m", message)
}

/**
 * A fresh repository, the implementation under test pointed at it, and both
 * handed to the case — half of what this suite asserts is about the repository
 * the worktree came from, which the port itself never mentions.
 */
type InRepo = (
  body: (ctx: {
    readonly repo: string
    readonly vcs: VcsShape
    readonly run: <A>(effect: Effect.Effect<A, GitFailed>) => Promise<A>
  }) => Promise<void>,
) => Promise<void>

const inRepoFor =
  (c: VcsUnderTest): InRepo =>
  (body) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(c.repository, (repo) =>
          Effect.flatMap(Vcs, (vcs: VcsShape) =>
            Effect.promise(() =>
              body({
                repo,
                vcs,
                run: (effect) => Effect.runPromise(Effect.timeout(effect, `${c.timeoutMs} millis`)),
              }),
            ),
          ).pipe(Effect.provide(c.layer(repo))),
        ),
      ),
    )

// -- shared: what every implementation answers -------------------------------
//
// Each case here reads its answers through the port and the files on disk, and
// nothing else — so it holds a fake to the answers git gives, and runs against git
// as well to prove they are git's.

/** Somewhere isolated to work, and asking again not costing the trak the first one. */
const creationCases = (inRepo: InRepo): void => {
  it("gives a trak its own checkout, holding the repository's files", async () => {
    await inRepo(async ({ vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))

      expect(existsSync(worktree.path)).toBe(true)
      expect(await run(vcs.hasCheckout("t1"))).toBe(true)
      // The repository's history, not an empty directory somewhere convenient.
      expect(existsSync(join(worktree.path, "README.md"))).toBe(true)
    })
  })

  it("leaves the host where it was, on its branch and clean", async () => {
    await inRepo(async ({ vcs, run }) => {
      await run(vcs.createWorktree("t1"))

      // The checkout sits inside the host's tree, and it is not the host's work.
      expect(await run(vcs.hostBranch())).toBe("main")
      expect(await run(vcs.dirty())).toEqual([])
    })
  })

  it("asking twice gives the checkout the trak already has", async () => {
    await inRepo(async ({ vcs, run }) => {
      const first = await run(vcs.createWorktree("t1"))
      const second = await run(vcs.createWorktree("t1"))

      expect(second).toEqual(first)
    })
  })
}

/** Keeping the work, and — separately, later, and only when asked — clearing up. */
const finishingCases = (inRepo: InRepo): void => {
  it("commits the work to the branch and leaves the checkout standing", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      const sha = await run(vcs.commitWork(worktree, "add a flag"))

      expect(sha).toBeDefined()
      expect(existsSync(worktree.path)).toBe(true)
      const changes = await run(vcs.changes(ChangeRange.Branch({ worktree })))
      expect(changes.files.map((f) => f.path)).toEqual(["flag.ts"])
      // On the branch and nowhere else.
      expect(existsSync(join(repo, "flag.ts"))).toBe(false)
    })
  })

  it("removing takes the checkout away and leaves the branch", async () => {
    await inRepo(async ({ vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      await run(vcs.commitWork(worktree, "add a flag"))
      await run(vcs.removeWorktree(worktree, REACH))

      expect(existsSync(worktree.path)).toBe(false)
      expect(await run(vcs.hasCheckout("t1"))).toBe(false)
      expect(await run(vcs.hasBranch("t1"))).toBe(true)
      const changes = await run(vcs.changes(ChangeRange.Branch({ worktree })))
      expect(changes.files.map((f) => f.path)).toEqual(["flag.ts"])
    })
  })

  it("takes the branch with it when there was nothing to commit — at removal, not before", async () => {
    await inRepo(async ({ vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      const sha = await run(vcs.commitWork(worktree, "changed nothing"))

      expect(sha).toBeUndefined()
      expect(await run(vcs.hasBranch("t1"))).toBe(true)

      await run(vcs.removeWorktree(worktree, REACH))
      expect(existsSync(worktree.path)).toBe(false)
      expect(await run(vcs.hasBranch("t1"))).toBe(false)
    })
  })

  it("committing twice keeps the commit — the second run reports the first one's work", async () => {
    await inRepo(async ({ vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      const first = await run(vcs.commitWork(worktree, "add a flag"))
      const second = await run(vcs.commitWork(worktree, "add a flag"))

      expect(second).toBe(first)
      expect(await run(vcs.hasBranch("t1"))).toBe(true)
    })
  })

  it("commits again over a change made since — a second commit on the branch", async () => {
    await inRepo(async ({ vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      const first = kept(await run(vcs.commitWork(worktree, "add a flag")))
      writeFileSync(join(worktree.path, "docs.md"), "# json flag\n")
      const second = kept(await run(vcs.commitWork(worktree, "document it")))

      expect(second).not.toBe(first)
      const step = await run(vcs.changes(ChangeRange.Commits({ from: first, to: second })))
      expect(step.files.map((f) => f.path)).toEqual(["docs.md"])
    })
  })
}

/**
 * The awkward states each half has to reach the same answer from — one a human
 * deleted, and a second run over its own work.
 */
const rerunCases = (inRepo: InRepo): void => {
  it("says whether a checkout is there, including after a human deletes it", async () => {
    await inRepo(async ({ vcs, run }) => {
      expect(await run(vcs.hasCheckout("t1"))).toBe(false)

      const worktree = await run(vcs.createWorktree("t1"))
      expect(await run(vcs.hasCheckout("t1"))).toBe(true)

      await run(vcs.removeWorktree(worktree, REACH))
      expect(await run(vcs.hasCheckout("t1"))).toBe(false)

      await run(vcs.createWorktree("t1"))
      rmSync(worktree.path, { recursive: true, force: true })
      expect(await run(vcs.hasCheckout("t1"))).toBe(false)
    })
  })

  it("makes a checkout somebody deleted again at its path, from its branch", async () => {
    await inRepo(async ({ vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "kept.ts"), "export const kept = true\n")
      await run(vcs.commitWork(worktree, "work worth keeping"))
      rmSync(worktree.path, { recursive: true, force: true })

      expect(await run(vcs.remakeCheckout("t1"))).toEqual(worktree)
      expect(await run(vcs.hasCheckout("t1"))).toBe(true)
      expect(readFileSync(join(worktree.path, "kept.ts"), "utf8")).toBe(
        "export const kept = true\n",
      )
    })
  })

  it("leaves a checkout that is there as it is", async () => {
    await inRepo(async ({ vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "unkept.ts"), "export const unkept = true\n")

      expect(await run(vcs.remakeCheckout("t1"))).toBeUndefined()
      expect(readFileSync(join(worktree.path, "unkept.ts"), "utf8")).toBe(
        "export const unkept = true\n",
      )
    })
  })

  it("takes a checkout away without its branch, even one nothing was committed to", async () => {
    await inRepo(async ({ vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      await run(vcs.removeCheckout(worktree))

      expect(existsSync(worktree.path)).toBe(false)
      expect(await run(vcs.hasBranch("t1"))).toBe(true)
      expect(await run(vcs.remakeCheckout("t1"))).toEqual(worktree)
    })
  })

  it("refuses to make a checkout again once its branch is gone too", async () => {
    await inRepo(async ({ vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      // Nothing committed, so the removal takes the branch with it.
      await run(vcs.removeWorktree(worktree, REACH))

      await expect(run(vcs.remakeCheckout("t1"))).rejects.toThrow(/so is trak\/t1/)
      expect(existsSync(worktree.path)).toBe(false)
      expect(await run(vcs.hasBranch("t1"))).toBe(false)
    })
  })

  it("says whether a branch is there, including after the checkout and the records have gone", async () => {
    await inRepo(async ({ vcs, run }) => {
      // What the mint asks before it gives a name away. The store cannot answer
      // it: wiping a trak removes its log and touches neither the branch nor the
      // recorded base ref, so a branch outliving every record of its trak is the
      // ordinary state — and a name redrawn onto it is a new trak continuing a
      // dead one's commits.
      expect(await run(vcs.hasBranch("t1"))).toBe(false)

      const worktree = await run(vcs.createWorktree("t1"))
      expect(await run(vcs.hasBranch("t1"))).toBe(true)

      writeFileSync(join(worktree.path, "kept.ts"), "export const kept = true\n")
      await run(vcs.commitWork(worktree, "work worth keeping"))
      await run(vcs.removeWorktree(worktree, REACH))
      // The checkout went and the branch stayed, because it holds work — which is
      // the state the whole question exists for.
      expect(await run(vcs.hasCheckout("t1"))).toBe(false)
      expect(await run(vcs.hasBranch("t1"))).toBe(true)
    })
  })

  it("says a branch is gone once an empty trak has taken it with it", async () => {
    await inRepo(async ({ vcs, run }) => {
      // The other half: nothing was committed, so `removeWorktree` deletes the
      // branch, and the name really is free again.
      const worktree = await run(vcs.createWorktree("t1"))
      await run(vcs.commitWork(worktree, "changed nothing"))
      await run(vcs.removeWorktree(worktree, REACH))

      expect(await run(vcs.hasBranch("t1"))).toBe(false)
    })
  })

  it("removing an empty trak twice is still a no-op, not a failure", async () => {
    await inRepo(async ({ vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      await run(vcs.commitWork(worktree, "changed nothing"))
      await run(vcs.removeWorktree(worktree, REACH))
      await run(vcs.removeWorktree(worktree, REACH))

      expect(await run(vcs.hasBranch("t1"))).toBe(false)
      expect(await run(vcs.commitWork(worktree, "changed nothing"))).toBeUndefined()
    })
  })
}

/** A child landing back on its parent's branch, cleanly or not at all. */
const spawnCases = (inRepo: InRepo): void => {
  it("brings a child's work onto the parent's branch, and nowhere else", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      const parent = await run(vcs.createWorktree("parent"))
      const child = await run(vcs.createWorktree("child", parent.branch))
      writeFileSync(join(child.path, "lens.ts"), "export const lens = true\n")
      await run(vcs.commitWork(child, "the child's work"))

      const outcome = await run(
        vcs.merge(MergeInto.Checkout({ worktree: parent }), child.branch, "join child"),
      )

      expect(outcome._tag).toBe("Merged")
      expect(readFileSync(join(parent.path, "lens.ts"), "utf8")).toBe("export const lens = true\n")
      expect(await run(vcs.dirty(parent))).toEqual([])
      // The branch the human is standing on is not where a join lands.
      expect(existsSync(join(repo, "lens.ts"))).toBe(false)
    })
  })

  it("merging twice reports the first merge's tip, rather than failing on it", async () => {
    await inRepo(async ({ vcs, run }) => {
      // A join is restartable for the same reason finishing is: the process can
      // die between the merge and the event reaching the log, and the second run
      // must not read *already up to date* as a reason to fail or to report
      // something new.
      const parent = await run(vcs.createWorktree("parent"))
      const child = await run(vcs.createWorktree("child", parent.branch))
      writeFileSync(join(child.path, "lens.ts"), "export const lens = true\n")
      await run(vcs.commitWork(child, "the child's work"))

      const first = await run(
        vcs.merge(MergeInto.Checkout({ worktree: parent }), child.branch, "join child"),
      )
      const second = await run(
        vcs.merge(MergeInto.Checkout({ worktree: parent }), child.branch, "join child"),
      )

      expect(second).toEqual(first)
    })
  })

  it("refuses a join that conflicts, leaving the parent's files and the child's branch", async () => {
    await inRepo(async ({ vcs, run }) => {
      const parent = await run(vcs.createWorktree("parent"))
      const child = await run(vcs.createWorktree("child", parent.branch))
      writeFileSync(join(child.path, "lens.ts"), "the child's answer\n")
      await run(vcs.commitWork(child, "the child's work"))
      writeFileSync(join(parent.path, "lens.ts"), "the parent's answer\n")
      await run(vcs.commitWork(parent, "the parent's own answer"))

      const outcome = await run(
        vcs.merge(MergeInto.Checkout({ worktree: parent }), child.branch, "join child"),
      )

      expect(outcome).toEqual(MergeOutcome.Conflicted({ paths: ["lens.ts"] }))
      expect(await run(vcs.dirty(parent))).toEqual([])
      expect(readFileSync(join(parent.path, "lens.ts"), "utf8")).toBe("the parent's answer\n")
      expect(await run(vcs.hasBranch("child"))).toBe(true)
    })
  })
}

/** A whole trak into the branch a human is standing on — `main`, where the fixture leaves it. */
const hostMergeCases = (inRepo: InRepo): void => {
  it("brings a trak's branch into the branch the host is on", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      await run(vcs.commitWork(worktree, "add a flag"))

      const outcome = await run(vcs.merge(MergeInto.Host(), worktree.branch, "merge the trak"))

      expect(outcome._tag).toBe("Merged")
      expect(readFileSync(join(repo, "flag.ts"), "utf8")).toBe("export const json = true\n")
      expect(await run(vcs.hostBranch())).toBe("main")
      expect(await run(vcs.dirty())).toEqual([])
    })
  })

  it("merging twice reports the same tip, rather than failing on its own work", async () => {
    await inRepo(async ({ vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      await run(vcs.commitWork(worktree, "add a flag"))

      const first = await run(vcs.merge(MergeInto.Host(), worktree.branch, "merge the trak"))
      const second = await run(vcs.merge(MergeInto.Host(), worktree.branch, "merge the trak"))

      expect(second).toEqual(first)
    })
  })

  it("refuses a conflict between two traks' work, leaving the host as it was", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // Two traks answering the same file differently: the first lands, and the
      // second is told so before and after it is attempted.
      const first = await run(vcs.createWorktree("t1"))
      writeFileSync(join(first.path, "flag.ts"), "the first answer\n")
      await run(vcs.commitWork(first, "the first answer"))
      const second = await run(vcs.createWorktree("t2"))
      writeFileSync(join(second.path, "flag.ts"), "the second answer\n")
      await run(vcs.commitWork(second, "the second answer"))
      await run(vcs.merge(MergeInto.Host(), first.branch, "merge the first"))

      expect(await run(vcs.wouldConflict(MergeInto.Host(), second.branch))).toBe(true)
      const outcome = await run(vcs.merge(MergeInto.Host(), second.branch, "merge the second"))

      expect(outcome).toEqual(MergeOutcome.Conflicted({ paths: ["flag.ts"] }))
      expect(await run(vcs.dirty())).toEqual([])
      expect(readFileSync(join(repo, "flag.ts"), "utf8")).toBe("the first answer\n")
      expect(await run(vcs.hasBranch("t2"))).toBe(true)
      expect(await run(vcs.contains(MergeInto.Host(), second.branch))).toBe(false)
    })
  })

  it("names no default branch where no remote says", async () => {
    await inRepo(async ({ vcs, run }) => {
      expect(await run(vcs.defaultBranch())).toBeUndefined()
    })
  })

  it("says which branch the host is on", async () => {
    await inRepo(async ({ vcs, run }) => {
      expect(await run(vcs.hostBranch())).toBe("main")
    })
  })
}

/** The merge's question asked first, changing nothing by being asked. */
const predictionCases = (inRepo: InRepo): void => {
  it("says a clean merge is clean, and touches nothing asking", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      await run(vcs.commitWork(worktree, "add a flag"))

      expect(await run(vcs.wouldConflict(MergeInto.Host(), worktree.branch))).toBe(false)

      expect(await run(vcs.dirty())).toEqual([])
      expect(existsSync(join(repo, "flag.ts"))).toBe(false)
      expect(await run(vcs.contains(MergeInto.Host(), worktree.branch))).toBe(false)
    })
  })

  it("says a branch already merged would not conflict", async () => {
    await inRepo(async ({ vcs, run }) => {
      // The re-runnability `merge` promises, one question earlier: a preview
      // polled after somebody merged must not start claiming a conflict.
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      await run(vcs.commitWork(worktree, "add a flag"))
      await run(vcs.merge(MergeInto.Host(), worktree.branch, "merge the trak"))

      expect(await run(vcs.wouldConflict(MergeInto.Host(), worktree.branch))).toBe(false)
    })
  })
}

/** Whether a merge would bring anything, read off the history rather than a log. */
const containmentCases = (inRepo: InRepo): void => {
  it("holds a branch with nothing on it beyond where it was cut, and not one with a commit", async () => {
    await inRepo(async ({ vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      expect(await run(vcs.contains(MergeInto.Host(), worktree.branch))).toBe(true)
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      await run(vcs.commitWork(worktree, "add a flag"))
      expect(await run(vcs.contains(MergeInto.Host(), worktree.branch))).toBe(false)
    })
  })

  it("holds a branch once it has merged, and a checkout kept afterwards that did not move", async () => {
    await inRepo(async ({ vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      await run(vcs.commitWork(worktree, "add a flag"))
      await run(vcs.merge(MergeInto.Host(), worktree.branch, "merge the trak"))
      expect(await run(vcs.contains(MergeInto.Host(), worktree.branch))).toBe(true)
      // A commit that changes nothing leaves the tip where it was.
      await run(vcs.commitWork(worktree, "nothing to keep"))
      expect(await run(vcs.contains(MergeInto.Host(), worktree.branch))).toBe(true)
    })
  })

  it("answers about a child against its parent's checkout, not the host", async () => {
    await inRepo(async ({ vcs, run }) => {
      const parent = await run(vcs.createWorktree("parent"))
      const child = await run(vcs.createWorktree("child", parent.branch))
      writeFileSync(join(child.path, "lens.ts"), "the child's answer\n")
      await run(vcs.commitWork(child, "the child's work"))
      const into = MergeInto.Checkout({ worktree: parent })
      expect(await run(vcs.contains(into, child.branch))).toBe(false)
      await run(vcs.merge(into, child.branch, "merge the child"))
      expect(await run(vcs.contains(into, child.branch))).toBe(true)
      // The host never took it, and says so.
      expect(await run(vcs.contains(MergeInto.Host(), child.branch))).toBe(false)
    })
  })
}

/**
 * The two questions asked of the *host* repository, before a trak exists.
 *
 * The fixture's committed `.gitignore` already carries the entries, as an older
 * engine left them; the cases about writing them read `info/exclude`, which the
 * fixture leaves without them.
 */
const hostRepoCases = (inRepo: InRepo): void => {
  it("adds every entry a repository is missing, under one attributable comment", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // `info/` itself gone too: the adapter has to make it.
      rmSync(join(repo, ".git", "info"), { recursive: true, force: true })
      await run(vcs.ensureIgnored())

      const written = readFileSync(ignoreFile(repo), "utf8")
      for (const entry of IGNORED_PATHS) expect(written).toContain(`${entry}\n`)
      expect(written).toContain(IGNORE_HEADER)
    })
  })

  it("adds nothing to a repository that already has them, however often it runs", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await run(vcs.ensureIgnored())
      const before = readFileSync(ignoreFile(repo), "utf8")
      await run(vcs.ensureIgnored())
      await run(vcs.ensureIgnored())

      expect(readFileSync(ignoreFile(repo), "utf8")).toBe(before)
    })
  })

  it("never edits the repository's `.gitignore`", async () => {
    // The bug this replaced: the edit left the tree dirty, and the next trak's start
    // was refused over a file the engine itself had written.
    await inRepo(async ({ repo, vcs, run }) => {
      writeFileSync(join(repo, ".gitignore"), "node_modules/\n")
      await run(vcs.ensureIgnored())

      expect(readFileSync(join(repo, ".gitignore"), "utf8")).toBe("node_modules/\n")
    })
  })

  it("appends to what the human wrote rather than replacing it", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      writeIgnoreFile(repo, "node_modules/\ndist/\n")
      await run(vcs.ensureIgnored())

      const written = readFileSync(ignoreFile(repo), "utf8")
      expect(written.startsWith("node_modules/\ndist/\n")).toBe(true)
      for (const entry of IGNORED_PATHS) expect(written).toContain(`${entry}\n`)
    })
  })

  it("does not read a line that merely mentions an entry as the entry", async () => {
    // Matching on `includes` would take the comment below for the real thing and
    // commit a database into someone's repository, silently.
    await inRepo(async ({ repo, vcs, run }) => {
      writeIgnoreFile(repo, `# not this: ${IGNORED_PATHS[0]}\n`)
      await run(vcs.ensureIgnored())

      expect(readFileSync(ignoreFile(repo), "utf8")).toContain(`\n${IGNORED_PATHS[0]}\n`)
    })
  })

  it("reports nothing for a clean tree, and the file itself for a dirty one", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      expect(await run(vcs.dirty())).toEqual([])

      writeFileSync(join(repo, "half-done.txt"), "work in progress\n")
      const dirty = await run(vcs.dirty())
      // The lines, not a boolean: the CLI's refusal has to say which files, and
      // git's own status prefix is worth keeping in front of whoever reads it.
      expect(dirty).toHaveLength(1)
      expect(dirty[0]).toContain("half-done.txt")
    })
  })

  it("reads a checkout's own tree when given one, not the host's", async () => {
    // A child's merge goes into its parent's checkout, so that is the tree whose
    // uncommitted work is in the way — and the host's has nothing to do with it.
    await inRepo(async ({ repo, vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(repo, "host-only.txt"), "on the host\n")
      expect(await run(vcs.dirty(worktree))).toEqual([])

      writeFileSync(join(worktree.path, "in-progress.txt"), "in the checkout\n")
      const dirty = await run(vcs.dirty(worktree))
      expect(dirty).toHaveLength(1)
      expect(dirty[0]).toContain("in-progress.txt")
    })
  })
}

/** The sha a commit produced, loudly: every case below is about work that was kept. */
const kept = (sha: CommitSha | undefined): CommitSha => {
  if (sha === undefined) throw new Error("expected the commit to have kept something")
  return sha
}

/**
 * Reading the work back — the one thing here that decides nothing and is asked
 * only by a person looking.
 *
 * Two promises separate these from the rest: a **committed** slice is answered
 * from refs, so it survives the checkout being taken away, and the **uncommitted**
 * one is the only slice that needs the checkout at all — and says so by being
 * empty rather than by failing.
 */
const changesCases = (inRepo: InRepo): void => {
  it("shows every file the branch touched since it forked, across several steps", async () => {
    await inRepo(async ({ vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      await run(vcs.commitWork(worktree, "1-work"))
      writeFileSync(join(worktree.path, "docs.md"), "# json flag\n")
      await run(vcs.commitWork(worktree, "2-work"))

      const changes = await run(vcs.changes(ChangeRange.Branch({ worktree })))

      // Once each and in path order, with the whole branch's counts — not one
      // row per commit that touched them.
      expect(changes.files.map((f) => f.path)).toEqual(["docs.md", "flag.ts"])
      expect(changes.files.map((f) => f.change)).toEqual(["added", "added"])
      expect(changes.files.map((f) => f.additions)).toEqual([1, 1])
      expect(changes.omittedFiles).toBeUndefined()
    })
  })

  it("shows one step's own commit, and not the step before it", async () => {
    await inRepo(async ({ vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      const first = kept(await run(vcs.commitWork(worktree, "1-work")))
      writeFileSync(join(worktree.path, "docs.md"), "# json flag\n")
      const second = kept(await run(vcs.commitWork(worktree, "2-work")))

      const changes = await run(vcs.changes(ChangeRange.Commits({ from: first, to: second })))

      expect(changes.files.map((f) => f.path)).toEqual(["docs.md"])
    })
  })

  it("says nothing changed when both ends of the range are the same commit", async () => {
    await inRepo(async ({ vcs, run }) => {
      // What a step that wrote nothing resolves to: `commitWork` reads its answer
      // off the branch, so it reports the sha the step before it did.
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      const sha = kept(await run(vcs.commitWork(worktree, "1-work")))

      expect(await run(vcs.changes(ChangeRange.Commits({ from: sha, to: sha })))).toEqual({
        files: [],
      })
    })
  })

  it("shows an edit and a file the agent has not committed yet, with its contents", async () => {
    await inRepo(async ({ vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      await run(vcs.commitWork(worktree, "1-work"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = false\n")
      writeFileSync(join(worktree.path, "fresh.ts"), "export const fresh = true\n")

      const changes = await run(vcs.changes(ChangeRange.Uncommitted({ worktree })))

      // The untracked one is the half a plain `git diff HEAD` cannot see, and it
      // arrives as a real patch rather than as a name on a list.
      expect(changes.files.map((f) => [f.path, f.change])).toEqual([
        ["flag.ts", "modified"],
        ["fresh.ts", "added"],
      ])
      expect(changes.files[1]?.hunks[0]?.lines).toEqual([
        { kind: "add", text: "export const fresh = true", newLine: 1 },
      ])
    })
  })

  it("still shows the work after the checkout has been taken away", async () => {
    await inRepo(async ({ vcs, run }) => {
      // The branch outlives the checkout whenever anything was committed to it,
      // so a merged or closed trak stays readable — which is most of the traks
      // anybody wants to read.
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      const sha = kept(await run(vcs.commitWork(worktree, "1-work")))
      await run(vcs.removeWorktree(worktree, REACH))

      expect(existsSync(worktree.path)).toBe(false)
      const all = await run(vcs.changes(ChangeRange.Branch({ worktree })))
      expect(all.files.map((f) => f.path)).toEqual(["flag.ts"])
      const step = await run(vcs.changes(ChangeRange.Commits({ from: worktree.base, to: sha })))
      expect(step.files.map((f) => f.path)).toEqual(["flag.ts"])
    })
  })

  it("has no uncommitted work once there is no checkout to hold any", async () => {
    await inRepo(async ({ vcs, run }) => {
      // A fact rather than a failure: there is nowhere for uncommitted work to
      // be. Answering an error here would make an ordinary merged trak look
      // broken on a screen that asks for every slice.
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      await run(vcs.commitWork(worktree, "1-work"))
      await run(vcs.removeWorktree(worktree, REACH))

      expect(await run(vcs.changes(ChangeRange.Uncommitted({ worktree })))).toEqual({ files: [] })
    })
  })

  it("has nothing on a branch nothing was ever committed to", async () => {
    await inRepo(async ({ vcs, run }) => {
      // `removeWorktree` deletes such a branch, so its absence is *no committed
      // work* — not a repository that cannot answer.
      const worktree = await run(vcs.createWorktree("t1"))
      await run(vcs.commitWork(worktree, "changed nothing"))
      await run(vcs.removeWorktree(worktree, REACH))

      expect(await run(vcs.changes(ChangeRange.Branch({ worktree })))).toEqual({ files: [] })
    })
  })

  it("answers no files for a branch the archive has deleted", async () => {
    await inRepo(async ({ vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      await run(vcs.commitWork(worktree, "1-work"))
      await run(vcs.removeWorktree(worktree, REACH))
      await run(vcs.deleteBranch(worktree))

      expect(await run(vcs.hasBranch("t1"))).toBe(false)
      expect(await run(vcs.changes(ChangeRange.Branch({ worktree })))).toEqual({ files: [] })
    })
  })
}

/** Which end a branch's changes are measured from, once the work has landed. */
const forkPointCases = (inRepo: InRepo): void => {
  it("still shows a trak's work after the trak has been merged", async () => {
    await inRepo(async ({ vcs, run }) => {
      // The other end of the same rule, and the one that would have blanked the
      // changes view of every finished trak: once `main` holds this branch, the
      // two share everything and a diff between them is empty. Where the branch
      // started is the answer then — what a merged pull request keeps showing.
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      await run(vcs.commitWork(worktree, "1-work"))
      await run(vcs.merge(MergeInto.Host(), worktree.branch, "land it"))

      const changes = await run(vcs.changes(ChangeRange.Branch({ worktree })))

      expect(changes.files.map((f) => f.path)).toEqual(["flag.ts"])
    })
  })

  it("falls back the same way once the branch it forked from has been deleted", async () => {
    await inRepo(async ({ vcs, run }) => {
      // Reachable, not hypothetical: a piece forks from its parent's branch, and
      // archiving the parent takes that branch away while the piece's own trak
      // stays readable. The child's record moves to where the parent forked from,
      // whose merge base sits behind the child's start — so `base` is the floor,
      // and the parent's work stays out of the child's diff.
      const parent = await run(vcs.createWorktree("parent"))
      writeFileSync(join(parent.path, "parent.ts"), "the parent's work\n")
      await run(vcs.commitWork(parent, "the parent's work"))
      const child = await run(vcs.createWorktree("child", parent.branch))
      writeFileSync(join(child.path, "child.ts"), "the child's work\n")
      await run(vcs.commitWork(child, "the child's work"))
      await run(vcs.removeWorktree(parent, REACH))
      await run(vcs.deleteBranch(parent))

      const changes = await run(vcs.changes(ChangeRange.Branch({ worktree: child })))

      expect(changes.files.map((f) => f.path)).toEqual(["child.ts"])
    })
  })
}

/**
 * The two shapes a file can take that are not a wall of lines: one that moved,
 * and one git will not read as text at all.
 */
const changedFileCases = (inRepo: InRepo): void => {
  it("draws a moved file as one row naming both paths", async () => {
    await inRepo(async ({ vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "old-name.ts"), "export const a = 1\nexport const b = 2\n")
      const first = kept(await run(vcs.commitWork(worktree, "1-work")))
      rmSync(join(worktree.path, "old-name.ts"))
      writeFileSync(join(worktree.path, "new-name.ts"), "export const a = 1\nexport const b = 2\n")
      const second = kept(await run(vcs.commitWork(worktree, "2-work")))

      // The step that moved it, rather than the whole branch — over the branch
      // the file was only ever added, under the name it ended up with.
      const changes = await run(vcs.changes(ChangeRange.Commits({ from: first, to: second })))

      // Two large opposite rows is what `--no-renames` would give, and it is what
      // makes a moved directory unreadable.
      expect(changes.files).toHaveLength(1)
      expect(changes.files[0]).toMatchObject({
        path: "new-name.ts",
        oldPath: "old-name.ts",
        change: "renamed",
      })
    })
  })

  it("gives a binary file a row with a reason instead of hunks", async () => {
    await inRepo(async ({ vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "shot.png"), Buffer.from([0x89, 0x50, 0x00, 0x01, 0x02]))
      await run(vcs.commitWork(worktree, "1-work"))

      const changes = await run(vcs.changes(ChangeRange.Branch({ worktree })))

      expect(changes.files[0]).toMatchObject({
        path: "shot.png",
        binary: true,
        omitted: "binary",
        hunks: [],
      })
    })
  })
}

/** The checkout's files as one id — what a check's pass is reused against. */
const workingTreeCases = (inRepo: InRepo): void => {
  it("names the same files the same way, in any checkout", async () => {
    await inRepo(async ({ vcs, run }) => {
      const one = await run(vcs.createWorktree("t1"))
      const two = await run(vcs.createWorktree("t2"))
      writeFileSync(join(one.path, "notes.md"), "same\n")
      writeFileSync(join(two.path, "notes.md"), "same\n")

      expect(await run(vcs.workingTree(one, false))).toBe(await run(vcs.workingTree(two, false)))
      expect(await run(vcs.workingTree(one, false))).toBe(await run(vcs.workingTree(one, false)))
    })
  })

  it("changes with a tracked file, an untracked one, and a removed one", async () => {
    await inRepo(async ({ vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      const seen = [await run(vcs.workingTree(worktree, false))]

      writeFileSync(join(worktree.path, "README.md"), "edited\n")
      seen.push(await run(vcs.workingTree(worktree, false)))
      writeFileSync(join(worktree.path, "fresh.ts"), "export const a = 1\n")
      seen.push(await run(vcs.workingTree(worktree, false)))
      rmSync(join(worktree.path, "fresh.ts"))
      rmSync(join(worktree.path, "README.md"))
      seen.push(await run(vcs.workingTree(worktree, false)))

      expect(new Set(seen).size).toBe(seen.length)
    })
  })

  it("stages nothing, so the checkout reads as it did and commits what it holds", async () => {
    await inRepo(async ({ vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "fresh.ts"), "export const a = 1\n")
      writeFileSync(join(worktree.path, "README.md"), "edited\n")
      const before = await run(vcs.dirty(worktree))

      await run(vcs.workingTree(worktree, false))

      expect(await run(vcs.dirty(worktree))).toEqual(before)
      kept(await run(vcs.commitWork(worktree, "1-work")))
      expect(await run(vcs.dirty(worktree))).toEqual([])
    })
  })
}

/** A repository with no `origin`: every press of the git bar refused, and nothing moved. */
const noOriginCases = (inRepo: InRepo): void => {
  it("reads a repository with no origin as a branch that tracks nothing", async () => {
    await inRepo(async ({ vcs, run }) => {
      expect(await run(vcs.hostStatus())).toStrictEqual({
        head: HostHead.Branch({ name: BranchName.make("main") }),
        origin: false,
      })
    })
  })

  it("refuses every sync press where there is no origin, touching nothing", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      writeFileSync(join(repo, "new.txt"), "new\n")

      expect(await run(vcs.fetch())).toStrictEqual(SyncRefusal.NoOrigin())
      expect(await run(vcs.pull())).toStrictEqual(SyncRefusal.NoUpstream())
      expect(await run(vcs.reconcile())).toStrictEqual(SyncRefusal.NoUpstream())
      expect(await run(vcs.push())).toStrictEqual(SyncRefusal.NoOrigin())
      expect(await run(vcs.stashAnd("pull"))).toStrictEqual(
        StashedSync.Refused({ refusal: SyncRefusal.NoUpstream() }),
      )

      expect(readFileSync(join(repo, "new.txt"), "utf8")).toBe("new\n")
      expect(await run(vcs.dirty())).toEqual(["?? new.txt"])
    })
  })
}

// -- git only: what git itself holds -----------------------------------------
//
// Each case here observes git directly — its branch and worktree lists, a commit
// made outside the port, a remote, a stash, the exact patch text — or sets up a
// state only git can be put in. They run against `GitCliLayer` alone. A case whose
// port-only half is in the shared group above keeps that half here as well, so
// git still answers every assertion it answered before the split.

/** Somewhere isolated to work, and asking again not costing the trak the first one. */
const creationOnGit = (inRepo: InRepo): void => {
  it("gives a trak its own checkout, on its own branch", async () => {
    await inRepo(async ({ vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))

      expect(existsSync(worktree.path)).toBe(true)
      expect(git(worktree.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe(worktree.branch)
      // The repository's history, not an empty `git init` somewhere convenient.
      expect(existsSync(join(worktree.path, "README.md"))).toBe(true)
    })
  })

  it("leaves the repository it came from where it was", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await run(vcs.createWorktree("t1"))

      expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main")
      expect(git(repo, "status", "--porcelain")).toBe("")
    })
  })

  it("is idempotent — asking twice gives the checkout the trak already has", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // A restart replays a log that already contains `WorktreeReady`. Failing
      // here, or making a second branch, is how a resumed trak loses its work.
      const first = await run(vcs.createWorktree("t1"))
      const second = await run(vcs.createWorktree("t1"))

      expect(second).toEqual(first)
      expect(git(repo, "worktree", "list").split("\n")).toHaveLength(2)
    })
  })

  it("keeps the same base when the trak's own agent has committed since", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // The base has to be a *fact about the branch*, not a reading of wherever
      // the checkout has got to. Re-derived from the checkout's `HEAD`, a second
      // setup after a step committed came back with that commit as its base —
      // and `commitWork` then compared the tip against itself, called it
      // "this step wrote nothing", and deleted the branch. `git log --all`
      // afterwards showed only `initial`.
      const first = await run(vcs.createWorktree("t1"))
      writeFileSync(join(first.path, "flag.ts"), "export const json = true\n")
      commitIn(first.path, "the agent's own commit")

      const second = await run(vcs.createWorktree("t1"))
      expect(second).toEqual(first)
      expect(second.base).not.toBe(git(first.path, "rev-parse", "HEAD"))

      const sha = await run(vcs.commitWork(second, "keep it"))
      expect(sha).toBeDefined()
      expect(git(repo, "show", `${second.branch}:flag.ts`)).toBe("export const json = true")
    })
  })

  it("adopts the branch a lost checkout left behind, rather than refusing forever", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // A `Failed` trak keeps its checkout so a human can look at it — and
      // deleting the directory once they have is the obvious next thing they do.
      // `worktree add … -b` was unconditional, so every retry after that failed
      // on "a branch named 'trak/t1' already exists", which `prune` cannot help
      // with: a branch is not a worktree record. Adopting is safe because the
      // branch is ours by construction and holds this trak's own work.
      const first = await run(vcs.createWorktree("t1"))
      writeFileSync(join(first.path, "flag.ts"), "export const json = true\n")
      commitIn(first.path, "work so far")
      git(repo, "worktree", "remove", "--force", first.path)

      const second = await run(vcs.createWorktree("t1"))
      expect(second).toEqual(first)
      // The work is back in front of the trak, not stranded on a branch.
      expect(existsSync(join(second.path, "flag.ts"))).toBe(true)
    })
  })

  it("keeps the branch it forked from when the checkout is made again elsewhere", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // The base survives this for `adoptedBase`'s reasons and the fork has to
      // survive it on the same terms, or the two describe different forks. The
      // way in is the case above: a human deletes a `Failed` trak's checkout,
      // moves onto another branch, and resumes — re-derived from `HEAD`, the
      // trak would be measured against that branch for the rest of its life.
      const first = await run(vcs.createWorktree("t1"))
      writeFileSync(join(first.path, "flag.ts"), "export const json = true\n")
      commitIn(first.path, "work so far")
      git(repo, "worktree", "remove", "--force", first.path)
      git(repo, "checkout", "-b", "elsewhere")

      const second = await run(vcs.createWorktree("t1"))

      expect(git(repo, "symbolic-ref", forkRefFor(second.branch))).toBe("refs/heads/main")
    })
  })
}

/** Keeping the work, and — separately, later, and only when asked — clearing up. */
const finishingOnGit = (inRepo: InRepo): void => {
  it("commits the work to the branch and leaves the checkout standing", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      const sha = await run(vcs.commitWork(worktree, "add a flag"))

      expect(sha).toBeDefined()
      expect(git(repo, "branch", "--list", worktree.branch)).not.toBe("")
      expect(git(repo, "show", `${worktree.branch}:flag.ts`)).toBe("export const json = true")
      // **The half this split exists for.** These were one operation, so the one
      // moment a human wants to read a trak was the moment its scaffolding went.
      expect(existsSync(worktree.path)).toBe(true)
      // On the branch and nowhere else: the checkout the human is sitting in is
      // not what a trak commits to.
      expect(git(repo, "log", "-1", "--format=%s", "main")).toBe("initial")
    })
  })

  it("removing takes the checkout away and leaves the branch", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // The inverse of the case above, and the one that would fail silently in
      // the direction that costs work.
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      await run(vcs.commitWork(worktree, "add a flag"))
      await run(vcs.removeWorktree(worktree, REACH))

      expect(existsSync(worktree.path)).toBe(false)
      expect(git(repo, "worktree", "list")).not.toContain(worktree.branch)
      expect(git(repo, "branch", "--list", worktree.branch)).not.toBe("")
      expect(git(repo, "show", `${worktree.branch}:flag.ts`)).toBe("export const json = true")
    })
  })

  it("takes the branch with it when there was nothing to commit — at removal, not before", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // An empty branch is litter, but only once nobody is going to commit to
      // it. A trak holding its checkout is exactly somebody who still might.
      const worktree = await run(vcs.createWorktree("t1"))
      const sha = await run(vcs.commitWork(worktree, "changed nothing"))

      expect(sha).toBeUndefined()
      expect(git(repo, "branch", "--list", worktree.branch)).not.toBe("")

      await run(vcs.removeWorktree(worktree, REACH))
      expect(existsSync(worktree.path)).toBe(false)
      expect(git(repo, "branch", "--list", worktree.branch)).toBe("")
    })
  })

  it("committing twice keeps the commit — the second run reports the first one's work", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // The path a retry takes: the commit succeeded, the process died before
      // `WorkCommitted` reached the log, and a human retried. The second run
      // finds a clean tree. Read that as "this step produced nothing" and the
      // branch holding the work is deleted, with the trak reporting `Finished`
      // and no sha over the top of it.
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      const first = await run(vcs.commitWork(worktree, "add a flag"))
      const second = await run(vcs.commitWork(worktree, "add a flag"))

      expect(second).toBe(first)
      expect(git(repo, "branch", "--list", worktree.branch)).not.toBe("")
      expect(git(repo, "show", `${worktree.branch}:flag.ts`)).toBe("export const json = true")
    })
  })

  it("commits again over a change made since — two commits on the branch", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // The guarantee a per-step committer leans on: this suite otherwise commits
      // once per worktree, and per-step auto-commit calls `commitWork` at every
      // step boundary rather than only at the end.
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      const first = await run(vcs.commitWork(worktree, "add a flag"))
      writeFileSync(join(worktree.path, "docs.md"), "# json flag\n")
      const second = await run(vcs.commitWork(worktree, "document it"))

      expect(second).toBeDefined()
      expect(second).not.toBe(first)
      expect(git(repo, "rev-list", "--count", `main..${worktree.branch}`)).toBe("2")
      expect(git(repo, "show", `${worktree.branch}:flag.ts`)).toBe("export const json = true")
      expect(git(repo, "show", `${worktree.branch}:docs.md`)).toBe("# json flag")
    })
  })

  it("keeps a commit the step made itself, against a checkout that is still there", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // The scenario that actually destroys work, and the one the twice-run case
      // above does *not* reach: the checkout is present and its tree is clean
      // because the commit already happened. Either the agent committed its own
      // work — CLAUDE.md expects steps to run git — or a crash landed between
      // `commit` and the event reaching the log. Read as "this step produced
      // nothing", both end with `branch -D` over a commit nobody else records.
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      commitIn(worktree.path, "the agent's own commit")

      const sha = await run(vcs.commitWork(worktree, "add a flag"))
      await run(vcs.removeWorktree(worktree, REACH))

      expect(sha).toBe(git(repo, "rev-parse", worktree.branch))
      expect(git(repo, "branch", "--list", worktree.branch)).not.toBe("")
      expect(git(repo, "show", `${worktree.branch}:flag.ts`)).toBe("export const json = true")
    })
  })

  it("keeps the excluded paths out of a trak's commit when `.gitignore` does not name them", async () => {
    // A project that never ran the old engine: its `.gitignore` has no Orkestra lines,
    // so `info/exclude` in the common directory is all that keeps `git add -A` in a
    // linked checkout off the runtime data.
    await inRepo(async ({ repo, vcs, run }) => {
      git(repo, "rm", "-q", ".gitignore")
      git(repo, "commit", "-q", "-m", "no ignore file")
      await run(vcs.ensureIgnored())
      expect(await run(vcs.dirty())).toEqual([])

      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      mkdirSync(join(worktree.path, ".orkestra", ".trak"), { recursive: true })
      writeFileSync(join(worktree.path, ".orkestra", ".trak", "trak.md"), "# trak\n")
      mkdirSync(join(worktree.path, ".orkestra", ".cache"), { recursive: true })
      writeFileSync(join(worktree.path, ".orkestra", ".cache", "blob"), "x\n")
      await run(vcs.commitWork(worktree, "add a flag"))

      expect(git(repo, "show", "--name-only", "--format=", worktree.branch)).toBe("flag.ts")
    })
  })
}

/**
 * The awkward states each half has to reach the same answer from — a checkout
 * that wandered, one a human deleted, and a second run over its own work.
 */
const rerunOnGit = (inRepo: InRepo): void => {
  it("refuses a checkout that has wandered off its branch, keeping it for a human", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // An agent that runs `git checkout -b` inside its own checkout puts the
      // work somewhere `commitWork` cannot see: `trak/t1` is still sitting on
      // `base`, so it reads as an empty branch, is deleted at close, and the trak
      // reports `Finished` over commits nothing records. Detached, only
      // `git fsck` would find them. So this fails loudly instead — and does not
      // put HEAD back, because which branch holds the work is a human's call.
      const worktree = await run(vcs.createWorktree("t1"))
      git(worktree.path, "checkout", "-q", "-b", "agents-idea")
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      commitIn(worktree.path, "an idea of its own")

      const result = await run(Effect.either(vcs.commitWork(worktree, "add a flag")))

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") expect(result.left.op).toBe("check checkout branch")
      // Nothing deleted, nothing removed: `Failed{worktree}` keeps its checkout
      // precisely so someone can look at both branches.
      expect(existsSync(worktree.path)).toBe(true)
      expect(git(repo, "branch", "--list", worktree.branch)).not.toBe("")
      expect(git(repo, "show", "agents-idea:flag.ts")).toBe("export const json = true")
    })
  })

  it("says whether a checkout is there, including after a human deletes it", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // The one question nothing else in this system can answer. The log says what
      // the engine *did*; a human with `rm -rf` is not the engine, and the answer
      // decides whether a re-entered trak re-runs the project's setup script.
      expect(await run(vcs.hasCheckout("t1"))).toBe(false)

      const worktree = await run(vcs.createWorktree("t1"))
      expect(await run(vcs.hasCheckout("t1"))).toBe(true)

      await run(vcs.removeWorktree(worktree, REACH))
      expect(await run(vcs.hasCheckout("t1"))).toBe(false)

      // And by hand, which leaves git's admin record behind: `worktree list` still
      // prints the path with `prunable …` under it. Reading the line alone would
      // say yes to a directory nobody has.
      await run(vcs.createWorktree("t1"))
      rmSync(worktree.path, { recursive: true, force: true })
      expect(await run(vcs.hasCheckout("t1"))).toBe(false)
      expect(git(repo, "worktree", "list")).toContain(worktree.path)
    })
  })

  it("leaves the branch a trak forked from standing when the trak's own is deleted", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // Both deletions take the fork ref with the branch, and that ref is a
      // *symbolic* one naming `main` — so `update-ref -d` without `--no-deref`
      // follows it and deletes `main` instead. Measured, not hypothetical, which
      // is why both paths are asserted rather than the one that reads riskier.
      const empty = await run(vcs.createWorktree("t1"))
      await run(vcs.commitWork(empty, "changed nothing"))
      await run(vcs.removeWorktree(empty, REACH))
      expect(git(repo, "branch", "--list", "main")).not.toBe("")

      const archived = await run(vcs.createWorktree("t2"))
      writeFileSync(join(archived.path, "flag.ts"), "export const json = true\n")
      await run(vcs.commitWork(archived, "1-work"))
      await run(vcs.removeWorktree(archived, REACH))
      await run(vcs.deleteBranch(archived))

      expect(git(repo, "branch", "--list", "main")).not.toBe("")
      expect(git(repo, "for-each-ref", "--format=%(refname)", "refs/orkestra/")).toBe("")
    })
  })

  it("removing an empty trak twice is still a no-op, not a failure", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // The other half: nothing was ever committed, so the branch really is
      // disposable — and the second run must reach the same answer against a
      // checkout and a branch that are no longer there.
      const worktree = await run(vcs.createWorktree("t1"))
      await run(vcs.commitWork(worktree, "changed nothing"))
      await run(vcs.removeWorktree(worktree, REACH))
      await run(vcs.removeWorktree(worktree, REACH))

      expect(git(repo, "branch", "--list", worktree.branch)).toBe("")
      expect(await run(vcs.commitWork(worktree, "changed nothing"))).toBeUndefined()
    })
  })

  it("commits against a checkout a human deleted, instead of failing forever", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // Deleting the directory does not remove git's record of it: `worktree
      // list --porcelain` still prints the same `worktree <path>` line, with
      // `prunable …` beneath. Reading only the line, this spawned git with a
      // `cwd` nobody has and every retry came back identically —
      // `GitFailed{op: "stage work", reason: "spawn git ENOENT"}`, which reads
      // as "git is not installed" — so the trak was permanently unretryable.
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      commitIn(worktree.path, "work so far")
      rmSync(worktree.path, { recursive: true, force: true })

      const sha = await run(vcs.commitWork(worktree, "add a flag"))

      expect(sha).toBe(git(repo, "rev-parse", worktree.branch))
      expect(git(repo, "show", `${worktree.branch}:flag.ts`)).toBe("export const json = true")

      // And removing prunes the stale record, rather than leaving it to make the
      // path un-addable next time.
      await run(vcs.removeWorktree(worktree, REACH))
      expect(git(repo, "worktree", "list").split("\n")).toHaveLength(1)
    })
  })

  it("does not mistake a half-made checkout for one git knows about", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // `worktree add` interrupted partway leaves the directory behind without
      // git ever registering it. An existence check short-circuits on that and
      // hands back a `Worktree` every later git command fails against, each
      // with a message about something other than the real problem.
      //
      // The branch is deleted first, and that is the point of the case rather
      // than housekeeping: with it left behind this passed for the wrong
      // reason — `worktree add -b` failed on "a branch named 'trak/t1' already
      // exists" whether or not the directory was there, so it never touched the
      // leftover directory it names. That branch is now adopted (see the
      // creation cases), so the debris is all that is left to object to.
      //
      // Registration is the fact that matters, so this is loud instead: the
      // trak settles `Failed{worktree}` naming what git objected to, keeps its
      // directory for someone to look at, and stays retryable once they have.
      const worktree = await run(vcs.createWorktree("t1"))
      git(repo, "worktree", "remove", "--force", worktree.path)
      git(repo, "branch", "-D", worktree.branch)
      mkdirSync(worktree.path, { recursive: true })
      writeFileSync(join(worktree.path, "leftover.txt"), "half a checkout\n")

      const result = await run(Effect.either(vcs.createWorktree("t1")))
      expect(result._tag).toBe("Left")
      // Named, so the trak's `Failed{worktree}` says which git operation
      // objected rather than reporting the first confusing symptom of it.
      if (result._tag === "Left") expect(result.left.op).toBe("create worktree")
      // And it did not quietly delete the debris on its way past.
      expect(existsSync(join(worktree.path, "leftover.txt"))).toBe(true)
    })
  })
}

/**
 * The two halves of a spawn's boundary with git: a child starting from its
 * parent's work rather than beside it, and landing back on it.
 *
 * Nothing in the engine calls either yet. These are what says they work
 * before anything depends on them.
 */
const spawnOnGit = (inRepo: InRepo): void => {
  it("branches from the branch it is given, and from HEAD when given none", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      const parent = await run(vcs.createWorktree("parent"))
      writeFileSync(join(parent.path, "api.ts"), "export const api = true\n")
      commitIn(parent.path, "the parent's own commit")

      const child = await run(vcs.createWorktree("child", parent.branch))
      // The parent's work is in front of the child — which is also what makes a
      // child spawned after a sibling landed inherit that sibling, with nothing
      // anywhere declaring a dependency.
      expect(existsSync(join(child.path, "api.ts"))).toBe(true)
      expect(child.base).toBe(git(repo, "rev-parse", parent.branch))

      // No `from` is what a trak a human asked for gets. Every spawned child is
      // given its parent's branch — the engine has no second shape any more —
      // but the port keeps both, because that is what starting a trak needs.
      const own = await run(vcs.createWorktree("own"))
      expect(existsSync(join(own.path, "api.ts"))).toBe(false)
      expect(own.base).toBe(git(repo, "rev-parse", "main"))
    })
  })

  it("keeps the base a child was first given, however the second call asks", async () => {
    await inRepo(async ({ vcs, run }) => {
      // The same stability the idempotence cases pin, on the path that can now
      // be told a *different* answer: a child set up again while its parent has
      // moved on must not silently re-base onto the new tip, or `commitWork`
      // measures its work against a commit it never branched from.
      const parent = await run(vcs.createWorktree("parent"))
      const child = await run(vcs.createWorktree("child", parent.branch))
      writeFileSync(join(parent.path, "api.ts"), "export const api = true\n")
      commitIn(parent.path, "the parent moved on")

      const again = await run(vcs.createWorktree("child", parent.branch))

      expect(again).toEqual(child)
      expect(existsSync(join(again.path, "api.ts"))).toBe(false)
    })
  })

  it("brings a child's work onto the parent's branch, and nowhere else", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      const parent = await run(vcs.createWorktree("parent"))
      const child = await run(vcs.createWorktree("child", parent.branch))
      writeFileSync(join(child.path, "lens.ts"), "export const lens = true\n")
      await run(vcs.commitWork(child, "the child's work"))

      const outcome = await run(
        vcs.merge(MergeInto.Checkout({ worktree: parent }), child.branch, "join child"),
      )

      expect(outcome).toEqual(
        MergeOutcome.Merged({ sha: CommitSha.make(git(repo, "rev-parse", parent.branch)) }),
      )
      expect(readFileSync(join(parent.path, "lens.ts"), "utf8")).toBe("export const lens = true\n")
      // The branch the human is standing on is not where a join lands.
      expect(git(repo, "log", "-1", "--format=%s", "main")).toBe("initial")
    })
  })

  it("leaves the parent clean and both branches intact when a merge conflicts", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // A conflict is an answer git gave, not a failure to give one — so it
      // comes back as a value, and the merge is aborted rather than left
      // half-applied. Both branches survive: the child's is the only place its
      // work exists, and throwing it away is the most expensive mistake here.
      const parent = await run(vcs.createWorktree("parent"))
      const child = await run(vcs.createWorktree("child", parent.branch))
      writeFileSync(join(child.path, "lens.ts"), "the child's answer\n")
      await run(vcs.commitWork(child, "the child's work"))
      writeFileSync(join(parent.path, "lens.ts"), "the parent's answer\n")
      commitIn(parent.path, "the parent's own answer")

      const outcome = await run(
        vcs.merge(MergeInto.Checkout({ worktree: parent }), child.branch, "join child"),
      )

      expect(outcome).toEqual(MergeOutcome.Conflicted({ paths: ["lens.ts"] }))
      expect(git(parent.path, "status", "--porcelain")).toBe("")
      expect(readFileSync(join(parent.path, "lens.ts"), "utf8")).toBe("the parent's answer\n")
      expect(git(repo, "branch", "--list", child.branch)).not.toBe("")
    })
  })

  it("leaves no ref naming a parent's branch once archiving the parent deletes it", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // The child's fork record names the parent's branch. Archiving the parent
      // deletes that branch, and a record still naming it is a symbolic ref to
      // nothing — which `git fsck` reports as corruption, and which failed the
      // first backup drill on `refs/orkestra/fork/trak/key-lavender-cicada`.
      const parent = await run(vcs.createWorktree("parent"))
      const child = await run(vcs.createWorktree("child", parent.branch))
      writeFileSync(join(child.path, "lens.ts"), "export const lens = true\n")
      await run(vcs.commitWork(child, "the child's work"))
      await run(vcs.merge(MergeInto.Checkout({ worktree: parent }), child.branch, "join child"))
      await run(vcs.removeWorktree(child, REACH))
      await run(vcs.removeWorktree(parent, REACH))
      await run(vcs.deleteBranch(parent))

      const fsck = spawnSync("git", ["fsck", "--no-dangling", "--no-progress"], {
        cwd: repo,
        encoding: "utf8",
      })

      expect({ code: fsck.status, errors: fsck.stderr.trim() }).toEqual({ code: 0, errors: "" })
    })
  })

  it("moves a child's fork record to where its parent forked from when an empty parent branch goes", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // The other deletion: `removeWorktree` drops a branch nothing was committed to,
      // and a child forked from it before then still names it.
      const parent = await run(vcs.createWorktree("parent"))
      const child = await run(vcs.createWorktree("child", parent.branch))
      await run(vcs.removeWorktree(parent, REACH))

      expect(git(repo, "branch", "--list", parent.branch)).toBe("")
      expect(git(repo, "symbolic-ref", `refs/orkestra/fork/${child.branch}`)).toBe(
        "refs/heads/main",
      )
    })
  })

  it("forgets a wiped trak's recorded base and fork, and keeps its branch", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "kept.ts"), "kept\n")
      await run(vcs.commitWork(worktree, "1-work"))

      await run(vcs.forgetTrak("t1"))
      await run(vcs.forgetTrak("t1"))

      expect(git(repo, "for-each-ref", "refs/orkestra/")).toBe("")
      expect(git(repo, "branch", "--list", worktree.branch)).not.toBe("")
    })
  })
}

/**
 * The other direction a merge goes: a whole trak, into the branch a human is
 * standing on. The destination is *their* checkout, which is the one thing this
 * tool never picks for them — so these assert against `main`, because that is
 * where `testRepo` leaves `HEAD`.
 */
const hostMergeOnGit = (inRepo: InRepo): void => {
  it("brings a trak's branch into the branch the host is on", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      await run(vcs.commitWork(worktree, "add a flag"))

      const outcome = await run(vcs.merge(MergeInto.Host(), worktree.branch, "merge the trak"))

      expect(outcome).toEqual(
        MergeOutcome.Merged({ sha: CommitSha.make(git(repo, "rev-parse", "main")) }),
      )
      expect(readFileSync(join(repo, "flag.ts"), "utf8")).toBe("export const json = true\n")
      // `--no-ff`, so which commits came from the trak stays readable afterwards.
      expect(git(repo, "rev-list", "--count", "--merges", "main")).toBe("1")
      // And the human's checkout is where they left it, on the branch they chose.
      expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main")
    })
  })

  it("merging twice reports the same tip, rather than failing on its own work", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      await run(vcs.commitWork(worktree, "add a flag"))

      const first = await run(vcs.merge(MergeInto.Host(), worktree.branch, "merge the trak"))
      const second = await run(vcs.merge(MergeInto.Host(), worktree.branch, "merge the trak"))

      expect(second).toEqual(first)
      expect(git(repo, "rev-list", "--count", "--merges", "main")).toBe("1")
    })
  })

  it("refuses a conflict by aborting it, leaving both branches where they were", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // The refusal that matters: nothing is merged, nothing is half-applied, and
      // the trak's branch is still there for whoever resolves it by hand. A merge
      // that left the host mid-conflict would be this tool making a mess in
      // somebody's working copy and calling it an outcome.
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "the trak's answer\n")
      await run(vcs.commitWork(worktree, "the trak's answer"))
      writeFileSync(join(repo, "flag.ts"), "the human's answer\n")
      commitIn(repo, "the human got there first")

      const outcome = await run(vcs.merge(MergeInto.Host(), worktree.branch, "merge the trak"))

      expect(outcome).toEqual(MergeOutcome.Conflicted({ paths: ["flag.ts"] }))
      expect(git(repo, "status", "--porcelain")).toBe("")
      expect(readFileSync(join(repo, "flag.ts"), "utf8")).toBe("the human's answer\n")
      expect(git(repo, "branch", "--list", worktree.branch)).not.toBe("")
      expect(git(repo, "show", `${worktree.branch}:flag.ts`)).toBe("the trak's answer")
    })
  })

  it("names the default branch off `origin/HEAD`, and nothing where no remote says", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // A fresh `git init` has no remote at all, which is one of the two shapes that
      // have no answer; the other is a clone whose `origin/HEAD` was never recorded.
      expect(await run(vcs.defaultBranch())).toBeUndefined()
      // The refs a clone records, written directly rather than through a second
      // repository: what is being read is the symbolic ref, not the network.
      git(repo, "update-ref", "refs/remotes/origin/main", "main")
      git(repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main")
      expect(await run(vcs.defaultBranch())).toBe("main")
      // The local branch, not the remote-tracking name: it is what a worktree is
      // cut from and what the fork ref names.
      const worktree = await run(vcs.createWorktree("t-off", BranchName.make("main")))
      expect(git(repo, "symbolic-ref", forkRefFor(worktree.branch))).toBe("refs/heads/main")
    })
  })

  it("cuts from a remote-tracking branch, recording it as the fork, and leaves the host alone", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // What a fetch leaves: `origin/main` ahead of the local `main` by a merged pull
      // request. Written directly, for the case above's reason.
      const host = git(repo, "rev-parse", "main")
      git(repo, "checkout", "-q", "-b", "merged-elsewhere")
      writeFileSync(join(repo, "merged.ts"), "export const merged = true\n")
      commitIn(repo, "a pull request merged on the forge")
      git(repo, "update-ref", "refs/remotes/origin/main", "merged-elsewhere")
      git(repo, "checkout", "-q", "main")
      git(repo, "branch", "-q", "-D", "merged-elsewhere")

      const worktree = await run(vcs.createWorktree("goal", BranchName.make("origin/main")))
      expect(existsSync(join(worktree.path, "merged.ts"))).toBe(true)
      expect(worktree.base).toBe(git(repo, "rev-parse", "refs/remotes/origin/main"))
      expect(git(repo, "symbolic-ref", forkRefFor(worktree.branch))).toBe(
        "refs/remotes/origin/main",
      )
      expect(git(repo, "rev-parse", "main")).toBe(host)

      // The fork ref names a real ref, so the branch's changes are the trak's alone.
      writeFileSync(join(worktree.path, "own.ts"), "export const own = true\n")
      await run(vcs.commitWork(worktree, "1-work"))
      const changes = await run(vcs.changes(ChangeRange.Branch({ worktree })))
      expect(changes.files.map((f) => f.path)).toEqual(["own.ts"])
    })
  })

  it("says which branch the host is on, and nothing when it is detached", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      expect(await run(vcs.hostBranch())).toBe("main")
      git(repo, "checkout", "-q", "--detach")
      // Not the literal string `HEAD`, which is what `--abbrev-ref` answers and
      // is not a branch name. A warning line that read "you are on HEAD" would be
      // worse than one that admits it does not know.
      expect(await run(vcs.hostBranch())).toBeUndefined()
    })
  })
}

/**
 * Whether a merge would bring anything — the graph asked, not the log.
 *
 * Its own cases because the answer has to come from refs: a commit made by hand in a
 * checkout is on the branch and in no log, and a branch merged and kept is behind the
 * destination whatever was committed on it before.
 */
const containmentOnGit = (inRepo: InRepo): void => {
  it("holds a branch with nothing on it beyond where it was cut, and not one with a commit", async () => {
    await inRepo(async ({ vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      expect(await run(vcs.contains(MergeInto.Host(), worktree.branch))).toBe(true)
      // Committed by hand, the way a person in the checkout would — nothing here
      // told the tool, and the graph answers all the same.
      writeFileSync(join(worktree.path, "hand.ts"), "export const byHand = true\n")
      commitIn(worktree.path, "a commit by hand")
      expect(await run(vcs.contains(MergeInto.Host(), worktree.branch))).toBe(false)
    })
  })
}

/**
 * The same question the merge answers, asked before anybody presses anything.
 *
 * What makes these worth writing separately from the merge cases is the half a
 * merge cannot show: that asking changes **nothing** — no index, no worktree, no
 * refs, in a destination this tool does not own. A prediction with a side effect
 * would be a merge with extra steps.
 */
const predictionOnGit = (inRepo: InRepo): void => {
  it("says a clean merge is clean, and touches nothing asking", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      await run(vcs.commitWork(worktree, "add a flag"))
      const before = git(repo, "rev-parse", "HEAD")

      expect(await run(vcs.wouldConflict(MergeInto.Host(), worktree.branch))).toBe(false)

      // Nothing moved and nothing is half-applied: the host is where the human
      // left it, and the branch is still unmerged.
      expect(git(repo, "rev-parse", "HEAD")).toBe(before)
      expect(git(repo, "status", "--porcelain")).toBe("")
      expect(git(repo, "rev-list", "--count", "--merges", "main")).toBe("0")
    })
  })

  it("says a conflicting merge will conflict, before it is attempted", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "the trak's answer\n")
      await run(vcs.commitWork(worktree, "the trak's answer"))
      writeFileSync(join(repo, "flag.ts"), "the human's answer\n")
      commitIn(repo, "the human got there first")

      expect(await run(vcs.wouldConflict(MergeInto.Host(), worktree.branch))).toBe(true)
      // And the attempt agrees, which is the whole claim: the prediction is the
      // same answer the merge gives, without the merge.
      expect(await run(vcs.merge(MergeInto.Host(), worktree.branch, "merge the trak"))).toEqual(
        MergeOutcome.Conflicted({ paths: ["flag.ts"] }),
      )
    })
  })

  it("answers about a child against its parent, not against the host", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // A child's destination is a checkout this tool made, and the host is not
      // it — so a prediction that read `HEAD` would answer about the wrong branch
      // and be right often enough to look correct.
      const parent = await run(vcs.createWorktree("parent"))
      const child = await run(vcs.createWorktree("child", parent.branch))
      writeFileSync(join(child.path, "lens.ts"), "the child's answer\n")
      await run(vcs.commitWork(child, "the child's work"))
      writeFileSync(join(parent.path, "lens.ts"), "the parent's answer\n")
      commitIn(parent.path, "the parent's own answer")

      expect(
        await run(vcs.wouldConflict(MergeInto.Checkout({ worktree: parent }), child.branch)),
      ).toBe(true)
      // Against the host the same child merges cleanly — `lens.ts` is not there
      // at all — which is what makes the destination the thing being asked about.
      expect(await run(vcs.wouldConflict(MergeInto.Host(), child.branch))).toBe(false)
      expect(git(parent.path, "status", "--porcelain")).toBe("")
      expect(git(repo, "status", "--porcelain")).toBe("")
    })
  })
}

/**
 * Reading the work back — the one thing here that decides nothing and is asked
 * only by a person looking.
 *
 * Two promises separate these from the rest: a **committed** slice is answered
 * from refs, so it survives the checkout being taken away, and the **uncommitted**
 * one is the only slice that needs the checkout at all — and says so by being
 * empty rather than by failing.
 */
const changesOnGit = (inRepo: InRepo): void => {
  it("answers no files for a slice whose commits the archive has orphaned", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // `deleteBranch` takes the branch and its reflog, and git prunes what nothing
      // reaches — here forced, where a real repository takes weeks to get there. The
      // slice is then a fact about the deletion somebody confirmed, not a repository
      // that cannot answer: the route promises nothing-to-read is an empty answer.
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      const sha = kept(await run(vcs.commitWork(worktree, "1-work")))
      await run(vcs.removeWorktree(worktree, REACH))
      await run(vcs.deleteBranch(worktree))
      git(repo, "reflog", "expire", "--expire-unreachable=now", "--all")
      git(repo, "gc", "--prune=now", "--quiet")

      const step = ChangeRange.Commits({ from: worktree.base, to: sha })
      expect(await run(vcs.changes(step))).toEqual({ files: [] })
      expect(await run(vcs.changes(ChangeRange.Branch({ worktree })))).toEqual({ files: [] })
    })
  })

  it("collapses a file `.gitattributes` marks generated, and opens it by path", async () => {
    await inRepo(async ({ vcs, run }) => {
      // The branch is what adds the line, so a committed slice has to read the attribute
      // at its far end rather than in the checkout the repository root has.
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, ".gitattributes"), "proof/** linguist-generated\n")
      mkdirSync(join(worktree.path, "proof"))
      writeFileSync(join(worktree.path, "proof", "shot.tsx"), "export const a = 1\n")
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      const sha = kept(await run(vcs.commitWork(worktree, "1-work")))
      writeFileSync(join(worktree.path, "proof", "late.tsx"), "export const b = 2\n")

      const committed = async (range: ChangeRange): Promise<void> => {
        const all = await run(vcs.changes(range))
        const shot = all.files.find((f) => f.path === "proof/shot.tsx")
        expect(shot).toMatchObject({ omitted: "generated", additions: 1, hunks: [] })
        expect(all.files.find((f) => f.path === "flag.ts")?.hunks).toHaveLength(1)

        const opened = await run(vcs.changes(range, "proof/shot.tsx"))
        expect(opened.files.map((f) => [f.path, f.omitted, f.hunks.length])).toEqual([
          ["proof/shot.tsx", undefined, 1],
        ])
      }
      await committed(ChangeRange.Branch({ worktree }))
      await committed(ChangeRange.Commits({ from: worktree.base, to: sha }))

      const uncommitted = ChangeRange.Uncommitted({ worktree })
      expect((await run(vcs.changes(uncommitted))).files).toMatchObject([
        { path: "proof/late.tsx", omitted: "generated", hunks: [] },
      ])
      expect((await run(vcs.changes(uncommitted, "proof/late.tsx"))).files[0]?.hunks).toHaveLength(
        1,
      )
    })
  })
}

/** What a check that ignores generated files has its pass kept against. */
const workingTreeOnGit = (inRepo: InRepo): void => {
  it("leaves generated files out, committed or not, and keeps the rest in", async () => {
    await inRepo(async ({ vcs, run }) => {
      // Committed between the two readings, because the engine commits after every step:
      // a scratch index copied from the checkout's would otherwise carry the proof's
      // committed copy into the tree and move the id.
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, ".gitattributes"), "proof/** linguist-generated\n")
      mkdirSync(join(worktree.path, "proof"))
      writeFileSync(join(worktree.path, "proof", "shot.tsx"), "export const a = 1\n")
      const before = await run(vcs.workingTree(worktree, true))
      const whole = await run(vcs.workingTree(worktree, false))
      kept(await run(vcs.commitWork(worktree, "1-work")))

      writeFileSync(join(worktree.path, "proof", "shot.tsx"), "export const a = 2\n")
      writeFileSync(join(worktree.path, "proof", "fresh.tsx"), "export const b = 1\n")
      kept(await run(vcs.commitWork(worktree, "2-work")))
      writeFileSync(join(worktree.path, "proof", "shot.tsx"), "export const a = 3\n")

      expect(await run(vcs.workingTree(worktree, true))).toBe(before)
      expect(await run(vcs.workingTree(worktree, false))).not.toBe(whole)
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      expect(await run(vcs.workingTree(worktree, true))).not.toBe(before)
    })
  })
}

/**
 * Which end a branch's changes are measured from — the half of this feature with
 * an interesting wrong answer, and the one a `Commits` range never has to decide.
 */
const forkPointOnGit = (inRepo: InRepo): void => {
  it("leaves out what the branch merged in from the one it forked from", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // The whole reason the fork branch is recorded rather than only the commit:
      // catching a trak up with `main` must not put `main`'s work into the trak's
      // own diff, which measuring from the fork commit does. This is the diff a
      // pull request shows.
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      await run(vcs.commitWork(worktree, "1-work"))
      writeFileSync(join(repo, "elsewhere.md"), "# somebody else's work\n")
      commitIn(repo, "main moves on")
      git(worktree.path, "merge", "--no-edit", "main")

      const changes = await run(vcs.changes(ChangeRange.Branch({ worktree })))

      expect(changes.files.map((f) => f.path)).toEqual(["flag.ts"])
    })
  })

  it("never reaches further back than where the branch started", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // A fork branch whose history was replaced — `git pull --rebase` over
      // unpushed commits is the routine way in — shares less with this branch
      // than it did, so the merge base sits *behind* where the trak started. The
      // floor is what stops the answer growing commits the trak never wrote,
      // which is the noise the rest of this removes.
      writeFileSync(join(repo, "theirs.md"), "# somebody else's work\n")
      commitIn(repo, "before the fork")
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      await run(vcs.commitWork(worktree, "1-work"))
      git(repo, "reset", "--hard", "HEAD~1")
      writeFileSync(join(repo, "theirs.md"), "# somebody else's work, rewritten\n")
      commitIn(repo, "before the fork, rewritten")

      const changes = await run(vcs.changes(ChangeRange.Branch({ worktree })))

      expect(changes.files.map((f) => f.path)).toEqual(["flag.ts"])
    })
  })

  it("falls back to where the branch started when no fork branch was recorded", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      // Three traks land here: one made before the fork ref existed, one forked
      // off a detached `HEAD`, and one whose fork branch has since been deleted.
      // The answer widens back to everything past the fork commit rather than
      // failing, which is what it was before any of this.
      const worktree = await run(vcs.createWorktree("t1"))
      git(repo, "symbolic-ref", "--delete", forkRefFor(worktree.branch))
      writeFileSync(join(worktree.path, "flag.ts"), "export const json = true\n")
      await run(vcs.commitWork(worktree, "1-work"))
      writeFileSync(join(repo, "elsewhere.md"), "# somebody else's work\n")
      commitIn(repo, "main moves on")
      git(worktree.path, "merge", "--no-edit", "main")

      const changes = await run(vcs.changes(ChangeRange.Branch({ worktree })))

      expect(changes.files.map((f) => f.path)).toEqual(["elsewhere.md", "flag.ts"])
    })
  })
}

/**
 * The one thing about a patch that is about the *text* rather than the work: its
 * last line, when that line is blank. `git` trims every other caller's stdout,
 * and this is the case that would go quiet if it trimmed this one's.
 */
const patchTextOnGit = (inRepo: InRepo): void => {
  it("keeps a hunk's last line when it is blank, rather than a trimmed patch's worth", async () => {
    await inRepo(async ({ vcs, run }) => {
      // A file ending in a blank line makes the patch's own last line a single
      // space. Trimmed away, the hunk arrives a row shorter than its own `@@`
      // header declares, with nothing on the wire to say so.
      const worktree = await run(vcs.createWorktree("t1"))
      writeFileSync(join(worktree.path, "trailing.md"), "one\ntwo\nthree\n\n")
      const first = kept(await run(vcs.commitWork(worktree, "1-work")))
      writeFileSync(join(worktree.path, "trailing.md"), "one\nTWO\nthree\n\n")
      const second = kept(await run(vcs.commitWork(worktree, "2-work")))

      const changes = await run(vcs.changes(ChangeRange.Commits({ from: first, to: second })))

      const hunk = changes.files[0]?.hunks[0]
      expect(hunk?.newCount).toBe(4)
      expect(hunk?.lines.at(-1)).toStrictEqual({
        kind: "context",
        text: "",
        oldLine: 4,
        newLine: 4,
      })
    })
  })
}

/** An `origin` for the case's repository, removed when the body ends. */
const withOrigin = async (repo: string, body: (from: Origin) => Promise<void>): Promise<void> => {
  const from = addOrigin(repo)
  try {
    await body(from)
  } finally {
    from.remove()
  }
}

/** A commit on top of whatever `checkout` has, touching a file of its own. */
const commitFile = (checkout: string, name: string): void =>
  commitOnHost(checkout, name, `${name}\n`)

/**
 * The host repository against its remote: where it stands, and the fetch that moves the
 * counts. Against a real bare `origin` rather than refs written by hand, here and in the
 * pull and push cases, because what is pinned is what git does over a remote.
 */
const hostStatusOnGit = (inRepo: InRepo): void => {
  it("reads the branch and both counts the way `git status -sb` does", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withOrigin(repo, async (from) => {
        landElsewhere(from, "theirs-1.txt")
        landElsewhere(from, "theirs-2.txt")
        commitFile(repo, "mine.txt")
        git(repo, "fetch", "--quiet", "origin")

        expect(git(repo, "status", "-sb").split("\n")[0]).toBe(
          "## main...origin/main [ahead 1, behind 2]",
        )
        expect(await run(vcs.hostStatus())).toStrictEqual({
          head: HostHead.Branch({ name: BranchName.make("main") }),
          origin: true,
          upstream: { name: "origin/main", ahead: 1, behind: 2 },
        })
      })
    })
  })

  it("reads no origin, no upstream and a detached HEAD as what they are", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      expect(await run(vcs.hostStatus())).toStrictEqual({
        head: HostHead.Branch({ name: BranchName.make("main") }),
        origin: false,
      })
      git(repo, "checkout", "--quiet", "--detach")
      expect(await run(vcs.hostStatus())).toStrictEqual({
        head: HostHead.Detached({ sha: CommitSha.make(git(repo, "rev-parse", "HEAD")) }),
        origin: false,
      })
    })
  })

  it("fetches a commit made elsewhere into the counts, and refuses with no origin", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      expect(await run(vcs.fetch())).toStrictEqual(SyncRefusal.NoOrigin())
      await withOrigin(repo, async (from) => {
        landElsewhere(from, "theirs.txt")
        expect((await run(vcs.hostStatus())).upstream?.behind).toBe(0)

        expect(await run(vcs.fetch())).toBeUndefined()

        expect((await run(vcs.hostStatus())).upstream?.behind).toBe(1)
        // A fetch moves refs and nothing else: the branch and the files stay put.
        expect(existsSync(join(repo, "theirs.txt"))).toBe(false)
      })
    })
  })
}

/**
 * A remote that wants a password: every request is answered `401` with a Basic
 * challenge, which is what makes git go looking for credentials. Loopback HTTP rather
 * than an `https` host, so the case needs no network and no certificate — git asks for
 * credentials over either.
 */
const withAuthWall = async (body: (url: string) => Promise<void>): Promise<void> => {
  const server = createServer((_request, response) => {
    response.writeHead(401, { "www-authenticate": 'Basic realm="orkestra-test"' })
    response.end()
  })
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening))
  const address = server.address()
  const port = typeof address === "object" && address !== null ? address.port : 0
  try {
    await body(`http://127.0.0.1:${String(port)}/repo.git`)
  } finally {
    await new Promise((closed) => server.close(closed))
  }
}

/**
 * An askpass program that answers and writes down that it was asked — the shape of the
 * one an editor's terminal hands every process started inside it.
 */
const recordingAskpass = (dir: string): { readonly script: string; readonly calls: string } => {
  const calls = join(dir, "askpass-calls")
  const script = join(dir, "askpass.sh")
  writeFileSync(script, `#!/bin/sh\necho "$1" >> "${calls}"\necho x\n`, { mode: 0o755 })
  return { script, calls }
}

/** A pull: fast-forward only, and refused before anything moves. */
const pullOnGit = (inRepo: InRepo): void => {
  it("pulls by fast-forwarding a branch that is behind, and makes no merge commit", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withOrigin(repo, async (from) => {
        landElsewhere(from, "theirs-1.txt")
        landElsewhere(from, "theirs-2.txt")
        await run(vcs.fetch())

        expect(await run(vcs.pull())).toBeUndefined()

        expect(git(repo, "rev-parse", "HEAD")).toBe(git(repo, "rev-parse", "origin/main"))
        expect(git(repo, "rev-list", "--count", "--merges", "HEAD")).toBe("0")
        expect((await run(vcs.hostStatus())).upstream).toStrictEqual({
          name: "origin/main",
          ahead: 0,
          behind: 0,
        })
      })
    })
  })

  it("refuses to pull a diverged branch, leaving it where it was", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withOrigin(repo, async (from) => {
        landElsewhere(from, "theirs.txt")
        commitFile(repo, "mine.txt")
        await run(vcs.fetch())
        const before = git(repo, "rev-parse", "HEAD")

        expect(await run(vcs.pull())).toStrictEqual(SyncRefusal.Diverged({ ahead: 1, behind: 1 }))

        expect(git(repo, "rev-parse", "HEAD")).toBe(before)
        expect(git(repo, "status", "--porcelain")).toBe("")
      })
    })
  })

  it("refuses to pull over uncommitted work, naming every file", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withOrigin(repo, async (from) => {
        landElsewhere(from, "theirs.txt")
        await run(vcs.fetch())
        const before = git(repo, "rev-parse", "HEAD")
        // Neither file is one the incoming commit touches: the whole tree is refused.
        writeFileSync(join(repo, "README.md"), "# edited\n")
        writeFileSync(join(repo, "new.txt"), "new\n")

        expect(await run(vcs.pull())).toStrictEqual(
          SyncRefusal.Dirty({ files: ["M README.md", "?? new.txt"] }),
        )

        expect(git(repo, "rev-parse", "HEAD")).toBe(before)
      })
    })
  })

  it("refuses to pull a branch that tracks nothing", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withOrigin(repo, async () => {
        git(repo, "checkout", "--quiet", "-b", "feature")
        expect(await run(vcs.pull())).toStrictEqual(SyncRefusal.NoUpstream())
      })
    })
  })
}

/** Somebody else's edit to a file the repository already holds, pushed and not fetched. */
const landEdit = (from: Origin, name: string, content: string): void => {
  git(from.elsewhere, "pull", "--quiet", "--ff-only")
  commitOnHost(from.elsewhere, name, content)
  git(from.elsewhere, "push", "--quiet", "origin", "main")
}

/** Everything a stopped press must leave alone: the tip, the tree and the stash. */
const standing = (repo: string): readonly string[] => [
  git(repo, "rev-parse", "HEAD"),
  git(repo, "status", "--porcelain"),
  git(repo, "stash", "list"),
]

/** A reconcile: a merge of the upstream, asked about before anything moves. */
const reconcileOnGit = (inRepo: InRepo): void => {
  it("merges the upstream into a diverged branch, leaving a merge commit and a clean tree", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withOrigin(repo, async (from) => {
        landElsewhere(from, "theirs.txt")
        commitFile(repo, "mine.txt")
        await run(vcs.fetch())

        expect(await run(vcs.reconcile())).toBeUndefined()

        expect(git(repo, "rev-list", "--count", "--merges", "HEAD")).toBe("1")
        expect(git(repo, "status", "--porcelain")).toBe("")
        expect(existsSync(join(repo, "theirs.txt"))).toBe(true)
        // Nothing left to pull and the merge to send: Push is the press that applies.
        expect((await run(vcs.hostStatus())).upstream).toStrictEqual({
          name: "origin/main",
          ahead: 2,
          behind: 0,
        })
      })
    })
  })

  it("stops a reconcile that would conflict, naming the files and moving nothing", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withOrigin(repo, async (from) => {
        landEdit(from, "README.md", "# theirs\n")
        commitOnHost(repo, "README.md", "# mine\n")
        await run(vcs.fetch())
        const before = standing(repo)

        expect(await run(vcs.reconcile())).toStrictEqual(
          SyncRefusal.Conflicted({
            branch: BranchName.make("main"),
            upstream: "origin/main",
            files: ["README.md"],
          }),
        )

        expect(standing(repo)).toStrictEqual(before)
        // No merge was begun, so there is nothing for a person to abort.
        expect(existsSync(join(repo, ".git", "MERGE_HEAD"))).toBe(false)
      })
    })
  })

  it("refuses to reconcile over uncommitted work, and fast-forwards a branch only behind", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withOrigin(repo, async (from) => {
        landElsewhere(from, "theirs.txt")
        await run(vcs.fetch())
        writeFileSync(join(repo, "new.txt"), "new\n")
        expect(await run(vcs.reconcile())).toStrictEqual(
          SyncRefusal.Dirty({ files: ["?? new.txt"] }),
        )

        rmSync(join(repo, "new.txt"))
        expect(await run(vcs.reconcile())).toBeUndefined()
        expect(git(repo, "rev-parse", "HEAD")).toBe(git(repo, "rev-parse", "origin/main"))
        expect(git(repo, "rev-list", "--count", "--merges", "HEAD")).toBe("0")
      })
    })
  })
}

/** A press around a stash: the changes set aside, and put back only where they go in. */
const stashOnGit = (inRepo: InRepo): void => {
  it("pulls over a dirty tree and restores every change, tracked and untracked", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withOrigin(repo, async (from) => {
        landElsewhere(from, "theirs.txt")
        await run(vcs.fetch())
        writeFileSync(join(repo, "README.md"), "# edited\n")
        writeFileSync(join(repo, "new.txt"), "new\n")

        expect(await run(vcs.stashAnd("pull"))).toStrictEqual(StashedSync.Restored())

        expect(git(repo, "rev-parse", "HEAD")).toBe(git(repo, "rev-parse", "origin/main"))
        expect(git(repo, "status", "--porcelain")).toBe("M README.md\n?? new.txt")
        expect(readFileSync(join(repo, "README.md"), "utf8")).toBe("# edited\n")
        expect(readFileSync(join(repo, "new.txt"), "utf8")).toBe("new\n")
        expect(git(repo, "stash", "list")).toBe("")
      })
    })
  })

  it("keeps the changes in one stash entry where restoring them would conflict", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withOrigin(repo, async (from) => {
        // Both ways a restore conflicts: an edit to a file the pull changed, and an
        // untracked file at a path the pull brought down.
        landEdit(from, "README.md", "# theirs\n")
        landElsewhere(from, "theirs.txt")
        await run(vcs.fetch())
        writeFileSync(join(repo, "README.md"), "# mine\n")
        writeFileSync(join(repo, "theirs.txt"), "mine\n")

        expect(await run(vcs.stashAnd("pull"))).toStrictEqual(
          StashedSync.Kept({ files: ["README.md", "theirs.txt"] }),
        )

        expect(git(repo, "rev-parse", "HEAD")).toBe(git(repo, "rev-parse", "origin/main"))
        expect(git(repo, "status", "--porcelain")).toBe("")
        expect(git(repo, "stash", "list").split("\n")).toHaveLength(1)
        expect(git(repo, "show", "stash@{0}:README.md")).toBe("# mine")
      })
    })
  })

  it("leaves a stash that was already there alone, under its own", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withOrigin(repo, async (from) => {
        writeFileSync(join(repo, "README.md"), "# somebody else's\n")
        git(repo, "stash", "push", "--quiet", "--message", "theirs")
        landElsewhere(from, "theirs.txt")
        await run(vcs.fetch())
        writeFileSync(join(repo, "new.txt"), "new\n")

        expect(await run(vcs.stashAnd("pull"))).toStrictEqual(StashedSync.Restored())

        expect(git(repo, "stash", "list")).toContain("theirs")
        expect(git(repo, "stash", "list").split("\n")).toHaveLength(1)
        expect(git(repo, "status", "--porcelain")).toBe("?? new.txt")
      })
    })
  })

  it("reconciles over a dirty tree, and stashes nothing for a merge that would conflict", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withOrigin(repo, async (from) => {
        landElsewhere(from, "theirs.txt")
        commitFile(repo, "mine.txt")
        await run(vcs.fetch())
        writeFileSync(join(repo, "new.txt"), "new\n")

        expect(await run(vcs.stashAnd("reconcile"))).toStrictEqual(StashedSync.Restored())
        expect(git(repo, "rev-list", "--count", "--merges", "HEAD")).toBe("1")
        expect(git(repo, "status", "--porcelain")).toBe("?? new.txt")

        landEdit(from, "README.md", "# theirs\n")
        commitOnHost(repo, "README.md", "# mine\n")
        await run(vcs.fetch())
        const before = standing(repo)

        expect(await run(vcs.stashAnd("reconcile"))).toStrictEqual(
          StashedSync.Refused({
            refusal: SyncRefusal.Conflicted({
              branch: BranchName.make("main"),
              upstream: "origin/main",
              files: ["README.md"],
            }),
          }),
        )
        expect(standing(repo)).toStrictEqual(before)
      })
    })
  })

  it("refuses to pull a diverged branch around a stash, with the changes still in place", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withOrigin(repo, async (from) => {
        landElsewhere(from, "theirs.txt")
        commitFile(repo, "mine.txt")
        await run(vcs.fetch())
        writeFileSync(join(repo, "new.txt"), "new\n")
        const before = standing(repo)

        expect(await run(vcs.stashAnd("pull"))).toStrictEqual(
          StashedSync.Refused({ refusal: SyncRefusal.Diverged({ ahead: 1, behind: 1 }) }),
        )
        expect(standing(repo)).toStrictEqual(before)
      })
    })
  })
}

/** A push: never forced, and publishing a branch that has no upstream. */
const pushOnGit = (inRepo: InRepo): void => {
  it("pushes the commits a branch is ahead by", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withOrigin(repo, async (from) => {
        commitFile(repo, "mine.txt")

        expect(await run(vcs.push())).toBeUndefined()

        expect(git(from.origin, "rev-parse", "main")).toBe(git(repo, "rev-parse", "HEAD"))
        expect((await run(vcs.hostStatus())).upstream?.ahead).toBe(0)
      })
    })
  })

  it("publishes a branch with no upstream to origin under its own name, and tracks it", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withOrigin(repo, async (from) => {
        git(repo, "checkout", "--quiet", "-b", "feature")
        commitFile(repo, "mine.txt")

        expect(await run(vcs.push())).toBeUndefined()

        expect(git(from.origin, "rev-parse", "feature")).toBe(git(repo, "rev-parse", "HEAD"))
        expect((await run(vcs.hostStatus())).upstream).toStrictEqual({
          name: "origin/feature",
          ahead: 0,
          behind: 0,
        })
      })
    })
  })

  it("refuses to push a branch that is behind, sending nothing", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withOrigin(repo, async (from) => {
        landElsewhere(from, "theirs.txt")
        await run(vcs.fetch())
        const theirs = git(from.origin, "rev-parse", "main")

        expect(await run(vcs.push())).toStrictEqual(SyncRefusal.Behind({ behind: 1 }))
        commitFile(repo, "mine.txt")
        expect(await run(vcs.push())).toStrictEqual(SyncRefusal.Diverged({ ahead: 1, behind: 1 }))

        expect(git(from.origin, "rev-parse", "main")).toBe(theirs)
      })
    })
  })

  it("fails rather than hangs when origin cannot be reached", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withOrigin(repo, async () => {
        git(repo, "remote", "set-url", "origin", join(repo, "no-such-remote.git"))
        commitFile(repo, "mine.txt")

        const fetched = await run(Effect.either(vcs.fetch()))
        const pushed = await run(Effect.either(vcs.push()))

        expect(fetched).toMatchObject({ _tag: "Left", left: { op: "fetch origin" } })
        expect(pushed).toMatchObject({ _tag: "Left", left: { op: "push" } })
      })
    })
  })

  it("never runs an askpass it inherits, from the environment or from core.askPass", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withAuthWall(async (url) => {
        const around = mkdtempSync(join(tmpdir(), "orkestra-askpass-"))
        const inherited = process.env["GIT_ASKPASS"]
        try {
          const askpass = recordingAskpass(around)
          git(repo, "remote", "add", "origin", url)
          // The machine's own credential helpers are not what is under test, and one
          // holding a password for this address would answer before askpass is reached.
          git(repo, "config", "credential.helper", "")
          commitFile(repo, "mine.txt")

          // The repository's own configuration first, with nothing in the environment.
          delete process.env["GIT_ASKPASS"]
          git(repo, "config", "core.askPass", askpass.script)
          const fromConfig = await run(Effect.either(vcs.fetch()))
          expect(fromConfig).toMatchObject({ _tag: "Left", left: { op: "fetch origin" } })
          expect(existsSync(askpass.calls)).toBe(false)

          // Then what a process started from an editor's terminal inherits. `runGit`
          // spawns over the parent environment, so setting it here sets it for git.
          process.env["GIT_ASKPASS"] = askpass.script
          const fetched = await run(Effect.either(vcs.fetch()))
          const pushed = await run(Effect.either(vcs.push()))
          expect(fetched).toMatchObject({ _tag: "Left", left: { op: "fetch origin" } })
          expect(pushed).toMatchObject({ _tag: "Left", left: { op: "publish branch" } })
          expect(existsSync(askpass.calls)).toBe(false)
        } finally {
          if (inherited === undefined) delete process.env["GIT_ASKPASS"]
          else process.env["GIT_ASKPASS"] = inherited
          rmSync(around, { recursive: true, force: true })
        }
      })
    })
  })
}

/** Run this against any Vcs implementation. */
export const vcsContract = (c: VcsUnderTest): void => {
  const inRepo = inRepoFor(c)
  describe(`Vcs contract: ${c.label}`, () => {
    creationCases(inRepo)
    finishingCases(inRepo)
    rerunCases(inRepo)
    spawnCases(inRepo)
    hostMergeCases(inRepo)
    predictionCases(inRepo)
    containmentCases(inRepo)
    hostRepoCases(inRepo)
    changesCases(inRepo)
    forkPointCases(inRepo)
    changedFileCases(inRepo)
    workingTreeCases(inRepo)
    noOriginCases(inRepo)
  })
}

/**
 * Run this against git, beside `vcsContract`. Two halves, each its own test file: a
 * file runs its cases one after another, so the suite cannot finish before its longest
 * file does, and as one file this was the longest by far (136s of a 243s suite).
 */
export const vcsGitContract = (c: VcsUnderTest): void => {
  const inRepo = inRepoFor(c)
  describe(`Vcs contract, git only: ${c.label}`, () => {
    creationOnGit(inRepo)
    finishingOnGit(inRepo)
    rerunOnGit(inRepo)
    spawnOnGit(inRepo)
    hostMergeOnGit(inRepo)
    predictionOnGit(inRepo)
    containmentOnGit(inRepo)
    changesOnGit(inRepo)
    workingTreeOnGit(inRepo)
    forkPointOnGit(inRepo)
    patchTextOnGit(inRepo)
  })
}

/** The other half of `vcsGitContract`: the project checkout and its remote. */
/**
 * A goal branch on a real bare `origin`: made from the default branch, and merged into
 * through the engine's own checkout of it, which a pull request merged on the forge first
 * must not be lost under.
 */
const GOAL = BranchName.make("goal/ship")

/** `withOrigin`, with `origin/HEAD` set, which a goal branch is cut from. */
const withGoalOrigin = (repo: string, body: (from: Origin) => Promise<void>) =>
  withOrigin(repo, async (from) => {
    git(repo, "remote", "set-head", "origin", "main")
    await body(from)
  })

const goalBranchOnGit = (inRepo: InRepo): void => {
  it("makes the goal branch on origin from its default branch, and again is a no-op", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withGoalOrigin(repo, async (from) => {
        await run(vcs.createGoalBranch(GOAL))
        expect(git(from.origin, "rev-parse", GOAL)).toBe(git(from.origin, "rev-parse", "main"))
        landElsewhere(from, "theirs.txt")
        git(from.elsewhere, "push", "--quiet", "origin", `main:${GOAL}`)
        const moved = git(from.origin, "rev-parse", GOAL)

        await run(vcs.createGoalBranch(GOAL))

        expect(git(from.origin, "rev-parse", GOAL)).toBe(moved)
      })
    })
  })

  it("refuses the default branch, a name git will not take, and a repository with no origin", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      const refusal = async (branch: BranchName) => {
        const made = await run(Effect.either(vcs.createGoalBranch(branch)))
        return made._tag === "Left" ? made.left : undefined
      }
      expect((await refusal(GOAL))?.reason).toContain("origin")
      await withGoalOrigin(repo, async () => {
        const main = await refusal(BranchName.make("main"))
        const bad = await refusal(BranchName.make("goal/x.lock"))
        expect(main?.reason).toContain("default branch")
        expect(bad?.op).toBe("create goal branch")
      })
    })
  })

  it("cuts a sub-goal's branch from its parent's goal branch, and refuses a parent origin lacks", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withGoalOrigin(repo, async (from) => {
        const sub = BranchName.make(`${GOAL}-sub-1`)
        const orphan = await run(Effect.either(vcs.createGoalBranch(sub, GOAL)))
        expect(orphan._tag === "Left" ? orphan.left.reason : "made").toContain(`no \`${GOAL}\``)
        await run(vcs.createGoalBranch(GOAL))
        // The parent's goal branch moves past the default branch.
        git(from.elsewhere, "fetch", "--quiet", "origin")
        git(from.elsewhere, "checkout", "--quiet", "-b", "parent", `origin/${GOAL}`)
        commitOnHost(from.elsewhere, "parent.txt", "parent\n")
        git(from.elsewhere, "push", "--quiet", "origin", `parent:${GOAL}`)

        await run(vcs.createGoalBranch(sub, GOAL))

        expect(git(from.origin, "rev-parse", sub)).toBe(git(from.origin, "rev-parse", GOAL))
        expect(git(from.origin, "rev-parse", sub)).not.toBe(git(from.origin, "rev-parse", "main"))
      })
    })
  })

  it("merges into the goal checkout over a forge merge that landed first, and pushes", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withGoalOrigin(repo, async (from) => {
        await run(vcs.createGoalBranch(GOAL))
        const into = MergeInto.Goal({ goal: "ship-1", branch: GOAL })
        const worktree = await run(vcs.createWorktree("t1", BranchName.make(`origin/${GOAL}`)))
        commitFile(worktree.path, "mine.txt")
        // A sibling's pull request, merged into the goal branch on the forge.
        git(from.elsewhere, "fetch", "--quiet", "origin")
        git(from.elsewhere, "checkout", "--quiet", "-b", "sibling", `origin/${GOAL}`)
        commitFile(from.elsewhere, "sibling.txt")
        git(from.elsewhere, "push", "--quiet", "origin", `sibling:${GOAL}`)

        expect(await run(vcs.wouldConflict(into, worktree.branch))).toBe(false)
        const outcome = await run(vcs.merge(into, worktree.branch, "Merge t1"))

        expect(outcome._tag).toBe("Merged")
        const tip = git(from.origin, "rev-parse", GOAL)
        expect(git(from.origin, "show", `${tip}:mine.txt`)).toBe("mine.txt")
        expect(git(from.origin, "show", `${tip}:sibling.txt`)).toBe("sibling.txt")
        expect(await run(vcs.contains(into, worktree.branch))).toBe(true)
        // The person's own checkout never moved.
        expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main")
        expect(existsSync(join(repo, "mine.txt"))).toBe(false)
      })
    })
  })

  it("predicts a conflict against the goal branch as origin holds it", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withGoalOrigin(repo, async (from) => {
        await run(vcs.createGoalBranch(GOAL))
        const worktree = await run(vcs.createWorktree("t1", BranchName.make(`origin/${GOAL}`)))
        commitOnHost(worktree.path, "same.txt", "mine\n")
        git(from.elsewhere, "fetch", "--quiet", "origin")
        git(from.elsewhere, "checkout", "--quiet", "-b", "sibling", `origin/${GOAL}`)
        commitOnHost(from.elsewhere, "same.txt", "theirs\n")
        git(from.elsewhere, "push", "--quiet", "origin", `sibling:${GOAL}`)
        await run(vcs.fetch())

        const into = MergeInto.Goal({ goal: "ship-1", branch: GOAL })
        expect(await run(vcs.wouldConflict(into, worktree.branch))).toBe(true)
      })
    })
  })
}

/** The engine's checkout of a goal branch: one operation at a time, and pushed only when ahead. */
const goalCheckoutOnGit = (inRepo: InRepo): void => {
  it("takes two merges into one goal at once one after the other, and both reach origin", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withGoalOrigin(repo, async (from) => {
        await run(vcs.createGoalBranch(GOAL))
        const into = MergeInto.Goal({ goal: "ship-1", branch: GOAL })
        const cutFrom = BranchName.make(`origin/${GOAL}`)
        const [a, b] = await run(
          Effect.all([vcs.createWorktree("t1", cutFrom), vcs.createWorktree("t2", cutFrom)]),
        )
        commitFile(a.path, "a.txt")
        commitFile(b.path, "b.txt")

        const outcomes = await run(
          Effect.all(
            [vcs.merge(into, a.branch, "Merge t1"), vcs.merge(into, b.branch, "Merge t2")],
            {
              concurrency: "unbounded",
            },
          ),
        )

        expect(outcomes.map((o) => o._tag)).toEqual(["Merged", "Merged"])
        const tip = git(from.origin, "rev-parse", GOAL)
        expect(git(from.origin, "show", `${tip}:a.txt`)).toBe("a.txt")
        expect(git(from.origin, "show", `${tip}:b.txt`)).toBe("b.txt")
      })
    })
  })

  it("sends nothing at pushGoal where a forge merge since the last local one already holds it", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withGoalOrigin(repo, async (from) => {
        await run(vcs.createGoalBranch(GOAL))
        const worktree = await run(vcs.createWorktree("t1", BranchName.make(`origin/${GOAL}`)))
        commitFile(worktree.path, "mine.txt")
        await run(vcs.merge(MergeInto.Goal({ goal: "ship-1", branch: GOAL }), worktree.branch, "m"))
        // A sibling's pull request, merged on the forge after the local merge.
        git(from.elsewhere, "fetch", "--quiet", "origin")
        git(from.elsewhere, "checkout", "--quiet", "-b", "sibling", `origin/${GOAL}`)
        commitFile(from.elsewhere, "sibling.txt")
        git(from.elsewhere, "push", "--quiet", "origin", `sibling:${GOAL}`)
        const forged = git(from.origin, "rev-parse", GOAL)

        await run(vcs.pushGoal("ship-1", GOAL))

        expect(git(from.origin, "rev-parse", GOAL)).toBe(forged)
      })
    })
  })

  it("pushes at pushGoal the merge an earlier push did not deliver, and refuses a diverged checkout", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withGoalOrigin(repo, async (from) => {
        await run(vcs.createGoalBranch(GOAL))
        const worktree = await run(vcs.createWorktree("t1", BranchName.make(`origin/${GOAL}`)))
        commitFile(worktree.path, "mine.txt")
        await run(vcs.merge(MergeInto.Goal({ goal: "ship-1", branch: GOAL }), worktree.branch, "m"))
        const checkout = join(repo, ".orkestra", ".worktrees", "goal-ship-1")
        commitFile(checkout, "unsent.txt")

        await run(vcs.pushGoal("ship-1", GOAL))
        expect(git(from.origin, "rev-parse", GOAL)).toBe(git(checkout, "rev-parse", "HEAD"))

        commitFile(checkout, "local.txt")
        git(from.elsewhere, "fetch", "--quiet", "origin")
        git(from.elsewhere, "checkout", "--quiet", "-b", "sibling", `origin/${GOAL}`)
        commitFile(from.elsewhere, "sibling.txt")
        git(from.elsewhere, "push", "--quiet", "origin", `sibling:${GOAL}`)
        const pushed = await run(Effect.either(vcs.pushGoal("ship-1", GOAL)))
        expect(pushed._tag === "Left" ? pushed.left.reason : "pushed").toContain("diverged")
      })
    })
  })

  it("pushes nothing where there is no goal checkout, and removes one that is there", async () => {
    await inRepo(async ({ repo, vcs, run }) => {
      await withGoalOrigin(repo, async (from) => {
        await run(vcs.createGoalBranch(GOAL))
        await run(vcs.pushGoal("ship-1", GOAL))
        const worktree = await run(vcs.createWorktree("t1", BranchName.make(`origin/${GOAL}`)))
        commitFile(worktree.path, "mine.txt")
        await run(vcs.merge(MergeInto.Goal({ goal: "ship-1", branch: GOAL }), worktree.branch, "m"))
        const checkout = join(repo, ".orkestra", ".worktrees", "goal-ship-1")
        expect(existsSync(checkout)).toBe(true)

        await run(vcs.removeGoalCheckout("ship-1"))
        await run(vcs.removeGoalCheckout("ship-1"))

        expect(existsSync(checkout)).toBe(false)
        expect(git(from.origin, "rev-parse", "--verify", GOAL)).not.toBe("")
      })
    })
  })
}

export const vcsGitRemoteContract = (c: VcsUnderTest): void => {
  const inRepo = inRepoFor(c)
  describe(`Vcs contract, git only, against a remote: ${c.label}`, () => {
    hostStatusOnGit(inRepo)
    pullOnGit(inRepo)
    reconcileOnGit(inRepo)
    stashOnGit(inRepo)
  })
}

/**
 * What goes the other way, to the remote — a push, and a goal's branch and checkout.
 * Apart from {@link vcsGitRemoteContract} only so the two files run beside each other.
 */
export const vcsGitPushContract = (c: VcsUnderTest): void => {
  const inRepo = inRepoFor(c)
  describe(`Vcs contract, git only, pushing to a remote: ${c.label}`, () => {
    pushOnGit(inRepo)
    goalBranchOnGit(inRepo)
    goalCheckoutOnGit(inRepo)
  })
}
