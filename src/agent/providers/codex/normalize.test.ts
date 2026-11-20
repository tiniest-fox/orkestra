// Unit tests for override point 2 of the Codex provider, run against the runs
// captured in `test/fixtures/codex/`. Hand-written JSON would test my imagination;
// captured output tests Codex.

import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { answerOf } from "../../logic/answer.js"
import { rawKind } from "../../logic/event-line.js"
import { meter } from "../../logic/meter.js"
import type { ProviderEvent } from "../../types/provider-event.js"
import { codexApiErrorKind, codexNormalizer, codexRolloutLine } from "./normalize.js"

const fixture = (name: string): readonly string[] =>
  readFileSync(new URL(`../../../../test/fixtures/codex/${name}`, import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")

/** One reader per fixture, as the harness builds one per spawn. */
const eventsOf = (lines: readonly string[]): readonly ProviderEvent[] => {
  const normalize = codexNormalizer()
  return lines.flatMap(normalize)
}

const tagsOf = (lines: readonly string[]): readonly string[] => eventsOf(lines).map((e) => e._tag)

// The thread and the turn a hand-written line is about, and a reader that has been
// told both — a notification is read only where it names the two the answers named.
const THREAD = "thread-1"
const TURN = "turn-1"
const started = (): ((line: string) => readonly ProviderEvent[]) => {
  const normalize = codexNormalizer()
  normalize(JSON.stringify({ id: 2, result: { thread: { id: THREAD } } }))
  normalize(JSON.stringify({ id: 3, result: { turn: { id: TURN } } }))
  return normalize
}

/** One item notification of the given phase, with whatever the case under test says about the item. */
const itemLine = (
  phase: "started" | "completed",
  item: Record<string, unknown>,
  on: { readonly threadId: string; readonly turnId: string } = { threadId: THREAD, turnId: TURN },
): string =>
  JSON.stringify({ method: `item/${phase}`, params: { item: { id: "item_9", ...item }, ...on } })

/** A `turn/completed` for the given thread and turn, with whatever the case says about the turn. */
const endLine = (turn: Record<string, unknown>, threadId = THREAD, turnId = TURN): string =>
  JSON.stringify({ method: "turn/completed", params: { threadId, turn: { id: turnId, ...turn } } })

describe("codexNormalizer — a launch with one shell call", () => {
  const lines = fixture("launch-shell-call.captured.jsonl")

  it("maps the whole run to the expected event sequence", () => {
    expect(tagsOf(lines)).toEqual([
      "SessionStarted", // the answer to thread/start
      // turn/started, the prompt read back and an empty reasoning item produce nothing
      "TextDelta", // the narration before the command
      "ToolUse", // item/started commandExecution
      "ToolResult", // item/completed commandExecution
      "RateLimit", // account/rateLimits/updated, after each model call
      "TextDelta", // the answer, as the agent's words
      "RateLimit",
      "Usage", // turn/completed
      "Result", // …and the answer settled
    ])
  })

  it("lifts the thread id out of the thread request's answer, as the session", () => {
    expect(eventsOf(lines)).toContainEqual({
      _tag: "SessionStarted",
      id: "01a12cbb-f6f2-7870-80d4-38be064756ea",
    })
  })

  it("settles the answer on the LAST message, not the first", () => {
    // The run narrated before it acted. A reader that took the first message as the
    // answer would hand `extractJson` the narration.
    expect(answerOf(eventsOf(lines))).toBe("DONE")
  })

  it("writes each message once and whole, whatever the deltas before it carried", () => {
    // Fifteen `item/agentMessage/delta` lines spell the narration a token at a time.
    expect(eventsOf(lines).filter((e) => e._tag === "TextDelta")).toEqual([
      {
        _tag: "TextDelta",
        text: "I’ll run the requested shell command, then respond with the required word.",
        parent: undefined,
      },
      { _tag: "TextDelta", text: "DONE", parent: undefined },
    ])
  })

  it("names a shell call as Bash with the command, joined to its result by item id", () => {
    const events = eventsOf(lines)
    expect(events).toContainEqual({
      _tag: "ToolUse",
      name: "commandExecution",
      kind: "Bash",
      detail: "/bin/zsh -lc 'echo hello-orkestra'",
      backgrounded: undefined,
      call: "exec-4e534d59-50c8-4325-b2ac-2544cd4be4d2",
      parent: undefined,
    })
    expect(events).toContainEqual({
      _tag: "ToolResult",
      ok: true,
      call: "exec-4e534d59-50c8-4325-b2ac-2544cd4be4d2",
      parent: undefined,
    })
  })

  it("reports one usage for the turn — every call's count added, the cache taken back out of the input, and no cost", () => {
    // Two model calls, so two `thread/tokenUsage/updated`: 11,685 in with 9,984 cached
    // and 98 out, then 11,811 in with 11,008 cached and 5 out. `turn/completed` itself
    // carries no usage.
    expect(eventsOf(lines).filter((e) => e._tag === "Usage")).toEqual([
      {
        _tag: "Usage",
        inputTokens: 11_685 - 9984 + (11_811 - 11_008),
        outputTokens: 98 + 5,
        cacheWriteTokens: 0,
        cacheReadTokens: 9984 + 11_008,
        runCostUsd: 0,
      },
    ])
    expect(meter(eventsOf(lines)).costUsd).toBe(0)
  })

  it("leaves nothing to Unknown", () => {
    expect(tagsOf(lines)).not.toContain("Unknown")
  })
})

describe("codexNormalizer — a resume", () => {
  const lines = fixture("resume-by-id.captured.jsonl")

  it("announces the same session, and the one message is the answer", () => {
    const events = eventsOf(lines)
    expect(events[0]).toEqual({
      _tag: "SessionStarted",
      id: "01a12cbb-f6f2-7870-80d4-38be064756ea",
    })
    expect(answerOf(events)).toBe("DONE")
  })

  it("counts this turn's calls alone, not the count the thread replays as it opens", () => {
    // A resumed thread's first `thread/tokenUsage/updated` names the turn before this
    // one and repeats its last call — 11,839 in. Added, it would bill that call twice.
    expect(eventsOf(lines).filter((e) => e._tag === "Usage")).toEqual([
      {
        _tag: "Usage",
        inputTokens: 11_867 - 11_008,
        outputTokens: 79,
        cacheWriteTokens: 0,
        cacheReadTokens: 11_008,
        runCostUsd: 0,
      },
    ])
  })

  it("leaves nothing to Unknown", () => {
    expect(tagsOf(lines)).not.toContain("Unknown")
  })
})

describe("codexNormalizer — a resume of a thread Codex has no rollout for", () => {
  it("reads the refused request as the turn failing, in the server's own words", () => {
    expect(eventsOf(fixture("resume-miss.captured.jsonl"))).toEqual([
      {
        _tag: "ApiError",
        kind: "unclassified",
        message: "no rollout found for thread id 01a12cbb-0000-7000-8000-000000000000",
      },
    ])
  })
})

describe("codexNormalizer — file changes and a command that failed", () => {
  const lines = fixture("file-change.captured.jsonl")

  it("reads an add as Write and an update as Edit, with the path", () => {
    const tools = eventsOf(lines).filter((e) => e._tag === "ToolUse")
    expect(tools).toMatchObject([
      { name: "fileChange", kind: "Write", detail: "/tmp/codex-as-work/probe.txt" },
      { name: "fileChange", kind: "Edit", detail: "/tmp/codex-as-work/probe.txt" },
      { name: "commandExecution", kind: "Bash" },
    ])
  })

  it("joins each outcome to its own call by id, so the failure lands on the command", () => {
    const events = eventsOf(lines)
    const uses = events.flatMap((e) => (e._tag === "ToolUse" ? [e.call] : []))
    const results = events.flatMap((e) => (e._tag === "ToolResult" ? [e] : []))
    expect(results.map((r) => r.call)).toEqual(uses)
    expect(results.map((r) => r.ok)).toEqual([true, true, false])
  })

  it("still settles the answer: a failed command is not a failed turn", () => {
    expect(answerOf(eventsOf(lines))).toBe("DONE")
    expect(tagsOf(lines)).not.toContain("ApiError")
  })

  it("leaves nothing to Unknown", () => {
    expect(tagsOf(lines)).not.toContain("Unknown")
  })
})

describe("codexNormalizer — a command with a pre and a post hook", () => {
  const lines = fixture("hooks.captured.jsonl")
  const command = "exec-d6b53aa2-9261-406a-9589-35f3601fb883"

  it("reads each finished hook as one HookRan naming the command's item id", () => {
    const hooks = eventsOf(lines).filter((e) => e._tag === "HookRan")
    expect(hooks).toEqual([
      expect.objectContaining({
        call: command,
        event: "preToolUse",
        status: "completed",
        durationMs: 3,
        source: "/private/tmp/ork-codex-home/hooks.json",
        message: undefined,
        output: [],
      }),
      expect.objectContaining({ call: command, event: "postToolUse", status: "completed" }),
    ])
  })

  it("places the pre hook before the call and the post hook after its outcome", () => {
    expect(tagsOf(lines).filter((t) => t !== "TextDelta")).toEqual([
      "SessionStarted",
      "Unknown", // account/updated
      "HookRan",
      "ToolUse",
      "ToolResult",
      "HookRan",
      "RateLimit",
      "RateLimit",
      // The capture ends at the thread going idle, before any `turn/completed`.
    ])
  })

  it("leaves no hook line to Unknown", () => {
    const normalize = codexNormalizer()
    const unknown = lines.flatMap((line) =>
      normalize(line).flatMap((e) => (e._tag === "Unknown" ? [rawKind(e.raw)] : [])),
    )
    expect(unknown).toEqual(["account/updated"])
  })
})

/** A hook run as `hook/completed` carries it, a path holding a colon included. */
const hookRun = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: "pre-tool-use:0:C:/hooks.json:exec-1",
  eventName: "preToolUse",
  status: "completed",
  sourcePath: "C:/hooks.json",
  durationMs: 4,
  entries: [],
  ...over,
})

