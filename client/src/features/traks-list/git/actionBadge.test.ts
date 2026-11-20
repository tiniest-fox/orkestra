/**
 * Tier 1: what the phone's git-action tab says on its badge and aloud — a dismissed
 * problem before a count, behind before ahead, and 99+ past 99.
 */

import { describe, expect, it } from "vitest"
import type { HostGitDto } from "../../../api/types"
import { makeHostGit } from "../../../fixtures"
import { actionBadge, actionLabel } from "./actionBadge"
import { gitView } from "./gitView"

const view = (over: Partial<HostGitDto>, dismissed?: string) =>
  gitView(makeHostGit(over), undefined, undefined, dismissed, undefined)

const up = (ahead: number, behind: number): Partial<HostGitDto> => ({
  upstream: { name: "origin/main", ahead, behind },
})

describe("the git-action tab", () => {
  it("counts behind in the working tone, and ahead only when nothing is behind", () => {
    expect(actionBadge(view(up(0, 3)))).toEqual({ text: "3", tone: "working" })
    expect(actionBadge(view(up(12, 128)))).toEqual({ text: "99+", tone: "working" })
    expect(actionBadge(view(up(2, 0)))).toEqual({ text: "2", tone: "neutral" })
    expect(actionBadge(view(up(0, 0)))).toBeUndefined()
  })
  it("says the verb and both counts aloud", () => {
    expect(actionLabel(view(up(12, 128)))).toBe("Reconcile, 12 ahead, 128 behind")
    expect(actionLabel(view(up(0, 0)))).toBe("Fetch")
    expect(actionLabel(view({ origin: false, upstream: undefined }))).toBe("Git: no origin")
  })
  it("carries a problem no row raises as a ! in place of the count", () => {
    const failed = view({ ...up(0, 3), failure: { action: "fetch", message: "down", at: 40 } })
    expect(failed.risen).toBe(false)
    expect(actionBadge(failed)).toEqual({ text: "!", tone: "waiting" })
    expect(actionLabel(failed)).toBe("Pull, failed")
  })
})
