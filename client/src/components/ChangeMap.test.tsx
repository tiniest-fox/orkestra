/**
 * What the change map exists to get right: a rail of buckets that picks one, a file that
 * opens its lines only where a diff is behind it, and the join flagging only what the diff
 * can prove. Narrow keys on the figure's own width, which happy-dom reports as 0, so every case
 * here is the desk; the narrow layout is the proof's to show.
 *
 * Every bucket's tree is drawn, hidden but the picked one, so the queries go by role:
 * a hidden bucket is out of the accessibility tree and out of `getByRole`'s reach.
 */

import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ChangeBucket as ChangeBucketType, DiffFile } from "../format/changeMap"
import { parseChanges } from "../format/changeMap"
import ChangeMap, { MarkdownChanges, type StepDiff } from "./ChangeMap"

afterEach(cleanup)

const BUCKETS =
  parseChanges(
    [
      "## The dispatch",
      "why: Markdown sends each fence label to its figure",
      "~ client/src/components/Markdown.tsx",
      "  one branch per label",
      "+ client/src/components/ChangeMap.tsx",
      "  the figure itself",
      "## Docs",
      "why: where the figure is described",
      "~ references/glossary.md",
      "  one line",
    ].join("\n"),
  ) ?? []

const file = (path: string, over: Partial<DiffFile> = {}): DiffFile => ({
  path,
  change: "modified",
  additions: 4,
  deletions: 1,
  ...over,
})

const joined = (over: Partial<StepDiff> = {}): StepDiff => ({
  name: "step 3 · build",
  join: {
    files: [
      file("client/src/components/Markdown.tsx"),
      file("client/src/components/ChangeMap.tsx", { change: "added", additions: 90, deletions: 0 }),
      file("test/stray.ts"),
    ],
    complete: true,
  },
  omitted: undefined,
  lines: (path) => <p>lines of {path}</p>,
  ...over,
})

const draw = (diff: StepDiff | undefined): void => {
  const tree: ReactNode = <ChangeMap buckets={BUCKETS} />
  render(diff === undefined ? tree : <MarkdownChanges diff={diff}>{tree}</MarkdownChanges>)
}

/** The bucket showing — the one region the accessibility tree holds. */
const shown = () => within(screen.getByRole("region"))

const pick = async (name: RegExp): Promise<void> => {
  await userEvent.click(screen.getByRole("button", { name, pressed: false }))
}

/** A bucket named `Tests`, holding one file. */
const twin = (path: string, why: string): ChangeBucketType => ({
  name: "Tests",
  why,
  entries: [{ kind: "modified", path, oldPath: undefined, why: undefined }],
})

describe("ChangeMap, standalone", () => {
  it("rails the buckets with their reasons, the first picked and its files showing", () => {
    draw(undefined)
    const dispatch = screen.getByRole("button", { name: /The dispatch/, pressed: true })
    expect(dispatch.textContent).toContain("Markdown sends each fence label to its figure")
    expect(screen.getByRole("button", { name: /Docs/, pressed: false })).toBeDefined()
    expect(screen.getByRole("region").getAttribute("aria-label")).toBe("The dispatch")
    expect(shown().getByText("client/src/components/")).toBeDefined()
    expect(shown().getByText("Markdown.tsx")).toBeDefined()
    expect(shown().getByText("one branch per label")).toBeDefined()
  })

  it("shows the bucket a reader picks, and only that one", async () => {
    draw(undefined)
    await pick(/Docs/)
    expect(screen.getByRole("region").getAttribute("aria-label")).toBe("Docs")
    expect(shown().getByText("glossary.md")).toBeDefined()
    expect(shown().queryByText("Markdown.tsx")).toBeNull()
  })

  // `parseChanges` refuses a repeated name, so this reaches the map only from a caller that
  // builds its buckets itself — and the map must still keep the two apart.
  it("picks each of two buckets named alike, on its own", async () => {
    render(
      <ChangeMap
        buckets={[twin("a.test.ts", "the parser's cases"), twin("b.test.ts", "the figure's cases")]}
      />,
    )
    expect(shown().getByText("a.test.ts")).toBeDefined()

    await userEvent.click(screen.getByRole("button", { name: /Tests/, pressed: false }))
    expect(shown().getByText("b.test.ts")).toBeDefined()
    expect(shown().queryByText("a.test.ts")).toBeNull()
    expect(screen.getAllByRole("button", { name: /Tests/, pressed: true })).toHaveLength(1)
  })

  it("offers no press on a file, warns about nothing, and adds no bucket", () => {
    draw(undefined)
    expect(shown().queryAllByRole("button")).toHaveLength(0)
    expect(screen.queryByText("not in the diff")).toBeNull()
    expect(screen.queryByRole("button", { name: /Unexplained/ })).toBeNull()
    expect(screen.queryByText(/Joined to/)).toBeNull()
  })
})

describe("ChangeMap, joined to a step's diff", () => {
  it("opens a file's lines under its row on a press, and shuts them on a second", async () => {
    draw(joined())
    const row = shown().getByRole("button", { name: /Markdown\.tsx/ })
    await userEvent.click(row)
    expect(screen.getByText("lines of client/src/components/Markdown.tsx")).toBeDefined()
    expect(row.getAttribute("aria-expanded")).toBe("true")
    await userEvent.click(row)
    expect(screen.queryByText(/lines of/)).toBeNull()
  })

  it("counts the files and their lines in the header", () => {
    draw(joined())
    expect(screen.getByText(/^3 files/).textContent).toBe("3 files · +98 −2")
  })

  it("warns on a named path the diff lacks, and offers it no press", async () => {
    draw(joined())
    await pick(/Docs/)
    expect(shown().getByText("not in the diff")).toBeDefined()
    expect(shown().queryByRole("button", { name: /glossary/ })).toBeNull()
  })

  it("gathers the changed files nobody named into a last Unexplained bucket", async () => {
    draw(joined())
    const rail = screen.getAllByRole("button", { pressed: false })
    expect(rail.at(-1)?.textContent).toContain("Unexplained")
    await pick(/Unexplained/)
    expect(shown().getByText("stray.ts")).toBeDefined()
    expect(screen.getByText(/Joined to step 3 · build's diff · 3 files/)).toBeDefined()
  })

  it("flags nothing it cannot know where the diff was capped, and says how much was loaded", async () => {
    draw(joined({ join: { ...joined().join, complete: false }, omitted: 12 }))
    expect(screen.queryByRole("button", { name: /Unexplained/ })).toBeNull()
    await pick(/Docs/)
    expect(screen.queryByText("not in the diff")).toBeNull()
    expect(screen.getByText(/3 of 15 files loaded/)).toBeDefined()
  })

  it("hands the page the path and the desk's gutter for the lines it draws", async () => {
    const lines = vi.fn<StepDiff["lines"]>(() => undefined)
    draw(joined({ lines }))
    expect(lines).not.toHaveBeenCalled()
    await userEvent.click(shown().getByRole("button", { name: /ChangeMap\.tsx/ }))
    expect(lines).toHaveBeenLastCalledWith("client/src/components/ChangeMap.tsx", "pair")
  })
})
