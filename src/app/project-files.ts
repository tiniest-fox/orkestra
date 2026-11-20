// The engine's `.orkestra/` and prompt templates, read at boot and again whenever a person
// asks for a reload — so an edited agent file reaches the next turn without a restart,
// and a restart's cost, every turn and process killed, is not paid for it.

import { Effect, Layer, Ref } from "effect"
import { Lib } from "../library/ports/library.js"
import type { Library } from "../library/types/library.js"
import { loadLibrary } from "../library/adapters/library-fs.js"
import { loadTemplates } from "../prompts/adapters/builtin.js"
import { Prompts } from "../prompts/ports/prompts.js"
import type { LoadFailed } from "../library/types/errors.js"
import { NO_RUNNER_FILES, type RunnerFiles, Runners } from "../vcs/ports/runners.js"
import {
  ProjectFiles,
  type ProjectFilesRead,
  type ProjectFilesShape,
  ReloadFailed,
} from "../workflow/ports/project-files.js"

/** The boot's line for an engine with no runner — every public engine's, which reads no runner file. */
export const NO_RUNNER_REPORT = "runner: none — every trak's work runs on this machine"

/**
 * How a hosted engine reads the project's runner and backup files beside each library it
 * reads, which a host may provide. A failure fails the read the
 * library is part of.
 */
export type RunnerFilesRead = (library: Library) => Effect.Effect<RunnerFiles, LoadFailed>

/** What one read holds: the pair, and the runner files read beside it where there is a reader. */
interface Held {
  readonly pair: ProjectFilesRead
  readonly runners: RunnerFiles | undefined
}

const read = (
  cwd: string,
  shipped: string,
  templates: string,
  runners: RunnerFilesRead | undefined,
) =>
  Effect.flatMap(
    Effect.all({
      library: loadLibrary(cwd, shipped),
      templates: loadTemplates(templates),
    }),
    (pair) =>
      runners === undefined
        ? Effect.succeed<Held>({ pair, runners: undefined })
        : Effect.map(runners(pair.library), (files): Held => ({ pair, runners: files })),
  )

/**
 * `Lib` and `Prompts` as the boot read them, and `ProjectFiles` holding the pair a reload
 * swaps. A boot that cannot read either fails, as it always has; a reload that cannot is
 * an error to the person who pressed, and the pair already held goes on serving.
 *
 * With `runners`, `Runners` as well, answering the runner and backup files read beside the
 * pair held now and swapped with it. Without, no `Runners` is provided, and there is no
 * runner.
 *
 * One reload at a time, so two presses cannot finish in the opposite order and leave the
 * older read held.
 */
export const ProjectFilesLayer = (
  cwd: string,
  shipped: string,
  templates: string,
  runners?: RunnerFilesRead,
) =>
  Layer.unwrapEffect(
    Effect.gen(function* () {
      const boot = yield* read(cwd, shipped, templates, runners)
      const held = yield* Ref.make(boot)
      const permit = yield* Effect.makeSemaphore(1)
      const files: ProjectFilesShape = {
        current: Effect.map(Ref.get(held), (h) => h.pair),
        reload: permit.withPermits(1)(
          read(cwd, shipped, templates, runners).pipe(
            Effect.mapError((e) => new ReloadFailed({ reason: e.message })),
            Effect.flatMap((next) => Ref.set(held, next)),
          ),
        ),
      }
      const pair = Layer.mergeAll(
        Layer.succeed(ProjectFiles, files),
        Layer.succeed(Lib, boot.pair.library),
        Layer.succeed(Prompts, boot.pair.templates),
      )
      return runners === undefined
        ? pair
        : Layer.merge(
            pair,
            Layer.succeed(Runners, {
              current: Effect.map(Ref.get(held), (h) => h.runners ?? NO_RUNNER_FILES),
            }),
          )
    }),
  )
