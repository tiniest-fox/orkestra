// Tier 2: the first of the two screens in this client that spend money.
//
// The theme is *what it refuses to do*, which is where the judgement is. Starting a
// trak runs a composer, and the server cannot tell a deliberate click from a double
// one — so the guards are the subject, and the happy path is the easy half.
//
// Mounts the real `routeTree` under a memory history, because a page here is a route
// component and rendering one bare would test something the app does not ship.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { HttpResponse, http } from "msw"
import { setupServer } from "msw/node"
import type { CreatedDto } from "@orkestra/shared/dto/actions"
import type { RefusalDto } from "@orkestra/shared/dto/common"
import type { AgentDto } from "@orkestra/shared/dto/fleet"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { makeAgent, makeHostGit, makeCliUsage } from "../../fixtures"
import { routeTree } from "../../routes"

const server = setupServer(
  // The root route is behind the session gate, and an engine with no passphrase says
  // come in. A default rather than a `server.use`, so `resetHandlers` keeps it.
  http.get("*/api/session", () => new HttpResponse(null, { status: 204 })),
  // The git bar, which every screen under the list draws.
  http.get("*/api/git", () => HttpResponse.json(makeHostGit())),
  // The git bar's usage cell: never read.
  http.get("*/api/usage", () => HttpResponse.json({ clis: [makeCliUsage()] })),
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

/** The list behind the drawer, which every render of this route also mounts. */
const emptyList = http.get("*/api/traks", () => HttpResponse.json({ traks: [], archived: 0 }))

/**
 * The library the grid draws. Two entries rather than the real eight: what is under test
 * is the cut and the choosing, and eight of them would only make the assertions longer.
 */
const AGENTS: readonly AgentDto[] = [
  makeAgent({
    name: "ui-prototype",
    description:
      "Settles what a screen should do by building it. Produces a study under `.atelier/`.",
  }),
  makeAgent({ name: "research", description: "Lays out the options. Recommends nothing." }),
]

const library = (agents: readonly AgentDto[] = AGENTS) =>
  http.get("*/api/agents", () => HttpResponse.json(agents))

const starts = (created: CreatedDto) =>
  http.post("*/api/traks", () => HttpResponse.json(created, { status: 202 }))

/** What the create request carried, so a test can say what the choice actually sent. */
const startsRecording = (sent: { body?: unknown }) =>
  http.post("*/api/traks", async ({ request }) => {
    sent.body = await request.json()
    return HttpResponse.json({ id: "trak-7" }, { status: 202 })
  })

const refuses = (refusal: RefusalDto) =>
  http.post("*/api/traks", () => HttpResponse.json(refusal, { status: 409 }))

// The return type is inferred: `createRouter`'s is generic over the whole route tree,
// and naming it here would be restating the tree rather than describing it.
const renderNew = () => {
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
  return { router }
}

/**
 * The field, once the router has resolved the route.
 *
 * `findBy` rather than `getBy`: a route component is not in the tree on the first
 * paint, so every case has to wait for it once before it can do anything.
 */
const field = (): Promise<HTMLElement> =>
  screen.findByRole("textbox", { name: "What do you want done?" })

const startButton = (): HTMLElement => screen.getByRole("button", { name: "Start trak" })

/**
 * A tile, by the agent it names. Anchored at the start rather than a bare substring: the
 * blurb follows the name inside the tile, and once an agent is picked the send button is
 * called `Start <agent>` — so an unanchored match finds two.
 */
const named = (name: string): RegExp => new RegExp(`^${name}`)
const tile = (name: string): HTMLElement => screen.getByRole("button", { name: named(name) })
const tileAsync = (name: string): Promise<HTMLElement> =>
  screen.findByRole("button", { name: named(name) })

const composeCard = (): Promise<HTMLElement> =>
  screen.findByRole("button", { name: /Compose a plan/ })

/**
 * A segment of the run-mode strip, by the name on it — Title case, because that is what
 * the strip draws. What the request carries is still the log's own `manual` / `smart` /
 * `auto`, which is why the assertions below say one and press the other.
 */
const mode = (name: string): HTMLElement => screen.getByRole("button", { name: named(name) })
const modeAsync = (name: string): Promise<HTMLElement> =>
  screen.findByRole("button", { name: named(name) })

/** Typing as a person does it, key by key — which is what makes Enter reachable. */
const typeInto = async (text: string): Promise<void> => {
  await userEvent.type(await field(), text)
}

describe("the new trak drawer", () => {
  it("draws a navigator with nothing in it to press", async () => {
    server.use(emptyList, library())
    renderNew()
    // The bar is the real one with no map behind it — the position, the arrows, and the
    // trak's three surfaces — so every control it draws is there and disabled. Drawn
    // rather than absent so that nothing moves when the map arrives; disabled rather than
    // inert markup so that what cannot be pressed says so to a pointer and to a screen
    // reader alike.
    const nav = await screen.findByRole("navigation")
    const controls = within(nav).getAllByRole("button")
    expect(controls).toHaveLength(6)
    for (const control of controls) expect(control).toHaveProperty("disabled", true)
    for (const surface of ["Map", "Trak", "Changes"])
      expect(within(nav).getByRole("button", { name: surface })).toBeDefined()
  })

  it("holds the rail's width open before there is a plan to put in it", async () => {
    server.use(emptyList, library())
    renderNew()

    // The same argument as the disabled bar above, one band lower: the rail's box is drawn
    // with nothing in it, so starting a trak does not slide the pane sideways when its
    // positions arrive. Empty means no list — the marks are what would carry one.
    await screen.findByRole("navigation")
    expect(screen.queryByRole("list", { name: "Positions" })).toBeNull()
  })

  it("will not start a trak with nothing to compose from", async () => {
    server.use(emptyList, library())
    renderNew()
    // Blank on arrival, and blank after whitespace: a round trip to be told there is
    // nothing to plan from is a round trip that spends nothing and says nothing.
    await field()
    expect(startButton()).toBeDisabled()
    await typeInto("   ")
    expect(startButton()).toBeDisabled()
  })

  it("starts one, and moves to the trak it made", async () => {
    server.use(emptyList, library(), starts({ id: "trak-7" }))
    const { router } = renderNew()
    await typeInto("Add a --json flag")
    await userEvent.click(startButton())
    // The 202 carries the id and nothing else — going to it is the whole of what a
    // caller does with it.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/traks/trak-7")
    })
  })

  it("says why it was refused, and keeps what was typed", async () => {
    server.use(emptyList, library(), refuses({ _tag: "Driving" }))
    renderNew()
    await typeInto("Add a --json flag")
    await userEvent.click(startButton())

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Something is already driving this.")
    // A surface that took the description away would make you write it twice.
    expect(await field()).toHaveValue("Add a --json flag")
  })

  it("cannot be asked twice while it is starting", async () => {
    // The server cannot tell a deliberate click from a double one, and two would be
    // two composers. Held open so the in-flight state is a state rather than a race.
    let started = 0
    server.use(
      emptyList,
      library(),
      http.post("*/api/traks", async () => {
        started += 1
        await new Promise(() => {})
        return HttpResponse.json({ id: "never" })
      }),
    )
    renderNew()
    await typeInto("Add a --json flag")
    await userEvent.click(startButton())
    await waitFor(() => {
      expect(startButton()).toBeDisabled()
    })
    await userEvent.click(startButton())
    expect(started).toBe(1)
  })

  it("starts on Enter; Shift-Enter writes a line instead", async () => {
    server.use(emptyList, library(), starts({ id: "trak-7" }))
    const { router } = renderNew()
    await typeInto("Add a --json flag")
    await userEvent.type(await field(), "{Shift>}{Enter}{/Shift}")
    expect(await field()).toHaveValue("Add a --json flag\n")
    expect(router.state.location.pathname).toBe("/traks/new")

    await userEvent.keyboard("{Enter}")
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/traks/trak-7")
    })
  })
})

