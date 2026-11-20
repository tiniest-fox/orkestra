// Tier-1: a person's edits laid over a proposed plan, and the edits refused before any
// are laid. The plan is a revision — two entries that ran, then the proposal — so every
// case also says the head never moves.

import { describe, expect, it } from "vitest"
import { Edits, editedPlan, editRefusal, unpicked } from "./plan-edit.js"
import type { ChildStep, Plan, Step } from "./outputs/proposal.js"

const turn = (agent: string, extra: Partial<Extract<Step, { agent: string }>> = {}): Step => ({
  agent,
  instruction: `${agent} it`,
  ...extra,
})

/**
 * `0-plan` and `1-compose` ran; the proposal is `2-build` … `5-pull-request`, and two of
 * its steps continue `2-build`.
 */
const PLAN: Plan = {
  title: "t",
  steps: [
    turn("plan"),
    { type: "compose" },
    turn("build"),
    turn("review", { continues: "2-build" }),
    turn("smoke", { wait_until: "PT8H" }),
    turn("pull-request", { continues: "2-build" }),
  ],
}
const FROM = 2
const MODELS = ["opus", "sonnet", "codex/gpt-5.6-sol"]

const refusalOver = (p: Plan, edits: Parameters<typeof editRefusal>[2]) =>
  editRefusal(p, FROM, edits, MODELS)

/** Each entry's key and what it continues, the two things a removal renumbers. */
const keys = (p: Plan): readonly (readonly [string, string | undefined])[] =>
  p.steps.map((s, i) => [
    `${String(i)}-${"agent" in s ? s.agent : "compose"}`,
    "agent" in s ? s.continues : undefined,
  ])

describe("editedPlan", () => {
  it("drops a removed step, renumbers the tail and re-points what continued a moved step", () => {
    const withReview: Plan = {
      ...PLAN,
      steps: [...PLAN.steps, turn("fix", { continues: "4-smoke" })],
    }
    const p = editedPlan(withReview, FROM, [Edits.remove(3)])
    expect(keys(p)).toEqual([
      ["0-plan", undefined],
      ["1-compose", undefined],
      ["2-build", undefined],
      ["3-smoke", undefined],
      ["4-pull-request", "2-build"],
      ["5-fix", "3-smoke"],
    ])
  })

  it("leaves a step whose continued step was removed in a new session", () => {
    const p = editedPlan(PLAN, FROM, [Edits.remove(2)])
    expect(keys(p)).toEqual([
      ["0-plan", undefined],
      ["1-compose", undefined],
      ["2-review", undefined],
      ["3-smoke", undefined],
      ["4-pull-request", undefined],
    ])
  })

  it("re-points a continues the person set through the same map as the composer's", () => {
    const p = editedPlan(PLAN, FROM, [Edits.remove(2), Edits.continueFrom(5, "3-review")])
    expect(keys(p).at(-1)).toEqual(["4-pull-request", "2-review"])
  })

  it("keeps a continues naming an entry that ran, which never moves", () => {
    const p = editedPlan(PLAN, FROM, [Edits.remove(2), Edits.continueFrom(3, "0-plan")])
    expect(keys(p)[2]).toEqual(["2-review", "0-plan"])
  })

  it("rewords a step, clears its continues, and drops its wait", () => {
    const p = editedPlan(PLAN, FROM, [
      Edits.reword(2, "build it smaller"),
      Edits.continueFrom(3),
      Edits.clearWait(4),
    ])
    expect(p.steps.slice(FROM)).toEqual([
      { agent: "build", instruction: "build it smaller" },
      { agent: "review", instruction: "review it" },
      { agent: "smoke", instruction: "smoke it" },
      turn("pull-request", { continues: "2-build" }),
    ])
  })

  it("drops a step's `wait_for` and its time together, and refuses a step with neither", () => {
    const waiting: Plan = {
      ...PLAN,
      steps: [...PLAN.steps, turn("report", { wait_until: "PT1H", wait_for: "merged" })],
    }
    expect(editedPlan(waiting, FROM, [Edits.clearWait(6)]).steps[6]).toEqual(turn("report"))
    const merging: Plan = {
      ...PLAN,
      steps: [...PLAN.steps, turn("report", { wait_for: "merged" })],
    }
    expect(refusalOver(merging, [Edits.clearWait(6)])).toBeUndefined()
    expect(editedPlan(merging, FROM, [Edits.clearWait(6)]).steps[6]).toEqual(turn("report"))
  })

  it("takes the last of two edits of one kind at one step", () => {
    const p = editedPlan(PLAN, FROM, [Edits.reword(2, "first"), Edits.reword(2, "second")])
    expect(p.steps[2]).toEqual({ agent: "build", instruction: "second" })
  })

  it("changes nothing with no edits", () => {
    expect(editedPlan(PLAN, FROM, [])).toEqual(PLAN)
  })
})

