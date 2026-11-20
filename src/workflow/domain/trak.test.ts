import { describe, expect, it } from "vitest"
import { SessionId } from "../../agent/types/session.js"
import type { Agent } from "../../library/types/agent.js"
import type { Library } from "../../library/types/library.js"
import { CommitSha } from "../../vcs/index.js"
import type { Step } from "./outputs/proposal.js"
import {
  archived,
  borrowedSession,
  emptyTrak,
  effortAt,
  modelAt,
  nextCheckedPosition,
  noSlot,
  slotAt,
  type Trak,
  TrakId,
  TrakState,
} from "./trak.js"

const id = TrakId.make("slot-trak")

describe("what a trak holds at a position nothing has reached", () => {
  it("is a whole slot, not an absence every caller defaults for itself", () => {
    // Asserted as one value rather than field by field, deliberately. This is
    // the test that fails when a field is added to `Slot` without a default —
    // the alternative is `undefined` arriving at nine call sites, each of which
    // would have to invent the same answer and could disagree.
    expect(slotAt(emptyTrak(id), 0)).toStrictEqual({
      session: undefined,
      iterations: 0,
      filings: 0,
      skipped: false,
      skipNote: undefined,
      children: [],
      ambiguity: undefined,
      checkFailures: undefined,
      filed: undefined,
      permission: undefined,
      waiting: undefined,
      skippedWait: undefined,
      handOffs: [],
      handedOff: undefined,
      goal: undefined,
      goalOpened: undefined,
    })
  })

  it("answers the same past the end of the plan as before its start", () => {
    // There is no position a trak refuses to be asked about: `Finished` is the
    // virtual step at index N, and a caller doing arithmetic near either end
    // should get an answer rather than a hole.
    const trak = emptyTrak(id)
    expect(slotAt(trak, 100)).toStrictEqual(slotAt(trak, 1))
  })
})

/** The answer for a trak stood at `state`, so a row is the state and the number. */
const at = (t: Trak, state: TrakState): number | undefined => nextCheckedPosition({ ...t, state })

describe("the position whose checks run next", () => {
  // Names, so a row reads as the engine's: entry 0 is a turn, 1 a spawn, 2 a turn, 3
  // the composer's own entry — the four kinds of neighbour the walk has to answer for.
  const work: Step = { agent: "work", instruction: "do it" }
  const spawn: Step = {
    type: "spawn",
    instruction: "split it",
    children: [{ agent: "work", instruction: "a piece" }],
  }
  const compose: Step = { type: "compose" }
  const planned = (...steps: readonly [Step, ...Step[]]): Trak => ({
    ...emptyTrak(id),
    plan: { title: "the work", steps },
  })
  it("answers nothing before there is a plan", () => {
    expect(at(emptyTrak(id), TrakState.AgentWorking({ step: 0 }))).toBeUndefined()
  })

  it("is the running step's own while its agent works, and the entry after once it has filed", () => {
    const t = planned(work, work, work)
    expect(at(t, TrakState.AgentWorking({ step: 0 }))).toBe(0)
    for (const filed of [
      TrakState.CheckRunning({ step: 0 }),
      TrakState.AwaitingHuman({ step: 0, kind: "approval" }),
      TrakState.AwaitingHuman({ step: 0, kind: "checks" }),
      TrakState.Committing({ step: 0 }),
      TrakState.Effecting({ step: 0 }),
    ]) {
      expect(at(t, filed)).toBe(1)
    }
  })

  it("is the step itself at a gate it has not filed at, because answering resumes it", () => {
    const t = planned(work, work)
    for (const kind of ["answers", "conversation", "stuck"] as const) {
      expect(at(t, TrakState.AwaitingHuman({ step: 0, kind }))).toBe(0)
    }
  })

  it("steps over a spawn, whose children check their own work on their own logs", () => {
    const t = planned(work, spawn, work)
    expect(at(t, TrakState.Effecting({ step: 0 }))).toBe(2)
    for (const between of [
      TrakState.Spawning({ step: 1 }),
      TrakState.AwaitingChildren({ step: 1 }),
      TrakState.Joining({ step: 1 }),
    ]) {
      expect(at(t, between)).toBe(2)
    }
  })

  it("stops at a compose entry and at the end of the plan, where nothing of this plan runs", () => {
    expect(at(planned(work, compose, work), TrakState.Effecting({ step: 0 }))).toBeUndefined()
    expect(at(planned(work), TrakState.Effecting({ step: 0 }))).toBeUndefined()
    expect(
      at(planned(work), TrakState.AwaitingHuman({ step: 0, kind: "approval" })),
    ).toBeUndefined()
  })

  it("enters where an approved plan would, at the proposal gate", () => {
    // `firstUnrun` on a fresh plan is 0 — and a plan opening on a spawn walks past it.
    expect(at(planned(work, work), TrakState.AwaitingProposal())).toBe(0)
    expect(at(planned(spawn, work), TrakState.AwaitingProposal())).toBe(1)
  })

  it("answers nothing while the composer holds the plan, and once the trak is past its steps", () => {
    const t = planned(work, work)
    for (const state of [
      TrakState.Preparing(),
      TrakState.Composing(),
      TrakState.AwaitingComposerAnswers(),
      TrakState.Integrating(),
      TrakState.Finished(),
      TrakState.Merging(),
      TrakState.Closing({ merged: undefined }),
      TrakState.Closed(),
      TrakState.Abandoning({ reason: "r" }),
      TrakState.Abandoned({ reason: "r" }),
    ]) {
      expect(at(t, state)).toBeUndefined()
    }
  })
})

