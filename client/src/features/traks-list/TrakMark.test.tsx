/**
 * The two rules this component exists for: **a row mid-turn gives its glyph to the agent
 * and nothing else does**, and **the segment travels wherever something is happening**,
 * which is a different set of rows.
 *
 * Asserted by class rather than by role or text, which is the exception `client-style`'s
 * *fix the markup* rule leaves room for: the glyph is `aria-hidden` on purpose — the
 * status line beside it is what names the row — so it has no accessible name to query and
 * giving it one would read every row twice. `lucide-<name>` is the drawn identity, and it
 * is the thing that would have to break for the wrong mark to be on screen.
 */

import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { PullRequestSummaryDto, TrakStateDto } from "../../api/types"
import { makeAgent, makePullRequestSummary, makeTrak, makeWaiting } from "../../fixtures"
import { pullRung } from "./pullRung"
import TrakMark from "./TrakMark"

afterEach(cleanup)

const AGENTS = [makeAgent({ name: "build", icon: "blocks" }), makeAgent({ name: "review" })]

const draw = (state: TrakStateDto, agent?: string): HTMLElement => {
  const { container } = render(
    <TrakMark
      trak={makeTrak({ state, running: true, ...(agent === undefined ? {} : { agent }) })}
      tone="working"
      agents={AGENTS}
    />,
  )
  return container
}

describe("TrakMark", () => {
  it("draws the agent's own glyph while that agent is taking a turn", () => {
    const box = draw({ _tag: "AgentWorking", step: 1 }, "build")
    expect(box.querySelector(".lucide-blocks")).not.toBeNull()
    // The state's own mark is the thing it replaced, not something drawn beside it.
    expect(box.querySelector("svg[viewBox='0 0 24 24'].shrink-0")).toBeNull()
  })

  it("draws the state's own glyph at a gate, exactly as it did before", () => {
    // The whole of what the list gave up, which is nothing: `AwaitingHuman` still tells
    // its five kinds apart, and no agent-shaped mark appears on a row nobody is working.
    const box = draw({ _tag: "AwaitingHuman", kind: "approval", step: 1 })
    expect(box.querySelector(".lucide-blocks")).toBeNull()
    expect(box.querySelector("svg")).not.toBeNull()
  })

  it("falls back rather than inventing an agent when the library has not answered", () => {
    // `terminal` is `agentGlyph`'s answer to *a turn, and we cannot say whose* — never a
    // state glyph standing in for an agent, and never nothing at all.
    const { container } = render(
      <TrakMark
        trak={makeTrak({ state: { _tag: "AgentWorking", step: 1 }, agent: "build" })}
        tone="working"
        agents={[]}
      />,
    )
    expect(container.querySelector(".lucide-terminal")).not.toBeNull()
  })

  it("travels the segment for the two states something is actually happening in", () => {
    // The plate's own, and the only motion on the list. `animate-spin` is on the gradient
    // behind the square rather than on the glyph inside it, which is the point: nothing
    // that says *which agent* may also be the thing that says *it is running*.
    expect(
      draw({ _tag: "AgentWorking", step: 1 }, "build").querySelector(".animate-spin"),
    ).not.toBeNull()
    expect(draw({ _tag: "CheckRunning", step: 1 }).querySelector(".animate-spin")).not.toBeNull()
    expect(draw({ _tag: "Merged", sha: "9f31c07" }).querySelector(".animate-spin")).toBeNull()
    expect(draw({ _tag: "Finished" }).querySelector(".animate-spin")).toBeNull()
  })

  it("takes the motion from the rung on a finished row, not from the state", () => {
    // The one case where a trak the engine is doing nothing about still has something in
    // flight: GitHub is running the checks. *Something is happening* is said the same way
    // either way, so the rung carries it rather than the state.
    const running = render(
      <TrakMark
        trak={makeTrak({ state: { _tag: "Finished" } })}
        tone="working"
        rung={{
          section: "review",
          icon: "shield",
          label: "Checks running",
          tone: "working",
          running: true,
          unmerged: true,
        }}
        agents={AGENTS}
      />,
    )
    expect(running.container.querySelector(".animate-spin")).not.toBeNull()
    expect(running.container.querySelector(".lucide-shield")).not.toBeNull()
  })

  it("wears the dashed ring while the wait leads the row, and the rung's mark where the pull request does", () => {
    // A wait on the deploy cannot pass until the pull request merges, so a forge saying
    // *Conflicts* takes the mark; once it says merged, the wait has the row — and the ring
    // — back. `waitingRow` orders the two; this is the mark reading that order.
    const held = (pull: PullRequestSummaryDto) =>
      render(
        <TrakMark
          trak={makeTrak({
            state: { _tag: "Finished" },
            waiting: makeWaiting({ name: "deployed" }),
          })}
          tone="working"
          rung={pullRung(pull)}
          agents={AGENTS}
        />,
      ).container
    expect(
      held(makePullRequestSummary({ merging: "conflicting" })).querySelector(".lucide-unlink"),
    ).not.toBeNull()
    expect(
      held(makePullRequestSummary({ state: "merged" })).querySelector(".lucide-circle-dashed"),
    ).not.toBeNull()
  })
})