describe("editedPlan — agents and models", () => {
  it("swaps an agent, renames its key, and re-points every continues that named the old one", () => {
    const p = editedPlan(PLAN, FROM, [Edits.swapAgent(2, "experiment")])
    expect(keys(p).slice(FROM)).toEqual([
      ["2-experiment", undefined],
      ["3-review", "2-experiment"],
      ["4-smoke", undefined],
      ["5-pull-request", "2-experiment"],
    ])
  })

  it("renames and renumbers in one pass where a swap and a removal meet", () => {
    const p = editedPlan(PLAN, FROM, [
      Edits.remove(3),
      Edits.swapAgent(2, "experiment"),
      Edits.continueFrom(4, "2-build"),
    ])
    expect(keys(p).slice(FROM)).toEqual([
      ["2-experiment", undefined],
      ["3-smoke", "2-experiment"],
      ["4-pull-request", "2-experiment"],
    ])
  })

  it("sets a picked model on the step, and a swap drops it unless the approval picks again", () => {
    expect(editedPlan(PLAN, FROM, [Edits.pickModel(2, "sonnet")]).steps[2]).toEqual({
      agent: "build",
      instruction: "build it",
      model: "sonnet",
    })
    const [plan, ...rest] = PLAN.steps
    const chat: Plan = {
      ...PLAN,
      steps: [plan, ...rest.slice(0, 3), turn("smoke", { model: "opus" })],
    }
    expect(editedPlan(chat, FROM, [Edits.swapAgent(4, "verify")]).steps[4]).toEqual({
      agent: "verify",
      instruction: "smoke it",
    })
    expect(
      editedPlan(chat, FROM, [Edits.pickModel(4, "sonnet"), Edits.swapAgent(4, "verify")]).steps[4],
    ).toEqual({ agent: "verify", instruction: "smoke it", model: "sonnet" })
  })

  it("takes the pick off an entry for the composer's decode, and leaves the rest", () => {
    expect(unpicked(turn("build", { model: "opus", continues: "0-plan" }))).toEqual(
      turn("build", { continues: "0-plan" }),
    )
    expect(unpicked({ type: "compose" })).toEqual({ type: "compose" })
  })
})

