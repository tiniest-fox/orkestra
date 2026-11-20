/**
 * Tier 2: the traks list below the phone breakpoint — the dock, the chevron-only rows,
 * and the spawn band lying down as a strip of worded cards.
 *
 * `matchMedia` is stubbed to answer the phone query true (`usePhone`'s documented
 * seam); the rest is `TraksListPage.test.tsx`'s setup at its smallest.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router"
import { setupServer } from "msw/node"
import { http, HttpResponse } from "msw"
import type { TrakSummaryDto } from "@orkestra/shared/dto/trak"
import { makeParent, makeTrak, makeHostGit, makeHostedProcess, makeCliUsage } from "../../fixtures"
import { routeTree } from "../../routes"

const SPAWN_ID = "cccccccc-2222-4333-8444-555555555555"

const spawn: TrakSummaryDto = makeTrak({
  id: SPAWN_ID,
  description: "review the whole client",
  title: "Review the client end to end",
  state: { _tag: "AwaitingChildren", step: 2 },
  running: true,
  instruction: "One child per lens",
})

const piece = (
  id: string,
  description: string,
  state: TrakSummaryDto["state"],
  child: number,
): TrakSummaryDto =>
  makeTrak({ id, description, state, parent: makeParent({ id: SPAWN_ID, step: 2, child }) })

const traks: readonly TrakSummaryDto[] = [
  makeTrak({
    id: "11111111-2222-4333-8444-555555555555",
    description: "add a client",
    state: { _tag: "AwaitingHuman", step: 2, kind: "approval" },
    instruction: "Draw the step card",
  }),
  spawn,
  piece(
    "aaaaaaaa-2222-4333-8444-555555555555",
    "Check the security of every route",
    {
      _tag: "AgentWorking",
      step: 0,
    },
    0,
  ),
  piece(
    "bbbbbbbb-2222-4333-8444-555555555555",
    "Check the performance of every route",
    {
      _tag: "Failed",
      kind: "provider",
      error: "the CLI exited 1",
    },
    1,
  ),
]

const server = setupServer(
  http.get("*/api/session", () => new HttpResponse(null, { status: 204 })),
  // The git bar, which every screen under the list draws.
  http.get("*/api/git", () => HttpResponse.json(makeHostGit())),
  // The git bar's usage cell: never read.
  http.get("*/api/usage", () => HttpResponse.json({ clis: [makeCliUsage()] })),
  // The project checkout's processes, which the dock draws beside the branch.
  http.get("*/api/processes", () =>
    HttpResponse.json({ processes: [makeHostedProcess({ name: "atelier", log: "ready\n" })] }),
  ),
  // The goal banner over the list, which every screen under it draws.
  http.get("*/api/goals", () => HttpResponse.json({ goals: [] })),
  http.get("*/api/traks", () => HttpResponse.json({ traks, archived: 0 })),
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

describe("the traks list on a phone", () => {
  it("carries both doors in the dock, and a row's right side is never a button", async () => {
    renderList()
    const dock = await screen.findByRole("navigation", { name: "Start a trak" })
    // One split pill, New Chat on the left and New Trak on the right — the order is the
    // seam's, so it is asserted as an order and not as two presences.
    expect(
      within(dock)
        .getAllByRole("link")
        .map((a) => a.getAttribute("href")),
    ).toEqual(["/traks/chat", "/traks/new"])
    expect(within(dock).getByRole("link", { name: "New Chat" })).toBeInTheDocument()
    expect(within(dock).getByRole("link", { name: "New Trak" })).toBeInTheDocument()

    // The row at a gate keeps its title link; its action link and its activity line are
    // the desk's, and the phone slot holds only the chevron.
    expect(await screen.findByRole("link", { name: "add a client" })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Review — add a client/ })).not.toBeInTheDocument()
  })

  it("draws a spawn's pieces as a strip of cards led by their distinguishing word", async () => {
    renderList()
    const strip = await screen.findByRole("list", {
      name: "Pieces of Review the client end to end",
    })
    const links = within(strip).getAllByRole("link")

    // Led by the word `pieceWord` cut from each piece's instruction — never the agent,
    // never a state word — and the failed piece ordered first.
    expect(links.map((link) => link.textContent)).toEqual(["the performance", "the security"])
    expect(within(strip).queryByText(/Failed/)).not.toBeInTheDocument()
  })
})

