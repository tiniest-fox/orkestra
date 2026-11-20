/**
 * Tier 2: New Chat below the phone breakpoint — the inert bands are not drawn, the same
 * reversal `NewTrakPage.phone.test.tsx` holds for the screen this one is cut from.
 *
 * `matchMedia` is stubbed to answer the phone query true (`usePhone`'s documented seam);
 * the rest is `NewChatPage.test.tsx`'s setup at its smallest. The chat bar is the point:
 * with the navigator and the rail gone, the foot is the whole of what this screen is for.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router"
import { setupServer } from "msw/node"
import { http, HttpResponse } from "msw"
import { makeModels, makeHostGit, makeCliUsage } from "../../fixtures"
import { routeTree } from "../../routes"

const server = setupServer(
  http.get("*/api/session", () => new HttpResponse(null, { status: 204 })),
  // The git bar, which every screen under the list draws.
  http.get("*/api/git", () => HttpResponse.json(makeHostGit())),
  // The git bar's usage cell: never read.
  http.get("*/api/usage", () => HttpResponse.json({ clis: [makeCliUsage()] })),
  // The goal banner over the list, which every screen under it draws.
  http.get("*/api/goals", () => HttpResponse.json({ goals: [] })),
  http.get("*/api/models", () => HttpResponse.json(makeModels())),
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

const renderPage = (): void => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/traks/chat"] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe("New Chat on a phone", () => {
  it("draws no inert band: no navigator, the one-line header, a back control for the Close", async () => {
    renderPage()
    const field = await screen.findByRole("textbox", { name: "What do you want to know?" })

    // The way out is the page's back control, on the left where the browser's was.
    expect(screen.getByRole("link", { name: "Back" })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Close" })).not.toBeInTheDocument()

    // The disabled navigator is the desk's; the phone spends its height on the pane
    // instead. The header's metadata row is the same one line at every width.
    expect(screen.queryByRole("navigation", { name: "Trak navigator" })).not.toBeInTheDocument()
    expect(screen.getByText("not started")).toBeInTheDocument()

    // What remains is the working foot, and the cursor is still in it — the whole point
    // of this door is that the first thing you do is type, phone or desk.
    expect(field).toHaveFocus()
    expect(screen.getByRole("button", { name: "Start chat" })).toBeInTheDocument()

    // The picker is pane content and is drawn here too — no band above the bar at either
    // width, and no `usePhone` branch. Two across is a class, which only tier 3 can see.
    const picker = await screen.findByRole("group", { name: "Which model answers" })
    expect(within(picker).getAllByRole("button")).toHaveLength(5)
  })
})
