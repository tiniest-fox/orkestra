// Asserts against `src/ork.ts` read as TEXT, never imported.
//
// It cannot be imported: `process.argv` is read at module scope and a missing
// argument calls `process.exit(1)`, so an `import` here would end the test run
// rather than fail it. Reading the file is the same tier-1 shape
// `prompt.test.ts` uses on the templates — assert against the thing that ships,
// not against a copy of it.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ork.ts"), "utf8")

/**
 * Every subcommand the file actually dispatches on.
 *
 * `flatMap` rather than `map`, because a capture group is `string | undefined`
 * under this tsconfig — and dropping the impossible case beats asserting it away.
 */
const dispatched = [...source.matchAll(/cmdArg === "([a-z]+)"/g)].flatMap(([, name]) =>
  name === undefined ? [] : [name],
)

/** The `usage()` body, which is the only thing a mistyped command ever sees. */
const usage = source.slice(source.indexOf("const usage = "), source.indexOf("const requireArg"))

describe("ork's usage text", () => {
  it("names every subcommand the CLI dispatches on", () => {
    // **A real trak found this, by reading.** `merge` shipped in the header
    // comment and in the dispatch and never reached `usage()`: the edit that
    // added it was a string replace against a line `oxfmt` had since wrapped, so
    // it matched nothing and said nothing. A silent no-op is exactly the failure
    // a text assertion catches and a type checker cannot.
    expect(dispatched.length).toBeGreaterThan(0)
    for (const name of dispatched) expect(usage).toContain(`pnpm ork ${name}`)
  })

  it("names them in the header comment too, which is what a reader opens first", () => {
    const header = source.slice(0, source.indexOf("\n\n"))
    for (const name of dispatched) expect(header).toContain(`pnpm ork ${name}`)
  })
})