/**
 * A `hook/completed` line. `turnId` is spliced in as text so a hook about the thread can
 * say `null`, which is what the protocol writes there.
 */
const hookLine = (run: Record<string, unknown>, turnId = `"${TURN}"`): string =>
  `{"method":"hook/completed","params":{"threadId":"${THREAD}","turnId":${turnId},"run":${JSON.stringify(run)}}}`

describe("codexNormalizer — a hook's own line", () => {
  it("takes the call after the last colon, so a path holding one does not shift it", () => {
    expect(started()(hookLine(hookRun({})))).toMatchObject([{ _tag: "HookRan", call: "exec-1" }])
  })

  it("carries a blocked hook's message and what it printed", () => {
    const entries = [{ kind: "stop", text: "rm -rf outside the worktree" }]
    expect(
      started()(hookLine(hookRun({ status: "blocked", statusMessage: "exit 2", entries }))),
    ).toMatchObject([{ status: "blocked", message: "exit 2", output: entries }])
  })

  it("names no call for a hook about the turn, and reads one whose turn is null", () => {
    const stop = hookRun({ id: "stop:0:/h.json", eventName: "stop", status: "failed" })
    expect(started()(hookLine(stop, "null"))).toMatchObject([
      { _tag: "HookRan", event: "stop", call: undefined, status: "failed" },
    ])
  })

  it("earns nothing for another turn's hook", () => {
    expect(started()(hookLine(hookRun({}), `"turn-other"`))).toEqual([])
  })

  it("leaves a status it cannot colour to Unknown", () => {
    expect(started()(hookLine(hookRun({ status: "running" })))).toMatchObject([{ _tag: "Unknown" }])
  })

  it("reads a hook starting as nothing", () => {
    const line = JSON.stringify({
      method: "hook/started",
      params: { threadId: THREAD, turnId: TURN, run: hookRun({ status: "running" }) },
    })
    expect(started()(line)).toEqual([])
  })
})

