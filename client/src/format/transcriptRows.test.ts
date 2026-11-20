/**
 * Tier 1: a turn's entries as the rows the live log draws, with no React and no fetch.
 *
 * What is asserted is where a row starts and stops — a call's outcome folding back onto
 * the run it answers, a delegation's lines gathered under its card, a pause kept only at
 * the live end — and the one line the trak row takes from the last of them.
 */

import { describe, expect, it } from "vitest"
import type { NoteEntryDto, ToolEntryDto, TranscriptEntryDto } from "../api/types"
import {
  makeApiRetry,
  makeBackground,
  makeBackgroundStarted,
  makeNote,
  makeSession,
  makeSpawned,
  makeSubagent,
  makeSubagentResult,
  makeText,
  makeTool,
  makeViewEntry,
  makeCheckEntry,
  makeHook,
  makeDenied,
} from "../fixtures"
import {
  lateFrom,
  latestActivity,
  groupCalls,
  groupEntries,
  groupFailures,
  groupRuns,
  isChecked,
  isDelegation,
  isJob,
  isViewed,
  jobOutcome,
  pauseRetry,
  pauseText,
  runningSince,
  withoutEndedPauses,
  withoutEnvelopes,
  workOnly,
  type Delegation,
  type Job,
} from "./transcriptRows"

const tool = (name: string, kind: ToolEntryDto["kind"], detail?: string): ToolEntryDto =>
  makeTool({ name, kind, ...(detail === undefined ? {} : { detail }) })

/** The agent's own words, as the provider records them. */
const said = (text: string): TranscriptEntryDto => makeText({ text })

/** The head of a delegation, as `system/task_started` records one. */
const head = (call: string, description = "review the round"): TranscriptEntryDto =>
  makeSubagent({ call, agentType: "general-purpose", description })

/** What it answered, as `system/task_notification` records it. */
const answered = (call: string, summary?: string): TranscriptEntryDto =>
  makeSubagentResult({ call, ...(summary === undefined ? {} : { summary }) })

/** The same line, written inside a delegation rather than by the agent itself. */
const inside = (call: string, entry: ToolEntryDto | NoteEntryDto): TranscriptEntryDto => ({
  ...entry,
  parent: call,
})

/**
 * A kind nobody has written a reason for, which is the one that still reaches these
 * functions: `workOnly` takes out the kinds `test/smoke/known-kinds.json` catalogues, and
 * everything else the provider does not model arrives here as a note and draws a row.
 */
const uncatalogued = (kind: string): NoteEntryDto => makeNote({ text: `Unknown(${kind})` })

const only = (entries: readonly TranscriptEntryDto[]): readonly Delegation[] =>
  groupEntries(entries).filter(isDelegation)

/** The runs a turn drew, without the cards standing between them. */
const withoutCards = (
  entries: readonly TranscriptEntryDto[],
): readonly (readonly TranscriptEntryDto[])[] =>
  groupEntries(entries).flatMap((group) =>
    isDelegation(group) || isJob(group) || isViewed(group) || isChecked(group) ? [] : [group],
  )

/** How the entries fell into groups, which is the whole of what `groupRuns` decides. */
const sizes = (entries: readonly TranscriptEntryDto[]): readonly number[] =>
  groupRuns(entries).map((g) => g.length)

describe("groupEntries", () => {
  it("gathers a run of one activity and keeps every call in it", () => {
    const reads = [
      tool("Read", "Read", "a.ts"),
      tool("Read", "Read", "b.ts"),
      tool("Read", "Read", "c.ts"),
      tool("Read", "Read", "d.ts"),
    ]
    expect(groupEntries(reads)).toEqual([reads])
  })

  it("takes a run of mixed kinds, because an agent interleaves and the row can say so", () => {
    expect(
      sizes([
        tool("Edit", "Edit", "a.ts"),
        tool("Read", "Read", "b.ts"),
        tool("Edit", "Edit", "c.ts"),
      ]),
    ).toEqual([3])
  })

  it("leaves everything that is not a tool call on its own row", () => {
    expect(
      sizes([
        makeNote({ text: "Result(20 chars)" }),
        makeNote({ text: "ApiError(auth)" }),
        makeSpawned({ pid: 1 }),
      ]),
    ).toEqual([1, 1, 1])
  })

  it("closes the run behind anything that is not a call, so a turn's tail is not swept in", () => {
    expect(
      sizes([tool("Read", "Read", "a.ts"), makeSpawned({ pid: 1 }), tool("Read", "Read", "b.ts")]),
    ).toEqual([1, 1, 1])
  })

  it("has nothing to group in an empty turn", () => {
    expect(groupEntries([])).toEqual([])
  })

  /**
   * The shape a provider actually writes, and the reason this function was dead code.
   *
   * Every call is followed by its own `ToolResult`, so two `Tool` entries are never
   * adjacent — across both traks in `.orkestra/.database` that happens zero times in
   * fifteen calls. A rule requiring adjacency therefore never fired, and `Read ×4` could
   * not render however many files a step read.
   */
  it("groups calls separated by their own results, which is how a transcript arrives", () => {
    const ok = makeNote({ text: "ToolResult(ok)" })
    expect(
      sizes([
        tool("Read", "Read", "a.ts"),
        ok,
        tool("Read", "Read", "b.ts"),
        ok,
        tool("Read", "Read", "c.ts"),
        ok,
      ]),
    ).toEqual([6])
  })

  it("keeps a run through a change of kind, which is what a stretch of working is", () => {
    const ok = makeNote({ text: "ToolResult(ok)" })
    expect(sizes([tool("Read", "Read", "a.ts"), ok, tool("Edit", "Edit", "b.ts"), ok])).toEqual([4])
  })

  it("does not let a result start a group when no call precedes it", () => {
    // A clean one says nothing without the call it answers, so it is not drawn at all; a
    // failure is evidence and keeps its row wherever it landed.
    expect(sizes([makeNote({ text: "ToolResult(ok)" })])).toEqual([])
    expect(sizes([makeNote({ text: "ToolResult(error)" })])).toEqual([1])
  })

  /**
   * The pause is the boundary and the only one a working agent writes, so this is the case
   * the whole rule turns on — and it is a row between the two rather than a seam with
   * nothing in it. `ActivityRow` draws that row as `Thinking`'s dots.
   */
  it("cuts a run at a pause, and gives the pause a row between the halves", () => {
    const ok = makeNote({ text: "ToolResult(ok)" })
    expect(
      sizes([
        tool("Read", "Read", "a.ts"),
        ok,
        makeNote({ text: "Thinking" }),
        tool("Read", "Read", "b.ts"),
        ok,
      ]),
    ).toEqual([2, 1, 2])
  })

  it("does not let a pause open a run, so the call after it starts its own", () => {
    expect(sizes([makeNote({ text: "Thinking" }), tool("Read", "Read", "a.ts")])).toEqual([1, 1])
  })

  it("takes a run of pauses as one group, however many bursts the engine wrote", () => {
    // The later bursts ride in the group rather than being dropped, so a pause group's
    // row can be named by the latest summary — and it is still one row.
    const thinking = makeNote({ text: "Thinking" })
    expect(
      sizes([tool("Read", "Read", "a.ts"), thinking, thinking, thinking, tool("Edit", "Edit")]),
    ).toEqual([1, 3, 1])
  })

  it("keeps two pauses that had work between them, because they are two stops", () => {
    const thinking = makeNote({ text: "Thinking" })
    expect(sizes([thinking, tool("Read", "Read", "a.ts"), thinking, tool("Edit", "Edit")])).toEqual(
      [1, 1, 1, 1],
    )
  })

  it("folds two pauses carrying words into one group, holding both", () => {
    // A Codex reasoning item with two summary parts arrives as two lines back to back.
    // One row: the agent is thinking now, and `ActivityGroup` names it by the latest.
    const first = makeNote({
      text: "Thinking: Evaluating sparse matrix encoding options",
    })
    const second = makeNote({
      text: "Thinking: Comparing memory and lookup trade-offs",
    })
    expect(groupRuns([first, second, tool("Read", "Read", "a.ts")])).toEqual([
      [first, second],
      [tool("Read", "Read", "a.ts")],
    ])
  })
})

