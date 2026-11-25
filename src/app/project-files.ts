// The engine's `.orkestra/` and prompt templates, read at boot and again whenever a person
// asks for a reload — so an edited agent file reaches the next turn without a restart,
// and a restart's cost, every turn and process killed, is not paid for it.
//
// **Under an external store, `.orkestra/` is the commit `origin`'s default branch names in
// the cache checkout**, never the directory the engine was started in: nothing moves that
// directory, so a fix merged to the default branch would never reach the engine. The commit
// is read again after every git call that can move that branch (`refreshingVcs`), and the
// read is of the committed tree rather than the cache's working tree, which nothing moves
// either where there is no runner.

import { Clock, Effect, Layer, Ref } from "effect"
import { Lib } from "../library/ports/library.js"
import type { Library } from "../library/types/library.js"
import { loadLibrary } from "../library/adapters/library-fs.js"
import { SKILL_DIRS } from "../library/logic/agent-file.js"
import { loadTemplates } from "../prompts/adapters/builtin.js"
import { Prompts, type TemplateMissing } from "../prompts/ports/prompts.js"
import { LoadFailed } from "../library/types/errors.js"
import { makeNodeProcess } from "../agent/adapters/process-node.js"
import { committedFiles, defaultBranchTip, preparedCache } from "../vcs/adapters/git-cli.js"
import type { GitFailed } from "../vcs/types/errors.js"
import type { CommitSha } from "../vcs/types/worktree.js"
import { NO_RUNNER_FILES, type RunnerFiles, Runners } from "../vcs/ports/runners.js"
import { Vcs, type VcsShape } from "../vcs/ports/vcs.js"
import {
  ProjectFiles,
  type ProjectFilesRead,
  type ProjectFilesShape,
  type RefusedConfig,
  ReloadFailed,
} from "../workflow/ports/project-files.js"

/** The boot's line for an engine with no runner — every public engine's, which reads no runner file. */
export const NO_RUNNER_REPORT = "runner: none — every trak's work runs on this machine"

/**
 * How a hosted engine reads the project's runner and backup files beside each library it
 * reads, which a host may provide. A failure fails the read the
 * library is part of. Under an external store the library handed it is the one read out of
 * the commit, whose `root` is that copy — so the files are the commit's too.
 */
export type RunnerFilesRead = (library: Library) => Effect.Effect<RunnerFiles, LoadFailed>

/** Why a read would not load: a file of `.orkestra/`, or a template. */
type Unloaded = LoadFailed | TemplateMissing

/** What one read holds: the pair, and the runner files read beside it where there is a reader. */
interface Held {
  readonly pair: ProjectFilesRead
  readonly runners: RunnerFiles | undefined
  /** Under an external store, the commit read; `undefined` for an empty `.orkestra/`. */
  readonly commit: CommitSha | undefined
}

/** Where every read of one engine comes from, and what it is served as. */
interface Reading {
  readonly shipped: string
  readonly templates: string
  readonly runners: RunnerFilesRead | undefined
}

/**
 * One read of the `.orkestra/` the walk-up from `dir` finds. `root`, where given, is what the
 * library is served as being under, in place of the directory it was read from.
 */
const readAt = (
  reading: Reading,
  dir: string,
  root: string | undefined,
  commit: CommitSha | undefined,
) =>
  Effect.flatMap(
    Effect.all({
      library: loadLibrary(dir, reading.shipped),
      templates: loadTemplates(reading.templates),
    }),
    (read) => {
      const pair = root === undefined ? read : { ...read, library: { ...read.library, root } }
      return reading.runners === undefined
        ? Effect.succeed<Held>({ pair, runners: undefined, commit })
        : Effect.map(
            reading.runners(read.library),
            (files): Held => ({ pair, runners: files, commit }),
          )
    },
  )

/** A git failure under the cache checkout, as the loader's callers read a failed boot. */
const unread =
  (cache: string) =>
  (e: GitFailed): LoadFailed =>
    new LoadFailed({ path: cache, reason: e.message })

