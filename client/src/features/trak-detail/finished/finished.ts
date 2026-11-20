/**
 * What the finished position says about a trak that has run its plan out.
 *
 * **Derived on the client, from the log and the plan, exactly as `planView` derives
 * everything else.** Nothing here is predicted and nothing here is fetched — every number
 * below is a count over events the server already sent, so the card is complete the moment
 * it draws. Git's own answer about what changed is a request (`GET /changes`, the drawer's
 * Changes surface); keeping it out of here is what stops a summary waiting on one.
 *
 * **`domain/record.ts` computes most of this already and is deliberately not reused.** Its
 * only exit is `GET /api/traks/:id/record`, which answers `text/markdown`; making it usable
 * here means a structured record DTO and a second route. What it has that this does not is
 * a working/waiting split of the elapsed time, attributed gap by gap — and copying
 * `gapsIn` into the client would be a second copy free to disagree with the record a person
 * can read beside it. So the duration here is the plain wall-clock one the design asked
 * for, and the split stays where it is.
 */

import { GENERIC_AGENT } from "../../../format/engineAgent"
import type { ArchiveFailedDto, EndStateDto } from "../controls"
import type { MergeMethod, Standing } from "../pull-request/pullRequest"
import type { EventDto, MergePreviewDto, PlanDto } from "../../../api/types"

/** The summary's numbers and names, all of them counted off `log` and `plan`. */
export interface Ending {
  /** The branch the work is on. It survives the ending — `replay.ts` keeps `worktree`
   *  naming the checkout that has gone, because clearing it would take this with it. */
  readonly branch: string | undefined
  /** Distinct commits on the branch. See `commitsIn`. */
  readonly commits: number
  /** Plan entries that were the agent's rather than the composer's. */
  readonly steps: number
  /** How many times it stopped for a person. */
  readonly gates: number
  /** Wall clock between the first and last stamped event, or `undefined` when the log
   *  predates `Store.append` stamping one. */
  readonly elapsed: string | undefined
  /** Checks that were failing when a person took the work anyway, by name. */
  readonly overrode: readonly string[]
}

/**
 * Commits on the branch, counted by **distinct sha**.
 *
 * `WorkCommitted.sha` is the branch tip after that commit rather than a commit the step
 * necessarily produced — `Vcs.commitWork` is re-runnable and reads its answer off the
 * branch — so two entries in a row that changed nothing report the same one. Counting the
 * events instead would say *5 commits* about a branch with three, which is the one number
 * on this card a person might go and check.
 */
const commitsIn = (log: readonly EventDto[]): number =>
  new Set(log.flatMap((e) => (e._tag === "WorkCommitted" && e.sha !== undefined ? [e.sha] : [])))
    .size

/**
 * Whether anything was kept on the branch — the fact that decides what a finished trak's
 * ending offers, and the words on every surface that names it.
 *
 * **The client's own reading of `TrakSummaryDto.branchMoved`, and it has to agree with
 * it.** The list has no log and is sent the answer; the detail has the log and counts it.
 * They are the same predicate on two sides of the wire — the server asks whether *any*
 * `WorkCommitted` carries a sha, and a set is non-empty exactly when one element exists —
 * so no de-duplication is owed on either side and there is nothing to keep in step.
 *
 * Exported rather than left to `Ending.commits > 0` at each call site: four surfaces read
 * it, only one of them has an `Ending` in hand, and the word they share with the wire is
 * what stops the pane and the row disagreeing about the same trak.
 */
export const branchMoved = (log: readonly EventDto[]): boolean => commitsIn(log) > 0

/**
 * What this trak's composer handed up to its parent, or `undefined` where it handed up
 * nothing — which is every trak with no parent, and most children.
 *
 * **The last `finished` in the log, and only that one.** A child sent back and finished
 * again writes a second `finished`, and the later judgment is this trak's message —
 * `handedUp` in `runtime.ts` reads the same event for the same reason.
 *
 * **The parent is told the same one, by a different event.** The landing carries the
 * hand-up the child ended with the first time; a child sent back after it landed and
 * finished again refiles its newer one on the parent as a `ChildRefiled`. This screen is
 * the child's, so it is read off the child's log, which has neither event — both are on
 * the parent.
 */
