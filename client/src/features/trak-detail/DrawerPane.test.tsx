/**
 * The pane's wiring, which is a different thing from what the pane draws.
 *
 * **This file exists because a component test could not have caught the bug it pins.**
 * `TurnsView` had `kind` as an optional prop defaulting to `"step"`, `DrawerPane` never
 * passed it, and so every compose row asked the log the step question and drew nothing.
 * Every `TurnsView` test passed, because each one handed `kind` in directly — they tested
 * the component and the app tested nothing.
 *
 * So what is asserted here is that a **row** reaches the right drawing, given only what
 * the page has: the trak, the rows and which one is selected. `kind` is required now and
 * a missing one is a compile error, but the compiler cannot say the *right* value was
 * passed, and that is what these two cases are for.
 */

import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { EventDto, TrakDetailDto, TranscriptEntryDto } from "../../api/types"
import {
  makeAgentReturned,
  makeAgentStep,
  makeCheckFailed,
  makeChildrenSpawned,
  makeComposeEntry,
  makeComposerReturned,
  makeDetail,
  makeHumanActed,
  makeNote,
  makePlan,
  makeSession,
  makeSpawned,
  makeTool,
  makeTrakCreated,
} from "../../fixtures"
import DrawerPane from "./DrawerPane"
import { familyBands, walk } from "./family/family"
import { NOTHING, type TrakUsage } from "./tokens/usage"

/** No wait on any trak here, so any instant does. */
const NOW = 0

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const TITLE = "Export a transcript"

const proposal = (session: string, agent: string): EventDto =>
  makeComposerReturned({
    sessionId: session,
    output: {
      type: "proposal",
      title: TITLE,
      rationale: "the turn-splitting lives in client/ and decides everything after it",
      steps: [makeAgentStep({ agent, instruction: "do the thing" })],
    },
  })

const log: readonly EventDto[] = [
  makeTrakCreated({ description: TITLE }),
  proposal("s-plan", "build"),
  makeAgentReturned({
    step: 1,
    sessionId: "s-1",
    output: { type: "artifact", sections: { Summary: "it works now" } },
  }),
]

const transcript = [
  makeSpawned({ pid: 1, position: "composer" }),
  makeSession({ id: "s-plan", position: "composer" }),
  makeSession({ id: "s-1", position: 1 }),
]

const trak: TrakDetailDto = makeDetail({
  id: "t-1",
  description: TITLE,
  state: { _tag: "Finished" },
  plan: makePlan({
    title: TITLE,
    steps: [makeComposeEntry(), makeAgentStep({ agent: "build", instruction: "do the thing" })],
  }),
  log: [...log],
  transcript: [...transcript],
})

/** Nothing measured: the trak view's fifth section is not what any case here is about. */
const NO_USAGE: TrakUsage = { own: NOTHING, positions: [], pieces: undefined }

/** No spawn in this fixture, so every band is one row and the walk is the plan. */
const noChildren = new Map<string, TrakDetailDto>()

const paneAt = (key: string): void => {
  const bands = familyBands(trak, noChildren, [], NOW)
  const spot = walk(bands).find((s) => s.key === key)
  render(
    <DrawerPane
      agents={[]}
      changes={undefined}
      usage={NO_USAGE}
      level="step"
      cancelling={undefined}
      planning={undefined}
      trak={trak}
      bands={bands}
      spot={spot}
      onPick={() => undefined}
    />,
  )
}

/**
 * The pane, an append, and every `scrollTop` it set on the way.
 *
 * **happy-dom has no layout, so every metric the following rule reads is zero** and an
 * assertion over where the box ended up would pass whatever the component did. So the
 * three are stubbed on the pane's own node and the writes are recorded: what is asserted
 * is the decision the component made, which is the thing that was missing.
 *
 * The stubs go on after the first render because the node does not exist before it. That
 * is the honest shape anyway — mounting is not the case that broke; an append under a
 * reader is.
 */
