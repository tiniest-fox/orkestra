import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { SessionId } from "../../agent/types/session.js"
import { TEMPLATE_NAMES, type Templates } from "../../prompts/index.js"
import {
  buildGoalPrompt,
  type Goal,
  GoalEvent,
  GoalEvents,
  goalChatWith,
  goalHandOffs,
  goalOffers,
  heldGoalChat,
  type GoalSpec,
  outcomeOf,
  outcomeSince,
  owesTurn,
  replayGoal,
  sharedBudget,
  subgoalOutcome,
  subgoalSpec,
  unread,
} from "./goal.js"
import { CommitSha } from "../../vcs/index.js"
import { Events } from "./event.js"
import { emptyTrak, GoalId, noSlot, TrakId, TrakState, UserId } from "./trak.js"
import { BranchName } from "../../vcs/index.js"

const SPEC: GoalSpec = { file: "g", title: "G", line: "l", finished: "done", limits: {} }
const SESSION = SessionId.make("00000000-0000-4000-8000-000000000001")
const A = TrakId.make("a")
const PLANNED = { title: "A", description: "do a", mode: "smart" as const }
const WHICH = [{ question: "Which?", options: [{ label: "this" }, { label: "that" }] }] as const
const REQUEST = {
  trak: undefined,
  title: "Add the deploy key",
  steps: ["Open the repository settings", "Add the key as read-only"],
  why: "The traks cannot push without it.",
} as const
const SCOPE = [
  {
    question: "How far does it go?",
    options: [
      { label: "the engine", description: "smallest", recommended: true },
      { label: "the engine and the CLI" },
    ],
  },
  { question: "Is the admin view in?", context: "It has its own routes.", options: [] },
  { question: "One service or two?", options: [{ label: "one" }, { label: "two" }] },
] as const

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "prompts", "templates")
const templates: Templates = new Map(
  TEMPLATE_NAMES.map((n) => [n, readFileSync(join(DIR, `${n}.md`), "utf8")]),
)

/** The goal a log adds up to, after the start every log opens with. */
const after = (...events: readonly GoalEvent[]): Goal => {
  const goal = replayGoal(GoalId.make("g-1"), [GoalEvents.started(SPEC), ...events])
  if (goal === undefined) throw new Error("a started log replays to a goal")
  return goal
}

/** A plan put to the person, as a log written before goals opened traks unasked holds one. */
const proposed = [
  GoalEvents.planProposed("c1", [PLANNED], undefined),
  GoalEvents.turnEnded(SESSION, 0, undefined),
] as const
const approved = [...proposed, GoalEvents.acted({ _tag: "Approve" })] as const
const watching = [
  GoalEvents.replanned("c1", [PLANNED], "The first piece is clear."),
  GoalEvents.trakOpened("c2", A, "A", "smart"),
  GoalEvents.turnEnded(SESSION, 0, undefined),
] as const

describe("an old goal log standing at a plan gate", () => {
  it("asks for nobody while the turn that proposed the plan runs", () => {
    const goal = after(GoalEvents.planProposed("c1", [PLANNED], undefined))
    expect(goal.state._tag).toBe("Composing")
    expect(owesTurn(goal)).toBe(true)
    expect(goal.pending).toBe("plan")
  })

  it("replays to the plan gate, offering approve and chat", () => {
    const goal = after(...proposed)
    expect(goal.state).toMatchObject({ _tag: "AtGate", gate: "plan" })
    expect(goal.session).toBe(SESSION)
    expect(goal.plan).toEqual([PLANNED])
    expect(goalOffers(goal.state)).toEqual(["Approve", "Chat"])
  })

  it("owes the approved turn, which opens traks as before", () => {
    const goal = after(...approved)
    expect(goal.state._tag).toBe("Composing")
    expect(goal.owed?._tag).toBe("Approved")
    expect(buildGoalPrompt(templates, goal, [], [goal])).toContain("The person approved the plan.")
    const opened = after(
      ...approved,
      GoalEvents.trakOpened("c2", A, "A", "smart"),
      GoalEvents.turnEnded(SESSION, 0, undefined),
    )
    expect(opened.state._tag).toBe("Watching")
    expect(opened.traks).toMatchObject([{ id: A, status: "live" }])
  })
})

describe("a goal's first turn with a file", () => {
  it("tells the first turn with a file to open what it is confident in, and asks for no plan", () => {
    const fromFile = buildGoalPrompt(templates, after(), [], [])
    const filed = buildGoalPrompt(
      templates,
      asked(
        GoalEvents.drafted("d1", SPEC),
        GoalEvents.turnEnded(SESSION, 0, undefined),
        GoalEvents.acted({ _tag: "Approve" }),
      ),
      [],
      [],
    )
    for (const prompt of [fromFile, filed]) {
      expect(prompt).toContain("Open the traks you are confident in")
      expect(prompt).not.toMatch(/propose_plan|Propose the plan/)
    }
    expect(filed).toContain("The person approved the goal file.")
  })
})