export const handedUp = (log: readonly EventDto[]): string | undefined =>
  log
    .flatMap((e) =>
      e._tag === "ComposerReturned" && e.output.type === "finished" ? [e.output.handUp] : [],
    )
    .at(-1)

/**
 * Checks that failed and were taken anyway, by name.
 *
 * **The last surface that can say it.** A `checks` gate is the only place the app says a
 * check disagreed with the work, and it is gone the moment somebody approves — so a trak
 * arrives here with nothing on screen recording that it happened.
 *
 * **In log order, and that is the whole of it.** A `CheckFailed` and an `Approve` at the
 * same step is also what the engine's *ordinary* recovery writes: `decide` re-runs the
 * agent on a first failure with the check's output as the trigger, the re-run passes, and
 * the step parks at its **approval** gate where a person says yes. `CHECK_FAILURE_LIMIT`
 * exists to make that path the common one, so a rule that paired the two by step alone
 * would call almost every step an override.
 *
 * So a failure is carried until something resolves it, and what resolves it decides — by
 * what it does to the *failure*, not by what it does to the moment. A `ChecksPassed` at
 * that step with no `skipped` is the re-run passing. A `Replan` sends the step back to the
 * composer, and `Skip` does not arise at all because `skippable` excludes `checks`. A
 * `Chat` resolves nothing: it re-enters the step, and a prose reply hands back the **same**
 * `checks` gate with `Approve` still on offer and no check re-run — so the failure is
 * carried across it, and an `Approve` after a chat is as much an override as one with no
 * chat before it. A `ChecksCancelled` is `Chat`'s case again: the re-run a person ended
 * said nothing new, and the `checks` gate it parks at still offers the same `Approve`. An
 * `Approve` is the override — at a `checks` gate that is precisely *take it anyway*, and it
 * is the only action there that advances past a check that is still failing.
 *
 * **A `ChecksPassed` carrying `skipped` resolves nothing either, and what follows it
 * decides.** The check it names did not run, so the last thing that check said still
 * stands — carried across as it is across a chat. Where the skip is the acceptance, on
 * `smart` and `auto`, nothing follows at that step and the failure is still outstanding
 * at the end of the log: that is the override, and the step is marked *skipped past* so
 * the end of the log can name it. On `manual` the skip parks at an approval gate with
 * three presses, and each is read as it is read after a failure: `Approve` names the
 * check, `Replan` sends the step back and names nothing, and a `Chat` that files again
 * reaches a re-run — the switch is spent — whose plain pass clears it. A skip with no
 * failure before it names nothing: this surface is about checks that *disagreed* with the
 * work, and a check that never ran said nothing — the step's own card says it was skipped.
 *
 * **`AnswerQuestions` carries a failure across too.** A step re-entered after a failure
 * can ask before it files again; its answers move nothing past the check, and clearing
 * there was only ever safe because a re-run always followed. With the switch armed, the
 * run that follows is the skipped one, and the failure has to still be there for it.
 *
 * **One name at a time, and the latest wins.** Checks are fail-fast — `RunChecks` returns on
 * the first non-zero and never reaches the rest — so at most one check at a step is failing
 * at any moment, and a *different* name on the next run means the agent got past the first
 * one. `check-progress.ts` puts the name in the failure signature for exactly that reason.
 * Accumulating across the runs of a step would make the alternating-names path — the one
 * that survives to `CHECK_FAILURE_LIMIT`, since `replay.ts` only calls a failure repeated
 * when it matches the one immediately before it — report every check the step ever tripped
 * as still failing.
 *
 * **It drops the plan gate for free**, which is `HumanActed{step: 0}` because the composer
 * has no step of its own: nothing is outstanding at 0 when it arrives, so it clears
 * nothing and names nothing. A set of approved step indices cannot tell it from a child
 * trak's first step.
 *
 * **The name, never a count of warnings.** `CheckFailed` carries the check's name and its
 * raw output text, so *2 lint warnings* would be this surface parsing a shell transcript.
 */