/** A quota line whose `rateLimits` is `json`, as Codex writes it — `null` included. */
const quotaLine = (json: string): string =>
  `{"method":"account/rateLimits/updated","params":{"rateLimits":${json}}}`

const windowsOf = (line: string): unknown => {
  const event = codexNormalizer()(line)[0]
  return event?._tag === "RateLimit" ? event.windows : "not a RateLimit"
}

describe("codexNormalizer — the plan's quota", () => {
  it("reads the five-hour and weekly windows of each quota line, resets in milliseconds", () => {
    const limits = eventsOf(fixture("hooks.captured.jsonl")).filter((e) => e._tag === "RateLimit")
    // The capture's last line: `primary` 43% of 300 minutes, `secondary` 13% of 10080.
    expect(limits.at(-1)).toEqual({
      _tag: "RateLimit",
      exhausted: false,
      usingOverage: false,
      resetsAt: undefined,
      windows: [
        { kind: "five_hour", utilization: 43, resetsAt: 1_793_128_086_000 },
        { kind: "seven_day", utilization: 13, resetsAt: 1_793_633_175_000 },
      ],
    })
  })

  it("reads a quota line from any thread, since the quota is the account's", () => {
    const lines = fixture("subagent.captured.jsonl")
    const quotaLines = lines.filter((l) => l.includes("account/rateLimits/updated"))
    expect(tagsOf(lines).filter((t) => t === "RateLimit")).toHaveLength(quotaLines.length)
  })

  it("drops a window of a length the indicator does not draw", () => {
    expect(
      windowsOf(
        quotaLine(
          `{"primary":{"usedPercent":12,"windowDurationMins":60,"resetsAt":1},` +
            `"secondary":{"usedPercent":3,"windowDurationMins":10080,"resetsAt":null}}`,
        ),
      ),
    ).toEqual([{ kind: "seven_day", utilization: 3 }])
  })

  it("carries no windows where none is one the indicator draws", () => {
    expect(windowsOf(quotaLine(`{"primary":null,"secondary":null}`))).toBeUndefined()
    expect(
      windowsOf(
        quotaLine(`{"primary":{"usedPercent":1,"windowDurationMins":60},"secondary":null}`),
      ),
    ).toBeUndefined()
  })

  it("adds nothing for a failed or a killed turn, whose streams carry no quota line", () => {
    for (const name of ["unknown-model.captured.jsonl", "sigkill.captured.jsonl"]) {
      expect(tagsOf(fixture(name))).not.toContain("RateLimit")
    }
  })
})