/** The summary a pause carries, read back off the line `eventLine` wrote. */
describe("pauseText", () => {
  it("reads the words after the prefix, and nothing off a bare pause", () => {
    expect(pauseText(makeNote({ text: "Thinking: Planning file size counting method" }))).toBe(
      "Planning file size counting method",
    )
    expect(pauseText(makeNote({ text: "Thinking" }))).toBeUndefined()
    expect(pauseText(makeNote({ text: "Thinking:  " }))).toBeUndefined()
  })

  it("says nothing of a note that is not a pause, or of a call", () => {
    expect(pauseText(makeNote({ text: "ToolResult(ok)" }))).toBeUndefined()
    expect(pauseText(tool("Read", "Read", "a.ts"))).toBeUndefined()
  })
})

/**
 * A result that landed away from the call it reports on.
 *
 * A pause, a delegation's card and a kind nobody catalogued all land between a call and its
 * result, and parallel calls report in whatever order they finish. Asking only whether the
 * *last* group was a run left the outcome opening a group there: `ToolResult(ok)` drawn as a
 * row of prose, no `1 failed` badge on the row that failed, and the command's own row
 * counting up as though nothing had answered it.
 *
 * The line standing between them here is an uncatalogued kind, because that is the one that
 * still arrives: `workOnly` takes the heartbeat and the task lines out before any of this
 * runs, which is separately what lets a run fold at all.
 */
describe("groupRuns — a result that landed away from its call", () => {
  const progress: NoteEntryDto = uncatalogued("system/some_new_kind")
  const changed: NoteEntryDto = uncatalogued("system/another_new_kind")

  it("folds it back onto its call across the line that landed between", () => {
    const groups = groupRuns([tool("Bash", "Bash", "pnpm verify"), progress, ok])

    // Two rows: the command, and the note where it landed — a kind nobody catalogued is
    // drawn on purpose, so this is the outcome folding back rather than the note going.
    expect(groups).toEqual([[tool("Bash", "Bash", "pnpm verify"), ok], [progress]])
    expect(runningSince(groups[0] ?? [])).toBeUndefined()
  })

  it("marks the call failed rather than saying so in a row of its own", () => {
    const groups = groupRuns([tool("Bash", "Bash", "pnpm verify"), changed, failed])

    expect(groupFailures(groups[0] ?? [])).toBe(1)
    expect(groups[1]).toEqual([changed])
  })

  it("does not let the note it folded past take the next call into the run", () => {
    // The note still closes the run for anything *new*: an outcome rejoining is one
    // direction, and a call after a boundary starting its own row is the other.
    expect(sizes([tool("Bash", "Bash", "a"), progress, ok, tool("Read", "Read", "b.ts")])).toEqual([
      2, 1, 1,
    ])
  })

  it("gives each result to the call that has been waiting longest", () => {
    // Two runs open at once — a backgrounded command, then a note, then a read — and
    // nothing on the wire says which result is which. Counted the way `runningSince`
    // counts, so the older run's is due first.
    const bg = tool("Bash", "Bash", "sleep 25 &")
    const read = tool("Read", "Read", "a.ts")

    expect(groupRuns([bg, changed, read, ok, ok])).toEqual([[bg, ok], [changed], [read, ok]])
  })

  it("drops a clean result nothing is waiting for, and keeps a failed one", () => {
    // Every call answered, so there is no call for either to belong to — and putting a
    // failure on a run that did not earn it is worse than a row. `ToolResult(ok)` alone
    // names no tool, no path and no time, so the row it would take says nothing at all.
    const thinking = makeNote({ text: "Thinking" })
    expect(sizes([tool("Read", "Read", "a.ts"), ok, thinking, ok])).toEqual([2, 1])
    expect(sizes([tool("Read", "Read", "a.ts"), ok, thinking, failed])).toEqual([2, 1, 1])
  })
})

describe("workOnly", () => {
  const ok = makeNote({ text: "ToolResult(ok)" })

  it("takes out the engine's bookkeeping, which outnumbers the work five to one", () => {
    const entries: TranscriptEntryDto[] = [
      makeSpawned({ pid: 1 }),
      makeSession({ id: "s-a" }),
      makeNote({ text: "RateLimit(ok, resets 2026-08-05T18:20:00.000Z)" }),
      tool("Read", "Read", "a.ts"),
      ok,
      makeNote({ text: "TextDelta(662 chars)" }),
      makeNote({ text: "Usage(23693 cached + 2 in, 1555 out, $0.15)" }),
      makeNote({ text: "Result(662 chars)" }),
    ]
    expect(workOnly(entries)).toEqual([tool("Read", "Read", "a.ts"), ok])
  })

  // A pause is not bookkeeping and this is not where it is dealt with: it survives to
  // `groupRuns`, which is what lets it separate two runs — and `withoutEndedPauses`, which is the
  // only thing that drops one and can only ask once the grouping has happened.
  it("keeps a pause, which is what lets it separate two runs later", () => {
    const thinking = makeNote({ text: "Thinking" })
    expect(workOnly([makeSpawned({ pid: 1 }), thinking, tool("Read", "Read", "a.ts")])).toEqual([
      thinking,
      tool("Read", "Read", "a.ts"),
    ])
  })

  it("keeps a call's own outcome, which is the only signal a failure has", () => {
    // `ToolResult` looks like bookkeeping and is not: `groupFailures` reads it, and
    // folding it away would silently drop every `exit 1` from the pane.
    expect(workOnly([makeNote({ text: "ToolResult(exit 1)" })])).toHaveLength(1)
  })

  it("keeps a note the engine wrote that is not one of the five", () => {
    const err: TranscriptEntryDto = makeNote({
      text: "ApiError(auth: no credentials)",
    })
    expect(workOnly([err])).toEqual([err])
  })

  it("takes out every kind known-kinds.json has already written a reason for", () => {
    // The kinds the catalogue answers, and the reason each carries nothing a row could say
    // is written there rather than restated here. Across the traks in `.orkestra/.database`
    // they are the most numerous lines in the file by a wide margin.
    const catalogued: TranscriptEntryDto[] = [
      makeNote({ text: "Unknown(tool_progress)" }),
      makeNote({ text: "Unknown(system/task_progress)" }),
      makeNote({ text: "Unknown(system/task_updated)" }),
      makeNote({ text: "Unknown(system/background_tasks_changed)" }),
      makeNote({ text: "Unknown(system/commands_changed)" }),
      makeNote({ text: "Unknown(system/code_change_published)" }),
      makeNote({ text: "Unknown(system/vcs_state_changed)" }),
      makeNote({ text: "Unknown(system/informational)" }),
      makeNote({ text: "Unknown(item.completed/error)" }),
    ]
    expect(workOnly(catalogued)).toEqual([])
  })

  it("keeps a kind nobody catalogued, which is what makes a new one visible", () => {
    // The tripwire, and the client half of what `pnpm smoke` enforces: a kind with no
    // reason written for it draws a row so that somebody notices it. Hiding every
    // `Unknown` would leave both halves silent.
    const novel = uncatalogued("system/nobody_wrote_a_reason")
    expect(workOnly([novel])).toEqual([novel])
  })

  it("keeps a delegation's own lines to the same rule as the parent's", () => {
    // One pass over the whole turn, before anything is nested — so a heartbeat written
    // inside a subagent goes for the same reason the parent's does.
    const beat = inside("toolu_1", makeNote({ text: "Unknown(tool_progress)" }))
    const work = inside("toolu_1", tool("Bash", "Bash", "echo hello"))
    expect(workOnly([beat, work])).toEqual([work])
  })
})

