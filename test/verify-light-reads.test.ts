// `.orkestra/checks/verify-light.sh`'s test stage on a file a test reads off disk rather
// than imports: a template, a shipped agent file and a check file. The repository and the
// run are `test/support/verify-light.ts`'s.

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { branch, testStage, verifyLight } from "./support/verify-light.js"

describe("verify-light, on a file a test reads off disk", () => {
  it("selects only the tests of the module that reads a template that changed", () => {
    const { dir, passed } = branch()
    writeFileSync(join(dir, "src", "prompts", "templates", "step.md"), "Do the step well.\n")
    expect(testStage(verifyLight(dir, passed))).toBe(
      "✓ pnpm test — test files: 1 ran, 0 already proven",
    )
  }, 60_000)

  it("selects the tests that read a shipped agent file that changed", () => {
    const { dir, passed } = branch()
    writeFileSync(join(dir, "src", "library", "shipped", "agents", "build.md"), "Build it well.\n")
    // `open-pr.test.ts`, which the table names as a reader of the fleet.
    expect(testStage(verifyLight(dir, passed))).toBe(
      "✓ pnpm test — test files: 1 ran, 0 already proven",
    )
  }, 60_000)

  it("selects the test that reads a check file that changed", () => {
    const { dir, passed } = branch()
    writeFileSync(
      join(dir, ".orkestra", "checks", "verify.sh"),
      `${readFileSync(join(dir, ".orkestra", "checks", "verify.sh"), "utf8")}\n`,
    )
    expect(testStage(verifyLight(dir, passed))).toBe(
      "✓ pnpm test — test files: 1 ran, 0 already proven",
    )
  }, 60_000)
})
