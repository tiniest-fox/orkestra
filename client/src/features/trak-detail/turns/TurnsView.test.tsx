/**
 * The step pane: the agent's turns, why each one after the first ran, and the document it
 * filed at the end.
 *
 * **The artifact is what this asserts hardest**, because until now nothing in the app
 * drew one — every `AgentReturned.output` crossed the wire and was read by nothing. A
 * pane that silently shows no document looks exactly like a step that filed none.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import type { CheckRunDto, EventDto, TranscriptEntryDto } from "../../../api/types"
import { failureWords } from "../../../format/failure"
import {
  makeAgentReturned,
  makeApiRetry,
  makeCheckFailed,
  makeChecksCancelled,
  makeCheckRun,
  makeChecksPassed,
  makeComposerReturned,
  makeFilingAsked,
  makeHumanActed,
  makeNote,
  makeRestarted,
  makeSession,
  makeSpawned,
  makeStopped,
  makeText,
  makeTool,
  makeUsage,
  makeTurnFailed,
} from "../../../fixtures"
import { composeRow, stepRow } from "../family/map.fixtures"
import type { MapRow } from "../family/rows"
import { splitTurns, stepTurns, type Turn } from "./turns"
import type { Answering } from "../useAnswer"
import type { Stopping } from "../useStop"
import TurnsView from "./TurnsView"

/**
 * The position these turns belong to, as `rows.ts` would have built it. What the pane
 * reads off a row is its turns, its index, its kind and its gate mark; the fixture row
 * supplies the rest, and a test about the mark builds its own.
 */
const rowOf = (turns: readonly Turn[], at: number, kind: MapRow["kind"]): MapRow => ({
  ...(kind === "step" ? stepRow : composeRow),
  turns,
  at,
  kind,
})