describe("a goal's log", () => {
  it("opens a trak on its first turn, with no gate before it", () => {
    const goal = after(GoalEvents.trakOpened("c2", A, "A", "smart"))
    expect(goal.state._tag).toBe("Composing")
    expect(goal.pending).toBeUndefined()
    expect(goal.traks).toMatchObject([{ id: A, status: "live" }])
  })

  it("watches once a turn ends with nothing asked", () => {
    const goal = after(...watching)
    expect(goal.state._tag).toBe("Watching")
    expect(goal.traks).toMatchObject([{ id: A, status: "live" }])
  })

  it("wakes the composer when a trak lands, and counts it landed", () => {
    const goal = after(...watching, GoalEvents.trakWoke(A, "landed", 2))
    expect(goal.state._tag).toBe("Composing")
    expect(goal.owed?._tag).toBe("Woken")
    expect(goal.traks).toMatchObject([{ id: A, status: "landed" }])
    expect(unread(goal)).toEqual([{ trak: A, kind: "landed" }])
  })

  it("owes another turn for a wake that landed while a turn ran", () => {
    const goal = after(
      ...watching,
      GoalEvents.trakWoke(A, "failed", 2),
      GoalEvents.trakWoke(A, "stuck", 2),
      // The turn was shown the first wake only.
      GoalEvents.turnEnded(SESSION, 1, undefined),
    )
    expect(goal.state._tag).toBe("Composing")
    expect(unread(goal)).toEqual([{ trak: A, kind: "stuck" }])
  })

  it("keeps a wake that arrives at a gate for the turn the gate's answer starts", () => {
    const goal = after(...proposed, GoalEvents.trakWoke(A, "failed", 2))
    expect(goal.state).toMatchObject({ _tag: "AtGate", gate: "plan" })
    expect(unread(goal)).toHaveLength(1)
  })

  it("takes no turn while paused, and one when resumed from watching", () => {
    const paused = after(...watching, GoalEvents.paused([A]), GoalEvents.trakWoke(A, "landed", 2))
    expect(paused.state._tag).toBe("Composing")
    expect(owesTurn(paused)).toBe(false)
    expect(paused.held).toEqual([A])
    const resumed = after(...watching, GoalEvents.paused([A]), GoalEvents.resumed([A]))
    expect(resumed.owed?._tag).toBe("Resumed")
    expect(owesTurn(resumed)).toBe(true)
    expect(resumed.held).toEqual([])
  })

  it("stops for the person on an escalation, and owes the turn their answer starts", () => {
    const asked = after(
      ...watching,
      GoalEvents.trakWoke(A, "stuck", 2),
      GoalEvents.escalated("c3", A, WHICH),
      GoalEvents.turnEnded(SESSION, 1, undefined),
    )
    expect(asked.state).toMatchObject({ _tag: "AtGate", gate: "escalation" })
    const answered = after(
      ...watching,
      GoalEvents.escalated("c3", A, WHICH),
      GoalEvents.turnEnded(SESSION, 0, undefined),
      GoalEvents.acted({ _tag: "Answer", answers: ["this"] }),
    )
    expect(answered.owed).toMatchObject({ _tag: "Answered", answers: ["this"], questions: WHICH })
    expect(answered.escalation).toBeUndefined()
  })

  it("ends at done once the person confirms, and takes nothing after", () => {
    const goal = after(
      ...watching,
      GoalEvents.doneProposed("c4", "it holds"),
      GoalEvents.turnEnded(SESSION, 0, undefined),
      GoalEvents.acted({ _tag: "Confirm" }),
      GoalEvents.acted({ _tag: "Chat", message: "one more" }),
    )
    expect(goal.state._tag).toBe("Done")
    expect(goalOffers(goal.state)).toEqual([])
  })

  it("fails a turn the provider lost, and owes it again on a retry", () => {
    const failed = after(GoalEvents.turnFailed(undefined, 0, "usage limit", undefined))
    expect(failed.state).toMatchObject({ _tag: "Failed", reason: "usage limit" })
    const retried = after(
      GoalEvents.turnFailed(undefined, 0, "usage limit", undefined),
      GoalEvents.acted({ _tag: "Retry" }),
    )
    expect(retried.state._tag).toBe("Composing")
    expect(retried.owed?._tag).toBe("Started")
  })

  it("leaves the goal where it was for a press it does not offer", () => {
    expect(after(...watching, GoalEvents.acted({ _tag: "Approve" })).state._tag).toBe("Watching")
  })
})

describe("a new session", () => {
  it("retries in a new session only where a person presses it, with the whole brief", () => {
    const failed = [
      ...watching,
      GoalEvents.turnFailed(SESSION, 0, "No conversation found", undefined),
    ]
    expect(after(...failed).session).toBe(SESSION)
    expect(goalOffers(after(...failed).state)).toEqual(["Retry", "NewSession", "Chat"])
    const retried = after(...failed, GoalEvents.acted({ _tag: "Retry" }))
    expect(retried.session).toBe(SESSION)
    expect(buildGoalPrompt(templates, retried, [], [], "Use a goal branch.")).not.toContain(
      "Use a goal branch.",
    )
    const fresh = after(...failed, GoalEvents.acted({ _tag: "NewSession" }))
    expect(fresh.session).toBeUndefined()
    expect(fresh.owed?._tag).toBe("Started")
    expect(buildGoalPrompt(templates, fresh, [], [], "Use a goal branch.")).toContain(
      "Use a goal branch.",
    )
    expect(after(...watching, GoalEvents.acted({ _tag: "NewSession" })).session).toBe(SESSION)
  })
})

