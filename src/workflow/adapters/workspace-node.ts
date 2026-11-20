// The projection and the corpus, on a real filesystem.
//
// Cleared and rewritten rather than written over, which is the port's contract
// and the only reason this is not two lines: `rm -rf` then write. Anything the
// previous projection left that the current one does not name is a document an
// agent could open and act on after the log stopped agreeing with it.
//
// It takes a start directory for the same reason `FileStoreLayer` does: the corpus
// lives inside `.orkestra`, and which project's `.orkestra` that is has to be the
// same answer the store gives, or a merge would file its record beside somebody
// else's logs.
//
// **A projection into a sandboxed checkout is one `tar -x` there**, through the
// `Sandboxes` the layer finds — this machine holds no such directory. It is a turn's or an
// effect's input, so it starts a stopped sandbox. With no runner file, or no `Sandboxes`
// at all, every projection is this machine's disk.

import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { Effect, Layer, Option } from "effect"
import { orkestraDir } from "../../library/adapters/library-fs.js"
import { Sandboxes, type SandboxesShape } from "../../vcs/ports/sandboxes.js"
import { Workspace, WorkspaceFailed, type WorkspaceShape } from "../ports/workspace.js"

/**
 * Where an ended trak's record is kept, inside `.orkestra` and **not**
 * dot-prefixed — unlike `.database` and `.worktrees`, which are the tool's own
 * bookkeeping. This is the output: a person is meant to find it, open it and grep
 * it. Gitignored all the same, by `Vcs.ensureIgnored`, because a corpus of how the
 * work went is not part of the work.
 */
const RECORDS = "records"

const why = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

const write = (dir: string, files: ReadonlyMap<string, string>): void => {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  for (const [name, content] of files) {
    const path = join(dir, name)
    // A key with a slash in it is a subdirectory, not an error: a piece's
    // documents land under the piece's name — see `pieceKey`.
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
}

const makeWorkspace = (root: string, sandboxes: Option.Option<SandboxesShape>): WorkspaceShape => {
  const replace = (dir: string, files: ReadonlyMap<string, string>) =>
    Effect.try({
      try: () => write(dir, files),
      catch: (cause) => new WorkspaceFailed({ reason: `could not project ${dir}: ${why(cause)}` }),
    })
  const project = (dir: string, files: ReadonlyMap<string, string>) =>
    Option.match(sandboxes, {
      onNone: () => replace(dir, files),
      onSome: (held) =>
        Effect.flatMap(held.placeOf(dir), (place) =>
          place === undefined
            ? replace(dir, files)
            : held
                .place(place, files, true)
                .pipe(
                  Effect.mapError(
                    (e) => new WorkspaceFailed({ reason: `could not project ${dir}: ${e.reason}` }),
                  ),
                ),
        ),
    })
  return {
    project,
    keepRecord: (folder, files) => replace(join(root, RECORDS, folder), files),
  }
}

export const NodeWorkspaceLayer = (startDir: string): Layer.Layer<Workspace, WorkspaceFailed> =>
  Layer.effect(
    Workspace,
    Effect.gen(function* () {
      const root = yield* orkestraDir(startDir).pipe(
        Effect.mapError((e) => new WorkspaceFailed({ reason: `${e.path}: ${e.reason}` })),
      )
      return makeWorkspace(root, yield* Effect.serviceOption(Sandboxes))
    }),
  )
