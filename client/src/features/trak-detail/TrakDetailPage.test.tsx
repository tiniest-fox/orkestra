/**
 * Tier 2 (`testing-tiers`): the detail drawer end to end — route param, poll, and the
 * three surfaces the bar moves between.
 *
 * The assertions worth having here are the ones a pure test cannot make: that the pane
 * shows the *agent's* turns and only the ones belonging to where you are standing, that
 * the composer is a row on the map you can drop into, and that the drawer offers no way
 * to spend money. The projections themselves are asserted in `planView.test.ts` and
 * `turns.test.ts`, never read back off a render.
 *
 * Fixtures are `@orkestra/shared`-typed, checklist item 2.
 */

import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import type { TrakDetailDto } from "@orkestra/shared/dto/trak"
import {
  makeAgentReturned,
  makeAgentStep,
  makeCheckFailed,
  makeFileChange,
  makeChanges,
  makeComposeEntry,
  makeComposerReturned,
  makeHumanActed,
  makeModels,
  makePlan,
  makeProposal,
  makeSession,
  makeSpawned,
  makeTool,
  makeTrakCreated,
} from "../../fixtures"
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
  map,
  goTo,
  acts,
  emptyList,
  held,
  filed,
  resumes,
  working,
  finished,
  previews,
} from "./TrakDetailPage.support"

/**
 * What each of `detail()`'s three positions shows on its row before it is pressed.
 *
 * A run of one folds like a run of forty — `ActivityGroup` carries why — so a position's
 * call reads as a counted phrase and the path it names is a press away. The three call
 * three different tools, which is what keeps *this position's turns and no other's* an
 * assertion the collapsed rows can still make.
 */
const COMPOSED = "Globbed 1 pattern"

describe("TrakDetailPage", () => {
  it("opens where the trak is, showing that position's turns and no other's", async () => {
    server.use(answers(detail()))
    renderDetail()

    // Step 1 is where the gate is, so the edit is what the agent did here — and the other
    // two turns belong to positions you are not standing at. Each position calls a
    // different tool, so the folded row is still what says which one's turns these are.
    expect(await screen.findByText(BUILT)).toBeDefined()
    expect(screen.queryByText(PLANNED)).toBeNull()
    expect(screen.queryByText(COMPOSED)).toBeNull()
  })

  it("names the agent standing at the position, beside what it was asked to do", async () => {
    server.use(answers(detail()))
    renderDetail()

    // Scoped to the navigator, because the question is what a reader deep in a transcript
    // can see: the map says the same two things a surface away, and the rail names every
    // position at once. Both are off this list by construction — the nav holds neither.
    await screen.findByText(BUILT)
    const bar = within(screen.getByRole("navigation"))
    expect(bar.getByText("builder")).toBeDefined()
    expect(bar.getByText("build the drawer")).toBeDefined()

    // And it is the position's own name rather than the trak's newest: moving names the
    // agent that ran there instead.
    await goTo("planner — sketch the routes")
    expect(within(screen.getByRole("navigation")).getByText("planner")).toBeDefined()
  })

  it("heads the drawer with the plan's title rather than the request", async () => {
    server.use(answers(detail()))
    renderDetail()

    // The composer's name for the work, not the paragraph it was asked for. The
    // request is still on screen — `RequestView` shows it under a heading saying so —
    // which is what makes this a choice about the band rather than a substitution.
    expect(await screen.findByRole("heading", { name: "Add a read-only client" })).toBeDefined()
  })

  it("falls back to the request while there is no plan to name the work", async () => {
    server.use(answers(detail({ plan: undefined, state: { _tag: "Composing" } })))
    renderDetail()

    expect(await screen.findByRole("heading", { name: "add a client" })).toBeDefined()
  })

  it("goes to a position pressed in the rail, and shows that entry's turn instead", async () => {
    server.use(answers(detail()))
    renderDetail()

    await goTo("planner — sketch the routes")

    expect(await screen.findByText(PLANNED)).toBeDefined()
    expect(screen.queryByText(BUILT)).toBeNull()
  })

  it("drops back onto the pane from the map, rather than moving in the abstract", async () => {
    server.use(answers(detail()))
    renderDetail()

    await press(/Map/)
    fireEvent.click(await screen.findByRole("button", { name: /sketch the routes/ }))

    // Not still on the map with something changed somewhere invisible: the map carries no
    // *you are here* mark, so a press that left you there would look inert.
    expect(await screen.findByText(PLANNED)).toBeDefined()
  })

  it("says so plainly at a position the agent has not reached", async () => {
    server.use(answers(detail({ state: { _tag: "AgentWorking", step: 1 }, transcript: [] })))
    renderDetail()

    // The shared `EmptyState`, in its `blocks` shape: a title, a sentence, and the
    // ghost of the turns that never ran.
    expect(await screen.findByText("Nothing has run here yet")).toBeDefined()
    expect(screen.getByText("The agent has not run at this position.")).toBeDefined()
  })

  it("offers nothing that spends money beyond the one press this gate accepts", async () => {
    // `AwaitingHuman{approval}` accepts `Approve` — asserted in *the step gate* below —
    // and refuses each of these, which `decide` settles as `Failed{engine}` rather than
    // refusing. So a control drawn one state too wide ends the trak. Chatting is the one
    // action that applies at every gate; the rest are still `pnpm ork`.
    server.use(answers(detail()))
    renderDetail()

    await screen.findByText(BUILT)
    for (const name of ["Send answers", "Retry", "Skip", "Replan", /^Close —/]) {
      expect(screen.queryByRole("button", { name })).toBeNull()
    }
  })

  it("keeps its four bands through the first load of the trak it just made", async () => {
    // Held open so the first load is a state rather than a race — the same frame any
    // cold open of `/traks/:id` starts in, which is why the header holds its line
    // rather than repeating `NewTrakPage`'s words: a trak reopened cold may already be
    // running or done.
    server.use(
      emptyList,
      http.get(`*/api/traks/${ID}`, async () => {
        await new Promise(() => {})
        return HttpResponse.json(detail())
      }),
    )
    renderDetail()

    expect(await screen.findByRole("heading")).toBeDefined()
    expect(screen.getByRole("navigation")).toBeDefined()
    expect(screen.getByRole("textbox", { name: "Loading the trak…" })).toBeDefined()
  })
})

