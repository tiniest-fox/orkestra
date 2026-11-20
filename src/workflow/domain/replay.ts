// Deriving Trak from its event log.
//
// `step` is the single definition of "apply one event": recordFacts its data, then
// let `decide` decide the new state. `replayHistory` and `advance` both go through it,
// so a trak's stored state and its replayed state cannot disagree.

import type { SessionId } from "../../agent/types/session.js"
import type { CommitSha } from "../../vcs/index.js"
import { type Event, isSetupEvent, type SetupEvent } from "./event.js"

/** A trak's event log. Named, because it is a domain concept, not just an array. */
export type History = readonly Event[]
import { failureSignature } from "./check-progress.js"
import { decide, type Decision } from "./decide.js"
import { type Artifact, type Document, documentOf } from "./outputs/artifact.js"
import type { Correction } from "./outputs/correction.js"
import {
  accumulated,
  type Decided,
  isUnplanned,
  recorded,
  requirementsIn,
  supersededBy,
} from "./outputs/decided.js"
import {
  artifactKey,
  childKey,
  conversationWith,
  ended,
  isCompose,
  isSpawn,
  lastChildKey,
  openingPlan,
  pieceKey,
  planOf,
  type Proposal,
  type ReconsultWhy,
  revise,
  type Step,
  withAsk,
  withoutAsk,
  withStep,
} from "./outputs/proposal.js"
import { stuckDocument } from "./outputs/stuck.js"
import type { Finished } from "./outputs/finished.js"
import { planWarrant, warrantFor } from "./attention.js"
import { editedPlan } from "./plan-edit.js"
import { parentKeyOf } from "./projection.js"
import {
  asGate,
  atRest,
  composeAt,
  emptyTrak,
  engineWait,
  firstUnrun,
  goalProposalPending,
  handOffPending,
  type Landing,
  type ReentryCause,
  planEntryOf,
  slotAt,
  Mark,
  type Slot,
  type Trak,
  type TrakId,
  type TrakState,
  type Warrant,
} from "./trak.js"

/**
 * The composer is owed a turn, and the plan says where: the ask stands in it as the
 * entry that run lands at.
 *
 * **Written when the ask is made, not when its run comes back.** The field alone left
 * the plan with nothing to show for a composer that was already working, so every
 * surface reading the plan pointed at the previous compose until the turn landed. See
 * `withAsk`.
 *
 * A plan is needed to hold one, and a trak asked before it has any is not a gap: the
 * first compose of a trak writes its own entry when it lands, carrying whatever asked.
 */
const asked = (t: Trak, why: ReconsultWhy): Trak => ({
  ...t,
  reconsult: { why },
  plan: t.plan === undefined ? undefined : withAsk(t.plan, firstUnrun(t), why),
})

/**
 * The composer is owed nothing now, and an ask nothing ran closes with it.
 *
 * **Two ways to reach it, and they discharge the debt for opposite reasons.** The plan
 * answering the ask *began* — the ordinary one, and it drops nothing: the plan that
 * answers landed, its entry holds a session, and the position that just returned is one
 * of the steps it proposed. Or a re-entry named an agent, which runs its own turn and
 * consults nobody, so there is no plan coming to answer anything. See `withoutAsk` for
 * the case the second half exists for, and `spliced` for why the second way is not
 * optional.
 */
const answered = (t: Trak): Trak => ({
  ...t,
  reconsult: undefined,
  plan: t.plan === undefined ? undefined : withoutAsk(t.plan, firstUnrun(t)),
})

/**
 * A named agent is owed a turn, and the plan says where: the entry stands at the join,
 * exactly where an ask would have.
 *
 * **`withStep` rather than an append**, and see it for why the two are the same index
 * only for the trak this exists for. A plan is not needed to hold one, unlike an ask: a
 * trak that never composed has nothing to splice into, so the entry becomes the whole
 * plan — the same one-entry shape New Trak's named-agent birth is born holding, reached
 * one rest later.
 *
 * **It goes through `answered` first, and that is not tidiness.** A trak can come to
 * rest still owing the composer a turn: the field is discharged by whatever *begins* the
 * plan that answers it, and a trak abandoned at its plan gate, or after its compose turn
 * failed, produced no such thing — nor does `landFinish`, so *more work on it* answered
 * **nothing to do** comes back to `Finished` with the debt still on it. Left standing,
 * `onWorktreeReady` reads `reconsult` before it reads the plan: the question buys a
 * composer turn on the *previous* sentence, parks at a plan gate, and `landCompose`
 * truncates this entry away as unrun tail. The person's sentence would survive nowhere
 * but the event. The plan half matters as much as the field: an ask whose turn never
 * happened still stands as a compose entry at this very index, and a turn spliced in
 * front of one is answered and then re-planned at the next boundary.
 *
 * **Dropped rather than refused**, deliberately: what a person asking a question of work
 * at rest wants is an answer, and a debt nothing discharged for a whole rest is one
 * nothing was going to. Keeping it would mean refusing the ask while one is outstanding,
 * which is a door somebody has to decide on rather than one to build quietly.
 */
const spliced = (t: Trak, agent: string, what: string): Trak => {
  const at = firstUnrun(t)
  const clear = answered(t)
  return {
    ...clear,
    plan:
      clear.plan === undefined
        ? planOf(openingPlan(agent, what))
        : withStep(clear.plan, at, conversationWith(agent, what)),
  }
}

/**
 * The position whose turn a session filed by a restart, a stop or a filing belongs to.
 * `ConditionRunning` is among them for a log written before conditions were asked,
 * which stands there where it once stood in `AgentWorking` — see `turnAt` in
 * `decide.ts`. On a log written since, no session is minted there to carry.
 */
const turnStep = (s: TrakState): number | undefined =>
  s._tag === "AgentWorking" ||
  s._tag === "CheckRunning" ||
  s._tag === "ConditionRunning" ||
  s._tag === "Stopping"
    ? s.step
    : undefined

/**
 * A session a restart, a stop or a filing carries, filed against the turn it belongs to.
 *
 * A `Failed` trak files against `failedFrom`, the position it failed at: that is the
 * turn a restart re-enters, and a session a person names there is the only repair for
 * a slot holding an id the provider never knew.
 */
const filedSession = (t: Trak, session: SessionId): Trak => {
  const at = t.state._tag === "Failed" ? t.failedFrom : t.state
  if (at === undefined) return t
  if (at._tag === "Composing" || (at._tag === "Stopping" && at.step === undefined)) {
    return { ...t, composerSession: session }
  }
  const step = turnStep(at)
  return step === undefined ? t : withSlot(t, step, { session })
}

/**
 * A trak born holding a plan arrives with the whole of what makes it not run a
 * composer: the plan is already the proposal. A spawn's child carries the rest with
 * it — an origin, and the parent's intent already in the decisions channel. A trak
 * opened with a named agent carries the plan and nothing else, which is why every
 * field but the description is defaulted here
 * rather than assumed. `mode` absent is a log written before the field existed, and
 * `manual` is what all of them ran as — so this is the one default here that is a
 * fact about the past rather than a shape being normalized.
 */
