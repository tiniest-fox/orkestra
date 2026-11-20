// Unit tests for override point 2, run against fixtures captured from real
// `claude --output-format stream-json` output. Hand-written JSON would test my
// imagination; captured output tests Claude.

import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { answerOf } from "../../logic/answer.js"
import { rawKind } from "../../logic/event-line.js"
import { meter } from "../../logic/meter.js"
import { claudeApiErrorKind, claudeNormalizeLine } from "./normalize.js"

const fixture = (name: string): readonly string[] =>
  readFileSync(new URL(`../../../../test/fixtures/claude/${name}`, import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")

const tagsOf = (lines: readonly string[]): readonly string[] =>
  lines.flatMap((l) => claudeNormalizeLine(l).map((e) => e._tag))

/** One `task_started`, with whatever the case under test wants to say about it. */
const taskStarted = (over: Record<string, unknown>): string =>
  JSON.stringify({
    type: "system",
    subtype: "task_started",
    task_id: "t1",
    tool_use_id: "toolu_1",
    ...over,
  })

/** One assistant message carrying one tool call, which is how every tool arrives. */
const toolCall = (name: string, input: Record<string, unknown>): string =>
  JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", name, input }] },
  })

describe("claudeNormalizeLine — captured output", () => {
  const lines = fixture("simple-reply.captured.jsonl")

  it("maps a whole session to the expected event sequence", () => {
    expect(tagsOf(lines)).toEqual([
      "SessionStarted", // system/init
      "RateLimit", // rate_limit_event — a quota broadcast, and not a failure
      "Occupancy", // the assistant frame's own usage: what this call's window held
      "TextDelta", // assistant
      "Usage", // result carries usage + cost
      "Result",
    ])
  })

  it("lifts session_id out of system/init", () => {
    expect(claudeNormalizeLine(lines[0] ?? "")).toMatchObject([
      { _tag: "SessionStarted", id: "adfed8ee-9dd1-427f-98f1-1fcbc0cd75ba" },
    ])
  })

  it("reports usage and cost from the result line", () => {
    expect(claudeNormalizeLine(lines[3] ?? "")).toContainEqual({
      _tag: "Usage",
      inputTokens: 2,
      outputTokens: 4,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      runCostUsd: 0.0710665,
    })
  })

  it("reads the cache counters, which are most of a real turn's input", () => {
    const withCache = JSON.stringify({
      type: "result",
      is_error: false,
      result: "OK",
      total_cost_usd: 0.32,
      usage: {
        input_tokens: 2,
        output_tokens: 3695,
        cache_creation_input_tokens: 14_000,
        cache_read_input_tokens: 280_000,
      },
    })
    expect(claudeNormalizeLine(withCache)).toContainEqual({
      _tag: "Usage",
      inputTokens: 2,
      outputTokens: 3695,
      cacheWriteTokens: 14_000,
      cacheReadTokens: 280_000,
      runCostUsd: 0.32,
    })
  })

  it("takes the final answer from result.result, not the assistant deltas", () => {
    const result = claudeNormalizeLine(lines[3] ?? "").find((e) => e._tag === "Result")
    expect(result?._tag === "Result" ? result.text : undefined).toBe("OK")
  })
})

describe("claudeNormalizeLine — a user message echoed back", () => {
  const events = fixture("steered.captured.jsonl").flatMap(claudeNormalizeLine)

  it("reads every replayed line as a delivery, the turn's own prompt included", () => {
    // Which of the two was steered is not this file's to know: the harness holds what
    // it wrote, and drops the one it did not. No key from here, for the same reason.
    expect(events.filter((e) => e._tag === "MessageDelivered")).toEqual([
      {
        _tag: "MessageDelivered",
        text: "Run `sleep 6` with the Bash tool, then answer with the single word DONE.",
        key: undefined,
      },
      {
        _tag: "MessageDelivered",
        text: "End your final answer with the word TANGERINE.",
        key: undefined,
      },
    ])
  })

  it("reports the steered message after the tool call it was written under returned", () => {
    const tags = events.map((e) => e._tag)
    expect(tags.lastIndexOf("MessageDelivered")).toBeGreaterThan(tags.indexOf("ToolResult"))
    expect(tags.lastIndexOf("MessageDelivered")).toBeLessThan(tags.indexOf("Result"))
  })

  it("still reads a tool_result line, which is a user message that is not a replay", () => {
    expect(events.filter((e) => e._tag === "ToolResult")).toHaveLength(1)
    expect(events.some((e) => e._tag === "Unknown" && rawKind(e.raw) === "user")).toBe(false)
  })
})

describe("claudeNormalizeLine — thinking", () => {
  it("reads system/thinking_tokens as Thinking, with the running estimate", () => {
    // Was two `Unknown`s, which is what made a turn's longest stretch unreadable.
    expect(claudeNormalizeLine(fixture("thinking-tokens.captured.jsonl")[1] ?? "")).toEqual([
      { _tag: "Thinking", tokens: 158 },
    ])
  })

  it("keeps the estimate optional, because the next provider may not report one", () => {
    const noCount = JSON.stringify({ type: "system", subtype: "thinking_tokens" })
    expect(claudeNormalizeLine(noCount)).toEqual([{ _tag: "Thinking", tokens: undefined }])
  })

  it("does not swallow system/init, which shares its type", () => {
    // The two are told apart by `subtype` alone, so a reader that checked `type`
    // would turn every session start into a thinking tick.
    expect(tagsOf(fixture("simple-reply.captured.jsonl"))[0]).toBe("SessionStarted")
  })
})

describe("claudeNormalizeLine — rate limits", () => {
  it("reads the quota broadcast without treating it as a failure", () => {
    // The captured line says `status: "rejected"` on a turn that returned "OK" via
    // overage — which is why this is its own event and not an ApiError. Reading it
    // as one would have failed a healthy turn.
    const events = claudeNormalizeLine(fixture("simple-reply.captured.jsonl")[1] ?? "")
    expect(events).toEqual([
      {
        _tag: "RateLimit",
        exhausted: true,
        usingOverage: true,
        resetsAt: 1_785_193_200,
        windows: undefined,
      },
    ])
    expect(tagsOf(fixture("simple-reply.captured.jsonl"))).not.toContain("ApiError")
  })

  it("says nothing rather than guessing when the payload is absent", () => {
    // Every field optional: a broadcast whose shape shifts must still be a
    // RateLimit, or a status message would fail the whole line into Unknown.
    expect(claudeNormalizeLine(JSON.stringify({ type: "rate_limit_event" }))).toEqual([
      {
        _tag: "RateLimit",
        exhausted: false,
        usingOverage: false,
        resetsAt: undefined,
        windows: undefined,
      },
    ])
  })

  it("keeps the provider's own word for exhausted out of the vocabulary", () => {
    // `status` is compared here and never carried, so no consumer switches on a
    // string the compiler cannot check — the trap a `SystemEvent({ kind })` sets.
    const allowed = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed", isUsingOverage: false },
    })
    expect(claudeNormalizeLine(allowed)).toEqual([
      {
        _tag: "RateLimit",
        exhausted: false,
        usingOverage: false,
        resetsAt: undefined,
        windows: undefined,
      },
    ])
  })
})

