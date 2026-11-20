/**
 * Tier 2, phone layout: the file browser and search as a phone reaches them — the dock's
 * Files mark opens the tree in a sheet, a file opens full screen with a back press, and
 * the top bar's glyph opens search full screen. Which branch drew, never a measurement.
 *
 * `matchMedia` answers the phone query alone, so `(pointer: coarse)` stays false.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router"
import { setupServer } from "msw/node"
import { http, HttpResponse } from "msw"
import type { FileContentDto, ProjectFilesDto } from "@orkestra/shared/dto/files"
import { makeHostGit, makeTrak, makeCliUsage } from "../../fixtures"
import { setPaletteOpen } from "../../hooks/usePalette"
import { routeTree } from "../../routes"

const FILES: ProjectFilesDto = { paths: ["README.md", "src/app/server.ts"] }

const README: FileContentDto = { _tag: "Text", path: "README.md", text: "# Hello\n", lines: 1 }

const server = setupServer(
  http.get("*/api/session", () => new HttpResponse(null, { status: 204 })),
  http.get("*/api/git", () => HttpResponse.json(makeHostGit())),
  // The git bar's usage cell: never read.
  http.get("*/api/usage", () => HttpResponse.json({ clis: [makeCliUsage()] })),
  http.get("*/api/processes", () => HttpResponse.json({ processes: [] })),
  http.get("*/api/goals", () => HttpResponse.json({ goals: [] })),
  http.get("*/api/agents", () => HttpResponse.json([])),
  http.get("*/api/traks", () =>
    HttpResponse.json({ traks: [makeTrak({ title: "A trak" })], archived: 0 }),
  ),
  http.get("*/api/files", () => HttpResponse.json(FILES)),
  http.get("*/api/files/content", () => HttpResponse.json(README)),
)

beforeAll(() => {
  vi.stubGlobal("scrollTo", () => {})
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.startsWith("(max-width"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
  server.listen({ onUnhandledRequest: "error" })
})
afterEach(() => {
  cleanup()
  server.resetHandlers()
  setPaletteOpen(false)
})
afterAll(() => {
  server.close()
  vi.unstubAllGlobals()
})

const renderList = async (): Promise<void> => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  await screen.findByRole("link", { name: "A trak" })
}

describe("the file browser on a phone", () => {
  it("opens the tree from the dock's Files mark, and a file full screen with a back press", async () => {
    await renderList()
    fireEvent.click(screen.getByRole("button", { name: "Project files" }))
    const sheet = await screen.findByRole("dialog", { name: "Project files" })
    // No search entry in the sheet: on a phone search is the top bar's alone.
    expect(within(sheet).queryByRole("button", { name: "Search traks and files" })).toBeNull()

    fireEvent.click(await within(sheet).findByRole("button", { name: "README.md" }))
    const file = await screen.findByRole("dialog", { name: "README.md" })
    expect(await within(file).findByText("# Hello")).toBeTruthy()
    // The phone draws a markdown file's lines, with no toggle to render it.
    expect(within(file).queryByRole("group", { name: "View" })).toBeNull()
    expect(screen.queryByRole("dialog", { name: "Project files" })).toBeNull()

    fireEvent.click(within(file).getByRole("button", { name: "Back to the tree" }))
    expect(await screen.findByRole("dialog", { name: "Project files" })).toBeTruthy()
  })

  it("opens search full screen from the top bar's glyph", async () => {
    await renderList()
    fireEvent.click(screen.getByRole("button", { name: "Search traks and files" }))
    const search = await screen.findByRole("dialog", { name: "Search" })
    expect(within(search).getByRole("searchbox")).toBeTruthy()
    fireEvent.click(within(search).getByRole("button", { name: "Cancel" }))
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull()
  })
})
