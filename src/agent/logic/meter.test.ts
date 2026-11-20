import { describe, expect, it } from "vitest"
import { ProviderEvent, type ActivityKind } from "../types/provider-event.js"
import { noEstimate, noUsage } from "../types/usage.js"
import { meter, metered, unmetered } from "./meter.js"

const tool = (name: string, kind: ActivityKind, detail?: string) =>
  ProviderEvent.ToolUse({
    name,
    kind,
    detail,
    command: undefined,
    backgrounded: undefined,
    call: undefined,
    parent: undefined,
  })

const usage = (over: Partial<Parameters<typeof ProviderEvent.Usage>[0]> = {}) =>
  ProviderEvent.Usage({
    inputTokens: 2,
    outputTokens: 100,
    cacheReadTokens: 30_000,
    cacheWriteTokens: 4000,
    runCostUsd: 0.25,
    ...over,
  })

// The second reading of `context-window.captured.jsonl`: call 2 read 23,557 from cache
// plus 178 written. Two readings added are twice what the window ever held.
const reading = (over: Partial<Parameters<typeof ProviderEvent.Occupancy>[0]> = {}) =>
  ProviderEvent.Occupancy({
    model: "claude-haiku-4-5-20251001",
    call: undefined,
    inputTokens: 8,
    outputTokens: 2,
    cacheReadTokens: 23_557,
    cacheWriteTokens: 178,
    ...over,
  })

describe("meter", () => {
  it("a turn that emitted nothing spent nothing", () => {
    expect(meter([])).toEqual(noUsage)
  })

  // By the provider's own name and never by the kind: `ork record` prints this table
  // for a human judging a trak, and two tools that share a kind are two tools.
  it("counts tools by name, because the name is the finding", () => {
    const turn = [
      tool("Grep", "Grep", "ToolUse"),
      ProviderEvent.ToolResult({ ok: true, call: undefined, parent: undefined }),
      tool("Read", "Read", "/tmp/a.ts"),
      tool("Grep", "Grep", "meter"),
      tool("MultiEdit", "Edit", "/tmp/b.ts"),
      tool("Write", "Write", "/tmp/c.ts"),
    ]
    expect(meter(turn).tools).toEqual({ Grep: 2, Read: 1, MultiEdit: 1, Write: 1 })
  })

  it("adds the token counters across repeated reports", () => {
    expect(meter([usage(), usage({ outputTokens: 40, runCostUsd: 0.4 })])).toEqual({
      inputTokens: 4,
      outputTokens: 140,
      cacheReadTokens: 60_000,
      cacheWriteTokens: 8000,
      costUsd: 0.4,
      tools: {},
    })
  })

  it("takes the largest cost one run reports, because each report is that run's total", () => {
    // The three real readings from `background-work.captured.jsonl`. Added they come to
    // $0.248 for a turn that cost $0.093 — this is the assumption `metered` was written
    // asking to have checked against a fixture, and the fixture disagreed with it.
    const reported = [0.071_454_05, 0.083_362_65, 0.093_032_45]
    expect(meter(reported.map((c) => usage({ runCostUsd: c }))).costUsd).toBe(0.093_032_45)
  })

  it("does not let a report arriving out of order shrink what a turn has spent", () => {
    expect(meter([usage({ runCostUsd: 0.9 }), usage({ runCostUsd: 0.2 })]).costUsd).toBe(0.9)
  })

  it("ignores everything a turn does that is not spending", () => {
    const noise = [
      ProviderEvent.Spawned({ pid: 42 }),
      ProviderEvent.TextDelta({ text: "thinking out loud", parent: undefined }),
      ProviderEvent.Thinking({ tokens: 900, text: undefined }),
      ProviderEvent.RateLimit({
        exhausted: false,
        usingOverage: true,
        resetsAt: undefined,
        windows: undefined,
      }),
      ProviderEvent.Result({ text: "done" }),
      ProviderEvent.Unknown({ raw: { type: "something/new" } }),
    ]
    expect(meter(noise)).toEqual(noUsage)
  })

  it("adds the runs of a turn that re-asked, because the second CLI starts its total again", () => {
    // The two readings a real re-ask recorded: $18.15 from the run that answered
    // badly, then $2.60 from the run that answered — kept as a maximum, the turn
    // recorded $18.15. Tokens were already summed; cost now is too.
    const reask = ProviderEvent.Reask({ reason: "not a value of the schema" })
    expect(
      meter([usage({ runCostUsd: 18.1539 }), reask, usage({ runCostUsd: 2.5959 })]).costUsd,
    ).toBeCloseTo(20.7498, 4)
  })

  it("keeps a run's own reports as a maximum on top of what was banked", () => {
    // Background work after a re-ask still reports a running total for that run,
    // so its readings stay a maximum — laid over the run before rather than added to
    // it report by report.
    const reask = ProviderEvent.Reask({ reason: "not a value of the schema" })
    const readings = [usage({ runCostUsd: 0.5 }), reask, usage({ runCostUsd: 0.2 })]
    expect(meter([...readings, usage({ runCostUsd: 0.3 })]).costUsd).toBeCloseTo(0.8, 6)
  })

  it("keeps the last context reading rather than adding readings, which is the opposite rule", () => {
    const turn = [reading({ inputTokens: 10, cacheWriteTokens: 0 }), reading(), usage()]
    expect(meter(turn).context).toEqual({
      inputTokens: 8,
      outputTokens: 2,
      cacheReadTokens: 23_557,
      cacheWriteTokens: 178,
    })
  })

  it("has no reading until one arrives, whatever was spent", () => {
    expect(meter([usage()]).context).toBeUndefined()
    expect(meter([usage()]).contextWindow).toBeUndefined()
  })

  it("takes the window the reading's own model reports, and not a subagent model's", () => {
    // Claude reports one `modelUsage` entry per model the invocation called, and a
    // turn on opus that delegated to haiku sees both windows on its result line.
    const turn = [
      reading({ model: "claude-opus-5" }),
      ProviderEvent.ContextWindow({ model: "claude-haiku-4-5-20251001", tokens: 200_000 }),
      ProviderEvent.ContextWindow({ model: "claude-opus-5", tokens: 1_000_000 }),
    ]
    expect(meter(turn).contextWindow).toBe(1_000_000)
  })

  it("takes a window where neither side names a model, which is how Codex reports both", () => {
    const turn = [
      ProviderEvent.ContextWindow({ model: undefined, tokens: 258_400 }),
      reading({ model: undefined }),
    ]
    expect(meter(turn).contextWindow).toBe(258_400)
    expect(meter(turn).context?.cacheReadTokens).toBe(23_557)
  })

  it("folds one event at a time onto what came before", () => {
    // `metered` is what the runtime calls per event, so the incremental form has to
    // agree with the whole-turn one — a Ref updated per event is the only shape a
    // turn that dies mid-flight can report anything at all from.
    const turn = [usage(), tool("Bash", "Bash", "pnpm test")]
    expect(turn.reduce(metered, unmetered).usage).toEqual(meter(turn))
  })
})

