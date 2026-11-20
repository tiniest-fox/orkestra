/**
 * Tier 1 (`testing-tiers`): one pure function, no React and no network.
 *
 * **The assertion that matters is the negative one**, and it is asserted over every state
 * rather than over a sample. `decide` settles an action a gate does not accept as
 * `Failed{kind:"engine"}` — so a control offered one state too wide does not get refused,
 * it ends the trak, with the engine named for something the UI drew. That is
 * `client-style`'s checklist item 5.
 */

import { describe, expect, it } from "vitest"
import type { TrakStateDto } from "@orkestra/shared/dto/trak"
import {
  archiveUnfinishedOffered,
  changesOffered,
  chatAccepted,
  chatClosed,
  archiveOffered,
  composerAwaitsAnswers,
  unfiledGate,
  destinationAsked,
  fileOffered,
  finishedPosition,
  mergeOffered,
  messageKept,
  cancelChecksOffered,
  autoMergeSettable,
  holdOffered,
  recomposeOffered,
  sendBlocked,
  modeSettable,
  planAwaitsApproval,
  restartOffered,
  skipChecksOffered,
  stopOffered,
  stopTaken,
  openersOffered,
  workAwaitsAnswers,
  workAwaitsApproval,
} from "./controls"
import { runInterrupted } from "../../format/interrupted"

/**
 * Every state on the wire, spelled out. Hand-written rather than derived from the Schema:
 * a list generated from the union would grow silently, and the point of this file is that
 * a twenty-second state has to be looked at by a person.
 *
 * **Nothing checks that this is complete, and that is the cost of the choice above.** The
 * predicates below are switches with declared return types, so a state the union grows is
 * a compile error in `controls.ts` — but a literal array one member short compiles and
 * every `EVERY_STATE.filter(…)` assertion here quietly stops covering it. `Effecting`
 * arrived that way and sat unasserted through two reviews.
 */
const EVERY_STATE: readonly TrakStateDto[] = [
  { _tag: "Preparing" },
  { _tag: "Composing" },
  { _tag: "AwaitingProposal" },
  { _tag: "AwaitingComposerAnswers" },
  { _tag: "AgentWorking", step: 1 },
  { _tag: "Stopping", step: 1 },
  { _tag: "CheckRunning", step: 1 },
  { _tag: "ConditionRunning", step: 1 },
  { _tag: "AwaitingHuman", step: 1, kind: "approval" },
  { _tag: "Spawning", step: 1 },
  { _tag: "HandingOff", step: 1 },
  { _tag: "AwaitingChildren", step: 1 },
  { _tag: "Joining", step: 1 },
  { _tag: "Committing", step: 1 },
  { _tag: "Effecting", step: 1 },
  { _tag: "Integrating" },
  { _tag: "Abandoning", reason: "changed my mind" },
  { _tag: "Finished" },
  { _tag: "Merging" },
  { _tag: "Closing" },
  { _tag: "Closed" },
  { _tag: "Merged", sha: "abc1234" },
  { _tag: "Abandoned", reason: "changed my mind" },
  { _tag: "Failed", kind: "engine", error: "nope" },
]

/** The one failure that is still a finished trak: git declined the last hop. */
const REFUSED: TrakStateDto = { _tag: "Failed", kind: "merge", error: "merge: git merge exited 2" }

describe("planAwaitsApproval", () => {
  it("offers the press at the plan gate", () => {
    expect(planAwaitsApproval({ _tag: "AwaitingProposal" })).toBe(true)
  })

  it("offers it at no other state, including the composer's other gate", () => {
    const offered = EVERY_STATE.filter((s) => planAwaitsApproval(s)).map((s) => s._tag)
    expect(offered).toEqual(["AwaitingProposal"])
  })

  /**
   * `AwaitingHuman` is the state this is most likely to be widened to by accident — it is
   * a gate, it accepts `Approve`, and it is what the *step* pane will eventually draw a
   * press for. It is a different gate with a different step index, and the wrong one sent
   * from here is an event `decide` rejects.
   */
  it("does not answer for the step gate, which is a different approval", () => {
    expect(planAwaitsApproval({ _tag: "AwaitingHuman", step: 2, kind: "approval" })).toBe(false)
  })
})

