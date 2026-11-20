// Pure-domain tests: no Effect, no layers, no mocks, no I/O.
// This is the payoff of keeping decide a plain total function.

import { Equal, Schema } from "effect"
import type { RunnerFailure } from "../src/agent/types/runner-failure.js"
import { SessionId } from "../src/agent/types/session.js"
import { describe, expect, it } from "vitest"
import type { StepOutput } from "../src/workflow/domain/outputs/step-output.js"
import { stuck as makeStuck } from "../src/workflow/domain/outputs/stuck.js"
import { permission } from "../src/workflow/domain/outputs/permission.js"
import {
  Artifact,
  artifact as makeArtifact,
  artifactText,
} from "../src/workflow/domain/outputs/artifact.js"
import { failed } from "../src/workflow/domain/outputs/failed.js"
import { finished } from "../src/workflow/domain/outputs/finished.js"
import { message } from "../src/workflow/domain/outputs/message.js"
import { askPlainly, Questions } from "../src/workflow/domain/outputs/questions.js"
import { Event, Events } from "../src/workflow/domain/event.js"
import { Actions, type HumanAction } from "../src/workflow/domain/human-action.js"
import { applyEvent, replayHistory } from "../src/workflow/domain/replay.js"
import { approvedInAdvance } from "../src/workflow/domain/attention.js"
import {
  AwaitReason,
  Command,
  decide,
  Decision,
  heldChat,
  party,
} from "../src/workflow/domain/decide.js"
import type { Ambiguity } from "../src/workflow/domain/outputs/ambiguity.js"
import type { Decided } from "../src/workflow/domain/outputs/decided.js"
import {
  isCompose,
  proposal as makeProposal,
  type Proposal,
  type ReconsultWhy,
  stepName,
} from "../src/workflow/domain/outputs/proposal.js"
import {
  asGate,
  atRest,
  effectFailedAt,
  emptyTrak,
  firstUnrun,
  handOffPending,
  mintedAt,
  noSlot,
  pendingWait,
  type RunMode,
  slotAt,
  waitingAt,
  type HumanGate,
  TrakId,
  type Trak,
  TrakState,
  Mark,
  UserId,
  GoalId,
} from "../src/workflow/domain/trak.js"
import { BranchName, CommitSha, WorktreePath } from "../src/vcs/index.js"
import { Triggers } from "../src/workflow/domain/trigger.js"

const id = TrakId.make("t1")
const sid = SessionId.make("00000000-0000-4000-8000-000000000000")
const kid = TrakId.make("t1-child-0")
/**
 * The composer's second session. A reconsult starts one rather than resuming, so a
 * revision arrives under an id of its own — which is what tells one run of the
 * composer from the next, and therefore what gets its own entry in the plan.
 */
const sid2 = SessionId.make("00000000-0000-4000-8000-000000000002")

const proposal = (count: number): Proposal => {
  const [first, ...rest] = Array.from({ length: count }, (_, i) => ({
    agent: `a${i}`,
    instruction: `do step ${i}`,
  }))
  if (first === undefined) throw new Error("a proposal needs at least one step")
  return makeProposal("do the thing", [first, ...rest])
}

/**
 * The degenerate document — one section — which is what an agent with a single
 * `Summary` returns. Nothing here is about sections, so every case uses it and
 * `doc` says what the engine renders it as.
 */
const artifact = (summary: string): StepOutput => makeArtifact({ Summary: summary })
/** A step that did the work and found work the plan does not have. */
const raising = (summary: string, first: string, ...rest: readonly string[]): StepOutput =>
  makeArtifact({ Summary: summary }, [
    { text: first, source: "assumed", kind: "unplanned_work" },
    ...rest.map((text) => ({ text, source: "assumed" as const, kind: "unplanned_work" as const })),
  ])
/**
 * A step that did the work and settled something the rest of it holds to. The same
 * channel as `raising` and the same list on the trak — what separates them is the
 * `kind`, and only `raising`'s reaches the composer.
 */
const constraining = (summary: string, text: string): StepOutput =>
  makeArtifact({ Summary: summary }, [{ text, source: "assumed", kind: "constraint" }])
/** A step that did the work and says an earlier document is not good enough. */
const correcting = (summary: string, at: string, text: string): StepOutput =>
  makeArtifact({ Summary: summary }, undefined, [{ at, text }])
/** A step that could not do the work. Its account is filed nowhere. */
const stuck = (tried: string): StepOutput => makeStuck(tried, "it timed out", "the lock")
const doc = (summary: string): string => `## Summary\n\n${summary}`

/** Stands in for "no artifact", so a lookup can be rendered without a branch. */
const empty = makeArtifact({})

const create: Event = Events.trakCreated("d")
/**
 * The worktree, which every history needs: nothing composes until the trak has
 * somewhere to work, so `TrakCreated` on its own leaves a trak in `Preparing`
 * and the composer's turn would be the out-of-order event it now is.
 */
const ready: Event = Events.worktreeReady({
  path: WorktreePath.make("/tmp/wt"),
  branch: BranchName.make("trak/t1"),
  base: CommitSha.make("base000"),
})
/** What `FinishWorktree` reports when a trak changed no files. */
const committed: Event = Events.workCommitted(undefined)
/**
 * The second half of every step boundary: the effects that step's agent declared, run.
 *
 * Every boundary has one — `decide` cannot see whether an agent declares any without
 * reading policy, so `Effecting` is entered at all of them and an empty `EffectsRan`
 * is the honest record that nothing was required. A history that stops at the commit
 * is one the trak is still standing inside.
 */
const effectsRan = (s: number): Event => Events.effectsRan(s, [])
/**
 * A whole boundary at a named step — which is the only kind that can run a plan out.
 * The catch-all past the last step and the one on the way out of an abandonment both
 * carry no step, and `committed` above is those.
 */
const keptStep = (s: number): readonly Event[] => [
  Events.workCommitted(undefined, s),
  effectsRan(s),
]

/**
 * Where a step's boundary leaves the trak: the commit lands, the effects run, and
 * this is what `decide` says at the end of it.
 *
 * One helper because a boundary is two events now and almost nothing here is *about*
 * that — what these tests ask is which position the trak reaches, and asking it in one
 * line keeps the subject visible. A test whose subject IS the boundary spells both out.
 */
const pastBoundary = (t: Trak, step: number): Decision => {
  const kept = decide({ ...t, state: TrakState.Committing({ step }) }, committed)
  return decide({ ...t, state: kept.next }, effectsRan(step))
}
const accept = (p: Proposal, session = sid): Event => Events.composerReturned(session, p)
/** The composer answering that the work is already done. Defaults to a reconsult's session. */
const ends = (reason: string, session = sid2): Event =>
  Events.composerReturned(session, finished(reason))
/** The same answer, handing work off to a trak on the main line. */
const endsHandingOff = (
  reason: string,
  off: readonly [string, ...string[]],
  session = sid,
): Event => Events.composerReturned(session, finished(reason, undefined, off))
const returned = (s: number, output: StepOutput): Event => Events.agentReturned(s, sid, output)
/**
 * An artifact and the verification that follows it.
 *
 * Every artifact passes through `CheckRunning` now — checks belong to the agent,
 * which `decide` cannot read — so a history that reaches a gate needs both
 * events. Spelled as one helper because the pair is what "a step finished its
 * work" means; the tests that are *about* checks still write them separately.
 */
const filed = (s: number, output: StepOutput): readonly Event[] => [
  returned(s, output),
  Events.checksPassed(s, []),
]
const acted = (s: number, action: HumanAction): Event => Events.humanActed(s, action)
/**
 * The step at `s` may start: its conditions met, which every first entry asks before
 * the turn — an empty list, since nothing in these histories declares one. A history
 * that reaches a step's first turn without it is one written before the ask existed,
 * which `decide` also takes; these spell it out so they read as today's log.
 */
const mayStart = (s: number): Event => Events.conditionsMet(s, [])
/** A conversational step's first turn: prose, and nothing filed. */
const riffed = (): Event => returned(1, message("what are we after?"))

/**
 * Every state and every event, crossed. Module-level rather than inside the
 * totality suite because the failure invariants below want the same matrix: a
 * curated list of failing histories is what let a poisoned `failedFrom` through.
 *
 * **Keyed by tag, not an array, and that is the whole point.** As arrays these were
 * silently 7 of 10 states and 9 of 11 events — the missing states were two of the
 * three gates, and the missing events were both check events. A hand-listed array of
 * union members has no way to say it is complete, so it drifts every time a variant
 * is added and the comment claiming "every" stays put. As a `Record` keyed on the
 * union's own tag, a new variant is a compile error here until someone writes down
 * what it should do.
 */
const everyState: Record<TrakState["_tag"], TrakState> = {
  Preparing: TrakState.Preparing(),
  Composing: TrakState.Composing(),
  AwaitingProposal: TrakState.AwaitingProposal(),
  AgentWorking: TrakState.AgentWorking({ step: 0 }),
  Stopping: TrakState.Stopping({ step: 0 }),
  CheckRunning: TrakState.CheckRunning({ step: 0 }),
  ConditionRunning: TrakState.ConditionRunning({ step: 0 }),
  AwaitingHuman: TrakState.AwaitingHuman({ step: 0, kind: "approval" }),
  AwaitingComposerAnswers: TrakState.AwaitingComposerAnswers(),
  Spawning: TrakState.Spawning({ step: 0 }),
  HandingOff: TrakState.HandingOff({ step: 0 }),
  AwaitingChildren: TrakState.AwaitingChildren({ step: 0 }),
  Joining: TrakState.Joining({ step: 0 }),
  Committing: TrakState.Committing({ step: 0 }),
  Effecting: TrakState.Effecting({ step: 0 }),
  Integrating: TrakState.Integrating(),
  Abandoning: TrakState.Abandoning({ reason: "did it by hand" }),
  Finished: TrakState.Finished(),
  Merging: TrakState.Merging(),
  Closing: TrakState.Closing({ merged: undefined }),
  Closed: TrakState.Closed(),
  Merged: TrakState.Merged({ sha: CommitSha.make("merge01") }),
  Abandoned: TrakState.Abandoned({ reason: "did it by hand" }),
  Failed: TrakState.Failed({ error: "x", kind: "engine", apiKind: undefined }),
}

/** A list per tag, because several events are worth more than one sample. */
const everyEvent: Record<Event["_tag"], readonly Event[]> = {
  // Both modes, because a trak that stands at no gate takes different routes out of
  // three of the states below and the matrix is what says none of them is a dead end.
  TrakCreated: [
    create,
    Events.trakCreated("d", undefined, "auto"),
    // A spawn's child, born holding a plan and a split.
    Events.trakCreated("d", {
      parent: { id: kid, step: 0, child: 0, depth: 1 },
      plan: proposal(1),
      base: undefined,
      decisions: [],
      artifacts: [],
      split: { instruction: "one piece", pieces: [{ name: "1.0-check", instruction: "one" }] },
    }),
  ],
  WorktreeReady: [ready],
  WorktreeFailed: [
    Events.worktreeFailed("no space left"),
    Events.worktreeFailed("create sandbox: the sandbox provider's limit was reached", {
      runner: {
        kind: "limited",
        said: "five starts a minute",
        file: ".orkestra/runner.sh",
        verb: "create",
        stderr: "refused (429)",
      },
    }),
    Events.worktreeFailed("put back uncommitted changes: exited 1", {
      carried: "refs/orkestra/carried/t1",
    }),
  ],
  SetupStarted: [Events.setupStarted()],
  SetupPassed: [Events.setupPassed()],
  // With and without the turn it killed, and with what the outcome carried beside it.
  SetupFailed: [
    Events.setupFailed("setup failed in /w:\nno lockfile", { output: "no lockfile" }),
    Events.setupFailed("setup failed in /w:\nno lockfile", {
      output: "no lockfile",
      carried: "refs/orkestra/carried/t1",
    }),
    Events.setupFailed(
      "setup failed in /w:\nno lockfile",
      { output: "no lockfile" },
      { sessionId: sid, step: 0 },
    ),
  ],
  MergeFailed: [Events.mergeFailed("merge: git merge exited 2: Your local changes")],
  Conflicted: [
    Events.conflicted(["flag.ts"], "main"),
    // A detached host has no branch name, which is the shape the optional exists
    // for and the one a total mapper has to keep round-tripping.
    Events.conflicted(["flag.ts", "README.md"], undefined),
  ],
  WorkCommitted: [committed],
  StepRefused: [Events.stepRefused(0, "`fix` writes, and this trak's branch has merged")],
  // With and without the sha the runtime got from the forge: a log written before
  // the field existed still decodes, and both shapes have to replay alike.
  WorktreeRemoved: [Events.worktreeRemoved(), Events.worktreeRemoved(CommitSha.make("9f31c07"))],
  // Both answers that land a compose entry, because they leave the plan in opposite
  // shapes — one with steps after the entry, one with the entry last and nothing to come.
  ComposerReturned: [accept(proposal(2)), Events.composerReturned(sid, finished("already done"))],
  AgentReturned: [
    returned(0, artifact("c")),
    returned(0, askPlainly("q")),
    returned(0, raising("c", "and a mockup")),
    returned(0, stuck("f")),
    returned(0, failed("e")),
    returned(0, message("just answering")),
  ],
  HumanActed: [
    acted(0, Actions.approve()),
    acted(0, Actions.chat("f")),
    acted(0, Actions.replan("try something else")),
    // The off-gate shape: the route killed a turn and carries its session on the press.
    Events.humanActed(0, Actions.replan("try something else"), sid),
    acted(0, Actions.skip("not worth it")),
  ],
  // Both shapes: the checks ran, and a person's skip kept them from running. The second
  // spends the switch and the first leaves it, so a log holding either has to replay.
  ChecksPassed: [Events.checksPassed(0, ["verify"]), Events.checksPassed(0, [], ["verify"])],
  CheckFailed: [Events.checkFailed(0, "verify", "2 errors")],
  // With the name the route read off the run, and without it where the press raced the
  // run starting — the schema decodes both.
  ChecksCancelled: [Events.checksCancelled(0, "verify"), Events.checksCancelled(0)],
  // Both shapes, because they are two different facts and the empty one is the
  // ordinary case: almost every step boundary declares no effects at all.
  EffectsRan: [
    Events.effectsRan(0, []),
    Events.effectsRan(0, [{ name: "open-pr", output: "https://example.invalid/pr/7" }]),
  ],
  EffectFailed: [Events.effectFailed(0, "open-pr", "gh: not authenticated")],
  // The empty one is the ordinary case, as with effects: nearly every step declares
  // no condition. The unmet one in both answers, because they route the same way in
  // and differ only on whether anything asks again.
  ConditionsMet: [
    Events.conditionsMet(0, []),
    Events.conditionsMet(0, ["pr-merged"]),
    // The engine's own wait passing, carrying the commit the branch landed as.
    Events.conditionsMet(0, ["merged"], CommitSha.make("merge01")),
  ],
  ConditionsUnmet: [
    Events.conditionsUnmet(0, "pr-merged", "open", false),
    Events.conditionsUnmet(0, "pr-merged", "closed without merging", true),
    // A `deployed` wait that found the branch merged before the deploy is live.
    Events.conditionsUnmet(0, "deployed", "rolling out", false, CommitSha.make("merge01")),
  ],
  // With and without the commit the re-asked `merged` found: a press on a script wait
  // over a branch that has not merged carries none, and one over a merged branch lands
  // the sha as a condition's answer would.
  WaitSkipped: [
    Events.waitSkipped(0, "pr-merged"),
    Events.waitSkipped(0, "merged", CommitSha.make("merge01")),
  ],
  Restarted: [Events.restarted(sid)],
  // The shape the route files, and the one it refuses to. `stopRoute` will not append a
  // stop without a run record behind it — a session it cannot name is a redirection that
  // reaches a fresh conversation — but the schema decodes one, so `decide` and `replay`
  // are still held total over a log that holds one however it got there.
  StopRequested: [
    Events.stopRequested(sid, 0),
    Events.stopRequested(undefined, undefined),
    Events.stopRequested(sid, undefined),
  ],
  Stopped: [Events.stopped(sid, 0), Events.stopped(undefined, undefined)],
  // The same two shapes, for the same reason: the route files the first and refuses
  // the second, and the schema decodes both.
  FilingAsked: [Events.filingAsked(sid, 0), Events.filingAsked(undefined, undefined)],
  // Both directions of each, because a change that moves nothing has to be shown to
  // move nothing from every state — and one that arrives at a gate re-offers it.
  ModeChanged: [Events.modeChanged("manual"), Events.modeChanged("auto")],
  MergeMethodPicked: [Events.mergeMethodPicked("rebase"), Events.mergeMethodPicked("squash")],
  OwnerChanged: [
    Events.ownerChanged(undefined, UserId.make("gh:2")),
    Events.ownerChanged(UserId.make("gh:1"), UserId.make("gh:2")),
  ],
  HoldChanged: [Events.holdChanged(true), Events.holdChanged(false)],
  SkipChecksChanged: [Events.skipChecksChanged(true), Events.skipChecksChanged(false)],
  AutoMergeChanged: [Events.autoMergeChanged(true), Events.autoMergeChanged(false)],
  // The same promise as the three above: said and heard both move nothing, from
  // every state, and a delivery naming no waiting message is absorbed.
  MessageWaiting: [Events.messageWaiting("m1", "keep the old flag working")],
  MessageDelivered: [Events.messageDelivered("m1")],
  TurnFailed: [
    Events.turnFailed(0, sid, "exit 1: connection closed mid-response"),
    Events.turnFailed(undefined, sid, "usage limit reached"),
    Events.turnFailed(1, undefined, "the sandbox could not be reached", undefined, undefined, {
      runner: {
        kind: "lost",
        said: "the sandbox would not start",
        file: ".orkestra/runner.sh",
        verb: "exec",
        stderr: "",
      },
    }),
    Events.turnFailed(1, undefined, "the sandbox could not be readied", undefined, undefined, {
      carried: "refs/orkestra/carried/t1",
    }),
  ],
  ChildrenSpawned: [Events.childrenSpawned(0, [kid])],
  HandedOff: [Events.handedOff(0, BranchName.make("main"), [kid])],
  GoalOpened: [Events.goalOpened(0, GoalId.make("goal-1"))],
  ChildLanded: [
    Events.childLanded({
      step: 0,
      child: 0,
      id: kid,
      branch: BranchName.make("trak/kid"),
      sha: undefined,
      artifacts: [],
      decisions: [],
      handUp: undefined,
    }),
  ],
  // Moves nothing from any state, like a change of mode: the matrix is what says so.
  ChildRefiled: [
    Events.childRefiled({
      step: 0,
      child: 0,
      id: kid,
      artifacts: [],
      decisions: [],
      handUp: "the cache belongs to no piece",
    }),
  ],
  ChildrenJoined: [Events.childrenJoined(0, [])],
  // Parked, mid-step and mid-compose: an archive that killed a turn carries the turn's
  // session and position — no position for the composer's — and one that found nothing
  // running carries neither.
  Abandoned: [
    Events.abandoned("tried three times, did it by hand"),
    Events.abandoned("enough", sid, 0),
    Events.abandoned("enough", sid),
  ],
  Closed: [Events.closed()],
  Merged: [Events.merged()],
  WorkMerged: [Events.workMerged(CommitSha.make("merge01"))],
  ChangesDropped: [Events.changesDropped("its parent's branch has merged")],
  // Both doors, because they leave the trak in opposite shapes: one owes the composer
  // a turn, the other has a turn standing in its plan and owes nobody anything.
  Reentered: [
    Events.reentered("CI failed on main: the auth test is flaky"),
    Events.reentered("does this cover the offline case?", "generic"),
    Events.sentBack("https://forge/pr/7", { _tag: "Conflict" }),
    Events.sentBack("https://forge/pr/7", { _tag: "Checks", failed: ["test"] }),
  ],
  AutoMergeStopped: [Events.autoMergeStopped({ _tag: "Conflict" })],
}

const allStates: readonly TrakState[] = Object.values(everyState)
const allEvents: readonly Event[] = Object.values(everyEvent).flat()

describe("decide is total", () => {
  it("returns exactly one of Advance | Await | Settle for every pair", () => {
    for (const state of allStates) {
      for (const event of allEvents) {
        const trak: Trak = { ...emptyTrak(id), state, plan: proposal(2) }
        const r = decide(trak, event)
        expect(["Advance", "Await", "Settle"]).toContain(r._tag)
        // Advance always carries at least one command — no silent stalls.
        if (r._tag === "Advance") expect(r.commands.length).toBeGreaterThan(0)
        // Await always names a party. Actions at a gate, trak ids at a spawn —
        // it was spelled "lists human actions" only while there was one kind.
        if (r._tag === "Await") expect(party(r.awaiting).length).toBeGreaterThan(0)
      }
    }
  })

  it("never throws on an out-of-order event — it fails loudly instead", () => {
    const trak: Trak = { ...emptyTrak(id), state: TrakState.Finished() }
    const r = decide(trak, returned(0, artifact("c")))
    expect(r._tag).toBe("Settle")
    expect(r.next._tag).toBe("Failed")
  })

  it("a turn cannot fail where no turn was running — that is an engine bug", () => {
    // The guard on `TurnFailed`. Without it a transport error at a gate would be
    // recorded as the provider failing, and `failedFrom` would name a state no
    // command re-enters. The provider's own words survive into the message
    // anyway: this is the one event whose job is to carry them, and "unexpected
    // event TurnFailed" on its own tells a human nothing about what broke.
    const trak: Trak = {
      ...emptyTrak(id),
      plan: proposal(2),
      state: TrakState.AwaitingHuman({ step: 0, kind: "approval" }),
    }
    const r = decide(trak, Events.turnFailed(0, sid, "connection closed mid-response"))
    expect(r).toEqual(
      Decision.Settle({
        next: TrakState.Failed({
          error:
            "unexpected event TurnFailed in state AwaitingHuman: connection closed mid-response",
          kind: "engine",
          apiKind: undefined,
        }),
      }),
    )
  })

  it("carries the provider's classification onto the state, beside whose fault it is", () => {
    // Two axes. `kind` stays `provider` for every in-band failure — `cli-provider`
    // says why — so without this the only difference between a dropped connection and
    // an exhausted usage limit is English in `error`, which is what left every one of
    // them reading "provider failed".
    const trak: Trak = { ...emptyTrak(id), state: TrakState.Composing() }
    const r = decide(
      trak,
      Events.turnFailed(undefined, sid, "API Error: Connection closed", undefined, "interrupted"),
    )
    expect(r.next).toEqual(
      TrakState.Failed({
        error: "API Error: Connection closed",
        kind: "provider",
        apiKind: "interrupted",
      }),
    )
  })

  it("settles a failure the provider classified nothing for, rather than inventing a kind", () => {
    // A non-zero exit reports no in-band error, and every log written before the field
    // existed carries none either. `unclassified` would be a claim nobody made — the
    // absence has to survive so a surface can say *nobody said* instead.
    const trak: Trak = { ...emptyTrak(id), state: TrakState.Composing() }
    const r = decide(trak, Events.turnFailed(undefined, sid, "exit 1: claude: not found"))
    expect(r.next).toEqual(
      TrakState.Failed({
        error: "exit 1: claude: not found",
        kind: "provider",
        apiKind: undefined,
      }),
    )
  })
})

/**
 * The one press a route sends off a gate: a recompose while a step's turn runs. The route
 * takes the drive over for it, so `decide` keeps the work at `AgentWorking` and stands
 * still anywhere the take-over's race can land it — never refusing.
 */
const replanOffGate = (action: HumanAction): boolean => action._tag === "Replan"

describe("what may be acted on is `state`, never the gate a trak remembers", () => {
  // `Trak.lastGate` is the last gate parked at, and it outlives that gate on purpose
  // so a conversational reply lands where the conversation started. That makes it
  // unable to answer "can a human act right now?" — `asGate(state)` answers it,
  // and the two disagree for the whole of `AgentWorking`. The HTTP `/act` route
  // read the remembered one and accepted an approval for a trak that had already
  // moved on — one request, no agent involved, and the press went nowhere it was
  // aimed.
  const from = (state: TrakState, action: HumanAction): Decision => {
    const trak: Trak = {
      ...emptyTrak(id),
      state,
      plan: proposal(2),
      // Set on every case: if the assertions below could be satisfied by reading
      // this field, the test would not be checking anything.
      lastGate: TrakState.AwaitingProposal(),
    }
    return decide(trak, acted(0, action))
  }

  const refuses = (state: TrakState, action: HumanAction): boolean => {
    const r = from(state, action)
    return (
      r._tag === "Settle" &&
      r.next._tag === "Failed" &&
      r.next.error.startsWith("unexpected event HumanActed")
    )
  }

  /** Already taken: the trak stays exactly where it is, rather than moving or failing. */
  const absorbs = (state: TrakState): boolean => {
    const r = from(state, Actions.approve())
    return r._tag === "Settle" && Equal.equals(r.next, state)
  }

  /** Everything an unattended gate does not say on a person's behalf. */
  const saysSomething: readonly HumanAction[] = [
    Actions.chat("f"),
    Actions.replan("try something else"),
    Actions.skip("not worth it"),
    Actions.answer(["list only"]),
  ]

  it("routes HumanActed in exactly the states asGate admits, and outside them refuses all but an approval and a replan", () => {
    for (const state of allStates) {
      const noGate = asGate(state) === undefined
      // Compared as a whole so a failure names the state, and the position names
      // the action, that broke the rule.
      expect({
        state: state._tag,
        approvalAbsorbed: absorbs(state),
        othersRefused: saysSomething.map((a) => refuses(state, a)),
      }).toStrictEqual({
        state: state._tag,
        approvalAbsorbed: noGate,
        othersRefused: saysSomething.map((a) => noGate && !replanOffGate(a)),
      })
    }
  })

  it("refuses a chat mid-turn, which is the case that shipped", () => {
    const working = TrakState.AgentWorking({ step: 0 })
    expect(asGate(working)).toBeUndefined()
    expect(refuses(working, Actions.chat("f"))).toBe(true)
  })
})

describe("a Restarted turn re-issues exactly the command a crash interrupted", () => {
  it("re-issues SetupWorktree from Preparing", () => {
    const trak: Trak = { ...emptyTrak(id), state: TrakState.Preparing() }
    const r = decide(trak, Events.restarted(undefined))
    expect(r).toMatchObject({
      _tag: "Advance",
      next: TrakState.Preparing(),
      commands: [{ _tag: "SetupWorktree" }],
    })
  })

  it("re-issues Compose from Composing, carrying Triggers.interrupted()", () => {
    const trak: Trak = { ...emptyTrak(id), description: "d", state: TrakState.Composing() }
    const r = decide(trak, Events.restarted(sid))
    expect(r).toMatchObject({
      _tag: "Advance",
      next: TrakState.Composing(),
      commands: [{ _tag: "Compose", description: "d", trigger: Triggers.interrupted() }],
    })
  })

  it("re-issues SpawnStep at the same step from AgentWorking", () => {
    const trak: Trak = {
      ...emptyTrak(id),
      plan: proposal(2),
      state: TrakState.AgentWorking({ step: 1 }),
    }
    const r = decide(trak, Events.restarted(sid))
    expect(r).toMatchObject({
      _tag: "Advance",
      next: TrakState.AgentWorking({ step: 1 }),
      commands: [{ _tag: "SpawnStep", step: 1, trigger: Triggers.interrupted() }],
    })
  })

  it("re-runs the step's checks from CheckRunning", () => {
    const trak: Trak = {
      ...emptyTrak(id),
      plan: proposal(1),
      state: TrakState.CheckRunning({ step: 0 }),
    }
    const r = decide(trak, Events.restarted(sid))
    expect(r).toMatchObject({
      _tag: "Advance",
      next: TrakState.CheckRunning({ step: 0 }),
      commands: [{ _tag: "RunChecks", step: 0 }],
    })
  })

  it("re-issues CommitWork at the same step from Committing", () => {
    const trak: Trak = {
      ...emptyTrak(id),
      plan: proposal(2),
      state: TrakState.Committing({ step: 0 }),
    }
    const r = decide(trak, Events.restarted(undefined))
    expect(r).toEqual(
      Decision.Advance({
        next: TrakState.Committing({ step: 0 }),
        commands: [Command.CommitWork({ step: 0 })],
      }),
    )
  })

  it("re-issues CommitWork from Integrating", () => {
    const trak: Trak = { ...emptyTrak(id), state: TrakState.Integrating() }
    const r = decide(trak, Events.restarted(undefined))
    expect(r).toMatchObject({
      _tag: "Advance",
      next: TrakState.Integrating(),
      commands: [{ _tag: "CommitWork" }],
    })
  })

  it("re-issues RemoveWorktree from Closing", () => {
    const trak: Trak = { ...emptyTrak(id), state: TrakState.Closing({ merged: undefined }) }
    const r = decide(trak, Events.restarted(undefined))
    expect(r).toMatchObject({
      _tag: "Advance",
      next: TrakState.Closing({ merged: undefined }),
      commands: [{ _tag: "RemoveWorktree" }],
    })
  })

  it("settles unchanged when the trak was already done", () => {
    expect(
      decide({ ...emptyTrak(id), state: TrakState.Finished() }, Events.restarted(undefined)),
    ).toEqual(Decision.Settle({ next: TrakState.Finished() }))

    const failedState = TrakState.Failed({ error: "boom", kind: "engine", apiKind: undefined })
    expect(decide({ ...emptyTrak(id), state: failedState }, Events.restarted(undefined))).toEqual(
      Decision.Settle({ next: failedState }),
    )
  })
})

describe("a Restarted turn at a gate is the dead end it must not fall into", () => {
  it("re-parks unchanged at every gate", () => {
    const gates: readonly TrakState[] = [
      TrakState.AwaitingProposal(),
      TrakState.AwaitingHuman({ step: 0, kind: "approval" }),
      TrakState.AwaitingHuman({ step: 0, kind: "answers" }),
      TrakState.AwaitingHuman({ step: 0, kind: "checks" }),
      TrakState.AwaitingHuman({ step: 1, kind: "stuck" }),
      TrakState.AwaitingHuman({ step: 0, kind: "conversation" }),
      TrakState.AwaitingComposerAnswers(),
    ]
    for (const state of gates) {
      const trak: Trak = { ...emptyTrak(id), plan: proposal(2), state }
      const r = decide(trak, Events.restarted(sid))
      expect(r._tag).toBe("Await")
      // Same state back — nothing in the log moved it, so nothing here may.
      expect(r.next).toEqual(state)
      if (r._tag !== "Await") continue
      // The same set the gate itself offers, which is what makes a re-park a
      // re-park rather than a quietly narrower version of where you were.
      const kind = state._tag === "AwaitingHuman" ? state.kind : undefined
      expect(party(r.awaiting)).toEqual(
        state._tag === "AwaitingComposerAnswers"
          ? ["AnswerQuestions"]
          : // The plan gate offers no `Replan`: the composer is who just spoke, so
            // asking it again for a plan it has given is `Chat` with the reason in it.
            state._tag === "AwaitingProposal"
            ? ["Approve", "Chat"]
            : kind === "answers"
              ? ["AnswerQuestions", "Skip", "Replan"]
              : kind === "stuck" || kind === "conversation"
                ? ["Chat", "Skip", "Replan"]
                : ["Approve", "Chat", "Replan"],
      )
    }
  })
})

