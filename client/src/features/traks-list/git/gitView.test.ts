/**
 * Tier 1: what the git bar says. One row of the design's table per case — which action
 * the branch's state calls for and whether Fetch waits behind the chevron — then what is
 * running, and what each press that did not land is told and offered.
 */

import { describe, expect, it } from "vitest"
import type { GitActionDto, HostGitDto } from "../../../api/types"
import { makeHostGit } from "../../../fixtures"
import { ageSaid, ago, gitView, pressable } from "./gitView"
import type { GitCell, Pressed } from "./gitView"

const up = (ahead: number, behind: number): Partial<HostGitDto> => ({
  upstream: { name: "origin/main", ahead, behind },
})

const view = (
  over: Partial<HostGitDto>,
  pressed?: Pressed,
  pending?: GitActionDto,
  dismissed?: string,
  earnedAt?: number,
) => gitView(makeHostGit(over), pressed, pending, dismissed, earnedAt)

const press = (action: GitActionDto, verb: string, ahead = 0, behind = 0): GitCell => ({
  _tag: "Press",
  action,
  verb,
  ahead,
  behind,
  busy: false,
})

describe("which action the bar shows", () => {
  const rows: readonly (readonly [string, Partial<HostGitDto>, GitCell, boolean])[] = [
    [
      "no origin",
      { origin: false, upstream: undefined },
      { _tag: "None", said: "no origin" },
      false,
    ],
    [
      "a detached HEAD",
      { head: { _tag: "Detached", sha: "d04d0542a05d28e9" }, upstream: undefined },
      { _tag: "None", said: "detached" },
      false,
    ],
    ["no upstream", { upstream: undefined }, press("push", "Publish"), true],
    ["level with its upstream", up(0, 0), press("fetch", "Fetch"), false],
    ["not fetched yet", { ...up(0, 0), fetchedAt: undefined }, press("fetch", "Fetch"), false],
    ["behind only", up(0, 3), press("pull", "Pull", 0, 3), true],
    ["ahead only", up(2, 0), press("push", "Push", 2, 0), true],
    ["ahead and behind", up(1, 4), press("reconcile", "Reconcile", 1, 4), true],
  ]

  it.each(rows)(
    "draws %s as its cell, with Fetch behind the chevron or not",
    (_, git, cell, menu) => {
      const drawn = view(git)
      expect(drawn.cell).toStrictEqual(cell)
      expect(drawn.menu).toBe(menu)
      expect(drawn.idle).toBe(true)
    },
  )

  it("says Fetching in place of the action while a fetch runs, whoever started it", () => {
    const fetching = { _tag: "Press", action: "fetch", verb: "Fetching", ahead: 0, behind: 0 }
    for (const drawn of [
      view({ ...up(0, 3), fetching: true }),
      view(up(0, 3), undefined, "fetch"),
    ]) {
      expect(drawn.cell).toStrictEqual({ ...fetching, busy: true })
      // The chevron stays where it was, and nothing on the bar may be pressed.
      expect(drawn.menu).toBe(true)
      expect(drawn.idle).toBe(false)
      expect(pressable(drawn, "pull")).toBe(false)
      expect(pressable(drawn, "fetch")).toBe(false)
    }
  })

  it("says a running press's own word, over the fetch a pull begins with", () => {
    const pulling = view({ ...up(0, 3), fetching: true }, undefined, "pull")
    expect(pulling.cell).toStrictEqual({ ...press("pull", "Pull", 0, 3), busy: true })
    expect(pulling.idle).toBe(false)

    expect(view({ upstream: undefined }, undefined, "push").cell).toStrictEqual({
      ...press("push", "Publish"),
      busy: true,
    })
    // A press whose state a poll has since moved under it still shows its own word.
    expect(view(up(0, 0), undefined, "reconcile").cell).toStrictEqual({
      ...press("reconcile", "Reconcile"),
      busy: true,
    })
  })

  it("lets the cell's own action and the menu's Fetch be pressed, and nothing else", () => {
    const behind = view(up(0, 3))
    expect(pressable(behind, "pull")).toBe(true)
    expect(pressable(behind, "fetch")).toBe(true)
    expect(pressable(behind, "push")).toBe(false)
    expect(pressable(behind, "reconcile")).toBe(false)
    expect(pressable(view({ origin: false, upstream: undefined }), "fetch")).toBe(false)
  })
})

describe("what the checkout's own state needs saying", () => {
  it("says each standing state in the card and raises none of them", () => {
    const standing: readonly (readonly [Partial<HostGitDto>, string])[] = [
      [{ origin: false, upstream: undefined }, "No remote named origin"],
      [
        { head: { _tag: "Detached", sha: "d04d0542a05d28e9" }, upstream: undefined },
        "HEAD is detached at d04d054",
      ],
      [{ upstream: undefined }, "No upstream"],
      [up(1, 4), "Diverged from origin/main"],
    ]
    for (const [git, title] of standing) {
      const drawn = view(git)
      expect(drawn.standing).toMatchObject({ tone: "neutral", title })
      expect(drawn.problem).toBeUndefined()
      expect(drawn.risen).toBe(false)
    }
    expect(view(up(0, 3)).standing).toBeUndefined()
  })

  it("names Reconcile for a diverged branch, and sends nobody to a terminal", () => {
    expect(view(up(1, 4)).standing?.body).toBe(
      "Reconcile merges the 4 commits on origin/main into your 1 local commit.",
    )
  })
})

