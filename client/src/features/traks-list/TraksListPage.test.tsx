/**
 * Tier 2 (`testing-tiers`): the real page, the real hook, the real transport, against
 * MSW. Nothing is stubbed between the fixture and the row — which is the point, because
 * everything between them is what phase 5 added.
 *
 * **The fixtures are annotated with `@orkestra/shared` types**, checklist item 2: a
 * handler returning a shape the DTO rejects is a `tsc` failure rather than a mystery at
 * runtime.
 *
 * It mounts the app's own `routeTree` under a memory history rather than rendering the
 * component bare. A page is a route component here — `TrakDetailPage` reads its id
 * through `getRouteApi` — so rendering one outside its tree would be testing a
 * different thing than the app ships.
 *
 * Roles and text, no snapshots: a snapshot fails on a reworded label and passes on a
 * missing link.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router"
import { setupServer } from "msw/node"
import { http, HttpResponse } from "msw"
import type { PullRequestEntryDto, PullRequestSummaryDto } from "@orkestra/shared/dto/forge"
import type { TrakSummaryDto } from "@orkestra/shared/dto/trak"
import {
  makeDetail,
  makeDeploy,
  makeListing,
  makeNote,
  makeParent,
  makePullRequest,
  makePullRequestSummary,
  makeText,
  makeTool,
  makeTrak,
  makeWaiting,
  makeHostGit,
  makeHostedProcess,
  makeCliUsage,
} from "../../fixtures"
import { branchLimit } from "../../api/forge"
import { queryKeys } from "../../queryCache"
import { setPaletteOpen } from "../../hooks/usePalette"
import { routeTree } from "../../routes"

const server = setupServer(
  // The root route is behind the session gate, and an engine with no passphrase says
  // come in. A default rather than a `server.use`, so `resetHandlers` keeps it.
  http.get("*/api/session", () => new HttpResponse(null, { status: 204 })),
  // The git bar, which every screen under the list draws.
  http.get("*/api/git", () => HttpResponse.json(makeHostGit())),
  // The git bar's usage cell: never read.
  http.get("*/api/usage", () => HttpResponse.json({ clis: [makeCliUsage()] })),
  // The project checkout's processes, which the git bar draws: none declared.
  http.get("*/api/processes", () => HttpResponse.json({ processes: [] })),
  // The goal banner over the list, which every screen under it draws.
  http.get("*/api/goals", () => HttpResponse.json({ goals: [] })),
  // The bar's project openers, as a machine with no scan: nothing drawn in the slot.
  http.get("*/api/openers", () => new HttpResponse(null, { status: 204 })),
)

