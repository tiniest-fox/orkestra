import { Context, Data, type Effect } from "effect"

export class WorkspaceFailed extends Data.TaggedError("WorkspaceFailed")<{
  readonly reason: string
}> {
  /** The reason, as the `Error` message — `NodeWorkspaceLayer` can fail a boot with
   * this, and `serve.ts` reports one by rendering the `Cause`. */
  override get message(): string {
    return this.reason
  }
}

/**
 * Writing the trak's own paperwork: into the directory a turn runs in, and into
 * the one a trak whose checkout is gone is kept in afterwards.
 *
 * The engine had no way to write a file: `Store` writes a log, `vcs/` does git,
 * and neither is a place to put a document an agent is meant to open. That is
 * what this is for and the whole of it — one directory, replaced outright.
 *
 * **Replaced, not written over.** The projection is rebuilt from the log before
 * every spawn, so it cannot drift from what the log says; leaving files no
 * longer in the map would make the directory a graveyard the moment work routes
 * backward, and a superseded artifact is a trap that fails the confident way —
 * work grounded in a version nobody can see was replaced.
 *
 * `dir` is absolute, because the caller knows the worktree and this does not.
 * A caller with nowhere to project — an offline demo, `pnpm real:compose` in the
 * human's own checkout — provides `NoWorkspaceLayer` rather than passing a flag:
 * which world a trak runs in is wiring, the same argument `NoVcsLayer` is built on.
 */
export interface WorkspaceShape {
  readonly project: (
    dir: string,
    files: ReadonlyMap<string, string>,
  ) => Effect.Effect<void, WorkspaceFailed>
  /**
   * One ended trak's folder in the corpus, replaced outright like a projection.
   *
   * `folder` is **relative to the corpus root and never absolute**, which is the
   * opposite of `project` and for the same reason: a worktree is a fact the caller
   * holds, and where this tool keeps things inside `.orkestra` is a fact the
   * adapter holds — the same split `store-file.ts` and `runs-file.ts` already make.
   *
   * It is also what keeps regeneration safe. The replacement is per trak, so a
   * caller can only ever clear one folder; asked for a day or the root it would
   * delete every sibling, and there is no argument here that can name either.
   */
  readonly keepRecord: (
    folder: string,
    files: ReadonlyMap<string, string>,
  ) => Effect.Effect<void, WorkspaceFailed>
}

export class Workspace extends Context.Tag("workflow/Workspace")<Workspace, WorkspaceShape>() {}
