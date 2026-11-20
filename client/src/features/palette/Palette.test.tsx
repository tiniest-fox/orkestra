/**
 * Tier 2: the ⌘K palette and the Files panel it opens, on the real traks list against
 * MSW — the real hooks and the real transport, so what is asserted is what a person
 * pressing ⌘K would see.
 *
 * The two things the palette exists to get right: the sections come in their order —
 * live traks, put-away traks, files by path, lines in files — and a press on a line opens
 * that file in the panel at that line.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router"
import { setupServer } from "msw/node"
import { http, HttpResponse } from "msw"
import type { FileContentDto, FileSearchDto, ProjectFilesDto } from "@orkestra/shared/dto/files"
import type { ArchivedTrakListDto } from "@orkestra/shared/dto/trak"
import { makeHostGit, makeListing, makeTrak, makeCliUsage } from "../../fixtures"
import { setPaletteOpen } from "../../hooks/usePalette"
import { routeTree } from "../../routes"

const LIVE = makeTrak({ id: "bold-amber-lynx", title: "Let decide retry once" })

const ARCHIVED: ArchivedTrakListDto = {
  traks: [{ id: "quiet-teal-heron", title: "Move decide into its own file" }],
}

const FILES: ProjectFilesDto = {
  paths: ["README.md", "src/workflow/decide.ts", "src/app/server.ts"],
}

const SEARCH: FileSearchDto = {
  matches: [{ path: "src/app/server.ts", line: 3, text: "  // decide, uncommitted" }],
  cut: false,
}

const SERVER_TS: FileContentDto = {
  _tag: "Text",
  path: "src/app/server.ts",
  text: "import x\n\n  // decide, uncommitted\nexport {}\n",
  lines: 4,
}

const server = setupServer(
  http.get("*/api/session", () => new HttpResponse(null, { status: 204 })),
  http.get("*/api/git", () => HttpResponse.json(makeHostGit())),
  // The git bar's usage cell: never read.
  http.get("*/api/usage", () => HttpResponse.json({ clis: [makeCliUsage()] })),
  http.get("*/api/processes", () => HttpResponse.json({ processes: [] })),
  http.get("*/api/goals", () => HttpResponse.json({ goals: [] })),
  http.get("*/api/openers", () => new HttpResponse(null, { status: 204 })),
  http.get("*/api/agents", () => HttpResponse.json([])),
  http.get("*/api/traks", () => HttpResponse.json({ traks: [LIVE], archived: 1 })),
  http.get("*/api/files", () => HttpResponse.json(FILES)),
  http.get("*/api/files/search", ({ request }) =>
    new URL(request.url).searchParams.get("q") === "decide"
      ? HttpResponse.json(SEARCH)
      : HttpResponse.json({ matches: [], cut: false }),
  ),
  http.get("*/api/traks/archived", ({ request }) =>
    new URL(request.url).searchParams.get("q") === "decide"
      ? HttpResponse.json(ARCHIVED)
      : HttpResponse.json({ traks: [] }),
  ),
  http.get("*/api/files/content", ({ request }) =>
    new URL(request.url).searchParams.get("path") === SERVER_TS.path
      ? HttpResponse.json(SERVER_TS)
      : new HttpResponse(null, { status: 404 }),
  ),
)

beforeAll(() => {
  vi.stubGlobal("scrollTo", () => {})
  server.listen({ onUnhandledRequest: "error" })
})
afterEach(() => {
  cleanup()
  server.resetHandlers()
  // The flag is the tab's, outside React, so one test's open palette would be the next's.
  setPaletteOpen(false)
})
afterAll(() => {
  server.close()
  vi.unstubAllGlobals()
})

const renderList = (): void => {
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
}

/** ⌘K, then the query typed into the field it opens. */
const search = async (query: string): Promise<HTMLElement> => {
  await screen.findByRole("link", { name: LIVE.title })
  // happy-dom names a Linux platform, so the chord is Ctrl K — the one the top bar's hint spells.
  expect(screen.getByRole("button", { name: "Search traks and files" }).textContent).toContain(
    "Ctrl K",
  )
  fireEvent.keyDown(window, { key: "k", ctrlKey: true })
  const palette = await screen.findByRole("dialog", { name: "Search" })
  fireEvent.change(within(palette).getByRole("searchbox"), { target: { value: query } })
  return palette
}

describe("the ⌘K palette", () => {
  it("finds a live trak, a put-away trak, a file by path and an uncommitted line, in that order", async () => {
    renderList()
    const palette = await search("decide")
    await within(palette).findByRole("button", { name: "src/app/server.ts, line 3" })

    expect(
      within(palette)
        .getAllByRole("region")
        .map((section) => section.getAttribute("aria-label")),
    ).toStrictEqual(["Traks", "Files", "In files"])
    const traks = within(within(palette).getByRole("region", { name: "Traks" })).getAllByRole(
      "link",
    )
    expect(traks.map((link) => link.textContent)).toStrictEqual([
      "Let decide retry once",
      "Move decide into its own file",
    ])
    expect(
      within(within(palette).getByRole("region", { name: "Files" }))
        .getAllByRole("button")
        .map((row) => row.getAttribute("aria-label")),
    ).toStrictEqual(["src/workflow/decide.ts"])
  })

  it("opens a matching line's file in the Files panel, at that line, highlighted", async () => {
    renderList()
    const palette = await search("decide")
    fireEvent.click(
      await within(palette).findByRole("button", { name: "src/app/server.ts, line 3" }),
    )

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull()
    })
    const panel = screen.getByRole("dialog", { name: "Project files" })
    const hit = await within(panel).findByRole("mark", { name: "Line 3" })
    expect(hit.textContent).toContain("// decide, uncommitted")
    expect(within(panel).getByText("4 lines · ts")).toBeTruthy()
  })

  it("says what it searched when nothing matches", async () => {
    renderList()
    const palette = await search("frobnicate")
    expect((await within(palette).findByText(/Nothing matches/)).textContent).toBe(
      "Nothing matches frobnicate in 2 traks or 3 files.",
    )
  })

  /**
   * A finished result's *Archive* draws its panel outside the palette, on the page's body,
   * and React still carries the panel's events up through the palette — which shuts on a
   * click in its list and on Escape. Neither may reach it.
   */
  it("asks to archive a finished result without shutting the palette", async () => {
    const finished = makeTrak({
      ...LIVE,
      state: { _tag: "Finished" },
      branch: `trak/${LIVE.id}`,
    })
    server.use(
      http.get("*/api/traks", () => HttpResponse.json({ traks: [finished], archived: 1 })),
      // The forge's answer, which a finished row is held for: no pull request on it.
      http.get("*/api/pull-requests", () =>
        HttpResponse.json(makeListing({ entries: [{ branch: `trak/${LIVE.id}` }] })),
      ),
    )
    renderList()
    const palette = await search("decide")
    fireEvent.click(
      await within(palette).findByRole("button", { name: `Archive — ${String(LIVE.title)}` }),
    )
    const panel = screen.getByRole("dialog", { name: "Archive this trak?" })
    // The palette does not ask the forge, so the line is the one true whether or not the
    // branch went in — never *Nothing on that branch is kept*, false of a merged trak.
    expect(within(panel).getByText(/Only what was merged from it stays\./)).toBeTruthy()
    expect(within(panel).queryByText(/Nothing on that branch is kept/)).toBeNull()

    fireEvent.keyDown(panel, { key: "Escape" })
    expect(screen.queryByRole("dialog", { name: "Archive this trak?" })).toBeNull()
    expect(screen.getByRole("dialog", { name: "Search" })).toBeTruthy()
  })
})