describe("a Stopped turn parks where the person who stopped it can say what they want", () => {
  const working = (mode: RunMode = "manual"): Trak => ({
    ...emptyTrak(id),
    mode,
    plan: proposal(2),
    state: TrakState.AgentWorking({ step: 1 }),
  })

  it("sends a step to its own conversation gate, offering what that gate offers", () => {
    const r = decide(working(), Events.stopped(sid, 1))
    expect(r).toStrictEqual(
      Decision.Await({
        next: TrakState.AwaitingHuman({ step: 1, kind: "conversation" }),
        awaiting: AwaitReason.Human({ actions: ["Chat", "Skip", "Replan"] }),
      }),
    )
  })

  it("holds that gate on a trak running unattended", () => {
    // The one thing about this gate that is not shared with every other: a mode that
    // approves gates on a person's behalf must not approve past the one that person
    // opened by interrupting the turn. Nothing in `onStopped` reads `Trak.mode`, and
    // this is what says so — `auto` takes every other gate this trak has.
    for (const mode of ["smart", "auto", "decider"] as const) {
      expect(decide(working(mode), Events.stopped(sid, 1)).next).toStrictEqual(
        TrakState.AwaitingHuman({ step: 1, kind: "conversation" }),
      )
    }
  })

  it("sends a composer to the plan gate it already had", () => {
    const trak: Trak = { ...emptyTrak(id), plan: proposal(2), state: TrakState.Composing() }
    expect(decide(trak, Events.stopped(sid, undefined))).toStrictEqual(
      Decision.Await({
        next: TrakState.AwaitingProposal(),
        awaiting: AwaitReason.Human({ actions: ["Approve", "Chat"] }),
      }),
    )
  })

  it("leaves a first compose where it is, because there is no plan to wait beside", () => {
    // The route refuses this, and `decide` is the second line rather than the first:
    // what it must not do is `unexpected`, which would settle a healthy trak
    // `Failed{engine}`. Left in `Composing` with nothing driving it, the trak reads as
    // interrupted and is offered a resume.
    const trak: Trak = { ...emptyTrak(id), state: TrakState.Composing() }
    expect(decide(trak, Events.stopped(sid, undefined))).toStrictEqual(
      Decision.Settle({ next: TrakState.Composing() }),
    )
  })

  it("re-parks rather than failing when the press and the turn finishing raced", () => {
    // A stop can land on a trak that got to a gate first — the route's read of the run
    // record and the append are not one moment, so the event carries the session it found
    // and arrives somewhere that has moved on. Every gate answers with the Await it
    // already carries, and every other state stands still; `unexpected` at any of them is
    // the failure `actRoute` records having shipped, on a trak nothing was wrong with.
    for (const state of allStates) {
      const trak: Trak = { ...emptyTrak(id), plan: proposal(2), state }
      const r = decide(trak, Events.stopped(sid, 1))
      // `ConditionRunning` opens the gate too, for a stop that names a step: only a log
      // written before conditions were asked has a turn to name there — see `turnAt`.
      if (
        state._tag === "AgentWorking" ||
        state._tag === "ConditionRunning" ||
        state._tag === "Composing" ||
        state._tag === "Stopping"
      ) {
        continue
      }
      expect({ state: state._tag, next: r.next }).toStrictEqual({ state: state._tag, next: state })
      expect({ state: state._tag, tag: r._tag }).toStrictEqual({
        state: state._tag,
        tag: asGate(state) === undefined ? "Settle" : "Await",
      })
    }
  })
})

describe("a stop writes the person's intent before anything is killed", () => {
  const working = (mode: RunMode = "manual"): Trak => ({
    ...emptyTrak(id),
    mode,
    plan: proposal(2),
    state: TrakState.AgentWorking({ step: 1 }),
  })
  const stopping = (mode: RunMode, step: number | undefined): Trak => ({
    ...working(mode),
    state: TrakState.Stopping({ step }),
  })

  it("moves a step's turn to Stopping and issues the kill", () => {
    expect(decide(working(), Events.stopRequested(sid, 1))).toStrictEqual(
      Decision.Advance({
        next: TrakState.Stopping({ step: 1 }),
        commands: [Command.StopTurn({ step: 1 })],
      }),
    )
  })

  it("moves a composer revising a standing plan to Stopping with no step", () => {
    const trak: Trak = { ...emptyTrak(id), plan: proposal(2), state: TrakState.Composing() }
    expect(decide(trak, Events.stopRequested(sid, undefined))).toStrictEqual(
      Decision.Advance({
        next: TrakState.Stopping({ step: undefined }),
        commands: [Command.StopTurn({ step: undefined })],
      }),
    )
  })

  it("re-parks anywhere else, a second press in Stopping included", () => {
    for (const state of allStates) {
      if (state._tag === "AgentWorking" || state._tag === "Composing") continue
      const trak: Trak = { ...emptyTrak(id), plan: proposal(2), state }
      const r = decide(trak, Events.stopRequested(sid, 1))
      expect({ state: state._tag, next: r.next }).toStrictEqual({ state: state._tag, next: state })
    }
  })

  it("opens the step's conversation gate once the kill ends, on every mode", () => {
    for (const mode of ["manual", "smart", "auto", "decider"] as const) {
      expect(decide(stopping(mode, 1), Events.stopped(undefined, undefined))).toStrictEqual(
        Decision.Await({
          next: TrakState.AwaitingHuman({ step: 1, kind: "conversation" }),
          awaiting: AwaitReason.Human({ actions: ["Chat", "Skip", "Replan"] }),
        }),
      )
    }
  })

  it("opens the plan gate for a stopped composer", () => {
    expect(
      decide(stopping("manual", undefined), Events.stopped(undefined, undefined)),
    ).toStrictEqual(
      Decision.Await({
        next: TrakState.AwaitingProposal(),
        awaiting: AwaitReason.Human({ actions: ["Approve", "Chat"] }),
      }),
    )
  })

  it("finishes the kill on a restart, never rejoining the turn", () => {
    expect(decide(stopping("manual", 1), Events.restarted(sid, 1))).toStrictEqual(
      Decision.Advance({
        next: TrakState.Stopping({ step: 1 }),
        commands: [Command.StopTurn({ step: 1 })],
      }),
    )
  })
})

describe("a stop's own failures and races", () => {
  const stopping = (step: number): Trak => ({
    ...emptyTrak(id),
    plan: proposal(2),
    state: TrakState.Stopping({ step }),
  })

  it("parks a spent kill window at Failed, and a retry from there kills again", () => {
    const events = [
      create,
      ready,
      accept(proposal(2)),
      acted(1, Actions.approve()),
      mayStart(1),
      Events.stopRequested(sid2, 1),
      Events.turnFailed(1, undefined, "the stop could not end the turn's command"),
    ]
    const failedTrak = replayHistory(id, events)
    expect(failedTrak.state._tag).toBe("Failed")
    expect(failedTrak.failedFrom).toStrictEqual(TrakState.Stopping({ step: 1 }))
    expect(decide(failedTrak, Events.restarted(undefined)).next).toStrictEqual(
      TrakState.Stopping({ step: 1 }),
    )
  })

  it("files the session and hands waiting messages back as the intent lands", () => {
    const trak = replayHistory(id, [
      create,
      ready,
      accept(proposal(2)),
      acted(1, Actions.approve()),
      mayStart(1),
      Events.messageWaiting("m1", "also this"),
      Events.stopRequested(sid2, 1),
    ])
    expect(trak.state).toStrictEqual(TrakState.Stopping({ step: 1 }))
    expect(slotAt(trak, 1).session).toBe(sid2)
    expect(trak.messages).toStrictEqual([])
    expect(trak.returned).toStrictEqual(["also this"])
  })

  it("files a turn's own ending that raced the kill, and holds the gate it opens on auto", () => {
    const log = [
      Events.trakCreated("d", undefined, "auto"),
      ready,
      accept(proposal(2)),
      mayStart(1),
      Events.stopRequested(sid2, 1),
      returned(1, askPlainly("which one?")),
    ]
    const trak = replayHistory(id, log)
    // On `auto` a question is answered unattended; the stop holds it for the person.
    expect(trak.state).toStrictEqual(TrakState.AwaitingHuman({ step: 1, kind: "answers" }))
    expect(trak.holding).toBe(true)
  })

  it("stands still when a refused step raced the press, leaving the kill to open the gate", () => {
    expect(decide(stopping(0), Events.stepRefused(0, "merged")).next).toStrictEqual(
      TrakState.Stopping({ step: 0 }),
    )
  })
})

describe("a Stopped turn's session becomes a recorded fact", () => {
  it("files it against the step, which is what the person's next message resumes", () => {
    const trak = replayHistory(id, [
      create,
      ready,
      accept(proposal(2)),
      acted(1, Actions.approve()),
      Events.stopped(sid2, 1),
    ])
    expect(slotAt(trak, 1).session).toBe(sid2)
  })

  it("files a stopped composer's against the trak, and hands the plan back", () => {
    // A revision in flight: the plan gate, a person typing at it, and the composer's
    // second run killed. The session it was holding is what an `Approve` does not need
    // and a second `Chat` does — so it lands on the trak, and the plan the person was
    // looking at before they typed is still what the gate is offering.
    const trak = replayHistory(id, [
      create,
      ready,
      accept(proposal(2)),
      acted(0, Actions.chat("try it the other way")),
      Events.stopped(sid2, undefined),
    ])
    expect(trak.composerSession).toBe(sid2)
    expect(trak.state).toStrictEqual(TrakState.AwaitingProposal())
    expect(trak.plan?.steps.length).toBe(3)
  })

  it("agrees with applyEvent when the log contains Stopped", () => {
    const events = [
      create,
      ready,
      accept(proposal(1)),
      acted(1, Actions.approve()),
      Events.stopped(sid2, 1),
    ]
    const viaFold = replayHistory(id, events)
    const viaStep = events.reduce<Trak>((t, e) => applyEvent(t, e).trak, emptyTrak(id))
    expect(viaFold).toEqual(viaStep)
  })
})

describe("a step gate offers the same actions however it was reached", () => {
  // One function writes every offer, and this is what says so from outside: **every**
  // site that parks a step for the first time, against the re-park a reply or a
  // restart hands back. Sites rather than kinds, because a kind two sites reach is
  // exactly where the drift this closes lived — one of them fixed and the other not.
  const plan = proposal(3)
  /** Step 1 conversational, so a turn ending on prose parks instead of re-entering. */
  const talking = makeProposal("do the thing", [
    { agent: "a0", instruction: "do step 0" },
    { agent: "a1", instruction: "talk it through", conversational: true },
  ])
  const firstParks = (kind: HumanGate): readonly Decision[] => {
    const trak: Trak = { ...emptyTrak(id), plan, state: TrakState.AgentWorking({ step: 1 }) }
    switch (kind) {
      case "approval":
        return [
          decide(
            { ...trak, state: TrakState.CheckRunning({ step: 1 }) },
            Events.checksPassed(1, []),
          ),
        ]
      case "checks":
        // The second identical failure is what parks; `applyEvent` records it before
        // deciding, as the engine does.
        return [
          applyEvent(
            replayHistory(id, [
              create,
              ready,
              accept(plan),
              acted(1, Actions.approve()),
              returned(1, artifact("v1")),
              Events.checkFailed(1, "verify", "2 errors"),
              returned(1, artifact("v1")),
            ]),
            Events.checkFailed(1, "verify", "2 errors"),
          ).decision,
        ]
      case "answers":
        return [decide(trak, returned(1, askPlainly("q")))]
      case "stuck":
        return [decide(trak, returned(1, stuck("timed out")))]
      case "permission":
        return [decide(trak, returned(1, permission("rm -rf build", "a clean build")))]
      case "conversation":
        // The one gate two sites open: the press that stops a turn mid-flight, and a
        // conversational step ending its turn on prose.
        return [decide(trak, Events.stopped(sid, 1)), decide({ ...trak, plan: talking }, riffed())]
    }
  }

  it("re-entry and restart offer exactly what every first park offered", () => {
    for (const kind of [
      "approval",
      "checks",
      "answers",
      "stuck",
      "conversation",
      "permission",
    ] as const) {
      for (const first of firstParks(kind)) {
        expect(first._tag).toBe("Await")
        if (first._tag !== "Await") continue
        expect(first.next).toStrictEqual(TrakState.AwaitingHuman({ step: 1, kind }))
        const parked: Trak = { ...emptyTrak(id), plan, state: first.next }
        const again = decide(parked, Events.restarted(sid))
        expect({ kind, again }).toStrictEqual({ kind, again: first })
      }
    }
  })
})

describe("a person asking the step to file what it has", () => {
  const working = (mode: RunMode = "manual"): Trak => ({
    ...emptyTrak(id),
    mode,
    plan: proposal(2),
    state: TrakState.AgentWorking({ step: 1 }),
  })
  const filing = Decision.Advance({
    next: TrakState.AgentWorking({ step: 1 }),
    commands: [Command.SpawnStep({ step: 1, trigger: Triggers.filing() })],
  })

  it("re-enters a running step at once, on the trigger that asks for the document", () => {
    // The route has killed the turn by the time this is decided; what is left is to
    // run the step again on the session the event carries, and `Filing` is what
    // says the conversation is over.
    expect(decide(working(), Events.filingAsked(sid, 1))).toStrictEqual(filing)
  })

  it("re-enters a step parked at any gate with nothing filed, with nothing killed", () => {
    // The gates the press exists for off a running turn: a conversation to be talked
    // into filing, a question the step asked, and an account of why it is stuck. Each
    // has the session in its slot, so the event carries none, and each is re-entered
    // to settle whatever is open and file it.
    for (const kind of ["conversation", "answers", "stuck"] as const) {
      const parked: Trak = {
        ...working(),
        state: TrakState.AwaitingHuman({ step: 1, kind }),
      }
      expect(decide(parked, Events.filingAsked(undefined, 1))).toStrictEqual(filing)
    }
  })

  it("reads no run mode, because the person pressed it", () => {
    for (const mode of ["smart", "auto", "decider"] as const) {
      expect(decide(working(mode), Events.filingAsked(sid, 1))).toStrictEqual(filing)
    }
  })

  it("re-parks rather than failing anywhere else, the press and the turn having raced", () => {
    // `onStopped`'s rule: a press can land on a trak that has moved on, and
    // `unexpected` there would settle a healthy trak `Failed{engine}`. Every gate
    // answers with the Await it already carries, everything else stands still —
    // including a composer, which the route refuses and `decide` leaves alone.
    for (const state of allStates) {
      const trak: Trak = { ...emptyTrak(id), plan: proposal(2), state }
      const r = decide(trak, Events.filingAsked(sid, 1))
      // `ConditionRunning` on the stop's terms, one test up.
      if (state._tag === "AgentWorking" || state._tag === "ConditionRunning") continue
      if (
        state._tag === "AwaitingHuman" &&
        (state.kind === "conversation" || state.kind === "answers" || state.kind === "stuck")
      )
        continue
      expect({ state: state._tag, next: r.next }).toStrictEqual({ state: state._tag, next: state })
      expect({ state: state._tag, tag: r._tag }).toStrictEqual({
        state: state._tag,
        tag: asGate(state) === undefined ? "Settle" : "Await",
      })
    }
  })

  it("refuses the two gates with a document on the table, by re-offering them", () => {
    // Nothing for *file what you have* to ask at a gate where the work is already
    // filed — the same two gates `Skip` is refused at.
    for (const kind of ["approval", "checks"] as const) {
      const at: Trak = { ...working(), state: TrakState.AwaitingHuman({ step: 1, kind }) }
      expect(decide(at, Events.filingAsked(undefined, 1)).next).toStrictEqual(at.state)
    }
  })

  it("files the killed turn's session against the step, which is what the filing turn resumes", () => {
    const trak = replayHistory(id, [
      create,
      ready,
      accept(proposal(2)),
      acted(1, Actions.approve()),
      Events.filingAsked(sid2, 1),
    ])
    expect(slotAt(trak, 1).session).toBe(sid2)
    expect(trak.state).toStrictEqual(TrakState.AgentWorking({ step: 1 }))
  })

  it("agrees with applyEvent when the log contains FilingAsked", () => {
    const events = [
      create,
      ready,
      accept(proposal(1)),
      acted(1, Actions.approve()),
      Events.filingAsked(sid2, 1),
    ]
    const viaFold = replayHistory(id, events)
    const viaStep = events.reduce<Trak>((t, e) => applyEvent(t, e).trak, emptyTrak(id))
    expect(viaFold).toEqual(viaStep)
  })
})

describe("a Restarted turn's session becomes a recorded fact", () => {
  it("files the carried session into composerSession when composing", () => {
    const trak = replayHistory(id, [create, ready, Events.restarted(sid)])
    expect(trak.composerSession).toBe(sid)
  })

  it("files the carried session into sessions[step] when working on a step", () => {
    const trak = replayHistory(id, [
      create,
      ready,
      accept(proposal(2)),
      acted(1, Actions.approve()),
      Events.restarted(sid),
    ])
    expect(slotAt(trak, 1).session).toBe(sid)
  })

  it("files a restart of a failed trak against the step it failed at", () => {
    // A slot holding an id the provider never knew fails every resume the same way, and
    // a restart naming the right session is the only repair a person has.
    const trak = replayHistory(id, [
      create,
      ready,
      accept(proposal(2)),
      acted(1, Actions.approve()),
      mayStart(1),
      Events.turnFailed(1, sid, "no rollout found"),
      Events.restarted(sid2),
    ])
    expect(slotAt(trak, 1).session).toBe(sid2)
  })

  it("records nothing when no session was ever minted for the interrupted turn", () => {
    const trak = replayHistory(id, [create, ready, Events.restarted(undefined)])
    expect(trak.composerSession).toBeUndefined()
  })

  it("agrees with applyEvent when the log contains Restarted", () => {
    const events = [
      create,
      ready,
      accept(proposal(1)),
      acted(1, Actions.approve()),
      Events.restarted(sid),
    ]
    const viaFold = replayHistory(id, events)
    const viaStep = events.reduce<Trak>((t, e) => applyEvent(t, e).trak, emptyTrak(id))
    expect(viaFold).toEqual(viaStep)
  })
})

/** Every way a trak can stop, and where each one has to be sent back to. */
const failingHistories: readonly {
  readonly what: string
  readonly history: readonly Event[]
  readonly kind: string
  readonly from: TrakState
}[] = [
  {
    what: "a provider that died mid-step",
    history: [
      create,
      ready,
      accept(proposal(2)),
      acted(1, Actions.approve()),
      mayStart(1),
      Events.turnFailed(0, sid, "exit 1: connection closed mid-response"),
    ],
    kind: "provider",
    from: TrakState.AgentWorking({ step: 1 }),
  },
  {
    what: "a provider that died while composing",
    history: [create, ready, Events.turnFailed(undefined, sid, "usage limit reached")],
    kind: "provider",
    from: TrakState.Composing(),
  },
  {
    what: "an agent that gave up on a step",
    history: [
      create,
      ready,
      accept(proposal(2)),
      acted(1, Actions.approve()),
      mayStart(1),
      returned(1, failed("cannot do this")),
    ],
    kind: "agent",
    from: TrakState.AgentWorking({ step: 1 }),
  },
  {
    what: "a worktree that could not be made",
    history: [create, Events.worktreeFailed("no space left")],
    kind: "worktree",
    from: TrakState.Preparing(),
  },
  {
    what: "an event that could not apply",
    history: [create, ready, committed],
    kind: "engine",
    from: TrakState.Composing(),
  },
]

describe("a failure records where it happened, so it can be sent back there", () => {
  for (const c of failingHistories) {
    it(`says how and where it failed: ${c.what}`, () => {
      const trak = replayHistory(id, c.history)
      expect(trak.state._tag).toBe("Failed")
      if (trak.state._tag !== "Failed") return
      expect(trak.state.kind).toBe(c.kind)
      // The half `error` never had. A retry has to re-issue a *command*, and the
      // prose says nothing about which.
      expect(trak.failedFrom).toEqual(c.from)
    })
  }
})

describe("no failure is a dead end", () => {
  it("every failure a trak can reach is retryable — the sibling of the Await invariant", () => {
    // A trak that stopped must have somewhere to be sent back to, or `ork resume`
    // has nothing to offer and the work in its worktree is stranded exactly as it
    // was before any of this existed.
    for (const c of failingHistories) {
      const trak = replayHistory(id, c.history)
      const r = decide(trak, Events.restarted(undefined))
      expect(r._tag).not.toBe("Settle")
      expect(r.next).toEqual(c.from)
    }
  })

  it("holds over every state and event, not just the histories written down here", () => {
    // The curated list above is a set of examples, and examples are what let a
    // poisoned `failedFrom` through: the pair that produced it — an out-of-order
    // event arriving at a trak that had already failed — was not one of them.
    // This crosses the whole matrix instead, and asserts the two things that make
    // a failure recoverable at all.
    for (const state of allStates) {
      for (const event of allEvents) {
        const before: Trak = { ...emptyTrak(id), state, plan: proposal(2) }
        const { trak } = applyEvent(before, event)
        if (trak.state._tag !== "Failed") continue

        // The position is the state the trak was in — and never `Failed` itself,
        // which is not a position and would destroy the real one.
        expect(trak.failedFrom).toEqual(state._tag === "Failed" ? undefined : state)

        const r = decide(trak, Events.restarted(undefined))
        // Two kinds of position have no command to re-issue, and both are honest
        // about it. `undefined` is a log written before the field existed. A
        // position **at rest** is a trak that had already ended before the stray
        // event landed on it: there is nothing to re-run, so it goes back to where
        // it was rather than staying failed. Asked through the domain's own
        // predicate, so a fourth resting state cannot quietly miss this.
        if (trak.failedFrom === undefined || atRest(trak.failedFrom)) {
          expect(r).toEqual(Decision.Settle({ next: trak.failedFrom ?? trak.state }))
          continue
        }
        expect(r._tag).not.toBe("Settle")
        // One position is sent back a step rather than to itself, and it is not
        // an exception to the rule but the rule applied: awaiting children this
        // trak has no record of means the ids never reached the log, and what
        // that needs is the command that mints them. Nothing here is `Settle`.
        // Asked of the position that failed, which is the predicate
        // `onChildLanded` actually uses — sharper than "no children anywhere",
        // which was only ever right because these fixtures have one spawn.
        const spawnless =
          trak.failedFrom._tag === "AwaitingChildren" &&
          slotAt(trak, trak.failedFrom.step).children.length === 0
        expect(r.next).toEqual(
          spawnless ? TrakState.Spawning({ step: trak.failedFrom.step }) : trak.failedFrom,
        )
      }
    }
  })

  it("a second failure keeps the first one's position, so retrying never runs out", () => {
    // `failedFrom` must never take a `Failed` state. Filing whatever state the
    // trak was in turns one stray event into a retryable
    // `Failed{provider}` recorded as a `Failed{engine}` pointing at it, `restartFrom`
    // settles on a `Failed` position, and every further `Restarted` alternates
    // between the two — permanently unretryable, with the displayed error quietly
    // reverting to the older one, on a worktree that still held the work.
    for (const c of failingHistories) {
      const once = replayHistory(id, c.history)
      const twice = replayHistory(id, [...c.history, committed])

      expect(twice.state._tag).toBe("Failed")
      expect(twice.failedFrom).toEqual(once.failedFrom)
      expect(twice.failedFrom).toEqual(c.from)

      // Still goes back to where the work actually was, however many times it
      // has been landed on since.
      const r = decide(twice, Events.restarted(undefined))
      expect(r._tag).not.toBe("Settle")
      expect(r.next).toEqual(c.from)
    }
  })

  it("re-issues the command the position implies, not merely the state", () => {
    // The step is what a retry has to get right: coming back at step 0 when the
    // failure happened at step 2 would silently redo approved work.
    const history: readonly Event[] = [
      create,
      ready,
      accept(proposal(3)),
      acted(1, Actions.approve()),
      mayStart(1),
      ...filed(1, artifact("a")),
      acted(1, Actions.approve()),
      committed,
      effectsRan(1),
      mayStart(2),
      Events.turnFailed(1, sid, "exit 1: connection closed"),
    ]
    const trak = replayHistory(id, history)
    expect(trak.failedFrom).toEqual(TrakState.AgentWorking({ step: 2 }))

    const r = decide(trak, Events.restarted(undefined))
    expect(r).toEqual(
      Decision.Advance({
        next: TrakState.AgentWorking({ step: 2 }),
        commands: [Command.SpawnStep({ step: 2, trigger: Triggers.interrupted() })],
      }),
    )
  })

  it("resumes the conversation the failed turn was having, rather than paying to rebuild it", () => {
    // The whole reason `TurnFailed` carries a session: a cleanly-settled trak
    // released its `Runs` custody scope, so after this the log is the only place
    // that conversation exists.
    const trak = replayHistory(id, [
      create,
      ready,
      accept(proposal(2)),
      acted(1, Actions.approve()),
      mayStart(1),
      Events.turnFailed(1, sid, "usage limit reached"),
    ])
    expect(slotAt(trak, 1).session).toBe(sid)
  })

  it("settles a failure whose log predates failedFrom, rather than inventing a position", () => {
    const older: Trak = {
      ...emptyTrak(id),
      state: TrakState.Failed({ error: "from an older log", kind: "provider", apiKind: undefined }),
    }
    expect(decide(older, Events.restarted(undefined))).toEqual(
      Decision.Settle({ next: older.state }),
    )
  })

  it("clears failedFrom on the way back out, so a retried trak is not still failed", () => {
    const failedTrak = replayHistory(id, [create, ready, Events.turnFailed(undefined, sid, "boom")])
    const { trak } = applyEvent(failedTrak, Events.restarted(undefined))
    expect(trak.state).toEqual(TrakState.Composing())
    expect(trak.failedFrom).toBeUndefined()
  })
})

/**
 * A `smart` trak whose one step filed corrections, verified, and stopped at the
 * approval gate the rule opened for it at the time — then ran out and finished. Every
 * event is one the trak really produced; this is trak `776f7581`'s shape with the
 * middle taken out.
 *
 * Today `raisedUnplannedWork` reads the requirements half of that `Raised` entry alone,
 * so the same history goes past the same gate unattended and the recorded `HumanActed`
 * lands in `Committing`.
 */
const pressedAtAGateTheRuleNoLongerOpens: readonly Event[] = [
  Events.trakCreated("d", undefined, "smart"),
  ready,
  accept(proposal(1)),
  ...filed(1, correcting("read the diff", "0-plan", "the offline case is missing")),
  acted(1, Actions.approve()),
  ...keptStep(1),
  ends("the work is already done"),
  committed,
]

describe("a stored log replays to where the trak actually got", () => {
  it("takes the route the log records, not the one today's gate rule would have taken", () => {
    // What `decide` reads at a gate is policy, and policy moves — so a log written
    // before it moved holds a press at a gate the rule now goes past. The log is the
    // record of what happened; a press it recorded cannot become `Failed{engine}`,
    // which is absorbing and takes every event after it with it. A finished trak
    // holding an open pull request came back from a restart errored, with nothing
    // wrong with the work.
    //
    // The premise is asserted rather than assumed: this history only exercises the
    // absorb branch while the press lands where there is no gate. Move
    // `raisedUnplannedWork` back and the same events route normally to `Finished`,
    // and the assertion below would pass having tested nothing.
    const beforeThePress = pressedAtAGateTheRuleNoLongerOpens.slice(
      0,
      pressedAtAGateTheRuleNoLongerOpens.findIndex((e) => e._tag === "HumanActed"),
    )
    expect(asGate(replayHistory(id, beforeThePress).state)).toBeUndefined()
    expect(replayHistory(id, pressedAtAGateTheRuleNoLongerOpens).state).toEqual(
      TrakState.Finished(),
    )
  })
})

describe("no Await is a dead end", () => {
  it("every action listed on an Await moves the trak out of that Await", () => {
    const p = proposal(2)
    // From the verification that follows the artifact, not from the artifact —
    // an artifact advances into `CheckRunning` now, and the gate is one event on.
    const trak: Trak = { ...emptyTrak(id), plan: p, state: TrakState.CheckRunning({ step: 0 }) }
    const r = decide(trak, Events.checksPassed(0, []))
    expect(r._tag).toBe("Await")
    if (r._tag !== "Await") return

    const parked: Trak = { ...trak, state: r.next }
    for (const tag of party(r.awaiting)) {
      const action: HumanAction =
        tag === "Approve"
          ? Actions.approve()
          : tag === "Chat"
            ? Actions.chat("say something")
            : Actions.answer(["a"])
      const out = decide(parked, acted(0, action))
      expect(out.next).not.toEqual(r.next)
    }
  })
})

describe("Finished is index N", () => {
  it("a 1-step proposal reaches Finished once its artifact is approved", () => {
    const events = [
      create,
      ready,
      accept(proposal(1)),
      acted(1, Actions.approve()), // the plan
      ...filed(1, artifact("c")),
      acted(1, Actions.approve()), // the artifact
      committed, // the step's own work is kept
      effectsRan(1), // its effects run — none declared, so nothing acted
      committed, // and Integrating's catch-all is what ends it
    ]
    const trak = replayHistory(id, events)
    expect(trak.state._tag).toBe("Finished")
    expect(artifactText(trak.artifacts.get("1-a0") ?? empty)).toBe(doc("c"))
  })

  it("the LAST step's artifact gates too — approval is what ends the trak", () => {
    // The last position is a gate like any other, so on `manual` even the final
    // artifact waits. What passes one is the trak's mode or a fix a review asked for,
    // and neither is anything the proposal itself says.
    const trak: Trak = {
      ...emptyTrak(id),
      plan: proposal(2),
      state: TrakState.CheckRunning({ step: 2 }),
    }
    const parked = decide(trak, Events.checksPassed(2, []))
    expect(parked._tag).toBe("Await")
    expect(parked.next).toEqual(TrakState.AwaitingHuman({ step: 2, kind: "approval" }))
  })

  it("nothing declares Finished — it is simply past the last step", () => {
    const trak: Trak = {
      ...emptyTrak(id),
      plan: proposal(2),
      state: TrakState.AwaitingHuman({ step: 2, kind: "approval" }),
    }
    // Approving the last step keeps its own work first, exactly like any other
    // step — see `keepStep`. Only once that commit comes back does `enterStep`
    // run out of plan and reach `Integrating`; see "the tail is committed twice,
    // deliberately" below for that full sequence.
    const r = decide(trak, acted(2, Actions.approve()))
    expect(r).toEqual(
      Decision.Advance({
        next: TrakState.Committing({ step: 2 }),
        commands: [Command.CommitWork({ step: 2 })],
      }),
    )
  })

  it("ends once the work is on its branch, and not before", () => {
    const trak: Trak = { ...emptyTrak(id), plan: proposal(2), state: TrakState.Integrating() }
    expect(decide(trak, committed)).toEqual(Decision.Settle({ next: TrakState.Finished() }))
  })
})

