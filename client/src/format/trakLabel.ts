/**
 * Where a trak is, in one phrase and a tone — its state, and the one fact about the work
 * that a state cannot carry.
 *
 * **It lives in `format/` because both features say it**, and it moved here the day the
 * second one did: it was `traks-list/trakRowLabel` while the list was the only screen,
 * and a `trak-detail/` reaching across for it would have been the first cross-feature
 * import — which `client-style` says there is never a good first one of. Hoisted on
 * second use, never before, is the whole rule for this directory.
 *
 * Exhaustive over every state for the same reason `planView`'s projections are:
 * a state the server grows must be a compile error somewhere in the client, and
 * this is the somewhere for a state.
 *
 * **The tone answers "who is this waiting on".** `working` means the engine, `waiting`
 * means the person reading it, and `bad` is a trak that stopped. `neutral` is where a
 * trak ended with nothing owed and nothing wrong.
 *
 * `good` belongs to a `Finished` trak whose branch never moved — nothing is left to
 * decide about where the work goes, because there is nowhere for it to go. The three
 * ended states are all `neutral`: they draw as one Archived pile, and toning one of them
 * `good` would be three tones under one lid. A `Finished` trak that *did* write something
 * is `waiting` and must not be `good` — it is holding a checkout and a person owes it a
 * merge, which is the opposite of what `good` says.
 *
 * `waiting` is about the trak, not about what this UI can do to it: a `Finished` trak
 * is waiting on a person whether or not the surface reading this raises a button.
 *
 * `running` on `TrakSummaryDto` is a different fact and is not read here — it says a
 * process holds custody, not what the trak is doing. The list composes the two in
 * `rowWords`: an in-flight state that nothing holds says `stoppedWords`' chip instead of
 * the phrase here (`format/interrupted.ts`).
 *
 * **No step index appears in any phrase.** A bare index answers a question nobody asked
 * — *of how many?* — and the row carries the composer's own instruction for that step,
 * which says what a number would stand in for.
 */

import type { TrakStateDto } from "../api/types"
import { failureWords } from "./failure"
import type { Tone } from "./tone"

export interface TrakLabel {
  /**
   * `undefined` at `AwaitingChildren`, and nowhere else — the one state with
   * nothing to say about itself. The children are drawn beneath the parent, each
   * saying what it is doing, and a parent phrase above them would be a fourth way
   * of reading the same fact. Both surfaces render nothing rather than an empty pill.
   */
  readonly label: string | undefined
  readonly tone: Tone
}

/**
 * The things a human can be standing at inside `AwaitingHuman`. Kinds rather than
 * states because a reply routes to the same place from all of them — see `HumanGate`
 * in `src/workflow/domain/trak.ts` — so they differ only in what to say, which is
 * this function and nothing else.
 *
 * Narrowed out of `TrakStateDto` rather than importing `AwaitingHumanDto`: every
 * read of a nested shape here goes through the state or event that carries it, which
 * is why `api/types` has one name per consumer and not one per struct.
 */
const gateLabel = (kind: Extract<TrakStateDto, { _tag: "AwaitingHuman" }>["kind"]): string => {
  switch (kind) {
    case "approval":
      return "Output awaiting approval"
    case "answers":
      return "Questions need answers"
    case "checks":
      return "Automated checks failed"
    case "stuck":
      return "Step could not do the work"
    case "conversation":
      return "Agent awaiting response"
    case "permission":
      return "Command needs permission"
  }
}

/**
 * **`branchMoved` is required rather than defaulted**, and that is the whole of why it is
 * a second argument instead of a second function. It matters at one state, so a default
 * would be right at twenty of the twenty-one and wrong at the one this exists for — and
 * wrong silently, since the phrase it falls back to is the phrase this used to give
 * unconditionally. Every caller has the fact: the list reads `TrakSummaryDto.branchMoved`
 * off the row, and the detail counts it off the log with `finished.ts`'s `branchMoved`.
 */