/** The `rate_limit_event` line a captured fixture holds. */
const rateLimitLine = (name: string): string =>
  fixture(name).find((line) => line.includes('"rate_limit_event"')) ?? ""

const windowsOf = (line: string) => {
  const [event] = claudeNormalizeLine(line)
  return event?._tag === "RateLimit" ? event.windows : "not a RateLimit"
}

const windowsLine = (unifiedWindows: unknown) =>
  JSON.stringify({ type: "rate_limit_event", rate_limit_info: { unifiedWindows } })

describe("claudeNormalizeLine — plan windows", () => {
  it("reads both windows as shares of 100 resetting at epoch milliseconds", () => {
    // 2.1.263 writes `utilization: 0.08` and `resetsAt: 1790101800` — a fraction and
    // seconds, which `PlanWindow` holds as 8 and milliseconds.
    expect(windowsOf(rateLimitLine("context-window.captured.jsonl"))).toEqual([
      { kind: "five_hour", utilization: 8, resetsAt: 1_790_101_800_000 },
      { kind: "seven_day", utilization: 19, resetsAt: 1_790_398_800_000 },
    ])
  })

  it("reads no windows from a claude that writes none, and still reads the quota", () => {
    // 2.1.220 omits `unifiedWindows` on every event, `allowed` and `rejected` alike.
    const [event] = claudeNormalizeLine(rateLimitLine("background-work.captured.jsonl"))
    expect(event).toMatchObject({ _tag: "RateLimit", resetsAt: 1_786_424_400, windows: undefined })
  })

  it("drops a malformed window rather than the event, and the rest with it", () => {
    expect(
      windowsOf(
        windowsLine({ five_hour: { utilization: "lots" }, seven_day: { utilization: 0.5 } }),
      ),
    ).toEqual([{ kind: "seven_day", utilization: 50 }])
    expect(windowsOf(windowsLine(JSON.parse('{ "five_hour": null }')))).toBeUndefined()
    expect(windowsOf(windowsLine("nonsense"))).toBeUndefined()
  })
})

describe("claudeNormalizeLine — unmodelled kinds", () => {
  it("keeps the raw payload on Unknown so nothing is lost", () => {
    expect(claudeNormalizeLine('{"type":"brand_new_kind","x":1}')).toMatchObject([
      { _tag: "Unknown", raw: { type: "brand_new_kind", x: 1 } },
    ])
  })
})

describe("claudeNormalizeLine — delegation", () => {
  const lines = fixture("delegation.synthetic.jsonl")

  it("brackets a delegation and attributes the subagent's work to it", () => {
    expect(tagsOf(lines)).toEqual([
      "ToolUse", // the Agent call itself
      "SubagentStarted", // system/task_started
      // the sidechain `user` echo of the brief produces nothing — see below
      "TextDelta", // the subagent's own narration
      "ToolUse", // the subagent's Bash
      "ToolResult", // and its answer
      "Unknown", // system/task_progress, deliberately — see known-kinds.json
      "Unknown", // system/task_updated, deliberately — and it precedes the answer
      "SubagentResult", // system/task_notification
      "ToolResult", // the Agent call's own answer, back at the top level
    ])
  })

  it("names the delegating call on the tool_use that started it", () => {
    // The head of the group, and the id every line below points at.
    expect(claudeNormalizeLine(lines[0] ?? "")).toEqual([
      {
        _tag: "ToolUse",
        name: "Agent",
        kind: "Task",
        detail: "general-purpose",
        call: "toolu_01Df",
        parent: undefined,
      },
    ])
  })

  it("reads task_started as the delegation, with the brief attached to the call", () => {
    expect(claudeNormalizeLine(lines[1] ?? "")).toEqual([
      {
        _tag: "SubagentStarted",
        call: "toolu_01Df",
        agentType: "general-purpose",
        description: "Run echo hello and report output",
        prompt: "Run `echo hello` and tell me what it printed.",
      },
    ])
  })

  it("drops the brief echoed back on a sidechain user message", () => {
    // Falls out of the rule a `user` line is read by at all — tool results and nothing
    // else. Worth its own case because the brief is the one echo a delegation adds, and
    // storing it would credit the *parent* agent with the words it wrote for the
    // subagent, which arrive again on `task_started` attached to the call that owns them.
    expect(claudeNormalizeLine(lines[2] ?? "")).toEqual([])
  })

  it("marks every line the subagent wrote with the call it happened inside", () => {
    expect(claudeNormalizeLine(lines[3] ?? "")).toEqual([
      { _tag: "TextDelta", text: "Running it now.", parent: "toolu_01Df" },
      {
        _tag: "ToolUse",
        name: "Bash",
        kind: "Bash",
        detail: "echo hello",
        call: "toolu_02Bs",
        parent: "toolu_01Df",
      },
    ])
    expect(claudeNormalizeLine(lines[4] ?? "")).toEqual([
      // Both ids: the delegation it happened inside, and the subagent's own call it answers.
      { _tag: "ToolResult", ok: true, call: "toolu_02Bs", parent: "toolu_01Df" },
    ])
  })

  it("reads task_notification as the subagent's answer", () => {
    expect(claudeNormalizeLine(lines[7] ?? "")).toEqual([
      {
        _tag: "SubagentResult",
        call: "toolu_01Df",
        ok: true,
        summary: "It printed `hello`.",
        outcome: "completed",
        taskId: "task_9",
      },
    ])
  })

  it("reads a bracket with no tool_use_id, and then emits nothing for it", () => {
    // Two rules meeting. The line decodes — the provider's own schema makes the field
    // optional and a required one here would render a *known* kind as `Unknown(...)`,
    // which is the whole symptom — and then produces nothing, because the id is the only
    // handle joining a subagent's lines to the call that asked for them and a head no
    // group can hang off is worse than no head.
    const line = JSON.stringify({
      type: "system",
      subtype: "task_started",
      task_id: "task_9",
      task_type: "local_agent",
    })
    expect(claudeNormalizeLine(line)).toEqual([])
  })

  it("reads a null parent_tool_use_id as the agent's own line, not as a failure", () => {
    // Every top-level line carries the field as `null`. A Schema that took only a string
    // would fail the struct and drop every ordinary assistant message into `Unknown`.
    expect(tagsOf([lines[0] ?? ""])).toEqual(["ToolUse"])
  })
})