const appended = (
  level: "step" | "map",
  scrolledTo?: number,
): { readonly writes: readonly number[] } => {
  // Rebuilt per render, as the page does it: the bands are a projection of the answer the
  // poll just brought back, and a spot holds the trak its turns come from.
  const pane = (extra: readonly TranscriptEntryDto[]): ReactNode => {
    const grown = { ...trak, transcript: [...trak.transcript, ...extra] }
    const bands = familyBands(grown, noChildren, [], NOW)
    return (
      <DrawerPane
        agents={[]}
        changes={undefined}
        usage={NO_USAGE}
        level={level}
        cancelling={undefined}
        planning={undefined}
        trak={grown}
        bands={bands}
        spot={walk(bands).find((s) => s.key === "step:1")}
        onPick={() => undefined}
      />
    )
  }

  const { rerender, container } = render(pane([]))
  const node = container.firstElementChild
  if (node === null) throw new Error("the pane drew nothing")

  const writes: number[] = []
  let top = 0
  Object.defineProperty(node, "scrollHeight", { value: 1000, configurable: true })
  Object.defineProperty(node, "clientHeight", { value: 300, configurable: true })
  Object.defineProperty(node, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (to: number) => {
      top = to
      writes.push(to)
    },
  })

  // A reader who has scrolled away says so the only way a browser reports it.
  if (scrolledTo !== undefined) {
    top = scrolledTo
    fireEvent.scroll(node)
  }

  rerender(pane([makeNote({ text: "Thinking", position: 1 })]))
  return { writes }
}

describe("DrawerPane", () => {
  it("gives a compose row the composer's question, so its proposal is drawn", () => {
    paneAt("compose:0")

    expect(screen.getByText("Export a transcript")).toBeDefined()
    expect(
      screen.getByText("the turn-splitting lives in client/ and decides everything after it"),
    ).toBeDefined()
  })

  it("gives a step row the step's question, so its artifact is drawn", () => {
    paneAt("step:1")

    expect(screen.getByText("it works now")).toBeDefined()
  })
})

/**
 * Whose decisions a card is showing — the step's, not the trak's.
 *
 * `TrakDetailDto.decisions` is the accumulated channel: every requirement every step has
 * filed so far, each stamped with the stage that recorded it, which is what a later
 * step's `trak.md` opens with. It is the right list for the trak pane and the wrong one
 * for a card, and the pane used to hand the whole of it down as one prop — so the further
 * through a plan a reader got, the more a step read as having settled things it never
 * filed, with the earliest step's entries repeated under every card after it.
 *
 * A wiring test rather than a component one, for this file's reason: the components
 * below draw exactly the list they are handed, and each of their tests hands one in.
 * What is wrong is which list the pane reaches for, and only the pane knows that.
 *
 * The per-step list is on the wire twice over — `ArtifactDto.requirements` carries what the
 * envelope filed, and every entry in the accumulated list is stamped with the
 * `artifactKey` of the stage that filed it — so this asserts the outcome rather than
 * which of the two is read. The fix reads the envelope's, which is why the fixture below
 * carries both.
 */
const twoDecisions: TrakDetailDto = {
  id: "t-2",
  description: "Export a transcript",
  mode: "manual",
  holding: false,
  skippingChecks: false,
  messages: [],
  returned: [],
  state: { _tag: "Finished" },
  plan: {
    title: "Export a transcript",
    steps: [
      { type: "compose" },
      { type: "agent", agent: "investigate", instruction: "find it", conversational: false },
      { type: "agent", agent: "build", instruction: "fix it", conversational: false },
    ],
  },
  // Accumulated, in log order, stamped with `artifactKey` — `${index}-${agent}`.
  decisions: [
    {
      text: "the admin view is out of scope",
      source: "stated",
      at: "1-investigate",
      id: "1-investigate.1",
    },
    {
      text: "the retry is deferred to a later trak",
      source: "assumed",
      at: "2-build",
      id: "2-build.1",
    },
  ],
  marks: [],
  nextChecks: [],
  deployScript: false,
  log: [
    makeTrakCreated({ description: "Export a transcript" }),
    proposal("s-plan", "investigate"),
    makeAgentReturned({
      step: 1,
      sessionId: "s-1",
      output: {
        type: "artifact",
        sections: { Findings: "the cause is in the pane" },
        requirements: [{ text: "the admin view is out of scope", source: "stated" }],
      },
    }),
    makeAgentReturned({
      step: 2,
      sessionId: "s-2",
      output: {
        type: "artifact",
        sections: { Changes: "the pane now scopes it" },
        requirements: [{ text: "the retry is deferred to a later trak", source: "assumed" }],
      },
    }),
  ],
  transcript: [
    makeSpawned({ pid: 1, position: "composer" }),
    makeSession({ id: "s-plan", position: "composer" }),
    makeSession({ id: "s-1", position: 1 }),
    makeSession({ id: "s-2", position: 2 }),
  ],
  custody: {},
}

