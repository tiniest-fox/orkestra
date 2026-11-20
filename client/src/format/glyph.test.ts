/**
 * **The one test here that reads the repository**, and the reason is that nothing else
 * can check this.
 *
 * `.orkestra/agents/*.md` names the glyph each agent wears and the engine deliberately
 * refuses to know an icon set — `agent-file.ts` takes `icon:` as an opaque string, because
 * which library a surface draws from is not the engine's business. So the check has to
 * live where lucide does, which is here, and it has to read the files, because the value
 * being checked is in them.
 *
 * What it catches is a silent failure and the exact one `CLAUDE.md` records: a typo, a
 * renamed lucide icon, or a name in the wrong case draws the fallback and nothing else
 * goes wrong. Eight of the twelve values moved in one change, which is when that stops
 * being hypothetical.
 *
 * It asserts about *this project's* agents and about the ones the engine itself ships, which
 * is the one place a client test may know anything about either: the rule is that nothing
 * under `client/`, `src/` or `shared/` may carry which agents exist, and this carries none —
 * it reads the directories and checks whatever is in them.
 */

import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Terminal } from "lucide-react"
import { describe, expect, it } from "vitest"
import { glyphFor } from "./glyph"

// From `process.cwd()` rather than from `import.meta.url`: Vite rewrites the latter to
// an http URL under the test transform, so it cannot be resolved to a path. Vitest runs
// with its config's root as the working directory, which is `client/`.
const AGENTS = resolve(process.cwd(), "../.orkestra/agents")
// The agents the engine ships rather than the project writing them: the fleet, and
// `generic` beside it — the same `icon:` and the same silent failure, and the press
// `generic` draws on a trak at rest is on this surface.
const SHIPPED = resolve(process.cwd(), "../src/library/shipped")

/** The `icon:` line of an agent file, or `undefined` where it declares none. */
const iconIn = (body: string): string | undefined =>
  /^icon:[^\S\n]*(?<icon>\S+)[^\S\n]*$/mu.exec(body)?.groups?.["icon"]

const markdownIn = (dir: string): readonly string[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => `${dir}/${f}`)

// A project's file is an override, so it names `icon:` only where it changes the
// shipped one — and a file with none is not the typo this catches. A shipped file is the
// bottom layer, so it has to name one.
const files = markdownIn(AGENTS).filter((f) => iconIn(readFileSync(f, "utf8")) !== undefined)
const shipped = [...markdownIn(SHIPPED), ...markdownIn(`${SHIPPED}/agents`)]

describe("every agent file's icon:", () => {
  // The directories are the fixture, so an empty read is a passing suite that checked
  // nothing — the failure mode a filesystem test is most likely to have. Only the
  // shipped read is asked: a project whose overrides change no icon is an empty one.
  it("is read from a directory that has agents in it", () => {
    expect(shipped.length).toBeGreaterThan(0)
  })

  it.each([...files, ...shipped])("%s resolves to something lucide can draw", (file) => {
    const icon = iconIn(readFileSync(file, "utf8"))
    expect(icon).toBeDefined()
    // Not `toBeDefined` on the result: `glyphFor` is total and answers `Terminal` for a
    // name it cannot resolve, which is what a typo produces and what this exists to catch.
    expect(glyphFor(icon)).not.toBe(Terminal)
  })
})

describe("glyphFor", () => {
  it("falls back rather than throwing on a name lucide does not have", () => {
    expect(glyphFor("hamer")).toBe(Terminal)
    expect(glyphFor(undefined)).toBe(Terminal)
  })

  // The agent files are kebab and `icons` is keyed PascalCase, so the conversion is the
  // whole of what could silently stop matching. A three-word name is the case a
  // first-segment-only conversion would pass.
  it("converts a kebab name of any length to the key lucide holds it under", () => {
    expect(glyphFor("square-dashed")).not.toBe(Terminal)
    expect(glyphFor("fingerprint-pattern")).not.toBe(Terminal)
    expect(glyphFor("squaredashed")).toBe(Terminal)
  })
})
