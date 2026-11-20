// Tier 2: the app as it is actually assembled.
//
// **This file exists because of a bug every other test in this package was structurally
// unable to see.** A page test builds its own `createRouter` around `routeTree` — which
// is right, because a page is a route component — and so none of them render `App`. The
// bar therefore had no test at all, and when it grew a `Link` while still sitting
// *beside* `<RouterProvider>` rather than inside it, `useLinkProps` read a null context
// and the whole app rendered blank. Every unit test passed; the first thing a browser
// did was throw.
//
// So the rule this pins is not about the bar. It is that **something has to render the
// composition** — the provider tree, the root route and the chrome together — because
// composition is the one thing a test of the parts cannot check.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { HttpResponse, http } from "msw"
import { setupServer } from "msw/node"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import App from "./App"
import { makeHostGit, makeOpener, makeOpeners, makeCliUsage } from "./fixtures"

const server = setupServer(
  // The gate asks first, and an engine with no passphrase says come in.
  http.get("*/api/session", () => new HttpResponse(null, { status: 204 })),
  // The git bar, which every screen under the list draws.
  http.get("*/api/git", () => HttpResponse.json(makeHostGit())),
  // The git bar's usage cell: never read.
  http.get("*/api/usage", () => HttpResponse.json({ clis: [makeCliUsage()] })),
  // The goal banner over the list, which every screen under it draws.
  http.get("*/api/goals", () => HttpResponse.json({ goals: [] })),
  http.get("*/api/traks", () => HttpResponse.json({ traks: [], archived: 0 })),
  // The project's openers, in the bar's slot once the browser is in.
  http.get("*/api/openers", () => HttpResponse.json(makeOpeners())),
  // Who the engine is, which a phone's bar names the project from.
  http.get("*/api/health", () =>
    HttpResponse.json({ cwd: "/Users/k/Repos/harbor-web", version: "0.0.0" }),
  ),
)

/** Every path the engine was asked for, so a test can say what was *not* asked. */
const asked: string[] = []
server.events.on("request:start", ({ request }) => {
  asked.push(new URL(request.url).pathname)
})

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" })
})
afterEach(() => {
  cleanup()
  server.resetHandlers()
  asked.length = 0
  vi.unstubAllGlobals()
})
afterAll(() => {
  server.close()
  vi.unstubAllGlobals()
})

/** A message from a host's page — happy-dom's window is its own parent, so it is believed. */
const fromHost = (data: unknown): void => {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", { data, origin: window.location.origin, source: window }),
    )
  })
}

const renderApp = (): void => {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <App />
    </QueryClientProvider>,
  )
}

describe("the app", () => {
  it("renders its chrome", async () => {
    renderApp()
    // The failure mode being guarded is a blank page, so the assertion is that
    // anything at all drew — the wordmark is the one thing on screen at every route.
    expect(await screen.findByText("Orkestra")).toBeInTheDocument()
  })

  it("offers a way to start a trak, as a link rather than a button", async () => {
    renderApp()
    // A link and not a button, deliberately: it *goes somewhere*, so middle-click and
    // bookmarking work. That is also precisely what needs router context — and getting
    // it wrong is what this file was written for.
    const start = await screen.findByRole("link", { name: "New Trak" })
    expect(start).toHaveAttribute("href", "/traks/new")
    // The second door, beside it: a trak that is a conversation first.
    expect(screen.getByRole("link", { name: "New Chat" })).toHaveAttribute("href", "/traks/chat")
  })

  it("draws the list under the bar", async () => {
    renderApp()
    // The engine answers with nothing, so the empty state is what should be here —
    // proving the route tree resolved rather than that the shell alone rendered.
    expect(await screen.findByText("No traks yet")).toBeInTheDocument()
  })

  it("keeps the bar and empties its slot while locked, with the login under it", async () => {
    server.use(http.get("*/api/session", () => new HttpResponse(null, { status: 401 })))
    renderApp()
    // The gate is under the router and draws the bar itself — which is the composition
    // this file exists to check. The bar's own test cannot see it, and the gate's renders
    // the slot as a bare anchor because it has no router.
    expect(await screen.findByLabelText("Passphrase")).toBeInTheDocument()
    expect(screen.getByText("Orkestra")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "New Trak" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "New Chat" })).not.toBeInTheDocument()
    expect(screen.queryByText("No traks yet")).not.toBeInTheDocument()
    // The slot's openers never mounted, so the scan behind the listing was not asked for.
    expect(asked).not.toContain("/api/openers")
  })
})

