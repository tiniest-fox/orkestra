/**
 * Tier 2: a spawn's pieces seen from the parent's drawer — their band, their gates, the
 * presses that act on one, and the run mode, openers and ending each carries.
 */

import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import type { TrakDetailDto } from "@orkestra/shared/dto/trak"
import {
  makeAgentReturned,
  makeAgentStep,
  makeChildrenSpawned,
  makeComposeEntry,
  makeComposerReturned,
  makeDetail,
  makePlan,
  makeProposal,
  makeSession,
  makeSpawned,
  makeTool,
  makeOpener,
  makeOpeners,
  makeTrakCreated,
  makeWorktree,
  makeTurnFailed,
  makeWorkCommitted,
  makeGoal,
  makeHostedProcess,
} from "../../fixtures"
import {
  server,
  ID,
  TITLE,
  detail,
  PLANNED,
  BUILT,
  openCall,
  renderAt,
  renderDetail,
  answers,
  loaded,
  press,
  map,
  step,
  goTo,
  emptyList,
  held,
  C1,
  C2,
  piece,
  firstPiece,
  secondPiece,
  spawner,
  answersFor,
  modes,
} from "./TrakDetailPage.support"

/** The top band — the element the title heads, which is where the id and the model sit. */
const topBand = (): HTMLElement => {
  const band = screen.getByRole("heading", { level: 1 }).closest("header")
  if (band === null) throw new Error("the title is not in a header")
  return band
}

describe("a trak a goal opened", () => {
  it("links back to its goal from the header, by the goal's title", async () => {
    server.use(
      answers(detail({ goal: "g1" })),
      http.get("*/api/goals", () =>
        HttpResponse.json({ goals: [makeGoal({ id: "g1", title: "Search everywhere" })] }),
      ),
    )
    renderDetail()
    await loaded()
    const link = await within(topBand()).findByRole("link", {
      name: "Part of the goal Search everywhere",
    })
    expect(link).toHaveAttribute("href", "/goals/g1")
  })
})

/** Whether `node` is drawn after the chat box's field — under the box, not in the header. */
const underTheBox = (node: HTMLElement): boolean =>
  (screen
    .getByRole("textbox", { name: "Say something to the agent" })
    .compareDocumentPosition(node) &
    Node.DOCUMENT_POSITION_FOLLOWING) !==
  0

