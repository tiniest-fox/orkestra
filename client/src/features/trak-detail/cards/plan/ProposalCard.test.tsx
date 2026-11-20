/**
 * Tier 2 (`testing-tiers`): RTL, no network — what the card says a plan is.
 *
 * **The failure worth a render test is a card that understates what approving buys.** An
 * instruction cut to the measure reads as a plan of phrases, and a spawn drawn as `3 pieces`
 * hides three traks and three more gates behind one row — neither is an error anywhere on
 * the wire, and this card is the only place a person meets either fact.
 *
 * Assertions are on text, because the card's job is entirely what it says.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { AgentDto, ComposerOutputDto, PlanEditsDto } from "../../../../api/types"
import { makeAgent, makeComposeEntry } from "../../../../fixtures"
import { approval } from "../../actions.fixtures"
import ProposalCard from "./ProposalCard"

afterEach(cleanup)

type Proposal = Extract<ComposerOutputDto, { type: "proposal" }>

/** Longer than the row it used to be clipped to, and the only copy of it anywhere. */
const LONG =
  "Settle what a person can do about a conflict from inside the drawer, and where the line is. Resolving a conflict is an edit to a working tree that Orkestra does not own, so the honest scope may be showing the paths and opening the checkout rather than offering a merge tool."

const WHY = "Three lenses over the same change, because a merge surface fails in three ways."
const FIRST = "Read it as a state machine, and say whether a second attempt is reachable."
const SECOND = "Read it for what happens when git says something the parser did not expect."
const THIRD = "Read the copy. A conflict is not a failure and must not read as one."

const spawning: Proposal = {
  type: "proposal",
  title: "Say which files disagreed when a merge conflicts",
  steps: [
    { type: "agent", agent: "scope-and-approach", instruction: LONG, conversational: true },
    {
      type: "spawn",
      instruction: WHY,
      children: [
        [{ agent: "review", instruction: FIRST }],
        [{ agent: "review", instruction: SECOND }],
        [{ agent: "design-review", instruction: THIRD }],
      ],
    },
  ],
}

const BUILT = "Move the /events route across, response byte-identical."
const CHECKED = "Read the moved route for behaviour that changed."

/** A piece that does its work and then reviews it — two steps in one column. */
const selfReviewing: Proposal = {
  type: "proposal",
  title: "Port the routes to the new adapter",
  steps: [
    {
      type: "spawn",
      instruction: WHY,
      children: [
        [
          { agent: "build", instruction: BUILT },
          { agent: "review", instruction: CHECKED },
        ],
        [{ agent: "build", instruction: "Move /traks across." }],
      ],
    },
  ],
}

describe("a step's instruction", () => {
  it("is on the card whole, however long it is", () => {
    render(
      <ProposalCard
        proposal={spawning}
        atGate={undefined}
        handOffBase={undefined}
        opened={undefined}
      />,
    )

    expect(screen.getByText(LONG)).toBeDefined()
  })
})

describe("a spawn", () => {
  it("names every child and draws every child's instruction", () => {
    render(
      <ProposalCard
        proposal={spawning}
        atGate={undefined}
        handOffBase={undefined}
        opened={undefined}
      />,
    )

    expect(screen.getAllByText("review")).toHaveLength(2)
    expect(screen.getByText("design-review")).toBeDefined()
    for (const text of [FIRST, SECOND, THIRD]) expect(screen.getByText(text)).toBeDefined()
  })

  it("keeps its own instruction, which argues for the set rather than for any one piece", () => {
    render(
      <ProposalCard
        proposal={spawning}
        atGate={undefined}
        handOffBase={undefined}
        opened={undefined}
      />,
    )

    expect(screen.getByText(WHY)).toBeDefined()
    expect(screen.getByText("3 pieces")).toBeDefined()
  })

  it("marks each child under the spawn's own position", () => {
    render(
      <ProposalCard
        proposal={spawning}
        atGate={undefined}
        handOffBase={undefined}
        opened={undefined}
      />,
    )

    // The spawn is entry 2, so its pieces are 2·1, 2·2, 2·3 — one step each here.
    for (const mark of ["2·1", "2·2", "2·3"]) expect(screen.getByText(mark)).toBeDefined()
  })
})

