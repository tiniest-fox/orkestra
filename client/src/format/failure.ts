/**
 * A stopped trak, in words — the chip a row carries, the notice's head, what happened,
 * and what the press out of it is called and costs.
 *
 * **Two ways a trak stops, and one vocabulary for both.** The engine wrote an ending, which
 * is a `Failed` state and the whole of `failureWords`; or the process carrying a command
 * went away and nothing wrote anything, which is `stoppedWords`. They draw the same plate
 * and the same press, so their words are decided here together rather than one set here and
 * a sentence in a component.
 *
 * **Two axes, one map.** `Failure` says whose fault it is and `ApiErrorKind` says what
 * the API did, so a provider failure keys on the second and the other three kinds key on
 * the first. `${kind} failed` was one string doing all four jobs, and *provider failed*
 * is what a dropped connection read as.
 *
 * **Exhaustive, with no `default`** — `StepOutputView` is the precedent. A kind the
 * server grows is a `tsc` failure here rather than a notice with nothing in it.
 *
 * **`apiKind` absent is not `unclassified`.** Nothing said, and every failure recorded
 * before the field existed says nothing — so it lands on the same words as a shape the
 * classifier did not recognise, which is the honest answer for both.
 *
 * **A failure a runner verb caused leads with the runner's words**, whichever kind it is:
 * a checkout whose sandbox the provider's limit refused and a turn whose sandbox would
 * not start are both the runner speaking, and the script's own sentence is the one a
 * person can act on. The runner file and the verb ride beside it, and what the script
 * printed is behind a press — the provider's own text, kept for whoever wants it.
 *
 * **A spawn the runners-only guard refused leads with the guard**, ahead of the kind and of
 * any runner verb: nothing ran, so neither says anything true about it. The line is the
 * guard's own sentence, and the press says it lands in the same place until there is a
 * runner — a retry is the next step only once someone has added one.
 *
 * **A remake that left the sandbox's uncommitted changes behind leads with where they are**,
 * ahead of the kind: the checkout's own words say nothing is lost by trying again, and
 * here a retry starts from the branch without those changes. The ref is named under the
 * line, whole, so a person can copy it.
 *
 * **A failed setup leads with setup**, ahead of the kind: its kind is `worktree`, whose
 * words say the checkout could not be made, and that is false once a turn has run in it.
 * What the script printed is behind a press, as a runner's is.
 *
 * **A provider failure nobody named carries the provider's own text**, behind a press. Its
 * sentence says only that there is no name for it, and the causes behind it — a spawn that
 * failed, a `model:` naming no provider, a CLI that exited before answering — differ only
 * in that text. A classified kind's sentence says what to do, so its text stays off.
 *
 * It lives in `format/` because the chip is read by the list row and the detail header
 * alike, which is the same second use that moved `trakLabel` here.
 */

import type { TrakStateDto } from "../api/types"

type Failed = Extract<TrakStateDto, { readonly _tag: "Failed" }>

/** What the notice over a stopped run says, whichever way it stopped. */
export interface NoticeWords {
  /** The same fact at the notice's length — the mono-caps mark above the sentence. */
  readonly head: string
  /** What happened, and whether running it again is worth anything. */
  readonly line: string
  /** What the press out of it is called. */
  readonly press: string
  /** What the press costs, beside it. */
  readonly says: string
  /** The runner verb behind it, where one failed — what is named under the line. */
  readonly runner?: RunnerWords
  /** The ref holding the sandbox's uncommitted changes, where a remake left them there. */
  readonly carried?: string
  /** What the project's setup script printed, where setup failed — drawn only on a press. */
  readonly setup?: string
  /** The provider's own failure text, where nothing classified it — drawn only on a press. */
  readonly unnamed?: string
}

/** A runner verb's failure, past the sentence the line already carries. */
export interface RunnerWords {
  /** The runner file and the verb it was asked: `.orkestra/runner.sh create`. */
  readonly names: string
  /** Everything the script printed on stderr, drawn only on a press. */
  readonly printed: string
}

export interface FailureWords extends NoticeWords {
  /** The short form, scanned in a list beside a truncating title. */
  readonly chip: string
}

/**
 * What the press would re-run, keyed on whose failure it is.
 *
 * Position-relative rather than numbered: the notice is drawn at the position the trak
 * stopped at, so *this position* is a fact the reader can see, where a step index would
 * be a second copy of the map's own numbering. The two kinds that do not re-run a
 * position say what they do instead — a checkout that was never prepared has no position
 * to go back to, and an engine failure re-issues whatever command its position implies.
 */
