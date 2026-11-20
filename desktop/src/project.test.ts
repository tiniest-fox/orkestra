import { describe, expect, it } from "vitest"
import { type EntryKind, projectRefusal } from "./project.js"

/** A disk holding `entries`; every folder named as a key's parent is there too. */
const disk =
  (entries: Record<string, EntryKind>) =>
  (path: string): EntryKind =>
    entries[path] ??
    (Object.keys(entries).some((k) => k.startsWith(`${path}/`)) ? "directory" : "missing")

describe("which folders the app opens", () => {
  it("opens a repository with an .orkestra/ in it", () => {
    const kind = disk({ "/r/.git": "directory", "/r/.orkestra": "directory" })
    expect(projectRefusal("/r", kind)).toBeUndefined()
  })

  it("accepts a worktree, whose .git is a file", () => {
    const kind = disk({ "/w/.git": "file", "/w/.orkestra": "directory" })
    expect(projectRefusal("/w", kind)).toBeUndefined()
  })

  it("names the git check when there is no .git", () => {
    const kind = disk({ "/r/.orkestra": "directory" })
    expect(projectRefusal("/r", kind)).toEqual({
      check: "git",
      reason: "/r is not a git repository — there is no .git in it.",
    })
  })

  it("names the .orkestra check when a repository has none", () => {
    const kind = disk({ "/r/.git": "directory" })
    expect(projectRefusal("/r", kind)).toEqual({
      check: "orkestra",
      reason: "/r has no .orkestra/ — Orkestra opens only a repository that already has one.",
    })
  })

  it("treats an .orkestra that is a file as none, because the engine reads a directory", () => {
    const kind = disk({ "/r/.git": "directory", "/r/.orkestra": "file" })
    expect(projectRefusal("/r", kind)?.check).toBe("orkestra")
  })

  it("says a folder that is gone is gone, before saying it is not a repository", () => {
    expect(projectRefusal("/r", disk({}))).toEqual({
      check: "missing",
      reason: "/r no longer exists.",
    })
  })

  it("reports the git check before the .orkestra one, so a folder failing both gets the earlier reason", () => {
    expect(projectRefusal("/r", disk({ "/r/README": "file" }))?.check).toBe("git")
  })
})
