// `.orkestra/checks/verify-light.sh`'s test stage on code only a child process imports: a
// module of the engine a test starts, and a workspace package that engine imports. The
// repository and the run are `test/support/verify-light.ts`'s.

import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { git } from "./support/git.js"
import { branch, edited, json, testStage, verifyLight } from "./support/verify-light.js"

describe("verify-light, on code a test reaches through an engine it starts", () => {
  it("selects the test that starts an engine when a module the engine imports changed", () => {
    const { dir, out } = edited(join("src", "app", "expiry-sweep.ts"))
    // `engine-boot.test.ts`, through the engine it starts, which no test imports: the stage
    // reaches the module through the child process.
    expect(testStage(out)).toBe("✓ pnpm test — test files: 1 ran, 0 already proven")
    expect(existsSync(join(dir, "test", "e2e", "ran"))).toBe(true)
  }, 60_000)

  it("selects the test that starts an engine when a workspace package the engine imports changed", () => {
    const { dir } = branch()
    sharedPackage(dir)
    git(dir, "add", ".")
    git(dir, "commit", "-q", "-m", "the engine reads the shared package")
    const passed = git(dir, "rev-parse", "HEAD^{tree}")
    writeFileSync(join(dir, "shared", "src", "dto", "fleet.ts"), 'export const fleet = "three"\n')
    expect(testStage(verifyLight(dir, passed))).toBe(
      "✓ pnpm test — test files: 1 ran, 0 already proven",
    )
    expect(existsSync(join(dir, "test", "e2e", "ran"))).toBe(true)
  }, 60_000)
})

/**
 * A workspace package the fixture's engine imports by its name, linked into a
 * `node_modules` of the fixture's own as pnpm links one: this repository's packages beside
 * it, so the name resolves into the fixture rather than into this checkout.
 */
const sharedPackage = (dir: string): void => {
  mkdirSync(join(dir, "shared", "src", "dto"), { recursive: true })
  writeFileSync(
    join(dir, "shared", "package.json"),
    json({
      name: "@orkestra/shared",
      private: true,
      type: "module",
      exports: { "./dto/*": "./src/dto/*.ts" },
    }),
  )
  writeFileSync(join(dir, "shared", "src", "dto", "fleet.ts"), 'export const fleet = "one"\n')
  writeFileSync(
    join(dir, "test", "support", "fake-engine.ts"),
    'import { fleet } from "@orkestra/shared/dto/fleet"\nimport { gone } from "../../src/app/expiry-sweep"\n\nconsole.log(gone, fleet)\n',
  )
  rmSync(join(dir, "node_modules", "@orkestra"))
  mkdirSync(join(dir, "node_modules", "@orkestra"))
  symlinkSync(join("..", "..", "shared"), join(dir, "node_modules", "@orkestra", "shared"))
}
