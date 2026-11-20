/**
 * Tier 2: the side panel on the trak's screen, through the real route — the opener in the
 * header, the panel it opens, the presses inside it, and which way the page is drawn.
 *
 * The page's own cases are `TrakDetailPage.test.tsx`; this file is the setup at its
 * smallest plus a process route.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router"
import { setupServer } from "msw/node"
import { http, HttpResponse } from "msw"
import type { PageBridge } from "@orkestra/shared/page"
import type { HostedProcessDto, TrakDetailDto } from "@orkestra/shared/dto/trak"
import {
  makeAgentReturned,
  makeAgentStep,
  makeArtifact,
  makeComposeEntry,
  makeDetail,
  makeHostedProcess,
  makeHumanActed,
  makePlan,
  makePullRequest,
  makeTrak,
  makeSession,
  makeSpawned,
  makeText,
  makeTrakCreated,
  makeWorkCommitted,
  makeWorktree,
  makeHostGit,
  makeCliUsage,
} from "../../../fixtures"
import { routeTree } from "../../../routes"

const ID = "11111111-2222-4333-8444-555555555555"

const server = setupServer(
  http.get("*/api/session", () => new HttpResponse(null, { status: 204 })),
  // The git bar, which every screen under the list draws.
  http.get("*/api/git", () => HttpResponse.json(makeHostGit())),
  // The git bar's usage cell: never read.
  http.get("*/api/usage", () => HttpResponse.json({ clis: [makeCliUsage()] })),
  // The goal banner over the list, which every screen under it draws.
  http.get("*/api/goals", () => HttpResponse.json({ goals: [] })),
  http.get("*/api/agents", () => HttpResponse.json([])),
  http.get("*/api/openers", () => new HttpResponse(null, { status: 204 })),
)

beforeAll(() => {
  vi.stubGlobal("scrollTo", () => {})
  server.listen({ onUnhandledRequest: "error" })
})
afterEach(() => {
  cleanup()
  server.resetHandlers()
  delete window.orkestraPage
})
afterAll(() => {
  server.close()
  vi.unstubAllGlobals()
})

const detail: TrakDetailDto = makeDetail({
  id: ID,
  state: { _tag: "AgentWorking", step: 1 },
  plan: makePlan({
    title: "Show the discount line",
    steps: [makeComposeEntry(), makeAgentStep({ agent: "builder", instruction: "build it" })],
  }),
  log: [makeTrakCreated()],
  worktree: makeWorktree(),
})

const RUNNING = makeHostedProcess({
  name: "dev",
  run: 1,
  log: "VITE ready in 412 ms\n",
  chunks: 1,
  state: {
    _tag: "Running",
    port: 47213,
    startedAt: 1_000,
    readyAt: 2_000,
    url: "http://[::1]:47213/",
  },
})

const API = makeHostedProcess({ name: "api", page: false })

const serving = (processes: readonly HostedProcessDto[]) => [
  http.get(`*/api/traks/${ID}`, () => HttpResponse.json(detail)),
  http.get(`*/api/traks/${ID}/processes`, () => HttpResponse.json({ processes })),
]

const renderDetail = (): void => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [`/traks/${ID}`] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

const opened = async (): Promise<HTMLElement> => {
  fireEvent.click(await screen.findByRole("button", { name: "Side panel" }))
  return screen.findByRole("region", { name: "Side panel" })
}

/** The trak header — the band holding the trak's title, wherever the page has drawn it. */
const trakHeader = async (): Promise<HTMLElement> => {
  const title = await screen.findByRole("heading", { name: "Show the discount line" })
  const found = title.closest("header")
  if (found === null) throw new Error("no header")
  return found
}

