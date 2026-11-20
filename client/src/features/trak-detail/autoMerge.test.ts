import { describe, expect, it } from "vitest"
import {
  autoMergeLine,
  autoMergeNotice,
  autoMergePhrase,
  autoMerging,
  sentBackText,
} from "./autoMerge"

describe("autoMergeLine", () => {
  it("says off, on, and how many sends are spent", () => {
    expect(autoMergeLine(undefined)).toBe("off")
    expect(autoMergeLine({ sentBack: 0, limit: 3 })).toBe("on")
    expect(autoMergeLine({ sentBack: 2, limit: 3 })).toBe("on · sent back 2 of 3")
  })

  it("says why it stopped, naming the failed checks", () => {
    expect(
      autoMergeLine({ sentBack: 3, limit: 3, stopped: { _tag: "Checks", failed: ["test"] } }),
    ).toBe("stopped after 3 sends — its checks failed: test; merge or archive it yourself")
  })
})

describe("a stop no send could fix", () => {
  it("says the forge holds the merge, or what it said refusing it, with no count", () => {
    expect(autoMergeLine({ sentBack: 0, limit: 3, stopped: { _tag: "Blocked" } })).toBe(
      "stopped — its checks pass, and GitHub still holds the merge (a required review or rule); merge or archive it yourself",
    )
    expect(
      autoMergeLine({ sentBack: 1, limit: 3, stopped: { _tag: "Refused", why: "not mergeable" } }),
    ).toBe("stopped — GitHub refused the merge: not mergeable; merge or archive it yourself")
  })
})

describe("sentBackText", () => {
  it("names a conflict, and failed checks with or without their names", () => {
    expect(sentBackText({ _tag: "Conflict" })).toBe(
      "auto-merge: its pull request conflicts with its base",
    )
    expect(sentBackText({ _tag: "Checks", failed: [] })).toBe("auto-merge: its checks failed")
  })
})

describe("the switch's words", () => {
  const spent = { sentBack: 3, limit: 3, stopped: { _tag: "Conflict" as const } }
  const held = { sentBack: 0, limit: 3, stopped: { _tag: "Blocked" as const } }

  it("counts a stopped one as not merging, and says so in the row's phrase", () => {
    expect([
      autoMerging(undefined),
      autoMerging({ sentBack: 1, limit: 3 }),
      autoMerging(spent),
    ]).toEqual([false, true, false])
    expect(autoMergePhrase(undefined)).toBe("once its checks pass")
    expect(autoMergePhrase({ sentBack: 1, limit: 3 })).toBe("sent back 1 of 3")
    expect(autoMergePhrase(spent)).toBe("stopped")
  })

  it("says nothing above the switch until a send is spent", () => {
    expect(autoMergeNotice(undefined)).toBeUndefined()
    expect(autoMergeNotice({ sentBack: 0, limit: 3 })).toBeUndefined()
    expect(autoMergeNotice({ sentBack: 1, limit: 3 })).toEqual({
      waiting: false,
      text: "Auto-merge sent it back 1 of 3 times to make it mergeable.",
    })
  })

  it("tells a stop for sends spent to turn it on, and one GitHub holds to merge it there", () => {
    expect(autoMergeNotice(spent)).toEqual({
      waiting: true,
      text: "Auto-merge stopped after 3 sends — its pull request conflicts with its base. Turn it on to try again.",
    })
    expect(autoMergeNotice(held)?.text).toMatch(/Merge it on GitHub once the review is in\.$/)
  })
})

/** A local auto-merge, with no `origin`: the conflict names the checkout's branch, never a
 *  pull request, wherever the cause is worded. */
describe("a conflict in a local auto-merge", () => {
  const local = { _tag: "Conflict" as const, into: "main" }
  const words = "its branch conflicts with main in the project's checkout"

  it("names the checkout's branch in the re-entry's caption", () => {
    expect(sentBackText(local)).toBe(`auto-merge: ${words}`)
  })

  it("names it in the details line once the sends are spent", () => {
    expect(autoMergeLine({ sentBack: 3, limit: 3, stopped: local })).toBe(
      `stopped after 3 sends — ${words}; merge or archive it yourself`,
    )
  })

  it("names it in the notice above the switch", () => {
    expect(autoMergeNotice({ sentBack: 3, limit: 3, stopped: local })).toEqual({
      waiting: true,
      text: `Auto-merge stopped after 3 sends — ${words}. Turn it on to try again.`,
    })
  })
})
