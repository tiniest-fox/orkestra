// The stage runner's failure report, on failures written by hand: the caps and the forms
// a real vitest run is slow to reach. `test/check-stages.test.ts` has the report on a real run.

import { describe, expect, it } from "vitest"
import {
  CONSOLE_LINES,
  DETAILED,
  ERROR_LINES,
  failureReport,
  trimmedOutput,
} from "./check-stages.js"
import type { Failure } from "./check-stages.js"

const ROOT = "/repo"

const failing = (overrides: Partial<Failure> = {}): Failure => ({
  file: "/repo/packages/domain/test/dose.test.ts",
  name: "a dose > is due",
  errors: [
    {
      name: "AssertionError",
      message: "expected 1 to be 2 // Object.is equality",
      diff: "\u001b[32m- Expected\u001b[39m\n\u001b[31m+ Received\u001b[39m\n\n- 2\n+ 1",
      stacks: [
        { file: "/repo/node_modules/.pnpm/vitest/dist/index.js", line: 10, column: 3 },
        { file: "/repo/packages/domain/test/dose.test.ts", line: 12, column: 5 },
      ],
    },
  ],
  console: [],
  rerun: "pnpm test packages/domain/test/dose.test.ts -t 'is due'",
  ...overrides,
})

describe("failureReport", () => {
  it("names the file and test, the error and diff, the first frame in the checkout, and the rerun", () => {
    expect(failureReport(ROOT, [failing()])).toBe(
      [
        "FAIL packages/domain/test/dose.test.ts > a dose > is due",
        "    AssertionError: expected 1 to be 2 // Object.is equality",
        "",
        "    - Expected",
        "    + Received",
        "",
        "    - 2",
        "    + 1",
        "    at packages/domain/test/dose.test.ts:12:5",
        "  rerun: pnpm test packages/domain/test/dose.test.ts -t 'is due'",
        "",
      ].join("\n"),
    )
  })

  it("shows console output under its test, capped", () => {
    const output = Array.from({ length: CONSOLE_LINES + 5 }, (_, at) => `line ${at}\n`)
    const report = failureReport(ROOT, [failing({ console: output })]).split("\n")

    expect(report).toContain("  console:")
    expect(report).toContain(`    line ${CONSOLE_LINES - 1}`)
    expect(report).not.toContain(`    line ${CONSOLE_LINES}`)
    expect(report).toContain("    (5 more lines of console output)")
  })

  it("caps a long error", () => {
    const message = Array.from({ length: ERROR_LINES + 3 }, (_, at) => `part ${at}`).join("\n")
    const report = failureReport(ROOT, [failing({ errors: [{ message }] })]).split("\n")

    expect(report).not.toContain(`    part ${ERROR_LINES}`)
    expect(report).toContain("    (3 more lines of this error)")
  })

  it("names failures past the detailed few without their errors", () => {
    const failures = Array.from({ length: DETAILED + 2 }, (_, at) =>
      failing({ name: `test ${at}`, rerun: `pnpm test dose.test.ts -t 'test ${at}'` }),
    )
    const report = failureReport(ROOT, failures)

    expect(report.match(/AssertionError/g)).toHaveLength(DETAILED)
    expect(report).toContain(
      "2 more failing, without their errors:\nFAIL packages/domain/test/dose.test.ts > test 10\n  rerun: pnpm test dose.test.ts -t 'test 10'\n",
    )
  })

  it("says so for an error outside any test file, which has no rerun", () => {
    expect(
      failureReport(ROOT, [
        failing({ file: "", name: "", errors: [{ message: "boom" }], rerun: undefined }),
      ]),
    ).toBe("FAIL (outside any test file)\n    boom\n")
  })
})

describe("trimmedOutput", () => {
  it("drops pnpm's preamble and lifecycle lines, keeping a code frame's marked line", () => {
    const output = [
      "",
      "> @orkestra/client@ check /repo/client",
      "> tsc --noEmit",
      "",
      "lib/x.ts:1:7 - error TS2322: Type 'string' is not assignable to type 'number'.",
      "",
      '> 1 | const a: number = "x"',
      "",
      "",
      "/repo/client:",
      "\u001b[31m ELIFECYCLE \u001b[39m Command failed with exit code 2.",
      " ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @orkestra/client@ check: `tsc --noEmit`",
      "Exit status 2",
      "",
    ].join("\n")
    expect(trimmedOutput(output)).toStrictEqual([
      "lib/x.ts:1:7 - error TS2322: Type 'string' is not assignable to type 'number'.",
      "",
      '> 1 | const a: number = "x"',
    ])
  })

  it("keeps pnpm's other errors, which are the whole of what failed", () => {
    const refusal =
      " ERR_PNPM_VERIFY_DEPS_BEFORE_RUN  Cannot run because node_modules is out of date"
    expect(trimmedOutput(`${refusal}\n`)).toStrictEqual([refusal])
  })

  it("drops every duration and keeps the line it was on", () => {
    expect(
      trimmedOutput("lib/x.ts (0ms)\nFinished in 12ms on 3 files\nBuild failed in 1.2s\n"),
    ).toStrictEqual(["lib/x.ts", "Finished on 3 files", "Build failed"])
  })
})