const AGAIN = "Runs this position again, from the top."

/**
 * The other thing a press can cost: re-issuing whatever command the position implies
 * rather than re-running a turn. Shared by the engine's own failures and by a run nothing
 * is carrying, because it is the same act — `decide` reads where to pick up from off the
 * state in both.
 */
const PICKS_UP = "Picks it back up where it stopped."

/** What the provider did, for a failure it reported in-band. `undefined` is *nobody said*. */
const providerWords = (apiKind: Failed["apiKind"]): Omit<FailureWords, "press" | "says"> => {
  switch (apiKind) {
    case "interrupted":
      return {
        chip: "interrupted",
        head: "the agent was interrupted",
        line: "The connection dropped part-way through the agent's reply. Nothing it committed is lost — this position can be run again from the top.",
      }
    case "rate_limit":
      return {
        chip: "usage limit",
        head: "the API turned the agent away",
        line: "The usage limit was reached, so the agent never got an answer. Waiting is the fix; running it again now will land in the same place.",
      }
    case "overloaded":
      return {
        chip: "API busy",
        head: "the API was too busy",
        line: "The provider turned the request away rather than answering it. Running it again shortly usually works.",
      }
    case "server":
      return {
        chip: "API failed",
        head: "the API errored",
        line: "Something failed on the provider's side. It says nothing about the work — running the position again is the usual answer.",
      }
    case "auth":
      return {
        chip: "not signed in",
        head: "the agent could not sign in",
        line: "The claude CLI was not authorised. Fix that in a terminal, then run this again.",
      }
    case "unclassified":
    case undefined:
      return {
        chip: "provider failed",
        head: "the agent's CLI stopped",
        line: "Something went wrong between Orkestra and the API, and there is no name for it yet. It says nothing about the work.",
      }
  }
}

/**
 * Which archive stopped, as the sentence that opens the line. *On its branch* rather than
 * *not merged* for a close: a pull request GitHub merged also arrives as `closed`, because
 * the forge is asked after the teardown.
 */
const archivedWork = (archiving: Failed["archiving"]): string => {
  switch (archiving) {
    case "merged":
      return "The work is merged. "
    case "closed":
      return "The work is on its branch. "
    case "abandoned":
      return "The trak was being abandoned. "
    case undefined:
      return ""
  }
}

const kindWords = (state: Failed): Omit<FailureWords, "press"> => {
  switch (state.kind) {
    case "provider":
      return { ...providerWords(state.apiKind), says: AGAIN }
    case "agent":
      return {
        chip: "the agent gave up",
        head: "the agent gave up",
        line: "It stopped on the work rather than on the way it was being run. What it said above is the reason — running it again unchanged usually lands here twice.",
        says: AGAIN,
      }
    case "worktree":
      return {
        chip: "checkout failed",
        head: "the checkout could not be prepared",
        line: "git, or this project's .orkestra/worktrees/setup.sh, did not finish. Every step kept so far is on the trak's branch, so there is nothing to lose by trying again.",
        says: "Prepares the checkout again.",
      }
    // Everything a person asked for has run, so the line opens on where the work is —
    // which the archive does not change — and names `teardown.sh` beside git rather than
    // alone: a failure while abandoning can be the commit that comes before the teardown.
    case "archive":
      return {
        chip: "archive failed",
        head: "the checkout could not be archived",
        line: `${archivedWork(state.archiving)}git, or this project's .orkestra/worktrees/teardown.sh, did not finish taking the checkout away. Nothing about the work is lost.`,
        says: "Runs the archive again.",
      }
    // Git's own sentence is on the event and `MergeRefused` draws it under this line,
    // naming the files in the way — so the line says whose tree it is rather than
    // repeating them. The press is the finishing card's own Merge, not a restart on a
    // notice: `restartOffered` withholds that one here.
    case "merge":
      return {
        chip: "merge refused",
        head: "the merge was refused",
        line: "git would not merge this branch into its destination. The work is intact on its branch; what is in the way is in the tree it was merging into, and git names it below.",
        says: "Runs the merge again.",
      }
    // The one failure whose fix is a file in this repository rather than a retry, so
    // the line points at it and the press says only what it would cost. What the
    // script printed is on its own event and drawn above this — naming it twice would
    // be the notice and the card saying the same thing.
    case "project":
      return {
        chip: "a script failed",
        head: "this project's own script could not do it",
        line: "A script under this project's `.orkestra/checks/` was asked to act on the work and could not. The agent did not cause it and cannot fix it — what the script printed is above, and it names what to put right.",
        says: "Runs this step's effects again.",
      }
    case "engine":
      return {
        chip: "Orkestra broke",
        head: "Orkestra broke",
        line: "An invariant in the engine broke. A retry will most likely land in the same place.",
        says: PICKS_UP,
      }
  }
}

