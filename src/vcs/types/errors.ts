import { Data } from "effect"
import type { RunnerFailure } from "../../agent/types/runner-failure.js"

/**
 * A git command that did not exit zero, or could not be spawned at all.
 *
 * One error for every cause, for the reason `LoadFailed` is one: the caller's
 * response is the same in each case — record `op: reason` on the trak and stop.
 * Nothing branches on *which* git command failed, because there is nothing
 * useful to do differently about `worktree add` versus `commit`.
 *
 * `Data.TaggedError`, not a bare `Error` subclass: `_tag` is what makes it
 * catchable by name and discriminable inside a union, and every other module's
 * errors are declared this way.
 */
export class GitFailed extends Data.TaggedError("GitFailed")<{
  /** What we were doing, in the caller's words: `create worktree`, `commit`. */
  readonly op: string
  readonly reason: string
  /** The runner verb that failed, where git was talking to a sandbox through one. */
  readonly runner?: RunnerFailure
  /**
   * Where a remake of the sandbox kept its uncommitted changes, where it failed before
   * putting them back — `refs/orkestra/carried/<trak>` in the project.
   */
  readonly carried?: string
}> {
  /** That `op: reason` line, as the `Error` message — `GitCliLayer` can fail a boot with
   * this, and `serve.ts` reports one by rendering the `Cause`. */
  override get message(): string {
    return `${this.op}: ${this.reason}`
  }
}