const born = (t: Trak, e: Extract<Event, { _tag: "TrakCreated" }>): Trak => ({
  ...t,
  description: e.description,
  attachments: e.attachments ?? [],
  parent: e.parent,
  mode: e.mode ?? "manual",
  plan: e.plan === undefined ? undefined : planOf(e.plan),
  planAt: e.plan === undefined ? undefined : e.at,
  base: e.base,
  handedOffFrom: e.handedOffFrom,
  goal: e.goal,
  goalBranch: e.goalBranch,
  owner: e.owner,
  autoMerge: e.autoMerge === true ? { sentBack: 0, stopped: undefined } : undefined,
  decisions: e.decisions ?? [],
  inherited: e.artifacts ?? [],
  split: e.split,
})

/**
 * The engine's re-entry of an auto-merging trak, counted — and a conflict's runs to rest
 * with nobody at its gates. A re-entry with no cause is a person's or a goal's, and
 * counts nothing.
 */
const sentBack = (t: Trak, cause: ReentryCause | undefined): Trak =>
  cause === undefined || t.autoMerge === undefined
    ? t
    : {
        ...t,
        autoMerge: { ...t.autoMerge, sentBack: t.autoMerge.sentBack + 1 },
        resolving: cause._tag === "Conflict",
      }

/** A re-entry through either door — see the `Reentered` arm of `recordFacts`. */
const reentered = (t: Trak, e: Extract<Event, { _tag: "Reentered" }>): Trak =>
  e.agent === undefined
    ? asked(sentBack(t, e.cause), {
        _tag: "Reentered",
        what: e.what,
        ...(e.cause === undefined ? {} : { cause: e.cause }),
        ...(e.base === undefined ? {} : { base: e.base }),
      })
    : spliced(t, e.agent, e.what)

/** The wait at the join lifted, ahead of whatever re-cuts the plan there. */
const unheld = (t: Trak): Trak => withSlot(t, firstUnrun(t), { waiting: undefined })

/**
 * A check's failure, counted against the ones before it. The comparison lives here
 * rather than in `decide` because this is the only point that sees the previous run
 * and the new failure at once.
 */
const recordCheckFailure = (t: Trak, e: Extract<Event, { _tag: "CheckFailed" }>): Trak => {
  const signature = failureSignature(e.name, e.output)
  const before = slotAt(t, e.step).checkFailures
  return withSlot(t, e.step, {
    checkFailures: {
      count: (before?.count ?? 0) + 1,
      signature,
      repeated: before?.signature === signature,
    },
  })
}

/**
 * The branch landed as `sha`, where an answer carried one. The first sha wins: a
 * later answer naming a different commit is the forge and a local merge disagreeing
 * about one branch, and the earlier, closer fact is the one every reader was already
 * acting on — `onRemoved` settles the same way.
 */
const landedAs = (t: Trak, sha: CommitSha | undefined): Trak =>
  sha === undefined || t.landed !== undefined ? t : { ...t, landed: { sha } }

/**
 * The wait lands on the position it holds, and lifts from it. What the script printed
 * stays on the event, on `EffectsRan`'s rule: a fact about the world — all but the
 * commit the branch landed as, which is a fact about this trak.
 */
const waited = (t: Trak, e: Extract<Event, { _tag: "ConditionsMet" | "ConditionsUnmet" }>): Trak =>
  landedAs(
    withSlot(
      t,
      e.step,
      e._tag === "ConditionsMet"
        ? { waiting: undefined }
        : { waiting: { name: e.name, stopped: e.stopped } },
    ),
    e.merged,
  )

/**
 * A person's replan, as the facts it leaves: the killed turn's session where the press
 * carried one, and the ask — standing alone, or over the ask it displaced.
 *
 * **The session lands first, so the position reads as run.** Only the off-gate press
 * carries one — the route read it before the kill, as a stop does — and `ran` is what
 * `firstUnrun` asks: with the slot empty the interrupted entry is the join, and `asked`
 * would write the ask over it, taking the entry and the model a person picked with it.
 * Written to the event's own step: the take-over read it off the running state, and a
 * race past the turn's ending stays at the same position.
 *
 * **Off a gate, the standing ask is folded in rather than written over.** A replan
 * pressed at a gate replaces whatever stands — the artifact and its complaints were on
 * screen before the person typed. The one that lands off a gate is the raced press: the
 * take-over forked it after the turn it meant to interrupt had ended, and that turn may
 * have sent the plan back — so at `CheckRunning` the step's own `Raised` is standing,
 * and its corrections live here and nowhere else. One ask still stands, and it is the
 * person's; the displaced one rides inside it. Read by the gate, never by whether
 * something stands: a person at a gate replacing a `Raised` whole is the rule, not a
 * collision.
 */
const replanned = (
  t: Trak,
  step: number,
  reason: string,
  sessionId: SessionId | undefined,
): Trak => {
  const interrupted = sessionId === undefined ? t : withSlot(t, step, { session: sessionId })
  const standing = asGate(t.state) === undefined ? t.reconsult?.why : undefined
  return asked(interrupted, {
    _tag: "Replanned",
    step,
    reason,
    ...(standing === undefined ? {} : { displaced: standing }),
  })
}

/** A person changing how the trak is run — the mode, a one-shot, auto-merge or its method — or who owns it. */
const settingChanged = (
  t: Trak,
  e: Extract<
    Event,
    {
      _tag:
        | "ModeChanged"
        | "HoldChanged"
        | "SkipChecksChanged"
        | "AutoMergeChanged"
        | "MergeMethodPicked"
        | "OwnerChanged"
    }
  >,
): Trak => {
  switch (e._tag) {
    // A hold on `manual` promises nothing the mode does not, so setting the mode
    // there takes the hold with it — the person's own rule: coming back to `smart`
    // is a fresh decision about whether they want one.
    case "ModeChanged":
      return { ...t, mode: e.mode, holding: e.mode === "manual" ? false : t.holding }

    // Never pending on `manual`, held here rather than by the route: `holdRoute`
    // reads the mode outside the log permit, so a `ModeChanged{manual}` landing in
    // the gap would otherwise leave a hold nobody can see until the mode moves back.
    case "HoldChanged":
      return { ...t, holding: t.mode !== "manual" && e.holding }

    // No clamp, unlike the hold: every mode runs its checks, so the switch means the
    // same thing on each.
    case "SkipChecksChanged":
      return { ...t, skippingChecks: e.skipping }

    // On is a fresh start: the count back to 0 and any stop cleared. Off takes the
    // resolve's claim on every gate with it, so its next gate is the run mode's.
    case "AutoMergeChanged":
      return e.on
        ? { ...t, autoMerge: { sentBack: 0, stopped: undefined } }
        : { ...t, autoMerge: undefined, resolving: false }

    case "MergeMethodPicked":
      return { ...t, mergeMethod: e.method }

    case "OwnerChanged":
      return { ...t, owner: e.to }
  }
}

/**
 * Where setup stands — `recordFacts` for the three setup events. The turn a failure killed has its session filed as `TurnFailed`'s
 * is, so a retry resumes that conversation.
 */
const setupRecorded = (t: Trak, e: SetupEvent): Trak => {
  if (e._tag === "SetupStarted") return { ...t, setup: "running" }
  if (e._tag === "SetupPassed") return { ...t, setup: "passed" }
  const failed: Trak = { ...t, setup: "failed" }
  if (e.sessionId === undefined) return failed
  return e.step === undefined
    ? { ...failed, composerSession: e.sessionId }
    : withSlot(failed, e.step, { session: e.sessionId })
}

