// The Environment port's contract, written once and run against every implementation.
//
// Everything here is about the boundary between a project's env script and the spawn
// it is for: what comes back, where the script ran, and what a script that breaks
// costs. Each case supplies its own script, because the script IS the environment.

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, type Layer } from "effect"
import { describe, expect, it } from "vitest"
import type { Check } from "../../src/library/types/check.js"
import { Environment, EnvironmentFailed } from "../../src/workflow/ports/environment.js"

export interface EnvironmentUnderTest {
  readonly label: string
  /** The layer for a project whose env script is `script` — or none. */
  readonly layer: (script: Check | undefined) => Layer.Layer<Environment>
  readonly timeoutMs: number
}

/** A scratch directory the suite writes its scripts into. */
const scratch = mkdtempSync(join(tmpdir(), "orkestra-env-"))

const script = (name: string, body: string, timeoutSeconds = 10): Check => {
  const path = join(scratch, `${name}.sh`)
  writeFileSync(path, `#!/bin/bash\n# ---\n# description: ${name}\n# ---\n${body}\n`)
  return {
    name: "env",
    description: name,
    timeoutSeconds,
    askedEverySeconds: undefined,
    exclusive: false,
    cache: true,
    ignoresLinguistGenerated: false,
    units: undefined,
    cacheAcross: "platform" as const,
    path,
  }
}

const capturing =
  (c: EnvironmentUnderTest) =>
  (
    env: Check | undefined,
    cwd = scratch,
  ): Promise<Readonly<Record<string, string>> | EnvironmentFailed> =>
    Effect.runPromise(
      Effect.flatMap(Environment, (environment) => environment.capture(cwd)).pipe(
        Effect.merge,
        Effect.timeout(`${c.timeoutMs} millis`),
        Effect.provide(c.layer(env)),
      ),
    )

/** The failure's own account, and nothing for an answer that was not one. */
const reasonOf = (answer: Readonly<Record<string, string>> | EnvironmentFailed): string =>
  answer instanceof EnvironmentFailed ? answer.reason : ""

/** Run this against any Environment implementation. */
export const environmentContract = (c: EnvironmentUnderTest): void => {
  const capture = capturing(c)
  describe(`Environment contract: ${c.label}`, () => {
    it("captures nothing for a project without a script, and spawns nothing to do it", async () => {
      expect(await capture(undefined)).toEqual({})
    })

    it("answers what the script left exported, over what it inherited", async () => {
      const captured = await capture(script("exports", "export ORK_TEST_TOOL=from-env"))
      expect(captured).toMatchObject({ ORK_TEST_TOOL: "from-env" })
      // The inherited base comes back too, so a caller lays the answer over its own
      // environment rather than replacing it — PATH is the one every script builds on.
      expect(captured).toHaveProperty("PATH")
    })

    it("leaves what the script merely set, unexported, out", async () => {
      // The contract is exported variables: a loop counter or a temporary is the
      // script's own, and `mise env` and friends export what they mean to hand on.
      const captured = await capture(script("plain", "ORK_TEST_PLAIN=1"))
      expect(captured).not.toHaveProperty("ORK_TEST_PLAIN")
    })

    it("keeps a value with a newline in it whole", async () => {
      const captured = await capture(script("multi", `export ORK_TEST_MULTI=$'one\\ntwo'`))
      expect(captured).toMatchObject({ ORK_TEST_MULTI: "one\ntwo" })
    })

    it("is not confused by what the script prints", async () => {
      // `mise activate` and a chatty `.envrc` both print; what they print must not be
      // read as a variable, and must not corrupt the ones that are.
      const captured = await capture(
        script("chatty", `echo "loading toolchain"; echo "FAKE=1"; export ORK_TEST_QUIET=yes`),
      )
      expect(captured).toMatchObject({ ORK_TEST_QUIET: "yes" })
      expect(captured).not.toHaveProperty("FAKE")
    })

    it("runs in the directory it was given, which is where a pin file is", async () => {
      // Found relative to `.` rather than by comparing $PWD: on macOS the scratch path
      // is under a symlink, so the shell's spelling and ours are both right.
      writeFileSync(join(scratch, "pin"), "")
      const captured = await capture(
        script("where", "test -f ./pin && export ORK_TEST_PINNED=found"),
      )
      expect(captured).toMatchObject({ ORK_TEST_PINNED: "found" })
    })

    it("strips the engine's own variables, however the script came by them", async () => {
      const captured = await capture(
        script("leaks", "export ORKESTRA_PROJECT_DIR=/elsewhere; export ELECTRON_RUN_AS_NODE=1"),
      )
      expect(captured).not.toHaveProperty("ORKESTRA_PROJECT_DIR")
      expect(captured).not.toHaveProperty("ELECTRON_RUN_AS_NODE")
    })

    it("fails on a non-zero exit, carrying the script's stderr — no fallback to the inherited environment", async () => {
      const failure = await capture(
        script("broken", `echo "mise: ruby 3.3.0 is not installed" >&2; exit 3`),
      )
      expect(failure).toMatchObject({ _tag: "EnvironmentFailed" })
      expect(reasonOf(failure)).toContain("exited 3")
      expect(reasonOf(failure)).toContain("mise: ruby 3.3.0 is not installed")
      expect(reasonOf(failure)).toContain("broken.sh")
    })

    it("fails a script that ends the shell before its variables are read, even cleanly", async () => {
      // `exit 0` ends the sourced shell with a clean exit and an empty dump, which is
      // also what a script with nothing to add produces. Judged by the exit code that
      // script would fall back to the inherited environment without a word.
      const clean = await capture(script("exits-clean", "export ORK_TEST_LOST=1; exit 0"))
      expect(clean).toMatchObject({ _tag: "EnvironmentFailed" })
      expect(reasonOf(clean)).toContain("before its variables could be read")
      expect(reasonOf(clean)).toContain("`return`")
      const bare = await capture(script("exits-bare", "export ORK_TEST_LOST=1; exit"))
      expect(bare).toMatchObject({ _tag: "EnvironmentFailed" })
      expect(reasonOf(bare)).toContain("before its variables could be read")
    })

    it("accepts a script that returns, which is how a sourced script ends early", async () => {
      const captured = await capture(script("returns", "export ORK_TEST_KEPT=1; return 0"))
      expect(captured).toMatchObject({ ORK_TEST_KEPT: "1" })
    })

    it("fails a script that never returns, and says so", async () => {
      const failure = await capture(script("hangs", "sleep 30", 1))
      expect(failure).toMatchObject({ _tag: "EnvironmentFailed" })
      expect(reasonOf(failure)).toContain("timed out")
    })

    it("fails a script it cannot run at all, the same way", async () => {
      const failure = await capture({
        name: "env",
        description: "not on disk",
        timeoutSeconds: 5,
        askedEverySeconds: undefined,
        exclusive: false,
        cache: true,
        ignoresLinguistGenerated: false,
        units: undefined,
        cacheAcross: "platform" as const,
        path: join(scratch, "nothing-here.sh"),
      })
      expect(failure).toMatchObject({ _tag: "EnvironmentFailed" })
    })
  })
}
