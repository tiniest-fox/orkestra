import type { ExtraProps } from "react-markdown"
import { describe, expect, it } from "vitest"
import { tableOf } from "./markdownTable"

type Node = NonNullable<ExtraProps["node"]>
type Child = Node["children"][number]

const el = (tagName: string, children: readonly Child[]): Node => ({
  type: "element",
  tagName,
  properties: {},
  children: [...children],
})
const text = (value: string): Child => ({ type: "text", value })
const table = (rows: readonly (readonly Child[])[]): Node =>
  el("table", [
    el("thead", [
      el(
        "tr",
        (rows[0] ?? []).map((c) => el("th", [c])),
      ),
    ]),
    el(
      "tbody",
      rows.slice(1).map((r) =>
        el(
          "tr",
          r.map((c) => el("td", [c])),
        ),
      ),
    ),
  ])

describe("tableOf", () => {
  it("reads the head as columns, the first one leading, and keeps code spans and bold", () => {
    const config = tableOf(
      table([
        [text("Shape"), text("Lead")],
        [el("code", [text("decision")]), el("strong", [text("the decision")])],
      ]),
    )

    expect(config?.columns.map((c) => [c.head, c.lead])).toEqual([
      ["Shape", true],
      ["Lead", false],
    ])
    expect(config?.rows[0]?.cells.map((c) => c.text)).toEqual(["`decision`", "**the decision**"])
  })

  it("refuses a cell holding a link, so the table draws as a grid and keeps it", () => {
    const link = el("a", [text("here")])
    expect(tableOf(table([[text("A")], [link]]))).toBeUndefined()
  })

  it("refuses more columns than the figure lays out", () => {
    const five = ["a", "b", "c", "d", "e"].map(text)
    expect(tableOf(table([five, five]))).toBeUndefined()
  })

  // What the `table` fence refuses, refused here too: each draws as the plain grid instead.
  it("refuses a head with no rows under it, which would draw as an empty figure when narrow", () => {
    expect(tableOf(table([[text("Option"), text("Cost")]]))).toBeUndefined()
  })

  it("refuses a head left empty", () => {
    expect(
      tableOf(
        table([
          [text(""), text("Before")],
          [text("a"), text("b")],
        ]),
      ),
    ).toBeUndefined()
  })

  it("reads two columns that share a head, as the fence does", () => {
    const config = tableOf(
      table([
        [text("Notes"), text("Notes")],
        [text("a"), text("b")],
      ]),
    )
    expect(config?.columns.map((c) => c.head)).toEqual(["Notes", "Notes"])
  })
})