describe("the model readback under the chat box", () => {
  it("names the model the position's step runs on, under the box and not in the header", async () => {
    // Two steps on two models — the second a Codex one, so the qualifier's absence is
    // asserted too — and the compose entry ahead of them, which runs on no step's model.
    server.use(
      answers(
        detail({
          plan: makePlan({
            title: TITLE,
            steps: [
              makeComposeEntry(),
              makeAgentStep({ agent: "planner", instruction: "sketch the routes", model: "opus" }),
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
    await screen.findByText(BUILT)

    // The bare name, and `codex/` is nowhere on screen. The effort is in the same pill,
    // whole — the client holds no list of levels to shorten it against — and the pill
    // says both facts in words for a reader who cannot see the two compartments. The
    // header holds the id and no token.
    const token = screen.getByLabelText("Model gpt-5.6-sol, effort persistent")
    expect(underTheBox(token)).toBe(true)
    expect(within(topBand()).queryByLabelText(/^Model /)).toBeNull()
    expect(within(topBand()).getByText(ID)).toBeInTheDocument()
    expect(screen.queryByText(/codex\//)).toBeNull()

    // It is the position's model rather than the trak's newest: moving changes it — and a
    // step that declared no effort draws the model alone, which is every step today.
    await goTo("planner — sketch the routes")
    expect(underTheBox(screen.getByLabelText("Model opus"))).toBe(true)
    expect(screen.queryByText("gpt-5.6-sol")).toBeNull()
    expect(screen.queryByText("persistent")).toBeNull()

    // And a position that is no agent's turn names none.
    await goTo("composer")
    expect(screen.queryByLabelText(/^Model /)).toBeNull()
  })
})

/** A request that never settles, so "the pieces have not answered" is a state to assert on. */
const neverAnswers = (id: string) =>
  http.get(`*/api/traks/${id}`, async () => {
    await new Promise(() => {})
    return HttpResponse.json({})
  })

describe("a spawn's pieces", () => {
  it("puts the pieces on the band instead of a row of the parent's", async () => {
    server.use(emptyList, answers(spawner()), ...answersFor(firstPiece, secondPiece))
    renderDetail()

    await press(/Map/)

    // Each piece's own plan, stacked, where the spawn's row used to be — and the row
    // itself gone, because the columns *are* the position.
    expect(await screen.findByText("test the band")).toBeDefined()
    expect(screen.getByText("draw the columns")).toBeDefined()
    expect(screen.getByText("test the columns")).toBeDefined()
    expect(screen.queryByText("2 pieces")).toBeNull()
    // No head over a column and no row for the spawn, so its own instruction has nowhere
    // to go — the accepted cost of the pieces taking the band. What tells them apart is
    // the instruction on each of their steps.
    expect(screen.queryByText("build both halves")).toBeNull()
  })

  it("names the piece's own step's model and effort under the box, and neither band does", async () => {
    server.use(emptyList, answers(spawner()), ...answersFor(firstPiece, secondPiece))
    renderDetail()

    // It opens at the first step of the first piece, whose entry carries both facts. The
    // token under the box says them, in the place the trak's own step's does; neither the
    // header nor the piece's band says anything about a model.
    await loaded()
    const band = await screen.findByRole("group", { name: "Piece" })
    expect(underTheBox(screen.getByLabelText("Model gpt-5.6-sol, effort high"))).toBe(true)
    expect(within(band).queryByLabelText(/^Model /)).toBeNull()
    expect(within(topBand()).queryByLabelText(/^Model /)).toBeNull()

    // The piece's second step declared neither, and the engine resolved no model for it.
    await step("Next step")
    expect(screen.queryByLabelText(/^Model /)).toBeNull()
  })

  it("shows a piece's step out of that piece's own transcript", async () => {
    server.use(emptyList, answers(spawner()), ...answersFor(firstPiece, secondPiece))
    renderDetail()

    await press(/Map/)
    fireEvent.click(map().getByRole("button", { name: /draw the columns/ }))
    // A press on the map is a navigation, so the pane is still the position being left until
    // it commits — and every piece's row reads `Read`, so a call opened before then
    // is the wrong piece's.
    await waitFor(() => {
      expect(screen.getByRole("navigation").textContent).toContain("draw the columns")
    })

    // The second piece's own line. The parent has none of these, and the first piece's
    // is a different file — pooling them is the failure this pins. Both pieces read a
    // file, so the folded row says the same words for either and the path is the whole of
    // the difference: opened, every time this asks which piece it is looking at.
    await openCall(PLANNED)
    expect(screen.getByText("trak-detail/TrakMap.tsx")).toBeDefined()
    expect(screen.queryByText("traks-list/TrakRow.tsx")).toBeNull()
  })

  it("steps into the pieces in turn and out the other side", async () => {
    server.use(emptyList, answers(spawner()), ...answersFor(firstPiece, secondPiece))
    renderDetail()

    // It opens at the spawn, and a spawn has no position of its own to stand at — so it
    // stands at the first step of the first piece.
    await loaded()
    await openCall(PLANNED)
    expect(screen.getByText("traks-list/TrakRow.tsx")).toBeDefined()

    // Forward twice: past that piece's second step and into the second piece. By the arrows
    // rather than the rail, which is the point of the case — a piece's tile is 14px, and
    // stepping through a spawn is what the arrows are still here for.
    //
    // Awaited between presses, because the position is in the URL now: the arrow navigates,
    // and `next` is computed from where the drawer is standing — so a second press fired
    // before the first has landed would send the same key again. A person clicking twice
    // gets a render in between; a test firing twice in one tick does not.
    await step("Next step")
    await step("Next step")
    await openCall(PLANNED)
    expect(screen.getByText("trak-detail/TrakMap.tsx")).toBeDefined()

    // And back, which has to land inside the piece before rather than on the parent's plan.
    await step("Previous step")
    await step("Previous step")
    await openCall(PLANNED)
    expect(screen.getByText("traks-list/TrakRow.tsx")).toBeDefined()
  })

  it("reaches a piece's step from the rail too, for a pointer that would rather aim", async () => {
    server.use(emptyList, answers(spawner()), ...answersFor(firstPiece, secondPiece))
    renderDetail()

    await loaded()
    await goTo("builder — draw the columns")

    await openCall(PLANNED)
    expect(screen.getByText("trak-detail/TrakMap.tsx")).toBeDefined()
    expect(screen.queryByText("traks-list/TrakRow.tsx")).toBeNull()
  })

  it("keeps the spawn's own row while nothing has answered for its pieces", async () => {
    // Held open, so the frame the parent arrives in is a state rather than a race: the
    // position has to stay on the map and on the walk while the pieces are being read,
    // and this is what a piece that cannot be reached at all falls back to.
    server.use(emptyList, answers(spawner()), neverAnswers(C1), neverAnswers(C2))
    renderDetail()

    await press(/Map/)
    // Scoped to the map, because the navigator names the position you are standing at and
    // that is this same spawn — so an unscoped query for its name finds the bar as well.
    await screen.findByRole("list", { name: "Plan" })
    expect(map().getByText("2 pieces")).toBeDefined()
  })
})

/**
 * The gate's own press on a piece, and the ending that lands one — the two things a piece's
 * column deliberately did not carry until this change, because both were built from the
 * *parent's* state.
 */
describe("a piece's own gate, from the parent's drawer", () => {
  /**
   * The press on a piece's gate, at a parent standing at a gate of its own — the case that
   * separates *the drawer acts for the trak the page is of* from *the drawer acts for
   * whichever trak owns the position*. It used to be withheld here, correctly, because the
   * press was built from the parent's state and carried the parent's step index; the page
   * builds it from `spot.trak` now, so approving from a piece's card approves the piece.
   *
   * Two traks are at a gate at once in this fixture, which is what makes *which one* an
   * assertion rather than an accident: the approval must reach `C1`.
   */
  it("approves the piece from the piece's card, not the parent standing at its own gate", async () => {
    const waiting = piece(C1, "wire the band", "test the band", "traks-list/TrakRow.tsx", {
      state: { _tag: "AwaitingHuman", step: 0, kind: "approval" },
      log: [
        makeTrakCreated({ description: "wire the band" }),
        makeAgentReturned({
          step: 0,
          sessionId: `${C1}-0`,
          output: { type: "artifact", sections: { Summary: "the band is on the list" } },
        }),
      ],
    })
    const sent: string[] = []
    server.use(
      emptyList,
      answers(spawner()),
      ...answersFor(waiting, secondPiece),
      http.post("*/api/traks/:id/act", ({ params }) => {
        sent.push(String(params["id"]))
        return HttpResponse.json({ id: C1 }, { status: 202 })
      }),
    )
    renderDetail()

    await press(/Map/)
    fireEvent.click(map().getByRole("button", { name: /wire the band/ }))

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }))
    await waitFor(() => {
      expect(sent).toEqual([C1])
    })
  })

  it("draws the press on the piece's own document rather than beside the parent's", async () => {
    const waiting = piece(C1, "wire the band", "test the band", "traks-list/TrakRow.tsx", {
      state: { _tag: "AwaitingHuman", step: 0, kind: "approval" },
      log: [
        makeTrakCreated({ description: "wire the band" }),
        makeAgentReturned({
          step: 0,
          sessionId: `${C1}-0`,
          output: { type: "artifact", sections: { Summary: "the band is on the list" } },
        }),
      ],
    })
    server.use(
      emptyList,
      answers(
        spawner({
          state: { _tag: "AwaitingHuman", step: 3, kind: "approval" },
          log: [
            ...spawner().log,
            makeAgentReturned({
              step: 3,
              sessionId: "s-3",
              output: { type: "artifact", sections: { Summary: "the diff reads well" } },
            }),
          ],
          transcript: [
            makeSpawned({ pid: 400, position: 3 }),
            makeSession({ id: "s-3", position: 3 }),
          ],
        }),
      ),
      ...answersFor(waiting, secondPiece),
    )
    renderDetail()

    // The parent's own gate, with its press on the document at its own position.
    expect(await screen.findByRole("button", { name: "Approve" })).toBeDefined()
    expect(screen.getByText("the diff reads well")).toBeDefined()

    await press(/Map/)
    fireEvent.click(map().getByRole("button", { name: /wire the band/ }))

    // One press, on the piece's document — the parent's is a position away and its own
    // press went with it. A second Approve on screen would be two gates being offered at
    // once, with nothing saying which trak either belongs to.
    expect(await screen.findByText("the band is on the list")).toBeDefined()
    expect(screen.queryByText("the diff reads well")).toBeNull()
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1)
  })

  /**
   * A piece's ending, which its column stopped drawing when a piece was landed on its own
   * page. That page is gone, so this row is the only place a piece can be merged from — and
   * the destination is its parent rather than a branch, which `toMergePreviewDto` already
   * answered correctly for a child.
   */
  it("merges a finished piece from its own ending row, into its parent", async () => {
    const done = piece(C1, "wire the band", "test the band", "traks-list/TrakRow.tsx", {
      state: { _tag: "Finished" },
      worktree: { path: "/tmp/c1", branch: "trak/wire-the-band", base: "main" },
      // A piece with something on its branch, which is what makes a merge the question:
      // one that kept nothing is offered Close alone and has no destination to draw.
      log: [makeTrakCreated({ description: "wire the band" }), makeWorkCommitted({ sha: "c1sha" })],
    })
    let merged: string | undefined
    server.use(
      emptyList,
      answers(spawner()),
      ...answersFor(done, secondPiece),
      http.get(`*/api/traks/${C1}/merge`, () => HttpResponse.json({ parentId: ID })),
      http.post(`*/api/traks/${C1}/merge`, () => {
        merged = C1
        return HttpResponse.json({ id: C1 }, { status: 202 })
      }),
    )
    renderDetail()

    await goTo("Finished — Ready to merge")

    expect(await screen.findByText("trak/wire-the-band")).toBeDefined()
    fireEvent.click(await screen.findByRole("button", { name: "Merge into its parent" }))
    await waitFor(() => {
      expect(merged).toBe(C1)
    })
  })
})

/**
 * A piece parked on something of its own, at the second step of its plan — with a turn in
 * its transcript there, because the pane draws *Nothing has run here yet* at a position
 * with no turns whatever the log filed.
 */
const standing = (
  state: TrakDetailDto["state"],
  output: Extract<TrakDetailDto["log"][number], { _tag: "AgentReturned" }>["output"],
  over: Partial<TrakDetailDto> = {},
): TrakDetailDto =>
  piece(C1, "wire the band", "test the band", "traks-list/TrakRow.tsx", {
    state,
    log: [
      makeTrakCreated({ description: "wire the band" }),
      makeAgentReturned({ step: 1, sessionId: `${C1}-1`, output }),
    ],
    transcript: [
      makeSpawned({ pid: 901, position: 1 }),
      makeSession({ id: `${C1}-1`, position: 1 }),
      makeTool({ name: "Read", kind: "Read", detail: "traks-list/TrakBand.tsx", position: 1 }),
    ],
    ...over,
  })

/** Every `/act`, whichever trak it names, so the id in the path is what is asserted. */
const acted = (sent: { id: string; body: unknown }[]) =>
  http.post("*/api/traks/:id/act", async ({ params, request }) => {
    sent.push({ id: String(params["id"]), body: await request.json() })
    return HttpResponse.json({ id: C1 }, { status: 202 })
  })

/**
 * The other two presses on a piece, and the one thing that must stop all of them.
 *
 * What is worth asserting here and nowhere else is **which trak the request reaches**. The
 * route is `/api/traks/:id/act` for the approval, the answer and the chat alike, so the id
 * in the path is the whole of the difference between answering the piece a reader is looking
 * at and answering the parent at a position nobody is on.
 */
describe("acting on a piece from its parent's drawer", () => {
  const asking = (over: Partial<TrakDetailDto> = {}): TrakDetailDto =>
    standing(
      { _tag: "AwaitingHuman", step: 1, kind: "answers" },
      { type: "questions", questions: [{ question: "Which plate size?", options: [] }] },
      over,
    )

  it("answers the piece's own gate, without leaving the parent", async () => {
    const sent: { id: string; body: unknown }[] = []
    server.use(emptyList, answers(spawner()), ...answersFor(asking(), secondPiece), acted(sent))
    renderDetail()

    await goTo("builder — test the band")

    const field = await screen.findByRole("textbox", { name: "Which plate size?" })
    fireEvent.change(field, { target: { value: "24px, like the list" } })
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }))

    await waitFor(() => {
      expect(sent).toEqual([
        { id: C1, body: { action: "answer", answers: ["24px, like the list"] } },
      ])
    })
  })

  it("sends what was typed to the piece, at a piece's conversation gate", async () => {
    const sent: { id: string; body: unknown }[] = []
    const talking = standing(
      { _tag: "AwaitingHuman", step: 1, kind: "conversation" },
      {
        type: "message",
        text: "the band reflows as pieces land",
      },
    )
    server.use(emptyList, answers(spawner()), ...answersFor(talking, secondPiece), acted(sent))
    renderDetail()

    await goTo("builder — test the band")

    // Open, where it used to be shut with *The trak is not waiting here*: the message would
    // have resumed the **parent's** last speaker at the parent's position.
    const bar = await screen.findByLabelText<HTMLTextAreaElement>("Say something to the agent")
    expect(bar.hasAttribute("disabled")).toBe(false)
    fireEvent.change(bar, { target: { value: "keep the columns ragged" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))

    await waitFor(() => {
      expect(sent).toEqual([
        { id: C1, body: { action: "chat", message: "keep the columns ragged" } },
      ])
    })
  })

  /**
   * Custody, and **the piece's rather than the parent's**. A parent waiting on its children
   * holds no drive of its own, so reading `running` off it would leave every press on a
   * piece live while a `pnpm ork` was mid-turn inside it — a 409 the user provoked, which
   * `client-style` calls a UI bug caught downstream.
   */
  it("will not press or send while something already holds the piece", async () => {
    const sent: { id: string; body: unknown }[] = []
    server.use(
      emptyList,
      answers(spawner()),
      ...answersFor(asking({ custody: { holder: { since: 1786028700000 } } }), secondPiece),
      acted(sent),
    )
    renderDetail()

    await goTo("builder — test the band")

    const field = await screen.findByRole("textbox", { name: "Which plate size?" })
    fireEvent.change(field, { target: { value: "24px" } })
    fireEvent.click(screen.getByRole("button", { name: /still to answer|Send answers/ }))

    // The field stays open at a gate — custody there is a drive letting go, and shutting
    // the field for it takes the cursor — so the send is what refuses.
    const bar = await screen.findByLabelText<HTMLTextAreaElement>("Say something to the agent")
    fireEvent.change(bar, { target: { value: "smaller" } })
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send" }).disabled).toBe(true)
    expect(sent).toEqual([])
  })
})

/** A piece, with the parentage in its log that `parentId` reads. */
const born = (over: Partial<TrakDetailDto> = {}): TrakDetailDto =>
  piece(C1, "wire the band", "test the band", "traks-list/TrakRow.tsx", {
    log: [
      makeTrakCreated({
        description: "wire the band",
        parent: { id: ID, step: 2, child: 0, depth: 1 },
      }),
    ],
    ...over,
  })

/**
 * The two routes into a piece, and the one route that still ends at its own drawer.
 *
 * A subtrak has one canonical view and it is inside its parent — so every way of asking for
 * one lands there, and the exception is the child a parent cannot be found for, which
 * `tree.ts` also stands as a root row on the list.
 */
describe("a link that points at a piece", () => {
  it("takes an old link to a piece's own drawer into its parent, standing at the piece", async () => {
    server.use(emptyList, answers(spawner()), ...answersFor(born(), secondPiece))
    const router = renderAt(`/traks/${C1}`)

    // Replaced rather than pushed: nobody navigated to the child's drawer on purpose.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/traks/${ID}`)
    })
    // And normalised from the bare id to the position, so a link copied from here points at
    // the step that was interesting rather than at wherever the piece gets to next.
    await waitFor(() => {
      expect(router.state.location.searchStr).toBe(
        "?spot=c1111111-2222-4333-8444-555555555555%3Astep%3A0",
      )
    })
    await openCall(PLANNED)
    expect(screen.getByText("traks-list/TrakRow.tsx")).toBeDefined()
  })

  it("opens the parent at the piece a ?spot= names, and holds it against the poll", async () => {
    server.use(emptyList, answers(spawner()), ...answersFor(firstPiece, secondPiece))
    renderAt(`/traks/${ID}?spot=${C2}`)

    // The second piece rather than the first, which is where the drawer would have opened
    // on its own — a spawn has no position of its own to stand at.
    await openCall(PLANNED)
    expect(screen.getByText("trak-detail/TrakMap.tsx")).toBeDefined()
    expect(screen.queryByText("traks-list/TrakRow.tsx")).toBeNull()
  })

  it("closes the notifications of the piece it stands at, and of the next one picked", async () => {
    // happy-dom has no service worker: a registration that records each tag it is asked for,
    // on a container the chrome can listen to for notification clicks.
    const closed: string[] = []
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        addEventListener: () => {},
        removeEventListener: () => {},
        startMessages: () => {},
        ready: Promise.resolve({
          getNotifications: ({ tag }: { readonly tag: string }) =>
            Promise.resolve([{ close: () => closed.push(tag) }]),
        }),
      },
    })
    try {
      server.use(emptyList, answers(spawner()), ...answersFor(firstPiece, secondPiece))
      renderAt(`/traks/${ID}?spot=${C2}`)
      await waitFor(() => {
        expect(closed).toContain(`trak:${C2}`)
      })
      expect(closed).not.toContain(`trak:${C1}`)

      await goTo("builder — wire the band")
      await waitFor(() => {
        expect(closed).toContain(`trak:${C1}`)
      })
    } finally {
      Reflect.deleteProperty(navigator, "serviceWorker")
    }
  })

  /**
   * The one drawer a subtrak keeps. A wiped parent is a thing that happens, and a trak that
   * exists and is reachable from nowhere is the failure this must not have — so the redirect
   * waits for the parent to load rather than for its id to exist.
   */
  it("leaves a child its own drawer where the parent cannot be loaded", async () => {
    server.use(
      emptyList,
      http.get(`*/api/traks/${C1}`, () => HttpResponse.json(born())),
      http.get(`*/api/traks/${ID}`, () => new HttpResponse(null, { status: 404 })),
    )
    const router = renderAt(`/traks/${C1}`)

    await loaded()
    expect(router.state.location.pathname).toBe(`/traks/${C1}`)
    expect(screen.getByRole("heading", { name: "wire the band" })).toBeDefined()
  })
})

