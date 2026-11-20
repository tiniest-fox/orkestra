/**
 * An agent's mark — the one place a name off the wire becomes something lucide can draw.
 *
 * **The map that stood here is gone on purpose.** It was keyed by agent name, which made
 * a directory a person edits into something a source file had to be edited alongside —
 * and it silently failed to be: `survey` drew the fallback for weeks because nobody
 * remembered to come back. `.orkestra/agents/*.md` says which glyph it wants and the wire
 * carries it, so nothing here knows any agent's name.
 *
 * In `format/` rather than beside one screen because three now ask: New Trak's grid, the
 * plan a trak draws down its middle and its edge, and the traks list. `glyph.test.ts` is
 * the other half — it reads the agent files and resolves every `icon:` in them, because a
 * typo draws the fallback and nothing else goes wrong.
 *
 * **The whole icon set is imported, and that is the cost of not knowing.** A name
 * arriving at runtime cannot be tree-shaken against, so the barrel adds ~127 KB gzip to
 * this bundle. Paid knowingly: this UI is served from `127.0.0.1`, where transfer is free
 * and the only real cost is parsing an inert record once.
 */

import type { LucideIcon } from "lucide-react"
import { icons, Terminal } from "lucide-react"
import type { AgentDto } from "../api/types"

/**
 * **A `Map` rather than indexing `icons` directly**, because the name is a string from
 * the wire and indexing wants a key of the union: asserting it into one claims the
 * library has an icon we have not checked for, which is the assertion lint's whole point.
 * `.get` returns the `undefined` that is actually possible.
 *
 * `icons` is keyed PascalCase where `lucide.dev` and the agent files are kebab, so the
 * name is converted rather than authored twice.
 */
const CATALOG = new Map<string, LucideIcon>(Object.entries(icons))

/** The glyph an `icon:` asks for, or the mark for one this library does not have. */
export const glyphFor = (icon: string | undefined): LucideIcon => {
  if (icon === undefined) return Terminal
  const pascal = icon
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")
  return CATALOG.get(pascal) ?? Terminal
}

/**
 * The mark one agent wears, by the name a plan entry or a summary calls it.
 *
 * A linear scan rather than a memoised index: the library is a dozen entries and this is
 * asked once per row, where a `Map` rebuilt each render would cost more than it saved.
 *
 * **`Terminal` covers three different absences and deliberately does not tell them
 * apart** — the agents query has not answered, the plan names an agent the library no
 * longer holds, or the agent asked for an icon lucide does not have. All three mean *a
 * turn, and we cannot say whose*, which is what the fallback draws. It reads as no agent
 * rather than as a thirteenth one, which is the property that matters.
 */
export const agentGlyph = (agents: readonly AgentDto[], name: string): LucideIcon =>
  glyphFor(agents.find((a) => a.name === name)?.icon)
