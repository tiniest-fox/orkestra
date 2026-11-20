/**
 * What the git bar says, worked out from what the engine reported and what the last press
 * earned — one view, drawn by the desktop strip, its card, the phone's dock and its sheet.
 *
 * The bar's rules are here rather than in a component: which one action the branch's state
 * calls for, whether Fetch waits behind the chevron, what a refused press is told, and
 * which press is the way through.
 *
 * **One action, chosen by the state.** Fetch while the branch is level or has not been
 * fetched, Pull behind, Push ahead, Reconcile where both have moved, Publish with no
 * upstream — and plain words in the cell's place where there is no origin or no branch.
 * Beside any action but Fetch, Fetch is in the chevron's menu.
 *
 * **A problem is something a press earned, or a failure the engine holds.** A refusal, a
 * press nothing answered, changes a stash kept, or the press git failed, which the engine
 * holds until that press next succeeds. What the checkout's own state needs saying — no
 * origin, a detached `HEAD`, no upstream, a diverged branch — is `standing`, said in the
 * card and never raised. The first three are about something a person just did, so they
 * stand over the engine's.
 *
 * **A notice rises only for what a press in this browser earned.** The engine records a
 * failure for the fetch a poll starts as well as for a press, and sends it with every
 * poll, to every tab, across a reload. One no press here earned is drawn already put
 * away — its title on the bar, its word on the band, its plate in the card — because a
 * notice over the list that nobody asked for, rising again at every failed fetch, is the
 * bar interrupting a person about a network they already know is down. `earnedAt` is
 * what tells the two apart: the `at` of the failure this session's last press came back
 * with, and no clock is compared, since the browser's and the engine's need not agree.
 *
 * **A dismissal is keyed, not a flag.** The engine sends its failure with every poll and
 * a second failure of the same press is a new one, so what is dismissed is one problem's
 * `key`: the press's own start for what a press earned, and the failure's `at`.
 */

import type { GitActionDto, HostGitDto, RefusalDto } from "../../../api/types"
import { refusalSaid } from "../../../format/refusal"

type Stamped = { readonly action: GitActionDto; readonly at: number }

/** What the last press came back with, when it has something to say. `at` is its start. */
export type Pressed =
  | (Stamped & { readonly refusal: RefusalDto })
  | (Stamped & { readonly unreachable: true })
  | (Stamped & { readonly stashed: readonly string[] })

/** The two presses a dirty tree refuses, which are the two that can run around a stash. */
export type Stashable = "pull" | "reconcile"

/** The way through a problem, where one press is. */
export type GitFix =
  | { readonly _tag: "Stash"; readonly action: Stashable; readonly label: string }
  | { readonly _tag: "Resolve"; readonly label: string; readonly description: string }

/** What the card says in a plate: the checkout's standing state, or a problem in full. */
export interface GitSaid {
  readonly tone: "neutral" | "waiting" | "bad"
  readonly title: string
  readonly body: string
  /** The files a refusal or a kept stash named, as git printed them. */
  readonly files: readonly string[]
}

export interface GitProblem extends GitSaid {
  readonly tone: "waiting" | "bad"
  /** What a dismissal names — see the file's note. */
  readonly key: string
  /** The one word the phone's band has room for once the notice is dismissed. */
  readonly word: "Refused" | "Conflict" | "Stashed" | "Failed"
  readonly fix: GitFix | undefined
}

/** The slot beside the upstream in the card: the counts, or why there can be none. */
export type GitCounts =
  | { readonly _tag: "Apart"; readonly ahead: number; readonly behind: number }
  | { readonly _tag: "Even" }
  | { readonly _tag: "None"; readonly said: "no origin" | "detached" | "not published" }

/** The bar's right end: the one action, or the words that stand where it would be. */
export type GitCell =
  | { readonly _tag: "None"; readonly said: "no origin" | "detached" }
  | {
      readonly _tag: "Press"
      readonly action: GitActionDto
      readonly verb: string
      readonly ahead: number
      readonly behind: number
      /** Running now — a spinner in place of the glyph, and nothing on the bar pressable. */
      readonly busy: boolean
    }

export interface GitView {
  /** The branch, or `HEAD` and a short sha for a detached checkout. */
  readonly head: string
  readonly detached: boolean
  /** `origin/main`, when the branch tracks one. */
  readonly upstream: string | undefined
  readonly counts: GitCounts
  /** Whether there is a remote to have fetched from — no age is drawn without one. */
  readonly origin: boolean
  /** When this engine last finished a fetch. Aged by `ageSaid` against a ticking clock. */
  readonly fetchedAt: number | undefined
  readonly cell: GitCell
  /** Fetch is behind the chevron, because the cell is another action. */
  readonly menu: boolean
  /** Nothing is running, so the cell, the chevron's Fetch and a fix may be pressed. */
  readonly idle: boolean
  readonly standing: GitSaid | undefined
  readonly problem: GitProblem | undefined
  /** A press here earned the problem and it has not been dismissed, so its notice is up. */
  readonly risen: boolean
}

