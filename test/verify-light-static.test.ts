// `.orkestra/checks/verify-light.sh`'s static stages: which projects' tsc and oxlint run for
// each kind of change, and what a run reports when two stages running at the same time
// fail. The repository and the run are `test/support/verify-light.ts`'s, whose `tsc` and
// `oxlint` record what they were asked to check.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import { branch, lightRun, ranStatic, verifyLight } from "./support/verify-light.js"

/** The check's output and what its fake tools ran, after `path` changed on the branch. */
const afterEdit = (path: string): { lines: string[]; ran: string[] } => {
  const { dir, passed } = branch()
  mkdirSync(dirname(join(dir, path)), { recursive: true })
  writeFileSync(join(dir, path), "export const edited = true\n")
  return { lines: verifyLight(dir, passed).split("\n"), ran: ranStatic(dir) }
}

const WHOLE = [
  "./client: tsc --noEmit",
  "./desktop: tsc --noEmit",
  ".: oxlint client",
  ".: oxlint desktop",
  ".: oxlint src test shared",
  ".: tsc --noEmit",
  ".: tsc --noEmit -p shared",
]

describe("verify-light's static stages", () => {
  it("type-checks and lints only client for a client change", () => {
    const { lines, ran } = afterEdit("client/src/row.ts") // docs-check-ignore: a file the fixture gains
    expect(ran).toStrictEqual(["./client: tsc --noEmit", ".: oxlint client"])
    expect(lines).toContain("– pnpm check, not run: no changed file reaches a project it checks")
    expect(lines).toContain("✓ oxlint client")
    expect(lines).not.toContain("✓ oxlint desktop")
    expect(lines).toContain("✓ pnpm fmt:check")
    expect(lines).toContain(
      "– pnpm --filter @orkestra/desktop check, not run: no changed file reaches desktop",
    )
  }, 60_000)

  it("reaches the engine, client and desktop for a src change", () => {
    const { lines, ran } = afterEdit("src/row.ts") // docs-check-ignore: a file the fixture gains
    expect(ran).toStrictEqual([
      "./client: tsc --noEmit",
      "./desktop: tsc --noEmit",
      ".: oxlint client",
      ".: oxlint desktop",
      ".: oxlint src test shared",
      ".: tsc --noEmit",
    ])
    expect(lines).toContain("✓ tsc --noEmit")
    expect(lines).not.toContain("✓ tsc --noEmit -p shared")
    expect(lines).toContain("✓ oxlint src test shared")
    expect(lines).toContain("✓ pnpm --filter @orkestra/client check")
  }, 60_000)

  it("reaches the engine and desktop, and not client, for a test change", () => {
    const { lines, ran } = afterEdit("test/row.ts") // docs-check-ignore: a file the fixture gains
    expect(ran).toStrictEqual([
      "./desktop: tsc --noEmit",
      ".: oxlint desktop",
      ".: oxlint src test shared",
      ".: tsc --noEmit",
    ])
    expect(lines).toContain("✓ oxlint desktop")
    expect(lines).not.toContain("✓ oxlint client")
  }, 60_000)

  it("reaches every project for a shared change", () => {
    const { lines, ran } = afterEdit("shared/src/dto/fleet.ts")
    expect(ran).toStrictEqual(WHOLE)
    // Each part of a whole script is a stage of its own, under its own text.
    expect(lines).toContain("✓ tsc --noEmit -p shared")
    expect(lines).toContain("✓ oxlint desktop")
  }, 60_000)

  it("reaches every project for a file the reach rule does not list", () => {
    const { ran } = afterEdit("knip.json")
    expect(ran).toStrictEqual(WHOLE)
  }, 60_000)

  it("reports only the earlier of two failing stages, as a sequential run would", () => {
    const { dir, passed } = branch()
    const pkg = join(dir, "package.json")
    // fmt:check finishes last, so a report in finishing order would name lint.
    writeFileSync(
      pkg,
      readFileSync(pkg, "utf8")
        .replace(
          /"fmt:check": "[^"]*"/,
          '"fmt:check": "sleep 1; echo one file is not formatted; exit 1"',
        )
        .replace(/"lint": "[^"]*"/, '"lint": "echo lint found a problem; exit 1"'),
    )
    const { status, out } = lightRun(dir, passed)
    expect(status).toBe(1)
    // pnpm 12 echoes a failing script's command line before its output; earlier ones do not.
    expect(out.replace(/^\$ .*\n/m, "")).toBe(
      "`pnpm fmt:check` failed, and nothing after it ran.\n\none file is not formatted\n",
    )
  }, 60_000)
})