/** The goal a log started from a sentence adds up to. */
const asked = (...events: readonly GoalEvent[]): Goal => {
  const goal = replayGoal(GoalId.make("g-2"), [
    GoalEvents.asked("make search work", ["smart", "auto"]),
    ...events,
  ])
  if (goal === undefined) throw new Error("an asked log replays to a goal")
  return goal
}

describe("whose goal it is", () => {
  it("is the owner its opening event names, and nobody's on a log from before owners", () => {
    const id = GoalId.make("g-1")
    const owner = UserId.make("gh:583231")
    expect(replayGoal(id, [GoalEvents.started(SPEC, owner)])?.owner).toBe(owner)
    expect(replayGoal(id, [GoalEvents.asked("do it", ["manual"], undefined, owner)])?.owner).toBe(
      owner,
    )
    expect(GoalEvents.started(SPEC)).not.toHaveProperty("owner")
    const old = Schema.decodeUnknownSync(GoalEvent)({ _tag: "GoalStarted", spec: SPEC })
    expect(replayGoal(id, [old])?.owner).toBeUndefined()
  })

  it("is the new owner after a take, which names the one before where there was one", () => {
    const id = GoalId.make("g-1")
    const [alice, bob] = [UserId.make("gh:1"), UserId.make("gh:2")]
    const taken = replayGoal(id, [
      GoalEvents.started(SPEC, alice),
      GoalEvents.ownerChanged(alice, bob),
    ])
    expect(taken?.owner).toBe(bob)
    expect(GoalEvents.ownerChanged(undefined, bob)).not.toHaveProperty("from")
    expect(
      replayGoal(id, [GoalEvents.started(SPEC), GoalEvents.ownerChanged(undefined, bob)])?.owner,
    ).toBe(bob)
  })
})

describe("work asked of the person by hand", () => {
  it("stops for the person on a request for work by hand, and owes the turn their report starts", () => {
    const parked = after(
      ...watching,
      GoalEvents.actionRequested("c3", REQUEST),
      GoalEvents.turnEnded(SESSION, 0, undefined),
    )
    expect(parked.state).toMatchObject({ _tag: "AtGate", gate: "action" })
    expect(parked.action).toEqual(REQUEST)
    expect(goalOffers(parked.state)).toEqual(["Reported", "Chat"])
    const reported = after(
      ...watching,
      GoalEvents.actionRequested("c3", REQUEST),
      GoalEvents.turnEnded(SESSION, 0, undefined),
      GoalEvents.acted({ _tag: "Reported", done: true }),
    )
    expect(reported.owed).toMatchObject({ _tag: "Reported", request: REQUEST, done: true })
    expect(reported.action).toBeUndefined()
    expect(owesTurn(reported)).toBe(true)
  })

  it("holds the action gate until the turn that asked for it ends", () => {
    const running = after(GoalEvents.actionRequested("c3", REQUEST))
    expect(running.state._tag).toBe("Composing")
    expect(running.pending).toBe("action")
  })

  it("tells the turn after a report what was asked and what the person said", () => {
    const at = [
      ...watching,
      GoalEvents.actionRequested("c3", REQUEST),
      GoalEvents.turnEnded(SESSION, 0, undefined),
    ] as const
    const done = buildGoalPrompt(
      templates,
      after(...at, GoalEvents.acted({ _tag: "Reported", done: true })),
      [],
      [],
    )
    expect(done).toContain(
      "You asked the person to do this by hand: **Add the deploy key**\n\n1. Open the repository settings\n2. Add the key as read-only",
    )
    expect(done).toContain("They report it done.")
    expect(done).not.toContain("could not")
    const couldnt = buildGoalPrompt(
      templates,
      after(...at, GoalEvents.acted({ _tag: "Reported", done: false, note: "I am not an admin" })),
      [],
      [],
    )
    expect(couldnt).toContain("They report they could not do it.")
    expect(couldnt).toContain("They say:\n\nI am not an admin")
  })
})