describe("claudeNormalizeLine — a task report's status", () => {
  it.each([
    ["failed", false, "failed"],
    ["completed", true, "completed"],
    // `stopped` is the whole reason `outcome` exists: through `ok` alone it reads as a
    // success, and a task the CLI killed must never be presented as one.
    ["stopped", true, "stopped"],
    // The direction `is_error` takes: a status this file has not seen must not become a
    // failure mark, because a wrong one is actionable and wrong. It carries no outcome
    // either — a wrong word would be the same mistake with a wider vocabulary.
    ["some_word_nobody_here_has_seen", true, undefined],
    [undefined, true, undefined],
  ])("reads a status of %s as ok=%s, outcome=%s", (status, ok, outcome) => {
    const line = JSON.stringify({
      type: "system",
      subtype: "task_notification",
      tool_use_id: "toolu_1",
      ...(status === undefined ? {} : { status }),
    })
    expect(claudeNormalizeLine(line)).toEqual([
      {
        _tag: "SubagentResult",
        call: "toolu_1",
        ok,
        summary: undefined,
        outcome,
        taskId: undefined,
      },
    ])
  })
})

describe("claudeNormalizeLine — which tasks are delegations", () => {
  it.each([
    ["local_agent", true],
    ["remote_agent", true],
    ["local_workflow", true],
    ["local_bash", false],
    ["in_process_teammate", false],
    ["monitor_mcp", false],
    ["dream", false],
    ["auto_mode_scan", false],
  ])("reads task_type %s as a delegation: %s", (task_type, delegates) => {
    expect(claudeNormalizeLine(taskStarted({ task_type })).map((e) => e._tag)).toEqual(
      delegates ? ["SubagentStarted"] : [],
    )
  })

  it("reads a bracket that names no task_type as not a delegation", () => {
    // The direction is chosen: a missing card beats one per slow shell command, and the
    // corpus says the shell ones outnumber the real delegations by two orders.
    expect(claudeNormalizeLine(taskStarted({}))).toEqual([])
  })

  it("reads a control_response as recognised and produces nothing — not Unknown", () => {
    // The ack for a stop the harness wrote. What a person watches for is already on the
    // stream — the level shrinking and the task's own stopped notification.
    const ack = JSON.stringify({
      type: "control_response",
      response: { subtype: "success", request_id: "ork-1", response: {} },
    })
    expect(claudeNormalizeLine(ack)).toEqual([])
  })

  it("emits nothing at all for an ambient task, on either bracket", () => {
    // `skip_transcript` is the provider asking consumers to hide housekeeping from an
    // inline transcript, and there is no other surface here to hide it *on* — background
    // work has none outside the transcript, so a count would be furniture with no home.
    expect(
      claudeNormalizeLine(taskStarted({ task_type: "local_agent", skip_transcript: true })),
    ).toEqual([])
    const answer = JSON.stringify({
      type: "system",
      subtype: "task_notification",
      task_id: "t1",
      tool_use_id: "toolu_1",
      status: "completed",
      skip_transcript: true,
    })
    expect(claudeNormalizeLine(answer)).toEqual([])
  })

  it("answers for a task it never opened, because the answer cannot say which kind it was", () => {
    // `task_notification` carries no `task_type`. Gating it would need memory of the
    // `task_started` before it, and this function has none by design — so a shell
    // command's answer is emitted and dropped by whatever draws it, against the
    // delegations it actually opened.
    const answer = JSON.stringify({
      type: "system",
      subtype: "task_notification",
      task_id: "t1",
      tool_use_id: "toolu_shell",
      status: "completed",
      summary: "Run Python sleep command for 50 seconds",
    })
    expect(claudeNormalizeLine(answer).map((e) => e._tag)).toEqual(["SubagentResult"])
  })
})

describe("claudeNormalizeLine — which tasks are background work", () => {
  // The frame shapes are 6-experiment's verbatim captures on 2.1.241, cut to the fields
  // read here; the stored fixtures predate `is_backgrounded`, so the current emitter's
  // behaviour is pinned synthetically.

  it("emits the join for a backgrounded shell task, which is not a delegation", () => {
    expect(
      claudeNormalizeLine(
        taskStarted({
          task_type: "local_bash",
          is_backgrounded: true,
          description: "Background sleep for 400 seconds",
        }),
      ),
    ).toEqual([
      {
        _tag: "BackgroundStarted",
        taskId: "t1",
        call: "toolu_1",
        description: "Background sleep for 400 seconds",
      },
    ])
  })

  it("emits the join beside the delegation for a backgrounded subagent", () => {
    // `SubagentStarted` carries no task id, and the level and the stop control speak
    // nothing else — so a backgrounded delegation owes both events.
    expect(
      claudeNormalizeLine(taskStarted({ task_type: "local_agent", is_backgrounded: true })).map(
        (e) => e._tag,
      ),
    ).toEqual(["BackgroundStarted", "SubagentStarted"])
  })

  it("emits no join for an inline task, which registers exactly like a backgrounded one", () => {
    // `is_backgrounded: false` is what a current CLI writes on every `pnpm verify`; a
    // row per one of those would say nothing a transcript needs.
    expect(
      claudeNormalizeLine(taskStarted({ task_type: "local_bash", is_backgrounded: false })),
    ).toEqual([])
  })

  it("emits no join for an ambient backgrounded task either", () => {
    expect(
      claudeNormalizeLine(
        taskStarted({ task_type: "local_bash", is_backgrounded: true, skip_transcript: true }),
      ),
    ).toEqual([])
  })

  it("models the level, empty set included", () => {
    const level = JSON.stringify({
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [{ task_id: "t1", task_type: "local_bash", description: "sleep 400" }],
    })
    expect(claudeNormalizeLine(level)).toEqual([
      {
        _tag: "BackgroundTasks",
        tasks: [{ id: "t1", taskType: "local_bash", description: "sleep 400" }],
      },
    ])
    const empty = JSON.stringify({
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [],
    })
    expect(claudeNormalizeLine(empty)).toEqual([{ _tag: "BackgroundTasks", tasks: [] }])
  })

  it("leaves a level that cannot say what is running unmodelled", () => {
    // The set is the whole content of the line, on `api_retry`'s rule: `Unknown` is what
    // makes a moved shape visible to `pnpm smoke` rather than an empty replacement.
    const bare = JSON.stringify({ type: "system", subtype: "background_tasks_changed" })
    expect(claudeNormalizeLine(bare)).toMatchObject([{ _tag: "Unknown" }])
  })
})

