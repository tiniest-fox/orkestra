/**
 * One `TrakStateDto` → what the *engine* is doing at this position, or `undefined` where
 * the thing working is an agent, a person, or nothing at all.
 *
 * **Eight states, and the block takes the whole pane at every one of them.** They are the
 * ones the engine reaches with a command of its own in flight — a checkout being made, a
 * commit, a spawn, a merge, a close, a script sending what a step filed — where nothing
 * else would say a `git` is running, and *Nothing has run here yet* would sit over a
 * position no agent will ever run at. `format/interrupted.ts`'s `commandInFlight` is the wider list
 * this is a subset of: `Composing` and `AgentWorking` are an agent's turns, `Stopping` the end of one, `CheckRunning` is handled
 * separately, and `Joining` draws nothing because a parent joining its pieces is standing
 * on a *piece's* row and covering that piece's work is what nothing here may do.
 *
 * **No line here is `trakLabel`'s phrase for the same state**, and the test beside this
 * pins it. That phrase is the list row's and the ending row's, and it says where a trak
 * *stands*; this block says what the engine is *doing*, in words of its own. A line here
 * that read the same would be two surfaces kept in step by hand.
 *
 * **The marks are `traks-list/stateIcon`'s answers for these eight**, as lucide components
 * because that is what `EmptyState.icon` takes. It is deliberately not an import of that
 * module: it answers with an `IconName` that only `TrakIcon` can draw, and a
 * `trak-detail/` reaching into `traks-list/` would be the first cross-feature import, which
 * `client-style` says there is never a good first one of. What must not drift is the
 * *decision*, and these six are it.
 *
 * Beside the view that draws it rather than in `format/`, for `finished.ts`'s reason: one
 * feature draws this. It moves to `format/` on a second use and not before.
 */