/**
 * The position shape that had no home for the notice at all, and the one the live database
 * holds twice: a plan whose last entry is a spawn, and a failure the engine wrote at merge
 * time.
 *
 * `WorktreeFailed` blames no entry, so nothing reads `failed` and the drawer falls through
 * to the last plan entry — where a spawn's pieces take the band, so the position it opens
 * on belongs to a *piece*. Asking the notice to be on a row of the parent's own dropped
 * both the sentence and the way out, and a trak with no notice reads as one that had
 * nothing to say. It goes at the head of the pane there, above the piece's log rather than
 * closing it.
 */
describe("a failed trak resting on a spawn band", () => {
  /** The piece has landed; the parent died joining it, which is where the plan stops. */
  const landed = piece(C1, "wire the band", "test the band", "traks-list/TrakRow.tsx", {
    state: { _tag: "Merged", sha: "abc1234" },
  })

  const stoppedAtTheSpawn = makeDetail({
    id: ID,
    state: { _tag: "Failed", error: "fatal: worktree already exists", kind: "worktree" },
    plan: makePlan({
      title: TITLE,
      steps: [
        makeComposeEntry(),
        makeAgentStep({ agent: "planner", instruction: "sketch the routes" }),
        { type: "spawn", instruction: "build both halves", children: [] },
      ],
    }),
    log: [
      makeTrakCreated(),
      makeComposerReturned({ sessionId: "s-plan", output: makeProposal({ title: TITLE }) }),
      makeAgentReturned({ step: 1, sessionId: "s-0" }),
      makeChildrenSpawned({ step: 2, ids: [C1] }),
    ],
    transcript: [makeSpawned({ pid: 200 }), makeSession({ id: "s-0" })],
  })

  it("says what happened and offers the way out, on a position it does not own", async () => {
    server.use(emptyList, answers(stoppedAtTheSpawn), ...answersFor(landed))
    renderDetail()

    expect(await screen.findByText("the checkout could not be prepared")).toBeDefined()
    expect(screen.getByRole("button", { name: "Restart" })).toBeDefined()
  })

  it("puts it above the piece's turns rather than at the end of them", async () => {
    server.use(emptyList, answers(stoppedAtTheSpawn), ...answersFor(landed))
    renderDetail()

    // The piece's own call is on screen, so this is its log the notice is over — and the
    // press is the parent's, so a sentence closing that log would read as the piece's own
    // ending.
    expect(await screen.findByRole("button", { name: PLANNED })).toBeDefined()
    const shown = document.body.textContent
    expect(shown.indexOf("the checkout could not be prepared")).toBeLessThan(shown.indexOf(PLANNED))
  })

  it("draws the piece's own notice under it where the piece has stopped too", async () => {
    // Two traks stopped at one position, which is what the head-and-tail split is for: the
    // parent speaks over the pane and the piece's own ends the piece's own chronology, and
    // the two presses do different things to different traks.
    server.use(emptyList, answers(stoppedAtTheSpawn), ...answersFor(firstPiece))
    renderDetail()

    expect(await screen.findByText("the checkout could not be prepared")).toBeDefined()
    expect(screen.getByText("nothing is carrying this trak")).toBeDefined()
    expect(screen.getByRole("button", { name: "Restart" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Resume" })).toBeDefined()

    const shown = document.body.textContent
    expect(shown.indexOf("the checkout could not be prepared")).toBeLessThan(
      shown.indexOf("nothing is carrying this trak"),
    )
  })
})

/** Every `/resume`, whichever trak it names, so the id in the path is what is asserted. */
const resumed = (sent: string[]) =>
  http.post("*/api/traks/:id/resume", ({ params }) => {
    sent.push(String(params["id"]))
    return HttpResponse.json({ id: C1 }, { status: 202 })
  })

/**
 * The two ways a piece of a spawn stops, and the one place either is picked back up.
 *
 * Not a nicety: a `Failed` or crashed child never lands on its parent — `landOnParent`
 * files a landing for an ending alone — and cannot be closed. So one stopped piece parks
 * the whole spawn in `AwaitingChildren` until somebody says pick it up, or archives it from
 * its band, and the notice at the row it stopped on is where they say the first.
 */
describe("a piece that stopped, from its parent's drawer", () => {
  /** The first piece, with an ending the engine wrote at the second step of its plan. */
  const gaveUp = piece(C1, "wire the band", "test the band", "traks-list/TrakRow.tsx", {
    state: { _tag: "Failed", error: "I cannot do this step", kind: "agent" },
    log: [
      makeTrakCreated({ description: "wire the band" }),
      makeTurnFailed({ step: 1, sessionId: `${C1}-1`, reason: "I cannot do this step" }),
    ],
  })

  it("restarts a piece that gave up, and the press names the piece", async () => {
    const sent: string[] = []
    server.use(emptyList, answers(spawner()), ...answersFor(gaveUp, secondPiece), resumed(sent))
    renderDetail()

    await goTo("builder — test the band")
    expect(screen.getByText(/It stopped on the work/)).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Restart" }))

    // The parent is standing at the spawn and holds no drive of its own, so a press keyed
    // to the page's trak would have gone to the wrong id and left the piece where it is.
    await waitFor(() => {
      expect(sent).toEqual([C1])
    })
  })

  it("resumes a piece whose process died, from the same notice", async () => {
    const sent: string[] = []
    // `piece` is `AgentWorking` with nobody holding it, which is the whole of the case.
    server.use(emptyList, answers(spawner()), ...answersFor(firstPiece, secondPiece), resumed(sent))
    renderDetail()

    // It opens at the spawn, which is the first step of the first piece — and that is
    // where this piece is standing, so its notice is already there.
    expect(await screen.findByText("nothing is carrying this trak")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Resume" }))

    await waitFor(() => {
      expect(sent).toEqual([C1])
    })
  })

  it("puts it at the row that piece stopped on and at no other row of it", async () => {
    server.use(emptyList, answers(spawner()), ...answersFor(gaveUp, secondPiece))
    renderDetail()

    // It opens at that piece's first step, which ran and returned — one row above the one
    // that died, and a sentence there would be an explanation against the wrong turns.
    await loaded()
    expect(screen.queryByText(/It stopped on the work/)).toBeNull()
    expect(screen.queryByRole("button", { name: "Restart" })).toBeNull()

    await goTo("builder — test the band")
    expect(screen.getByText(/It stopped on the work/)).toBeDefined()
  })

  /**
   * The hook's subject changes with the position and nothing navigates, so a refusal
   * earned at one piece would otherwise be read as the engine's answer about the next —
   * `useScopedTo`, which every acting hook in this feature calls.
   */
  it("leaves one piece's refusal behind when a reader steps to another", async () => {
    server.use(
      emptyList,
      answers(spawner()),
      ...answersFor(firstPiece, secondPiece),
      http.post("*/api/traks/:id/resume", () =>
        HttpResponse.json({ _tag: "Driving" }, { status: 409, statusText: "Driving" }),
      ),
    )
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "Resume" }))
    expect(await screen.findByText("Something is already driving this.")).toBeDefined()

    await goTo("builder — draw the columns")
    expect(screen.queryByText("Something is already driving this.")).toBeNull()
    // The second piece has stopped in its own right, so this is the notice moving to
    // another trak rather than going away.
    expect(screen.getByRole("button", { name: "Resume" })).toBeDefined()
  })
})

describe("the run mode on a spawn's piece", () => {
  it("puts the piece's picker on its band beside the trak's, and only the trak's merges", async () => {
    const sent: unknown[] = []
    server.use(
      emptyList,
      answers(spawner({ mode: "auto" })),
      ...answersFor({ ...firstPiece, mode: "smart" }, secondPiece),
      modes(sent),
    )
    renderDetail()

    // It opens at the first piece's first step: two pickers, each in the row naming its
    // trak — the header's the parent's, the band's the piece's.
    await loaded()
    const readouts = await screen.findAllByRole("button", { name: /^Run mode/ })
    expect(readouts.map((r) => r.getAttribute("aria-label"))).toEqual([
      "Run mode: Auto",
      "Run mode: Smart",
    ])
    const band = within(screen.getByRole("group", { name: "Piece" }))
    expect(within(topBand()).getByRole("button", { name: "Run mode: Auto" })).toBeDefined()
    expect(band.getByRole("button", { name: "Run mode: Smart" })).toBeDefined()
    // The band names the piece.
    expect(band.getByText("wire the band")).toBeDefined()

    // The trak's own picker offers auto-merge.
    fireEvent.click(screen.getByRole("button", { name: "Run mode: Auto" }))
    expect(screen.getByRole("menuitemcheckbox", { name: /^Auto-merge/ })).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Run mode: Auto" }))

    fireEvent.click(screen.getByRole("button", { name: "Run mode: Smart" }))
    // A piece has no pull request of its own, so its picker offers no auto-merge.
    expect(screen.queryByRole("menuitemcheckbox", { name: /^Auto-merge/ })).toBeNull()
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Manual/ }))
    await waitFor(() => {
      expect(sent).toEqual([{ id: C1, body: { mode: "manual" } }])
    })
  })

  it("collapses the band on the trak's own step, and keeps what it said while it goes", async () => {
    server.use(
      emptyList,
      answers(spawner({ mode: "auto" })),
      ...answersFor(firstPiece, secondPiece),
    )
    renderDetail()

    await loaded()
    await goTo("planner — sketch the routes")

    // The header's picker alone, and the band collapsed rather than gone — its last
    // content still in it, `inert`, so there is something to watch leave.
    expect(screen.getByRole("button", { name: "Run mode: Auto" })).toBeDefined()
    expect(screen.queryByRole("group", { name: "Piece" })).toBeNull()
    const band = screen
      .getByRole("group", { name: "Piece", hidden: true })
      .closest("[data-collapsed]")
    expect(band?.getAttribute("data-collapsed")).toBe("true")
    expect(band?.hasAttribute("inert")).toBe(true)
  })

  it("draws the held band on the document of the step a hold held", async () => {
    server.use(emptyList, answers(detail({ mode: "auto", marks: [{ _tag: "Held", at: 2 }] })))
    renderDetail()

    await loaded()
    expect(screen.getByText("held for you")).toBeDefined()
  })
})