describe("the bar on a phone, with no host in front of the engine", () => {
  it("names the project under the word, with search and nothing to switch to", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.startsWith("(max-width"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }))
    renderApp()

    const bar = screen.getByRole("banner")
    expect(await within(bar).findByText("harbor-web")).toBeInTheDocument()
    expect(within(bar).getByText("Orkestra")).toBeInTheDocument()
    expect(within(bar).getByRole("button", { name: "Search traks and files" })).toBeEnabled()
    expect(within(bar).queryByRole("button", { name: /switch project/ })).toBeNull()
  })

  it("keeps its phone bar, search included, where the host's page draws no header over it", async () => {
    // A host window 640–687px wide: the page keeps its rail and no header, and the frame
    // beside it is under the breakpoint.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.startsWith("(max-width"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }))
    renderApp()
    await screen.findByText("harbor-web")

    fromHost({ type: "orkestra:header", drawn: false })

    const bar = screen.getByRole("banner")
    expect(within(bar).getByRole("button", { name: "Search traks and files" })).toBeEnabled()
  })

  it("stands its bar down at any width once the host's page says it draws the header", async () => {
    renderApp()
    expect(await screen.findByRole("link", { name: "New Trak" })).toBeInTheDocument()

    fromHost({ type: "orkestra:header", drawn: true })

    expect(screen.queryByRole("banner")).toBeNull()
    expect(screen.queryByRole("link", { name: "New Trak" })).toBeNull()
  })

  it("gives up its step over the list when the host's page hides it, and takes it back when shown", async () => {
    renderApp()
    fireEvent.click(await screen.findByRole("link", { name: "New Trak" }))
    await waitFor(() => expect(window.location.pathname).toBe("/traks/new"))
    expect(window.history.state).toMatchObject({ overList: true, __TSR_index: 1 })

    fromHost({ type: "orkestra:shown", shown: false })
    await waitFor(() =>
      expect(window.history.state).toMatchObject({ overList: false, __TSR_index: 0 }),
    )
    expect(window.location.pathname).toBe("/traks/new")

    fromHost({ type: "orkestra:shown", shown: true })
    await waitFor(() =>
      expect(window.history.state).toMatchObject({ overList: true, __TSR_index: 1 }),
    )
    expect(window.location.pathname).toBe("/traks/new")
  })

  it("does not ask who the engine is above the breakpoint", async () => {
    renderApp()

    expect(await screen.findByText("No traks yet")).toBeInTheDocument()
    expect(asked).not.toContain("/api/health")
  })
})

describe("the project's openers in the bar", () => {
  it("draws an editor and a terminal left of New Chat, and a press opens at the project", async () => {
    const opened: unknown[] = []
    server.use(
      http.post("*/api/open", async ({ request }) => {
        opened.push(await request.json())
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderApp()

    const terminal = await screen.findByRole("button", {
      name: "Open Ghostty at the project checkout",
    })
    const editor = screen.getByRole("button", { name: "Open Zed at the project checkout" })
    const chat = screen.getByRole("link", { name: "New Chat" })
    // Document order is left to right in the slot's row.
    expect(editor.compareDocumentPosition(terminal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(terminal.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(terminal)
    await waitFor(() => {
      expect(opened).toStrictEqual([{ kind: "terminal" }])
    })
  })

  it("re-asks the one listing every opener reads after a pick from the bar", async () => {
    const picked: unknown[] = []
    let listed = 0
    server.use(
      http.get("*/api/openers", () => {
        listed += 1
        return HttpResponse.json(
          makeOpeners({
            terminal: {
              apps: [makeOpener(), makeOpener({ id: "com.apple.Terminal", name: "Terminal" })],
              chosen: listed === 1 ? "com.mitchellh.ghostty" : "com.apple.Terminal",
            },
          }),
        )
      }),
      http.post("*/api/openers", async ({ request }) => {
        picked.push(await request.json())
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: "Choose a terminal" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Terminal" }))

    // The header's plate reads `queryKeys.openers` too, so this re-answer is what moves it.
    expect(
      await screen.findByRole("button", { name: "Open Terminal at the project checkout" }),
    ).toBeInTheDocument()
    expect(picked).toStrictEqual([{ kind: "terminal", id: "com.apple.Terminal" }])
  })

  it("draws neither below the phone breakpoint, and does not ask for the listing", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.startsWith("(max-width"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }))
    renderApp()

    expect(await screen.findByText("No traks yet")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /at the project checkout/ })).toBeNull()
    expect(asked).not.toContain("/api/openers")
  })
})
