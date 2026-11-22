/**
 * What a delegation's card says, and what it says once you press it. `turns.test.ts`
 * decides which lines belong to it; this decides what is on screen.
 *
 * Rendered bare, as `ActivityGroup.test.tsx` is: the delegation is the whole input.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { TranscriptEntryDto } from "../../../../api/types"
import {
  makeNote,
  makeSubagent,
  makeSubagentResult,
  makeText,
  makeTool,
} from "../../../../fixtures"
import SubagentGroup from "./SubagentGroup"
import type { Delegation } from "../../../../format/transcriptRows"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const ran = (command: string): TranscriptEntryDto =>
  makeTool({ name: "Bash", kind: "Bash", detail: command, parent: "toolu_1" })

const working: Delegation = {
  head: makeSubagent({
    call: "toolu_1",
    agentType: "general-purpose",
    description: "Run echo hello and report output",
    prompt: "Run echo hello and tell me what it printed.",
  }),
  result: undefined,
  ok: undefined,
  backgrounded: false,
  entries: [ran("ls"), ran("echo hello")],
}

const done: Delegation = {
  ...working,
  result: makeSubagentResult({ call: "toolu_1", ok: true, summary: "It printed hello." }),
  ok: true,
}

/** The header, which is the one control on the card. */
const header = (): HTMLElement => screen.getByRole("button", { name: /general-purpose|background/ })

describe("SubagentGroup — the header", () => {
  it("leads with the agent rather than with the job", () => {
    // The complaint this came from is a delegation reading as a tool call that failed.
    // The card is the answer to that, and the agent is what a reader wants off it first.
    render(<SubagentGroup delegation={working} />)

    expect(screen.getByText("general-purpose")).toBeDefined()
  })

  it("says how it was started, which is the only thing that separates the two", () => {
    render(<SubagentGroup delegation={working} />)
    expect(screen.getByText("subagent")).toBeDefined()

    cleanup()
    render(<SubagentGroup delegation={{ ...working, backgrounded: true }} />)
    expect(screen.getByText("background")).toBeDefined()
  })

  it("calls a delegation with no agent type a background task", () => {
    // No captured stream produces one, so this is the only thing standing behind the
    // fallback. Never blank and never *unnamed …*, both of which read as a field that
    // came back empty — which is the misreading the card exists to remove.
    render(
      <SubagentGroup
        delegation={{ ...working, head: makeSubagent({ call: "toolu_1" }), backgrounded: true }}
      />,
    )

    expect(screen.getByText("background task")).toBeDefined()
  })

  it("shows what it was asked, and never what it answered", () => {
    // Folded, a finished delegation still says the job. Reading the answer is a click,
    // which is the round's decision rather than an oversight.
    render(<SubagentGroup delegation={done} />)

    expect(screen.getByText("Run echo hello and report output")).toBeDefined()
    expect(screen.queryByText("It printed hello.")).toBeNull()
  })

  it("marks a subagent that failed, and says nothing about one that did not", () => {
    render(<SubagentGroup delegation={done} />)
    expect(screen.queryByText("failed")).toBeNull()

    cleanup()
    // The delegation's own `ok`, which is the parent's observed outcome where there was
    // one — here the answer says it worked and the call that made it says otherwise.
    render(
      <SubagentGroup
        delegation={{
          ...working,
          result: makeSubagentResult({ call: "toolu_1", ok: true }),
          ok: false,
        }}
      />,
    )
    expect(screen.getByText("failed")).toBeDefined()
  })

  it("marks a stopped subagent as stopped, never as a success or a failure", () => {
    // Through `ok` alone a stop reads as a success — the report says `ok: true` — and
    // the word is drawn in the ordinary quiet ink: a stop is a thing that was done to
    // the subagent, not a verdict on its work.
    render(
      <SubagentGroup
        delegation={{
          ...working,
          result: makeSubagentResult({ call: "toolu_1", ok: true, outcome: "stopped" }),
          ok: true,
        }}
      />,
    )
    expect(screen.getByText("stopped")).toBeDefined()
    expect(screen.queryByText("failed")).toBeNull()
  })
})

describe("SubagentGroup — how long it has been going", () => {
  const at = 1_786_400_000_000

  /** The clock the card reads at render, held still so the number is a fact. */
  const now = (offset: number): void => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(at + offset)
  }

  it("counts up while it is still working and something is driving the trak", () => {
    now(112_000)
    render(<SubagentGroup delegation={{ ...working, head: { ...working.head, at } }} live />)

    expect(screen.getByText("1m 52s")).toBeDefined()
  })

  it("says nothing once it has answered, however long it took", () => {
    // The cost of drawing elapsed only where something is running, taken deliberately: a
    // finished delegation loses the number, and a column of durations on rows that are
    // over is what the eye has to skip past to find the one that matters.
    now(112_000)
    render(<SubagentGroup delegation={{ ...done, head: { ...done.head, at } }} live />)

    expect(screen.queryByText("1m 52s")).toBeNull()
  })

  it("says nothing on a trak nobody is driving, though the answer never landed", () => {
    // A turn that died mid-delegation. The answer is never coming, and a number counting
    // up on it would be the confident wrong fact the whole treatment exists to remove.
    now(112_000)
    render(<SubagentGroup delegation={{ ...working, head: { ...working.head, at } }} />)

    expect(screen.queryByText("1m 52s")).toBeNull()
  })

  it("says nothing where the engine stamped no time", () => {
    now(112_000)
    render(<SubagentGroup delegation={working} live />)

    expect(screen.queryByText(/\ds/)).toBeNull()
  })
})

