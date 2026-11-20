// `src/check-stages.ts --related`, run as a check runs it in a project of its own: what it
// measures from, and the `held_back:` entry it reads from the project's selection file. The
// project and the run are `test/support/related-repo.ts`'s; the `reads:` rows are
// `check-stages-reads.test.ts`, so the runs go to separate workers.

import { describe, expect, it } from "vitest"
import { HELD_BACK } from "../src/check-stages.js"
import { git } from "./support/git.js"
import { edit, related, relatedRepo } from "./support/related-repo.js"

describe("check-stages --related", () => {
  it("runs only the tests of what changed since the tree the check last passed on", () => {
    const { dir, passed } = relatedRepo()
    edit(dir, "a.js")
    const { out, ran } = related(dir, passed)
    expect(ran).toStrictEqual(["a"])
    expect(out).toContain("✓ pnpm test — test files: 1 ran, 0 already proven\n")
    expect(out).toContain(`${HELD_BACK} held.test.js\n`)
  }, 60_000)

  it("runs the tests of everything the branch changed where it has passed on no tree", () => {
    const { dir } = relatedRepo()
    edit(dir, "a.js")
    expect(related(dir).ran).toStrictEqual(["a", "b"])
  }, 60_000)

  it("runs a held-back test when a file its when: names changed", () => {
    const { dir, passed } = relatedRepo()
    edit(dir, "held/subject.js")
    const { out, ran } = related(dir, passed)
    expect(ran).toStrictEqual(["held"])
    expect(out).not.toContain(HELD_BACK)
  }, 60_000)
})

/**
 * The project with its branch read as a goal branch ahead of `main`, which changed `b.js`, and
 * a trak cut from that branch's tip that changed `a.js` and has passed on no tree: the dir,
 * and the commit the trak was cut from.
 */
const onGoalBranch = (): { dir: string; cut: string } => {
  const { dir } = relatedRepo()
  const cut = git(dir, "rev-parse", "HEAD")
  git(dir, "checkout", "-q", "-b", "trak/on-goal")
  edit(dir, "a.js")
  git(dir, "commit", "-q", "-am", "the trak's own step")
  return { dir, cut }
}

describe("check-stages --related on a trak cut from a branch ahead of main", () => {
  it("runs only the tests of the trak's own changes, measured from the commit it was cut from", () => {
    const { dir, cut } = onGoalBranch()
    expect(related(dir, undefined, cut).ran).toStrictEqual(["a"])
  }, 60_000)

  it("measures from main where no commit is handed over", () => {
    const { dir } = onGoalBranch()
    expect(related(dir).ran).toStrictEqual(["a", "b"])
  }, 60_000)

  it("measures from main where the checkout does not hold the commit handed over", () => {
    const { dir } = onGoalBranch()
    expect(related(dir, undefined, "0123456789abcdef0123456789abcdef01234567").ran).toStrictEqual([
      "a",
      "b",
    ])
  }, 60_000)
})