describe("workAwaitsApproval", () => {
  it("offers the press at the two gates with a document on the table", () => {
    for (const kind of ["approval", "checks"] as const) {
      expect(workAwaitsApproval({ _tag: "AwaitingHuman", step: 2, kind })).toBe(true)
    }
  })

  /**
   * The three the engine refuses, and the reason this is the assertion that matters:
   * `decide` settles an approval at any of them as `Failed{kind:"engine"}` with *nothing
   * has been filed to take*. So drawing the press there does not earn a refusal — it ends
   * the trak, at the gate where somebody was reading an account of why it could not.
   */
  it("offers it at none of the three gates where nothing has been filed", () => {
    for (const kind of ["answers", "conversation", "stuck"] as const) {
      expect(workAwaitsApproval({ _tag: "AwaitingHuman", step: 2, kind })).toBe(false)
    }
  })

  it("offers it at no other state, including the plan gate it shares a press with", () => {
    const offered = EVERY_STATE.filter((s) => workAwaitsApproval(s)).map((s) => s._tag)
    expect(offered).toEqual(["AwaitingHuman"])
  })

  /**
   * `checks` is the near-miss in the other direction, and it is asserted on its own
   * because it is the one a reader of this file would delete. An artifact is on the table
   * and a declared check disagrees with it; approving is taking it anyway, and it is a
   * `Skip` there that `decide` settles as `Failed{engine}`.
   */
  it("takes work its own check disagrees with, which is what that gate is for", () => {
    expect(workAwaitsApproval({ _tag: "AwaitingHuman", step: 2, kind: "checks" })).toBe(true)
  })
})

/**
 * The one predicate here that is not about a gate, and its negative is a different shape:
 * the press it draws does not end a trak the way an approval at the wrong gate does — the
 * route has no parked check and `decide` re-parks a gate unchanged. What it costs instead
 * is money and a lie. Drawn one state too wide, it spends a `claude` on a position that
 * was never interrupted, and it says *this stopped* on a screen where it did not.
 */
describe("runInterrupted", () => {
  it("says so wherever a command was in flight and nothing is carrying it", () => {
    const stalled = EVERY_STATE.filter((s) => runInterrupted(s, false)).map((s) => s._tag)

    expect(stalled).toEqual([
      "Preparing",
      "Composing",
      "AgentWorking",
      "Stopping",
      "CheckRunning",
      "ConditionRunning",
      "Spawning",
      "HandingOff",
      "Joining",
      "Committing",
      // **Intended, and it is the one entry here that reaches outside the checkout.**
      // The engine reached `Effecting` with `RunEffects` in flight; a process that
      // vanished mid-send left a script that may or may not have got where it was
      // going, and a person is owed the way back in. Re-running is what makes that
      // safe rather than a second send — an effect is written to be idempotent,
      // which is what `restartFrom` re-issuing it rests on.
      "Effecting",
      "Integrating",
      "Abandoning",
      "Merging",
      "Closing",
    ])
  })

  /** The other half of the pair. The same states, with somebody driving, are busy. */
  it("says so at no state at all while something holds the trak", () => {
    expect(EVERY_STATE.filter((s) => runInterrupted(s, true))).toEqual([])
  })

  /**
   * The near-miss, and the reason `commandInFlight` is a switch rather than the domain's
   * `!asGate && !atRest`. `asGate` does not count `AwaitingChildren`, so the server calls
   * a parent sitting in one interrupted — but a parent holds no drive of its own for as
   * long as it waits, and what ends the wait is a person merging or closing each child.
   * Grouping it with the rest puts a permanent Resume on every healthy parent.
   */
  it("leaves a parent waiting on its children alone, where nobody driving is the norm", () => {
    expect(runInterrupted({ _tag: "AwaitingChildren", step: 1 }, false)).toBe(false)
  })

  /**
   * The other one, asserted on its own because it is retryable and this is not the press
   * for it: the engine wrote that ending, so a failed trak stopped rather than vanished,
   * and what it is owed is a retry with the error in front of it.
   */
  it("leaves a failure alone, which stopped in a way somebody was told about", () => {
    expect(runInterrupted({ _tag: "Failed", kind: "engine", error: "nope" }, false)).toBe(false)
  })
})