describe("codexNormalizer — a failed turn", () => {
  const lines = fixture("unknown-model.captured.jsonl")

  it("reports the error as an ApiError carrying the whole message", () => {
    const events = eventsOf(lines)
    const errors = events.filter((e) => e._tag === "ApiError")
    // The `error` notification and `turn/completed` carry the same sentence; the
    // harness fails the stream at the first, and the second is read only by a reader
    // that never saw the first.
    expect(errors).toHaveLength(2)
    expect(errors[0]).toMatchObject({ kind: "unclassified" })
    expect(errors[0]?._tag === "ApiError" ? errors[0].message : "").toContain(
      "is not supported when using Codex with a ChatGPT account",
    )
  })

  it("settles no answer, and draws nothing for the warning that came first", () => {
    expect(tagsOf(lines)).toEqual(["SessionStarted", "ApiError", "ApiError"])
  })
})

describe("codexNormalizer — a turn cut off by a signal", () => {
  it("ends with whatever arrived and no answer, which is what a killed turn leaves", () => {
    const events = eventsOf(fixture("sigkill.captured.jsonl"))
    expect(events.map((e) => e._tag)).toEqual(["SessionStarted", "TextDelta", "ToolUse"])
    // The narration is all the answer fold has: a killed turn is read from the deltas.
    expect(answerOf(events)).toBe("Running `sleep 30` now.")
  })
})

describe("codexNormalizer — one reader per spawn", () => {
  it("carries neither the answer nor the count from one turn into the next", () => {
    const first = codexNormalizer()
    fixture("launch-shell-call.captured.jsonl").flatMap(first)
    const second = started()
    const events = [endLine({ status: "completed" })].flatMap(second)
    expect(events).toEqual([
      {
        _tag: "Usage",
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        runCostUsd: 0,
      },
      { _tag: "Result", text: "" },
    ])
  })
})

describe("codexNormalizer — reasoning", () => {
  it("reads a reasoning item as a pause carrying the model's summary, ahead of the answer it planned", () => {
    const events = eventsOf(fixture("reasoning.captured.jsonl"))
    expect(events.map((e) => e._tag)).toEqual([
      "SessionStarted",
      "Thinking", // the reasoning item, at its completion
      "TextDelta",
      "RateLimit",
      "Usage",
      "Result",
    ])
    expect(events[1]).toEqual({
      _tag: "Thinking",
      tokens: undefined,
      text: "Comparing rg/xargs wc to language-aware traversal for efficient line counting",
    })
  })

  it("splits an item holding two summary parts into two pauses, without the bold markers", () => {
    const line = itemLine("completed", {
      type: "reasoning",
      summary: ["**Evaluating encoding options**", "**Comparing lookup trade-offs**"],
    })
    expect(started()(line)).toEqual([
      { _tag: "Thinking", tokens: undefined, text: "Evaluating encoding options" },
      { _tag: "Thinking", tokens: undefined, text: "Comparing lookup trade-offs" },
    ])
  })

  it("reads an item with no summary as nothing, rather than an empty pause", () => {
    // What every reasoning item is at its start, and at its end too on a turn that
    // spent no summary — `launch-shell-call.captured.jsonl` has one.
    expect(started()(itemLine("started", { type: "reasoning", summary: [] }))).toEqual([])
    expect(started()(itemLine("completed", { type: "reasoning", summary: [] }))).toEqual([])
    expect(started()(itemLine("completed", { type: "reasoning", summary: ["\n"] }))).toEqual([])
  })
})