describe("the estimate of what a turn has spent before its provider says", () => {
  // The two calls of `.experiments/run1.jsonl`: Claude wrote the first as three
  // `assistant` frames — thinking, then a tool_use, then a second tool_use — all
  // under `msg_011CfNMcRBoNb5vQTJnkudnN`, and the second as two under
  // `msg_011CfNMcbcrZ5kz573zDdrcR`. The `result` line's totals were 18 in, 17,295
  // written and 42,850 read: each call's reading added once, to the token.
  const first = { call: "msg_011CfNMcRBoNb5vQTJnkudnN", inputTokens: 10, outputTokens: 4 }
  const second = { call: "msg_011CfNMcbcrZ5kz573zDdrcR", inputTokens: 8, outputTokens: 3 }
  const run1 = [
    reading({ ...first, cacheWriteTokens: 16_944, cacheReadTokens: 12_953 }),
    reading({ ...first, cacheWriteTokens: 16_944, cacheReadTokens: 12_953 }),
    reading({ ...first, cacheWriteTokens: 16_944, cacheReadTokens: 12_953 }),
    reading({ ...second, cacheWriteTokens: 351, cacheReadTokens: 29_897 }),
    reading({ ...second, cacheWriteTokens: 351, cacheReadTokens: 29_897 }),
  ]

  it("adds each call's reading once, however many frames carry it", () => {
    expect(run1.reduce(metered, unmetered).estimate).toEqual({
      inputTokens: 18,
      outputTokens: 7,
      cacheWriteTokens: 17_295,
      cacheReadTokens: 42_850,
    })
  })

  it("counts every reading where the provider names no call, as Codex reports", () => {
    // Two calls that happened to read the same numbers are still two calls.
    const same = reading({ call: undefined })
    expect([same, same].reduce(metered, unmetered).estimate.cacheReadTokens).toBe(47_114)
  })

  it("starts again at each report, so readings after one are laid on top", () => {
    // A `Usage` is the provider's own figure for everything read so far; a report
    // that did not clear the estimate would count the same calls twice on the
    // background-work turn that reports three times.
    const reported = [...run1, usage()].reduce(metered, unmetered)
    expect(reported.estimate).toEqual(noEstimate)
    expect(reported.usage.cacheReadTokens).toBe(30_000)
    const after = metered(reported, reading({ call: "msg_third", cacheReadTokens: 1000 }))
    expect(after.estimate.cacheReadTokens).toBe(1000)
    expect(after.usage.cacheReadTokens).toBe(30_000)
  })
})