describe("stopOffered", () => {
  it("offers the stop at the two positions an agent turn runs in, and nowhere else", () => {
    const offered = EVERY_STATE.filter((s) => stopOffered(s, true, true)).map((s) => s._tag)
    expect(offered).toEqual(["Composing", "AgentWorking"])
  })

  /**
   * The list the trak's own success criteria names, asserted as the negative it is. Each
   * of these is a state where something is going and none of it is a turn: `CheckRunning`
   * and `Effecting` are shell scripts, `Spawning` mints ids, `Joining`, `Committing`,
   * `Integrating`, `Merging` and `Closing` are git, and `Preparing` is `git worktree add`
   * followed by the project's setup script. Interrupting any of them would kill work with
   * no gate to leave the trak at, and a `git merge` in the host's own checkout has no
   * re-run behind it at all.
   *
   * `Effecting` is the one whose cost is not this checkout's: the script it kills is
   * half-way through acting somewhere else, and the trak would be left with no record of
   * how far it got. The stop's whole promise is a gate to say something at, and there is
   * none here.
   */
  it("offers it at nothing that is a check, a script or git", () => {
    for (const tag of [
      "Preparing",
      "CheckRunning",
      "ConditionRunning",
      "Spawning",
      "HandingOff",
      "Joining",
      "Committing",
      "Effecting",
      "Integrating",
      "Merging",
      "Closing",
      "Abandoning",
    ] as const) {
      const state = EVERY_STATE.find((s) => s._tag === tag)
      expect({ tag, offered: state !== undefined && stopOffered(state, true, true) }).toEqual({
        tag,
        offered: false,
      })
    }
  })

  /**
   * A parent holds no turn of its own while it waits — what ends the wait is a person
   * answering each child — so a stop here would interrupt nothing and park a trak that
   * was not stuck. You stop a piece on the piece.
   */
  it("offers it at no parent waiting on its children", () => {
    expect(stopOffered({ _tag: "AwaitingChildren", step: 1 }, true, true)).toBe(false)
  })

  /**
   * The plan gate's whole meaning is *a plan is on the table*, so a composer writing a
   * trak's first one has nowhere for a stop to leave it. Abandoning is the way out of
   * that, and the route refuses this too.
   */
  it("offers it to a composer only once there is a plan to wait beside", () => {
    expect(stopOffered({ _tag: "Composing" }, true, false)).toBe(false)
    expect(stopOffered({ _tag: "Composing" }, true, true)).toBe(true)
    // A step's turn does not ask: it has a plan by construction, and the question is
    // about where the trak parks rather than about what is running.
    expect(stopOffered({ _tag: "AgentWorking", step: 1 }, true, false)).toBe(true)
  })

  /**
   * Custody the other way up, and it is the only control here that reads it so. Every
   * other press is refused while something drives; this one exists *because* something
   * does — and a crashed run stays `AgentWorking` with nobody holding it, where there is
   * no turn to interrupt and `runInterrupted` is what offers the way out instead.
   */
  it("offers it at no state at all while nothing is driving the trak", () => {
    expect(EVERY_STATE.filter((s) => stopOffered(s, false, true))).toEqual([])
  })

  it("never agrees with runInterrupted, which is the same pair read the other way", () => {
    for (const state of EVERY_STATE) {
      for (const running of [true, false]) {
        expect(stopOffered(state, running, true) && runInterrupted(state, running)).toBe(false)
      }
    }
  })
})

describe("stopTaken", () => {
  /**
   * A stop answers once its intent is on the log, so the press would come back pressable
   * while the engine is still ending the turn. `Stopping` draws it taken instead — and only
   * there, and only while something drives: one nobody drives is `runInterrupted`'s.
   */
  it("draws the press taken at `Stopping` alone, and never where it is offered", () => {
    const taken = EVERY_STATE.filter((s) => stopTaken(s, true)).map((s) => s._tag)
    expect(taken).toEqual(["Stopping"])
    expect(stopTaken({ _tag: "Stopping" }, true)).toBe(true)
    expect(EVERY_STATE.filter((s) => stopTaken(s, false))).toEqual([])
    expect(EVERY_STATE.filter((s) => stopTaken(s, true) && stopOffered(s, true, true))).toEqual([])
  })
})

describe("fileOffered", () => {
  /**
   * With something driving, the only position the route takes is a step's own turn: the
   * turn is killed and the step re-entered to file. `Composing` is the near-miss —
   * `stopOffered` takes it, and this refuses it, because a composer has no document to be
   * made to file and the route answers `409 NothingToStop`.
   */
  it("offers it at a step's running turn and nowhere else while something drives", () => {
    const offered = EVERY_STATE.filter((s) => fileOffered(s, true)).map((s) => s._tag)
    expect(offered).toEqual(["AgentWorking"])
  })

  /**
   * With nothing driving, the positions the route takes are the step gates with nothing
   * filed — a conversation, a question, a stuck account. `AgentWorking` with nobody holding
   * it is a crashed run, and what that wants is the resume — the same answer `stopOffered`
   * gives, which is why the `AwaitingHuman` states are all that answer here.
   */
  it("offers it at every gate with nothing filed and nowhere else while nothing drives", () => {
    const offered = EVERY_STATE.filter((s) => fileOffered(s, false)).map((s) => s._tag)
    expect(offered).toEqual([])
    for (const kind of ["conversation", "answers", "stuck"] as const) {
      expect(fileOffered({ _tag: "AwaitingHuman", step: 2, kind }, false)).toBe(true)
    }
  })

  /**
   * The route refuses a drive already under way at the gate with `409 Driving`, so the
   * press is withheld there rather than drawn and refused — a 409 the surface provoked
   * is a UI bug caught downstream.
   */
  it("withholds it at a gate with nothing filed while something else drives", () => {
    for (const kind of ["conversation", "answers", "stuck"] as const) {
      expect(fileOffered({ _tag: "AwaitingHuman", step: 2, kind }, true)).toBe(false)
    }
  })

  /**
   * The two document gates have a document on the table, so a filing there has nothing to
   * ask for and `decide` refuses it — the same two gates `Skip` is refused at.
   */
  it("offers it at neither document gate, driven or not", () => {
    for (const kind of ["approval", "checks"] as const) {
      for (const running of [true, false]) {
        expect({
          kind,
          running,
          offered: fileOffered({ _tag: "AwaitingHuman", step: 2, kind }, running),
        }).toEqual({ kind, running, offered: false })
      }
    }
  })
})

