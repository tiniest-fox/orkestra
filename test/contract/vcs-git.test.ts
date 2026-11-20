// The git adapter against real git. Slower than the rest of the suite and worth
// it: this is the layer `pnpm ork` runs, and until it existed the only thing
// exercising a worktree was a second implementation written for the tests.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer, Logger } from "effect"
import { describe, expect, it } from "vitest"
import { NodeProcessLayer } from "../../src/agent/adapters/process-node.js"
import { Process } from "../../src/agent/ports/process.js"
import { GitCliLayer } from "../../src/vcs/adapters/git-cli.js"
import { Vcs } from "../../src/vcs/ports/vcs.js"
import { ChangeRange } from "../../src/vcs/types/worktree.js"
import { testRepo } from "../support/vcs-fixture.js"
import { recordingPreparation } from "../support/preparation.js"
import { type VcsUnderTest, vcsContract } from "./vcs.js"

const git: VcsUnderTest = {
  label: "git",
  repository: testRepo,
  layer: (repoDir) => GitCliLayer(repoDir).pipe(Layer.provide(NodeProcessLayer)),
  timeoutMs: 20_000,
}

// The git-only cases are in `vcs-git-only.test.ts`, `vcs-git-remote.test.ts` and
// `vcs-git-push.test.ts`, so the four files run beside each other rather than one after
// another.
vcsContract(git)

describe("the git adapter's own startup", () => {
  it("fails where there is no repository, rather than finding one further up", async () => {
    // `git` walks up until it finds a `.git`, so a wrong starting directory does
    // not error — it silently retargets whatever checkout encloses it, which is
    // how a test fixture ends up making branches in orkestra itself. The temp
    // dir is outside any checkout, so a layer
    // that resolves its root at startup is the thing that has to say no.
    const outside = mkdtempSync(join(tmpdir(), "orkestra-not-a-repo-"))
    const result = await Effect.runPromise(
      Effect.either(
        Effect.flatMap(Vcs, (vcs) => vcs.createWorktree("t1")).pipe(
          Effect.provide(GitCliLayer(outside).pipe(Layer.provide(NodeProcessLayer))),
        ),
      ),
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") expect(result.left.op).toBe("find repository")
  })
})

/**
 * Real git, except that `check-attr` is handed a flag it rejects — the way a git older than
 * a flag the adapter passes would answer.
 */
const attributesRefused = Layer.effect(
  Process,
  Effect.map(Process, (real) => ({
    ...real,
    spawn: (spec: Parameters<typeof real.spawn>[0]) =>
      real.spawn(
        spec.args[0] === "check-attr" ? { ...spec, args: ["check-attr", "--no-such-flag"] } : spec,
      ),
  })),
).pipe(Layer.provide(NodeProcessLayer))

describe("a slice whose attributes git will not read", () => {
  it("is sent whole and uncollapsed, and the log says why", async () => {
    const logged: string[] = []
    const logger = Logger.make(({ message }) => {
      logged.push(String(message))
    })
    const files = await Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(testRepo, (repo) =>
          Effect.gen(function* () {
            const vcs = yield* Vcs
            const worktree = yield* vcs.createWorktree("t1")
            writeFileSync(join(worktree.path, ".gitattributes"), "proof/** linguist-generated\n")
            mkdirSync(join(worktree.path, "proof"))
            writeFileSync(join(worktree.path, "proof", "shot.tsx"), "export const a = 1\n")
            yield* vcs.commitWork(worktree, "1-work")
            writeFileSync(join(worktree.path, "proof", "late.tsx"), "export const b = 2\n")
            const committed = yield* vcs.changes(ChangeRange.Branch({ worktree }))
            const uncommitted = yield* vcs.changes(ChangeRange.Uncommitted({ worktree }))
            return [...committed.files, ...uncommitted.files]
          }).pipe(
            Effect.provide(GitCliLayer(repo).pipe(Layer.provide(attributesRefused))),
            Effect.provide(Logger.replace(Logger.defaultLogger, logger)),
          ),
        ),
      ),
    )

    expect(files.map((f) => [f.path, f.omitted, f.hunks.length])).toEqual([
      [".gitattributes", undefined, 1],
      ["proof/shot.tsx", undefined, 1],
      ["proof/late.tsx", undefined, 1],
    ])
    expect(logged).toHaveLength(2)
    expect(logged[0]).toContain("changes sent uncollapsed: read attributes: git check-attr")
  })
})

describe("a checkout made on this machine", () => {
  it("is named as a local worktree while it is made, and made again where it went", async () => {
    const { seen, layer } = recordingPreparation()
    await Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(testRepo, (repo) =>
          Effect.gen(function* () {
            const vcs = yield* Vcs
            const worktree = yield* vcs.createWorktree("t1")
            expect(seen).toEqual(["t1:Checkout"])
            // A checkout that is there is not made again, and names nothing.
            expect(yield* vcs.remakeCheckout("t1")).toBeUndefined()
            expect(seen).toEqual(["t1:Checkout"])
            rmSync(worktree.path, { recursive: true, force: true })
            expect(yield* vcs.remakeCheckout("t1")).toMatchObject({ path: worktree.path })
            expect(seen).toEqual(["t1:Checkout", "t1:Checkout"])
          }).pipe(
            Effect.provide(
              GitCliLayer(repo).pipe(Layer.provide(Layer.merge(NodeProcessLayer, layer))),
            ),
          ),
        ),
      ),
    )
  })
})
