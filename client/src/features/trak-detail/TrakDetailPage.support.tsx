/**
 * The trak page's tier-2 setup — the forge's default answers, the scene most cases start
 * from and the presses they move through — shared so the page's tests can run as several
 * files in parallel rather than one file in series.
 */

import { afterAll, afterEach, beforeAll, expect, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
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
  makeHumanActed,
  makePlan,
  makeProposal,
  makeSession,
  makeSpawned,
  makeTool,
  makeTrakCreated,
  makeWorkCommitted,
  makeHostGit,
  makeCliUsage,
} from "../../fixtures"
import { routeTree } from "../../routes"

/**
 * **The forge answers *no pull request* by default, and it is a default rather than a
 * `server.use`.** Every one of the five finished states asks this route, so leaving it
 * unhandled would fail two dozen cases here on a request none of them is about — and it is
 * passed to `setupServer` rather than registered per test because `resetHandlers` keeps
 * exactly what was given here. A case about a pull request overrides it.
 */
export const server = setupServer(
  http.get("*/api/traks/:id/pull-request", () => HttpResponse.json({ _tag: "NoPullRequest" })),
  // The deploy is asked at the two ended states with a merge commit, and a project with no
  // `deploy.sh` says so — the default, so no case is about the block unless it says so.
  http.get("*/api/traks/:id/deploy", () => HttpResponse.json({ answer: "none" })),
  // The root route is behind the session gate, and an engine with no passphrase says
  // come in. The same reason: a default, so `resetHandlers` keeps it.
  http.get("*/api/session", () => new HttpResponse(null, { status: 204 })),
  // The git bar, which every screen under the list draws.
  http.get("*/api/git", () => HttpResponse.json(makeHostGit())),
  // The git bar's usage cell: never read.
  http.get("*/api/usage", () => HttpResponse.json({ clis: [makeCliUsage()] })),
  // The goal banner over the list, which every screen under it draws.
  http.get("*/api/goals", () => HttpResponse.json({ goals: [] })),
  // The header asks which terminals and editors the engine's machine has on every
  // desk-width mount, and the platform's no — the 404 — is the default here so no case
  // is about the controls unless it says so. The cases that are override with a listing.
  http.get("*/api/openers", () => new HttpResponse(null, { status: 204 })),
  // The header asks which hosted processes the project declares on every mount, and a
  // project with none is the default — the side panel's own cases are `SidePanel.test.tsx`.
  http.get("*/api/traks/:id/processes", () => HttpResponse.json({ processes: [] })),
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

export const ID = "11111111-2222-4333-8444-555555555555"

export const TITLE = "Add a read-only client"

/**
 * The trak this file is about: a plan of two steps, both run, standing at the gate after
 * the second. Not a bare floor — most cases here layer one field onto this whole scene.
 */
export const detail = (over: Partial<TrakDetailDto> = {}): TrakDetailDto =>
  makeDetail({
    id: ID,
    state: { _tag: "AwaitingHuman", step: 2, kind: "approval" },
    // The compose that wrote the plan is the plan's first entry, so the work starts at 1.
    plan: makePlan({
      title: TITLE,
      steps: [
        makeComposeEntry(),
        makeAgentStep({ agent: "planner", instruction: "sketch the routes" }),
        makeAgentStep({ agent: "builder", instruction: "build the drawer" }),
      ],
    }),
    log: [
      makeTrakCreated(),
      makeComposerReturned({ sessionId: "s-plan", output: makeProposal({ title: TITLE }) }),
      makeAgentReturned({ step: 1, sessionId: "s-0" }),
      makeAgentReturned({ step: 2, sessionId: "s-1" }),
    ],
    transcript: [
      makeSpawned({ pid: 100 }),
      makeSession({ id: "s-plan" }),
      makeTool({ name: "Glob", kind: "Glob", detail: "**/*.ts" }),
      makeSpawned({ pid: 200 }),
      makeSession({ id: "s-0" }),
      makeTool({ detail: "src/plan.md" }),
      makeSpawned({ pid: 300 }),
      makeSession({ id: "s-1" }),
      makeTool({ name: "Edit", kind: "Edit", detail: "src/app/dto.ts" }),
    ],
    ...over,
  })
export const PLANNED = "Read 1 file"
export const BUILT = "Edited 1 file"

/**
 * Open a folded call, so the path it names is on screen.
 *
 * Only where the phrase cannot answer the question — two positions that both read a file
 * say the same words, and the path underneath is the whole of the difference.
 */
export const openCall = async (name: string): Promise<void> => {
  fireEvent.click(await screen.findByRole("button", { name }))
}

/**
 * The drawer under a memory history, and the router it is given back.
 *
 * The router is returned because the position lives in the URL now: a case about *where a
 * link lands* has to read `state.location` rather than infer it from what drew.
 */
export const renderAt = (path: string) => {
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
  return router
}

export const renderDetail = (): void => {
  renderAt(`/traks/${ID}`)
}

export const answers = (body: TrakDetailDto) =>
  http.get(`*/api/traks/${ID}`, () => HttpResponse.json(body))

/**
 * The loaded drawer, waited for by the one control the frame before it words differently.
 *
 * `LoadingDrawer` draws the real `StepBar` with everything in it disabled, so a query that
 * waits for *Map* or *Previous step* to **appear** resolves on the frame that cannot be
 * pressed — and an assertion that something is absent passes on it for the wrong reason.
 * The loading frame labels its chat field `Loading the trak…` on purpose, which leaves the
 * loaded page's own label as the unambiguous thing to wait for.
 */
export const loaded = (): Promise<HTMLElement> =>
  screen.findByRole("textbox", { name: "Say something to the agent" })

/** Press something in the navigator, once the drawer behind it is the real one. */
export const press = async (name: string | RegExp): Promise<void> => {
  await loaded()
  fireEvent.click(screen.getByRole("button", { name }))
}

/**
 * The map's own rows, and never the rail's.
 *
 * `TrakRail` draws every position down the edge of the pane under the *same* accessible
 * names the map's rows carry, so an unscoped query for one finds two. That is a fact about
 * the screen rather than about the test — the two lists are labelled *Plan* and *Positions*
 * so a reader can tell them apart, and this asks the same question a reader would.
 */
// No return annotation: `within` is generic over its query set, and naming a type here
// collapses it to `any`, which the type-aware lint then reports at every call site.
export const map = () => within(screen.getByRole("list", { name: "Plan" }))

/**
 * Move to a position by pressing its mark in the rail.
 *
 * **Beside the arrows, not instead of them.** The rail is a second way to move and the
 * cheaper one to assert against, because it names where it is going rather than counting
 * steps — so a test that reads better this way uses it, and the ones pinning that the
 * *arrows* work still press the arrows.
 */
/**
 * Press an arrow and wait for the move to land.
 *
 * The position lives in the URL, so an arrow is a navigation rather than a `setState`: the
 * key it would move to next is read off where the drawer is *standing*, which does not
 * change until the router has committed. Two presses in one tick send the same key twice.
 */
export const step = async (name: "Next step" | "Previous step"): Promise<void> => {
  // The bar captions the position it is standing at, so its own text is what changes when
  // the move lands. Every instruction in these fixtures is unique, which is what makes it
  // an answer rather than a coincidence.
  const at = screen.getByRole("navigation").textContent
  fireEvent.click(screen.getByRole("button", { name }))
  await waitFor(() => {
    expect(screen.getByRole("navigation").textContent).not.toBe(at)
  })
}

export const goTo = async (name: string): Promise<void> => {
  // The rail rather than the chat field, because it is a *stronger* guard than `loaded()`:
  // the loading frame draws `Rail` empty, with no list inside it at all, so this can only
  // ever resolve once the real drawer has mounted. **Not from the map**: the rail is slid
  // out there and `aria-hidden`, so this query never resolves — a test standing on the map
  // presses a row in `map()` instead.
  const rail = within(await screen.findByRole("list", { name: "Positions" }))
  // Waited for the same way `step` waits, and for the same reason: the position is in the
  // URL, so a press here is a navigation rather than a `setState`. A query fired before it
  // commits is answered by the position the drawer has not left yet — and the row it opens
  // there is a different trak's.
  const at = screen.getByRole("navigation").textContent
  // Matched on the head of the name rather than the whole of it: a position's press is
  // named for the position *and* for how it is going, and these tests are about which
  // position. `TrakRail`'s own test is where the status half is asserted.
  fireEvent.click(rail.getByRole("button", { name: (label: string) => label.startsWith(name) }))
  await waitFor(() => {
    expect(screen.getByRole("navigation").textContent).not.toBe(at)
  })
}

/**
 * The same route, handed what was sent. `approves` ignores the body on purpose — an
 * approval carries nothing but the press — where an answer's whole content is its payload,
 * and the order within it is the only thing joining an answer to its question.
 */
export const acts = (respond: (body: unknown) => Response | Promise<Response>) =>
  http.post(`*/api/traks/${ID}/act`, async ({ request }) => respond(await request.json()))

/**
 * The list behind the drawer. Answered for these cases and not the ones above, because
 * this group asserts on a *disabled* attribute: an unhandled list request throws, React
 * re-renders around the failure, and a press read mid-throw is read at the wrong moment.
 */
export const emptyList = http.get("*/api/traks", () =>
  HttpResponse.json({ traks: [], archived: 0 }),
)

/** A promise a handler can sit on, so a turn stays in flight while the test presses. */
export const held = (): { readonly wait: Promise<void>; readonly release: () => void } => {
  let resolve!: () => void
  const wait = new Promise<void>((r) => {
    resolve = r
  })
  return {
    wait,
    release: () => {
      resolve()
    },
  }
}

/**
 * The same press, one gate along. What is worth asserting here and not at the plan gate is
 * *where it lands*: `Approve` is refused at three of the five `AwaitingHuman` kinds, and
 * `decide` settles a refused one as `Failed{kind:"engine"}` — so a press drawn on a card
 * that filed nothing ends the trak at the gate where somebody was reading why it could
 * not. The hook behind the button is the one the plan gate already exercises.
 */
/** A step's own gate, with the document it filed as the last thing at that position. */
export const filed = (over: Partial<TrakDetailDto> = {}): TrakDetailDto =>
  detail({
    log: [
      makeTrakCreated({ description: "add a client" }),
      makeAgentReturned({
        step: 2,
        sessionId: "s-1",
        output: { type: "artifact", sections: { Summary: "what the drawer now does" } },
      }),
    ],
    ...over,
  })

export const resumes = (respond: () => Response | Promise<Response>) =>
  http.post(`*/api/traks/${ID}/resume`, respond)

/** An agent mid-turn, with the drive holding the trak — the case the header menu is for. */
export const working = (over: Partial<TrakDetailDto> = {}): TrakDetailDto =>
  detail({
    state: { _tag: "AgentWorking", step: 2 },
    custody: { holder: { since: 1786028700000 } },
    ...over,
  })

/**
 * One detail covering a parent and every piece of its spawn.
 *
 * What is worth asserting here and nowhere else is the *join*: that the pieces are read
 * through the route a child's own page uses, that a piece's step draws that piece's turns
 * rather than the parent's, and that nothing about a piece became pressable here. The
 * order the arrows move in and what a column is made of are `family.test.ts`.
 *
 * Every instruction in these fixtures is unique, deliberately: the bar captions the
 * position you are standing at, so a caption shared with a row would be found whether the
 * map drew it or not.
 */
export const C1 = "c1111111-2222-4333-8444-555555555555"
export const C2 = "c2222222-2222-4333-8444-555555555555"

/** A piece: born holding its plan, so its column has no compose entry of its own. */
export const piece = (
  id: string,
  first: string,
  second: string,
  read: string,
  over: Partial<TrakDetailDto> = {},
): TrakDetailDto => ({
  id,
  description: first,
  mode: "manual",
  holding: false,
  skippingChecks: false,
  messages: [],
  returned: [],
  state: { _tag: "AgentWorking", step: 0 },
  plan: {
    title: first,
    steps: [
      { type: "agent", agent: "builder", instruction: first, conversational: false },
      { type: "agent", agent: "builder", instruction: second, conversational: false },
    ],
  },
  decisions: [],
  marks: [],
  nextChecks: [],
  deployScript: false,
  log: [makeTrakCreated({ description: first })],
  transcript: [
    makeSpawned({ pid: 900, position: 0 }),
    makeSession({ id: `${id}-0`, position: 0 }),
    makeTool({ name: "Read", kind: "Read", detail: read, position: 0 }),
  ],
  custody: {},
  ...over,
})

export const firstPiece = piece(C1, "wire the band", "test the band", "traks-list/TrakRow.tsx", {
  plan: {
    title: "wire the band",
    steps: [
      {
        type: "agent",
        agent: "builder",
        instruction: "wire the band",
        conversational: false,
        model: "codex/gpt-5.6-sol",
        effort: "high",
      },
      { type: "agent", agent: "builder", instruction: "test the band", conversational: false },
    ],
  },
})
export const secondPiece = piece(
  C2,
  "draw the columns",
  "test the columns",
  "trak-detail/TrakMap.tsx",
)

/** The parent, with two pieces out at the third entry of its plan. */
export const spawner = (over: Partial<TrakDetailDto> = {}): TrakDetailDto =>
  detail({
    state: { _tag: "AwaitingChildren", step: 2 },
    plan: {
      title: "Add a read-only client",
      steps: [
        { type: "compose" },
        {
          type: "agent",
          agent: "planner",
          instruction: "sketch the routes",
          conversational: false,
        },
        {
          type: "spawn",
          instruction: "build both halves",
          children: [
            [{ agent: "builder", instruction: "wire the band" }],
            [{ agent: "builder", instruction: "draw the columns" }],
          ],
        },
        { type: "agent", agent: "reviewer", instruction: "read the diff", conversational: false },
      ],
    },
    log: [
      makeTrakCreated({ description: "add a client" }),
      makeComposerReturned({
        sessionId: "s-plan",
        output: { type: "proposal", title: "Add a read-only client", steps: [] },
      }),
      makeAgentReturned({ step: 1, sessionId: "s-0", output: { type: "artifact", sections: {} } }),
      makeChildrenSpawned({ step: 2, ids: [C1, C2] }),
    ],
    ...over,
  })

export const answersFor = (...traks: readonly TrakDetailDto[]) =>
  traks.map((trak) => http.get(`*/api/traks/${trak.id}`, () => HttpResponse.json(trak)))

/**
 * The position at the end of the picker, and the three endings it carries.
 *
 * What is worth asserting here and not in `rows.test.ts` or `controls.test.ts` is the part
 * a pure test cannot reach: that the drawer *opens* on it rather than on the last step,
 * that the merge button names its destination before it is pressed, and that each press
 * behaves the way `client-style` requires of one that starts a drive — non-submittable
 * while in flight, dead while somebody else holds the trak, and explaining a refusal
 * without taking anything off the screen.
 */
export const finished = (over: Partial<TrakDetailDto> = {}): TrakDetailDto =>
  detail({
    state: { _tag: "Finished" },
    worktree: { path: "/tmp/wt", branch: "trak/auto-commit", base: "main" },
    // The base log, so the steps still own their turns, plus what an ending counts:
    // a commit on the branch and the stop that took the last step's work.
    log: [
      ...detail().log,
      makeWorkCommitted({ step: 1, sha: "abc1234", at: 1_000_000 }),
      makeHumanActed({ step: 2, action: { _tag: "Approve" }, at: 2_560_000 }),
    ],
    ...over,
  })

export const previews = (body: {
  branch?: string
  into?: string
  parentId?: string
  conflicts?: boolean
}) => http.get(`*/api/traks/${ID}/merge`, () => HttpResponse.json(body))

/**
 * The run mode, read out in the header and changed from it — and the one-shot hold at the
 * foot of the same panel. Both presses spend nothing and take no drive, which is why the
 * cases here assert the *opposite* of what every other press asserts about custody.
 */
export const modes = (sent: unknown[]) =>
  http.post("*/api/traks/:id/mode", async ({ params, request }) => {
    sent.push({ id: params["id"], body: await request.json() })
    return new HttpResponse(null, { status: 204 })
  })