describe("recomposeOffered", () => {
  /**
   * With nothing driving, `decide` accepts `Replan` at all five kinds and refuses it at
   * none, so this does not narrow by kind. What differs by kind is what the press does
   * first, which the sheet says, and where it is drawn — welded into a card or beside the
   * bar — which the page decides.
   */
  it("offers it at every step gate while nothing drives", () => {
    for (const kind of ["approval", "checks", "answers", "conversation", "stuck"] as const) {
      expect(recomposeOffered({ _tag: "AwaitingHuman", step: 2, kind }, false)).toBe(true)
    }
  })

  /**
   * The mid-turn press, custody the other way up: a recompose while a step's turn runs takes
   * the drive over, so it exists *because* something drives. `stopOffered` and `fileOffered`
   * read custody the same way.
   */
  it("offers it at a running step turn while something drives, and nowhere else driven", () => {
    const offered = EVERY_STATE.filter((s) => recomposeOffered(s, true)).map((s) => s._tag)
    expect(offered).toEqual(["AgentWorking"])
  })

  /**
   * A gate with something else driving withholds it: the route is `startDrive`, which
   * refuses a drive already under way, so drawing the press would earn a 409 the surface
   * provoked.
   */
  it("withholds it at a gate while something else drives", () => {
    for (const kind of ["approval", "checks", "answers", "conversation", "stuck"] as const) {
      expect(recomposeOffered({ _tag: "AwaitingHuman", step: 2, kind }, true)).toBe(false)
    }
  })

  /**
   * The composer's own two gates are the near-misses: a `Replan` at either is settled
   * `Failed{engine}`, and `AwaitingProposal` is the one a reader would widen this to by
   * accident — it is a gate, and it looks like a place to say *not that plan*.
   */
  it("offers it at no other state, including the composer's two gates", () => {
    const offered = EVERY_STATE.filter((s) => recomposeOffered(s, false)).map((s) => s._tag)
    expect(offered).toEqual(["AwaitingHuman"])
  })
})

describe("unfiledGate", () => {
  it("answers for the three gates with no document card, and no other", () => {
    for (const kind of ["conversation", "answers", "stuck"] as const) {
      expect(unfiledGate({ _tag: "AwaitingHuman", step: 2, kind })).toBe(true)
    }
    for (const kind of ["approval", "checks"] as const) {
      expect(unfiledGate({ _tag: "AwaitingHuman", step: 2, kind })).toBe(false)
    }
    expect(EVERY_STATE.filter((s) => unfiledGate(s))).toEqual([])
  })
})

describe("restartOffered", () => {
  it("offers the restart at a failure and at no other state", () => {
    const offered = EVERY_STATE.filter((s) => restartOffered(s, false)).map((s) => s._tag)
    expect(offered).toEqual(["Failed"])
  })

  /** A refused merge's way out is the finishing card's own Merge press, not a notice. */
  it("withholds it at a merge git refused, whose press is on the card", () => {
    expect(restartOffered(REFUSED, false)).toBe(false)
    expect(mergeOffered(REFUSED)).toBe(true)
  })

  /**
   * The pair, and the reason this is not a widening of `runInterrupted`: the two answer
   * about disjoint sets and neither may borrow the other's. A failure is a trak the
   * engine wrote an ending for, so its press sits on the ending; an interruption is a
   * process that vanished, so its press is chrome.
   */
  it("never agrees with runInterrupted at any state", () => {
    for (const state of EVERY_STATE) {
      expect(restartOffered(state, false) && runInterrupted(state, false)).toBe(false)
    }
  })

  /** Custody, as everywhere: a trak somebody is already driving takes no second drive. */
  it("offers it at no state at all while something holds the trak", () => {
    expect(EVERY_STATE.filter((s) => restartOffered(s, true))).toEqual([])
  })
})

describe("chatAccepted", () => {
  it("takes words at the plan gate and at every step gate, and nowhere else", () => {
    const offered = EVERY_STATE.filter((s) => chatAccepted(s)).map((s) => s._tag)
    expect(offered).toEqual(["AwaitingProposal", "AwaitingHuman"])
  })

  /**
   * The five kinds are one state, and `onHumanAction` does not branch on the kind — so
   * this is asserted rather than left to the tag, because a future guard that read the
   * kind would be a bar that shut at a gate the engine answers.
   */
  it("takes them at all five gate kinds, including the one that asked a question", () => {
    const kinds = ["approval", "checks", "stuck", "conversation", "answers"] as const
    for (const kind of kinds) {
      expect(chatAccepted({ _tag: "AwaitingHuman", step: 1, kind })).toBe(true)
    }
  })

  /**
   * The near-miss, asserted on its own because the group test above would pass with it
   * either way round the day a twenty-second state is added and someone re-sorts the list.
   * `onComposerAnswers` takes `AnswerQuestions` and nothing else; a `Chat` there is
   * `Failed{engine}`, which ends the trak.
   */
  it("refuses the composer's other gate, which looks exactly like the one it takes", () => {
    expect(chatAccepted({ _tag: "AwaitingComposerAnswers" })).toBe(false)
  })
})

