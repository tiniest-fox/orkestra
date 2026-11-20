/**
 * What the foot of the finished pane draws, and — the point of this file — what it refuses
 * to draw for a state that would not take it.
 *
 * **A pick outlives the state it was made in.** Ticking something at `Finished` and then
 * pressing an ending leaves the list full while the trak moves to a state that takes no more
 * work, so the box has to be gated on the offer rather than on there being something in it.
 * Rendered bare, with the ending cell and the doors as props: which states set them is
 * `controls.test.ts` and `endingCell`'s own, and this is about the band given them.
 *
 * **Where Archive is drawn, and that nothing archives without the confirmation** — the
 * promotion table and the guard are the two halves the design settled, so both are asserted
 * over the set of panes rather than the cell somebody thought of.
 *
 * **And which door the box is on**, which is the other thing decided here and nowhere else:
 * the two presses are the only place an agent name reaches the request, so what each one
 * sends is asserted rather than inferred from the words it drew.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { Bot } from "lucide-react"
import FinishedActs from "./FinishedActs"
import type { AutoMergeOffer } from "./FinishedActs"
import type { EndingCell } from "../finished"
import type { Picked } from "../../pull-request/picks/reentryBody"
import type { Archiving } from "../../useArchive"
import type { Merge } from "../merge/useMerge"
import type { PullMerging } from "../merge/useMergePullRequest"
import type { MergeMethodPick } from "../merge/useSetMergeMethod"
import type { PullMerge } from "../../pull-request/pullRequest"
import type { Changes } from "./useReenter"

afterEach(cleanup)

const MERGE: Merge = {
  merge: () => {},
  isPending: false,
  disabled: false,
  said: undefined,
  files: [],
  forget: () => {},
}

const ARCHIVING: Archiving = {
  archive: () => {},
  isPending: false,
  disabled: false,
  said: undefined,
}

const CHANGES: Changes = {
  what: "",
  write: () => {},
  send: () => {},
  isPending: false,
  disabled: false,
  said: undefined,
}

/** One thing already ticked, which is what makes each case below about the gate rather than
 *  about an empty list. */
const PICKED: readonly Picked[] = [
  { key: "check:run:1", label: "verify — failing", said: "it failed", where: [], quote: undefined },
]

/** An open pull request #142 GitHub would take, on a repository that only squashes. */
const PULL: PullMerge = {
  number: 142,
  method: "squash",
  methods: ["squash"],
  verdict: { _tag: "Mergeable" },
}

/** The same, on a repository allowing all three methods. */
const THREE: PullMerge = { ...PULL, methods: ["merge", "squash", "rebase"] }

/** The method menu, recording each method picked. */
const picker = () => {
  const picks: string[] = []
  const methodPick: MergeMethodPick = {
    pick: (method) => {
      picks.push(method)
    },
    picking: undefined,
    said: undefined,
  }
  return { picks, methodPick }
}

const PULL_MERGING: PullMerging = {
  merge: () => {},
  isPending: false,
  disabled: false,
  said: undefined,
}

interface Pane {
  readonly cell: EndingCell
  readonly pull?: PullMerge
  readonly pullMerging?: PullMerging
  readonly methodPick?: MergeMethodPick
  readonly doors?: boolean
  readonly merged?: boolean
  readonly moved?: boolean
  readonly waiting?: boolean
  readonly changes?: Changes
  readonly picked?: readonly Picked[]
  readonly archiving?: Archiving
  readonly onClear?: () => void
  readonly phone?: boolean
  readonly autoMerge?: AutoMergeOffer
}

/** `doors` defaults to a state that takes more work, `moved` to a branch something was
 *  committed to, and `merged` and `waiting` to neither — the pane every case about the box
 *  and the doors is drawn on. */