beforeAll(() => {
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

/** Named, because the naming test below refers to it twice. */
const PARENT_ID = "11111111-2222-4333-8444-555555555555"

/** The spawn the band tests hang their pieces off. */
const SPAWN_ID = "cccccccc-2222-4333-8444-555555555555"

/**
 * What a real child is named and what its first step says — one string, because
 * `childPlan` titles a child's plan with its first step's instruction, so `title` and
 * `instruction` come off the wire identical for every piece standing at that step. The
 * other pieces below are hand-written and differ; this one is the shape the engine
 * actually sends, and the column must not print it twice.
 */
const REPEATED = "Read every route for an id that reaches the store without a guard in front of it"

/**
 * A parent with its pieces out. It carries an instruction and a title, so a row that
 * failed to collapse would show both — which is what the band tests assert against.
 */
const spawn: TrakSummaryDto = makeTrak({
  id: SPAWN_ID,
  description: "review the whole client",
  title: "Review the client end to end",
  state: { _tag: "AwaitingChildren", step: 2 },
  running: true,
  instruction: "One child per lens — security, performance, accessibility",
})

const gate = (id: string, description: string, touched: number): TrakSummaryDto =>
  makeTrak({ id, description, state: { _tag: "AwaitingProposal" }, touched })

/** A piece of `spawn`, at whatever state and plan position the case needs. */
const piece = (
  id: string,
  description: string,
  state: TrakSummaryDto["state"],
  child: number,
): TrakSummaryDto =>
  makeTrak({ id, description, state, parent: makeParent({ id: SPAWN_ID, step: 2, child }) })

const traks: readonly TrakSummaryDto[] = [
  makeTrak({
    id: PARENT_ID,
    description: "add a client",
    state: { _tag: "AwaitingHuman", step: 2, kind: "approval" },
    instruction: "Draw the step card: one card per step, tool calls collapsed",
  }),
  makeTrak({
    id: "99999999-8888-4777-8666-555555555555",
    description: "rewrite the composer prompt",
    state: { _tag: "AgentWorking", step: 1 },
    running: true,
    instruction: "Move the commit to the end of the step, after checks pass",
    activity: [
      makeTool({ name: "Read", kind: "Read", detail: "src/app/dto.ts" }),
      makeTool({ name: "Edit", kind: "Edit", detail: "src/app/dto.ts" }),
    ],
  }),
]

/**
 * Fresh per test: a shared cache would let one test's answer satisfy the next.
 *
 * It hands the client back so a test can invalidate the list and get the *next* MSW
 * answer without waiting out `POLL_MS` — the same key `useEngineStream` invalidates
 * when the engine appends, so the refetch is the real one and only the trigger is the
 * test's.
 *
 * `prime` runs against the cache before anything mounts — the shape a page has when
 * another surface already paid for an answer, which is what the store tests below are
 * about.
 */
const renderList = (
  prime?: (queryClient: QueryClient) => void,
  /** Where the page opens — `/` is the list alone; a trak's path is the list with its
   *  drawer open over it. */
  at = "/",
): QueryClient => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  prime?.(queryClient)
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [at] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return queryClient
}

/** The list as the engine sends it: the live rows, and how many traks are put away. */
const answers = (body: readonly TrakSummaryDto[], archived = 0) =>
  http.get("*/api/traks", () => HttpResponse.json({ traks: body, archived }))

/**
 * What the forge says about the branches the page named — the second read this page makes,
 * and the only one that is not about a trak.
 *
 * **One handler, not one per row**, which is the change: the page asks `/api/pull-requests`
 * once whatever is on screen, naming its branches on the query string. This answers the way
 * the engine does — an entry per branch asked about, carrying a pull request only where
 * `byBranch` names one, so a branch it does not name reads *the forge has none on it*
 * rather than *nobody asked*. The route is registered unconditionally so that
 * `onUnhandledRequest: "error"` still catches a request nobody meant to make.
 */
const forge = (byBranch: Readonly<Record<string, Partial<PullRequestSummaryDto>>> = {}) =>
  http.get("*/api/pull-requests", ({ request }) => {
    const entries: PullRequestEntryDto[] = []
    for (const branch of new URL(request.url).searchParams.getAll("branch")) {
      const pull = byBranch[branch]
      entries.push(pull === undefined ? { branch } : { branch, pull: makePullRequestSummary(pull) })
    }
    return HttpResponse.json(makeListing({ entries }))
  })

/** A forge that could not be asked at all, which is what `gh` not being installed is. */
const unreachable = () =>
  http.get("*/api/pull-requests", () =>
    HttpResponse.json({ _tag: "ForgeUnavailable", why: "gh: not authenticated" }),
  )

/** An answer holding no entry for the branch on screen: the engine's per-call bound, or an
 *  answer to a different set of branches still in hand. Nobody asked about this one. */
const unanswered = () => http.get("*/api/pull-requests", () => HttpResponse.json(makeListing()))

/** A trak whose plan has run out, on the branch its own id names — which is the only thing
 *  joining it to one of the forge's rows. */
const done = (id: string, description: string): TrakSummaryDto =>
  makeTrak({ id, description, state: { _tag: "Finished" }, branch: `trak/${id}` })

/** Distinct ids that sort in the order they are generated, for the case about the bound. */
const nth = (i: number) => `00000000-2222-4333-8444-${String(i).padStart(12, "0")}`

/**
 * The section headers on the page, in the order they are drawn.
 *
 * By role rather than by matching their words, because a pile's title and the phrase on a
 * row inside it are deliberately the same string — four rows reading *Ready to merge*
 * under a header reading the same — so a text query cannot tell a lid from a row. Every
 * header is the button its lid hangs off, and the only button that says whether it is
 * open: a finished row's *Archive* is a button too, and the git bar's are in the strip at
 * the foot, outside `main`.
 */
const lids = (): readonly HTMLElement[] =>
  within(screen.getByRole("main"))
    .queryAllByRole("button")
    .filter((button) => button.hasAttribute("aria-expanded"))

describe("TraksListPage", () => {
  it("renders a row per trak — the work, the step it is at, and how that is going", async () => {
    server.use(answers(traks))
    renderList()

    // The link, by role and by name: the row's destination is the trak, and the name
    // that reaches a screen reader has to be the work rather than "open". Neither
    // fixture has reached a plan, so both go by their request — see the test below.
    const link = await screen.findByRole("link", { name: "add a client" })
    expect(link.getAttribute("href")).toBe("/traks/11111111-2222-4333-8444-555555555555")

    // The middle line: the composer's own sentence for the step that is running,
    // which is the whole reason the row is three lines rather than two.
    expect(
      screen.getByText("Move the commit to the end of the step, after checks pass"),
    ).toBeDefined()

    // Words from `trakLabel`, not tags from the wire. A row that printed
    // `AwaitingHuman` would pass a snapshot and fail a reader — and neither phrase
    // names a step index any more.
    expect(screen.getByText("Output awaiting approval")).toBeDefined()
    expect(screen.getByText("Working…")).toBeDefined()

    // The right-hand slot, which holds one thing or the other and never both: what
    // is waiting on you at the gated trak, the last transcript line at the running
    // one. `Review` is a link into the trak — nothing on this list acts.
    const review = screen.getByRole("link", { name: "Review — add a client" })
    expect(review.getAttribute("href")).toBe("/traks/11111111-2222-4333-8444-555555555555")
    // The calls are the phrase the live log names their run by, never one line per call.
    expect(screen.getByText("Read 1 file, and edited 1 file")).toBeDefined()
    expect(screen.queryByText("src/app/dto.ts")).toBeNull()
  })

  it("names a row by the plan's title, falling back to the request until there is one", async () => {
    server.use(
      answers([
        {
          id: PARENT_ID,
          description:
            "the list shows the raw request, which is a paragraph, so a queue of them is unreadable — name each row instead",
          title: "Name a row by its plan",
          state: { _tag: "AgentWorking", step: 1 },
          running: true,
          mode: "manual",
          branchMoved: false,
        },
        {
          id: "99999999-8888-4777-8666-555555555555",
          description: "nothing has been composed here yet",
          state: { _tag: "Composing" },
          running: true,
          mode: "manual",
          branchMoved: false,
        },
      ]),
    )
    renderList()

    expect(await screen.findByRole("link", { name: "Name a row by its plan" })).toBeDefined()
    // Both, and only one each: the request is on the detail page, and a row that
    // printed it under the title would be back to a list of paragraphs.
    expect(screen.queryByText(/queue of them is unreadable/)).toBeNull()
    expect(screen.getByRole("link", { name: "nothing has been composed here yet" })).toBeDefined()
  })

  it("shows no activity line at all when the newest line is the envelope", async () => {
    // The row has no log to read the slice off, so the summary carries it beside the
    // entry — the same string the turn's `AgentReturned` holds.
    const envelope = '```json\n{ "type": "artifact", "sections": { "Summary": "done" } }\n```'
    server.use(
      answers([
        makeTrak({
          id: PARENT_ID,
          description: "rewrite the composer prompt",
          state: { _tag: "AgentWorking", step: 1 },
          running: true,
          activity: [makeText({ text: envelope })],
          envelope,
        }),
      ]),
    )
    renderList()

    // The row draws, and the slot beside it is empty — not a truncated line of JSON, and
    // not a blank one either. The card on the detail page is where the document is read.
    expect(await screen.findByRole("link", { name: "rewrite the composer prompt" })).toBeDefined()
    expect(screen.queryByText(/artifact/)).toBeNull()
  })

  it("says the agent is thinking where the live log's last row is a pause", async () => {
    // The pause closes the run before it, so the row says what the log's live end says
    // rather than the calls it has already moved past.
    server.use(
      answers([
        makeTrak({
          id: PARENT_ID,
          description: "rewrite the composer prompt",
          state: { _tag: "AgentWorking", step: 1 },
          running: true,
          activity: [
            makeTool({ name: "Read", kind: "Read", detail: "src/app/dto.ts" }),
            makeNote({ text: "Thinking" }),
          ],
        }),
      ]),
    )
    renderList()

    expect(await screen.findByText("Thinking")).toBeDefined()
    expect(screen.queryByText(/Read 1 file/)).toBeNull()
  })

  it("says what would put something here when there is nothing", async () => {
    server.use(answers([]))
    renderList()

    // `client-style`'s empty state: a sentence naming the start path, never a blank
    // panel. Starting one is the "New Trak" button — the app bar's at desk width, the
    // dock's on a phone — so the sentence names the button and not where it sits.
    expect(await screen.findByText(/No traks yet/)).toBeDefined()
    expect(screen.getByText(/Press New Trak to start one/)).toBeDefined()
  })

  it("shows the failure in words, with a retry, when there is no data to show", async () => {
    server.use(http.get("*/api/traks", () => new HttpResponse(null, { status: 500 })))
    renderList()

    // The fourth view state. The first three are covered above and by the detail page;
    // this is the one that must not render an empty list.
    expect(await screen.findByRole("alert")).toBeDefined()
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined()
    expect(screen.queryByRole("list")).toBeNull()
  })
})

describe("TraksListPage — an idle trak", () => {
  it("draws as one line at its section's foot: the title, the age, and no state word or press", async () => {
    const DAY = 24 * 60 * 60 * 1000
    server.use(
      answers([
        makeTrak({
          id: PARENT_ID,
          description: "left at a gate",
          state: { _tag: "AwaitingHuman", step: 0, kind: "approval" },
          instruction: "Review the second round",
          idle: true,
          active: Date.now() - 12 * DAY - 1000,
        }),
        makeTrak({
          id: SPAWN_ID,
          description: "answered today",
          state: { _tag: "AwaitingHuman", step: 0, kind: "approval" },
        }),
      ]),
      forge(),
    )
    renderList()

    const section = await screen.findByRole("list", { name: "Needs you" })
    const links = within(section).getAllByRole("link")
    // The live row's title and its press come first; the idle row's title is last.
    expect(links.map((link) => link.textContent)).toEqual([
      "answered today",
      "Review",
      "left at a gate",
    ])
    expect(within(section).getByText("12d")).toBeDefined()
    expect(screen.queryByText("Review the second round")).toBeNull()
    expect(screen.queryByRole("link", { name: "Review — left at a gate" })).toBeNull()
  })
})

describe("TraksListPage — idle piles", () => {
  const DAY = 24 * 60 * 60 * 1000
  const approval = { _tag: "AwaitingHuman", step: 0, kind: "approval" } as const
  const idle = (id: string, description: string, days: number): TrakSummaryDto =>
    makeTrak({ id, description, state: approval, idle: true, active: Date.now() - days * DAY })

  it("cuts a section's idle rows after three, and the press draws the rest and folds back", async () => {
    server.use(
      answers([
        makeTrak({ description: "answered today", state: approval }),
        ...[1, 2, 3, 4, 5].map((n) => idle(`idle-${String(n)}`, `left ${String(n)}`, 3 + n)),
      ]),
      forge(),
    )
    renderList()

    const section = await screen.findByRole("list", { name: "Needs you" })
    expect(within(section).queryByRole("link", { name: "left 3" })).not.toBeNull()
    expect(within(section).queryByRole("link", { name: "left 4" })).toBeNull()
    fireEvent.click(within(section).getByRole("button", { name: "+2 more" }))
    expect(within(section).getByRole("link", { name: "left 5" })).toBeDefined()
    fireEvent.click(within(section).getByRole("button", { name: "Show fewer" }))
    expect(within(section).queryByRole("link", { name: "left 5" })).toBeNull()
  })

  it("moves a section with nothing live to one line on the idle shelf, which opens to its rows", async () => {
    server.use(
      answers(
        [
          makeTrak({ description: "running now", state: { _tag: "AgentWorking", step: 0 } }),
          idle("idle-a", "left at a gate", 12),
          idle("idle-b", "left at another", 5),
        ],
        4,
      ),
      forge(),
    )
    renderList()

    const shelf = await screen.findByRole("list", { name: "Idle" })
    // No section of its own: the shelf's line is the only place *Needs you* is named.
    expect(screen.queryByRole("list", { name: "Needs you" })).toBeNull()
    const line = within(shelf).getByRole("button", { name: /Needs you/ })
    expect(line.textContent).toContain("5d")
    expect(screen.queryByRole("link", { name: "left at a gate" })).toBeNull()

    fireEvent.click(line)
    const rows = within(shelf).getByRole("list", { name: "Needs you" })
    expect(within(rows).getByRole("link", { name: "left at a gate" })).toBeDefined()
    expect(within(rows).getByRole("link", { name: "left at another" })).toBeDefined()

    // Directly above the archive, and below every live section.
    const after = Node.DOCUMENT_POSITION_FOLLOWING
    const live = screen.getByRole("link", { name: "running now" })
    expect(live.compareDocumentPosition(shelf) & after).toBe(after)
    expect(shelf.compareDocumentPosition(screen.getByText("Archived")) & after).toBe(after)
  })
})

describe("TraksListPage — the run mode", () => {
  it("marks every row with its run mode, manual included", async () => {
    server.use(
      answers([
        makeTrak({ title: "Run by hand", mode: "manual" }),
        makeTrak({ title: "Run smart", mode: "smart" }),
        makeTrak({ title: "Run on its own", mode: "auto" }),
      ]),
    )
    renderList()

    await screen.findByRole("link", { name: "Run by hand" })
    for (const [title, mode] of [
      ["Run by hand", "Manual mode"],
      ["Run smart", "Smart mode"],
      ["Run on its own", "Auto mode"],
    ] as const) {
      // One mark per row, and the row it sits in is the trak it names.
      expect(screen.getByRole("img", { name: mode }).closest("li")?.textContent).toContain(title)
    }
  })
})

/**
 * The band and the sections meet here, and the rule is one sentence: **a piece is on its
 * parent's band or it is off the list, and the group is what a section holds.** `asTree`
 * runs over the whole list before anything is filed, so a piece's own state moves the
 * group it is in rather than moving the piece out of it.
 *
 * A piece that reaches a gate is the case worth following: the *group* lands in *Needs
 * you*, the piece stays a column, and the parent still heads it wearing its own state.
 * One piece that needs attention is the whole group needing attention.
 */
describe("TraksListPage — the context ring", () => {
  it("rings each row with a reading and a window, as a fraction of that row's own window", async () => {
    const held = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 120_000,
      cacheWriteTokens: 0,
    }
    server.use(
      answers([
        makeTrak({ id: nth(1), description: "nearly full", context: { held, window: 200_000 } }),
        makeTrak({ id: nth(2), description: "roomy", context: { held, window: 1_000_000 } }),
        makeTrak({ id: nth(3), description: "window unknown", context: { held } }),
        makeTrak({ id: nth(4), description: "nothing read" }),
      ]),
    )
    renderList()

    await screen.findByRole("link", { name: "nearly full" })
    // Two rings, each its own row's fraction — never one row scaled against another, and
    // none where the window is unknown or nothing has been read.
    const rings = screen.getAllByRole("img", { name: /of the context window/ })
    expect(rings.map((r) => r.getAttribute("aria-label"))).toEqual([
      "60% of the context window",
      "12% of the context window",
    ])
  })
})

