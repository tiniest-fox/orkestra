/**
 * Tier 2: the chat bar's footer — the spend row under the box and the context line under that —
 * in the states the wire can put a position in. The folds are `usage.ts`'s and the
 * arithmetic `squares.ts`'s, each tested beside it; this asserts what a reader is shown,
 * for the position the page hands over.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { EventDto, TurnInFlightDto } from "../../../api/types"
import { makeAgentReturned, makeReadUsage, makeTurnInFlight } from "../../../fixtures"
import { stepRow } from "../family/map.fixtures"
import type { MapRow } from "../family/rows"
import { stepUsage } from "../tokens/usage"
import type { Chat } from "./useSendChat"
import TrakChatBar from "./TrakChatBar"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const chat: Chat = {
  draft: "",
  write: () => undefined,
  send: () => undefined,
  isPending: false,
  disabled: false,
  said: undefined,
  attached: {
    files: [],
    refusal: undefined,
    add: () => undefined,
    remove: () => undefined,
    ids: [],
    uploading: false,
    clear: () => undefined,
  },
}

const row = (at: number, over: Partial<MapRow> = {}): MapRow => ({
  ...stepRow,
  at,
  window: 1_000_000,
  turns: [{ session: "s-a", at, entries: [] }],
  ...over,
})

/** One turn at `step` that spent `spent`, all cache reads, and — where given — was read at `held`. */
const ended = (step: number, spent: number, held?: number): EventDto =>
  makeAgentReturned({
    step,
    sessionId: "s-a",
    usage: makeReadUsage(
      held === undefined
        ? undefined
        : { inputTokens: 0, cacheReadTokens: held, cacheWriteTokens: 0, outputTokens: 0 },
      undefined,
      { inputTokens: 0, cacheReadTokens: spent, cacheWriteTokens: 0, outputTokens: 0 },
    ),
  })

/** The record's turn at step 4, read at `read`, having spent four times that. */
const reading = (read: number): TurnInFlightDto =>
  makeTurnInFlight({
    step: 4,
    usage: makeReadUsage(
      { inputTokens: 0, cacheReadTokens: read, cacheWriteTokens: 0, outputTokens: 0 },
      undefined,
      { inputTokens: 0, cacheReadTokens: read * 4, cacheWriteTokens: 0, outputTokens: 0 },
    ),
  })

const bar = (at: MapRow, log: readonly EventDto[], inFlight?: TurnInFlightDto) => (
  <TrakChatBar
    chat={chat}
    usage={stepUsage(at, log, inFlight)}
    model={undefined}
    effort={undefined}
    phone={false}
  />
)

/** The track as the layout would size it — happy-dom lays nothing out, so every box is 0 wide. */
const trackWidth = (px: number): void => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(px)
}

const squaresIn = (): { readonly whole: number; readonly partial: number } => {
  const track = screen.getByRole("img", { name: /of a full row/ })
  const all = [...track.children]
  const partial = all.filter((s) => s.className.includes("ring-1")).length
  return { whole: all.length - partial, partial }
}

describe("TrakChatBar — the step's usage", () => {
  it("fills 28% of the row for a 5.6m step, at a desk track and a phone track", () => {
    trackWidth(638)
    render(bar(row(3), [ended(3, 5_600_000, 150_000)]))
    expect(screen.getByText("5.6m")).toBeDefined()
    expect(screen.getByRole("img", { name: "28% of a full row" })).toBeDefined()
    // 80 squares fit, so 22 whole and the 23rd 40% filled.
    expect(squaresIn()).toEqual({ whole: 22, partial: 1 })
    cleanup()

    trackWidth(246)
    render(bar(row(3), [ended(3, 5_600_000, 150_000)]))
    // 31 fit, so each is worth more: 8 whole and a ninth 68% filled — still 28%.
    expect(squaresIn()).toEqual({ whole: 8, partial: 1 })
    expect(screen.queryByText(/^×/)).toBeNull()
  })

  it("keeps the row full past 20m and says how many rows' worth", () => {
    trackWidth(638)
    render(bar(row(3), [ended(3, 49_100_000, 740_000)]))
    expect(squaresIn()).toEqual({ whole: 80, partial: 0 })
    expect(screen.getByText("×2.5")).toBeDefined()
  })

  it("draws the reading as the line at the bar's foot, and opens what is in it", () => {
    render(bar(row(3), [ended(3, 2_700_000, 150_000)]))
    expect(screen.getByText("15%")).toBeDefined()
    const line = screen.getByRole("button", { name: "What is in the context window" })
    expect(line.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(line)
    expect(screen.getByText("free")).toBeDefined()
    expect(screen.getByText("/ 1.0m")).toBeDefined()
    fireEvent.keyDown(line, { key: "Escape" })
    expect(screen.queryByText("free")).toBeNull()
  })

  it("lets a pinned breakdown go on a press anywhere outside the line, blur or no blur", () => {
    // iOS Safari never focuses a tapped button, so a blur is not a dismissal there.
    render(bar(row(3), [ended(3, 2_700_000, 150_000)]))
    const line = screen.getByRole("button", { name: "What is in the context window" })
    fireEvent.click(line)
    fireEvent.pointerDown(line)
    expect(screen.getByText("free")).toBeDefined()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByText("free")).toBeNull()
  })

  it("follows the position on screen, and grows the running one between readings", () => {
    const log = [ended(2, 430_000, 61_000), ended(3, 2_700_000, 150_000)]
    const { rerender } = render(bar(row(3), log))
    expect(screen.getByText("2.7m")).toBeDefined()
    expect(screen.getByText("15%")).toBeDefined()
    // Stepping back to position 2 shows its own spend and its own last reading.
    rerender(bar(row(2), log))
    expect(screen.getByText("430k")).toBeDefined()
    expect(screen.getByText("6%")).toBeDefined()

    // Position 4 is running with no ending yet; the record's reading and estimate grow it.
    const live = row(4, { status: "running", turns: [] })
    rerender(bar(live, log, reading(100_000)))
    expect(screen.getByText("400k")).toBeDefined()
    expect(screen.getByText("10%")).toBeDefined()
    rerender(bar(live, log, reading(300_000)))
    expect(screen.getByText("1.2m")).toBeDefined()
    expect(screen.getByText("30%")).toBeDefined()
  })

  it("draws the row with no line and no percentage where spend was never read", () => {
    render(bar(row(3), [ended(3, 1_000_000)]))
    expect(screen.getByText("1.0m")).toBeDefined()
    expect(screen.queryByText(/%$/)).toBeNull()
    expect(screen.queryByText("ctx")).toBeNull()
    expect(screen.queryByRole("button", { name: "What is in the context window" })).toBeNull()
  })

  it("draws neither where nothing was measured", () => {
    render(bar(row(3), [makeAgentReturned({ step: 3, usage: undefined })]))
    expect(screen.queryByRole("img", { name: /of a full row/ })).toBeNull()
    expect(screen.queryByRole("button", { name: "What is in the context window" })).toBeNull()
    // The bar itself is still there to type into.
    expect(screen.getByRole("textbox", { name: "Say something to the agent" })).toBeDefined()
  })

  it("says the reading itself where no window is known, since a percentage would be a claim", () => {
    render(bar(row(3, { window: undefined }), [ended(3, 1_000_000, 320_000)]))
    expect(screen.getByText("320k")).toBeDefined()
    expect(screen.getByText("ctx")).toBeDefined()
    expect(screen.queryByText(/%$/)).toBeNull()
  })
})