const overriddenIn = (log: readonly EventDto[]): readonly string[] => {
  const outstanding = new Map<number, string>()
  /** Steps whose outstanding failure a skipped run went past, and nothing has settled since. */
  const skippedPast = new Set<number>()
  const taken: string[] = []
  for (const e of log) {
    if (e._tag === "CheckFailed") {
      outstanding.set(e.step, e.name)
      skippedPast.delete(e.step)
    } else if (e._tag === "ChecksPassed") {
      if (e.skipped === undefined) {
        outstanding.delete(e.step)
        skippedPast.delete(e.step)
      } else if (outstanding.has(e.step)) {
        skippedPast.add(e.step)
      }
    } else if (
      e._tag === "HumanActed" &&
      e.action._tag !== "Chat" &&
      e.action._tag !== "AnswerQuestions"
    ) {
      const failing = outstanding.get(e.step)
      if (e.action._tag === "Approve" && failing !== undefined) taken.push(failing)
      outstanding.delete(e.step)
      skippedPast.delete(e.step)
    }
  }
  for (const step of skippedPast) {
    const failing = outstanding.get(step)
    if (failing !== undefined) taken.push(failing)
  }
  return [...new Set(taken)]
}

/**
 * How long it took, in the coarsest words that are still true.
 *
 * Rounded down to the minute, because the number stands beside *5 steps* as a sense of
 * scale rather than as a measurement — and a trak that took forty seconds says so in words
 * rather than as `0m`, which reads like a bug.
 */
const spell = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return "under a minute"
  const hours = Math.floor(minutes / 60)
  return hours === 0 ? `${String(minutes)}m` : `${String(hours)}h${String(minutes % 60)}m`
}

/**
 * The span the trak covers, or `undefined` when the log cannot say.
 *
 * `at` is optional on every event and absent on a log written before `Store.append` stamped
 * one — *a time the engine did not measure is not one to invent*, which is the DTO's own
 * comment. So a log with fewer than two stamps reports nothing rather than a zero, and
 * never a duration measured from 1970.
 */
const elapsedIn = (log: readonly EventDto[]): string | undefined => {
  const stamps = log.flatMap((e) => (e.at === undefined ? [] : [e.at]))
  const [first] = stamps
  const last = stamps.at(-1)
  if (first === undefined || last === undefined || stamps.length < 2) return undefined
  return spell(last - first)
}

/**
 * **Counted, and never read off the state.** Every number here is a tally over the log and
 * the plan, which is why the ending it is drawn at is not an argument: the one fact the
 * engine reports directly is the merge commit, and that is on the state where `arrowEnd`
 * reads it, narrowed, rather than copied here as a `string | undefined` nothing can check.
 */
export const ending = (
  log: readonly EventDto[],
  plan: PlanDto | undefined,
  /** `TrakDetailDto.worktree?.branch`, read off the detail by the caller — `api/types`
   *  takes a name when something imports it, and nothing needs the whole worktree here. */
  branch: string | undefined,
): Ending => ({
  branch,
  commits: commitsIn(log),
  // The composer's own entries are not steps — the map draws them as rows and the count
  // beside *stopped for you 3 times* is about the work, not about the planning.
  steps: (plan?.steps ?? []).filter((e) => e.type !== "compose").length,
  gates: log.filter((e) => e._tag === "HumanActed").length,
  elapsed: elapsedIn(log),
  overrode: overriddenIn(log),
})