describe("TraksListPage — a spawn's band", () => {
  it("draws the pieces still running on a band under it, in plan order whatever order they arrive in", async () => {
    server.use(
      answers([
        {
          id: "aaaaaaaa-2222-4333-8444-555555555555",
          description: "review it for performance",
          state: { _tag: "AgentWorking", step: 0 },
          running: true,
          mode: "manual",
          branchMoved: false,
          parent: { id: SPAWN_ID, step: 2, child: 1, depth: 1 },
        },
        spawn,
        ...traks,
        {
          id: "bbbbbbbb-2222-4333-8444-555555555555",
          description: "review it for security",
          state: { _tag: "CheckRunning", step: 1 },
          running: true,
          mode: "manual",
          branchMoved: false,
          instruction: "Read every route for an unguarded id",
          parent: { id: SPAWN_ID, step: 2, child: 0, depth: 1 },
        },
        {
          // Wire-shaped: a child is born with its parent's request as its
          // description, and its own sentence as both the plan's title and the one
          // step's instruction.
          id: "dddddddd-2222-4333-8444-555555555555",
          description: "review the whole client",
          title: REPEATED,
          state: { _tag: "AgentWorking", step: 0 },
          running: true,
          mode: "manual",
          branchMoved: false,
          instruction: REPEATED,
          parent: { id: SPAWN_ID, step: 2, child: 2, depth: 1 },
        },
      ]),
    )
    renderList()

    await screen.findByRole("link", { name: "Review the client end to end" })
    // The parent's own row is the title alone — no instruction, and no count of the
    // pieces anywhere on it. The band is where they are.
    const progress = screen.getByRole("list", { name: "In progress" })
    const parent = within(progress).getAllByRole("listitem")[0]?.textContent
    expect(parent).toContain("Review the client end to end")
    expect(parent).not.toContain("One child per lens")
    expect(parent).not.toMatch(/pieces/)

    // Plan order, not the order the store handed them over in, which is a directory
    // read. Each piece is the child trak drawn small: its name, its instruction where
    // it has one, and the phrase saying what it wants.
    const band = screen.getByRole("list", { name: "Pieces of Review the client end to end" })
    const pieces = within(band)
      .getAllByRole("listitem")
      .map((r) => r.textContent)
    expect(pieces).toHaveLength(3)
    expect(pieces[0]).toContain("review it for security")
    expect(pieces[0]).toContain("Read every route for an unguarded id")
    expect(pieces[1]).toContain("review it for performance")

    // The wire-shaped piece: its name and its step's instruction are one string, so
    // the column says it once and then says what the piece is doing. Printed twice it
    // would be the same truncated sentence stacked on itself at a fifth of the width.
    expect(within(band).getAllByText(REPEATED)).toHaveLength(1)
    expect(pieces[2]).toContain("Working…")

    // A piece is one press from the surface that can approve it — and that surface is its
    // **parent's** drawer, standing at this piece. A subtrak has no drawer of its own, so
    // the link goes to the parent with the piece's id as `?spot=`, which is all a summary
    // can name: it carries no plan and no log, so it cannot build a position key.
    const column = within(band).getByRole("link", { name: "review it for security" })
    expect(column.getAttribute("href")).toBe(
      "/traks/cccccccc-2222-4333-8444-555555555555?spot=bbbbbbbb-2222-4333-8444-555555555555",
    )
  })

  it("stacks the pieces one per row while a drawer is open over the list", async () => {
    // The drawer is fixed over the right of the list, so columns abreast would put the
    // pieces a person opened it to watch behind it. Same page, same rows — the band's
    // grid is the only thing that changes.
    const working = { _tag: "AgentWorking", step: 0 } as const
    server.use(
      answers([
        spawn,
        piece("aaaaaaaa-2222-4333-8444-555555555555", "review it for security", working, 0),
        piece("bbbbbbbb-2222-4333-8444-555555555555", "review it for performance", working, 1),
        piece("dddddddd-2222-4333-8444-555555555555", "review it for accessibility", working, 2),
      ]),
      http.get("*/api/traks/:id", () => HttpResponse.json(makeDetail({ id: SPAWN_ID }))),
    )
    renderList(undefined, `/traks/${SPAWN_ID}`)

    const band = await screen.findByRole("list", { name: "Pieces of Review the client end to end" })
    expect(within(band).getAllByRole("listitem")).toHaveLength(3)
    expect(band.style.gridTemplateColumns).toBe("repeat(1, minmax(0, 1fr))")
  })

  it("draws the pieces abreast when nothing is open over the list", async () => {
    const working = { _tag: "AgentWorking", step: 0 } as const
    server.use(
      answers([
        spawn,
        piece("aaaaaaaa-2222-4333-8444-555555555555", "review it for performance", working, 0),
        piece("bbbbbbbb-2222-4333-8444-555555555555", "review it for security", working, 1),
      ]),
    )
    renderList()

    const band = await screen.findByRole("list", { name: "Pieces of Review the client end to end" })
    expect(band.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))")
  })
})

/**
 * The request itself: a group is one unit wherever its members are, filed under the
 * furthest-up section any of them is in, and no piece of a parent this list holds is ever
 * a row on its own.
 */
describe("TraksListPage — a group moves as one", () => {
  it("takes a landed piece off the list altogether, and the band with the last of them", async () => {
    server.use(
      answers([
        spawn,
        piece(
          "aaaaaaaa-2222-4333-8444-555555555555",
          "review it for performance",
          { _tag: "Merged", sha: "a91c04e" },
          0,
        ),
      ]),
    )
    renderList()

    await screen.findByRole("link", { name: "Review the client end to end" })
    // Off the band, and the band gone with it: the parent's row is alone in its
    // section, with nothing under it — and back to three lines, because a parent with
    // no live pieces is an ordinary row again.
    const progress = screen.getByRole("list", { name: "In progress" })
    expect(within(progress).getAllByRole("listitem")).toHaveLength(1)
    expect(
      within(progress).getByText("One child per lens — security, performance, accessibility"),
    ).toBeDefined()

    // **And nowhere else either.** A merged piece is its parent now, so there is no
    // outstanding work for a row to stand for: `Merged` is not drawn at all here.
    expect(screen.queryByText("review it for performance")).toBeNull()
    expect(screen.queryByText("Merged")).toBeNull()
  })

  it("puts the whole group in Needs you when one piece reaches a gate", async () => {
    // The request in one case. The piece stays a column and the parent keeps heading it;
    // what moves is the unit, into the section the piece names.
    server.use(
      answers([
        spawn,
        piece(
          "bbbbbbbb-2222-4333-8444-555555555555",
          "review it for security",
          { _tag: "AwaitingHuman", step: 1, kind: "approval" },
          0,
        ),
      ]),
    )
    renderList()

    await screen.findByText("Needs you")
    const attention = screen.getByRole("list", { name: "Needs you" })
    // The head is the parent, drawn as an ordinary row is: its own name, and no phrase
    // borrowed from the piece that pulled the group up.
    const head = within(attention).getAllByRole("listitem")[0]?.textContent
    expect(head).toContain("Review the client end to end")
    expect(head).not.toMatch(/part of/)

    // The piece is a column on the band, not a row — and the group is in one section,
    // so "In progress" is not drawn at all.
    const band = screen.getByRole("list", { name: "Pieces of Review the client end to end" })
    expect(within(band).getByText("review it for security")).toBeDefined()
    expect(screen.queryByText("In progress")).toBeNull()
  })

  it("keeps a group in one place as its pieces land", async () => {
    // A group's section follows its members, so landing one of three moves nothing: the
    // gate is still out and the group is still under it.
    server.use(
      answers([
        spawn,
        piece(
          "bbbbbbbb-2222-4333-8444-555555555555",
          "review it for security",
          { _tag: "AwaitingHuman", step: 1, kind: "approval" },
          0,
        ),
        piece(
          "aaaaaaaa-2222-4333-8444-555555555555",
          "review it for performance",
          { _tag: "Merged", sha: "a91c04e" },
          1,
        ),
        piece(
          "dddddddd-2222-4333-8444-555555555555",
          "review it for accessibility",
          { _tag: "AgentWorking", step: 0 },
          2,
        ),
      ]),
    )
    renderList()

    await screen.findByText("Needs you")
    // One header on the page, one head row under it, two columns on the band — the
    // merged piece is gone and the other two never left.
    expect(lids().map((h) => h.textContent)).toEqual(["Needs you1"])
    const band = screen.getByRole("list", { name: "Pieces of Review the client end to end" })
    expect(within(band).getAllByRole("listitem")).toHaveLength(2)
    expect(within(band).getByText("review it for security")).toBeDefined()
    expect(within(band).getByText("review it for accessibility")).toBeDefined()
  })
})

const MERGED = "aaaaaaaa-2222-4333-8444-555555555555"
const CONFLICTED = "bbbbbbbb-2222-4333-8444-555555555555"
const QUIET = "dddddddd-2222-4333-8444-555555555555"
const REVIEWED = "eeeeeeee-2222-4333-8444-555555555555"