/**
 * An outcome that names no call, which is every one written before the provider carried
 * the id — so the cases below built on these are the ones the counted fallback answers.
 */
const ok: NoteEntryDto = makeNote({ text: "ToolResult(ok)" })
const failed: NoteEntryDto = makeNote({ text: "ToolResult(error)" })

/** The same, naming the call it answers — which is what every captured `tool_result` does. */
const okFor = (call: string): NoteEntryDto => makeNote({ text: "ToolResult(ok)", call })
const failedFor = (call: string): NoteEntryDto => makeNote({ text: "ToolResult(error)", call })

/**
 * The heartbeat's real cost, which is not the rows it takes.
 *
 * A `Note` is not a `Tool`, so every one ends the run behind it — and the CLI writes a
 * `system/task_progress` line in front of every call while a subagent is working. One
 * position of `bedbed16`'s transcript is twenty commands in that shape, which drew as
 * twenty `Ran 1 command` rows with twenty notes standing between them.
 */
describe("workOnly before groupEntries — the run that could not fold", () => {
  const beat = makeNote({ text: "Unknown(system/task_progress)" })
  const twenty: readonly TranscriptEntryDto[] = Array.from({ length: 20 }, (_, i) => [
    beat,
    tool("Bash", "Bash", `pnpm check ${String(i)}`),
    i === 6 || i === 15 ? failed : ok,
  ]).flat()

  it("draws a row per call while the heartbeats are still in", () => {
    expect(withoutCards(twenty)).toHaveLength(40)
  })

  it("folds the whole stretch into one run once they are out", () => {
    // What `groupRuns` exists for, and no change of its own: taking the notes out upstream
    // is the whole of it. The two failures ride in the group they belong to, so the one row
    // can say `2 failed` rather than the badge being lost with the rows it was split across.
    const groups = withoutCards(workOnly(twenty))

    expect(groups).toHaveLength(1)
    expect(groupCalls(groups[0] ?? [])).toHaveLength(20)
    expect(groupFailures(groups[0] ?? [])).toBe(2)
  })
})

describe("groupEntries — delegations", () => {
  it("gathers the subagent's own lines under the call that asked for them", () => {
    const entries = [
      tool("Read", "Read", "a.ts"),
      { ...tool("Agent", "Task", "general-purpose"), call: "toolu_1" },
      head("toolu_1"),
      inside("toolu_1", tool("Bash", "Bash", "echo hello")),
      inside("toolu_1", ok),
      answered("toolu_1", "It printed hello."),
      okFor("toolu_1"),
      tool("Edit", "Edit", "b.ts"),
    ]

    // The parent's own rows above and below are untouched, and everything the subagent
    // did is in one group rather than scattered among them.
    const groups = groupEntries(entries)
    expect(groups).toHaveLength(3)
    expect(groups[0]).toEqual([tool("Read", "Read", "a.ts")])
    expect(groups[2]).toEqual([tool("Edit", "Edit", "b.ts")])
    expect(only(entries)).toEqual([
      {
        head: head("toolu_1"),
        result: answered("toolu_1", "It printed hello."),
        ok: true,
        backgrounded: false,
        entries: [inside("toolu_1", tool("Bash", "Bash", "echo hello")), inside("toolu_1", ok)],
      },
    ])
  })

  it("draws the delegation once, not beside the Agent call that opened it", () => {
    // Both would otherwise render: the job, and `Agent general-purpose` saying less.
    const entries = [
      { ...tool("Agent", "Task", "general-purpose"), call: "toolu_1" },
      head("toolu_1", "Run echo hello"),
    ]
    expect(groupEntries(entries)).toHaveLength(1)
    expect(only(entries).map((d) => d.head.description)).toEqual(["Run echo hello"])
  })

  it("keeps two background subagents apart, though the stream interleaves them", () => {
    // The whole reason the join is an id and not arrival order.
    const entries = [
      head("toolu_a", "read the log"),
      head("toolu_b", "run the tests"),
      inside("toolu_a", tool("Read", "Read", "a.ts")),
      inside("toolu_b", tool("Bash", "Bash", "pnpm test")),
      inside("toolu_a", tool("Read", "Read", "b.ts")),
      answered("toolu_b"),
      answered("toolu_a"),
      // Both answers land, then both of the Agent calls' own outcomes — in the other order,
      // which is a fact each of them names rather than one their arrival has to encode.
      okFor("toolu_a"),
      okFor("toolu_b"),
    ]
    const delegations = only(entries)

    expect(groupEntries(entries)).toHaveLength(2)
    expect(delegations.map((d) => d.head.description)).toEqual(["read the log", "run the tests"])
    expect(delegations[0]?.entries).toEqual([
      inside("toolu_a", tool("Read", "Read", "a.ts")),
      inside("toolu_a", tool("Read", "Read", "b.ts")),
    ])
    expect(delegations[1]?.entries).toEqual([inside("toolu_b", tool("Bash", "Bash", "pnpm test"))])
  })

  it("leaves a line whose parent names no delegation where it is", () => {
    // Every line of every transcript written before the id existed, and also a subagent
    // whose opening line never landed. Both read as the agent's own work, as before.
    const orphan = inside("toolu_gone", tool("Read", "Read", "a.ts"))
    expect(groupEntries([orphan])).toEqual([[orphan]])
    expect(groupEntries([tool("Read", "Read", "a.ts")])).toEqual([[tool("Read", "Read", "a.ts")]])
  })
})

/** What the parent's own `ToolResult` says about the delegation it answers, and when. */
describe("groupEntries — a delegation's outcome", () => {
  it("drops the delegation's own outcome, which its answer already carries", () => {
    // `SubagentResult` says whether it worked and what it said; the `ToolResult` right
    // behind it would be a bare `ToolResult(ok)` row in the parent's list saying less.
    const entries = [head("toolu_1"), answered("toolu_1"), okFor("toolu_1")]
    expect(groupEntries(entries)).toHaveLength(1)
    expect(only(entries).map((d) => d.ok)).toEqual([true])
  })

  it("never reads an outcome that names no call as a delegation's", () => {
    // Every entry written before the id was carried. Nothing joins one to the `Agent` call,
    // so no card is marked failed on the strength of a note that named nothing — the
    // conservative direction, and the failure keeps a row of its own instead.
    const clean = [head("toolu_1"), answered("toolu_1"), ok]
    const broken = [head("toolu_1"), answered("toolu_1"), failed]

    expect(only(clean).map((d) => d.ok)).toEqual([true])
    expect(only(broken).map((d) => d.ok)).toEqual([true])
    expect(groupEntries(broken)).toContainEqual([failed])
  })

  it("fails a delegation on the outcome the parent saw, not on the status it guessed", () => {
    // `answered` is `ok: true` because the status was not the one spelling this codebase
    // compares against — the only thing that actually observed the failure is the
    // `is_error` behind the note, and dropping it would leave nothing saying so.
    const entries = [head("toolu_1"), answered("toolu_1"), failedFor("toolu_1")]
    expect(groupEntries(entries)).toHaveLength(1)
    expect(only(entries).map((d) => d.ok)).toEqual([false])
  })

  it("still reads the outcome across the lines that landed between them", () => {
    // Two kinds nobody catalogued, which is what still reaches here — the ones that used to
    // sit in the middle of every delegation are taken out by `workOnly` first. One is placed
    // before the answer and one after, because the ordering is the provider's to change and
    // nothing about where a note landed may decide whose outcome comes next.
    const progress: NoteEntryDto = uncatalogued("system/some_new_kind")
    const updated: NoteEntryDto = uncatalogued("system/another_new_kind")
    const entries: TranscriptEntryDto[] = [
      { ...tool("Agent", "Task", "general-purpose"), call: "toolu_01Df" },
      head("toolu_01Df", "Run echo hello and report output"),
      makeText({ text: "Running it now.", parent: "toolu_01Df" }),
      inside("toolu_01Df", tool("Bash", "Bash", "echo hello")),
      inside("toolu_01Df", ok),
      progress,
      answered("toolu_01Df", "It printed `hello`."),
      updated,
      failedFor("toolu_01Df"),
    ]

    expect(only(entries).map((d) => d.ok)).toEqual([false])
    // The two notes are still rows — nobody has written a reason for either, and hiding
    // one of those is how a new kind goes unnoticed — and the outcome is not, because it
    // was read.
    const groups = groupEntries(entries)
    expect(groups).toHaveLength(3)
    expect(groups.slice(1)).toEqual([[progress], [updated]])
  })

  it("fails the delegation the outcome names, with a second one waiting beside it", () => {
    // Two waiting at once, which is the case a count cannot answer at all: it either
    // blames the one that has been waiting longest or leaves a real failure unread. The
    // note says which, so neither is necessary.
    const entries = [
      head("toolu_a", "read the log"),
      head("toolu_b", "run the tests"),
      answered("toolu_a"),
      answered("toolu_b"),
      failedFor("toolu_b"),
      okFor("toolu_a"),
    ]
    expect(only(entries).map((d) => d.ok)).toEqual([true, false])
    expect(groupEntries(entries)).toHaveLength(2)
  })
})