/**
 * One sentence per ending, the line under it, and what stands where the presses would be.
 *
 * **The position survives the ending**, so three of these six are epitaphs rather than
 * questions — and they have to read as endings rather than as a page that has lost its
 * buttons. That is what `instead` is for: a state with nothing on offer says why, so the
 * space where two buttons were is answered rather than empty. It is `undefined` at exactly
 * the states `controls.ts` offers a press at, which is now four of the six.
 *
 * **A merge git refused says the `Finished` words, and nothing here names the refusal.**
 * The plan ran out and the work is on its branch, both still true; what is not is one hop
 * past them, and `MergeRefused` draws that under this sentence with git's own text in it.
 *
 * **`Merged` says what `Closed` says about its branch: it is gone.** Archiving deletes
 * the branch, its recorded base ref and the branch's copy on GitHub along with the
 * checkout, so the line under both endings names that rather than promising a branch that
 * is no longer there — a promise this surface made for as long as closing kept it. Both
 * still offer the doors; what re-entry starts from is fresh.
 *
 * **Two of the three sentences move once the branch has a pull request, and neither is a
 * matter of taste.** A trak with one is never offered a local Merge — `FinishedView`
 * composes that offer away — so naming the press in the line under the lead points at a
 * button that is not there; and once the forge reports the pull request merged, *the work
 * is on its branch* stands directly over a section saying it went in. Both are the pane
 * disagreeing with itself, and the fact that settles them is the forge's, so it arrives as
 * an argument rather than being read off the state.
 *
 * `Merging` and a plain `Closing` say the `Finished` words: the ending is in flight, and a
 * pane that re-wrote itself mid-`git` would be reporting a result it does not have yet.
 *
 * **`Closing` after a merge is the one case where the result *is* in**, which is why it
 * reads `state.merged` the way `arrowEnd` does. The sha is on the state, so the merge is a
 * fact and the checkout is no longer held — saying *Closing it now* beside a card drawing
 * the merge commit is the pane disagreeing with itself for as long as removing a worktree
 * takes. What is in flight there is the clearing up, and that is what it says.
 *
 * **`Closed` says the same thing either way, and it is the case worth stating.** Its second
 * line names re-entry, and re-entry is genuinely on offer there — `changesOffered` is true
 * at `Closed` and the press below the card is drawn — so a pull request changes nothing
 * about it. What re-entering makes is a fresh checkout from wherever the host is standing:
 * the branch went with the archive.
 *
 * **A remembered or coarse answer is as good as a fresh one here**, which is the whole
 * reason `pull` is a `Standing` rather than the whole answer's state: the sentence and the
 * Merge press below it are read off `standingOf` and nothing else, so the pane cannot end up
 * naming a press it is not drawing.
 *
 * **A branch nothing was committed to changes `Finished` and nothing else.** It leads with
 * the work being complete rather than with the absence, because these traks are not a
 * failed kind of merge — an investigation that answered a question, work done outside the
 * repository, and a look that found nothing all end here, and no wording that named what
 * was *produced* could be true of all three. The line under it names the one press left,
 * where an ordinary finished trak's names a choice between two. The four states after it
 * are untouched: once a person has decided, *nothing landed* has stopped being the useful
 * fact. `pull` is not read there, and it is `none` in any case — a branch nobody pushed to
 * has no pull request, so `FinishedView` says so itself rather than spending a `gh` process
 * to be told, and never hands this an answer nobody asked for.
 */
