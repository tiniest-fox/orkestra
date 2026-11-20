/**
 * Tier 1: taking a checkout off a tool call's argument, with no React and no fetch.
 *
 * The cases worth guarding are the ones a substitution gets wrong on a string it does not
 * parse: a path that is not the root's, a sibling directory whose name starts with the
 * root's, and a shell command holding several paths at once.
 */

import { describe, expect, it } from "vitest"
import { makeNote, makeTool } from "../fixtures"
import { withoutWorktree } from "./paths"

const ROOT = "/Users/k/Documents/Repos/orkestra/.orkestra/.worktrees/d68da68b-ce1b"

/** The detail after shortening — every case here is about a `Tool` entry. */
const detailOf = (detail: string, root: string | undefined): string | undefined => {
  const entry = withoutWorktree(makeTool({ detail }), root)
  return entry._tag === "Tool" ? entry.detail : undefined
}

describe("withoutWorktree", () => {
  it("leaves the path relative to the checkout", () => {
    expect(detailOf(`${ROOT}/src/agent/logic/event-line.ts`, ROOT)).toBe(
      "src/agent/logic/event-line.ts",
    )
  })

  it("takes every occurrence, because a command holds more than one", () => {
    // The answered case: `Bash` normalizes to the whole command, so the paths are
    // mid-string and there can be several.
    expect(detailOf(`cd ${ROOT}/client && pnpm test ${ROOT}/client/src/format`, ROOT)).toBe(
      "cd client && pnpm test client/src/format",
    )
  })

  it("names the checkout itself `.` rather than nothing", () => {
    // `cd ` with the argument deleted would read as a different command.
    expect(detailOf(`cd ${ROOT} && git status`, ROOT)).toBe("cd . && git status")
  })

  it("leaves a path outside the checkout whole", () => {
    // Reaching out of the worktree is the interesting case, and shortening would hide it.
    const outside = "/Users/k/.claude/settings.json"
    expect(detailOf(outside, ROOT)).toBe(outside)
  })

  it("leaves a sibling whose name starts with the checkout's whole", () => {
    // Both boundaries are guarded: without them this reads `-backup/src/x.ts`.
    expect(detailOf(`${ROOT}-backup/src/x.ts`, ROOT)).toBe(`${ROOT}-backup/src/x.ts`)
    expect(detailOf(`${ROOT}.orig`, ROOT)).toBe(`${ROOT}.orig`)
  })

  it("does not match the checkout inside a longer path", () => {
    expect(detailOf(`/elsewhere${ROOT}/src/x.ts`, ROOT)).toBe(`/elsewhere${ROOT}/src/x.ts`)
  })

  it("draws the detail whole when the trak has no worktree", () => {
    // Everything before the checkout exists runs where the daemon was started.
    const path = `${ROOT}/src/x.ts`
    expect(detailOf(path, undefined)).toBe(path)
  })

  it("shortens against a root written with a trailing separator", () => {
    expect(detailOf(`${ROOT}/src/x.ts`, `${ROOT}/`)).toBe("src/x.ts")
  })

  it("shortens the command behind a described call, and leaves the description whole", () => {
    const call = makeTool({ detail: `Test ${ROOT}`, command: `cd ${ROOT} && pnpm test` })
    expect(withoutWorktree(call, ROOT)).toMatchObject({
      detail: `Test ${ROOT}`,
      command: "cd . && pnpm test",
    })
  })

  it("leaves an entry that is not a tool call alone", () => {
    // A note, a bubble and a subagent's summary are prose, not an argument.
    const note = makeNote({ text: `wrote ${ROOT}/src/x.ts` })
    expect(withoutWorktree(note, ROOT)).toBe(note)
  })

  it("returns the entry itself when there was nothing to take off", () => {
    // Identity, so a redraw of an unchanged transcript allocates nothing.
    const call = makeTool({ detail: "pnpm verify" })
    expect(withoutWorktree(call, ROOT)).toBe(call)
    const named = makeTool()
    expect(withoutWorktree(named, ROOT)).toBe(named)
  })
})