/**
 * Its own block rather than more cases in the one above, because the subject is
 * different: that one is about what the screen refuses to do, and this is about what a
 * trak is being started *as*.
 */
describe("choosing what a trak starts as", () => {
  it("offers Compose a plan and every startable agent, with Compose a plan chosen", async () => {
    server.use(emptyList, library())
    renderNew()

    // Chosen is `aria-pressed`, which is the only part of "the edge alone" a test can
    // see — and the only part a screen reader can. On load it is the composer's, which
    // is today's behaviour with the shelf drawn under it.
    expect(await composeCard()).toHaveAttribute("aria-pressed", "true")
    expect(await tileAsync("ui-prototype")).toHaveAttribute("aria-pressed", "false")
    expect(tile("research")).toHaveAttribute("aria-pressed", "false")
    // The two that cannot work with no prior step are not drawn at all — the engine
    // filters, so there is nothing here to keep in step with it.
    expect(screen.queryByRole("button", { name: /resolve/ })).toBeNull()
  })

  it("shows one sentence of a description, not the whole of it", async () => {
    server.use(emptyList, library())
    renderNew()

    // The cut is at the first sentence, and the period in `.atelier/` is not one.
    const prototype = await tileAsync("ui-prototype")
    expect(prototype).toHaveTextContent("Settles what a screen should do by building it.")
    expect(prototype).not.toHaveTextContent(".atelier")
  })

  it("starts the agent that was picked, and says so on the button", async () => {
    const sent: { body?: unknown } = {}
    server.use(emptyList, library(), startsRecording(sent))
    renderNew()

    await userEvent.click(await tileAsync("ui-prototype"))
    expect(tile("ui-prototype")).toHaveAttribute("aria-pressed", "true")
    expect(await composeCard()).toHaveAttribute("aria-pressed", "false")
    // The send is icon-only, so the choice is spoken in its name and nowhere else.
    await userEvent.type(await field(), "Draw the finished screen")
    await userEvent.click(screen.getByRole("button", { name: "Start ui-prototype" }))

    await waitFor(() => {
      expect(sent.body).toEqual({
        description: "Draw the finished screen",
        agent: "ui-prototype",
        mode: "manual",
      })
    })
  })

  it("sends no agent at all when Compose a plan is what is chosen", async () => {
    const sent: { body?: unknown } = {}
    server.use(emptyList, library(), startsRecording(sent))
    renderNew()

    // Picked and then unpicked: the composer is the *absence* of an agent, not a name
    // the request carries, so going back to it must leave the field off entirely.
    await userEvent.click(await tileAsync("research"))
    await userEvent.click(await composeCard())
    await userEvent.type(await field(), "Add a --json flag")
    await userEvent.click(startButton())

    await waitFor(() => {
      expect(sent.body).toEqual({ description: "Add a --json flag", mode: "manual" })
    })
  })

  it("still starts a trak when the agents cannot be read", async () => {
    // Compose a plan is this screen's own copy, so a library that will not load costs
    // the eight tiles and nothing else. A blank pane here would be the failure.
    server.use(
      emptyList,
      http.get("*/api/agents", () => new HttpResponse(null, { status: 500 })),
      starts({ id: "trak-7" }),
    )
    const { router } = renderNew()

    expect(await composeCard()).toHaveAttribute("aria-pressed", "true")
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not read which agents")
    await typeInto("Add a --json flag")
    await userEvent.click(startButton())
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/traks/trak-7")
    })
  })

  it("sends the mode that was picked, not the one it opened on", async () => {
    const sent: { body?: unknown } = {}
    server.use(emptyList, library(), startsRecording(sent))
    renderNew()

    expect(await modeAsync("Manual")).toHaveAttribute("aria-pressed", "true")
    await userEvent.click(mode("Auto"))
    expect(mode("Manual")).toHaveAttribute("aria-pressed", "false")
    await typeInto("Add a --json flag")
    await userEvent.click(startButton())

    await waitFor(() => {
      expect(sent.body).toEqual({ description: "Add a --json flag", mode: "auto" })
    })
  })

  it("opens on the mode picked last time, so nobody answers it twice", async () => {
    server.use(emptyList, library(), starts({ id: "trak-7" }))
    renderNew()
    await userEvent.click(await modeAsync("Auto"))

    // The whole screen, gone and mounted again — which is what coming back to New Trak
    // is. Page state would be empty here; what survives is the storage the hook writes.
    cleanup()
    renderNew()

    expect(await modeAsync("Auto")).toHaveAttribute("aria-pressed", "true")
    expect(mode("Manual")).toHaveAttribute("aria-pressed", "false")
  })
})

