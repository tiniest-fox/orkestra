// Tier-1: which provider events the store keeps structure for, and which it flattens.
//
// The split is the whole point of the function, and it is what the SSE stream rests on:
// a frame is an entry, so anything `entryOf` throws away is gone from every surface at
// once. `Text` is here because it was a `Note` reading `TextDelta(482 chars)` — the
// longest stretch of a turn recorded as its own length.

import { describe, expect, it } from "vitest"
import { ProviderEvent } from "../types/provider-event.js"
import { SessionId } from "../types/session.js"
import { entryOf } from "./transcript-entry.js"

const call = (over: Partial<Parameters<typeof ProviderEvent.ToolUse>[0]> = {}) =>
  ProviderEvent.ToolUse({
    name: "Read",
    kind: "Read",
    detail: "/tmp/a.ts",
    command: undefined,
    backgrounded: undefined,
    call: undefined,
    parent: undefined,
    ...over,
  })

describe("entryOf", () => {
  it("keeps the tool's own name beside the normalized kind", () => {
    expect(entryOf(call())).toEqual({
      _tag: "Tool",
      name: "Read",
      kind: "Read",
      detail: "/tmp/a.ts",
    })
  })

  it("leaves detail off a tool with nothing to show", () => {
    // Absent rather than an empty string: `exactOptionalPropertyTypes` keeps absent
    // absent through a round trip, and the surfaces branch on it.
    expect(entryOf(call({ name: "TodoWrite", kind: "Todo", detail: undefined }))).toEqual({
      _tag: "Tool",
      name: "TodoWrite",
      kind: "Todo",
    })
  })

  it("structures the two events that bracket a turn", () => {
    expect(entryOf(ProviderEvent.Spawned({ pid: 4321 }))).toEqual({ _tag: "Spawned", pid: 4321 })
    expect(entryOf(ProviderEvent.SessionStarted({ id: SessionId.make("abc") }))).toEqual({
      _tag: "Session",
      id: "abc",
    })
  })

  it("structures a re-ask, which is what says the next spawn is not a new turn", () => {
    // Flattened to a `Note` it would be indistinguishable from the engine's other
    // bookkeeping, and a reader counting spawns against endings would place a turn's
    // document one turn early.
    expect(entryOf(ProviderEvent.Reask({ reason: "no JSON found in response" }))).toEqual({
      _tag: "Reask",
      reason: "no JSON found in response",
    })
  })

  it("keeps what a person said to the running turn whole, and drops the harness's key", () => {
    // The words are the entry; the key names a log event and means nothing to a reader.
    expect(entryOf(ProviderEvent.MessageDelivered({ text: "keep --json", key: "m1" }))).toEqual({
      _tag: "Said",
      text: "keep --json",
    })
  })

  it("keeps what the agent said whole", () => {
    // The assertion this file exists for. `eventLine` writes the length for the places
    // that want a line; the store is the only record of the words themselves, so a
    // count here would lose them for every surface at once.
    const said = "Looking at the two adapters before I change either.\n\nThe first one…"
    expect(entryOf(ProviderEvent.TextDelta({ text: said, parent: undefined }))).toEqual({
      _tag: "Text",
      text: said,
    })
  })

  it("keeps the command behind a described call, and adds no key where there is none", () => {
    const described = call({
      name: "Bash",
      kind: "Bash",
      detail: "Run the touched specs",
      command: "bin/rspec spec/models",
    })
    expect(entryOf(described)).toMatchObject({ command: "bin/rspec spec/models" })
    expect("command" in entryOf(call())).toBe(false)
  })

  it("keeps a detached call marked, and says nothing about an inline one", () => {
    // The one thing on the wire that separates a subagent the turn is blocked on from
    // one it is not. Absent rather than `false` on the inline side, because that is what
    // every call already on disk has and a surface must read the two the same way.
    expect(entryOf(call({ backgrounded: true }))).toMatchObject({ backgrounded: true })
    expect("backgrounded" in entryOf(call())).toBe(false)
  })

  it("structures a retry, because a surface has to place it rather than print it", () => {
    // It belongs on the pause it interrupted, in waiting ink. As a `Note` the only way
    // to find it again would be a prefix match on rendered text, which makes the
    // display the source of a fact about the stream.
    expect(
      entryOf(ProviderEvent.ApiRetry({ attempt: 2, of: 5, status: "429", waitedMs: 1200 })),
    ).toEqual({ _tag: "ApiRetry", attempt: 2, of: 5, status: "429", waitedMs: 1200 })
  })

  it("leaves the status off a retry the provider gave no status for", () => {
    // A transport failure got no HTTP response, and absent is the honest shape of that.
    expect(
      entryOf(
        ProviderEvent.ApiRetry({ attempt: 1, of: 5, status: undefined, waitedMs: undefined }),
      ),
    ).toEqual({ _tag: "ApiRetry", attempt: 1, of: 5 })
  })

  it("flattens everything else to the line eventLine already writes", () => {
    expect(
      entryOf(ProviderEvent.ToolResult({ ok: false, call: undefined, parent: undefined })),
    ).toEqual({
      _tag: "Note",
      text: "ToolResult(error)",
    })
    expect(entryOf(ProviderEvent.Thinking({ tokens: 8, text: undefined }))).toEqual({
      _tag: "Note",
      text: "Thinking",
    })
  })
})

