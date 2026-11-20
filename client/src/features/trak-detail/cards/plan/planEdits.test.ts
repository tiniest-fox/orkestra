/**
 * Tier 1: what the card draws from a person's edits, and what the press sends. The
 * proposal is `1-work`, `2-review` continuing `1-work`, and `3-smoke` on a clock, behind
 * a first compose at `0`.
 */

import { describe, expect, it } from "vitest"
import { makeAgent, makeAgentStep, makeComposeEntry } from "../../../../fixtures"
import {
  continuable,
  editCount,
  editsDto,
  modelOn,
  NO_EDITS,
  tilesOf,
  withAgent,
  withCellAgent,
  withCellEdit,
  withCellModel,
  withEdit,
  withModel,
  withoutCellEdit,
  withoutEdit,
} from "./planEdits"

const STEPS = [
  makeAgentStep({ agent: "work", instruction: "Do it." }),
  makeAgentStep({ agent: "review", instruction: "Review it.", continues: "1-work" }),
  makeAgentStep({ agent: "smoke", instruction: "Smoke it.", waitUntil: 1_000 }),
]
const HEAD = [makeComposeEntry()]
const FROM = HEAD.length
const AGENTS = [
  makeAgent({ name: "work", model: "sonnet" }),
  makeAgent({ name: "review", model: "opus" }),
  makeAgent({ name: "smoke", model: "haiku" }),
  makeAgent({ name: "experiment", model: "codex/gpt-5.6-sol" }),
]

describe("tilesOf", () => {
  it("draws the proposal as it stands with no edits", () => {
    const tiles = tilesOf(STEPS, HEAD, NO_EDITS)
    expect(tiles.map((t) => [t.key, t.changes, t.removed])).toEqual([
      ["1-work", 0, false],
      ["2-review", 0, false],
      ["3-smoke", 0, false],
    ])
    expect(tiles.map((t) => t.now)).toEqual(STEPS)
    expect(editCount(tiles)).toBe(0)
  })

  it("reads a step continuing a removed one as a new session at once", () => {
    const tiles = tilesOf(STEPS, HEAD, withEdit(NO_EDITS, 0, { removed: true }))
    expect(tiles[1]?.now).not.toHaveProperty("continues")
    // Its own edit is not what moved it, so it wears no dot — the removal is the edit.
    expect(tiles[1]?.changes).toBe(0)
    expect(editCount(tiles)).toBe(1)
  })

  it("marks and counts each in-place edit, and drops a cleared clock from the step", () => {
    const edits = withEdit(
      withEdit(withEdit(NO_EDITS, 0, { instruction: "Do less." }), 1, {
        continues: { key: undefined },
      }),
      2,
      { waitCleared: true },
    )
    const tiles = tilesOf(STEPS, HEAD, edits)
    expect(tiles.map((t) => t.changes)).toEqual([1, 1, 1])
    expect(tiles[2]?.now).not.toHaveProperty("waitUntil")
    expect(editCount(tiles)).toBe(3)
  })

  it("drops a step's `waitFor` with its clock when the wait is cleared", () => {
    const steps = [makeAgentStep({ agent: "report", instruction: "Report.", waitFor: "merged" })]
    const kept = tilesOf(steps, HEAD, NO_EDITS)
    expect(kept[0]?.now).toHaveProperty("waitFor", "merged")
    const cleared = tilesOf(steps, HEAD, withEdit(NO_EDITS, 0, { waitCleared: true }))
    expect(cleared[0]?.now).not.toHaveProperty("waitFor")
    expect(cleared[0]?.changes).toBe(1)
  })

  it("counts a removal once, however much else the step had", () => {
    const edits = withEdit(withEdit(NO_EDITS, 0, { instruction: "Do less." }), 0, {
      removed: true,
    })
    expect(editCount(tilesOf(STEPS, HEAD, edits))).toBe(1)
  })

  it("takes a removal back with Undo and keeps the step's other edits", () => {
    const edits = withoutEdit(
      withEdit(withEdit(NO_EDITS, 0, { instruction: "Do less." }), 0, { removed: true }),
      0,
      "removed",
    )
    const tiles = tilesOf(STEPS, HEAD, edits)
    expect([tiles[0]?.removed, tiles[0]?.now.instruction]).toEqual([false, "Do less."])
  })
})