/**
 * The events that end a turn something cut off, each carrying the session it was talking
 * to — the one fact the log genuinely could not have had until now. Filed against the
 * state the trak was in when it was: `AgentWorking`/`CheckRunning` share the session in
 * that position's slot, `Composing` keeps its own on the trak, and anything else means no
 * session was ever minted for that turn.
 *
 * All carry it, from the same record, and for a stop — `StopRequested`, or `Stopped` on a
 * log from before it — it is what the whole interruption is for: the message a person
 * types at the gate it opens resumes that conversation rather than starting over.
 * `FilingAsked` needs it for the turn it re-enters at once — the step files what *that*
 * conversation worked out. The difference is *when* the record is read — a restart reads
 * it inside the drive, the others before the kill that clears it — and by here that
 * difference is spent.
 */
const carriesSession = (
  e: Event,
): e is Extract<
  Event,
  { readonly _tag: "Restarted" | "StopRequested" | "Stopped" | "FilingAsked" }
> =>
  e._tag === "Restarted" ||
  e._tag === "StopRequested" ||
  e._tag === "Stopped" ||
  e._tag === "FilingAsked"

/** Absorb the event's *data* into the trak. Says nothing about state. */
const recordFacts = (t: Trak, e: Exclude<Event, SetupEvent>): Trak => {
  if (carriesSession(e)) return e.sessionId === undefined ? t : filedSession(t, e.sessionId)
  switch (e._tag) {
    case "TrakCreated":
      return born(t, e)

    case "ComposerReturned": {
      // The run that lands has read what was handed up since the last one — see
      // `Trak.handUps` for the run prompted before it arrived.
      const withSession = { ...t, composerSession: e.sessionId, handUps: [] }
      // A composer run that asked instead of proposing was an attempt at the
      // position its entry will land at, and it is counted there — the same fact
      // `onAgentReturned` records for a step that asked, at the position it ran at.
      // `firstUnrun` is that position: `landCompose` writes this run's session at
      // the very index the ask stands at, and nothing runs between two rounds of one
      // question, so the count is per run rather than per trak.
      //
      // Two things read it: `unanswered` in `attention.ts`, which is the only thing
      // that can spend a turn on the strength of it, and the gate on the plan this run
      // is about to write — a composer that had to ask is one the person was in.
      if (e.output.type === "proposal") {
        return landCompose(withSession, t, e.sessionId, e.output, e.at)
      }
      // **The answer that says the work is done lands too**, and it has to: it is a run
      // of the entry that asked for it rather than a way around one. Counted as an
      // attempt instead would leave the entry with no session — reading as a turn that
      // never happened, and standing in `firstUnrun`'s way at the one moment the plan
      // has to be able to run out.
      if (e.output.type === "finished") return landFinish(withSession, t, e.sessionId, e.output)
      return bumpIteration(withSession, firstUnrun(t))
    }

    case "AgentReturned":
      return onAgentReturned(t, e)

    case "ChecksPassed": {
      // Something changed, so the budget is fresh: a step whose checks fail
      // again later is failing about something new, and should get the same
      // chances to fix it as it got the first time. The skip is spent by the run that
      // honoured it and by nothing else — the event says whether this one did.
      const fresh = withSlot(t, e.step, { checkFailures: undefined })
      return e.skipped === undefined ? fresh : { ...fresh, skippingChecks: false }
    }

    case "CheckFailed":
      return recordCheckFailure(t, e)

    // The three actions that leave a fact behind. Everything else a human does is
    // read out of the log when someone asks.
    //
    // A skip has to be on the trak because the step it names never runs and so
    // never writes anything of its own that a later prompt could notice the
    // absence of. A replan has to be because it is what the composer is answering,
    // and by the time it is asked this event is two behind.
    //
    // Recorded before `decide` has ruled on it, like every other fact here. Either
    // at a gate that does not offer it settles `Failed{engine}`, and the entry
    // rides along on a trak that has stopped.
    //
    // An approval carrying edits is the third, and only at the plan gate: the plan it
    // enters is the proposal with the person's edits laid over it, so they land before
    // `decide` reads which entry comes first. The tail starts at `firstUnrun` — the
    // entry after the compose run that proposed it.
    case "HumanActed": {
      const action = e.action
      if (action._tag === "Skip") {
        return withSlot(t, e.step, { skipped: true, skipNote: action.message })
      }
      if (action._tag === "Approve") {
        return action.edits === undefined ||
          t.plan === undefined ||
          t.state._tag !== "AwaitingProposal"
          ? t
          : { ...t, plan: editedPlan(t.plan, firstUnrun(t), action.edits) }
      }
      return action._tag === "Replan" ? replanned(t, e.step, action.reason, e.sessionId) : t
    }

    case "WorktreeReady":
      return { ...t, worktree: e.worktree }

    // The door closes here as well as at `AgentReturned`, and this is the half
    // that is easy to miss: a spawn position produces no `AgentReturned` at all,
    // so a plan that opens on one would leave the field set and re-splice at the
    // next commit boundary — forever, because each splice drops `children` and
    // spawns again.
    case "ChildrenSpawned":
      return recordSpawned(answered(t), e.step, e.ids)

    // The ids beside the descriptions they were opened for, at the compose entry
    // that handed them off — none on a goal's trak, whose hand-off went to its goal.
    // Once here, `handOffPending` reads no for good.
    case "HandedOff":
      return withSlot(t, e.step, { handedOff: { base: e.base, ids: e.ids ?? [] } })

    // Once here, `goalOwed` reads no for this entry for good.
    case "GoalOpened":
      return withSlot(t, e.step, { goalOpened: e.goal })

    // Facts only: neither `decisions` nor `artifacts` moves here. See
    // `ChildrenJoined`, which is the one moment the batch enters both.
    case "ChildLanded":
      return recordLanding(t, e)

    case "ChildRefiled":
      return recordRefiled(t, e)

    case "ChildrenJoined":
      return joinChildren(t, e.step)

    // A merge made here under a `merged` or `deployed` wait is that wait passing, so
    // the sha lands as a forge's would; under none it rides `Closing` — see `Trak.landed`.
    case "WorkMerged":
      return engineWait(t) === undefined ? t : landedAs(t, e.sha)

    case "ConditionsMet":
    case "ConditionsUnmet":
      return waited(t, e)

    // The wait lifts as a met answer lifts it — the step is about to run — and what
    // it was waiting on stays on the slot for the step's prompt. The commit the
    // re-asked `merged` found lands as any answer's does.
    case "WaitSkipped":
      return landedAs(withSlot(t, e.step, { waiting: undefined, skippedWait: e.name }), e.merged)

    // **Nothing to record, and that is the rule rather than a gap.** What an effect
    // printed is a fact about a world nothing here owns, so putting it on the trak
    // would invite `decide` to route on it — see `EffectsRan`. It stays where it
    // landed, on the event, for a surface to render with the time it ran.
    case "EffectsRan":

    // Nothing to record either: what the script said is on the event, and where the
    // trak stopped is the state `decide` returns for it — `CheckFailed`'s bookkeeping
    // has no twin here, because an effect failing never re-enters the agent and so
    // nothing is counting rounds of it.
    case "EffectFailed":

    // Nothing to record, and here the absence is the point: a run a person ended is
    // not a failure, so it neither counts against `checkFailures` nor clears it.
    case "ChecksCancelled":

    // Nothing to record: the commit belongs to the branch that is already on the
    // trak. A plan running out where the composer said it would used to be caught
    // here and turned into a reason to ask it again; the composer writes that down
    // as a compose entry now, and reaching one is entering a step.
    case "WorkCommitted":

    // None records a fact the trak needs. The reason a trak failed — git's, at
    // either end or at the merge — is carried by the state `decide` returns.
    // `Abandoned`, `Closed` and `Merged` join it: what each declares is carried
    // by the states `decide` returns for it, which is where a reader already looks
    // for why a trak stopped.
    // `WorktreeRemoved` too, and it is the one worth stating: `Trak.worktree`
    // deliberately keeps naming the checkout and the branch that have just gone.
    // Both are where the work *was* — the archive deleted the branch with the
    // checkout — and naming them is what lets a reader say what was taken away.
    // `ChangesDropped` with them: what was dropped is on the event for a reader, and
    // the ending it leads to is the state `decide` returns.
    case "WorktreeFailed":
    case "MergeFailed":
    case "WorktreeRemoved":
    case "Abandoned":
    case "Closed":
    case "Merged":
    case "ChangesDropped":
      return t

    // The composer is asked from the refused position — the first unrun, since the
    // turn never began — and the reason rides along for its prompt.
    case "StepRefused":
      return asked(t, { _tag: "Refused", step: e.step, reason: e.reason })

    // The merge disagreed, so the composer is asked from the end of what ran —
    // which for a finished trak is the whole plan, so the resolution appends. The
    // paths ride along because the composer's prompt is their only reader, and by
    // then this event is behind us. `into` with them, and it is the destination's
    // name — the composer's prompt is where that name becomes the resolving step's
    // instruction, which is the only channel reaching a step at all.
    case "Conflicted":
      return asked(t, {
        _tag: "Conflicted",
        paths: e.paths,
        ...(e.into === undefined ? {} : { into: e.into }),
      })

    // The world came back, and the event says which door it came through.
    //
    // **No agent named: the composer is asked from the end of what ran.** Nothing that
    // ran is replaced, which is what keeps one piece of work reading as one record —
    // every slot survives and no artifact key can collide, however many times a trak is
    // re-entered. `what` rides along because the composer's prompt is its only reader,
    // and by then this event is behind us.
    //
    // **An agent named: that turn stands in the plan instead**, at the same join and on
    // the same terms — one conversational entry whose instruction is the sentence. No
    // composer is owed a turn, so no `reconsult` is set, and `onWorktreeReady` therefore
    // enters the plan rather than composing. See `spliced`.
    //
    // **A wait at the join goes first, through either door.** The entry it held is
    // the unrun tail both doors replace — the composer re-cuts from here, a named
    // agent stands here — so the fact would be left on an index that now names
    // something else. Cleared rather than read around, for `Slot.waiting`'s reason.
    case "Reentered":
      return reentered(unheld(t), e)

    // The trak stays where it is, and the sweep asks nothing more of the forge about it.
    case "AutoMergeStopped":
      return t.autoMerge === undefined
        ? t
        : { ...t, autoMerge: { ...t.autoMerge, stopped: e.cause } }

    // The session the failed turn was talking to, filed so a retry resumes that
    // conversation instead of paying to rebuild it. `step` absent means the
    // composer, which has no position and so no slot — its session sits on the
    // trak itself. The event carries the index rather than the state being read
    // for it, because unlike `Restarted` this arrives while the turn it
    // describes is still the current one.
    case "TurnFailed": {
      if (e.sessionId === undefined) return t
      return e.step === undefined
        ? { ...t, composerSession: e.sessionId }
        : withSlot(t, e.step, { session: e.sessionId })
    }

    // A person changing how the trak is run, or whose it is — see `settingChanged`.
    case "ModeChanged":
    case "HoldChanged":
    case "SkipChecksChanged":
    case "AutoMergeChanged":
    case "MergeMethodPicked":
    case "OwnerChanged":
      return settingChanged(t, e)

    // `unheard`'s, which runs over every event after this.
    case "MessageWaiting":
    case "MessageDelivered":
      return t
  }
}

