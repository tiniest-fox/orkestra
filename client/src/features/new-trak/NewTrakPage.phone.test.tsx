/**
 * Tier 2: New Trak below the phone breakpoint — the inert bands are not drawn, which is
 * the reversal the page's own docstring carries.
 *
 * `matchMedia` is stubbed to answer the phone query true (`usePhone`'s documented
 * seam); the rest is `NewTrakPage.test.tsx`'s setup at its smallest.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router"
import { setupServer } from "msw/node"
import { http, HttpResponse } from "msw"
import { makeAgent, makeHostGit, makeCliUsage } from "../../fixtures"
import { routeTree } from "../../routes"

const server = setupServer(
  http.get("*/api/session", () => new HttpResponse(null, { status: 204 })),
  // The git bar, which every screen under the list draws.
  http.get("*/api/git", () => HttpResponse.json(makeHostGit())),
  // The git bar's usage cell: never read.
  http.get("*/api/usage", () => HttpResponse.json({ clis: [makeCliUsage()] })),
  // The goal banner over the list, which every screen under it draws.
  http.get("*/api/goals", () => HttpResponse.json({ goals: [] })),
  http.get("*/api/agents", () => HttpResponse.json([makeAgent()])),
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
    history: createMemoryHistory({ initialEntries: ["/traks/new"] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe("New Trak on a phone", () => {
  it("draws no inert band: no navigator, the one-line header, a back control for the Close", async () => {
    renderPage()
    expect(await screen.findByRole("button", { name: /Compose a plan/ })).toBeInTheDocument()

    // The way out is the page's back control, on the left where the browser's was.
    expect(screen.getByRole("link", { name: "Back" })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Close" })).not.toBeInTheDocument()

    // The disabled navigator is the desk's; the phone spends its height on the pane
    // instead. The header's metadata row is the same one line at every width.
    expect(screen.queryByRole("navigation", { name: "Trak navigator" })).not.toBeInTheDocument()
    expect(screen.getByText("not started")).toBeInTheDocument()

    // Compose is the grid's first tile there, not a card over it, so the rule that
    // contrasts the two sides of the desk layout is not drawn.
    expect(screen.queryByText("or start with one agent")).not.toBeInTheDocument()

    // What remains is the working foot: the mode strip and the composer.
    expect(screen.getByRole("button", { name: /Manual/ })).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "What do you want done?" })).toBeInTheDocument()
  })
})
