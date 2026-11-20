import { describe, expect, it } from "vitest"
import { BranchName, CommitSha } from "../types/worktree.js"
import {
  baseRefFor,
  branchFor,
  checkoutPlaceOf,
  forkRefFor,
  goalCheckoutPathFor,
  remotesIn,
  trakOfBranch,
  trakOfCheckout,
  worktreeFor,
  worktreePathFor,
  withoutCredentials,
} from "./paths.js"

const BASE = CommitSha.make("abc1234")

describe("where a trak's checkout goes", () => {
  it("is absolute, under the repository root it was given", () => {
    // The point of taking a root at all: a relative path is resolved against
    // `process.cwd()`, which is not the repository whenever `ork` is run from a
    // subdirectory — and the same string is handed to git and used as an
    // agent's `cwd`, so the two would disagree about where the trak is.
    expect(worktreeFor("/repos/orkestra", "t1", BASE).path).toBe(
      "/repos/orkestra/.orkestra/.worktrees/t1",
    )
  })

  it("names the branch after the trak, so a human can find the work later", () => {
    expect(worktreeFor("/repos/orkestra", "t1", BASE).branch).toBe("trak/t1")
  })

  it("carries the base commit through, since only git could have supplied it", () => {
    // Not a naming decision like the other two, which is why it is an argument:
    // it is what `finishWorktree` compares the branch tip against to tell a step
    // that wrote nothing from a commit that already happened.
    expect(worktreeFor("/repos/orkestra", "t1", BASE).base).toBe("abc1234")
  })

  it("gives two traks two different places to work", () => {
    const a = worktreeFor("/repos/orkestra", "t1", BASE)
    const b = worktreeFor("/repos/orkestra", "t2", BASE)
    expect(a.path).not.toBe(b.path)
    expect(a.branch).not.toBe(b.branch)
  })

  it("names the path and the branch without being told a base", () => {
    // The adapter has to name both before it can know the base: whether a
    // checkout is registered, and whether the branch is already there, is what
    // decides where the base comes from. Asking for a whole `Worktree` that
    // early meant handing in a `CommitSha` of `"unresolved"` — a brand asserting
    // something false — purely to read a field back off it.
    const worktree = worktreeFor("/repos/orkestra", "t1", BASE)
    expect(worktreePathFor("/repos/orkestra", "t1")).toBe(worktree.path)
    expect(branchFor("t1")).toBe(worktree.branch)
  })
})

describe("where a trak's base commit is written down", () => {
  it("is a ref outside refs/heads, so it is not a branch anyone can check out", () => {
    // It has to survive the process — the bug it fixes is `createWorktree`
    // re-deriving the base from a checkout whose agent had since committed — and
    // a ref is the only durable place git maintains for us. Under `refs/heads/`
    // it would show up in `git branch` and be pushed by a default refspec.
    expect(baseRefFor(branchFor("t1"))).toBe("refs/orkestra/base/trak/t1")
  })

  it("is keyed on the branch, which is what a caller holding a Worktree has", () => {
    // `finishWorktree` is handed a `Worktree` and no trak id, and it is the one
    // that has to delete this ref alongside the branch it describes.
    const worktree = worktreeFor("/repos/orkestra", "t2", BASE)
    expect(baseRefFor(worktree.branch)).toBe("refs/orkestra/base/trak/t2")
  })
})

describe("where the branch a trak forked from is written down", () => {
  it("is a second ref beside the base one, and not the base one", () => {
    // Two facts about the same fork, and they answer different questions: the
    // base is the commit and never moves, this is the branch and moves with it.
    // One ref could not hold both.
    expect(forkRefFor(branchFor("t1"))).toBe("refs/orkestra/fork/trak/t1")
    expect(forkRefFor(branchFor("t1"))).not.toBe(baseRefFor(branchFor("t1")))
  })
})

describe("which trak's checkout a directory is", () => {
  const root = "/repo"

  it("names the trak for its checkout and anything inside it", () => {
    expect(trakOfCheckout(root, worktreePathFor(root, "witty-jade-otter"))).toBe("witty-jade-otter")
    expect(trakOfCheckout(root, `${worktreePathFor(root, "witty-jade-otter")}/src/app`)).toBe(
      "witty-jade-otter",
    )
  })

  it("names none for the project checkout, a goal's checkout or the directory above them", () => {
    expect(trakOfCheckout(root, root)).toBeUndefined()
    expect(trakOfCheckout(root, goalCheckoutPathFor(root, "launch"))).toBeUndefined()
    expect(trakOfCheckout(root, `${root}/.orkestra/.worktrees`)).toBeUndefined()
    expect(trakOfCheckout(root, `${root}/.orkestra/.worktrees/`)).toBeUndefined()
    expect(trakOfCheckout(root, "/repo-other/.orkestra/.worktrees/x")).toBeUndefined()
  })
})

describe("which trak a branch was named for", () => {
  it("names the trak for the branch it made, and none for any other branch", () => {
    expect(trakOfBranch(branchFor("witty-jade-otter"))).toBe("witty-jade-otter")
    expect(trakOfBranch(BranchName.make("main"))).toBeUndefined()
    expect(trakOfBranch(BranchName.make("trak/"))).toBeUndefined()
    expect(trakOfBranch(BranchName.make("trak/a/b"))).toBeUndefined()
  })
})

describe("where a directory is in a trak's sandbox", () => {
  it("names the trak and spells the directory under the resolved project, whichever spelling matched", () => {
    const projects = ["/real/repo", "/link/repo"] as const
    expect(checkoutPlaceOf(projects, ["/link/repo/.orkestra/.worktrees/t/src"])).toEqual({
      trak: "t",
      path: "/real/repo/.orkestra/.worktrees/t/src",
    })
    expect(
      checkoutPlaceOf(projects, ["/elsewhere/x", "/real/repo/.orkestra/.worktrees/t"]),
    ).toEqual({ trak: "t", path: "/real/repo/.orkestra/.worktrees/t" })
  })

  it("names nothing for a directory in no trak's checkout", () => {
    expect(
      checkoutPlaceOf(["/repo"], ["/repo", "/repo/.orkestra/.worktrees/goal-x"]),
    ).toBeUndefined()
  })
})

describe("the remotes a sandbox is given", () => {
  it("reads each remote's name and URL, a dotted name whole", () => {
    expect(
      remotesIn(
        "remote.origin.url https://github.com/o/r.git\nremote.my.fork.url git@github.com:me/r.git",
      ),
    ).toEqual([
      { name: "origin", url: "https://github.com/o/r.git" },
      { name: "my.fork", url: "git@github.com:me/r.git" },
    ])
  })

  it("reads no remote from an empty listing", () => {
    expect(remotesIn("")).toEqual([])
  })

  it("takes a token or a password out of an HTTPS URL", () => {
    expect(withoutCredentials("https://x-access-token:ghp_abc@github.com/o/r.git")).toBe(
      "https://github.com/o/r.git",
    )
    expect(withoutCredentials("https://ghp_abc@github.com/o/r.git")).toBe(
      "https://github.com/o/r.git",
    )
  })

  it("keeps an SSH URL's login and a URL holding no credential", () => {
    expect(withoutCredentials("git@github.com:o/r.git")).toBe("git@github.com:o/r.git")
    expect(withoutCredentials("ssh://git@github.com/o/r.git")).toBe("ssh://git@github.com/o/r.git")
    expect(withoutCredentials("https://github.com/o/r.git")).toBe("https://github.com/o/r.git")
    expect(withoutCredentials("/srv/git/r.git")).toBe("/srv/git/r.git")
  })
})