describe("a piece that holds a plan of its own", () => {
  it("draws it as a column, every step of it", () => {
    render(
      <ProposalCard
        proposal={selfReviewing}
        atGate={undefined}
        handOffBase={undefined}
        opened={undefined}
      />,
    )

    for (const text of [BUILT, CHECKED]) expect(screen.getByText(text)).toBeDefined()
    // The deep piece is numbered step by step; the one-step piece beside it is not.
    for (const mark of ["1·1.1", "1·1.2", "1·2"]) expect(screen.getByText(mark)).toBeDefined()
  })
})

/**
 * The thing the plan gate is the only place to catch: a step put into the conversation
 * that produced a document — including, if nothing says so here, the conversation it is
 * meant to judge, which nothing in the engine refuses.
 */
describe("the conversation a step continues", () => {
  const continuing: Proposal = {
    type: "proposal",
    title: "Answer the review",
    steps: [
      {
        type: "agent",
        agent: "build",
        instruction: "fix what the review found",
        conversational: false,
        continues: "2-build",
      },
      {
        type: "agent",
        agent: "review",
        instruction: "read the fix",
        conversational: false,
      },
    ],
  }

  it("names the document the composer wrote, and nothing about what it resolves to", () => {
    render(
      <ProposalCard
        proposal={continuing}
        atGate={undefined}
        handOffBase={undefined}
        opened={undefined}
      />,
    )

    expect(screen.getByText("continues 2-build")).toBeDefined()
  })

  it("says nothing about a step that starts a fresh conversation", () => {
    render(
      <ProposalCard
        proposal={continuing}
        atGate={undefined}
        handOffBase={undefined}
        opened={undefined}
      />,
    )

    // Two steps, one key — and no word standing in for the silence, which would be the
    // card claiming the second step was deliberately started fresh.
    expect(screen.getAllByText(/continues/)).toHaveLength(1)
  })

  it("draws no key on a spawn, which has no session of its own", () => {
    render(
      <ProposalCard
        proposal={spawning}
        atGate={undefined}
        handOffBase={undefined}
        opened={undefined}
      />,
    )

    expect(screen.queryByText(/continues/)).toBeNull()
  })
})

/** The count sits beside the press that spends the money, and it was counting the wrong thing. */
describe("the header", () => {
  it("counts the pieces beside the steps, because approving buys both", () => {
    render(
      <ProposalCard
        proposal={spawning}
        atGate={undefined}
        handOffBase={undefined}
        opened={undefined}
      />,
    )

    expect(screen.getByText("Proposed 2 steps · 3 pieces")).toBeDefined()
  })

  it("counts the runs too where a piece buys more than one", () => {
    render(
      <ProposalCard
        proposal={selfReviewing}
        atGate={undefined}
        handOffBase={undefined}
        opened={undefined}
      />,
    )

    // Two pieces, three agent turns and three gates. `2 pieces` alone is what said
    // one run each, which is the undercount this line exists to stop.
    expect(screen.getByText("Proposed 1 step · 2 pieces · 3 runs")).toBeDefined()
  })

  it("says nothing about pieces where the plan spawns none", () => {
    render(
      <ProposalCard
        handOffBase={undefined}
        opened={undefined}
        proposal={{
          type: "proposal",
          title: "Bump the provider client",
          steps: [
            {
              type: "agent",
              agent: "build",
              instruction: "move to the streaming API",
              conversational: false,
            },
          ],
        }}
        atGate={undefined}
      />,
    )

    expect(screen.getByText("Proposed 1 step")).toBeDefined()
  })
})