/**
 * The piece band's own controls — the presses that act on the focused piece alone, in the
 * row that names it. The header's copies stay the parent's, which is what each case pins:
 * the same word one row apart has to reach two different traks.
 */
const PARENT = { id: ID, step: 2, child: 0, depth: 1 }

/** A finished piece with work on its branch, born of the page's trak. */
const landable = piece(C1, "wire the band", "test the band", "traks-list/TrakRow.tsx", {
  state: { _tag: "Finished" },
  worktree: { path: "/tmp/c1", branch: "trak/wire-the-band", base: "main" },
  log: [
    makeTrakCreated({ description: "wire the band", parent: PARENT }),
    makeWorkCommitted({ sha: "c1sha" }),
  ],
})

/** A piece mid-turn, archived from its own band. */
const midTurn = piece(C1, "wire the band", "test the band", "traks-list/TrakRow.tsx", {
  worktree: { path: "/tmp/c1", branch: "trak/wire-the-band", base: "main" },
  log: [makeTrakCreated({ description: "wire the band", parent: PARENT })],
})

/** The drawer opens standing inside the first piece, so the band is already the piece's. */
const pieceBand = async () => within(await screen.findByRole("group", { name: "Piece" }))

/** The header's copy of a control the band also carries — the one outside the band. */
const inHeader = (name: string): HTMLElement => {
  const grouped = screen.getByRole("group", { name: "Piece" })
  const hit = screen.getAllByRole("button", { name }).find((b) => !grouped.contains(b))
  if (hit === undefined) throw new Error(`no "${name}" outside the piece band`)
  return hit
}