const SHORT_SHA = 7

const VERB: Record<GitActionDto, string> = {
  fetch: "Fetch",
  pull: "Pull",
  reconcile: "Reconcile",
  push: "Push",
}

const DONE: Record<GitActionDto, string> = {
  fetch: "Fetched",
  pull: "Pulled",
  reconcile: "Reconciled",
  push: "Pushed",
}

const plural = (n: number, one: string, many: string): string =>
  `${String(n)} ${n === 1 ? one : many}`

/** How long ago, in the strip's few characters. */
export const ago = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${String(minutes)} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)} h ago`
  return `${String(Math.floor(hours / 24))} d ago`
}

/** `2 min ago`, `not fetched yet`, or nothing for a checkout with no origin. */
export const ageSaid = (view: GitView, now: number): string | undefined => {
  if (!view.origin) return undefined
  if (view.fetchedAt === undefined) return "not fetched yet"
  return ago(Math.max(0, now - view.fetchedAt))
}

type Press = Extract<GitCell, { readonly _tag: "Press" }>

const press = (action: GitActionDto, verb: string, ahead: number, behind: number): Press => ({
  _tag: "Press",
  action,
  verb,
  ahead,
  behind,
  busy: false,
})

/** The action the branch's own state calls for, with nothing running. */
const resting = (git: HostGitDto): GitCell => {
  if (!git.origin) return { _tag: "None", said: "no origin" }
  if (git.head._tag === "Detached") return { _tag: "None", said: "detached" }
  if (git.upstream === undefined) return press("push", "Publish", 0, 0)
  const { ahead, behind } = git.upstream
  if (ahead > 0 && behind > 0) return press("reconcile", VERB.reconcile, ahead, behind)
  if (behind > 0) return press("pull", VERB.pull, 0, behind)
  if (ahead > 0) return press("push", VERB.push, ahead, 0)
  return press("fetch", VERB.fetch, 0, 0)
}

/**
 * The cell as drawn: the resting action, or what is running in its place. A press in
 * flight shows its own word, and is read before the engine's `fetching` because a pull
 * and a reconcile fetch first — the person pressed Pull, not Fetch.
 */
const cellOf = (git: HostGitDto, pending: GitActionDto | undefined): GitCell => {
  const rest = resting(git)
  if (rest._tag === "None") return rest
  if (pending !== undefined && pending !== "fetch") {
    return pending === rest.action
      ? { ...rest, busy: true }
      : { _tag: "Press", action: pending, verb: VERB[pending], ahead: 0, behind: 0, busy: true }
  }
  if (git.fetching || pending === "fetch") {
    return { _tag: "Press", action: "fetch", verb: "Fetching", ahead: 0, behind: 0, busy: true }
  }
  return rest
}

/**
 * The stash press for a dirty tree, named for the action the bar shows *now* rather than
 * the one that was refused: a poll since may have found the branch diverged, and a pull
 * around a stash would only be refused again.
 */
const stashFix = (cell: GitCell): GitFix | undefined => {
  if (cell._tag === "None") return undefined
  if (cell.action === "pull") return { _tag: "Stash", action: "pull", label: "Stash & pull" }
  if (cell.action === "reconcile")
    return { _tag: "Stash", action: "reconcile", label: "Stash & reconcile" }
  return undefined
}

const refused = (pressed: Stamped, refusal: RefusalDto, cell: GitCell): GitProblem => {
  const verb = VERB[pressed.action]
  const key = `press:${String(pressed.at)}`
  if (refusal._tag === "Dirty") {
    const fix = stashFix(cell)
    return {
      key,
      tone: "bad",
      title: `${verb} refused — ${plural(refusal.files.length, "file has", "files have")} uncommitted changes`,
      body:
        fix === undefined
          ? "Commit or stash them first."
          : `${fix.label} sets them aside, brings the branch up to date, and puts them back.`,
      files: refusal.files,
      word: "Refused",
      fix,
    }
  }
  if (refusal._tag === "Conflict")
    return {
      key,
      tone: "bad",
      title: `${verb} stopped — ${plural(refusal.files.length, "file conflicts", "files conflict")}`,
      body: "No merge was started, and this checkout is as it was.",
      files: refusal.files,
      word: "Conflict",
      fix: { _tag: "Resolve", label: "Resolve in a Trak", description: refusal.description },
    }
  return {
    key,
    tone: "bad",
    title: `${verb} refused`,
    body: refusalSaid(refusal),
    files: [],
    word: "Refused",
    fix: undefined,
  }
}

const earned = (pressed: Pressed, cell: GitCell): GitProblem => {
  if ("refusal" in pressed) return refused(pressed, pressed.refusal, cell)
  const key = `press:${String(pressed.at)}`
  if ("stashed" in pressed)
    return {
      key,
      tone: "waiting",
      title: `${DONE[pressed.action]} — your changes are in the stash`,
      body: "Putting them back would conflict with what came down. Run git stash pop in a terminal and settle these files.",
      files: pressed.stashed,
      word: "Stashed",
      fix: undefined,
    }
  return {
    key,
    tone: "bad",
    title: `${VERB[pressed.action]} did not reach the engine`,
    body: "Nothing answered the press, so nothing is known to have happened. Press again once the engine is back.",
    files: [],
    word: "Failed",
    fix: undefined,
  }
}

const failed = (failure: NonNullable<HostGitDto["failure"]>): GitProblem => ({
  key: `failure:${String(failure.at)}`,
  tone: "bad",
  title: `${VERB[failure.action]} failed`,
  body: failure.message,
  files: [],
  word: "Failed",
  fix: undefined,
})

const said = (title: string, body: string): GitSaid => ({
  tone: "neutral",
  title,
  body,
  files: [],
})

const standingOf = (git: HostGitDto): GitSaid | undefined => {
  if (!git.origin)
    return said("No remote named origin", "Add one in a terminal to fetch, pull or push.")
  if (git.head._tag === "Detached")
    return said(
      `HEAD is detached at ${git.head.sha.slice(0, SHORT_SHA)}`,
      "There is no branch to pull into or push from. Check one out in a terminal.",
    )
  if (git.upstream === undefined)
    return said(
      "No upstream",
      `Publish sends this branch to origin/${git.head.name} and tracks it.`,
    )
  const { name, ahead, behind } = git.upstream
  if (ahead > 0 && behind > 0)
    return said(
      `Diverged from ${name}`,
      `Reconcile merges the ${plural(behind, "commit", "commits")} on ${name} into your ${plural(ahead, "local commit", "local commits")}.`,
    )
  return undefined
}

const countsOf = (git: HostGitDto): GitCounts => {
  if (!git.origin) return { _tag: "None", said: "no origin" }
  if (git.head._tag === "Detached") return { _tag: "None", said: "detached" }
  if (git.upstream === undefined) return { _tag: "None", said: "not published" }
  const { ahead, behind } = git.upstream
  return ahead === 0 && behind === 0 ? { _tag: "Even" } : { _tag: "Apart", ahead, behind }
}

export const gitView = (
  git: HostGitDto,
  pressed: Pressed | undefined,
  pending: GitActionDto | undefined,
  /** The `key` of the problem a person dismissed, if they have dismissed one. */
  dismissed: string | undefined,
  /** The `at` of the engine-held failure a press of this session earned, if one did. */
  earnedAt: number | undefined,
): GitView => {
  const cell = cellOf(git, pending)
  const rest = resting(git)
  const problem =
    pressed === undefined
      ? git.failure === undefined
        ? undefined
        : failed(git.failure)
      : earned(pressed, rest)
  return {
    head: git.head._tag === "Branch" ? git.head.name : `HEAD ${git.head.sha.slice(0, SHORT_SHA)}`,
    detached: git.head._tag === "Detached",
    upstream: git.upstream?.name,
    counts: countsOf(git),
    origin: git.origin,
    fetchedAt: git.fetchedAt,
    cell,
    menu: rest._tag === "Press" && rest.action !== "fetch",
    // A fetch the engine is running, or any press in flight, holds everything: a pull or
    // a push pressed under a running fetch would race it for the same refs.
    idle: !git.fetching && pending === undefined,
    standing: standingOf(git),
    problem,
    risen:
      problem !== undefined &&
      problem.key !== dismissed &&
      (pressed !== undefined || git.failure?.at === earnedAt),
  }
}

/**
 * Whether `action` may be pressed now — the guard the hook holds as well as the control.
 * The cell's own action, or Fetch from the chevron's menu, and neither while anything
 * runs. A stash press is its action again, so it is the same question.
 */
export const pressable = (view: GitView, action: GitActionDto): boolean => {
  if (!view.idle || view.cell._tag === "None") return false
  return view.cell.action === action || (action === "fetch" && view.menu)
}