/** Every waiting message moved to `returned`, after whatever was returned before. */
const handedBack = (t: Trak): Pick<Trak, "messages" | "returned"> => ({
  messages: [],
  returned: [...t.returned, ...t.messages.map((m) => m.message)],
})

/**
 * What an event does to the messages nobody has read — `Trak.messages` and
 * `Trak.returned`, kept apart from `recordFacts` because every arm here is about
 * those two fields and nothing else.
 *
 * **A stop hands them back and sends none**: the gate a stop opens takes `Chat`, and
 * `heldChat` would otherwise spend a turn on them the moment after a person asked the
 * agent to stop. A check ended by a person is the same press at the other running
 * state. **A `Chat` takes them with it** — `chatWith` has put them in its text,
 * whether `heldChat` wrote it or a person did at a gate where some still waited.
 * Any other press leaves them for the turn it starts, and withdraws the offer of
 * what was handed back.
 */
const unheard = (t: Trak, e: Event): Trak => {
  if (e._tag === "MessageWaiting") {
    const waiting = { id: e.id, message: e.message, attachments: e.attachments ?? [] }
    return { ...t, messages: [...t.messages, waiting], returned: [] }
  }
  if (e._tag === "MessageDelivered") {
    return { ...t, messages: t.messages.filter((m) => m.id !== e.id) }
  }
  if (e._tag === "StopRequested" || e._tag === "Stopped" || e._tag === "ChecksCancelled") {
    return { ...t, ...handedBack(t) }
  }
  if (e._tag === "HumanActed") {
    return { ...t, messages: e.action._tag === "Chat" ? [] : t.messages, returned: [] }
  }
  return e._tag === "Reentered" ? { ...t, returned: [] } : t
}

/**
 * The gate this event took with nobody reading it, if it took one — the entry it let
 * through and what the rule read.
 *
 * **The same two questions `decide` just asked, asked again of the same trak**, rather
 * than inferred from the states either side: `acceptStep` asks `runsUnattended` of the
 * position whose checks passed, and the proposal arm asks `planRunsUnattended` of the
 * plan that landed. Nothing else takes a gate on the engine's own account — a question
 * answered unattended and a conversation ended unattended are turns, not gates, and a
 * child's ending is `endsUnattended`'s and lands on no entry.
 *
 * `undefined` everywhere else, including the two events arriving in a state that
 * `decide` refuses: a stamp on a gate that was not taken would be a mark on nothing.
 */
const gateTaken = (t: Trak, e: Event): readonly [at: number, why: Warrant] | undefined => {
  if (e._tag === "ChecksPassed" && t.state._tag === "CheckRunning") {
    const why = warrantFor(t, t.state.step)
    return why === undefined ? undefined : [t.state.step, why]
  }
  // A finish carrying a hand-off or a goal takes the plan gate as a proposal does — see
  // `onComposerOutput`; one without takes no gate on any mode, so there is nothing
  // to stamp.
  if (
    e._tag === "ComposerReturned" &&
    (e.output.type === "proposal" ||
      (e.output.type === "finished" && (handOffPending(t) || goalProposalPending(t)))) &&
    t.state._tag === "Composing"
  ) {
    return planWarrant(t)
  }
  return undefined
}

