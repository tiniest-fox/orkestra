/**
 * Tier 2 (`testing-tiers`): RTL, no network — a finish that hands work off, drawn as the
 * plan it is.
 *
 * **The failure worth a render test is a hand-off read as a spawn**, or a finish read as
 * a plain sentence: the block has to sit under its own label with the branch named on
 * it, the head has to count the traks approving opens, and a finish handing nothing off
 * has to draw no card at all — `ComposerOutputView` holds that last one. A finish
 * proposing a goal is the same card, with the goal under its own label.
 *
 * The opened state draws links, so those cases mount a memory router around the card.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router"
import type { ComposerOutputDto } from "../../../../api/types"
import ComposerOutputView from "../../turns/output/ComposerOutputView"
import FinishedCard from "./FinishedCard"

afterEach(cleanup)

type Finished = Extract<ComposerOutputDto, { type: "finished" }>

const OFF = "Fix the deploy hook, which fires against the wrong host once this branch is live."
const SECOND =
  "Give the condition waits a backoff, so a slow deploy stops being asked every minute."

const handingOff: Finished = {
  type: "finished",
  reason: "The branch is in, and what the check found cannot be built on it.",
  handOff: [OFF],
}

/** A router around one component, because a link cannot render outside one. */
const inRouter = (element: React.ReactElement): void => {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => element }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  })
  render(<RouterProvider router={router} />)
}

describe("a finish that hands work off", () => {
  it("is a card with nothing to run, counting what approving opens, with the reason on it", () => {
    render(
      <FinishedCard
        finished={handingOff}
        atGate={undefined}
        handOffBase="main"
        opened={undefined}
        goalOpened={undefined}
      />,
    )

    expect(screen.getByText("The work is done · 1 new trak")).toBeDefined()
    expect(screen.getByText(handingOff.reason)).toBeDefined()
  })

  it("draws the hand-off under its own label, with the base branch named on it", () => {
    render(
      <FinishedCard
        finished={handingOff}
        atGate={undefined}
        handOffBase="main"
        opened={undefined}
        goalOpened={undefined}
      />,
    )

    const block = screen.getByRole("region", { name: "Work for a new trak" })
    expect(block.textContent).toContain(OFF)
    expect(block.textContent).toContain("main")
    expect(screen.getByText("New trak")).toBeDefined()
  })

  it("says so where the repository names no default branch, because approving would fail on it", () => {
    render(
      <FinishedCard
        finished={handingOff}
        atGate={undefined}
        handOffBase={undefined}
        opened={undefined}
        goalOpened={undefined}
      />,
    )

    expect(screen.getByText("no default branch")).toBeDefined()
  })

  it("counts several on the label as one set, never one label each", () => {
    render(
      <FinishedCard
        finished={{ ...handingOff, handOff: [OFF, SECOND] }}
        atGate={undefined}
        handOffBase="main"
        opened={undefined}
        goalOpened={undefined}
      />,
    )

    expect(screen.getByText("The work is done · 2 new traks")).toBeDefined()
    expect(screen.getByText("New trak · 2 new traks")).toBeDefined()
    expect(screen.getAllByRole("region", { name: "Work for a new trak" })).toHaveLength(1)
  })

  it("points at the traks once they are opened, and drops the branch and the prose", async () => {
    inRouter(
      <FinishedCard
        finished={handingOff}
        atGate={undefined}
        handOffBase={undefined}
        opened={["quiet-emerald-capybara"]}
        goalOpened={undefined}
      />,
    )

    // Awaited: the router mounts its route on the next tick.
    expect(await screen.findByText("Opened as a new trak")).toBeDefined()
    expect(screen.getByRole("link", { name: "quiet-emerald-capybara" })).toBeDefined()
    expect(screen.queryByText(OFF)).toBeNull()
    expect(screen.queryByText("no default branch")).toBeNull()
  })
})

describe("a finish that hands work off on a goal's trak", () => {
  it("names the goal as where it goes, with no branch, while the gate is open", () => {
    render(
      <FinishedCard
        finished={handingOff}
        atGate={undefined}
        handOffBase={{ goal: "ship-goals" }}
        opened={undefined}
        goalOpened={undefined}
      />,
    )

    expect(screen.getByText("The work is done · 1 for the goal")).toBeDefined()
    const block = screen.getByRole("region", { name: "Work for the goal" })
    expect(block.textContent).toContain(OFF)
    expect(screen.queryByText("from")).toBeNull()
    expect(screen.queryByText("no default branch")).toBeNull()
  })

  it("keeps the words once the gate went past, under a link to the goal, since no trak opened", async () => {
    inRouter(
      <FinishedCard
        finished={handingOff}
        atGate={undefined}
        handOffBase={{ goal: "ship-goals" }}
        opened={[]}
        goalOpened={undefined}
      />,
    )

    expect(await screen.findByRole("link", { name: "Sent to the goal" })).toBeDefined()
    expect(screen.getByText(OFF)).toBeDefined()
    expect(screen.queryByText(/Opened as/)).toBeNull()
  })

  it("points at the traks it opened where the goal was at rest when the gate went past", async () => {
    inRouter(
      <FinishedCard
        finished={handingOff}
        atGate={undefined}
        handOffBase={{ goal: "ship-goals" }}
        opened={["quiet-emerald-capybara"]}
        goalOpened={undefined}
      />,
    )

    expect(await screen.findByText("Opened as a new trak")).toBeDefined()
    expect(screen.getByRole("link", { name: "quiet-emerald-capybara" })).toBeDefined()
    expect(screen.queryByText("Sent to the goal")).toBeNull()
  })
})

describe("a plain finish", () => {
  it("stays a sentence and takes no card", () => {
    render(
      <ComposerOutputView
        output={{ type: "finished", reason: "already done" }}
        atGate={undefined}
        agents={[]}
        handOffBase={undefined}
        planning={undefined}
        opened={undefined}
        goalOpened={undefined}
      />,
    )

    expect(screen.getByText("already done")).toBeDefined()
    expect(screen.queryByText(/The work is done/)).toBeNull()
  })
})

describe("a finish that proposes a goal", () => {
  const GOAL = "Rebuild the importer around streaming.\n\nSettled: one pass, no temporary copies."
  const proposing: Finished = { type: "finished", reason: "The approach is settled.", goal: GOAL }

  it("is the card, naming the goal in the head and the words under its own label", () => {
    render(
      <ComposerOutputView
        output={proposing}
        atGate={undefined}
        agents={[]}
        handOffBase={undefined}
        planning={undefined}
        opened={undefined}
        goalOpened={undefined}
      />,
    )

    expect(screen.getByText("The work is done · a new goal")).toBeDefined()
    expect(screen.getByRole("region", { name: "A new goal" })).toBeDefined()
    expect(screen.getByText("New goal · once this trak finishes")).toBeDefined()
    expect(screen.getByText(/Rebuild the importer around streaming/)).toBeDefined()
  })

  it("points at the goal once it has started, keeping the words", async () => {
    inRouter(
      <FinishedCard
        finished={proposing}
        atGate={undefined}
        handOffBase={undefined}
        opened={undefined}
        goalOpened="goal-abc"
      />,
    )

    const link = await screen.findByRole("link", { name: /Opened as a goal/ })
    expect(link.getAttribute("href")).toBe("/goals/goal-abc")
    expect(screen.getByText(/Rebuild the importer around streaming/)).toBeDefined()
  })
})