/**
 * The forge's answer reaching a row, through everything between it and the wire: the one
 * query the page makes, the branch match, the ladder, and the two projections that take a
 * rung.
 *
 * The unit tiers cover the ladder itself; what only this tier can say is that an answer
 * reaches a row through its branch and is drawn where the ladder filed it. What the forge
 * *did not* say is the block below.
 */
describe("TraksListPage — what the forge says about a finished branch", () => {
  it("splits the finished work into three piles by what is in the way", async () => {
    server.use(
      answers([
        done(MERGED, "widen the merge preview"),
        done(CONFLICTED, "port the seed design"),
        done(REVIEWED, "read every route for an unguarded id"),
        done(QUIET, "give the drawer its own route"),
      ]),
      forge({
        [`trak/${MERGED}`]: { state: "merged" },
        [`trak/${CONFLICTED}`]: { merging: "conflicting" },
        [`trak/${REVIEWED}`]: { decision: "reviewRequired" },
        [`trak/${QUIET}`]: {},
      }),
    )
    renderList()

    // Awaited on a pile only the forge's answer can produce, not on *Ready to merge* —
    // that one is where every finished trak sits before the answer arrives, so finding it
    // would be finding the page mid-flight and asserting against the wrong frame.
    const issues = await screen.findByRole("list", { name: "Has issues" })

    // What can land, what is still out, and what is stuck — one row each, and each row
    // saying which of the three it is in its own words rather than by where it sits.
    const ready = screen.getByRole("list", { name: "Ready to merge" })
    expect(within(ready).getAllByRole("listitem")).toHaveLength(1)
    expect(within(ready).getByText("give the drawer its own route")).toBeDefined()
    expect(within(ready).getByText("Ready to merge")).toBeDefined()

    const inReview = screen.getByRole("list", { name: "In review" })
    expect(within(inReview).getByText("Waiting on review")).toBeDefined()

    expect(within(issues).getAllByRole("listitem")).toHaveLength(1)
    expect(within(issues).getByText("Conflicts")).toBeDefined()

    // And the merged one has left all three for MERGED — the chore pile, open on first
    // paint, because its row still owes a press.
    const pile = screen.getByRole("list", { name: "Merged" })
    expect(within(pile).getAllByRole("listitem")).toHaveLength(1)
    expect(within(pile).getByText("widen the merge preview")).toBeDefined()
    // Its own words under that header — the work is in, the checkout is not gone.
    expect(within(pile).getByText("Merged — checkout still here")).toBeDefined()
  })

  /**
   * The second override, reaching a row through the same page: a trak holding a step
   * behind a condition leaves *Merged* for *Waiting*, keeps the forge's answer as an
   * aside, and raises no *Archive* — the one press this list must not offer on it.
   */
  it("files a held trak under Waiting, over the forge's merged, and offers no Archive", async () => {
    server.use(
      answers([
        makeTrak({
          id: MERGED,
          description: "move the Asana task to Done",
          state: { _tag: "Finished" },
          branch: `trak/${MERGED}`,
          waiting: makeWaiting(),
        }),
        done(QUIET, "give the drawer its own route"),
      ]),
      forge({ [`trak/${MERGED}`]: { state: "merged" }, [`trak/${QUIET}`]: { state: "merged" } }),
    )
    renderList()

    const pile = await screen.findByRole("list", { name: "Merged" })
    expect(within(pile).getAllByRole("listitem")).toHaveLength(1)
    expect(within(pile).getByText("give the drawer its own route")).toBeDefined()

    const held = screen.getByRole("list", { name: "Waiting" })
    expect(within(held).getAllByRole("listitem")).toHaveLength(1)
    expect(within(held).getByText("move the Asana task to Done")).toBeDefined()
    expect(within(held).getByText("Held on a condition")).toBeDefined()
    expect(within(held).getByText("Merged — checkout still here")).toBeDefined()
    expect(within(held).queryByRole("button", { name: /^Archive/ })).toBeNull()
    // Above the forge's piles and the failures both — it is about now, not about done.
    expect(lids().map((h) => h.textContent)).toEqual(["Waiting1", "Merged1"])
  })

  it("puts a draft above every other thing that would block it", async () => {
    // A draft is precisely a pull request that cannot be merged, so nothing below it on the
    // ladder is worth reporting until it is marked ready — not even a failing check.
    server.use(
      answers([done(QUIET, "sketch the settings page")]),
      forge({
        [`trak/${QUIET}`]: { isDraft: true, merging: "conflicting", checks: "failed" },
      }),
    )
    renderList()

    const inReview = await screen.findByRole("list", { name: "In review" })
    expect(within(inReview).getByText("Draft")).toBeDefined()
    expect(screen.queryByText("Conflicts")).toBeNull()
    expect(screen.queryByText("Checks failing")).toBeNull()
  })

  /**
   * The first answer the list gets about nearly every newly-finished trak: GitHub computes
   * mergeability lazily, and a trak reaches `Finished` the moment its work is pushed. This
   * used to fall the length of the ladder to the flag, so the header counting what a person
   * can land counted a branch nobody had reached a verdict on.
   */
  it("does not count a mergeability the forge has not worked out as landable", async () => {
    server.use(
      answers([done(QUIET, "move the commit to the end of a step")]),
      forge({ [`trak/${QUIET}`]: { merging: "unknown" } }),
    )
    renderList()

    const inReview = await screen.findByRole("list", { name: "In review" })
    expect(within(inReview).getByText("Not worked out yet")).toBeDefined()
    expect(screen.queryByRole("list", { name: "Ready to merge" })).toBeNull()
  })
})

/**
 * The wait on the branch going in, reaching a row through the page: the one wait that
 * yields to the forge, and only while the forge says the branch is out.
 */
describe("TraksListPage — a wait on the branch going in", () => {
  /**
   * The wait yields where it is on this very pull request going in: a trak waiting on its
   * deploy whose pull request has conflicts is filed and worded by the conflicts, with the
   * deploy's own words after them — and it still offers no *Archive*, because the wait is
   * still there.
   */
  it("files a trak waiting on deploy by its pull request while the forge says it is out", async () => {
    server.use(
      answers([
        makeTrak({
          id: MERGED,
          description: "move the Asana task to Done",
          state: { _tag: "Finished" },
          branch: `trak/${MERGED}`,
          waiting: makeWaiting({ name: "deployed" }),
        }),
      ]),
      forge({ [`trak/${MERGED}`]: { merging: "conflicting" } }),
    )
    renderList()

    const issues = await screen.findByRole("list", { name: "Has issues" })
    expect(within(issues).getByText("move the Asana task to Done")).toBeDefined()
    expect(within(issues).getByText("Conflicts")).toBeDefined()
    expect(within(issues).getByText("Not live yet")).toBeDefined()
    expect(within(issues).queryByRole("button", { name: /^Archive/ })).toBeNull()
    expect(screen.queryByRole("list", { name: "Waiting on deploy" })).toBeNull()
  })
})

/**
 * The third override, a pile of its own: the sweep's answer about a trak waiting on its
 * deploy files the row above *Waiting*, saying the word alone.
 */
describe("TraksListPage — a wait on the deploy", () => {
  /**
   * The third override: the sweep's answer about a trak waiting on its deploy files the row
   * under a pile of its own above *Waiting*, saying the answer's word alone in its tone —
   * a failed deploy in red, and still there rather than under *Has issues*.
   */
  it("files a trak waiting on its deploy under Waiting on deploy, saying what the script said", async () => {
    server.use(
      answers([
        makeTrak({
          id: MERGED,
          description: "show the sources under every reply",
          state: { _tag: "Finished" },
          branch: `trak/${MERGED}`,
          waiting: makeWaiting({ name: "deployed" }),
          deploy: makeDeploy({ answer: "not-yet" }),
        }),
        makeTrak({
          id: QUIET,
          description: "drop the legacy answers table",
          state: { _tag: "Finished" },
          branch: `trak/${QUIET}`,
          waiting: makeWaiting({ name: "deployed" }),
          deploy: makeDeploy({ answer: "gave-up" }),
        }),
        // Before its merge: no answer on the row yet, and the deploy's section all the same.
        makeTrak({
          id: CONFLICTED,
          description: "cache embeddings per organisation",
          state: { _tag: "Finished" },
          branch: `trak/${CONFLICTED}`,
          waiting: makeWaiting({ name: "deployed" }),
        }),
        makeTrak({
          id: REVIEWED,
          description: "send the release note",
          state: { _tag: "Finished" },
          branch: `trak/${REVIEWED}`,
          waiting: makeWaiting(),
        }),
      ]),
      forge({ [`trak/${MERGED}`]: { state: "merged" }, [`trak/${QUIET}`]: { state: "merged" } }),
    )
    renderList()

    const deploying = await screen.findByRole("list", { name: "Waiting on deploy" })
    expect(within(deploying).getAllByRole("listitem")).toHaveLength(3)
    // The tone is the status line's, around the word — and the same word before and
    // after the merge.
    for (const word of within(deploying).getAllByText("Not live yet"))
      expect(word.parentElement).toHaveClass("text-tone-working")
    expect(within(deploying).getAllByText("Not live yet")).toHaveLength(2)
    expect(within(deploying).getByText("Failed").parentElement).toHaveClass("text-tone-bad")
    // The word alone: no version, no time, and the forge's clause gone with them.
    expect(within(deploying).queryByText(/checkout still here/)).toBeNull()
    expect(within(deploying).queryByText("v2026.09.10-3")).toBeNull()
    expect(within(deploying).queryByRole("button", { name: /^Archive/ })).toBeNull()
    const held = screen.getByRole("list", { name: "Waiting" })
    expect(within(held).getByText("send the release note")).toBeDefined()
    expect(lids().map((h) => h.textContent)).toEqual(["Waiting on deploy3", "Waiting1"])
  })
})