/** The card at the gate, resolving each step's agent against `agents`. */
const drawnWith = (proposal: Proposal, agents: readonly AgentDto[]): void => {
  render(
    <ProposalCard
      proposal={proposal}
      atGate={undefined}
      agents={agents}
      handOffBase={undefined}
      opened={undefined}
    />,
  )
}

/**
 * A step that waits on a condition splits the plan into now and later, and this card is
 * where a person learns that before spending on it. The rule is a row of its own, so a
 * tile below it is asserted unchanged; the names are the whole of what the rule says.
 */
describe("a step that waits on a condition", () => {
  const AGENTS = [
    makeAgent({ name: "build" }),
    makeAgent({ name: "verify", conditions: ["deployed"] }),
    makeAgent({ name: "announce", conditions: ["deployed"] }),
    makeAgent({ name: "smoke", conditions: ["merged", "staging-ready"] }),
    makeAgent({ name: "check-preview", conditions: ["preview-up"] }),
  ]

  const deploying: Proposal = {
    type: "proposal",
    title: "Rate-limit the answers API",
    steps: [
      { type: "agent", agent: "build", instruction: "add the limit", conversational: false },
      { type: "agent", agent: "verify", instruction: "call it 61 times", conversational: false },
      { type: "agent", agent: "announce", instruction: "post in #api", conversational: false },
    ],
  }

  it("draws the condition's name once, above the first step that waits on it", () => {
    drawnWith(deploying, AGENTS)

    // `announce` re-declares `deployed` and the plan is already past it: one rule, not two.
    expect(screen.getAllByText("deployed")).toHaveLength(1)
    // The rule sits between the tiles rather than in one, so the list has a row for it.
    const rows = [
      ...(screen.getByText("add the limit").closest("ol")?.querySelectorAll(":scope > li") ?? []),
    ]
    expect(rows.map((row) => row.textContent.startsWith("deployed"))).toStrictEqual([
      false,
      true,
      false,
      false,
    ])
  })

  it("names both conditions on one rule where a step declares two", () => {
    render(
      <ProposalCard
        handOffBase={undefined}
        opened={undefined}
        proposal={{
          ...deploying,
          steps: [
            deploying.steps[0] ?? { type: "compose", instruction: "" },
            { type: "agent", agent: "smoke", instruction: "resync staging", conversational: false },
          ],
        }}
        atGate={undefined}
        agents={AGENTS}
      />,
    )

    expect(screen.getByText("merged")).toBeDefined()
    expect(screen.getByText("staging-ready")).toBeDefined()
  })

  it("counts the waiting steps in the header, re-declared or not", () => {
    drawnWith(deploying, AGENTS)

    expect(screen.getByText("Proposed 3 steps · 2 wait")).toBeDefined()
  })

  it("says nothing about waiting where no step waits", () => {
    drawnWith(spawning, AGENTS)

    expect(screen.queryByText(/wait/)).toBeNull()
  })

  it("draws a piece's rule in its own column, and the plan's above the entry after the spawn", () => {
    render(
      <ProposalCard
        handOffBase={undefined}
        opened={undefined}
        proposal={{
          type: "proposal",
          title: "Check the checklist on every preview",
          steps: [
            {
              type: "spawn",
              instruction: "one per seeded organisation",
              children: [
                [
                  { agent: "build", instruction: "list the items" },
                  { agent: "check-preview", instruction: "tick them all" },
                ],
                [{ agent: "check-preview", instruction: "confirm sources are ticked" }],
              ],
            },
            {
              type: "agent",
              agent: "build",
              instruction: "review what they found",
              conversational: false,
            },
          ],
        }}
        atGate={undefined}
        agents={AGENTS}
      />,
    )

    // Once per column, then once for the plan: the spawn itself draws none.
    expect(screen.getAllByText("preview-up")).toHaveLength(3)
    expect(screen.getByText("Proposed 2 steps · 2 pieces · 3 runs · 2 wait")).toBeDefined()
  })
})