describe("finishedPosition", () => {
  /**
   * Five, not three. Leaving `Merging` and `Closing` out is what would make the row appear
   * the moment a merge starts and vanish again while it runs — a position that pops for as
   * long as a `git merge` takes.
   */
  it("is drawn at the five states a plan runs out into", () => {
    const drawn = EVERY_STATE.filter((s) => finishedPosition(s) !== undefined).map((s) => s._tag)
    expect(drawn).toEqual(["Finished", "Merging", "Closing", "Closed", "Merged"])
  })

  /**
   * The two endings that are not a plan running out, and the assertion the whole predicate
   * exists for: a human ended one mid-flight and the other died, so *the plan ran out and
   * the work is on its branch* is false on both.
   */
  it("is drawn at neither an abandoned trak nor a failed one", () => {
    expect(finishedPosition({ _tag: "Abandoned", reason: "changed my mind" })).toBeUndefined()
    expect(finishedPosition({ _tag: "Failed", kind: "engine", error: "nope" })).toBeUndefined()
  })

  /**
   * The sixth: a merge git refused. The plan did run out and the work is on its branch, so
   * the card is kept and the refusal is drawn above it — where the other five failure kinds
   * stopped somewhere in the plan and keep their notice at that position.
   */
  it("is drawn at a merge git refused and an archive that did not finish, and no other failure", () => {
    expect(finishedPosition(REFUSED)).toBe(REFUSED)
    const archive: TrakStateDto = { _tag: "Failed", kind: "archive", error: "teardown failed" }
    expect(finishedPosition(archive)).toBe(archive)
    for (const kind of ["agent", "provider", "worktree", "project", "engine"] as const) {
      expect(finishedPosition({ _tag: "Failed", kind, error: "nope" })).toBeUndefined()
    }
  })
})

/**
 * The three endings. Their refusals are the route's rather than `decide`'s — `mergeRoute`
 * and `closeRoute` re-read the state and answer `409 NotFinished` — so a press drawn too
 * wide costs a sentence rather than the trak. It is still a lie about what the trak can do,
 * and these are what stop it.
 */
describe("the endings a person is offered", () => {
  it("offers the merge at the one state decide accepts it from", () => {
    expect(EVERY_STATE.filter((s) => mergeOffered(s)).map((s) => s._tag)).toEqual(["Finished"])
  })

  /** And from the failure, where the same press re-issues the merge — `mergeRoute` takes
   *  both. The archive is not: `closeRoute` takes `Finished` alone. */
  it("offers the merge again from a merge git refused, and the archive not", () => {
    expect(mergeOffered(REFUSED)).toBe(true)
    expect(archiveOffered(REFUSED)).toBe(false)
    expect(changesOffered(REFUSED)).toBe(false)
  })

  /** Restart is the only way on from an archive that did not finish, and it stays on the
   *  notice: no merge, no second archive, no more work, and no merge preview to ask. */
  it("offers nothing on the card at an archive that did not finish, and the restart on the notice", () => {
    const archive: TrakStateDto = {
      _tag: "Failed",
      kind: "archive",
      archiving: "merged",
      error: "teardown failed",
    }
    expect(restartOffered(archive, false)).toBe(true)
    expect(mergeOffered(archive)).toBe(false)
    expect(archiveOffered(archive)).toBe(false)
    expect(changesOffered(archive)).toBe(false)
    expect(destinationAsked(archive)).toBe(false)
  })

  it("offers the archive at the same one, and asks it separately", () => {
    expect(EVERY_STATE.filter((s) => archiveOffered(s)).map((s) => s._tag)).toEqual(["Finished"])
  })

  /**
   * Still narrower than the engine, and by one state rather than two: `reenterRoute` takes
   * every at-rest state and this surface offers the three that have an ending pane to draw a
   * press on. `Abandoned` is the one left, because there is nowhere to put it.
   *
   * **`Merged` returning `true` is the reversal**, and it is asserted positively for that
   * reason — the sentence this file used to carry, *once the work is in the host branch more
   * work is a new trak*, is a decision that is gone rather than narrowed.
   */
  it("sends a trak back from every ending that has a pane, merged included", () => {
    expect(EVERY_STATE.filter((s) => changesOffered(s)).map((s) => s._tag)).toEqual([
      "Finished",
      "Closed",
      "Merged",
    ])
    expect(changesOffered({ _tag: "Merged", sha: "abc1234" })).toBe(true)
    expect(changesOffered({ _tag: "Abandoned", reason: "changed my mind" })).toBe(false)
  })

  /** A merge already under way is not a merge to offer: a second press races a `git merge`. */
  it("offers nothing at all while an ending is in flight", () => {
    for (const state of [{ _tag: "Merging" }, { _tag: "Closing" }] as const) {
      expect(mergeOffered(state)).toBe(false)
      expect(archiveOffered(state)).toBe(false)
      expect(changesOffered(state)).toBe(false)
      expect(archiveUnfinishedOffered(state)).toBe(false)
    }
  })
})