describe("SubagentGroup — what is inside it", () => {
  it("opens while it is running and folds once it is done", () => {
    render(<SubagentGroup delegation={working} />)
    expect(header().getAttribute("aria-expanded")).toBe("true")

    cleanup()
    render(<SubagentGroup delegation={done} />)
    expect(header().getAttribute("aria-expanded")).toBe("false")
  })

  it("shows the answer as the agent's own words once it is opened", () => {
    render(<SubagentGroup delegation={done} />)

    fireEvent.click(header())
    expect(screen.getByText("It printed hello.")).toBeDefined()
  })

  it("says what it was asked in one line, and never hands over the briefing itself", () => {
    // A real prompt is a kilobyte of headings and numbered lists, and drawn as an
    // `AgentMessage` it was the parent's briefing wearing the subagent's own element —
    // longer than everything under it and reading as the subagent talking. `description`
    // is the same job in one line and is on the card whether it is open or folded.
    render(<SubagentGroup delegation={done} />)
    expect(screen.getByText("Run echo hello and report output")).toBeDefined()

    fireEvent.click(header())
    expect(screen.getByText("Run echo hello and report output")).toBeDefined()
    expect(screen.queryByText(/tell me what it printed/)).toBeNull()
  })

  it("groups the subagent's own work the way the parent's is grouped", () => {
    render(<SubagentGroup delegation={working} />)

    // A run of one activity is one row inside a delegation too.
    fireEvent.click(screen.getByRole("button", { name: "Listed, and ran commands" }))
    expect(screen.getByText("ls")).toBeDefined()
  })

  it("keeps the three most recent rows and counts the rest", () => {
    // The window the round settled. A delegation that has been going for forty rows is
    // otherwise the longest thing in the turn that asked for it.
    const chatty: Delegation = {
      ...working,
      entries: [
        makeText({ text: "first" }),
        makeText({ text: "second" }),
        makeText({ text: "third" }),
        makeText({ text: "fourth" }),
        makeText({ text: "fifth" }),
      ],
    }
    render(<SubagentGroup delegation={chatty} />)

    expect(screen.getByText("2 earlier")).toBeDefined()
    expect(screen.queryByText("first")).toBeNull()
    expect(screen.getByText("fifth")).toBeDefined()
  })

  it("says nothing about earlier rows when it is showing all of them", () => {
    render(<SubagentGroup delegation={working} />)

    expect(screen.queryByText(/earlier/)).toBeNull()
  })
})

/**
 * The same rule the parent's log runs under, asked of the card: a subagent that is still
 * working shows one set of dots at its tail, and one that answered shows none.
 *
 * *What is it doing right now* is asked hardest of a card that is still open, which is why
 * the delegation's own liveness is the fact and not the turn's alone.
 */
describe("SubagentGroup — the pause inside it", () => {
  const thinking: TranscriptEntryDto = makeNote({ text: "Thinking", parent: "toolu_1" })

  /** A subagent that stopped, worked, stopped, worked, and stopped again. */
  const stopping: readonly TranscriptEntryDto[] = [
    thinking,
    ran("ls"),
    thinking,
    ran("echo hello"),
    thinking,
  ]

  it("shows one set of dots, at the end of the rows of a card still working", () => {
    render(<SubagentGroup delegation={{ ...working, entries: stopping }} live />)

    expect(screen.getAllByText("Thinking")).toHaveLength(1)
  })

  it("shows none once it has answered, however it left off", () => {
    render(<SubagentGroup delegation={{ ...done, entries: stopping }} live />)

    fireEvent.click(header())
    expect(screen.queryByText("Thinking")).toBeNull()
  })

  it("shows none on a trak nobody is driving, though the answer never landed", () => {
    render(<SubagentGroup delegation={{ ...working, entries: stopping }} />)

    expect(screen.queryByText("Thinking")).toBeNull()
  })

  it("names the dots at its tail by the summary, and drops an earlier one like any pause", () => {
    const planned = makeNote({ text: "Thinking: Planning the listing", parent: "toolu_1" })
    const checked = makeNote({ text: "Thinking: Checking the output", parent: "toolu_1" })
    const { container } = render(
      <SubagentGroup delegation={{ ...working, entries: [planned, ran("ls"), checked] }} live />,
    )

    expect(screen.queryByText("Planning the listing")).toBeNull()
    expect(screen.getByText("Checking the output")).toBeDefined()
    expect(container.querySelectorAll(".animate-thinking")).toHaveLength(3)
  })

  it("counts only rows a reader can get to as earlier", () => {
    // Five groups with the two spent pauses in them, three without — so the window shows
    // everything and there is nothing earlier. A hidden row counted here would send a
    // reader looking for two lines the card cannot open onto.
    render(<SubagentGroup delegation={{ ...working, entries: stopping }} live />)

    expect(screen.queryByText(/earlier/)).toBeNull()
  })
})