/**
 * Did this decision accept the entry a hold is holding, so the hold has done its job?
 *
 * A hold holds the step that is running or gated — a spawn is not one — and is spent by
 * that step being accepted, never by a gate opening on it. A step that asks, chats, gives up or fails
 * its checks has advanced nothing, and the person who pressed is still to accept it;
 * spending the hold as the gate opened is what handed a second artifact, filed after
 * they chatted there, straight to the mode. Three transitions accept, and nothing else:
 *
 * - `Committing` — `keepStep`, the funnel approving, skipping and a recompose from a
 *   gate with a document on the table all pass through. The recompose is the one worth
 *   naming: a person breaking out of the plan still accepts the step's work, because
 *   `onHumanAction` keeps it before the composer runs — so the hold is spent and the
 *   replacement plan's gate is the mode's. A recompose from a gate with nothing filed
 *   goes straight to `Composing` and keeps the hold, which is this rule rather than an
 *   exception to it: nothing was accepted. **Not
 *   from `Joining`**: a spawn's children landing goes through the same funnel, but a
 *   spawn has no human gate on any mode, so nothing stood and nothing was accepted. A
 *   hold that reaches a spawn passes over it and holds the first entry after it that
 *   has a gate.
 * - `Approve` at `AwaitingProposal` — `enterStep` with no commit, so its own arm, and
 *   one that reads the event rather than where it lands: approving enters whatever the
 *   first unrun entry is — a step, a spawn, a compose entry the composer scheduled, or
 *   nothing left — and `Chat` at the same gate lands on `Composing` too, so the pair of
 *   states cannot tell an approved compose entry from a plan sent back. A plan the mode
 *   enters unattended never had a hold pending: `planRunsUnattended` reads it.
 * - rest — nothing is left to hold. **Not `Integrating`**: on a child the plan running
 *   out is followed by `endsUnattended`, which reads the hold to decide whether the
 *   child merges or archives itself or holds at `Finished` for a person, and that
 *   ending is the stop the press was made for. Spending the hold on the way into
 *   `Integrating` had an `auto` child end itself one event later. `Finished` is at
 *   rest, so a top-level trak's hold is spent there, one event after it would have been.
 *
 * A restart re-issues `Committing` from `Failed`, which is the same acceptance retried,
 * so a hold pressed on the failed trak is kept for the next one.
 * Pressing Hold at an open gate needs no case of its own: `HoldChanged` reaches none of
 * these, so it holds the gated step by construction.
 */
const accepted = (from: TrakState, e: Event, to: TrakState): boolean => {
  if (from._tag === "AwaitingProposal") {
    return e._tag === "HumanActed" && e.action._tag === "Approve"
  }
  if (from._tag === to._tag) return false
  if (to._tag === "Committing") return from._tag !== "Failed" && from._tag !== "Joining"
  return atRest(to)
}

/**
 * The entry the acceptance was of, or nothing: a step kept is its step, a plan entered
 * is the compose entry `planWarrant` names, and reaching rest accepts no
 * entry at all.
 */
const acceptedEntry = (t: Trak, from: TrakState, to: TrakState): number | undefined =>
  to._tag === "Committing" ? to.step : from._tag === "AwaitingProposal" ? planEntryOf(t) : undefined

/**
 * What a step's turn leaves on the trak: its session, the door it closes, its
 * document, its requirements and its attempt count.
 *
 * Its own function because `recordFacts` is a switch and this arm is most of it —
 * five facts from one event, each with a reason of its own.
 */
const onAgentReturned = (t: Trak, e: Extract<Event, { readonly _tag: "AgentReturned" }>): Trak => {
  const withSession = withSlot(t, e.step, {
    session: e.sessionId,
    // Whatever the last envelope that carries one said. An artifact re-filed after a
    // failing check reports again, and the newest answer is the one about the work
    // that is now on the table; `stuck`, `questions` and prose carry no rung and
    // leave whatever stands, because none of them reaches a gate this bears on.
    ...(e.output.type === "artifact" && e.output.ambiguity !== undefined
      ? { ambiguity: e.output.ambiguity }
      : {}),
    // The command a permission gate's yes quotes, from the envelope that opened it.
    // Prose leaves it standing, as it leaves the rung; any other envelope clears it.
    ...(e.output.type === "message"
      ? {}
      : { permission: e.output.type === "permission" ? e.output.command : undefined }),
  })
  // A step running is the plan that answers the composer beginning, so the door
  // closes behind it. Closed here rather than at the gate because the plan gate
  // still needs it to know where approving starts running. Left open, the next
  // plan gate would splice at a position two plans ago.
  const shut = answered(withSession)
  // A conversational reply is not an attempt at the step's work, so it does
  // not count as one — three exchanges about one artifact should not report
  // "attempt 4". The session is still recorded, which is what continuity
  // needs. It answers nothing either: the human is still standing at the gate
  // they spoke from, or in the conversation itself.
  //
  // **This is why `resumeFrom` cannot key off `attempt > 0` alone.** A
  // conversational step's first turn is prose, so its attempt count is still
  // zero when the human replies — and a reply that mints a fresh session
  // discards the conversation it is a reply to. See `SpawnStep`.
  if (e.output.type === "message") return withSession
  const out = e.output
  if (out.type !== "artifact" && out.type !== "stuck") return bumpIteration(shut, e.step)
  const step = t.plan?.steps[e.step]
  const key = step === undefined ? undefined : artifactKey(step, e.step)
  // Artifacts are derived from the log — there is no ArtifactWritten event.
  //
  // The document, not `artifactText` of it: absorbing an event must not throw
  // away what the log knows. Rendering is a view, and every reader that wants
  // prose asks for it — see outputs/artifact.ts. Keyed by position and agent,
  // so a step re-run by a chat or a failed check replaces its own artifact
  // while a plan that names the same agent twice files two.
  //
  // **A `stuck` account files like anything else.** It used to be dropped, on the
  // grounds that a later agent reading "here's why I couldn't do the breakdown" under
  // `1-breakdown` would be reading the wrong thing confidently — but that is an argument
  // about what a *reader* should be shown, answered at write time where it cannot be
  // undone. What a step produced is the record; who sees it is `visibleArtifacts`'.
  // Its three named fields are its sections, so nothing here needs a second shape.
  //
  // The requirements land beside the artifact and never inside it: they accumulate
  // in log order and survive both a document that never gets filed and a step
  // the plan later replaces. `key` is the provenance a human reads — derived
  // here rather than written by the agent, because the event already says which
  // step it came from. A later attempt at the same key is unioned in rather than
  // appended whole, or every re-run after a failing check would file the list
  // again — see `accumulated`.
  const withArtifact =
    key === undefined
      ? shut
      : {
          ...withSlot(shut, e.step, {
            filed: out.type,
            filings: slotAt(shut, e.step).filings + 1,
          }),
          artifacts: new Map(shut.artifacts).set(
            key,
            out.type === "artifact" ? documentOf(out) : stuckDocument(out),
          ),
          decisions: accumulated(
            shut.decisions,
            requirementsIn(out).map((d) => recorded(d, key, supersededBy(d))),
          ),
        }
  // Asked last, so it survives the closing above: this event opens the door rather
  // than answering it, and a turn that raises something again re-asks from where it
  // now stands.
  //
  // The join is the unrun tail, so nothing that ran is dropped — and the route
  // itself waits for the approval gate and the commit after it, because an
  // artifact a person sends back must not have bought a composer turn.
  //
  // **A `stuck` account never gets here.** It may carry requirements, which land on
  // the intent above; what it may not do is send the plan back to the composer,
  // because it is a trak stopping in front of a person.
  const raised = out.type === "artifact" ? raisedBy(out) : undefined
  const withRaised =
    raised === undefined
      ? withArtifact
      : asked(withArtifact, { _tag: "Raised", step: e.step, ...raised })
  return bumpIteration(withRaised, e.step)
}

