/**
 * Tier 2: the desk's Files panel over the real browser state, with the files it reads
 * answered from a table — what a markdown file draws, how the Rendered | Source toggle
 * moves it, what a search hit opens on, which link presses the panel takes, and the header
 * that stays over both the tree and a file.
 */

import type { ReactNode } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import type { FileContentDto } from "../../api/types"
import FilesPanel from "./FilesPanel"
import { useFileBrowser } from "./useFileBrowser"
import type { FileReading } from "./useFileContent"

const text = (path: string, body: string): FileContentDto => ({
  _tag: "Text",
  path,
  text: body,
  lines: body.split("\n").length - 1,
})

const CONTENT: Readonly<Record<string, FileContentDto>> = {
  "README.md": text(
    "README.md",
    "# Hello\n\nRead [setup](docs/setup.md), [gone](docs/gone.md),\n[the site](https://example.com) or [below](#below).\n",
  ),
  "docs/setup.md": text("docs/setup.md", "## Setup\n\nInstall it.\n"),
  "src/a.ts": text("src/a.ts", "export const a = 1\n"),
}

const PATHS = ["README.md", "docs/setup.md", "src/a.ts"]

/** The browser as the traks list holds it, and two presses standing in for the palette. */
const Harness = (): ReactNode => {
  const browser = useFileBrowser()
  const found = browser.file === undefined ? undefined : CONTENT[browser.file.path]
  const reading: FileReading = {
    shown: found === undefined ? { _tag: "Loading" } : { _tag: "Shown", file: found },
    retry: () => {},
  }
  return (
    <>
      <button type="button" onClick={browser.toggle}>
        Files
      </button>
      <button type="button" onClick={() => browser.openFile("README.md", 3)}>
        Search hit
      </button>
      {browser.open && (
        <FilesPanel
          browser={browser}
          files={{ data: { paths: PATHS }, failed: undefined, retry: () => {} }}
          reading={reading}
          branch="main"
          onSearch={() => {}}
          hint="Ctrl K"
        />
      )}
    </>
  )
}

const panel = (): HTMLElement => screen.getByRole("dialog", { name: "Project files" })

const openFromTree = (name: string): void => {
  fireEvent.click(screen.getByRole("button", { name: "Files" }))
  fireEvent.click(within(panel()).getByRole("button", { name }))
}

const segment = (name: string): HTMLElement =>
  within(within(panel()).getByRole("group", { name: "View" })).getByRole("button", { name })

afterEach(cleanup)

describe("the Files panel on a desk", () => {
  it("opens a markdown file rendered, and the toggle switches it to source and back", () => {
    render(<Harness />)
    openFromTree("README.md")
    expect(within(panel()).getByRole("heading", { level: 1, name: "Hello" })).toBeTruthy()
    expect(segment("Rendered").getAttribute("aria-pressed")).toBe("true")

    fireEvent.click(segment("Source"))
    expect(within(panel()).queryByRole("heading", { name: "Hello" })).toBeNull()
    expect(within(panel()).getByText("# Hello")).toBeTruthy()
    expect(segment("Source").getAttribute("aria-pressed")).toBe("true")

    fireEvent.click(segment("Rendered"))
    expect(within(panel()).getByRole("heading", { level: 1, name: "Hello" })).toBeTruthy()
  })

  it("opens a search hit on the source at its line, and the next file opened rendered", () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: "Search hit" }))
    expect(within(panel()).getByRole("mark", { name: "Line 3" })).toBeTruthy()
    expect(segment("Source").getAttribute("aria-pressed")).toBe("true")

    fireEvent.click(within(panel()).getByRole("button", { name: "Back to the tree" }))
    fireEvent.click(within(panel()).getByRole("button", { name: "README.md" }))
    expect(segment("Rendered").getAttribute("aria-pressed")).toBe("true")
    expect(within(panel()).queryByRole("mark")).toBeNull()
  })

  it("opens a linked file in the tree here, and lets every other link through", () => {
    render(<Harness />)
    openFromTree("README.md")
    // `fireEvent` answers `false` when the press's default was prevented — taken here.
    expect(fireEvent.click(within(panel()).getByRole("link", { name: "the site" }))).toBe(true)
    expect(fireEvent.click(within(panel()).getByRole("link", { name: "gone" }))).toBe(true)
    expect(fireEvent.click(within(panel()).getByRole("link", { name: "below" }))).toBe(false)
    expect(within(panel()).getByRole("heading", { level: 1, name: "Hello" })).toBeTruthy()

    expect(fireEvent.click(within(panel()).getByRole("link", { name: "setup" }))).toBe(false)
    expect(within(panel()).getByRole("heading", { level: 2, name: "Setup" })).toBeTruthy()
    expect(segment("Rendered").getAttribute("aria-pressed")).toBe("true")
  })

  it("draws a file that is not markdown as its lines, with no toggle", () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: "Files" }))
    fireEvent.click(within(panel()).getByRole("button", { name: "src" }))
    fireEvent.click(within(panel()).getByRole("button", { name: "a.ts" }))
    expect(within(panel()).queryByRole("group", { name: "View" })).toBeNull()
    expect(within(panel()).getByText("1 line · ts")).toBeTruthy()
  })
})

/** The header's title and its line, read as one string per view. */
const header = (): string => {
  const band = within(panel()).getByRole("banner")
  expect(within(band).getByRole("heading", { level: 1, name: "Files" })).toBeTruthy()
  expect(within(band).getByRole("button", { name: "Search traks and files" })).toBeTruthy()
  expect(within(band).getByRole("button", { name: "Close the files" })).toBeTruthy()
  return within(band).getByText("project checkout").closest("p")?.textContent ?? ""
}

describe("the Files panel's header", () => {
  it("names the checkout, its branch and how many files, over the tree and over a file", () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: "Files" }))
    expect(header()).toBe("project checkout·main·3 files")

    fireEvent.click(within(panel()).getByRole("button", { name: "README.md" }))
    expect(header()).toBe("project checkout·main·3 files")
  })

  it("puts back on the file's band and nowhere else, and back returns to the tree", () => {
    render(<Harness />)
    openFromTree("README.md")
    const back = within(panel()).getByRole("button", { name: "Back to the tree" })
    expect(within(panel()).getByRole("banner").contains(back)).toBe(false)
    expect(within(panel()).getAllByRole("button", { name: "Close the files" })).toHaveLength(1)

    fireEvent.click(back)
    expect(within(panel()).getByRole("button", { name: "README.md" })).toBeTruthy()
    expect(within(panel()).queryByRole("button", { name: "Back to the tree" })).toBeNull()
  })

  it("shuts on Close and on Escape, from a file as from the tree", () => {
    render(<Harness />)
    openFromTree("README.md")
    fireEvent.click(within(panel()).getByRole("button", { name: "Close the files" }))
    expect(screen.queryByRole("dialog", { name: "Project files" })).toBeNull()

    openFromTree("README.md")
    fireEvent.keyDown(within(panel()).getByRole("button", { name: "Back to the tree" }), {
      key: "Escape",
    })
    expect(screen.queryByRole("dialog", { name: "Project files" })).toBeNull()
  })
})