describe("claudeNormalizeLine — a call auto mode refused", () => {
  const lines = fixture("auto-mode-denied.captured.jsonl")

  it("names the rule and the call it refused, and is never `Unknown`", () => {
    expect(tagsOf(lines)).toEqual(["Occupancy", "ToolUse", "PermissionDenied", "ToolResult"])
    expect(claudeNormalizeLine(lines[1] ?? "")).toEqual([
      {
        _tag: "PermissionDenied",
        call: "toolu_01L6Z1UWn42ZLPF39nJroYEJ",
        tool: "Bash",
        reason: "[Safety Bypass Flag]",
        source: "classifier",
      },
    ])
  })

  it("joins the denial to the call it names, which the error result answers too", () => {
    const [use, denied, result] = lines.map((l) => claudeNormalizeLine(l).at(-1))
    expect(use).toMatchObject({ _tag: "ToolUse", call: "toolu_01L6Z1UWn42ZLPF39nJroYEJ" })
    expect(denied).toMatchObject({ call: "toolu_01L6Z1UWn42ZLPF39nJroYEJ" })
    expect(result).toMatchObject({ ok: false, call: "toolu_01L6Z1UWn42ZLPF39nJroYEJ" })
  })
})

describe("claudeNormalizeLine — a retryable API failure", () => {
  // Not captured: no run has been rate-limited while a fixture was being taken. Both
  // lines are written as wire bytes rather than built from an object, because the
  // second one's `error_status` is `null` — which is the case, and which this
  // codebase's own vocabulary has no way to spell.
  const retry =
    '{"type":"system","subtype":"api_retry","attempt":2,"max_retries":5,' +
    '"retry_delay_ms":1200,"error_status":429,"error":{"message":"Too Many Requests"}}'
  const noStatus =
    '{"type":"system","subtype":"api_retry","attempt":2,"max_retries":5,' +
    '"retry_delay_ms":1200,"error_status":null,"error":{"message":"Connection error"}}'

  it("says which attempt it is and how long it is waiting", () => {
    expect(claudeNormalizeLine(retry)).toEqual([
      { _tag: "ApiRetry", attempt: 2, of: 5, status: "429", waitedMs: 1200 },
    ])
  })

  it("carries no status for a connection error that never got a response", () => {
    // The provider writes `null` there, and a label invented for it would be a claim
    // about an HTTP exchange that did not happen.
    expect(claudeNormalizeLine(noStatus)).toEqual([
      { _tag: "ApiRetry", attempt: 2, of: 5, status: undefined, waitedMs: 1200 },
    ])
  })

  it("keeps the counters when the status arrives in a shape nobody predicted", () => {
    // `error_status` is read as `Unknown` for the reason `result.origin` is: it is the
    // decorative half, and a typed field would lose *which attempt this is* over it.
    const spelled = JSON.stringify({
      type: "system",
      subtype: "api_retry",
      attempt: 3,
      max_retries: 5,
      retry_delay_ms: 400,
      error_status: "503 Service Unavailable",
    })
    expect(claudeNormalizeLine(spelled)).toEqual([
      { _tag: "ApiRetry", attempt: 3, of: 5, status: "503 Service Unavailable", waitedMs: 400 },
    ])
  })

  it("leaves a frame missing the counters unmodelled, as the provider's own reader does", () => {
    // They are the whole content of the line: an attempt that cannot say which attempt
    // it is has nothing to draw, and `Unknown` is what makes it visible to `pnpm smoke`.
    const short = JSON.stringify({ type: "system", subtype: "api_retry", attempt: 2 })
    expect(claudeNormalizeLine(short)).toMatchObject([{ _tag: "Unknown" }])
  })

  it("is not an ApiError, because the turn has not ended", () => {
    // The two are the same trouble at different times: this one is a pause to explain,
    // and `failOnApiError` must not see it — a retry that succeeded fails no turn.
    expect(claudeNormalizeLine(retry).map((e) => e._tag)).not.toContain("ApiError")
  })
})

describe("claudeNormalizeLine — the tools that were drawing bare names", () => {
  it.each([
    ["Skill", { skill: "atelier" }, "Other", "atelier"],
    ["ToolSearch", { query: "select:Monitor", max_results: 1 }, "Other", "select:Monitor"],
    ["TaskStop", { task_id: "aac33443737da12ad" }, "Other", "aac33443737da12ad"],
    ["TaskOutput", { task_id: "bnp8c8df9", block: true }, "Other", "bnp8c8df9"],
    [
      "SendMessage",
      { to: "ad1a2fd", summary: "re-measure and screenshot" },
      "Other",
      "re-measure and screenshot",
    ],
    ["ScheduleWakeup", { delaySeconds: 120, reason: "watching CI" }, "Other", "watching CI"],
  ])("reads %s as %s(%s)", (name, input, kind, detail) => {
    expect(claudeNormalizeLine(toolCall(name, input))).toEqual([
      { _tag: "ToolUse", name, kind, detail, backgrounded: undefined },
    ])
  })

  it("files the task-list tools under Todo, not under the background family", () => {
    // The `Task*` prefix spans two unrelated tools sets and the arguments are what tell
    // them apart: `TaskGet` takes a camelCase `taskId` and sits beside `TaskCreate`,
    // where `TaskStop` takes a snake_case `task_id` and acts on a background task.
    expect(claudeNormalizeLine(toolCall("TaskGet", { taskId: "3" }))).toEqual([
      {
        _tag: "ToolUse",
        name: "TaskGet",
        kind: "Todo",
        detail: undefined,
        backgrounded: undefined,
      },
    ])
    expect(claudeNormalizeLine(toolCall("TaskList", {}))).toEqual([
      {
        _tag: "ToolUse",
        name: "TaskList",
        kind: "Todo",
        detail: undefined,
        backgrounded: undefined,
      },
    ])
  })

  it.each([
    ["Bash", "Bash"],
    ["Monitor", "Other"],
  ])("shows a described %s by its description, and keeps the command behind it", (name, kind) => {
    const input = { description: "Run the touched specs", command: "bin/rspec spec/a_spec.rb" }
    expect(claudeNormalizeLine(toolCall(name, input))).toEqual([
      {
        _tag: "ToolUse",
        name,
        kind,
        detail: "Run the touched specs",
        command: "bin/rspec spec/a_spec.rb",
        backgrounded: undefined,
      },
    ])
  })

  it("shows an undescribed command as itself, and carries it once", () => {
    const [event] = claudeNormalizeLine(toolCall("Bash", { command: "ls", description: "" }))
    expect(event).toMatchObject({ kind: "Bash", detail: "ls", command: undefined })
  })

  it("marks a call the turn did not wait for", () => {
    // On `Bash` as much as on `Agent` — it is a fact about how the tool was invoked.
    expect(
      claudeNormalizeLine(toolCall("Bash", { command: "sleep 25", run_in_background: true })),
    ).toEqual([
      { _tag: "ToolUse", name: "Bash", kind: "Bash", detail: "sleep 25", backgrounded: true },
    ])
  })

  it("leaves an inline call unmarked, whether it said so or not", () => {
    // `false` and absent are one fact — the turn waited — and writing the false one down
    // would put a key saying nothing on every `Read` in every transcript.
    for (const input of [{ command: "ls", run_in_background: false }, { command: "ls" }]) {
      expect(claudeNormalizeLine(toolCall("Bash", input))).toEqual([
        { _tag: "ToolUse", name: "Bash", kind: "Bash", detail: "ls", backgrounded: undefined },
      ])
    }
  })
})

