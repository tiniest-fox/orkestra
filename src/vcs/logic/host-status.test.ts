import { describe, expect, it } from "vitest"
import { HostHead, type HostStatus, SyncRefusal } from "../types/host-status.js"
import { BranchName, CommitSha } from "../types/worktree.js"
import {
  conflictedIn,
  hostStatusOf,
  pullRefusal,
  pushRefusal,
  reconcileRefusal,
  stashNamed,
  updateAfterMerge,
} from "./host-status.js"

const SHA = "d04d0542a05d28e95e7f54f5ed3bfd193fb5a9d7"

const onMain = (upstream?: HostStatus["upstream"]): HostStatus => ({
  head: HostHead.Branch({ name: BranchName.make("main") }),
  origin: true,
  ...(upstream === undefined ? {} : { upstream }),
})

describe("reading the host's status off porcelain v2", () => {
  it("reads the branch, the upstream and both counts", () => {
    const out = [
      `# branch.oid ${SHA}`,
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +1 -4",
      "1 .M N... 100644 100644 100644 a b README.md",
    ].join("\n")
    expect(hostStatusOf(out, true)).toStrictEqual(
      onMain({ name: "origin/main", ahead: 1, behind: 4 }),
    )
  })

  it("reads a detached HEAD as the commit it is on", () => {
    const out = `# branch.oid ${SHA}\n# branch.head (detached)`
    expect(hostStatusOf(out, false)).toStrictEqual({
      head: HostHead.Detached({ sha: CommitSha.make(SHA) }),
      origin: false,
    })
  })

  it("reads an upstream whose remote branch has gone as no upstream", () => {
    // Git keeps the configuration and prints no counts: there is nothing to count against.
    const out = `# branch.oid ${SHA}\n# branch.head main\n# branch.upstream origin/gone`
    expect(hostStatusOf(out, true)).toStrictEqual(onMain())
  })
})

describe("which state refuses a pull", () => {
  it("refuses a dirty tree with every file, ahead of a divergence", () => {
    const diverged = onMain({ name: "origin/main", ahead: 1, behind: 4 })
    expect(pullRefusal(diverged, ["M README.md", "?? new.ts"])).toStrictEqual(
      SyncRefusal.Dirty({ files: ["M README.md", "?? new.ts"] }),
    )
  })

  it("refuses a diverged branch, and lets a branch that is only behind through", () => {
    expect(pullRefusal(onMain({ name: "origin/main", ahead: 1, behind: 4 }), [])).toStrictEqual(
      SyncRefusal.Diverged({ ahead: 1, behind: 4 }),
    )
    expect(pullRefusal(onMain({ name: "origin/main", ahead: 0, behind: 4 }), [])).toBeUndefined()
  })

  it("refuses a branch that tracks nothing, and a detached HEAD", () => {
    expect(pullRefusal(onMain(), [])).toStrictEqual(SyncRefusal.NoUpstream())
    const detached: HostStatus = {
      head: HostHead.Detached({ sha: CommitSha.make(SHA) }),
      origin: true,
    }
    expect(pullRefusal(detached, [])).toStrictEqual(SyncRefusal.Detached())
  })
})

describe("which state refuses a push", () => {
  it("refuses a branch that is behind, so nothing is ever forced", () => {
    expect(pushRefusal(onMain({ name: "origin/main", ahead: 0, behind: 2 }))).toStrictEqual(
      SyncRefusal.Behind({ behind: 2 }),
    )
    expect(pushRefusal(onMain({ name: "origin/main", ahead: 3, behind: 2 }))).toStrictEqual(
      SyncRefusal.Diverged({ ahead: 3, behind: 2 }),
    )
  })

  it("publishes a branch with no upstream to origin, and refuses where there is none", () => {
    expect(pushRefusal(onMain())).toBeUndefined()
    expect(pushRefusal({ ...onMain(), origin: false })).toStrictEqual(SyncRefusal.NoOrigin())
  })
})

describe("which state refuses a reconcile", () => {
  it("takes a diverged branch, which is what it is for, and refuses a dirty tree whole", () => {
    const diverged = onMain({ name: "origin/main", ahead: 1, behind: 4 })
    expect(reconcileRefusal(diverged, [])).toBeUndefined()
    expect(reconcileRefusal(diverged, ["M README.md"])).toStrictEqual(
      SyncRefusal.Dirty({ files: ["M README.md"] }),
    )
  })

  it("refuses a branch that tracks nothing, and a detached HEAD", () => {
    expect(reconcileRefusal(onMain(), [])).toStrictEqual(SyncRefusal.NoUpstream())
    const detached: HostStatus = {
      head: HostHead.Detached({ sha: CommitSha.make(SHA) }),
      origin: true,
    }
    expect(reconcileRefusal(detached, [])).toStrictEqual(SyncRefusal.Detached())
  })
})

describe("reading what git printed for a merge and a stash", () => {
  it("reads the conflicted paths between the tree and the messages", () => {
    const out = [SHA, "README.md", "notes.txt", "", "Auto-merging README.md", "CONFLICT (content)"]
    expect(conflictedIn(out.join("\n"))).toStrictEqual(["README.md", "notes.txt"])
    expect(conflictedIn(SHA)).toStrictEqual([])
  })

  it("finds a stash entry by its message, wherever it sits in the stack", () => {
    const list = [`aaa\tOn main: somebody else's`, `${SHA}\tOn main: ours 17`].join("\n")
    expect(stashNamed(list, "ours 17")).toBe(SHA)
    expect(stashNamed(list, "ours 18")).toBeUndefined()
    expect(stashNamed("", "ours 17")).toBeUndefined()
  })
})

describe("which press a merge into the base earns", () => {
  it("pulls a branch on the base that is only behind", () => {
    expect(updateAfterMerge(onMain({ name: "origin/main", ahead: 0, behind: 2 }), "main")).toBe(
      "pull",
    )
  })

  it("reconciles a branch on the base that has diverged", () => {
    expect(updateAfterMerge(onMain({ name: "origin/main", ahead: 1, behind: 2 }), "main")).toBe(
      "reconcile",
    )
  })

  it("leaves a branch tracking another upstream alone", () => {
    expect(
      updateAfterMerge(onMain({ name: "origin/feature", ahead: 0, behind: 2 }), "main"),
    ).toBeUndefined()
  })

  it("leaves a branch with nothing to bring down alone", () => {
    expect(
      updateAfterMerge(onMain({ name: "origin/main", ahead: 3, behind: 0 }), "main"),
    ).toBeUndefined()
  })

  it("leaves a branch with no upstream alone", () => {
    expect(updateAfterMerge(onMain(), "main")).toBeUndefined()
  })

  it("leaves a detached checkout alone", () => {
    const detached: HostStatus = {
      head: HostHead.Detached({ sha: CommitSha.make(SHA) }),
      origin: true,
    }
    expect(updateAfterMerge(detached, "main")).toBeUndefined()
  })
})