/**
 * What this artifact puts in front of the composer, or `undefined` when it puts
 * nothing there — which is most artifacts.
 *
 * One of two writers of `Raised` — `joinChildren` is the other, for what a child handed
 * up — and the one place the *at least one of the two is non-empty* invariant has to be
 * checked, since the join writes only when it has something. Both channels go in one
 * reason because only one ask may stand at a time; see `ReconsultWhy`.
 *
 * **Only `unplanned_work` gets here, and that is the whole of the split** — see
 * `isUnplanned`. Every entry lands on the standing list above whatever its kind, and
 * `composer.md` injects that whole list on a fresh session, so a settled constraint
 * reaches the composer either way. What it no longer does is wake it now.
 *
 * A non-routing entry does not ride the payload either, for the same reason: the
 * composer already has it, and carrying it twice would say a step raised work nobody
 * planned when it had settled something and moved on — which is a gate, in
 * `attention.ts`, as well as a planning turn.
 *
 * **Legacy `uncovered_work` feeds the requirements half and nothing else.** It never
 * landed on the intent, and replay has to take the route the trak actually took —
 * folding it in would give every stored trak an intent it never had. It routes
 * unchanged: it is the channel `unplanned_work` was named after.
 */
const raisedBy = (
  out: Artifact,
):
  | { readonly requirements: readonly string[]; readonly corrections: readonly Correction[] }
  | undefined => {
  // `?? uncovered_work` reads off the field's presence rather than off the filtered
  // length: an envelope that filed requirements and nothing unplanned among them has
  // raised nothing, and must not fall through to a legacy key it never wrote.
  const requirements =
    out.requirements?.filter(isUnplanned).map((r) => r.text) ?? out.uncovered_work ?? []
  const corrections = out.corrections ?? []
  return requirements.length === 0 && corrections.length === 0
    ? undefined
    : { requirements, corrections }
}

/**
 * The ids a spawn position minted.
 *
 * It overwrites rather than appends, because a restart re-issues `SpawnChildren`
 * and that hands back the same ids it minted the first time — a second list would
 * double every child.
 *
 * Overwriting cannot lose a landing, and that is `decide`'s guarantee rather than
 * this function's care: `Spawning` is the only state this event applies in, and a
 * trak that has not left `Spawning` has had nothing come back. Anywhere else it is
 * `unexpected`.
 */
const recordSpawned = (t: Trak, step: number, ids: readonly TrakId[]): Trak =>
  withSlot(t, step, { children: ids.map((id) => ({ id, landing: undefined })) })

/** One child's return, against the place in the list the spawn entry gave it. */
const recordLanding = (t: Trak, e: Extract<Event, { readonly _tag: "ChildLanded" }>): Trak => {
  const runs = slotAt(t, e.step).children
  // A landing at a position with no record of a spawn: nothing to write it into,
  // and `decide` is what rules on the event rather than this. Empty rather than
  // absent is the test now that the slot is total — same question, since a spawn
  // entry always names at least one child.
  if (runs.length === 0) return t
  const landing = {
    branch: e.branch,
    sha: e.sha,
    artifacts: landedArtifacts(t, e),
    decisions: e.decisions,
    handUp: e.handUp,
  }
  return withSlot(t, e.step, {
    children: runs.map((r, i) => (i === e.child ? { id: r.id, landing } : r)),
  })
}

/**
 * Every document the child filed, under its own keys — or, from a log written
 * before the landing carried keys, its last document under the key its spawn entry
 * implies. See `lastChildKey`.
 */
const landedArtifacts = (
  t: Trak,
  e: Extract<Event, { readonly _tag: "ChildLanded" }>,
): readonly (readonly [string, Document])[] => {
  if (e.artifacts !== undefined) return e.artifacts
  const step = t.plan?.steps[e.step]
  const child = step !== undefined && isSpawn(step) ? step.children[e.child] : undefined
  return e.artifact === undefined || child === undefined ? [] : [[lastChildKey(child), e.artifact]]
}

/**
 * The whole batch, at one position, on the way out of a spawn.
 *
 * **Every child folds, including one that produced nothing usable** — a ruled-out
 * approach is often the most valuable thing a dropped piece produces, and the bar
 * for what counts as a decision is already what keeps per-child implementation
 * noise out.
 *
 * **Every document a child filed** files here, under the piece's name by the
 * child's own key, in the order the child's plan gave them — so a piece of two
 * steps hands back both, and the parent's next step can read how the second was
 * reached. One name per child rather than one per position, because parallel
 * review lenses are all `review` and a shared name would have them overwrite each
 * other.
 *
 * Provenance is stamped here, which is what makes the decisions `Decided` on the
 * wire and `Recorded` on the trak: the child wrote what it decided, and the
 * parent is what knows where that sits.
 *
 * **What a child handed up asks the composer, exactly as a step's `unplanned_work`
 * does.** A `Raised` naming the spawn position, with every hand-up as its requirements
 * half — so `reconsultHere` matches at this boundary and the commit runs out into a
 * compose rather than into the next entry. Nothing lands it on the intent: the child
 * step that found it already filed it there, and it came home with the child's
 * decisions. No gate here either — a person has already stood at the child step that
 * raised it, and the re-cut plan takes the ordinary plan gate.
 */
/**
 * Where a child's `supersedes` lands on the parent: the child named keys of its
 * own trak, and this trak files those documents somewhere else.
 *
 * A document the child filed itself is under the piece's name here, like the
 * document; one the child was born holding is the parent's own, under the key the
 * parent filed it by. Anything else is left as written: a requirement id is already
 * the parent's — one the child inherited is the same id here, and one of the child's
 * own was rewritten to what this trak calls it before it was sent, `handedDecisions`
 * — and a key the child's plan replaced has no home here either, so inventing one
 * would put the note on the wrong file.
 */
const landedNames = (landing: Landing, piece: string, d: Decided): readonly string[] =>
  supersededBy(d).map((named) =>
    landing.artifacts.some(([k]) => k === named)
      ? pieceKey(piece, named)
      : (parentKeyOf(named) ?? named),
  )

/**
 * A landed child came back again: what it filed since goes onto the landing it came
 * back with, and — once the join has passed — onto the trak.
 *
 * **Before the join, the landing carries it.** The batch enters the trak at one
 * moment, `joinChildren`, reading the slot's landings — so amending this child's is
 * what puts a re-entered sibling's later work into the same fold, in the same order,
 * as its first. After the join no fold is coming, so the documents go under the
 * piece's name and the decisions are stamped with it here, as the join does.
 *
 * **The hand-up never splices an ask.** The join's `Raised` is written at a boundary
 * the join owns; a refiling arrives in whatever state the parent is parked in, and an
 * ask written at `firstUnrun` there stands in front of the entry the plan holds
 * next — a step resting on a `merged` wait among them, which the sweep then answers
 * for the compose entry instead and walks past. It goes onto `Trak.handUps`, and the
 * next composer turn, whatever asks for it, is shown it. The landing keeps it too —
 * the later judgment standing in for the earlier, as `handedUp` reads it.
 */
