/**
 * Tier 2: what a person steers the trak with — the chat bar and the stop in its place,
 * the presses that leave a step, the recompose sheet and the positions the engine works
 * at. The header's controls — run mode, openers, Rebuild — are in
 * `TrakDetailPage.header.test.tsx`.
 */

import { describe, expect, it } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router"
import { http, HttpResponse } from "msw"
import type { EngineFrameDto } from "@orkestra/shared/dto/stream"
import type { TrakDetailDto } from "@orkestra/shared/dto/trak"
import {
  makeAgentReturned,
  makeAppended,
  makeChecksPassed,
  makeComposerReturned,
  makeDrive,
  makeTrakCreated,
} from "../../fixtures"
import { applyFrame } from "../../applyFrame"
import { queryKeys } from "../../queryCache"
import { routeTree } from "../../routes"
import {
  server,
  ID,
  TITLE,
  detail,
  PLANNED,
  BUILT,
  openCall,
  renderDetail,
  answers,
  loaded,
  press,
  step,
  goTo,
  acts,
  emptyList,
  filed,
  resumes,
  firstPiece,
  secondPiece,
  spawner,
  answersFor,
  finished,
  previews,
} from "./TrakDetailPage.support"

describe("the intent, one move from the gate", () => {
  it("shows the decisions on the Trak tab, saying which nobody agreed to", async () => {
    // The description alone stops being what is being asked for the moment anything is
    // decided, and `assumed` is the entry a reader has to catch. It lives on the trak
    // level rather than beside the gate: a decision is a fact about the trak, and the
    // drawer shows one altitude at a time.
    server.use(
      answers(
        detail({
          decisions: [
            {
              text: "the admin view is out of scope",
              source: "stated",
              at: "0-plan",
              id: "0-plan.1",
            },
            {
              text: "responsive means phone and desktop",
              source: "assumed",
              at: "0-plan",
              id: "0-plan.2",
            },
          ],
        }),
      ),
    )
    renderDetail()

    await press(/Trak/)

    expect(await screen.findByText(/the admin view is out of scope/)).toBeDefined()
    expect(screen.getByText(/responsive means phone and desktop/)).toBeDefined()
    // Provenance is a plate rather than a word, so what a reader can find is the
    // label behind it — and `assumed` must never be styled as a failure.
    expect(screen.getByText("inferred by the agent")).toBeDefined()
    expect(screen.getByText("from you")).toBeDefined()
    // Named by the id a later entry would use, which is the engine's and not this file's.
    expect(screen.getByText("0-plan.2")).toBeDefined()
  })

  it("leaves out a decision a later one supersedes, and says what the later one replaced", async () => {
    // The same rule every list the engine renders holds to: the replacing entry
    // restated whatever still held, so the old one is read nowhere.
    server.use(
      answers(
        detail({
          decisions: [
            {
              text: "the admin view is out of scope",
              source: "stated",
              at: "0-plan",
              id: "0-plan.1",
            },
            {
              text: "the admin view is in, read-only",
              source: "stated",
              at: "2-build",
              id: "2-build.1",
              supersedes: ["0-plan.1", "1-scope"],
            },
          ],
        }),
      ),
    )
    renderDetail()

    await press(/Trak/)

    expect(await screen.findByText(/the admin view is in, read-only/)).toBeDefined()
    expect(screen.queryByText(/the admin view is out of scope/)).toBeNull()
    expect(screen.getByText("supersedes 0-plan.1, 1-scope")).toBeDefined()
  })

  it("says so plainly when nothing has been decided, which is most traks", async () => {
    server.use(answers(detail()))
    renderDetail()

    await press(/Trak/)
    expect(await screen.findByText("Nothing decided yet.")).toBeDefined()
    // And says it once: the section's note describes a list, so with no list it is a
    // second grey sentence above the one that answers.
    expect(screen.queryByText(/Amendments to the request/)).toBeNull()
  })

  it("is what the trak is, not what happened to it — no log here", async () => {
    server.use(answers(detail()))
    renderDetail()

    await press(/Trak/)
    await screen.findByText("Nothing decided yet.")
    expect(screen.queryByText("Trak created")).toBeNull()
  })
})

const chats = (respond: () => Response | Promise<Response>) =>
  http.post(`*/api/traks/${ID}/act`, respond)