describe("a child whose plan runs out", () => {
  // The catch-all commit's `sha` is whether anything was ever kept on the branch,
  // and it is the one fact the ending turns on.
  const kept = Events.workCommitted(CommitSha.make("kid0000"))
  const runOut = (mode: RunMode, parent = true): Trak => ({
    ...emptyTrak(id),
    mode,
    plan: proposal(2),
    state: TrakState.Integrating(),
    ...(parent ? { parent: { id: TrakId.make("parent"), step: 1, child: 0, depth: 1 } } : {}),
  })

  it("merges itself on auto where something was committed, and archives itself where not", () => {
    // The press a person would make, made in advance by the mode — and nothing
    // records it as pressed, as at every gate the mode takes.
    expect(decide(runOut("auto"), kept)).toEqual(
      Decision.Advance({ next: TrakState.Merging(), commands: [Command.MergeWork()] }),
    )
    expect(decide(runOut("auto"), committed)).toEqual(
      Decision.Advance({
        next: TrakState.Closing({ merged: undefined }),
        commands: [Command.RemoveWorktree()],
      }),
    )
  })

  it("archives itself on smart only where nothing was committed", () => {
    // A piece holding code is what the mode stands at; one that only wrote
    // documents has nothing for a person to look at before it goes.
    expect(decide(runOut("smart"), committed)).toEqual(
      Decision.Advance({
        next: TrakState.Closing({ merged: undefined }),
        commands: [Command.RemoveWorktree()],
      }),
    )
    expect(decide(runOut("smart"), kept)).toEqual(Decision.Settle({ next: TrakState.Finished() }))
  })

  it("holds on manual, and so does a trak at the top whatever its mode", () => {
    // A top-level trak's destination is the checkout a person is standing in, and
    // no mode puts a branch there unasked.
    expect(decide(runOut("manual"), committed)).toEqual(
      Decision.Settle({ next: TrakState.Finished() }),
    )
    expect(decide(runOut("auto", false), kept)).toEqual(
      Decision.Settle({ next: TrakState.Finished() }),
    )
    expect(decide(runOut("smart", false), committed)).toEqual(
      Decision.Settle({ next: TrakState.Finished() }),
    )
  })

  it("the tail is committed twice, deliberately", () => {
    // Approving the last step of an n-step plan: `Committing(n-1)` keeps the
    // step's own work, and only once that lands does `enterStep` run out of
    // plan into `Integrating`, which commits again as the catch-all — two
    // `commitWork` calls and two `WorkCommitted` events for one approval. The
    // second stages nothing new; deleting either half breaks something else
    // this suite pins (`Abandoning`'s totality, and per-step attribution).
    const n = 2
    const atLastStep: Trak = {
      ...emptyTrak(id),
      plan: proposal(n),
      state: TrakState.AwaitingHuman({ step: n - 1, kind: "approval" }),
    }
    const keeping = decide(atLastStep, acted(n - 1, Actions.approve()))
    expect(keeping).toEqual(
      Decision.Advance({
        next: TrakState.Committing({ step: n - 1 }),
        commands: [Command.CommitWork({ step: n - 1 })],
      }),
    )
    if (keeping._tag !== "Advance") return

    const committing: Trak = { ...atLastStep, state: keeping.next }
    // The boundary's own two events: the commit lands, the effects run, and only
    // then does `enterStep` run out of plan.
    const effecting = decide(committing, committed)
    expect(effecting).toEqual(
      Decision.Advance({
        next: TrakState.Effecting({ step: n - 1 }),
        commands: [Command.RunEffects({ step: n - 1 })],
      }),
    )
    if (effecting._tag !== "Advance") return

    const acting: Trak = { ...committing, state: effecting.next }
    const integrating = decide(acting, effectsRan(n - 1))
    expect(integrating).toEqual(
      Decision.Advance({
        next: TrakState.Integrating(),
        commands: [Command.CommitWork({ step: undefined })],
      }),
    )
    if (integrating._tag !== "Advance") return

    const settling: Trak = { ...acting, state: integrating.next }
    expect(decide(settling, committed)).toEqual(Decision.Settle({ next: TrakState.Finished() }))
  })
})

// The composer's fifth answer. It reaches `Finished` through the same door a plan that
// merely runs out goes through — which is the point: no new state, no new gate, and the
// plan left honest about the turn that ended it.
describe("the composer answering that the work is already done", () => {
  /** A two-step plan run to the end, so the trak is at rest holding its branch. */
  const ranOut: readonly Event[] = [
    create,
    ready,
    accept(proposal(2)),
    acted(1, Actions.approve()), // the plan
    ...filed(1, artifact("v1")),
    acted(1, Actions.approve()),
    ...keptStep(1),
    ...filed(2, artifact("v2")),
    acted(2, Actions.approve()),
    ...keptStep(2),
    committed,
  ]
  it("takes a re-entered trak back to rest without running a step or asking anybody", () => {
    // `create` is `manual`, which is the mode that stops for everything — so reaching
    // `Finished` here is the whole of "this answer opens no gate on any mode".
    const back = replayHistory(id, [
      ...ranOut,
      Events.reentered("CI failed on main: the auth test is flaky"),
      ready,
      ends("the flaky test is main's own and nothing here touched it"),
      committed,
    ])
    expect(back.state).toEqual(TrakState.Finished())
    // The entry the re-entry wrote stands as a run that happened, with nothing after it.
    expect(back.plan?.steps.map(stepName)).toEqual(["compose", "a0", "a1", "compose"])
    expect(slotAt(back, 3).session).toBe(sid2)
  })

  it("ends a merge conflict the composer reads as work the destination already carries", () => {
    const merging: Trak = { ...replayHistory(id, ranOut), state: TrakState.Merging() }
    const asked = applyEvent(merging, Events.conflicted(["flag.ts"], "main"))
    expect(asked.trak.state).toEqual(TrakState.Composing())

    const landing = applyEvent(
      asked.trak,
      ends("main already carries this; there is nothing to resolve"),
    )
    // Straight to the commit that keeps the checkout as it stands — not a gate, and not
    // a re-issued merge, which would put in a tree nobody authorized.
    expect(landing.decision).toEqual(
      Decision.Advance({
        next: TrakState.Integrating(),
        commands: [Command.CommitWork({ step: undefined })],
      }),
    )
    expect(applyEvent(landing.trak, committed).trak.state).toEqual(TrakState.Finished())
  })

  it("drops the steps that had not run, so the plan has nothing still to come", () => {
    const raised = replayHistory(id, [
      create,
      ready,
      accept(proposal(3)),
      acted(1, Actions.approve()),
      ...filed(1, raising("v1", "and a mockup first")),
      acted(1, Actions.approve()),
      ...keptStep(1),
      ends(
        "the mockup is in 1-a0's own artifact, and the two steps after it were for work that is done",
      ),
      committed,
    ])
    expect(raised.state).toEqual(TrakState.Finished())
    expect(raised.plan?.steps.map(stepName)).toEqual(["compose", "a0", "compose"])
  })

  it("is available on a first compose, where there is no plan to land on yet", () => {
    const never = replayHistory(id, [
      create,
      ready,
      ends("the request is already satisfied by what is on the base branch", sid),
      committed,
    ])
    expect(never.state).toEqual(TrakState.Finished())
    // One entry, and it ran: a composer turn happened and proposed nothing.
    expect(never.plan?.steps.map(stepName)).toEqual(["compose"])
    // Its title is the request, because no plan ever named the work.
    expect(never.plan?.title).toBe("d")
  })
})

describe("finishing is not closing", () => {
  it("keeps the checkout there — running out of plan is not a human saying they are done", () => {
    // The whole of the closing phase, in one assertion: `Integrating` issues the
    // commit and nothing else, so the only thing that can take a checkout away is
    // a person. Before this it removed in the same breath, and the moment somebody
    // most wanted to read a trak was the moment its scaffolding disappeared.
    const trak: Trak = { ...emptyTrak(id), plan: proposal(2), state: TrakState.Integrating() }
    const r = decide(trak, committed)
    expect(r._tag).toBe("Settle")

    const held: Trak = { ...trak, state: TrakState.Finished() }
    expect(decide(held, Events.closed())).toEqual(
      Decision.Advance({
        next: TrakState.Closing({ merged: undefined }),
        commands: [Command.RemoveWorktree()],
      }),
    )
    const closing: Trak = { ...held, state: TrakState.Closing({ merged: undefined }) }
    expect(decide(closing, Events.worktreeRemoved())).toEqual(
      Decision.Settle({ next: TrakState.Closed() }),
    )
  })

  it("a plain archive ends Merged when the removal carries GitHub's merge commit", () => {
    // The runtime asked the forge once at the press and put the answer on the
    // event — the one way a trak whose work went in *over there* ends `Merged`.
    const sha = CommitSha.make("9f31c07")
    const closing: Trak = { ...emptyTrak(id), state: TrakState.Closing({ merged: undefined }) }
    expect(decide(closing, Events.worktreeRemoved(sha))).toEqual(
      Decision.Settle({ next: TrakState.Merged({ sha }) }),
    )
    // The state's own sha wins where both exist: a merge made from this machine is
    // the earlier, closer fact, and the ending should name it.
    const local = CommitSha.make("merge01")
    const merged: Trak = { ...emptyTrak(id), state: TrakState.Closing({ merged: local }) }
    expect(decide(merged, Events.worktreeRemoved(sha))).toEqual(
      Decision.Settle({ next: TrakState.Merged({ sha: local }) }),
    )
    // An abandon ends `Abandoned` whatever the forge said — the sha names no ending
    // there.
    const abandoning: Trak = { ...emptyTrak(id), state: TrakState.Abandoning({ reason: "over" }) }
    expect(decide(abandoning, Events.worktreeRemoved(sha))).toEqual(
      Decision.Settle({ next: TrakState.Abandoned({ reason: "over" }) }),
    )
  })

  it("an abandoned trak commits, and then loses its checkout like a closed one", () => {
    // Two commands from one state, told apart by the event rather than by a
    // second `Abandoning` that would carry the reason twice.
    const reason = "did it by hand"
    const declared = decide(
      { ...emptyTrak(id), state: TrakState.Composing() },
      Events.abandoned(reason),
    )
    expect(declared).toEqual(
      Decision.Advance({
        next: TrakState.Abandoning({ reason }),
        commands: [Command.CommitWork({ step: undefined })],
      }),
    )
    const abandoning: Trak = { ...emptyTrak(id), state: TrakState.Abandoning({ reason }) }
    expect(decide(abandoning, committed)).toEqual(
      Decision.Advance({
        next: TrakState.Abandoning({ reason }),
        commands: [Command.RemoveWorktree()],
      }),
    )
    expect(decide(abandoning, Events.worktreeRemoved())).toEqual(
      Decision.Settle({ next: TrakState.Abandoned({ reason }) }),
    )
  })

  it("closes and merges only from Finished — the others have no checkout left", () => {
    for (const state of [
      TrakState.Closed(),
      TrakState.Merged({ sha: CommitSha.make("merge01") }),
      TrakState.Abandoned({ reason: "gave up" }),
    ]) {
      for (const e of [Events.closed(), Events.merged()]) {
        const r = decide({ ...emptyTrak(id), state }, e)
        expect(r._tag).toBe("Settle")
        expect(r.next._tag).toBe("Failed")
      }
    }
  })
})

describe("a runner verb that failed", () => {
  it("carries the runner verb that failed onto the state, for a checkout and for a turn", () => {
    const runner: RunnerFailure = {
      kind: "limited",
      said: "five starts a minute",
      file: ".orkestra/runner.sh",
      verb: "create",
      stderr: "refused (429)",
    }
    const preparing: Trak = { ...emptyTrak(id), state: TrakState.Preparing() }
    expect(decide(preparing, Events.worktreeFailed("create sandbox", { runner })).next).toEqual(
      TrakState.Failed({ error: "create sandbox", kind: "worktree", apiKind: undefined, runner }),
    )
    const working: Trak = {
      ...emptyTrak(id),
      plan: proposal(2),
      state: TrakState.AgentWorking({ step: 1 }),
    }
    const turn = Events.turnFailed(1, undefined, "exec", undefined, undefined, { runner })
    expect(decide(working, turn).next).toEqual(
      TrakState.Failed({ error: "exec", kind: "provider", apiKind: undefined, runner }),
    )
  })
})

describe("a remake that left the uncommitted changes behind", () => {
  const carried = "refs/orkestra/carried/t1"

  it("carries the ref onto the state, for a checkout, a turn and a check", () => {
    const preparing: Trak = { ...emptyTrak(id), state: TrakState.Preparing() }
    expect(decide(preparing, Events.worktreeFailed("did not apply", { carried })).next).toEqual(
      TrakState.Failed({ error: "did not apply", kind: "worktree", apiKind: undefined, carried }),
    )
    const working: Trak = {
      ...emptyTrak(id),
      plan: proposal(2),
      state: TrakState.AgentWorking({ step: 1 }),
    }
    const turn = Events.turnFailed(1, undefined, "readied", undefined, undefined, { carried })
    expect(decide(working, turn).next).toEqual(
      TrakState.Failed({ error: "readied", kind: "provider", apiKind: undefined, carried }),
    )
  })

  it("fails a trak parked at a gate or resting at Finished, and nothing whose checkout is gone", () => {
    const left = Events.worktreeFailed("did not apply", { carried })
    const stopped = TrakState.Failed({
      error: "did not apply",
      kind: "worktree",
      apiKind: undefined,
      carried,
    })
    for (const state of [
      TrakState.AwaitingProposal(),
      TrakState.AwaitingHuman({ step: 1, kind: "approval" }),
      TrakState.Finished(),
    ]) {
      expect(decide({ ...emptyTrak(id), plan: proposal(2), state }, left).next).toEqual(stopped)
    }
    expect(decide({ ...emptyTrak(id), state: TrakState.Closed() }, left).next).toMatchObject({
      _tag: "Failed",
      kind: "engine",
    })
    // Without the ref it is git declining outside a git command, as before.
    expect(
      decide({ ...emptyTrak(id), state: TrakState.Finished() }, Events.worktreeFailed("x")).next,
    ).toMatchObject({ _tag: "Failed", kind: "engine" })
  })

  it("fails a check whose sandbox lost them, rather than sending the step back", () => {
    const checking: Trak = {
      ...emptyTrak(id),
      plan: proposal(1),
      state: TrakState.CheckRunning({ step: 0 }),
    }
    const failing = Events.checkFailed(0, "verify", "could not be run", undefined, undefined, {
      carried,
    })
    expect(decide(checking, failing)).toEqual(
      Decision.Settle({
        next: TrakState.Failed({
          error: "`verify` could not be run",
          kind: "project",
          apiKind: undefined,
          carried,
        }),
      }),
    )
  })
})

describe("a setup that failed in the background", () => {
  const failing = Events.setupFailed(
    "setup failed in /w:\nno lockfile",
    { output: "no lockfile" },
    {
      sessionId: sid,
      step: 0,
    },
  )

  it("fails the trak from every state that is still going, and leaves the rest where they are", () => {
    // The ending states run on: a merge or an archive has no more work for an install to
    // spoil. A trak already stopped keeps the failure it had.
    const passing = new Set<TrakState["_tag"]>(["Failed", "Merging", "Closing", "Abandoning"])
    for (const state of allStates) {
      const trak: Trak = { ...emptyTrak(id), plan: proposal(2), state }
      const { trak: after } = applyEvent(trak, failing)
      if (passing.has(state._tag) || atRest(state)) {
        expect(after.state).toEqual(state)
      } else {
        expect(after.state).toEqual(
          TrakState.Failed({
            error: "setup failed in /w:\nno lockfile",
            kind: "worktree",
            apiKind: undefined,
            setup: "no lockfile",
          }),
        )
        expect(after.failedFrom).toEqual(state)
      }
      expect(after.setup).toBe("failed")
    }
  })

  it("marks a setup that failed in a checkout made again, as a setup's failure", () => {
    const working: Trak = {
      ...emptyTrak(id),
      plan: proposal(2),
      state: TrakState.AgentWorking({ step: 0 }),
    }
    const remade = Events.worktreeFailed("setup failed in /w:\nno network", undefined, "no network")
    expect(decide(working, remade).next).toEqual(
      TrakState.Failed({
        error: "setup failed in /w:\nno network",
        kind: "worktree",
        apiKind: undefined,
        setup: "no network",
      }),
    )
    // Git declining is not setup, and says nothing of it.
    expect(
      decide(working, Events.worktreeFailed("worktree add: exited 128")).next,
    ).not.toHaveProperty("setup")
  })

  it("keeps the first failure's position when a second report arrives", () => {
    const working: Trak = {
      ...emptyTrak(id),
      plan: proposal(2),
      state: TrakState.AgentWorking({ step: 0 }),
    }
    const once = applyEvent(working, failing).trak
    const twice = applyEvent(
      once,
      Events.setupFailed("setup failed again", { output: "again" }),
    ).trak
    expect(twice.state).toEqual(once.state)
    expect(twice.failedFrom).toEqual(TrakState.AgentWorking({ step: 0 }))
  })

  it("files the killed turn's session, so the retry resumes it", () => {
    const working: Trak = {
      ...emptyTrak(id),
      plan: proposal(2),
      state: TrakState.AgentWorking({ step: 0 }),
    }
    expect(slotAt(applyEvent(working, failing).trak, 0).session).toBe(sid)
    const composing: Trak = { ...emptyTrak(id), state: TrakState.Composing() }
    const composer = Events.setupFailed("setup failed", { output: "" }, { sessionId: sid })
    expect(applyEvent(composing, composer).trak.composerSession).toBe(sid)
  })

  it("moves nothing as it starts or passes, and says where setup stands", () => {
    const parked: Trak = {
      ...emptyTrak(id),
      plan: proposal(2),
      state: TrakState.AwaitingHuman({ step: 0, kind: "approval" }),
    }
    const started = applyEvent(parked, Events.setupStarted())
    expect(started.trak.state).toEqual(parked.state)
    expect(started.trak.setup).toBe("running")
    const passed = applyEvent(started.trak, Events.setupPassed())
    expect(passed.trak.state).toEqual(parked.state)
    expect(passed.trak.setup).toBe("passed")
    // A log written before setup ran in the background says nothing about it.
    expect(replayHistory(id, [Events.trakCreated("d"), ready]).setup).toBeUndefined()
  })
})

describe("merging is closing with a destination", () => {
  it("runs the git first, then joins the path a plain close takes", () => {
    // The merge runs first and the clearing up follows the path a plain close
    // takes, which is what `Closing` carrying the commit is for: one operation,
    // two endings, and the one fact that tells them apart.
    const sha = CommitSha.make("merge01")
    const held: Trak = { ...emptyTrak(id), state: TrakState.Finished() }
    expect(decide(held, Events.merged())).toEqual(
      Decision.Advance({ next: TrakState.Merging(), commands: [Command.MergeWork()] }),
    )
    const merging: Trak = { ...held, state: TrakState.Merging() }
    expect(decide(merging, Events.workMerged(sha))).toEqual(
      Decision.Advance({
        next: TrakState.Closing({ merged: sha }),
        commands: [Command.RemoveWorktree()],
      }),
    )
    const clearing: Trak = { ...held, state: TrakState.Closing({ merged: sha }) }
    expect(decide(clearing, Events.worktreeRemoved())).toEqual(
      Decision.Settle({ next: TrakState.Merged({ sha }) }),
    )
  })

  it("re-enters from every resting state, and refuses to abandon any of them", () => {
    for (const state of [
      TrakState.Finished(),
      TrakState.Closed(),
      TrakState.Merged({ sha: CommitSha.make("merge01") }),
      TrakState.Abandoned({ reason: "gave up" }),
    ]) {
      const trak: Trak = { ...emptyTrak(id), state }
      expect(decide(trak, Events.reentered("CI failed"))).toEqual(
        Decision.Advance({ next: TrakState.Preparing(), commands: [Command.SetupWorktree()] }),
      )
      // `close` is the door for a finished trak somebody wants to be done with,
      // and the other two are already through it.
      expect(decide(trak, Events.abandoned("no"))._tag).toBe("Settle")
    }
  })

  it("fails rather than finishing when the work could not be kept", () => {
    const trak: Trak = { ...emptyTrak(id), plan: proposal(2), state: TrakState.Integrating() }
    const r = decide(trak, Events.worktreeFailed("commit: nothing to commit"))
    expect(r.next).toEqual(
      TrakState.Failed({
        error: "commit: nothing to commit",
        kind: "worktree",
        apiKind: undefined,
      }),
    )
  })

  it("fails as worktree, not engine, when a step's own commit fails", () => {
    // The one omission that would produce a plausible-looking wrong answer rather
    // than a compile error: `Committing` has to be in `GIT_IN_FLIGHT` or this
    // settles `Failed{engine}` — "an invariant broke" — for a git failure, which
    // is a false accusation against the engine for something git did.
    const trak: Trak = {
      ...emptyTrak(id),
      plan: proposal(2),
      state: TrakState.Committing({ step: 0 }),
    }
    const r = decide(trak, Events.worktreeFailed("commit: checkout wandered off its branch"))
    expect(r).toEqual(
      Decision.Settle({
        next: TrakState.Failed({
          error: "commit: checkout wandered off its branch",
          kind: "worktree",
          apiKind: undefined,
        }),
      }),
    )
  })

  it("fails as worktree, not engine, when git cannot say whether a child's name is free", () => {
    // The same omission one command further on. Naming a spawn's children asks git
    // whether it already holds the branch — a name drawn onto a closed trak's
    // branch is a new trak committing over its work — so `SpawnChildren` can raise
    // a `GitFailed` and absorbs it here. Without `Spawning` in `GIT_IN_FLIGHT` this
    // settles `Failed{engine}` reading "unexpected event WorktreeFailed in state
    // Spawning", with what git actually said thrown away by `unexpected`.
    const trak: Trak = {
      ...emptyTrak(id),
      plan: proposal(2),
      state: TrakState.Spawning({ step: 0 }),
    }
    const r = decide(trak, Events.worktreeFailed("read branch: fatal: not a git repository"))
    expect(r).toEqual(
      Decision.Settle({
        next: TrakState.Failed({
          error: "read branch: fatal: not a git repository",
          kind: "worktree",
          apiKind: undefined,
        }),
      }),
    )
  })

  it("a review that approves parks like any other artifact — it does not end the trak", () => {
    // There is no `approve` envelope: a reviewer content with the work returns its
    // findings as an artifact, and the last step's artifact still gates.
    const trak: Trak = {
      ...emptyTrak(id),
      plan: proposal(2),
      state: TrakState.CheckRunning({ step: 1 }),
    }
    const r = decide(trak, Events.checksPassed(1, []))
    expect(r._tag).toBe("Await")
    expect(r.next).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "approval" }))
  })
})

describe("a checkout made again for work in it", () => {
  it("fails as worktree, not engine, when a missing checkout could not be made again for work in it", () => {
    // Every command that runs in the checkout first makes it again where it went
    // missing, so each state one of them runs in can hear git declining.
    for (const state of [
      TrakState.Composing(),
      TrakState.AgentWorking({ step: 0 }),
      TrakState.CheckRunning({ step: 0 }),
      TrakState.ConditionRunning({ step: 0 }),
      TrakState.Effecting({ step: 0 }),
    ]) {
      const trak: Trak = { ...emptyTrak(id), plan: proposal(2), state }
      expect(decide(trak, Events.worktreeFailed("remake checkout: no branch"))).toEqual(
        Decision.Settle({
          next: TrakState.Failed({
            error: "remake checkout: no branch",
            kind: "worktree",
            apiKind: undefined,
          }),
        }),
      )
    }
  })
})

describe("an archive that did not finish", () => {
  it("fails as archive, not worktree, when the checkout cannot be taken away", () => {
    // `runTeardown` writes `WorktreeFailed` from `Closing`, after a merge or a close, and
    // `CommitWork` or the removal can write it from `Abandoning`. The work has run in all
    // three, so a checkout that was never prepared is the wrong account of any of them.
    const reason = "teardown failed in /repo/.orkestra/.worktrees/x:\ndatabase is in use"
    for (const state of [
      TrakState.Closing({ merged: undefined }),
      TrakState.Closing({ merged: CommitSha.make("abc1234") }),
      TrakState.Abandoning({ reason: "over" }),
    ]) {
      expect(decide({ ...emptyTrak(id), state }, Events.worktreeFailed(reason))).toEqual(
        Decision.Settle({
          next: TrakState.Failed({ error: reason, kind: "archive", apiKind: undefined }),
        }),
      )
    }
    // And at the other end of the trak it is still a checkout that was never prepared.
    const preparing: Trak = { ...emptyTrak(id), state: TrakState.Preparing() }
    expect(decide(preparing, Events.worktreeFailed("setup.sh exited 1")).next).toMatchObject({
      _tag: "Failed",
      kind: "worktree",
    })
  })

  it("re-issues RemoveWorktree when an archive that failed is restarted", () => {
    const closing = TrakState.Closing({ merged: CommitSha.make("abc1234") })
    const stopped: Trak = {
      ...emptyTrak(id),
      state: TrakState.Failed({ error: "teardown failed", kind: "archive", apiKind: undefined }),
      failedFrom: closing,
    }
    expect(decide(stopped, Events.restarted(undefined))).toMatchObject({
      _tag: "Advance",
      next: closing,
      commands: [{ _tag: "RemoveWorktree" }],
    })
  })
})

describe("a merge git refused", () => {
  it("fails as merge, with git's sentence kept, when the merge is refused", () => {
    // Its own kind: the checkout is fine, and what a person has to fix is in the
    // tree the branch was merging into. Git's sentence is the only thing that names
    // the files in the way, so it is carried rather than replaced.
    const trak: Trak = { ...emptyTrak(id), plan: proposal(2), state: TrakState.Merging() }
    const reason = "merge: git merge exited 2: Your local changes would be overwritten"
    expect(decide(trak, Events.mergeFailed(reason))).toEqual(
      Decision.Settle({
        next: TrakState.Failed({ error: reason, kind: "merge", apiKind: undefined }),
      }),
    )
    // And an old log's `WorktreeFailed` at the same position still replays as it did.
    expect(decide(trak, Events.worktreeFailed(reason)).next).toMatchObject({
      _tag: "Failed",
      kind: "worktree",
    })
  })

  it("fails as engine when a merge failure arrives anywhere but Merging", () => {
    const trak: Trak = { ...emptyTrak(id), plan: proposal(2), state: TrakState.Finished() }
    expect(decide(trak, Events.mergeFailed("merge: refused")).next).toMatchObject({
      _tag: "Failed",
      kind: "engine",
    })
  })
})

describe("a human talking to an agent", () => {
  const atGate = (step: number): Trak => ({
    ...emptyTrak(id),
    plan: proposal(2),
    state: TrakState.AwaitingHuman({ step, kind: "approval" }),
  })

  it("talking at a review's gate resumes the REVIEWER, which is what just spoke", () => {
    // Not the reviewed step. The reviewer answers, and the escalation it returns
    // next is what reaches the composer — the engine does not interpret the
    // disagreement.
    const r = decide(atGate(1), acted(1, Actions.chat("I want tests")))
    expect(r).toMatchObject({
      _tag: "Advance",
      next: TrakState.AgentWorking({ step: 1 }),
      commands: [{ _tag: "SpawnStep", step: 1, trigger: Triggers.message("I want tests") }],
    })
  })

  it("approving a review's artifact advances like any other approval", () => {
    const r = decide(atGate(0), acted(0, Actions.approve()))
    expect(r).toMatchObject({ _tag: "Advance", next: TrakState.Committing({ step: 0 }) })
  })

  it("talking at an artifact gate resumes that step — one rule, no gate branch", () => {
    const parked: Trak = {
      ...emptyTrak(id),
      plan: proposal(2),
      state: TrakState.AwaitingHuman({ step: 1, kind: "approval" }),
    }
    const r = decide(parked, acted(1, Actions.chat("narrower")))
    expect(r).toMatchObject({ _tag: "Advance", next: TrakState.AgentWorking({ step: 1 }) })
  })
})

// ============================================================================
// Escalation, and a composer that can be re-consulted
// ============================================================================

/** Mid-turn at `step`, with a plan long enough to have somewhere to go next. */
const working = (step: number, steps = 3): Trak => ({
  ...emptyTrak(id),
  plan: proposal(steps),
  state: TrakState.AgentWorking({ step }),
})