describe("editRefusal", () => {
  it("takes edits that fit the proposal", () => {
    expect(
      refusalOver(PLAN, [
        Edits.remove(3),
        Edits.reword(2, "x"),
        Edits.continueFrom(5, "0-plan"),
        Edits.clearWait(4),
      ]),
    ).toBeUndefined()
  })

  it("refuses every step removed", () => {
    const all = [2, 3, 4, 5].map(Edits.remove)
    expect(refusalOver(PLAN, all)).toMatch(/every step of the plan is removed/)
  })

  it("refuses a position that is not in the proposal, before it or past it", () => {
    expect(refusalOver(PLAN, [Edits.reword(0, "x")])).toMatch(/position 0/)
    expect(refusalOver(PLAN, [Edits.remove(6)])).toMatch(/position 6/)
  })

  it("refuses a continues naming no earlier agent step the edits keep", () => {
    expect(refusalOver(PLAN, [Edits.continueFrom(3, "9-nothing")])).toMatch(/9-nothing/)
    expect(refusalOver(PLAN, [Edits.continueFrom(3, "4-smoke")])).toMatch(/4-smoke/)
    expect(refusalOver(PLAN, [Edits.continueFrom(3, "1-compose")])).toMatch(/1-compose/)
    expect(refusalOver(PLAN, [Edits.remove(2), Edits.continueFrom(3, "2-build")])).toMatch(
      /2-build/,
    )
  })

  it("refuses a continues on a step that is not an agent turn", () => {
    const spawned: Plan = {
      ...PLAN,
      steps: [
        ...PLAN.steps,
        { type: "spawn", instruction: "s", children: [{ agent: "build", instruction: "b" }] },
      ],
    }
    expect(refusalOver(spawned, [Edits.continueFrom(6, "2-build")])).toMatch(/6-spawn/)
  })

  it("refuses a swap or a pick on a step that is not an agent turn", () => {
    const composed: Plan = { ...PLAN, steps: [...PLAN.steps, { type: "compose" }] }
    expect(refusalOver(composed, [Edits.swapAgent(6, "build")])).toMatch(/6-compose.*no agent/)
    expect(refusalOver(composed, [Edits.pickModel(6, "opus")])).toMatch(/6-compose.*no model/)
  })

  it("refuses a model models.yaml does not list", () => {
    expect(refusalOver(PLAN, [Edits.pickModel(2, "gpt-9")])).toMatch(/no model `gpt-9`/)
  })

  it("refuses a pick on a step locked to the conversation it continues", () => {
    expect(refusalOver(PLAN, [Edits.pickModel(3, "sonnet")])).toMatch(
      /3-review continues `2-build`/,
    )
    expect(
      refusalOver(PLAN, [Edits.continueFrom(4, "0-plan"), Edits.pickModel(4, "opus")]),
    ).toMatch(/4-smoke continues `0-plan`/)
  })

  it("takes a pick where the edits free the step from the conversation it continued", () => {
    expect(refusalOver(PLAN, [Edits.continueFrom(3), Edits.pickModel(3, "sonnet")])).toBeUndefined()
    expect(refusalOver(PLAN, [Edits.remove(2), Edits.pickModel(3, "sonnet")])).toBeUndefined()
  })

  it("takes a swap on a continuing step, whose model stays the conversation's", () => {
    expect(refusalOver(PLAN, [Edits.swapAgent(3, "critique")])).toBeUndefined()
  })

  it("refuses a blank instruction and a wait that is not there", () => {
    expect(refusalOver(PLAN, [Edits.reword(2, "  \n")])).toMatch(/blank/)
    expect(refusalOver(PLAN, [Edits.clearWait(2)])).toMatch(/has no wait to remove/)
  })
})

/** One step of a piece, on `turn`'s terms. */
const cstep = (agent: string, extra: Partial<ChildStep> = {}): ChildStep => ({
  agent,
  instruction: `${agent} it`,
  ...extra,
})

/** `PLAN` with a spawn at 6: a ragged piece of two, and one written as a bare pair. */
const SPAWNED: Plan = {
  ...PLAN,
  steps: [
    ...PLAN.steps,
    {
      type: "spawn",
      instruction: "split it",
      children: [
        { steps: [cstep("build"), cstep("review")] },
        { agent: "document", instruction: "document it" },
      ],
    },
  ],
}

const spawnAt = (p: Plan, at: number) => {
  const s = p.steps[at]
  return s !== undefined && "children" in s ? s.children : undefined
}