const recordRefiled = (t: Trak, e: Extract<Event, { readonly _tag: "ChildRefiled" }>): Trak => {
  const step = t.plan?.steps[e.step]
  const runs = slotAt(t, e.step).children
  const run = runs[e.child]
  const child = step !== undefined && isSpawn(step) ? step.children[e.child] : undefined
  // Nothing landed to add to: `decide` rules on the event, and this absorbs facts.
  if (run?.landing === undefined || child === undefined) return t
  const landing: Landing = {
    ...run.landing,
    artifacts: [...run.landing.artifacts, ...e.artifacts],
    decisions: [...run.landing.decisions, ...e.decisions],
    handUp: e.handUp ?? run.landing.handUp,
  }
  const amended = withSlot(t, e.step, {
    children: runs.map((r, j) => (j === e.child ? { id: r.id, landing } : r)),
  })
  if (beforeJoin(t, e.step)) return amended
  const key = childKey(e.step, e.child, child)
  const artifacts = new Map(t.artifacts)
  for (const [k, doc] of e.artifacts) artifacts.set(pieceKey(key, k), doc)
  const decisions = [
    ...t.decisions,
    ...e.decisions.map((d) => recorded(d, key, landedNames(landing, key, d))),
  ]
  const handUps = e.handUp === undefined ? t.handUps : [...t.handUps, e.handUp]
  return { ...amended, artifacts, decisions, handUps }
}

/**
 * Is the spawn at `step` still waiting on its children, with the join yet to come?
 * `failedFrom` answers for a parent stopped there, whose restart re-parks it.
 */
const beforeJoin = (t: Trak, step: number): boolean => {
  const at = t.state._tag === "Failed" ? t.failedFrom : t.state
  return (
    at !== undefined &&
    (at._tag === "AwaitingChildren" || at._tag === "Joining") &&
    at.step === step
  )
}

const joinChildren = (t: Trak, i: number): Trak => {
  const step = t.plan?.steps[i]
  const runs = slotAt(t, i).children
  // Unreachable: `decide` only issues `JoinChildren` from a spawn position whose
  // children have all landed. Nothing to fold is nothing to do, rather than a
  // failure — this absorbs facts and `decide` is what rules on them.
  if (step === undefined || !isSpawn(step) || runs.length === 0) return t
  const artifacts = new Map(t.artifacts)
  const decisions = [...t.decisions]
  const handedUp: string[] = []
  for (const [j, run] of runs.entries()) {
    const child = step.children[j]
    const landing = run.landing
    if (child === undefined || landing === undefined) continue
    const key = childKey(i, j, child)
    for (const [k, doc] of landing.artifacts) artifacts.set(pieceKey(key, k), doc)
    for (const d of landing.decisions) {
      decisions.push(recorded(d, key, landedNames(landing, key, d)))
    }
    if (landing.handUp !== undefined) handedUp.push(landing.handUp)
  }
  const joined = { ...t, artifacts, decisions }
  return handedUp.length === 0
    ? joined
    : asked(joined, { _tag: "Raised", step: i, requirements: handedUp, corrections: [] })
}

/**
 * One position's slot, changed — everything else it holds is kept.
 *
 * The only writer. `slotAt` supplies the base, so a position nothing has
 * happened at yet is written the same way as one being updated.
 */
const withSlot = (t: Trak, position: number, change: Partial<Slot>): Trak => ({
  ...t,
  slots: new Map(t.slots).set(position, { ...slotAt(t, position), ...change }),
})

const bumpIteration = (t: Trak, step: number): Trak =>
  withSlot(t, step, { iterations: slotAt(t, step).iterations + 1 })

/**
 * The composer's run, landed on its entry in the plan, with the steps it proposed
 * appended after it.
 *
 * **The entry is normally already there** — `withAsk` wrote it when something asked, or
 * the composer proposed it as the last entry of a plan that stops short — and this fills
 * it in by writing the session into its slot. Only a run with no entry to land on writes
 * one, which is the first compose of a trak.
 *
 * **One entry per composer *session*, not per event.** A run can return more than once
 * under the same session — it asks `questions`, a person answers, it returns a proposal;
 * or a person chats at the plan gate and it revises. Only being asked for a different
 * plan mints a fresh session (`runtime.ts`, `Reconsulted`), so the session is what tells
 * a second turn of one run from a second run. Both cases reduce to the same sentence:
 * *keep everything up to and including this run's own entry, then append its steps.*
 *
 * **Nothing is dropped that ran, and nothing that ran is renumbered**, so no slot needs
 * truncating: unrun entries never had one. Re-doing work is a *new entry at a new index*,
 * which is what keeps a rescuing agent out of the stuck conversation it was hired to
 * arrive without — nothing has to drop a slot to arrange it.
 *
 * **A fresh session is what the shape gives an entry, and no longer what it guarantees.**
 * An entry may name `continues`, which asks for the conversation that produced the
 * document it is fixing — still holding what it wrote, which is the whole of why the fix
 * is cheap. `SpawnStep` resolves the name; a name that resolves to nothing starts fresh,
 * so the default survives every way of getting it wrong.
 */
const landCompose = (
  t: Trak,
  before: Trak,
  session: SessionId,
  revised: Proposal,
  at: number | undefined,
): Trak => {
  const head = composeHead(t, before, session)
  // The entry's own position — the last of the head either way.
  //
  // The run's rung lands here rather than being read off the event at the gate, because
  // `warrants` is recomputed whenever a surface draws it and an event is not where it
  // could look. **And the turn is counted**, exactly as a step's filing turn is: a
  // composer that asked first, or one a person chatted with and had revise, has spent
  // more than one turn at this position, which is what `attention.ts` reads.
  // The anchor every wait on the new tail counts from — see `Trak.planAt`.
  const landed = withSlot({ ...t, plan: revise(head, revised), planAt: at }, head.length - 1, {
    session,
    ...(revised.ambiguity === undefined ? {} : { ambiguity: revised.ambiguity }),
    // Whole, every time — see `Slot.handOffs`: a revision that says nothing has
    // withdrawn what the last one said. A plan proposes no goal, so it withdraws one.
    handOffs: revised.handOff ?? [],
    goal: undefined,
  })
  return bumpIteration(landed, head.length - 1)
}

/**
 * The composer's run, landed on its entry, with nothing appended after it — the answer
 * that says the work is already done.
 *
 * **The same landing as a plan's, which is the whole of why it needs no route of its
 * own.** The entry gets its session and so reads as run, the unrun tail it was going to
 * replace goes, and `firstUnrun` therefore lands past the last entry — where `decide`
 * already knows what to do with a plan that has run out.
 *
 * No rung is recorded: this answer carries none, and the one gate it can take — the
 * plan gate, where it hands work off — is asked about the hand-off rather than a rung.
 */