/**
 * The silences, which are not one silence: an entry saying this branch has no pull request,
 * a forge nobody could reach, and an answer holding no entry for the branch at all. The
 * first is a fact about the branch and the rest are facts about us — and this tier is where
 * they are seen apart on a page rather than argued about in a map.
 */
describe("TraksListPage — what the forge did not say", () => {
  it("leaves a branch the forge has no pull request on exactly as it was", async () => {
    // A branch nobody opened a pull request for comes back as an entry with nothing in it,
    // and the row has to be untouched by that — the same words, and the same pile the
    // bottom rung uses. Nothing is stopping it, which is true.
    server.use(answers([done(QUIET, "give the drawer its own route")]), forge())
    renderList()

    const ready = await screen.findByRole("list", { name: "Ready to merge" })
    expect(within(ready).getByText("Ready to merge")).toBeDefined()
  })

  /**
   * The finding this change exists for, end to end. `gh` not being installed answers
   * `ForgeUnavailable`, which used to reach the same absence a branch with no pull request
   * reaches — so every finished trak was drawn as landable by a page that had not been able
   * to look at any of them.
   */
  it("never draws a forge it could not reach as a verdict about the work", async () => {
    server.use(answers([done(QUIET, "give the drawer its own route")]), unreachable())
    renderList()

    // Waited for by its words rather than by the section, because the section is where the
    // row sits from the first paint: *Asking GitHub…* and *Could not ask GitHub* are both
    // filed under `Finished`, so finding the list proves nothing about which one is drawn.
    await screen.findByText("Could not ask GitHub")
    const finished = screen.getByRole("list", { name: "Finished" })
    expect(within(finished).getByText("Could not ask GitHub")).toBeDefined()
    // And out of the pile whose header counts what a person could land.
    expect(screen.queryByRole("list", { name: "Ready to merge" })).toBeNull()
  })

  /**
   * An answer with no entry for this branch never looked at it, and on a branch the page
   * *is* asking about that means the answer in hand is to an older question — which is what
   * `keepPreviousData` leaves on screen the moment a trak finishes. Every finished branch
   * here is in that state, so the page holds: the placeholder stands where the piles will
   * be, and nothing claims the branch could land. (The row a *partly*-covered page draws
   * for the same absence — *Asking GitHub…* under *Finished* — is the in-flight test
   * below.)
   */
  it("will not read a branch nobody asked about as nothing being in the way", async () => {
    server.use(answers([done(QUIET, "give the drawer its own route")]), unanswered())
    renderList()

    await screen.findByText("Fetching status…")
    expect(screen.queryByText("give the drawer its own route")).toBeNull()
    expect(screen.queryByRole("list", { name: "Ready to merge" })).toBeNull()
  })

  /**
   * The cost this change is for, and the question it asks. The page used to ask once per
   * finished trak per poll, so three of them were three `gh` processes; it now asks once
   * whatever is on screen, naming every finished branch and no others.
   */
  it("asks the forge exactly once, naming every finished branch and nothing else", async () => {
    const asked: string[][] = []
    server.use(
      answers([
        done(QUIET, "give the drawer its own route"),
        done(MERGED, "widen the merge preview"),
        done(CONFLICTED, "port the seed design"),
        makeTrak({
          id: REVIEWED,
          description: "rewrite the composer prompt",
          state: { _tag: "AgentWorking", step: 1 },
          running: true,
        }),
      ]),
      http.get("*/api/pull-requests", ({ request }) => {
        const branches = new URL(request.url).searchParams.getAll("branch")
        asked.push(branches)
        return HttpResponse.json(makeListing({ entries: branches.map((branch) => ({ branch })) }))
      }),
    )
    renderList()

    await screen.findByRole("list", { name: "Ready to merge" })
    await waitFor(() => {
      expect(asked).toHaveLength(1)
    })
    // The three that ran their plan out, sorted — and not the one still working, whose
    // branch a pull request could perfectly well exist on.
    expect(asked[0]).toStrictEqual([`trak/${QUIET}`, `trak/${MERGED}`, `trak/${CONFLICTED}`].sort())
  })
})

/**
 * The other feeder of the store the rows read: a trak's own page asks a far richer question
 * about its one branch, and its answer is projected by branch into the same
 * freshest-per-branch fold the listing feeds. What only this tier can say is that an
 * answer under the *pane's* key reaches a *row*, through the real cache and the real fold.
 */
describe("TraksListPage — what a trak's own page already heard", () => {
  it("draws the pane's answer on the row without waiting for the list's own answer", async () => {
    // The list's own question is held open, so the row can only be drawn from what the
    // pane's key holds — the state a person is in stepping back to the list from a card
    // that just said *Merged*, one poll ahead of the listing.
    server.use(
      answers([done(QUIET, "give the drawer its own route")]),
      http.get("*/api/pull-requests", () => new Promise<never>(() => {})),
    )
    renderList((queryClient) => {
      queryClient.setQueryData(
        queryKeys.pullRequest(QUIET),
        makePullRequest({ branch: `trak/${QUIET}`, state: "merged" }),
      )
    })

    // No hold and no *Asking GitHub…*: the store answers for the only finished branch, so
    // the row draws classified — under *Merged*, which starts shut, its count the proof.
    const merged = await screen.findByRole("button", { name: /Merged/ })
    expect(merged.textContent).toBe("Merged1")
    expect(screen.queryByText("Fetching status…")).toBeNull()
    expect(screen.queryByText("Asking GitHub…")).toBeNull()
    expect(screen.queryByRole("list", { name: "Ready to merge" })).toBeNull()
  })

  /** *There is none* from the pane is an answer about the branch, and it draws exactly as
   *  the listing's empty entry would: the bottom rung, under *Ready to merge*. */
  it("reads the pane's no-pull-request as nothing being in the way", async () => {
    server.use(
      answers([done(QUIET, "give the drawer its own route")]),
      http.get("*/api/pull-requests", () => new Promise<never>(() => {})),
    )
    renderList((queryClient) => {
      queryClient.setQueryData(queryKeys.pullRequest(QUIET), {
        _tag: "NoPullRequest",
        branch: `trak/${QUIET}`,
      })
    })

    const ready = await screen.findByRole("list", { name: "Ready to merge" })
    expect(within(ready).getByText("give the drawer its own route")).toBeDefined()
    expect(screen.queryByText("Fetching status…")).toBeNull()
  })
})

/**
 * The branch set is the question and the question is the cache key, so the set changing is
 * a different key with nothing cached under it — and the set changes on the most ordinary
 * event this screen has: a trak finishing, or one being merged out of the pile.
 *
 * Both cases below are the same failure seen from two ends. **An answer nobody has must
 * never draw as a verdict**, and on this page the default verdict is the worst one
 * available: a finished row the ladder never reached is filed under the header that counts
 * what a person could land.
 */
describe("TraksListPage — when the set of finished branches changes", () => {
  it("keeps a conflicting row out of the landable pile while the next answer is in flight", async () => {
    let release: (() => void) | undefined
    server.use(
      answers([done(CONFLICTED, "port the seed design")]),
      http.get("*/api/pull-requests", async ({ request }) => {
        const branches = new URL(request.url).searchParams.getAll("branch")
        // The second question — the one asked once a second trak has finished — is held
        // open. That gap is where every finished row used to fall through to the flag.
        if (branches.length > 1) {
          await new Promise<void>((resolve) => {
            release = resolve
          })
        }
        const entries: PullRequestEntryDto[] = branches.map((branch) =>
          branch === `trak/${CONFLICTED}`
            ? { branch, pull: makePullRequestSummary({ merging: "conflicting" }) }
            : { branch },
        )
        return HttpResponse.json(makeListing({ entries }))
      }),
    )
    const queryClient = renderList()

    expect(
      within(await screen.findByRole("list", { name: "Has issues" })).getByText("Conflicts"),
    ).toBeDefined()

    server.use(
      answers([
        done(CONFLICTED, "port the seed design"),
        done(QUIET, "give the drawer its own route"),
      ]),
    )
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.traks })
    })

    // The second trak is on the page, so the new branch set is what is being asked about.
    // No hold — the other row has a real rung — so the new row draws, saying it is still
    // being asked about, under the pile that claims nothing.
    await screen.findByText("give the drawer its own route")
    expect(
      within(screen.getByRole("list", { name: "Finished" })).getByText("Asking GitHub…"),
    ).toBeDefined()
    // And the first row still says what the answer in hand says about its branch.
    expect(
      within(screen.getByRole("list", { name: "Has issues" })).getByText("Conflicts"),
    ).toBeDefined()
    const ready = screen.queryByRole("list", { name: "Ready to merge" })
    expect(ready === null ? null : within(ready).queryByText("port the seed design")).toBeNull()

    release?.()
  })

  /**
   * Past the bound the branches are not asked about, which the rows say for themselves.
   * What must not happen is the request growing until the server refuses the whole read —
   * that arrives as no answer at all, which is the case above with every row in it.
   */
  it("asks about no more branches than one call may carry, and says so on the rest", async () => {
    const finished = Array.from({ length: branchLimit + 2 }, (_, i) =>
      done(nth(i), `work ${String(i).padStart(4, "0")}`),
    )
    let asked: readonly string[] = []
    server.use(
      answers(finished),
      http.get("*/api/pull-requests", ({ request }) => {
        asked = new URL(request.url).searchParams.getAll("branch")
        return HttpResponse.json(makeListing({ entries: asked.map((branch) => ({ branch })) }))
      }),
    )
    renderList()

    const ready = await screen.findByRole("list", { name: "Ready to merge" })
    await waitFor(() => {
      expect(asked).toHaveLength(branchLimit)
    })
    expect(within(ready).getAllByRole("listitem")).toHaveLength(branchLimit)

    // The two past the bound: nobody asked about them, so nothing is claimed about them.
    const unasked = screen.getByRole("list", { name: "Finished" })
    expect(within(unasked).getAllByText("Could not ask GitHub")).toHaveLength(2)
  })
})