describe("a step that could not do the work", () => {
  it("parks straight at the gate — there is no artifact to verify", () => {
    const r = decide(working(2), returned(2, stuck("both attempts timed out")))
    expect(r._tag).toBe("Await")
    expect(r.next).toEqual(TrakState.AwaitingHuman({ step: 2, kind: "stuck" }))
  })

  it("goes nowhere on its own: nothing is planned from it and nothing carries on", () => {
    // The whole of what this envelope means. What is on the table is an account
    // of why there is no work, and only a person moves the trak off it.
    const r = decide(working(2), returned(2, stuck("nope")))
    expect(r).toMatchObject({
      _tag: "Await",
      awaiting: { _tag: "Human", actions: ["Chat", "Skip", "Replan"] },
    })
  })

  it("refuses an approval there, because there is nothing filed to take", () => {
    // `conversation`'s rule, and for its reason: approving would advance the plan
    // past a step that produced nothing. Carrying on regardless is `Skip`, which
    // says so in the record.
    const atStuck: Trak = {
      ...working(2),
      state: TrakState.AwaitingHuman({ step: 2, kind: "stuck" }),
    }
    const r = decide(atStuck, acted(2, Actions.approve()))
    expect(r._tag).toBe("Settle")
    expect(r.next).toMatchObject({ _tag: "Failed", kind: "engine" })
  })

  it("skips forward instead, keeping what ran and recording that nobody ran this", () => {
    const atStuck: Trak = {
      ...working(2),
      state: TrakState.AwaitingHuman({ step: 2, kind: "stuck" }),
    }
    expect(decide(atStuck, acted(2, Actions.skip("not worth it")))).toEqual(
      Decision.Advance({
        next: TrakState.Committing({ step: 2 }),
        commands: [Command.CommitWork({ step: 2 })],
      }),
    )
  })

  it("files the account like any other document, and keeps the decisions it carried", () => {
    // What a step produced is the record, and the account of why it could not do the
    // work is the most useful thing a failed turn leaves behind. Keeping a later agent
    // from reading it under the step's name is a question about *readers*, answered by
    // `visibleArtifacts` — at write time it would be a judgment nobody could undo.
    //
    // The decisions are the other half: a ruled-out approach is often the best thing a
    // failed turn produces, and it is a fact about the conversation rather than the file.
    const ruled = { text: "ruled out the queue-based approach", source: "assumed" } as const
    const trak = replayHistory(id, [
      create,
      ready,
      accept(proposal(3)),
      acted(1, Actions.approve()),
      returned(2, makeStuck("twice", "it timed out", "the lock", [ruled])),
    ])
    expect(trak.artifacts.get("2-a1")?.sections).toEqual({
      "What I tried": "twice",
      "What happened": "it timed out",
      "What I think is wrong": "the lock",
    })
    expect(trak.decisions).toEqual([{ ...ruled, at: "2-a1" }])
  })

  it("leaves the composer alone: nothing on the trak is waiting for a plan", () => {
    const trak = replayHistory(id, [
      create,
      ready,
      accept(proposal(2)),
      acted(1, Actions.approve()),
      returned(1, stuck("timed out")),
    ])
    expect(trak.reconsult).toBeUndefined()
  })

  it("stays on the table across an argument, so a person can push back and then replan", () => {
    const argued = replayHistory(id, [
      create,
      ready,
      accept(proposal(2)),
      acted(1, Actions.approve()),
      returned(1, stuck("timed out")),
      acted(1, Actions.chat("are you sure?")),
      returned(1, message("yes — the fixture is fine")),
    ])
    expect(argued.state).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "stuck" }))
    // Kept first, then the composer at the boundary — the route every replan takes.
    const { trak: pressed, decision } = applyEvent(
      argued,
      acted(1, Actions.replan("try a smaller piece")),
    )
    expect(decision).toMatchObject({ _tag: "Advance", next: TrakState.Committing({ step: 1 }) })
    expect(pastBoundary(pressed, 1)).toMatchObject({
      _tag: "Advance",
      next: TrakState.Composing(),
    })
  })
})

describe("a step asking to run a command the CLI refused", () => {
  /** A real classifier refusal's command, so byte-identity is tested on one that matters. */
  const command = "DANGEROUSLY_DISABLE_SAFETY_GUARD=1 echo 'probe ran' | tee \\`out\\`.txt"
  const asked = permission(command, "the probe has to run with the flag")
  /** Step 1 of a two-step plan, past the plan gate, its turn having asked. */
  const askedOn = (mode: RunMode, ...before: readonly Event[]): Trak =>
    replayHistory(id, [
      Events.trakCreated("d", undefined, mode),
      ready,
      ...before,
      accept(proposal(2)),
      acted(0, Actions.approve()),
      mayStart(1),
      returned(1, asked),
    ])
  const atGate = TrakState.AwaitingHuman({ step: 1, kind: "permission" })

  it("stops for a person on every run mode, and under a hold", () => {
    for (const mode of ["manual", "smart", "auto", "decider"] as const) {
      expect({ mode, state: askedOn(mode).state }).toEqual({ mode, state: atGate })
    }
    expect(askedOn("auto", Events.holdChanged(true)).state).toEqual(atGate)
  })

  it("offers a yes or a no, a skip and a replan — no approval, and no chat", () => {
    const r = decide(working(1), returned(1, asked))
    expect(r).toMatchObject({
      _tag: "Await",
      next: atGate,
      awaiting: { _tag: "Human", actions: ["Permit", "Skip", "Replan"] },
    })
  })

  it("resumes the step on a yes that quotes the command byte for byte", () => {
    expect(decide(askedOn("manual"), acted(1, Actions.permit(true)))).toEqual(
      Decision.Advance({
        next: TrakState.AgentWorking({ step: 1 }),
        commands: [Command.SpawnStep({ step: 1, trigger: Triggers.permitted(command) })],
      }),
    )
  })

  it("resumes the step on a no, naming the command it may not run", () => {
    expect(decide(askedOn("auto"), acted(1, Actions.permit(false)))).toEqual(
      Decision.Advance({
        next: TrakState.AgentWorking({ step: 1 }),
        commands: [Command.SpawnStep({ step: 1, trigger: Triggers.refused(command) })],
      }),
    )
  })

  it("quotes the newest request, not one an earlier turn made", () => {
    const again = applyEvent(
      applyEvent(askedOn("manual"), acted(1, Actions.permit(false))).trak,
      returned(1, permission("make deploy", "the step deploys")),
    ).trak
    expect(decide(again, acted(1, Actions.permit(true)))).toMatchObject({
      commands: [{ trigger: Triggers.permitted("make deploy") }],
    })
  })

  it("refuses an approval there, and a yes anywhere else", () => {
    expect(decide(askedOn("manual"), acted(1, Actions.approve())).next).toMatchObject({
      _tag: "Failed",
      kind: "engine",
    })
    const atApproval: Trak = {
      ...working(1),
      state: TrakState.AwaitingHuman({ step: 1, kind: "approval" }),
    }
    expect(decide(atApproval, acted(1, Actions.permit(true))).next).toMatchObject({
      _tag: "Failed",
      kind: "engine",
    })
  })

  it("keeps a waiting message waiting rather than sending it in place of the answer", () => {
    const waiting = applyEvent(askedOn("manual"), Events.messageWaiting("m1", "hurry")).trak
    expect(heldChat(waiting)).toBeUndefined()
  })
})

describe("a person asking for a different rest of the plan", () => {
  const atGate = (step: number, kind: HumanGate): Trak => ({
    ...working(step),
    state: TrakState.AwaitingHuman({ step, kind }),
  })

  it("is offered at every step gate, because wanting the plan changed is not one gate's", () => {
    for (const kind of ["approval", "checks", "stuck", "conversation", "answers"] as const) {
      const r = decide(atGate(1, kind), Events.restarted(sid))
      expect(r._tag).toBe("Await")
      if (r._tag !== "Await") continue
      expect(party(r.awaiting)).toContain("Replan")
    }
  })

  it("is refused at the plan gate, where Chat already talks to the composer", () => {
    const atPlan: Trak = {
      ...working(0),
      state: TrakState.AwaitingProposal(),
    }
    const r = decide(atPlan, acted(1, Actions.replan("something else")))
    expect(r._tag).toBe("Settle")
    expect(r.next).toMatchObject({ _tag: "Failed", kind: "engine" })
  })
})

describe("what a replan keeps", () => {
  const atGate = (step: number, kind: HumanGate): Trak => ({
    ...working(step),
    state: TrakState.AwaitingHuman({ step, kind }),
  })

  it("keeps the work first where the step has filed, and the composer runs after it", () => {
    // A forward move from a document keeps the document, as `Approve` and `Skip`
    // do: the commit is what an approval takes, and the boundary after it is where
    // the composer runs — the same boundary a step that raised something reaches.
    for (const kind of ["approval", "checks"] as const) {
      const at = replayHistory(id, [
        create,
        ready,
        accept(proposal(3)),
        acted(1, Actions.approve()),
        ...filed(1, artifact("v1")),
      ])
      const gate: Trak = { ...at, state: TrakState.AwaitingHuman({ step: 1, kind }) }
      const { trak: pressed, decision } = applyEvent(
        gate,
        acted(1, Actions.replan("split this in two")),
      )
      expect(decision).toStrictEqual(
        Decision.Advance({
          next: TrakState.Committing({ step: 1 }),
          commands: [Command.CommitWork({ step: 1 })],
        }),
      )
      expect(pastBoundary(pressed, 1)).toStrictEqual(
        Decision.Advance({
          next: TrakState.Composing(),
          commands: [Command.Compose({ description: "d", trigger: Triggers.reconsulted() })],
        }),
      )
    }
  })

  it("keeps the work first where nothing is filed too, the way a skip does", () => {
    // The gates `skippable` names have no document to keep, and still have a
    // checkout: a conversational step edits files before it files anything, and a
    // replan that skipped the commit handed a spawn's children a branch without
    // those edits — every merge back then collided with the parent's own copy.
    for (const kind of ["conversation", "answers", "stuck"] as const) {
      const r = decide(atGate(1, kind), acted(1, Actions.replan("split this in two")))
      expect(r).toStrictEqual(
        Decision.Advance({
          next: TrakState.Committing({ step: 1 }),
          commands: [Command.CommitWork({ step: 1 })],
        }),
      )
      expect(r).toStrictEqual(decide(atGate(1, kind), acted(1, Actions.skip("not this"))))
    }
  })
})

describe("a recompose pressed while a step's turn runs", () => {
  it("keeps the work and hands the boundary after it to the composer", () => {
    // The route has taken the drive over and killed the turn, so the state is still
    // AgentWorking. What is left is the same move a replan at a gate makes: `keepStep`
    // commits whatever the turn edited, and the composer runs at the boundary after it
    // off the `Replanned` fact — the mid-turn press is one `HumanActed{Replan}`.
    const { trak: pressed, decision } = applyEvent(
      working(1),
      acted(1, Actions.replan("go simpler")),
    )
    expect(decision).toStrictEqual(
      Decision.Advance({
        next: TrakState.Committing({ step: 1 }),
        commands: [Command.CommitWork({ step: 1 })],
      }),
    )
    expect(pressed.reconsult).toMatchObject({
      why: { _tag: "Replanned", step: 1, reason: "go simpler" },
    })
    const past = pastBoundary(pressed, 1)
    expect(past.next).toStrictEqual(TrakState.Composing())
    expect(past._tag === "Advance" && past.commands[0]._tag).toBe("Compose")
  })

  it("records the killed turn's session, so the position reads as run and the ask lands after it", () => {
    // The route read the session before the kill and carries it on the press. Filed
    // into the slot first, the interrupted entry counts as run, `firstUnrun` moves past
    // it, and the ask is appended — the entry stays. With no session the entry read as
    // unrun and the ask was written over it.
    // Step 0 ran — a turn at 1 means the entry before it did — so the join is past it.
    const midway: Trak = { ...working(1), slots: new Map([[0, { ...noSlot, session: sid }]]) }
    const { trak: pressed } = applyEvent(
      midway,
      Events.humanActed(1, Actions.replan("go simpler"), sid2),
    )
    expect(slotAt(pressed, 1).session).toBe(sid2)
    expect(firstUnrun(pressed)).toBe(2)
    expect(pressed.plan?.steps.map((s) => (isCompose(s) ? "compose" : stepName(s)))).toEqual([
      "a0",
      "a1",
      "compose",
      "a2",
    ])
  })

  it("keeps the entry a person opened a chat on, and the model they picked with it", () => {
    // New Chat is a plan of one entry carrying the pick; the composer may never write a
    // model, so an ask landing on that entry loses the pick with nothing to restore it.
    const chat: Trak = {
      ...emptyTrak(id),
      plan: makeProposal("Add a --json flag", [
        { agent: "generic", instruction: "Add a --json flag", model: "opus" },
      ]),
      state: TrakState.AgentWorking({ step: 0 }),
    }
    const { trak: pressed } = applyEvent(
      chat,
      Events.humanActed(0, Actions.replan("go simpler"), sid2),
    )
    expect(pressed.plan?.steps[0]).toStrictEqual({
      agent: "generic",
      instruction: "Add a --json flag",
      model: "opus",
    })
    expect(pressed.plan?.steps[1]).toMatchObject({ type: "compose", why: { _tag: "Replanned" } })
    expect(pressed.plan?.steps).toHaveLength(2)
  })

  it("is the one press `decide` routes at AgentWorking — a chat there is an engine fault", () => {
    // The route only ever sends a `Replan` off a gate. Anything else reaching
    // `AgentWorking` is `unexpected` — the mid-turn branch is `Replan` and nothing
    // else, so a stray chat cannot advance a running step.
    const r = decide(working(1), acted(1, Actions.chat("hello")))
    expect(r._tag).toBe("Settle")
    expect(r.next).toMatchObject({ _tag: "Failed", kind: "engine" })
  })

  it("stands still, keeping the reason, when it lands after the turn has already ended", () => {
    // The take-over forks the event after interrupting, and the fiber it interrupted
    // may have finished the turn first — so the press can land at `CheckRunning`,
    // `Committing`, `Effecting`, or wherever the log took the step next. Every state a
    // turn can end into answers with the state it is in, the way a stop and a filing
    // that raced do; `unexpected` at any of them would settle a healthy trak
    // `Failed{engine}`. The gates route the press as a replan at a gate; `AgentWorking`
    // is the mid-turn case above.
    for (const state of allStates) {
      if (state._tag === "AgentWorking" || asGate(state) !== undefined) continue
      const trak: Trak = { ...emptyTrak(id), plan: proposal(2), state }
      const { trak: pressed, decision } = applyEvent(trak, acted(1, Actions.replan("go simpler")))
      expect({ state: state._tag, decision }).toStrictEqual({
        state: state._tag,
        decision: Decision.Settle({ next: state }),
      })
      // The words are not dropped: the fact is on the trak, waiting for the resume that
      // re-issues this position to carry it to the step's own boundary.
      expect({ state: state._tag, why: pressed.reconsult?.why }).toStrictEqual({
        state: state._tag,
        why: { _tag: "Replanned", step: 1, reason: "go simpler" },
      })
    }
  })

  it("reaches the composer at the step's boundary after such a race", () => {
    // Landed at `CheckRunning`: the take-over killed the run, so a resume re-issues it —
    // the checks then pass, the person approves the document, and the commit boundary
    // reads the `Replanned` fact the raced press left behind. `ChecksPassed` stands for
    // the re-issued run here; what this pins is the boundary, not who got it there.
    const raced = replayHistory(id, [
      create,
      ready,
      accept(proposal(3)),
      acted(1, Actions.approve()),
      ...filed(1, artifact("v1")),
    ])
    const atChecks: Trak = { ...raced, state: TrakState.CheckRunning({ step: 1 }) }
    const { trak: pressed } = applyEvent(atChecks, acted(1, Actions.replan("go simpler")))
    const { trak: passed } = applyEvent(pressed, Events.checksPassed(1, []))
    expect(passed.state).toStrictEqual(TrakState.AwaitingHuman({ step: 1, kind: "approval" }))
    const { trak: approved, decision } = applyEvent(passed, acted(1, Actions.approve()))
    expect(decision.next).toStrictEqual(TrakState.Committing({ step: 1 }))
    const past = pastBoundary(approved, 1)
    expect(past.next).toStrictEqual(TrakState.Composing())
    expect(past._tag === "Advance" && past.commands[0]._tag).toBe("Compose")
  })
})

/**
 * Every ask that can be standing when the raced press lands, one per kind. Keyed by
 * tag so a sixth kind is a compile error here rather than a case the fold never met.
 */
const STANDING: Record<ReconsultWhy["_tag"], ReconsultWhy> = {
  Raised: {
    _tag: "Raised",
    step: 1,
    requirements: ["flag it"],
    corrections: [{ at: "0-plan", text: "no offline case" }],
  },
  Replanned: { _tag: "Replanned", step: 1, reason: "at the gate, earlier" },
  Reentered: { _tag: "Reentered", what: "CI is red" },
  Refused: { _tag: "Refused", step: 1, reason: "the branch merged" },
  Conflicted: { _tag: "Conflicted", paths: ["flag.ts"], into: "main" },
}

describe("a recompose that lands on an ask already standing", () => {
  const replan = acted(1, Actions.replan("go simpler"))

  it("carries the standing ask inside the person's, at every off-gate state and for every kind", () => {
    // The step's corrections live in `reconsult.why` and nowhere else, so a press that
    // wrote over a standing `Raised` destroyed them — silently, once the landing stopped
    // being loud. Off a gate the person had not read what the step sent back, so neither
    // replaces the other: one ask stands, the person's, with the displaced one inside.
    for (const state of allStates) {
      if (state._tag === "AgentWorking" || asGate(state) !== undefined) continue
      for (const standing of Object.values(STANDING)) {
        const trak: Trak = {
          ...emptyTrak(id),
          plan: proposal(2),
          state,
          reconsult: { why: standing },
        }
        const { trak: pressed } = applyEvent(trak, replan)
        expect({
          state: state._tag,
          standing: standing._tag,
          why: pressed.reconsult?.why,
        }).toStrictEqual({
          state: state._tag,
          standing: standing._tag,
          why: { _tag: "Replanned", step: 1, reason: "go simpler", displaced: standing },
        })
      }
    }
  })

  it("carries it mid-turn as well, where the press is routed rather than parked", () => {
    // `AgentWorking` is the intended landing and is off a gate too: a step whose
    // earlier turn raised and whose re-entry is running when the person presses.
    const trak: Trak = { ...working(1), reconsult: { why: STANDING.Raised } }
    const { trak: pressed } = applyEvent(trak, replan)
    expect(pressed.reconsult?.why).toStrictEqual({
      _tag: "Replanned",
      step: 1,
      reason: "go simpler",
      displaced: STANDING.Raised,
    })
  })

  it("writes the same one ask onto the plan entry, so the wire and the composer see both", () => {
    const trak: Trak = {
      ...emptyTrak(id),
      plan: proposal(2),
      state: TrakState.CheckRunning({ step: 1 }),
      reconsult: { why: STANDING.Raised },
    }
    const { trak: pressed } = applyEvent(trak, replan)
    const entry = pressed.plan?.steps[firstUnrun(pressed)]
    expect(entry).toStrictEqual({
      type: "compose",
      why: { _tag: "Replanned", step: 1, reason: "go simpler", displaced: STANDING.Raised },
    })
    // One entry, not two: the displaced ask rides inside rather than queueing behind.
    expect(
      pressed.plan?.steps.filter((s) => s.type === "compose" && s.why !== undefined),
    ).toHaveLength(1)
  })

  it("replaces the standing ask whole when pressed at a gate, for every kind", () => {
    // At a gate the artifact and its complaints were on screen before the person
    // typed, so their words are the whole account — the rule the round settled. All
    // three gates `asGate` answers for: `recordFacts` files the fact before `decide`
    // rules, so the composer's two gates write the same bare ask a step gate does,
    // even though `decide` then refuses the press at both.
    for (const state of allStates) {
      if (asGate(state) === undefined) continue
      for (const standing of Object.values(STANDING)) {
        const trak: Trak = {
          ...emptyTrak(id),
          plan: proposal(2),
          state,
          reconsult: { why: standing },
        }
        const { trak: pressed } = applyEvent(trak, replan)
        expect({ standing: standing._tag, why: pressed.reconsult?.why }).toStrictEqual({
          standing: standing._tag,
          why: { _tag: "Replanned", step: 1, reason: "go simpler" },
        })
      }
    }
  })

  it("is the fold the log replays to, so a restart sees the same two", () => {
    const events = [
      create,
      ready,
      accept(proposal(3)),
      acted(1, Actions.approve()),
      // Filed with both channels, so a `Raised` stands at `CheckRunning` when the raced
      // press lands there.
      returned(
        1,
        makeArtifact(
          { Summary: "done" },
          [{ text: "flag it", source: "stated", kind: "unplanned_work" }],
          [{ at: "0-plan", text: "no offline case" }],
        ),
      ),
      replan,
    ]
    const viaFold = replayHistory(id, events)
    const viaStep = events.reduce<Trak>((t, e) => applyEvent(t, e).trak, emptyTrak(id))
    expect(viaFold).toEqual(viaStep)
    expect(viaFold.state).toStrictEqual(TrakState.CheckRunning({ step: 1 }))
    expect(viaFold.reconsult?.why).toMatchObject({
      _tag: "Replanned",
      reason: "go simpler",
      displaced: { _tag: "Raised", corrections: [{ at: "0-plan", text: "no offline case" }] },
    })
  })
})

describe("a replan's compose, once its plan has begun", () => {
  it("does not fire again at the next boundary, being keyed on the position", () => {
    // `reconsultHere` is keyed on the position: a replan whose answering plan has
    // begun does not fire again at the step after it.
    const answered = replayHistory(id, [
      create,
      ready,
      accept(proposal(3)),
      acted(1, Actions.approve()),
      ...filed(1, artifact("v1")),
      acted(1, Actions.replan("split this in two")),
      ...keptStep(1),
      accept(proposal(3), sid2),
      acted(2, Actions.approve()),
      ...filed(2, artifact("v2")),
      acted(2, Actions.approve()),
    ])
    expect(answered.reconsult).toBeUndefined()
    expect(pastBoundary(answered, 2).next).toStrictEqual(TrakState.ConditionRunning({ step: 3 }))
  })

  it("records the reason the same way whether the step filed or went stuck", () => {
    // **Where the revision joins on is no longer a judgment.** It used to be: a step
    // that filed was followed, one that filed nothing was *replaced*, so a stuck
    // attempt vanished from the plan. Now nothing that ran is replaced — the join is
    // simply the end of what happened — so both of these record the same thing, and
    // the difference between them is visible in the plan rather than in an integer.
    const ran = [
      create,
      ready,
      accept(proposal(3)),
      acted(1, Actions.approve()),
      ...filed(1, artifact("v1")),
      acted(1, Actions.approve()),
      committed,
      effectsRan(1),
    ]
    const afterFiled = replayHistory(id, [
      ...ran,
      ...filed(2, artifact("v2")),
      acted(2, Actions.replan("actually do it differently")),
    ])
    expect(afterFiled.reconsult).toMatchObject({ why: { _tag: "Replanned", step: 2 } })

    const atStuck = replayHistory(id, [
      ...ran,
      returned(2, stuck("timed out")),
      acted(2, Actions.replan("try a smaller piece")),
    ])
    expect(atStuck.reconsult).toMatchObject({ why: { _tag: "Replanned", step: 2 } })
  })

  it("carries the reason, because it is the only account the composer is given", () => {
    const trak = replayHistory(id, [
      create,
      ready,
      accept(proposal(2)),
      acted(1, Actions.approve()),
      returned(1, stuck("timed out")),
      acted(1, Actions.replan("use the other library")),
    ])
    expect(trak.reconsult?.why).toEqual({
      _tag: "Replanned",
      step: 1,
      reason: "use the other library",
    })
  })
})

/** Step 1 has run and filed whatever the case is about, with step 0 already approved. */
const found = (...steps: readonly Event[]) =>
  replayHistory(id, [create, ready, accept(proposal(3)), acted(1, Actions.approve()), ...steps])

describe("a step that sends the plan back", () => {
  it("records what it raised", () => {
    const trak = found(...filed(1, raising("done", "and a mockup first")))
    expect(trak.reconsult).toEqual({
      why: { _tag: "Raised", step: 1, requirements: ["and a mockup first"], corrections: [] },
    })
  })

  it("records a correction the same way, so one ask carries either channel", () => {
    const trak = found(...filed(1, correcting("done", "0-plan", "the offline case is missing")))
    expect(trak.reconsult).toEqual({
      why: {
        _tag: "Raised",
        step: 1,
        requirements: [],
        corrections: [{ at: "0-plan", text: "the offline case is missing" }],
      },
    })
  })

  it("carries both in one ask, because only one may stand at a time", () => {
    const both = makeArtifact(
      { Summary: "done" },
      [{ text: "flag it", source: "stated", kind: "unplanned_work" }],
      [{ at: "0-plan", text: "no offline case" }],
    )
    const trak = found(...filed(1, both))
    expect(trak.reconsult).toEqual({
      why: {
        _tag: "Raised",
        step: 1,
        requirements: ["flag it"],
        corrections: [{ at: "0-plan", text: "no offline case" }],
      },
    })
  })

  it("gates like any other artifact — an agent does not move a trak by writing a field", () => {
    const trak = found(...filed(1, raising("done", "and a mockup first")))
    expect(trak.state).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "approval" }))
  })

  it("reaches the composer only after the work is kept, never at the gate", () => {
    // The order is the point: `Approve` commits first, exactly as at every other
    // step boundary, and the compose follows the commit.
    const approved = found(
      ...filed(1, raising("done", "and a mockup first")),
      acted(1, Actions.approve()),
    )
    expect(approved.state).toEqual(TrakState.Committing({ step: 1 }))
    expect(pastBoundary(approved, 1)).toMatchObject({
      _tag: "Advance",
      next: TrakState.Composing(),
      commands: [{ _tag: "Compose", trigger: Triggers.reconsulted() }],
    })
  })

  it("buys no composer turn when a person sends the artifact back instead", () => {
    const chatted = found(
      ...filed(1, raising("done", "and a mockup first")),
      acted(1, Actions.chat("drop the mockup, we have one")),
      ...filed(1, artifact("done, no mockup needed")),
    )
    expect(chatted.reconsult).toBeUndefined()
    // And nothing of it is left standing in the plan. An entry nobody will ever run
    // is one the next commit boundary walks straight into.
    expect(chatted.plan?.steps.map(stepName)).toEqual(["compose", "a0", "a1", "a2"])
    expect(pastBoundary(chatted, 1)).toMatchObject({
      next: TrakState.ConditionRunning({ step: 2 }),
    })
  })

  it("fires once, at ITS step's commit and no other", () => {
    // Unguarded, this is an infinite loop: the field survives until the plan
    // answering it begins, so the NEXT commit boundary would compose again.
    const later = found(
      ...filed(1, raising("done", "and a mockup first")),
      acted(1, Actions.approve()),
    )
    expect(pastBoundary(later, 2)).toMatchObject({
      next: TrakState.ConditionRunning({ step: 3 }),
    })
  })

  it("composes even from the last step, where the plan would otherwise have run out", () => {
    const lastStep = replayHistory(id, [
      create,
      ready,
      accept(proposal(1)),
      acted(1, Actions.approve()),
      ...filed(1, raising("done", "we should also update the README")),
      acted(1, Actions.approve()),
    ])
    expect(pastBoundary(lastStep, 1)).toMatchObject({ next: TrakState.Composing() })
  })
})

describe("what a filed requirement costs", () => {
  it("asks nothing where the entry only settled something, whatever else it says", () => {
    // The whole of the split: the entry lands on the intent and the trak walks on to
    // its next step. `composer.md` injects that list on every planning turn, so waking
    // one now would tell it nothing it will not read anyway.
    const text = "we are staying on the current library"
    const settled = found(...filed(1, constraining("done", text)))
    expect(settled.reconsult).toBeUndefined()
    expect(settled.decisions).toEqual([{ text, source: "assumed", at: "1-a0" }])
    const approved = found(...filed(1, constraining("done", text)), acted(1, Actions.approve()))
    expect(pastBoundary(approved, 1)).toMatchObject({
      next: TrakState.ConditionRunning({ step: 2 }),
    })
  })

  it("asks nothing for an entry filed before the kinds existed, which is every stored one", () => {
    // Absent is not the cautious answer here, deliberately: reading it as one would
    // spend a planning turn on every entry already in the store.
    const old = makeArtifact({ Summary: "done" }, [{ text: "flag it", source: "stated" }])
    const trak = found(...filed(1, old))
    expect(trak.reconsult).toBeUndefined()
    expect(trak.decisions).toEqual([{ text: "flag it", source: "stated", at: "1-a0" }])
  })
})

describe("the turn the composer is owed, standing in the plan while it runs", () => {
  /** Three steps, the first two run, the third never started. */
  const twoIn = [
    create,
    ready,
    accept(proposal(3)),
    acted(1, Actions.approve()),
    ...filed(1, artifact("v1")),
    acted(1, Actions.approve()),
    ...keptStep(1),
    ...filed(2, artifact("v2")),
  ]

  it("is an entry from the moment something asks, not from the moment its run lands", () => {
    // What the plan showed before this was the *previous* compose, which reads as a
    // trak that has gone backwards for as long as the composer takes.
    // The step had filed, so the work is being kept and the composer's turn is a
    // boundary away — and the entry is already standing.
    const asking = replayHistory(id, [...twoIn, acted(2, Actions.replan("split this in two"))])
    expect(asking.state).toEqual(TrakState.Committing({ step: 2 }))
    expect(asking.plan?.steps.map(stepName)).toEqual(["compose", "a0", "a1", "compose", "a2"])
    expect(asking.plan?.steps[3]).toEqual({
      type: "compose",
      why: { _tag: "Replanned", step: 2, reason: "split this in two" },
    })
  })

  it("is unrun until its own turn comes back, which is what the tail stays behind", () => {
    const asking = replayHistory(id, [
      ...twoIn,
      acted(2, Actions.replan("split this in two")),
      ...keptStep(2),
    ])
    expect(asking.state).toEqual(TrakState.Composing())
    expect(slotAt(asking, 3).session).toBeUndefined()
    expect(firstUnrun(asking)).toBe(3)
    const landed = applyEvent(asking, accept(proposal(1), sid2)).trak
    expect(slotAt(landed, 3).session).toBe(sid2)
    expect(landed.plan?.steps.map(stepName)).toEqual(["compose", "a0", "a1", "compose", "a0"])
  })

  it("is one entry however often the ask changes, because it is one field", () => {
    // A step raised something, and the person at its gate replanned instead of
    // approving. Two asks, one turn: the second replaces the first rather than
    // queueing behind it.
    const twice = replayHistory(id, [
      ...twoIn.slice(0, -2),
      ...filed(2, raising("v2", "and a mockup first")),
      acted(2, Actions.replan("split this in two")),
    ])
    expect(twice.plan?.steps.map(stepName)).toEqual(["compose", "a0", "a1", "compose", "a2"])
    expect(twice.plan?.steps[3]).toMatchObject({ why: { _tag: "Replanned" } })
  })

  it("stands at the end when that is where the work ran out", () => {
    const reentered = replayHistory(id, [
      ...twoIn,
      acted(2, Actions.approve()),
      ...keptStep(2),
      ...filed(3, artifact("v3")),
      acted(3, Actions.approve()),
      committed,
      effectsRan(3),
      Events.reentered("CI failed on main: the auth test is flaky"),
    ])
    expect(reentered.plan?.steps.map(stepName)).toEqual(["compose", "a0", "a1", "a2", "compose"])
  })
})

/**
 * A declaration all the way to rest: the reason, the commit that keeps whatever is in
 * the checkout, and the checkout going. Spelled out because a bare `Abandoned` leaves
 * the trak in `Abandoning` — where a re-entry is `unexpected`, and every assertion
 * about what it *decided* would be read off a trak that had failed instead.
 */