/**
 * The `tool_result` a backgrounded launch gets straight back — the `Agent` call being
 * acknowledged rather than anything said about the delegation.
 *
 * It drew as a bare `ToolResult(ok)` row directly under the card until it was read here,
 * on the one case the card exists for: `answered` catches the outcome that lands *after*
 * an answer, which is the inline ordering, and a background launch is the other one.
 */
describe("groupEntries — a launch acknowledgement", () => {
  const opener = (call: string): TranscriptEntryDto => ({
    ...tool("Agent", "Task", "general-purpose"),
    call,
    backgrounded: true,
  })

  it("drops the outcome that lands on the head, which is what a background launch gets", () => {
    // `task_started`, then *async agent launched successfully*, then the parent goes back
    // to work — and the answer arrives much later with no outcome behind it at all.
    const entries = [
      opener("toolu_1"),
      head("toolu_1"),
      okFor("toolu_1"),
      tool("Read", "Read", "a.ts"),
      ok,
      answered("toolu_1", "It printed hello."),
    ]

    const groups = groupEntries(entries)
    expect(groups).toHaveLength(2)
    expect(groups[1]).toEqual([tool("Read", "Read", "a.ts"), ok])
    expect(only(entries).map((d) => d.ok)).toEqual([true])
  })

  it("still reads it across a line that landed around a launch", () => {
    // A kind nobody catalogued, standing between the head and its acknowledgement: the
    // ordering is the provider's to change, and nothing about where a note landed may
    // decide whose outcome the next one is.
    const changed: NoteEntryDto = uncatalogued("system/some_new_kind")
    const entries = [opener("toolu_1"), head("toolu_1"), changed, okFor("toolu_1")]

    expect(groupEntries(entries)).toHaveLength(2)
    expect(groupEntries(entries)[1]).toEqual([changed])
  })

  it("matches each acknowledgement to the launch it names, in whichever order they land", () => {
    // Two `Agent` calls in one message: both heads, then both acknowledgements, and the
    // second launched is acknowledged first. Neither is a row.
    const entries = [
      opener("toolu_a"),
      opener("toolu_b"),
      head("toolu_a", "read the log"),
      head("toolu_b", "run the tests"),
      okFor("toolu_b"),
      okFor("toolu_a"),
    ]

    expect(groupEntries(entries)).toHaveLength(2)
  })

  it("fails a delegation whose launch came back an error, rather than a row beside it", () => {
    // The only thing that observed it: there is no answer coming, so a card left open with
    // an error row beside it would say less than the card saying `failed`.
    const entries = [opener("toolu_1"), head("toolu_1"), failedFor("toolu_1")]

    expect(groupEntries(entries)).toHaveLength(1)
    expect(only(entries).map((d) => d.ok)).toEqual([false])
  })

  /**
   * The answer to a launch already acknowledged, which is the ordinary shape of background
   * work: the parent goes on calling tools, and the delegation reports whenever it finishes.
   *
   * A delegation is owed one outcome and a backgrounded one spent it at the head, so an
   * answer must add nothing — and here the outcomes name their calls, so nothing has to
   * infer that from the order they arrived in.
   */
  it("does not let an answer claim the acknowledgement its launch already spent", () => {
    const entries = [
      opener("toolu_1"),
      head("toolu_1"),
      okFor("toolu_1"),
      tool("Bash", "Bash", "pnpm verify"),
      answered("toolu_1", "It printed hello."),
      ok,
    ]

    // The command keeps its own outcome, so nothing goes on counting up on a finished call.
    expect(withoutCards(entries)).toEqual([[tool("Bash", "Bash", "pnpm verify"), ok]])
    expect(only(entries).map((d) => d.ok)).toEqual([true])
  })

  it("leaves a command's failure on the command, not on the delegation beside it", () => {
    const entries = [
      opener("toolu_1"),
      head("toolu_1"),
      okFor("toolu_1"),
      tool("Bash", "Bash", "pnpm verify"),
      answered("toolu_1", "It printed hello."),
      failed,
    ]

    expect(groupFailures(withoutCards(entries)[0] ?? [])).toBe(1)
    expect(only(entries).map((d) => d.ok)).toEqual([true])
  })

  it("keeps two answering background delegations off the parent's open calls", () => {
    const entries = [
      opener("toolu_a"),
      opener("toolu_b"),
      head("toolu_a", "read the log"),
      head("toolu_b", "run the tests"),
      okFor("toolu_a"),
      okFor("toolu_b"),
      tool("Bash", "Bash", "pnpm verify"),
      answered("toolu_a"),
      answered("toolu_b"),
      ok,
    ]

    expect(groupEntries(entries)).toHaveLength(3)
    expect(withoutCards(entries)).toEqual([[tool("Bash", "Bash", "pnpm verify"), ok]])
    expect(only(entries).map((d) => d.ok)).toEqual([true, true])
  })

  it("leaves the parent's own outcome alone once it has gone back to work", () => {
    // The next failing command in the turn keeps its failure: the acknowledgement was the
    // delegation's because it named it, not because it came first.
    const entries = [
      opener("toolu_1"),
      head("toolu_1"),
      okFor("toolu_1"),
      tool("Bash", "Bash", "pnpm verify"),
      failed,
    ]

    expect(groupEntries(entries)[1]).toEqual([tool("Bash", "Bash", "pnpm verify"), failed])
    expect(only(entries).map((d) => d.ok)).toEqual([undefined])
  })
})

/**
 * An `Agent` issued in the same assistant message as another tool, which is the ordinary
 * way this repository's own agents call things: the head lands while a parent call is
 * already open, and the two outcomes come back in whichever order the work finished in.
 *
 * **The case a queue filled at the head cannot answer**, and all three of the symptoms this
 * treatment exists to remove arrive together on it — the command loses its `1 failed`, its
 * row counts up forever, and the delegation's own acknowledgement draws as a bare row under
 * the card. Each outcome names its call, so none of the orderings below is a special case.
 */