/** The card at the gate, with the repository naming `main`. */
const drawn = (proposal: Proposal): void => {
  render(
    <ProposalCard proposal={proposal} atGate={undefined} handOffBase="main" opened={undefined} />,
  )
}

/**
 * A hand-off on the plan: traks of its own, cut from the default branch, never coming
 * back. The one thing that keeps it from reading as a spawn is where it is drawn.
 */
describe("a hand-off on the plan", () => {
  const OFF = "`git merge-tree` is shelled out to twice per preview; that is a fix to the preview."
  const handingOff: Proposal = { ...spawning, handOff: [OFF] }

  it("is drawn after the list under its own label, with the base branch named on it", () => {
    drawn(handingOff)

    const block = screen.getByRole("region", { name: "Work for a new trak" })
    expect(block.textContent).toContain(OFF)
    expect(block.textContent).toContain("main")
    // Outside the numbered list, which is what says it is not an entry.
    expect(block.closest("ol")).toBeNull()
  })

  it("counts the new traks in the head, last, after the pieces", () => {
    drawn(handingOff)

    expect(screen.getByText("Proposed 2 steps · 3 pieces · 1 new trak")).toBeDefined()
  })

  it("draws nothing of the kind on a plan that hands nothing off", () => {
    drawn(spawning)

    expect(screen.queryByRole("region", { name: "Work for a new trak" })).toBeNull()
    expect(screen.getByText("Proposed 2 steps · 3 pieces")).toBeDefined()
  })
})

/**
 * A clock is the step's own rather than its agent's, so it draws off the entry: a rule of
 * the same shape carrying the instant, above the condition's where a step has both, and
 * counted in the header with the rest.
 */
describe("a step with a clock of its own", () => {
  it("draws the clock as a rule above the step, and above the condition's rule", () => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(6, 0, 0, 0)
    render(
      <ProposalCard
        proposal={{
          type: "proposal",
          title: "Reconcile the ledger against the nightly export",
          steps: [
            { type: "agent", agent: "build", instruction: "add the job", conversational: false },
            {
              type: "agent",
              agent: "verify",
              instruction: "check last night's run",
              conversational: false,
              waitUntil: tomorrow.getTime(),
            },
          ],
        }}
        atGate={undefined}
        handOffBase={undefined}
        opened={undefined}
        agents={[makeAgent({ name: "verify", conditions: ["deployed"] })]}
      />,
    )

    expect(screen.getByText("Proposed 2 steps · 1 wait")).toBeDefined()
    const rows = [
      ...(screen.getByText("add the job").closest("ol")?.querySelectorAll(":scope > li") ?? []),
    ]
    // Tile, the clock's rule, the condition's rule, tile — the clock is the outer floor.
    expect(rows.map((row) => row.textContent)).toStrictEqual([
      expect.stringContaining("add the job"),
      expect.stringMatching(/^06:00 tomorrow · in \d+[hm] \d\d[ms]$/),
      "deployed",
      expect.stringContaining("check last night's run"),
    ])
  })
})

/** Press the `nth` button of that name. */
const press = (name: string | RegExp, nth = 0): void => {
  const found = screen.getAllByRole("button", { name })[nth]
  if (found === undefined) throw new Error(`no press named ${String(name)}`)
  fireEvent.click(found)
}

const TOMORROW = Date.now() + 86_400_000
const MODELS = ["opus", "sonnet", "haiku", "codex/gpt-5.6-sol"]
const FLEET = [
  makeAgent({ name: "build", model: "opus" }),
  makeAgent({ name: "review", model: "opus" }),
  makeAgent({ name: "smoke", model: "haiku" }),
  makeAgent({ name: "experiment", model: "sonnet", description: "Tries an idea, keeps nothing." }),
]
const plan: Proposal = {
  type: "proposal",
  title: "Let a person tweak a plan",
  steps: [
    { type: "agent", agent: "build", instruction: "add the edits", conversational: false },
    {
      type: "agent",
      agent: "review",
      instruction: "read the diff",
      conversational: false,
      continues: "1-build",
    },
    {
      type: "agent",
      agent: "smoke",
      instruction: "run it overnight",
      conversational: false,
      waitUntil: TOMORROW,
    },
  ],
}