const draw = ({
  cell,
  pull,
  pullMerging = PULL_MERGING,
  methodPick = picker().methodPick,
  doors = true,
  merged = false,
  moved = true,
  waiting = false,
  changes = CHANGES,
  picked = PICKED,
  archiving = ARCHIVING,
  onClear = () => {},
  phone = false,
  autoMerge,
}: Pane): void => {
  render(
    <FinishedActs
      cell={cell}
      doors={doors}
      merged={merged}
      moved={moved}
      waiting={waiting}
      instead="Nothing more to decide here."
      destination="main"
      conflicts={false}
      askGlyph={Bot}
      merge={MERGE}
      pull={pull}
      pullMerging={pullMerging}
      methodPick={methodPick}
      autoMerge={autoMerge}
      refusedAbove={false}
      archiving={archiving}
      changes={changes}
      picked={picked}
      onRemove={() => {}}
      onClear={onClear}
      phone={phone}
    />,
  )
}

describe("the box that receives a pick", () => {
  /** `Merging` and `Closing`: with an ending in flight the merge, the archive and the
   *  re-entry are all off, so the pane says which one is running and draws no control at
   *  all — including for a pick made before the state moved. */
  it("draws nothing but the sentence where the state offers nothing", () => {
    draw({ cell: "none", doors: false })

    expect(screen.getByText("Nothing more to decide here.")).toBeDefined()
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  /**
   * The case the guard exists for: something is on offer, so the row is drawn — and more
   * work is not, so the box is not, however full the picked list is. `POST /reenter` would
   * answer `409 NotAtRest`. A refused merge is this pane.
   */
  it("draws no box where something is offered but more work is not", () => {
    draw({ cell: "merge", doors: false })

    expect(screen.getByRole("button", { name: "Merge into main" })).toBeDefined()
    expect(screen.queryByRole("button", { name: "More work on it" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Send it back" })).toBeNull()
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  /** And where it is offered, the pick opens the box on its own — no press needed, because a
   *  tick several folds above has to land somewhere a person can see it. On the plan door:
   *  a ticked failing check is something to change. */
  it("opens the box on a pick where more work is offered", () => {
    draw({ cell: "merge" })

    expect(screen.getByRole("button", { name: "Send it back" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Remove verify — failing" })).toBeDefined()
  })

  /** A tick is made on the card, so the box it opens takes no focus — which on a phone is
   *  the difference between a keyboard rising over the card and not. */
  it("takes no focus into a box a tick opened", () => {
    draw({ cell: "merge" })
    expect(document.activeElement).not.toBe(screen.getByRole("textbox"))
  })

  it("takes focus into the field a door press opens, and again on the other door", () => {
    draw({ cell: "merge", picked: [] })
    fireEvent.click(screen.getByRole("button", { name: "More work on it" }))
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "What should change?" }),
    )

    fireEvent.click(screen.getByRole("button", { name: "Ask about it" }))
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "What do you want to ask?" }),
    )
  })

  /** On a phone the focus raises the keyboard over the band's pinned edge, so the field has
   *  to be let into view — by `focus()`'s own scroll or an explicit one. A focus taken with
   *  `preventScroll` and nothing after it leaves the box under the keyboard. */
  it("lets the field a door press opens on a phone scroll into view", () => {
    const focused: {
      readonly node: Element
      readonly options: FocusOptions | undefined
    }[] = []
    const scrolled: Element[] = []
    const focus = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
      this: HTMLElement,
      options?: FocusOptions,
    ) {
      focused.push({ node: this, options })
    })
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      draw({ cell: "merge", picked: [], phone: true })
      fireEvent.click(screen.getByRole("button", { name: "Ask" }))
      const field = screen.getByRole("textbox", { name: "What do you want to ask?" })

      const takenWithScroll = focused.some(
        ({ node, options }) => node === field && options?.preventScroll !== true,
      )
      expect(
        takenWithScroll || scrolled.includes(field),
        "focused with preventScroll and never scrolled into view",
      ).toBe(true)
    } finally {
      focus.mockRestore()
      Reflect.deleteProperty(Element.prototype, "scrollIntoView")
    }
  })

  /** Send and its way out are at the box's own foot, never inserted into the row — so the
   *  row reads the same with the box open as shut. */
  it("draws the send inside the box and leaves the row as it was", () => {
    draw({ cell: "merge", picked: [] })
    const before = screen.getAllByRole("button").map((b) => b.textContent)
    fireEvent.click(screen.getByRole("button", { name: "More work on it" }))

    const box = screen.getByRole("textbox").closest(".rounded-surface")
    expect(box?.contains(screen.getByRole("button", { name: "Send it back" }))).toBe(true)
    expect(box?.contains(screen.getByRole("button", { name: "Cancel" }))).toBe(true)
    const row = screen.getAllByRole("button").filter((b) => box?.contains(b) !== true)
    expect(row.map((b) => b.textContent)).toEqual(before)
  })

  /** The send's refusal is drawn in the band with the box, and only while the box is. */
  it("draws the send's refusal while the box is open", () => {
    draw({ cell: "merge", changes: { ...CHANGES, said: "That trak has already come to rest." } })
    expect(screen.getByRole("alert").textContent).toBe("That trak has already come to rest.")
    cleanup()

    draw({
      cell: "merge",
      picked: [],
      changes: { ...CHANGES, said: "That trak has already come to rest." },
    })
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("shuts a box a press opened on Cancel", () => {
    draw({ cell: "merge", picked: [] })
    fireEvent.click(screen.getByRole("button", { name: "More work on it" }))
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

    expect(screen.queryByRole("textbox")).toBeNull()
  })

  /** With something ticked the way out reads *Clear*, and it empties the picked list — which
   *  is what holds the box open, so shutting without it would change nothing. */
  it("clears the ticks where something is ticked", () => {
    const cleared: string[] = []
    draw({ cell: "merge", onClear: () => cleared.push("clear") })

    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Clear" }))
    expect(cleared).toEqual(["clear"])
  })
})

/**
 * **On a phone the box takes the row's place**, and says what is ticked as a count: the
 * chrome above the pane stays pinned there, so the box has to leave the ticks above it room.
 */
describe("the box on a phone", () => {
  const TWO: readonly Picked[] = [
    { key: "c1", label: "reviewer-a on a.ts", said: "a", where: [], quote: "one" },
    { key: "c2", label: "reviewer-b on b.ts", said: "b", where: [], quote: "two" },
  ]

  it("counts what is ticked on its label line, with no list and no remove", () => {
    draw({ cell: "merge", picked: TWO, phone: true })
    expect(screen.getByText("2 ticked")).toBeInTheDocument()
    expect(screen.queryByText("reviewer-a on a.ts")).toBeNull()
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull()
  })

  it("stands in place of the row while it is open", () => {
    draw({ cell: "merge", picked: TWO, phone: true })
    for (const name of ["Merge", "Ask", "More work"])
      expect(screen.queryByRole("button", { name })).toBeNull()
  })

  it("brings the row back on Cancel", () => {
    draw({ cell: "merge", picked: [], phone: true })
    fireEvent.click(screen.getByRole("button", { name: "More work" }))
    expect(screen.queryByRole("button", { name: "Merge" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.getByRole("button", { name: "Merge" })).toBeInTheDocument()
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  it("keeps the named lines and the row at desk", () => {
    draw({ cell: "merge", picked: TWO })
    expect(screen.getByText("reviewer-a on a.ts")).toBeInTheDocument()
    expect(screen.queryByText("2 ticked")).toBeNull()
    expect(screen.getByRole("button", { name: "Merge into main" })).toBeInTheDocument()
  })
})

/**
 * **The row is the doors, then the ending, in every cell.** Asserted over every cell the
 * rule can produce, because the defect this replaced was a press inserted ahead of the
 * doors once the forge answered.
 */
describe("the row", () => {
  const CELLS: readonly { readonly cell: EndingCell; readonly last: string | undefined }[] = [
    { cell: "checking", last: "Checking GitHub…" },
    { cell: "merge", last: "Merge into main" },
    { cell: "archive", last: "Archive" },
    { cell: "menu", last: "" },
    { cell: "none", last: undefined },
  ]

  for (const { cell, last } of CELLS)
    it(`draws the doors first and the ending last at ${cell}`, () => {
      draw({ cell, picked: [] })
      const names = screen.getAllByRole("button").map((b) => b.textContent)
      expect(names.slice(0, 2)).toEqual(["More work on it", "Ask about it"])
      expect(names[2]).toBe(last)
      expect(names.length).toBe(last === undefined ? 2 : 3)
    })

  /** The ghost is a press that is not yet one: in place, and not pressable. */
  it("holds the ending's place with a disabled ghost while GitHub is asked", () => {
    draw({ cell: "checking", picked: [] })
    expect(screen.getByRole("button", { name: "Checking GitHub…" })).toHaveProperty(
      "disabled",
      true,
    )
  })

  it("draws the short labels on a phone", () => {
    draw({ cell: "merge", picked: [], phone: true })
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "More work",
      "Ask",
      "Merge",
    ])
    cleanup()

    draw({ cell: "checking", picked: [], phone: true })
    expect(screen.getByRole("button", { name: "Checking…" })).toBeDefined()
  })
})

/**
 * **Only the ending is loud**, over every cell. The doors never are, so a row whose ending
 * is the `⋯`, the ghost or nothing has no loud press at all.
 */
describe("which press in the row is the loud one", () => {
  const PRESSES = [
    "Merge into main",
    "Archive",
    "Checking GitHub…",
    "More work on it",
    "Ask about it",
    "More endings",
  ] as const

  /** `primary` is `bg-accent`; `quiet` is `bg-surface`, and its hover names the accent
   *  without ever filling with it — so the whole class name is what decides, never a
   *  substring of one. */
  const loud = (): readonly string[] =>
    PRESSES.filter((name) =>
      (screen.queryByRole("button", { name })?.className.split(" ") ?? []).includes("bg-accent"),
    )

  const CASES: readonly { readonly cell: EndingCell; readonly shouts: readonly string[] }[] = [
    { cell: "checking", shouts: [] },
    { cell: "merge", shouts: ["Merge into main"] },
    { cell: "archive", shouts: ["Archive"] },
    { cell: "menu", shouts: [] },
    { cell: "none", shouts: [] },
  ]

  for (const { cell, shouts } of CASES)
    it(`shouts ${shouts.join("") || "nothing"} at ${cell}`, () => {
      draw({ cell, picked: [] })
      expect(loud()).toEqual(shouts)
    })
})

describe("where Archive is drawn", () => {
  it("draws it loud in the cell where there is nothing left to decide", () => {
    draw({ cell: "archive" })
    expect(screen.getByRole("button", { name: "Archive" })).toBeDefined()
    expect(screen.queryByRole("button", { name: "More endings" })).toBeNull()
  })

  it("keeps it behind the overflow where it is a choice", () => {
    draw({ cell: "menu" })
    expect(screen.getByRole("button", { name: "More endings" })).toBeDefined()
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull()
  })

  it("says the held step never runs", () => {
    draw({ cell: "menu", merged: true, waiting: true })
    fireEvent.click(screen.getByRole("button", { name: "More endings" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive this trak" }))
    expect(screen.getByText(/The merge commit stays\./)).toBeDefined()
    expect(screen.getByText(/The step it is waiting to run never will\./)).toBeDefined()
  })
})

describe("nothing archives without the confirmation", () => {
  const pressed: string[] = []
  const RECORDING: Archiving = { ...ARCHIVING, archive: () => pressed.push("archive") }

  afterEach(() => {
    pressed.length = 0
  })

  /** The promoted press is the trigger, not the act: it opens the panel, sends nothing,
   *  and stays live — the open panel is what says it was taken. */
  it("opens the panel from the promoted press and sends nothing", () => {
    draw({
      cell: "archive",
      merged: true,
      archiving: RECORDING,
    })
    fireEvent.click(screen.getByRole("button", { name: "Archive" }))

    expect(pressed).toEqual([])
    const dialog = screen.getByRole("dialog", { name: "Archive this trak?" })
    expect(within(dialog).getByRole("button", { name: "Archive" })).toBeDefined()
    // The trigger is live, not `disabled` — a disabled crimson press paints its ink at
    // 1.47:1, and the open panel already says which press was taken.
    expect(screen.getAllByRole("button", { name: "Archive" }).length).toBe(2)
  })

  it("archives only on the panel's own press", () => {
    draw({
      cell: "archive",
      merged: true,
      archiving: RECORDING,
    })
    fireEvent.click(screen.getByRole("button", { name: "Archive" }))
    const dialog = screen.getByRole("dialog", { name: "Archive this trak?" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }))

    expect(pressed).toEqual(["archive"])
  })

  /** The promoted wrapper owns Escape the way `OverflowMenu` does for the other home —
   *  `Confirmation` takes focus and owns no key handler, so this is the container's. */
  it("shuts the promoted panel on Escape, and sends nothing", () => {
    draw({
      cell: "archive",
      merged: true,
      archiving: RECORDING,
    })
    fireEvent.click(screen.getByRole("button", { name: "Archive" }))
    const dialog = screen.getByRole("dialog", { name: "Archive this trak?" })
    fireEvent.keyDown(within(dialog).getByRole("button", { name: "Archive" }), { key: "Escape" })

    expect(screen.queryByRole("dialog")).toBeNull()
    expect(pressed).toEqual([])
  })

  it("confirms from the overflow too, on the same panel", () => {
    draw({ cell: "menu", archiving: RECORDING })
    fireEvent.click(screen.getByRole("button", { name: "More endings" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive this trak" }))

    expect(pressed).toEqual([])
    expect(screen.getByText("Archive this trak?")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Archive" }))
    expect(pressed).toEqual(["archive"])
  })

  /** The panel's one line changes with what is true of the branch — the merged sentence on
   *  a merged trak, the nothing-was-committed one on a branch that never moved, and the
   *  work-goes one on an unmerged branch with commits. */
  it("says what the press costs, per pane", () => {
    draw({
      cell: "archive",
      merged: true,
      archiving: RECORDING,
    })
    fireEvent.click(screen.getByRole("button", { name: "Archive" }))
    expect(screen.getByText(/The merge commit stays/)).toBeDefined()
    cleanup()

    draw({
      cell: "archive",
      moved: false,
      archiving: RECORDING,
    })
    fireEvent.click(screen.getByRole("button", { name: "Archive" }))
    expect(screen.getByText(/Nothing was ever committed to it/)).toBeDefined()
    cleanup()

    draw({ cell: "menu", archiving: RECORDING })
    fireEvent.click(screen.getByRole("button", { name: "More endings" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive this trak" }))
    expect(screen.getByText(/Nothing on that branch is kept/)).toBeDefined()
  })
})

/**
 * The two doors. Both presses open the same box and the difference is four strings and the
 * name on the request — so the assertions that matter are what is sent, which is the half no
 * amount of looking at the screen would catch.
 */
describe("the two doors", () => {
  const sent: { body: string | undefined; agent: string | undefined }[] = []
  const RECORDING: Changes = {
    ...CHANGES,
    what: "why did the review step reject the first attempt?",
    send: (body, agent) => sent.push({ body, agent }),
  }

  afterEach(() => {
    sent.length = 0
  })

  it("offers both presses wherever it offers either", () => {
    draw({ cell: "merge", changes: CHANGES, picked: [] })

    expect(screen.getByRole("button", { name: "More work on it" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Ask about it" })).toBeDefined()
  })

  /** Today's path, unchanged: no agent named is the composer's door, which is what every
   *  re-entry did before there was a second one. */
  it("sends no agent through the plan door", () => {
    draw({ cell: "merge", changes: RECORDING, picked: [] })
    fireEvent.click(screen.getByRole("button", { name: "More work on it" }))
    fireEvent.click(screen.getByRole("button", { name: "Send it back" }))

    expect(sent).toEqual([
      { body: "why did the review step reject the first attempt?", agent: undefined },
    ])
  })

  /** The whole of the new door: the same box, worded for a question, naming the one agent
   *  `POST /reenter` accepts. */
  it("names the agent through the ask door, and says so in the box", () => {
    draw({ cell: "merge", changes: RECORDING, picked: [] })
    fireEvent.click(screen.getByRole("button", { name: "Ask about it" }))

    expect(screen.getByText("What do you want to ask?")).toBeDefined()
    expect(screen.queryByText("What should change?")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Ask generic" }))
    expect(sent).toEqual([
      { body: "why did the review step reject the first attempt?", agent: "generic" },
    ])
  })

  /** The press you took reads as taken; the other stays live, so changing your mind is one
   *  press rather than a cancel and a re-open — and what has been ticked survives it. */
  it("disables the door that is open and leaves the other one pressable", () => {
    draw({ cell: "merge", changes: RECORDING })
    fireEvent.click(screen.getByRole("button", { name: "Ask about it" }))

    expect(screen.getByRole("button", { name: "Ask about it" })).toHaveProperty("disabled", true)
    const plan = screen.getByRole("button", { name: "More work on it" })
    expect(plan).toHaveProperty("disabled", false)

    fireEvent.click(plan)
    expect(screen.getByText("What should change?")).toBeDefined()
    expect(screen.getByRole("button", { name: "Remove verify — failing" })).toBeDefined()
  })
})

/**
 * **The forge merge**: GitHub's words for the repository's method, the `⋯` beside it, a
 * panel before anything is sent, and GitHub's refusal above the row.
 */
describe("the pull request's merge", () => {
  it("names the method in GitHub's words, loud, with Archive in the overflow beside it", () => {
    draw({ cell: "mergePull", pull: PULL, picked: [] })
    const names = screen.getAllByRole("button").map((b) => b.textContent)
    expect(names.slice(2)).toEqual(["Squash and merge", ""])
    expect(screen.getByRole("button", { name: "More endings" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Squash and merge" }).className.split(" ")).toContain(
      "bg-accent",
    )
  })

  it("draws the full press on its own line above the doors on a phone, the ⋯ in the row", () => {
    draw({ cell: "mergePull", pull: { ...THREE, method: "rebase" }, picked: [], phone: true })
    const order = [...document.querySelectorAll("button")].map(
      (b) => b.getAttribute("aria-label") ?? b.textContent,
    )
    expect(order).toEqual(["Rebase and merge", "Merge method", "More work", "Ask", "More endings"])
  })
})

describe("GitHub's verdict and the method menu", () => {
  it("draws the press disabled where GitHub blocks it, with GitHub's reason above the row", () => {
    draw({
      cell: "mergePull",
      pull: {
        ...THREE,
        verdict: {
          _tag: "Blocked",
          holds: [{ cause: "reviewRequired" }, { cause: "checks", names: ["verify"] }],
        },
      },
      picked: [],
    })
    expect(screen.getByRole("button", { name: "Squash and merge" })).toHaveProperty(
      "disabled",
      true,
    )
    expect(screen.getByText(/Required status check “verify” is failing\./).textContent).toBe(
      "Merging is blocked. At least 1 approving review is required by reviewers with write access. Required status check “verify” is failing.",
    )
    // The method can still change while the merge is blocked.
    expect(screen.getByRole("button", { name: "Merge method" })).toHaveProperty("disabled", false)
  })

  it("names a conflict as its own sentence, with no headline", () => {
    draw({
      cell: "mergePull",
      pull: { ...PULL, verdict: { _tag: "Blocked", holds: [{ cause: "conflicting" }] } },
      picked: [],
    })
    expect(screen.getByText("This branch has conflicts that must be resolved.")).toBeDefined()
    expect(screen.queryByText(/Merging is blocked/)).toBeNull()
  })

  it("holds the ghost while GitHub has not worked out whether it merges", () => {
    draw({ cell: "mergePull", pull: { ...THREE, verdict: { _tag: "Checking" } }, picked: [] })
    expect(screen.getByRole("button", { name: "Checking GitHub…" })).toBeDefined()
    expect(screen.queryByRole("button", { name: "Merge method" })).toBeNull()
  })

  it("draws no caret where the repository allows one method", () => {
    draw({ cell: "mergePull", pull: PULL, picked: [] })
    expect(screen.queryByRole("button", { name: "Merge method" })).toBeNull()
  })

  it("lists the allowed methods in GitHub's order, the picked one checked", () => {
    draw({ cell: "mergePull", pull: THREE, picked: [] })
    fireEvent.click(screen.getByRole("button", { name: "Merge method" }))
    const rows = screen.getAllByRole("menuitemradio")
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"])
    expect(rows[0]?.textContent).toContain("Create a merge commit")
    expect(rows[2]?.textContent).toContain("Rebase and merge")
  })

  it("records a picked method and merges nothing", () => {
    let merges = 0
    const { picks, methodPick } = picker()
    draw({
      cell: "mergePull",
      pull: THREE,
      pullMerging: {
        ...PULL_MERGING,
        merge: () => {
          merges += 1
        },
      },
      methodPick,
      picked: [],
    })
    fireEvent.click(screen.getByRole("button", { name: "Merge method" }))
    fireEvent.click(screen.getAllByRole("menuitemradio")[2] ?? document.body)
    expect(picks).toEqual(["rebase"])
    expect(merges).toBe(0)
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("names auto-merge's method on the line above the row", () => {
    const { autoMerge } = offer({ sentBack: 0, limit: 3 })
    draw({ cell: "mergePull", pull: { ...THREE, method: "rebase" }, picked: [], autoMerge })
    expect(
      screen.getByText("Auto-merge will rebase and merge #142 once GitHub allows it."),
    ).toBeDefined()
  })
})

describe("the pull request's merge, confirmed", () => {
  it("asks first, saying what the method does to main, and merges only on the panel's press", () => {
    let merges = 0
    draw({
      cell: "mergePull",
      pull: PULL,
      pullMerging: {
        ...PULL_MERGING,
        merge: () => {
          merges += 1
        },
      },
      picked: [],
    })
    fireEvent.click(screen.getByRole("button", { name: "Squash and merge" }))
    expect(merges).toBe(0)

    const panel = screen.getByRole("dialog", { name: "Squash and merge #142?" })
    expect(panel.textContent).toContain("The branch’s commits go into main as one commit.")
    expect(panel.textContent).toContain("The branch stays on GitHub until you archive the trak.")
    fireEvent.click(within(panel).getByRole("button", { name: "Squash" }))
    expect(merges).toBe(1)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("shuts the panel on Cancel and on Escape, and merges nothing", () => {
    let merges = 0
    const pullMerging = {
      ...PULL_MERGING,
      merge: () => {
        merges += 1
      },
    }
    draw({ cell: "mergePull", pull: PULL, pullMerging, picked: [] })
    fireEvent.click(screen.getByRole("button", { name: "Squash and merge" }))
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }))
    expect(screen.queryByRole("dialog")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Squash and merge" }))
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(merges).toBe(0)
  })

  it("reads Merging… while the forge merges", () => {
    draw({
      cell: "mergePull",
      pull: PULL,
      pullMerging: { ...PULL_MERGING, isPending: true, disabled: true },
      picked: [],
    })
    expect(screen.getByRole("button", { name: "Merging…" })).toHaveProperty("disabled", true)
  })

  it("draws GitHub's refusal above the row, and leaves the press live", () => {
    const said = "The pull request was not merged: gh exited 1: Required status check is expected."
    draw({ cell: "mergePull", pull: PULL, pullMerging: { ...PULL_MERGING, said }, picked: [] })
    expect(screen.getByRole("alert").textContent).toBe(said)
    expect(screen.getByRole("button", { name: "Squash and merge" })).toHaveProperty(
      "disabled",
      false,
    )
  })
})

/** Auto-merge on offer at `value`, recording each position asked for. */
const offer = (value: AutoMergeOffer["value"], said?: string) => {
  const asked: boolean[] = []
  const autoMerge: AutoMergeOffer = {
    value,
    setting: {
      set: (on) => {
        asked.push(on)
      },
      isPending: false,
      disabled: false,
      said,
    },
  }
  return { autoMerge, asked }
}

describe("auto-merge beside the pull request's merge", () => {
  it("stands before the merge press at desk, and asks for the other position", () => {
    const { autoMerge, asked } = offer(undefined)
    draw({ cell: "mergePull", pull: PULL, picked: [], autoMerge })

    const toggle = screen.getByRole("switch", { name: "Auto-merge" })
    expect(toggle.getAttribute("aria-checked")).toBe("false")
    // Every press in document order: the doors, then the switch, then the merge.
    const order = [...document.querySelectorAll("button")].map((b) => b.textContent)
    expect(order.slice(2, 4)).toEqual(["Auto-merge", "Squash and merge"])
    fireEvent.click(toggle)
    expect(asked).toEqual([true])
  })

  it("reads off while stopped, says why above the row, and is pressed on to start again", () => {
    const { autoMerge, asked } = offer({ sentBack: 3, limit: 3, stopped: { _tag: "Conflict" } })
    draw({ cell: "mergePull", pull: PULL, picked: [], autoMerge })

    expect(
      screen.getByText(/Auto-merge stopped after 3 sends.*Turn it on to try again\./),
    ).toBeDefined()
    fireEvent.click(screen.getByRole("switch", { name: "Auto-merge" }))
    expect(asked).toEqual([true])
  })

  it("draws a refused press's reason above the row", () => {
    const { autoMerge } = offer(undefined, "This trak’s goal does not allow auto-merge.")
    draw({ cell: "mergePull", pull: PULL, picked: [], autoMerge })

    expect(screen.getByRole("alert").textContent).toBe(
      "This trak’s goal does not allow auto-merge.",
    )
  })

  it("is drawn nowhere but beside the pull request's merge", () => {
    draw({ cell: "merge", picked: [], autoMerge: offer(undefined).autoMerge })

    expect(screen.queryByRole("switch")).toBeNull()
  })
})

describe("auto-merge on a phone", () => {
  it("leaves the row for a full-width press above the doors", () => {
    const autoMerge: AutoMergeOffer = {
      value: { sentBack: 0, limit: 3 },
      setting: { set: () => {}, isPending: false, disabled: false, said: undefined },
    }
    draw({ cell: "mergePull", pull: PULL, picked: [], autoMerge, phone: true })

    const toggle = screen.getByRole("switch", { name: "Auto-merge" })
    expect(toggle.getAttribute("aria-checked")).toBe("true")
    expect(toggle.className.split(" ")).toContain("w-full")
    const order = [...document.querySelectorAll("button")].map((b) => b.textContent)
    expect(order[0]).toBe("Auto-merge")
  })
})

/** The phone's sheet, told from the panel by its rounded top — no Tailwind is loaded here. */
const isSheet = (dialog: HTMLElement): boolean => dialog.querySelector(".rounded-t-sheet") !== null

/** On a phone every confirmation here is a sheet rising from the foot rather than a panel
 *  over the row; the panel's own rules — nothing sent before its press — hold the same. */
describe("the confirmations on a phone", () => {
  it("asks the pull request's merge in a sheet that shuts on its press, merging once", () => {
    let merges = 0
    draw({
      cell: "mergePull",
      pull: PULL,
      pullMerging: {
        ...PULL_MERGING,
        merge: () => {
          merges += 1
        },
      },
      picked: [],
      phone: true,
    })
    fireEvent.click(screen.getByRole("button", { name: "Squash and merge" }))
    const sheet = screen.getByRole("dialog", { name: "Squash and merge #142?" })
    expect(isSheet(sheet)).toBe(true)
    fireEvent.click(within(sheet).getByRole("button", { name: "Squash" }))
    expect(merges).toBe(1)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("asks the loud Archive in a sheet that stays open on a refusal", () => {
    draw({
      cell: "archive",
      merged: true,
      archiving: { ...ARCHIVING, said: "A process still holds the checkout." },
      picked: [],
      phone: true,
    })
    fireEvent.click(screen.getByRole("button", { name: "Archive" }))
    const sheet = screen.getByRole("dialog", { name: "Archive this trak?" })
    expect(isSheet(sheet)).toBe(true)
    expect(within(sheet).getByRole("alert")).toHaveTextContent(
      "A process still holds the checkout.",
    )
    fireEvent.click(sheet)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("shuts the ⋯ as its Archive asks in a sheet, and archives once on the sheet's press", () => {
    const pressed: string[] = []
    draw({
      cell: "menu",
      archiving: { ...ARCHIVING, archive: () => pressed.push("archive") },
      picked: [],
      phone: true,
    })
    fireEvent.click(screen.getByRole("button", { name: "More endings" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive this trak" }))
    expect(screen.queryByRole("menu")).toBeNull()
    const sheet = screen.getByRole("dialog", { name: "Archive this trak?" })
    expect(isSheet(sheet)).toBe(true)

    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.queryByRole("menu")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "More endings" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive this trak" }))
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }))
    expect(pressed).toEqual(["archive"])
  })
})