type RunnerFailure = NonNullable<Failed["runner"]>

/** What a runner's failure says, in place of the kind's words — the chip kept where the kind's says it. */
const runnerWords = (
  runner: RunnerFailure,
  chip: string,
): Pick<FailureWords, "chip" | "head" | "line" | "runner"> => {
  const named = {
    line: runner.said,
    runner: { names: `${runner.file} ${runner.verb}`, printed: runner.stderr },
  }
  switch (runner.kind) {
    case "limited":
      return { chip: "provider limit", head: "the sandbox provider's limit was reached", ...named }
    case "unreachable":
      return {
        chip: "provider unreachable",
        head: "the sandbox provider could not be reached",
        ...named,
      }
    case "absent":
      return { chip: "sandbox gone", head: "the sandbox is gone", ...named }
    case "lost":
      return { chip: "sandbox unreachable", head: "the sandbox could not be reached", ...named }
    case "failed":
      return { chip, head: "the runner failed", ...named }
  }
}

/** A spawn the runners-only guard refused, in place of the kind's words and any runner's. */
const runnersOnlyWords = (sentence: string): Omit<FailureWords, "press"> => ({
  chip: "runners only",
  head: "refused by --runners-only",
  line: sentence,
  says: "Refused again until the project or the host has a runner.sh.",
})

/** A remake that kept the uncommitted changes at `ref` and did not put them back. */
const carriedWords = (ref: string): Omit<FailureWords, "press"> => ({
  chip: "changes left behind",
  head: "the uncommitted changes did not come across",
  line: "The trak's sandbox was made again, and the uncommitted changes it held were not put back in the new one. They are kept in this project's repository, as one commit over the trak's branch, at the ref below. Until it is applied or deleted, the sandbox is not rebuilt.",
  says: "Starts again from the trak's branch, without those changes.",
  carried: ref,
})

/** A setup script that failed, beside the work or before it, with what it printed. */
const setupWords = (printed: string): Omit<FailureWords, "press"> => ({
  chip: "setup failed",
  head: "the project's setup.sh failed",
  line: "This project's .orkestra/worktrees/setup.sh did not finish, so the checkout has nothing it installs, and any turn running beside it was stopped. Every step kept so far is on the trak's branch.",
  says: "Runs setup.sh again, then the work it stopped.",
  setup: printed,
})

/** The provider's own text, where nothing named the failure — nothing for any other. */
const unnamedText = (state: Failed): Pick<FailureWords, "unnamed"> =>
  state.kind === "provider" && (state.apiKind === undefined || state.apiKind === "unclassified")
    ? { unnamed: state.error }
    : {}

/**
 * Every failure takes the same press, because each is a trak the engine wrote an ending
 * for and `failedFrom` knows the position to re-enter at. Which kind it is decides only
 * what that costs — and, for a refused merge, that the press is drawn on the finishing
 * card rather than on a notice.
 */
export const failureWords = (state: Failed): FailureWords => {
  if (state.runnersOnly !== undefined)
    return { ...runnersOnlyWords(state.runnersOnly), press: "Restart" }
  if (state.carried !== undefined) return { ...carriedWords(state.carried), press: "Restart" }
  if (state.setup !== undefined) return { ...setupWords(state.setup), press: "Restart" }
  const words = kindWords(state)
  if (state.runner !== undefined)
    return { ...words, ...runnerWords(state.runner, words.chip), press: "Restart" }
  return { ...words, ...unnamedText(state), press: "Restart" }
}

/**
 * The one stoppage with no ending behind it: a command was in flight and the process that
 * would have finished it is gone.
 *
 * **A constant rather than a function, because there is nothing to key on.** The state is
 * whichever command was running and says nothing about why nobody is holding it — killing
 * `pnpm ui` mid-turn and a `pnpm ork` that died leave the same pair, and neither is worth
 * telling apart in a sentence.
 *
 * The chip is what the list row says, under *Errors* beside the failures: the wire still
 * names the command that was running, and a row reading it off the state would say
 * *Working…* about a trak nothing is working on.
 */
export const stoppedWords: FailureWords = {
  chip: "stopped",
  head: "nothing is carrying this trak",
  line: "A command was in flight and the process that would have finished it is gone. Nothing recovers that on its own — the trak sits where it is until somebody picks it back up.",
  press: "Resume",
  says: PICKS_UP,
}