describe("claudeNormalizeLine — tool use and errors", () => {
  it("surfaces text, tool_use and the tool's answer in order", () => {
    expect(tagsOf(fixture("tool-use.synthetic.jsonl"))).toEqual([
      "TextDelta",
      "ToolUse",
      "ToolResult", // the user/tool_result echo — one Unknown per tool call until now
    ])
  })

  it("reads a tool_result with no is_error as a tool that worked, and names the call", () => {
    expect(claudeNormalizeLine(fixture("tool-use.synthetic.jsonl")[1] ?? "")).toEqual([
      { _tag: "ToolResult", ok: true, call: "toolu_01" },
    ])
  })

  it("reads is_error on a tool_result as the tool failing", () => {
    const failed = JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true }] },
    })
    expect(claudeNormalizeLine(failed)).toEqual([{ _tag: "ToolResult", ok: false, call: "t1" }])
  })

  it("yields nothing for a user message that echoes no tool result", () => {
    // A turn input coming back is not an event — better silence than an
    // empty-handed one, and better than `Unknown`, which means never-seen-before.
    //
    // The block is a **well-formed** text block on purpose. This test read
    // `{ type: "text", x: 1 }`, which `TextBlock` rejects for want of `text`, so it
    // passed on a decode failure rather than on the rule it names — and the rule was
    // never true. See the skill-load suite below for what that cost.
    const echo = JSON.stringify({
      type: "user",
      message: { content: [{ type: "text", text: "the prompt, echoed back" }] },
    })
    expect(claudeNormalizeLine(echo)).toEqual([])
  })

  it("says what the tool did, not only what it was called", () => {
    expect(claudeNormalizeLine(fixture("tool-use.synthetic.jsonl")[0] ?? "")).toEqual([
      { _tag: "TextDelta", text: "Let me look.", parent: undefined },
      {
        _tag: "ToolUse",
        name: "Read",
        kind: "Read",
        detail: "/tmp/x",
        call: "toolu_01",
        parent: undefined,
      },
    ])
  })

  it.each([
    ["Bash", { command: "git commit -m 'x'" }, "Bash", "git commit -m 'x'"],
    ["Edit", { file_path: "/tmp/a.ts" }, "Edit", "/tmp/a.ts"],
    ["NotebookEdit", { notebook_path: "a.ipynb" }, "Edit", "a.ipynb"],
    ["Write", { file_path: "/tmp/b.ts" }, "Write", "/tmp/b.ts"],
    ["Grep", { pattern: "ToolUse" }, "Grep", "ToolUse"],
    ["Glob", { pattern: "**/*.ts" }, "Glob", "**/*.ts"],
    ["WebFetch", { url: "https://x" }, "WebFetch", "https://x"],
    // Second choice, because a spawn names its role only sometimes.
    ["Task", { description: "review the diff" }, "Task", "review the diff"],
  ])("reads %s as %s(%s)", (name, input, kind, detail) => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name, input }] },
    })
    expect(claudeNormalizeLine(line)).toEqual([{ _tag: "ToolUse", name, kind, detail }])
  })

  it("has a kind with nothing to show", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "TodoWrite", input: { todos: [] } }] },
    })
    expect(claudeNormalizeLine(line)).toEqual([
      { _tag: "ToolUse", name: "TodoWrite", kind: "Todo", detail: undefined },
    ])
  })

  // The fallback is the whole reason a new tool, an MCP server or a second provider is
  // not a breaking change. The provider's own name survives either way, so `meter` and
  // the record stay exact on a tool nothing here classifies.
  it("files an unmapped tool under Other and keeps its name", () => {
    expect(claudeNormalizeLine(toolCall("DesignSync", { id: 7 }))).toEqual([
      { _tag: "ToolUse", name: "DesignSync", kind: "Other", detail: undefined },
    ])
  })

  it("keeps the kind when the input is missing the field it would show", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Bash" }] },
    })
    expect(claudeNormalizeLine(line)).toEqual([
      { _tag: "ToolUse", name: "Bash", kind: "Bash", detail: undefined },
    ])
  })

  it("turns is_error into ApiError, not Result", () => {
    const tags = tagsOf(fixture("is-error.synthetic.jsonl"))
    expect(tags).toContain("ApiError")
    expect(tags).not.toContain("Result")
  })

  it("classifies the failure and keeps the sentence that described it", () => {
    // Both halves: the kind is what a retry policy would read, and the message is
    // the only description of what happened that reaches `ork resume`.
    expect(claudeNormalizeLine(fixture("is-error.synthetic.jsonl")[0] ?? "")).toContainEqual({
      _tag: "ApiError",
      kind: "rate_limit",
      message: "Credit balance is too low",
    })
  })

  it("reads the CLI's errors as the message where the result has no text", () => {
    expect(claudeNormalizeLine(fixture("resume-miss.captured.jsonl")[0] ?? "")).toContainEqual({
      _tag: "ApiError",
      kind: "unclassified",
      message: "No conversation found with session ID: 0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
    })
  })
})

/**
 * The id an outcome names is optional on the provider's own schema, so what a frame
 * without one must not do is disappear: a required field would fail the block, and a lost
 * outcome draws as a call still running rather than as one nothing could be joined to.
 */
describe("claudeNormalizeLine — an outcome that names no call", () => {
  // Written out rather than built, because `null` is a spelling this codebase does not
  // have and the point is that the provider does.
  const bare = '{"type":"user","message":{"content":[{"type":"tool_result"}]}}'
  const nulled = '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":null}]}}'

  it.each([
    ["absent", bare],
    ["null", nulled],
  ])("reads a %s id as no id, and still reports the outcome", (_, line) => {
    expect(claudeNormalizeLine(line)).toEqual([{ _tag: "ToolResult", ok: true, call: undefined }])
  })
})

describe("claudeNormalizeLine — a skill loading", () => {
  // Captured from `claude --output-format stream-json` in a scratch directory holding
  // one three-line skill: the `Skill` tool_use, its "Launching skill: tiny" answer, and
  // then a `user` line whose single text block is the **whole skill body**, which the
  // CLI injects as turn input. A real skill is 30 KB of it.
  const lines = fixture("skill-load.captured.jsonl")

  it("records a skill load as a tool call and its answer, and nothing else", () => {
    expect(tagsOf(lines)).toEqual(["Occupancy", "ToolUse", "ToolResult"])
  })

  it("does not read the injected skill body as something the agent said", () => {
    // `TextDelta` is stored whole as a `Text` entry — "the only record of what the
    // agent said" — so a skill body arriving as one puts the entire skill in the
    // transcript under the agent's name.
    expect(claudeNormalizeLine(lines[2] ?? "")).toEqual([])
  })
})