const gaveUp = (reason: string): readonly Event[] => [
  Events.abandoned(reason),
  committed,
  Events.worktreeRemoved(),
]

/**
 * The trak owes the composer nothing, and entering its worktree runs the turn at
 * `step` — the two halves of *this ask reaches its own agent*, which is what every
 * case below is about.
 */
const spawnsAt = (trak: Trak, step: number): void => {
  expect(trak.reconsult).toBeUndefined()
  expect(trak.state).toEqual(TrakState.Preparing())
  // Entering a step asks its conditions first, at every first entry.
  expect(applyEvent(trak, ready).decision).toEqual(
    Decision.Advance({
      next: TrakState.ConditionRunning({ step }),
      commands: [Command.AskConditions({ step })],
    }),
  )
}

describe("a re-entry that names an agent", () => {
  const question = "does this cover the offline case?"
  /** A whole plan run out and its work kept — a `Finished` trak, which is the door. */
  const ranToTheEnd: readonly Event[] = [
    create,
    ready,
    accept(proposal(2)),
    acted(1, Actions.approve()),
    ...filed(1, artifact("v1")),
    acted(1, Actions.approve()),
    ...keptStep(1),
    ...filed(2, artifact("v2")),
    acted(2, Actions.approve()),
    ...keptStep(2),
    committed,
  ]

  const asked = (...before: readonly Event[]): Trak =>
    replayHistory(id, [...before, Events.reentered(question, "generic")])

  it("stands the agent's turn in the plan instead of asking the composer", () => {
    const trak = asked(...ranToTheEnd)
    expect(trak.plan?.steps.map(stepName)).toEqual(["compose", "a0", "a1", "generic"])
    expect(trak.plan?.steps[3]).toMatchObject({
      agent: "generic",
      instruction: question,
      conversational: true,
    })
    // Nothing owes the composer a turn, which is what `onWorktreeReady` reads.
    expect(trak.reconsult).toBeUndefined()
    // Nothing that ran moved: the entries keep their positions and so do their slots.
    expect(slotAt(trak, 1).session).toBe(sid)
    expect(firstUnrun(trak)).toBe(3)
  })

  it("enters that turn once there is somewhere to work, spending no composer turn", () => {
    const trak = asked(...ranToTheEnd)
    expect(trak.state).toEqual(TrakState.Preparing())
    const entered = applyEvent(trak, ready)
    expect(entered.trak.state).toEqual(TrakState.ConditionRunning({ step: 3 }))
    expect(entered.decision).toEqual(
      Decision.Advance({
        next: TrakState.ConditionRunning({ step: 3 }),
        commands: [Command.AskConditions({ step: 3 })],
      }),
    )
  })

  it("stands at the join rather than at the end, where a trak stopped with work planned", () => {
    // Abandoned two steps into a three-step plan. The entry goes where the composer's
    // ask would have — ahead of the tail nobody ran — so the question is answered
    // first and the planned work is still there behind it. Appending at the end would
    // run that work instead, on the strength of a person asking a question.
    const trak = asked(
      create,
      ready,
      accept(proposal(3)),
      acted(1, Actions.approve()),
      ...filed(1, artifact("v1")),
      ...gaveUp("did the rest by hand"),
    )
    expect(trak.plan?.steps.map(stepName)).toEqual(["compose", "a0", "generic", "a1", "a2"])
    spawnsAt(trak, 2)
  })

  it("is the whole plan where there never was one", () => {
    // A trak abandoned before its first compose landed has nothing to splice into, so
    // the entry is the plan — the one-entry shape New Trak's named-agent birth has.
    const trak = asked(create, ready, ...gaveUp("wrong repository"))
    expect(trak.plan?.steps.map(stepName)).toEqual(["generic"])
    expect(trak.plan?.title).toBe(question)
    spawnsAt(trak, 0)
  })
})

// The field is cleared in one place — `answered`, off an `AgentReturned` or a
// `ChildrenSpawned` — so a trak that came to rest without reaching either is still
// carrying one. `onWorktreeReady` reads it BEFORE it reads the plan, so an ask that
// left it set would buy a composer turn on the *previous* sentence, park at a plan
// gate, and lose its own entry to `landCompose`'s truncation. Three logs produce it,
// and this is the set rather than an example.
describe("a re-entry that names an agent, on a trak still owing the composer a turn", () => {
  const question = "does this cover the offline case?"

  /** The whole of a plan, run out, its work kept — the `Finished` this door opens on. */
  const ranToTheEnd: readonly Event[] = [
    create,
    ready,
    accept(proposal(1)),
    acted(1, Actions.approve()),
    ...filed(1, artifact("v1")),
    acted(1, Actions.approve()),
    ...keptStep(1),
    committed,
  ]

  /** The first door pressed on that trak: the sentence goes to the composer. */
  const sentBack: readonly Event[] = [...ranToTheEnd, Events.reentered("CI went red"), ready]

  const asked = (...before: readonly Event[]): Trak =>
    replayHistory(id, [...before, Events.reentered(question, "generic")])

  it("clears a debt the composer already answered `finished`", () => {
    // The reachable one, and the one that reads worst: *more work on it*, the composer
    // says there is nothing to do, the trak comes back to `Finished` — and `landFinish`
    // leaves the field set, so the next question is planned against last week's.
    const before = [...sentBack, ends("the flaky test is main's own"), committed]
    expect(replayHistory(id, before).reconsult).toMatchObject({ why: { _tag: "Reentered" } })

    const trak = asked(...before)
    expect(trak.plan?.steps.map(stepName)).toEqual(["compose", "a0", "compose", "generic"])
    spawnsAt(trak, 3)
  })

  it("clears one a person walked away from at the plan gate", () => {
    // The composer proposed and nobody approved: `landCompose` landed the run, and
    // nothing since produced the `AgentReturned` that would have closed the door.
    const trak = asked(...sentBack, accept(proposal(1), sid2), ...gaveUp("did it by hand instead"))
    // The tail nobody ran keeps its place behind the question, as at any other join.
    expect(trak.plan?.steps.map(stepName)).toEqual(["compose", "a0", "compose", "generic", "a0"])
    spawnsAt(trak, 3)
  })

  it("takes the entry with it where the composer's turn never happened", () => {
    // The compose turn failed and the trak was given up on, so the ask is still
    // standing unrun at the join. Clearing the field alone would leave that compose
    // entry directly behind the answer — a planning turn at the next boundary, on a
    // press whose whole promise is that there is not one.
    const trak = asked(
      ...sentBack,
      Events.turnFailed(undefined, sid2, "usage limit reached"),
      ...gaveUp("not worth another try"),
    )
    expect(trak.plan?.steps.map(stepName)).toEqual(["compose", "a0", "generic"])
    spawnsAt(trak, 2)
  })
})

describe("a plan that said where it ends", () => {
  const question = "column or schema — nothing past the breakdown can be planned until that lands"
  /** Two steps, then the composer's own re-cut — the entry that says *ask me again*. */
  const stopsShort = makeProposal("do the thing", [
    { agent: "a0", instruction: "do step 0" },
    { agent: "a1", instruction: "do step 1" },
    { type: "compose", instruction: question },
  ])
  /** Both steps filed and approved, up to but not including the last commit. */
  const upToTheEnd = (p: Proposal): readonly Event[] => [
    create,
    ready,
    accept(p),
    acted(1, Actions.approve()),
    ...filed(1, artifact("v1")),
    acted(1, Actions.approve()),
    ...keptStep(1),
    ...filed(2, artifact("v2")),
    acted(2, Actions.approve()),
  ]
  /** The commit at the end lands, and this is where its effects leave the trak. */
  const atTheEnd = (p: Proposal) =>
    applyEvent(
      replayHistory(id, [...upToTheEnd(p), Events.workCommitted(undefined, 2)]),
      effectsRan(2),
    )

  it("asks the composer instead of coming to rest", () => {
    expect(atTheEnd(stopsShort).decision).toMatchObject({
      _tag: "Advance",
      next: TrakState.Composing(),
      commands: [{ _tag: "Compose", trigger: Triggers.reconsulted() }],
    })
  })

  it("carries nothing on the trak to say so — the entry is the whole of it", () => {
    // The predicate this replaced lived in `recordFacts`: a commit that ran the plan
    // out wrote `Exhausted` onto `Trak.reconsult`, and `decide` asked the field. There
    // is nothing to write down now, because reaching the entry *is* the fact.
    expect(atTheEnd(stopsShort).trak.reconsult).toBeUndefined()
  })

  it("rests as it always did when the plan proposed no compose", () => {
    const rested = atTheEnd(proposal(2))
    expect(rested.trak.reconsult).toBeUndefined()
    expect(rested.decision).toMatchObject({ _tag: "Advance", next: TrakState.Integrating() })
  })

  it("stays shut at a boundary the plan does not end at", () => {
    const midway = replayHistory(id, [
      create,
      ready,
      accept(stopsShort),
      acted(1, Actions.approve()),
      ...filed(1, artifact("v1")),
      acted(1, Actions.approve()),
      ...keptStep(1),
    ])
    expect(midway.state).toEqual(TrakState.ConditionRunning({ step: 2 }))
  })

  it("fills the entry in rather than appending beside it", () => {
    // The whole of what makes this a step: the position the composer wrote down when
    // it planned the stop is the position its run lands at. Appending would leave one
    // compose entry proposed and never run, and a second beside it that did the work.
    const landed = replayHistory(id, [
      ...upToTheEnd(stopsShort),
      ...keptStep(2),
      accept(proposal(1), sid2),
    ])
    expect(landed.plan?.steps.map(stepName)).toEqual(["compose", "a0", "a1", "compose", "a0"])
    expect(slotAt(landed, 3).session).toBe(sid2)
  })

  it("approves into the work, not past it into a turn nobody has asked for", () => {
    // `enterAt` used to be *after the last compose entry*, which with this plan on the
    // table is the end of it — so approving would have run the trak straight out.
    const onTheTable = replayHistory(id, [create, ready, accept(stopsShort)])
    expect(decide(onTheTable, acted(0, Actions.approve()))).toMatchObject({
      next: TrakState.ConditionRunning({ step: 1 }),
    })
  })

  it("is replaced like any unrun entry when something asks first", () => {
    // A step ahead of it raised something, so the composer is asked from there — and the
    // re-cut it was going to make at position 3 is guesswork that never happened.
    const asked = replayHistory(id, [
      create,
      ready,
      accept(stopsShort),
      acted(1, Actions.approve()),
      ...filed(1, artifact("v1")),
      acted(1, Actions.approve()),
      ...keptStep(1),
      ...filed(2, raising("done", "and the README")),
      acted(2, Actions.approve()),
      ...keptStep(2),
      accept(proposal(1), sid2),
    ])
    expect(asked.plan?.steps[3]).toEqual({
      type: "compose",
      why: { _tag: "Raised", step: 2, requirements: ["and the README"], corrections: [] },
    })
  })
})

describe("a plan the composer revised", () => {
  /** Two steps filed, the third stuck, the human agreed. */
  const stuckAtTwo = [
    create,
    ready,
    accept(proposal(4)),
    acted(1, Actions.approve()),
    ...filed(1, artifact("v1")),
    acted(1, Actions.approve()),
    ...keptStep(1),
    ...filed(2, artifact("v2")),
    acted(2, Actions.approve()),
    ...keptStep(2),
    returned(3, stuck("timed out twice")),
    acted(3, Actions.replan("try a smaller piece")),
    // The stuck step's checkout is kept before the composer runs, as at every gate.
    ...keptStep(3),
  ]
  const revision = makeProposal("re-cut", [
    { agent: "unblock", instruction: "pick it up" },
    { agent: "review", instruction: "check it" },
  ])

  const revised = replayHistory(id, [...stuckAtTwo, accept(revision, sid2)])

  it("keeps the steps that ran and appends the remainder", () => {
    // Everything that ran keeps its place, the compose that produced the revision
    // is written down where it happened, and the remainder follows it. `a2` went
    // stuck and stays: it is what happened, and re-doing that work is a new entry.
    expect(revised.plan?.steps.map(stepName).join(" ")).toBe(
      "compose a0 a1 a2 compose unblock review",
    )
  })

  it("takes the revision's title — the newest turn is the one that knows what this is", () => {
    expect(revised.plan?.title).toBe("re-cut")
  })

  it("starts after a step that filed, whose artifact is kept", () => {
    const informed = replayHistory(id, [
      create,
      ready,
      accept(proposal(4)),
      acted(1, Actions.approve()),
      ...filed(1, artifact("v1")),
      acted(1, Actions.approve()),
      committed,
      effectsRan(1),
      ...filed(2, artifact("this needs splitting")),
      acted(2, Actions.replan("split it")),
      accept(revision, sid2),
    ])
    expect(informed.plan?.steps.map(stepName).join(" ")).toBe(
      "compose a0 a1 compose unblock review",
    )
    expect(informed.artifacts.get("2-a1")).toBeDefined()
  })

  it("keeps every slot, because nothing that ran is replaced", () => {
    // **The splice used to drop the slot at and after the join**, so that a stuck
    // `2-a2` replanned into `3-unblock` did not resume the stuck conversation. There
    // is nothing to drop now: the rescuing work is a new entry at a new index, so it
    // has no slot of its own to inherit and the stuck attempt keeps its record.
    expect(slotAt(revised, 3).session).toBe(sid)
    expect(slotAt(revised, 1).session).toBe(sid)
    expect(slotAt(revised, 1).iterations).toBe(1)
    // The entries the revision proposed have run nothing, so they have no slot.
    expect(revised.slots.has(5)).toBe(false)
  })

  it("approving the revised plan enters it after the compose that wrote it", () => {
    const r = decide(revised, acted(1, Actions.approve()))
    expect(r).toMatchObject({
      _tag: "Advance",
      next: TrakState.ConditionRunning({ step: 5 }),
      commands: [{ _tag: "AskConditions", step: 5 }],
    })
  })

  it("agrees with applyEvent across the splice, like every other piece of state", () => {
    const history = [...stuckAtTwo, accept(revision, sid2)]
    const viaStep = history.reduce<Trak>((t, e) => applyEvent(t, e).trak, emptyTrak(id))
    expect(replayHistory(id, history)).toEqual(viaStep)
  })

  it("keeps what a child was born holding, which no plan of its own can change", () => {
    // The whole slot goes at the join. This is not in one: it is not keyed by
    // position, and re-planning a piece's own steps does not change what the piece
    // was split out of.
    const bornWith: Event = Events.trakCreated("d", {
      parent: { id, step: 1, child: 0, depth: 1 },
      plan: proposal(1),
      base: undefined,
      decisions: [],
      artifacts: [["0-breakdown", makeArtifact({ Summary: "three pieces" })]],
      split: { instruction: "three pieces", pieces: [{ name: "1.0-build", instruction: "one" }] },
    })
    const spliced = replayHistory(id, [
      bornWith,
      ready,
      ...filed(1, artifact("v1")),
      acted(1, Actions.replan("this piece is two pieces")),
      accept(revision, sid2),
    ])
    expect(spliced.plan?.steps.map(stepName).join(" ")).toBe("compose unblock review")
    // A `Document`, not the `Artifact` it was handed: the envelope is the step's
    // and only the document crosses.
    expect(spliced.inherited).toEqual([["0-breakdown", { sections: { Summary: "three pieces" } }]])
  })

  it("sends the composer's own questions back to the composer, never into a step", () => {
    // The reason `AwaitingComposerAnswers` exists: a proposal now exists when the
    // composer asks, so "is there a proposal" stopped telling the two apart, and
    // answering would have spawned a step instead of re-composing.
    const asked = replayHistory(id, [
      ...stuckAtTwo,
      Events.composerReturned(sid, askPlainly("own PR or not?")),
    ])
    expect(asked.state).toEqual(TrakState.AwaitingComposerAnswers())
    const r = decide(asked, acted(1, Actions.answer(["own PR"])))
    expect(r).toMatchObject({
      _tag: "Advance",
      next: TrakState.Composing(),
      commands: [{ _tag: "Compose", trigger: Triggers.answers(["own PR"]) }],
    })
  })
})

describe("an agent answering rather than working", () => {
  /**
   * Built by replay, never by hand: `gate` is derived, and a test that set it
   * directly would prove `decide` reads a field rather than proving the field is
   * there to read when it matters.
   */
  const afterChatting = (history: readonly Event[]): Trak => replayHistory(id, history)

  const untilArtifact = [create, ready, accept(proposal(2)), acted(1, Actions.approve())]

  it("returns to the artifact gate it was called away from", () => {
    const trak = afterChatting([
      ...untilArtifact,
      ...filed(1, artifact("v1")),
      acted(1, Actions.chat("why two steps?")),
      returned(1, message("because the review needs something to read")),
    ])
    expect(trak.state).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "approval" }))
  })

  it("leaves the artifact alone — a conversation is not a new version", () => {
    const trak = afterChatting([
      ...untilArtifact,
      ...filed(1, artifact("v1")),
      acted(1, Actions.chat("why?")),
      returned(1, message("because")),
    ])
    expect(artifactText(trak.artifacts.get("1-a0") ?? empty)).toBe(doc("v1"))
  })

  it("is not an attempt at the work, so it does not count as one", () => {
    // `iterations` means attempts at the step's own output. Three exchanges about
    // one artifact reporting "attempt 4" is a display lie, and the count is what
    // `ork` shows and what `resumeFrom` reads.
    const trak = afterChatting([
      ...untilArtifact,
      ...filed(1, artifact("v1")),
      acted(1, Actions.chat("why?")),
      returned(1, message("because")),
      acted(1, Actions.chat("and?")),
      returned(1, message("and that")),
    ])
    expect(slotAt(trak, 1).iterations).toBe(1)
  })

  it("still records the session, which is what keeps the conversation going", () => {
    const other = SessionId.make("00000000-0000-4000-8000-000000000002")
    const trak = afterChatting([
      ...untilArtifact,
      ...filed(1, artifact("v1")),
      acted(1, Actions.chat("why?")),
      Events.agentReturned(1, other, message("because")),
    ])
    expect(slotAt(trak, 1).session).toBe(other)
  })

  it("keeps an escalation gate intact through being argued with", () => {
    // The case a display-only "reply" gate gets wrong: land anywhere else and
    // pressing enter walks FORWARD past an escalation instead of answering it.
    const trak = afterChatting([
      create,
      ready,
      accept(proposal(3)),
      acted(1, Actions.approve()),
      ...filed(1, artifact("v1")),
      acted(1, Actions.approve()),
      committed,
      effectsRan(1),
      returned(2, stuck("no way in")),
      acted(2, Actions.chat("tests exist, look again")),
      returned(2, message("you are right, I missed them")),
    ])
    expect(trak.state).toEqual(TrakState.AwaitingHuman({ step: 2, kind: "stuck" }))
  })

  it("returns to the plan gate when the composer is the one answering", () => {
    const trak = afterChatting([
      create,
      ready,
      accept(proposal(2)),
      acted(1, Actions.chat("why three steps?")),
      Events.composerReturned(sid, message("two, and here is why")),
    ])
    expect(trak.state).toEqual(TrakState.AwaitingProposal())
    // Three entries, not two: the compose that wrote them is one of them. The chat
    // resumed that same session, so it revised its own entry rather than adding one.
    expect(trak.plan?.steps.length).toBe(3)
  })

  it("approving after a reply routes exactly as it would have before it", () => {
    const chatted = afterChatting([
      ...untilArtifact,
      ...filed(1, artifact("v1")),
      acted(1, Actions.chat("why?")),
      returned(1, message("because")),
    ])
    const r = decide(chatted, acted(1, Actions.approve()))
    expect(r).toMatchObject({ _tag: "Advance", next: TrakState.Committing({ step: 1 }) })
  })

  it("fails loudly with no gate to return to, rather than teleporting", () => {
    // Unreachable through the runtime, which only builds a reply on a turn a human
    // started. Reachable by a caller assembling the log by hand.
    const trak: Trak = {
      ...emptyTrak(id),
      plan: proposal(2),
      state: TrakState.AgentWorking({ step: 1 }),
    }
    const r = decide(trak, returned(1, message("hello")))
    expect(r._tag).toBe("Settle")
    expect(r.next._tag).toBe("Failed")
  })
})

describe("skipping a failed effect", () => {
  /** A trak whose step-0 effect `open-pr` failed, through the domain's own fold. */
  const failedAtEffect = (): Trak =>
    applyEvent(
      { ...emptyTrak(id), plan: proposal(2), state: TrakState.Effecting({ step: 0 }) },
      Events.effectFailed(0, "open-pr", "gh: not authenticated"),
    ).trak
  const skip = Events.effectsRan(0, [], ["open-pr", "notify"])

  it("enters the next step exactly as effects that ran would have", () => {
    const trak = failedAtEffect()
    expect(effectFailedAt(trak)).toBe(0)
    const ran = decide(
      { ...trak, state: TrakState.Effecting({ step: 0 }), failedFrom: undefined },
      effectsRan(0),
    )
    // No `RunEffects` is issued: the next step is entered, and nothing reruns.
    expect(decide(trak, skip)).toEqual(ran)
    expect(ran.next).toEqual(TrakState.ConditionRunning({ step: 1 }))
  })

  it("is refused where no skip was asked for, or at another step", () => {
    const trak = failedAtEffect()
    for (const e of [effectsRan(0), Events.effectsRan(1, [], ["open-pr"])]) {
      const r = decide(trak, e)
      expect(r.next._tag === "Failed" && r.next.kind).toBe("engine")
    }
  })

  it("does not apply where something other than an effect stopped it", () => {
    // `Effecting` can also settle as the engine's failure; nobody saw an effect fail there.
    const engine = applyEvent(
      { ...emptyTrak(id), plan: proposal(2), state: TrakState.Effecting({ step: 0 }) },
      Events.checksPassed(0, []),
    ).trak
    expect(engine.state._tag === "Failed" && engine.state.kind).toBe("engine")
    expect(effectFailedAt(engine)).toBeUndefined()
    const r = decide(engine, skip)
    expect(r.next._tag).toBe("Failed")
  })

  it("keeps the names it skipped on the log, in the order declared", () => {
    const decoded = Schema.decodeUnknownSync(Event)(JSON.parse(JSON.stringify(skip)))
    expect(decoded._tag === "EffectsRan" && decoded.skipped).toEqual(["open-pr", "notify"])
    expect(Events.effectsRan(0, [])).not.toHaveProperty("skipped")
  })
})

describe("skipping a step", () => {
  const untilQuestions = [
    create,
    ready,
    accept(proposal(2)),
    acted(1, Actions.approve()),
    returned(1, askPlainly("which subcommands?")),
  ]

  it("keeps the step and records what was said", () => {
    const trak = replayHistory(id, [...untilQuestions, acted(1, Actions.skip("docs only"))])
    // A skip keeps the step's own work exactly as an approval does — see
    // `keepStep` — so it parks in `Committing` until that commit comes back.
    expect(trak.state).toEqual(TrakState.Committing({ step: 1 }))
    expect(slotAt(trak, 1).skipNote).toBe("docs only")
    // No artifact for the step nobody ran, and nothing invented in its place.
    expect(trak.artifacts.has("1-a0")).toBe(false)
  })

  it("is recorded even with nothing said, because presence is the skip", () => {
    const trak = replayHistory(id, [...untilQuestions, acted(1, Actions.skip())])
    expect(slotAt(trak, 1).skipped).toBe(true)
    expect(slotAt(trak, 1).skipNote).toBeUndefined()
  })

  it("does not consult the composer — a plan minus one step is not a broken plan", () => {
    const parked = replayHistory(id, untilQuestions)
    const r = decide(parked, acted(1, Actions.skip("docs only")))
    expect(r).toEqual(
      Decision.Advance({
        next: TrakState.Committing({ step: 1 }),
        commands: [Command.CommitWork({ step: 1 })],
      }),
    )
  })

  it("runs off the end into Integrating when the skipped step was the last", () => {
    const trak = replayHistory(id, [
      create,
      ready,
      accept(proposal(1)),
      acted(1, Actions.approve()),
      returned(1, askPlainly("which subcommands?")),
      acted(1, Actions.skip()),
      committed,
      effectsRan(1),
    ])
    expect(trak.state).toEqual(TrakState.Integrating())
  })

  it("is refused at every gate whose step has already filed", () => {
    // Not a second `Approve`. The two route identically, so the gate check is the
    // only thing keeping them apart — and a skip recorded against a step that
    // produced work would tell the next agent something false.
    for (const kind of ["approval", "checks"] as const) {
      const trak: Trak = {
        ...emptyTrak(id),
        plan: proposal(2),
        state: TrakState.AwaitingHuman({ step: 1, kind }),
      }
      const r = decide(trak, acted(1, Actions.skip()))
      expect(r._tag).toBe("Settle")
      expect(r.next).toMatchObject({ _tag: "Failed", kind: "engine" })
    }
  })

  it("is refused at the plan gate, where nothing is running to skip", () => {
    const trak = replayHistory(id, [create, ready, accept(proposal(2))])
    const r = decide(trak, acted(1, Actions.skip()))
    expect(r._tag).toBe("Settle")
    expect(r.next).toMatchObject({ _tag: "Failed", kind: "engine" })
  })

  it("survives a revision of the steps after it, because it describes one that ran", () => {
    // A skip is always behind a resume point — the trak had to move past the step
    // to record one — so the splice keeps every entry. Asserted because the
    // opposite would be silent: the step after the skip would stop being told.
    const trak = replayHistory(id, [
      create,
      ready,
      accept(proposal(3)),
      acted(1, Actions.approve()),
      returned(1, askPlainly("which?")),
      acted(1, Actions.skip("not now")),
      returned(2, stuck("no way in")),
      acted(2, Actions.replan("pick it up differently")),
      accept(makeProposal("re-cut", [{ agent: "unblock", instruction: "pick it up" }]), sid2),
    ])
    expect(slotAt(trak, 1).skipNote).toBe("not now")
    // The skipped step and the stuck one both keep their slots: they happened, and a
    // revision appends rather than replacing. Nothing resumes them, because the work
    // the composer proposed instead sits at an index of its own.
    expect(slotAt(trak, 2).session).toBe(sid)
  })
})

describe("a step whose artifact is not owed on the first turn", () => {
  /** Two steps, the first of which is conversational. */
  const riffing = makeProposal("do the thing", [
    { agent: "a0", instruction: "talk it through", conversational: true },
    { agent: "a1", instruction: "do step 1" },
  ])
  const untilRiffing = [create, ready, accept(riffing), acted(1, Actions.approve())]

  it("parks in the conversation rather than at the gate it was entered from", () => {
    // `lastGate` here is the PLAN gate — where `Chat` talks to the composer and
    // `Approve` enters the plan again. Returning there is the bug this kind
    // exists to prevent, and it is invisible: both are gates, both look parked.
    const trak = replayHistory(id, [...untilRiffing, returned(1, message("what are we after?"))])
    expect(trak.state).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "conversation" }))
  })

  it("offers no approval, because there is nothing filed to approve", () => {
    const trak = replayHistory(id, [...untilRiffing, returned(1, message("what are we after?"))])
    const r = decide(trak, acted(1, Actions.chat("scope")))
    expect(r).toMatchObject({ _tag: "Advance", next: TrakState.AgentWorking({ step: 1 }) })

    // And an approval that arrives anyway is refused rather than honoured: the
    // action list a gate declares is what surfaces read, not something `decide`
    // re-reads, so this is the only place that can stop it.
    const approved = decide(trak, acted(1, Actions.approve()))
    expect(approved._tag).toBe("Settle")
    expect(approved.next).toMatchObject({ _tag: "Failed", kind: "engine" })
  })

  it("goes to its ordinary gate the moment it files, and back there when chatted to", () => {
    const settled = replayHistory(id, [
      ...untilRiffing,
      returned(1, message("what are we after?")),
      acted(1, Actions.chat("scope")),
      ...filed(1, artifact("v1")),
    ])
    expect(settled.state).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "approval" }))

    // Conversational moves the deadline, not the gate: once the document exists a
    // reply belongs at the approval gate, with the artifact still on the table.
    const asked = replayHistory(id, [
      ...untilRiffing,
      returned(1, message("what are we after?")),
      acted(1, Actions.chat("scope")),
      ...filed(1, artifact("v1")),
      acted(1, Actions.chat("why only list?")),
      returned(1, message("because")),
    ])
    expect(asked.state).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "approval" }))
  })

  it("says nothing about the step after it, which owes its artifact as usual", () => {
    const trak = replayHistory(id, [
      ...untilRiffing,
      ...filed(1, artifact("v1")),
      acted(1, Actions.approve()),
      committed,
      effectsRan(1),
      returned(2, message("just chatting")),
    ])
    // Step 1 is not conversational, so a reply there is a reply at a gate — and
    // the gate it returns to is step 0's, which is where the human last stood.
    expect(trak.state).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "approval" }))
  })
})