export const endingWords = (
  state: EndStateDto,
  /**
   * Where the branch's pull request stands — `standingOf`, the same answer the card is
   * drawn from and the same answer the local Merge press is withheld on.
   */
  pull: Standing,
  /** Whether anything was kept on the branch — `branchMoved`, off the same log. */
  moved: boolean,
): {
  readonly lead: string
  readonly under: string | undefined
  readonly instead: string | undefined
} => {
  /**
   * What holds the checkout, or **nothing at all while nothing is known**.
   *
   * `unknown` says no second line rather than a fourth wording, and it is the one case here
   * that is a decision rather than a reading. Every other value names what would release
   * the checkout, and while the forge is still being asked there is no answer to that: the
   * local Merge press is withheld at `unknown`, so *until you merge it* would promise a
   * button that is not there, and *until this goes in on GitHub* would assert a pull request
   * nobody has found. Saying nothing is the same rule the rows are drawn under — no claim
   * is made where the forge has not made one — and the line appears a moment later when it
   * can be true.
   */
  const held =
    pull === "unknown"
      ? undefined
      : pull === "none"
        ? "The checkout is held until you merge it or archive it."
        : pull === "open"
          ? "The checkout is held until this goes in on GitHub, or you archive it."
          : // Merged or closed over there: nothing is going to go in, and no local merge
            // was ever on offer, so archiving is the only thing left to name.
            "The checkout is held until you archive it."
  const ran =
    pull === "merged"
      ? "The work is in — it went in on GitHub."
      : "The plan ran out and the work is on its branch."
  const went = "The work is in."
  // Archiving deleted the branch along with the checkout, so what re-entry makes is a
  // fresh start rather than a checkout of the old work — worth saying, because the
  // sentence it replaced promised the branch was still there.
  const kept = "Its branch went with it. More work on it starts a fresh checkout."
  switch (state._tag) {
    case "Failed":
      if (state.kind === "archive") return archiveWords(state.archiving)
      // A refused merge says the `Finished` words: the plan did run out and the work is on
      // its branch, and the refusal itself is the plate under this, not the sentence.
      return finishedWords(moved, ran, held)
    case "Finished":
      return finishedWords(moved, ran, held)
    case "Merging":
      return { lead: ran, under: held, instead: "Merging it now." }
    case "Closing":
      return state.merged === undefined
        ? { lead: ran, under: held, instead: "Archiving it now." }
        : { lead: went, under: undefined, instead: "Clearing the checkout up." }
    case "Merged":
      return {
        lead: `${went} The checkout has been taken away.`,
        under: kept,
        instead: undefined,
      }
    case "Closed":
      return {
        lead: "You were done with it. Nothing was merged, and nothing was given up on.",
        under: kept,
        instead: undefined,
      }
  }
}

const finishedWords = (
  moved: boolean,
  ran: string,
  held: string | undefined,
): ReturnType<typeof endingWords> =>
  moved
    ? { lead: ran, under: held, instead: undefined }
    : {
        lead: "The work is complete. Nothing to merge.",
        under: "Archiving takes the checkout and the branch — here and on GitHub.",
        instead: undefined,
      }

/**
 * An archive that did not finish says how the trak was ended and nothing about the
 * checkout: the notice above the sentence says what failed and carries the restart. An
 * abandon's words must not say the plan ran out, because it did not.
 */
const archiveWords = (archiving: ArchiveFailedDto["archiving"]): ReturnType<typeof endingWords> => {
  switch (archiving) {
    case "merged":
      return { lead: "The work is in.", under: undefined, instead: undefined }
    case "closed":
      return {
        lead: "You were done with it. The work is on its branch.",
        under: undefined,
        instead: undefined,
      }
    case "abandoned":
      return {
        lead: "You gave up on it before its plan ran out.",
        under: undefined,
        instead: undefined,
      }
    case undefined:
      return { lead: "You were done with it.", under: undefined, instead: undefined }
  }
}

/** Which press opened the box at the foot, and so where what is in it is going. */
export type Door = "plan" | "ask"

/**
 * The words a door changes, and the agent it sends.
 *
 * **Everything else about the box is identical and stays identical** — what is ticked, the
 * growing field, `Cancel` drawn only where nothing is ticked, and one request carrying the
 * lot. A tick and a sentence is one re-entry through either door; which door it went
 * through decides who reads it, not what is sent.
 *
 * **Four strings: the label, the foot line, the send press and the placeholder.** The
 * placeholder belongs with the other three because it is the same sentence in the same
 * box, and the plan door's — *the commit message should name the step by its instruction*
 * — is an instruction rather than a question. A hint that models the wrong
 * thing is worse than none, and it is the one string on this pane a reader copies the
 * shape of.
 *
 * `foot` is the rest of the line after the agent's name, because the box draws the name
 * itself in mono ahead of it — the plan door names nobody, so there its `foot` is the
 * whole line and `agent` is what tells the two apart, on screen and in the request.
 */