/** At the plan gate, with the composer's proposal as the only thing that has run. */
const parked = (over: Partial<TrakDetailDto> = {}): TrakDetailDto =>
  detail({
    state: { _tag: "AwaitingProposal" },
    log: [
      makeTrakCreated({ description: "add a client" }),
      makeComposerReturned({
        sessionId: "s-plan",
        output: {
          type: "proposal",
          title: "Add a read-only client",
          steps: [
            {
              type: "agent",
              agent: "planner",
              instruction: "sketch the routes",
              conversational: false,
            },
            {
              type: "agent",
              agent: "builder",
              instruction: "build the drawer",
              conversational: false,
            },
          ],
        },
      }),
    ],
    transcript: [
      makeSpawned({ pid: 100 }),
      makeSession({ id: "s-plan" }),
      makeTool({ name: "Glob", kind: "Glob", detail: "**/*.ts" }),
    ],
    ...over,
  })

const approves = (respond: () => Response | Promise<Response>) =>
  http.post(`*/api/traks/${ID}/act`, respond)

/**
 * The one press in this drawer that spends money. The theme is the same as
 * `NewTrakPage.test.tsx`'s: what it refuses to do is where the judgement is, because the
 * server cannot tell a deliberate click from a double one and each click is a `claude`.
 */
/**
 * How the rail's strip is standing, found through its list — `Rail` is a box with no role
 * of its own. Collapsed rather than absent: the strip stays mounted so it can slide, and
 * happy-dom loads no stylesheet, so *is it there* is answered yes on every surface.
 *
 * **Both halves, because either alone leaves the other free to be deleted.** `inert` is
 * what takes the strip out of the accessibility tree and out of the focus order, which a
 * default role query cannot see through and a `hidden` one confirms; the transform is what
 * moves it off the edge, and being inline it is the one part of the slide happy-dom can read.
 * Asserting only the first passes on a rail that is fully visible and unreachable.
 */
const railStanding = (): { readonly inert: boolean; readonly transform: string } => {
  const strip = screen.getByRole("list", { name: "Positions", hidden: true }).parentElement
  if (strip === null) throw new Error("`Rail` draws its list inside a strip")
  return { inert: strip.hasAttribute("inert"), transform: strip.style.transform }
}

const OUT = { inert: true, transform: "translateX(-48px)" }
const IN = { inert: false, transform: "" }

describe("the map, and the rail beside it", () => {
  it("slides the rail out on the map and back in on every other surface", async () => {
    server.use(answers(detail()))
    renderDetail()
    await loaded()

    expect(screen.getByRole("list", { name: "Positions" })).toBeDefined()
    expect(railStanding()).toEqual(IN)

    fireEvent.click(screen.getByRole("button", { name: /Map/ }))
    await screen.findByRole("list", { name: "Plan" })
    expect(screen.queryByRole("list", { name: "Positions" })).toBeNull()
    expect(railStanding()).toEqual(OUT)

    // A surface change is a `setState`, not a navigation, so the rail is back on the
    // same tick the tab is pressed.
    for (const level of [/Trak/, /Changes/]) {
      fireEvent.click(screen.getByRole("button", { name: level }))
      expect(screen.getByRole("list", { name: "Positions" })).toBeDefined()
      expect(railStanding()).toEqual(IN)
    }
  })

  it("shows the whole of a step's instruction on the map", async () => {
    // A paragraph, because one line is what the map used to cut it to — and the length a
    // composer actually writes is what proves the row is not truncating at some other one.
    const paragraph =
      "Read the neighbouring file before adding one, because placement is not a judgment " +
      "call: every file has a kind, and the kind is determined by what it exports. Mirror " +
      "the analogous feature end to end before you write anything, and say in Summary when " +
      "the job turned out bigger than the instruction made it sound."
    server.use(
      answers(
        detail({
          plan: makePlan({
            title: TITLE,
            steps: [
              makeComposeEntry(),
              makeAgentStep({ agent: "planner", instruction: paragraph }),
              makeAgentStep({ agent: "builder", instruction: "build the drawer" }),
            ],
          }),
        }),
      ),
    )
    renderDetail()

    await press(/Map/)
    await screen.findByRole("list", { name: "Plan" })
    expect(map().getByText(paragraph)).toBeDefined()
  })
})

