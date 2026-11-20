/**
 * Tier 2 (`testing-tiers`): the strip against invented jobs, no network.
 *
 * What it pins is the settled round's behaviour: a row per job with the stop press
 * reachable, nothing at all when the set is empty, and the count header only once the
 * list stops showing all of it.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import BackgroundStrip from "./BackgroundStrip"
import type { OutstandingJob } from "./outstanding"
import type { StoppingJob } from "../../useStopJob"

afterEach(cleanup)

const job = (taskId: string, description?: string): OutstandingJob => ({
  taskId,
  description,
  since: Date.now() - 65_000,
})

const stopping = (
  stop = vi.fn<(taskId: string) => void>(),
): StoppingJob & { readonly stop: ReturnType<typeof vi.fn> } => ({
  stop,
  isPending: false,
  disabled: false,
  said: undefined,
})

describe("BackgroundStrip", () => {
  it("draws a row per job, named by the provider's words, with a stop press each", () => {
    render(
      <BackgroundStrip
        jobs={[job("b1", "sleep 300"), job("b2", "pnpm verify")]}
        stopping={stopping()}
      />,
    )
    const list = screen.getByRole("list", { name: "Background work" })
    expect(list).toBeInTheDocument()
    expect(screen.getByText("sleep 300")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Stop pnpm verify" })).toBeInTheDocument()
  })

  it("presses stop with the task id the route speaks", () => {
    const pressed = stopping()
    render(<BackgroundStrip jobs={[job("b1", "sleep 300")]} stopping={pressed} />)
    fireEvent.click(screen.getByRole("button", { name: "Stop sleep 300" }))
    expect(pressed.stop).toHaveBeenCalledWith("b1")
  })

  it("draws nothing at all when the set is empty — the bar is exactly the bar", () => {
    const { container } = render(<BackgroundStrip jobs={[]} stopping={stopping()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("falls back to the task id where nothing ever described the job", () => {
    render(<BackgroundStrip jobs={[job("b9")]} stopping={stopping()} />)
    expect(screen.getByText("b9")).toBeInTheDocument()
  })

  it("adds the count header only once the list stops showing all of it", () => {
    const three = [job("b1"), job("b2"), job("b3")]
    const { rerender } = render(<BackgroundStrip jobs={three} stopping={stopping()} />)
    expect(screen.queryByText("3 running")).not.toBeInTheDocument()
    rerender(<BackgroundStrip jobs={[...three, job("b4")]} stopping={stopping()} />)
    expect(screen.getByText("4 running")).toBeInTheDocument()
  })

  it("draws the list with no press where nothing is driving — a reader on a dead turn", () => {
    render(<BackgroundStrip jobs={[job("b1", "sleep 300")]} stopping={undefined} />)
    expect(screen.getByText("sleep 300")).toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })
})