describe("groupEntries — a delegation opened beside another call", () => {
  const command: ToolEntryDto = {
    ...tool("Bash", "Bash", "pnpm verify"),
    call: "toolu_bash",
  }
  const opener = (backgrounded: boolean): TranscriptEntryDto => ({
    ...tool("Agent", "Task", "general-purpose"),
    call: "toolu_agent",
    backgrounded,
  })

  it.each([
    ["inline", false],
    ["backgrounded", true],
  ])("keeps a %s delegation off the failure of the call it was issued beside", (_, detached) => {
    const entries = [
      command,
      opener(detached),
      head("toolu_agent"),
      failedFor("toolu_bash"),
      answered("toolu_agent"),
      okFor("toolu_agent"),
    ]

    const run = withoutCards(entries)[0] ?? []
    expect(run).toEqual([command, failedFor("toolu_bash")])
    expect(groupFailures(run)).toBe(1)
    // The command has been answered, so nothing counts up on it — the third symptom.
    expect(runningSince(run)).toBeUndefined()
    expect(only(entries).map((d) => d.ok)).toEqual([true])
  })

  it("keeps the card clean when its acknowledgement lands before the failure beside it", () => {
    // The backgrounded ordering: the launch is acknowledged at once, and the command it was
    // issued beside fails afterwards. Taking the first outcome to arrive drew the card
    // failed for a failure that was the command's.
    const entries = [
      command,
      opener(true),
      head("toolu_agent"),
      okFor("toolu_agent"),
      failedFor("toolu_bash"),
      answered("toolu_agent"),
    ]

    expect(groupFailures(withoutCards(entries)[0] ?? [])).toBe(1)
    expect(only(entries).map((d) => d.ok)).toEqual([true])
  })

  it("draws no row for the acknowledgement, wherever the parent's own outcome landed", () => {
    // The bare `ToolResult(ok)` the request pasted. Two orders, one for each of the outcomes
    // arriving first, and neither leaves a row of its own behind the card.
    const first = [
      command,
      opener(true),
      head("toolu_agent"),
      okFor("toolu_agent"),
      okFor("toolu_bash"),
    ]
    const second = [
      command,
      opener(true),
      head("toolu_agent"),
      okFor("toolu_bash"),
      okFor("toolu_agent"),
    ]

    expect(withoutCards(first)).toEqual([[command, okFor("toolu_bash")]])
    expect(withoutCards(second)).toEqual([[command, okFor("toolu_bash")]])
  })

  it("gives a failure to whichever of two open calls it names", () => {
    // A second command in the same run, and a delegation outstanding beside both. The badge
    // belongs to the call that failed rather than to the one that has been waiting longest.
    const other: ToolEntryDto = {
      ...tool("Bash", "Bash", "pnpm test"),
      call: "toolu_test",
    }
    const entries = [
      command,
      other,
      opener(true),
      head("toolu_agent"),
      okFor("toolu_agent"),
      okFor("toolu_bash"),
      failedFor("toolu_test"),
    ]

    const run = withoutCards(entries)[0] ?? []
    expect(run).toEqual([command, other, okFor("toolu_bash"), failedFor("toolu_test")])
    expect(groupFailures(run)).toBe(1)
  })
})

/** How a delegation was started, which only the call that opened it says. */
describe("groupEntries — a detached delegation", () => {
  const opener = (call: string, backgrounded?: boolean): TranscriptEntryDto => ({
    ...tool("Agent", "Task", "general-purpose"),
    call,
    ...(backgrounded === undefined ? {} : { backgrounded }),
  })

  it("reads detachment off the call that opened it, not off the head", () => {
    // `run_in_background` is on the `Tool` entry because a shell command takes the same
    // key. `nest` drops that entry, so this is the one chance anything has to keep it.
    expect(only([opener("toolu_1", true), head("toolu_1")]).map((d) => d.backgrounded)).toEqual([
      true,
    ])
  })

  it("keeps it across the work that separates the two halves", () => {
    // Which is the shape a background delegation has by definition: the parent went on
    // working between framing the call and the task registering.
    const entries = [opener("toolu_1", true), tool("Read", "Read", "a.ts"), ok, head("toolu_1")]
    expect(only(entries).map((d) => d.backgrounded)).toEqual([true])
  })

  it("reads a delegation as inline unless something says otherwise", () => {
    // Three ways the field can be missing, and none of them is evidence of detachment:
    // an opener that said nothing, an old transcript, and a head with no opener at all.
    expect(only([opener("toolu_1"), head("toolu_1")]).map((d) => d.backgrounded)).toEqual([false])
    expect(only([opener("toolu_1", false), head("toolu_1")]).map((d) => d.backgrounded)).toEqual([
      false,
    ])
    expect(only([head("toolu_1")]).map((d) => d.backgrounded)).toEqual([false])
  })
})

/**
 * The answer that names no delegation, which is a `task_notification` for something that
 * was never one — 309 of 317 observed bookends are a slow shell command.
 */
describe("groupEntries — an unmatched answer", () => {
  it("drops it rather than drawing *A subagent answered* beside every slow command", () => {
    const entries = [tool("Bash", "Bash", "pnpm verify"), ok, answered("toolu_task")]

    expect(groupEntries(entries)).toEqual([[tool("Bash", "Bash", "pnpm verify"), ok]])
  })

  it("stands between a delegation and its outcome without being read as either", () => {
    // The engine reporting a shell task finished, in the middle of a delegation's own two
    // lines. It names a task nothing opened, so it is dropped — and the failure behind it
    // still reaches the delegation it names.
    const entries = [
      head("toolu_1"),
      answered("toolu_1"),
      answered("toolu_task"),
      failedFor("toolu_1"),
    ]

    expect(only(entries).map((d) => d.ok)).toEqual([false])
    expect(groupEntries(entries)).toHaveLength(1)
  })
})

/** A backgrounded shell call, as the engine writes one now. */
const detachedTool = (call: string, command: string): ToolEntryDto =>
  makeTool({
    name: "Bash",
    kind: "Bash",
    detail: command,
    call,
    backgrounded: true,
  })

/** A task's report with the fields a current engine carries. */
const reported = (
  call: string,
  taskId: string,
  outcome: "completed" | "failed" | "stopped",
): ReturnType<typeof makeSubagentResult> =>
  makeSubagentResult({ call, taskId, outcome, ok: outcome !== "failed" })

const jobs = (entries: readonly TranscriptEntryDto[]): readonly Job[] =>
  groupEntries(entries).filter(isJob)

/** A level naming the tasks alive at that moment — empty is the set going quiet. */
const level = (...ids: string[]): TranscriptEntryDto =>
  makeBackground({ tasks: ids.map((id) => ({ id })) })

/** The join a current engine writes the moment a task goes outstanding. */
const started = (taskId: string, call: string, description?: string): TranscriptEntryDto =>
  makeBackgroundStarted({
    taskId,
    call,
    ...(description === undefined ? {} : { description }),
  })

/**
 * A backgrounded shell command, drawn as a card the way a delegation is — and told from
 * the inline slow command that registers a task exactly like it. The stored fixtures
 * hold both shapes: `background-work.captured.jsonl` levels its tasks and
 * `slow-command.captured.jsonl` never emits a level at all.
 */
