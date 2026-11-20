// port: what the forge hosting this repository says about a branch.
//
// Apart from `Vcs` rather than a seventh method on it, because the two answer
// about different machines: `Vcs` asks git on this disk, and every one of its
// questions is about work that exists here. This one crosses the network to a
// service that may not be there at all, and that difference is the whole of the
// signature below — one method, no error channel, and *I could not ask* as a
// value rather than a failure.
//
// It writes two things. The merge of a pull request — for a trak a person or a goal set
// to merge itself, made once the forge says it would go in, and for a person's press on
// the finished band, which the forge itself accepts or refuses. And the one pull request
// a goal with a goal branch opens into the default branch when a person confirms it done. Approving, re-running a
// check, resolving a thread and replying to a comment are all deliberately absent: what
// this repository does with a review is re-enter the trak with it, so a forge we can
// otherwise write to would be a second way for work to happen.

import { Context, type Effect } from "effect"
import type {
  ForgeAnswer,
  ForgeListing,
  ForgeMerge,
  ForgeOpen,
  MergeMethod,
} from "../types/pull-request.js"
import type { BranchName } from "../types/worktree.js"

export interface ForgeShape {
  /**
   * The pull request that has this branch as its source, if the forge has one.
   *
   * **Found by asking, never by remembering.** A URL printed into a log by
   * whatever opened the pull request would put knowledge of one project's script
   * inside this engine, and it goes stale the moment somebody opens a second one
   * by hand. The branch is the key because the branch is the thing both sides
   * already agree on.
   *
   * **No error channel, and that is the contract rather than an omission.** A
   * missing CLI, an expired token, a repository on no forge at all, a network
   * that is down and a call that never comes back are all `Unavailable` — see
   * the type for why that is a different answer from `None`. A caller polls this
   * on a timer to draw a pane, so a failure here would be a red banner about
   * somebody's wifi over work that is perfectly fine. `ChecksShape.run` takes the
   * same shape for the same reason.
   *
   * The newest pull request when a branch has had several, which is what a branch
   * reopened after a close comes back as.
   */
  readonly pullRequest: (branch: BranchName) => Effect.Effect<ForgeAnswer>

  /**
   * What the forge says about many branches at once, coarsely, in one call.
   *
   * **Takes every branch and asks once, which is the point.** A caller with N
   * branches to draw asked the method above N times, which is N processes and N
   * network calls per poll over a set that only grows — the finished work a person
   * has not archived. This is one call whatever N is, and the caller matches the
   * entries back by `branch`.
   *
   * It is a different *shape* as well as a different question: `PullRequestSummary`
   * carries no comment, no review and no thread, and rolls the checks up to a word.
   * A caller that needs any of those is drawing one pull request and should ask for
   * it by branch.
   *
   * **Naming the branches is what makes an absence readable.** Ask the forge for its
   * pull requests instead and every connection it answers is bounded, so a branch
   * missing from the answer might have no pull request or might be past the page —
   * which a caller cannot tell apart and must therefore never read as a verdict.
   * Asked by name, an entry is written per branch and says which it is.
   *
   * **It is still bounded, and it says so by leaving branches out.** An implementation
   * may answer about fewer branches than it was handed; what it may never do is invent
   * an entry for one it did not ask about. See `ForgeListing`.
   *
   * Where the bound falls is `PULL_REQUEST_BRANCH_LIMIT` in the wire package, because a
   * surface asking has to stop at the same line for its request to be servable at all.
   * This side holds it anyway: a caller that never read that constant still gets a
   * bounded answer.
   *
   * **No error channel, for the reason above.**
   */
  readonly listing: (branches: readonly BranchName[]) => Effect.Effect<ForgeListing>

  /**
   * Merge the pull request that has this branch as its source, leaving the branch where it
   * is — the archive is what removes it. By `pick` where the repository and the base
   * branch's rules still allow it, and by the method the forge offers first otherwise: a
   * pick made on a trak can outlive a change to the repository's settings.
   *
   * **No error channel, for the reason above**, and a refusal is an answer rather than a
   * failure. The sweep has already read the pull request as mergeable, so its refusal is
   * the world moving between the two calls, and its next pass reads the world again; a
   * person's press leaves the verdict to the forge, so its refusal is the forge's answer.
   */
  readonly merge: (branch: BranchName, pick: MergeMethod | undefined) => Effect.Effect<ForgeMerge>

  /**
   * Open a pull request from `head` into `base` under `title` and `body`, or update the
   * open one there already is, so a second call leaves one pull request rather than two.
   * Nothing is merged. **No error channel, for the reason above**: a refusal and a forge
   * that could not be reached are both `Refused`, with the reason.
   */
  readonly openPullRequest: (
    head: BranchName,
    base: BranchName,
    title: string,
    body: string,
  ) => Effect.Effect<ForgeOpen>
}

export class Forge extends Context.Tag("vcs/Forge")<Forge, ForgeShape>() {}