/**
 * The bar at the foot of the drawer, and the second press here that spends money.
 *
 * What is worth asserting is the same as the plan gate's: not that a message can be sent,
 * but the three things that must stop one — a turn already in flight, a trak somebody
 * else is holding, and a position the trak is not standing at. The last is this control's
 * own. Every other control on this screen is drawn by the thing it acts on, so it cannot
 * be somewhere the trak is not; the bar is on screen at every position, so *where you are
 * looking* has to be part of whether it works.
 */
describe("the chat bar", () => {
  it("sends what was typed, and empties the field once it has landed", async () => {
    let seen: unknown
    server.use(
      emptyList,
      answers(detail()),
      http.post(`*/api/traks/${ID}/act`, async ({ request }) => {
        seen = await request.json()
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    const field = await screen.findByLabelText<HTMLTextAreaElement>("Say something to the agent")
    fireEvent.change(field, { target: { value: "smaller, and skip the migration" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))

    await waitFor(() => {
      expect(seen).toEqual({ action: "chat", message: "smaller, and skip the migration" })
    })
    // Emptied on the answer rather than on the press: what a refusal must not do is lose
    // a paragraph somebody wrote.
    await waitFor(() => {
      expect(field.value).toBe("")
    })
  })

  it("says why a refused message did not land, and keeps what was typed", async () => {
    server.use(
      emptyList,
      answers(detail()),
      chats(() => HttpResponse.json({ _tag: "Driving" }, { status: 409, statusText: "Driving" })),
    )
    renderDetail()

    const field = await screen.findByLabelText<HTMLTextAreaElement>("Say something to the agent")
    fireEvent.change(field, { target: { value: "wait, stop" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))

    expect(await screen.findByText("Something is already driving this.")).toBeDefined()
    expect(field.value).toBe("wait, stop")
  })

  it("will not send while something already holds the trak", async () => {
    let sent = 0
    server.use(
      emptyList,
      answers(detail({ custody: { holder: { since: 1786028700000 } } })),
      chats(() => {
        sent += 1
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    // The trak is at a gate, so the field stays open — custody there is a drive letting go,
    // and a field shut for it loses the cursor. The send is what refuses.
    const field = await screen.findByLabelText<HTMLTextAreaElement>("Say something to the agent")
    expect(field.disabled).toBe(false)
    fireEvent.change(field, { target: { value: "wait, stop" } })
    const send = screen.getByRole<HTMLButtonElement>("button", { name: "Send" })
    expect(send.disabled).toBe(true)
    fireEvent.click(send)
    expect(sent).toBe(0)
  })

  it("shuts on a position the trak is not waiting at", async () => {
    server.use(emptyList, answers(detail()))
    renderDetail()

    // Step 1 has already run. The message would land at step 2, where the gate is, so
    // sending from here would put words somewhere the reader is not looking.
    await goTo("planner — sketch the routes")
    await screen.findByText(PLANNED)

    const field = await screen.findByPlaceholderText("The trak is not waiting here")
    expect(field.hasAttribute("disabled")).toBe(true)
  })

  it("shuts while the agent is working, with nobody holding the trak", async () => {
    server.use(emptyList, answers(detail({ state: { _tag: "AgentWorking", step: 2 } })))
    renderDetail()

    // A crashed run reads exactly like this — custody clear, state still `AgentWorking` —
    // so the state is what answers here, and `chatAccepted` is what it answers with.
    expect(await screen.findByPlaceholderText("Nothing is being asked here")).toBeDefined()
  })

  it("opens at the gate, saying so rather than only going un-grey", async () => {
    server.use(emptyList, answers(detail()))
    renderDetail()

    const field = await screen.findByPlaceholderText("Say something…")
    expect(field.hasAttribute("disabled")).toBe(false)
  })
})

describe("the chat bar through a drive letting go", () => {
  /**
   * The engine appends the gate's state while the drive still holds the trak, and lets go
   * on a `Drive` frame after it — `src/app/drive.ts` publishes the release as the drive's
   * finalizer. So between the two frames the cache holds a gate with custody held, which
   * `chatClosed` and `sendBlocked` both read as *something is driving*, and a browser
   * blurs a textarea the moment it is disabled. The release enables it again; nothing
   * gives the cursor back.
   */
  it("keeps the cursor in the field when a turn the reader is typing through parks at a gate", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const turning = detail({
      state: { _tag: "AgentWorking", step: 2 },
      custody: { holder: { since: 1786028700000 } },
      log: detail().log.slice(0, 3),
    })
    server.use(emptyList, answers(turning))
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider
          router={createRouter({
            routeTree,
            history: createMemoryHistory({ initialEntries: [`/traks/${ID}`] }),
          })}
        />
      </QueryClientProvider>,
    )

    const field = await screen.findByPlaceholderText<HTMLTextAreaElement>("Say something…")
    field.focus()
    fireEvent.change(field, { target: { value: "and while you're there" } })

    // `EngineStream`'s write, one frame at a time. React Query tells its observers on a
    // timer, so each frame waits that tick out before anything is read off the screen.
    const frame = async (next: EngineFrameDto): Promise<void> => {
      await act(async () => {
        queryClient.setQueryData<TrakDetailDto>(queryKeys.trak(ID), (cached) =>
          cached === undefined ? cached : (applyFrame(cached, next) ?? cached),
        )
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
    // The turn returns and the trak parks at the gate after step 2 — still held.
    await frame(
      makeAppended({
        trak: ID,
        seq: turning.log.length + 1,
        event: makeAgentReturned({ step: 2, sessionId: "s-1" }),
        state: { _tag: "AwaitingHuman", step: 2, kind: "approval" },
        plan: turning.plan,
        worktree: turning.worktree,
        waiting: turning.waiting,
        landed: turning.landed,
      }),
    )
    // `disabled` is the assertion that bites: happy-dom keeps focus on a disabled field where
    // a browser drops it, so the focus checks alone would pass over the bug.
    expect(field.disabled).toBe(false)
    expect(document.activeElement).toBe(field)

    // And the drive lets go.
    await frame(makeDrive({ trak: ID, custody: {} }))
    expect(document.activeElement).toBe(field)
    expect(field.value).toBe("and while you're there")
  })
})

/** A turn in flight and somebody driving it, which is the whole of what offers a stop. */
const running = (over: Partial<TrakDetailDto> = {}): TrakDetailDto =>
  detail({
    state: { _tag: "AgentWorking", step: 2 },
    custody: { holder: { since: 1786028700000 } },
    ...over,
  })

/**
 * The one press in the footer, and only what a pure test cannot reach: that the button
 * actually swaps, and that pressing it interrupts rather than sends.
 *
 * **Which states offer it is `controls.test.ts`'s, exhaustively, and is deliberately not
 * re-asserted here** — `client-style`'s checklist item 5 says which controls to show is
 * asserted directly and never inferred from a render, and a render per state is also the
 * most expensive way to ask the cheapest question. What survives is the pair a switch
 * cannot answer: a bar shut with its reason still showing *and* a live control beside it,
 * since a stop drawn next to a working Send and a Send left standing through a turn are
 * both ways this is wrong with neither half wrong on its own.
 */
describe("the stop that takes the send's place", () => {
  it("draws a stop instead of a send while the agent is working", async () => {
    server.use(emptyList, answers(running()))
    renderDetail()

    expect(await screen.findByRole("button", { name: "Stop the agent" })).toBeDefined()
    // The field is open under it: what is typed while a turn runs is for the agent.
    const field = await screen.findByPlaceholderText("Say something…")
    expect(field.hasAttribute("disabled")).toBe(false)
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull()
  })

  it("turns the stop back into a send once the field holds text, and posts it as a chat", async () => {
    const said: unknown[] = []
    server.use(
      emptyList,
      answers(running()),
      http.post(`*/api/traks/${ID}/act`, async ({ request }) => {
        said.push(await request.json())
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    const field = await screen.findByPlaceholderText("Say something…")
    fireEvent.change(field, { target: { value: "keep --json" } })
    // One button, and it follows the draft.
    expect(screen.queryByRole("button", { name: "Stop the agent" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Send" }))

    await waitFor(() => {
      expect(said).toEqual([{ action: "chat", message: "keep --json" }])
    })
    // Sent, so the field is empty and the one button is the stop again.
    expect(await screen.findByRole("button", { name: "Stop the agent" })).toBeDefined()
  })

  it("draws what is waiting at the foot of the conversation, apart from what was delivered", async () => {
    server.use(
      emptyList,
      answers(
        running({
          messages: [
            { id: "m1", message: "keep --json" },
            { id: "m2", message: "skip the changelog" },
          ],
        }),
      ),
    )
    renderDetail()

    const waiting = await screen.findByRole("list", { name: "Waiting messages" })
    expect(
      within(waiting)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["keep --json", "skip the changelog"])
  })

  it("puts what a stop handed back into the field, where nothing has sent it", async () => {
    server.use(
      emptyList,
      answers(
        detail({
          state: { _tag: "AwaitingHuman", step: 2, kind: "conversation" },
          returned: ["keep --json", "skip the changelog"],
        }),
      ),
    )
    renderDetail()

    const field = await screen.findByLabelText("Say something to the agent")
    await waitFor(() => {
      expect(field).toHaveProperty("value", "keep --json\n\nskip the changelog")
    })
  })

  it("posts the interruption, which is the one press that overrides a drive", async () => {
    let kills = 0
    server.use(
      emptyList,
      answers(running()),
      http.post(`*/api/traks/${ID}/stop`, () => {
        kills += 1
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "Stop the agent" }))
    await waitFor(() => {
      expect(kills).toBe(1)
    })
  })

  it("says why a refused stop did not land", async () => {
    // **Drawn at a state that offers the press**, which is the case a person actually
    // meets: the engine records a turn a moment after the state says one is running, and
    // a stop inside that window is refused rather than filing one with no session to
    // resume. Nothing on the wire can see the far side of it, so the sentence is how the
    // surface finds out — and it is worded about what is *running* for this reason.
    server.use(
      emptyList,
      answers(running()),
      http.post(`*/api/traks/${ID}/stop`, () =>
        HttpResponse.json({ _tag: "NothingToStop" }, { status: 409, statusText: "NothingToStop" }),
      ),
    )
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "Stop the agent" }))
    expect(await screen.findByText("Nothing is running here to interrupt.")).toBeDefined()
  })
})

/**
 * The two presses that leave the step, and the sheet one of them opens.
 *
 * **Which states offer each is `controls.test.ts`'s, exhaustively, and is not re-asserted
 * here** — what survives is what a switch cannot answer: that the presses are beside the
 * bar at the one gate with no card and in the card's header everywhere else, that the
 * filing posts its own route and the recompose posts `/act` with the reason typed in the
 * sheet, that the sheet says which of its two things it is about to do, and that a refusal
 * keeps the sheet and the draft on screen.
 */
/** The recompose sheet, or `null` while it is shut. */
const sheet = (): HTMLElement | null =>
  screen.queryByRole("dialog", { name: "Recompose from here?" })

/** A step parked in a conversation: it replied in prose, filed nothing, nobody driving. */
const talking = (over: Partial<TrakDetailDto> = {}): TrakDetailDto =>
  detail({
    state: { _tag: "AwaitingHuman", step: 2, kind: "conversation" },
    log: [
      makeTrakCreated({ description: "add a client" }),
      makeAgentReturned({
        step: 2,
        sessionId: "s-1",
        output: { type: "message", text: "which of the two did you mean?" },
      }),
    ],
    ...over,
  })

/** A turn in flight and somebody driving it. */
const driven = (): TrakDetailDto =>
  detail({
    state: { _tag: "AgentWorking", step: 2 },
    custody: { holder: { since: 1786028700000 } },
  })

/** A step at its approval gate whose person chatted and got prose back — the document is
 *  up the transcript, and the reply is the newest thing at the position. */
const repliedAtDoc = (): TrakDetailDto =>
  detail({
    state: { _tag: "AwaitingHuman", step: 2, kind: "approval" },
    log: [
      makeTrakCreated({ description: "add a client" }),
      makeAgentReturned({
        step: 2,
        sessionId: "s-1",
        output: { type: "artifact", sections: { Summary: "the work" } },
      }),
      makeAgentReturned({
        step: 2,
        sessionId: "s-1",
        output: { type: "message", text: "does that cover it?" },
      }),
    ],
  })

/** A step at its questions gate whose person chatted and got prose back — the questions are
 *  up the transcript, and the reply is the newest thing. */
const repliedAtQuestions = (): TrakDetailDto =>
  detail({
    state: { _tag: "AwaitingHuman", step: 2, kind: "answers" },
    log: [
      makeTrakCreated({ description: "add a client" }),
      makeAgentReturned({
        step: 2,
        sessionId: "s-1",
        output: { type: "questions", questions: [{ question: "which port?", options: [] }] },
      }),
      makeAgentReturned({
        step: 2,
        sessionId: "s-1",
        output: { type: "message", text: "or should I decide?" },
      }),
    ],
  })

describe("the presses that leave the step", () => {
  it("offers the filing and the recompose beside the stop while a turn runs", async () => {
    let filings = 0
    server.use(
      emptyList,
      answers(driven()),
      http.post(`*/api/traks/${ID}/file`, () => {
        filings += 1
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    // The stop is the send transformed; File it and Recompose sit beside it, both offered
    // mid-turn because each takes the drive over rather than starting a second one.
    expect(await screen.findByRole("button", { name: "Stop the agent" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Recompose" })).toBeDefined()

    fireEvent.click(screen.getByRole("button", { name: "File it" }))
    await waitFor(() => {
      expect(filings).toBe(1)
    })
  })

  it("offers both beside the bar at a parked conversation, which has no card", async () => {
    server.use(emptyList, answers(talking()))
    renderDetail()

    expect(await screen.findByRole("button", { name: "File it" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Recompose" })).toBeDefined()
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull()
  })

  it("withholds both presses off the gate row, where the bar says the trak is not waiting", async () => {
    server.use(emptyList, answers(talking()))
    renderDetail()

    expect(await screen.findByRole("button", { name: "File it" })).toBeDefined()
    await step("Previous step")

    // The bar has disqualified itself, and a press that spends must not stand beside it.
    expect(await screen.findByPlaceholderText("The trak is not waiting here")).toBeDefined()
    expect(screen.queryByRole("button", { name: "File it" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Recompose" })).toBeNull()
  })

  it("withholds the filing at a parked conversation something else is driving", async () => {
    server.use(emptyList, answers(talking({ custody: { holder: { since: 1786028700000 } } })))
    renderDetail()

    await loaded()
    expect(screen.queryByRole("button", { name: "File it" })).toBeNull()
  })

  it("welds the recompose to Approve where a document is on the table, with no filing", async () => {
    server.use(emptyList, answers(filed()))
    renderDetail()

    expect(await screen.findByRole("button", { name: "Approve" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Recompose" })).toBeDefined()
    expect(screen.queryByRole("button", { name: "File it" })).toBeNull()

    // The sheet says the reversal: at this gate the work is kept before the composer runs.
    fireEvent.click(screen.getByRole("button", { name: "Recompose" }))
    expect(within(sheet() ?? document.body).getByText(/committed first/)).toBeDefined()
  })

  it("offers File it and Recompose beside the bar at a questions gate, with no approve", async () => {
    // A step's own answers gate — not the composer's, which refuses a replan outright.
    // Nothing is filed, so the questions card carries no header press and the pair sits
    // beside the bar.
    server.use(
      emptyList,
      answers(
        talking({
          state: { _tag: "AwaitingHuman", step: 2, kind: "answers" },
          log: [
            makeTrakCreated({ description: "add a client" }),
            makeAgentReturned({
              step: 2,
              sessionId: "s-1",
              output: { type: "questions", questions: [{ question: "which port?", options: [] }] },
            }),
          ],
        }),
      ),
    )
    renderDetail()

    expect(await screen.findByRole("button", { name: "Recompose" })).toBeDefined()
    expect(screen.getByRole("button", { name: "File it" })).toBeDefined()
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull()
  })

  it("says why a refused filing did not land, under the bar", async () => {
    server.use(
      emptyList,
      answers(driven()),
      http.post(`*/api/traks/${ID}/file`, () =>
        HttpResponse.json({ _tag: "NothingToStop" }, { status: 409, statusText: "NothingToStop" }),
      ),
    )
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "File it" }))
    expect(await screen.findByText("Nothing is running here to interrupt.")).toBeDefined()
  })
})

/**
 * The gate's presses follow the conversation: once a prose reply is the newest thing at a
 * document gate, the presses leave the card the reply pushed up the transcript and stand
 * beside the bar — Approve travelling with Recompose, and the answer form to a foot card so
 * it is still answerable.
 */
describe("the gate's presses after a prose reply", () => {
  it("moves Approve and Recompose beside the bar once a prose reply is the newest thing", async () => {
    // The presses are still on screen and still work — only the site moved.
    let approveCount = 0
    server.use(
      emptyList,
      answers(repliedAtDoc()),
      http.post(`*/api/traks/${ID}/act`, () => {
        approveCount += 1
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    expect(await screen.findByRole("button", { name: "Approve" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Recompose" })).toBeDefined()
    expect(screen.queryByRole("button", { name: "File it" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Approve" }))
    await waitFor(() => {
      expect(approveCount).toBe(1)
    })
  })

  it("keeps the answer form on screen after a prose reply at a questions gate", async () => {
    // The form, which rode the question card, moves to a fresh card at the foot; the
    // presses go beside the bar.
    server.use(emptyList, answers(repliedAtQuestions()))
    renderDetail()

    expect(await screen.findByRole("button", { name: "File it" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Recompose" })).toBeDefined()
    // The live form, told apart from the settled record up the transcript by its submit.
    expect(screen.getByRole("button", { name: "1 still to answer" })).toBeDefined()
  })
})

/**
 * The sheet the recompose opens. What a switch cannot answer: that the reason is typed
 * there and nowhere else, that it posts as a replan and shuts, and that a refusal keeps
 * the sheet and the draft.
 */
describe("the recompose sheet", () => {
  it("takes the reason in a sheet and posts it as a replan, then shuts", async () => {
    const sent: unknown[] = []
    server.use(
      emptyList,
      answers(talking()),
      acts((body) => {
        sent.push(body)
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "Recompose" }))
    const open = sheet()
    expect(open).not.toBeNull()
    // Nothing was filed here, and the sheet says so — and still promises the commit, which
    // a replan now takes at every gate.
    expect(within(open ?? document.body).getByText(/Nothing has been filed here/)).toBeDefined()
    expect(within(open ?? document.body).getByText(/committed first/)).toBeDefined()

    // Blank sends nothing: the composer run to read nothing spends the same as one run to
    // read a paragraph.
    const send = within(open ?? document.body).getByRole("button", { name: "Recompose" })
    expect(send.hasAttribute("disabled")).toBe(true)

    fireEvent.change(screen.getByRole("textbox", { name: "What should happen instead?" }), {
      target: { value: "  split it into two steps  " },
    })
    fireEvent.click(send)

    await waitFor(() => {
      expect(sent).toEqual([{ action: "replan", reason: "split it into two steps" }])
    })
    await waitFor(() => {
      expect(sheet()).toBeNull()
    })
  })

  it("keeps the sheet and the draft on a refusal, with the sentence inside it", async () => {
    server.use(
      emptyList,
      answers(talking()),
      acts(() => HttpResponse.json({ _tag: "Driving" }, { status: 409, statusText: "Driving" })),
    )
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "Recompose" }))
    const field = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "What should happen instead?",
    })
    fireEvent.change(field, { target: { value: "not like that" } })
    fireEvent.click(within(sheet() ?? document.body).getByRole("button", { name: "Recompose" }))

    expect(await screen.findByText("Something is already driving this.")).toBeDefined()
    expect(sheet()).not.toBeNull()
    expect(field.value).toBe("not like that")
  })

  it("shuts on Escape and on Cancel without losing what was typed", async () => {
    server.use(emptyList, answers(talking()))
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "Recompose" }))
    const field = screen.getByRole("textbox", { name: "What should happen instead?" })
    fireEvent.change(field, { target: { value: "keep this" } })
    fireEvent.keyDown(field, { key: "Escape" })
    expect(sheet()).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Recompose" }))
    expect(
      screen.getByRole<HTMLTextAreaElement>("textbox", { name: "What should happen instead?" })
        .value,
    ).toBe("keep this")
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(sheet()).toBeNull()
  })
})

/**
 * A position the **engine** is working at, which is eight of the twenty-one states and was
 * the one thing the drawer had nothing to say about.
 *
 * Two of them were a lie rather than a silence: at `Preparing` and `Spawning` the pane drew
 * *Nothing has run here yet — The agent has not run at this position* about a position no
 * agent will ever run at. The others left the previous step's turns or the ending card
 * on screen with nothing saying a `git` was in flight.
 *
 * What is worth asserting here and not in `engineWork.test.ts` is everything that module
 * cannot see: which *row* the block lands on, that it takes the pane rather than sitting
 * over what was there, and that a reader who has stepped elsewhere keeps their turns.
 */
const HELD = { holder: { since: 1_786_028_700_000 } }

/** A checkout, so the three states that commit have a branch to name. */
const WORKTREE = { path: "/tmp/wt", branch: "trak/auto-commit", base: "main" }

/** The spawn fixture with its `ChildrenSpawned` taken out — at `Spawning` the engine has
 *  not written it yet, which is the whole of what that state is on its way to. */
const spawning = (over: Partial<TrakDetailDto> = {}): TrakDetailDto =>
  spawner({
    state: { _tag: "Spawning", step: 2 },
    worktree: WORKTREE,
    log: [
      makeTrakCreated({ description: "add a client" }),
      makeComposerReturned({
        sessionId: "s-plan",
        output: { type: "proposal", title: "Add a read-only client", steps: [] },
      }),
      makeAgentReturned({ step: 1, sessionId: "s-0", output: { type: "artifact", sections: {} } }),
    ],
    ...over,
  })

/**
 * The eight, each with the trak that reaches it, what it now says, and the thing it
 * replaced. `gone` is the point of the table: four different surfaces are being taken over,
 * and a shared assertion would be vacuous at three of them.
 *
 * Hand-written, and nothing checks it against `engineWork`'s own list: a row short compiles
 * and simply stops asserting that state, which is how `Effecting` sat here uncovered.
 */
const ENGINE_WORK = [
  {
    tag: "Preparing",
    trak: () => detail({ state: { _tag: "Preparing" }, plan: undefined, log: [], transcript: [] }),
    says: "Making the checkout and running setup",
    command: undefined,
    gone: "Nothing has run here yet",
  },
  {
    tag: "Committing",
    trak: () => detail({ state: { _tag: "Committing", step: 2 }, worktree: WORKTREE }),
    says: "Keeping the work on the branch",
    command: "trak/auto-commit",
    gone: BUILT,
  },
  {
    // The one whose work is not in this checkout, and the only row with no mono line:
    // which scripts run here is on the agent file, which never crosses the wire.
    tag: "Effecting",
    trak: () => detail({ state: { _tag: "Effecting", step: 2 }, worktree: WORKTREE }),
    says: "Sending what this step filed, outside the checkout",
    command: undefined,
    gone: BUILT,
  },
  {
    tag: "Spawning",
    trak: () => spawning(),
    says: "A trak for each piece, with its own plan",
    command: "2 pieces, off trak/auto-commit",
    gone: "Nothing has run here yet",
  },
  {
    tag: "Integrating",
    trak: () => detail({ state: { _tag: "Integrating" }, worktree: WORKTREE }),
    says: "Keeping the work on the branch",
    command: "trak/auto-commit",
    gone: BUILT,
  },
  {
    tag: "Abandoning",
    trak: () =>
      detail({ state: { _tag: "Abandoning", reason: "changed my mind" }, worktree: WORKTREE }),
    says: "Keeping the work on the branch",
    command: "trak/auto-commit",
    gone: BUILT,
  },
  {
    tag: "Merging",
    trak: () => finished({ state: { _tag: "Merging" } }),
    says: "Putting the work in",
    command: "git merge --no-ff",
    gone: "The plan ran out and the work is on its branch.",
  },
  {
    tag: "Closing",
    trak: () => finished({ state: { _tag: "Closing" } }),
    says: "Taking the checkout away",
    command: "git worktree remove --force",
    gone: "The plan ran out and the work is on its branch.",
  },
] as const

describe("a position the engine is working at", () => {
  it.each(ENGINE_WORK)(
    "says what is happening at $tag, in place of what was there",
    async ({ trak, says, command, gone }) => {
      // Held, so this is the working face — the same eight states with nobody carrying
      // them are the stopped one, which the group below is about.
      server.use(emptyList, answers({ ...trak(), custody: HELD }), previews({ into: "main" }))
      renderDetail()

      expect(await screen.findByText(says)).toBeDefined()
      if (command !== undefined) expect(screen.getByText(command)).toBeDefined()
      expect(screen.queryByText(gone)).toBeNull()
    },
  )

  it("leaves a reader who has stepped elsewhere the turns they went to read", async () => {
    // The block is pinned to the row the trak is standing at, asked through `restingFor` —
    // a rule keyed to the state alone would blank whatever row you walked to.
    server.use(
      emptyList,
      answers({ ...detail({ state: { _tag: "Committing", step: 2 } }), custody: HELD }),
    )
    renderDetail()

    expect(await screen.findByText("Keeping the work on the branch")).toBeDefined()
    await goTo("planner — sketch the routes")

    expect(screen.getByText(PLANNED)).toBeDefined()
    expect(screen.queryByText("Keeping the work on the branch")).toBeNull()
  })

  /**
   * The stopped face, and the press inside it. This is the way back for a trak killed
   * mid-`git`, and it is the whole reason the two surfaces were folded into one rather than
   * stacked: leaving the notice above would have said *this is happening* and *this stopped*
   * within 200px.
   */
  it("picks a trak back up that was killed mid-commit, from the block itself", async () => {
    let sent = 0
    server.use(
      emptyList,
      answers(detail({ state: { _tag: "Committing", step: 2 }, worktree: WORKTREE })),
      resumes(() => {
        sent += 1
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    expect(await screen.findByText("Stopped while committing the work")).toBeDefined()
    // The state's own mark in an error face, not a second glyph for stopped engine work —
    // and the branch is still named, because it is still where the work is.
    expect(screen.getByText("trak/auto-commit")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Resume" }))

    await waitFor(() => {
      expect(sent).toBe(1)
    })
  })

  /**
   * The parent bringing its pieces back together, which draws nothing new by decision: the
   * parent has no row at a spawn, so the only pane available belongs to a piece — and
   * covering a piece's work with something its parent is doing is what `DrawerPane`'s
   * page-notice split exists to avoid.
   */
  it("leaves a piece's work alone while its parent joins them", async () => {
    server.use(
      emptyList,
      answers({ ...spawner({ state: { _tag: "Joining", step: 2 } }), custody: HELD }),
      ...answersFor(firstPiece, secondPiece),
    )
    renderDetail()

    await loaded()
    await openCall(PLANNED)
    expect(screen.getByText("traks-list/TrakRow.tsx")).toBeDefined()
    expect(screen.queryByText("Keeping the work on the branch")).toBeNull()
    expect(screen.queryByText("A trak for each piece, with its own plan")).toBeNull()
  })

  /**
   * The three shapes that must be untouched: an agent mid-turn, a check running, and a trak
   * that has come to rest. `CheckRunning` is the one of them that *is* the engine working —
   * it is excluded on purpose, because a failing check parks a person and that is
   * a different problem from a `git` nobody can be asked about.
   */
  it.each([
    { tag: "AgentWorking", state: { _tag: "AgentWorking", step: 2 } },
    { tag: "CheckRunning", state: { _tag: "CheckRunning", step: 2 } },
    { tag: "Merged", state: { _tag: "Merged", sha: "9f31c07" } },
  ] as const)("draws nothing new at $tag", async ({ state }) => {
    server.use(emptyList, answers({ ...finished({ state }), custody: HELD }))
    renderDetail()

    await screen.findByRole("heading", { name: TITLE })
    for (const says of ENGINE_WORK.map((work) => work.says)) {
      expect(screen.queryByText(says)).toBeNull()
    }
  })
})

/** Where the pane is pointing the browser for the agent's picture. */
const drawn = async (): Promise<string> =>
  (await screen.findByRole("img", { name: "the pane" })).getAttribute("src") ?? ""

/**
 * A shot an agent took, drawn again after the agent re-took it.
 *
 * **A shot is overwritten in place under a name that never changes**, which is what leaves
 * the address as the only thing that can tell the browser to fetch it again. `no-store` on
 * the route cannot: an `<img>` is served out of the document's *list of available images*,
 * which is consulted ahead of the HTTP cache and which `no-store` does not clear — a second
 * element with the same `src` in the same document never reaches the network at all. So a
 * surface that never reloads draws whichever bytes it first saw under that path, for as
 * long as it is open and however many times the file behind it is rewritten.
 */
describe("a shot the trak has re-taken", () => {
  const SHOT = ".atelier/proof/.shots/pane.png"

  /** The step's document, with the picture the agent took beside its words. */
  const shot = makeAgentReturned({
    step: 2,
    sessionId: "s-1",
    output: { type: "artifact", sections: { Proof: `![the pane](${SHOT})` } },
  })

  /**
   * The one route the drawer asks for that nothing else in this file waits long enough to
   * hear go unanswered. Two mounts in one case is what makes it audible, and a case that
   * printed MSW's complaint would be a passing run that is not silent.
   */
  const noAgents = http.get("*/api/agents", () => HttpResponse.json([]))

  it("draws it, out of the checkout it was taken in", async () => {
    server.use(emptyList, noAgents, answers(filed({ log: [makeTrakCreated(), shot] })))
    renderDetail()

    expect(await drawn()).toContain(encodeURIComponent(SHOT))
  })

  /**
   * The trak moves and the same document is still on screen — the ordinary case, because a
   * step that re-renders and shoots again keeps the name it wrote the first time. The
   * address has to move with it: what is on screen is the file as it was when the surface
   * first asked, and nothing short of a new address makes it ask twice.
   */
  it("gives it a new address once the trak has moved", async () => {
    server.use(emptyList, noAgents, answers(filed({ log: [makeTrakCreated(), shot] })))
    renderDetail()
    const before = await drawn()

    cleanup()
    server.use(
      emptyList,
      noAgents,
      answers(filed({ log: [makeTrakCreated(), shot, makeChecksPassed({ step: 2 })] })),
    )
    renderDetail()

    expect(await drawn()).not.toBe(before)
  })
})