describe("claudeNormalizeLine — a slow foreground shell command", () => {
  // Captured from Claude Code 2.1.220 on haiku in a scratch directory: one `Bash` call
  // running `python3 -c "…time.sleep(50)…"`, and nothing else. The whole turn is here
  // because what it shows is an *ordering*, not a line.
  const lines = fixture("slow-command.captured.jsonl")
  const events = lines.flatMap((l) => claudeNormalizeLine(l))

  it("opens no delegation for a shell command, though the CLI brackets it like one", () => {
    // **The defect the display work exists for, observed rather than inferred.** The CLI
    // registers a task for shell work too — most brackets in a real corpus are these — so
    // without the `task_type` gate one slow `pnpm verify` draws a subagent that never
    // existed. Nothing else about the two frames distinguishes it from a delegation.
    expect(tagsOf(lines.slice(9, 14))).toEqual([
      "ToolUse", // the Bash call
      // system/task_started, task_type "local_bash" — read, and deliberately silent
      "Unknown", // tool_progress, a heartbeat at 30s — known-kinds.json says why
      // system/task_notification carries no task_type at all, so it is still an answer
      // here; the surface drawing it drops one that names no delegation it opened.
      "SubagentResult",
      "ToolResult", // and the command's actual answer
    ])
  })

  it("emits nothing for the bracket rather than a delegation with no agent", () => {
    // A `local_bash` bracket is the only thing in a real stream that carries no
    // `subagent_type`, which is why "a delegation that arrived without one" has no
    // producer: the gate stops it before the missing field could be read as anything.
    expect(claudeNormalizeLine(lines[10] ?? "")).toEqual([])
  })

  it("answers with the description it was given, not with a result", () => {
    // A `local_bash` notification's `summary` restates the call's own description and its
    // `output_file` is empty. Anything drawing `SubagentResult.summary` as "what came
    // back" would print the question.
    expect(claudeNormalizeLine(lines[12] ?? "")).toEqual([
      {
        _tag: "SubagentResult",
        call: "toolu_01ANTHX3r3WAyyPoUtcpTbyC",
        ok: true,
        summary: "Run Python sleep command for 50 seconds",
        outcome: "completed",
        taskId: "bm7luhhca",
      },
    ])
  })

  it("puts the heartbeat's own id where a joinable one would go", () => {
    // `tool_progress.tool_use_id` is `<call>-heartbeat-N` — an id for the heartbeat, not
    // for the call. The joinable one is `parent_tool_use_id`. Pinned because the field
    // named `tool_use_id` is exactly what anyone joining it would reach for first.
    const raw: unknown = JSON.parse(lines[11] ?? "")
    expect(raw).toMatchObject({
      tool_use_id: "toolu_01ANTHX3r3WAyyPoUtcpTbyC-heartbeat-0",
      parent_tool_use_id: "toolu_01ANTHX3r3WAyyPoUtcpTbyC",
      heartbeat: true,
    })
  })

  it("reports one session and one answer", () => {
    // The counterpart to the background fixture below, where neither is true.
    expect(events.filter((e) => e._tag === "SessionStarted")).toHaveLength(1)
    expect(events.filter((e) => e._tag === "Result")).toHaveLength(1)
  })
})

const selfGiven = (more: Readonly<Record<string, unknown>>): string =>
  JSON.stringify({ type: "result", origin: { kind: "task-notification" }, ...more })

describe("claudeNormalizeLine — a turn Claude gave itself", () => {
  it("reports what it ended by saying, as a result like ours", () => {
    expect(claudeNormalizeLine(selfGiven({ is_error: false, result: "done" }))).toEqual([
      { _tag: "Result", text: "done" },
    ])
  })

  it("keeps its failure from failing ours", () => {
    // Ours has answered by then, and an `ApiError` here would throw that answer away.
    expect(claudeNormalizeLine(selfGiven({ is_error: true, result: "API Error: 529" }))).toEqual([])
  })
})

