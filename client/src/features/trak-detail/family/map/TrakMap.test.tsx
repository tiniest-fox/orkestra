/**
 * Tier 2: the marks the map draws that are not the plate — a piece's ending row saying
 * its composer handed work up, and the corner badge on a held entry and an asked-for
 * compose — and the one rule it draws, over an ending at the foot and not over one a wait
 * has moved. The rows are fixtures; which rows carry what is `rows.ts`'s and is tested
 * there.
 */

import { CircleDashed, Hand } from "lucide-react"
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { makeDetail, makeWaiting } from "../../../../fixtures"
import type { Band } from "../family"
import { composeRow, endRow, stepRow, todoRow } from "../map.fixtures"
import type { MapRow } from "../rows"
import TrakMap from "./TrakMap"

afterEach(cleanup)

const parent = makeDetail({ id: "parent" })

/** Which corner the mark carrying these words sits on, read off its disc's class. */
const side = (words: string): string | undefined =>
  screen.getByText(words).parentElement?.className.match(/-(right|left)-1/)?.[1]
const child = makeDetail({ id: "child" })

const ended = (handUp: string | undefined): MapRow => ({
  ...stepRow,
  key: "end",
  at: -1,
  kind: "end",
  status: undefined,
  title: "Merged",
  caption: handUp === undefined ? "Merged" : "Merged · handed work up",
  handUp,
})

/** The parent's compose, then a spawn of one piece: a step and its ending. */
const bands = (handUp: string | undefined): readonly Band[] => [
  { spot: { key: "compose:0", row: composeRow, trak: parent }, columns: [] },
  {
    spot: { key: "step:1", row: stepRow, trak: parent },
    columns: [
      {
        id: "child",
        spots: [
          { key: "child:step:1", row: stepRow, trak: child },
          { key: "child:end", row: ended(handUp), trak: child },
        ],
      },
    ],
  },
]

describe("TrakMap", () => {
  it("marks the ending row of a piece that handed work up, in words a reader can hear", () => {
    render(<TrakMap bands={bands("the icons need building first")} onPick={() => {}} />)
    expect(screen.getByText("handed work up to the parent")).not.toBeNull()
    expect(screen.getByText("Merged · handed work up")).not.toBeNull()
  })

  it("marks nothing on a piece that handed nothing up", () => {
    render(<TrakMap bands={bands(undefined)} onPick={() => {}} />)
    expect(screen.queryByText("handed work up to the parent")).toBeNull()
  })

  it("says what a held entry is held on and that a compose was asked for, in words", () => {
    const held: MapRow = {
      ...todoRow,
      badge: { glyph: CircleDashed, tone: "working", says: "held — deployed is not met yet" },
    }
    const asked: MapRow = {
      ...composeRow,
      key: "compose:6",
      at: 6,
      kind: "recompose",
      status: "todo",
      badge: { glyph: Hand, tone: "waiting", says: "something asked for this" },
    }
    const moved: MapRow = {
      ...endRow,
      title: "Held",
      caption: "held on deployed",
      waiting: makeWaiting({ step: 5, name: "deployed" }),
    }
    const plain = (row: MapRow): Band => ({
      spot: { key: row.key, row, trak: parent },
      columns: [],
    })
    render(<TrakMap bands={[stepRow, moved, held, asked].map(plain)} onPick={() => {}} />)
    expect(screen.getByText("held — deployed is not met yet")).not.toBeNull()
    expect(screen.getByText("something asked for this")).not.toBeNull()
  })

  it("gives a settled ask the engine gated both its marks, one to each corner", () => {
    // The hand landed on the bolt's coordinates and painted it out, with both still read
    // aloud — an unattended trak whose step raised work reached it as soon as the ask ran.
    const settled: MapRow = {
      ...composeRow,
      atGate: { _tag: "Uneventful", at: 0, ambiguity: "none" },
      badge: { glyph: Hand, tone: "waiting", says: "something asked for this" },
    }
    render(
      <TrakMap
        bands={[{ spot: { key: settled.key, row: settled, trak: parent }, columns: [] }]}
        onPick={() => {}}
      />,
    )
    expect(side("automatically approved")).toBe("right")
    expect(side("something asked for this")).toBe("left")
  })

  it("draws the rule over an ending at the foot, and not over one a wait has moved", () => {
    // The one class that is the rule: *the plan stops here* is false of a row with plan
    // entries under it, so the row itself is what the assertion has to read.
    const rule = (row: MapRow): boolean => {
      cleanup()
      render(
        <TrakMap
          bands={[stepRow, row].map((r) => ({
            spot: { key: r.key, row: r, trak: parent },
            columns: [],
          }))}
          onPick={() => {}}
        />,
      )
      return (
        screen
          .getByRole("button", { name: /Held/ })
          .closest("li")
          ?.className.includes("border-dashed") ?? false
      )
    }
    expect(rule({ ...endRow, title: "Held" })).toBe(true)
    expect(rule({ ...endRow, title: "Held", waiting: makeWaiting({ step: 1 }) })).toBe(false)
  })

  it("marks a step put into an earlier conversation, in words a reader can hear", () => {
    const continued: MapRow = {
      ...stepRow,
      key: "step:2",
      at: 2,
      continues: { key: "1-experiment", to: "step:1", fresh: false },
    }
    render(
      <TrakMap
        bands={[
          { spot: { key: "step:1", row: stepRow, trak: parent }, columns: [] },
          { spot: { key: "step:2", row: continued, trak: parent }, columns: [] },
        ]}
        onPick={() => {}}
      />,
    )
    // One mark, on the continuing row alone — the row it points at carries nothing.
    expect(screen.getAllByText("continues an earlier conversation")).toHaveLength(1)
  })
})