/* Inert: answering is the gesture that spends money, and nothing here presses it. */
const ANSWERING: Answering = {
  send: () => undefined,
  isPending: false,
  disabled: false,
  said: undefined,
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const ok: TranscriptEntryDto = makeNote({ text: "ToolResult(ok)" })

const transcript: TranscriptEntryDto[] = [
  makeSpawned({ pid: 1, position: 3 }),
  makeSession({ id: "s-a", position: 3 }),
  makeNote({ text: "Thinking", position: 3 }),
  makeTool({ detail: "a.ts", position: 3 }),
  ok,
  makeTool({ detail: "b.ts", position: 3 }),
  ok,
  makeNote({ text: "Usage(1 in, 2 out, $0.01)", position: 3 }),
]

const filed = (summary: string, envelope?: string): EventDto =>
  makeAgentReturned({
    step: 3,
    sessionId: "s-a",
    output: {
      type: "artifact",
      sections: { Summary: summary, Changes: "one file" },
      uncovered_work: ["nothing outside src/app/ can read a stored transcript"],
    },
    // The text the turn wrote it as, where a case is about the log drawing it too.
    ...(envelope === undefined ? {} : { envelope }),
  })

/** A step's output, wrapped in the event that carries it. */
const emit = (output: Extract<EventDto, { _tag: "AgentReturned" }>["output"]): EventDto =>
  makeAgentReturned({ step: 3, sessionId: "s-a", output })

/**
 * One run of the composer, as a transcript with a session and the event that ended it.
 * `after` is whatever the log recorded next — an answer to what the run asked, which is
 * joined to the ask by log order rather than by a position the event does not carry.
 */
const composerRun = (
  output: Extract<EventDto, { _tag: "ComposerReturned" }>["output"],
  after: readonly EventDto[] = [],
): void => {
  const log: EventDto[] = [makeComposerReturned({ sessionId: "s-plan", output }), ...after]
  const entries: TranscriptEntryDto[] = [
    makeSpawned({ pid: 1, position: "composer" }),
    makeSession({ id: "s-plan", position: "composer" }),
  ]
  render(
    <TurnsView
      handOffBase={undefined}
      planning={undefined}
      agents={[]}
      row={rowOf(splitTurns(entries, log), 0, "compose")}
      log={log}
      worktree={undefined}
      running={false}
      cancelling={undefined}
    />,
  )
}

const view = (log: readonly EventDto[], entries = transcript): void => {
  const turns = stepTurns(splitTurns(entries, log), 3)
  render(
    <TurnsView
      handOffBase={undefined}
      planning={undefined}
      agents={[]}
      row={rowOf(turns, 3, "step")}
      log={log}
      worktree={undefined}
      running={false}
      cancelling={undefined}
    />,
  )
}

/** A turn that stopped, worked, stopped, worked, and stopped again. */
const paused: TranscriptEntryDto[] = [
  makeSpawned({ pid: 1, position: 3 }),
  makeSession({ id: "s-a", position: 3 }),
  makeNote({ text: "Thinking", position: 3 }),
  makeTool({ detail: "a.ts", position: 3 }),
  ok,
  makeNote({ text: "Thinking", position: 3 }),
  makeTool({ detail: "b.ts", position: 3 }),
  ok,
  makeNote({ text: "Thinking", position: 3 }),
]

/** The same turn, with the provider retrying during the first of its three pauses. */
const retried: TranscriptEntryDto[] = [
  ...paused.slice(0, 3),
  makeApiRetry({ attempt: 2, of: 5, status: "429", position: 3 }),
  ...paused.slice(3),
]

/** The pane with nothing filed, so the log is the whole of what is on screen. */
const drawn = (
  entries: readonly TranscriptEntryDto[],
  running: boolean,
): ReturnType<typeof render> => {
  const log: EventDto[] = []
  return render(
    <TurnsView
      handOffBase={undefined}
      planning={undefined}
      agents={[]}
      row={rowOf(stepTurns(splitTurns(entries, log), 3), 3, "step")}
      log={log}
      worktree={undefined}
      running={running}
      cancelling={undefined}
    />,
  )
}

describe("TurnsView, on what a turn spent", () => {
  it("stamps a turn a person stopped with what it had spent, and no other turn", () => {
    const usage = makeUsage({
      inputTokens: 0,
      cacheReadTokens: 96_000,
      cacheWriteTokens: 0,
      outputTokens: 166,
    })
    // Two turns at this position: the first filed and was measured, the second was stopped.
    view(
      [filed("first"), makeStopped({ step: 3, sessionId: "s-a", usage })],
      [
        ...transcript,
        makeSpawned({ pid: 2, position: 3 }),
        makeSession({ id: "s-a", position: 3 }),
        makeTool({ detail: "c.ts", position: 3 }),
      ],
    )
    // The stamp says why it is there, and the figure beside it is the stopped turn's alone.
    expect(screen.getByText("stopped after")).toBeDefined()
    expect(screen.getByText("96k")).toBeDefined()
    expect(screen.queryByRole("img", { name: "tokens" })).toBeNull()
  })

  it("stamps a turn killed by File it with the filing's own words, never the stop's", () => {
    const usage = makeUsage({
      inputTokens: 0,
      cacheReadTokens: 412_000,
      cacheWriteTokens: 0,
      outputTokens: 900,
    })
    view(
      [filed("first"), makeFilingAsked({ step: 3, sessionId: "s-a", usage })],
      [
        ...transcript,
        makeSpawned({ pid: 2, position: 3 }),
        makeSession({ id: "s-a", position: 3 }),
        makeTool({ detail: "c.ts", position: 3 }),
      ],
    )
    expect(screen.getByText("asked to file after")).toBeDefined()
    expect(screen.getByText("413k")).toBeDefined()
    expect(screen.queryByText("stopped after")).toBeNull()
  })

  it("stamps nothing on a turn that filed, however much it cost", () => {
    view([
      makeAgentReturned({
        step: 3,
        sessionId: "s-a",
        output: { type: "artifact", sections: { Summary: "done" } },
        usage: makeUsage({ cacheReadTokens: 9_000_000 }),
      }),
    ])
    expect(screen.queryByText("stopped after")).toBeNull()
  })
})

describe("TurnsView", () => {
  it("draws the document the position filed, which nothing in the app did before", () => {
    view([filed("the renderer is pure")])

    expect(screen.getByText("Summary")).toBeDefined()
    expect(screen.getByText("the renderer is pure")).toBeDefined()
  })

  it("opens every section, so nothing a person is asked to approve is behind a fold", () => {
    view([filed("the renderer is pure")])

    const head = screen.getByRole("button", { name: /Changes/ })
    expect(head.getAttribute("aria-expanded")).toBe("true")
    // Outside the header, which is what says the body drew: a folded section puts the
    // same words in its one-line preview, so a bare `getByText` passes in either state.
    expect(within(head).queryByText("one file")).toBeNull()
    expect(screen.getByText("one file")).toBeDefined()
  })

  it("shows work the plan does not have, which is why approving is not just 'next'", () => {
    view([filed("done")])

    expect(screen.getByText("Work the plan does not have")).toBeDefined()
  })

  it("says nothing about a document where the step filed none", () => {
    view([])

    expect(screen.queryByText(/Filed its work/)).toBeNull()
  })

  it("folds an earlier attempt and leaves the live one open", () => {
    // A step re-entered after a failing check files twice, and both are in the log.
    // Showing them both open is a step arguing with itself.
    view([filed("first go"), filed("second go")])

    const heads = screen.getAllByRole("button", { name: /Attempt/ })
    expect(heads.map((h) => h.getAttribute("aria-expanded"))).toEqual(["false", "true"])
  })

  it("folds the engine's bookkeeping away and keeps the work", () => {
    view([filed("done")])

    expect(screen.queryByText(/Usage\(/)).toBeNull()
    expect(screen.getByText("Read 2 files")).toBeDefined()
    // A pause is not bookkeeping, and it is dropped for a different reason: nothing is
    // driving this turn, so the wait it stands for is over — see the pauses describe.
    expect(screen.queryByText("Thinking")).toBeNull()
  })

  it("heads a second turn with the check that sent the agent back", () => {
    const second: TranscriptEntryDto[] = [
      ...transcript,
      makeSession({ id: "s-b", position: 3 }),
      makeTool({ name: "Edit", kind: "Edit", detail: "a.ts", position: 3 }),
      ok,
    ]
    // The whole shape: it failed, the agent went back, and it passed. Two things say
    // "verify failed" and they are two facts — the heading is *why the second turn ran*,
    // and the strip on the first attempt's card is *what happened to that document*. The
    // second is on a card folded under `Attempt 1 of 2`, which is what stops it reading
    // as the reason a person is being asked now.
    const log: EventDto[] = [
      filed("first go"),
      makeCheckFailed({ step: 3, name: "verify", output: "1 failed" }),
      filed("second go"),
      makeChecksPassed({ step: 3, ran: ["verify"] }),
    ]
    const turns = stepTurns(splitTurns(second, log), 3)
    render(
      <TurnsView
        handOffBase={undefined}
        planning={undefined}
        agents={[]}
        row={rowOf(turns, 3, "step")}
        log={log}
        worktree={undefined}
        running={false}
        cancelling={undefined}
      />,
    )

    expect(screen.getAllByText("verify failed").length).toBe(2)
    expect(screen.getByText("re-entering the agent to fix it")).toBeDefined()
    expect(screen.getByText("Attempt 1 of 2")).toBeDefined()
  })

  it("puts a human's words in their own bubble rather than in the log's voice", () => {
    const second: TranscriptEntryDto[] = [
      ...transcript,
      makeSession({ id: "s-b", position: 3 }),
      makeTool({ name: "Edit", kind: "Edit", detail: "a.ts", position: 3 }),
      ok,
    ]
    const log: EventDto[] = [
      filed("first go"),
      makeHumanActed({ step: 3, action: { _tag: "Chat", message: "use a copy instead" } }),
      filed("second go"),
    ]
    const turns = stepTurns(splitTurns(second, log), 3)
    render(
      <TurnsView
        handOffBase={undefined}
        planning={undefined}
        agents={[]}
        row={rowOf(turns, 3, "step")}
        log={log}
        worktree={undefined}
        running={false}
        cancelling={undefined}
      />,
    )

    expect(screen.getByText("use a copy instead")).toBeDefined()
  })

  it("folds a section when it is asked to", () => {
    view([filed("done")])

    const head = screen.getByRole("button", { name: /Changes/ })
    fireEvent.click(head)
    expect(head.getAttribute("aria-expanded")).toBe("false")
    // The words move into the header's preview, which is the folded section's whole
    // account of itself — and is why the open case above has to look outside the header.
    expect(within(head).getByText("one file")).toBeDefined()
  })
})

/**
 * The dots, and how many of them a log is allowed to have.
 *
 * `Thinking` animates, so it does not say *the agent stopped here* — it says *the agent is
 * thinking now*. Drawn per pause, a turn that stopped three times was three agents thinking
 * at once, two of them long finished, and a turn nothing was driving thought forever.
 */
describe("TurnsView, on the pause the agent is still in", () => {
  it("draws one set of dots, at the bottom of the turn something is driving", () => {
    drawn(paused, true)

    expect(screen.getAllByText("Thinking")).toHaveLength(1)
    // At the end, and after the work rather than between two stretches of it.
    expect(document.body.textContent.lastIndexOf("Thinking")).toBeGreaterThan(
      document.body.textContent.indexOf("Read 1 file"),
    )
  })

  it("draws none at all once a call came after the pause", () => {
    // Still running, and what it is doing is the call — the last thing it did was not
    // stop to think, so nothing on this log may claim it is thinking.
    drawn(paused.slice(0, -1), true)

    expect(screen.queryByText("Thinking")).toBeNull()
  })

  it("draws none on a turn nothing is driving, though it ended on a pause", () => {
    // A turn that died mid-thought. The wait is over whatever the last line says, and
    // dots animating on it are the same confident wrong fact a running clock would be.
    drawn(paused, false)

    expect(screen.queryByText("Thinking")).toBeNull()
  })

  it("keeps the pause the provider retried during, on a turn that has stopped", () => {
    // The only account of the retry there is: the `ApiRetry` was folded into the pause, so
    // a rule that dropped the row would take the words with it and nothing else draws them.
    // The words stay and the dots go: on a turn nothing is driving this is the one row
    // that would otherwise still be moving, which is what it would be read by.
    drawn(retried, false)

    expect(screen.getByText("retrying · 429 · attempt 2 of 5")).toBeDefined()
    expect(screen.queryByText("Thinking")).toBeNull()
  })

  it("animates that pause while something is driving the turn, wherever it sits", () => {
    // Two rows are entitled to dots here and both are true: the provider is retrying now,
    // and the turn ended on a pause. The retry is nowhere near the tail.
    drawn(retried, true)

    expect(screen.getByText("retrying · 429 · attempt 2 of 5")).toBeDefined()
    expect(screen.getAllByText("Thinking")).toHaveLength(2)
  })
})

/**
 * A Codex turn, whose pauses carry the model's own summary: the live one names its dots by
 * it, and every other one is dropped like any pause — the calls are the log.
 */
describe("TurnsView, on a turn whose pauses carry words", () => {
  const reasoned: TranscriptEntryDto[] = [
    makeSpawned({ pid: 1, position: 3 }),
    makeSession({ id: "s-a", position: 3 }),
    makeNote({ text: "Thinking: Planning file size counting method", position: 3 }),
    makeTool({ detail: "a.ts", position: 3 }),
    ok,
    makeNote({ text: "Thinking: Verifying the byte counts", position: 3 }),
    makeTool({ detail: "b.ts", position: 3 }),
    ok,
  ]

  it("draws no summary on a turn nothing is driving", () => {
    const { container } = drawn(reasoned, false)

    expect(screen.queryByText("Planning file size counting method")).toBeNull()
    expect(screen.queryByText("Verifying the byte counts")).toBeNull()
    expect(container.querySelectorAll(".animate-thinking")).toHaveLength(0)
  })

  it("separates the calls either side of a summary into two runs", () => {
    drawn(reasoned, false)

    expect(screen.getAllByText("Read 1 file")).toHaveLength(2)
  })

  it("draws only the summary the agent is still on, with the dots", () => {
    const { container } = drawn(
      [...reasoned, makeNote({ text: "Thinking: Writing the answer", position: 3 })],
      true,
    )

    expect(screen.getByText("Writing the answer")).toBeDefined()
    expect(screen.queryByText("Planning file size counting method")).toBeNull()
    expect(container.querySelectorAll(".animate-thinking")).toHaveLength(3)
  })
})

describe("TurnsView, on the paths a call names", () => {
  const ROOT = "/Users/k/Documents/Repos/orkestra/.orkestra/.worktrees/d68da68b-ce1b"

  /** One read, opened — the paths are behind the disclosure, which is where they belong. */
  const opened = (detail: string): void => {
    const log = [filed("done")]
    const entries: TranscriptEntryDto[] = [
      makeSpawned({ pid: 1, position: 3 }),
      makeSession({ id: "s-a", position: 3 }),
      makeTool({ detail, position: 3 }),
      ok,
    ]
    render(
      <TurnsView
        handOffBase={undefined}
        planning={undefined}
        agents={[]}
        row={rowOf(stepTurns(splitTurns(entries, log), 3), 3, "step")}
        log={log}
        worktree={ROOT}
        running={false}
        cancelling={undefined}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Read 1 file" }))
  }

  it("draws a call relative to the checkout it ran in", () => {
    opened(`${ROOT}/src/agent/logic/event-line.ts`)

    expect(screen.getByText("src/agent/logic/event-line.ts")).toBeDefined()
  })

  it("leaves a path outside the checkout whole, because reaching out is the finding", () => {
    opened("/Users/k/.claude/settings.json")

    expect(screen.getByText("/Users/k/.claude/settings.json")).toBeDefined()
  })
})

/**
 * A position that ran more than once, which is what a conversational step is.
 *
 * The pane was built against one turn and one document, and every one of these was a way
 * that showed: a message with nowhere to be while its turn spawned, and two of an agent's
 * messages stacked at the bottom under the reply to the first one.
 */
describe("TurnsView, on a position that ran more than once", () => {
  /** The transcript with a second turn on the end of it. */
  const twice: TranscriptEntryDto[] = [
    ...transcript,
    makeSession({ id: "s-b", position: 3 }),
    makeTool({ name: "Edit", kind: "Edit", detail: "a.ts", position: 3 }),
    ok,
  ]

  it("keeps a message on screen in the seconds before the turn it started exists", () => {
    // The exact shape after Send lands: the log has the message, the trak is `AgentWorking`
    // and the CLI has not written a line yet — so there is one turn, not two. This was a
    // paragraph vanishing: the bar clears on success and nothing else had it.
    const log: EventDto[] = [
      filed("first go"),
      makeHumanActed({ step: 3, action: { _tag: "Chat", message: "use a copy instead" } }),
    ]
    const turns = stepTurns(splitTurns(transcript, log), 3)
    expect(turns).toHaveLength(1)
    render(
      <TurnsView
        handOffBase={undefined}
        planning={undefined}
        agents={[]}
        row={rowOf(turns, 3, "step")}
        log={log}
        worktree={undefined}
        running={false}
        cancelling={undefined}
      />,
    )

    expect(screen.getByText("use a copy instead")).toBeDefined()
  })

  it("says it once when the turn arrives and takes it, rather than in both places", () => {
    const log: EventDto[] = [
      filed("first go"),
      makeHumanActed({ step: 3, action: { _tag: "Chat", message: "use a copy instead" } }),
    ]
    const turns = stepTurns(splitTurns(twice, log), 3)
    expect(turns).toHaveLength(2)
    render(
      <TurnsView
        handOffBase={undefined}
        planning={undefined}
        agents={[]}
        row={rowOf(turns, 3, "step")}
        log={log}
        worktree={undefined}
        running={false}
        cancelling={undefined}
      />,
    )

    expect(screen.getAllByText("use a copy instead")).toHaveLength(1)
  })

  it("puts each turn's words at the end of that turn, not both at the end of the step", () => {
    // The exact shape that was on screen: a conversational step answered, was answered
    // back, and answered again — and the pane drew both of its messages stacked at the
    // bottom, under the reply to the first one and a whole second turn's log.
    const log: EventDto[] = [
      emit({ type: "message", text: "shall I open the round" }),
      makeHumanActed({ step: 3, action: { _tag: "Chat", message: "yes please" } }),
      emit({ type: "message", text: "here are three directions" }),
    ]
    const turns = stepTurns(splitTurns(twice, log), 3)
    const { container } = render(
      <TurnsView
        handOffBase={undefined}
        planning={undefined}
        agents={[]}
        row={rowOf(turns, 3, "step")}
        log={log}
        worktree={undefined}
        running={false}
        cancelling={undefined}
      />,
    )

    const text = container.textContent
    const asked = text.indexOf("shall I open the round")
    const reply = text.indexOf("yes please")
    const answer = text.indexOf("here are three directions")
    expect(asked).toBeGreaterThanOrEqual(0)
    expect(reply).toBeGreaterThan(asked)
    expect(answer).toBeGreaterThan(reply)
  })
})

/**
 * A transcript written by an older build, where the engine had not yet stamped every line
 * with the position it belonged to. What is asserted is that a pane built on positions
 * still draws what those logs hold.
 */
describe("TurnsView, on a transcript the engine did not position", () => {
  it("keeps a document the log has and the transcript has no turn for", () => {
    // A transcript written before the engine stamped positions has no turn to hang the
    // second attempt on. Dropping it would be a pane silently missing the thing it exists
    // to show, which reads as a step that filed nothing.
    render(
      <TurnsView
        handOffBase={undefined}
        planning={undefined}
        agents={[]}
        row={rowOf(stepTurns(splitTurns(transcript, []), 3), 3, "step")}
        log={[filed("first go"), filed("second go")]}
        worktree={undefined}
        running={false}
        cancelling={undefined}
      />,
    )

    expect(screen.getByText("Attempt 1 of 2")).toBeDefined()
    expect(screen.getByText("Attempt 2 of 2")).toBeDefined()
  })

  it("keeps the gate's press beside the document when a turn after it filed nothing", () => {
    // A transcript written before the engine recorded a re-ask: `elicit` spawned twice
    // for one ask, so its second spawn reads as a turn of its own and the log holds one
    // ending for both. Handing the press to the last section put it on a turn with no
    // card to draw it, and the gate could not be answered from this surface at all.
    const stale: TranscriptEntryDto[] = [
      ...transcript,
      makeSpawned({ pid: 2, position: 3 }),
      makeSession({ id: "s-a", position: 3 }),
      makeText({ text: '{ "type": "artifact" }', position: 3 }),
    ]
    const log = [filed("done")]
    render(
      <TurnsView
        handOffBase={undefined}
        planning={undefined}
        agents={[]}
        row={rowOf(stepTurns(splitTurns(stale, log), 3), 3, "step")}
        log={log}
        worktree={undefined}
        running={false}
        cancelling={undefined}
        actions={
          <button type="button" name="Approve">
            Approve
          </button>
        }
      />,
    )

    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined()
  })
})

/**
 * The other four things a step can file.
 *
 * A step files one of five shapes and the pane drew one of them, so the other four were
 * invisible — and an invisible `stuck` is the worst of the set: the trak has stopped and
 * is waiting on a person, and the surface said nothing at all.
 */
describe("TurnsView, on the outputs that are not a document", () => {
  it("draws a stuck account, which stops the trak in front of a person", () => {
    view([
      emit({
        type: "stuck",
        tried: "moved splitTurns out of the feature",
        happened: "no-restricted-imports names the wrong side",
        diagnosis: "the boundary may run both ways and I would be guessing",
      }),
    ])

    expect(screen.getByText("Could not do the work")).toBeDefined()
    expect(screen.getByText("no-restricted-imports names the wrong side")).toBeDefined()
  })

  it("draws what a step asked beside what was answered, with nobody standing at the gate", () => {
    const asked = emit({
      type: "questions",
      questions: [
        {
          question: "Where should the shared turn-splitting live?",
          context: "the module rules do not obviously allow either direction",
          options: [{ label: "A copy in each" }, { label: "A new shared module" }],
        },
      ],
    })
    view([
      asked,
      makeHumanActed({
        step: 3,
        action: { _tag: "AnswerQuestions", answers: ["A new shared module"] },
      }),
    ])

    expect(screen.getByText("Where should the shared turn-splitting live?")).toBeDefined()
    // Once, as the answer. The options are dropped: nothing on the wire says which was
    // picked, so a marked list would be a guess and an unmarked one a dead control.
    expect(screen.getAllByText("A new shared module")).toHaveLength(1)
    expect(screen.queryByText("A copy in each")).toBeNull()
    expect(screen.getByText("Answered")).toBeDefined()
  })

  it("says an ask nobody answered was never answered, rather than leaving it waiting", () => {
    // Skipped, superseded or replanned past. This card used to claim a person still owed
    // an answer for the rest of the trak's life.
    view([emit({ type: "questions", questions: [{ question: "Which port?", options: [] }] })])

    expect(screen.getByText("Never answered")).toBeDefined()
    expect(screen.getByText("not answered")).toBeDefined()
  })

  it("gives the gate's form to the newest ask, and not to the one it replaced", () => {
    // A position that asked, was answered, and asked again. Only the newest is on the
    // table; the first is a record of what was decided, and a form on it would send answers
    // numbered against a list the agent has already replaced.
    const ask = (question: string): EventDto =>
      emit({ type: "questions", questions: [{ question, options: [] }] })
    const log: EventDto[] = [
      ask("Which port?"),
      makeHumanActed({
        step: 3,
        action: { _tag: "AnswerQuestions", answers: ["The one in .env"] },
      }),
      ask("And the host?"),
    ]
    const turns = stepTurns(splitTurns(transcript, log), 3)
    render(
      <TurnsView
        handOffBase={undefined}
        planning={undefined}
        agents={[]}
        row={rowOf(turns, 3, "step")}
        log={log}
        worktree={undefined}
        running={false}
        cancelling={undefined}
        answering={ANSWERING}
      />,
    )

    expect(screen.getByRole("textbox", { name: "And the host?" })).toBeDefined()
    expect(screen.queryByRole("textbox", { name: "Which port?" })).toBeNull()
    expect(screen.getByText("Answered")).toBeDefined()
    expect(screen.queryByText("Never answered")).toBeNull()
  })

  it("draws the agent's prose as its own bubble, with nothing annotating it", () => {
    view([emit({ type: "message", text: "Do you want every call, or what the drawer shows?" })])

    expect(screen.getByText("Do you want every call, or what the drawer shows?")).toBeDefined()
    // The caption that used to sit under it said what the bubble already says.
    expect(screen.queryByText(/waiting on you/i)).toBeNull()
  })

  it("draws a turn that gave up as a notice rather than as a document", () => {
    view([emit({ type: "failed", error: "no schema-valid output after three attempts" })])

    expect(screen.getByText("no schema-valid output after three attempts")).toBeDefined()
  })
})

/**
 * Where the log and the card below it are showing the same thing.
 *
 * A turn's last words *are* its return value, so the transcript and the output event carry
 * the same string — and the pane held both. This is the seam that decides which one draws
 * it, and it is the one place where deleting too much would lose something no card shows.
 */
describe("TurnsView, where the log and the output overlap", () => {
  it("draws that prose once, not as a log row as well as a bubble", () => {
    // The turn's last words *are* its return value, so the same string arrives twice —
    // once as the `Text` entry the provider recorded and once as the `message` the
    // runtime wrapped it in. Drawn twice it read as the agent having said it twice.
    const text = "Say go and I will open the round on those defaults."
    view([emit({ type: "message", text })], [...transcript, makeText({ text, position: 3 })])

    expect(screen.getAllByText(text)).toHaveLength(1)
  })

  it("draws the document a turn filed and not the JSON that carried it", () => {
    // The envelope is the same thing the card below draws, in the form a machine reads it
    // in. Drawn as well it was a fenced blob of JSON directly above the document it says.
    // The event reports the exact slice the engine took, fences included, and the log
    // subtracts that — nothing here reads the text looking for one.
    const envelope =
      "```json\n" +
      JSON.stringify({
        type: "artifact",
        sections: { Summary: "the renderer is pure", Changes: "one file" },
      }) +
      "\n```"
    view(
      [filed("the renderer is pure", envelope)],
      [...transcript, makeText({ text: "Done — filing now.\n\n" + envelope })],
    )

    expect(screen.getAllByText("the renderer is pure")).toHaveLength(1)
    expect(document.body.textContent).not.toContain('"type"')
    // What the agent said before filing is still the agent talking, and stays.
    expect(screen.getByText("Done — filing now.")).toBeDefined()
  })

  it("draws the JSON of a turn that reported no envelope, which is one worth reading", () => {
    // An attempt `elicit` re-asked, and a turn that answered in prose: neither reports a
    // slice, so the log keeps every word. The alternative is a pane that quietly deletes
    // the one thing that says what went wrong.
    const malformed = '```json\n{ "type": "artifact", "sections": { "Summary": "do'
    view([filed("the renderer is pure")], [...transcript, makeText({ text: malformed })])

    expect(document.body.textContent).toContain('"type"')
  })

  it("keeps prose no card is drawing, which is the narration between two calls", () => {
    const narration = "Reading the other half of the file before I decide."
    view(
      [emit({ type: "message", text: "and here is what I found" })],
      [...transcript, makeText({ text: narration, position: 3 })],
    )

    expect(screen.getByText(narration)).toBeDefined()
  })

  it("gives mid-turn prose the same bubble as the words a turn ends on", () => {
    // The agent talking is the agent talking. It used to be a muted `Line` in the tool
    // column, which read as a longer note among the notes — and left the same words in
    // two registers depending only on where in the turn they happened.
    view([], [...transcript, makeText({ text: "**What exists** — a list:\n\n- one", position: 3 })])

    // Only the bubble renders markdown, so the emphasis arriving as an element rather
    // than as asterisks is proof of which shape drew it. The log's own rows are list
    // items too, which is why this asserts on the element and not on a count.
    expect(screen.getByText("What exists").tagName).toBe("STRONG")
  })

  it("renders the markdown an agent wrote rather than the characters it typed", () => {
    // Every string an agent writes is markdown, and a table is the shape that is
    // unreadable as characters — `| a | b |` on one line says nothing about its cells.
    view([emit({ type: "message", text: "| Question | Default |\n| - | - |\n| scope | (a) |" })])

    // It draws as a table fence draws, so its heads appear again on each narrow line.
    expect(screen.getAllByText("Question").length).toBeGreaterThan(0)
    expect(screen.getByText("scope")).toBeDefined()
    expect(screen.queryByText(/\| Question \|/)).toBeNull()
  })
})

/** What the composer filed, and what a check said about a step's work. */
describe("TurnsView, on the composer's runs and the checks over a step", () => {
  it("puts a failing check above what the step filed, since it is why you are asked", () => {
    const log: EventDto[] = [
      filed("done"),
      makeCheckFailed({ step: 3, name: "verify", output: "1 failed | 411 passed" }),
    ]
    view(log)

    expect(screen.getByText("verify failed")).toBeDefined()
    expect(screen.getByText("1 failed | 411 passed")).toBeDefined()
  })

  it("draws the composer's answered questions with the same card a step's get", () => {
    // Keyed by session rather than by position — `ComposerReturned` carries no step —
    // and drawn by the same component, because nothing on the wire says who asked.
    //
    // **The answer's `step: 0` is what a composer gate actually records**, and it is a
    // real position as well. Nothing here may key on it: it is the ask this answer
    // followed in the log that makes it the composer's.
    composerRun(
      {
        type: "questions",
        questions: [
          { question: "Readable by a person, or parseable by another trak?", options: [] },
        ],
      },
      [makeHumanActed({ step: 0, action: { _tag: "AnswerQuestions", answers: ["By a person"] } })],
    )

    expect(screen.getByText("Readable by a person, or parseable by another trak?")).toBeDefined()
    expect(screen.getByText("By a person")).toBeDefined()
    expect(screen.getByText("Answered")).toBeDefined()
  })

  it("draws what a run proposed, which a re-composed plan no longer matches", () => {
    // The reason this is not the Map's job: the Map draws the plan as it stands, and a
    // trak composed twice has a spliced plan matching neither proposal — so this card is
    // the only place the first run's own proposal survives.
    composerRun({
      type: "proposal",
      title: "Export a transcript",
      rationale: "the turn-splitting lives in client/ and decides everything after it",
      steps: [
        {
          type: "agent",
          agent: "investigate",
          instruction: "find where it lives",
          conversational: false,
        },
      ],
    })

    expect(screen.getByText("Export a transcript")).toBeDefined()
    expect(screen.getByText("investigate")).toBeDefined()
    // Rendered nowhere else in the app before this.
    expect(
      screen.getByText("the turn-splitting lives in client/ and decides everything after it"),
    ).toBeDefined()
  })

  /**
   * The clock belongs on the row a person is waiting on, and that row is routinely not the
   * last one: a line the provider wrote after the call is what ends a live turn, with the
   * command still open above it. Handing `live` to the last group alone took the duration
   * off the one case it exists for.
   *
   * The trailing line is a kind nobody catalogued, deliberately — `workOnly` takes the
   * heartbeat out, and using one here would make the command the last group and stop the
   * case being tested at all.
   */
  it("counts up on the open call behind the line written after it", () => {
    const at = 1_786_400_000_000
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(at + 112_000)
    const log: readonly EventDto[] = [filed("done")]
    const entries: TranscriptEntryDto[] = [
      makeSpawned({ pid: 1, position: 3 }),
      makeSession({ id: "s-a", position: 3 }),
      makeTool({ name: "Bash", kind: "Bash", detail: "pnpm verify", at, position: 3 }),
      makeNote({ text: "Unknown(system/some_new_kind)", position: 3 }),
    ]
    const turns = stepTurns(splitTurns(entries, log), 3)
    render(
      <TurnsView
        handOffBase={undefined}
        planning={undefined}
        agents={[]}
        row={rowOf(turns, 3, "step")}
        log={log}
        worktree={undefined}
        running
        cancelling={undefined}
      />,
    )

    expect(screen.getByText("Running · 1m 52s")).toBeDefined()
  })

  it("says nothing about a check the agent went back and fixed", () => {
    const log: EventDto[] = [
      makeCheckFailed({ step: 3, name: "verify", output: "1 failed" }),
      filed("done"),
      makeChecksPassed({ step: 3, ran: ["verify"] }),
    ]
    view(log)

    expect(screen.queryByText(/verify failed/)).toBeNull()
  })
})

/**
 * The card's two faces, which is what a check gets instead of a plate above the document.
 *
 * The rule under all of it: **the gate while it runs, the document once it passes, and the
 * evidence whatever a person pressed when it fails.** `check.ts` holds it as a function and
 * these are it drawn — what a reader is actually looking at at each of the four states.
 */
const STARTED = 1_786_400_000_000

const gate = (): HTMLElement => screen.getByRole("button", { name: "Gate" })

/** The pane with the daemon's run in hand, which is the only source of live output. */
const withRun = (log: readonly EventDto[], run: CheckRunDto | undefined): void => {
  render(
    <TurnsView
      handOffBase={undefined}
      planning={undefined}
      row={rowOf(stepTurns(splitTurns(transcript, log), 3), 3, "step")}
      log={log}
      worktree="/repo"
      running={false}
      cancelling={undefined}
      check={run}
      agents={[]}
    />,
  )
}

describe("TurnsView, on the gate a check opens in the card", () => {
  it("draws no strip at all at a position whose agent declares no check", () => {
    // Half the agents in this project declare none, and their cards must be exactly what
    // they were — which is what stops the strip becoming furniture that is empty more
    // often than not.
    view([filed("done")])

    expect(screen.queryByRole("button", { name: "Gate" })).toBeNull()
    expect(screen.getByText("done")).toBeDefined()
  })

  it("opens on the gate while a check runs, counting against its own ceiling", () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(STARTED + 72_000)
    withRun(
      [filed("done")],
      makeCheckRun({
        step: 3,
        startedAt: STARTED,
        limit: 300,
        output: "prettier --check .\ntsc --noEmit\n",
      }),
    )

    expect(screen.getByText("verify · 1m12s of 5m00s")).toBeDefined()
    expect(screen.getByText(/tsc --noEmit/)).toBeDefined()
    // The document is behind the other face rather than gone, and nothing has grown a
    // press: there is nothing to approve until the check has said something.
    expect(screen.queryByText("done")).toBeNull()
  })

  it("never offers a run the agent started through the check tool to the document", () => {
    // The newest document is the previous attempt's while the agent works, and a run it
    // asked for mid-turn judged no filing: drawn here it would read as that one's verdict.
    withRun(
      [filed("done")],
      makeCheckRun({ step: 3, startedAt: STARTED, call: "toolu_1", output: "tsc --noEmit\n" }),
    )

    expect(screen.queryByRole("button", { name: "Gate" })).toBeNull()
    expect(screen.getByText("done")).toBeDefined()
  })

  it("shortens the line it was spawned as to the checkout it ran in", () => {
    withRun(
      [filed("done")],
      makeCheckRun({
        step: 3,
        startedAt: STARTED,
        command: "bash /repo/.orkestra/checks/verify.sh",
      }),
    )

    expect(screen.getByText("bash .orkestra/checks/verify.sh")).toBeDefined()
  })

  it("hands the document back when the check passes, one press from the output", () => {
    withRun(
      [filed("done"), makeChecksPassed({ step: 3, ran: ["verify"] })],
      makeCheckRun({
        step: 3,
        startedAt: STARTED,
        output: "611 passed",
        finished: { verdict: "passed", exitCode: 0, at: STARTED + 161_000 },
      }),
    )

    expect(screen.getByText("verify passed · 2m41s")).toBeDefined()
    expect(screen.getByText("done")).toBeDefined()
    expect(screen.queryByText("611 passed")).toBeNull()

    fireEvent.click(gate())
    expect(screen.getByText("611 passed")).toBeDefined()
  })
})

/**
 * The other half, split only because the block was over the line limit: what a failure
 * looks like when it is the thing a person is standing at, and when it is history.
 */
describe("TurnsView, on a check that came back non-zero", () => {
  it("lands on the evidence when it fails, and says what taking the work would mean", () => {
    const log: EventDto[] = [
      filed("done"),
      makeCheckFailed({ step: 3, name: "verify", output: "1 failed | 411 passed", exitCode: 1 }),
    ]
    render(
      <TurnsView
        handOffBase={undefined}
        planning={undefined}
        row={rowOf(stepTurns(splitTurns(transcript, log), 3), 3, "step")}
        log={log}
        worktree="/repo"
        running={false}
        cancelling={undefined}
        actions={<button type="button">Approve</button>}
        agents={[]}
      />,
    )

    expect(screen.getByText("verify failed · exit 1")).toBeDefined()
    expect(screen.getByText("1 failed | 411 passed")).toBeDefined()
    expect(
      screen.getByText(/Approving takes the work anyway; replying sends the agent back/),
    ).toBeDefined()
  })

  it("says nothing about approving on a superseded attempt, whose failure is history", () => {
    // Same failure, no press on the table: the sentence describes two things a person can
    // do at a gate, and this card is not one.
    const log: EventDto[] = [
      filed("first go"),
      makeCheckFailed({ step: 3, name: "verify", output: "1 failed", exitCode: 1 }),
      filed("second go"),
    ]
    view(log)

    expect(screen.getByText("verify failed · exit 1")).toBeDefined()
    expect(screen.queryByText(/Approving takes the work anyway/)).toBeNull()
  })

  it("opens a folded attempt onto whichever face was pressed", () => {
    // A superseded card folds to its header and keeps its strip, because the verdict is
    // the useful half of it at a glance. Pressing a face is a press to read something.
    const log: EventDto[] = [
      filed("first go"),
      makeCheckFailed({ step: 3, name: "verify", output: "1 failed" }),
      filed("second go"),
    ]
    view(log)

    expect(screen.queryByText("1 failed")).toBeNull()
    fireEvent.click(gate())
    expect(screen.getByText("1 failed")).toBeDefined()
  })

  it("holds the daemon's run against the newest document and not against an older one", () => {
    // Between the agent being re-entered and its new check starting, the memory still
    // holds the previous attempt's failure. Drawing it on the new document would say the
    // work just filed had already been judged.
    const log: EventDto[] = [
      filed("first go"),
      makeCheckFailed({ step: 3, name: "verify", output: "1 failed" }),
      filed("second go"),
    ]
    withRun(
      log,
      makeCheckRun({
        step: 3,
        startedAt: STARTED,
        output: "1 failed",
        finished: { verdict: "failed", exitCode: 1, at: STARTED + 1_000 },
      }),
    )

    // One strip, on the attempt that earned it — the newest card is the plain one it was
    // before any of this existed.
    expect(screen.getAllByRole("button", { name: "Gate" }).length).toBe(1)
    expect(screen.getByText("second go")).toBeDefined()
  })

  it("puts no verdict at all on a document filed after a pass, since nothing judged it", () => {
    // **The one a green verdict got wrong.** A person chats at the approval gate, the
    // agent files again, and the daemon still holds the run that passed over the document
    // below — so the new card drew `verify passed · 2m41s` and the previous run's console
    // over work no check had run on, at the gate where somebody is deciding.
    const log: EventDto[] = [
      filed("first go"),
      makeChecksPassed({ step: 3, ran: ["verify"] }),
      makeHumanActed({ step: 3, action: { _tag: "Chat", message: "widen the second section" } }),
      filed("second go"),
    ]
    withRun(
      log,
      makeCheckRun({
        step: 3,
        startedAt: STARTED,
        output: "611 passed",
        finished: { verdict: "passed", exitCode: 0, at: STARTED + 161_000 },
      }),
    )

    expect(screen.queryByText(/verify passed/)).toBeNull()
    expect(screen.queryByRole("button", { name: "Gate" })).toBeNull()
    expect(screen.getByText("second go")).toBeDefined()
  })

  it("draws nothing where a pass is only on the log, rather than an empty console", () => {
    // What a passed run costs once the daemon has forgotten it: `ChecksPassed` carries the
    // names and no output whatever, so the strip it would buy leads nowhere.
    view([filed("done"), makeChecksPassed({ step: 3, ran: ["verify"] })])

    expect(screen.queryByRole("button", { name: "Gate" })).toBeNull()
    expect(screen.getByText("done")).toBeDefined()
  })
})

/**
 * A position that dropped the same way twice, which is where the fold has to be per turn.
 *
 * The rows are matched by text and both attempts wrote the identical string, so a fold
 * aimed with one error string could only take both or neither — and taking both left the
 * earlier attempt reading as a turn that stopped for no reason, with nothing on screen
 * saying why. `filed.ts` pairs each `TurnFailed` with the turn that earned it, so both fold
 * and each turn carries its own account of what ended it.
 */
describe("TurnsView, on a position that dropped the same way twice", () => {
  const DROPPED = "API Error: Connection closed mid-response. The response above may be incomplete."
  /** What the line says, read off `failure.ts` so it cannot drift from the notice's words. */
  const HEAD = failureWords({
    _tag: "Failed",
    error: DROPPED,
    kind: "provider",
    apiKind: "interrupted",
  }).head

  /**
   * Interrupted, restarted, interrupted again — the same words both times.
   *
   * The restart carries a `step` it would not have from the engine, which clears the
   * in-flight record when the failing turn lets go of it. Kept deliberately: a restart
   * naming a turn that already ended must not be counted as a second ending, or the
   * attempt below it is drawn a section away from its own rows.
   */
  const log: readonly EventDto[] = [
    makeTurnFailed({ step: 3, sessionId: "s-a", reason: DROPPED, apiKind: "interrupted" }),
    makeRestarted({ step: 3, sessionId: "s-b" }),
    makeTurnFailed({ step: 3, sessionId: "s-b", reason: DROPPED, apiKind: "interrupted" }),
  ]

  /**
   * One attempt: a call of its own, then the two rows the drop arrives as.
   *
   * The call is what tells the two turns apart on screen — their error rows are the same
   * string, which is the whole of the case, so only what sits above them can say which
   * turn a survivor belongs to.
   */
  const dropped = (session: string, pid: number, tool: "Read" | "Edit"): TranscriptEntryDto[] => [
    makeSpawned({ pid, position: 3 }),
    makeSession({ id: session, position: 3 }),
    makeTool({ name: tool, kind: tool, detail: `${session}.ts`, position: 3 }),
    makeText({ text: DROPPED, position: 3 }),
    makeNote({ text: `ApiError(interrupted: ${DROPPED})`, position: 3 }),
  ]

  const twoDrops = (): void => {
    const entries = [...dropped("s-a", 1, "Read"), ...dropped("s-b", 2, "Edit")]
    const turns = stepTurns(splitTurns(entries, log), 3)
    expect(turns).toHaveLength(2)
    render(
      <TurnsView
        handOffBase={undefined}
        planning={undefined}
        agents={[]}
        row={rowOf(turns, 3, "step")}
        log={log}
        worktree={undefined}
        running={false}
        cancelling={undefined}
        // Deliberately not the notice's own words: what is being counted below is how many
        // *lines* were drawn, and a stand-in spelling the same sentence would be counted
        // with them.
        failure={<p>the notice</p>}
      />,
    )
  }

  it("folds both attempts' rows, since neither is the pane's to draw raw", () => {
    twoDrops()

    // Neither the provider's prose nor the engine's note for it, at either attempt.
    expect(screen.queryByText(DROPPED)).toBeNull()
    expect(screen.queryByText(/^ApiError\(/)).toBeNull()
  })

  /**
   * The other end of the same rule: exactly one line, and it is the *earlier* attempt's.
   * The later one is the notice's to say — it is saying it in full with the press out of
   * it, so a line above would be its headline twelve pixels up.
   */
  it("leaves the earlier attempt a line of its own, where its rows were", () => {
    twoDrops()

    expect(screen.getAllByText(HEAD)).toHaveLength(1)
    // Below that turn's own call and above the restart that ended it, which is the only
    // way to say which of the two identical attempts it belongs to.
    const shown = document.body.textContent
    expect(shown.indexOf(HEAD)).toBeGreaterThan(shown.indexOf("Read 1 file"))
    expect(shown.indexOf(HEAD)).toBeLessThan(shown.indexOf("Restarted"))
  })

  /**
   * The other half of the fold. There is no rule and no gap between sections, so the row
   * saying a restart happened *is* the boundary — without it the two attempts read as one
   * continuous log, and the fold has made the pane shorter without making it legible.
   */
  it("heads the second attempt with the restart that started it", () => {
    twoDrops()

    // Once, and between the two: after the turn the drop ended, above the turn it began.
    expect(screen.getAllByText("Restarted")).toHaveLength(1)
    const shown = document.body.textContent
    expect(shown.indexOf("Restarted")).toBeGreaterThan(shown.indexOf("Read 1 file"))
    expect(shown.indexOf("Restarted")).toBeLessThan(shown.indexOf("Edited 1 file"))
  })
})

/**
 * The two things a person can do to a check, drawn: the press that ends one running, and
 * what a card says afterwards — for the run they ended, and for the run their switch kept
 * from starting.
 */
const stopping = (): Stopping => ({
  stop: vi.fn<() => void>(),
  isPending: false,
  disabled: false,
  said: undefined,
})

/** The pane with the daemon's run and the page's cancel press in hand. */
const withCancel = (
  log: readonly EventDto[],
  run: CheckRunDto | undefined,
  cancelling: Stopping | undefined,
): void => {
  render(
    <TurnsView
      handOffBase={undefined}
      planning={undefined}
      row={rowOf(stepTurns(splitTurns(transcript, log), 3), 3, "step")}
      log={log}
      worktree="/repo"
      running={true}
      cancelling={cancelling}
      check={run}
      agents={[]}
    />,
  )
}

describe("TurnsView, on ending a check and on the record the two presses leave", () => {
  it("draws one press in the band while the check runs, and it is the page's stop", () => {
    const press = stopping()
    withCancel([filed("done")], makeCheckRun({ step: 3, startedAt: STARTED }), press)

    const button = screen.getByRole("button", { name: "Stop verify" })
    fireEvent.click(button)
    expect(press.stop).toHaveBeenCalledTimes(1)
  })

  it("draws no press where the page offered none, or once the run has settled", () => {
    withCancel([filed("done")], makeCheckRun({ step: 3, startedAt: STARTED }), undefined)
    expect(screen.queryByRole("button", { name: "Stop verify" })).toBeNull()
    cleanup()

    withCancel(
      [filed("done"), makeChecksPassed({ step: 3, ran: ["verify"] })],
      makeCheckRun({
        step: 3,
        startedAt: STARTED,
        finished: { verdict: "passed", exitCode: 0, at: STARTED + 1_000 },
      }),
      stopping(),
    )
    expect(screen.queryByRole("button", { name: "Stop verify" })).toBeNull()
  })

  it("says who ended a run and lands on the evidence, with the failing gate's sentence", () => {
    const log: EventDto[] = [filed("done"), makeChecksCancelled({ step: 3, name: "verify" })]
    render(
      <TurnsView
        handOffBase={undefined}
        planning={undefined}
        row={rowOf(stepTurns(splitTurns(transcript, log), 3), 3, "step")}
        log={log}
        worktree="/repo"
        running={false}
        cancelling={undefined}
        check={makeCheckRun({
          step: 3,
          startedAt: STARTED,
          output: "compiling\nlinting\n",
          finished: { verdict: "cancelled", at: STARTED + 72_000 },
        })}
        actions={<button type="button">Approve</button>}
        agents={[]}
      />,
    )

    expect(screen.getByText("verify ended by you · 1m12s")).toBeDefined()
    expect(screen.getByText(/compiling/)).toBeDefined()
    expect(screen.getByText(/You ended the run before it finished/)).toBeDefined()
  })

  it("says twice that a step's checks were skipped, and its gate face is unpressable", () => {
    // The surface a wrong build looks right in: no run, no console, nobody stopped here.
    const log: EventDto[] = [
      filed("done"),
      makeChecksPassed({ step: 3, ran: [], skipped: ["verify"] }),
    ]
    view(log)

    expect(screen.getByText("checks skipped")).toBeDefined()
    expect(screen.getByText("verify did not run. This step was accepted without it.")).toBeDefined()
    expect(screen.getByText("done")).toBeDefined()
    expect(gate().hasAttribute("disabled")).toBe(true)
  })
})