describe("DrawerPane, on whose decisions a card carries", () => {
  const decidedPaneAt = (key: string): void => {
    const bands = familyBands(twoDecisions, noChildren, [], NOW)
    const spot = walk(bands).find((s) => s.key === key)
    render(
      <DrawerPane
        agents={[]}
        changes={undefined}
        usage={NO_USAGE}
        level="step"
        cancelling={undefined}
        planning={undefined}
        trak={twoDecisions}
        bands={bands}
        spot={spot}
        onPick={() => undefined}
      />,
    )
  }

  it("shows a step the decision it filed", () => {
    decidedPaneAt("step:2")

    expect(screen.getByText("the retry is deferred to a later trak")).toBeDefined()
  })

  it("does not show a step a decision an earlier step filed", () => {
    decidedPaneAt("step:2")

    expect(screen.queryByText("the admin view is out of scope")).toBeNull()
  })

  it("does not show the first step a decision filed after it", () => {
    decidedPaneAt("step:1")

    expect(screen.queryByText("the retry is deferred to a later trak")).toBeNull()
  })
})

/**
 * Which position may count a duration up, which is two facts and not one.
 *
 * A wiring test for this file's reason: the components each assert what they draw when
 * they are told a turn is live, and every one of those tests hands `live` in directly.
 * What can be wrong here is the question the pane asks — it read the *trak's* custody
 * alone, so a reader who scrolled back to a finished position was shown that position's
 * last unanswered call counting up under a clock that never stops.
 */
describe("DrawerPane, on which position may count up", () => {
  const at = 1_786_400_000_000

  /**
   * A trak in flight at its second step, where **both** positions end on a call nothing
   * answered — the first because its turn died there, the second because it is happening
   * now. Custody cannot tell them apart and the row's status is what does.
   */
  const working: TrakDetailDto = makeDetail({
    id: "t-3",
    description: TITLE,
    state: { _tag: "AgentWorking", step: 2 },
    custody: { holder: { since: at } },
    plan: makePlan({
      title: TITLE,
      steps: [
        makeComposeEntry(),
        makeAgentStep({ agent: "build", instruction: "do the thing" }),
        makeAgentStep({ agent: "review", instruction: "read it" }),
      ],
    }),
    log: [makeTrakCreated({ description: TITLE }), proposal("s-plan", "build")],
    transcript: [
      makeSpawned({ pid: 1, position: 1 }),
      makeSession({ id: "s-1", position: 1 }),
      makeTool({ name: "Bash", kind: "Bash", detail: "pnpm verify", at, position: 1 }),
      makeSpawned({ pid: 2, position: 2 }),
      makeSession({ id: "s-2", position: 2 }),
      makeTool({ name: "Bash", kind: "Bash", detail: "pnpm test", at, position: 2 }),
    ],
  })

  const workingPaneAt = (key: string): void => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(at + 112_000)
    const bands = familyBands(working, noChildren, [], NOW)
    render(
      <DrawerPane
        agents={[]}
        changes={undefined}
        usage={NO_USAGE}
        level="step"
        cancelling={undefined}
        planning={undefined}
        trak={working}
        bands={bands}
        spot={walk(bands).find((s) => s.key === key)}
        onPick={() => undefined}
      />,
    )
  }

  it("counts up on the position the trak is standing at", () => {
    workingPaneAt("step:2")

    expect(screen.getByText("Running · 1m 52s")).toBeDefined()
  })

  it("says nothing on a position that has ended, though the trak is held", () => {
    workingPaneAt("step:1")

    expect(screen.queryByText("Running · 1m 52s")).toBeNull()
  })
})