describe("editedPlan — pieces", () => {
  it("rewords, swaps, picks and removes piece steps, and leaves a piece no edit names as written", () => {
    const p = editedPlan(SPAWNED, FROM, [
      Edits.rewordPiece(6, 0, 0, "build it well"),
      Edits.pickPieceModel(6, 0, 0, "sonnet"),
      Edits.swapPieceAgent(6, 0, 1, "critique"),
    ])
    expect(spawnAt(p, 6)).toEqual([
      {
        steps: [
          { agent: "build", instruction: "build it well", model: "sonnet" },
          { agent: "critique", instruction: "review it" },
        ],
      },
      { agent: "document", instruction: "document it" },
    ])
    expect(spawnAt(editedPlan(SPAWNED, FROM, [Edits.removePieceStep(6, 0, 0)]), 6)?.[0]).toEqual({
      steps: [cstep("review")],
    })
  })

  it("drops a piece step's model with a swap, unless the same approval picks one", () => {
    const picked: Plan = {
      ...PLAN,
      steps: [
        ...PLAN.steps,
        { type: "spawn", instruction: "s", children: [cstep("build", { model: "opus" })] },
      ],
    }
    expect(
      spawnAt(editedPlan(picked, FROM, [Edits.swapPieceAgent(6, 0, 0, "critique")]), 6),
    ).toEqual([{ steps: [{ agent: "critique", instruction: "build it" }] }])
    expect(
      spawnAt(
        editedPlan(picked, FROM, [
          Edits.pickPieceModel(6, 0, 0, "sonnet"),
          Edits.swapPieceAgent(6, 0, 0, "critique"),
        ]),
        6,
      ),
    ).toEqual([{ steps: [{ agent: "critique", instruction: "build it", model: "sonnet" }] }])
  })

  it("strips piece models in unpicked, keeping each piece's arm", () => {
    const modelled: Step = {
      type: "spawn",
      instruction: "s",
      children: [
        { steps: [cstep("build", { model: "opus" })] },
        cstep("document", { model: "sonnet" }),
      ],
    }
    expect(unpicked(modelled)).toEqual({
      type: "spawn",
      instruction: "s",
      children: [{ steps: [cstep("build")] }, cstep("document")],
    })
  })
})

describe("editRefusal — pieces", () => {
  it("takes piece edits that fit the spawn", () => {
    expect(
      refusalOver(SPAWNED, [
        Edits.removePieceStep(6, 0, 1),
        Edits.rewordPiece(6, 1, 0, "x"),
        Edits.swapPieceAgent(6, 0, 0, "critique"),
        Edits.pickPieceModel(6, 1, 0, "opus"),
      ]),
    ).toBeUndefined()
  })

  it("refuses removing a piece's last remaining step", () => {
    expect(refusalOver(SPAWNED, [Edits.removePieceStep(6, 1, 0)])).toMatch(
      /piece 2 of 6-spawn would have no steps left/,
    )
    expect(
      refusalOver(SPAWNED, [Edits.removePieceStep(6, 0, 0), Edits.removePieceStep(6, 0, 1)]),
    ).toMatch(/piece 1 of 6-spawn would have no steps left/)
  })

  it("refuses a piece edit on a step that is not a spawn, or a piece step it does not have", () => {
    expect(refusalOver(SPAWNED, [Edits.rewordPiece(2, 0, 0, "x")])).toMatch(
      /2-build is not a spawn/,
    )
    expect(refusalOver(SPAWNED, [Edits.rewordPiece(6, 2, 0, "x")])).toMatch(/piece 3 of 6-spawn/)
    expect(refusalOver(SPAWNED, [Edits.rewordPiece(6, 1, 1, "x")])).toMatch(/step 2 of piece 2/)
  })

  it("refuses a blank piece instruction and a model models.yaml does not list", () => {
    expect(refusalOver(SPAWNED, [Edits.rewordPiece(6, 0, 0, " ")])).toMatch(/blank/)
    expect(refusalOver(SPAWNED, [Edits.pickPieceModel(6, 0, 0, "gpt-9")])).toMatch(
      /no model `gpt-9`/,
    )
  })
})