describe("codexNormalizer — shapes the protocol documents and no run produced", () => {
  it("reads an MCP call as Mcp, named server/tool", () => {
    expect(
      started()(itemLine("started", { type: "mcpToolCall", server: "linear", tool: "issue" })),
    ).toMatchObject([{ _tag: "ToolUse", name: "mcpToolCall", kind: "Mcp", detail: "linear/issue" }])
  })

  it("reads a web search by its shared kind, and as done when it completes with no status", () => {
    expect(started()(itemLine("started", { type: "webSearch", query: "effect ts" }))).toMatchObject(
      [{ _tag: "ToolUse", kind: "WebSearch", detail: "effect ts" }],
    )
    expect(started()(itemLine("completed", { type: "webSearch", query: "effect ts" }))).toEqual([
      { _tag: "ToolResult", ok: true, call: "item_9", parent: undefined },
    ])
  })

  it("files an item type it has never seen as Unknown, named by the method and the type", () => {
    const events = started()(itemLine("completed", { type: "somethingNew" }))
    expect(events).toMatchObject([{ _tag: "Unknown" }])
    expect(events[0]?._tag === "Unknown" ? rawKind(events[0].raw) : undefined).toBe(
      "item/completed/somethingNew",
    )
  })

  it("files a notification it has never seen as Unknown, named by its method", () => {
    const events = codexNormalizer()(JSON.stringify({ method: "thread/somethingNew", params: {} }))
    expect(events[0]?._tag === "Unknown" ? rawKind(events[0].raw) : undefined).toBe(
      "thread/somethingNew",
    )
  })

  it("files a message with no text as nothing, rather than an empty delta", () => {
    expect(started()(itemLine("completed", { type: "agentMessage" }))).toEqual([])
  })

  it("fails the turn on a request of the server's own, which nothing would ever answer", () => {
    // An approval the thread's `approvalPolicy` should have ruled out. Unanswered, the
    // turn waits on it without end.
    const request = JSON.stringify({
      method: "item/commandExecution/requestApproval",
      id: 7,
      params: {},
    })
    expect(codexNormalizer()(request)).toEqual([
      {
        _tag: "ApiError",
        kind: "unclassified",
        message:
          "codex asked for item/commandExecution/requestApproval, which nothing here answers",
      },
    ])
  })

  it("does not fail a turn on an error Codex says it will retry", () => {
    const error = (willRetry: boolean): string =>
      JSON.stringify({
        method: "error",
        params: {
          error: { message: "stream disconnected" },
          willRetry,
          threadId: THREAD,
          turnId: TURN,
        },
      })
    expect(started()(error(true))).toEqual([])
    // The same line without the promise is the failure, so the case above is the flag's doing.
    expect(started()(error(false))).toMatchObject([{ _tag: "ApiError" }])
  })

  it("reads an interrupted turn as a failure of that kind, with no answer", () => {
    expect(started()(endLine({ status: "interrupted" }))).toMatchObject([
      { _tag: "ApiError", kind: "interrupted" },
    ])
  })

  it.each([
    "item/commandExecution/outputDelta",
    "item/fileChange/outputDelta",
    "item/fileChange/patchUpdated",
    "item/mcpToolCall/progress",
    "item/reasoning/textDelta",
  ])("draws nothing for %s — the growth of an item read whole at its completion", (method) => {
    const line = JSON.stringify({ method, params: { threadId: THREAD, turnId: TURN, delta: "x" } })
    expect(started()(line)).toEqual([])
  })
})