/**
 * A piece's ask, read from its parent's drawer — where the form now is, and where it was
 * withheld through two shapes of this component.
 *
 * A wiring test for this file's reason: `QuestionsCard` draws whichever state it is told,
 * and its own tests hand each one in. What can be wrong here is the question the pane asks.
 * It handed the card `answering` alone, withheld on a piece's row because a form there
 * would have posted at the parent's position, and the card read that absence as *nobody
 * owes an answer* — so a live question drew as `Never answered`. The withholding is what
 * has gone: the page builds `answering` from the trak that owns the position, and the pane
 * asks only whether this is the live row. What these pin is that the form arrives.
 */
describe("DrawerPane, on an ask that is live on a piece", () => {
  const ASK = "Should the exporter keep the tool calls?"

  /** The piece: its own plan, its own log, and standing at its own answers gate. */
  const piece: TrakDetailDto = makeDetail({
    id: "child-1",
    description: "export the transcript",
    state: { _tag: "AwaitingHuman", step: 1, kind: "answers" },
    plan: makePlan({
      title: "Export the transcript",
      steps: [makeComposeEntry(), makeAgentStep({ agent: "build", instruction: "write it" })],
    }),
    log: [
      makeTrakCreated({ description: "export the transcript" }),
      makeAgentReturned({
        step: 1,
        sessionId: "s-c",
        output: { type: "questions", questions: [{ question: ASK, options: [] }] },
      }),
    ],
    transcript: [makeSpawned({ pid: 3, position: 1 }), makeSession({ id: "s-c", position: 1 })],
  })

  /** The parent, waiting on it — which is not a gate, and offers nothing to press. */
  const parent: TrakDetailDto = makeDetail({
    id: "t-4",
    description: TITLE,
    state: { _tag: "AwaitingChildren", step: 1 },
    plan: makePlan({
      title: TITLE,
      steps: [
        makeComposeEntry(),
        {
          type: "spawn",
          instruction: "split it",
          children: [[{ agent: "build", instruction: "write it" }]],
        },
      ],
    }),
    log: [
      makeTrakCreated({ description: TITLE }),
      proposal("s-plan", "build"),
      makeChildrenSpawned({ step: 1, ids: ["child-1"] }),
    ],
    transcript: [...transcript],
  })

  /** `answering`, as a parent standing at a gate of its own would hand it down. */
  const answering = { send: () => undefined, isPending: false, disabled: false, said: undefined }

  const pieceInParentsPane = (): void => {
    const bands = familyBands(parent, new Map([["child-1", piece]]), [], NOW)
    render(
      <DrawerPane
        agents={[]}
        changes={undefined}
        usage={NO_USAGE}
        level="step"
        cancelling={undefined}
        planning={undefined}
        trak={parent}
        bands={bands}
        spot={walk(bands).find((s) => s.key === "child-1:step:1")}
        answering={answering}
        onPick={() => undefined}
      />,
    )
  }

  it("says the ask is live rather than that nobody ever answered it", () => {
    pieceInParentsPane()

    expect(screen.getByText(ASK)).toBeDefined()
    expect(screen.queryByText("Never answered")).toBeNull()
    expect(screen.queryByText("not answered")).toBeNull()
  })

  it("puts the form on the piece's own card, which is where the ask is", () => {
    pieceInParentsPane()

    expect(screen.getByRole("textbox", { name: ASK })).toBeDefined()
    expect(screen.getByRole("button", { name: /Send answers|still to answer/ })).toBeDefined()
  })
})

/**
 * Following the bottom, which the pane did not do at all for one commit.
 *
 * The cost was not cosmetic: a message sent from the bar and every line the agent wrote
 * after it landed below the fold, so a working stream read as a dead trak. Both halves of
 * that were reported as bugs and both were this.
 */
