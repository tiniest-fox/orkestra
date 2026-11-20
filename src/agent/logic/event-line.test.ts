// Tier-1: what one provider event looks like written down.
//
// The file had no test until an unnamed `Unknown` made 87% of a real transcript
// read as the same four-letter word. Both halves are pinned here now: that every
// event says something specific, and that the one event which by definition
// cannot be understood still says what it was.

import { describe, expect, it } from "vitest"
import { ProviderEvent } from "../types/provider-event.js"
import { eventLine, rawKind } from "./event-line.js"

const call = (
  name: string,
  kind: Parameters<typeof ProviderEvent.ToolUse>[0]["kind"],
  detail: string | undefined,
) =>
  ProviderEvent.ToolUse({
    name,
    kind,
    detail,
    command: undefined,
    backgrounded: undefined,
    call: undefined,
    parent: undefined,
  })

describe("eventLine", () => {
  it("names the tool and what it acted on", () => {
    expect(eventLine(call("Read", "Read", "/tmp/a.ts"))).toBe("Read(/tmp/a.ts)")
    expect(eventLine(call("Bash", "Bash", "git commit"))).toBe("Bash(git commit)")
  })

  it("writes a tool with nothing to show as its name alone", () => {
    expect(eventLine(call("TodoWrite", "Todo", undefined))).toBe("TodoWrite")
  })

  it("says whether a tool answered or failed", () => {
    expect(
      eventLine(ProviderEvent.ToolResult({ ok: true, call: undefined, parent: undefined })),
    ).toBe("ToolResult(ok)")
    expect(
      eventLine(ProviderEvent.ToolResult({ ok: false, call: undefined, parent: undefined })),
    ).toBe("ToolResult(error)")
  })

  it("writes thinking without its token estimate", () => {
    // `withTranscript` records one of these per burst of ticks, so the first
    // tick's estimate would stand for a burst many times its size. The number
    // stays on the event for a live watcher.
    expect(eventLine(ProviderEvent.Thinking({ tokens: 8, text: undefined }))).toBe("Thinking")
    expect(eventLine(ProviderEvent.Thinking({ tokens: undefined, text: undefined }))).toBe(
      "Thinking",
    )
  })

  it("writes the provider's summary of a pause after the word, where it gave one", () => {
    // The one thing about a pause a reader can use once the turn has moved on, so it
    // goes in the stored line rather than staying on the event.
    expect(
      eventLine(
        ProviderEvent.Thinking({ tokens: undefined, text: "Planning file size counting method" }),
      ),
    ).toBe("Thinking: Planning file size counting method")
  })

  it("leads an ApiError with its kind and keeps the sentence", () => {
    expect(
      eventLine(
        ProviderEvent.ApiError({ kind: "rate_limit", message: "Credit balance is too low" }),
      ),
    ).toBe("ApiError(rate_limit: Credit balance is too low)")
  })

  it("counts a retry's attempts, and drops a status the provider did not give", () => {
    // The pause this explains is otherwise indistinguishable from a model thinking.
    expect(
      eventLine(ProviderEvent.ApiRetry({ attempt: 2, of: 5, status: "429", waitedMs: 1200 })),
    ).toBe("ApiRetry(429, attempt 2/5)")
    expect(
      eventLine(
        ProviderEvent.ApiRetry({ attempt: 1, of: 5, status: undefined, waitedMs: undefined }),
      ),
    ).toBe("ApiRetry(attempt 1/5)")
  })

  it("says what a quota broadcast said, and renders its reset as a date", () => {
    // Epoch seconds. Rendered rather than stored, so a wrong unit shows as 1970.
    expect(
      eventLine(
        ProviderEvent.RateLimit({
          exhausted: true,
          usingOverage: true,
          resetsAt: 1_785_193_200,
          windows: undefined,
        }),
      ),
    ).toBe("RateLimit(exhausted, on overage, resets 2026-07-27T23:00:00.000Z)")
  })

  it("keeps a quota broadcast that says nothing short", () => {
    expect(
      eventLine(
        ProviderEvent.RateLimit({
          exhausted: false,
          usingOverage: false,
          resetsAt: undefined,
          windows: undefined,
        }),
      ),
    ).toBe("RateLimit(ok)")
  })

  it("names the kind of an event nothing models", () => {
    // Not a kind claude actually sends: every one of those is now a real event, so
    // an example here has to be invented — which is the state this should stay in.
    const raw = { type: "brand_new_kind", subtype: "surprise" }
    expect(eventLine(ProviderEvent.Unknown({ raw }))).toBe("Unknown(brand_new_kind/surprise)")
  })
})

describe("rawKind", () => {
  it("joins type and subtype, which is how a stream kind is named everywhere here", () => {
    // The same spelling `smoke.ts` compares against `known-kinds.json`. Two copies
    // of this would drift without either being wrong.
    expect(rawKind({ type: "system", subtype: "thinking_tokens" })).toBe("system/thinking_tokens")
  })

  it("uses the type alone when there is no subtype", () => {
    expect(rawKind({ type: "rate_limit_event" })).toBe("rate_limit_event")
  })

  it("ignores a subtype that is not a string, rather than printing one", () => {
    expect(rawKind({ type: "system", subtype: 7 })).toBe("system")
  })

  it("names a Codex line by its method, which is where an app-server message says its kind", () => {
    expect(rawKind({ method: "thread/compacted", params: { threadId: "t" } })).toBe(
      "thread/compacted",
    )
  })

  it("adds the item's own type on a Codex item line, where the kind is two levels down", () => {
    // Every `item/*` notification names the same method; `params.item.type` is the word.
    expect(rawKind({ method: "item/completed", params: { item: { id: "i", type: "plan" } } })).toBe(
      "item/completed/plan",
    )
  })

  it.each([
    // Through `JSON.parse`, which is both how `raw` really arrives and the way to
    // write the case the engine's `unicorn/no-null` bans as a literal. It is the
    // one that matters most: `typeof null === "object"`, so the guard needs it.
    ["null", JSON.parse("null")],
    ["a string", "not an object"],
    ["an object with no type", { message: "hello" }],
  ])("says unrecognised for %s", (_label, raw) => {
    // `raw` is by definition a shape this codebase has never seen, so every read
    // of it is defensive — a thrown error here would be a crash caused by the
    // fallback that exists to prevent crashes.
    expect(rawKind(raw)).toBe("unrecognised")
  })
})
