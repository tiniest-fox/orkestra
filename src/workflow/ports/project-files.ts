import { Context, Data, Effect, Option } from "effect"
import { Lib } from "../../library/ports/library.js"
import type { Library } from "../../library/types/library.js"
import type { Templates } from "../../prompts/index.js"
import { Prompts } from "../../prompts/ports/prompts.js"

/** The library and the templates as one pair, so a reader never holds one without the other. */
export interface ProjectFilesRead {
  readonly library: Library
  readonly templates: Templates
}

/** A reload read the files and they would not load; the pair already held still serves. */
export class ReloadFailed extends Data.TaggedError("ReloadFailed")<{
  readonly reason: string
}> {
  override get message(): string {
    return this.reason
  }
}

/** A read of the default branch's `.orkestra/` that would not load, and so is not served. */
export interface RefusedConfig {
  /** The commit whose `.orkestra/` would not load. */
  readonly commit: string
  /** The loader's line. */
  readonly reason: string
  /** When it was refused, epoch milliseconds. */
  readonly at: number
}

/** Under an external store, which commit's `.orkestra/` is served, and the last refused. */
export interface ServedConfig {
  /**
   * The default-branch commit whose `.orkestra/` is held; absent where none is — `origin`
   * names no default branch, or the boot's commit was refused and the shipped agents serve.
   */
  readonly commit?: string
  /** The last read that would not load, until a read after it loads. */
  readonly refused?: RefusedConfig
}

export interface ProjectFilesShape {
  /** The pair loaded last. */
  readonly current: Effect.Effect<ProjectFilesRead>
  /** Read both again and swap them in together — or, where either fails, swap neither. */
  readonly reload: Effect.Effect<void, ReloadFailed>
  /**
   * Under an external store, read again where `origin`'s default branch names a commit other
   * than the one served and the one last refused; nothing otherwise, and nothing at all
   * where the engine reads its own checkout. Called after every git call that can move that
   * branch. Never fails: a read that will not load is logged and kept as `refused`.
   */
  readonly refresh: Effect.Effect<void>
  /** Under an external store, what `ServedConfig` says; `undefined` where there is none. */
  readonly served: Effect.Effect<ServedConfig | undefined>
}

/**
 * The engine's swappable copy of `.orkestra/` and the templates.
 *
 * **Beside `Lib` and `Prompts` rather than in their place.** Those two stay the pair a
 * boot read, so a caller that provides a fixed library — a test, `ork`, a walkthrough —
 * provides nothing new. A unit of work takes the current pair at its start through
 * `withProjectFiles`, and an adapter built once reads it on each use through
 * `libraryNow`. Where this is absent, both answer with the boot pair.
 */
export class ProjectFiles extends Context.Tag("workflow/ProjectFiles")<
  ProjectFiles,
  ProjectFilesShape
>() {}

/**
 * Run `work` against the pair held now, read once at its start — so a reload during it
 * changes nothing it sees, and the next unit of work sees the new pair whole.
 */
export const withProjectFiles = <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.flatMap(Effect.serviceOption(ProjectFiles), (files) =>
    Option.match(files, {
      onNone: () => work,
      onSome: (held) =>
        Effect.flatMap(held.current, ({ library, templates }) =>
          work.pipe(Effect.provideService(Lib, library), Effect.provideService(Prompts, templates)),
        ),
    }),
  )

/**
 * How an adapter built once reads the library on each use: the held pair's, or the
 * boot's where nothing is held. Taken at build, so the reading needs nothing after.
 */
export const libraryNow: Effect.Effect<Effect.Effect<Library>, never, Lib> = Effect.gen(
  function* () {
    const boot = yield* Lib
    const files = yield* Effect.serviceOption(ProjectFiles)
    return Option.match(files, {
      onNone: () => Effect.succeed(boot),
      onSome: (held) => Effect.map(held.current, (read) => read.library),
    })
  },
)