describe("codexNormalizer — a turn that spawns a subagent", () => {
  // One real turn told to spawn a subagent and wait for it. The subagent ran on a
  // thread of its own, and that thread's turn, items, counts and ending all arrived on
  // this connection between the parent's `wait` starting and completing.
  const lines = fixture("subagent.captured.jsonl")
  const events = eventsOf(lines)

  it("settles one Result, the parent's last message, and only where the parent's turn ends", () => {
    expect(events.filter((e) => e._tag === "Result")).toEqual([{ _tag: "Result", text: "PARENT" }])
    expect(events.at(-1)?._tag).toBe("Result")
    // The subagent's `turn/completed` is the first in the file, with the parent's
    // answer still to come. Read up to and including it, nothing has ended.
    const firstEnd = lines.findIndex((line) => line.includes('"method":"turn/completed"'))
    expect(firstEnd).toBeLessThan(lines.length - 1)
    expect(tagsOf(lines.slice(0, firstEnd + 1))).not.toContain("Result")
  })

  it("writes none of the subagent's words as the parent's", () => {
    const texts = events.flatMap((e) => (e._tag === "TextDelta" ? [e.text] : []))
    expect(texts).toHaveLength(2)
    expect(texts.at(-1)).toBe("PARENT")
    expect(texts).not.toContain("CHILD")
  })

  it("counts the parent's three calls and neither of the subagent's", () => {
    // The parent: 12,550 in with 9,984 cached, 22,094 with 12,032, 22,371 with 21,248.
    // The subagent's two, 12,522 and 12,602 in, name its own thread.
    expect(events.filter((e) => e._tag === "Usage")).toEqual([
      {
        _tag: "Usage",
        inputTokens: 12_550 - 9984 + (22_094 - 12_032) + (22_371 - 21_248),
        outputTokens: 68 + 126 + 6,
        cacheWriteTokens: 0,
        cacheReadTokens: 9984 + 12_032 + 21_248,
        runCostUsd: 0,
      },
    ])
  })

  it("draws the spawn as a Task carrying the subagent's prompt, and the wait as a call named for itself", () => {
    expect(events.filter((e) => e._tag === "ToolUse")).toMatchObject([
      {
        name: "spawnAgent",
        kind: "Task",
        detail: "Run the shell command 'echo from-the-subagent' and reply with the word CHILD.",
      },
      { name: "wait", kind: "Other", detail: undefined },
    ])
    // The command the subagent ran is its own thread's, and is not a call of this turn.
    expect(events.filter((e) => e._tag === "ToolUse" && e.kind === "Bash")).toEqual([])
    expect(events.filter((e) => e._tag === "ToolResult")).toHaveLength(2)
  })

  it("leaves nothing to Unknown", () => {
    expect(events.map((e) => e._tag)).not.toContain("Unknown")
  })
})

describe("codexNormalizer — a message steered into the turn", () => {
  const TANGERINE = "New message from me: end your final answer with the word TANGERINE."

  // One real turn steered while a web search ran. The steer was answered at once and
  // the model received the message only once the search had come back.
  it("reports the delivery under the key it was sent with, after the call it waited on", () => {
    expect(tagsOf(fixture("steered.captured.jsonl"))).toEqual([
      "SessionStarted",
      "TextDelta",
      "ToolUse", // item/started webSearch, which is when the steer was written
      "ToolResult",
      "RateLimit",
      "MessageDelivered", // item/started userMessage — once, though it completes too
      "TextDelta",
      "RateLimit",
      "Usage",
      "Result",
    ])
    expect(eventsOf(fixture("steered.captured.jsonl"))).toContainEqual({
      _tag: "MessageDelivered",
      key: "ork-key-1",
      text: TANGERINE,
    })
  })

  // One real turn steered while its subagent ran a command. A steer naming the
  // subagent's turn was refused first; the one naming the parent's was taken, and
  // reached the parent only when its `wait` came back.
  it("reports it once on a turn waiting on a subagent, and never from the subagent's thread", () => {
    const events = eventsOf(fixture("steered-subagent.captured.jsonl"))
    expect(events.filter((e) => e._tag === "MessageDelivered")).toEqual([
      { _tag: "MessageDelivered", key: "ork-key-1", text: TANGERINE },
    ])
    const waited = events.findLastIndex((e) => e._tag === "ToolResult")
    expect(events.findIndex((e) => e._tag === "MessageDelivered")).toBeGreaterThan(waited)
    expect(answerOf(events)).toBe("PARENT TANGERINE")
  })

  it("fails nothing on a refused steer — both runs hold one, and both answer", () => {
    for (const name of ["steered.captured.jsonl", "steered-subagent.captured.jsonl"]) {
      expect(fixture(name).some((line) => line.includes('"error":{"code":-32600'))).toBe(true)
      expect(tagsOf(fixture(name))).not.toContain("ApiError")
      expect(tagsOf(fixture(name))).not.toContain("Unknown")
    }
  })

  it("reports nothing for a turn's own prompt, which carries no key", () => {
    // Written as text because the wire says `null` there, as the captured runs do.
    const prompt = `{"method":"item/started","params":{"threadId":"${THREAD}","turnId":"${TURN}","item":{"type":"userMessage","id":"item_9","clientId":null,"content":[{"type":"text","text":"go"}]}}}`
    expect(started()(prompt)).toEqual([])
  })

  it("reports nothing for a keyed message on another thread", () => {
    const theirs = {
      type: "userMessage",
      clientId: "key-1",
      content: [{ type: "text", text: "x" }],
    }
    expect(
      started()(itemLine("started", theirs, { threadId: "thread-2", turnId: "turn-2" })),
    ).toEqual([])
  })

  it("still fails the turn on a refused opening request", () => {
    const refused = JSON.stringify({ id: 3, error: { code: -32_600, message: "no such thread" } })
    expect(codexNormalizer()(refused)).toMatchObject([{ _tag: "ApiError" }])
  })
})