describe("groupEntries — background jobs", () => {
  it("draws a backgrounded call as a card, and lands its completion on it", () => {
    // The current engine's shape: the level, the join, the call, its acknowledgement,
    // other work, and the report minutes later. The completion is drawn when it lands —
    // on the card, not as a row of its own — and the acknowledgement says nothing.
    const entries = [
      detachedTool("toolu_bg", "pnpm verify"),
      level("t1"),
      started("t1", "toolu_bg", "Run the whole gate"),
      okFor("toolu_bg"),
      tool("Read", "Read", "a.ts"),
      ok,
      reported("toolu_bg", "t1", "completed"),
    ]
    expect(jobs(entries)).toEqual([
      {
        head: detachedTool("toolu_bg", "pnpm verify"),
        report: reported("toolu_bg", "t1", "completed"),
        ok: true,
        description: "Run the whole gate",
        taskId: "t1",
      },
    ])
    // The card closed the run behind it, and the read after it folded on its own.
    expect(withoutCards(entries)).toEqual([[tool("Read", "Read", "a.ts"), ok]])
  })

  it("joins a levelled task back to its call where the join entry never existed", () => {
    // `background-work.captured.jsonl` predates `BackgroundStarted`: the call says
    // `run_in_background`, the levels name the task, and the report carries both ids.
    const entries = [
      detachedTool("toolu_bg", "sleep 25 && echo bg-done"),
      level("t1"),
      okFor("toolu_bg"),
      level(),
      reported("toolu_bg", "t1", "completed"),
    ]
    expect(jobs(entries).map((j) => j.report?.taskId)).toEqual(["t1"])
  })

  it("leaves an inline slow command in its run, and drops its report", () => {
    // `slow-command.captured.jsonl`'s shape: a task registered, no level anywhere. The
    // report must not draw — every `pnpm verify` writes one — and the call folds into
    // its run exactly as before background work was modelled.
    const entries = [
      tool("Bash", "Bash", "python3 -c 'sleep'"),
      makeSubagentResult({
        call: "call-1",
        taskId: "t9",
        outcome: "completed",
      }),
      ok,
    ]
    expect(jobs(entries)).toEqual([])
    expect(withoutCards(entries)).toEqual([[tool("Bash", "Bash", "python3 -c 'sleep'"), ok]])
  })

  it("draws a card per job, however many a turn backgrounds at once", () => {
    // The round settled it: no fold, ten cards as readily as two.
    const entries = [
      detachedTool("toolu_a", "pnpm vitest run src"),
      detachedTool("toolu_b", "pnpm vitest run shared"),
      detachedTool("toolu_c", "pnpm lint"),
    ]
    expect(jobs(entries)).toHaveLength(3)
    expect(withoutCards(entries)).toEqual([])
  })

  it("keeps a backgrounded delegation as one delegation card, never a job as well", () => {
    // The join is written for a backgrounded subagent too — `Subagent` carries no task
    // id — and the `Agent` call it names is the delegation's opener, already dropped for
    // the card that says strictly more.
    const entries = [
      {
        ...tool("Agent", "Task", "general-purpose"),
        call: "toolu_1",
        backgrounded: true,
      },
      started("t1", "toolu_1"),
      head("toolu_1"),
      answered("toolu_1"),
    ]
    expect(jobs(entries)).toEqual([])
    expect(only(entries)).toHaveLength(1)
  })

  it("draws no row for the level or the join, which are state rather than work", () => {
    // The live list at the input bar is the level's surface; the transcript keeps no
    // frozen record of what a turn ended with.
    expect(groupEntries([level("t1"), started("t1", "toolu_bg")])).toEqual([])
  })

  it("puts a failed launch on the card, which is the only verdict it will ever get", () => {
    const entries = [detachedTool("toolu_bg", "pnpm verify"), failedFor("toolu_bg")]
    expect(jobs(entries).map((j) => j.ok)).toEqual([false])
  })
})

describe("jobOutcome — the word a job's card ends on", () => {
  const bare = (over: Partial<Job>): Job => ({
    head: detachedTool("toolu_bg", "pnpm verify"),
    report: undefined,
    ok: undefined,
    description: undefined,
    taskId: undefined,
    ...over,
  })
  const withReport = (outcome: "completed" | "failed" | "stopped"): Job =>
    bare({
      report: reported("toolu_bg", "t1", outcome),
      ok: outcome !== "failed",
    })

  it.each([
    ["completed", "completed"],
    ["failed", "failed"],
    // The reason the field exists: through `ok` alone a stopped job reads as a success,
    // and it must read as neither a success nor a failure.
    ["stopped", "stopped"],
  ] as const)("reads a report of %s as %s", (outcome, word) => {
    expect(jobOutcome(withReport(outcome))).toBe(word)
  })

  it("says nothing about a job no report ever closed", () => {
    // Still running on a live turn, and torn down without a word on a stored one —
    // either way, nothing observed an ending and the card must not invent one.
    expect(jobOutcome(bare({}))).toBeUndefined()
  })

  it("reads a failed launch as failed, with no report to say so", () => {
    expect(jobOutcome(bare({ ok: false }))).toBe("failed")
  })
})

const retry = (attempt: number): TranscriptEntryDto => makeApiRetry({ attempt, of: 5 })

/** The provider retrying, which belongs to the pause it interrupted. */
describe("groupRuns and pauseRetry — a retry", () => {
  const thinking: NoteEntryDto = makeNote({ text: "Thinking" })

  it("joins the pause it interrupted rather than taking a row", () => {
    expect(sizes([thinking, retry(2), tool("Read", "Read", "a.ts")])).toEqual([2, 1])
  })

  it("reads back as the most recent attempt, which supersedes the ones before it", () => {
    const group = groupRuns([thinking, retry(2), retry(3)])[0] ?? []

    expect(pauseRetry(group)?.attempt).toBe(3)
  })

  it("does not open a run, so the call after it starts one", () => {
    expect(
      sizes([thinking, retry(2), tool("Read", "Read", "a.ts"), tool("Read", "Read", "b.ts")]),
    ).toEqual([2, 2])
  })

  it("keeps a row of its own where no pause came before it", () => {
    // Nothing folds it away: a retry a reader cannot see at all is the worse failure.
    expect(sizes([tool("Read", "Read", "a.ts"), retry(2)])).toEqual([1, 1])
    expect(pauseRetry([retry(2)])).toBeUndefined()
  })

  it("says nothing about a group holding work", () => {
    expect(pauseRetry([tool("Read", "Read", "a.ts")])).toBeUndefined()
  })
})

/**
 * Which pause is still happening, which is the only one worth animating.
 *
 * Every other filter in this file drops an entry by what it *is*. This one asks where the
 * row landed and takes a fact the rows cannot see — whether anything is still driving the
 * turn — so both halves are asserted here rather than inferred from a rendered log.
 */
describe("withoutEndedPauses", () => {
  const thinking: NoteEntryDto = makeNote({ text: "Thinking" })
  const read = tool("Read", "Read", "a.ts")
  const edit = tool("Edit", "Edit", "b.ts")

  it("keeps the pause a live turn ended on", () => {
    expect(withoutEndedPauses(groupRuns([read, thinking]), true)).toEqual([[read], [thinking]])
  })

  it("drops a pause with work after it, though the turn is still going", () => {
    // The wait ended the moment the next call was made, and the dots claim otherwise.
    expect(withoutEndedPauses(groupRuns([thinking, read]), true)).toEqual([[read]])
  })

  it("drops the last pause of a turn nothing is driving, which is a wait that is over", () => {
    // The same argument `runningSince` is asked under: a turn that died stopped thinking
    // when it died, and dots animating on it are the confident wrong fact.
    expect(withoutEndedPauses(groupRuns([read, thinking]), false)).toEqual([[read]])
  })

  it("keeps a pause the provider retried during wherever it sits", () => {
    // The only visible account of the retry: `groupRuns` folded the `ApiRetry` into the
    // pause, so dropping the row drops the words with it and nothing else draws them.
    const paused = [thinking, retry(2)]
    expect(withoutEndedPauses(groupRuns([...paused, read]), false)).toEqual([paused, [read]])
  })

  it("leaves a delegation's card standing, and the pause in front of it is still over", () => {
    const rows = withoutEndedPauses(
      groupEntries([thinking, head("toolu_1"), answered("toolu_1")]),
      true,
    )

    expect(rows).toHaveLength(1)
    expect(rows.filter(isDelegation)).toHaveLength(1)
  })

  it("leaves a turn with no pause in it exactly as it was", () => {
    const runs = groupRuns([read, edit])
    expect(withoutEndedPauses(runs, true)).toEqual(runs)
    expect(withoutEndedPauses(runs, false)).toEqual(runs)
  })

  it("leaves the stretches either side of a dropped pause adjacent, with nothing between", () => {
    // **Pinned so nothing quietly puts a marker back between them.** The pane spaces every
    // pair of rows by 8px, so anything standing in for the boundary is a second gap on top
    // of that — the one boundary in the log wider than the rest. The cost is on the record:
    // two stretches separated by a pause are indistinguishable from two that were not.
    expect(withoutEndedPauses(groupRuns([read, thinking, edit]), false)).toEqual([[read], [edit]])
  })

  it("drops a pause at either end of a turn, which separated nothing", () => {
    // `read` and `edit` are one run either way: nothing closes the stretch between them,
    // so what the pause is at the head or the foot of is a single row.
    expect(withoutEndedPauses(groupRuns([thinking, read, edit]), false)).toEqual([[read, edit]])
    expect(withoutEndedPauses(groupRuns([read, edit, thinking]), false)).toEqual([[read, edit]])
  })

  it("drops two pauses in a row as one, which `gather` has already folded together", () => {
    expect(withoutEndedPauses(groupRuns([read, thinking, thinking, edit]), false)).toEqual([
      [read],
      [edit],
    ])
  })

  it("drops a pause carrying the model's summary by the same rule — the words are the dots' name", () => {
    // A live explanation, not a log: the calls either side are the record, and a summary
    // for a wait that is over says nothing they do not.
    const thought = makeNote({
      text: "Thinking: Planning file size counting method",
    })
    expect(withoutEndedPauses(groupRuns([read, thought, edit]), true)).toEqual([[read], [edit]])
    expect(withoutEndedPauses(groupRuns([read, thought]), false)).toEqual([[read]])
    expect(withoutEndedPauses(groupRuns([read, thought]), true)).toEqual([[read], [thought]])
  })
})

