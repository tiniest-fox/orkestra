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

export interface ProjectFilesShape {
  /** The pair loaded last. */
  readonly current: Effect.Effect<ProjectFilesRead>
  /** Read both again and swap them in together — or, where either fails, swap neither. */
  readonly reload: Effect.Effect<void, ReloadFailed>
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
