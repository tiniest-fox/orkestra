/**
 * What the finished pane says about a trak's deploy — the words, the tone, the rows and
 * the steps a deploy holds — off the wire's `DeployDto`, `landed` and `waiting`.
 *
 * **Everything here reads the wire and predicts nothing.** Whether there is a commit to
 * ask about is `landed` and the state; whether a step is held on the deploy is
 * `waiting.name`, which is the engine's own vocabulary for the two waits it answers itself
 * — a second reading off the plan would be a copy of `waitingAt` free to disagree with it.
 *
 * **Three answers, three words, three tones — and a stopped wait ahead of all three.**
 * *Not live yet* is `working` for `HeldCard`'s reason — nobody owes a waiting trak
 * anything, so it is never amber. *Failed* is `bad`: a deploy that gave up is the more
 * interesting fact than the script's output, and the block leads with it. A wait that has
 * stopped asking beats the answer: the page's own route goes on running `deploy.sh` after
 * the sweep has dropped the wait, so the answer beside a stopped wait goes *live* once the
 * release lands, and a head reading *Live* in green would be the deploy about to release
 * the step — which nothing will. `headWords` reads the stop first and says *Gave up* in
 * `bad`, the word and tone the list row and the held card use for the same state.
 */

import type { DeployDto, LandedDto, PlanDto, TrakStateDto, WaitingDto } from "../../../api/types"
import type { Tone } from "../../../format/tone"

/** The member a block draws: the script ran, and said one of three things. */
export type DeployAnswer = Exclude<DeployDto, { answer: "none" }>

/** The one member with something to draw, or nothing — `none` is a trak with no deploy. */
export const deployRan = (answer: DeployDto | undefined): DeployAnswer | undefined =>
  answer === undefined || answer.answer === "none" ? undefined : answer

/**
 * Whether the page asks `deploy.sh` about this trak at all: there is a merge commit to
 * hand it. `landed` is a wait having found the branch merged; `Merged` is an archive that
 * ended the trak with one. Nothing else has a commit, so nothing else is asked — every
 * answer but `none` may run a script.
 */
export const deployAsked = (
  state: TrakStateDto | undefined,
  landed: LandedDto | undefined,
): boolean => landed !== undefined || state?._tag === "Merged"

/** The wait, where it is the deploy's — the block replaces the held card there. */
export const heldOnDeploy = (waiting: WaitingDto | undefined): WaitingDto | undefined =>
  waiting?.name === "deployed" ? waiting : undefined

export const deployWords = (
  answer: DeployAnswer["answer"],
): { readonly word: string; readonly tone: Tone } => {
  switch (answer) {
    case "live":
      return { word: "Live", tone: "good" }
    case "not-yet":
      return { word: "Not live yet", tone: "working" }
    case "gave-up":
      return { word: "Failed", tone: "bad" }
  }
}

/**
 * The head's word and tone: the stop where the wait has stopped asking, the script's
 * answer otherwise, and *Not live yet* before the script has run — the branch has not
 * merged, so nothing is live, which is what the held word says of it too.
 */
export const headWords = (
  answer: DeployAnswer["answer"] | undefined,
  stopped: boolean,
): { readonly word: string; readonly tone: Tone } =>
  stopped ? { word: "Gave up", tone: "bad" } : deployWords(answer ?? "not-yet")

/** A link's text: the address without its scheme, which is the part a person reads. */
export const shownUrl = (url: string): string => url.replace(/^https?:\/\//, "")

/**
 * The plan entries the deploy holds — the held one and everything behind it — each with
 * the mark the proposal card numbers it by. Empty where the detail has no plan yet.
 */
export interface HeldEntry {
  readonly mark: string
  readonly entry: PlanDto["steps"][number]
}

export const heldEntries = (waiting: WaitingDto, plan: PlanDto | undefined): readonly HeldEntry[] =>
  (plan?.steps ?? []).slice(waiting.step).map((entry, i) => ({
    mark: String(waiting.step + i + 1),
    entry,
  }))

/**
 * The head of the steps section: what the steps are to the deploy, and the condition in
 * mono. Each fact is said once — a stopped wait says here what the stop costs, so the
 * steps under it carry no status word of their own.
 */
export const heldHead = (
  waiting: WaitingDto,
  count: number,
): { readonly title: string; readonly fact: string } => ({
  title: "Waiting on this deploy",
  fact: waiting.stopped
    ? `${waiting.name} · stopped asking · archiving drops ${count > 1 ? "them" : "it"}`
    : waiting.name,
})