describe("claudeNormalizeLine — a turn with background work", () => {
  // One captured invocation on haiku that does four things: a blocked foreground command,
  // a backgrounded `Bash`, an inline `Agent`, and a backgrounded `Agent` that answers
  // after the parent has moved on. Everything a delegation can do to a transcript's
  // ordering is in this file.
  const lines = fixture("background-work.captured.jsonl")
  const events = lines.flatMap((l) => claudeNormalizeLine(l))
  // Spread rather than an assertion, the way `stringField` reads a tool's input: these
  // are provider bytes, and the point of every case below is that we did not know
  // their shape until this file was captured.
  const raw = (i: number): Record<string, unknown> => {
    const parsed: unknown = JSON.parse(lines[i] ?? "")
    return typeof parsed === "object" && parsed !== null ? { ...parsed } : {}
  }

  it("re-announces the same session each time it picks the work back up", () => {
    // **Every other fixture here has one `system/init`, and so did every assumption built
    // on them.** All three carry the same id, so this is one session re-entered rather
    // than three sessions — `withTranscript` writes one line for the three.
    const ids = events.flatMap((e) => (e._tag === "SessionStarted" ? [e.id] : []))
    expect(ids).toEqual(Array.from({ length: 3 }, () => "11111111-2222-4333-8444-555555555555"))
  })

  it("reports a result for each of the three turns the CLI ends", () => {
    // Three `result` frames, and only the first answers the prompt we sent. The other two
    // are turns Claude gave itself when a background task reported back, which is where
    // an agent that waited writes what it waited for — so all three are results.
    const results = events.flatMap((e) => (e._tag === "Result" ? [e.text] : []))
    expect(results).toEqual(["Waiting for background operations to complete...", "done", "done"])
    expect(raw(127)).toMatchObject({ type: "result", origin: { kind: "task-notification" } })
    expect(raw(126)["origin"]).toBeUndefined()
    // And all three are what `CollectText` collects for a turn that filed no envelope.
    // Reading deltas as well would repeat each and add a subagent's top-level text.
    expect(answerOf(events)).toBe(results.join("\n\n"))
  })

  it("still meters a turn Claude gave itself, because the session paid for it", () => {
    // Those turns ran because ours backgrounded work. All three `Usage` events survive,
    // and their costs are non-decreasing because each is the session's running total —
    // added they come to $0.248 against the $0.093 the invocation actually cost.
    const costs = events.flatMap((e) => (e._tag === "Usage" ? [e.runCostUsd] : []))
    expect(costs).toHaveLength(3)
    expect([...costs].sort((a, b) => a - b)).toEqual(costs)
    expect(costs.reduce((a, b) => a + b, 0)).toBeGreaterThan(2 * (costs.at(-1) ?? 0))
  })

  it("bills the turn what the session spent, not the sum of what it was told", () => {
    // The whole point of the fix, over the captured stream rather than three hand-copied
    // numbers: `meter` and this file have to agree about what a `Usage` event means.
    const costs = events.flatMap((e) => (e._tag === "Usage" ? [e.runCostUsd] : []))
    expect(meter(events).costUsd).toBe(costs.at(-1))
    expect(meter(events).costUsd).toBeCloseTo(0.093, 3)
  })

  it("carries run_in_background on the call that asked for it", () => {
    // The source for a delegation card's "background" against "subagent" header.
    // Present on both `Agent` calls, one true and one false — so absent means absent
    // rather than false, which is why it can be read as a tri-state.
    expect(raw(55)).toMatchObject({
      message: { content: [{ input: { run_in_background: false } }] },
    })
    expect(raw(72)).toMatchObject({
      message: { content: [{ input: { run_in_background: true } }] },
    })
    expect(claudeNormalizeLine(lines[72] ?? "")).toEqual([
      {
        _tag: "ToolUse",
        name: "Agent",
        kind: "Task",
        detail: "general-purpose",
        backgrounded: true,
        call: "toolu_01PSXhjwMVDsFdGevAXqJmk9",
        parent: undefined,
      },
    ])
  })

  it("opens a delegation for each Agent call and none for the backgrounded shell one", () => {
    // Three tasks are bracketed here and only two of them are delegations. The shell one
    // is `local_bash` and produces nothing — where its answer, which carries no task_type
    // to gate on, arrives with the other two.
    const opened = events.flatMap((e) => (e._tag === "SubagentStarted" ? [e.call] : []))
    expect(opened).toEqual(["toolu_01Pxf1bfRfg1dE8Gq2bqcfBr", "toolu_01PSXhjwMVDsFdGevAXqJmk9"])
    expect(events.filter((e) => e._tag === "SubagentResult")).toHaveLength(3)
  })

  it("renders none of the eight audited kinds as Unknown except the two with a reason", () => {
    // What the audit was for. Everything still falling through is named in
    // `test/smoke/known-kinds.json` with the reason it cannot be modelled, so a ninth
    // kind fails `pnpm smoke` instead of arriving silently.
    const unknown = new Set(events.flatMap((e) => (e._tag === "Unknown" ? [rawKind(e.raw)] : [])))
    expect([...unknown].sort()).toEqual(["system/task_progress", "system/task_updated"])
  })

  it("answers a backgrounded delegation long after the parent was told it launched", () => {
    // `ToolResult(ok)` for the `Agent` call is "Async agent launched successfully" and
    // arrives immediately; the answer arrives 22 lines later, after the parent has
    // written prose of its own. A card that folds on its tool result folds on the launch.
    //
    // The acknowledgement names the `Agent` call, which is what lets a surface recognise it
    // as the delegation's own rather than as the next outcome the parent was waiting for.
    expect(claudeNormalizeLine(lines[75] ?? "")).toEqual([
      { _tag: "ToolResult", ok: true, call: "toolu_01PSXhjwMVDsFdGevAXqJmk9" },
    ])
    expect(claudeNormalizeLine(lines[97] ?? "")).toEqual([
      {
        _tag: "SubagentResult",
        call: "toolu_01PSXhjwMVDsFdGevAXqJmk9",
        ok: true,
        summary: "The command printed exactly:\n\n```\ndetached\n```",
        outcome: "completed",
        taskId: "a5d25363955cb2b9e",
      },
    ])
  })

  it("models each level as the whole set it replaces the last one with", () => {
    // REPLACE semantics, over the captured turn: the set grows to two, shrinks back to
    // one, and goes empty — and the empty one is a real event, because it is the only
    // thing that says the last job landed. The CLI's own docstring claims the payload
    // "carries ids only"; what it carries is a task_id, a task_type and a description
    // each, and all three are kept for the surfaces that name a job by them.
    const levels = events.flatMap((e) => (e._tag === "BackgroundTasks" ? [e.tasks] : []))
    expect(levels.map((tasks) => tasks.map((t) => t.id))).toEqual([
      ["bnp8c8df9"],
      ["bnp8c8df9", "a5d25363955cb2b9e"],
      ["bnp8c8df9"],
      [],
    ])
    expect(levels[1]?.[1]).toEqual({
      id: "a5d25363955cb2b9e",
      taskType: "local_agent",
      description: "Run echo command in background and report output",
    })
  })

  it("emits no BackgroundStarted from a capture that predates is_backgrounded", () => {
    // The stored fixtures carry no `is_backgrounded`, so the join is absent here and the
    // level is what says which tasks were background work — the compatibility half of
    // the discriminator decision. A current CLI emits the field on every bracket, and
    // the synthetic cases below pin what it produces.
    expect(events.filter((e) => e._tag === "BackgroundStarted")).toHaveLength(0)
  })

  it("carries tool_use_id on every bracket frame it emitted", () => {
    // The open question the capture was run to settle: the 2.1.220 emitter makes the
    // field optional, and no frame in a real turn — shell, inline agent or backgrounded
    // agent — was observed without it. Relaxing the schema is still safe; it is not the
    // reason anything reached `Unknown`.
    const brackets = lines
      .map((_, i) => raw(i))
      .filter((d) => d["subtype"] === "task_started" || d["subtype"] === "task_notification")
    expect(brackets).toHaveLength(6)
    expect(brackets.every((d) => typeof d["tool_use_id"] === "string")).toBe(true)
  })
})