describe("a goal started from a sentence", () => {
  const drafted = [
    GoalEvents.drafted("d1", SPEC),
    GoalEvents.turnEnded(SESSION, 0, undefined),
  ] as const

  it("has no spec, and owes the turn that drafts one", () => {
    const goal = asked()
    expect(goal.spec).toBeUndefined()
    expect(goal.asked).toBe("make search work")
    expect(owesTurn(goal)).toBe(true)
  })

  it("stops at the file gate with the draft, offering approve and chat", () => {
    const goal = asked(...drafted)
    expect(goal.state).toMatchObject({ _tag: "AtGate", gate: "file" })
    expect(goal.draft).toEqual(SPEC)
    expect(goalOffers(goal.state)).toEqual(["Approve", "Chat"])
  })

  it("makes the draft its spec on approval, and owes the turn that plans", () => {
    const goal = asked(...drafted, GoalEvents.acted({ _tag: "Approve" }))
    expect(goal.spec).toEqual(SPEC)
    expect(goal.draft).toBeUndefined()
    expect(goal.owed?._tag).toBe("Filed")
  })

  it("comes back to the file gate after a chat turn that drafts nothing", () => {
    const goal = asked(
      ...drafted,
      GoalEvents.acted({ _tag: "Chat", message: "why two at a time?" }),
      GoalEvents.turnEnded(SESSION, 0, undefined),
    )
    expect(goal.state).toMatchObject({ _tag: "AtGate", gate: "file" })
    expect(goal.draft).toEqual(SPEC)
    expect(goalOffers(goal.state)).toContain("Approve")
  })

  it("replays an old log's Redraft as nothing, and lands on the file gate with the later draft", () => {
    const later = { ...SPEC, title: "G, again" }
    const redraft = Schema.decodeUnknownSync(GoalEvent)({
      _tag: "GoalActed",
      action: { _tag: "Redraft" },
    })
    const pressed = asked(...drafted, redraft)
    expect([pressed.state, pressed.owed]).toEqual([asked(...drafted).state, undefined])
    const goal = asked(
      ...drafted,
      redraft,
      GoalEvents.drafted("d2", later),
      GoalEvents.turnEnded(SESSION, 0, undefined),
    )
    expect(goal.state).toMatchObject({ _tag: "AtGate", gate: "file" })
    expect(goal.draft).toEqual(later)
  })

  it("files the draft under the limits the person set on Approve, and keeps the rest of it", () => {
    const draft = { ...SPEC, limits: { parallel: 2, modes: ["smart", "auto"] as const } }
    const limits = { parallel: 3, modes: ["smart"] as const, autoMerge: "always" as const }
    const goal = asked(
      GoalEvents.drafted("d1", draft),
      GoalEvents.turnEnded(SESSION, 0, undefined),
      GoalEvents.acted({ _tag: "Approve", limits }),
    )
    expect(goal.spec).toEqual({ ...SPEC, limits })
  })

  it("files the goal branch the person left on Approve: kept, changed, or cleared", () => {
    const draft = { ...SPEC, branch: "goal/drafted" }
    const approve = (action: Extract<GoalEvent, { _tag: "GoalActed" }>["action"]) =>
      asked(
        GoalEvents.drafted("d1", draft),
        GoalEvents.turnEnded(SESSION, 0, undefined),
        GoalEvents.acted(action),
      ).spec
    expect(approve({ _tag: "Approve" })?.branch).toBe("goal/drafted")
    expect(approve({ _tag: "Approve", limits: {}, branch: "goal/mine" })?.branch).toBe("goal/mine")
    expect(approve({ _tag: "Approve", limits: {} })).not.toHaveProperty("branch")
  })
})

describe("a goal at rest", () => {
  it("records when it ended, and is dismissed only once at rest", () => {
    const going = after(...watching, GoalEvents.dismissed())
    expect(going.dismissed).toBe(false)
    const dropped = { ...GoalEvents.dropped("enough"), at: 5 }
    const goal = after(...watching, dropped, GoalEvents.dismissed())
    expect(goal.endedAt).toBe(5)
    expect(goal.dismissed).toBe(true)
  })

  it("takes a trak the composer dropped off the plan, and not one a person archived", () => {
    expect(after(...watching, GoalEvents.trakDropped("c3", A, "redundant")).plan).toEqual([])
    expect(after(...watching, GoalEvents.trakDropped(undefined, A, "archived")).plan).toEqual([
      PLANNED,
    ])
  })
})

describe("a trak's hand-off, which goes to its goal", () => {
  it("wakes a watching goal with the descriptions, and records the entry as filed", () => {
    const goal = after(...watching, GoalEvents.trakHandedOff(A, 0, ["fix the hook"]))
    expect(goal.state._tag).toBe("Composing")
    expect(goal.owed?._tag).toBe("Woken")
    expect(unread(goal)).toEqual([{ trak: A, kind: "handedOff", handOff: ["fix the hook"] }])
    expect(goal.traks).toMatchObject([{ id: A, status: "live", handedOff: [0], filed: undefined }])
  })

  it("reads the hand-offs that named no trak off the trak, and skips one that named some", () => {
    const toGoal = {
      ...noSlot,
      handOffs: ["fix the hook"],
      handedOff: { base: undefined, ids: [] },
    }
    const opened = {
      ...noSlot,
      handOffs: ["elsewhere"],
      handedOff: { base: BranchName.make("main"), ids: [TrakId.make("b")] },
    }
    const pending = { ...noSlot, handOffs: ["not yet"] }
    const t = {
      ...emptyTrak(A),
      slots: new Map([
        [4, toGoal],
        [0, opened],
        [2, pending],
        [1, toGoal],
      ]),
    }
    expect(goalHandOffs(t)).toEqual([
      { step: 1, handOff: ["fix the hook"] },
      { step: 4, handOff: ["fix the hook"] },
    ])
  })
})

