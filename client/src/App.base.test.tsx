// Tier 2: the whole app opened at a trak's address, with no prefix and under one.
//
// **Each case loads the app afresh**, because the router reads the page's `<base>` once,
// when `routes.ts` is evaluated. So a case writes the tag and the address first, resets
// the module registry, and imports React, the testing library and `App` together — one
// copy of React between them, or every hook throws. That is also why nothing here is a
// static import of the app's own code.
//
// The `<base>` stands in for what a host writes into `index.html` as it forwards it; see
// `base.ts`.

import { HttpResponse, http } from "msw"
import { setupServer } from "msw/node"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { makeDetail, makeHostGit, makePlan, makeCliUsage } from "./fixtures"

const ID = "11111111-2222-4333-8444-555555555555"
const TITLE = "Serve the client under a prefix"

const server = setupServer(
  http.get("*/api/session", () => new HttpResponse(null, { status: 204 })),
  http.get("*/api/git", () => HttpResponse.json(makeHostGit())),
  // The git bar's usage cell: never read.
  http.get("*/api/usage", () => HttpResponse.json({ clis: [makeCliUsage()] })),
  http.get("*/api/goals", () => HttpResponse.json({ goals: [] })),
  http.get("*/api/traks", () => HttpResponse.json({ traks: [], archived: 0 })),
  http.get("*/api/openers", () => new HttpResponse(null, { status: 204 })),
  http.get("*/api/traks/:id", () =>
    HttpResponse.json(makeDetail({ id: ID, plan: makePlan({ title: TITLE }) })),
  ),
  http.get("*/api/traks/:id/processes", () => HttpResponse.json({ processes: [] })),
)

/** Every path the engine was asked for. */
const asked: string[] = []

/** The open case's unmount, run after every case — a case that timed out never reaches its own. */
let unmount = (): void => {}

/**
 * Above the config's 15s: each case evaluates the whole app afresh, which alone takes most
 * of ten seconds, and under the full suite's load it ran past 15s. The case then left its
 * app mounted, and the next case found two of everything.
 */
const COLD_IMPORT_MS = 60_000
server.events.on("request:start", ({ request }) => {
  asked.push(new URL(request.url).pathname)
})

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" })
})
afterEach(() => {
  unmount()
  unmount = () => {}
  server.resetHandlers()
  asked.length = 0
  document.head.querySelector("base")?.remove()
  window.history.replaceState(null, "", "/")
})
afterAll(() => {
  server.close()
  vi.unstubAllGlobals()
})

/** Opens the app at `path` under `<base href={base}>`, and returns what to query it with. */
const openAt = async (base: string, path: string) => {
  const tag = document.createElement("base")
  tag.href = base
  document.head.prepend(tag)
  window.history.replaceState(null, "", path)
  vi.resetModules()
  const React = await import("react")
  const rtl = await import("@testing-library/react")
  const query = await import("@tanstack/react-query")
  const { default: App } = await import("./App")
  rtl.render(
    React.createElement(
      query.QueryClientProvider,
      { client: new query.QueryClient({ defaultOptions: { queries: { retry: false } } }) },
      React.createElement(App),
    ),
  )
  unmount = rtl.cleanup
  return rtl
}

describe("the app with no prefix", () => {
  it(
    "opens the drawer at /traks/<id>, asking the engine at /api/",
    async () => {
      const { screen } = await openAt("/", `/traks/${ID}`)
      expect(await screen.findByRole("heading", { name: TITLE })).toBeInTheDocument()
      expect(screen.getByRole("link", { name: "New Trak" })).toHaveAttribute("href", "/traks/new")
      expect(asked).toContain(`/api/traks/${ID}`)
      expect(asked.every((p) => p.startsWith("/api/"))).toBe(true)
    },
    COLD_IMPORT_MS,
  )
})

describe("the app under /p/x/", () => {
  it(
    "opens the drawer at /p/x/traks/<id>, asking the engine at /p/x/api/",
    async () => {
      const { screen } = await openAt("/p/x/", `/p/x/traks/${ID}`)
      expect(await screen.findByRole("heading", { name: TITLE })).toBeInTheDocument()
      expect(screen.getByRole("link", { name: "New Trak" })).toHaveAttribute(
        "href",
        "/p/x/traks/new",
      )
      expect(asked).toContain(`/p/x/api/traks/${ID}`)
      expect(asked.every((p) => p.startsWith("/p/x/api/"))).toBe(true)
    },
    COLD_IMPORT_MS,
  )
})