/** The card at the gate, with the presses the approval would send recorded. */
const atGate = () => {
  const sent: (PlanEditsDto | undefined)[] = []
  render(
    <ProposalCard
      proposal={plan}
      planning={{
        approval: {
          ...approval,
          approve: () => sent.push(undefined),
          approveWith: (edits) => sent.push(edits),
        },
        proposal: 2,
        head: [makeComposeEntry()],
        models: MODELS,
      }}
      atGate={undefined}
      handOffBase={undefined}
      opened={undefined}
      agents={FLEET}
    />,
  )
  return sent
}

describe("the plan at its gate", () => {
  it("approves as proposed where nothing was changed", () => {
    const sent = atGate()
    press("Approve")
    expect(sent).toStrictEqual([undefined])
  })

  it("folds a removed step, counts it on Approve, and reads what continued it as a new session", () => {
    const sent = atGate()
    press("Remove step", 0)

    expect(screen.getByText("removed")).toBeDefined()
    expect(screen.getByText("Proposed 2 steps · 1 wait")).toBeDefined()
    expect(screen.getByRole("button", { name: "Step 2 conversation: new session" })).toBeDefined()
    press("Approve · 1")
    expect(sent).toStrictEqual([{ proposal: 2, steps: [{ edit: "remove", at: 1 }] }])
  })

  it("takes a removed clock and a new session to the press, and puts both back on reset", () => {
    const sent = atGate()
    press("Remove wait")
    press(/Step 2 conversation/)
    fireEvent.click(screen.getByRole("menuitemradio", { name: /new session/ }))
    expect(screen.getByText("Proposed 3 steps")).toBeDefined()
    expect(screen.getAllByRole("img", { name: "edited" })).toHaveLength(2)

    press("Reset to proposed")
    expect(screen.queryByRole("img", { name: "edited" })).toBeNull()
    press("Approve")
    expect(sent).toStrictEqual([undefined])
  })

  it("sends an instruction rewritten in place, at its plan position", () => {
    const sent = atGate()
    press("add the edits")
    fireEvent.change(screen.getByRole("textbox", { name: "Step 1 instruction" }), {
      target: { value: "add only the removal" },
    })
    press("Approve · 1")
    expect(sent).toStrictEqual([
      { proposal: 2, steps: [{ edit: "instruction", at: 1, instruction: "add only the removal" }] },
    ])
  })
})