describe("outcomeSince", () => {
  const born = Events.trakForGoal("w", "smart", GoalId.make("g-1"))

  it("names the line a trak reached its outcome at, and keeps it through a re-park", () => {
    expect(outcomeSince(A, [born])).toEqual({ outcome: undefined, since: 0 })
    expect(outcomeSince(A, [born, Events.worktreeFailed("x")])).toEqual({
      outcome: "failed",
      since: 2,
    })
    expect(outcomeSince(A, [born, Events.worktreeFailed("x"), Events.holdChanged(true)])).toEqual({
      outcome: "failed",
      since: 2,
    })
  })

  it("moves the line when the trak leaves the outcome and reaches it again", () => {
    const again = [
      born,
      Events.worktreeFailed("x"),
      Events.restarted(undefined),
      Events.worktreeFailed("y"),
    ]
    expect(outcomeSince(A, again)).toEqual({ outcome: "failed", since: 4 })
  })
})

describe("outcomeOf", () => {
  it("reads a close as a landing where nothing was ever committed, and as an archive where something was", () => {
    expect(outcomeOf(TrakState.Closed(), false)).toBe("landed")
    expect(outcomeOf(TrakState.Closed(), true)).toBe("ended")
  })

  it("reads a merge as a landing and an abandon as an archive, whatever was committed", () => {
    const sha = CommitSha.make("abc")
    expect(outcomeOf(TrakState.Merged({ sha }), true)).toBe("landed")
    expect(outcomeOf(TrakState.Abandoned({ reason: "no" }), false)).toBe("ended")
  })

  it("reads a finished trak the engine stopped merging as stuck, and nothing else as it", () => {
    expect(outcomeOf(TrakState.Finished(), true, true)).toBe("stuck")
    expect(outcomeOf(TrakState.Finished(), true, false)).toBeUndefined()
  })
})

/** A goal started from a sentence, after `events`. */
const askedThen = (...events: readonly GoalEvent[]): Goal => {
  const goal = replayGoal(GoalId.make("g-2"), [
    GoalEvents.asked("Make search work", ["smart"]),
    ...events,
  ])
  if (goal === undefined) throw new Error("an asked log replays to a goal")
  return goal
}

const scoped = [
  GoalEvents.escalated("c1", undefined, SCOPE),
  GoalEvents.turnEnded(SESSION, 0, undefined),
] as const

describe("a goal's scoping round", () => {
  it("stops a goal with no file at the escalation gate, every question on it", () => {
    const goal = askedThen(...scoped)
    expect(goal.state).toMatchObject({ _tag: "AtGate", gate: "escalation" })
    expect(goal.draft).toBeUndefined()
    expect(goal.escalation?.questions).toEqual(SCOPE)
    expect(goalOffers(goal.state)).toEqual(["Answer", "Chat"])
  })

  it("owes a turn on the answers that pairs each with its question and keeps the note", () => {
    const goal = askedThen(
      ...scoped,
      GoalEvents.acted({ _tag: "Answer", answers: ["the engine", "no", "one"], note: "by Friday" }),
    )
    const prompt = buildGoalPrompt(templates, goal, [], [])
    expect(prompt).toContain("1. How far does it go? — the engine")
    expect(prompt).toContain("2. Is the admin view in? — no")
    expect(prompt).toContain("3. One service or two? — one")
    expect(prompt).toContain("by Friday")
    // Drafting, the answered turn is told to draft rather than left with no order.
    expect(prompt).toContain("Draft the goal file with `draft_goal` now")
  })

  it("tells a drafting goal's report turn to draft, or to ask again where it could not be done", () => {
    const requested = [
      GoalEvents.actionRequested("c1", REQUEST),
      GoalEvents.turnEnded(SESSION, 0, undefined),
    ] as const
    const done = buildGoalPrompt(
      templates,
      askedThen(...requested, GoalEvents.acted({ _tag: "Reported", done: true })),
      [],
      [],
    )
    expect(done).toContain("Draft the goal file with `draft_goal` now, from the sentence")
    const couldnt = buildGoalPrompt(
      templates,
      askedThen(
        ...requested,
        GoalEvents.acted({ _tag: "Reported", done: false, note: "no admin" }),
      ),
      [],
      [],
    )
    expect(couldnt).toContain("Draft the goal file with `draft_goal` now, around what could not")
    expect(couldnt).toContain("`request_action` for another way")
    // A filed goal's report turn is told nothing about drafting.
    const filed = buildGoalPrompt(
      templates,
      after(...watching, ...requested, GoalEvents.acted({ _tag: "Reported", done: true })),
      [],
      [],
    )
    expect(filed).not.toContain("draft_goal")
  })

  it("tells a filed goal's answered turn nothing about drafting", () => {
    const goal = after(
      ...watching,
      GoalEvents.escalated("c3", A, WHICH),
      GoalEvents.turnEnded(SESSION, 0, undefined),
      GoalEvents.acted({ _tag: "Answer", answers: ["that"] }),
    )
    const prompt = buildGoalPrompt(templates, goal, [], [])
    expect(prompt).toContain("1. Which? — that")
    expect(prompt).not.toContain("draft_goal")
  })

  it("hands the project's GOALS.md to the turn that opens the session, and to no other", () => {
    expect(buildGoalPrompt(templates, after(), [], [], "Propose a goal branch.")).toContain(
      "## This project's rules for goals\n\nPropose a goal branch.",
    )
    expect(buildGoalPrompt(templates, askedThen(), [], [], "Propose a goal branch.")).toContain(
      "Propose a goal branch.",
    )
    expect(buildGoalPrompt(templates, after(), [], [])).not.toContain("rules for goals")
    expect(buildGoalPrompt(templates, after(...watching), [], [], "Propose one.")).not.toContain(
      "Propose one.",
    )
  })

  it("tells a fresh goal with a goal branch where its traks land", () => {
    const goal = replayGoal(GoalId.make("g-3"), [GoalEvents.started({ ...SPEC, branch: "goal/g" })])
    expect(goal === undefined ? "" : buildGoalPrompt(templates, goal, [], [])).toContain(
      "On the goal branch `goal/g`",
    )
    expect(buildGoalPrompt(templates, after(), [], [])).not.toContain("goal branch")
  })

  it("asks the first turn of a sentence to weigh its scope before drafting", () => {
    const prompt = buildGoalPrompt(templates, askedThen(), [], [])
    expect(prompt).toContain("`escalate`")
    expect(prompt).toContain("draft the goal\nfile with `draft_goal`")
  })
})