describe("replayHistory", () => {
  const events = [
    create,
    ready,
    accept(proposal(2)),
    returned(1, artifact("first")),
    acted(1, Actions.approve()),
    returned(2, artifact("no blockers")),
  ]

  it("is deterministic — folding twice yields the same trak", () => {
    expect(replayHistory(id, events)).toEqual(replayHistory(id, events))
  })

  it("derives artifacts from the log (there is no ArtifactWritten event)", () => {
    expect(artifactText(replayHistory(id, events).artifacts.get("1-a0") ?? empty)).toBe(
      doc("first"),
    )
  })

  it("derives iteration counts per step", () => {
    const retried = [
      create,
      ready,
      accept(proposal(1)),
      ...filed(1, artifact("v1")),
      acted(1, Actions.chat("no")),
      ...filed(1, artifact("v2")),
    ]
    const trak = replayHistory(id, retried)
    expect(slotAt(trak, 1).iterations).toBe(2)
    expect(artifactText(trak.artifacts.get("1-a0") ?? empty)).toBe(doc("v2"))
  })

  it("agrees with applyEvent() — stored and replayed state cannot diverge", () => {
    const viaFold = replayHistory(id, events)
    const viaStep = events.reduce<Trak>((t, e) => applyEvent(t, e).trak, emptyTrak(id))
    expect(viaFold).toEqual(viaStep)
  })

  describe("the requirements channel", () => {
    const scope = { text: "the admin view is out of scope", source: "stated" } as const
    const responsive = { text: "responsive means phone and desktop", source: "assumed" } as const
    const auth = { text: "we are staying on the current auth library", source: "stated" } as const

    /**
     * Two steps, each recording as it goes — with the composer round the first one
     * buys, because a requirement always asks for the rest of the plan and the ask
     * stands in it as an entry. `a1` is at 3 rather than 2 for that reason.
     */
    const decided = [
      create,
      ready,
      accept(proposal(2)),
      ...filed(1, makeArtifact({ Summary: "first" }, [scope, responsive])),
      acted(1, Actions.approve()),
      ...keptStep(1),
      accept(makeProposal("the work, re-cut", [{ agent: "a1", instruction: "Do it." }]), sid2),
      acted(3, Actions.approve()),
      returned(3, makeArtifact({ Summary: "no blockers" }, [auth])),
    ]

    it("accumulates in log order, across steps, with the stage that filed each", () => {
      expect(replayHistory(id, decided).decisions).toEqual([
        { ...scope, at: "1-a0" },
        { ...responsive, at: "1-a0" },
        { ...auth, at: "3-a1" },
      ])
    })

    it("agrees with applyEvent(), the same as every other piece of derived state", () => {
      const viaStep = decided.reduce<Trak>((t, e) => applyEvent(t, e).trak, emptyTrak(id))
      expect(replayHistory(id, decided)).toEqual(viaStep)
    })

    it("takes them off an escalation too — a turn that escalates has learned something", () => {
      const sent = [
        create,
        ready,
        accept(proposal(2)),
        ...filed(1, artifact("v1")),
        acted(1, Actions.approve()),
        returned(2, makeArtifact({ Summary: "not yet" }, [scope], [{ at: "1-a0", text: "thin" }])),
      ]
      expect(replayHistory(id, sent).decisions).toEqual([{ ...scope, at: "2-a1" }])
    })

    it("survives the artifact that carried it being replaced", () => {
      // The asymmetry someone will later "fix": the superseded document leaves
      // the projection and its decisions stay in the intent, because a decision
      // is a fact about the conversation rather than a property of the file.
      const rerun = [
        create,
        ready,
        accept(proposal(1)),
        returned(1, makeArtifact({ Summary: "v1" }, [scope])),
        acted(1, Actions.chat("try again")),
        returned(1, makeArtifact({ Summary: "v2" })),
      ]
      const trak = replayHistory(id, rerun)
      expect(artifactText(trak.artifacts.get("1-a0") ?? empty)).toBe(doc("v2"))
      expect(trak.decisions).toEqual([{ ...scope, at: "1-a0" }])
    })

    it("is empty for a trak whose steps settled nothing, which is the common case", () => {
      expect(replayHistory(id, events).decisions).toEqual([])
    })
  })
})

describe("what a step that gave up may still record", () => {
  const scope = { text: "the admin view is out of scope", source: "stated" } as const

  it("takes them off a `stuck` account, which is filed nowhere and still teaches", () => {
    const wall = [
      create,
      ready,
      accept(proposal(2)),
      acted(1, Actions.approve()),
      returned(1, makeStuck("the lock", "it timed out", "the lock is held", [scope])),
    ]
    expect(replayHistory(id, wall).decisions).toEqual([{ ...scope, at: "1-a0" }])
  })

  it("does not send the plan back from a `stuck` account, only from a filed one", () => {
    // Widening what the account may say is not widening where it goes: this
    // envelope is a trak stopping in front of a person.
    const wall = replayHistory(id, [
      create,
      ready,
      accept(proposal(2)),
      acted(1, Actions.approve()),
      returned(1, makeStuck("the lock", "it timed out", "the lock is held", [scope])),
    ])
    expect(wall.reconsult).toBeUndefined()
    expect(wall.state).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "stuck" }))
  })
})

describe("a log written before the two channels merged", () => {
  const scope = { text: "the admin view is out of scope", source: "stated" } as const

  it("reads a log written under the old field name, on both envelopes", () => {
    // Nothing decodes strictly, so the key would be dropped in silence rather than
    // rejected — and every trak stored before the rename would replay with no
    // intent at all, including one that is mid-flight.
    const stored = replayHistory(id, [
      create,
      ready,
      accept(proposal(2)),
      returned(
        1,
        Schema.decodeUnknownSync(Artifact)({
          type: "artifact",
          sections: { Summary: "first" },
          decisions: [scope],
        }),
      ),
    ])
    expect(stored.decisions).toEqual([{ ...scope, at: "1-a0" }])
    // And it asked nothing, which is the route it took then and takes now: this key
    // never reached the composer, only the intent.
    expect(stored.reconsult).toBeUndefined()
  })

  it("replays a log whose work reached the composer under the old field name", () => {
    // `uncovered_work` bought a composer turn and landed on nothing else, and
    // replay has to take the route the trak actually took — folding it into the
    // intent would give a stored trak decisions it never recorded.
    const stored = replayHistory(id, [
      create,
      ready,
      accept(proposal(3)),
      acted(1, Actions.approve()),
      returned(
        1,
        Schema.decodeUnknownSync(Artifact)({
          type: "artifact",
          sections: { Summary: "done" },
          uncovered_work: ["and a mockup first"],
        }),
      ),
    ])
    expect(stored.decisions).toEqual([])
    expect(stored.reconsult).toEqual({
      why: { _tag: "Raised", step: 1, requirements: ["and a mockup first"], corrections: [] },
    })
  })
})

// ============================================================================
// Checks
// ============================================================================

/**
 * A one-step proposal.
 *
 * It declares no checks: checks belong to the agent, which `decide` cannot see —
 * so every artifact runs them, and the interesting cases are all about what
 * `ChecksPassed` and `CheckFailed` do rather than whether they arrive.
 */
const checked = (): Proposal => makeProposal("do it", [{ agent: "a0", instruction: "do it" }])

const passed = (step: number, ...ran: readonly string[]): Event => Events.checksPassed(step, ran)
const failedCheck = (step: number, name: string, output: string): Event =>
  Events.checkFailed(step, name, output)

/** Everything up to and including the artifact that triggers the checks. */
const upToArtifact = (p: Proposal): readonly Event[] => [
  create,
  ready,
  accept(p),
  acted(1, Actions.approve()),
  returned(1, artifact("v1")),
]

describe("an artifact is verified before it reaches a human", () => {
  it("parks in CheckRunning for every artifact, whatever the agent declares", () => {
    // Unconditional since checks moved onto the agent, which is policy `decide`
    // cannot read. An agent with none reaches the same state and leaves it inside
    // one command, which is the degenerate case rather than a special one.
    const trak = replayHistory(id, upToArtifact(checked()))
    expect(trak.state).toEqual(TrakState.CheckRunning({ step: 1 }))
  })

  it("commands RunChecks for the step whose artifact it is", () => {
    const before: Trak = {
      ...emptyTrak(id),
      plan: checked(),
      state: TrakState.AgentWorking({ step: 1 }),
    }
    const r = decide(before, returned(0, artifact("v1")))
    expect(r._tag).toBe("Advance")
    if (r._tag !== "Advance") return
    expect(r.next).toEqual(TrakState.CheckRunning({ step: 1 }))
    expect(r.commands).toEqual([{ _tag: "RunChecks", step: 1 }])
  })

  it("reaches the approval gate once they pass", () => {
    const trak = replayHistory(id, [...upToArtifact(checked()), passed(1, "verify")])
    expect(trak.state).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "approval" }))
  })

  it("sends the step back to fix a failure, resuming rather than restarting", () => {
    const trak = replayHistory(id, [
      ...upToArtifact(checked()),
      failedCheck(1, "verify", "2 problems"),
    ])
    expect(trak.state).toEqual(TrakState.AgentWorking({ step: 1 }))
  })

  it("carries the check's name and output into the trigger", () => {
    const before = replayHistory(id, upToArtifact(checked()))
    const r = decide(
      {
        ...before,
        slots: new Map([
          [
            1,
            { ...slotAt(before, 1), checkFailures: { count: 1, signature: "x", repeated: false } },
          ],
        ]),
      },
      failedCheck(1, "verify", "2 problems"),
    )
    expect(r._tag).toBe("Advance")
    if (r._tag !== "Advance") return
    expect(r.commands).toEqual([
      { _tag: "SpawnStep", step: 1, trigger: Triggers.checkFailure("verify", "2 problems") },
    ])
  })

  it("fails loudly if a check reports while nothing is running", () => {
    const trak: Trak = { ...emptyTrak(id), plan: checked() }
    expect(decide(trak, passed(1, "verify")).next._tag).toBe("Failed")
    expect(decide(trak, failedCheck(1, "verify", "x")).next._tag).toBe("Failed")
  })
})

describe("a step that stops fixing anything hands over to a human", () => {
  /** Fail the check `times` over, with `output` each time. Ends on a failure. */
  const failing = (times: number, output: (n: number) => string): readonly Event[] => [
    ...upToArtifact(checked()),
    ...Array.from({ length: times }, (_, n) => [
      ...(n === 0 ? [] : [returned(1, artifact(`v${n + 1}`))]),
      failedCheck(1, "verify", output(n)),
    ]).flat(),
  ]

  it("keeps retrying while the failure keeps changing", () => {
    const trak = replayHistory(
      id,
      failing(2, (n) => `${3 - n} problems`),
    )
    expect(trak.state).toEqual(TrakState.AgentWorking({ step: 1 }))
    expect(slotAt(trak, 1).checkFailures?.repeated).toBe(false)
  })

  it("parks at a checks gate the moment the same failure repeats", () => {
    const trak = replayHistory(id, [
      ...upToArtifact(checked()),
      failedCheck(1, "verify", "missing Risks section"),
      returned(1, artifact("v2")),
      failedCheck(1, "verify", "missing Risks section"),
    ])
    expect(trak.state).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "checks" }))
  })

  it("treats a re-ordered, re-spaced report as the same failure", () => {
    const trak = replayHistory(id, [
      ...upToArtifact(checked()),
      failedCheck(1, "verify", "a.ts: bad\nb.ts: worse"),
      returned(1, artifact("v2")),
      failedCheck(1, "verify", "  b.ts:   worse  \n\na.ts: bad"),
    ])
    expect(trak.state).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "checks" }))
  })

  it("gives up after the limit even when the output never repeats", () => {
    // The churn case normalization cannot see: a line number that moves every
    // run makes "the failure changed" true forever.
    const trak = replayHistory(
      id,
      failing(4, (n) => `error at line ${n}`),
    )
    expect(trak.state).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "checks" }))
  })

  it("lets a human take the artifact anyway, which enters the next step", () => {
    const p = makeProposal("do it", [
      { agent: "a0", instruction: "do it" },
      { agent: "a1", instruction: "then this" },
    ])
    const trak = replayHistory(id, [
      create,
      ready,
      accept(p),
      acted(1, Actions.approve()),
      returned(1, artifact("v1")),
      failedCheck(1, "verify", "same"),
      returned(1, artifact("v2")),
      failedCheck(1, "verify", "same"),
      acted(1, Actions.approve()),
      committed,
      effectsRan(1),
    ])
    expect(trak.state).toEqual(TrakState.ConditionRunning({ step: 2 }))
  })

  it("gives a step a fresh budget once its checks pass", () => {
    const trak = replayHistory(id, [
      ...upToArtifact(checked()),
      failedCheck(1, "verify", "one"),
      ...filed(1, artifact("v2")),
      passed(1, "verify"),
    ])
    expect(slotAt(trak, 1).checkFailures).toBeUndefined()
  })
})

// ============================================================================
// A spawn — one position, N traks
// ============================================================================

/** One child of the spawn at position 1, coming back with what it made. */
const landed = (
  child: number,
  from: TrakId,
  decisions: readonly Decided[],
  handUp?: string,
): Event =>
  Events.childLanded({
    step: 2,
    child,
    id: from,
    branch: BranchName.make(`trak/${from}`),
    sha: undefined,
    artifacts: [["0-review", makeArtifact({ Summary: `found by ${from}` })]],
    decisions,
    handUp,
  })

/** What the parent holds under `key`, as text. */
const folded = (t: Trak, key: string): string => artifactText(t.artifacts.get(key) ?? empty)

const kidA = TrakId.make("kid-0")
const kidB = TrakId.make("kid-1")

/** Two independent lenses over the same work, then a step that reconciles them. */
const withSpawn = makeProposal("do the thing", [
  { agent: "a0", instruction: "do step 0" },
  {
    type: "spawn",
    instruction: "both lenses at once",
    children: [
      { agent: "review", instruction: "security" },
      { agent: "review", instruction: "performance" },
    ],
  },
  { agent: "a2", instruction: "reconcile them" },
])

const upToSpawn: readonly Event[] = [
  create,
  ready,
  accept(withSpawn),
  acted(1, Actions.approve()),
  ...filed(1, artifact("v1")),
  acted(1, Actions.approve()),
  committed,
  effectsRan(1),
]

describe("a spawn position", () => {
  const scope = { text: "rate-limit per key, not per IP", source: "stated" } as const
  const guess = { text: "assumed the cache is warm", source: "assumed" } as const

  it("asks for children rather than a turn — a spawn is not one agent's work", () => {
    const trak = replayHistory(id, upToSpawn)
    expect(trak.state).toEqual(TrakState.Spawning({ step: 2 }))
  })

  it("parks on the ids, and names only the ones still out", () => {
    const spawned = replayHistory(id, [...upToSpawn, Events.childrenSpawned(2, [kidA, kidB])])
    expect(spawned.state).toEqual(TrakState.AwaitingChildren({ step: 2 }))
    // Through `applyEvent`, not `decide`: the list of who is still out is a fact
    // `recordFacts` writes from the very event being decided on, which is the
    // same shape `onCheckFailed` needs and for the same reason.
    const { decision } = applyEvent(spawned, landed(0, kidA, []))
    // An Await names the party that still owes an event, which is the whole of
    // what the restated invariant asks of it.
    expect(decision).toEqual(
      Decision.Await({
        next: TrakState.AwaitingChildren({ step: 2 }),
        awaiting: AwaitReason.Children({ ids: [kidB] }),
      }),
    )
  })

  it("joins once the last one is back, and no earlier", () => {
    const both = replayHistory(id, [
      ...upToSpawn,
      Events.childrenSpawned(2, [kidA, kidB]),
      landed(0, kidA, []),
      landed(1, kidB, []),
    ])
    expect(both.state).toEqual(TrakState.Joining({ step: 2 }))
  })

  it("folds the whole batch at the join, and nothing at a landing", () => {
    // The asymmetry someone will later "fix". Folding per landing would rank
    // siblings by when they finished, and they ran at the same time — so *latest
    // wins* would have nothing to rank them by.
    const spawned: readonly Event[] = [...upToSpawn, Events.childrenSpawned(2, [kidA, kidB])]
    const waiting = replayHistory(id, [
      ...spawned,
      landed(0, kidA, [scope]),
      landed(1, kidB, [guess]),
    ])
    expect(waiting.decisions).toEqual([])
    expect(waiting.artifacts.has("2.0-review/0-review")).toBe(false)

    const joined = replayHistory(id, [
      ...spawned,
      landed(0, kidA, [scope]),
      landed(1, kidB, [guess]),
      Events.childrenJoined(2, []),
    ])
    expect(joined.decisions).toEqual([
      { ...scope, at: "2.0-review" },
      { ...guess, at: "2.1-review" },
    ])
    // One directory per child, not one per position: both children are `review`,
    // and a shared name would have the second overwrite the first. Inside it, the
    // child's own key.
    expect(folded(joined, "2.0-review/0-review")).toBe(doc("found by kid-0"))
    expect(folded(joined, "2.1-review/0-review")).toBe(doc("found by kid-1"))
    // The spawn position's own work is kept before the plan moves past it, on
    // the same rule an ordinary step's approval follows — see `keepStep`.
    expect(joined.state).toEqual(TrakState.Committing({ step: 2 }))
  })

  it("reads a landing written before it carried keys under the piece's directory too", () => {
    // Such a log holds the child's last document and no key. The spawn entry is
    // the only account of the child's plan the parent has, so the document takes
    // the key that plan gives its last step — one layout for every log.
    const older = Schema.decodeUnknownSync(Event)({
      _tag: "ChildLanded",
      step: 2,
      child: 0,
      id: kidA,
      branch: "trak/kid-0",
      artifact: { sections: { Summary: "from an older log" } },
      decisions: [],
    })
    const joined = replayHistory(id, [
      ...upToSpawn,
      Events.childrenSpawned(2, [kidA, kidB]),
      older,
      landed(1, kidB, []),
      Events.childrenJoined(2, []),
    ])
    expect(folded(joined, "2.0-review/0-review")).toBe(doc("from an older log"))
    expect(joined.artifacts.has("2.0-review")).toBe(false)
  })

  it("agrees with applyEvent over `children`, like every other piece of derived state", () => {
    const history = [
      ...upToSpawn,
      Events.childrenSpawned(2, [kidA, kidB]),
      landed(0, kidA, [scope]),
      landed(1, kidB, [guess]),
      Events.childrenJoined(2, []),
    ]
    const viaStep = history.reduce<Trak>((t, e) => applyEvent(t, e).trak, emptyTrak(id))
    expect(replayHistory(id, history)).toEqual(viaStep)
  })

  it("survives a revision that starts after it — a satisfied spawn is not re-run", () => {
    // `children` joins `sessions`, `iterations`, `checkFailures` and `skipped` in
    // the list `replan` drops at the resume point. Nothing reachable today drops
    // one, for exactly the reason nothing drops a skip: a join is never behind a
    // position the trak has moved past, and a spawn that has children has already
    // been passed. It goes because it is in the slot, and the slot goes whole —
    // the day a resume point can move backwards is not the day to rediscover
    // that. What is asserted here is the reachable half.
    const revised = replayHistory(id, [
      ...upToSpawn,
      Events.childrenSpawned(2, [kidA, kidB]),
      landed(0, kidA, []),
      landed(1, kidB, []),
      Events.childrenJoined(2, []),
      returned(3, stuck("could not reconcile these")),
      acted(3, Actions.replan("pick it up with fresh eyes")),
      accept(makeProposal("re-cut", [{ agent: "unblock", instruction: "pick it up" }]), sid2),
    ])
    expect(slotAt(revised, 2).children).toHaveLength(2)
    expect(revised.plan?.steps.map(stepName).join(" ")).toBe("compose a0 spawn a2 compose unblock")
  })
})

describe("what a child hands up", () => {
  const scope = { text: "rate-limit per key, not per IP", source: "stated" } as const
  const spawned: readonly Event[] = [...upToSpawn, Events.childrenSpawned(2, [kidA, kidB])]

  it("asks the composer at the join for what a child handed up, and folds the rest first", () => {
    // A child's composer said *this is not ours*. Nothing gates it here — a person
    // stood at the child step that raised it — so the join asks the composer exactly
    // as a step's `unplanned_work` does, at the spawn position, and the commit runs
    // out into that compose rather than into `a2`.
    const joined = replayHistory(id, [
      ...spawned,
      landed(0, kidA, [scope], "the build needs a new schema before the reconcile"),
      landed(1, kidB, []),
      Events.childrenJoined(2, []),
    ])
    expect(joined.decisions).toEqual([{ ...scope, at: "2.0-review" }])
    expect(joined.reconsult).toEqual({
      why: {
        _tag: "Raised",
        step: 2,
        requirements: ["the build needs a new schema before the reconcile"],
        corrections: [],
      },
    })
    expect(joined.plan?.steps.map(stepName).join(" ")).toBe("compose a0 spawn compose a2")
    expect(joined.state).toEqual(TrakState.Committing({ step: 2 }))
    const { decision } = applyEvent(
      replayHistory(id, [
        ...spawned,
        landed(0, kidA, [], "not ours"),
        landed(1, kidB, []),
        Events.childrenJoined(2, []),
        committed,
      ]),
      effectsRan(2),
    )
    expect(decision).toEqual(
      Decision.Advance({
        next: TrakState.Composing(),
        commands: [Command.Compose({ description: "d", trigger: Triggers.reconsulted() })],
      }),
    )
  })

  it("asks nothing when no child handed anything up", () => {
    const joined = replayHistory(id, [
      ...spawned,
      landed(0, kidA, []),
      landed(1, kidB, []),
      Events.childrenJoined(2, []),
    ])
    expect(joined.reconsult).toBeUndefined()
    expect(joined.plan?.steps.map(stepName).join(" ")).toBe("compose a0 spawn a2")
  })

  it("composes rather than finishing when the spawn was the last entry", () => {
    // The case this channel exists for, and the one where the ask has no entry to
    // splice in front of: `withAsk` appends past the end instead. Without it the
    // commit runs out into `Integrating` and the hand-up dies at a trak going to
    // rest — which is exactly what happened before this existed.
    const trailing: readonly Event[] = [
      create,
      ready,
      accept(
        makeProposal("do the thing", [
          { agent: "a0", instruction: "do step 0" },
          {
            type: "spawn",
            instruction: "both lenses at once",
            children: [
              { agent: "review", instruction: "security" },
              { agent: "review", instruction: "performance" },
            ],
          },
        ]),
      ),
      acted(1, Actions.approve()),
      ...filed(1, artifact("v1")),
      acted(1, Actions.approve()),
      committed,
      effectsRan(1),
      Events.childrenSpawned(2, [kidA, kidB]),
      landed(0, kidA, [], "the build needs a new schema before the reconcile"),
      landed(1, kidB, []),
      Events.childrenJoined(2, []),
    ]
    const joined = replayHistory(id, trailing)
    expect(joined.plan?.steps.map(stepName).join(" ")).toBe("compose a0 spawn compose")
    const { decision } = applyEvent(replayHistory(id, [...trailing, committed]), effectsRan(2))
    expect(decision).toEqual(
      Decision.Advance({
        next: TrakState.Composing(),
        commands: [Command.Compose({ description: "d", trigger: Triggers.reconsulted() })],
      }),
    )
  })
})

describe("a landed child that refiles", () => {
  const scope = { text: "rate-limit per key, not per IP", source: "stated" } as const
  const guess = { text: "assumed the cache is warm", source: "assumed" } as const
  /** Kid A, sent back after it landed, came back with a second document and a decision. */
  const again = { text: "the cache is never warm on first hit", source: "assumed" } as const
  const refiled = (handUp?: string): Event =>
    Events.childRefiled({
      step: 2,
      child: 0,
      id: kidA,
      artifacts: [["2-review", makeArtifact({ Summary: "looked again" })]],
      decisions: [again],
      handUp,
    })

  it("adds what a landed child refiles to its landing while a sibling is still out, and the join folds it", () => {
    const spawned: readonly Event[] = [...upToSpawn, Events.childrenSpawned(2, [kidA, kidB])]
    const waiting = replayHistory(id, [...spawned, landed(0, kidA, [scope]), refiled()])
    // Still the landing's business: nothing enters the trak before the join, and the
    // refiling does not count as kid B coming back.
    expect(waiting.state).toEqual(TrakState.AwaitingChildren({ step: 2 }))
    expect(waiting.artifacts.has("2.0-review/2-review")).toBe(false)
    expect(waiting.decisions).toEqual([])

    const joined = replayHistory(id, [
      ...spawned,
      landed(0, kidA, [scope]),
      refiled(),
      landed(1, kidB, [guess]),
      Events.childrenJoined(2, []),
    ])
    expect(folded(joined, "2.0-review/0-review")).toBe(doc("found by kid-0"))
    expect(folded(joined, "2.0-review/2-review")).toBe(doc("looked again"))
    expect(joined.decisions).toEqual([
      { ...scope, at: "2.0-review" },
      { ...again, at: "2.0-review" },
      { ...guess, at: "2.1-review" },
    ])
  })

  /** The parent past its join: every child back, the batch folded, the spawn kept. */
  const joined: readonly Event[] = [
    ...upToSpawn,
    Events.childrenSpawned(2, [kidA, kidB]),
    landed(0, kidA, [scope]),
    landed(1, kidB, [guess]),
    Events.childrenJoined(2, []),
  ]

  it("folds what a landed child refiles straight onto the trak once the join has passed, moving nothing", () => {
    const before = replayHistory(id, joined)
    const { trak, decision } = applyEvent(before, refiled("the cache belongs to no piece"))
    expect(decision).toEqual(Decision.Settle({ next: before.state }))
    expect(folded(trak, "2.0-review/2-review")).toBe(doc("looked again"))
    expect(trak.decisions).toEqual([...before.decisions, { ...again, at: "2.0-review" }])
    // The hand-up waits for the next composer turn rather than splicing an ask: the
    // plan is untouched and nothing is owed at a boundary.
    expect(trak.handUps).toEqual(["the cache belongs to no piece"])
    expect(trak.reconsult).toBeUndefined()
    expect(trak.plan?.steps).toEqual(before.plan?.steps)
    // And the landing carries it too, so the record of what the child came back with is whole.
    expect(slotAt(trak, 2).children[0]?.landing?.artifacts.map(([k]) => k)).toEqual([
      "0-review",
      "2-review",
    ])
  })

  it("keeps a held step where it is when the hand-up reaches a parent resting on a wait", () => {
    // The order that stranded a parent: an ask spliced at `firstUnrun` stood in front
    // of the entry holding the `merged` wait, the sweep answered for the compose entry
    // it found there, and the held step never ran.
    const resting = replayHistory(id, [
      ...joined,
      committed,
      effectsRan(2),
      Events.conditionsUnmet(3, "merged", "pull request #7 is open", false),
      committed,
    ])
    expect(waitingAt(resting)).toEqual({ step: 3, name: "merged", stopped: false })
    const { trak, decision } = applyEvent(resting, refiled("the cache belongs to no piece"))
    expect(decision).toEqual(Decision.Settle({ next: resting.state }))
    expect(waitingAt(trak)).toEqual({ step: 3, name: "merged", stopped: false })
    expect(trak.plan?.steps).toEqual(resting.plan?.steps)

    const met = applyEvent(trak, Events.conditionsMet(3, ["merged"]))
    expect(met.decision).toEqual(
      Decision.Advance({
        next: TrakState.AgentWorking({ step: 3 }),
        commands: [Command.SpawnStep({ step: 3, trigger: Triggers.initial() })],
      }),
    )
    expect(met.trak.handUps).toEqual(["the cache belongs to no piece"])
  })

  it("spends the hand-ups on the composer run that lands, and not before", () => {
    // The plan runs out with two owed, the trak rests, and a re-entry is the next
    // composer turn: the list rides through the rest and clears as that run lands.
    const owed: readonly Event[] = [
      ...joined,
      refiled("the cache belongs to no piece"),
      refiled("and the CDN is nobody's"),
      committed,
      effectsRan(2),
      Events.conditionsMet(3, []),
      ...filed(3, artifact("reconciled")),
      acted(3, Actions.approve()),
      committed,
      effectsRan(3),
      committed,
      Events.reentered("does the cache matter?"),
      ready,
    ]
    const composing = replayHistory(id, owed)
    expect(composing.state).toEqual(TrakState.Composing())
    expect(composing.handUps).toEqual(["the cache belongs to no piece", "and the CDN is nobody's"])
    expect(replayHistory(id, [...owed, accept(proposal(2))]).handUps).toEqual([])
  })
})

// ============================================================================
// The run mode — how much of a trak its person stands at
// ============================================================================

describe("how much of a trak its person stands at", () => {
  /** A trak in one mode, past its worktree, plus whatever the case is about. */
  const running = (mode: RunMode, ...rest: readonly Event[]): Trak =>
    replayHistory(id, [Events.trakCreated("d", undefined, mode), ready, ...rest])

  it("is what the trak was created with, and no later event moves it", () => {
    const along = running("auto", accept(proposal(2)), ...filed(1, artifact("v1")), ...keptStep(1))
    expect(along.mode).toBe("auto")
  })

  it("is manual for a log written before anyone could say", () => {
    // The whole reason the field is optional. Nineteen traks were run before this
    // existed and every one of them stopped at every gate; a decode that guessed
    // anything else would replay them against a policy they never ran under.
    const old = Schema.decodeUnknownSync(Event)({ _tag: "TrakCreated", description: "d" })
    expect(replayHistory(id, [old]).mode).toBe("manual")
  })

  it("stops at the plan unless the person said in advance they would not read it", () => {
    expect(running("manual", accept(proposal(2))).state).toEqual(TrakState.AwaitingProposal())
    // The same press, taken for them: the plan is entered where approving it would
    // have entered it, and no `HumanActed` is invented to say a person did it.
    expect(running("auto", accept(proposal(2))).state).toEqual(
      TrakState.ConditionRunning({ step: 1 }),
    )
  })

  it("stops at a filed artifact unless they said the same about that", () => {
    const manual = running(
      "manual",
      accept(proposal(2)),
      acted(0, Actions.approve()),
      ...filed(1, artifact("v1")),
    )
    expect(manual.state).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "approval" }))
    // Straight to keeping the work, which is where approving it goes.
    expect(running("auto", accept(proposal(2)), ...filed(1, artifact("v1"))).state).toEqual(
      TrakState.Committing({ step: 1 }),
    )
  })

  it("agrees with applyEvent, like every other piece of derived state", () => {
    const history = [
      Events.trakCreated("d", undefined, "auto"),
      ready,
      accept(proposal(2)),
      ...filed(1, artifact("v1")),
    ]
    const viaStep = history.reduce<Trak>((t, e) => applyEvent(t, e).trak, emptyTrak(id))
    expect(replayHistory(id, history)).toEqual(viaStep)
  })
})