import {
  Archive,
  CircleDashed,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  GitMerge,
  Send,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { PlanDto, PreparingPhaseDto, TrakStateDto } from "../../api/types"
import { phaseWords } from "../../format/preparing"

/** The block, in the two faces one act has: being done, and stopped part-way through. */
export interface EngineWork {
  /** The state's own mark — `stateIcon`'s answer, as the component `EmptyState` takes. */
  readonly icon: LucideIcon
  /** What is being done, while something is carrying the trak. */
  readonly doing: string
  /**
   * The line under `doing`. A band never shows a heading on its own — `EmptyState`'s
   * two-line rule — and this is the sentence that keeps the working face to it; the
   * stopped face takes `stoppedWords.line` instead. It names nothing the client does not
   * hold: no path, no script, no destination branch.
   */
  readonly sentence: string
  /** The same act, where nothing is — the title the stopped face wears. */
  readonly stopped: string
  /**
   * The engine's one fact, in the mono chip: the branch it is committing onto, or the
   * command it is running. `undefined` where the client holds no such fact.
   */
  readonly command: string | undefined
}

/**
 * Committing a step's work, committing the last of it and keeping the work of a trak
 * somebody gave up on are the same act at three positions — `trakLabel` gives two of them
 * the same phrase for that reason, and the mark is what separates the third.
 */
const KEPT = {
  doing: "Keeping the work on the branch",
  sentence:
    "Everything this step changed is being committed, so it survives whatever happens to the checkout.",
  stopped: "Stopped while committing the work",
} as const

/**
 * How many pieces a spawn is putting out, off the plan entry it is at.
 *
 * The engine has written no `ChildrenSpawned` yet — that event is what `Spawning` is on its
 * way to — so the plan is the only thing that can say, and `Spawning.step` is the entry.
 * `undefined` for a plan that has not loaded, and for an entry that is not a spawn, which
 * is a shape the engine cannot produce and is not worth a guess either way.
 */
const piecesAt = (plan: PlanDto | undefined, step: number): number | undefined => {
  const entry = plan?.steps[step]
  return entry?.type === "spawn" ? entry.children.length : undefined
}

/**
 * The spawn's mono line: how many pieces, and the branch they are cut off.
 *
 * Both halves are optional and it says whichever it has, because neither absence is an
 * error — a piece count with no branch is still the fact worth reading, and a trak whose
 * detail has not brought a worktree back yet has no branch to name.
 */
const spawnLine = (pieces: number | undefined, branch: string | undefined): string | undefined => {
  const count =
    pieces === undefined ? undefined : `${String(pieces)} ${pieces === 1 ? "piece" : "pieces"}`
  const off = branch === undefined ? undefined : `off ${branch}`
  if (count === undefined) return off
  return off === undefined ? count : `${count}, ${off}`
}

/**
 * What the engine is doing here, or `undefined` where the pane draws what it always drew.
 *
 * Exhaustive over every state for `trakLabel`'s reason: a state the server grows must be a
 * compile error here rather than a position that quietly keeps saying *Nothing has run here
 * yet* while a command runs behind it.
 */
export const engineWork = (
  state: TrakStateDto,
  /** `TrakDetailDto.worktree?.branch`, read off the detail by the caller — nothing here
   *  needs the whole worktree, and its `path` is deliberately not drawn. */
  branch: string | undefined,
  /** The trak's own plan, for the one line that counts something in it. */
  plan: PlanDto | undefined,
  /** `TrakDetailDto.preparing` — which preparation a `Preparing` trak is in, where the engine said. */
  preparing: PreparingPhaseDto | undefined,
): EngineWork | undefined => {
  switch (state._tag) {
    // No mono line, and it is the one absence worth stating: the design sheet asked for
    // `.orkestra/.worktrees/<id> · pnpm install`, and neither half is a fact the client
    // holds. `worktree` is absent from the detail until the checkout exists, its path is
    // absolute and built by `src/vcs/logic/paths.ts`, and the setup script is the
    // project's own `.orkestra/worktrees/setup.sh`, which never crosses the wire.
    // The preparation's own words where the engine named one — a sandbox's line is the
    // runner file's description — and the whole act where it has not yet.
    case "Preparing": {
      const named = preparing === undefined ? undefined : phaseWords(preparing)
      return {
        icon: CircleDashed,
        doing: named?.label ?? "Making the checkout and running setup",
        sentence:
          named?.line ??
          "A branch of its own, checked out somewhere new, with the project's setup run against it.",
        stopped: "Stopped while making the checkout",
        command: undefined,
      }
    }
    case "Committing":
    case "Integrating":
      return { icon: GitCommitHorizontal, ...KEPT, command: branch }
    // No mono line, and it is the second absence worth stating: which scripts run here
    // is on the agent file, which never crosses the wire — and it must not, or every
    // surface would grow its own copy of what a project's agents declare.
    case "Effecting":
      return {
        icon: Send,
        doing: "Sending what this step filed, outside the checkout",
        sentence:
          "Opening a pull request, sending a message, handing something on — whichever this step asked for.",
        stopped: "Stopped part-way through sending it",
        command: undefined,
      }
    // The same words as the two above and `stateIcon`'s own different mark: what it does
    // to the work is identical, and where it is going is the mark's to say.
    case "Abandoning":
      return { icon: Archive, ...KEPT, command: branch }
    // The traks a composer handed off, named before the plan is entered. No mono line:
    // which branch they are cut from is on the card that offered the gate, and the
    // names are not known until this ends.
    case "HandingOff":
      return {
        icon: GitBranchPlus,
        doing: "Naming the traks the composer handed off",
        sentence:
          "Each one is opened on the default branch and runs on its own from there; nothing here waits on it.",
        stopped: "Stopped while naming the new traks",
        command: undefined,
      }
    case "Spawning":
      return {
        icon: GitBranch,
        doing: "A trak for each piece, with its own plan",
        sentence:
          "Each one gets a checkout of its own and runs from here without waiting on the others.",
        stopped: "Stopped while creating the pieces",
        command: spawnLine(piecesAt(plan, state.step), branch),
      }
    // `git merge --no-ff --no-verify -m <message> <branch>`, cut to the half that says what
    // is happening — and the title names no destination, because the engine merges into
    // whatever branch the machine is standing on, or into its parent for a piece. Neither
    // is a fact this surface can name without inventing it.
    case "Merging":
      return {
        icon: GitMerge,
        doing: "Putting the work in",
        sentence:
          "A merge commit rather than a squash, so this trak's history stays readable afterwards.",
        stopped: "Stopped while merging",
        command: "git merge --no-ff",
      }
    case "Closing":
      return {
        icon: Archive,
        doing: "Taking the checkout away",
        sentence:
          "The work is already on the branch; this is only the working copy coming off disk.",
        stopped: "Stopped while clearing up",
        command: "git worktree remove --force",
      }

    // An agent's turns, a person's answer, or a trak at rest — the pane draws what it
    // always drew. `Joining` and `AwaitingChildren` are the two here that are the engine
    // working and still draw nothing: at both, the row the trak is resting on belongs to
    // one of its pieces, and a parent covering a piece's work is what `DrawerPane`'s
    // page-notice split exists to avoid.
    case "Composing":
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "AgentWorking":
    // A kill is the engine's command, and it still takes no pane: the turn being ended is
    // what the person pressed Stop on, so it stays on screen with `SeamLine` under it.
    case "Stopping":
    case "CheckRunning":
    case "ConditionRunning":
    case "AwaitingHuman":
    case "AwaitingChildren":
    case "Joining":
    case "Finished":
    case "Closed":
    case "Merged":
    case "Abandoned":
    case "Failed":
      return undefined
  }
}
