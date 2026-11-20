/**
 * Tier 2: the trak page below the phone breakpoint — the structural swaps `usePhone`
 * makes, asserted through the real route.
 *
 * `matchMedia` is stubbed to answer the phone query true, which is the documented way a
 * test gets the phone layout (`usePhone`); everything else is
 * `TrakDetailPage.test.tsx`'s own setup at its smallest. Desktop behaviour stays that
 * file's business.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router"
import { setupServer } from "msw/node"
import { http, HttpResponse } from "msw"
import type { TrakDetailDto } from "@orkestra/shared/dto/trak"
import {
  makeAgentReturned,
  makeAgentStep,
  makeChildrenSpawned,
  makeComposeEntry,
  makeComposerReturned,
  makeDetail,
  makeHostedProcess,
  makePlan,
  makeProposal,
  makeTrakCreated,
  makeWorktree,
  makeHostGit,
  makeCliUsage,
  makeModels,
  makeSession,
  makeSpawned,
} from "../../fixtures"
import { routeTree } from "../../routes"

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
  http.get("*/api/traks/:id/pull-request", () => HttpResponse.json({ _tag: "NoPullRequest" })),
  // The deploy is asked at the two ended states with a merge commit, and a project with no
  // `deploy.sh` says so — the default, so no case is about the block unless it says so.
  http.get("*/api/traks/:id/deploy", () => HttpResponse.json({ answer: "none" })),
  // The header asks which hosted processes the project declares on every mount, and a
  // project with none is the default — the side panel's own cases are `SidePanel.test.tsx`.
  http.get("*/api/traks/:id/processes", () => HttpResponse.json({ processes: [] })),
)

