/**
 * Tier 1: the transcript split into turns, with no React and no fetch.
 *
 * This is the file that could lie without anyone noticing — it puts one step's work
 * under another step's heading, and both look plausible. So what is asserted is the
 * attribution itself: that a turn goes where the engine *stamped* it, that a line
 * written before the stamp existed still lands via the log's session join, and that no
 * line is dropped on the way.
 */

import { describe, expect, it } from "vitest"
import type { EventDto, ToolEntryDto, TranscriptEntryDto } from "../../../api/types"
import {
  makeAgentReturned,
  makeComposerReturned,
  makeNote,
  makeReask,
  makeSession,
  makeSpawned,
  makeText,
  makeTool,
} from "../../../fixtures"
import {
  composerRuns,
  spokenBelow,
  splitTurns,
  stepTurns,
  withoutFailure,
  withoutSpoken,
} from "./turns"
import { withoutEnvelopes } from "../../../format/transcriptRows"

const plan: EventDto = makeComposerReturned({
  sessionId: "s-plan",
  output: { type: "proposal", title: "Add a client", steps: [] },
})

const returned = (step: number, sessionId: string): EventDto =>
  makeAgentReturned({ step, sessionId })

const tool = (name: string, kind: ToolEntryDto["kind"], detail?: string): ToolEntryDto =>
  makeTool({ name, kind, ...(detail === undefined ? {} : { detail }) })

/** The agent's own words, as the provider records them. */
const said = (text: string): TranscriptEntryDto => makeText({ text })

/** A turn as the engine writes one now: every line stamped with its position. */
const turn = (
  pid: number,
  session: string,
  position: number | "composer",
  ...rest: TranscriptEntryDto[]
): TranscriptEntryDto[] => [
  makeSpawned({ pid, position }),
  makeSession({ id: session, position }),
  ...rest,
]

/** A turn as an older transcript holds one: no position anywhere. */
const unstamped = (
  pid: number,
  session: string,
  ...rest: TranscriptEntryDto[]
): TranscriptEntryDto[] => [makeSpawned({ pid }), makeSession({ id: session }), ...rest]

describe("splitTurns — where one turn ends and the next begins", () => {
  it("cuts at each Spawned and reads the session out of the line that names it", () => {
    const turns = splitTurns(
      [
        ...turn(1, "s-a", 0, tool("Read", "Read", "a.ts")),
        ...turn(2, "s-b", 1, tool("Edit", "Edit", "b.ts")),
      ],
      [],
    )

    expect(turns).toHaveLength(2)
    expect(turns.map((t) => t.session)).toEqual(["s-a", "s-b"])
    expect(turns[0]?.entries).toHaveLength(3)
  })

  it("cuts where the stamp changes, on the paths that write no Spawned", () => {
    // The shape that was actually on disk, and the bug it caused. `Spawned` is written
    // by the CLI provider and not by every path, so a transcript can carry one for the
    // composer's turns and none for the steps' — and every step's lines then fell into
    // the composer turn ahead of them, taking its `"composer"` stamp with them. One row
    // held the whole file and every step read *nothing ran here*.
    const turns = splitTurns(
      [
        ...turn(1, "s-plan", "composer"),
        makeSession({ id: "s-0", position: 0 }),
        tool("Read", "Read", "a.ts"),
      ],
      [],
    )

    expect(turns.map((t) => t.at)).toEqual(["composer", 0])
    expect(turns[1]?.session).toBe("s-0")
    expect(stepTurns(turns, 0)).toHaveLength(1)
  })

  it("cuts a second turn at the same position when the session changes", () => {
    // Ordinary after a splice: the entry is re-run, and its two attempts are two turns
    // under two sessions. The stamp alone cannot separate them.
    const turns = splitTurns(
      [makeSession({ id: "s-1a", position: 1 }), makeSession({ id: "s-1b", position: 1 })],
      [],
    )

    expect(turns.map((t) => t.session)).toEqual(["s-1a", "s-1b"])
    expect(stepTurns(turns, 1)).toHaveLength(2)
  })

  it("folds a re-ask into the turn it interrupts, and absorbs only that one spawn", () => {
    // What a malformed artifact leaves behind: `elicit` re-prompts by resuming, so one
    // ask spawns twice while the log records a single ending. Read as two turns it put
    // the position's document on the first of them and offered the gate's press beside
    // the second, which had nothing under it to press.
    const turns = splitTurns(
      [
        ...turn(1, "s-1", 1, said("{ not json")),
        makeReask({ reason: "no JSON found in response", position: 1 }),
        ...turn(2, "s-1", 1, said('{ "type": "artifact" }')),
        ...turn(3, "s-1", 1, said("re-entered after a check failed")),
      ],
      [returned(1, "s-1")],
    )

    expect(turns).toHaveLength(2)
    // The re-ask and both of its spawns are one turn; the check failure's is its own.
    expect(turns[0]?.entries).toHaveLength(7)
    expect(turns.map((t) => t.at)).toEqual([1, 1])
  })
})