describe("DrawerPane, on staying with the live turn", () => {
  it("carries a reader at the end along with a line that arrives", () => {
    expect(appended("step").writes).toContain(1000)
  })

  it("leaves a reader who has scrolled up where they are", () => {
    // 200 of 1000 with 300 visible: half a pane from the top and nowhere near the end.
    expect(appended("step", 200).writes).toEqual([])
  })

  it("takes it back when they scroll to the end again", () => {
    // 700 + 300 visible is exactly the bottom, which is the reader asking to be carried.
    expect(appended("step", 700).writes).toContain(1000)
  })

  it("does not move the map, which nothing appends to under a reader", () => {
    expect(appended("map").writes).toEqual([])
  })
})

/**
 * The record of what nobody read, which is two drawings of one fact and has to reach both.
 *
 * A wiring test for this file's reason: `UnattendedBand` asserts what it draws when it is
 * handed a warrant, and the map's mark is three lines of JSX. What can be wrong is whether
 * the row's own answer reaches either — the pane hands the band down four components, and
 * the mark is read off a row a pure module built.
 */
describe("DrawerPane, on the gates the engine took", () => {
  /** A round of complaint and fix: the re-cut that planned it, and the fix itself. */
  const round: TrakDetailDto = makeDetail({
    id: "t-4",
    description: TITLE,
    mode: "smart",
    state: { _tag: "Finished" },
    plan: makePlan({
      title: TITLE,
      steps: [
        makeComposeEntry(),
        makeAgentStep({ agent: "build", instruction: "do the thing" }),
        makeAgentStep({ agent: "review", instruction: "read it" }),
        makeComposeEntry({
          why: { _tag: "Raised", step: 2, requirements: [], corrections: [] },
        }),
        makeAgentStep({ agent: "build", instruction: "fix what the review named" }),
      ],
    }),
    marks: [
      { _tag: "Uneventful", at: 3, ambiguity: "none" },
      { _tag: "Uneventful", at: 4, ambiguity: "none" },
    ],
    // Every entry ran, and the log says so — `Finished` alone no longer says an entry
    // did, since a trak parked at a wait is `Finished` with a step still to come.
    log: [
      makeTrakCreated({ description: TITLE }),
      proposal("s-plan", "build"),
      makeAgentReturned({ step: 1, sessionId: "s-1" }),
      makeAgentReturned({ step: 2, sessionId: "s-2" }),
      proposal("s-plan-2", "build"),
      makeAgentReturned({
        step: 4,
        sessionId: "s-4",
        output: { type: "artifact", sections: { Summary: "fixed it" } },
      }),
    ],
    transcript: [makeSpawned({ pid: 4, position: 4 }), makeSession({ id: "s-4", position: 4 })],
  })

  /**
   * The same trak, with the fix's checks failing and a person taking it anyway.
   *
   * `smart` never reaches a `checks` gate, so this is the shape the record used to get
   * wrong: the warrants and the statuses are identical, and the only thing saying nobody
   * read entry 4 was that nothing asked whether anybody had.
   */
  const stoodAt: TrakDetailDto = {
    ...round,
    log: [...round.log, makeCheckFailed({ step: 4 }), makeHumanActed({ step: 4 })],
  }

  const unreadPaneAt = (level: "map" | "step", key: string, on: TrakDetailDto = round): void => {
    const bands = familyBands(on, noChildren, [], NOW)
    render(
      <DrawerPane
        agents={[]}
        changes={undefined}
        usage={NO_USAGE}
        level={level}
        cancelling={undefined}
        planning={undefined}
        trak={on}
        bands={bands}
        spot={walk(bands).find((s) => s.key === key)}
        onPick={() => undefined}
      />,
    )
  }

  it("marks the rows the engine let through, and only those", () => {
    unreadPaneAt("map", "step:4")

    // Five entries and an ending, two of them marked — the re-cut and the fix it planned.
    expect(screen.getAllByText("automatically approved")).toHaveLength(2)
  })

  it("puts the reason on the document, where the press would have been", () => {
    unreadPaneAt("step", "step:4")

    expect(screen.getByText("automatically approved")).toBeDefined()
    expect(screen.getByText("ambiguity: none")).toBeDefined()
    expect(screen.getByText("smart · nothing asked for a person")).toBeDefined()
  })

  it("says nothing on a position a person was asked about", () => {
    unreadPaneAt("step", "step:1")

    expect(screen.queryByText("automatically approved")).toBeNull()
  })

  it("takes the mark off a gate a person stood at, leaving the round's other one", () => {
    unreadPaneAt("map", "step:4", stoodAt)

    // One mark where there were two: the re-cut still went through unread, and the fix
    // it planned did not.
    expect(screen.getAllByText("automatically approved")).toHaveLength(1)
  })

  it("takes the band off the document that person approved", () => {
    unreadPaneAt("step", "step:4", stoodAt)

    expect(screen.queryByText("automatically approved")).toBeNull()
    expect(screen.queryByText("smart · nothing asked for a person")).toBeNull()
  })

  /**
   * A hold and a gate the engine took are one union on one field now, so both surfaces
   * tell them apart by `_tag` rather than by which field they read. The map's is the one
   * that can lie: a bolt reading `automatically approved` over an entry somebody asked to
   * hold until they accepted it claims the opposite of what happened.
   */
  it("draws no bolt on a row a hold held, which is nobody's automatic approval", () => {
    unreadPaneAt("map", "step:4", { ...round, marks: [{ _tag: "Held", at: 4 }] })

    expect(screen.queryAllByText("automatically approved")).toHaveLength(0)
  })
})

