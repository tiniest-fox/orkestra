/**
 * The card a view draws in, and the frame under it: what the frame is allowed, and what
 * a message from it does.
 *
 * happy-dom runs no script inside a frame, so nothing here is a view drawing. What it can
 * hold is the two things a browser is then trusted with — the frame's attributes — and
 * the host's half of a call: a message from this frame's own window reaches the press,
 * and one from anywhere else does not.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { RefusedError } from "../../../../api/http"
import type { ViewResultDto } from "../../../../api/types"
import { makeTool, makeView, makeViewEntry } from "../../../../fixtures"
import type { Viewed } from "../../../../format/transcriptRows"
import type { TrakViewsValue } from "./useViews"
import ViewCard, { TrakViews } from "./ViewCard"

afterEach(cleanup)

const viewed: Viewed = {
  view: makeViewEntry({ call: "c1" }),
  call: makeTool({ kind: "Mcp", call: "c1" }),
  ok: true,
}

const views = (over: Partial<TrakViewsValue> = {}): TrakViewsValue => ({
  isOpen: () => true,
  toggle: () => undefined,
  view: () => makeView(),
  unread: () => false,
  press: () => Promise.resolve({ content: [], isError: false }),
  running: false,
  phone: false,
  ...over,
})

const drawn = (value: TrakViewsValue): ReactNode => (
  <TrakViews views={value}>
    <ol>
      <ViewCard viewed={viewed} />
    </ol>
  </TrakViews>
)

const frameOf = (): HTMLIFrameElement =>
  screen.getByTitle<HTMLIFrameElement>("metrics/show_dashboard")

/** A message as the browser delivers one from the frame's own window. */
const fromFrame = (data: unknown, source: Window | null = frameOf().contentWindow): void => {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source }))
  })
}

type Press = TrakViewsValue["press"]
const EMPTY: ViewResultDto = { content: [], isError: false }

/** A press whose answer the test lands when it chooses. */
const held = (): { readonly press: Press; readonly land: (result: ViewResultDto) => void } => {
  const waiting: ((result: ViewResultDto) => void)[] = []
  return {
    press: () =>
      new Promise<ViewResultDto>((resolve) => {
        waiting.push(resolve)
      }),
    land: (result) => {
      for (const resolve of waiting.splice(0)) resolve(result)
    },
  }
}

const call = {
  jsonrpc: "2.0",
  id: 9,
  method: "tools/call",
  params: { name: "press", arguments: {} },
}

describe("ViewCard", () => {
  it("draws the view in a frame that may run script and nothing else, fed by srcdoc", () => {
    render(drawn(views()))
    const frame = frameOf()
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts")
    expect(frame.getAttribute("srcdoc")).toBe("<p>dashboard</p>")
    expect(frame.hasAttribute("src")).toBe(false)
  })

  it("is its header alone while folded, and a press on the header asks to open it", () => {
    const toggle = vi.fn<(call: string) => void>()
    render(drawn(views({ isOpen: () => false, toggle })))
    expect(screen.queryByTitle("metrics/show_dashboard")).toBeNull()
    const header = screen.getByRole("button", { name: /metrics\/show_dashboard/ })
    expect(header.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(header)
    expect(toggle).toHaveBeenCalledWith("c1")
  })

  it("says so where the view could not be read", () => {
    render(drawn(views({ view: () => undefined, unread: () => true })))
    expect(screen.getByText("This view could not be read.")).toBeDefined()
  })

  it("sends a call from its own frame through the press and posts the result back", async () => {
    const result: ViewResultDto = { content: [], structured: { count: 1 }, isError: false }
    const press = vi.fn<Press>(() => Promise.resolve(result))
    render(drawn(views({ press })))
    const post = vi.spyOn(frameOf().contentWindow ?? window, "postMessage")
    fromFrame(call)
    expect(press).toHaveBeenCalledWith("c1", "press", {})
    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        { jsonrpc: "2.0", id: 9, result: { content: [], structuredContent: { count: 1 } } },
        "*",
      )
    })
  })

  it("ignores the same message from any other window", () => {
    const press = vi.fn<Press>(() => Promise.resolve(EMPTY))
    render(drawn(views({ press })))
    fromFrame(call, window)
    expect(press).not.toHaveBeenCalled()
  })

  it("answers nothing once its frame has loaded a second document", () => {
    const press = vi.fn<Press>(() => Promise.resolve(EMPTY))
    render(drawn(views({ press })))
    // The served document, then whatever the frame went to. Its messages come from the
    // same window, which is why the source alone cannot refuse them.
    fireEvent.load(frameOf())
    fromFrame(call)
    expect(press).toHaveBeenCalledTimes(1)
    fireEvent.load(frameOf())
    fromFrame(call)
    expect(press).toHaveBeenCalledTimes(1)
  })

  it("veils the view while the CLI a first press needs is starting, and not during a turn", async () => {
    const { press, land } = held()
    const { rerender } = render(drawn(views({ press })))
    fromFrame(call)
    expect(screen.getByRole("status").textContent).toBe("Starting claude to send your press")
    act(() => {
      land(EMPTY)
    })
    await waitFor(() => {
      expect(screen.queryByRole("status")).toBeNull()
    })

    rerender(drawn(views({ press, running: true })))
    fromFrame(call)
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("draws a band over the view where the CLI did not start", async () => {
    const refused = new RefusedError(
      503,
      { _tag: "CliNotStarted", cli: "claude", reason: "exit 1" },
      "/x",
    )
    render(drawn(views({ press: () => Promise.reject(refused) })))
    fromFrame(call)
    expect((await screen.findByRole("alert")).textContent).toBe(
      "claude did not start, so your press was not sent. Press again to retry.",
    )
  })

  it("dims a view whose checkout is gone, says why, and sends nothing", () => {
    const press = vi.fn<Press>(() => Promise.resolve(EMPTY))
    render(drawn(views({ press, view: () => makeView({ answers: false }) })))
    expect(screen.getByText(/checkout is removed/)).toBeDefined()
    fromFrame(call)
    expect(press).not.toHaveBeenCalled()
  })

  it("cuts a view taller than the cap and grows it in place on Show all", () => {
    render(drawn(views()))
    fromFrame({
      jsonrpc: "2.0",
      method: "ui/notifications/size-changed",
      params: { height: 880 },
    })
    fireEvent.click(screen.getByRole("button", { name: "Show all · 880px" }))
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull()
    expect(frameOf().style.height).toBe("880px")
  })
})
