/**
 * What a background job's card says. `turns.test.ts` decides which entries become a
 * job; this decides what is on screen — chiefly the outcome word, because `stopped`
 * drawn as anything louder is the misreading the field exists to remove.
 *
 * Rendered bare, as `SubagentGroup.test.tsx` is: the job is the whole input.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { makeSubagentResult, makeTool } from "../../../../fixtures"
import JobCard from "./JobCard"
import type { Job } from "../../../../format/transcriptRows"

afterEach(cleanup)

const running: Job = {
  head: makeTool({
    name: "Bash",
    kind: "Bash",
    detail: "pnpm verify",
    call: "toolu_bg",
    backgrounded: true,
    at: 1_000,
  }),
  report: undefined,
  ok: undefined,
  description: "Run the whole gate",
  taskId: "b1",
}

const landed = (outcome: "completed" | "failed" | "stopped"): Job => ({
  ...running,
  report: makeSubagentResult({
    call: "toolu_bg",
    ok: outcome !== "failed",
    outcome,
    summary: "exit 0",
    at: 61_000,
  }),
  ok: outcome !== "failed",
})

describe("JobCard", () => {
  it("heads with the command, marked background, and its description under it", () => {
    render(<JobCard job={running} live />)

    expect(screen.getByText("pnpm verify")).toBeDefined()
    expect(screen.getByText("background")).toBeDefined()
    expect(screen.getByText("Run the whole gate")).toBeDefined()
    // Running: a clock, and no outcome word yet.
    expect(screen.queryByText("completed")).toBeNull()
  })

  it("heads a described call with its command, and draws the description once", () => {
    // The call's `detail` is the agent's description and `task_started` repeats it, so a
    // header read off `detail` drew the description twice and the command nowhere.
    const described: Job = {
      ...running,
      head: makeTool({
        name: "Bash",
        kind: "Bash",
        detail: "Run sleep 25 and echo bg-done in background",
        command: "sleep 25 && echo bg-done",
        call: "toolu_bg",
        backgrounded: true,
        at: 1_000,
      }),
      description: "Run sleep 25 and echo bg-done in background",
    }
    render(<JobCard job={described} live />)

    expect(screen.getByText("sleep 25 && echo bg-done")).toBeDefined()
    expect(screen.getAllByText("Run sleep 25 and echo bg-done in background")).toHaveLength(1)
  })

  it.each([["completed"], ["failed"], ["stopped"]] as const)(
    "ends on the report's own word — %s — with how long it ran and its last word",
    (outcome) => {
      render(<JobCard job={landed(outcome)} />)

      expect(screen.getByText(outcome)).toBeDefined()
      expect(screen.getByText("1m 0s")).toBeDefined()
      expect(screen.getByText("exit 0")).toBeDefined()
    },
  )

  it("says nothing about an ending nothing observed", () => {
    // A stored turn torn down before the work landed: no report, no word, no clock — a
    // duration counting up here is the confident wrong fact the treatment removes.
    render(<JobCard job={running} />)

    expect(screen.queryByText(/completed|failed|stopped/)).toBeNull()
    expect(screen.queryByText(/\ds/)).toBeNull()
  })

  it("offers the stop press while running, named by the job, with the task id behind it", () => {
    const stop = vi.fn<(taskId: string) => void>()
    render(
      <JobCard
        job={running}
        live
        stopJob={{ stop, isPending: false, disabled: false, said: undefined }}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Stop Run the whole gate" }))
    expect(stop).toHaveBeenCalledWith("b1")
  })

  it("offers no press on a job that has landed, and none on a dead turn's card", () => {
    const stopJob = {
      stop: vi.fn<(taskId: string) => void>(),
      isPending: false,
      disabled: false,
      said: undefined,
    }
    render(<JobCard job={landed("completed")} live stopJob={stopJob} />)
    render(<JobCard job={running} stopJob={stopJob} />)
    expect(screen.queryByRole("button")).toBeNull()
  })
})