describe("continuable", () => {
  it("offers the agent steps that ran and the earlier tiles still in the plan", () => {
    const head = [makeAgentStep({ agent: "plan", instruction: "Plan it." }), makeComposeEntry()]
    const tiles = tilesOf(STEPS, head, withEdit(NO_EDITS, 1, { removed: true }))
    expect(continuable(head, tiles, 2).map((c) => c.key)).toEqual(["0-plan", "2-work"])
  })
})

describe("editsDto", () => {
  it("sends nothing where nothing differs, which is approving as proposed", () => {
    expect(editsDto(4, tilesOf(STEPS, HEAD, NO_EDITS), FROM, NO_EDITS)).toBeUndefined()
    const back = withEdit(NO_EDITS, 1, { continues: { key: "1-work" }, instruction: "Review it." })
    expect(editsDto(4, tilesOf(STEPS, HEAD, back), FROM, back)).toBeUndefined()
  })

  it("sends each edit at its plan position, and a removal alone", () => {
    const edits = withEdit(
      withEdit(
        withEdit(withEdit(NO_EDITS, 0, { removed: true, instruction: "gone anyway" }), 1, {
          continues: { key: undefined },
        }),
        2,
        { instruction: "Smoke less.", waitCleared: true },
      ),
      1,
      {},
    )
    expect(editsDto(4, tilesOf(STEPS, HEAD, edits), FROM, edits)).toEqual({
      proposal: 4,
      steps: [
        { edit: "remove", at: 1 },
        { edit: "continues", at: 2 },
        { edit: "instruction", at: 3, instruction: "Smoke less." },
        { edit: "clearWait", at: 3 },
      ],
    })
  })
})

describe("an agent swap and a model pick", () => {
  it("draws a swapped step's key with its new agent everywhere, and sends the key as proposed", () => {
    const edits = withAgent(NO_EDITS, 0, "experiment", "work")
    const tiles = tilesOf(STEPS, HEAD, edits)
    expect([tiles[0]?.key, tiles[0]?.shown, tiles[0]?.changes]).toEqual([
      "1-work",
      "1-experiment",
      1,
    ])
    // The review still continues it, read under its new name.
    expect(tiles[1]?.now).toMatchObject({ continues: "1-work" })
    expect(continuable(HEAD, tiles, 1)).toEqual([
      { key: "1-work", shown: "1-experiment", instruction: "Do it." },
    ])
    expect(editsDto(4, tiles, FROM, edits)).toEqual({
      proposal: 4,
      steps: [{ edit: "agent", at: 1, agent: "experiment" }],
    })
  })

  it("drops a pick when the agent is swapped, and takes a swap back to the proposed agent as none", () => {
    const picked = withModel(NO_EDITS, 0, "haiku", "sonnet")
    expect(tilesOf(STEPS, HEAD, picked)[0]?.picked).toBe("haiku")
    const swapped = withAgent(picked, 0, "experiment", "work")
    expect(tilesOf(STEPS, HEAD, swapped)[0]?.picked).toBeUndefined()
    const back = withAgent(swapped, 0, "work", "work")
    expect(editsDto(4, tilesOf(STEPS, HEAD, back), FROM, back)).toBeUndefined()
  })

  it("takes a pick of the agent's own model as no pick", () => {
    const edits = withModel(withModel(NO_EDITS, 0, "haiku", "sonnet"), 0, "sonnet", "sonnet")
    expect(editsDto(4, tilesOf(STEPS, HEAD, edits), FROM, edits)).toBeUndefined()
  })

  it("locks a continuing step to the model of the step it continues, after that step's edits", () => {
    const plain = tilesOf(STEPS, HEAD, NO_EDITS)
    expect(plain.map((t) => t.locked)).toEqual([false, true, false])
    expect(STEPS.map((_, i) => modelOn(HEAD, plain, AGENTS, i))).toEqual([
      "sonnet",
      "sonnet",
      "haiku",
    ])
    const picked = tilesOf(STEPS, HEAD, withModel(NO_EDITS, 0, "opus", "sonnet"))
    expect(modelOn(HEAD, picked, AGENTS, 1)).toBe("opus")
    const swapped = tilesOf(STEPS, HEAD, withAgent(NO_EDITS, 0, "experiment", "work"))
    expect(modelOn(HEAD, swapped, AGENTS, 1)).toBe("codex/gpt-5.6-sol")
  })

  it("reads a step continuing one that ran at that entry's resolved model", () => {
    const head = [
      makeAgentStep({ agent: "plan", instruction: "Plan it.", model: "fable" }),
      makeComposeEntry(),
    ]
    const steps = [makeAgentStep({ agent: "work", instruction: "Do it.", continues: "0-plan" })]
    const tiles = tilesOf(steps, head, NO_EDITS)
    expect(tiles[0]?.locked).toBe(true)
    expect(modelOn(head, tiles, AGENTS, 0)).toBe("fable")
  })

  it("sends no pick on a locked step, and sends it once a new session unlocks the step", () => {
    const locked = withModel(NO_EDITS, 1, "haiku", "opus")
    const tiles = tilesOf(STEPS, HEAD, locked)
    expect([tiles[1]?.picked, tiles[1]?.changes]).toEqual([undefined, 0])
    expect(editsDto(4, tiles, FROM, locked)).toBeUndefined()
    const fresh = withEdit(locked, 1, { continues: { key: undefined } })
    expect(editsDto(4, tilesOf(STEPS, HEAD, fresh), FROM, fresh)).toEqual({
      proposal: 4,
      steps: [
        { edit: "continues", at: 2 },
        { edit: "model", at: 2, model: "haiku" },
      ],
    })
  })
})