describe("the side panel", () => {
  it("is not offered to a project that declares no process", async () => {
    server.use(...serving([]))
    renderDetail()
    await screen.findByRole("textbox", { name: "Say something to the agent" })

    expect(screen.queryByRole("button", { name: "Side panel" })).toBeNull()
  })

  it("opens on the first process, with a tab for each and the running one's page in a frame", async () => {
    server.use(...serving([RUNNING, API]))
    renderDetail()
    const panel = await opened()

    expect(
      within(panel)
        .getAllByRole("tab")
        .map((t) => t.textContent),
    ).toStrictEqual(["dev", "api"])
    expect(within(panel).getByRole("heading", { name: "dev" })).toBeInTheDocument()
    expect(within(panel).getByText(/Running on port 47213/)).toBeInTheDocument()
    expect(within(panel).getByRole("button", { name: "Restart" })).toBeInTheDocument()
    expect(within(panel).getByRole("button", { name: "Stop" })).toBeInTheDocument()
    // No bridge on this window, so the page is an iframe on the process's own address.
    expect(within(panel).getByTitle("dev's page")).toHaveAttribute("src", "http://[::1]:47213/")
    expect(within(panel).getByTitle("dev's page").getAttribute("sandbox")).not.toContain(
      "allow-same-origin",
    )
    expect(screen.getByRole("button", { name: "Side panel" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
  })

  it("shows the log in place of the page, and a pageless process has only its log", async () => {
    server.use(...serving([RUNNING, API]))
    renderDetail()
    const panel = await opened()

    fireEvent.click(within(panel).getByRole("button", { name: "Log" }))
    expect(within(panel).getByText("VITE ready in 412 ms")).toBeInTheDocument()

    fireEvent.click(within(panel).getByRole("tab", { name: "api" }))
    expect(within(panel).queryByRole("navigation", { name: "Process views" })).toBeNull()
    expect(within(panel).getByText(/Nothing has run yet/)).toBeInTheDocument()
  })

  it("starts a process on a press, at its own route", async () => {
    const asked = vi.fn<() => void>()
    server.use(
      ...serving([API]),
      http.post(`*/api/traks/${ID}/processes/api/start`, () => {
        asked()
        return HttpResponse.json(API)
      }),
    )
    renderDetail()
    const panel = await opened()

    fireEvent.click(within(panel).getByRole("button", { name: "Start" }))
    await vi.waitFor(() => expect(asked).toHaveBeenCalledOnce())
  })

  it("is drawn by the shell's native view inside Orkestra.app, and never by a frame", async () => {
    const bridge = inTheApp()
    server.use(...serving([RUNNING]))
    renderDetail()
    const panel = await opened()

    expect(within(panel).queryByTitle("dev's page")).toBeNull()
    expect(within(panel).getByRole("region", { name: "dev's page" })).toBeInTheDocument()
    await vi.waitFor(() =>
      expect(bridge.show).toHaveBeenCalledWith(
        JSON.stringify([ID, "dev", 1]),
        "http://[::1]:47213/",
        expect.anything(),
      ),
    )

    // Leaving the Page view takes the view off the window: nothing else knows it is there.
    fireEvent.click(within(panel).getByRole("button", { name: "Log" }))
    expect(bridge.hide).toHaveBeenCalled()
  })
})

/** The shell's bridge on the window, as Orkestra.app's preload puts it there. */
const inTheApp = () => {
  const bridge = {
    show: vi.fn<PageBridge["show"]>(),
    hide: vi.fn<PageBridge["hide"]>(),
    reload: vi.fn<PageBridge["reload"]>(),
    onLogin: vi.fn<PageBridge["onLogin"]>(() => () => undefined),
    copyLogin: vi.fn<PageBridge["copyLogin"]>(),
    signIn: vi.fn<PageBridge["signIn"]>(),
  }
  window.orkestraPage = bridge
  return bridge
}

/**
 * The pull request's tab. Offered only where the shell's bridge is on the window — GitHub
 * refuses to be framed, so a browser has nothing to draw it in — and only once the plan has
 * run out with a commit on the branch, which is when the finished card asks the forge too.
 */
const PULL = makePullRequest({ number: 41, url: "https://github.com/o/r/pull/41" })

const finished: TrakDetailDto = {
  ...detail,
  state: { _tag: "Finished" },
  log: [
    makeTrakCreated(),
    makeWorkCommitted({ step: 1, sha: "abc1234", at: 1_000_000 }),
    makeHumanActed({ step: 1, action: { _tag: "Approve" }, at: 2_000_000 }),
  ],
}

const servingFinished = (processes: readonly HostedProcessDto[]) => [
  http.get(`*/api/traks/${ID}`, () => HttpResponse.json(finished)),
  http.get(`*/api/traks/${ID}/processes`, () => HttpResponse.json({ processes })),
  http.get(`*/api/traks/${ID}/pull-request`, () => HttpResponse.json(PULL)),
  http.get(`*/api/traks/${ID}/merge`, () => HttpResponse.json({ into: "main" })),
]

describe("the pull request in the side panel", () => {
  it("is a tab of its own in the app, for a project with no process, drawn by the native view", async () => {
    const bridge = inTheApp()
    server.use(...servingFinished([]))
    renderDetail()
    const panel = await opened()

    expect(within(panel).getByRole("tab", { name: "Pull request #41" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    expect(within(panel).getByText("github.com/o/r/pull/41")).toBeInTheDocument()
    expect(within(panel).getByRole("region", { name: "Pull request #41's page" })).toBeDefined()
    await vi.waitFor(() =>
      expect(bridge.show).toHaveBeenCalledWith(
        JSON.stringify([ID, "pull-request", PULL.url]),
        PULL.url,
        expect.anything(),
      ),
    )
    // The opener counts processes only, so with none it carries no number.
    expect(screen.getByRole("button", { name: "Side panel" }).textContent).toBe("")
  })

  it("sits last, after the process tabs, and the opener still counts only the processes", async () => {
    inTheApp()
    server.use(...servingFinished([RUNNING]))
    renderDetail()
    const panel = await opened()

    expect(
      within(panel)
        .getAllByRole("tab")
        .map((t) => t.textContent),
    ).toStrictEqual(["dev", "PR #41"])
    expect(screen.getByRole("button", { name: "Side panel" }).textContent).toBe("1")
  })

  it("is opened at its tab by the card's link", async () => {
    inTheApp()
    server.use(...servingFinished([RUNNING]))
    renderDetail()

    fireEvent.click(
      await screen.findByRole("link", { name: "Open pull request #41 in the side panel" }),
    )
    const panel = await screen.findByRole("region", { name: "Side panel" })
    expect(within(panel).getByRole("tab", { name: "Pull request #41" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
  })

  it("is not offered in a browser, where the card's link leaves for GitHub", async () => {
    server.use(...servingFinished([]))
    renderDetail()

    const link = await screen.findByRole("link", { name: "Open pull request #41 on GitHub" })
    expect(link).toHaveAttribute("target", "_blank")
    expect(screen.queryByRole("button", { name: "Side panel" })).toBeNull()
  })

  it("adds no tab beside a process in a browser", async () => {
    server.use(...servingFinished([RUNNING]))
    renderDetail()
    const panel = await opened()

    expect(within(panel).queryByRole("tablist")).toBeNull()
    expect(within(panel).getByRole("heading", { name: "dev" })).toBeInTheDocument()
  })
})

/** The login line — the page's box holds a status of its own, its loading state. */
const loginLine = (panel: HTMLElement): HTMLElement | undefined => {
  const page = within(panel).getByRole("region", { name: "Pull request #41's page" })
  return within(panel)
    .queryAllByRole("status")
    .find((node) => !page.contains(node))
}

describe("the pull request panel's login line", () => {
  it("says under the bar why the login did not come across, with the one action each failure has", async () => {
    const bridge = inTheApp()
    server.use(...servingFinished([]))
    renderDetail()
    const panel = await opened()
    await vi.waitFor(() => expect(bridge.onLogin).toHaveBeenCalled())
    const tell = bridge.onLogin.mock.calls[0]?.[0]

    const page = within(panel).getByRole("region", { name: "Pull request #41's page" })
    expect(within(page).getByRole("status")).toHaveTextContent("Loading…")

    act(() => tell?.({ state: "keychain", browser: "Dia" }))
    expect(loginLine(panel)).toHaveTextContent("macOS didn’t let Orkestra read Dia’s login.")
    fireEvent.click(within(panel).getByRole("button", { name: "Try again" }))
    expect(bridge.copyLogin).toHaveBeenCalledOnce()

    act(() => tell?.({ state: "browser-out", browser: "Dia" }))
    fireEvent.click(within(panel).getByRole("button", { name: "Sign in in Dia" }))
    expect(bridge.signIn).toHaveBeenCalledOnce()

    act(() => tell?.({ state: "copied", browser: "Dia" }))
    expect(loginLine(panel)).toBeUndefined()
  })

  it("keeps a closed not-Chromium note closed for the rest of the window", async () => {
    const bridge = inTheApp()
    server.use(...servingFinished([]))
    renderDetail()
    const panel = await opened()
    await vi.waitFor(() => expect(bridge.onLogin).toHaveBeenCalled())

    act(() => bridge.onLogin.mock.calls[0]?.[0]({ state: "not-chromium", browser: "Safari" }))
    expect(loginLine(panel)).toHaveTextContent(
      "Safari can’t share its GitHub login — sign in below.",
    )
    fireEvent.click(within(panel).getByRole("button", { name: "Close this note" }))
    expect(loginLine(panel)).toBeUndefined()
    expect(window.sessionStorage.getItem("orkestra:pull-request-login-note-closed")).not.toBeNull()
    window.sessionStorage.clear()
  })
})

describe("the split layout", () => {
  it("keeps the header's cells beside the panel, Close apart from the actions", async () => {
    server.use(...serving([RUNNING]))
    renderDetail()
    // Shut: the title, the actions holding the side panel's opener, and the title row's
    // presses — three cells of one grid, whichever row the width puts the actions on.
    const cells = async (): Promise<readonly Element[]> => [
      ...((await trakHeader()).firstElementChild?.children ?? []),
    ]
    const shut = await cells()
    expect(shut).toHaveLength(3)
    expect(shut[1]).toContainElement(screen.getByRole("button", { name: "Side panel" }))

    await opened()
    // Open: the same cells — the title with its id, the actions, then Close.
    const [top, actions, presses] = await cells()
    expect(presses).toContainElement(screen.getByRole("link", { name: "Close" }))
    expect(top).toHaveTextContent(ID)
    expect(actions).toContainElement(screen.getByRole("button", { name: "Side panel" }))
    expect(actions).not.toContainElement(screen.getByRole("link", { name: "Close" }))
  })

  it("hides the trak in full view, and Collapse brings it back", async () => {
    server.use(...serving([RUNNING]))
    renderDetail()
    const panel = await opened()

    fireEvent.click(within(panel).getByRole("button", { name: "Expand" }))
    expect(screen.queryByRole("heading", { name: "Show the discount line" })).toBeNull()

    fireEvent.click(within(panel).getByRole("button", { name: "Collapse" }))
    expect(screen.getByRole("heading", { name: "Show the discount line" })).toBeInTheDocument()
  })

  it("turns the list's section headers into counts while it is open", async () => {
    server.use(
      ...serving([RUNNING]),
      http.get("*/api/traks", () =>
        HttpResponse.json({
          traks: [makeTrak({ state: { _tag: "AgentWorking", step: 1 }, running: true })],
          archived: 2,
        }),
      ),
    )
    renderDetail()
    const header = await screen.findByRole("button", { name: /In progress/ })
    expect(header).not.toHaveAttribute("title")

    await opened()
    expect(header).toHaveAttribute("title", "In progress")
    expect(header).toHaveTextContent(/^1In progress$/)
    expect(screen.getByTitle("Archived")).toHaveTextContent(/^2Archived$/)

    fireEvent.click(screen.getByRole("button", { name: "Side panel" }))
    expect(header).not.toHaveAttribute("title")
  })
})

/** A step at its gate whose turn said `said`, beside a filed document that says `filed`. */
const talking = (said: string, filed = "Nothing to link.") => [
  http.get(`*/api/traks/${ID}`, () =>
    HttpResponse.json({
      ...detail,
      state: { _tag: "AwaitingHuman", step: 1, kind: "approval" },
      log: [
        makeTrakCreated(),
        makeAgentReturned({
          step: 1,
          sessionId: "s-1",
          output: makeArtifact({ sections: { Summary: filed } }),
        }),
      ],
      transcript: [makeSpawned({ pid: 100 }), makeSession({ id: "s-1" }), makeText({ text: said })],
    } satisfies TrakDetailDto),
  ),
  http.get(`*/api/traks/${ID}/processes`, () => HttpResponse.json({ processes: [RUNNING] })),
]

/** Presses the link, and says whether the press was let through to the browser. */
const press = (name: string, init: MouseEventInit = {}): boolean =>
  fireEvent.click(screen.getByRole("link", { name }), init)

/**
 * A link an agent wrote, in a chat message or a filed document, to one of the trak's own
 * processes or its pull request: a plain press opens the panel there, and every other press
 * and every other link still leaves for a browser tab.
 */
describe("a link in the trak's markdown", () => {
  const DEEP = "http://localhost:47213/a?b#c"

  it("opens the process's tab on Page, at the link's path on the process's own host", async () => {
    server.use(...talking(`Look at [the drawer](${DEEP}).`))
    renderDetail()
    await screen.findByRole("link", { name: "the drawer" })

    expect(press("the drawer")).toBe(false)
    const panel = await screen.findByRole("region", { name: "Side panel" })
    expect(within(panel).getByTitle("dev's page")).toHaveAttribute(
      "src",
      "http://[::1]:47213/a?b#c",
    )
    expect(within(panel).getByText("[::1]:47213/a?b#c")).toBeInTheDocument()
  })

  it("leaves for the browser on a modifier, another port or another host", async () => {
    server.use(
      ...talking(
        `[the drawer](${DEEP}), [elsewhere](http://localhost:4000/) and [remote](http://example.com:47213/)`,
      ),
    )
    renderDetail()
    await screen.findByRole("link", { name: "the drawer" })

    expect(press("the drawer", { metaKey: true })).toBe(true)
    expect(press("elsewhere")).toBe(true)
    expect(press("remote")).toBe(true)
    expect(screen.queryByRole("region", { name: "Side panel" })).toBeNull()
    expect(screen.getByRole("link", { name: "the drawer" })).toHaveAttribute("target", "_blank")
  })

  it("does the same in a filed document as in a chat message", async () => {
    server.use(...talking("Nothing to link.", `See [the page](${DEEP}).`))
    renderDetail()
    await screen.findByRole("link", { name: "the page" })

    expect(press("the page")).toBe(false)
    expect(await screen.findByRole("region", { name: "Side panel" })).toBeInTheDocument()
  })

  it("sends a second link into the same running page to the shell as a load of its own", async () => {
    const bridge = inTheApp()
    server.use(...talking(`[one](${DEEP}) and [two](http://127.0.0.1:47213/b)`))
    renderDetail()
    await screen.findByRole("link", { name: "one" })

    press("one")
    await vi.waitFor(() =>
      expect(bridge.show).toHaveBeenLastCalledWith(
        JSON.stringify([ID, "dev", 1, 1]),
        "http://[::1]:47213/a?b#c",
        expect.anything(),
      ),
    )
    press("two")
    await vi.waitFor(() =>
      expect(bridge.show).toHaveBeenLastCalledWith(
        JSON.stringify([ID, "dev", 1, 2]),
        "http://[::1]:47213/b",
        expect.anything(),
      ),
    )
  })
})

describe("a link in the trak's markdown on a phone", () => {
  beforeAll(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.startsWith("(max-width"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }))
  })
  afterAll(() => {
    vi.unstubAllGlobals()
    vi.stubGlobal("scrollTo", () => {})
  })

  it("leaves for the browser as it always has", async () => {
    server.use(...talking("Look at [the drawer](http://localhost:47213/)."))
    renderDetail()

    expect(fireEvent.click(await screen.findByRole("link", { name: "the drawer" }))).toBe(true)
    expect(screen.queryByRole("region", { name: "Side panel" })).toBeNull()
  })
})

/**
 * Behind a host with a page domain: the host names the domain in a `<meta>` and the project
 * in the page's base, and each process is framed at a hostname of its own.
 */
describe("the side panel behind a page domain", () => {
  const PAGE = `https://dev--${ID}--proj.example.com`
  const added: HTMLElement[] = []
  beforeEach(() => {
    const base = document.createElement("base")
    base.href = "https://orkestra.example.com/p/proj/"
    const meta = document.createElement("meta")
    meta.name = "orkestra-page-domain"
    meta.content = "example.com"
    added.push(base, meta)
    document.head.append(base, meta)
  })
  afterEach(() => {
    for (const element of added.splice(0)) element.remove()
  })

  it("frames the process at its hostname, keeping that origin", async () => {
    server.use(...serving([RUNNING]))
    renderDetail()
    const frame = within(await opened()).getByTitle("dev's page")

    expect(frame).toHaveAttribute("src", `${PAGE}/`)
    expect(frame.getAttribute("sandbox")).toContain("allow-same-origin")
  })

  it("follows a link at the hostname, and one at the loopback, to the hostname", async () => {
    server.use(...talking(`[by name](${PAGE}/a?b#c) and [by port](http://localhost:47213/d)`))
    renderDetail()
    await screen.findByRole("link", { name: "by name" })

    expect(fireEvent.click(screen.getByRole("link", { name: "by name" }))).toBe(false)
    const panel = await screen.findByRole("region", { name: "Side panel" })
    expect(within(panel).getByTitle("dev's page")).toHaveAttribute("src", `${PAGE}/a?b#c`)

    expect(fireEvent.click(screen.getByRole("link", { name: "by port" }))).toBe(false)
    expect(within(panel).getByTitle("dev's page")).toHaveAttribute("src", `${PAGE}/d`)
  })
})