/**
 * The hold, end to end: on a first load with finished traks, no finished row is drawn
 * until GitHub has answered — the piles appear already classified rather than as
 * *Finished* then scattering a `gh` call later. The hold itself is tier-1
 * (`hold.test.ts`); what only this tier can say is which rows keep drawing while it
 * holds, and that the block dissolves the moment the answer lands.
 */
describe("TraksListPage — the hold", () => {
  it("holds the finished work while GitHub is asked, and everything else draws", async () => {
    let release: (() => void) | undefined
    server.use(
      answers([
        ...traks,
        makeTrak({
          id: "77777777-2222-4333-8444-555555555555",
          description: "teach the daemon record to survive a reboot",
          state: { _tag: "Failed", kind: "worktree", error: "could not create the checkout" },
        }),
        done(QUIET, "give the drawer its own route"),
      ]),
      http.get("*/api/pull-requests", async ({ request }) => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        const branches = new URL(request.url).searchParams.getAll("branch")
        return HttpResponse.json(makeListing({ entries: branches.map((branch) => ({ branch })) }))
      }),
    )
    renderList()

    // While the answer is in flight: the gate, the running row and the failure are all on
    // the page, the placeholder stands where the piles will be, and the finished trak is
    // nowhere — not under any header, and above all not under *Ready to merge*. The block
    // wears no lid, so the buttons are exactly the three real sections' — with *Errors*
    // above the block, not under it.
    await screen.findByText("Fetching status…")
    expect(screen.getByRole("link", { name: "add a client" })).toBeDefined()
    expect(screen.getByRole("link", { name: "rewrite the composer prompt" })).toBeDefined()
    expect(
      within(screen.getByRole("list", { name: "Errors" })).getByText(
        "teach the daemon record to survive a reboot",
      ),
    ).toBeDefined()
    expect(lids().map((h) => h.textContent)).toEqual(["Needs you1", "In progress1", "Errors1"])
    expect(screen.queryByText("give the drawer its own route")).toBeNull()
    expect(screen.queryByRole("list", { name: "Ready to merge" })).toBeNull()

    // The answer lands: the block dissolves and the row appears once, already classified —
    // and *Errors* is above *Ready to merge*, where the block stood.
    await waitFor(() => {
      expect(release).toBeDefined()
    })
    release?.()
    const ready = await screen.findByRole("list", { name: "Ready to merge" })
    expect(within(ready).getByText("give the drawer its own route")).toBeDefined()
    expect(screen.queryByText("Fetching status…")).toBeNull()
    expect(lids().map((h) => h.textContent)).toEqual([
      "Needs you1",
      "In progress1",
      "Errors1",
      "Ready to merge1",
    ])
  })

  /**
   * The hold is by the group, not the trak: a finished piece on a running parent's band
   * has no pile for the forge to decide, so it must not buy a ghost row and must not
   * leave the band while the block stands — it keeps saying its own asking words there.
   */
  it("keeps a spawn's band while the block stands", async () => {
    let release: (() => void) | undefined
    server.use(
      answers([
        spawn,
        makeTrak({
          id: "aaaaaaaa-2222-4333-8444-555555555555",
          description: "review it for performance",
          state: { _tag: "Finished" },
          branch: "trak/review-performance",
          parent: makeParent({ id: SPAWN_ID, step: 2, child: 0 }),
        }),
        done(QUIET, "give the drawer its own route"),
      ]),
      http.get("*/api/pull-requests", async ({ request }) => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        const branches = new URL(request.url).searchParams.getAll("branch")
        return HttpResponse.json(makeListing({ entries: branches.map((branch) => ({ branch })) }))
      }),
    )
    renderList()

    // The block stands for the flat finished trak — and the spawn is whole above it:
    // the parent's row, and the finished piece still a column on its band, saying that
    // it is still being asked about rather than vanishing for the length of the call.
    await screen.findByText("Fetching status…")
    expect(screen.queryByText("give the drawer its own route")).toBeNull()
    const band = screen.getByRole("list", { name: "Pieces of Review the client end to end" })
    expect(within(band).getByText("review it for performance")).toBeDefined()
    expect(within(band).getByText("Asking GitHub…")).toBeDefined()

    await waitFor(() => {
      expect(release).toBeDefined()
    })
    release?.()
  })
})

describe("TraksListPage sections", () => {
  it("groups the list, drops a section with nothing in it, and counts the archive under a header that is not a lid", async () => {
    server.use(answers(traks, 2))
    renderList()

    // Sections, top to bottom, by what is owed. Nothing has finished or failed here,
    // and those headers are absent rather than empty — the whole of what an empty
    // section draws.
    await screen.findByText("Needs you")
    const headings = lids()
    expect(headings.map((h) => h.textContent)).toEqual(["Needs you1", "In progress1"])
    expect(headings.map((h) => h.getAttribute("aria-expanded"))).toEqual(["true", "true"])

    // The archive is the count the engine sent and nothing else: no row was sent for a
    // put-away trak, so there is nothing to fold and the header is not a button.
    const archived = screen.getByText("Archived")
    expect(archived.parentElement?.textContent).toBe("Archived2")
    expect(screen.queryByRole("button", { name: /Archived/ })).toBeNull()
    expect(archived.closest("[aria-expanded]")).toBeNull()
  })

  it("draws no archived header when nothing is put away", async () => {
    server.use(answers(traks))
    renderList()

    await screen.findByText("Needs you")
    expect(screen.queryByText("Archived")).toBeNull()
  })

  it("orders a section by the most recent human touch", async () => {
    server.use(
      answers([
        gate("dddddddd-2222-4333-8444-555555555555", "older gate", 10),
        gate("eeeeeeee-2222-4333-8444-555555555555", "newer gate", 20),
      ]),
    )
    renderList()

    await screen.findByText("newer gate")
    const rows = screen.getAllByRole("listitem").map((r) => r.textContent)
    expect(rows[0]).toContain("newer gate")
    expect(rows[1]).toContain("older gate")
  })
})

describe("TraksListPage — the section lid", () => {
  it("folds a section that is not one of the endings", async () => {
    // Every header is a lid, so the one over live work folds too — the point of the
    // whole change: `In progress` down to a count while you work through `Needs you`.
    server.use(answers(traks))
    renderList()

    await screen.findByText("rewrite the composer prompt")
    const lid = screen.getByRole("button", { name: /In progress/ })
    expect(lid.getAttribute("aria-expanded")).toBe("true")

    fireEvent.click(lid)
    expect(lid.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByText("rewrite the composer prompt")).toBeNull()
    // The header survives the fold whole — title, tone and number.
    expect(lid.textContent).toBe("In progress1")
    // And the section above it is untouched: one lid, not a page-wide one.
    expect(screen.getByText("add a client")).toBeDefined()

    fireEvent.click(lid)
    expect(await screen.findByText("rewrite the composer prompt")).toBeDefined()
  })

  it("leaves a folded section folded when it empties and work arrives in it again", async () => {
    // A lid that reopened itself is one you could not leave down. The count on the
    // header is the whole of the notice — including across the gap where the section
    // held nothing and was not drawn at all.
    server.use(answers(traks))
    const queryClient = renderList()

    await screen.findByText("rewrite the composer prompt")
    fireEvent.click(screen.getByRole("button", { name: /In progress/ }))
    expect(screen.getByRole("button", { name: /In progress/ }).getAttribute("aria-expanded")).toBe(
      "false",
    )

    const reanswer = async (body: readonly TrakSummaryDto[]): Promise<void> => {
      server.use(answers(body))
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: queryKeys.traks })
      })
    }

    // Everything running has landed: the section is gone, header and all.
    await reanswer(traks.slice(0, 1))
    await waitFor(() => {
      expect(screen.queryByText("In progress")).toBeNull()
    })

    // And back, with two in it. Still shut, and the number is what says so.
    await reanswer([
      ...traks,
      makeTrak({
        id: "eeeeeeee-2222-4333-8444-555555555555",
        description: "give the drawer its own route",
        state: { _tag: "AgentWorking", step: 0 },
        running: true,
      }),
    ])
    const lid = await screen.findByRole("button", { name: /In progress/ })
    expect(lid.getAttribute("aria-expanded")).toBe("false")
    expect(lid.textContent).toBe("In progress2")
    expect(screen.queryByText("rewrite the composer prompt")).toBeNull()
  })
})