export const doorWords = (
  door: Door,
): {
  readonly label: string
  readonly agent: string | undefined
  readonly foot: string
  readonly send: string
  readonly placeholder: string
} =>
  door === "plan"
    ? {
        label: "What should change?",
        agent: undefined,
        foot: "This goes to the composer, which adds steps to the plan.",
        send: "Send it back",
        placeholder: "The commit message should name the step by its instruction, not its index.",
      }
    : {
        label: "What do you want to ask?",
        agent: GENERIC_AGENT,
        foot: "answers on the trak and files what it found.",
        send: `Ask ${GENERIC_AGENT}`,
        placeholder: "Why did the review step reject the first attempt? I want the reasoning.",
      }

/**
 * What a phone's box says about what is ticked, at the right of its label line — a count in
 * place of the named lines the desk draws. `ChangeRequest` says why. *Ticked* rather than
 * *comments*, because a failing check and GitHub's refusal to merge are ticked into it too.
 */
export const pickedCount = (n: number): string => `${String(n)} ticked`

/**
 * What the row on the map and the segment in the bar are called.
 *
 * The *caption* is `trakLabel`'s phrase, which the caller already has — this is the title
 * beside it, and it is the ending rather than the state so that a merge in flight still
 * reads as the thing it is finishing.
 *
 * **`Closing` is both endings**, so it reads `state.merged` for the same reason `arrowEnd`
 * does: the tail of a merge titled *Closed* is the row disagreeing with the card beside it.
 */
export const endingTitle = (state: EndStateDto): string => {
  switch (state._tag) {
    case "Failed":
      return state.kind === "archive" ? archiveTitle(state.archiving) : "Finished"
    case "Finished":
      return "Finished"
    case "Merging":
    case "Merged":
      return "Merged"
    case "Closing":
      return state.merged === undefined ? "Closed" : "Merged"
    case "Closed":
      return "Closed"
  }
}

/** The ending a person pressed, which an archive that did not finish has not changed. */
const archiveTitle = (archiving: ArchiveFailedDto["archiving"]): string => {
  switch (archiving) {
    case "merged":
      return "Merged"
    case "abandoned":
      return "Abandoned"
    case "closed":
    case undefined:
      return "Closed"
  }
}

/**
 * Where the work would go, in the words the card puts on the right of the arrow.
 *
 * Four facts and they are not interchangeable. A child merges into its parent and its
 * parent is an id rather than a branch name, so it is named by what it is; a goal's trak on
 * a goal branch merges into that branch wherever this machine stands; `into` absent on
 * the host case is a detached HEAD, which is the one condition where there is nowhere to
 * merge to at all. `undefined` means the preview has not answered yet.
 */
export const destination = (
  preview: MergePreviewDto | undefined,
): { readonly name: string; readonly note: string } | undefined => {
  if (preview === undefined) return undefined
  if (preview.parentId !== undefined)
    return { name: "its parent", note: "a child merges into its parent" }
  if (preview.goalBranch !== undefined)
    return { name: preview.goalBranch, note: "the branch its goal lands on" }
  if (preview.into === undefined)
    return { name: "nowhere", note: "this machine is not on a branch" }
  return { name: preview.into, note: "the branch this machine is on" }
}

/** The right-hand side of the move card: what is there, and whether an arrow points at it. */
interface ArrowEnd {
  readonly name: string
  readonly note: string
  /** Nothing went anywhere and nothing will, so there is no arrow and no destination. */
  readonly unmerged: boolean
}

const wentIn = (sha: string): ArrowEnd => ({
  name: sha,
  note: "the merge commit",
  unmerged: false,
})

const NOTHING_MERGED: ArrowEnd = {
  name: "nothing was merged",
  note: "the branch went with the archive",
  unmerged: true,
}

/** Where the work is going, or the ellipsis while the preview is still answering — the
 *  two states that still have a merge ahead of them. */
const headedFor = (
  into: { readonly name: string; readonly note: string } | undefined,
): ArrowEnd => ({
  name: into?.name ?? "…",
  note: into?.note ?? "asking where this would go",
  unmerged: false,
})