describe("the piece band's ending menu", () => {
  it("archives a finished piece from the band, and the parent from the header", async () => {
    const archived: string[] = []
    server.use(
      emptyList,
      answers(spawner()),
      ...answersFor(landable, secondPiece),
      http.get(`*/api/traks/${C1}/merge`, () => HttpResponse.json({ parentId: ID })),
      http.post("*/api/traks/:id/close", ({ params }) => {
        archived.push(`close:${String(params["id"])}`)
        return HttpResponse.json({ id: String(params["id"]) }, { status: 202 })
      }),
      http.post("*/api/traks/:id/abandon", ({ params }) => {
        archived.push(`abandon:${String(params["id"])}`)
        return HttpResponse.json({ id: String(params["id"]) }, { status: 202 })
      }),
    )
    renderDetail()

    // The band's `⋯` speaks for the piece: a finished one takes the close route, to its id.
    const inBand = await pieceBand()
    fireEvent.click(inBand.getByRole("button", { name: "More options" }))
    fireEvent.click(inBand.getByRole("menuitem", { name: "Archive this trak" }))
    expect(inBand.getByText(/The checkout goes/)).toBeDefined()
    fireEvent.click(inBand.getByRole("button", { name: "Archive" }))
    await waitFor(() => {
      expect(archived).toEqual([`close:${C1}`])
    })

    // The header's `⋯` still ends the page's trak — the abandon route, to the parent's id.
    fireEvent.click(inHeader("More options"))
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive this trak" }))
    fireEvent.click(inHeader("Archive"))
    await waitFor(() => {
      expect(archived).toEqual([`close:${C1}`, `abandon:${ID}`])
    })
  })

  it("archives an unfinished piece from the band, on the abandon route to the piece's id", async () => {
    const archived: string[] = []
    server.use(
      emptyList,
      answers(spawner()),
      ...answersFor(midTurn, secondPiece),
      http.post("*/api/traks/:id/abandon", ({ params }) => {
        archived.push(`abandon:${String(params["id"])}`)
        return HttpResponse.json({ id: String(params["id"]) }, { status: 202 })
      }),
    )
    renderDetail()

    const inBand = await pieceBand()
    fireEvent.click(inBand.getByRole("button", { name: "More options" }))
    fireEvent.click(inBand.getByRole("menuitem", { name: "Archive this trak" }))
    expect(inBand.getByText(/The agent mid-turn is interrupted/)).toBeDefined()
    fireEvent.click(inBand.getByRole("button", { name: "Archive" }))
    await waitFor(() => {
      expect(archived).toEqual([`abandon:${C1}`])
    })
  })
})