describe("the other goals a composer is pointed at", () => {
  const other = (...events: readonly GoalEvent[]): Goal => {
    const spec = {
      ...SPEC,
      file: "search",
      title: "Search",
      line: "find anything",
      finished: "Every page is searchable.\n\nNothing is indexed twice.",
    }
    const goal = replayGoal(GoalId.make("g-3"), [GoalEvents.started(spec), ...events])
    if (goal === undefined) throw new Error("a started log replays to a goal")
    return goal
  }

  it("lists another going goal's title, line, finished state and traks, and names no file", () => {
    const me = after(...watching)
    const prompt = buildGoalPrompt(templates, me, [], [me, other(...watching)])
    expect(prompt).toContain("## Other goals going in this project")
    expect(prompt).toContain(
      "- **Search** — find anything\n  - Finished when:\n    Every page is searchable.\n\n    Nothing is indexed twice.\n  - Trak `a` — A (live)",
    )
    expect(prompt).not.toContain(".orkestra/goals")
  })

  it("lists a goal still drafting by its sentence, with no finished state yet", () => {
    const me = after(...watching)
    const drafting = replayGoal(GoalId.make("g-4"), [
      GoalEvents.asked("Make search work", ["smart"]),
    ])
    if (drafting === undefined) throw new Error("an asked log replays to a goal")
    const prompt = buildGoalPrompt(templates, me, [], [me, drafting])
    expect(prompt).toContain("  - Not approved yet: it is still being drafted.")
  })

  it("leaves the section out when no other goal is going", () => {
    const me = after(...watching)
    const doneElsewhere = other(...watching, GoalEvents.dropped("enough"))
    for (const goals of [[], [me], [me, doneElsewhere]]) {
      expect(buildGoalPrompt(templates, me, [], goals)).not.toContain("Other goals")
    }
  })
})

const decoded = (line: unknown): GoalEvent => Schema.decodeUnknownSync(GoalEvent)(line)

describe("a goal log written before an escalation asked several questions", () => {
  const OLD = [
    { _tag: "GoalAsked", asked: "Make search work", modes: ["smart"] },
    { _tag: "Escalated", call: "c1", question: "Which?", answers: ["this", "that"] },
    { _tag: "GoalTurnEnded", sessionId: SESSION, read: 0 },
    { _tag: "GoalActed", action: { _tag: "Answer", answer: "this" } },
  ]

  it("reads its one question and its one answer as the current shapes", () => {
    const [, escalated, , answer] = OLD.map(decoded)
    expect(escalated).toEqual(GoalEvents.escalated("c1", undefined, WHICH))
    expect(answer).toEqual(GoalEvents.acted({ _tag: "Answer", answers: ["this"] }))
  })

  it("replays to the gate it stood at, and to the turn its answer owed", () => {
    const history = OLD.map(decoded)
    const atGate = replayGoal(GoalId.make("old"), history.slice(0, 3))
    expect(atGate?.escalation?.questions).toEqual(WHICH)
    const answered = replayGoal(GoalId.make("old"), history)
    expect(answered?.owed).toMatchObject({ _tag: "Answered", answers: ["this"], questions: WHICH })
  })

  it("is written back in the current shape", () => {
    const [, escalated] = OLD.map(decoded)
    if (escalated === undefined) throw new Error("decoded")
    expect(Schema.encodeSync(GoalEvent)(escalated)).toMatchObject({ questions: WHICH })
  })
})

describe("a goal a trak's agent opened", () => {
  const FROM = TrakId.make("chat-1")

  it("names the trak and the call that opened it", () => {
    const goal = replayGoal(GoalId.make("g-3"), [
      GoalEvents.asked("make search work", ["smart"], { from: FROM, call: "toolu_1" }),
    ])
    expect(goal?.openedBy).toEqual({ from: FROM, call: "toolu_1" })
  })

  it("replays a log written before one could, where no trak opened it", () => {
    const old = decoded({ _tag: "GoalAsked", asked: "Make search work", modes: ["smart"] })
    expect(replayGoal(GoalId.make("g-4"), [old])?.openedBy).toBeUndefined()
  })
})