beforeAll(() => {
  vi.stubGlobal("scrollTo", () => {})
  // The phone: the breakpoint query answers true, everything else — `pointer: coarse`
  // included — false, so Enter-to-send stays what the other tests assert.
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

const detail = (over: Partial<TrakDetailDto> = {}): TrakDetailDto =>
  makeDetail({
    id: ID,
    state: { _tag: "AwaitingHuman", step: 2, kind: "approval" },
    plan: makePlan({
      title: "Add a read-only client",
      steps: [
        makeComposeEntry(),
        makeAgentStep({ agent: "planner", instruction: "sketch the routes" }),
        makeAgentStep({ agent: "builder", instruction: "build the drawer" }),
      ],
    }),
    log: [
      makeTrakCreated(),
      makeComposerReturned({ sessionId: "s-plan", output: makeProposal() }),
      makeAgentReturned({ step: 1, sessionId: "s-0" }),
      makeAgentReturned({ step: 2, sessionId: "s-1" }),
    ],
    ...over,
  })

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

const answers = (body: TrakDetailDto) =>
  http.get(`*/api/traks/${ID}`, () => HttpResponse.json(body))

const loaded = (): Promise<HTMLElement> =>
  screen.findByRole("textbox", { name: "Say something to the agent" })

/** Found afresh each time: the block is keyed to the position, so a move remounts it. */
const block = (): HTMLElement => screen.getByRole("region", { name: "Current position" })

/** The row leads with the position's instruction, which is how a test tells where it is. */
const standsAt = (instruction: string): Promise<void> =>
  waitFor(() => {
    expect(block()).toHaveTextContent(new RegExp(`^${instruction}`, "u"))
  })

describe("a runner failure on a phone", () => {
  it("leads a failure the runner reported with its sentence, the file and the verb", async () => {
    server.use(
      answers(
        detail({
          state: {
            _tag: "Failed",
            error: "create sandbox: the runner failed: …",
            kind: "worktree",
            runner: {
              kind: "failed",
              said: "create: the region is full",
              file: ".orkestra/runner.sh",
              verb: "create",
              stderr: "pulling the image\ncreate: the region is full",
            },
          },
          plan: undefined,
          log: [makeTrakCreated()],
          transcript: [],
        }),
      ),
    )
    renderDetail()

    expect(await screen.findByText("the runner failed")).toBeInTheDocument()
    expect(screen.getByText("create: the region is full")).toBeInTheDocument()
    expect(screen.getByText("from .orkestra/runner.sh create")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Show what it printed" }))
    expect(screen.getByText(/pulling the image/)).toBeInTheDocument()
  })
})

describe("a setup that failed, on a phone", () => {
  it("says setup failed, and shows what it printed behind a press", async () => {
    server.use(
      answers(
        detail({
          state: {
            _tag: "Failed",
            error: "setup failed in /w:\nresolving packages\nERR_PNPM_NO_LOCKFILE",
            kind: "worktree",
            setup: "resolving packages\nERR_PNPM_NO_LOCKFILE",
          },
          plan: undefined,
          log: [makeTrakCreated()],
          transcript: [],
        }),
      ),
    )
    renderDetail()

    expect(await screen.findByText("the project's setup.sh failed")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Show what it printed" }))
    expect(screen.getByText(/ERR_PNPM_NO_LOCKFILE/)).toBeInTheDocument()
  })
})

describe("a remake that left the uncommitted changes behind, on a phone", () => {
  it("names the ref whole, inside the screen's width", async () => {
    server.use(
      answers(
        detail({
          state: {
            _tag: "Failed",
            error:
              "put back uncommitted changes: the uncommitted changes carried across the remake of t1's sandbox did not apply, and are kept at refs/orkestra/carried/t1 in /project: exited 1",
            kind: "provider",
            carried: "refs/orkestra/carried/t1",
          },
          plan: undefined,
          log: [makeTrakCreated()],
          transcript: [],
        }),
      ),
    )
    renderDetail()

    expect(
      await screen.findByText("the uncommitted changes did not come across"),
    ).toBeInTheDocument()
    expect(screen.getByText("refs/orkestra/carried/t1")).toHaveClass("break-all")
    expect(screen.queryByText(/nothing to lose/)).toBeNull()
  })
})

describe("the trak page on a phone", () => {
  it("is a page with a back control, not a drawer with a Close", async () => {
    server.use(answers(detail()))
    renderDetail()
    await loaded()

    expect(screen.getByRole("link", { name: "Back" })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Close" })).not.toBeInTheDocument()
  })

  it("draws no opener control, and never asks for the listing", async () => {
    // The press opens a window on the engine's machine, and a phone is the one viewer
    // known not to be at it. No `*/api/openers` handler in this file on purpose: the
    // query is disabled below the breakpoint, so a run that stays silent about an
    // unhandled request is the fetch gating holding.
    server.use(answers(detail({ worktree: makeWorktree() })))
    renderDetail()
    await loaded()

    expect(screen.queryByRole("button", { name: /Open .* at this trak's checkout/ })).toBeNull()
  })

  it("replaces the step bar with four surface tabs, and the rail with the strip and the directive block", async () => {
    server.use(answers(detail()))
    renderDetail()
    await loaded()

    // The strip: one mark per position, the current one marked, named as the desk rail's.
    const strip = screen.getByRole("list", { name: "Positions" })
    expect(within(strip).getAllByRole("button")).toHaveLength(3)
    expect(within(strip).getByRole("button", { current: "step" })).toHaveAccessibleName(
      "builder — build the drawer — waiting for you",
    )

    // The row carries the current position's instruction, and no state in words.
    expect(within(block()).getByText("build the drawer")).toBeInTheDocument()
    expect(within(block()).queryByText("Waiting on you")).toBeNull()

    // The four surfaces, `Agent` first — not `Step`.
    for (const label of ["Agent", "Map", "Trak", "Changes"])
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument()
    expect(screen.queryByRole("navigation", { name: "Trak navigator" })).not.toBeInTheDocument()
  })

  it("keeps the piece band's menu, and draws no opener in either band", async () => {
    // A parent with a spawn out, and one piece mid-turn with a checkout of its own — the
    // shape whose band carries an opener pair at desk width. No `*/api/openers` handler
    // on purpose: the query is disabled below the breakpoint, for both bands.
    const C1 = "c1111111-2222-4333-8444-555555555555"
    server.use(
      answers(
        detail({
          state: { _tag: "AwaitingChildren", step: 2 },
          worktree: makeWorktree(),
          plan: makePlan({
            title: "Add a read-only client",
            steps: [
              makeComposeEntry(),
              makeAgentStep({ agent: "planner", instruction: "sketch the routes" }),
              {
                type: "spawn",
                instruction: "build both halves",
                children: [[{ agent: "builder", instruction: "wire the band" }]],
              },
            ],
          }),
          log: [...detail().log, makeChildrenSpawned({ step: 2, ids: [C1] })],
        }),
      ),
      http.get(`*/api/traks/${C1}`, () =>
        HttpResponse.json(
          makeDetail({
            id: C1,
            description: "wire the band",
            state: { _tag: "AgentWorking", step: 0 },
            worktree: makeWorktree({ path: "/tmp/c1", branch: "trak/c1" }),
            plan: makePlan({
              title: "wire the band",
              steps: [makeAgentStep({ instruction: "wire the band" })],
            }),
            log: [
              makeTrakCreated({
                description: "wire the band",
                parent: { id: ID, step: 2, child: 0, depth: 1 },
              }),
            ],
          }),
        ),
      ),
    )
    renderDetail()

    const band = await screen.findByRole("group", { name: "Piece" })
    // The piece's 14px tile is in the strip, and the page stands on it.
    const strip = screen.getByRole("list", { name: "Positions" })
    expect(within(strip).getByRole("button", { current: "step" })).toHaveAccessibleName(
      /— wire the band — running$/,
    )
    fireEvent.click(within(strip).getByRole("button", { name: /^planner — / }))
    expect(
      await within(strip).findByRole("button", { current: "step", name: /^planner — / }),
    ).toBeInTheDocument()
    fireEvent.click(within(strip).getByRole("button", { name: /— wire the band — running$/ }))
    expect(
      await within(strip).findByRole("button", { current: "step", name: /wire the band/ }),
    ).toBeInTheDocument()
    expect(within(band).getByRole("button", { name: "More options" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Open .* at this trak's checkout/ })).toBeNull()
  })

  it("moves between surfaces through the tabs", async () => {
    server.use(answers(detail()))
    renderDetail()
    await loaded()

    fireEvent.click(screen.getByRole("button", { name: "Map" }))
    expect(await screen.findByRole("list", { name: "Plan" })).toBeInTheDocument()
  })
})

describe("the strip and the directive block on a phone", () => {
  it("moves to a position from a mark and from the arrows", async () => {
    server.use(answers(detail()))
    renderDetail()
    await loaded()

    fireEvent.click(within(block()).getByRole("button", { name: "Previous step" }))
    await standsAt("sketch the routes")

    fireEvent.click(within(block()).getByRole("button", { name: "Next step" }))
    await standsAt("build the drawer")

    const strip = screen.getByRole("list", { name: "Positions" })
    fireEvent.click(within(strip).getByRole("button", { name: /^planner — / }))
    await standsAt("sketch the routes")
    expect(within(strip).getByRole("button", { current: "step" })).toHaveAccessibleName(
      /^planner — /,
    )
  })

  it("draws neither the strip nor the block on Map, Trak or Changes", async () => {
    server.use(answers(detail()))
    renderDetail()
    await loaded()

    for (const label of ["Map", "Trak", "Changes"]) {
      fireEvent.click(screen.getByRole("button", { name: label }))
      expect(screen.queryByRole("list", { name: "Positions" })).toBeNull()
      expect(screen.queryByRole("region", { name: "Current position" })).toBeNull()
    }
    fireEvent.click(screen.getByRole("button", { name: "Agent" }))
    expect(screen.getByRole("list", { name: "Positions" })).toBeInTheDocument()
  })
})

/** Whether the chrome's wrapper is the hidden one. */
const hiddenNow = (): boolean =>
  screen.getByRole("link", { name: "Back" }).closest(".hidden") !== null

/**
 * The chrome stays above the pane on every surface and hides only while a field below it has
 * the keyboard. `hidden` is a class happy-dom draws nothing for, so the wrapper's class is what
 * is asserted; that the pane is then under nothing is `phone.spec.ts`'s to measure.
 */
describe("the pinned chrome on a phone", () => {
  it("sits above the pane's scroller on every surface", async () => {
    server.use(answers(detail()))
    renderDetail()
    await loaded()

    for (const label of ["Agent", "Map", "Trak"]) {
      fireEvent.click(screen.getByRole("button", { name: label }))
      const back = screen.getByRole("link", { name: "Back" })
      expect(back.closest(".overflow-y-auto")).toBeNull()
    }
  })

  it("hides while the chat bar has focus, and comes back when it lets go", async () => {
    server.use(answers(detail()))
    renderDetail()
    const field = await loaded()

    expect(hiddenNow()).toBe(false)
    fireEvent.focusIn(field)
    await waitFor(() => {
      expect(hiddenNow()).toBe(true)
    })
    fireEvent.focusOut(field)
    await waitFor(() => {
      expect(hiddenNow()).toBe(false)
    })
  })

  it("stays for a press that raises no keyboard", async () => {
    server.use(answers(detail()))
    renderDetail()
    await loaded()

    // Focus under the chrome that raises no keyboard — the pane's scroller, here.
    const pane = document.querySelector(".overflow-y-auto")
    if (pane === null) throw new Error("no pane")
    fireEvent.focusIn(pane)
    expect(hiddenNow()).toBe(false)
  })
})

describe("the header and the model readback on a phone", () => {
  it("draws Back, the title and the id in the header, and the step's model under the box", async () => {
    // The header is the title row at every width; the model and effort token is under the
    // chat box, at the head of the spend row, on a phone as at desk.
    server.use(
      answers(
        detail({
          plan: makePlan({
            title: "Add a read-only client",
            steps: [
              makeComposeEntry(),
              makeAgentStep({ agent: "planner", instruction: "sketch the routes" }),
              makeAgentStep({
                agent: "builder",
                instruction: "build the drawer",
                model: "codex/gpt-5.6-sol",
                effort: "persistent",
              }),
            ],
          }),
        }),
      ),
    )
    renderDetail()
    await loaded()

    const band = screen.getByRole("heading", { level: 1 }).closest("header")
    if (band === null) throw new Error("the title is not in a header")
    expect(within(band).getByRole("link", { name: "Back" })).toBeInTheDocument()
    expect(within(band).getByText(ID)).toBeInTheDocument()
    expect(within(band).queryByLabelText(/^Model /)).toBeNull()
    // The effort is in the pill here too, whole: what a phone does to it is clip, which
    // is a measurement nothing below the browser tier can see.
    const token = screen.getByLabelText("Model gpt-5.6-sol, effort persistent")
    const field = screen.getByRole("textbox", { name: "Say something to the agent" })
    expect(field.compareDocumentPosition(token) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("pushes the side panel over the trak with a way back, and shows a process's log but never its page", async () => {
    server.use(
      answers(detail({ worktree: makeWorktree() })),
      http.get(`*/api/traks/${ID}/processes`, () =>
        HttpResponse.json({
          processes: [
            makeHostedProcess({
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
            }),
          ],
        }),
      ),
    )
    renderDetail()
    await loaded()

    fireEvent.click(await screen.findByRole("button", { name: "Side panel" }))
    const panel = await screen.findByRole("region", { name: "Side panel" })
    expect(screen.queryByRole("textbox", { name: "Say something to the agent" })).toBeNull()
    expect(within(panel).getByText("VITE ready in 412 ms")).toBeInTheDocument()
    expect(within(panel).queryByRole("navigation", { name: "Process views" })).toBeNull()
    expect(within(panel).queryByTitle("dev's page")).toBeNull()
    expect(within(panel).queryByRole("button", { name: "Expand" })).toBeNull()

    fireEvent.click(within(panel).getByRole("button", { name: "Back to the trak" }))
    expect(await loaded()).toBeInTheDocument()
  })
})

describe("a sandboxed trak on a phone", () => {
  it("draws no handoff on a sandboxed trak either, the openers' breakpoint rule", async () => {
    server.use(
      answers(
        detail({
          worktree: makeWorktree(),
          handoff: { resume: "claude --resume s-1", host: "pnpm host shell p t1" },
        }),
      ),
    )
    renderDetail()
    await loaded()

    expect(screen.queryByRole("button", { name: "Resume this session yourself" })).toBeNull()
  })

  it("offers its Rebuild in the menu, which acts on the engine's sandbox rather than a window here", async () => {
    server.use(
      answers(
        detail({
          worktree: makeWorktree(),
          handoff: { resume: "claude --resume s-1" },
          rebuild: "rebuilding",
        }),
      ),
    )
    renderDetail()
    await loaded()

    fireEvent.click(screen.getByRole("button", { name: "More options" }))
    expect(screen.getByRole("menuitem", { name: "Rebuilding the sandbox…" })).toBeDisabled()
  })

  /** The sheet is the page's, after the pane: inside the header it would be painted under
   *  every later band of the drawer, `FinishedFoot` among them. */
  it("asks its Rebuild in a sheet the page draws outside the header", async () => {
    server.use(
      answers(detail({ worktree: makeWorktree(), handoff: { resume: "claude --resume s-1" } })),
    )
    renderDetail()
    await loaded()

    fireEvent.click(screen.getByRole("button", { name: "More options" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Rebuild sandbox" }))
    expect(screen.queryByRole("menu")).toBeNull()
    const sheet = screen.getByRole("dialog", { name: "Rebuild this trak's sandbox?" })
    expect(sheet.querySelector(".rounded-t-sheet")).not.toBeNull()
    expect(sheet.closest("header")).toBeNull()

    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }))
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

/**
 * The questions card's Send, pressed while an answer field still has the keyboard — the
 * ordinary way to reach it on a phone, since the last thing a person does is type.
 *
 * **The press must land on the button it started on.** Pressing down moves focus off the
 * field, and `useTyping` brings the chrome back on that `focusout` — about 249px of bands
 * inserted above the pane between the press going down and coming up. The button moves
 * out from under the thumb, the release lands somewhere else, no `click` is raised, and the
 * person sees the page jump and presses a second time. So the chrome may not come back
 * while the press that took focus is still down.
 */
describe("pressing Send answers on a phone with an answer field focused", () => {
  const asked = (): TrakDetailDto =>
    detail({
      state: { _tag: "AwaitingComposerAnswers" },
      log: [
        makeTrakCreated({ description: "add a client" }),
        makeComposerReturned({
          sessionId: "s-plan",
          output: {
            type: "questions",
            questions: [
              {
                question: "Which subcommands should take the flag?",
                options: [{ label: "list only" }, { label: "all commands" }],
              },
            ],
          },
        }),
      ],
      transcript: [makeSpawned({ pid: 100 }), makeSession({ id: "s-plan" })],
    })

  it("keeps the chrome hidden while the press on Send is still down", async () => {
    server.use(
      answers(asked()),
      // Asked once the press has focus moving around the page; none of them is read here.
      http.get("*/api/processes", () => HttpResponse.json({ processes: [] })),
      http.get("*/api/traks", () => HttpResponse.json({ traks: [], archived: 0 })),
      http.get("*/api/models", () => HttpResponse.json(makeModels())),
      http.get("*/api/health", () => HttpResponse.json({ cwd: "/repo", version: "0.0.0" })),
    )
    renderDetail()
    const user = userEvent.setup()

    const field = await screen.findByRole("textbox", {
      name: "Which subcommands should take the flag?",
    })
    await user.click(field)
    await user.keyboard("list only")
    await waitFor(() => {
      expect(hiddenNow()).toBe(true)
    })

    const send = screen.getByRole("button", { name: "Send answers" })
    // Down and not yet up: focus has left the field for the button, the release has not
    // happened, and whatever the layout does now is what the release lands on.
    await user.pointer({ keys: "[MouseLeft>]", target: send })
    expect(document.activeElement).toBe(send)
    expect(hiddenNow()).toBe(true)
  })

  it("brings the chrome back once a press that leaves no field focused has landed", async () => {
    server.use(answers(asked()))
    renderDetail()
    const user = userEvent.setup()

    const field = await screen.findByRole("textbox", {
      name: "Which subcommands should take the flag?",
    })
    await user.click(field)
    await waitFor(() => {
      expect(hiddenNow()).toBe(true)
    })

    // A press on the card's question text: focus leaves the field, and the click lands.
    await user.click(screen.getByText("Which subcommands should take the flag?"))
    await waitFor(() => {
      expect(hiddenNow()).toBe(false)
    })
  })

  it("keeps the chrome hidden when a tap moves focus after the pointer came up", async () => {
    server.use(answers(asked()))
    renderDetail()
    const user = userEvent.setup()

    const field = await screen.findByRole("textbox", {
      name: "Which subcommands should take the flag?",
    })
    await user.click(field)
    await waitFor(() => {
      expect(hiddenNow()).toBe(true)
    })

    // A touch's order: the pointer goes down and up, and only the compatibility `mousedown`
    // after it moves focus. The chrome may not move until the `click` that ends the tap.
    const text = screen.getByText("Which subcommands should take the flag?")
    fireEvent.pointerDown(text)
    fireEvent.pointerUp(text)
    field.blur()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(hiddenNow()).toBe(true)
    fireEvent.click(text)
    await waitFor(() => {
      expect(hiddenNow()).toBe(false)
    })
  })
})
