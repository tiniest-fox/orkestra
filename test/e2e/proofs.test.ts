// `ork proofs`, end to end against real git: a checkout publishes the units its checks
// proved, and a second clone — CI, building the merge of the pull request — reads them
// back for one check. No engine runs on either side.

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { NodeProcessLayer } from "../../src/agent/adapters/process-node.js"
import { proofsCommand } from "../../src/app/proofs.js"
import { loadLibrary } from "../../src/library/adapters/library-fs.js"
import { SHIPPED_AGENTS } from "../../src/app/packaged.js"
import { GitCliLayer } from "../../src/vcs/adapters/git-cli.js"
import { Vcs } from "../../src/vcs/ports/vcs.js"
import { FilePassesLayer } from "../../src/workflow/adapters/passes-file.js"
import { Passes } from "../../src/workflow/ports/passes.js"
import { addOrigin, commitOnHost, git } from "../support/git.js"
import { testRepo } from "../support/vcs-fixture.js"

const checkFile = (description: string, units?: string): string =>
  `#!/bin/bash\n# ---\n# description: ${description}\n${units === undefined ? "" : `# units: ${units}\n`}# ---\n\nexit 0\n`

/** A pull request's branch holding two checks, one with `units:`, pushed to `origin`. */
const pullRequest = (repo: string) => {
  const origin = addOrigin(repo)
  git(repo, "checkout", "--quiet", "-b", "feature")
  mkdirSync(join(repo, ".orkestra", "checks"), { recursive: true })
  writeFileSync(join(repo, ".orkestra", "checks", "verify.sh"), checkFile("tests", "tests"))
  writeFileSync(join(repo, ".orkestra", "checks", "lint.sh"), checkFile("lint"))
  git(repo, "add", ".orkestra/checks")
  git(repo, "commit", "--quiet", "-m", "checks")
  git(repo, "push", "--quiet", "origin", "feature")
  return origin
}

/** What the engine would have kept for `verify` after a run on this checkout. */
const proveOnHost = (repo: string, units: readonly string[]) =>
  Effect.gen(function* () {
    const verify = (yield* loadLibrary(repo, SHIPPED_AGENTS)).checks.get("verify")
    if (verify === undefined) return yield* Effect.die("no verify")
    const tree = yield* (yield* Vcs).workingTree(undefined, false)
    const passes = yield* Passes
    const key = yield* passes.unitKeyOf(verify, tree)
    if (key === undefined) return yield* Effect.die("no unit key")
    yield* passes.prove(key, units)
  }).pipe(
    Effect.provide(
      Layer.merge(GitCliLayer(repo).pipe(Layer.provide(NodeProcessLayer)), FilePassesLayer(repo)),
    ),
  )

/** CI's checkout: the merge of the pull request into `main` as `origin` holds it. */
const mergeInCi = (elsewhere: string): void => {
  git(elsewhere, "fetch", "--quiet", "origin")
  git(elsewhere, "merge", "--quiet", "--no-ff", "--no-edit", "origin/feature")
}

const answer = (dir: string, args: readonly string[]) =>
  Effect.match(proofsCommand(dir, args), {
    onFailure: (e) => ({ refused: e.reason }),
    onSuccess: (a) => ({ out: a.out }),
  })

/** Why the command refused, or `""` where it did not. */
const refusal = (dir: string, args: readonly string[]) =>
  Effect.match(proofsCommand(dir, args), { onFailure: (e) => e.reason, onSuccess: () => "" })

const inRepo = <A>(body: (repo: string) => Effect.Effect<A, unknown>) =>
  Effect.runPromise(Effect.scoped(Effect.flatMap(testRepo, body)).pipe(Effect.orDie))

describe("ork proofs", () => {
  it("publishes a checkout's units, and CI reads them back for the merge of the same files", async () => {
    await inRepo((repo) =>
      Effect.gen(function* () {
        const origin = pullRequest(repo)
        yield* proveOnHost(repo, ["a.test.ts", "b.test.ts"])
        expect(yield* answer(repo, ["publish"])).toEqual({ out: [] })

        mergeInCi(origin.elsewhere)
        expect(yield* answer(origin.elsewhere, ["read", "--check", "verify"])).toEqual({
          out: ["a.test.ts", "b.test.ts"],
        })
        origin.remove()
      }),
    )
  })

  it("reads nothing once `main` has moved, because the merge holds other files", async () => {
    await inRepo((repo) =>
      Effect.gen(function* () {
        const origin = pullRequest(repo)
        yield* proveOnHost(repo, ["a.test.ts"])
        yield* answer(repo, ["publish"])

        commitOnHost(origin.elsewhere, "moved.md", "main moved\n")
        mergeInCi(origin.elsewhere)
        expect(yield* answer(origin.elsewhere, ["read", "--check", "verify"])).toEqual({
          out: [],
        })
        origin.remove()
      }),
    )
  })

  it("refuses to publish from a checkout with uncommitted files, naming them", async () => {
    await inRepo((repo) =>
      Effect.gen(function* () {
        const origin = pullRequest(repo)
        writeFileSync(join(repo, "loose.ts"), "export const a = 1\n")
        const refused = yield* refusal(repo, ["publish"])
        expect(refused).toContain("commit first")
        expect(refused).toContain("loose.ts")
        origin.remove()
      }),
    )
  })

  it("refuses to read for a check with no `units:`, or one that does not exist", async () => {
    await inRepo((repo) =>
      Effect.gen(function* () {
        const origin = pullRequest(repo)
        expect(yield* refusal(repo, ["read", "--check", "lint"])).toContain("declares no `units:`")
        expect(yield* refusal(repo, ["read", "--check", "typo"])).toContain("no check named `typo`")
        origin.remove()
      }),
    )
  })
})