describe("codexNormalizer — a message Codex started as a turn of its own", () => {
  // One real process: a turn that answered OK, a steer refused because that turn had
  // ended, and the same message sent as a second `turn/start` on the thread.
  const events = eventsOf(fixture("late-message.captured.jsonl"))

  it("reads the second turn as the first is read, each settling its own answer", () => {
    expect(events.map((e) => e._tag)).toEqual([
      "SessionStarted",
      "TextDelta",
      "RateLimit",
      "Usage",
      "Result",
      "MessageDelivered", // the second turn's own userMessage item carries the key
      "TextDelta",
      "RateLimit",
      "Usage",
      "Result",
    ])
    expect(events.flatMap((e) => (e._tag === "Result" ? [e.text] : []))).toEqual(["OK", "QUINCE"])
    // The first is the step's answer, and the harness is what says so: it withholds a
    // result written after an answer that had nothing to wait for. The fold reads
    // whatever it is handed.
    expect(answerOf(events)).toBe("OK\n\nQUINCE")
  })

  it("counts each turn's calls once, the second starting from nothing", () => {
    // 12,514 in with 9,984 cached, then 12,539 with 12,032.
    expect(events.flatMap((e) => (e._tag === "Usage" ? [e.inputTokens] : []))).toEqual([
      12_514 - 9984,
      12_539 - 12_032,
    ])
  })

  it("reports the delivery under the key the turn was started with", () => {
    expect(events).toContainEqual({
      _tag: "MessageDelivered",
      key: "ork-key-2",
      text: "New message from me: reply with exactly the word QUINCE.",
    })
  })
})

describe("codexNormalizer — which thread and turn a line is about", () => {
  const elsewhere = { threadId: "thread-2", turnId: "turn-2" }

  it("ends nothing on another thread's turn/completed, and nothing on another turn of this thread", () => {
    expect(started()(endLine({ status: "completed" }, "thread-2", "turn-2"))).toEqual([])
    expect(started()(endLine({ status: "completed" }, THREAD, "turn-0"))).toEqual([])
  })

  it("fails nothing on another thread's error", () => {
    const line = JSON.stringify({
      method: "error",
      params: { error: { message: "the subagent failed" }, willRetry: false, ...elsewhere },
    })
    expect(started()(line)).toEqual([])
  })

  it("keeps another thread's message out of the answer", () => {
    const normalize = started()
    normalize(itemLine("completed", { type: "agentMessage", text: "mine" }))
    expect(
      normalize(itemLine("completed", { type: "agentMessage", text: "theirs" }, elsewhere)),
    ).toEqual([])
    expect(normalize(endLine({ status: "completed" })).at(-1)).toEqual({
      _tag: "Result",
      text: "mine",
    })
  })

  it("does not take the turn from turn/started, which a subagent's thread sends too", () => {
    const normalize = started()
    normalize(
      JSON.stringify({
        method: "turn/started",
        params: { threadId: "thread-2", turn: { id: "turn-2" } },
      }),
    )
    expect(normalize(endLine({ status: "completed" }, "thread-2", "turn-2"))).toEqual([])
    expect(normalize(endLine({ status: "completed" }))).toMatchObject([
      { _tag: "Usage" },
      { _tag: "Result" },
    ])
  })

  it("reads no turn's lines before the turn request is answered", () => {
    // Nothing has said which turn is this spawn's, so no line can be shown to be.
    const normalize = codexNormalizer()
    normalize(JSON.stringify({ id: 2, result: { thread: { id: THREAD } } }))
    expect(normalize(endLine({ status: "completed" }))).toEqual([])
  })
})