export const trakLabel = (state: TrakStateDto, branchMoved: boolean): TrakLabel => {
  switch (state._tag) {
    case "Preparing":
      return { label: "Preparing the worktree", tone: "working" }
    case "Composing":
      return { label: "Composing a plan", tone: "working" }
    case "AwaitingProposal":
      return { label: "Plan needs approval", tone: "waiting" }
    // The same words as the answers gate below, deliberately: what a reader has to
    // do is identical, and the difference — nothing has been built yet, so there is
    // no work to lose — is not something a status line can carry. The row's chip
    // and its instruction line say which one this is.
    case "AwaitingComposerAnswers":
      return { label: "Questions need answers", tone: "waiting" }
    case "AgentWorking":
      return { label: "Working…", tone: "working" }
    // `working` rather than `waiting`: a person asked, and the engine owes the kill.
    case "Stopping":
      return { label: "Stopping…", tone: "working" }
    case "CheckRunning":
      return { label: "Running automated checks…", tone: "working" }
    // Its own words rather than the check's: a condition asks whether the step may
    // start, and *checks* would say the work was being judged.
    case "ConditionRunning":
      return { label: "Asking its condition…", tone: "working" }
    case "AwaitingHuman":
      return { label: gateLabel(state.kind), tone: "waiting" }
    // A spawn's three phases. `AwaitingChildren` is `working` rather than
    // `waiting`, and that is the distinction the tone vocabulary exists for:
    // something is in flight, and it is not a person who owes it. Each child
    // gates in its own column of the band — which is also why it is the one state
    // with no phrase at all. See `TrakLabel.label`.
    case "Spawning":
      return { label: "Spawning children…", tone: "working" }
    // The plan was taken and the traks it handed off are being named — in flight, and
    // nobody's, exactly as a spawn's first phase is.
    case "HandingOff":
      return { label: "Opening new traks…", tone: "working" }
    case "AwaitingChildren":
      return { label: undefined, tone: "working" }
    case "Joining":
      return { label: "Integrating children…", tone: "working" }
    // The same tone as `Integrating`, one step earlier: something is in flight
    // and nobody is being asked anything — easy to forget when a state's own
    // work looks done the moment a human approved it. And the same words, because
    // committing a step's work and committing the last of it are the same act at
    // two positions; the instruction line beside it is what separates them.
    case "Committing":
      return { label: "Committing work…", tone: "working" }
    case "Integrating":
      return { label: "Committing work…", tone: "working" }
    // Its own words rather than the commit's, because it is the one thing a trak does
    // that reaches outside its checkout: what a person wants to know here is not that
    // the work is safe but that something is being sent.
    case "Effecting":
      return { label: "Running its effects…", tone: "working" }
    // Abandoning commits what exists and then archives, so it reads as `working` on
    // the way and `neutral` at rest. Not `bad`: nothing went wrong, a person decided —
    // and a row that scolds is a row people stop declaring, which costs the corpus the
    // traks worth reading.
    case "Abandoning":
      return { label: "Archiving work…", tone: "working" }
    // Two readings of one state, and the branch is what separates them.
    //
    // A trak that wrote something is `waiting`, not `good`: it has come to rest holding
    // its checkout, and what happens to that work is a person's decision. Labelled `good`
    // it read as an ending nobody owed anything to, which is exactly how a directory of
    // held worktrees grows unnoticed — which is what the wording says outright.
    //
    // A trak whose branch never moved is `good`, and it is the second `good` in the app.
    // There is no merge to owe: the plan ran out, the work such as it was is done, and
    // the one press left is Archive. The words name the fact rather than the press —
    // Archive is every finished pile's press, so it separates nothing — and the row sits
    // under the RESOLVED header saying the same thing.
    case "Finished":
      return branchMoved
        ? { label: "Ready to merge", tone: "waiting" }
        : { label: "Finished — nothing to merge", tone: "good" }
    case "Merging":
      return { label: "Integrating work…", tone: "working" }
    case "Closing":
      return { label: "Archiving trak…", tone: "working" }
    // The end of a trak somebody was done with, and `neutral` for `Abandoned`'s
    // reason: nothing went wrong. The three ended states share the tone — they draw as
    // one Archived pile — and keep their own words, because which ending it was is the
    // one thing left to say about a row under that lid.
    case "Closed":
      return { label: "Closed", tone: "neutral" }
    // The one ending that says where the work went.
    case "Merged":
      return { label: "Merged", tone: "neutral" }
    case "Abandoned":
      return { label: "Abandoned", tone: "neutral" }
    case "Failed":
      // The chip, not the error. `failure.ts` holds both lengths of the same fact: this
      // one fits a row beside a truncating title, and the notice in the detail view has
      // room for the sentence. `error` is a provider's own prose and is drawn nowhere.
      return { label: failureWords(state).chip, tone: "bad" }
  }
}