describe("splitTurns — which position a turn ran for", () => {
  it("puts each turn where the engine stamped it, composer included", () => {
    const turns = splitTurns(
      [...turn(1, "s-plan", "composer"), ...turn(2, "s-0", 0), ...turn(3, "s-1", 1)],
      [],
    )

    // The composer's own turn is a position like any other, which is what makes its
    // row on the map click through to something. Note the log is empty: the stamp is
    // the whole source here.
    expect(turns.map((t) => t.at)).toEqual(["composer", 0, 1])
    expect(stepTurns(turns, 1)).toHaveLength(1)
    expect(stepTurns(turns, 0)[0]?.session).toBe("s-0")
  })

  it("places the turn in flight, which the session join never could", () => {
    // The bug this change fixes. The event that would name the live turn's session is
    // not written until it returns, so the most-watched turn in the app was the one
    // the join could not answer — note there is no terminating event for `s-live` in
    // the log at all, and it still lands at 3.
    const turns = splitTurns(
      [...turn(1, "s-0", 0), ...turn(2, "s-live", 3, tool("Bash", "Bash", "pnpm test"))],
      [returned(0, "s-0")],
    )

    expect(turns.map((t) => t.at)).toEqual([0, 3])
  })

  it("places a turn recorded before the position existed, from the log", () => {
    // Every transcript already on disk. The join is kept for exactly this, and it is
    // right for them: a turn with no stamp is one that has already ended, so the event
    // naming its session is in the log.
    const turns = splitTurns(
      [...unstamped(1, "s-plan"), ...unstamped(2, "s-0")],
      [plan, returned(0, "s-0")],
    )

    expect(turns.map((t) => t.at)).toEqual(["composer", 0])
  })

  it("leaves a turn with neither a stamp nor an event unplaced rather than guessing", () => {
    // No position on the line and nothing in the log naming its session: putting it
    // anywhere would read as that step's work. Nothing borrows a neighbour's position.
    const turns = splitTurns(
      [...unstamped(1, "s-lost"), ...unstamped(2, "s-1"), ...turn(3, "s-live", 2)],
      [returned(1, "s-1")],
    )

    expect(turns.map((t) => t.at)).toEqual([undefined, 1, 2])
    expect(stepTurns(turns, 0)).toHaveLength(0)
  })

  it("keeps a turn that died before it had a session", () => {
    const turns = splitTurns(
      [makeSpawned({ pid: 9 }), makeNote({ text: "ApiError(auth: no credentials)" })],
      [],
    )

    expect(turns).toHaveLength(1)
    expect(turns[0]?.session).toBeUndefined()
    expect(turns[0]?.entries).toHaveLength(2)
  })

  it("drops nothing, including entries before the first Spawned", () => {
    const entries: TranscriptEntryDto[] = [
      makeNote({ text: "Thinking" }),
      ...turn(1, "s-a", 0),
      makeNote({ text: "Result(20 chars)" }),
    ]
    const turns = splitTurns(entries, [])

    expect(turns.flatMap((t) => t.entries)).toEqual(entries)
  })

  it("is empty for a trak whose agent has never run", () => {
    expect(splitTurns([], [])).toEqual([])
  })
})

describe("composerRuns", () => {
  it("cuts a run at each new session, and not at the steps between them", () => {
    const turns = splitTurns(
      [...turn(1, "s-plan", "composer"), ...turn(2, "s-0", 0), ...turn(3, "s-plan-2", "composer")],
      [],
    )

    const runs = composerRuns(turns)
    expect(runs.map((r) => r.session)).toEqual(["s-plan", "s-plan-2"])
    expect(runs.map((r) => r.turns.length)).toEqual([1, 1])
  })

  it("keeps a resumed session as one run, however many turns it took", () => {
    // Asking for a different plan mints a session; a chat at the plan gate and a retry
    // after a failure both resume one. So this is one ask that took two CLI runs, and
    // it is one row.
    const turns = splitTurns(
      [...turn(1, "s-plan", "composer"), ...turn(2, "s-plan", "composer")],
      [],
    )

    const runs = composerRuns(turns)
    expect(runs).toHaveLength(1)
    expect(runs[0]?.turns).toHaveLength(2)
  })

  it("gives a turn that died before it had a session a run of its own", () => {
    // Filing a launch failure under the conversation that happens to follow it would
    // read as that conversation's work.
    const turns = splitTurns(
      [
        makeSpawned({ pid: 9, position: "composer" }),
        makeNote({
          text: "ApiError(auth: no credentials)",
          position: "composer",
        }),
        ...turn(2, "s-plan", "composer"),
      ],
      [],
    )

    expect(composerRuns(turns).map((r) => r.session)).toEqual([undefined, "s-plan"])
  })

  it("cuts runs out of an old transcript too, through the log's session join", () => {
    const turns = splitTurns(
      [...unstamped(1, "s-plan"), ...unstamped(2, "s-0")],
      [plan, returned(0, "s-0")],
    )

    expect(composerRuns(turns).map((r) => r.session)).toEqual(["s-plan"])
  })

  it("is empty for a trak whose composer has never run", () => {
    expect(composerRuns([])).toEqual([])
  })
})