/**
 * The ending the header carries, and the one press here that reaches a `claude` still
 * running. Its refusal is the route's too — `abandonRoute` answers `409 AtRest` — but the
 * assertion worth making is the *positive* one for once: the whole point of the control is
 * that there is no state a person can be looking at where a trak is going and cannot be
 * ended.
 */
describe("archiveUnfinishedOffered", () => {
  it("offers an ending at every state that is not at rest and not already ending", () => {
    expect(EVERY_STATE.filter((s) => archiveUnfinishedOffered(s)).map((s) => s._tag)).toEqual([
      "Preparing",
      "Composing",
      "AwaitingProposal",
      "AwaitingComposerAnswers",
      "AgentWorking",
      "Stopping",
      "CheckRunning",
      "ConditionRunning",
      "AwaitingHuman",
      "Spawning",
      "HandingOff",
      "AwaitingChildren",
      "Joining",
      "Committing",
      // **Intended, and the judgement worth stating**: a send is not an ending, so the
      // rule this predicate states — everything that is not at rest and not already
      // ending — covers it, and refusing it here would be a special case with nothing
      // behind it. `decide` takes `Abandoned` from every state `atRest` refuses, this
      // one included. What keeps it from cutting a script off mid-write is custody
      // rather than this list: one permit per trak serializes the drive, so the
      // declaration lands after `RunEffects` has returned rather than during it.
      "Effecting",
      "Integrating",
      "Failed",
    ])
  })

  /**
   * `decide` refuses `Abandoned` from the four at-rest states, and settles nothing — it is
   * `unexpected`, which is `Failed{kind:"engine"}`. `abandonRoute` catches it first with
   * `409 AtRest`, so the cost is a sentence; the press is still a lie about what the trak
   * can do. `Finished` has `archiveOffered` for it, with the checkout still there to see.
   */
  it("offers nothing once the trak has come to rest, including at Finished", () => {
    for (const state of [
      { _tag: "Finished" },
      { _tag: "Closed" },
      { _tag: "Merged", sha: "abc1234" },
      { _tag: "Abandoned", reason: "changed my mind" },
    ] as const) {
      expect(archiveUnfinishedOffered(state)).toBe(false)
    }
  })

  /** The state the engine would accept and this refuses: a `git merge` into the *host's*
   *  checkout is the one interruption with no re-run story. */
  it("will not take over an ending that is already running", () => {
    expect(archiveUnfinishedOffered({ _tag: "Abandoning", reason: "changed my mind" })).toBe(false)
  })

  /** Not at rest: it sits waiting for a person, and giving up is one of the two answers. */
  it("offers it on a failed trak, beside the resume rather than instead of it", () => {
    expect(archiveUnfinishedOffered({ _tag: "Failed", kind: "engine", error: "nope" })).toBe(true)
    expect(runInterrupted({ _tag: "Failed", kind: "engine", error: "nope" }, false)).toBe(false)
  })
})

/**
 * The one switch here that is deliberately *wider* than the press it resembles, and the
 * only one whose negative costs a wrong word rather than a wrong trak: it gates a `GET`.
 */
describe("destinationAsked", () => {
  it("asks wherever a merge is still going somewhere, which is one state more than offers it", () => {
    expect(EVERY_STATE.filter((s) => destinationAsked(s)).map((s) => s._tag)).toEqual([
      "Finished",
      "Merging",
    ])
  })

  /**
   * `Merging` is the whole reason this is not `mergeOffered`. A preview cached from the
   * press survives in the query cache, so gating on the press makes the destination true
   * in the tab that pressed and `…` on every reload — under a note reading *asking where
   * this would go*, on a card the position was designed to survive into.
   */
  it("keeps asking while the merge is running, where the press has already gone", () => {
    expect(destinationAsked({ _tag: "Merging" })).toBe(true)
    expect(mergeOffered({ _tag: "Merging" })).toBe(false)
  })

  /** A refused merge still has somewhere to go, and the preview's `parentId` is the name
   *  the plate's press carries. */
  it("asks at a merge git refused, and at no other failure", () => {
    expect(destinationAsked(REFUSED)).toBe(true)
    expect(destinationAsked({ _tag: "Failed", kind: "worktree", error: "nope" })).toBe(false)
  })

  /**
   * And stops at two. A merge that has happened has no *would go* to answer, `arrowEnd`
   * draws the commit instead, and a terminal trak polling about somebody else's checkout
   * asks a question nothing reads.
   */
  it("stops asking once the work is in, or once the checkout is being taken away", () => {
    for (const state of [{ _tag: "Merged", sha: "abc1234" }, { _tag: "Closing" }] as const) {
      expect(destinationAsked(state)).toBe(false)
    }
  })
})