/** The text of each waiting list on screen — one per pane that draws it. */
const waitingDrawn = (): readonly (string | null)[] =>
  screen.queryAllByRole("list", { name: "Waiting messages" }).map((list) => list.textContent)

/**
 * A message sent while the trak is driven, before anything has read it. The field is open
 * at positions with no turn yet, so every branch of the pane has to draw it — and exactly
 * one row of a trak may.
 */
describe("DrawerPane, on a message nobody has read", () => {
  const waiting = [{ id: "m1", message: "keep --json" }]
  const held = { custody: { holder: { since: 1 } }, messages: waiting }
  const planned = makePlan({
    title: TITLE,
    steps: [makeComposeEntry(), makeAgentStep({ agent: "build", instruction: "do the thing" })],
  })
  const composed = [
    makeSpawned({ pid: 1, position: "composer" }),
    makeSession({ id: "s-plan", position: "composer" }),
  ]
  const head = [makeTrakCreated({ description: TITLE }), proposal("s-plan", "build")]

  const waitingPane = (of: TrakDetailDto, key?: string): void => {
    const bands = familyBands(of, noChildren, [], NOW)
    const spots = walk(bands)
    render(
      <DrawerPane
        agents={[]}
        changes={undefined}
        usage={NO_USAGE}
        level="step"
        cancelling={undefined}
        planning={undefined}
        trak={of}
        bands={bands}
        spot={key === undefined ? spots[0] : spots.find((s) => s.key === key)}
        onPick={() => undefined}
      />,
    )
  }
  it("draws it at a step whose process has not written a line", () => {
    const unstarted = makeDetail({
      ...held,
      state: { _tag: "AgentWorking", step: 1 },
      plan: planned,
      log: head,
      transcript: composed,
    })
    waitingPane(unstarted, "step:1")

    expect(screen.getByText("Nothing has run here yet")).toBeDefined()
    expect(waitingDrawn()).toEqual(["keep --json"])
  })

  it("draws it under a trak still preparing, which stands at no row", () => {
    waitingPane(
      makeDetail({
        ...held,
        state: { _tag: "Preparing" },
        log: [makeTrakCreated({ description: TITLE })],
        transcript: [],
      }),
    )

    expect(waitingDrawn()).toEqual(["keep --json"])
  })

  it("draws it at a step whose condition is still being asked", () => {
    waitingPane(
      makeDetail({
        ...held,
        state: { _tag: "ConditionRunning", step: 1 },
        plan: planned,
        log: head,
        transcript: composed,
      }),
      "step:1",
    )

    expect(waitingDrawn()).toEqual(["keep --json"])
  })

  it("draws none at a row the trak has left, where another row is where it stands", () => {
    const working = makeDetail({
      ...held,
      state: { _tag: "AgentWorking", step: 1 },
      plan: planned,
      log: head,
      transcript: composed,
    })
    // The first row is the composer's, which is behind a trak at its first step.
    waitingPane(working)

    expect(waitingDrawn()).toEqual([])
  })
})
