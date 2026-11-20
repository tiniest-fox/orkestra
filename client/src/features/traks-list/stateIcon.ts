/**
 * One `TrakStateDto` → one mark, and whether it moves.
 *
 * Exhaustive for the same reason `trakLabel` is: a state the server grows must be a
 * compile error in the client rather than a row that draws nothing. It sits beside
 * `trakLabel` in spirit and in `traks-list/` in fact — the list is the only screen
 * that draws a glyph per state, and `client-style`'s rule is that a thing moves to
 * `format/` on its *second* use.
 *
 * **`running` is not decoration, and it is no longer the glyph's.** It is the only thing
 * on the list that moves, and it says one thing: *this is happening now and nobody is
 * being asked anything*. Two states earn it — an agent's turn and a check run — and it is
 * withheld from the other ten the engine is also mid-something in, because those come and
 * go faster than an eye can follow a moving edge. What it moves is the segment travelling
 * the plate's edge, never the glyph: on a working row the glyph belongs to the agent.
 * `TrakMark` is where the two meet, and nothing here spins.
 *
 * **A `Rung` replaces the glyph and the motion both.** What the forge says about a
 * finished trak's branch is a better answer to *what is this row* than `Finished` is, and
 * it is the same answer the pile is drawn from — so the two cannot disagree. The motion
 * comes with it because a `Finished` trak has no turn in flight and the forge's checks are
 * the only thing that can be running on one; *something is happening* is then said the
 * same way whether the checks are Orkestra's or GitHub's.
 *
 * **The marks are three families.** Git's own shapes are the branch's shape — merged,
 * draft, closed, behind. Shields are anything that checks, at any scale, which is why the
 * engine's own check run and its local checks gate wear one beside GitHub's CI. Triangles
 * are a person's verdict on the work, the hollow one being the verdict nobody has given
 * yet. Three sit outside all three families, each because it is the absence of a fact
 * rather than one: `flag`, because it marks where the plan ran out and claims nothing about
 * the branch — which is why the two finished piles wear the same one, and the words are all
 * that separate *Ready to merge* from RESOLVED's *Finished — nothing to merge*; `unplug`,
 * because we could not ask — the same mark the page wears when the engine itself cannot be
 * reached, at a smaller scale and meaning the same thing; and `circleDashed`, because a
 * mergeability the forge has not computed is not a fact about the branch. That last is
 * `Preparing`'s own mark and means the same thing at the other scale — nothing has settled
 * here yet — so a dashed ring under *In progress*, one under *In review*, the one on a
 * row nothing has come back for yet and the one on a trak held behind a condition
 * (`waitingRow`'s `rowMark`, composed over this) are all agreeing. `rocket` is no
 * state's at all: it is the *Waiting on deploy* section's own mark, on its header.
 *
 * The names are lucide's. `TrakIcon` maps each to the library's own component and is
 * keyed by `IconName`, which is the direction that keeps the decision here and the
 * drawing there.
 */

import type { TrakStateDto } from "../../api/types"
import type { Rung } from "./pullRung"

export type IconName =
  | "activity"
  | "archive"
  | "chevronRight"
  | "chevronsUpDown"
  | "circleDashed"
  | "circleX"
  | "clipboardCheck"
  | "eye"
  | "flag"
  | "gitBranch"
  | "gitCommit"
  | "gitMerge"
  | "gitPullRequestClosed"
  | "gitPullRequestDraft"
  | "history"
  | "key"
  | "messages"
  | "octagonAlert"
  | "question"
  | "rocket"
  | "send"
  | "shield"
  | "shieldAlert"
  | "shieldX"
  | "sparkles"
  | "spinner"
  | "square"
  | "triangle"
  | "triangleAlert"
  | "unlink"
  | "unplug"

export interface StateIcon {
  readonly icon: IconName
  readonly running: boolean
}

/**
 * Six asks wearing one state. `trakLabel` already gives them six sentences; six
 * marks is the same argument at icon size, and it is what an explicit glyph has to
 * mean if it means anything — one shape for all six would say only *somebody is
 * waiting*, which the tone already says.
 */
const gateIcon = (kind: Extract<TrakStateDto, { _tag: "AwaitingHuman" }>["kind"]): IconName => {
  switch (kind) {
    case "approval":
      return "eye"
    case "answers":
      return "question"
    // A shield, and the same one `CheckRunning` wears with the segment stopped: a gate
    // asking about checks is the check family's, not a fourth idea.
    case "checks":
      return "shieldAlert"
    // Not the triangle. That family is now a reviewer's verdict, and an amber stuck row
    // beside a red *Changes requested* one would be one shape meaning two things.
    case "stuck":
      return "octagonAlert"
    case "conversation":
      return "messages"
    // A key: the step is asking for one command to be let through.
    case "permission":
      return "key"
  }
}

/** The state's own mark, which is what a row without a rung wears — every row but a
 *  finished one whose branch the forge has answered for. */
const ownIcon = (state: TrakStateDto): StateIcon => {
  switch (state._tag) {
    case "Preparing":
      return { icon: "circleDashed", running: false }
    case "Composing":
      return { icon: "sparkles", running: false }
    case "AwaitingProposal":
      return { icon: "clipboardCheck", running: false }
    case "AwaitingComposerAnswers":
      return { icon: "question", running: false }
    case "AgentWorking":
      return { icon: "spinner", running: true }
    // The chat bar's stop, filled there and outlined here: a person pressed it, and the
    // segment moves because the engine is still ending the turn.
    case "Stopping":
      return { icon: "square", running: true }
    case "CheckRunning":
      return { icon: "shield", running: true }
    // A script asking about the world, before the step starts: the mark that means
    // *nothing has settled here yet*, moving, because a script is running and nobody
    // is being asked anything — the same reason a check run moves.
    case "ConditionRunning":
      return { icon: "circleDashed", running: true }
    case "AwaitingHuman":
      return { icon: gateIcon(state.kind), running: false }
    // A spawn before and during its children. `Joining` shares its mark with
    // `Merging` rather than with these two, because what it is doing is a merge.
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
      return { icon: "gitBranch", running: false }
    case "Joining":
    case "Merging":
      return { icon: "gitMerge", running: false }
    // Committing a step's work and committing the last of it are the same act at
    // two positions, and `trakLabel` gives them the same words for that reason.
    case "Committing":
    case "Integrating":
      return { icon: "gitCommit", running: false }
    // Not a commit's mark, because it is not a commit: this is the one state whose
    // work leaves the checkout, and the glyph is the only thing on the row that says
    // so at a glance.
    case "Effecting":
      return { icon: "send", running: false }
    // The archive: the two acts of putting a trak away, and all three states it
    // ends in. One mark for the whole Archived pile — which ending it was is the
    // label's to say, in words. A merged row that is *not* archived — the MERGED
    // chore pile — wears the rung's `gitMerge` instead, so the two cannot read
    // alike.
    case "Abandoning":
    case "Closing":
    case "Closed":
    case "Merged":
    case "Abandoned":
      return { icon: "archive", running: false }
    // Not an ending, and the mark says so: a finished trak is still holding its
    // checkout and waiting for a person. One flag for both readings of the state —
    // whether there is anything to merge is `trakLabel`'s to say, in words.
    case "Finished":
      return { icon: "flag", running: false }
    case "Failed":
      return { icon: "circleX", running: false }
  }
}

export const stateIcon = (state: TrakStateDto, rung?: Rung): StateIcon =>
  rung === undefined ? ownIcon(state) : { icon: rung.icon, running: rung.running }