describe("a spawn's pieces", () => {
  /** `1-spawn`: a piece that works then reviews, and a piece of one smoke. */
  const SPAWN = [
    {
      type: "spawn" as const,
      instruction: "Split it.",
      children: [
        [
          { agent: "work", instruction: "Do it." },
          { agent: "review", instruction: "Review it." },
        ],
        [{ agent: "smoke", instruction: "Smoke it." }],
      ],
    },
  ]

  it("keeps the last step of a piece, and every step of a piece of one, from being removed", () => {
    const [tile] = tilesOf(SPAWN, HEAD, withCellEdit(NO_EDITS, 0, 0, 0, { removed: true }))
    expect(tile?.pieces.map((cells) => cells.map((c) => c.last))).toStrictEqual([
      [false, true],
      [true],
    ])
    // What approving runs, which the head counts, has lost the removed step.
    expect(tile?.now.type === "spawn" ? tile.now.children[0] : undefined).toStrictEqual([
      { agent: "review", instruction: "Review it." },
    ])
  })

  it("sends each piece edit at the spawn's position, by piece and step as proposed", () => {
    const edits = withCellModel(
      withCellAgent(
        withCellEdit(withCellEdit(NO_EDITS, 0, 0, 1, { removed: true }), 0, 1, 0, {
          instruction: "Smoke less.",
        }),
        0,
        0,
        0,
        "experiment",
        "work",
      ),
      0,
      1,
      0,
      "opus",
      "haiku",
    )
    const tiles = tilesOf(SPAWN, HEAD, edits)
    expect(editCount(tiles)).toBe(4)
    expect(editsDto(7, tiles, FROM, edits)).toStrictEqual({
      proposal: 7,
      steps: [
        { edit: "pieceAgent", at: 1, piece: 0, step: 0, agent: "experiment" },
        { edit: "pieceRemove", at: 1, piece: 0, step: 1 },
        { edit: "pieceInstruction", at: 1, piece: 1, step: 0, instruction: "Smoke less." },
        { edit: "pieceModel", at: 1, piece: 1, step: 0, model: "opus" },
      ],
    })
  })

  it("drops a piece step's pick with a swap, and takes back a removal with Undo", () => {
    const picked = withCellModel(NO_EDITS, 0, 0, 0, "opus", "sonnet")
    const swapped = withCellAgent(picked, 0, 0, 0, "experiment", "work")
    expect(tilesOf(SPAWN, HEAD, swapped)[0]?.pieces[0]?.[0]?.picked).toBeUndefined()
    const back = withoutCellEdit(
      withCellEdit(NO_EDITS, 0, 0, 1, { removed: true }),
      0,
      0,
      1,
      "removed",
    )
    expect(editsDto(7, tilesOf(SPAWN, HEAD, back), FROM, back)).toBeUndefined()
  })

  it("sends a removed spawn's removal alone, whatever was done to its pieces", () => {
    const edits = withEdit(withCellEdit(NO_EDITS, 0, 1, 0, { instruction: "x" }), 0, {
      removed: true,
    })
    const tiles = tilesOf(SPAWN, HEAD, edits)
    expect(editCount(tiles)).toBe(1)
    expect(editsDto(7, tiles, FROM, edits)?.steps).toStrictEqual([{ edit: "remove", at: 1 }])
  })
})