// A theme of its own, because the answer is a turn rather than a press: nothing is
// taken on anybody's behalf here — the agent is told there is nobody to take it.
describe("questions on a trak nobody is standing at", () => {
  /** The same trak, so the two themes cannot disagree about what one is. */
  const running = (mode: RunMode, ...rest: readonly Event[]): Trak =>
    replayHistory(id, [Events.trakCreated("d", undefined, mode), ready, ...rest])

  it("answers a step's questions by saying nobody is coming, and runs it again", () => {
    const asked = running("auto", accept(proposal(2)), returned(1, askPlainly("which one?")))
    expect(asked.state).toEqual(TrakState.AgentWorking({ step: 1 }))
    // The step's own session, resumed, with the one thing that is new — which is
    // that the answer is its own to make. `manual` still parks at the same output.
    expect(
      decide(running("auto", accept(proposal(2))), returned(1, askPlainly("q"))),
    ).toMatchObject({
      commands: [{ _tag: "SpawnStep", step: 1, trigger: Triggers.unanswered([{}]) }],
    })
    expect(
      running(
        "manual",
        accept(proposal(2)),
        acted(0, Actions.approve()),
        returned(1, askPlainly("q")),
      ).state,
    ).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "answers" }))
  })

  it("takes the option the step recommended on each question that marked one", () => {
    const asked = Questions.make({
      questions: [
        {
          question: "which subcommands?",
          options: [{ label: "all" }, { label: "list only", recommended: true }],
        },
        { question: "what name?", options: [{ label: "--json" }] },
      ],
    })
    expect(decide(running("auto", accept(proposal(2))), returned(1, asked))).toMatchObject({
      commands: [
        {
          _tag: "SpawnStep",
          step: 1,
          trigger: Triggers.unanswered([{ recommended: "list only" }, {}]),
        },
      ],
    })
  })

  it("stops answering for a position that has spent its turns, and asks a person", () => {
    // Told twice that nobody is coming and asking a third time, the step has not
    // been helped by being told — so the round nobody would have bought is the one
    // that parks instead. See `UNANSWERED_LIMIT`.
    const asking = (rounds: number): Trak =>
      running(
        "auto",
        accept(proposal(2)),
        ...Array.from({ length: rounds }, () => returned(1, askPlainly("which one?"))),
      )
    expect(asking(2).state).toEqual(TrakState.AgentWorking({ step: 1 }))
    expect(asking(3).state).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "answers" }))
  })

  it("answers the composer's questions too, and stops once it keeps asking", () => {
    const asking = (rounds: number): Trak =>
      running(
        "auto",
        ...Array.from({ length: rounds }, () =>
          Events.composerReturned(sid, askPlainly("own PR or not?")),
        ),
      )
    // A trak whose person is not at its gates and that stopped before it had a plan
    // is the one shape the mode cannot leave standing.
    expect(asking(1).state).toEqual(TrakState.Composing())
    expect(
      decide(running("auto"), Events.composerReturned(sid, askPlainly("own PR or not?"))),
    ).toMatchObject({
      commands: [{ _tag: "Compose", trigger: Triggers.unanswered([{}]) }],
    })
    expect(asking(3).state).toEqual(TrakState.AwaitingComposerAnswers())
    // And the budget is spent at the position the compose entry will land at, which
    // is where `landCompose` writes the run that finally proposes.
    expect(slotAt(asking(3), 0).iterations).toBe(3)
  })
})

describe("what a trak nobody is standing at still stops for", () => {
  /** The same trak, so the three themes cannot disagree about what one is. */
  const running = (mode: RunMode, ...rest: readonly Event[]): Trak =>
    replayHistory(id, [Events.trakCreated("d", undefined, mode), ready, ...rest])

  it("stops at a check that keeps failing, whatever the person said", () => {
    // The one gate the mode does not reach: taking work a script already knows is
    // wrong is a different decision from taking work nobody has read.
    const stuckOnChecks = running(
      "auto",
      accept(checked()),
      returned(1, artifact("v1")),
      failedCheck(1, "verify", "2 errors"),
      returned(1, artifact("v2")),
      failedCheck(1, "verify", "2 errors"),
    )
    expect(stuckOnChecks.state).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "checks" }))
  })

  /** Two steps, the first of which is conversational — `riffing` one theme along. */
  const talking = makeProposal("do the thing", [
    { agent: "a0", instruction: "talk it through", conversational: true },
    { agent: "a1", instruction: "do step 1" },
  ])

  it("nothing — a step ending on a conversational note is told to carry on", () => {
    // The one output that is neither work nor a question, and the conversation has
    // no other side. `manual` parks in it, as it always has.
    const manual = running("manual", accept(talking), acted(0, Actions.approve()), riffed())
    expect(manual.state).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "conversation" }))
    const auto = running("auto", accept(talking), riffed())
    expect(auto.state).toEqual(TrakState.AgentWorking({ step: 1 }))
    // And `runCommand` puts an `Unread` turn through `elicit`, whose union has no
    // prose in it — which is what makes one of these per conversation and no counter.
    expect(decide(running("auto", accept(talking)), riffed())).toMatchObject({
      commands: [{ _tag: "SpawnStep", step: 1, trigger: Triggers.unread() }],
    })
  })

  it("a step that could not do the work — there is nothing to say on its behalf", () => {
    expect(running("auto", accept(proposal(2)), returned(1, stuck("the lock"))).state).toEqual(
      TrakState.AwaitingHuman({ step: 1, kind: "stuck" }),
    )
  })

  it("everything on smart the person was already in, and the checks gate whatever", () => {
    // The mode reads what the record holds, so a step that asked a question and one
    // planned as a conversation both stop after all — the person is already in them.
    // What goes past is below; the rule itself is `attention.test.ts`.
    const asked = running(
      "smart",
      accept(proposal(2)),
      returned(1, askPlainly("q")),
      acted(1, Actions.answer(["this one"])),
      ...filed(1, artifact("v1")),
    )
    expect(asked.state).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "approval" }))
    // A conversational entry that files on its very first turn, having said nothing.
    const talked = running("smart", accept(talking), ...filed(1, artifact("v1")))
    expect(talked.state).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "approval" }))
    // And the one gate no mode reaches: a script already knows the work is wrong.
    const failing = running(
      "smart",
      accept(proposal(2)),
      returned(1, artifact("v1")),
      failedCheck(1, "verify", "2 errors"),
      returned(1, artifact("v2")),
      failedCheck(1, "verify", "2 errors"),
    )
    expect(failing.state).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "checks" }))
  })
})

// What `smart` now costs a trak where nothing goes wrong, written as events because
// what it turns on is what replay leaves behind: the rung in each position's slot, the
// turns spent there, and the reason on a compose entry.

/** A step that did the work and says what it ran into on the way. */
const reporting = (summary: string, rung: Ambiguity): StepOutput =>
  makeArtifact({ Summary: summary }, undefined, undefined, rung)

/** The plan, then every step of it filing on its first turn with nothing to report. */
const straightThrough = (mode: RunMode, count: number): readonly Event[] => {
  const events: Event[] = [Events.trakCreated("d", undefined, mode), ready, accept(proposal(count))]
  // From 1: `landCompose` writes the compose run's own entry at 0, and the steps it
  // proposed follow it.
  for (let i = 1; i <= count; i += 1) {
    events.push(...filed(i, artifact(`v${String(i)}`)), ...keptStep(i))
  }
  return [...events, committed]
}

describe("a smart trak where nothing goes wrong", () => {
  it("runs from the plan to the end with nobody asked anything", () => {
    // The whole of what the mode buys, and the change: the plan gate goes past on a
    // composer that reported nothing and asked nothing, and every step after it does
    // the same. Not one `HumanActed` in the history.
    const done = replayHistory(id, straightThrough("smart", 2))
    expect(done.state).toEqual(TrakState.Finished())
  })

  it("reads every one of them on manual, which is what the mode is buying", () => {
    expect(
      replayHistory(id, [Events.trakCreated("d", undefined, "manual"), ready, accept(proposal(2))])
        .state,
    ).toEqual(TrakState.AwaitingProposal())
  })

  it("stops at the step that says it met a fork, and not at the one before it", () => {
    const met = replayHistory(id, [
      Events.trakCreated("d", undefined, "smart"),
      ready,
      accept(proposal(2)),
      ...filed(1, artifact("v0")),
      ...keptStep(1),
      ...filed(2, reporting("v1", "some")),
    ])
    expect(met.state).toEqual(TrakState.AwaitingHuman({ step: 2, kind: "approval" }))
  })

  it("stops before anything is built where the composer says the plan was", () => {
    const unsure = replayHistory(id, [
      Events.trakCreated("d", undefined, "smart"),
      ready,
      accept(makeProposal("do the thing", proposal(2).steps, "a_lot")),
    ])
    expect(unsure.state).toEqual(TrakState.AwaitingProposal())
  })
})

/**
 * The re-cut a complaint gets: the fix, then the step that judges it.
 *
 * Nothing on the entry buys the fix its gate any more — what does is that it files in
 * one turn, raises nothing, and reports what it ran into.
 */
const recut = (key: string, agent = "a0"): Proposal =>
  makeProposal("the work, re-cut", [
    { agent, instruction: "fix it", continues: key },
    { agent: "a1", instruction: "judge the fix" },
  ])

/**
 * Built, read, and sent back by name — with the composer already asked.
 *
 * **The presses differ by mode, and that is the thing under test one layer down.** On
 * `manual` a person takes the plan gate, the build's gate and the verdict; on `smart`
 * all three go past — a complaint names a document the plan already has a step for, so
 * the review raised nothing that moves the shape of the work. A history carrying a
 * press at a gate the mode does not open is `Failed{engine}`, so this cannot be one
 * list for both.
 */
const sentBack = (
  mode: RunMode,
  verdict: StepOutput = correcting("sent back", "1-a0", "no check ran"),
): readonly Event[] => [
  Events.trakCreated("d", undefined, mode),
  ready,
  accept(proposal(2)),
  ...(mode === "manual" ? [acted(0, Actions.approve())] : []),
  ...filed(1, artifact("built it")),
  ...(mode === "manual" ? [acted(1, Actions.approve())] : []),
  ...keptStep(1),
  ...filed(2, verdict),
  ...(mode === "manual" ? [acted(2, Actions.approve())] : []),
  ...keptStep(2),
]

/** Where the trak lands when that re-cut arrives. */
const planned = (mode: RunMode, proposed: Proposal, verdict?: StepOutput): Trak =>
  replayHistory(id, [
    ...(verdict === undefined ? sentBack(mode) : sentBack(mode, verdict)),
    accept(proposed, sid2),
  ])

/**
 * One more round: the last fix is judged, sent back, and another is planned.
 *
 * No press anywhere in it. Every history built from this is `smart`, where a verdict
 * that only complains takes its own gate — and a press at a gate the mode does not open
 * is `Failed{engine}`.
 */
const again = (at: number, key: string, session: SessionId, said: string): readonly Event[] => [
  ...filed(at, correcting("sent back", key, said)),
  ...keptStep(at),
  accept(recut(key), session),
]

/** A composer session per round, since a run is told from the next one by its id. */
const composerSid = (round: number): SessionId =>
  SessionId.make(`00000000-0000-4000-8000-${String(round).padStart(12, "0")}`)

/**
 * `n` rounds of complaint-and-fix, ending the moment round `n`'s re-cut lands.
 *
 * **Every round complains about something the round before did not**, so nothing here
 * is the same fix failing twice — which is the other rule, and the one this must not
 * accidentally be testing. Round `k`'s fix lands at `3k + 1` and the step that judges
 * it at `3k + 2`, which is the review that opens round `k + 1`.
 */
const afterRounds = (n: number): readonly Event[] => {
  const events: Event[] = [...sentBack("smart"), accept(recut("1-a0"), composerSid(1))]
  for (let k = 1; k < n; k += 1) {
    events.push(
      ...filed(3 * k + 1, artifact(`fix ${String(k)}`)),
      ...keptStep(3 * k + 1),
      ...again(
        3 * k + 2,
        `${String(3 * k + 1)}-a0`,
        composerSid(k + 1),
        `something else, ${String(k + 1)}`,
      ),
    )
  }
  return events
}

describe("mintedAt — the entry whose session a step runs in", () => {
  // What `modelAt` reads: a step that continues another's conversation runs on the
  // model that conversation was minted with, so the entry that minted it is the one
  // whose model counts. `afterRounds` is the chain — round k's fix continues the fix
  // before it, so 7 continues `4-a0`, which continues `1-a0`, which started fresh.
  it("is the step itself where nothing is continued", () => {
    const fixing = planned("smart", recut("1-a0"))
    expect(mintedAt(fixing, 1)).toBe(1)
    expect(mintedAt(fixing, 5)).toBe(5)
  })

  it("is the entry named where that entry started fresh", () => {
    expect(mintedAt(planned("smart", recut("1-a0")), 4)).toBe(1)
  })

  it("walks a chain of continues back to the entry that started fresh", () => {
    const rounds = replayHistory(id, afterRounds(3))
    expect(mintedAt(rounds, 7)).toBe(1)
    expect(mintedAt(rounds, 10)).toBe(1)
  })

  it("stops at the step itself where the name resolves to nothing", () => {
    // The three ways `sessionOf` hands back nothing, and a fourth the runtime never
    // reaches: no such entry, one that has not run — a later position — and the
    // step naming itself. All four are a step that started fresh, so its own.
    expect(mintedAt(planned("smart", recut("7-nobody")), 4)).toBe(4)
    expect(mintedAt(planned("smart", recut("5-a1")), 4)).toBe(4)
    expect(mintedAt(planned("smart", recut("4-a0")), 4)).toBe(4)
  })
})

describe("a round of complaint and fix", () => {
  it("runs, and so does the re-cut that plans it — a round costs no stop at all", () => {
    // Nothing in the round is read: the verdict raised no work the plan does not
    // have, the composer reported nothing about the re-cut, and the fix files in
    // one turn.
    const fixing = planned("smart", recut("1-a0"))
    expect(fixing.state).toEqual(TrakState.ConditionRunning({ step: 4 }))
    const fixed = replayHistory(id, [
      ...sentBack("smart"),
      accept(recut("1-a0"), sid2),
      ...filed(4, artifact("fixed")),
    ])
    expect(fixed.state).toEqual(TrakState.Committing({ step: 4 }))
  })

  it("is read at every gate on manual, which is what the mode is for", () => {
    expect(planned("manual", recut("1-a0")).state).toEqual(TrakState.AwaitingProposal())
  })

  it("runs the verdict through, because a complaint is not work nobody planned", () => {
    // The document it names already has a step in the plan, so nothing about the
    // shape of the work moved — and the round answering it is the loop working.
    const rejected = replayHistory(id, [
      Events.trakCreated("d", undefined, "smart"),
      ready,
      accept(proposal(3)),
      ...filed(1, artifact("v0")),
      ...keptStep(1),
      ...filed(2, correcting("sent back", "1-a0", "no check ran")),
    ])
    expect(rejected.state).toEqual(TrakState.Committing({ step: 2 }))
  })

  it("stops where the verdict also named work the plan does not have", () => {
    // Both channels on one envelope, which `raisedBy` is the only writer of. The
    // requirements half is the one a person reads, and the split is on the field
    // rather than on which agent filed it.
    const both = replayHistory(id, [
      Events.trakCreated("d", undefined, "smart"),
      ready,
      accept(proposal(3)),
      ...filed(1, artifact("v0")),
      ...keptStep(1),
      ...filed(
        2,
        makeArtifact(
          { Summary: "sent back, and the offline case is unbuilt" },
          [
            {
              text: "the offline case still needs building",
              source: "assumed",
              kind: "unplanned_work",
            },
          ],
          [{ at: "1-a0", text: "no check ran" }],
        ),
      ),
    ])
    expect(both.state).toEqual(TrakState.AwaitingHuman({ step: 2, kind: "approval" }))
  })

  it("keeps running while each round finds something the last one did not", () => {
    expect(replayHistory(id, afterRounds(2)).state).toEqual(TrakState.ConditionRunning({ step: 7 }))
    expect(replayHistory(id, afterRounds(4)).state).toEqual(
      TrakState.ConditionRunning({ step: 13 }),
    )
  })

  it("stops the moment the same complaint comes back, however few rounds have run", () => {
    // Round two says word for word what round one said, about the fix that was
    // supposed to answer it. Nothing landed, and one repeat is the whole evidence
    // needed — the count below is for the case this cannot see.
    const twice = [
      ...sentBack("smart"),
      accept(recut("1-a0"), composerSid(1)),
      ...filed(4, artifact("fixed")),
      ...keptStep(4),
      ...again(5, "4-a0", composerSid(2), "no check ran"),
    ]
    expect(replayHistory(id, twice).state).toEqual(TrakState.AwaitingProposal())
  })

  it("compares complaints on what they said, not on how it was typed or where it went", () => {
    const rephrased = [
      ...sentBack("smart"),
      accept(recut("1-a0"), composerSid(1)),
      ...filed(4, artifact("fixed")),
      ...keptStep(4),
      ...again(5, "4-a0", composerSid(2), "  no   check\n\n  ran  "),
    ]
    expect(replayHistory(id, rephrased).state).toEqual(TrakState.AwaitingProposal())
  })

  it("stops qualifying once the trak has spent its rounds, whatever each one said", () => {
    // The backstop, for what normalizing cannot see: a reviewer that rephrases the
    // same objection every round never repeats exactly, so *the complaint changed*
    // stays true while nothing is being fixed.
    expect(replayHistory(id, afterRounds(5)).state).toEqual(TrakState.AwaitingProposal())
  })
})

// Nothing in the log corroborates one of these — running unattended writes no
// `HumanActed` — so this is the whole of the record, and it is stamped by the same
// decision that took the gate rather than reconstructed from the plan afterwards.
const said = (t: Trak): readonly (readonly [number, string])[] =>
  [...t.marks].flatMap(([at, m]) => (m._tag === "Held" ? [] : [[at, m._tag] as const]))
/** The entries a hold held until they were accepted — a person's marks, not the rule's. */
const heldAt = (t: Trak): readonly number[] =>
  [...t.marks].flatMap(([at, m]) => (m._tag === "Held" ? [at] : []))

describe("what the engine has to say for the gates it took", () => {
  it("names every gate behind it, and none of the ones ahead", () => {
    const fixing = planned("smart", recut("1-a0"))
    // The compose run, the build, the verdict that sent it back and the re-cut's own
    // plan gate: a round of complaint-and-fix stops nowhere, so every gate reached so
    // far went past on the rule's account. The fix and its review have not run, and a
    // mark is a record of a gate taken rather than a forecast of one.
    expect(said(fixing)).toEqual([
      [0, "Uneventful"],
      [1, "Uneventful"],
      [2, "Uneventful"],
      [3, "Uneventful"],
    ])
    expect(fixing.marks.get(3)).toEqual(Mark.Uneventful({ ambiguity: "none" }))
  })

  it("says nothing at all about a trak somebody read every gate of", () => {
    expect(said(planned("manual", recut("1-a0")))).toEqual([])
  })

  it("carries the rung the turn wrote, which is the one clause anybody claimed", () => {
    const done = replayHistory(id, straightThrough("smart", 2))
    expect(done.marks.get(1)).toEqual(Mark.Uneventful({ ambiguity: "none" }))
  })

  it("answers the mode where the mode is what took the gate", () => {
    const unread = replayHistory(id, [
      Events.trakCreated("d", undefined, "auto"),
      ready,
      accept(proposal(2)),
    ])
    expect(said(unread)).toEqual([[0, "Mode"]])
  })

  it("holds a plan at the gate auto would have taken, and clears the hold when the mode is set to manual", () => {
    // On `auto`, because a hold is refused on `manual` and the plan gate parks on no
    // other mode. Pressed again while standing there, the press holds what is already
    // held: it is still pending, and the gate is not the mode's.
    const auto = Events.trakCreated("d", undefined, "auto")
    const parked = [auto, ready, Events.holdChanged(true), accept(proposal(2))]
    const held = replayHistory(id, parked)
    expect([held.holding, held.state]).toEqual([true, TrakState.AwaitingProposal()])
    expect(said(held)).toEqual([])
    const atGate = replayHistory(id, [...parked, Events.holdChanged(true)])
    expect([atGate.holding, atGate.state]).toEqual([true, TrakState.AwaitingProposal()])
    // Cleared by `manual`, where it promises nothing the mode does not.
    const cleared = replayHistory(id, [
      ...parked,
      Events.holdChanged(true),
      Events.modeChanged("manual"),
    ])
    expect([cleared.holding, cleared.mode]).toEqual([false, "manual"])
    // A change of mode at a gate leaves the person standing where they were.
    expect(cleared.state).toEqual(TrakState.AwaitingProposal())
  })

  it("keeps what a gate read when the mode changes afterwards", () => {
    // The whole point of stamping: two documents went past on the mode's account, and
    // the person then set the trak to `manual`. Both still read as taken by the engine
    // — recomputed from the mode instead, both marks would vanish and the record
    // would say somebody read them.
    const later = replayHistory(id, [...straightThrough("auto", 2), Events.modeChanged("manual")])
    expect(later.mode).toBe("manual")
    expect(said(later)).toEqual([
      [0, "Mode"],
      [1, "Mode"],
      [2, "Mode"],
    ])
  })
})

// The other outcome, stamped the same way: the entry a hold was spent standing at. A
// commit on the way to the next turn and a stop look alike from the log, which is why
// the engine records it rather than leaving a surface to re-derive it.
describe("what the engine has to say for the steps a hold held", () => {
  const onAuto = [Events.trakCreated("d", undefined, "auto"), ready, accept(proposal(2))]

  it("holds the step whose gate the press was made at, and spends the hold as it is accepted", () => {
    // The request's own sentence: press Hold while standing at a gate, and only
    // accepting that step clears it. The step after it is the mode's as it would have
    // been. On `smart`, stopped by the rung the step reported, since `auto` stands at
    // no gate for a press to be made at.
    const pressed = [
      Events.trakCreated("d", undefined, "smart"),
      ready,
      accept(proposal(2)),
      ...filed(1, reporting("v1", "some")),
      Events.holdChanged(true),
    ]
    const held = replayHistory(id, pressed)
    expect([held.state._tag, held.holding, heldAt(held)]).toEqual(["AwaitingHuman", true, []])
    const kept = replayHistory(id, [...pressed, acted(1, Actions.approve())])
    expect([kept.state, kept.holding, heldAt(kept)]).toEqual([
      TrakState.Committing({ step: 1 }),
      false,
      [1],
    ])
    const past = replayHistory(id, [
      ...pressed,
      acted(1, Actions.approve()),
      ...keptStep(1),
      ...filed(2, artifact("v2")),
    ])
    expect([past.state, heldAt(past)]).toEqual([TrakState.Committing({ step: 2 }), [1]])
    // And the mode's marks are on the gates it took, never on the step the hold held.
    expect(said(past).map(([at]) => at)).toEqual([0, 2])
  })

  it("stamps nothing where a hold was taken back before the checks landed", () => {
    const let_go = replayHistory(id, [
      ...onAuto,
      Events.holdChanged(true),
      returned(1, artifact("v1")),
      Events.holdChanged(false),
      Events.checksPassed(1, []),
    ])
    expect(heldAt(let_go)).toEqual([])
    expect(said(let_go)).toEqual([
      [0, "Mode"],
      [1, "Mode"],
    ])
  })

  it("holds a plan at its gate, and lands the hold on the compose entry as it is entered", () => {
    const proposed = [
      Events.trakCreated("d", undefined, "auto"),
      ready,
      Events.holdChanged(true),
      accept(proposal(2)),
    ]
    const gated = replayHistory(id, proposed)
    expect([gated.state._tag, gated.holding, heldAt(gated)]).toEqual(["AwaitingProposal", true, []])
    const entered = replayHistory(id, [...proposed, acted(0, Actions.approve())])
    expect([entered.state, entered.holding, heldAt(entered)]).toEqual([
      TrakState.ConditionRunning({ step: 1 }),
      false,
      [0],
    ])
    expect(said(entered)).toEqual([])
  })

  it("spends the hold whatever kind of entry approving the plan enters", () => {
    // `enterStep` has three doors and the spend reads the approval, not the door: a
    // spawn and a compose entry the composer scheduled for itself accept the plan as
    // an ordinary step does.
    const held = (p: Proposal): Trak =>
      replayHistory(id, [
        Events.trakCreated("d", undefined, "auto"),
        ready,
        Events.holdChanged(true),
        accept(p),
        acted(0, Actions.approve()),
      ])
    const spawned = held(
      makeProposal("do the thing", [
        {
          type: "spawn",
          instruction: "both lenses at once",
          children: [{ agent: "review", instruction: "security" }],
        },
      ]),
    )
    expect([spawned.state, spawned.holding, heldAt(spawned)]).toEqual([
      TrakState.Spawning({ step: 1 }),
      false,
      [0],
    ])
    const rescheduled = held(
      makeProposal("do the thing", [{ type: "compose", instruction: "ask me once it lands" }]),
    )
    expect([rescheduled.state, rescheduled.holding, heldAt(rescheduled)]).toEqual([
      TrakState.Composing(),
      false,
      [0],
    ])
  })
})

// The break-out and the hold are two presses that never met before this branch, and what
// they compose is in neither's own rules: a recompose at a gate with a document on the
// table commits the step, and a commit is what spends a hold. Its own suite because that
// composition is the subject, not the hold's rule or the replan's.
describe("what a break-out does to a pending hold", () => {
  it("spends it on a recompose that keeps the step, and holds nothing on the plan that replaces it", () => {
    // The break-out at a gate with a document on the table routes through `keepStep`,
    // so it accepts the step exactly as an approval does and the hold has done its
    // job. What the person then gets back is a *different* plan, and the gate on it is
    // the mode's — a hold is one press for one step, not a standing instruction to
    // stand at whatever comes next.
    const pressed = [
      Events.trakCreated("d", undefined, "auto"),
      ready,
      accept(proposal(2)),
      Events.holdChanged(true),
      ...filed(1, artifact("v1")),
    ]
    const held = replayHistory(id, pressed)
    expect([held.state, held.holding]).toEqual([
      TrakState.AwaitingHuman({ step: 1, kind: "approval" }),
      true,
    ])
    const broke = [...pressed, acted(1, Actions.replan("pivot"))]
    const kept = replayHistory(id, broke)
    expect([kept.state, kept.holding, heldAt(kept)]).toEqual([
      TrakState.Committing({ step: 1 }),
      false,
      [1],
    ])
    // And the replacement plan runs its first step without standing, because `auto`
    // owns the gate again the moment the hold is spent.
    const replaced = replayHistory(id, [...broke, ...keptStep(1), accept(proposal(3), sid2)])
    expect([replaced.state, replaced.holding]).toEqual([
      TrakState.ConditionRunning({ step: 3 }),
      false,
    ])
  })
})

/** What `across` reads where a gate of `kind` stood on the hold and the approval spent it. */
const heldThenAccepted = (kind: HumanGate): readonly unknown[] => [
  TrakState.AwaitingHuman({ step: 1, kind }),
  true,
  [],
  TrakState.Committing({ step: 1 }),
  false,
  [1],
  [[0, "Mode"]],
]

// A gate opening on the held step is not its acceptance: every one of these stands, the
// hold is still pending at each, and the approval after them is what spends it.
describe("what does not spend a hold", () => {
  const pressed = [
    Events.trakCreated("d", undefined, "auto"),
    ready,
    accept(proposal(2)),
    Events.holdChanged(true),
  ]
  /** The hold at the gate these events reach, and again once the person approves there. */
  const across = (events: readonly Event[]): readonly unknown[] => {
    const at = replayHistory(id, [...pressed, ...events])
    const accepted = replayHistory(id, [...pressed, ...events, acted(1, Actions.approve())])
    return [
      at.state,
      at.holding,
      heldAt(at),
      accepted.state,
      accepted.holding,
      heldAt(accepted),
      said(accepted),
    ]
  }
  const answered = [returned(1, askPlainly("which one?")), acted(1, Actions.answer(["a"]))]

  it("the step's questions, nor the artifact filed after the answer", () => {
    expect(across([...answered, ...filed(1, artifact("v1"))])).toEqual(heldThenAccepted("approval"))
  })

  it("a conversational reply, nor the artifact filed after the chat", () => {
    // On `auto` the mode does not park at a conversation gate at all, so the hold is
    // the only reason anyone is standing here.
    const chatty = makeProposal("do the thing", [
      { agent: "a0", instruction: "talk it through", conversational: true },
    ])
    const talk = [
      Events.trakCreated("d", undefined, "auto"),
      ready,
      accept(chatty),
      Events.holdChanged(true),
      riffed(),
    ]
    const talking = replayHistory(id, talk)
    expect([talking.state, talking.holding]).toEqual([
      TrakState.AwaitingHuman({ step: 1, kind: "conversation" }),
      true,
    ])
    const chatted = replayHistory(id, [
      ...talk,
      acted(1, Actions.chat("go on")),
      ...filed(1, artifact("v1")),
    ])
    expect([chatted.state, chatted.holding, heldAt(chatted)]).toEqual([
      TrakState.AwaitingHuman({ step: 1, kind: "approval" }),
      true,
      [],
    ])
  })

  it("a stuck account, nor the artifact filed after the chat", () => {
    expect(
      across([
        returned(1, stuck("x")),
        acted(1, Actions.chat("try y")),
        ...filed(1, artifact("v1")),
      ]),
    ).toEqual(heldThenAccepted("approval"))
    const gaveUpAt = replayHistory(id, [...pressed, returned(1, stuck("x"))])
    expect([gaveUpAt.state, gaveUpAt.holding]).toEqual([
      TrakState.AwaitingHuman({ step: 1, kind: "stuck" }),
      true,
    ])
  })

  it("a check that keeps failing", () => {
    expect(
      across([
        returned(1, artifact("v1")),
        failedCheck(1, "verify", "missing Risks section"),
        returned(1, artifact("v2")),
        failedCheck(1, "verify", "missing Risks section"),
      ]),
    ).toEqual(heldThenAccepted("checks"))
  })

  it("a chat at the approval gate, nor the second artifact it brings", () => {
    expect(
      across([
        ...filed(1, artifact("v1")),
        acted(1, Actions.chat("narrower")),
        ...filed(1, artifact("v2")),
      ]),
    ).toEqual(heldThenAccepted("approval"))
  })
})

describe("what a hold does at a spawn", () => {
  // A spawn has no human gate on any mode, so its commit accepts nothing a person stood
  // at: the hold passes over it and holds the first entry after it that has a gate.
  const spawnRuns = [
    Events.childrenSpawned(2, [kidA]),
    landed(0, kidA, []),
    Events.childrenJoined(2, []),
  ]
  const afterSpawn = (pressed: readonly Event[]): void => {
    const joined = replayHistory(id, [...pressed, ...spawnRuns])
    expect([joined.state, joined.holding, heldAt(joined)]).toEqual([
      TrakState.Committing({ step: 2 }),
      true,
      [],
    ])
    const gated = replayHistory(id, [
      ...pressed,
      ...spawnRuns,
      ...keptStep(2),
      ...filed(3, artifact("v3")),
    ])
    expect([gated.state, gated.holding]).toEqual([
      TrakState.AwaitingHuman({ step: 3, kind: "approval" }),
      true,
    ])
    const kept = replayHistory(id, [
      ...pressed,
      ...spawnRuns,
      ...keptStep(2),
      ...filed(3, artifact("v3")),
      acted(3, Actions.approve()),
    ])
    expect([kept.holding, heldAt(kept)]).toEqual([false, [3]])
  }
  const upTo = [
    Events.trakCreated("d", undefined, "auto"),
    ready,
    accept(withSpawn),
    ...filed(1, artifact("v1")),
    Events.workCommitted(undefined, 1),
  ]

  it("passes over a spawn the hold was pressed at", () => {
    const pressed = [...upTo, effectsRan(1), Events.holdChanged(true)]
    expect(replayHistory(id, pressed).state).toEqual(TrakState.Spawning({ step: 2 }))
    afterSpawn(pressed)
  })

  it("passes over a spawn the hold was pressed before", () => {
    // Pressed at `Effecting{1}`, on the way into the spawn: the same window as a press
    // made before the spawn is on screen at all.
    const pressed = [...upTo, Events.holdChanged(true), effectsRan(1)]
    expect(replayHistory(id, pressed).state).toEqual(TrakState.Spawning({ step: 2 }))
    afterSpawn(pressed)
  })
})