describe("a running goal's settings", () => {
  it("replaces the spec's limits whole, and owes no turn", () => {
    const limits = { perDay: 4, autoMerge: "never" as const }
    const goal = after(...watching, GoalEvents.settingsChanged(limits))
    expect(goal.spec?.limits).toEqual(limits)
    expect(goal.state._tag).toBe("Watching")
    expect(goal.owed).toBeUndefined()
  })

  it("tells the next turn the new limits, Always among them", () => {
    const goal = after(...watching, GoalEvents.settingsChanged({ autoMerge: "always" }))
    expect(buildGoalPrompt(templates, goal, [], [goal])).toContain(
      "Every trak opens with `auto_merge`, whatever you pass",
    )
  })
})

describe("a goal log written while auto-merge was a switch", () => {
  const started = (autoMerge: boolean) =>
    decoded({ _tag: "GoalStarted", spec: { ...SPEC, limits: { parallel: 1, autoMerge } } })

  it("reads false as never and true as the composer deciding", () => {
    expect(started(false)).toEqual(
      GoalEvents.started({ ...SPEC, limits: { parallel: 1, autoMerge: "never" } }),
    )
    expect(started(true)).toEqual(GoalEvents.started({ ...SPEC, limits: { parallel: 1 } }))
  })

  it("replays, and is written back in the current shape", () => {
    const event = started(false)
    expect(replayGoal(GoalId.make("old"), [event])?.spec?.limits.autoMerge).toBe("never")
    expect(Schema.encodeSync(GoalEvent)(event)).toMatchObject({
      spec: { limits: { autoMerge: "never" } },
    })
  })
})

describe("a message written while the composer works", () => {
  const woken = [...watching, GoalEvents.trakWoke(A, "failed", 3)] as const

  it("is offered as a chat while a turn is owed or running, and waits rather than owing one", () => {
    const goal = after(...woken, GoalEvents.messageWaiting("k1", "also the docs"))
    expect(goalOffers(goal.state)).toContain("Chat")
    expect(goal.owed?._tag).toBe("Woken")
    expect(goal.messages).toEqual([{ id: "k1", message: "also the docs", attachments: [] }])
  })

  it("stops waiting once the composer reads it", () => {
    const goal = after(
      ...woken,
      GoalEvents.messageWaiting("k1", "also the docs"),
      GoalEvents.messageWaiting("k2", "and the readme"),
      GoalEvents.messageHeard("k1"),
    )
    expect(goal.messages).toEqual([{ id: "k2", message: "and the readme", attachments: [] }])
  })

  it("is the next chat once the turn ends unread, every waiting one joined oldest first", () => {
    const ended = after(
      ...woken,
      GoalEvents.messageWaiting("k1", "also the docs"),
      GoalEvents.messageWaiting("k2", "and the readme"),
      GoalEvents.turnEnded(SESSION, 1, undefined),
    )
    const held = heldGoalChat(ended)
    expect(held).toMatchObject({
      _tag: "GoalActed",
      action: { _tag: "Chat", message: "also the docs\n\nand the readme" },
    })
    if (held === undefined) throw new Error("a chat is held")
    const chatted = after(
      ...woken,
      GoalEvents.messageWaiting("k1", "also the docs"),
      GoalEvents.messageWaiting("k2", "and the readme"),
      GoalEvents.turnEnded(SESSION, 1, undefined),
      held,
    )
    expect(chatted.owed).toEqual({ _tag: "Said", message: "also the docs\n\nand the readme" })
    expect(chatted.messages).toEqual([])
    expect(heldGoalChat(chatted)).toBeUndefined()
  })

  it("holds no chat where nothing waits", () => {
    expect(
      heldGoalChat(after(...woken, GoalEvents.turnEnded(SESSION, 1, undefined))),
    ).toBeUndefined()
  })

  it("is said before what the person writes next", () => {
    const goal = after(...woken, GoalEvents.messageWaiting("k1", "also the docs"))
    expect(goalChatWith(goal, "and now this")).toEqual({
      _tag: "Chat",
      message: "also the docs\n\nand now this",
    })
  })
})

describe("a stopped composer turn", () => {
  const OTHER = SessionId.make("00000000-0000-4000-8000-000000000002")

  it("opens the gate the turn asked for", () => {
    const goal = after(
      GoalEvents.planProposed("c1", [PLANNED], undefined),
      GoalEvents.turnStopped(OTHER),
    )
    expect(goal.state).toMatchObject({ _tag: "AtGate", gate: "plan" })
    expect(goal.session).toBe(OTHER)
  })

  it("leaves a goal drafting its file at the file gate while a draft waits", () => {
    const goal = asked(
      GoalEvents.drafted("d1", SPEC),
      GoalEvents.turnEnded(SESSION, 0, undefined),
      GoalEvents.acted({ _tag: "Chat", message: "shorter" }),
      GoalEvents.turnStopped(undefined),
    )
    expect(goal.state).toMatchObject({ _tag: "AtGate", gate: "file" })
    expect(goal.session).toBe(SESSION)
  })

  it("watches, owing nothing, even with wakes the turn never read", () => {
    const goal = after(
      ...watching,
      GoalEvents.trakWoke(A, "failed", 3),
      GoalEvents.turnStopped(SESSION),
    )
    expect(goal.state._tag).toBe("Watching")
    expect(owesTurn(goal)).toBe(false)
    expect(goal.owed).toBeUndefined()
    expect(unread(goal)).toHaveLength(1)
  })

  it("keeps what was waiting for the next chat, and holds none of its own", () => {
    const goal = after(
      ...watching,
      GoalEvents.trakWoke(A, "failed", 3),
      GoalEvents.messageWaiting("k1", "also the docs"),
      GoalEvents.turnStopped(SESSION),
    )
    expect(goal.messages).toHaveLength(1)
    const chatted = after(
      ...watching,
      GoalEvents.trakWoke(A, "failed", 3),
      GoalEvents.messageWaiting("k1", "also the docs"),
      GoalEvents.turnStopped(SESSION),
      GoalEvents.acted(goalChatWith(goal, "go on")),
    )
    expect(chatted.owed).toEqual({ _tag: "Said", message: "also the docs\n\ngo on" })
    expect(chatted.messages).toEqual([])
  })
})