describe("codexNormalizer — an ending it cannot classify", () => {
  // The server never exits on its own, so an ending filed as `Unknown` is a process
  // that waits without limit. Each of these has to fail the turn instead.
  it("fails the turn on a status nothing here reads, naming it", () => {
    expect(started()(endLine({ status: "paused" }))).toEqual([
      {
        _tag: "ApiError",
        kind: "unclassified",
        message: "codex ended the turn with status paused, which nothing here reads",
      },
    ])
  })

  it.each([
    ["no status", {}],
    ["a status that is not a word", { status: 7 }],
    ["an error that is not an object", { status: "failed", error: "boom" }],
  ])("fails the turn on an ending with %s", (_label, turn) => {
    expect(started()(endLine(turn))).toMatchObject([{ _tag: "ApiError", kind: "unclassified" }])
  })
})

describe("codexRolloutLine — the session log beside the stream", () => {
  // The rollout Codex wrote for a launch with one shell call, on 0.154.0: two model
  // calls, each followed by a `token_usage_record` and a `token_count`. The turn's one
  // `Usage` is the two calls added.
  const lines = fixture("rollout-launch-shell-call.captured.jsonl")

  it("reads a per-call reading and the window off each token_count, and nothing else", () => {
    expect(lines.flatMap(codexRolloutLine).map((e) => e._tag)).toEqual([
      "ContextWindow",
      "Occupancy",
      "ContextWindow",
      "Occupancy",
    ])
  })

  it("takes the last call's usage, with the cache taken back out of the input", () => {
    expect(codexRolloutLine(lines[20] ?? "")).toEqual([
      { _tag: "ContextWindow", model: undefined, tokens: 258_400 },
      {
        _tag: "Occupancy",
        model: undefined,
        call: undefined,
        inputTokens: 13_401 - 13_184,
        outputTokens: 5,
        cacheWriteTokens: 0,
        cacheReadTokens: 13_184,
      },
    ])
  })

  it("folds to the last call, where the stream's total is both calls added", () => {
    // 13,311 then 13,401 in: the turn's `Usage` says 26,712, which is what the meter's
    // sum rule wants and the window never held.
    const folded = meter(lines.flatMap(codexRolloutLine))
    expect(folded.context).toEqual({
      inputTokens: 217,
      outputTokens: 5,
      cacheWriteTokens: 0,
      cacheReadTokens: 13_184,
    })
    expect(folded.contextWindow).toBe(258_400)
    expect(folded.inputTokens + folded.cacheReadTokens).toBe(0)
  })

  it("reads nothing off a token_count that carries only rate limits", () => {
    // Written as the log writes it: `info` is the JSON null, not a value this codebase has.
    const limitsOnly =
      '{"type":"event_msg","payload":{"type":"token_count","info":null,"rate_limits":{"limit_id":"codex"}}}'
    expect(codexRolloutLine(limitsOnly)).toEqual([])
  })

  it("is not held to cover the log, so a line it does not read is nothing rather than Unknown", () => {
    expect(codexRolloutLine(lines[0] ?? "")).toEqual([])
    expect(codexRolloutLine("not json")).toEqual([])
    expect(codexRolloutLine("")).toEqual([])
  })
})

describe("codexApiErrorKind", () => {
  it.each([
    ["401", "auth"],
    ["403", "auth"],
    ["429", "rate_limit"],
    ["500", "server"],
    ["503", "server"],
    ["400", "unclassified"],
  ] as const)("reads status %s off the JSON message as %s", (status, kind) => {
    expect(codexApiErrorKind(`{"type":"error","status":${status},"error":{}}`)).toBe(kind)
  })

  it("leaves a message that is not JSON unclassified — there is no code to read", () => {
    expect(codexApiErrorKind("something went wrong")).toBe("unclassified")
    expect(codexApiErrorKind("")).toBe("unclassified")
  })

  it.each([
    ["usageLimitExceeded", "rate_limit"],
    ["rateLimitExceeded", "rate_limit"],
    ["serverOverloaded", "overloaded"],
    ["internalServerError", "server"],
    ["unauthorized", "auth"],
  ] as const)("takes Codex's own word %s as %s, whatever the message says", (info, kind) => {
    expect(codexApiErrorKind("You've hit your usage limit.", info)).toBe(kind)
  })

  it("reads the status off a word that carries one", () => {
    expect(
      codexApiErrorKind("stream closed", { responseStreamDisconnected: { httpStatusCode: 503 } }),
    ).toBe("server")
  })

  it("falls back to the message where Codex says only `other`", () => {
    expect(codexApiErrorKind('{"type":"error","status":429}', "other")).toBe("rate_limit")
    expect(codexApiErrorKind("something went wrong", "other")).toBe("unclassified")
  })
})