describe("what a hold does at a child's ending", () => {
  // The plan running out is followed by `endsUnattended`, which reads the hold: a child
  // that would merge or archive itself holds at `Finished` for a person instead. Spent
  // there, since `Finished` is at rest.
  const born = (mode: RunMode): Event =>
    Events.trakCreated(
      "d",
      {
        parent: { id: TrakId.make("parent"), step: 1, child: 0, depth: 1 },
        plan: proposal(1),
        base: undefined,
        decisions: [],
        artifacts: [],
        split: { instruction: "one piece", pieces: [{ name: "1.0-build", instruction: "one" }] },
      },
      mode,
    )
  const ranOut = (mode: RunMode, hold: boolean, ending: Event): Trak =>
    replayHistory(id, [
      born(mode),
      ready,
      // A first-turn artifact reporting nothing goes past on `auto` and `smart` alike.
      ...filed(1, artifact("v1")),
      Events.workCommitted(undefined, 1),
      ...(hold ? [Events.holdChanged(true)] : []),
      effectsRan(1),
      ending,
    ])
  const kept = Events.workCommitted(CommitSha.make("kid0000"))
  const parked = [TrakState.Finished(), false]

  it("holds an auto child at Finished where it would have merged itself", () => {
    expect(ranOut("auto", false, kept).state).toEqual(TrakState.Merging())
    const held = ranOut("auto", true, kept)
    expect([held.state, held.holding]).toEqual(parked)
  })

  it("holds an auto child at Finished where it would have archived itself", () => {
    expect(ranOut("auto", false, committed).state).toEqual(TrakState.Closing({ merged: undefined }))
    const held = ranOut("auto", true, committed)
    expect([held.state, held.holding]).toEqual(parked)
  })

  it("holds a smart child with nothing on its branch, where it would have archived itself", () => {
    // The arm that never read the hold: `smart` ends a child that only wrote documents.
    expect(ranOut("smart", false, committed).state).toEqual(
      TrakState.Closing({ merged: undefined }),
    )
    const held = ranOut("smart", true, committed)
    expect([held.state, held.holding]).toEqual(parked)
    // With code on the branch `smart` holds anyway, and a hold changes nothing.
    expect(ranOut("smart", true, kept).state).toEqual(TrakState.Finished())
  })
})

describe("what does not spend a hold on a plan", () => {
  it("the composer's questions, nor the plan gate the answer reaches", () => {
    const asking = [
      Events.trakCreated("d", undefined, "auto"),
      ready,
      Events.holdChanged(true),
      Events.composerReturned(sid, askPlainly("own PR or not?")),
    ]
    const asked = replayHistory(id, asking)
    expect([asked.state._tag, asked.holding]).toEqual(["AwaitingComposerAnswers", true])
    const proposed = replayHistory(id, [
      ...asking,
      acted(1, Actions.answer(["own PR"])),
      accept(proposal(1)),
    ])
    expect([proposed.state._tag, proposed.holding, heldAt(proposed)]).toEqual([
      "AwaitingProposal",
      true,
      [],
    ])
    expect(said(proposed)).toEqual([])
  })

  it("a chat at the plan gate, which lands where an approved compose entry does", () => {
    const chatted = replayHistory(id, [
      Events.trakCreated("d", undefined, "auto"),
      ready,
      Events.holdChanged(true),
      accept(proposal(1)),
      acted(0, Actions.chat("narrower")),
    ])
    expect([chatted.state, chatted.holding, heldAt(chatted)]).toEqual([
      TrakState.Composing(),
      true,
      [],
    ])
  })
})

describe("what the engine has to say for the steps a hold held, on the other modes", () => {
  it("holds the step on smart too, where nothing takes its gate afterwards", () => {
    // `smart` stops a step that asked, so the approval after the questions is a
    // person's either way; the hold is still pending there, and their approval spends it.
    const one = replayHistory(id, [
      Events.trakCreated("d", undefined, "smart"),
      ready,
      accept(proposal(2)),
      Events.holdChanged(true),
      returned(1, askPlainly("which one?")),
      acted(1, Actions.answer(["a"])),
      ...filed(1, artifact("v1")),
    ])
    expect([one.holding, heldAt(one)]).toEqual([true, []])
    expect(said(one).map(([at]) => at)).toEqual([0])
  })

  it("never records a hold as pending on manual, whatever the route let through", () => {
    // The route refuses a hold on `manual`, but it reads the mode outside the log
    // permit — so the record holds the invariant itself, as the `ModeChanged` arm does.
    const onManual = replayHistory(id, [
      create,
      ready,
      accept(proposal(2)),
      Events.holdChanged(true),
    ])
    expect([onManual.mode, onManual.holding]).toEqual(["manual", false])
  })
})

/** A trak holding `proposal(2)` at `state`, for the cases about a plan entry that waits. */
const waitingAt0 = (state: TrakState, over: Partial<Trak> = {}): Trak => ({
  ...emptyTrak(id),
  plan: proposal(2),
  state,
  ...over,
})
const notYet = Events.conditionsUnmet(1, "pr-merged", "pull request #7 is open", false)
const neverWill = Events.conditionsUnmet(1, "pr-merged", "closed without merging", true)
/**
 * The log through the rest: approved, asked, not yet, and the commit that holds. The
 * landed proposal puts the compose entry at 0, so the held step is 1 here where the
 * decide-only cases below, holding a bare proposal, ask about 0.
 */
const rested: readonly Event[] = [
  create,
  ready,
  accept(proposal(2)),
  acted(0, Actions.approve()),
  notYet,
  committed,
]
/** A trak holding the wait at its first entry, however it got there. */
const held: Partial<Trak> = {
  slots: new Map([[0, { ...noSlot, waiting: { name: "pr-merged", stopped: false } }]]),
}

describe("a plan entry that waits to start", () => {
  it("asks the step's conditions before it starts, on every first entry", () => {
    // Unconditional, as the checks and the effects are: `decide` cannot read which
    // agents declare one, so every first entry passes through the ask.
    expect(decide(waitingAt0(TrakState.AwaitingProposal()), acted(0, Actions.approve()))).toEqual(
      Decision.Advance({
        next: TrakState.ConditionRunning({ step: 0 }),
        commands: [Command.AskConditions({ step: 0 })],
      }),
    )
  })

  it("runs the step when they are met, on the trigger a first entry gets", () => {
    expect(
      decide(waitingAt0(TrakState.ConditionRunning({ step: 0 })), Events.conditionsMet(0, [])),
    ).toEqual(
      Decision.Advance({
        next: TrakState.AgentWorking({ step: 0 }),
        commands: [Command.SpawnStep({ step: 0, trigger: Triggers.initial() })],
      }),
    )
  })

  it("rests through the door a plan running out takes when one is not", () => {
    // One route to `Finished`: the same commit with no step, into `Integrating`.
    expect(decide(waitingAt0(TrakState.ConditionRunning({ step: 0 })), notYet)).toEqual(
      Decision.Advance({
        next: TrakState.Integrating(),
        commands: [Command.CommitWork({ step: undefined })],
      }),
    )
  })

  it("replays the wait onto the held entry, readable at rest and nowhere else", () => {
    const trak = replayHistory(id, rested)
    expect(trak.state).toEqual(TrakState.Finished())
    expect(waitingAt(trak)).toEqual({ step: 1, name: "pr-merged", stopped: false })
    // The step never ran, so the plan is still held at it.
    expect(firstUnrun(trak)).toBe(1)
    // Between the answer and the commit the fact is on the slot and the trak is not
    // resting, which is the moment nobody draws.
    const between = replayHistory(id, rested.slice(0, -1))
    expect(waitingAt(between)).toBeUndefined()
    expect(pendingWait(between)).toEqual({ step: 1, name: "pr-merged", stopped: false })
  })

  it("holds a piece at Finished that its run mode would otherwise end", () => {
    // An `auto` child merges or archives itself when its plan runs out. A wait says
    // the plan has not run out, and an ending taken here would drop the held step.
    const piece = waitingAt0(TrakState.Integrating(), {
      ...held,
      mode: "auto",
      parent: { id: TrakId.make("parent"), step: 0, child: 0, depth: 1 },
    })
    expect(decide(piece, committed)).toEqual(Decision.Settle({ next: TrakState.Finished() }))
  })

  it("asks again from ConditionRunning on a restart", () => {
    expect(
      decide(waitingAt0(TrakState.ConditionRunning({ step: 0 })), Events.restarted(undefined)),
    ).toEqual(
      Decision.Advance({
        next: TrakState.ConditionRunning({ step: 0 }),
        commands: [Command.AskConditions({ step: 0 })],
      }),
    )
  })

  it("never asks on a resume: a chat at the step's gate goes straight to the turn", () => {
    const r = decide(
      waitingAt0(TrakState.AwaitingHuman({ step: 0, kind: "approval" })),
      acted(0, Actions.chat("say more")),
    )
    expect(r).toMatchObject({
      _tag: "Advance",
      next: TrakState.AgentWorking({ step: 0 }),
      commands: [{ _tag: "SpawnStep", step: 0 }],
    })
  })
})

describe("a trak resting on a condition", () => {
  it("enters the held step when the sweep finds the condition met", () => {
    // The one event besides `Reentered` that moves a resting trak — and into the
    // step, with no composer between.
    expect(
      decide(waitingAt0(TrakState.Finished(), held), Events.conditionsMet(0, ["pr-merged"])),
    ).toEqual(
      Decision.Advance({
        next: TrakState.AgentWorking({ step: 0 }),
        commands: [Command.SpawnStep({ step: 0, trigger: Triggers.initial() })],
      }),
    )
  })

  it("re-parks on an answer for an entry the plan is not held at, never failing", () => {
    // The sweep's answer races a person as a stop does: a press can have moved the
    // trak while the script ran, and a poll finishing late must not end a healthy
    // trak. Every state stands still or re-offers its gate.
    expect(decide(waitingAt0(TrakState.Finished(), held), Events.conditionsMet(1, []))).toEqual(
      Decision.Settle({ next: TrakState.Finished() }),
    )
    for (const state of allStates) {
      if (state._tag === "ConditionRunning" || state._tag === "Finished") continue
      const trak = waitingAt0(state, held)
      for (const late of [Events.conditionsMet(0, []), notYet, neverWill]) {
        expect({ state: state._tag, next: decide(trak, late).next }).toEqual({
          state: state._tag,
          next: state,
        })
      }
    }
  })

  it("records a condition giving up and stays exactly where it was", () => {
    const trak = replayHistory(id, [...rested, neverWill])
    expect(trak.state).toEqual(TrakState.Finished())
    expect(waitingAt(trak)).toEqual({ step: 1, name: "pr-merged", stopped: true })
    expect(trak.worktree).toBeDefined()
  })

  it("enters the held step when a person skips the wait, asking nothing on the way", () => {
    // The same route into the step a met answer takes — the first entry's trigger,
    // with no `AskConditions` between — on a wait still being asked and on one that
    // has given up alike.
    const skipped = Events.waitSkipped(0, "pr-merged")
    for (const stopped of [false, true]) {
      const resting = waitingAt0(TrakState.Finished(), {
        slots: new Map([[0, { ...noSlot, waiting: { name: "pr-merged", stopped } }]]),
      })
      expect(decide(resting, skipped)).toEqual(
        Decision.Advance({
          next: TrakState.AgentWorking({ step: 0 }),
          commands: [Command.SpawnStep({ step: 0, trigger: Triggers.initial() })],
        }),
      )
    }
  })

  it("lifts the wait, keeps what was skipped for the step, and lands the merge it learnt", () => {
    const trak = replayHistory(id, [
      ...rested,
      Events.waitSkipped(1, "pr-merged", CommitSha.make("merge01")),
    ])
    expect(trak.state).toEqual(TrakState.AgentWorking({ step: 1 }))
    expect(pendingWait(trak)).toBeUndefined()
    expect(slotAt(trak, 1).skippedWait).toBe("pr-merged")
    expect(trak.landed).toEqual({ sha: CommitSha.make("merge01") })
    // Without a commit the branch stays unlanded — a press learns nothing it did not ask.
    expect(
      replayHistory(id, [...rested, Events.waitSkipped(1, "pr-merged")]).landed,
    ).toBeUndefined()
  })

  it("re-parks a skip anywhere but at rest holding that entry, never failing", () => {
    // The press asks the forge holding nothing, and an archive or a merge can land
    // while it does — so a skip arriving elsewhere is a late press, on the sweep's
    // terms: every state stands still or re-offers its gate.
    expect(decide(waitingAt0(TrakState.Finished(), held), Events.waitSkipped(1, "x"))).toEqual(
      Decision.Settle({ next: TrakState.Finished() }),
    )
    for (const state of allStates) {
      if (state._tag === "Finished") continue
      expect({
        state: state._tag,
        next: decide(waitingAt0(state, held), Events.waitSkipped(0, "pr-merged")).next,
      }).toEqual({ state: state._tag, next: state })
    }
  })

  it("drops the wait with the entry it held when the world comes back", () => {
    // Either door re-cuts the plan from the held index, so the fact would sit on an
    // entry that is no longer the one that was waiting.
    expect(
      pendingWait(replayHistory(id, [...rested, Events.reentered("rebase it")])),
    ).toBeUndefined()
    expect(
      pendingWait(replayHistory(id, [...rested, Events.reentered("is it done?", "generic")])),
    ).toBeUndefined()
  })
})

/** The press that ends the running check at step 1, named off the run as the route does. */
const cancelled = (): Event => Events.checksCancelled(1, "verify")

// A person ending the check that is running. Its own suite because what it costs is the
// subject: no agent turn and no strike, where a failure costs both.
describe("a check a person ended", () => {
  /** A manual trak with its first step filed and its check in flight. */
  const running = [
    create,
    ready,
    accept(proposal(2)),
    acted(0, Actions.approve()),
    mayStart(1),
    returned(1, artifact("v1")),
  ]

  it("parks at the checks gate at once, offering what a failure there offers", () => {
    const t = replayHistory(id, running)
    expect(t.state).toEqual(TrakState.CheckRunning({ step: 1 }))
    const { trak, decision } = applyEvent(t, cancelled())
    expect(trak.state).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "checks" }))
    // Nothing runs on its own from here — a failure would have spawned the step again —
    // and what is offered is the failing gate's three presses.
    expect(decision._tag === "Await" ? party(decision.awaiting) : decision._tag).toEqual([
      "Approve",
      "Chat",
      "Replan",
    ])
  })

  it("counts against nothing, however many times it is pressed", () => {
    // Four rounds of ending the run, redirecting, and the step filing again: a failure
    // repeated or reaching four parks the step for good, and a cancel is not a failure.
    const rounds = Array.from({ length: 4 }, () => [
      cancelled(),
      acted(1, Actions.chat("carry on")),
      returned(1, artifact("v2")),
    ])
    const fourth = replayHistory(id, [...running, ...rounds.flat()])
    expect([fourth.state, slotAt(fourth, 1).checkFailures]).toEqual([
      TrakState.CheckRunning({ step: 1 }),
      undefined,
    ])
    const fifth = applyEvent(fourth, cancelled())
    expect([fifth.trak.state, slotAt(fifth.trak, 1).checkFailures]).toEqual([
      TrakState.AwaitingHuman({ step: 1, kind: "checks" }),
      undefined,
    ])
  })

  it("takes the work on Approve, exactly as the failing gate does", () => {
    const kept = replayHistory(id, [...running, cancelled(), acted(1, Actions.approve())])
    expect(kept.state).toEqual(TrakState.Committing({ step: 1 }))
  })

  it("is harmless where the press raced the run settling", () => {
    // The check passed a moment before the press landed: the gate it reached stands,
    // re-offered, and nothing is `Failed{engine}` for a person pressing twice.
    const settled = replayHistory(id, [...running, Events.checksPassed(1, ["verify"])])
    expect(settled.state).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "approval" }))
    const late = applyEvent(settled, cancelled())
    expect([late.trak.state, late.decision._tag]).toEqual([settled.state, "Await"])
    // And a cancel that finds the agent still writing leaves it writing.
    const early = applyEvent(replayHistory(id, running.slice(0, -1)), cancelled())
    expect([early.trak.state, early.decision._tag]).toEqual([
      TrakState.AgentWorking({ step: 1 }),
      "Settle",
    ])
  })

  it("does not re-run the check on a restart, because the cancel is its ending", () => {
    // A `Restarted` at `CheckRunning` re-issues `RunChecks`; the cancel moves the trak
    // off that state first, so picking it back up re-parks rather than re-running.
    const parked = replayHistory(id, [...running, cancelled()])
    const picked = applyEvent(parked, Events.restarted(undefined))
    expect([picked.trak.state, picked.decision._tag]).toEqual([parked.state, "Await"])
  })
})

// A person's switch keeping the next check run from happening. `holding`'s shape without
// its clamp, spent by the run that honoured it and by nothing else.
describe("a person skipping the next step's checks", () => {
  const onAuto = [Events.trakCreated("d", undefined, "auto"), ready, accept(proposal(2))]

  it("is armed by the press, taken back by the same switch, and clamped by no mode", () => {
    const armed = replayHistory(id, [create, ready, Events.skipChecksChanged(true)])
    expect([armed.mode, armed.skippingChecks]).toEqual(["manual", true])
    const taken = replayHistory(id, [
      create,
      ready,
      Events.skipChecksChanged(true),
      Events.skipChecksChanged(false),
    ])
    expect(taken.skippingChecks).toBe(false)
    // A change to `manual` clears a hold and leaves this alone: every mode runs its checks.
    const moved = replayHistory(id, [
      Events.trakCreated("d", undefined, "smart"),
      ready,
      Events.skipChecksChanged(true),
      Events.modeChanged("manual"),
    ])
    expect(moved.skippingChecks).toBe(true)
  })

  it("is spent by the run that skipped, and left by one that ran", () => {
    const pressed = [...onAuto, Events.skipChecksChanged(true), returned(1, artifact("v1"))]
    const skipped = replayHistory(id, [...pressed, Events.checksPassed(1, [], ["verify"])])
    expect(skipped.skippingChecks).toBe(false)
    // The runtime spends it only where there was something to skip: a step that declares
    // no checks writes a plain pass, and the switch waits for the first that does.
    const ran = replayHistory(id, [...pressed, Events.checksPassed(1, [])])
    expect(ran.skippingChecks).toBe(true)
  })

  it("accepts the step as a pass would — the mode's warrant stamped on it", () => {
    // The whole reason the ending stays inside `CheckRunning`: `gateTaken` stamps the
    // warrant on `ChecksPassed` there and nowhere else, so on `auto` a step nobody
    // checked and nobody read still says so.
    const accepted = replayHistory(id, [
      ...onAuto,
      Events.skipChecksChanged(true),
      returned(1, artifact("v1")),
      Events.checksPassed(1, [], ["verify"]),
    ])
    expect(accepted.state).toEqual(TrakState.Committing({ step: 1 }))
    expect(said(accepted)).toEqual([
      [0, "Mode"],
      [1, "Mode"],
    ])
  })

  it("re-offers a gate it lands at, and moves nothing anywhere else", () => {
    const atGate = replayHistory(id, [create, ready, accept(proposal(2))])
    const reoffered = applyEvent(atGate, Events.skipChecksChanged(true))
    expect([reoffered.trak.state, reoffered.decision._tag]).toEqual([atGate.state, "Await"])
    const writing = replayHistory(id, [...onAuto, Events.holdChanged(false)])
    const still = applyEvent(writing, Events.skipChecksChanged(true))
    expect([still.trak.state, still.decision._tag]).toEqual([writing.state, "Settle"])
  })
})

// A person's auto-merge switch: a setting rather than a one-shot, so nothing spends it.
describe("a person turning auto-merge on or off", () => {
  const stopped: Trak = {
    ...emptyTrak(id),
    state: TrakState.Finished(),
    autoMerge: { sentBack: 3, stopped: { _tag: "Conflict" } },
  }

  it("turns it on for a trak born without it, and off again", () => {
    const on = replayHistory(id, [create, ready, Events.autoMergeChanged(true)])
    expect(on.autoMerge).toEqual({ sentBack: 0, stopped: undefined })
    const off = replayHistory(id, [
      create,
      ready,
      Events.autoMergeChanged(true),
      Events.autoMergeChanged(false),
    ])
    expect(off.autoMerge).toBeUndefined()
  })

  it("starts a stopped one afresh — the count back to 0 and the stop cleared", () => {
    const fresh = applyEvent(stopped, Events.autoMergeChanged(true))
    expect(fresh.trak.autoMerge).toEqual({ sentBack: 0, stopped: undefined })
    expect([fresh.trak.state, fresh.decision._tag]).toEqual([stopped.state, "Settle"])
  })

  it("hands a conflict resolve's gates back to the run mode when turned off", () => {
    const resolving: Trak = {
      ...emptyTrak(id),
      mode: "smart",
      state: TrakState.Composing(),
      autoMerge: { sentBack: 1, stopped: undefined },
      resolving: true,
    }
    expect(approvedInAdvance(resolving)).toBe(true)
    const off = applyEvent(resolving, Events.autoMergeChanged(false)).trak
    expect([off.resolving, off.autoMerge, off.state]).toEqual([false, undefined, resolving.state])
    // `smart` takes no gate in advance, so the resolve's next gate is the mode's to decide.
    expect(approvedInAdvance(off)).toBe(false)
  })
})

describe("a composer that hands work off to a new trak", () => {
  const off = ["Fix the deploy hook once this is live"] as const
  const born = (mode: "manual" | "smart" | "auto"): readonly Event[] => [
    Events.trakCreated("d", undefined, mode),
    ready,
  ]

  it("stops a finish at the plan gate on manual, where a plain finish stops nowhere", () => {
    expect(
      replayHistory(id, [...born("manual"), endsHandingOff("branch is in", off)]).state,
    ).toEqual(TrakState.AwaitingProposal())
    expect(replayHistory(id, [...born("manual"), ends("branch is in", sid)]).state).toEqual(
      TrakState.Integrating(),
    )
  })

  it("stops on smart for the hand-off alone — the same finish without one goes past", () => {
    expect(
      replayHistory(id, [...born("smart"), endsHandingOff("branch is in", off)]).state,
    ).toEqual(TrakState.AwaitingProposal())
    expect(replayHistory(id, [...born("smart"), ends("branch is in", sid)]).state).toEqual(
      TrakState.Integrating(),
    )
    // And a plan carrying one stops where the same plan without it would run unread.
    const plan = { ...proposal(1), handOff: off }
    expect(replayHistory(id, [...born("smart"), accept(plan)]).state).toEqual(
      TrakState.AwaitingProposal(),
    )
    expect(replayHistory(id, [...born("smart"), accept(proposal(1))]).state).toEqual(
      TrakState.ConditionRunning({ step: 1 }),
    )
  })
})

describe("the traks a hand-off names", () => {
  const off = ["Fix the deploy hook once this is live"] as const
  const born = (mode: "manual" | "smart" | "auto"): readonly Event[] => [
    Events.trakCreated("d", undefined, mode),
    ready,
  ]
  const handedOff = Events.handedOff(0, BranchName.make("main"), [kid])

  it("are named first on auto, and then the plan is entered as it would have been", () => {
    const taken = applyEvent(
      replayHistory(id, born("auto")),
      endsHandingOff("branch is in", off),
    ).decision
    expect(taken).toEqual(
      Decision.Advance({
        next: TrakState.HandingOff({ step: 0 }),
        commands: [Command.HandOff({ step: 0 })],
      }),
    )
    // The gate went past on the mode's account, and the mark says so.
    const named = replayHistory(id, [
      ...born("auto"),
      endsHandingOff("branch is in", off),
      handedOff,
    ])
    expect([...named.marks]).toEqual([[0, Mark.Mode()]])
    expect(named.state).toEqual(TrakState.Integrating())
    expect(slotAt(named, 0).handedOff).toEqual({ base: "main", ids: [kid] })
    expect(handOffPending(named)).toBe(false)
  })

  it("names them on approval too, and a plan enters its first step once they are named", () => {
    const plan = { ...proposal(1), handOff: off }
    const approved = applyEvent(
      replayHistory(id, [...born("manual"), accept(plan)]),
      acted(0, Actions.approve()),
    ).decision
    expect(approved).toEqual(
      Decision.Advance({
        next: TrakState.HandingOff({ step: 0 }),
        commands: [Command.HandOff({ step: 0 })],
      }),
    )
    const entered = replayHistory(id, [
      ...born("manual"),
      accept(plan),
      acted(0, Actions.approve()),
      handedOff,
    ])
    expect(entered.state).toEqual(TrakState.ConditionRunning({ step: 1 }))
  })

  it("opens no second set on a restart part-way, because the ids are on the log", () => {
    const named = replayHistory(id, [
      ...born("auto"),
      endsHandingOff("branch is in", off),
      handedOff,
    ])
    // Restarted from where the naming left it: the plan's own command, never `HandOff`.
    const r = decide(named, Events.restarted(undefined))
    expect(r).toEqual(
      Decision.Advance({
        next: TrakState.Integrating(),
        commands: [Command.CommitWork({ step: undefined })],
      }),
    )
    // And restarted from inside the naming, the command is re-issued to find them.
    const naming = replayHistory(id, [...born("auto"), endsHandingOff("branch is in", off)])
    expect(decide(naming, Events.restarted(undefined))).toEqual(
      Decision.Advance({
        next: TrakState.HandingOff({ step: 0 }),
        commands: [Command.HandOff({ step: 0 })],
      }),
    )
  })

  it("fails as worktree, retryable, when git cannot name a default branch", () => {
    const naming = replayHistory(id, [...born("auto"), endsHandingOff("branch is in", off)])
    const r = decide(naming, Events.worktreeFailed("read default branch: no default branch"))
    expect(r).toEqual(
      Decision.Settle({
        next: TrakState.Failed({
          error: "read default branch: no default branch",
          kind: "worktree",
          apiKind: undefined,
        }),
      }),
    )
  })

  it("is withdrawn by a chat the composer answers without one", () => {
    // Refusing a hand-off is saying so: the composer answers again on its own session
    // and the run that lands is the answer. A plain finish after that stops nowhere.
    const withdrawn = replayHistory(id, [
      ...born("manual"),
      endsHandingOff("branch is in", off),
      acted(0, Actions.chat("no, leave the hook alone")),
      ends("branch is in, nothing else", sid),
    ])
    expect(withdrawn.state).toEqual(TrakState.Integrating())
    expect(slotAt(withdrawn, 0).handOffs).toEqual([])
    expect(handOffPending(withdrawn)).toBe(false)
  })
})

// What a person said while the trak was being driven, and nobody has read. Two events
// that move nothing, a list on the trak, and one question asked at every park.
describe("a message nobody has read", () => {
  const first = Events.messageWaiting("m1", "keep --json")
  const second = Events.messageWaiting("m2", "skip the changelog")
  /** A manual trak with its first step's turn running. */
  const midTurn = [create, ready, accept(proposal(2)), acted(0, Actions.approve()), mayStart(1)]

  it("waits without moving the trak, and stops waiting when the turn hears it", () => {
    const waiting = applyEvent(replayHistory(id, midTurn), first)
    expect([waiting.trak.state, waiting.decision._tag]).toEqual([
      TrakState.AgentWorking({ step: 1 }),
      "Settle",
    ])
    expect(waiting.trak.messages).toEqual([{ id: "m1", message: "keep --json", attachments: [] }])
    const heard = replayHistory(id, [...midTurn, first, second, Events.messageDelivered("m1")])
    expect(heard.messages).toEqual([{ id: "m2", message: "skip the changelog", attachments: [] }])
    expect(heldChat(heard)).toBeUndefined()
  })

  it("is the chat at the gate the trak parks at, oldest first and as one", () => {
    const parked = replayHistory(id, [
      ...midTurn,
      first,
      second,
      returned(1, artifact("v1")),
      Events.checksPassed(1, []),
    ])
    expect(parked.state).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "approval" }))
    const chat = heldChat(parked)
    expect(chat).toEqual(acted(1, Actions.chat("keep --json\n\nskip the changelog")))
    // And the chat takes them: nothing is first twice.
    const sent = replayHistory(id, [
      ...midTurn,
      first,
      second,
      returned(1, artifact("v1")),
      Events.checksPassed(1, []),
      acted(1, Actions.chat("keep --json\n\nskip the changelog")),
    ])
    expect([sent.messages, heldChat(sent)]).toEqual([[], undefined])
  })

  it("keeps waiting at a gate that takes answers, where a chat would end the trak", () => {
    const asking = replayHistory(id, [...midTurn, returned(1, askPlainly("which flag?")), first])
    expect(asking.state).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "answers" }))
    expect([asking.messages.length, heldChat(asking)]).toEqual([1, undefined])
    // The composer's question gate is the same answer.
    const composing = replayHistory(id, [
      create,
      ready,
      Events.composerReturned(sid, askPlainly("own PR or not?")),
      first,
    ])
    expect(composing.state._tag).toBe("AwaitingComposerAnswers")
    expect(heldChat(composing)).toBeUndefined()
  })

  it("is handed back by a stop, which sends none of it", () => {
    const stopped = replayHistory(id, [...midTurn, first, second, Events.stopped(sid, 1)])
    expect(stopped.state).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "conversation" }))
    expect([stopped.messages, stopped.returned]).toEqual([
      [],
      ["keep --json", "skip the changelog"],
    ])
    expect(heldChat(stopped)).toBeUndefined()
    // Until the person says something again, which is theirs to send or not.
    const spoke = replayHistory(id, [
      ...midTurn,
      first,
      Events.stopped(sid, 1),
      acted(1, Actions.chat("carry on")),
    ])
    expect(spoke.returned).toEqual([])
  })

  it("is handed back by a check a person ended, for the stop's reason", () => {
    const ended = replayHistory(id, [...midTurn, returned(1, artifact("v1")), first, cancelled()])
    expect(ended.state).toEqual(TrakState.AwaitingHuman({ step: 1, kind: "checks" }))
    expect([ended.messages, ended.returned, heldChat(ended)]).toEqual([
      [],
      ["keep --json"],
      undefined,
    ])
  })

  it("is handed back when the trak comes to rest with it unread", () => {
    const over = replayHistory(id, [...midTurn, first, Events.abandoned("not needed")])
    const putAway = applyEvent(over, Events.worktreeRemoved()).trak
    expect(putAway.state._tag).toBe("Abandoned")
    expect([putAway.messages, putAway.returned]).toEqual([[], ["keep --json"]])
  })
})
