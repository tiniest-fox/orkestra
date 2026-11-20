import { Data } from "effect"

/**
 * A `.orkestra` directory that cannot be loaded. One error for every cause —
 * missing directory, unreadable file, bad YAML, failed validation — because the
 * caller's response is identical in every case: print `path: reason` and stop.
 * Loading happens once, at startup, so nothing downstream branches on which.
 */
export class LoadFailed extends Data.TaggedError("LoadFailed")<{
  /** Relative to the `.orkestra` directory, or absolute for the directory itself. */
  readonly path: string
  readonly reason: string
}> {
  /**
   * That `path: reason` line, as the `Error` message — so a reporter that renders a
   * `Cause` rather than reading the fields gets it for free. Without this, `Cause.pretty`
   * falls back to `Data.TaggedError`'s default and says "LoadFailed: An error has
   * occurred", which names nothing and points at nothing. That is what `pnpm serve`
   * prints when a `.orkestra/` will not load, and it is the first thing anyone pointing
   * `--dir` at another repository meets.
   */
  override get message(): string {
    return `${this.path}: ${this.reason}`
  }
}