/**
 * What stands on the right of the arrow, at each of the six states — or nothing at all,
 * where the card has no right-hand side.
 *
 * **`destination` is a different question and this is not a wrapper for it.** That one
 * answers *where a merge would go*, which is the merge button's label and which only the
 * states still asking a preview have. This is the card's right-hand side, and there are
 * three answers rather than two: a destination with an arrow into it, words about where
 * the work *is* with the arrow withheld (`unmerged`), and — for a finished trak whose
 * branch never moved — no side at all.
 *
 * **`undefined` is emptiness, not absence-of-an-answer, and that is why it is not a third
 * `ArrowEnd`.** `NOTHING_MERGED` says *nothing was merged, the branch went with the
 * archive*, which is news at a trak somebody archived and a statement of the obvious at a
 * trak that never wrote anything — the card's own `0 commits` has already said it, one
 * line to the left. Nothing replaces it: the left column stands alone rather than
 * stretching, and `FinishedMove` draws the arrow and the whole right column or neither.
 *
 * **Once it is in, the merge commit is the answer and no branch is.** `Merged` carries no
 * destination on purpose — a merge goes wherever the host was standing, so which branch
 * took it is not a fact this app holds afterwards. Naming one would be inventing it, and
 * asking the preview would be asking where a merge that has already happened *would* go —
 * a question whose answer never arrives, because nothing offers a merge to ask about. The
 * sha is what the engine does report, and it is the one a person can go and look at.
 *
 * **`Closing` is both endings.** It carries the merge commit when it is the tail of a
 * merge and nothing when it is a plain close, because clearing the checkout up is the same
 * either way — so reading `merged` is what keeps the card from saying *nothing was merged*
 * for as long as removing a worktree takes.
 */
export const arrowEnd = (
  state: EndStateDto,
  /** `destination(preview)` — `undefined` until it answers, and where nothing asked. */
  into: { readonly name: string; readonly note: string } | undefined,
  /** Whether anything was kept on the branch — `branchMoved`, off the same log. */
  moved: boolean,
): ArrowEnd | undefined => {
  switch (state._tag) {
    // An archive that did not finish has no right-hand side: the wire does not carry a
    // merge's commit there, and *the branch went with the archive* may not be true yet.
    case "Failed":
      return state.kind === "archive" || !moved ? undefined : headedFor(into)
    case "Finished":
      return moved ? headedFor(into) : undefined
    case "Merging":
      return headedFor(into)
    case "Merged":
      return wentIn(state.sha)
    case "Closing":
      return state.merged === undefined ? NOTHING_MERGED : wentIn(state.merged)
    case "Closed":
      return NOTHING_MERGED
  }
}

/**
 * The forge merge press's words for a method — GitHub's own, so the person knows before
 * pressing whether main gets a merge commit, one squashed commit or the branch's commits
 * replayed. `short` is the confirmation's own press, `menu` the method's row in the menu
 * beside the press, and `verb` what auto-merge will do.
 */
export const pullMergeWords = (
  method: MergeMethod,
): {
  readonly label: string
  readonly short: string
  readonly menu: string
  readonly verb: string
  readonly does: string
} => {
  switch (method) {
    case "merge":
      return {
        label: "Merge pull request",
        short: "Merge",
        menu: "Create a merge commit",
        verb: "merge",
        does: "Every commit on the branch goes into main, under one merge commit.",
      }
    case "squash":
      return {
        label: "Squash and merge",
        short: "Squash",
        menu: "Squash and merge",
        verb: "squash and merge",
        does: "The branch’s commits go into main as one commit.",
      }
    case "rebase":
      return {
        label: "Rebase and merge",
        short: "Rebase",
        menu: "Rebase and merge",
        verb: "rebase and merge",
        does: "Each commit on the branch is replayed onto main, with no merge commit.",
      }
  }
}