describe("TraksListPage nothing open", () => {
  it("says nothing is in hand when every trak is put away", async () => {
    server.use(answers([], 2))
    renderList()

    // No row and a count: on its own the page would open as the archived header over
    // nothing. The notice stands where the sections would, with a way to start
    // something — a link to the same form as the app bar's — and the header below it.
    expect(await screen.findByRole("heading", { name: "Nothing in hand" })).toBeDefined()
    const starts = screen.getAllByRole("link", { name: "New Trak" })
    expect(starts.map((a) => a.getAttribute("href"))).toEqual(["/traks/new", "/traks/new"])
    expect(lids()).toEqual([])
    expect(screen.getByText("Archived").parentElement?.textContent).toBe("Archived2")
  })

  it("does not say so of a section a person shut themselves", async () => {
    server.use(answers(traks.slice(0, 1)))
    renderList()

    await screen.findByText("add a client")
    expect(screen.queryByRole("heading", { name: "Nothing in hand" })).toBeNull()

    // The only section on the page, folded by hand: a person who shut it knows what is
    // under it, and the count on the header is the whole of the notice.
    fireEvent.click(screen.getByRole("button", { name: /Needs you/ }))
    expect(screen.queryByText("add a client")).toBeNull()
    expect(screen.queryByRole("heading", { name: "Nothing in hand" })).toBeNull()
  })

  it("does not say so while the finished work is held for the forge", async () => {
    let release: (() => void) | undefined
    server.use(
      answers([done(QUIET, "give the drawer its own route")], 1),
      http.get("*/api/pull-requests", async ({ request }) => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        const branches = new URL(request.url).searchParams.getAll("branch")
        return HttpResponse.json(makeListing({ entries: branches.map((branch) => ({ branch })) }))
      }),
    )
    renderList()

    // Held, the archive's header is the only one drawn — but the block stands for live
    // work the forge has yet to file, and a notice saying nothing is in hand would be
    // false.
    await screen.findByText("Fetching status…")
    expect(lids()).toEqual([])
    expect(screen.getByText("Archived").parentElement?.textContent).toBe("Archived1")
    expect(screen.queryByRole("heading", { name: "Nothing in hand" })).toBeNull()

    await waitFor(() => {
      expect(release).toBeDefined()
    })
    release?.()
    await screen.findByRole("list", { name: "Ready to merge" })
    expect(screen.queryByRole("heading", { name: "Nothing in hand" })).toBeNull()
  })
})

describe("TraksListPage section counts", () => {
  it("counts groups rather than traks under a section header", async () => {
    // A spawn of two gated pieces plus one ordinary gate is `Needs you 2`, not 4. A
    // count that disagreed with the rows under it would be the worse of the two.
    server.use(
      answers([
        {
          id: PARENT_ID,
          description: "add a client",
          state: { _tag: "AwaitingChildren", step: 2 },
          running: false,
          mode: "manual",
          branchMoved: false,
        },
        {
          id: "ffffffff-2222-4333-8444-555555555555",
          description: "give the drawer its own route",
          state: { _tag: "AwaitingHuman", step: 2, kind: "answers" },
          running: false,
          mode: "manual",
          branchMoved: false,
          parent: { id: PARENT_ID, step: 2, child: 0, depth: 1 },
        },
        {
          id: "eeeeeeee-2222-4333-8444-555555555555",
          description: "name a row by its plan",
          state: { _tag: "AwaitingHuman", step: 1, kind: "approval" },
          running: false,
          mode: "manual",
          branchMoved: false,
          parent: { id: PARENT_ID, step: 2, child: 1, depth: 1 },
        },
        gate("dddddddd-2222-4333-8444-555555555555", "a gate of its own", 10),
      ]),
    )
    renderList()

    const header = (await screen.findByText("Needs you")).parentElement
    expect(header?.textContent).toBe("Needs you2")

    // And the pieces are still on the page — as columns of the group, never as rows.
    const band = screen.getByRole("list", { name: "Pieces of add a client" })
    expect(within(band).getAllByRole("listitem")).toHaveLength(2)
  })
})

describe("TraksListPage — the git bar", () => {
  const behind = makeHostGit({ upstream: { name: "origin/main", ahead: 0, behind: 3 } })

  it("draws the branch on the left and the one action on the right, with Fetch behind the chevron", async () => {
    server.use(
      answers(traks),
      forge(),
      http.get("*/api/git", () =>
        HttpResponse.json(makeHostGit({ upstream: { name: "origin/main", ahead: 1, behind: 4 } })),
      ),
    )
    renderList()
    const bar = await screen.findByRole("contentinfo", { name: "Project checkout" })
    // Diverged: the one action is the merge, and nothing about it rises by itself.
    expect(await within(bar).findByRole("button", { name: "Reconcile" })).toBeEnabled()
    expect(within(bar).queryByRole("button", { name: "Pull" })).not.toBeInTheDocument()
    expect(within(bar).queryByRole("button", { name: "Push" })).not.toBeInTheDocument()
    expect(within(bar).queryByRole("alert")).not.toBeInTheDocument()

    fireEvent.click(within(bar).getByRole("button", { name: "More git actions" }))
    expect(within(bar).getByRole("menuitem", { name: /Fetch/ })).toBeEnabled()

    fireEvent.click(within(bar).getByRole("button", { name: "Project checkout: main" }))
    const card = within(bar).getByRole("dialog", { name: "Project checkout" })
    expect(within(card).getByText("Diverged from origin/main")).toBeInTheDocument()
    expect(within(card).getByText(/Reconcile merges the 4 commits/)).toBeInTheDocument()
    // The card holds no press: the action is on the bar it hangs off.
    expect(within(card).queryAllByRole("button")).toEqual([])
  })

  it("raises a notice for a pull a dirty tree refused, and pulls around a stash from it", async () => {
    const pulls: unknown[] = []
    server.use(
      answers(traks),
      forge(),
      http.get("*/api/git", () => HttpResponse.json(behind)),
      http.post("*/api/git/pull", async ({ request }) => {
        const body = await request.json()
        pulls.push(body)
        return pulls.length === 1
          ? HttpResponse.json(
              { _tag: "Dirty", files: ["M README.md", "?? new.txt"] },
              { status: 409 },
            )
          : HttpResponse.json(makeHostGit())
      }),
    )
    renderList()
    const bar = await screen.findByRole("contentinfo", { name: "Project checkout" })
    fireEvent.click(await within(bar).findByRole("button", { name: "Pull" }))

    const notice = await within(bar).findByRole("alert")
    expect(
      within(notice).getByText("Pull refused — 2 files have uncommitted changes"),
    ).toBeInTheDocument()
    expect(within(notice).getByText("M README.md")).toBeInTheDocument()
    expect(within(notice).getByText("?? new.txt")).toBeInTheDocument()
    // The action cell does not change: the way through is in the notice.
    expect(within(bar).getByRole("button", { name: "Pull" })).toBeEnabled()

    fireEvent.click(within(notice).getByRole("button", { name: "Stash & pull" }))
    await within(bar).findByRole("button", { name: "Fetch" })
    expect(pulls).toEqual([{}, { stash: true }])
    expect(within(bar).queryByRole("alert")).not.toBeInTheDocument()
  })

  it("leaves a dismissed problem's title on the bar, left of the action", async () => {
    server.use(
      answers(traks),
      forge(),
      http.get("*/api/git", () => HttpResponse.json(behind)),
      http.post("*/api/git/pull", () =>
        HttpResponse.json({ _tag: "Dirty", files: ["M README.md"] }, { status: 409 }),
      ),
    )
    renderList()
    const bar = await screen.findByRole("contentinfo", { name: "Project checkout" })
    fireEvent.click(await within(bar).findByRole("button", { name: "Pull" }))
    const notice = await within(bar).findByRole("alert")

    fireEvent.click(within(notice).getByRole("button", { name: "Dismiss" }))

    expect(within(bar).queryByRole("alert")).not.toBeInTheDocument()
    expect(
      within(bar).getByText("Pull refused — 1 file has uncommitted changes"),
    ).toBeInTheDocument()
    expect(within(bar).queryByRole("button", { name: "Stash & pull" })).not.toBeInTheDocument()
  })
})

describe("TraksListPage — the project checkout's processes", () => {
  const running = makeHostedProcess({
    name: "atelier",
    log: "gallery ready\n",
    state: {
      _tag: "Running",
      port: 30377,
      startedAt: 0,
      readyAt: 0,
      url: "http://[::1]:30377/",
    },
  })
  const idle = makeHostedProcess({ name: "walkdown" })

  it("tallies them in a cell of the strip, and starts one from its popover", async () => {
    const started: string[] = []
    server.use(
      answers(traks),
      forge(),
      http.get("*/api/processes", () => HttpResponse.json({ processes: [running, idle] })),
      http.post("*/api/processes/:name/start", ({ params }) => {
        started.push(String(params["name"]))
        return HttpResponse.json(running)
      }),
    )
    renderList()
    const bar = await screen.findByRole("contentinfo", { name: "Project checkout" })
    const cell = await within(bar).findByRole("button", {
      name: "Project checkout's processes: 1 running",
    })
    expect(cell).toHaveTextContent("1 running")

    fireEvent.click(cell)
    const pop = within(bar).getByRole("dialog", { name: "Project checkout's processes" })
    const rows = within(pop).getAllByRole("listitem")
    expect(rows.map((row) => row.querySelector(".font-mono")?.textContent)).toEqual([
      "atelier",
      "walkdown",
    ])
    // The page opens in a browser tab, from the running row alone.
    expect(within(pop).getByRole("link", { name: "[::1]:30377" })).toHaveAttribute(
      "target",
      "_blank",
    )
    expect(within(pop).getByRole("button", { name: "Stop atelier" })).toBeEnabled()

    fireEvent.click(within(pop).getByRole("button", { name: "Start walkdown" }))
    await waitFor(() => {
      expect(started).toEqual(["walkdown"])
    })
  })

  it("shows a process's log in the list's place, and goes back", async () => {
    server.use(
      answers(traks),
      forge(),
      http.get("*/api/processes", () => HttpResponse.json({ processes: [running, idle] })),
    )
    renderList()
    const bar = await screen.findByRole("contentinfo", { name: "Project checkout" })
    fireEvent.click(await within(bar).findByRole("button", { name: /processes: 1 running/ }))
    const pop = within(bar).getByRole("dialog", { name: "Project checkout's processes" })

    fireEvent.click(within(pop).getByRole("button", { name: "Show atelier's log" }))
    expect(within(pop).getByLabelText("atelier's log")).toHaveTextContent("gallery ready")
    expect(within(pop).queryByText("walkdown")).not.toBeInTheDocument()

    fireEvent.click(within(pop).getByRole("button", { name: "Processes" }))
    expect(within(pop).getByText("walkdown")).toBeInTheDocument()
  })

  it("says so quietly when the project declares none", async () => {
    server.use(answers(traks), forge())
    renderList()
    const bar = await screen.findByRole("contentinfo", { name: "Project checkout" })
    const cell = await within(bar).findByRole("button", {
      name: "Project checkout's processes: none declared",
    })
    expect(cell).toHaveTextContent("No processes")
    fireEvent.click(cell)
    expect(within(bar).getByText(/This project declares no processes/)).toBeInTheDocument()
  })
})