/** Which call a run is waiting on, and whether it is waiting on one at all. */
describe("runningSince", () => {
  const at = (stamp: number, path: string): TranscriptEntryDto => ({
    ...tool("Read", "Read", path),
    at: stamp,
  })

  it("reports the call whose outcome has not arrived", () => {
    expect(runningSince([at(10, "a.ts"), ok, at(20, "b.ts")])).toBe(20)
  })

  it("reports the earliest of several open at once, which is the longer number", () => {
    // Nothing on the wire joins an outcome to the call it answers, so they are counted
    // rather than matched — and the one that explains the wait is the one waiting longest.
    expect(runningSince([at(10, "a.ts"), at(20, "b.ts"), ok])).toBe(20)
    expect(runningSince([at(10, "a.ts"), at(20, "b.ts")])).toBe(10)
  })

  it("says nothing about a run where every call was answered", () => {
    expect(runningSince([at(10, "a.ts"), ok, at(20, "b.ts"), ok])).toBeUndefined()
  })

  it("says nothing where the engine stamped no time, rather than a duration from 1970", () => {
    expect(runningSince([tool("Read", "Read", "a.ts")])).toBeUndefined()
  })

  it("says nothing about a group that holds no calls at all", () => {
    expect(runningSince([makeNote({ text: "Thinking" })])).toBeUndefined()
  })
})

describe("groupCalls and groupFailures", () => {
  // A second spelling of a failure, where `failed` above is the one the provider writes.
  const bad = makeNote({ text: "ToolResult(exit 1)" })

  it("counts the calls a group stands for, not the lines it holds", () => {
    const group = [tool("Read", "Read", "a.ts"), ok, tool("Read", "Read", "b.ts"), ok]
    expect(groupCalls(group)).toHaveLength(2)
  })

  it("counts only the results that came back non-zero", () => {
    const group = [tool("Bash", "Bash", "pnpm verify"), bad, tool("Bash", "Bash", "pnpm test"), ok]
    expect(groupFailures(group)).toBe(1)
  })

  it("reports no failures for a group nothing has reported on yet", () => {
    expect(groupFailures([tool("Read", "Read", "a.ts")])).toBe(0)
  })
})

/** What the turn reported writing — `EventDto.envelope`, the engine's own slice. */
const wrote = (...envelopes: string[]) => new Set(envelopes)

describe("withoutEnvelopes", () => {
  const artifact = JSON.stringify({
    type: "artifact",
    sections: { Summary: "done" },
  })
  const fenced = "```json\n" + artifact + "\n```"

  it("drops the row that held nothing but the envelope", () => {
    const entries = [tool("Read", "Read", "a.ts"), said(fenced)]
    expect(withoutEnvelopes(entries, wrote(fenced))).toEqual([tool("Read", "Read", "a.ts")])
  })

  it("keeps the prose the envelope was appended to, and only the prose", () => {
    const kept = withoutEnvelopes([said("Renamed the field.\n\n" + artifact)], wrote(artifact))
    expect(kept).toHaveLength(1)
    expect(kept[0]?._tag === "Text" ? kept[0].text.trim() : undefined).toBe("Renamed the field.")
  })

  it("leaves every entry that is not the agent's own words alone", () => {
    // A `Note` is the engine's own line and never an envelope, whatever it holds.
    const note = makeNote({ text: artifact })
    expect(withoutEnvelopes([note], wrote(artifact))).toEqual([note])
  })

  it("keeps a JSON example an agent pasted mid-turn", () => {
    // Nothing to subtract: an example is not what the turn filed, so no event reports it.
    const example = said('Add this to the config:\n\n```json\n{ "strict": true }\n```')
    expect(withoutEnvelopes([example], wrote(fenced))).toEqual([example])
  })

  it("takes the one of several envelopes that this entry holds", () => {
    // A position that filed twice has both on the log, and each row holds one of them.
    const first = JSON.stringify({ type: "questions", questions: [] })
    const kept = withoutEnvelopes([said("Second go.\n\n" + fenced)], wrote(first, fenced))
    expect(kept[0]?._tag === "Text" ? kept[0].text.trim() : undefined).toBe("Second go.")
  })

  it("leaves an entry whole when the turn reported no envelope", () => {
    // A turn that answered in prose, and one whose JSON never decoded: nothing was taken
    // out of the words the engine read, so nothing is taken out of the words drawn.
    const malformed = said('```json\n{ "type": "artifact", "sections": { "Summary": "do')
    expect(withoutEnvelopes([malformed], wrote())).toEqual([malformed])
  })
})

describe("latestActivity — the trak row's line", () => {
  // The row says what the live log's last row says, in the log's own words.
  it("names a run of calls the way the log's group row does", () => {
    const entries = [
      tool("Read", "Read", "a.ts"),
      tool("Read", "Read", "b.ts"),
      tool("Bash", "Bash"),
    ]
    expect(latestActivity(entries, undefined)).toBe("Read 2 files, and ran 1 command")
  })

  it("names a lone call by its count too", () => {
    expect(latestActivity([tool("Edit", "Edit", "a.ts")], undefined)).toBe("Edited 1 file")
  })

  it("says the agent is thinking at a live pause, by the model's name for it where there is one", () => {
    expect(latestActivity([tool("Read", "Read"), makeNote({ text: "Thinking" })], undefined)).toBe(
      "Thinking",
    )
    expect(latestActivity([makeNote({ text: "Thinking: Planning the split" })], undefined)).toBe(
      "Planning the split",
    )
  })

  it("draws the agent's words, and nothing once they were only the envelope", () => {
    const envelope = '```json\n{"type":"artifact"}\n```'
    expect(latestActivity([said("Now the mapper.")], undefined)).toBe("Now the mapper.")
    expect(latestActivity([said(envelope)], envelope)).toBeUndefined()
  })

  it("draws nothing for a turn that has only just started", () => {
    expect(latestActivity([makeSpawned({ pid: 1 }), makeSession({ id: "s" })], undefined)).toBe(
      undefined,
    )
  })

  it("names a delegation by the job it was given", () => {
    expect(latestActivity([head("t1"), inside("t1", tool("Read", "Read"))], undefined)).toBe(
      "Delegated review the round",
    )
  })
})

const lateText = (t: string): TranscriptEntryDto => ({ _tag: "Text", text: t })
const lateSaid = (t: string): TranscriptEntryDto => ({ _tag: "Said", text: t })
const RESULT: TranscriptEntryDto = { _tag: "Note", text: "Result(412 chars)" }

