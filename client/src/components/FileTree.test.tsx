/**
 * A file's reason is cut at two lines while shut, and must still be readable in full: a file
 * whose reason is cut opens even with no body, and an open file shows the reason whole.
 *
 * happy-dom lays nothing out, so every box measures 0 and nothing reads as cut. A cut is stubbed
 * here the one way the row asks for it: a note still carrying its clamp is taller inside than
 * it shows.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import type { ReactNode } from "react"
import FileTree, { type TreeFile } from "./FileTree"

const clamped = (node: Element): boolean => node.classList.contains("line-clamp-2")

beforeAll(() => {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return clamped(this) && this.textContent.includes("long") ? 48 : 0
    },
  )
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return clamped(this) ? 32 : 0
    },
  )
})
afterAll(() => {
  vi.restoreAllMocks()
})
afterEach(cleanup)

const file = (path: string, why: string, body: TreeFile["body"]): TreeFile => ({
  kind: "modified",
  path,
  oldPath: undefined,
  why,
  counts: undefined,
  missing: false,
  body,
})

/** The tree with the open path held as its navigator holds it. */
const Tree = ({ files }: { readonly files: readonly TreeFile[] }): ReactNode => {
  const [opened, setOpened] = useState<string | undefined>(undefined)
  return <FileTree files={files} narrow={false} opened={opened} onOpen={setOpened} />
}

describe("FileTree, a file's reason", () => {
  it("opens a file whose reason is cut, with no body, and shows the reason whole", async () => {
    render(<Tree files={[file("a.ts", "a long reason that runs past two lines", undefined)]} />)
    const press = screen.getByRole("button", { name: /a\.ts/ })
    const note = screen.getByText("a long reason that runs past two lines")
    expect(note.className).toContain("line-clamp-2")

    await userEvent.click(press)
    expect(press.getAttribute("aria-expanded")).toBe("true")
    expect(note.className).not.toContain("line-clamp-2")
  })

  it("offers no press on a file whose reason fits and that has nothing to open", () => {
    render(<Tree files={[file("b.ts", "short", undefined)]} />)
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("shows a reason whole while the file's body is open", async () => {
    render(<Tree files={[file("c.ts", "short", () => <p>the sketch</p>)]} />)
    await userEvent.click(screen.getByRole("button", { name: /c\.ts/ }))
    expect(screen.getByText("the sketch")).toBeDefined()
    expect(screen.getByText("short").className).not.toContain("line-clamp-2")
  })
})