describe("chatClosed", () => {
  const GATE: TrakStateDto = { _tag: "AwaitingHuman", step: 1, kind: "approval" }

  it("opens where the trak is being asked, with nobody driving", () => {
    expect(chatClosed(GATE, true, false)).toBeUndefined()
  })

  /**
   * The engine appends the gate while the drive still holds the trak and lets go a frame
   * later, so a gate with custody held is a turn parking. Shut there, the field is disabled
   * for that frame and a browser takes the cursor out of it; `sendBlocked` refuses the send.
   */
  it("stays open at a gate while something holds the trak, for the frame a drive lets go", () => {
    expect(chatClosed(GATE, true, true)).toBeUndefined()
    expect(chatClosed({ _tag: "AwaitingProposal" }, true, true)).toBeUndefined()
    expect(sendBlocked(GATE, true)).toBe(true)
  })

  it("stays open while a turn or a check runs, where what is sent waits for the agent", () => {
    // Custody at a state the engine keeps a message in closes nothing, on any row: the
    // subject is the running turn, and no row is a gate while one runs.
    expect(chatClosed({ _tag: "AgentWorking", step: 1 }, false, true)).toBeUndefined()
    expect(chatClosed({ _tag: "CheckRunning", step: 1 }, true, true)).toBeUndefined()
    expect(chatClosed({ _tag: "Composing" }, false, true)).toBeUndefined()
  })

  it("closes while a parent waits on its pieces and while a trak is being put away", () => {
    expect(chatClosed({ _tag: "AwaitingChildren", step: 1 }, true, true)).toBe(
      "Something is driving this trak",
    )
    expect(chatClosed({ _tag: "Abandoning", reason: "not needed" }, true, true)).toBe(
      "Something is driving this trak",
    )
  })

  /** A crashed run: nobody holds it, and the state still reads `AgentWorking`. */
  it("closes where nothing is being asked, even with nobody holding it", () => {
    expect(chatClosed({ _tag: "AgentWorking", step: 1 }, true, false)).toBe(
      "Nothing is being asked here",
    )
  })

  it("closes on a row the trak has already moved past", () => {
    // The message would land where the engine is, never at the position on screen — so
    // the bar shuts rather than sending somewhere the reader is not looking.
    expect(chatClosed(GATE, false, false)).toBe("The trak is not waiting here")
  })

  /**
   * The sentence this state used to get was *Nothing is being asked here*, on the one
   * screen with a question card directly above the bar. It is the only closing with a
   * remedy on the same surface, and it names it.
   */
  it("sends the composer's question gate to the form instead of denying the ask", () => {
    expect(chatClosed({ _tag: "AwaitingComposerAnswers" }, true, false)).toBe(
      "Answer the questions above",
    )
  })

  /** Custody still wins: the form is disabled there too, so neither is a way in. */
  it("still leads with custody at that gate, which is the closing that clears itself", () => {
    expect(chatClosed({ _tag: "AwaitingComposerAnswers" }, true, true)).toBe(
      "Something is driving this trak",
    )
  })
})

describe("messageKept", () => {
  /**
   * Every state the engine carries a trak through on its own, and none it parks, rests
   * or ends at — asserted as the whole list, so a state added to the wire has to be put
   * on one side here.
   */
  it("holds for a turn, a check and the bookkeeping between them, and nowhere else", () => {
    expect(EVERY_STATE.filter((s) => messageKept(s)).map((s) => s._tag)).toEqual([
      "Preparing",
      "Composing",
      "AgentWorking",
      "Stopping",
      "CheckRunning",
      "ConditionRunning",
      "Spawning",
      "HandingOff",
      "Joining",
      "Committing",
      "Effecting",
      "Integrating",
    ])
  })

  it("never holds where a chat is the gate's own, so a send has one meaning per state", () => {
    expect(EVERY_STATE.filter((s) => messageKept(s) && chatAccepted(s))).toEqual([])
  })
})

describe("composerAwaitsAnswers", () => {
  /**
   * The exact inverse of `chatAccepted`'s near-miss: the one state that refuses a `Chat`
   * is the one state this offers, and `onComposerAnswers` accepts nothing else.
   */
  it("offers the form at the composer's question gate and at no other state", () => {
    const offered = EVERY_STATE.filter((s) => composerAwaitsAnswers(s)).map((s) => s._tag)
    expect(offered).toEqual(["AwaitingComposerAnswers"])
  })

  /**
   * The step's answers gate is the adjacent one and takes the same action at a different
   * position — `enterStep` at the index the state holds, against `compose` on the
   * composer's own session. One predicate over both would send an answer to whichever the
   * server happened to be at.
   */
  it("does not answer for a step's questions, which are a different gate", () => {
    expect(composerAwaitsAnswers({ _tag: "AwaitingHuman", step: 2, kind: "answers" })).toBe(false)
  })
})

