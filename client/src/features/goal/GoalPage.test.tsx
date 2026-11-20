// Tier 2: a goal's screen and its banner over the list.
//
// Mounts the real `routeTree` under a memory history, as every page test here does. Each
// press that spends is pinned by the body it sends; none is sent anywhere real.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { HttpResponse, http } from "msw"
import { setupServer } from "msw/node"
import type { GoalDetailDto, GoalListDto } from "@orkestra/shared/dto/goals"
import type { TrakListDto } from "@orkestra/shared/dto/trak"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import {
  makeCliUsage,
  makeGoal,
  makeGoalDetail,
  makeHostGit,
  makeNote,
  makeText,
  makeTool,
  makeTrak,
} from "../../fixtures"
import { routeTree } from "../../routes"

const listing: TrakListDto = { traks: [], archived: 0 }

const server = setupServer(
  http.get("*/api/session", () => new HttpResponse(null, { status: 204 })),
  http.get("*/api/git", () => HttpResponse.json(makeHostGit())),
  // The git bar's usage cell: never read.
  http.get("*/api/usage", () => HttpResponse.json({ clis: [makeCliUsage()] })),
  http.get("*/api/agents", () => HttpResponse.json([])),
  http.get("*/api/traks", () => HttpResponse.json(listing)),
)