describe("what a press that did not land is told", () => {
  const files = ["M README.md", "?? new.txt"] as const
  const dirty = (action: GitActionDto): Pressed => ({
    action,
    at: 7,
    refusal: { _tag: "Dirty", files: [...files] },
  })

  it("offers the stash press for a dirty tree, named for the action the bar shows now", () => {
    const behind = view(up(0, 3), dirty("pull"))
    expect(behind.problem).toMatchObject({
      tone: "bad",
      title: "Pull refused — 2 files have uncommitted changes",
      files,
      word: "Refused",
      fix: { _tag: "Stash", action: "pull", label: "Stash & pull" },
    })
    expect(behind.risen).toBe(true)
    // The cell is unchanged: the notice is where the way through is.
    expect(behind.cell).toStrictEqual(press("pull", "Pull", 0, 3))

    expect(view(up(1, 4), dirty("reconcile")).problem?.fix).toStrictEqual({
      _tag: "Stash",
      action: "reconcile",
      label: "Stash & reconcile",
    })
    // A poll found the branch diverged since the pull was refused.
    expect(view(up(1, 4), dirty("pull")).problem?.fix).toMatchObject({ action: "reconcile" })
    expect(view(up(0, 0), dirty("pull")).problem?.fix).toBeUndefined()
  })

  it("offers Resolve in a Trak for a conflict, carrying the engine's request", () => {
    const stopped = view(up(1, 4), {
      action: "reconcile",
      at: 7,
      refusal: { _tag: "Conflict", files: ["README.md"], description: "Merge it." },
    })
    expect(stopped.problem).toMatchObject({
      tone: "bad",
      title: "Reconcile stopped — 1 file conflicts",
      files: ["README.md"],
      word: "Conflict",
      fix: { _tag: "Resolve", label: "Resolve in a Trak", description: "Merge it." },
    })
  })

  it("says where the changes are when a stash kept them, in the waiting tone and with no press", () => {
    const kept = view(up(0, 0), { action: "pull", at: 7, stashed: ["README.md"] })
    expect(kept.problem).toMatchObject({
      tone: "waiting",
      title: "Pulled — your changes are in the stash",
      files: ["README.md"],
      word: "Stashed",
      fix: undefined,
    })
  })

  it("quotes git for a press that failed, and stands a press's own answer over it", () => {
    const failure = { action: "push", message: "remote: Permission denied", at: 40 } as const
    const drawn = view({ ...up(2, 0), failure }, undefined, undefined, undefined, 40)
    expect(drawn.problem).toMatchObject({
      key: "failure:40",
      tone: "bad",
      title: "Push failed",
      body: "remote: Permission denied",
      word: "Failed",
      fix: undefined,
    })
    expect(drawn.risen).toBe(true)
    expect(
      view({ ...up(2, 0), failure }, { action: "fetch", at: 7, unreachable: true }).problem,
    ).toMatchObject({ key: "press:7", title: "Fetch did not reach the engine", word: "Failed" })
  })

  it.each(["fetch", "pull", "reconcile", "push"] as const)(
    "draws a %s failure no press here earned as already put away, and never raises it",
    (action) => {
      const failure = { action, message: "no route to host", at: 40 }
      // First load, another tab's press, or the fetch a poll started: nothing was pressed.
      const unearned = view({ ...up(0, 3), failure })
      expect(unearned.problem).toMatchObject({ key: "failure:40", word: "Failed" })
      expect(unearned.risen).toBe(false)
      // A press here earned an earlier failure and it was dismissed. The engine's next
      // one has a new `at`, which is neither the dismissed key nor the earned one.
      const second = { ...failure, at: 90 }
      expect(
        view({ ...up(0, 3), failure: second }, undefined, undefined, "failure:40", 40).risen,
      ).toBe(false)
      expect(
        view({ ...up(0, 3), failure: second }, undefined, undefined, undefined, 40).risen,
      ).toBe(false)
    },
  )

  it("keeps a dismissed problem off the notice until a press earns another", () => {
    const failure = { action: "fetch", message: "no route", at: 40 } as const
    const dismissed = view({ failure }, undefined, undefined, "failure:40", 40)
    expect(dismissed.problem?.title).toBe("Fetch failed")
    expect(dismissed.risen).toBe(false)
    // The same press failing again is a new failure that a press earned, and rises.
    expect(
      view({ failure: { ...failure, at: 90 } }, undefined, undefined, "failure:40", 90).risen,
    ).toBe(true)
    expect(view(up(0, 3), dirty("pull"), undefined, "press:7").risen).toBe(false)
    expect(view(up(0, 3), { ...dirty("pull"), at: 8 }, undefined, "press:7").risen).toBe(true)
  })
})

describe("the age of the last fetch", () => {
  it("counts in the strip's few characters", () => {
    expect(ago(20_000)).toBe("just now")
    expect(ago(2 * 60_000)).toBe("2 min ago")
    expect(ago(3 * 3_600_000)).toBe("3 h ago")
    expect(ago(50 * 3_600_000)).toBe("2 d ago")
  })

  it("says nothing without an origin, and says so before the first fetch", () => {
    expect(ageSaid(view({ origin: false, upstream: undefined }), 0)).toBeUndefined()
    expect(ageSaid(view({ fetchedAt: undefined }), 0)).toBe("not fetched yet")
    expect(ageSaid(view({ fetchedAt: 1000 }), 121_000)).toBe("2 min ago")
  })
})