const landFinish = (t: Trak, before: Trak, session: SessionId, answer: Finished): Trak => {
  const head = composeHead(t, before, session)
  const landed = withSlot({ ...t, plan: ended(t.plan, t.description, head) }, head.length - 1, {
    session,
    handOffs: answer.handOff ?? [],
    goal: answer.goal,
  })
  return bumpIteration(landed, head.length - 1)
}

/**
 * The entries a landing composer run keeps: everything that ran, then its own entry
 * last. What follows the head is the run's answer — a proposal's steps, or nothing.
 */
const composeHead = (t: Trak, before: Trak, session: SessionId): readonly Step[] => {
  const steps = t.plan?.steps ?? []
  // **Whether this run already has an entry, not whether it holds the session.** A
  // reconsult that asks questions first sets `composerSession` to its new id while
  // nothing is written down yet, so comparing against that field would read the
  // answering return as another turn of an entry that never existed — and truncate
  // the plan back to the previous compose. The slot is the honest test: it is
  // written by the caller, at the moment the entry is.
  const mine = composeAt(t, session)
  const at = firstUnrun(before)
  const here = steps[at]
  return mine >= 0
    ? // Another turn of a run already on the plan: keep its entry, and drop the steps it
      // proposed last time so this answer replaces them.
      steps.slice(0, mine + 1)
    : // The entry this run was going to land at, filled in rather than appended
      // beside. Both kinds sit at the join: the composer's own scheduled re-cut, and
      // the ask `withAsk` wrote when something asked — which is why nothing here has
      // to tell them apart.
      here !== undefined && isCompose(here)
      ? steps.slice(0, at + 1)
      : [...steps.slice(0, at), { type: "compose", ...whyOf(before) }]
}

/**
 * The reason on an entry being written here rather than filled in: a trak that had no
 * plan to hold an ask when it was asked. Absent for a first compose, which nothing asked
 * for.
 */
const whyOf = (t: Trak): { readonly why?: ReconsultWhy } =>
  t.reconsult === undefined ? {} : { why: t.reconsult.why }

/**
 * What an event does to `Trak.stopped`: a turn that returns replaces its session's
 * entry with what it stopped, which is nothing for nearly every turn.
 *
 * **Only a return clears an entry.** A turn that failed may have died before the
 * session read its prompt, and the retry is told again rather than never.
 */
const haltedBy = (t: Trak, e: Event): Trak => {
  if (e._tag !== "AgentReturned" && e._tag !== "ComposerReturned") return t
  if (e.stopped === undefined && !t.stopped.has(e.sessionId)) return t
  const stopped = new Map(t.stopped)
  if (e.stopped === undefined) stopped.delete(e.sessionId)
  else stopped.set(e.sessionId, e.stopped)
  return { ...t, stopped }
}

export const applyEvent = (
  t: Trak,
  e: Event,
): { readonly trak: Trak; readonly decision: Decision } => {
  const facts = isSetupEvent(e) ? setupRecorded(t, e) : recordFacts(t, e)
  const absorbed = stopHeld(haltedBy(unheard(facts, e), e), e)
  const decision = decide(absorbed, e)
  // The gate is recorded here, beside the state and from the same decision, so
  // `replayHistory` and `advance` cannot disagree about it any more than they can
  // about the state itself. It survives everything that is not a gate, which is
  // what makes it readable two events later when a reply comes back.
  const lastGate = asGate(decision.next) ?? absorbed.lastGate
  // Recorded here for the same reason and in the same breath as `gate`: this is
  // the only point that sees both the state the trak was in and the decision
  // that took it out of there. `absorbed.state` is still the pre-event state —
  // `decide` returns the new one, it does not assign it.
  //
  // A second failure keeps the first one's position rather than recording
  // `Failed` as the place to go back to. Anything at all can arrive at a trak
  // that has already stopped — an out-of-order event from a caller replaying by
  // hand becomes `Failed{engine}` — and filing the older `Failed` here would
  // destroy the only record of where the work actually was, leaving `restartFrom`
  // with a position it can do nothing with. So `failedFrom` is never itself a
  // `Failed`, which is what keeps every failure retryable.
  //
  // Not carried forward past a retry, unlike `gate`: a retry's `next` is the
  // position itself, so leaving `Failed` clears this by construction.
  const failedFrom =
    decision.next._tag === "Failed"
      ? absorbed.state._tag === "Failed"
        ? absorbed.failedFrom
        : absorbed.state
      : undefined
  // Stamped here for `lastGate`'s reason: this is the moment the rule was asked, and
  // what it read is what a document nobody read has to say for itself. Read back off
  // the trak later, a change of mode would rewrite marks on documents already filed.
  const taken = gateTaken(absorbed, e)
  // A hold is one press for one step. It holds the step running or gated when it was
  // pressed, every gate that step reaches stands, and the hold is spent by that step
  // being accepted — see `accepted`.
  const spent = absorbed.holding && accepted(absorbed.state, e, decision.next)
  const holding = absorbed.holding && !spent
  // Recorded where the hold is spent, for `taken`'s reason: a surface reading the log
  // back cannot tell a held step from one the mode took.
  const heldAt = spent ? acceptedEntry(absorbed, absorbed.state, decision.next) : undefined
  // **One mark per entry, and it is the last gate that entry reached** — which `set` on
  // a map keyed by entry says on its own. The hold is written last, so it wins where
  // both would land on one entry. That replacement fires where a plan gate is reached a
  // second time on a compose entry the mode already took — a replan interrupted and
  // re-parked — and a hold then holds the plan until it is approved. The other
  // direction has no path today: the mode takes no gate on an entry while a hold is
  // pending (`warrantFor` refuses), and nothing brings the trak back to a gate on a
  // step it has accepted. The order is settled anyway, so the rule survives that moving.
  const marked = taken === undefined ? absorbed.marks : new Map(absorbed.marks).set(...taken)
  return {
    trak: {
      ...absorbed,
      state: decision.next,
      lastGate,
      failedFrom,
      holding,
      // A conflict's re-entry is over once the trak rests: the next one the engine makes
      // sets it again.
      resolving: absorbed.resolving && !atRest(decision.next),
      marks: heldAt === undefined ? marked : new Map(marked).set(heldAt, Mark.Held()),
      // A trak at rest has no turn left to hear anything, so what waited is the
      // person's again.
      ...(atRest(decision.next) ? handedBack(absorbed) : {}),
    },
    decision,
  }
}

/**
 * A turn's own ending that raced a stop's kill holds the step, on every mode but `manual`,
 * where a gate already stands.
 *
 * The turn finished before the kill reached it, so what it filed is filed — but the person
 * asked the trak to stop, so a mode that would take the gate it opens must not. A hold is
 * exactly that, and is spent the way a pressed one is: by the step being accepted, so its
 * checks' gate stands too and the step after it is the mode's again. Only the endings
 * that open a gate: a failed turn parks at `Failed` on every mode.
 */
const stopHeld = (t: Trak, e: Event): Trak =>
  t.state._tag === "Stopping" &&
  (e._tag === "AgentReturned" || e._tag === "ComposerReturned") &&
  t.mode !== "manual"
    ? { ...t, holding: true }
    : t

export const replayHistory = (id: TrakId, history: History): Trak =>
  history.reduce((t, e) => applyEvent(t, e).trak, emptyTrak(id))