describe("entryOf, on a delegation", () => {
  it("carries the ids a delegation is grouped by, and leaves them off when there are none", () => {
    // Both directions in one place: `call` is what a `Subagent` points at, `parent` is
    // the delegation this call happened inside. Absent on the agent's own lines, which
    // is every line of every transcript written before this existed.
    expect(entryOf(call({ call: "toolu_1", parent: "toolu_0" }))).toMatchObject({
      call: "toolu_1",
      parent: "toolu_0",
    })
    expect(entryOf(call())).toEqual({
      _tag: "Tool",
      name: "Read",
      kind: "Read",
      detail: "/tmp/a.ts",
    })
  })

  it("structures both ends of a delegation, and keeps the brief and the answer", () => {
    // The two facts nothing else in a trak records: what the subagent was asked, and
    // what it handed back. Both reach the parent agent and neither reached the store.
    expect(
      entryOf(
        ProviderEvent.SubagentStarted({
          call: "toolu_1",
          agentType: "general-purpose",
          description: "review the round",
          prompt: "Read the diff and say what is wrong.",
        }),
      ),
    ).toEqual({
      _tag: "Subagent",
      call: "toolu_1",
      agentType: "general-purpose",
      description: "review the round",
      prompt: "Read the diff and say what is wrong.",
    })

    expect(
      entryOf(
        ProviderEvent.SubagentResult({
          call: "toolu_1",
          ok: true,
          summary: "Two findings.",
          outcome: "completed",
          taskId: "task_9",
        }),
      ),
    ).toEqual({
      _tag: "SubagentResult",
      call: "toolu_1",
      ok: true,
      summary: "Two findings.",
      outcome: "completed",
      taskId: "task_9",
    })
  })

  it("leaves a delegation that said less than the full four with the fields it gave", () => {
    expect(
      entryOf(
        ProviderEvent.SubagentStarted({
          call: "toolu_2",
          agentType: undefined,
          description: undefined,
          prompt: undefined,
        }),
      ),
    ).toEqual({ _tag: "Subagent", call: "toolu_2" })
  })

  it("keeps a tool outcome inside the delegation it happened in, and on the call it answers", () => {
    // The one `Note` that carries either id. Without `parent` a subagent's failures count
    // against the parent's list; without `call` a surface has to count outcomes onto the
    // calls above them, which is wrong as soon as two are open at once.
    expect(
      entryOf(ProviderEvent.ToolResult({ ok: true, call: "toolu_2", parent: "toolu_1" })),
    ).toEqual({ _tag: "Note", text: "ToolResult(ok)", call: "toolu_2", parent: "toolu_1" })
  })
})

describe("entryOf, on a hook", () => {
  it("structures a hook, leaving off what the provider did not say", () => {
    const output = [{ kind: "stop", text: "not allowed" }]
    expect(
      entryOf(
        ProviderEvent.HookRan({
          call: "exec-1",
          event: "preToolUse",
          status: "blocked",
          durationMs: 3,
          source: undefined,
          message: undefined,
          output,
        }),
      ),
    ).toEqual({
      _tag: "Hook",
      call: "exec-1",
      event: "preToolUse",
      status: "blocked",
      durationMs: 3,
      output,
    })
  })
})