/** The model and effort token, which leads the row under the box rather than the header. */
describe("TrakChatBar — the step's model", () => {
  const withModel = (log: readonly EventDto[]) => (
    <TrakChatBar
      chat={chat}
      usage={stepUsage(row(3), log, undefined)}
      model="codex/gpt-5.6-sol"
      effort="high"
      phone={false}
    />
  )

  it("leads the spend row, before the figure", () => {
    render(withModel([ended(3, 1_000_000)]))
    const token = screen.getByLabelText("Model gpt-5.6-sol, effort high")
    const figure = screen.getByText("1.0m")
    // Document order is reading order: the token comes first in the row.
    expect(token.compareDocumentPosition(figure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("draws alone where nothing was spent yet, and nothing where there is no model either", () => {
    const { rerender } = render(withModel([makeAgentReturned({ step: 3, usage: undefined })]))
    expect(screen.getByLabelText("Model gpt-5.6-sol, effort high")).toBeDefined()
    expect(screen.queryByRole("img", { name: /of a full row/ })).toBeNull()
    rerender(bar(row(3), [makeAgentReturned({ step: 3, usage: undefined })]))
    expect(screen.queryByLabelText(/^Model /)).toBeNull()
  })
})

/**
 * The box's one button while a turn runs. Which states offer the stop is
 * `controls.test.ts`'s; what is here is the swap, which only a render shows.
 */
describe("the one button while a turn runs", () => {
  const stopping = { stop: () => undefined, isPending: false, disabled: false, said: undefined }
  const running = (draft: string) => (
    <TrakChatBar
      chat={{ ...chat, draft }}
      stopping={stopping}
      usage={undefined}
      model={undefined}
      effort={undefined}
      phone={false}
    />
  )

  it("stops while the field is empty", () => {
    render(running(""))
    expect(screen.getByRole("button", { name: "Stop the agent" })).toBeDefined()
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull()
  })

  it("sends once the field holds text, and whitespace is not text", () => {
    const { rerender } = render(running("keep --json"))
    expect(screen.getByRole("button", { name: "Send" })).toBeDefined()
    expect(screen.queryByRole("button", { name: "Stop the agent" })).toBeNull()
    rerender(running("   "))
    expect(screen.getByRole("button", { name: "Stop the agent" })).toBeDefined()
  })
})

/** The filing pair on a phone: one `⋯` holding both — `BreakOutMenu`. */
describe("the break-out presses on a phone", () => {
  const filing = { file: vi.fn<() => void>(), isPending: false, disabled: false, said: undefined }
  const open = vi.fn<() => void>()
  const recomposing = {
    asking: false,
    open,
    cancel: () => undefined,
    draft: "",
    write: () => undefined,
    send: () => undefined,
    isPending: false,
    disabled: false,
    said: undefined,
  }
  const at = (phone: boolean) => (
    <TrakChatBar
      chat={chat}
      filing={filing}
      recomposing={recomposing}
      usage={undefined}
      model={undefined}
      effort={undefined}
      phone={phone}
    />
  )

  it("draws one menu in place of the two presses, and the desk keeps the pair", () => {
    const { rerender } = render(at(true))
    expect(screen.queryByRole("button", { name: "File it" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Recompose" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "More actions" }))
    expect(screen.getByRole("menuitem", { name: "File it" })).toBeDefined()
    expect(screen.getByRole("menuitem", { name: "Recompose" })).toBeDefined()
    rerender(at(false))
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull()
    expect(screen.getByRole("button", { name: "File it" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Recompose" })).toBeDefined()
  })

  it("acts on the item pressed and shuts the menu", () => {
    render(at(true))
    fireEvent.click(screen.getByRole("button", { name: "More actions" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "File it" }))
    expect(filing.file).toHaveBeenCalledOnce()
    expect(screen.queryByRole("menu")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "More actions" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Recompose" }))
    expect(open).toHaveBeenCalledOnce()
  })
})