describe("the git bar on a phone", () => {
  const behind = makeHostGit({ upstream: { name: "origin/main", ahead: 0, behind: 3 } })

  it("is the usage and action tabs right of the pill, the action opening the git sheet", async () => {
    server.use(http.get("*/api/git", () => HttpResponse.json(behind)))
    renderList()
    const dock = await screen.findByRole("navigation", { name: "Start a trak" })
    // The action tab says its counts aloud and on its badge, and does not press.
    const tab = await within(dock).findByRole("button", { name: "Pull, 3 behind" })
    expect(tab).toHaveTextContent("3")
    // Beside it, the usage tab, which opens a sheet of its own.
    fireEvent.click(await within(dock).findByRole("button", { name: "Claude usage" }))
    expect(screen.getByRole("dialog", { name: "Claude usage" })).toHaveTextContent(
      "The first reading comes with the first Claude turn.",
    )
    fireEvent.click(screen.getByRole("button", { name: "Done" }))

    fireEvent.click(tab)
    const sheet = screen.getByRole("dialog", { name: "Project checkout" })
    expect(
      within(sheet)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label") ?? b.textContent),
    ).toEqual(["Pull", "Fetch"])
    // No strip at the foot: the desk's bar is not drawn on a phone.
    expect(screen.queryByRole("contentinfo", { name: "Project checkout" })).not.toBeInTheDocument()
  })

  it("raises a refused pull as a row over the band, and leaves a ! on the tab once dismissed", async () => {
    server.use(
      http.get("*/api/git", () => HttpResponse.json(behind)),
      http.post("*/api/git/pull", () =>
        HttpResponse.json({ _tag: "Dirty", files: ["M README.md"] }, { status: 409 }),
      ),
    )
    renderList()
    const dock = await screen.findByRole("navigation", { name: "Start a trak" })
    fireEvent.click(await within(dock).findByRole("button", { name: "Pull, 3 behind" }))
    const sheet = screen.getByRole("dialog", { name: "Project checkout" })
    fireEvent.click(within(sheet).getByRole("button", { name: "Pull" }))
    // The sheet says it in its card; the row rises once the sheet is shut.
    expect(
      await within(sheet).findByText("Pull refused — 1 file has uncommitted changes"),
    ).toBeInTheDocument()
    fireEvent.keyDown(sheet, { key: "Escape" })

    const notice = await within(dock).findByRole("alert")
    expect(
      within(notice).getByText("Pull refused — 1 file has uncommitted changes"),
    ).toBeInTheDocument()
    expect(within(notice).getByRole("button", { name: "Stash & pull" })).toBeEnabled()

    fireEvent.click(within(notice).getByRole("button", { name: "Dismiss" }))

    expect(within(dock).queryByRole("alert")).not.toBeInTheDocument()
    expect(within(dock).getByRole("button", { name: "Pull, refused" })).toHaveTextContent("!")
  })

  it("puts a ! on the tab for a failure nobody here pressed for, and raises no row", async () => {
    server.use(
      http.get("*/api/git", () =>
        HttpResponse.json(
          makeHostGit({ failure: { action: "fetch", message: "no route to host", at: 40 } }),
        ),
      ),
    )
    renderList()
    const dock = await screen.findByRole("navigation", { name: "Start a trak" })
    const tab = await within(dock).findByRole("button", { name: "Fetch, failed" })
    expect(tab).toHaveTextContent("!")
    expect(within(dock).queryByRole("alert")).not.toBeInTheDocument()
  })
})

describe("the project checkout's processes on a phone", () => {
  it("opens a sheet of the processes alone from their tab, and the branch opens the git card alone", async () => {
    renderList()
    const dock = await screen.findByRole("navigation", { name: "Start a trak" })
    fireEvent.click(
      await within(dock).findByRole("button", {
        name: "Project checkout's processes: none running",
      }),
    )
    const sheet = screen.getByRole("dialog", { name: "Project checkout's processes" })
    // No switch to the git card: the dock's own tabs are the way there.
    expect(within(sheet).queryByRole("tablist")).not.toBeInTheDocument()
    expect(within(sheet).queryByRole("button", { name: "Fetch" })).not.toBeInTheDocument()
    expect(within(sheet).getByRole("button", { name: "Start atelier" })).toBeEnabled()

    fireEvent.click(within(sheet).getByRole("button", { name: "Show atelier's log" }))
    expect(within(sheet).getByLabelText("atelier's log")).toHaveTextContent("ready")
    fireEvent.keyDown(sheet, { key: "Escape" })

    fireEvent.click(await within(dock).findByRole("button", { name: "Fetch" }))
    const git = screen.getByRole("dialog", { name: "Project checkout" })
    expect(within(git).queryByRole("tablist")).not.toBeInTheDocument()
    expect(within(git).queryByRole("button", { name: "Start atelier" })).not.toBeInTheDocument()
  })
})

describe("idle rows on a phone", () => {
  it("cuts a section's idle rows after one", async () => {
    const DAY = 24 * 60 * 60 * 1000
    const left = (n: number): TrakSummaryDto =>
      makeTrak({
        id: `idle-${String(n)}`,
        description: `left ${String(n)}`,
        state: { _tag: "AwaitingHuman", step: 0, kind: "approval" },
        idle: true,
        active: Date.now() - (3 + n) * DAY,
      })
    server.use(
      http.get("*/api/traks", () =>
        HttpResponse.json({ traks: [traks[0], left(1), left(2), left(3)], archived: 0 }),
      ),
    )
    renderList()

    const section = await screen.findByRole("list", { name: "Needs you" })
    expect(within(section).getByRole("link", { name: "left 1" })).toBeInTheDocument()
    expect(within(section).queryByRole("link", { name: "left 2" })).not.toBeInTheDocument()
    expect(within(section).getByRole("button", { name: "+2 more" })).toBeInTheDocument()
  })
})