describe("what is put away", () => {
  it("is the three endings and the two archives in flight, and no other state", () => {
    // The five the client files under its archived pile, and the set the engine never
    // sends a row for. `Failed` is the one a failed archive lands in, and it comes back
    // out; `Finished` still holds a checkout and is drawn.
    expect(archived(TrakState.Closed())).toBe(true)
    expect(archived(TrakState.Merged({ sha: CommitSha.make("a91c04e") }))).toBe(true)
    expect(archived(TrakState.Abandoned({ reason: "not worth it" }))).toBe(true)
    expect(archived(TrakState.Closing({ merged: undefined }))).toBe(true)
    expect(archived(TrakState.Abandoning({ reason: "not worth it" }))).toBe(true)
    expect(archived(TrakState.Finished())).toBe(false)
    expect(
      archived(TrakState.Failed({ error: "git refused", kind: "worktree", apiKind: undefined })),
    ).toBe(false)
    expect(archived(TrakState.AgentWorking({ step: 0 }))).toBe(false)
  })
})

describe("a borrowed conversation the library can no longer price", () => {
  // The hole this closes: an agent file renamed or deleted while the trak runs. The
  // entry that minted the session still names it, so nothing can say what model that
  // session was minted with — and resuming it on the borrower's own is the
  // `codex exec resume <claude uuid>` the whole rule exists to stop.
  const borrower: Agent = {
    name: "work",
    description: "Does the work.",
    brief: "Do it.",
    model: "opus",
    permission: "write",
    sections: [],
    checks: [],
    effects: [],
    conditions: [],
    processes: [],
    skills: [],
    start: true,
    place: "sandbox" as const,
    icon: undefined,
    effort: undefined,
  }
  const lib: Library = {
    agents: new Map([[borrower.name, borrower]]),
    generic: { ...borrower, name: "generic", model: "haiku", start: false },
    checks: new Map(),
    processes: new Map(),
    tools: new Map(),
    setup: undefined,
    teardown: undefined,
    env: undefined,
    deploy: undefined,
    mcp: { servers: [], problems: [] },
    root: "/repo",
    models: {
      allowed: ["opus", "sonnet", "haiku"],
      efforts: new Map(),
      composer: "haiku",
      windows: {},
    },
    composition: "",
    goals: "",
    guidance: "",
  }

  /** The minting entry ran on `minter` and the borrower continues it. */
  const borrowing = (minter: string): Trak => ({
    ...emptyTrak(id),
    plan: {
      title: "the work",
      steps: [
        { agent: minter, instruction: "ask", conversational: true },
        { agent: "work", instruction: "fix it", continues: `0-${minter}` },
      ],
    },
    slots: new Map([[0, { ...noSlot, session: SessionId.make("s-0") }]]),
  })

  it("is borrowed and priced together where the minting entry still resolves", () => {
    const t = borrowing("work")
    expect(borrowedSession(t, 1, lib)).toBe(SessionId.make("s-0"))
    expect(modelAt(t, 1, lib)).toBe("opus")
  })

  it("is dropped rather than resumed on the borrower's own model", () => {
    // `gone` is not in the library. The session is there to be had and is left alone.
    const t = borrowing("gone")
    expect(borrowedSession(t, 1, lib)).toBeUndefined()
  })

  it("reads back as the fresh model it will actually run on, not as nothing", () => {
    // The spawn site starts fresh on `work`'s own file, so the header says `opus` —
    // the two answers come from one function precisely so they cannot differ.
    expect(modelAt(borrowing("gone"), 1, lib)).toBe("opus")
  })
})