describe("spokenBelow and withoutSpoken", () => {
  it("takes the log row a message bubble is already showing", () => {
    const spoken = spokenBelow([{ type: "message", text: "Say go and I will open the round." }])
    const entries = [
      tool("Read", "Read", "a.ts"),
      said("Say go and I will open the round."),
    ] as const

    expect(withoutSpoken(entries, spoken)).toEqual([tool("Read", "Read", "a.ts")])
  })

  it("ignores the whitespace around it, which is where the two copies differ", () => {
    const spoken = spokenBelow([{ type: "message", text: "one answer" }])
    expect(withoutSpoken([said("one answer\n")], spoken)).toEqual([])
  })

  it("keeps prose no card below is drawing — the narration between two tool calls", () => {
    const spoken = spokenBelow([{ type: "message", text: "the answer" }])
    const narration = said("Now I will read the other half of the file.")

    expect(withoutSpoken([narration], spoken)).toEqual([narration])
  })

  it("holds nothing for an output that is not prose — only `message` carries any", () => {
    // An artifact's `Text` entry is the fenced JSON, a different string from anything the
    // card shows. `withoutEnvelopes` is what takes that one out.
    const spoken = spokenBelow([{ type: "artifact", sections: { Summary: "done" } }])
    expect(spoken.size).toBe(0)
  })

  it("takes what a composer run said, on the same rule as a step's", () => {
    const spoken = spokenBelow([
      { type: "proposal", title: "Add a client", steps: [] },
      { type: "message", text: "Because the drawer already holds the log." },
    ])

    expect(withoutSpoken([said("Because the drawer already holds the log.")], spoken)).toEqual([])
  })

  it("comes before `withoutEnvelopes`, so a conversational reply is still drawn exactly once", () => {
    // `converse` falls back to a `message` carrying the whole raw text, and the card below
    // draws that string. A fallback reports no envelope, so nothing here can break the
    // match — and the order still holds for a reply the agent did file as an envelope.
    const raw = "Ready when you are.\n\n" + JSON.stringify({ type: "message", text: "Ready" })
    const spoken = spokenBelow([{ type: "message", text: raw }])

    expect(withoutEnvelopes(withoutSpoken([said(raw)], spoken), new Set<string>())).toEqual([])
  })
})

describe("withoutFailure", () => {
  const DROPPED = "API Error: Connection closed mid-response. The response above may be incomplete."

  it("takes both rows a dropped connection arrives as", () => {
    // The complaint, exactly: the same sentence as an agent bubble and again as a quiet
    // `ApiError(…)` row, with the notice below about to say it a third time.
    const work = tool("Edit", "Edit", "dto.ts")
    const entries = [
      work,
      said(DROPPED),
      makeNote({ text: `ApiError(interrupted: ${DROPPED})` }),
    ] as const

    expect(withoutFailure(entries, DROPPED)).toEqual([work])
  })

  it("keeps the half-written reply the connection cut off", () => {
    // The agent's own words are work and are the reason the turn is worth reading. Only
    // the copy the notice is drawing goes.
    const partial = said("I have read the loader and am part-way through")
    expect(withoutFailure([partial, said(DROPPED)], DROPPED)).toEqual([partial])
  })

  it("draws both rows again where no notice is saying it", () => {
    // A failure a restart has moved past has no notice, so nothing is superseding these
    // — and a transcript with a hole where the error was reads as a turn that stopped
    // for no reason.
    const entries = [said(DROPPED), makeNote({ text: `ApiError(interrupted: ${DROPPED})` })]
    expect(withoutFailure(entries, undefined)).toEqual(entries)
  })

  it("leaves another turn's ApiError row alone", () => {
    // Matched by text rather than by shape: a position that failed, was restarted and
    // failed differently holds two, and only the current one is being said below.
    const older = makeNote({
      text: "ApiError(rate_limit: Credit balance is too low)",
    })
    expect(withoutFailure([older], DROPPED)).toEqual([older])
  })
})