/**
 * What the band's right-hand cell holds — the one press in the row that ends the trak, and
 * the only part of the row that changes as the forge and the preview answer.
 *
 * **The doors never move, so this is the whole of what can.** The row used to insert Merge
 * or a promoted Archive ahead of the doors once the forge answered, which shifted every
 * press after it and moved the loud one with it. Now the doors hold the left and this cell
 * holds the right edge: it starts as `checking` wherever the forge's answer can decide it,
 * and becomes a real press or gives way to the `⋯`.
 *
 * - `archive` — nothing left to decide: the forge says merged, a wait found the branch
 *   landed, or nothing was committed. **Landed counts as merged**, which it did not while
 *   the row read the forge alone. A held step takes this away, because archiving drops it.
 * - `checking` — the forge has not answered, and its answer is what picks Merge or not; or
 *   the coarse answer says a pull request is open and the pane's whole answer, which names
 *   the merge method and decides readiness, is still on its way.
 * - `mergePull` — a pull request is open, something committed, not landed: the press that
 *   merges it on the forge, drawn disabled until GitHub's verdict is `Mergeable`. **Checked
 *   ahead of the held step's rule**, because a step held on `merged` is the case this press
 *   helps most; Archive stays in the `⋯` beside it.
 * - `merge` — no pull request, something committed, not landed.
 * - `menu` — Archive is on offer and is a choice rather than the next step: a pull request
 *   closed, or a held step.
 * - `none` — the state offers no ending here.
 *
 * `merge` and `archive` are `controls.ts`'s answers for the state and nothing else; the
 * forge, the log and the wait are what this adds.
 */
export type EndingCell = "checking" | "mergePull" | "merge" | "archive" | "menu" | "none"

export const endingCell = (f: {
  /** `mergeOffered` for the state. */
  readonly merge: boolean
  /** `archiveOffered` for the state. */
  readonly archive: boolean
  /** `standingOf`, or `none` where nothing was committed and the forge is never asked. */
  readonly standing: Standing
  /** `branchMoved`. */
  readonly moved: boolean
  /** Whether a wait found the branch merged — the wire's `landed`. */
  readonly landed: boolean
  /** Whether a step is held on an unmet condition — the wire's `waiting`. */
  readonly waiting: boolean
  /** Whether the pane's whole answer about an open pull request is in hand — `pullMergeOf`. */
  readonly pull: boolean
}): EndingCell => {
  const settled = f.standing === "merged" || f.landed || !f.moved
  if (f.archive && settled && !f.waiting) return "archive"
  // `archive` is the route's one state as well: the forge merge is taken at `Finished` alone.
  if (f.archive && f.moved && !f.landed && f.standing === "open") {
    return f.pull ? "mergePull" : "checking"
  }
  const mergeable = f.merge && f.moved && !f.landed
  if (mergeable && f.standing === "unknown") return "checking"
  if (mergeable && f.standing === "none") return "merge"
  return f.archive ? "menu" : "none"
}

/**
 * The confirmation's one line — true of this trak, not a formula. The merged case is the
 * settled copy; the other two replace a sentence that asserted a merge commit which does
 * not exist there. The last is the `Finished && !moved` pile's own: *nothing on that
 * branch is kept* implies there was something to keep, and on that pile there never was.
 *
 * The drawer's Archive and the list row's both say it. **`merged` is `undefined` where
 * nobody asked the forge** — a row on the goal screen or in the palette — and the line
 * for a branch with work on it then says only what is true either way: what was merged
 * from it stays, which is nothing on a branch that never went in.
 *
 * A held step is a second sentence on whichever of the three is true, because it is a
 * second thing the press takes: the step that has not run, and everything behind it.
 */
export const archiveScope = (
  merged: boolean | undefined,
  moved: boolean,
  waiting: boolean,
): string => {
  const checkout = !moved
    ? "The checkout goes, and so does the branch — here and on GitHub. Nothing was ever committed to it."
    : merged === undefined
      ? "The checkout goes, and so do the branch and its copy on GitHub. Only what was merged from it stays."
      : merged
        ? "The checkout goes, and so do the branch and its copy on GitHub. The merge commit stays."
        : "The checkout goes, and so do the branch and its copy on GitHub. Nothing on that branch is kept."
  return waiting ? `${checkout} The step it is waiting to run never will.` : checkout
}