describe("the piece band's openers", () => {
  it("opens the piece's checkout from the band, and the parent's from the header", async () => {
    const opened: string[] = []
    server.use(
      emptyList,
      http.get("*/api/openers", () => HttpResponse.json(makeOpeners())),
      answers(spawner({ worktree: makeWorktree() })),
      ...answersFor(midTurn, secondPiece),
      http.post("*/api/traks/:id/open", async ({ params, request }) => {
        opened.push(`${String(params["id"])}:${JSON.stringify(await request.json())}`)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderDetail()

    const inBand = await pieceBand()
    fireEvent.click(inBand.getByRole("button", { name: "Open Ghostty at this trak's checkout" }))
    await waitFor(() => {
      expect(opened).toEqual([`${C1}:{"kind":"terminal"}`])
    })
    fireEvent.click(inBand.getByRole("button", { name: "Open Zed at this trak's checkout" }))
    await waitFor(() => {
      expect(opened).toEqual([`${C1}:{"kind":"terminal"}`, `${C1}:{"kind":"editor"}`])
    })

    // The same words one row up still open the page's trak's checkout.
    fireEvent.click(inHeader("Open Ghostty at this trak's checkout"))
    await waitFor(() => {
      expect(opened).toEqual([
        `${C1}:{"kind":"terminal"}`,
        `${C1}:{"kind":"editor"}`,
        `${ID}:{"kind":"terminal"}`,
      ])
    })
  })

  it("moves one setting from either band's pick, with one pending state across both", async () => {
    const chosen: unknown[] = []
    const flight = held()
    server.use(
      emptyList,
      http.get("*/api/openers", () =>
        HttpResponse.json(
          makeOpeners({
            terminal: {
              apps: [makeOpener(), makeOpener({ id: "com.apple.Terminal", name: "Terminal" })],
              chosen: "com.mitchellh.ghostty",
            },
          }),
        ),
      ),
      answers(spawner({ worktree: makeWorktree() })),
      ...answersFor(midTurn, secondPiece),
      http.post("*/api/openers", async ({ request }) => {
        chosen.push(await request.json())
        await flight.wait
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderDetail()

    const inBand = await pieceBand()
    fireEvent.click(inBand.getByRole("button", { name: "Choose a terminal" }))
    fireEvent.click(inBand.getByRole("menuitem", { name: /Terminal/ }))
    await waitFor(() => {
      expect(chosen).toEqual([{ kind: "terminal", id: "com.apple.Terminal" }])
    })

    // The pick is the machine's, not a band's: while the band's pick is in flight, the
    // header's row for the same setting is the same mutation and refuses a second write.
    fireEvent.click(inHeader("Choose a terminal"))
    fireEvent.click(screen.getByRole("menuitem", { name: /Terminal/ }))
    expect(chosen).toEqual([{ kind: "terminal", id: "com.apple.Terminal" }])

    flight.release()
  })
})

/** The band that holds the title, whatever element the drawer draws it as. */
const header = (): HTMLElement => {
  const band = screen.getByRole("heading", { level: 1, name: TITLE }).closest("header")
  if (band === null) throw new Error("the title is not in a header band")
  return band
}

/**
 * The two bands at the top name a trak and a piece, and never say where either stands.
 * Every surface under them says that in more detail, so a phrase there was the same words
 * twice within 200px — and a chip reading *Ready to merge* over a pane saying there was
 * nothing to merge was the screen contradicting itself.
 */
describe("the header and the piece band", () => {
  it("says nothing about the trak's state while an agent works", async () => {
    server.use(emptyList, answers(detail({ state: { _tag: "AgentWorking", step: 2 } })))
    renderDetail()

    await loaded()
    expect(within(header()).queryByText("Working…")).toBeNull()
  })

  it("says nothing about the trak's state at a gate", async () => {
    server.use(emptyList, answers(detail()))
    renderDetail()

    await loaded()
    expect(within(header()).queryByText("Output awaiting approval")).toBeNull()
  })

  it("names a piece without saying where it stands", async () => {
    server.use(emptyList, answers(spawner()), ...answersFor(firstPiece, secondPiece))
    renderDetail()

    await loaded()
    const band = screen.getByRole("group", { name: "Piece" })
    expect(within(band).getByText("wire the band")).toBeDefined()
    expect(within(band).queryByText("Working…")).toBeNull()
    expect(within(header()).queryByText("Working…")).toBeNull()
  })
})

describe("the side panel at a spawn's piece", () => {
  it("lists the piece's processes and starts one in the piece's checkout", async () => {
    // The parent has no checkout and declares nothing running; the piece has its own, with
    // `api` up there. So every answer the panel shows, and Start being pressable at all,
    // can only have come from the piece.
    const started: string[] = []
    server.use(
      emptyList,
      answers(spawner()),
      ...answersFor(firstPiece, { ...secondPiece, worktree: makeWorktree() }),
      http.get(`*/api/traks/${C2}/processes`, () =>
        HttpResponse.json({ processes: [makeHostedProcess({ name: "api", page: false })] }),
      ),
      http.post("*/api/traks/:id/processes/api/start", ({ params }) => {
        started.push(String(params["id"]))
        return HttpResponse.json(makeHostedProcess({ name: "api", page: false }))
      }),
    )
    renderAt(`/traks/${ID}?spot=${C2}`)

    fireEvent.click(await screen.findByRole("button", { name: "Side panel" }))
    const panel = await screen.findByRole("region", { name: "Side panel" })
    fireEvent.click(within(panel).getByRole("button", { name: "Start" }))
    await waitFor(() => {
      expect(started).toEqual([C2])
    })
  })
})