describe("workAwaitsAnswers", () => {
  it("offers the form at the gate where a step asked something", () => {
    expect(workAwaitsAnswers({ _tag: "AwaitingHuman", step: 2, kind: "answers" })).toBe(true)
  })

  /**
   * **The negative that matters here is not a dead trak**, which is what makes it easy to
   * widen by accident: `onHumanAction` routes `AnswerQuestions` at all five kinds with no
   * gate check, so drawing the form at the other four is accepted. What it sends is a
   * numbered list of answers to questions nobody asked — `step-answers.md` renders it
   * against a session holding none — so the failure is an agent handed nonsense rather
   * than an error anybody sees.
   */
  it("offers it at none of the four gates with no questions on the table", () => {
    for (const kind of ["approval", "checks", "conversation", "stuck"] as const) {
      expect(workAwaitsAnswers({ _tag: "AwaitingHuman", step: 2, kind })).toBe(false)
    }
  })

  it("offers it at no other state, including the composer gate it shares an action with", () => {
    const offered = EVERY_STATE.filter((s) => workAwaitsAnswers(s)).map((s) => s._tag)
    expect(offered).toEqual([])
  })
})

describe("modeSettable", () => {
  it("offers the mode and the hold wherever the trak is not at rest, Failed included", () => {
    // The engine's `atRest`, the other way up: `modeRoute` refuses exactly the four.
    expect(EVERY_STATE.filter((s) => !modeSettable(s)).map((s) => s._tag)).toEqual([
      "Finished",
      "Closed",
      "Merged",
      "Abandoned",
    ])
  })

  it("is not narrowed by custody, because the press is meant to land mid-turn", () => {
    // The signature is the assertion: there is no `running` to pass.
    expect(modeSettable({ _tag: "AgentWorking", step: 1 })).toBe(true)
  })
})

describe("autoMergeSettable", () => {
  it("offers the switch at Finished too, and refuses the five archived states", () => {
    // The engine's `archived`, the other way up: `autoMergeRoute` refuses exactly the five.
    expect(EVERY_STATE.filter((s) => !autoMergeSettable(s)).map((s) => s._tag)).toEqual([
      "Abandoning",
      "Closing",
      "Closed",
      "Merged",
      "Abandoned",
    ])
  })
})

describe("openersOffered", () => {
  it("refuses the five states at or past the archive's teardown, and offers everywhere else", () => {
    // `Merged` is refused with the archives: the merge press runs the archive, so it is
    // only reached through `Closing`, which removed the checkout. `Merging` stays
    // offered — the removal has not been issued yet. Whether a checkout exists *yet*
    // is `worktree !== undefined`, composed by the caller.
    expect(EVERY_STATE.filter((s) => !openersOffered(s)).map((s) => s._tag)).toEqual([
      "Abandoning",
      "Closing",
      "Closed",
      "Merged",
      "Abandoned",
    ])
  })
})

describe("holdOffered", () => {
  it("withholds the hold at a spawn's three states and past the last stop, and offers it everywhere else", () => {
    expect(EVERY_STATE.filter((s) => !holdOffered(s)).map((s) => s._tag)).toEqual([
      "Spawning",
      "AwaitingChildren",
      "Joining",
      "Abandoning",
      "Merging",
      "Closing",
    ])
    // `Integrating` is offered on purpose: on a child it is where the ending is decided.
    expect(holdOffered({ _tag: "Integrating" })).toBe(true)
  })
})

describe("skipChecksOffered", () => {
  it("withholds the skip only where no check run is ahead, and offers it everywhere else", () => {
    expect(EVERY_STATE.filter((s) => !skipChecksOffered(s)).map((s) => s._tag)).toEqual([
      "Integrating",
      "Abandoning",
      "Merging",
      "Closing",
    ])
    // Unlike the hold, offered while a spawn's children run: the switch arms whatever
    // `RunChecks` comes next, and after a spawn that is a later step's.
    expect(skipChecksOffered({ _tag: "AwaitingChildren", step: 1 })).toBe(true)
  })
})

describe("cancelChecksOffered", () => {
  it("offers the end of a check at the one state a check runs in, and nowhere else", () => {
    expect(EVERY_STATE.filter((s) => cancelChecksOffered(s, true)).map((s) => s._tag)).toEqual([
      "CheckRunning",
    ])
  })

  it("offers it at no state at all while nothing is driving the trak", () => {
    // Custody the other way up, for `stopOffered`'s reason: a crashed `CheckRunning`
    // has no script to end, and `runInterrupted` is what offers the way out of it.
    expect(EVERY_STATE.filter((s) => cancelChecksOffered(s, false))).toEqual([])
    expect(cancelChecksOffered({ _tag: "CheckRunning", step: 1 }, false)).toBe(false)
  })
})
