/**
 * What the rail draws, and the one thing about it that is not obvious from the markup.
 *
 * `TrakDetailPage.test.tsx` already covers *pressing* a mark — that is navigation, and it
 * belongs where the page decides what a press does. What is only true here is the **shape
 * of a spawn**: one block per child, one tile per that child's steps, and a count that does
 * not collapse. The property that matters most — a spawn costs the rail nothing in width
 * whatever its shape — is invisible to a test, so what is asserted instead is the thing
 * that would have to break first: the tiles being per-step rather than per-child.
 */

import { cleanup, render, screen, within } from "@testing-library/react"
import { Hammer } from "lucide-react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { TrakDetailDto } from "../../../../api/types"
import {
  makeAgentReturned,
  makeAgentStep,
  makeChildrenSpawned,
  makeComposerReturned,
  makeDetail,
  makeTrakCreated,
} from "../../../../fixtures"
import { type Band, type Column, familyBands, type Spot } from "../family"
import type { MapRow } from "../rows"
import TrakRail from "./TrakRail"

/** No wait on any trak here, so any instant does. */
const NOW = 0

afterEach(cleanup)

/**
 * The trak every spot points at.
 *
 * The rail never reads it — a spot carries it so the *pane* can ask the right log for a
 * piece's turns — but it is built for real rather than asserted past, because a fixture
 * that lies about its own type is a fixture that stops matching the wire without saying so.
 * `family.test.ts` builds one the same way.
 */
const TRAK: TrakDetailDto = makeDetail({
  id: "t",
  description: "Add a rail to the drawer",
  state: { _tag: "Finished" },
})

/** The rail reads a key and six fields of a row. */
const spot = (key: string, title: string, over: Partial<MapRow> = {}): Spot => {
  const row: MapRow = {
    key,
    at: 0,
    kind: "step",
    status: "done",
    tone: "good",
    mark: Hammer,
    title,
    caption: `${title} ran`,
    pieces: undefined,
    sha: undefined,
    turns: [],
    atGate: undefined,
    handUp: undefined,
    outstanding: 0,
    continues: undefined,
    model: undefined,
    window: undefined,
    effort: undefined,
    badge: undefined,
    waiting: undefined,
    ...over,
  }
  return { key, row, trak: TRAK }
}

const column = (id: string, ...titles: readonly string[]): Column => ({
  id,
  spots: titles.map((t) => spot(`${id}:${t}`, t)),
})

// No return annotations on either: `within` and `render` are generic over their query sets,
// so naming a type here collapses both to `any` and the type-aware lint objects at every
// call. Inference keeps the bound queries.
const draw = (bands: readonly Band[], at?: string): void => {
  render(<TrakRail bands={bands} at={at} onPick={vi.fn<(key: string) => void>()} />)
}

const positions = () => within(screen.getByRole("list", { name: "Positions" }))

describe("TrakRail", () => {
  // **The one thing on the rail that only a screen reader gets.** Inside a trak, how a
  // position is going is the square's colour and the segment travelling its edge and
  // nothing else — the glyph belongs to the agent now — so the press is where that fact
  // lives, and a change that drops it makes the rail unreadable without colour.
  it("names how every position is going, at full size and at a piece's 14px tile", () => {
    draw([
      { spot: spot("step:0", "review", { status: "gate", tone: "waiting" }), columns: [] },
      {
        spot: spot("step:1", "2 pieces"),
        columns: [
          { id: "c1", spots: [spot("c1:build", "build", { status: "running", tone: "working" })] },
        ],
      },
    ])

    expect(
      positions().getByRole("button", { name: "review — review ran — waiting for you" }),
    ).toBeDefined()
    expect(positions().getByRole("button", { name: "build — build ran — running" })).toBeDefined()
  })

  // The tile wears its step's agent, exactly as the full-size square beside it does — the
  // status is the plate's colour and its segment, and a mark that changed with the status
  // was that fact drawn twice at 14px. Asserted by class for `TrakMark.test.tsx`'s reason:
  // the glyph is `aria-hidden`, and `lucide-<name>` is the drawn identity.
  it("draws a piece's tile as its step's agent at every status, done included", () => {
    const statuses: readonly MapRow["status"][] = ["done", "running", "gate", "failed", "todo"]
    draw([
      {
        spot: spot("step:1", "2 pieces"),
        columns: [
          {
            id: "c1",
            spots: statuses.map((status) =>
              spot(`c1:${String(status)}`, `build ${String(status)}`, { status }),
            ),
          },
        ],
      },
    ])

    for (const status of statuses) {
      const tile = positions().getByRole("button", {
        name: new RegExp(`^build ${String(status)} — `, "u"),
      })
      expect(tile.querySelector(".lucide-hammer")).not.toBeNull()
      expect(tile.querySelector(".lucide-check")).toBeNull()
    }
  })

  it("draws one mark per plan entry, named so a reader knows what it is", () => {
    draw([
      { spot: spot("compose:0", "composer"), columns: [] },
      { spot: spot("step:1", "builder"), columns: [] },
    ])

    expect(positions().getAllByRole("button")).toHaveLength(2)
    expect(
      positions().getByRole("button", { name: "composer — composer ran — done" }),
    ).toBeDefined()
  })

  it("wraps children two abreast, so a third starts a new row", () => {
    // The rule the user's own sketch settled: a child is a column, two columns sit side by
    // side, and the pair wraps — so the rail's width does not move with the piece count.
    // Three children are two rows, which is what the divider count says.
    draw([
      {
        spot: spot("step:2", "3 pieces"),
        columns: [column("c1", "build"), column("c2", "build"), column("c3", "build")],
      },
    ])

    expect(positions().getAllByRole("button")).toHaveLength(3)
    // Two vertical rules — one per row, including the row holding a lone child — and one
    // horizontal between the rows. A lone child keeps its divider so the grid stays aligned.
    expect(positions().getByRole("listitem").querySelectorAll("span[aria-hidden]")).toHaveLength(3)
  })

  it("draws a tile per step of every piece, not one per piece", () => {
    // Four children holding six positions between them are six tiles. A cell that collapsed
    // a child to one mark would pass a count of four here and could never say how far any
    // piece had got.
    draw([
      {
        spot: spot("step:2", "2 pieces"),
        columns: [column("c1", "build", "review"), column("c2", "build")],
      },
    ])

    expect(positions().getAllByRole("button")).toHaveLength(3)
    expect(positions().getByRole("button", { name: "review — review ran — done" })).toBeDefined()
  })

  it("marks the position it was given, and only that one", () => {
    draw(
      [
        { spot: spot("step:0", "planner"), columns: [] },
        { spot: spot("step:1", "builder"), columns: [] },
      ],
      "step:1",
    )

    // `aria-current` rather than a class: it is what the scroll-into-view finds the live
    // mark by, so a change that dropped it would strand a long plan silently.
    const current = positions().getAllByRole("button", { current: "step" })
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveAccessibleName("builder — builder ran — done")
  })

  it("marks a piece's step when the position is inside a spawn", () => {
    draw(
      [{ spot: spot("step:2", "2 pieces"), columns: [column("c1", "build", "review")] }],
      "c1:review",
    )

    expect(positions().getAllByRole("button", { current: "step" })).toHaveLength(1)
  })
})