describe("TraksListPage — the git bar's way through", () => {
  const behind = makeHostGit({ upstream: { name: "origin/main", ahead: 0, behind: 3 } })

  it("draws a failure nobody here pressed for as already put away, and raises one a press earns", async () => {
    server.use(
      answers(traks),
      forge(),
      // What the first poll finds: the engine's own five-minute fetch failed.
      http.get("*/api/git", () => HttpResponse.json(failed(40))),
      http.post("*/api/git/fetch", () => HttpResponse.json(failed(90))),
    )
    renderList()
    const bar = await screen.findByRole("contentinfo", { name: "Project checkout" })
    // Its title on the bar, and no notice over the list.
    expect(await within(bar).findByText("Fetch failed")).toBeInTheDocument()
    expect(within(bar).queryByRole("alert")).not.toBeInTheDocument()

    // The same failure once a person has pressed Fetch and git failed it again.
    fireEvent.click(within(bar).getByRole("button", { name: "Fetch" }))
    const notice = await within(bar).findByRole("alert")
    expect(within(notice).getByText("no route to host")).toBeInTheDocument()
  })

  it("says where the changes went when a stash kept them", async () => {
    server.use(
      answers(traks),
      forge(),
      http.get("*/api/git", () => HttpResponse.json(behind)),
      http.post("*/api/git/pull", async ({ request }) => {
        const body = await request.json()
        return isStash(body)
          ? HttpResponse.json({ ...makeHostGit(), stashed: { files: ["README.md"] } })
          : HttpResponse.json({ _tag: "Dirty", files: ["M README.md"] }, { status: 409 })
      }),
    )
    renderList()
    const bar = await screen.findByRole("contentinfo", { name: "Project checkout" })
    fireEvent.click(await within(bar).findByRole("button", { name: "Pull" }))
    fireEvent.click(await within(bar).findByRole("button", { name: "Stash & pull" }))

    await within(bar).findByText("Pulled — your changes are in the stash")
    const notice = within(bar).getByRole("alert")
    expect(within(notice).getByText("README.md")).toBeInTheDocument()
    // Nothing to press but the dismiss: settling a stash is a person's.
    expect(
      within(notice)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Dismiss"])
  })

  it("opens the New Trak page on the engine's request when a reconcile would conflict", async () => {
    server.use(
      answers(traks),
      forge(),
      http.get("*/api/git", () =>
        HttpResponse.json(makeHostGit({ upstream: { name: "origin/main", ahead: 1, behind: 4 } })),
      ),
      http.post("*/api/git/reconcile", () =>
        HttpResponse.json(
          {
            _tag: "Conflict",
            files: ["README.md"],
            description: "Merge `origin/main` into `main` and resolve the conflicts.",
          },
          { status: 409 },
        ),
      ),
    )
    renderList()
    const bar = await screen.findByRole("contentinfo", { name: "Project checkout" })
    fireEvent.click(await within(bar).findByRole("button", { name: "Reconcile" }))
    await within(bar).findByText("Reconcile stopped — 1 file conflicts")

    fireEvent.click(within(bar).getByRole("button", { name: "Resolve in a Trak" }))

    // Nothing was started: the request is in the field, and the person presses New Trak.
    const field = await screen.findByLabelText("What do you want done?")
    expect(field).toHaveValue("Merge `origin/main` into `main` and resolve the conflicts.")
    // The notice stood over that page's corner, so it is put away; the bar is as it was.
    expect(within(bar).queryByRole("alert")).not.toBeInTheDocument()
    expect(within(bar).getByRole("button", { name: "Reconcile" })).toBeEnabled()
  })
})

/** The bar with a fetch the engine failed at `at`. */
const failed = (at: number) =>
  makeHostGit({ failure: { action: "fetch", message: "no route to host", at } })

/** Whether a press asked to run around a stash. */
const isStash = (body: unknown): boolean =>
  typeof body === "object" && body !== null && "stash" in body && body.stash === true

const filesPanel = () => screen.queryByRole("dialog", { name: "Project files" })
const trakDrawer = () => screen.queryByRole("complementary", { name: "Trak" })
/** The strip's Files cell, which is outside the list. */
const filesCell = () =>
  within(screen.getByRole("contentinfo", { name: "Project checkout" })).getByRole("button", {
    name: /Files/,
  })

/**
 * Only one drawer at a time: the Files panel from the left and a route's drawer from the
 * right each take most of the window, so opening one shuts the other.
 */
describe("TraksListPage — one drawer at a time", () => {
  const ID = "11111111-2222-4333-8444-555555555555"
  const files = () => [
    answers(traks),
    http.get("*/api/files", () => HttpResponse.json({ paths: ["README.md"] })),
    http.get("*/api/files/search", () => HttpResponse.json({ matches: [], cut: false })),
    http.get("*/api/traks/archived", () => HttpResponse.json({ traks: [] })),
    http.get("*/api/traks/:id", () => HttpResponse.json(makeDetail({ id: ID }))),
  ]

  afterEach(() => {
    setPaletteOpen(false)
  })

  it("leaves a trak's route when Files opens over it", async () => {
    server.use(...files())
    renderList(undefined, `/traks/${ID}`)
    await waitFor(() => {
      expect(trakDrawer()).not.toBeNull()
    })

    fireEvent.click(filesCell())
    expect(filesPanel()).not.toBeNull()
    await waitFor(() => {
      expect(trakDrawer()).toBeNull()
    })
    expect(filesPanel()).not.toBeNull()
  })

  it("shuts Files when a row opens a trak", async () => {
    server.use(...files())
    renderList()
    fireEvent.click(await screen.findByRole("link", { name: "add a client" }))
    await waitFor(() => {
      expect(trakDrawer()).not.toBeNull()
    })
    fireEvent.click(filesCell())
    await waitFor(() => {
      expect(trakDrawer()).toBeNull()
    })

    fireEvent.click(screen.getByRole("link", { name: "add a client" }))
    await waitFor(() => {
      expect(trakDrawer()).not.toBeNull()
    })
    expect(filesPanel()).toBeNull()
  })

  it("shuts Files when ⌘K opens a trak", async () => {
    server.use(...files())
    renderList()
    await screen.findByRole("link", { name: "add a client" })
    fireEvent.click(filesCell())
    expect(filesPanel()).not.toBeNull()

    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    const palette = await screen.findByRole("dialog", { name: "Search" })
    fireEvent.change(within(palette).getByRole("searchbox"), { target: { value: "client" } })
    fireEvent.click(
      await within(within(palette).getByRole("region", { name: "Traks" })).findByRole("link", {
        name: "add a client",
      }),
    )
    await waitFor(() => {
      expect(trakDrawer()).not.toBeNull()
    })
    expect(filesPanel()).toBeNull()
  })
})

describe("TraksListPage — a finished row's Archive", () => {
  /**
   * A finished row's *Archive* asks on the row rather than opening the drawer: the
   * drawer's own confirmation, worded for what the forge says, and its press archives.
   */
  it("confirms Archive on the row, and archives from there", async () => {
    const closed: string[] = []
    server.use(
      answers([done(MERGED, "move the Asana task to Done")]),
      forge({ [`trak/${MERGED}`]: { state: "merged" } }),
      http.post("*/api/traks/:id/close", ({ params }) => {
        closed.push(String(params["id"]))
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderList()

    const row = await screen.findByRole("list", { name: "Merged" })
    fireEvent.click(
      within(row).getByRole("button", { name: "Archive — move the Asana task to Done" }),
    )
    const panel = screen.getByRole("dialog", { name: "Archive this trak?" })
    expect(within(panel).getByText(/The merge commit stays\./)).toBeDefined()
    // Asking navigated nowhere: the drawer is not open.
    expect(trakDrawer()).toBeNull()

    fireEvent.keyDown(panel, { key: "Escape" })
    expect(screen.queryByRole("dialog")).toBeNull()
    fireEvent.click(within(row).getByRole("button", { name: /^Archive/ }))

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }))
    expect(screen.queryByRole("dialog")).toBeNull()

    fireEvent.click(within(row).getByRole("button", { name: /^Archive/ }))
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }))
    await waitFor(() => {
      expect(closed).toEqual([MERGED])
    })
  })

  /**
   * A forge nobody could ask has said nothing about the branch, so the panel says what is
   * true whether or not it went in — never *Nothing on that branch is kept*.
   */
  it("words Archive neutrally on a row it could not ask GitHub about", async () => {
    server.use(answers([done(QUIET, "give the drawer its own route")]), unreachable())
    renderList()

    const row = await screen.findByRole("list", { name: "Finished" })
    await within(row).findByText("Could not ask GitHub")
    fireEvent.click(within(row).getByRole("button", { name: /^Archive/ }))
    const panel = screen.getByRole("dialog", { name: "Archive this trak?" })
    expect(within(panel).getByText(/Only what was merged from it stays\./)).toBeDefined()
    expect(within(panel).queryByText(/Nothing on that branch is kept/)).toBeNull()
  })
})