describe("a trak somebody else owns", () => {
  // The band itself is a host's to draw and test. The gates are public, and hold
  // whatever the slot draws.
  it("drops the gate's press and the chat bar, and the public slot draws no band", async () => {
    server.use(emptyList, answers(parked({ ownership: { owner: "alice" } })))
    renderDetail()

    expect(await screen.findByText("Proposed 2 steps")).toBeDefined()
    expect(screen.queryByRole("region", { name: "Ownership" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull()
    expect(screen.queryByRole("textbox")).toBeNull()
  })
})

describe("the plan gate", () => {
  it("puts the press in the proposal card's own header, at the gate", async () => {
    server.use(emptyList, answers(parked()))
    renderDetail()

    // The card is what is being decided about, so the button is on it — the drawer grew
    // no action bar. Found by role, because a control a test needs a testid to reach is
    // a control the markup got wrong.
    expect(await screen.findByRole("button", { name: "Approve" })).toBeDefined()
    expect(screen.getByText("Proposed 2 steps")).toBeDefined()
  })

  it("sends one Approve, and refuses the second click while the first is in flight", async () => {
    let sent = 0
    const flight = held()
    server.use(
      emptyList,
      answers(parked()),
      approves(async () => {
        sent += 1
        await flight.wait
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    const button = await screen.findByRole("button", { name: "Approve" })
    fireEvent.click(button)

    // Non-submittable, not merely spinning: a second press must not start a second drive.
    await waitFor(() => {
      expect(button.hasAttribute("disabled")).toBe(true)
    })
    fireEvent.click(button)
    expect(sent).toBe(1)

    flight.release()
  })

  it("will not press at all while something already holds the trak", async () => {
    let sent = 0
    server.use(
      emptyList,
      answers(parked({ custody: { holder: { since: 1786028700000 } } })),
      approves(() => {
        sent += 1
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    // Custody, not state — a `pnpm ork` in another terminal is holding this one, and the
    // server would answer `409 Driving`. A 409 the user provoked is a UI bug.
    const button = await screen.findByRole("button", { name: "Approve" })
    expect(button.hasAttribute("disabled")).toBe(true)
    fireEvent.click(button)
    expect(sent).toBe(0)
  })

  it("says why a refused approval did not land, and leaves the plan on screen", async () => {
    server.use(
      emptyList,
      answers(parked()),
      approves(() =>
        HttpResponse.json({ _tag: "Driving" }, { status: 409, statusText: "Driving" }),
      ),
    )
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }))

    // The engine's own sentence, not a status code — and nothing covers the proposal,
    // because the way through a refusal is to read it and press the same button again.
    expect(await screen.findByRole("alert")).toBeDefined()
    expect(screen.getByText("Something is already driving this.")).toBeDefined()
    // The plan itself, by an entry only the card draws — the title is also the bar's
    // caption, so finding it would not say the card survived.
    expect(screen.getByText("build the drawer")).toBeDefined()
  })

  it("draws no press once the trak has moved past the gate", async () => {
    // The same proposal, still on screen, and nobody being asked about it. Whether a
    // control exists is a fact about `state` and about nothing else.
    server.use(emptyList, answers(parked({ state: { _tag: "AgentWorking", step: 1 } })))
    renderDetail()

    await loaded()
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull()
  })
})

/** The composer's other gate, with a question as the only thing that has run. */
const asked = (over: Partial<TrakDetailDto> = {}): TrakDetailDto =>
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
    ...over,
  })

/**
 * One state along from the plan gate, and the one that accepts a different action. What is
 * asserted here is the pair of mistakes the states are one apart on: `onComposerAnswers`
 * takes `AnswerQuestions` and nothing else, so a `Chat` sent from here is
 * `Failed{kind:"engine"}` — and an `Approve` is the same thing from the other side.
 */
describe("the composer's question gate", () => {
  it("puts the form in the question card, and neither of the other gates' presses", async () => {
    server.use(emptyList, answers(asked()))
    renderDetail()

    expect(
      await screen.findByRole("textbox", { name: "Which subcommands should take the flag?" }),
    ).toBeDefined()
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull()
  })

  it("asks at the composer's first run too, where there is no plan behind it", async () => {
    // The shape the gate actually arrives in most often: the composer asked before it
    // proposed anything, so the trak has no plan entries at all. The row that stands for
    // the composer was handed no turns in that case, and the card rides in a turn — so
    // the one screen meant to ask drew *Nothing has run here yet* instead, over a
    // transcript that was sitting right there, with no way to answer from the surface.
    server.use(emptyList, answers(asked({ plan: undefined })))
    renderDetail()

    expect(
      await screen.findByRole("textbox", { name: "Which subcommands should take the flag?" }),
    ).toBeDefined()
    expect(screen.queryByText("Nothing has run here yet")).toBeNull()
  })

  /**
   * The sentence that used to read *Nothing is being asked here*, on the one screen with a
   * question card above the bar. The bar still shuts — a `Chat` here ends the trak — and
   * what changed is that it names the form instead of denying the ask.
   */
  it("shuts the chat bar with the reason, rather than claiming nothing was asked", async () => {
    server.use(emptyList, answers(asked()))
    renderDetail()

    const bar = await screen.findByRole("textbox", { name: "Say something to the agent" })
    expect(bar.hasAttribute("disabled")).toBe(true)
    expect(bar.getAttribute("placeholder")).toBe("Answer the questions above")
  })

  it("sends one answer per question, positionally, and refuses the second click", async () => {
    const sent: unknown[] = []
    const flight = held()
    server.use(
      emptyList,
      answers(asked()),
      acts(async (body) => {
        sent.push(body)
        await flight.wait
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    // Picking fills the field rather than settling the answer — the engine takes prose.
    fireEvent.click(await screen.findByRole("button", { name: /list only/ }))
    const send = screen.getByRole("button", { name: "Send answers" })
    fireEvent.click(send)

    await waitFor(() => {
      expect(send.hasAttribute("disabled")).toBe(true)
    })
    fireEvent.click(send)

    expect(sent).toEqual([{ action: "answer", answers: ["list only"] }])
    flight.release()
  })

  it("will not send at all while something already holds the trak", async () => {
    let posts = 0
    server.use(
      emptyList,
      answers(asked({ custody: { holder: { since: 1786028700000 } } })),
      approves(() => {
        posts += 1
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    // Custody, not state: the server would answer `409 Driving`, and a 409 the user
    // provoked is a UI bug caught downstream.
    const field = await screen.findByRole("textbox", {
      name: "Which subcommands should take the flag?",
    })
    fireEvent.change(field, { target: { value: "list only" } })
    fireEvent.click(screen.getByRole("button", { name: /still to answer|Send answers/ }))
    expect(posts).toBe(0)
  })

  it("draws no form once the trak has moved past the gate", async () => {
    // The same questions, still on screen, and nobody being asked about them.
    server.use(emptyList, answers(asked({ state: { _tag: "Composing" } })))
    renderDetail()

    await loaded()
    expect(
      screen.queryByRole("textbox", { name: "Which subcommands should take the flag?" }),
    ).toBeNull()
    // The list is still readable — what goes away is the ability to answer it.
    expect(screen.getByText("Which subcommands should take the flag?")).toBeDefined()
  })
})

/**
 * The three gates the engine refuses an approval at, each with the output that puts the
 * trak there — because the point is not that a boolean is false, it is that the card on
 * screen at each of them has no press on it.
 */
const nothingFiled = [
  {
    kind: "answers",
    output: { type: "questions", questions: [{ question: "which port?", options: [] }] },
  },
  {
    kind: "stuck",
    output: {
      type: "stuck",
      tried: "the obvious thing",
      happened: "it did not work",
      diagnosis: "the port is taken",
    },
  },
  { kind: "conversation", output: { type: "message", text: "here is what I found" } },
] as const

describe("the step gate", () => {
  it("puts the press in the filed document's own header, at the gate", async () => {
    server.use(emptyList, answers(filed()))
    renderDetail()

    // The document is what is being decided about, so the button is on it — the same
    // `CardShell` slot the proposal uses, rather than an action bar the drawer grew.
    expect(await screen.findByRole("button", { name: "Approve" })).toBeDefined()
    expect(screen.getByText("what the drawer now does")).toBeDefined()
  })

  it("presses the same route the plan gate does, once", async () => {
    let sent = 0
    server.use(
      emptyList,
      answers(filed()),
      approves(() => {
        sent += 1
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }))

    await waitFor(() => {
      expect(sent).toBe(1)
    })
  })

  it("takes work a declared check disagrees with, which is what that gate is for", async () => {
    server.use(
      emptyList,
      answers(filed({ state: { _tag: "AwaitingHuman", step: 2, kind: "checks" } })),
    )
    renderDetail()

    expect(await screen.findByRole("button", { name: "Approve" })).toBeDefined()
  })

  it.each(nothingFiled)(
    "draws no press at the $kind gate, where nothing has been filed to take",
    async ({ kind, output }) => {
      server.use(
        emptyList,
        answers(
          filed({
            state: { _tag: "AwaitingHuman", step: 2, kind },
            log: [
              makeTrakCreated({ description: "add a client" }),
              makeAgentReturned({ step: 2, sessionId: "s-1", output }),
            ],
          }),
        ),
      )
      renderDetail()

      await loaded()
      expect(screen.queryByRole("button", { name: "Approve" })).toBeNull()
    },
  )

  /**
   * A step re-entered after a failing check files twice and both are in the log. The press
   * belongs to the newest document; on the earlier one it would approve an attempt the
   * step itself has already replaced.
   */
  it("puts it on the live attempt and not on the one it superseded", async () => {
    server.use(
      emptyList,
      answers(
        filed({
          log: [
            makeTrakCreated({ description: "add a client" }),
            makeAgentReturned({
              step: 2,
              sessionId: "s-1",
              output: { type: "artifact", sections: { Summary: "the first go" } },
            }),
            makeCheckFailed({ step: 2, name: "verify", output: "nope" }),
            makeAgentReturned({
              step: 2,
              sessionId: "s-1",
              output: { type: "artifact", sections: { Summary: "the second go" } },
            }),
          ],
        }),
      ),
    )
    renderDetail()

    // One press for two documents, and it is on the one headed as the latest attempt.
    const presses = await screen.findAllByRole("button", { name: "Approve" })
    expect(presses).toHaveLength(1)
    expect(screen.getByText("Attempt 2 of 2")).toBeDefined()
  })
})

/** A trak whose process died mid-command: an in-flight state with nobody holding it. */
const stopped = (over: Partial<TrakDetailDto> = {}): TrakDetailDto =>
  detail({ state: { _tag: "AgentWorking", step: 2 }, custody: {}, ...over })

/**
 * The press that is not a gate's, and the one thing that separates it from the two above:
 * an interrupted trak is a *standing* condition rather than a question, so the surface
 * has to keep offering it without ever taking it — and it has no card to sit on, because
 * nothing was filed.
 */
describe("a trak nothing is driving", () => {
  it("says what stopped it, with nothing filed to hang the press on", async () => {
    // Killed mid-turn, with the turn's own transcript gone: the pane has no card at all,
    // which is the case that decides this press cannot live where the gate's does.
    server.use(emptyList, answers(stopped({ transcript: [] })))
    renderDetail()

    // A sentence, not a bare press: the condition used to be chrome in the header band
    // with nothing anywhere saying what had happened to the trak.
    expect(await screen.findByText("nothing is carrying this trak")).toBeDefined()
    expect(screen.getByRole("button", { name: "Resume" })).toBeDefined()
    expect(screen.getByText("Picks it back up where it stopped.")).toBeDefined()
    // Above the empty shell rather than under it, where it is all there is to say.
    expect(screen.getByText("Nothing has run here yet")).toBeDefined()
  })

  /**
   * The same stoppage at a state the *engine* was working at, which is the one shape this
   * notice no longer takes. `Preparing` is the case it used to: the pane drew *Nothing has
   * run here yet* about a position no agent will ever run at, with the sentence over it.
   * The block says the act instead, and the press moved inside it — the two surfaces would
   * otherwise have said *this is happening* and *this stopped* within 200px.
   */
  it("folds the notice into the block, where the engine was the thing that stopped", async () => {
    server.use(
      emptyList,
      answers(stopped({ state: { _tag: "Preparing" }, transcript: [], log: [] })),
    )
    renderDetail()

    expect(await screen.findByText("Stopped while making the checkout")).toBeDefined()
    expect(screen.getByRole("button", { name: "Resume" })).toBeDefined()
    // The sentence survives; the plate that used to carry it does not, and neither does
    // the empty shell it stood over.
    expect(screen.getByText(/A command was in flight/)).toBeDefined()
    expect(screen.queryByText("nothing is carrying this trak")).toBeNull()
    expect(screen.queryByText("Nothing has run here yet")).toBeNull()
  })

  /**
   * The band speaks for the trak the page is *of* at every position, and a stopped trak is
   * whichever one stopped — at a spawn, a piece the band is not speaking for. So the press
   * is at the step altitude, on the notice, and the band carries no way back at all.
   */
  it("draws no way back in the header band, at any altitude", async () => {
    server.use(emptyList, answers(stopped()))
    renderDetail()

    await loaded()
    expect(screen.getByRole("button", { name: "Resume" })).toBeDefined()

    // The band is on screen at all three, so its absence here is the press being on the
    // pane and nowhere else.
    for (const level of [/Map/, /Trak/]) {
      fireEvent.click(screen.getByRole("button", { name: level }))
      expect(screen.queryByRole("button", { name: "Resume" })).toBeNull()
    }
  })

  it("sends one Resume, and refuses the second click while the first is in flight", async () => {
    let sent = 0
    const flight = held()
    server.use(
      emptyList,
      answers(stopped()),
      resumes(async () => {
        sent += 1
        await flight.wait
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    const button = await screen.findByRole("button", { name: "Resume" })
    fireEvent.click(button)

    await waitFor(() => {
      expect(button.hasAttribute("disabled")).toBe(true)
    })
    fireEvent.click(button)
    expect(sent).toBe(1)

    flight.release()
  })

  /**
   * Not a disabled press: no press. Custody is half of what interrupted means, so a trak
   * somebody is driving is not stopped — it is busy, and *Resume* on screen beside a
   * running turn would be the drawer disagreeing with itself.
   */
  it("draws nothing at all while something already holds the trak", async () => {
    server.use(emptyList, answers(stopped({ custody: { holder: { since: 1786028700000 } } })))
    renderDetail()

    await loaded()
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull()
  })

  /** The other half: a trak at a gate is not driving anything and is not stopped either. */
  it("draws nothing at a gate, where nobody is driving because nobody has answered", async () => {
    server.use(emptyList, answers(detail()))
    renderDetail()

    await screen.findByRole("button", { name: "Approve" })
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull()
  })

  /**
   * The race the press cannot avoid: `running` is as fresh as the last poll, so a second
   * tab or a `pnpm ork` claiming the trak in between is what this sentence is for.
   */
  it("says why a refused resume did not land", async () => {
    server.use(
      emptyList,
      answers(stopped()),
      resumes(() => HttpResponse.json({ _tag: "Driving" }, { status: 409, statusText: "Driving" })),
    )
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "Resume" }))

    expect(await screen.findByRole("alert")).toBeDefined()
    expect(screen.getByText("Something is already driving this.")).toBeDefined()
  })
})

/**
 * The `⋯` beside the drawer's X, and the one ending it offers.
 *
 * What is worth asserting here and not in `controls.test.ts` is everything the exception
 * rests on: that the press is *live* while an agent is working and somebody holds the trak
 * — which is the one case the whole feature is about, and the one every other press in
 * this drawer refuses — that it still takes two presses, and that the second one is
 * non-submittable once it is in flight.
 */
const abandons = (respond: () => Response | Promise<Response>) =>
  http.post(`*/api/traks/${ID}/abandon`, respond)

describe("the ending in the header", () => {
  it("ends a trak with an agent mid-turn, which every other press here refuses", async () => {
    let seen: unknown
    server.use(
      emptyList,
      answers(working()),
      http.post(`*/api/traks/${ID}/abandon`, async ({ request }) => {
        seen = await request.json()
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    // Live, not greyed: `running` disables every other acting hook here, and this is the
    // documented exception — the route interrupts the drive rather than refusing it.
    fireEvent.click(await screen.findByRole("button", { name: "More options" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive this trak" }))

    const send = screen.getByRole("button", { name: "Archive" })
    expect(send.hasAttribute("disabled")).toBe(false)
    fireEvent.click(send)

    // The wire's field is required and the confirmation is a press, not a sentence.
    await waitFor(() => {
      expect(seen).toEqual({ reason: "" })
    })
  })

  it("takes two presses, and sends nothing on the first", async () => {
    let sent = 0
    server.use(
      emptyList,
      answers(working()),
      abandons(() => {
        sent += 1
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "More options" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive this trak" }))

    // Killing a running `claude` is irreversible and earns one confirmation. The item
    // opened it; nothing has been asked of the server yet.
    expect(screen.getByText(/The agent mid-turn is interrupted/)).toBeDefined()
    expect(sent).toBe(0)

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.getByRole("menuitem", { name: "Archive this trak" })).toBeDefined()
    expect(sent).toBe(0)
  })

  it("sends one abandon, and refuses the second click while the first is in flight", async () => {
    let sent = 0
    const flight = held()
    server.use(
      emptyList,
      answers(working()),
      abandons(async () => {
        sent += 1
        await flight.wait
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "More options" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive this trak" }))
    const send = screen.getByRole("button", { name: "Archive" })
    fireEvent.click(send)

    // The half of the hook contract that is not relaxed: `running` is ignored, its own
    // pending mutation is not.
    await waitFor(() => {
      expect(send.hasAttribute("disabled")).toBe(true)
    })
    fireEvent.click(send)
    expect(sent).toBe(1)

    flight.release()
  })

  it("says why a refused ending did not land, beside the press that earned it", async () => {
    server.use(
      emptyList,
      answers(working()),
      abandons(() => HttpResponse.json({ _tag: "AtRest" }, { status: 409, statusText: "AtRest" })),
    )
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "More options" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive this trak" }))
    fireEvent.click(screen.getByRole("button", { name: "Archive" }))

    expect(await screen.findByText("That trak has already come to rest.")).toBeDefined()
    // Nothing covers the press: the way through a refusal is to read it and decide again.
    expect(screen.getByRole("button", { name: "Archive" })).toBeDefined()
  })

  /**
   * The item that opens the confirmation unmounts as it does, and Chromium then puts focus
   * on `<body>` rather than in the panel — measured. happy-dom moves no focus on a
   * `fireEvent.click` either, so `<body>` is where it starts here too, and what this pins is
   * that the panel takes it off there. The Escape is aimed at whatever holds focus rather
   * than at the press, which is the half that fails when the panel does not: a keystroke at
   * the document never reaches `OverflowMenu`'s handler.
   */
  it("puts focus on the press it is asking about, so Escape still shuts the panel", async () => {
    server.use(emptyList, answers(working()))
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "More options" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive this trak" }))

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Archive" }))

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull()
  })
})

/**
 * Which of the two endings the menu offers, and where it offers none — the half of the
 * control that is a fact about `state` and about the trak's own parentage. The switches
 * themselves are `controls.test.ts` and `family.test.ts`; what these pin is that the panel
 * draws what they decided, and the two things a pure test cannot see: that it is there at
 * every altitude, and that it no longer shares a row with the way out of a stopped trak.
 */
describe("what the header's ending offers", () => {
  it("is on screen at every altitude, because ending is about the trak", async () => {
    server.use(emptyList, answers(working()))
    renderDetail()

    await loaded()
    for (const level of [/Map/, /Trak/]) {
      fireEvent.click(screen.getByRole("button", { name: level }))
      expect(screen.getByRole("button", { name: "More options" })).toBeDefined()
    }
  })

  /**
   * *Pick this back up* directly above *end it* was two contradictory presses at equal
   * weight, and the panel used to hide the second while it asked. They are two surfaces
   * now — a panel over the band, and a notice in the pane — so the way out stays where it
   * is and the reader can read both.
   */
  it("leaves the way out of a stopped trak alone while the confirmation stands", async () => {
    server.use(emptyList, answers(stopped()))
    renderDetail()

    expect(await screen.findByRole("button", { name: "Resume" })).toBeDefined()

    fireEvent.click(screen.getByRole("button", { name: "More options" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive this trak" }))
    expect(screen.getByRole("button", { name: "Archive" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Resume" })).toBeDefined()
  })

  /** One word, two routes: at `Finished` the item is the close route's — its body has no
   *  agent to interrupt — and `abandonRoute` would answer `409 AtRest`. */
  it("carries the archive on the close route once the plan has run out", async () => {
    server.use(emptyList, answers(finished()), previews({ into: "main" }))
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "More options" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive this trak" }))
    expect(screen.getByText(/The checkout goes/)).toBeDefined()
    expect(screen.queryByText(/The agent mid-turn is interrupted/)).toBeNull()
  })

  it("offers nothing at all once the trak has ended", async () => {
    server.use(emptyList, answers(finished({ state: { _tag: "Merged", sha: "9f31c07" } })))
    renderDetail()

    await loaded()
    expect(screen.queryByRole("button", { name: "More options" })).toBeNull()
  })

  /** A piece is archived like any other trak: the abandon route lands it on its parent as
   *  a drop, so the menu offers the press rather than a sentence about its parent. */
  it("offers a spawn's piece the same archive, on the abandon route", async () => {
    server.use(
      emptyList,
      answers(
        working({
          log: [
            makeTrakCreated({
              description: "wire the band",
              parent: { id: "p", step: 2, child: 0, depth: 1 },
            }),
          ],
        }),
      ),
    )
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "More options" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive this trak" }))
    expect(screen.getByText(/The agent mid-turn is interrupted/)).toBeDefined()
  })
})

/**
 * Two composer runs, a replan between them, and a transcript in the shape the engine
 * actually writes: a `Spawned` on the composer's turns and none on the step's. Both
 * halves of the bug are here — every run's lines used to pool in the one composer row,
 * and the step's used to be swallowed by the composer turn ahead of them.
 */
const recomposed = (): TrakDetailDto =>
  detail({
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
        { type: "compose", why: { _tag: "Replanned", step: 1, reason: "keep it smaller" } },
        {
          type: "agent",
          agent: "builder",
          instruction: "build the drawer",
          conversational: false,
        },
      ],
    },
    log: [
      makeTrakCreated({ description: "add a client" }),
      makeComposerReturned({
        sessionId: "s-plan",
        output: { type: "proposal", title: "Add a read-only client", steps: [] },
      }),
      makeAgentReturned({
        step: 1,
        sessionId: "s-0",
        output: { type: "artifact", sections: {} },
      }),
      makeHumanActed({ step: 1, action: { _tag: "Replan", reason: "keep it smaller" } }),
      makeComposerReturned({
        sessionId: "s-plan-2",
        output: { type: "proposal", title: "Add a read-only client", steps: [] },
      }),
    ],
    transcript: [
      makeSpawned({ pid: 100, position: "composer" }),
      makeSession({ id: "s-plan", position: "composer" }),
      makeTool({ name: "Glob", kind: "Glob", detail: "**/*.ts", position: "composer" }),
      // No `Spawned` — the path that wrote this one does not emit it.
      makeSession({ id: "s-0", position: 1 }),
      makeTool({ name: "Read", kind: "Read", detail: "src/plan.md", position: 1 }),
      makeSpawned({ pid: 300, position: "composer" }),
      makeSession({ id: "s-plan-2", position: "composer" }),
      makeTool({
        name: "Grep",
        kind: "Grep",
        detail: "only-the-second.ts",
        position: "composer",
      }),
    ],
  })

describe("the map", () => {
  it("draws the composer above the plan it wrote, and drops into its turns", async () => {
    server.use(answers(detail()))
    renderDetail()

    await press(/Map/)

    // The plan's own title is the composer row's caption — its answer to what it
    // decided to do. Scoped to the row, because the header band is named by the same
    // string and a bare query would be satisfied by either.
    const composer = await map().findByRole("button", { name: /composer/ })
    expect(within(composer).getByText("Add a read-only client")).toBeDefined()
    // A row per entry below it. Step 0's instruction, because step 1's is also the
    // bar's caption and would be found whether the map drew it or not.
    expect(screen.getByText("sketch the routes")).toBeDefined()

    fireEvent.click(composer)
    expect(await screen.findByText(COMPOSED)).toBeDefined()
  })

  it("draws a re-compose after the step it followed, holding only its own turns", async () => {
    server.use(answers(recomposed()))
    renderDetail()

    await press(/Map/)

    // Captioned with why it was asked, which is the fact that makes it worth a row.
    const again = await map().findByRole("button", { name: /re-compose/ })
    expect(screen.getByText("keep it smaller")).toBeDefined()

    // Below the entry that preceded it, so the map reads as the chronology.
    const order = screen.getAllByRole("listitem").map((li) => li.textContent)
    expect(order.findIndex((t) => t.includes("re-compose"))).toBeGreaterThan(
      order.findIndex((t) => t.includes("sketch the routes")),
    )

    fireEvent.click(again)
    // A `Grep`, where the first run's was a `Glob` — so the folded rows say which run's
    // work this is without either of them being opened.
    expect(await screen.findByText("Searched 1 time")).toBeDefined()
    // The first compose's work is not this run's, and pooling them is the whole bug.
    expect(screen.queryByText(COMPOSED)).toBeNull()
  })

  it("gives a step its turns even when nothing wrote a Spawned for them", async () => {
    server.use(answers(recomposed()))
    renderDetail()

    await press(/Map/)
    fireEvent.click(map().getByRole("button", { name: /sketch the routes/ }))

    // These lines used to be filed under the composer turn ahead of them, leaving the
    // step reading *Nothing has run here yet*. Opened, because the path is what says the
    // row came out of the step's own transcript rather than the compose above it.
    await openCall(PLANNED)
    expect(screen.getByText("src/plan.md")).toBeDefined()
    expect(screen.queryByText("Nothing has run here yet")).toBeNull()
  })

  it("still has a row to draw before a plan exists", async () => {
    server.use(answers(detail({ state: { _tag: "Composing" }, plan: undefined, transcript: [] })))
    renderDetail()

    await press(/Map/)
    // The row, and the stand-in caption it carries until there is a plan to name. Twice
    // on screen: the bar is standing at the composer too, and says the same thing.
    expect(await map().findByRole("button", { name: /composer/ })).toBeDefined()
    expect(screen.getAllByText("Working out what to do")).toHaveLength(2)
  })
})

/**
 * Coming back to Changes after the branch moved. The client learns of a commit only from a
 * `WorkCommitted` frame, and that frame is the engine's own commit at a step boundary — a
 * commit made any other way (an agent mid-turn, a person in the checkout's terminal, a
 * `claude --resume` session) moves the branch's tip with no frame at all. So reopening the
 * tab is the moment a reader expects the latest, and the answer git gives then is the one
 * that has to draw.
 */
describe("the Changes tab, reopened", () => {
  it("shows what the branch holds now, not what it held when the tab was first opened", async () => {
    let tip = "first.ts"
    server.use(
      emptyList,
      answers(detail()),
      http.get("*/api/agents", () => HttpResponse.json([])),
      http.get("*/api/models", () => HttpResponse.json(makeModels())),
      http.get(`*/api/traks/${ID}/changes`, ({ request }) => {
        const at = new URL(request.url).searchParams.get("at") ?? "all"
        return HttpResponse.json(makeChanges({ at, files: [makeFileChange({ path: tip })] }))
      }),
    )
    renderDetail()

    await press("Changes")
    expect((await screen.findAllByText(/first\.ts/)).length).toBeGreaterThan(0)

    // The branch moves under the tab, and nothing on the stream says so.
    tip = "second.ts"
    fireEvent.click(screen.getByRole("button", { name: "Map" }))
    fireEvent.click(screen.getByRole("button", { name: "Changes" }))

    expect((await screen.findAllByText(/second\.ts/)).length).toBeGreaterThan(0)
    expect(screen.queryByText(/first\.ts/)).toBeNull()
  })
})

/**
 * A change map on the step's own document, joined to the step's diff. The step is at its
 * gate with nothing committed, so the diff is the uncommitted work — and Open in Changes
 * has to land the tab on that slice and on that file, not on whatever the tab last showed.
 */
describe("a change map on the step's document", () => {
  const FENCE = [
    "```changes",
    "## The wire",
    "why: the drawer reads one more field",
    "~ src/app/dto.ts",
    "  maps the new field",
    "```",
  ].join("\n")

  it("opens a file's lines in place, and Open in Changes lands the tab on that slice and file", async () => {
    const slices: string[] = []
    server.use(
      emptyList,
      answers(
        detail({
          log: [
            makeTrakCreated(),
            makeComposerReturned({ sessionId: "s-plan", output: makeProposal({ title: TITLE }) }),
            makeAgentReturned({ step: 1, sessionId: "s-0" }),
            makeAgentReturned({
              step: 2,
              sessionId: "s-1",
              output: { type: "artifact", sections: { Changes: FENCE } },
            }),
          ],
        }),
      ),
      http.get("*/api/agents", () => HttpResponse.json([])),
      http.get("*/api/models", () => HttpResponse.json(makeModels())),
      http.get(`*/api/traks/${ID}/changes`, ({ request }) => {
        const at = new URL(request.url).searchParams.get("at") ?? "all"
        slices.push(at)
        return HttpResponse.json(
          makeChanges({
            at,
            files: [
              makeFileChange({ path: "src/app/server.ts" }),
              makeFileChange({ path: "src/app/dto.ts" }),
            ],
          }),
        )
      }),
    )
    renderDetail()

    // The join answers before anything is pressed: the step is asked for its own slice.
    expect(await screen.findByText(/Joined to the uncommitted work's diff/)).toBeDefined()
    expect(slices).toEqual(["uncommitted"])
    // The changed file the agent did not name is the join's to point out, as a bucket of its own.
    expect(screen.getByRole("button", { name: /Unexplained/ })).toBeDefined()

    fireEvent.click(screen.getByRole("button", { name: /The wire/ }))
    fireEvent.click(screen.getByRole("button", { name: /dto\.ts/ }))
    expect(screen.getByText("The whole change to this file")).toBeDefined()

    fireEvent.click(screen.getByRole("button", { name: /Open in Changes/ }))

    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { current: true }).map((b) => b.textContent.trim()),
      ).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/Uncommitted/),
          expect.stringMatching(/dto\.ts/),
        ]),
      )
    })
  })
})

describe("the preparation beside a running position", () => {
  it("says setup is still running under the turn that started ahead of it", async () => {
    server.use(emptyList, answers(working({ preparing: { _tag: "SetupBeside" } })))
    renderDetail()
    await loaded()
    expect((await screen.findByText("Setup still running")).closest("[role=status]")).not.toBeNull()
  })

  it("names the sandbox's preparation in the runner's own words where the trak is being prepared", async () => {
    server.use(
      emptyList,
      answers(
        detail({
          state: { _tag: "Preparing" },
          custody: { holder: { since: 1786028700000 } },
          preparing: { _tag: "Creating", runner: "Runs each trak in a sandbox." },
        }),
      ),
    )
    renderDetail()
    expect(await screen.findByText("Creating a sandbox from the tools template")).toBeDefined()
    expect(screen.getByText("Runs each trak in a sandbox.")).toBeDefined()
  })
})
