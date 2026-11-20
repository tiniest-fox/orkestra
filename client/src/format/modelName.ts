/**
 * How a model name off the wire is drawn: its bare name behind a mark for the CLI that
 * runs it. The rule below is the one this file is careful with.
 *
 * **The client may know the wire's grammar and never the list.** `<provider>/<name>`
 * qualifies a model with the CLI it runs on and a bare name runs on `claude` — that is
 * how `SessionRequest.model` reads at the other end, not something this project's
 * `models.yaml` chose. So this splits on the slash and carries one glyph per CLI, and
 * nothing here names a model: a sixth entry in the file adds no line here, and a third
 * CLI adds one.
 *
 * Kind `pure` — a `.ts` that imports two icons for a prop that takes a component, which
 * `client-style` allows a pure module.
 */

import type { LucideIcon } from "lucide-react"
import { Asterisk, SquareTerminal, Terminal } from "lucide-react"

/**
 * One glyph per CLI the engine spawns, keyed by the qualifier the wire uses for it. A bare
 * name is `claude`, which is why it is a key too.
 *
 * A `Map` rather than an object for `glyph.ts`'s reason: the key is a string off the wire,
 * and `.get` returns the `undefined` that is actually possible.
 */
const CLI_GLYPH = new Map<string, LucideIcon>([
  ["claude", Asterisk],
  ["codex", SquareTerminal],
])

/** The qualifier and the name, split once — `["codex", "gpt-5.6-sol"]`, or `["claude", "opus"]`. */
const split = (model: string): readonly [string, string] => {
  const at = model.indexOf("/")
  return at === -1 ? ["claude", model] : [model.slice(0, at), model.slice(at + 1)]
}

/** The name without its qualifier — what is drawn in place of the whole string. */
export const bareName = (model: string): string => split(model)[1]

/**
 * The mark the CLI that runs this model wears. A qualifier this client has no glyph for
 * draws the fallback `glyph.ts` uses for an agent it cannot place: *a CLI, and we cannot
 * say which* — never the Claude mark, which would be a claim.
 */
export const cliGlyph = (model: string): LucideIcon => CLI_GLYPH.get(split(model)[0]) ?? Terminal
