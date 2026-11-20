/**
 * Tier 2: a goal below the phone breakpoint — the drawer is the whole screen, so the way
 * out is Back on the left rather than Close, as on a trak.
 *
 * `matchMedia` answers the phone query true and nothing else (`usePhone`'s seam).
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { HttpResponse, http } from "msw"
import { setupServer } from "msw/node"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { makeGoal, makeGoalDetail, makeHostGit, makeCliUsage } from "../../fixtures"
import { routeTree } from "../../routes"

const detail = makeGoalDetail({ goal: makeGoal({ id: "g1" }) })

const DRAFT = {
  file: "search-everywhere",
  title: "Search everywhere",
  line: "Find any trak by typing",
  finished: "One box finds every trak.",
  limits: { parallel: 2 },
}

const drafting = makeGoalDetail({
  goal: makeGoal({
    id: "g2",
    file: undefined,
    state: { _tag: "AtGate", gate: "file" },
    offers: ["Approve", "Chat"],
    draft: DRAFT,
  }),
  log: [{ _tag: "GoalDrafted", call: "d1", draft: DRAFT }],
})

const server = setupServer(
  http.get("*/api/session", () => new HttpResponse(null, { status: 204 })),
  http.get("*/api/git", () => HttpResponse.json(makeHostGit())),
  // The git bar's usage cell: never read.
  http.get("*/api/usage", () => HttpResponse.json({ clis: [makeCliUsage()] })),
  http.get("*/api/agents", () => HttpResponse.json([])),
  http.get("*/api/traks", () => HttpResponse.json({ traks: [], archived: 0 })),
  http.get("*/api/goals", () => HttpResponse.json({ goals: [detail.goal] })),
  http.get("*/api/goals/g1", () => HttpResponse.json(detail)),
  http.get("*/api/goals/g2", () => HttpResponse.json(drafting)),
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

const renderAt = (path: string): void => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe("a goal on a phone", () => {
  it("leaves by Back, and draws no Close", async () => {
    renderAt("/goals/g1")
    expect(await screen.findByRole("link", { name: "Back" })).toHaveAttribute("href", "/")
    expect(screen.queryByRole("link", { name: "Close" })).toBeNull()
  })
})

describe("a goal's Drop on a phone", () => {
  /** The sheet is the screen's, drawn last: inside the header it would be painted under
   *  every later band of the drawer. */
  it("shuts the menu and asks in a sheet drawn outside the header", async () => {
    renderAt("/goals/g1")
    fireEvent.click(await screen.findByRole("button", { name: "Goal options" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Drop this goal" }))

    expect(screen.queryByRole("menu")).toBeNull()
    const sheet = screen.getByRole("dialog", { name: "Drop this goal?" })
    expect(sheet.querySelector(".rounded-t-sheet")).not.toBeNull()
    expect(sheet.closest("header")).toBeNull()
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }))
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

describe("a goal at a gate on a phone", () => {
  it("opens on Chat, where the gate's card is", async () => {
    renderAt("/goals/g2")
    expect(await screen.findByRole("region", { name: "Approve the goal file" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Chat · 1" })).toHaveAttribute("aria-current")
  })
})

describe("a goal's settings on a phone", () => {
  it("draws the drafted file's summary line, and Edit opens the strips in a sheet", async () => {
    renderAt("/goals/g2")
    const card = await screen.findByRole("region", { name: "Approve the goal file" })
    expect(within(card).getByText("2 at once")).toBeInTheDocument()
    expect(within(card).queryByRole("group", { name: "Modes" })).toBeNull()
    await userEvent.click(within(card).getByRole("button", { name: "Edit limits and modes" }))
    const sheet = screen.getByRole("dialog", { name: "Limits and modes" })
    expect(within(sheet).getByRole("group", { name: "Modes" })).toBeInTheDocument()
    expect(
      within(sheet).getByText("Written into the file when you approve it."),
    ).toBeInTheDocument()
  })

  it("draws a running goal's strips on its Goal tab, with no Edit and no sheet", async () => {
    renderAt("/goals/g1")
    await userEvent.click(await screen.findByRole("button", { name: "Goal" }))
    expect(screen.getByRole("group", { name: "Modes" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Edit limits and modes" })).toBeNull()
    expect(screen.queryByRole("dialog", { name: "Limits and modes" })).toBeNull()
  })
})