/**
 * A spawn column whose last spot is an ending, which every other case here lacks.
 *
 * Its own block because it is about a different property from the ones above — not the
 * shape of a spawn, but what a position with no `StepStatus` is *called* — and because
 * building the row through `familyBands` needs a parent and a piece rather than the
 * hand-made spots the rest of the file uses.
 */
describe("TrakRail, on a column that ends on a merged piece", () => {
  /**
   * **A column can end on a row that has no `StepStatus` at all**, and this is the only
   * place that shape is drawn at 14px.
   *
   * A piece that has landed gets an ending row — the position it is merged *from* — and
   * `endRow` gives it no status by construction, because a `StepStatus` says how an entry
   * went and the ending is not one. The tile used to coerce that absence to `todo` and
   * announce a merged piece as **not started**: the one channel that compensates for the
   * status glyph leaving the square, saying the opposite of the truth.
   *
   * Built through `familyBands` rather than by hand, which is what makes it a regression
   * test rather than a restatement: it asserts the engine's own row for a merged piece,
   * as the rail actually receives it. Every other spawn case here holds steps only, which
   * is why the whole class went untested.
   */
  it("names a merged piece's ending tile without a status word", () => {
    const parent = makeDetail({
      id: "p",
      description: "Add a read-only client",
      state: { _tag: "AwaitingChildren", step: 1 },
      plan: {
        title: "Add a read-only client",
        steps: [
          { type: "compose" },
          {
            type: "spawn",
            instruction: "build both halves",
            children: [[{ agent: "builder", instruction: "the band in the list" }]],
          },
        ],
      },
      log: [
        makeTrakCreated({ description: "Add a read-only client" }),
        makeComposerReturned({
          sessionId: "s-plan",
          output: { type: "proposal", title: "Add a read-only client", steps: [] },
        }),
        makeChildrenSpawned({ step: 1, ids: ["c1"] }),
      ],
    })
    const merged: TrakDetailDto = makeDetail({
      id: "c1",
      description: "the band",
      state: { _tag: "Merged", sha: "9f31c07" },
      plan: { title: "c1", steps: [makeAgentStep({ agent: "builder", instruction: "the band" })] },
      log: [
        makeTrakCreated({ description: "c1" }),
        makeAgentReturned({ step: 0, sessionId: "c1-0" }),
      ],
    })

    const bands = familyBands(parent, new Map([["c1", merged]]), [], NOW)
    const ending = bands[1]?.columns[0]?.spots.at(-1)
    // The row this is about, named so a failure says which shape stopped being produced
    // rather than only that a label changed.
    expect(ending?.key).toBe("c1:end")
    expect(ending?.row.status).toBeUndefined()

    draw(bands)

    const tile = positions().getByRole("button", { name: /^Merged/u })
    expect(tile).toHaveAccessibleName(`Merged — ${ending?.row.caption ?? ""}`)
    // The words the coercion used to add. Asserted by absence as well as by the whole
    // name, because a future `— done` would pass a prefix match and still be a lie.
    expect(tile.getAttribute("aria-label")).not.toContain("not started")
  })
})