describe("auto-merge", () => {
  it("sends auto-merge only when it was switched on, beside the mode", async () => {
    const sent: { body?: unknown } = {}
    server.use(emptyList, library(), startsRecording(sent))
    renderNew()
    // The mode is remembered from the case before; picked here so the body is this case's.
    await userEvent.click(await modeAsync("Manual"))

    const toggle = screen.getByRole("switch", { name: /Auto-merge/ })
    expect(toggle).toHaveAttribute("aria-checked", "false")
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute("aria-checked", "true")
    await typeInto("Add a --json flag")
    await userEvent.click(startButton())

    await waitFor(() => {
      expect(sent.body).toEqual({
        description: "Add a --json flag",
        mode: "manual",
        autoMerge: true,
      })
    })
  })

  it("opens on the choice made last time, off as well as on", async () => {
    server.use(emptyList, library())
    renderNew()
    const toggle = await screen.findByRole("switch", { name: /Auto-merge/ })
    // Storage carries the case before's choice; switched on here so this case owns it.
    if (toggle.getAttribute("aria-checked") === "false") await userEvent.click(toggle)

    // Gone and mounted again, as coming back to New Trak is.
    cleanup()
    renderNew()
    const again = await screen.findByRole("switch", { name: /Auto-merge/ })
    expect(again).toHaveAttribute("aria-checked", "true")

    await userEvent.click(again)
    cleanup()
    renderNew()
    expect(await screen.findByRole("switch", { name: /Auto-merge/ })).toHaveAttribute(
      "aria-checked",
      "false",
    )
  })
})