describe("claudeNormalizeLine — what the context window holds", () => {
  // One haiku turn on 2.1.263 that ran a shell command and answered: two model calls,
  // each written as two `assistant` frames — a `thinking` block and the call's own
  // block — carrying the same `usage`, and a `result` line with `modelUsage`.
  const lines = fixture("context-window.captured.jsonl")

  it("reads each assistant frame's usage as what the window held at that call", () => {
    expect(tagsOf(lines)).toEqual([
      "RateLimit",
      "SessionStarted",
      "Thinking",
      "Thinking",
      "Occupancy", // call 1, thinking block
      "Occupancy", // call 1, tool_use block — the same reading again
      "ToolUse",
      "ToolResult",
      "Occupancy", // call 2, thinking block
      "Occupancy", // call 2, text block
      "TextDelta",
      "ContextWindow", // result.modelUsage, one model
      "Usage",
      "Result",
    ])
  })

  it("carries the input side whole and the call's partial output, named by resolved model", () => {
    expect(claudeNormalizeLine(lines[7] ?? "")).toContainEqual({
      _tag: "Occupancy",
      model: "claude-haiku-4-5-20251001",
      call: "msg_011CfJbCCWWUpdyrDVfbqwz2",
      inputTokens: 8,
      outputTokens: 2,
      cacheWriteTokens: 178,
      cacheReadTokens: 23_557,
    })
    // The result line's own count for the same call is 33 out, so the reading is short
    // by the rest of the reply — the under-count `Context` documents.
    expect(claudeNormalizeLine(lines[9] ?? "")).toContainEqual({
      _tag: "Usage",
      inputTokens: 18,
      outputTokens: 161,
      cacheWriteTokens: 178,
      cacheReadTokens: 47_114,
      runCostUsd: 0.006_851_400_000_000_000_5,
    })
  })

  it("emits the same reading once per content block, which the last-wins fold absorbs", () => {
    // Frame 4 is the call's `thinking` block and frame 5 its `tool_use`; the reading
    // heads both, and only the second goes on to a `ToolUse`.
    expect(claudeNormalizeLine(lines[4] ?? "")).toEqual([claudeNormalizeLine(lines[5] ?? "")[0]])
    expect(meter(lines.flatMap(claudeNormalizeLine)).context).toEqual({
      inputTokens: 8,
      outputTokens: 2,
      cacheReadTokens: 23_557,
      cacheWriteTokens: 178,
    })
  })

  it("reads the model's window off the result line, keyed by the resolved model id", () => {
    expect(claudeNormalizeLine(lines[9] ?? "")).toContainEqual({
      _tag: "ContextWindow",
      model: "claude-haiku-4-5-20251001",
      tokens: 200_000,
    })
    expect(meter(lines.flatMap(claudeNormalizeLine)).contextWindow).toBe(200_000)
  })

  it("reads no occupancy off a subagent's frame, whose window is its own", () => {
    const inside = JSON.stringify({
      type: "assistant",
      parent_tool_use_id: "toolu_parent",
      message: {
        model: "claude-haiku-4-5-20251001",
        usage: { input_tokens: 5, cache_read_input_tokens: 9000, output_tokens: 1 },
        content: [{ type: "text", text: "from inside" }],
      },
    })
    expect(tagsOf([inside])).toEqual(["TextDelta"])
  })

  it("reads no occupancy where a frame carries no usage, or writes null for it", () => {
    // The two fixtures that dropped per-message `usage` write `null`, which must not
    // fail the frame: every tool call in them still has to be read.
    const background = fixture("background-work.captured.jsonl")
    expect(tagsOf(background)).not.toContain("Occupancy")
    expect(tagsOf(background)).toContain("ToolUse")
    expect(tagsOf([toolCall("Read", { file_path: "/tmp/a" })])).toEqual(["ToolUse"])
  })

  it("emits a window per model the result line names, so the fold can pick the turn's", () => {
    const twoModels = JSON.stringify({
      type: "result",
      is_error: false,
      result: "done",
      modelUsage: {
        "claude-opus-5": { contextWindow: 1_000_000 },
        "claude-haiku-4-5-20251001": { contextWindow: 200_000, costUSD: 0.01 },
        "claude-mystery": { costUSD: 0.01 },
      },
    })
    expect(claudeNormalizeLine(twoModels)).toEqual([
      { _tag: "ContextWindow", model: "claude-opus-5", tokens: 1_000_000 },
      { _tag: "ContextWindow", model: "claude-haiku-4-5-20251001", tokens: 200_000 },
      { _tag: "Result", text: "done" },
    ])
  })
})

describe("claudeApiErrorKind — pattern matching on prose, and its limits", () => {
  it.each([
    ["Claude AI usage limit reached|1785193200", "rate_limit"],
    ["Credit balance is too low", "rate_limit"],
    ["API Error: 429 Too Many Requests", "rate_limit"],
    ['API Error: 529 {"type":"overloaded_error"}', "overloaded"],
    ["API Error: Server error mid-response. The response above may be incomplete.", "server"],
    ["API Error: 503 Service Unavailable", "server"],
    ["OAuth token has expired", "auth"],
    ["API Error: 401 Invalid API key", "auth"],
    [
      "API Error: Connection closed mid-response. The response above may be incomplete.",
      "interrupted",
    ],
    ["API Error: Connection error.", "interrupted"],
  ])("reads %j as %s", (message, kind) => {
    expect(claudeApiErrorKind(message)).toBe(kind)
  })

  it("separates a dropped connection from a server that answered badly", () => {
    // The pair the two share a sentence shape with, and the distinction the kind is
    // for: one is the transport going, where nothing was refused and re-running costs
    // only the turn; the other is a 5xx, where the API answered and said no.
    expect(claudeApiErrorKind("API Error: Connection closed mid-response.")).toBe("interrupted")
    expect(claudeApiErrorKind("API Error: Server error mid-response.")).toBe("server")
  })

  it("does not read a message that merely mentions a connection as one dropping", () => {
    // `interrupted` is the one kind that says *nothing is wrong with the request*, so
    // it is the most expensive one to reach by accident.
    expect(claudeApiErrorKind("could not open a database connection for the migration")).toBe(
      "unclassified",
    )
  })

  it("reads 529 as overloaded, not as another 5xx", () => {
    // The reason a "is it a 5xx" test is not enough: 529 means come back, and the
    // prose beside it often says "server error" anyway.
    expect(claudeApiErrorKind("API Error: 529 server error")).toBe("overloaded")
  })

  it("prefers the status code to the prose when both are present", () => {
    expect(claudeApiErrorKind("API Error: 429 rate limited, server error follows")).toBe(
      "rate_limit",
    )
  })

  it("defaults to unclassified rather than guessing", () => {
    // The whole reason this heuristic is tolerable. A wrong kind is actionable and
    // wrong; `unclassified` is merely uninformative.
    expect(claudeApiErrorKind("the agent gave up")).toBe("unclassified")
    expect(claudeApiErrorKind("")).toBe("unclassified")
  })

  it("does not read a number in prose as a status code", () => {
    // A code counts only where Claude puts one: after the word "error". Matching
    // `\\b5\\d\\d\\b` anywhere called this a server failure, and the test came first.
    expect(claudeApiErrorKind("the reply was truncated at 500 tokens")).toBe("unclassified")
  })
})

describe("claudeNormalizeLine — malformed input", () => {
  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["not json", "Warning: no stdin data received in 3s"],
    ["truncated json", '{"type":"assis'],
  ])("yields nothing for %s", (_label, line) => {
    expect(claudeNormalizeLine(line)).toEqual([])
  })
})

describe("claudeNormalizeLine — MCP calls", () => {
  it("reads an MCP call as Codex's mcp_tool_call does, with no raw name left on it", () => {
    expect(
      claudeNormalizeLine(toolCall("mcp__acme-admin__regression_reports_find", { report_id: 7 })),
    ).toEqual([
      {
        _tag: "ToolUse",
        name: "mcp_tool_call",
        kind: "Mcp",
        detail: "acme-admin/regression_reports_find",
        backgrounded: undefined,
      },
    ])
  })

  it("splits at the double underscore only, so single ones stay in their name", () => {
    expect(claudeNormalizeLine(toolCall("mcp__claude_ai_Sentry__search_events", {}))).toMatchObject(
      [{ kind: "Mcp", detail: "claude_ai_Sentry/search_events" }],
    )
  })
})