beforeAll(() => {
  vi.stubGlobal("scrollTo", () => {})
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

const serving = (detail: GoalDetailDto, traks: TrakListDto = listing) => {
  const goals: GoalListDto = { goals: [detail.goal] }
  server.use(
    http.get("*/api/goals", () => HttpResponse.json(goals)),
    http.get(`*/api/goals/${detail.goal.id}`, () => HttpResponse.json(detail)),
    http.get("*/api/traks", () => HttpResponse.json(traks)),
  )
}

const renderAt = (path: string): void => {
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
}

const atPlan = makeGoal({
  id: "g1",
  state: { _tag: "AtGate", gate: "plan" },
  offers: ["Approve", "Chat"],
  plan: [
    { title: "Index the logs", description: "Put every log in an index", mode: "auto" },
    { title: "A search box", description: "One field in the bar", mode: "smart" },
  ],
  planned: 2,
})

const liveTrak = (id: string) => ({ id, title: id, mode: "smart", status: "live" }) as const

// The goal's own head, apart from the banner the list beside it draws.
const head = async (): Promise<HTMLElement> => {
  const title = await screen.findByRole("heading", { level: 1, name: "Search across every trak" })
  const header = title.closest("header")
  if (header === null) throw new Error("the goal's title is outside its head")
  return header
}

/** A turn that stopped to think three times, and ended on the third. */
const PAUSING = [
  makeText({ text: "Reading the loader.", at: 0 }),
  makeNote({ text: "Thinking", at: 1 }),
  makeTool({ detail: "a.ts", at: 2 }),
  makeNote({ text: "Thinking", at: 3 }),
  makeTool({ detail: "b.ts", at: 4 }),
  makeNote({ text: "Thinking", at: 5 }),
]

describe("the goal screen", () => {
  it("opens on Chat at the plan gate, and Approve sends Approve", async () => {
    serving(
      makeGoalDetail({
        goal: atPlan,
        log: [{ _tag: "PlanProposed", call: "p1", traks: atPlan.plan }],
      }),
    )
    const sent: unknown[] = []
    server.use(
      http.post("*/api/goals/g1/act", async ({ request }) => {
        sent.push(await request.json())
        return HttpResponse.json({ id: "g1" }, { status: 202 })
      }),
    )
    renderAt("/goals/g1")
    const card = await screen.findByRole("region", { name: "Approve the plan" })
    expect(within(card).getByText("Proposed 2 traks")).toBeInTheDocument()
    expect(within(card).getByText("Index the logs")).toBeInTheDocument()
    expect(within(card).getByText("A search box")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Chat · 1" })).toHaveAttribute("aria-current")
    expect(within(card).queryByRole("button", { name: "Recompose" })).toBeNull()
    await userEvent.click(within(card).getByRole("button", { name: "Approve" }))
    await waitFor(() => expect(sent).toEqual([{ _tag: "Approve" }]))
  })

  it("draws a move in Chat as its call row, open, with the real trak row inside", async () => {
    const goal = makeGoal({
      id: "g2",
      traks: [{ id: "t1", title: "Index the logs", mode: "auto", status: "live" }],
    })
    serving(
      makeGoalDetail({
        goal,
        log: [
          {
            _tag: "TrakOpened",
            at: 2,
            call: "toolu_1",
            trak: "t1",
            title: "Index the logs",
            mode: "auto",
          },
        ],
        transcript: [
          {
            _tag: "Tool",
            name: "mcp_tool_call",
            kind: "Mcp",
            detail: "orkestra-goal/open_trak",
            call: "toolu_1",
            at: 1,
          },
        ],
      }),
      { traks: [makeTrak({ id: "t1", title: "Index the logs", mode: "auto" })], archived: 0 },
    )
    renderAt("/goals/g2")
    const view = await screen.findByRole("region", { name: "View orkestra-goal/open_trak" })
    const link = within(view).getByRole("link", { name: "Index the logs" })
    expect(link).toHaveAttribute("href", "/traks/t1")
  })

  it("draws the pause as a band whose Resume resumes", async () => {
    serving(makeGoalDetail({ goal: makeGoal({ id: "g4", paused: true }) }))
    let resumed = false
    server.use(
      http.post("*/api/goals/g4/resume", () => {
        resumed = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderAt("/goals/g4")
    const band = await screen.findByRole("region", { name: "Paused" })
    await userEvent.click(within(band).getByRole("button", { name: "Resume" }))
    await waitFor(() => expect(resumed).toBe(true))
  })
})

/** Opens the Goal tab. */
const toGoalTab = async (): Promise<void> => {
  await userEvent.click(await screen.findByRole("button", { name: "Goal" }))
}

describe("the chat while the composer works", () => {
  it("keeps the chat bar open while a composer turn runs, with Stop in Send's place", async () => {
    serving(
      makeGoalDetail({
        goal: makeGoal({ id: "g3", state: { _tag: "Composing" }, running: true, offers: ["Chat"] }),
      }),
    )
    const sent: unknown[] = []
    let stopped = 0
    server.use(
      http.post("*/api/goals/g3/act", async ({ request }) => {
        sent.push(await request.json())
        return HttpResponse.json({ id: "g3" }, { status: 202 })
      }),
      http.post("*/api/goals/g3/stop", () => {
        stopped += 1
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderAt("/goals/g3")
    const field = await screen.findByRole("textbox", { name: "Message the composer" })
    expect(field).toBeEnabled()
    await userEvent.click(screen.getByRole("button", { name: "Stop the composer" }))
    await waitFor(() => expect(stopped).toBe(1))
    // Something typed is something to send: the stop gives the button back.
    await userEvent.type(field, "Also the docs")
    expect(screen.queryByRole("button", { name: "Stop the composer" })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Send" }))
    await waitFor(() => expect(sent).toEqual([{ _tag: "Chat", message: "Also the docs" }]))
  })

  it("says why a stop did not land, where the composer had already finished", async () => {
    serving(
      makeGoalDetail({
        goal: makeGoal({ id: "g7", state: { _tag: "Composing" }, running: true, offers: ["Chat"] }),
      }),
    )
    server.use(
      http.post("*/api/goals/g7/stop", () =>
        HttpResponse.json({ _tag: "NothingToStop" }, { status: 409, statusText: "NothingToStop" }),
      ),
    )
    renderAt("/goals/g7")
    await userEvent.click(await screen.findByRole("button", { name: "Stop the composer" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("The composer had already finished.")
  })

  it("draws what the composer has not read yet as waiting, under the thread", async () => {
    serving(
      makeGoalDetail({
        goal: makeGoal({
          id: "g8",
          state: { _tag: "Composing" },
          running: true,
          offers: ["Chat"],
          messages: [{ id: "k1", message: "Also the docs" }],
        }),
      }),
    )
    renderAt("/goals/g8")
    const waiting = await screen.findByRole("list", { name: "Waiting messages" })
    expect(within(waiting).getByText("Also the docs")).toBeInTheDocument()
  })

  it("draws no thinking dots on a turn that has ended", async () => {
    serving(
      makeGoalDetail({
        goal: makeGoal({ id: "g9a", traks: [liveTrak("t1")] }),
        transcript: PAUSING,
      }),
    )
    renderAt("/goals/g9a")
    await screen.findByText("Reading the loader.")
    expect(screen.queryByText("Thinking")).toBeNull()
  })

  it("draws one set of thinking dots, on the tail of the turn that runs", async () => {
    serving(
      makeGoalDetail({
        goal: makeGoal({
          id: "g9b",
          state: { _tag: "Composing" },
          running: true,
          offers: ["Chat"],
        }),
        transcript: PAUSING,
      }),
    )
    renderAt("/goals/g9b")
    await screen.findByText("Reading the loader.")
    expect(screen.getAllByText("Thinking")).toHaveLength(1)
  })
})

describe("the goal's head", () => {
  it("heads the goal with its title over its id, and no state, line or settings", async () => {
    const traks = [liveTrak("t1"), liveTrak("t2")]
    serving(
      makeGoalDetail({
        goal: makeGoal({
          id: "g9",
          state: { _tag: "Composing" },
          traks,
          line: "Find any trak by typing",
          limits: { parallel: 2 },
        }),
      }),
    )
    renderAt("/goals/g9")
    const header = await head()
    expect(within(header).getByText("g9")).toBeInTheDocument()
    expect(within(header).queryByText("Composing")).toBeNull()
    expect(within(header).queryByText("2 traks running")).toBeNull()
    expect(within(header).queryByText("Find any trak by typing")).toBeNull()
    expect(within(header).queryByText("2 at once")).toBeNull()
    expect(within(header).queryByRole("button", { name: /Edit/ })).toBeNull()
  })
  it("calls out an idle goal on the Traks tab, and its press opens the chat", async () => {
    serving(makeGoalDetail({ goal: makeGoal({ id: "g6", state: { _tag: "Watching" } }) }))
    renderAt("/goals/g6")
    const idle = await screen.findByRole("region", {
      name: "Nothing is running. Tell the composer what next",
    })
    expect(screen.getByRole("button", { name: "Traks · 1" })).toBeInTheDocument()
    await userEvent.click(within(idle).getByRole("button", { name: "Open the chat" }))
    expect(
      screen.queryByRole("region", { name: "Nothing is running. Tell the composer what next" }),
    ).toBeNull()
  })

  it("pauses from the head's ⋯", async () => {
    serving(makeGoalDetail({ goal: makeGoal({ id: "g5", state: { _tag: "Watching" } }) }))
    let paused = false
    server.use(
      http.post("*/api/goals/g5/pause", () => {
        paused = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderAt("/goals/g5")
    const header = await head()
    expect(within(header).queryByRole("button", { name: "Pause" })).toBeNull()
    await userEvent.click(within(header).getByRole("button", { name: "Goal options" }))
    await userEvent.click(screen.getByRole("menuitem", { name: "Pause" }))
    await waitFor(() => expect(paused).toBe(true))
    expect(screen.queryByRole("menuitem", { name: "Pause" })).toBeNull()
  })
})

describe("who opened the goal", () => {
  it("links the Goal tab to the trak whose chat opened the goal, and not the head", async () => {
    serving(makeGoalDetail({ goal: makeGoal({ id: "g7", from: "chat-1" }) }))
    renderAt("/goals/g7")
    expect(within(await head()).queryByRole("link", { name: "chat-1" })).toBeNull()
    await toGoalTab()
    expect(screen.getByRole("link", { name: "chat-1" })).toHaveAttribute("href", "/traks/chat-1")
    expect(screen.getByText("opened by")).toBeInTheDocument()
  })

  it("draws no opener for a goal a person started", async () => {
    serving(makeGoalDetail({ goal: makeGoal({ id: "g8" }) }))
    renderAt("/goals/g8")
    await toGoalTab()
    expect(screen.queryByText("opened by")).not.toBeInTheDocument()
  })
})

describe("what the goal is", () => {
  it("draws the goal's finished state as markdown rather than its characters", async () => {
    serving(
      makeGoalDetail({
        goal: makeGoal({ id: "g30", finished: "Done when:\n\n- **one box** finds every trak" }),
      }),
    )
    renderAt("/goals/g30")
    await toGoalTab()
    const tab = screen.getByRole("complementary", { name: "Goal" })
    expect(within(tab).getByRole("listitem")).toHaveTextContent("one box finds every trak")
    expect(within(tab).getByText("one box").tagName).toBe("STRONG")
    expect(within(tab).queryByText(/\*\*/)).toBeNull()
  })

  it("draws the request a person typed as markdown, keeping their single line breaks", async () => {
    serving(
      makeGoalDetail({
        goal: makeGoal({
          id: "g31",
          file: undefined,
          line: undefined,
          finished: undefined,
          asked: "Make search work\nfrom every screen\n\n- **one box**",
        }),
      }),
    )
    renderAt("/goals/g31")
    await toGoalTab()
    const tab = screen.getByRole("complementary", { name: "Goal" })
    const asked = within(tab).getByText(/Make search work/)
    expect(asked.innerHTML).toBe("Make search work<br>\nfrom every screen")
    expect(within(tab).getByText("one box").tagName).toBe("STRONG")
  })
})

const acting = (id: string, sent: unknown[]) =>
  server.use(
    http.post(`*/api/goals/${id}/act`, async ({ request }) => {
      sent.push(await request.json())
      return HttpResponse.json({ id }, { status: 202 })
    }),
  )

/** Opens the Chat tab, and hands back the goal's drawer to look inside. */
const toChat = async (): Promise<HTMLElement> => {
  await userEvent.click(await screen.findByRole("button", { name: /^Chat/ }))
  return screen.getByRole("complementary", { name: "Goal" })
}

const draft = {
  file: "search-everywhere",
  title: "Search everywhere",
  line: "Find any trak by typing",
  finished: "One box finds every trak.",
  limits: { parallel: 2, modes: ["smart", "auto"] },
} as const

const QUESTION = "Rotate the key, or keep a revocation list?"
const SECOND = "Does the CLI change too?"

const atEscalation = makeGoal({
  id: "c3",
  state: { _tag: "AtGate", gate: "escalation" },
  offers: ["Answer", "Chat"],
  escalation: {
    questions: [
      {
        question: QUESTION,
        options: [{ label: "Rotate the key", recommended: true }, { label: "Keep a list" }],
      },
      { question: SECOND, options: [{ label: "Engine only" }, { label: "Engine and CLI" }] },
    ],
  },
})
const escalated = makeGoalDetail({
  goal: atEscalation,
  log: [{ _tag: "Escalated", call: "e1", questions: atEscalation.escalation?.questions ?? [] }],
})

describe("a goal's drafted file and plan as cards in Chat", () => {
  it("answers the drafted file from its card, and an earlier draft folds without presses", async () => {
    const goal = makeGoal({
      id: "c1",
      file: undefined,
      state: { _tag: "AtGate", gate: "file" },
      offers: ["Approve", "Chat"],
      draft,
    })
    serving(
      makeGoalDetail({
        goal,
        log: [
          { _tag: "GoalDrafted", call: "d1", draft: { ...draft, title: "Search somewhere" } },
          { _tag: "GoalActed", action: { _tag: "Chat", message: "Search everywhere instead" } },
          { _tag: "GoalDrafted", call: "d2", draft },
        ],
      }),
    )
    const sent: unknown[] = []
    acting("c1", sent)
    renderAt("/goals/c1")
    const thread = await toChat()
    expect(within(thread).getAllByText("Drafted goal file")).toHaveLength(2)
    expect(within(thread).getAllByRole("button", { name: "Approve and start" })).toHaveLength(1)
    // The earlier draft is folded to its title, and opens on a press of its header.
    const folded = within(thread).getByRole("button", { expanded: false, name: /Search somewhere/ })
    expect(within(folded).getByText("Search somewhere")).toBeInTheDocument()
    await userEvent.click(within(thread).getByRole("button", { name: "Approve and start" }))
    // The draft's own settings ride Approve, whole, where nobody changed them.
    await waitFor(() =>
      expect(sent).toEqual([
        { _tag: "Approve", limits: { parallel: 2, modes: ["smart", "auto"] } },
      ]),
    )
  })

  it("draws each proposed trak with its title and description, and Approve but no Recompose", async () => {
    serving(
      makeGoalDetail({
        goal: atPlan,
        log: [{ _tag: "PlanProposed", call: "p1", traks: atPlan.plan }],
      }),
    )
    const sent: unknown[] = []
    acting("g1", sent)
    renderAt("/goals/g1")
    const thread = await toChat()
    expect(within(thread).getByText("Proposed 2 traks")).toBeInTheDocument()
    expect(within(thread).getByText("Put every log in an index")).toBeInTheDocument()
    expect(within(thread).getByText("One field in the bar")).toBeInTheDocument()
    const row = within(thread).getByText("One field in the bar").closest("li")
    if (row === null) throw new Error("a planned trak is a list item")
    expect(within(row).getByRole("img", { name: "Smart mode" })).toBeInTheDocument()
    expect(within(thread).queryByRole("button", { name: "Recompose" })).toBeNull()
    await userEvent.click(within(thread).getByRole("button", { name: "Approve" }))
    await waitFor(() => expect(sent).toEqual([{ _tag: "Approve" }]))
  })
})

describe("a goal's question and done as cards in Chat", () => {
  it("answers every question the composer asks on one card", async () => {
    serving(escalated)
    const sent: unknown[] = []
    acting("c3", sent)
    renderAt("/goals/c3")
    const thread = await toChat()
    expect(within(thread).getByText("The composer asks")).toBeInTheDocument()
    expect(within(thread).getByText(SECOND)).toBeInTheDocument()
    await userEvent.click(within(thread).getByRole("button", { name: "Keep a list" }))
    await userEvent.click(within(thread).getByRole("button", { name: "Engine and CLI" }))
    await userEvent.click(within(thread).getByRole("button", { name: "Send answers" }))
    await waitFor(() =>
      expect(sent).toEqual([{ _tag: "Answer", answers: ["Keep a list", "Engine and CLI"] }]),
    )
  })

  it("answers in typed words, with the note sent apart from them", async () => {
    serving(escalated)
    const sent: unknown[] = []
    acting("c3", sent)
    renderAt("/goals/c3")
    const thread = await toChat()
    // The recommended option arrives already taken, so the typed words replace it.
    await userEvent.clear(within(thread).getByRole("textbox", { name: QUESTION }))
    await userEvent.type(within(thread).getByRole("textbox", { name: QUESTION }), "Neither")
    await userEvent.click(within(thread).getByRole("button", { name: "Engine only" }))
    await userEvent.type(
      within(thread).getByRole("textbox", { name: "Additional thoughts" }),
      "Ask me later",
    )
    await userEvent.click(within(thread).getByRole("button", { name: "Send answers" }))
    await waitFor(() =>
      expect(sent).toEqual([
        { _tag: "Answer", answers: ["Neither", "Engine only"], note: "Ask me later" },
      ]),
    )
  })

  it("draws an answered question as its record, with no form", async () => {
    serving(
      makeGoalDetail({
        goal: makeGoal({ id: "c4" }),
        log: [
          ...escalated.log,
          {
            _tag: "GoalActed",
            action: { _tag: "Answer", answers: ["Rotate the key", "Engine only"] },
          },
        ],
      }),
    )
    renderAt("/goals/c4")
    const thread = await toChat()
    expect(within(thread).getByText("Answered")).toBeInTheDocument()
    expect(within(thread).getByText("Rotate the key")).toBeInTheDocument()
    expect(within(thread).getByText("Engine only")).toBeInTheDocument()
    expect(within(thread).queryByRole("button", { name: "Send answers" })).toBeNull()
  })

  it("confirms the proposed done from its card", async () => {
    serving(
      makeGoalDetail({
        goal: makeGoal({
          id: "c5",
          state: { _tag: "AtGate", gate: "done" },
          offers: ["Confirm", "Chat"],
          done: "Every trak landed.",
        }),
        log: [{ _tag: "DoneProposed", call: "f1", summary: "Every trak landed." }],
      }),
    )
    const sent: unknown[] = []
    acting("c5", sent)
    renderAt("/goals/c5")
    const thread = await toChat()
    expect(within(thread).getByText("Every trak landed.")).toBeInTheDocument()
    expect(within(thread).queryByRole("button", { name: "Keep going" })).toBeNull()
    await userEvent.click(within(thread).getByRole("button", { name: "Confirm done" }))
    await waitFor(() => expect(sent).toEqual([{ _tag: "Confirm" }]))
  })
})

const REQUEST = {
  title: "Add the deploy key",
  steps: ["Open the repository's `Settings`", "Add the key as read-only"],
  why: "The traks cannot push without it.",
}
const atAction = (id: string) =>
  makeGoalDetail({
    goal: makeGoal({
      id,
      state: { _tag: "AtGate", gate: "action" },
      offers: ["Reported", "Chat"],
      action: REQUEST,
    }),
    log: [{ _tag: "ActionRequested", call: "r1", ...REQUEST }],
  })

describe("work asked of the person by hand, as a card in Chat", () => {
  it("lists the steps and why, and Done sends the report", async () => {
    serving(atAction("c6"))
    const sent: unknown[] = []
    acting("c6", sent)
    renderAt("/goals/c6")
    const thread = await toChat()
    expect(within(thread).getByText("Add the deploy key")).toBeInTheDocument()
    expect(within(thread).getByText("Add the key as read-only")).toBeInTheDocument()
    expect(within(thread).getByText("The traks cannot push without it.")).toBeInTheDocument()
    await userEvent.click(within(thread).getByRole("button", { name: "Done" }))
    await waitFor(() => expect(sent).toEqual([{ _tag: "Reported", done: true }]))
  })

  it("sends Couldn't only with a note saying why", async () => {
    serving(atAction("c7"))
    const sent: unknown[] = []
    acting("c7", sent)
    renderAt("/goals/c7")
    const thread = await toChat()
    const couldnt = within(thread).getByRole("button", { name: "Couldn't" })
    expect(couldnt).toBeDisabled()
    await userEvent.type(
      within(thread).getByRole("textbox", { name: "Note for the composer" }),
      "I am not an admin",
    )
    await userEvent.click(couldnt)
    await waitFor(() =>
      expect(sent).toEqual([{ _tag: "Reported", done: false, note: "I am not an admin" }]),
    )
  })
})

describe("a gate's card is in Chat alone", () => {
  it("opens a paused goal at a gate on Chat, and its Traks tab has the band and no card", async () => {
    serving(
      makeGoalDetail({
        goal: { ...atPlan, paused: true, traks: [liveTrak("t1")] },
        log: [{ _tag: "PlanProposed", call: "p1", traks: atPlan.plan }],
      }),
    )
    renderAt("/goals/g1")
    expect(await screen.findByRole("region", { name: "Approve the plan" })).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Traks" }))
    expect(screen.getByRole("region", { name: "Paused" })).toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Live" })).toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "Approve the plan" })).toBeNull()
    expect(screen.queryByText("Proposed 2 traks")).toBeNull()
  })

  it("opens on Traks, with its card there, for a failed turn", async () => {
    serving(
      makeGoalDetail({
        goal: makeGoal({
          id: "f1",
          state: { _tag: "Failed", reason: "boom" },
          offers: ["Retry", "Chat"],
        }),
      }),
    )
    renderAt("/goals/f1")
    expect(await screen.findByRole("button", { name: "Traks · 1" })).toHaveAttribute("aria-current")
    expect(screen.getByRole("button", { name: "Chat" })).toBeInTheDocument()
  })

  it("retries a failed turn in a new session where the goal offers it", async () => {
    const sent: unknown[] = []
    acting("f2", sent)
    serving(
      makeGoalDetail({
        goal: makeGoal({
          id: "f2",
          state: { _tag: "Failed", reason: "No conversation found" },
          offers: ["Retry", "NewSession", "Chat"],
        }),
      }),
    )
    renderAt("/goals/f2")
    await userEvent.click(await screen.findByRole("button", { name: "New session" }))
    await waitFor(() => {
      expect(sent).toEqual([{ _tag: "NewSession" }])
    })
  })

  it("opens on Traks for a paused goal with no gate open", async () => {
    serving(makeGoalDetail({ goal: makeGoal({ id: "p1", paused: true, traks: [liveTrak("t1")] }) }))
    renderAt("/goals/p1")
    expect(await screen.findByRole("region", { name: "Paused" })).toBeInTheDocument()
  })
})

/** A goal waiting on an open trak, so it reads as traks running rather than idle. */
const watching = makeGoal({
  id: "w",
  title: "Hand off to Codex",
  traks: [liveTrak("t")],
  startedAt: 1,
})

describe("the goal banner", () => {
  it("shows the goal still going, as landed of planned, and opens it", async () => {
    serving(makeGoalDetail({ goal: makeGoal({ id: "g5", landed: 2, planned: 6 }) }))
    renderAt("/")
    const banner = await screen.findByRole("link", { name: "Goal: Search across every trak" })
    // `landed` is its own span, which a phone hides.
    expect(screen.getByText("2 of 6")).toBeInTheDocument()
    expect(banner).toHaveAttribute("href", "/goals/g5")
  })

  const ended = makeGoal({
    id: "g6",
    state: { _tag: "Done" },
    done: "Four traks landed.",
    endedAt: Date.parse("2026-10-23T13:10:00Z"),
    landed: 4,
    planned: 4,
  })
  const dismissing = (): { readonly dismissed: () => boolean } => {
    let dismissed = false
    server.use(
      http.post("*/api/goals/g6/dismiss", () => {
        dismissed = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    return { dismissed: () => dismissed }
  }

  it("folds a goal at rest to one row offering Dismiss alone, and closes the stack on New goal", async () => {
    serving(makeGoalDetail({ goal: ended }))
    const press = dismissing()
    renderAt("/")
    await screen.findByRole("link", { name: "Goal: Search across every trak" })
    expect(screen.getByText("Done")).toBeInTheDocument()
    expect(screen.queryByText("4 of 4 landed")).toBeNull()
    expect(screen.queryByText(/Four traks landed\./)).toBeNull()
    expect(screen.queryByRole("button", { name: "Start new goal" })).toBeNull()
    expect(screen.queryByRole("link", { name: /Start a goal/ })).toBeNull()
    expect(screen.getByRole("link", { name: "New goal" })).toHaveAttribute("href", "/goals/new")
    await userEvent.click(screen.getByRole("button", { name: "Dismiss Search across every trak" }))
    await waitFor(() => expect(press.dismissed()).toBe(true))
  })

  it("stacks every goal shown: the going by need above the at rest, then New goal", async () => {
    const gate = makeGoal({
      id: "a",
      title: "Run several goals",
      state: { _tag: "AtGate", gate: "plan" },
      startedAt: 5,
    })
    const dropped = makeGoal({
      id: "d",
      title: "Pick a theme",
      state: { _tag: "Dropped", reason: "Not worth it" },
      endedAt: Date.parse("2026-10-24T09:00:00Z"),
    })
    serving(makeGoalDetail({ goal: ended }))
    server.use(
      http.get("*/api/goals", () => HttpResponse.json({ goals: [ended, watching, dropped, gate] })),
    )
    renderAt("/")
    await screen.findByRole("link", { name: "Goal: Hand off to Codex" })
    const links = screen
      .getAllByRole("link")
      .map((l) => l.getAttribute("aria-label") ?? l.textContent)
      .filter((name) => name.startsWith("Goal: ") || name === "New goal")
    expect(links).toEqual([
      "Goal: Run several goals",
      "Goal: Hand off to Codex",
      "Goal: Pick a theme",
      "Goal: Search across every trak",
      "New goal",
    ])
    // A going goal is a banner, with what it needs as its line; only the two at rest offer
    // Dismiss.
    expect(screen.getByText("Approve the plan")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: /^Dismiss / })).toHaveLength(2)
  })

  it("offers New goal while a goal is going", async () => {
    serving(makeGoalDetail({ goal: makeGoal({ id: "g10" }) }))
    renderAt("/")
    await screen.findByRole("link", { name: "Goal: Search across every trak" })
    expect(screen.getByRole("link", { name: "New goal" })).toHaveAttribute("href", "/goals/new")
    expect(screen.queryByRole("button", { name: /^Dismiss / })).toBeNull()
  })

  it("draws nothing of a dismissed goal, and the door to a new one in its place", async () => {
    serving(
      makeGoalDetail({ goal: makeGoal({ id: "g7", state: { _tag: "Done" }, dismissed: true }) }),
    )
    renderAt("/")
    const door = await screen.findByRole("link", { name: /Start a goal/ })
    expect(door).toHaveAttribute("href", "/goals/new")
    expect(screen.queryByRole("link", { name: /^Goal:/ })).toBeNull()
  })

  it("marks a row a goal opened with the goal's glyph", async () => {
    serving(makeGoalDetail({ goal: makeGoal({ id: "g8" }) }), {
      traks: [makeTrak({ id: "t8", title: "Index the logs", goal: "g8" })],
      archived: 0,
    })
    renderAt("/")
    expect(await screen.findByRole("img", { name: "Opened by a goal" })).toBeInTheDocument()
  })
})

describe("dismissing a goal at rest", () => {
  it("greys out Dismiss only on the row whose dismissal is in flight", async () => {
    const done = makeGoal({ id: "g6", state: { _tag: "Done" }, done: "Four traks landed." })
    const dropped = makeGoal({
      id: "d",
      title: "Pick a theme",
      state: { _tag: "Dropped", reason: "Not worth it" },
    })
    serving(makeGoalDetail({ goal: done }))
    // The dismissal never answers, so it stays in flight for the rest of the case.
    server.use(
      http.get("*/api/goals", () => HttpResponse.json({ goals: [done, dropped] })),
      http.post("*/api/goals/g6/dismiss", () => new Promise<never>(() => {})),
    )
    renderAt("/")
    const pressed = await screen.findByRole("button", { name: "Dismiss Search across every trak" })
    await userEvent.click(pressed)
    await waitFor(() => expect(pressed).toBeDisabled())
    expect(screen.getByRole("button", { name: "Dismiss Pick a theme" })).toBeEnabled()
  })
})

describe("starting a goal", () => {
  it("sends the sentence and the chosen modes, then opens the new goal", async () => {
    server.use(http.get("*/api/goals", () => HttpResponse.json({ goals: [] })))
    const sent: unknown[] = []
    server.use(
      http.post("*/api/goals", async ({ request }) => {
        sent.push(await request.json())
        return HttpResponse.json({ id: "g9" }, { status: 202 })
      }),
      http.get("*/api/goals/g9", () =>
        HttpResponse.json(makeGoalDetail({ goal: makeGoal({ id: "g9", title: undefined }) })),
      ),
    )
    renderAt("/goals/new")
    const field = await screen.findByRole("textbox", {
      name: "What should be true when this is done?",
    })
    await userEvent.click(screen.getByRole("button", { name: /Manual/ }))
    await userEvent.type(field, "Search works everywhere")
    await userEvent.click(screen.getByRole("button", { name: "Draft the goal" }))
    await waitFor(() =>
      expect(sent).toEqual([
        { asked: "Search works everywhere", modes: ["manual", "smart", "auto"] },
      ]),
    )
    expect(await screen.findByRole("heading", { name: "New goal" })).toBeInTheDocument()
  })

  it("sends while another goal is going", async () => {
    serving(makeGoalDetail({ goal: makeGoal({ id: "g10" }) }))
    const sent: unknown[] = []
    server.use(
      http.post("*/api/goals", async ({ request }) => {
        sent.push(await request.json())
        return HttpResponse.json({ id: "g12" }, { status: 202 })
      }),
      http.get("*/api/goals/g12", () =>
        HttpResponse.json(makeGoalDetail({ goal: makeGoal({ id: "g12", title: undefined }) })),
      ),
    )
    renderAt("/goals/new")
    const field = await screen.findByRole("textbox", {
      name: "What should be true when this is done?",
    })
    expect(field).toBeEnabled()
    expect(screen.queryByText("One goal runs at a time")).toBeNull()
    await userEvent.type(field, "Themes per project")
    await userEvent.click(screen.getByRole("button", { name: "Draft the goal" }))
    await waitFor(() =>
      expect(sent).toEqual([{ asked: "Themes per project", modes: ["smart", "auto"] }]),
    )
  })
})

describe("a drafted file at its gate", () => {
  it("asks for the drafted file first, in Chat, with Approve and start and no Redraft", async () => {
    const atFile = makeGoal({
      id: "g11",
      file: undefined,
      line: undefined,
      finished: undefined,
      title: "Search everywhere",
      asked: "Make search work",
      state: { _tag: "AtGate", gate: "file" },
      offers: ["Approve", "Chat"],
      draft: {
        file: "search-everywhere",
        title: "Search everywhere",
        line: "Find any trak by typing",
        finished: "One box finds every trak.",
        limits: { parallel: 2, modes: ["smart", "auto"] },
      },
    })
    serving(
      makeGoalDetail({
        goal: atFile,
        log: [{ _tag: "GoalDrafted", call: "d1", draft: atFile.draft ?? draft }],
      }),
    )
    const sent: unknown[] = []
    server.use(
      http.post("*/api/goals/g11/act", async ({ request }) => {
        sent.push(await request.json())
        return HttpResponse.json({ id: "g11" }, { status: 202 })
      }),
    )
    renderAt("/goals/g11")
    const card = await screen.findByRole("region", { name: "Approve the goal file" })
    expect(within(card).getByText("Drafted goal file")).toBeInTheDocument()
    // The three strips, changed in place: one more at once, and auto-merge always.
    expect(within(card).getByRole("group", { name: "Modes" })).toBeInTheDocument()
    await userEvent.click(within(card).getByRole("button", { name: "More at once" }))
    await userEvent.click(within(card).getByRole("radio", { name: /Always/ }))
    expect(within(card).getAllByRole("img", { name: "changed from the draft" })).toHaveLength(2)
    // No gate card carries the goal framing.
    expect(within(card).queryByText(/writes \.orkestra\/goals/)).toBeNull()
    expect(within(card).queryByText(/You asked/)).toBeNull()
    expect(within(card).queryByRole("button", { name: "Redraft" })).toBeNull()
    await userEvent.click(within(card).getByRole("button", { name: "Approve and start" }))
    await waitFor(() =>
      expect(sent).toEqual([
        {
          _tag: "Approve",
          limits: { parallel: 3, modes: ["smart", "auto"], autoMerge: "always" },
        },
      ]),
    )
  })
})

describe("a goal at rest", () => {
  it("leads a dropped goal with how it ended, then its open traks as the person's", async () => {
    const goal = makeGoal({
      id: "g12",
      state: { _tag: "Dropped", reason: "enough" },
      offers: [],
      traks: [{ id: "t12", title: "Search box", mode: "smart", status: "live" }],
      plan: [
        { title: "Search box", description: "A box", mode: "smart" },
        { title: "Phone sheet", description: "A sheet", mode: "smart" },
      ],
      planned: 2,
    })
    serving(makeGoalDetail({ goal }), {
      traks: [makeTrak({ id: "t12", title: "Search box", goal: "g12" })],
      archived: 0,
    })
    renderAt("/goals/g12")
    expect(await screen.findByRole("region", { name: "The goal was dropped" })).toBeInTheDocument()
    const open = screen.getByRole("region", { name: "Still open — yours now" })
    expect(within(open).getByRole("link", { name: "Search box" })).toHaveAttribute(
      "href",
      "/traks/t12",
    )
    const never = screen.getByRole("region", { name: "Never opened" })
    expect(within(never).getByText("Phone sheet")).toBeInTheDocument()
    expect(screen.getByText("The goal was dropped. Nothing moves it again.")).toBeInTheDocument()
    expect(screen.queryByRole("textbox", { name: "Message the composer" })).toBeNull()
  })

  it("draws a landed trak the list no longer sends as its real row", async () => {
    const goal = makeGoal({
      id: "g13",
      state: { _tag: "Done" },
      offers: [],
      traks: [{ id: "t13", title: "Index the logs", mode: "auto", status: "landed" }],
    })
    const settled = [
      makeTrak({ id: "t13", title: "Index the logs", state: { _tag: "Merged", sha: "abc" } }),
    ]
    serving(makeGoalDetail({ goal, settled }))
    renderAt("/goals/g13")
    const landed = await screen.findByRole("region", { name: "Landed" })
    expect(within(landed).getByRole("link", { name: "Index the logs" })).toHaveAttribute(
      "href",
      "/traks/t13",
    )
  })

  it("opens drop_trak into the reason, the dropped trak's row and what the plan lost", async () => {
    const goal = makeGoal({
      id: "g14",
      traks: [
        { id: "t14", title: "Phone sheet", mode: "smart", status: "dropped" },
        liveTrak("t15"),
      ],
    })
    const settled = [
      makeTrak({ id: "t14", title: "Phone sheet", state: { _tag: "Abandoned", reason: "x" } }),
    ]
    serving(
      makeGoalDetail({
        goal,
        settled,
        log: [
          {
            _tag: "PlanProposed",
            call: "toolu_p",
            traks: [
              { title: "Search box", description: "A box", mode: "smart" },
              { title: "Phone sheet", description: "A sheet", mode: "smart" },
            ],
          },
          { _tag: "TrakOpened", call: "toolu_o", trak: "t14", title: "Phone sheet", mode: "smart" },
          {
            _tag: "TrakDropped",
            call: "toolu_d",
            trak: "t14",
            reason: "The box is a sheet already.",
          },
        ],
      }),
    )
    renderAt("/goals/g14")
    const view = await screen.findByRole("region", { name: "View drop_trak" })
    expect(within(view).getByText("The box is a sheet already.")).toBeInTheDocument()
    expect(within(view).getByRole("link", { name: "Phone sheet" })).toHaveAttribute(
      "href",
      "/traks/t14",
    )
    expect(within(view).getByText("planned 2 → 1 · 0 landed")).toBeInTheDocument()
  })
})

describe("a running goal's settings", () => {
  it("are edited on the Goal tab, each change saved at once with no Edit and no mark", async () => {
    const goal = makeGoal({
      id: "g20",
      state: { _tag: "Watching" },
      offers: ["Chat"],
      limits: { parallel: 2 },
    })
    serving(makeGoalDetail({ goal }))
    const sent: unknown[] = []
    server.use(
      http.post("*/api/goals/g20/settings", async ({ request }) => {
        sent.push(await request.json())
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderAt("/goals/g20")
    await toGoalTab()
    const tab = screen.getByRole("complementary", { name: "Goal" })
    expect(within(tab).queryByRole("button", { name: /Edit/ })).toBeNull()
    expect(within(tab).queryByRole("img", { name: "changed from the draft" })).toBeNull()
    await userEvent.click(within(tab).getByRole("radio", { name: /Never/ }))
    await waitFor(() => expect(sent).toEqual([{ parallel: 2, autoMerge: "never" }]))
  })

  it("draws the settings read-only while the file is a draft, and once the goal is at rest", async () => {
    const goal = makeGoal({
      id: "g21",
      state: { _tag: "Done" },
      offers: [],
      limits: { parallel: 2 },
    })
    serving(makeGoalDetail({ goal }))
    renderAt("/goals/g21")
    await toGoalTab()
    expect(screen.getByText("2 at once")).toBeInTheDocument()
    expect(screen.queryByRole("radio", { name: /Never/ })).toBeNull()
    cleanup()
    serving(
      makeGoalDetail({
        goal: makeGoal({ id: "g21", file: undefined, state: { _tag: "Composing" }, offers: [] }),
      }),
    )
    renderAt("/goals/g21")
    await toGoalTab()
    expect(screen.queryByRole("radio", { name: /Never/ })).toBeNull()
  })
})

describe("where Drop is offered", () => {
  const DRAFT = {
    file: "search-everywhere",
    title: "Search across every trak",
    line: "Find any trak by typing",
    finished: "One box finds every trak.",
    limits: {},
  }
  const going: readonly (readonly [string, Parameters<typeof makeGoal>[0]])[] = [
    ["drafting", { file: undefined, state: { _tag: "Composing" }, running: true, offers: [] }],
    ["at its file", { file: undefined, draft: DRAFT, state: { _tag: "AtGate", gate: "file" } }],
    ["at its plan", { state: { _tag: "AtGate", gate: "plan" } }],
    ["asking", { state: { _tag: "AtGate", gate: "escalation" } }],
    ["proposing done", { state: { _tag: "AtGate", gate: "done" } }],
    ["watching", { state: { _tag: "Watching" } }],
    ["failed", { state: { _tag: "Failed", reason: "lost" }, offers: ["Retry"] }],
    ["paused", { state: { _tag: "Watching" }, paused: true }],
  ]

  it.each(going)("offers Drop in the head while %s", async (_, over) => {
    serving(makeGoalDetail({ goal: makeGoal({ id: "g30", ...over }) }))
    renderAt("/goals/g30")
    await userEvent.click(within(await head()).getByRole("button", { name: "Goal options" }))
    expect(screen.getByRole("menuitem", { name: "Drop this goal" })).toBeInTheDocument()
  })

  it.each([
    ["done", { _tag: "Done" }],
    ["dropped", { _tag: "Dropped", reason: "enough" }],
  ] as const)("offers no Drop once the goal is %s", async (_, state) => {
    serving(makeGoalDetail({ goal: makeGoal({ id: "g31", state, offers: [] }) }))
    renderAt("/goals/g31")
    expect(within(await head()).queryByRole("button", { name: "Goal options" })).toBeNull()
  })
})

describe("the drop's confirmation", () => {
  const sending = (id: string): unknown[] => {
    const sent: unknown[] = []
    server.use(
      http.post(`*/api/goals/${id}/drop`, async ({ request }) => {
        sent.push(await request.json())
        return HttpResponse.json({ id }, { status: 202 })
      }),
    )
    return sent
  }

  it("asks first: Cancel sends nothing, and Drop sends the drop", async () => {
    serving(makeGoalDetail({ goal: makeGoal({ id: "g32", state: { _tag: "Watching" } }) }))
    const sent = sending("g32")
    renderAt("/goals/g32")
    const header = await head()
    await userEvent.click(within(header).getByRole("button", { name: "Goal options" }))
    await userEvent.click(screen.getByRole("menuitem", { name: "Drop this goal" }))
    expect(screen.getByText("Drop this goal?")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.queryByText("Drop this goal?")).toBeNull()
    expect(sent).toEqual([])

    await userEvent.click(screen.getByRole("menuitem", { name: "Drop this goal" }))
    // The engine's answer to the refetch the press asks for: the goal at rest.
    serving(
      makeGoalDetail({
        goal: makeGoal({ id: "g32", state: { _tag: "Dropped", reason: "no longer wanted" } }),
      }),
    )
    await userEvent.click(screen.getByRole("button", { name: "Drop" }))
    await waitFor(() => expect(sent).toEqual([{ reason: "no longer wanted" }]))
    // At rest the menu holds nothing, so the head draws none.
    await waitFor(() => {
      expect(within(header).queryByRole("button", { name: "Goal options" })).toBeNull()
    })
  })

  it("names how many live traks keep running, and none where there are none", async () => {
    const traks = [liveTrak("t1"), liveTrak("t2"), { ...liveTrak("t3"), status: "landed" as const }]
    serving(makeGoalDetail({ goal: makeGoal({ id: "g33", traks }) }))
    renderAt("/goals/g33")
    await userEvent.click(within(await head()).getByRole("button", { name: "Goal options" }))
    await userEvent.click(screen.getByRole("menuitem", { name: "Drop this goal" }))
    expect(
      screen.getByText(
        "The goal stops for good, and its composer takes no more turns. Its 2 traks keep running as your own.",
      ),
    ).toBeInTheDocument()
    cleanup()
    serving(makeGoalDetail({ goal: makeGoal({ id: "g33" }) }))
    renderAt("/goals/g33")
    await userEvent.click(within(await head()).getByRole("button", { name: "Goal options" }))
    await userEvent.click(screen.getByRole("menuitem", { name: "Drop this goal" }))
    expect(
      screen.getByText("The goal stops for good, and its composer takes no more turns."),
    ).toBeInTheDocument()
  })

  it("says so in the panel when the goal came to rest before the press", async () => {
    serving(makeGoalDetail({ goal: makeGoal({ id: "g34" }) }))
    server.use(
      http.post("*/api/goals/g34/drop", () =>
        HttpResponse.json({ _tag: "AtRest" }, { status: 409 }),
      ),
    )
    renderAt("/goals/g34")
    await userEvent.click(within(await head()).getByRole("button", { name: "Goal options" }))
    await userEvent.click(screen.getByRole("menuitem", { name: "Drop this goal" }))
    await userEvent.click(screen.getByRole("button", { name: "Drop" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This goal has already come to rest.",
    )
  })

  it("folds the dropped goal to its rest row on the list, with Dismiss", async () => {
    const dropped = makeGoal({
      id: "g35",
      state: { _tag: "Dropped", reason: "no longer wanted" },
      offers: [],
    })
    serving(makeGoalDetail({ goal: dropped }))
    renderAt("/")
    await screen.findByRole("link", { name: "Goal: Search across every trak" })
    expect(screen.getByText("Dropped")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Dismiss Search across every trak" }),
    ).toBeInTheDocument()
  })
})

const parent = makeGoal({
  id: "gp",
  title: "Team-hosted Orkestra",
  line: "One Orkestra a whole team signs in to",
  branch: "goal/team",
  state: { _tag: "Watching" },
  subgoalPlan: [
    { title: "Accounts", line: "Each person signs in", finished: "Two accounts sign in" },
    { title: "Storage", line: "Shared logs", finished: "A log shows everywhere" },
    { title: "Billing", line: "Pay per seat", finished: "A fourth seat asks for a card" },
    { title: "Audit", line: "Who pressed what", finished: "An admin lists merges" },
  ],
  subgoals: [
    { id: "ga", title: "Accounts", status: "live" },
    { id: "gs", title: "Storage", status: "live" },
    { id: "gd", title: "Audit", status: "done" },
  ],
})
const of = { id: "gp", title: "Team-hosted Orkestra", branch: "goal/team" }
const accounts = makeGoal({
  id: "ga",
  title: "Accounts",
  line: "Each person signs in",
  parent: of,
  state: { _tag: "Watching" },
  traks: [{ id: "t1", title: "Session cookie", mode: "smart", status: "live" }],
})
const storage = makeGoal({
  id: "gs",
  title: "Storage",
  line: "Shared logs",
  parent: of,
  state: { _tag: "AtGate", gate: "escalation" },
})
const audit = makeGoal({ id: "gd", title: "Audit", parent: of, state: { _tag: "Done" } })

describe("a parent goal and its sub-goals", () => {
  it("leads the parent's Traks tab with its sub-goals, asking first, and folds a done one into Landed", async () => {
    serving(makeGoalDetail({ goal: parent, subgoals: [accounts, storage, audit] }))
    renderAt("/goals/gp")
    const group = await screen.findByRole("region", { name: "Sub-goals" })
    const rows = within(group).getAllByRole("listitem")
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Storage"),
      expect.stringContaining("Accounts"),
      expect.stringContaining("Billing"),
    ])
    expect(within(rows[2] ?? group).getByText(/Not opened yet/)).toBeInTheDocument()
    // The asking one starts open; the running one opens on its chevron.
    expect(within(group).getByRole("button", { name: "Open Accounts here" })).toBeInTheDocument()
    const landed = screen.getByRole("region", { name: "Landed" })
    expect(within(landed).getByRole("link", { name: "Sub-goal: Audit" })).toBeInTheDocument()
  })

  it("proposes sub-goals ahead of traks on the plan card, each spec whole", async () => {
    const proposing = makeGoal({
      ...atPlan,
      subgoalPlan: [{ title: "Accounts", line: "Each person signs in", finished: "Two sign in" }],
    })
    serving(
      makeGoalDetail({
        goal: proposing,
        log: [
          {
            _tag: "PlanProposed",
            call: "p1",
            traks: atPlan.plan,
            subgoals: proposing.subgoalPlan,
          },
        ],
      }),
    )
    renderAt("/goals/g1")
    const card = await screen.findByRole("region", { name: "Approve the plan" })
    expect(within(card).getByText("Proposed 1 sub-goal · 2 traks")).toBeInTheDocument()
    expect(within(card).getByText("Two sign in")).toBeInTheDocument()
    // The parent's Traks tab draws nothing for a sub-goal it has only proposed.
    await userEvent.click(screen.getByRole("button", { name: "Traks" }))
    expect(screen.queryByRole("region", { name: "Sub-goals" })).toBeNull()
  })

  it("leads a sub-goal's meta row with a link to its parent", async () => {
    serving(makeGoalDetail({ goal: accounts }))
    renderAt("/goals/ga")
    const link = await screen.findByRole("link", { name: "Parent goal: Team-hosted Orkestra" })
    expect(link).toHaveAttribute("href", "/goals/gp")
  })

  it("names the merge on a sub-goal's done card, and a conflict beside its press", async () => {
    const done = makeGoal({
      ...accounts,
      branch: "goal/team-ga",
      state: { _tag: "AtGate", gate: "done" },
      offers: ["Confirm", "Chat"],
      done: "Both accounts sign in.",
    })
    serving(
      makeGoalDetail({ goal: done, log: [{ _tag: "DoneProposed", call: "d1", summary: "ok" }] }),
    )
    server.use(
      http.post("*/api/goals/ga/act", () =>
        HttpResponse.json(
          { _tag: "SubgoalConflicted", into: "goal/team", paths: ["a.ts", "b.ts"] },
          { status: 409 },
        ),
      ),
    )
    renderAt("/goals/ga")
    const card = await screen.findByRole("region", { name: "Is the goal done?" })
    expect(within(card).getByText("goal/team-ga → goal/team")).toBeInTheDocument()
    await userEvent.click(within(card).getByRole("button", { name: "Confirm and merge" }))
    expect(await within(card).findByRole("alert")).toHaveTextContent(
      "Conflicts with goal/team in 2 files",
    )
  })

  it("draws the parent's live sub-goals as tiles in its card on the list, and no banner of their own", async () => {
    server.use(
      http.get("*/api/goals", () =>
        HttpResponse.json({ goals: [parent, accounts, storage, audit] } satisfies GoalListDto),
      ),
    )
    renderAt("/")
    await screen.findByRole("link", { name: "Goal: Team-hosted Orkestra" })
    const tiles = screen.getByRole("list", { name: "Sub-goals" })
    expect(
      within(tiles)
        .getAllByRole("link")
        .map((l) => l.getAttribute("aria-label")),
    ).toEqual(["Sub-goal: Storage, Needs you", "Sub-goal: Accounts, 1 trak running"])
    expect(within(tiles).getByText("Billing")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Goal: Accounts" })).toBeNull()
    expect(screen.queryByText("Audit")).toBeNull()
  })
})

describe("a landed trak's Archive", () => {
  /**
   * The goal screen does not ask the forge, so a landed trak still holding its checkout
   * cannot say whether its branch went in. Its Archive says what is true either way —
   * never *Nothing on that branch is kept*, which is false of a merged trak.
   */
  it("asks to archive a landed trak in words true whether or not it merged", async () => {
    const goal = makeGoal({
      id: "g16",
      state: { _tag: "Done" },
      offers: [],
      traks: [{ id: "t16", title: "Index the logs", mode: "auto", status: "landed" }],
    })
    serving(makeGoalDetail({ goal }), {
      traks: [
        makeTrak({
          id: "t16",
          title: "Index the logs",
          goal: "g16",
          state: { _tag: "Finished" },
          branch: "trak/t16",
        }),
      ],
      archived: 0,
    })
    renderAt("/goals/g16")
    const landed = await screen.findByRole("region", { name: "Landed" })
    await userEvent.click(within(landed).getByRole("button", { name: "Archive — Index the logs" }))
    const panel = screen.getByRole("dialog", { name: "Archive this trak?" })
    expect(within(panel).getByText(/Only what was merged from it stays\./)).toBeInTheDocument()
    expect(within(panel).queryByText(/Nothing on that branch is kept/)).toBeNull()
  })
})