describe("a sub-goal", () => {
  const PARENT = GoalId.make("parent")
  const SUB = GoalId.make("sub")
  const PLANNED_SUB = { title: "Accounts", line: "Sign in.", finished: "Two sign in." }
  const opened = GoalEvents.started(subgoalSpec(PLANNED_SUB, undefined), undefined, {
    parent: PARENT,
    call: "c",
  })

  it("is opened with its parent's plan entry as its spec, and replays the link", () => {
    const goal = replayGoal(SUB, [opened])
    expect(goal?.parent).toEqual({ goal: PARENT, call: "c" })
    expect(goal?.spec).toEqual({ ...PLANNED_SUB, limits: {} })
    expect(goal?.spec?.file).toBeUndefined()
  })

  it("opens its traks under the tighter of its own limits and its parent's", () => {
    const own = { parallel: 5, perHour: 1, modes: ["smart", "auto"] as const }
    const parent = {
      parallel: 2,
      perDay: 4,
      modes: ["smart"] as const,
      autoMerge: "never" as const,
    }
    expect(sharedBudget({ ...own, autoMerge: "always" }, parent)).toEqual({
      parallel: 2,
      perHour: 1,
      perDay: 4,
      modes: ["smart"],
      autoMerge: "never",
    })
    expect(sharedBudget(own, undefined)).toEqual(own)
  })

  it("wakes its parent stuck at each failure, and the line moves when it fails again", () => {
    const failed = GoalEvents.turnFailed(undefined, 0, "provider gone", undefined)
    const once = subgoalOutcome(SUB, [opened, failed])
    expect(once).toEqual({ kind: "stuck", said: "provider gone", since: 2 })
    const retried = [opened, failed, GoalEvents.acted({ _tag: "Retry" }), failed]
    expect(subgoalOutcome(SUB, retried)).toEqual({ kind: "stuck", said: "provider gone", since: 4 })
    const dropped = subgoalOutcome(SUB, [opened, GoalEvents.dropped("not needed")])
    expect(dropped).toEqual({ kind: "dropped", said: "not needed", since: 2 })
  })

  it("is counted live by its parent until a done or dropped wake settles it", () => {
    const parent = replayGoal(PARENT, [
      GoalEvents.started(SPEC),
      GoalEvents.planProposed("p", [], undefined, [PLANNED_SUB]),
      GoalEvents.turnEnded(SESSION, 0, undefined),
      GoalEvents.acted({ _tag: "Approve" }),
      GoalEvents.subgoalOpened("o", SUB, "Accounts"),
      GoalEvents.turnEnded(SESSION, 0, undefined),
      GoalEvents.subgoalWoke(SUB, "stuck", 2, "gone"),
      GoalEvents.subgoalWoke(SUB, "done", 9, "It works."),
    ])
    expect(parent?.subgoalPlan).toEqual([PLANNED_SUB])
    expect(parent?.subgoals).toEqual([{ id: SUB, title: "Accounts", status: "done", filed: 9 }])
    expect(parent === undefined ? [] : unread(parent)).toEqual([
      { subgoal: SUB, kind: "stuck", said: "gone" },
      { subgoal: SUB, kind: "done", said: "It works." },
    ])
    expect(parent?.state._tag).toBe("Composing")
  })

  it("is told its parent and the parent's limits, and the parent is told of each wake", () => {
    const parent = replayGoal(PARENT, [
      GoalEvents.started({ ...SPEC, title: "Ship it", limits: { parallel: 2 } }),
      GoalEvents.subgoalOpened("o", SUB, "Accounts"),
      GoalEvents.subgoalWoke(SUB, "done", 3, "It works."),
    ])
    const sub = replayGoal(SUB, [opened])
    if (parent === undefined || sub === undefined) throw new Error("no goal")
    const told = buildGoalPrompt(templates, sub, [], [parent, sub])
    expect(told).toContain("one part of the goal **Ship it**")
    expect(told).toContain("At most 2 of your traks running at once.")
    expect(told).not.toContain("Other goals going")
    const woken = buildGoalPrompt(templates, parent, [], [parent, sub])
    expect(woken).toContain("- Sub-goal `sub` — Accounts: done. It works.")
    expect(woken).toContain("- `sub` — Accounts: Composing")
  })
})