describe("the agent and model at the gate", () => {
  it("swaps an agent, redraws its key where a later step continues it, and sends the swap", () => {
    const sent = atGate()
    press("Step 1 agent: build")
    fireEvent.click(screen.getByRole("menuitemradio", { name: /experiment/ }))
    expect(screen.getByRole("button", { name: "Step 1 agent: experiment" })).toBeDefined()
    // The swapped agent's own model, and the review continuing it reads it too.
    expect(screen.getByRole("button", { name: "Step 1 model: sonnet" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Step 2 conversation: 1-experiment" })).toBeDefined()
    press("Approve · 1")
    expect(sent).toStrictEqual([
      { proposal: 2, steps: [{ edit: "agent", at: 1, agent: "experiment" }] },
    ])
  })

  it("picks a model, tags the agent's own, and locks the step continuing it to the pick", () => {
    const sent = atGate()
    press("Step 1 model: opus")
    expect(screen.getByRole("menuitemradio", { name: /opus.*build’s own/ })).toBeDefined()
    fireEvent.click(screen.getByRole("menuitemradio", { name: /haiku/ }))
    // Step 2 continues step 1, so it reads step 1's model and offers no menu of its own.
    expect(screen.queryByRole("button", { name: /Step 2 model/ })).toBeNull()
    expect(screen.getByTitle("Locked to the conversation it continues").textContent).toBe("haiku")
    press("Approve · 1")
    expect(sent).toStrictEqual([{ proposal: 2, steps: [{ edit: "model", at: 1, model: "haiku" }] }])
  })

  it("drops a pick when the agent is swapped", () => {
    const sent = atGate()
    press("Step 1 model: opus")
    fireEvent.click(screen.getByRole("menuitemradio", { name: /haiku/ }))
    press("Step 1 agent: build")
    fireEvent.click(screen.getByRole("menuitemradio", { name: /experiment/ }))
    expect(screen.getByRole("button", { name: "Step 1 model: sonnet" })).toBeDefined()
    press("Approve · 1")
    expect(sent).toStrictEqual([
      { proposal: 2, steps: [{ edit: "agent", at: 1, agent: "experiment" }] },
    ])
  })

  it("draws nothing to edit on a card away from the gate", () => {
    render(
      <ProposalCard
        proposal={plan}
        atGate={undefined}
        handOffBase={undefined}
        opened={undefined}
      />,
    )
    expect(screen.queryByRole("button", { name: "Remove step" })).toBeNull()
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull()
  })
})

describe("a spawn's pieces at the gate", () => {
  const splitting: Proposal = {
    type: "proposal",
    title: "Split it",
    steps: [
      {
        type: "spawn",
        instruction: "two pieces",
        children: [
          [
            { agent: "build", instruction: "build the piece" },
            { agent: "review", instruction: "review the piece" },
          ],
          [{ agent: "smoke", instruction: "smoke the other" }],
        ],
      },
    ],
  }
  const spawnAtGate = () => {
    const sent: (PlanEditsDto | undefined)[] = []
    render(
      <ProposalCard
        proposal={splitting}
        planning={{
          approval: { ...approval, approveWith: (edits) => sent.push(edits) },
          proposal: 4,
          head: [makeComposeEntry()],
          models: MODELS,
        }}
        atGate={undefined}
        handOffBase={undefined}
        opened={undefined}
        agents={FLEET}
      />,
    )
    return sent
  }

  it("rewords, swaps, picks and removes piece steps, and sends each by piece and step", () => {
    const sent = spawnAtGate()
    press("smoke the other")
    fireEvent.change(screen.getByRole("textbox", { name: "Step 1·2 instruction" }), {
      target: { value: "smoke it all" },
    })
    press("Step 1·1.1 agent: build")
    fireEvent.click(screen.getByRole("menuitemradio", { name: /experiment/ }))
    press("Step 1·2 model: haiku")
    fireEvent.click(screen.getByRole("menuitemradio", { name: /opus/ }))
    // The spawn's own trash press, then the first piece's two steps' — the one piece of
    // one step offers none.
    expect(screen.getAllByRole("button", { name: "Remove step" })).toHaveLength(3)
    press("Remove step", 2)
    expect(screen.getByText("removed")).toBeDefined()
    // The first piece is down to its last step, which may not be removed.
    expect(screen.getAllByRole("button", { name: "Remove step" })).toHaveLength(1)
    expect(screen.getByText("Proposed 1 step · 2 pieces")).toBeDefined()

    press("Approve · 4")
    expect(sent).toStrictEqual([
      {
        proposal: 4,
        steps: [
          { edit: "pieceAgent", at: 1, piece: 0, step: 0, agent: "experiment" },
          { edit: "pieceRemove", at: 1, piece: 0, step: 1 },
          { edit: "pieceInstruction", at: 1, piece: 1, step: 0, instruction: "smoke it all" },
          { edit: "pieceModel", at: 1, piece: 1, step: 0, model: "opus" },
        ],
      },
    ])
  })
})

describe("a refused approval at the gate", () => {
  it("says why the last press was refused, whole, in the body rather than the head", () => {
    const said = "That plan can't run as edited: `build` writes, and this trak's branch has merged."
    render(
      <ProposalCard
        proposal={plan}
        planning={{
          approval: { ...approval, said },
          proposal: 2,
          head: [makeComposeEntry()],
          models: MODELS,
        }}
        atGate={undefined}
        handOffBase={undefined}
        opened={undefined}
      />,
    )
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toBe(said)
    expect(alert.closest("ol")).toBeNull()
    expect(alert.nextElementSibling?.tagName).toBe("OL")
  })
})

/** A step that waits for the merge itself. */
const reporting = (agent: string, instruction: string): Proposal["steps"][number] => ({
  type: "agent",
  agent,
  instruction,
  conversational: false,
  waitFor: "merged",
})

describe("a step's own `waitFor` at the gate", () => {
  const merging: Proposal = {
    type: "proposal",
    title: "Report on the release",
    steps: [
      { type: "agent", agent: "build", instruction: "ship it", conversational: false },
      {
        type: "agent",
        agent: "review",
        instruction: "report once merged",
        conversational: false,
        waitFor: "merged",
      },
    ],
  }

  it("draws its rule, counts it, and removes it with the clear-wait edit", () => {
    const sent: (PlanEditsDto | undefined)[] = []
    render(
      <ProposalCard
        proposal={merging}
        planning={{
          approval: { ...approval, approveWith: (edits) => sent.push(edits) },
          proposal: 2,
          head: [makeComposeEntry()],
          models: MODELS,
        }}
        atGate={undefined}
        handOffBase={undefined}
        opened={undefined}
        agents={FLEET}
      />,
    )
    expect(screen.getByText("merged")).toBeDefined()
    expect(screen.getByText("Proposed 2 steps · 1 wait")).toBeDefined()

    press("Remove wait")
    expect(screen.getByText("Proposed 2 steps")).toBeDefined()
    // Still drawn, struck, until the plan is approved.
    expect(screen.getByText("merged").className).toContain("line-through")
    press("Approve · 1")
    expect(sent).toStrictEqual([{ proposal: 2, steps: [{ edit: "clearWait", at: 2 }] }])
  })

  /** The card at the gate over `steps`, with the edits Approve sends recorded. */
  const gate = (steps: Proposal["steps"], fleet: readonly AgentDto[]) => {
    const sent: (PlanEditsDto | undefined)[] = []
    render(
      <ProposalCard
        proposal={{ type: "proposal", title: "Report", steps }}
        planning={{
          approval: { ...approval, approveWith: (edits) => sent.push(edits) },
          proposal: 2,
          head: [makeComposeEntry()],
          models: MODELS,
        }}
        atGate={undefined}
        handOffBase={undefined}
        opened={undefined}
        agents={fleet}
      />,
    )
    return sent
  }

  it("draws a repeated `waitFor` on each step, and clears the second alone", () => {
    const sent = gate(
      [reporting("review", "report once merged"), reporting("smoke", "smoke once merged")],
      FLEET,
    )
    expect(screen.getAllByText("merged")).toHaveLength(2)
    expect(screen.getAllByRole("button", { name: "Remove wait" })).toHaveLength(2)

    press("Remove wait", 1)
    expect(screen.getAllByText("merged")[1]?.className).toContain("line-through")
    press("Approve · 1")
    expect(sent).toStrictEqual([{ proposal: 2, steps: [{ edit: "clearWait", at: 2 }] }])
  })

  it("keeps a cleared name live where the step's agent declares it too", () => {
    const fleet = [...FLEET, makeAgent({ name: "verify", conditions: ["merged"] })]
    gate(
      [reporting("review", "report once merged"), reporting("verify", "verify once merged")],
      fleet,
    )

    press("Remove wait", 1)
    const names = screen.getAllByText("merged")
    expect(names).toHaveLength(2)
    expect(names.map((n) => n.className.includes("line-through"))).toStrictEqual([false, false])
    // The press stays reachable, as Undo, to take the edit back.
    expect(screen.getByRole("button", { name: /undo/i })).toBeDefined()
  })
})
