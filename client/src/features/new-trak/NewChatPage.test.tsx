// Tier 2: the second screen in this client that spends money.
//
// `NewTrakPage.test` carries the guards a create shares — the double click, a
// refusal, Enter against Shift-Enter — and they run through the same hook, so what is
// pinned here is only what this door does differently: the cursor is already in the
// field, what one send carries is fixed but for the model and the remembered mode, and
// the model is the list the engine sent, drawn as it arrived.
//
// Mounts the real `routeTree` under a memory history, because a page here is a route
// component and rendering one bare would test something the app does not ship.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { HttpResponse, http } from "msw"
import { setupServer } from "msw/node"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { storageKey } from "../../base"
import { makeModels, makeHostGit, makeCliUsage } from "../../fixtures"
import { routeTree } from "../../routes"
import { MODE_KEY } from "./runMode"

const server = setupServer(
  http.get("*/api/session", () => new HttpResponse(null, { status: 204 })),
  // The git bar, which every screen under the list draws.
  http.get("*/api/git", () => HttpResponse.json(makeHostGit())),
  // The git bar's usage cell: never read.
  http.get("*/api/usage", () => HttpResponse.json({ clis: [makeCliUsage()] })),
  // The goal banner over the list, which every screen under it draws.
  http.get("*/api/goals", () => HttpResponse.json({ goals: [] })),
  // The bar's project openers, as a machine with no scan: nothing drawn in the slot.
  http.get("*/api/openers", () => new HttpResponse(null, { status: 204 })),
  http.get("*/api/traks", () => HttpResponse.json({ traks: [], archived: 0 })),
  http.get("*/api/models", () => HttpResponse.json(makeModels())),
)

beforeAll(() => {
  vi.stubGlobal("scrollTo", () => {})
  server.listen({ onUnhandledRequest: "error" })
})
afterEach(() => {
  cleanup()
  server.resetHandlers()
  window.localStorage.clear()
})
afterAll(() => {
  server.close()
  vi.unstubAllGlobals()
})

/** What the create request carried, so a test can say what one send actually sent. */
const startsRecording = (sent: { body?: unknown }) =>
  http.post("*/api/traks", async ({ request }) => {
    sent.body = await request.json()
    return HttpResponse.json({ id: "trak-7" }, { status: 202 })
  })

const renderChat = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/traks/chat"] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router }
}

const field = (): Promise<HTMLElement> =>
  screen.findByRole("textbox", { name: "What do you want to know?" })

const startButton = (): HTMLElement => screen.getByRole("button", { name: "Start chat" })

/** The picker's tiles, in the order drawn. */
const tiles = async (): Promise<readonly HTMLElement[]> =>
  within(await screen.findByRole("group", { name: "Which model answers" })).getAllByRole("button")

const pressed = (tile: HTMLElement): boolean => tile.getAttribute("aria-pressed") === "true"

describe("the new chat drawer", () => {
  it("opens with the cursor in the field, and only the model to choose", async () => {
    renderChat()
    // The whole reason for the door: the first thing you do is type. No shelf of
    // agents and no mode strip — the mode is the one New Trak remembers.
    expect(await field()).toHaveFocus()
    expect(screen.queryByRole("button", { name: /Compose a plan/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /^Manual/ })).toBeNull()
    expect(await tiles()).toHaveLength(5)
  })

  it("lists exactly what the engine sent, in its order, with the default chosen", async () => {
    renderChat()
    const drawn = await tiles()
    // The bare name behind the CLI's mark, and the `codex/` qualifier never drawn — the
    // client splits the string and knows the grammar, never the list.
    expect(drawn.map((t) => t.textContent)).toEqual([
      "fable",
      "opus",
      "sonnet",
      "haiku",
      "gpt-5.6-sol",
    ])
    expect(drawn.map(pressed)).toEqual([false, true, false, false, false])
  })

  it("will not start with nothing to say", async () => {
    renderChat()
    await field()
    expect(startButton()).toBeDisabled()
    await userEvent.type(await field(), "   ")
    expect(startButton()).toBeDisabled()
  })

  it("sends the pressed tile as the model, and moves the chosen edge to it", async () => {
    const sent: { body?: unknown } = {}
    server.use(startsRecording(sent))
    renderChat()
    const [, , , haiku] = await tiles()
    if (haiku === undefined) throw new Error("no fourth tile")
    await userEvent.click(haiku)
    expect((await tiles()).map(pressed)).toEqual([false, false, false, true, false])

    await userEvent.type(await field(), "Why is the list slow?")
    await userEvent.keyboard("{Enter}")
    await waitFor(() => {
      expect(sent.body).toEqual({
        description: "Why is the list slow?",
        agent: "generic",
        mode: "manual",
        model: "haiku",
      })
    })
  })

  it("keeps the field live when the list cannot be read, and says the chat runs on the default", async () => {
    server.use(http.get("*/api/models", () => new HttpResponse(null, { status: 500 })))
    const sent: { body?: unknown } = {}
    server.use(startsRecording(sent))
    renderChat()
    expect(await screen.findByRole("alert")).toHaveTextContent("runs on the default")
    expect(screen.queryByRole("group", { name: "Which model answers" })).toBeNull()

    // Nothing about a model on the wire: the request is what it was before the picker.
    await userEvent.type(await field(), "Why is the list slow?")
    await userEvent.keyboard("{Enter}")
    await waitFor(() => {
      expect(sent.body).toEqual({
        description: "Why is the list slow?",
        agent: "generic",
        mode: "manual",
      })
    })
  })

  it("starts an ordinary trak with the engine's own agent, in manual, on the first send", async () => {
    const sent: { body?: unknown } = {}
    server.use(startsRecording(sent))
    const { router } = renderChat()

    await userEvent.type(await field(), "How does the export decide what to write?")
    await userEvent.keyboard("{Enter}")

    // The same request New Trak sends with that agent's tile picked — no field on the
    // wire says *chat*, because there is no such kind of trak. `manual` because nothing
    // was ever picked on New Trak — the next case covers a mode that was.
    // No `model` either: nothing was pressed, and the engine's default is what an absent
    // field asks for — so the request is exactly what it was before the picker existed.
    await waitFor(() => {
      expect(sent.body).toEqual({
        description: "How does the export decide what to write?",
        agent: "generic",
        mode: "manual",
      })
    })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/traks/trak-7")
    })
  })
})

// A chat inherits its mode into whatever work it raises, so the mode New Trak would
// open on is the one it starts in — except `auto`, which would close the chat unread.
describe("the mode a new chat starts in", () => {
  it.each([
    ["manual", "manual"],
    ["smart", "smart"],
    ["auto", "smart"],
  ])("starts in the mode New Trak remembers, %s as %s", async (stored, expected) => {
    window.localStorage.setItem(storageKey(MODE_KEY, document.baseURI), stored)
    const sent: { body?: unknown } = {}
    server.use(startsRecording(sent))
    renderChat()

    await userEvent.type(await field(), "Why is the list slow?")
    await userEvent.keyboard("{Enter}")
    await waitFor(() => {
      expect(sent.body).toEqual({
        description: "Why is the list slow?",
        agent: "generic",
        mode: expected,
      })
    })
    // Read, never written: what New Trak opens on next is still what was picked there.
    expect(window.localStorage.getItem(storageKey(MODE_KEY, document.baseURI))).toBe(stored)
  })
})