describe("lateFrom", () => {
  it("starts at the message a person sent after the answer, and takes the reply with it", () => {
    const entries = [
      lateText("the answer"),
      RESULT,
      lateSaid("and the capital?"),
      lateText("Paris"),
    ]
    expect(entries.slice(lateFrom(entries))).toEqual([
      lateSaid("and the capital?"),
      lateText("Paris"),
    ])
  })

  it("leaves a message read before the answer where it was read", () => {
    const entries = [lateSaid("keep --json"), lateText("the answer"), RESULT]
    expect(lateFrom(entries)).toBe(entries.length)
  })

  it("finds nothing late in a turn that has not answered", () => {
    const entries = [lateText("working"), lateSaid("keep --json")]
    expect(lateFrom(entries)).toBe(entries.length)
  })
})

const done = (call: string): NoteEntryDto => makeNote({ text: "ToolResult(ok)", call })

const checking = (call: string): ToolEntryDto =>
  makeTool({ kind: "Mcp", name: "mcp_tool_call", detail: "orkestra-trak/run_check", call })

describe("a call on the engine's check tool", () => {
  const read = makeTool({ call: "r1" })
  const grep = makeTool({ kind: "Grep", name: "Grep", call: "g1" })

  it("is a card of its own, joined to its newest line by the call's id", () => {
    const entries = [
      read,
      done("r1"),
      checking("toolu_1"),
      makeCheckEntry({ call: "toolu_1" }),
      makeCheckEntry({ call: "toolu_1", outcome: "passed" }),
      done("toolu_1"),
      grep,
      done("g1"),
    ]
    const rows = groupEntries(entries)
    expect(
      rows.map((row) => (isChecked(row) ? [row.call.call, row.checked.outcome] : "run")),
    ).toEqual(["run", ["toolu_1", "passed"], "run"])
    expect(withoutCards(entries).map((run) => run.length)).toEqual([2, 2])
  })

  it("pairs a line naming no call here with the oldest unpaired call on its tool, as Codex leaves them", () => {
    const entries = [
      checking("item_7"),
      makeCheckEntry({ call: "check-a", name: "verify" }),
      makeCheckEntry({ call: "check-a", name: "verify", outcome: "failed" }),
      checking("item_9"),
      makeCheckEntry({ call: "check-b", name: "verify" }),
    ]
    expect(
      groupEntries(entries).map((row) =>
        isChecked(row) ? [row.call.call, row.checked.call, row.checked.outcome] : "run",
      ),
    ).toEqual([
      ["item_7", "check-a", "failed"],
      ["item_9", "check-b", undefined],
    ])
  })

  it("names the check as the latest thing a turn did", () => {
    expect(latestActivity([checking("toolu_1"), makeCheckEntry()], undefined)).toBe(
      "orkestra-trak/run_check verify-light",
    )
  })
})

describe("a call that left a view", () => {
  const read = makeTool({ call: "r1" })
  const shown = makeTool({ kind: "Mcp", name: "mcp_tool_call", detail: "metrics/show", call: "v1" })
  const grep = makeTool({ kind: "Grep", name: "Grep", call: "g1" })
  // The view's line lands after its call's own outcome, and here after the next call too.
  const entries = [
    read,
    done("r1"),
    shown,
    done("v1"),
    grep,
    makeViewEntry({ call: "v1" }),
    done("g1"),
  ]

  it("is a row of its own that breaks the run, in neither run's count", () => {
    const rows = groupEntries(entries)
    expect(rows).toHaveLength(3)
    const [before, view, after] = rows
    expect(
      before !== undefined && !isViewed(before) && !isDelegation(before) && !isJob(before),
    ).toBe(true)
    expect(
      view !== undefined && isViewed(view) ? [view.view.call, view.call.call, view.ok] : [],
    ).toEqual(["v1", "v1", true])
    expect(withoutCards(entries).map((run) => run.length)).toEqual([2, 2])
    expect(after !== undefined && isViewed(after)).toBe(false)
  })

  it("is an ordinary call in its run until the view's line arrives", () => {
    const plain = entries.filter((e) => e._tag !== "View")
    expect(withoutCards(plain).map((run) => run.length)).toEqual([6])
  })

  it("names the view as the latest thing a turn did", () => {
    expect(latestActivity([shown, done("v1"), makeViewEntry({ call: "v1" })], undefined)).toBe(
      "metrics/show_dashboard",
    )
  })
})

/** A Codex shell call, and its clean outcome. */
const run = (call: string, detail: string): ToolEntryDto =>
  makeTool({ name: "commandExecution", kind: "Bash", detail, call })
const ran = (call: string): TranscriptEntryDto => makeNote({ text: "ToolResult(ok)", call })

/** A call's failed outcome, which a refused call's error result is. */
const failedRun = (call: string): TranscriptEntryDto =>
  makeNote({ text: "ToolResult(error)", call })

describe("groupEntries, on a call the CLI refused", () => {
  it("puts the denial in the run holding the call it names", () => {
    const call = run("toolu_1", "DANGEROUSLY_DISABLE_SAFETY_GUARD=1 echo probe-ran")
    const denied = makeDenied({ call: "toolu_1" })
    const rows = groupEntries([call, denied, failedRun("toolu_1")])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(expect.arrayContaining([call, denied]))
  })

  it("draws a denial naming no call here as a row of its own", () => {
    const denied = makeDenied({ call: "elsewhere" })
    expect(groupEntries([run("a", "ls"), ran("a"), denied])).toEqual([
      [run("a", "ls"), ran("a")],
      [denied],
    ])
  })
})

describe("groupEntries, on hooks", () => {
  it("puts a pre and a post hook in the run holding their call, whichever side they land", () => {
    const pre = makeHook({ call: "exec-1", event: "preToolUse" })
    const post = makeHook({ call: "exec-1", event: "postToolUse" })
    const call = run("exec-1", "echo hi")
    const rows = groupEntries([pre, call, ran("exec-1"), post])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(expect.arrayContaining([pre, call, post]))
  })

  it("leaves a run of hooked reads one run", () => {
    const entries = [
      makeHook({ call: "a" }),
      run("a", "cat a.ts"),
      ran("a"),
      makeHook({ call: "a", event: "postToolUse" }),
      makeHook({ call: "b" }),
      run("b", "cat b.ts"),
      ran("b"),
      makeHook({ call: "b", event: "postToolUse" }),
    ]
    expect(groupRuns(entries).map((g) => groupCalls(g).length)).toEqual([2])
  })

  it("draws nothing for a hook naming no call that ran cleanly and printed nothing", () => {
    const rows = groupEntries([run("a", "ls"), ran("a"), makeHook({ call: "elsewhere" })])
    expect(rows).toEqual([[run("a", "ls"), ran("a")]])
  })

  it.each([
    ["failed", makeHook({ call: "elsewhere", status: "failed" })],
    ["blocked", makeHook({ call: undefined, event: "stop", status: "blocked" })],
    ["printed", makeHook({ call: "elsewhere", output: [{ kind: "warning", text: "slow" }] })],
  ])("keeps a stray hook that %s inside the run it arrived in", (_, stray) => {
    const rows = groupEntries([run("a", "ls"), ran("a"), stray, run("b", "pwd"), ran("b")])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain(stray)
  })

  it("holds a stray that arrives before any run for the first run after it", () => {
    const stray = makeHook({ call: undefined, event: "userPromptSubmit", status: "failed" })
    const rows = groupEntries([said("starting"), stray, run("a", "ls")])
    expect(rows).toEqual([[said("starting")], [run("a", "ls"), stray]])
  })

  it("draws a stray on its own line only where its turn has no run at all", () => {
    const stray = makeHook({ call: undefined, event: "stop", status: "blocked" })
    expect(groupEntries([stray, said("done")])).toEqual([[said("done")], [stray]])
  })

  it("treats a hook on a call a card took as a stray", () => {
    const viewed = makeTool({ name: "mcpToolCall", kind: "Mcp", call: "v", detail: "m/t" })
    const quiet = makeHook({ call: "v" })
    const rows = groupEntries([quiet, viewed, makeViewEntry({ call: "v" })])
    expect(rows.flat()).not.toContain(quiet)
  })
})