/** A project with none of the scripts the engine runs outside a step, and no goal rules. */
const UNDECLARED = {
  setup: undefined,
  teardown: undefined,
  env: undefined,
  deploy: undefined,
  mcp: { servers: [], problems: [] },
  goals: "",
  tools: new Map(),
}

const work: Agent = {
  name: "work",
  description: "Does the work.",
  brief: "Do it.",
  model: "opus",
  permission: "write",
  sections: [],
  checks: [],
  effects: [],
  conditions: [],
  processes: [],
  skills: [],
  start: true,
  place: "sandbox" as const,
  icon: undefined,
  effort: undefined,
}
/** `chat` declares its own level; `work` runs at whatever `opus` defaults to. */
const chat: Agent = { ...work, name: "chat", model: "sonnet", effort: "max" }

describe("effortAt — the effort a step runs at, off the entry that minted its session", () => {
  const libWith = (efforts: ReadonlyMap<string, string>, ...agents: readonly Agent[]): Library => ({
    agents: new Map(agents.map((a) => [a.name, a])),
    generic: { ...work, name: "generic", model: "haiku", start: false },
    checks: new Map(),
    processes: new Map(),
    ...UNDECLARED,
    root: "/repo",
    models: { allowed: ["opus", "sonnet", "haiku"], efforts, composer: "haiku", windows: {} },
    composition: "",
    guidance: "",
  })
  const lib = libWith(
    new Map([
      ["opus", "high"],
      ["haiku", "low"],
    ]),
    work,
    chat,
  )
  const planned = (
    steps: NonNullable<Trak["plan"]>["steps"],
    sessions: readonly number[] = [],
  ): Trak => ({
    ...emptyTrak(id),
    plan: { title: "the work", steps },
    slots: new Map(
      sessions.map((i) => [i, { ...noSlot, session: SessionId.make(`s-${String(i)}`) }]),
    ),
  })

  it("is the agent file's own level, else the model's default, else nothing", () => {
    const t = planned([
      { agent: "chat", instruction: "ask", conversational: true },
      { agent: "work", instruction: "do it" },
    ])
    expect(effortAt(t, 0, lib)).toBe("max")
    expect(effortAt(t, 1, lib)).toBe("high")
    expect(effortAt(t, 1, libWith(new Map(), work))).toBeUndefined()
  })

  it("is the picked model's default where New Chat picked one, and never the file's level", () => {
    // `chat`'s `max` was checked against its own model's CLI; the pick may be on the other.
    const t = planned([{ agent: "chat", instruction: "ask", conversational: true, model: "opus" }])
    expect(effortAt(t, 0, lib)).toBe("high")
    expect(
      effortAt(planned([{ agent: "chat", instruction: "ask", model: "sonnet" }]), 0, lib),
    ).toBeUndefined()
  })

  it("is the composer's model's default on a compose entry", () => {
    expect(effortAt(planned([{ type: "compose" }]), 0, lib)).toBe("low")
  })

  it("follows the minting entry for a step continuing its conversation, not its own file", () => {
    // `work` on its own runs at `high`; continuing `chat`'s session, it runs at `max`.
    const t = planned(
      [
        { agent: "chat", instruction: "ask", conversational: true },
        { agent: "work", instruction: "fix it", continues: "0-chat" },
      ],
      [0],
    )
    expect(effortAt(t, 1, lib)).toBe("max")
    expect(modelAt(t, 1, lib)).toBe("sonnet")
  })

  it("carries a minting entry's *absence* of effort too, rather than falling back to its own", () => {
    // The trap: `modelAt`'s `??` copied for effort would hand the borrower `work`'s
    // `high` here, and no test would fail. The conversation declared none, so none.
    const t = planned(
      [
        { agent: "plain", instruction: "ask", conversational: true },
        { agent: "work", instruction: "fix it", continues: "0-plain" },
      ],
      [0],
    )
    const plain: Agent = { ...work, name: "plain", model: "sonnet" }
    expect(effortAt(t, 1, libWith(lib.models.efforts, work, plain))).toBeUndefined()
  })

  it("falls back to the step's own where the minting entry's agent is gone, as the model does", () => {
    const t = planned(
      [
        { agent: "gone", instruction: "ask", conversational: true },
        { agent: "work", instruction: "fix it", continues: "0-gone" },
      ],
      [0],
    )
    expect(modelAt(t, 1, lib)).toBe("opus")
    expect(effortAt(t, 1, lib)).toBe("high")
  })
})