/**
 * Under an external store, where the reads come from: the commit `origin`'s default branch
 * names in the cache checkout now, and the read of one — `undefined` reading as an empty
 * `.orkestra/`.
 */
interface Source {
  readonly tip: Effect.Effect<CommitSha | undefined, GitFailed>
  readonly read: (commit: CommitSha | undefined) => Effect.Effect<Held, GitFailed | Unloaded>
}

const committedSource = (reading: Reading, project: string, cache: string) =>
  Effect.map(
    preparedCache(makeNodeProcess, project, cache),
    (repo): Source => ({
      tip: defaultBranchTip(makeNodeProcess, repo),
      read: (commit) =>
        Effect.flatMap(
          committedFiles(makeNodeProcess, repo, commit, [".orkestra", ...SKILL_DIRS]),
          // Served as the project's, so `deploy.sh` and a goal's composer run where they
          // always have rather than in the copy.
          (dir) => readAt(reading, dir, project, commit),
        ),
    }),
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
 * With `cache`, the engine's store is external and `cache` is its cache checkout: every read
 * is of the commit `origin`'s default branch names there, and a default branch with no
 * `.orkestra/` reads as an empty one. **A boot whose commit will not load does not fail**:
 * only another push can fix it, so the engine boots on an empty `.orkestra/` — the shipped
 * agents alone — and reports the refusal on `ProjectFiles.served`. Git failing does fail it,
 * as it fails `GitCliLayer`.
 *
 * One read at a time, so two presses cannot finish in the opposite order and leave the
 * older read held.
 */
export const ProjectFilesLayer = (
  cwd: string,
  shipped: string,
  templates: string,
  runners?: RunnerFilesRead,
  cache?: string,
) =>
  Layer.unwrapEffect(
    Effect.gen(function* () {
      const reading: Reading = { shipped, templates, runners }
      if (cache === undefined) {
        const boot = yield* readAt(reading, cwd, undefined, undefined)
        return yield* holding(boot, readAt(reading, cwd, undefined, undefined))
      }
      const source = yield* Effect.mapError(committedSource(reading, cwd, cache), unread(cache))
      const refused = yield* Ref.make<RefusedConfig | undefined>(undefined)
      const boot = yield* Effect.gen(function* () {
        const tip = yield* source.tip
        const read = yield* Effect.either(source.read(tip))
        if (read._tag === "Right") return read.right
        if (read.left._tag === "GitFailed") return yield* Effect.fail(read.left)
        yield* refuse(refused, tip, read.left)
        return yield* source.read(undefined)
      }).pipe(Effect.mapError((e) => (e._tag === "GitFailed" ? unread(cache)(e) : e)))
      return yield* holding(boot, { source, refused })
    }),
  )

/** Keep `e` as the last refused read of `commit`, and say so in the engine's log. */
const refuse = (
  refused: Ref.Ref<RefusedConfig | undefined>,
  commit: CommitSha | undefined,
  e: Unloaded,
) =>
  Effect.gen(function* () {
    yield* Effect.logWarning(
      `.orkestra/ on the default branch at ${commit ?? "no commit"} would not load and is not served: ${e.message}`,
    )
    if (commit === undefined) return
    const at = yield* Clock.currentTimeMillis
    yield* Ref.set(refused, { commit, reason: e.message, at })
  })

/** Under an external store, where reads come from and the last one refused. */
interface Committed {
  readonly source: Source
  readonly refused: Ref.Ref<RefusedConfig | undefined>
}

/**
 * The layers over `boot`, and the holder a read swaps: `from` is the read of the engine's own
 * checkout, or, under an external store, where the default branch's commits are read.
 */
const holding = (boot: Held, from: Effect.Effect<Held, Unloaded> | Committed) =>
  Effect.gen(function* () {
    const committed = Effect.isEffect(from) ? undefined : from
    const held = yield* Ref.make(boot)
    const permit = yield* Effect.makeSemaphore(1)
    /** Read `commit` and hold it, clearing any refusal; or keep the held pair and say why. */
    const readCommit = (
      c: Committed,
      commit: CommitSha | undefined,
    ): Effect.Effect<void, GitFailed | Unloaded> =>
      Effect.flatMap(
        Effect.either(c.source.read(commit)),
        (read): Effect.Effect<void, GitFailed | Unloaded> => {
          if (read._tag === "Right") {
            return Effect.zipRight(Ref.set(held, read.right), Ref.set(c.refused, undefined))
          }
          const e = read.left
          return e._tag === "GitFailed"
            ? Effect.fail(e)
            : Effect.zipRight(refuse(c.refused, commit, e), Effect.fail(e))
        },
      )
    const files: ProjectFilesShape = {
      current: Effect.map(Ref.get(held), (h) => h.pair),
      reload: permit.withPermits(1)(
        (Effect.isEffect(from)
          ? Effect.flatMap(from, (next) => Ref.set(held, next))
          : Effect.flatMap(from.source.tip, (tip) => readCommit(from, tip))
        ).pipe(Effect.mapError((e) => new ReloadFailed({ reason: e.message }))),
      ),
      refresh:
        committed === undefined
          ? Effect.void
          : permit.withPermits(1)(
              Effect.gen(function* () {
                const tip = yield* committed.source.tip
                const last = yield* Ref.get(committed.refused)
                if (tip === (yield* Ref.get(held)).commit || tip === last?.commit) return
                yield* readCommit(committed, tip)
              }).pipe(
                // A refusal is already logged and kept. Git failing is only logged, and the
                // next call that can move the branch asks again.
                Effect.catchAll((e) =>
                  e._tag === "GitFailed"
                    ? Effect.logWarning(`.orkestra/ was not read again: ${e.message}`)
                    : Effect.void,
                ),
              ),
            ),
      served:
        committed === undefined
          ? Effect.succeed(undefined)
          : Effect.map(Effect.all([Ref.get(held), Ref.get(committed.refused)]), ([h, r]) => ({
              ...(h.commit === undefined ? {} : { commit: h.commit }),
              ...(r === undefined ? {} : { refused: r }),
            })),
    }
    const pair = Layer.mergeAll(
      Layer.succeed(ProjectFiles, files),
      Layer.succeed(Lib, boot.pair.library),
      Layer.succeed(Prompts, boot.pair.templates),
    )
    return boot.runners === undefined
      ? pair
      : Layer.merge(
          pair,
          Layer.succeed(Runners, {
            current: Effect.map(Ref.get(held), (h) => h.runners ?? NO_RUNNER_FILES),
          }),
        )
  })

/**
 * `vcs`, with `ProjectFiles.refresh` after each call that can move `origin`'s default branch
 * in the repository it works in: a fetch, a pull or a reconcile, a push, a merge — which,
 * under an external store, lands on `origin` and fetches — a branch moved onto its base,
 * a goal branch cut, and a trak's work brought in, which under an external store pushes
 * `trak/<id>` and fetches. A refresh that finds the branch where it was costs two reads of
 * a ref, and nothing at all without an external store.
 */
export const refreshingVcs = <E, R>(
  vcs: Layer.Layer<Vcs, E, R>,
): Layer.Layer<Vcs, E, R | ProjectFiles> =>
  Layer.effect(
    Vcs,
    Effect.gen(function* () {
      const inner = yield* Vcs
      const { refresh } = yield* ProjectFiles
      const then =
        <A extends readonly unknown[], B, F>(call: (...args: A) => Effect.Effect<B, F>) =>
        (...args: A) =>
          Effect.tap(call(...args), () => refresh)
      return {
        ...inner,
        fetch: then(inner.fetch),
        pull: then(inner.pull),
        reconcile: then(inner.reconcile),
        stashAnd: then(inner.stashAnd),
        push: then(inner.push),
        merge: then(inner.merge),
        moveOntoBase: then(inner.moveOntoBase),
        createGoalBranch: then(inner.createGoalBranch),
        fetchWork: then(inner.fetchWork),
      } satisfies VcsShape
    }),
  ).pipe(Layer.provide(vcs))
