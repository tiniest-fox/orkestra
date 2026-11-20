/**
 * Where a proposed plan's order splits into *now* and *later*.
 *
 * A step whose agent lists `conditions:` does not start until the engine says each one
 * holds — a pull request merged, a deploy live, a project script answering 0 — so every
 * entry below it in the plan runs later too. The proposal card draws that split as a
 * rule across the list, and these are the rules for where one goes:
 *
 * - **A condition draws a rule the first time an entry waits on it**, and never again.
 *   A later step re-declaring `deployed` starts no new wait, so a second rule would say
 *   the plan pauses twice where it pauses once. A *different* condition is a new wait
 *   and draws its own rule, so a plan can carry several.
 * - **A spawn declares nothing itself.** Its pieces do, and the entry after the spawn
 *   waits for every piece to finish, so a piece's conditions are fresh on that next
 *   entry rather than on the spawn. Inside the spawn each column is a plan of its own
 *   and starts its own list from empty: a piece's rule crosses its own column only.
 * - **A step's own `waitFor` is drawn on that step every time**, first, like a clock: it
 *   is the step's to remove at the gate, so a step repeating a name an earlier step drew
 *   names it again rather than leaving its wait with no rule to carry the press. Its
 *   agent's names still follow the first-time rule.
 * - **A clock is a rule of its own, and the card draws it off the entry.** `waitUntil` is
 *   the step's own rather than its agent's, so it never repeats and is never shared, and
 *   the card reads it straight off the entry above the condition rule this file places, so
 *   the clock's rule sits above the names'. It counts here.
 *
 * Pure over the plan and the library, so the card and the grid share one reading and a
 * test can hold the plan without rendering.
 */

import type { AgentDto, ChildDto, ComposerOutputDto } from "../../../api/types"

type Entry = Extract<ComposerOutputDto, { type: "proposal" }>["steps"][number]

/** The names an agent waits on, or none for a name the library does not hold. */
export const conditionsOf = (agents: readonly AgentDto[], name: string): readonly string[] =>
  agents.find((a) => a.name === name)?.conditions ?? []

/** What an agent step waits on: its own `waitFor` first, then its agent's, each name once. */
const stepWaits = (agents: readonly AgentDto[], entry: Extract<Entry, { type: "agent" }>) => [
  ...new Set([
    ...(entry.waitFor === undefined ? [] : [entry.waitFor]),
    ...conditionsOf(agents, entry.agent),
  ]),
]

/**
 * One list per step: the names it waits on that nothing above it in the same column
 * already waited on. Empty where the step draws no rule.
 */
export const columnWaits = (
  agents: readonly AgentDto[],
  steps: readonly ChildDto[],
): readonly (readonly string[])[] => {
  const seen = new Set<string>()
  return steps.map((step) => {
    const fresh = conditionsOf(agents, step.agent).filter((c) => !seen.has(c))
    for (const c of fresh) seen.add(c)
    return fresh
  })
}

/**
 * The same over the plan's top-level entries, where a spawn's pieces reach the entry
 * after the spawn. A re-compose declares nothing: it is the composer's own run.
 */
export const planWaits = (
  agents: readonly AgentDto[],
  entries: readonly Entry[],
): readonly (readonly string[])[] => {
  const seen = new Set<string>()
  let pending: readonly string[] = []
  return entries.map((entry) => {
    const own = entry.type === "agent" ? stepWaits(agents, entry) : []
    const fresh = [...new Set([...pending, ...own])].filter((c) => !seen.has(c))
    for (const c of fresh) seen.add(c)
    const waitFor = entry.type === "agent" ? entry.waitFor : undefined
    if (waitFor !== undefined && !fresh.includes(waitFor)) return [waitFor, ...fresh]
    pending =
      entry.type === "spawn"
        ? entry.children.flat().flatMap((c) => conditionsOf(agents, c.agent))
        : []
    return fresh
  })
}

/**
 * What one tile's condition rule draws at the plan gate: `fresh` from `planWaits` over the
 * plan as it would run, with the step's own `waitFor` laid back on once a person cleared it.
 *
 * Cleared, the name is struck — unless the step's agent file declares it too, which the
 * gate cannot remove, so it stays live. Read off `declared`, the agent's own list, never
 * off `fresh`: a name an earlier step drew is missing from `fresh` and still the agent's.
 */
export const tileWaits = (
  fresh: readonly string[],
  own: string | undefined,
  declared: readonly string[],
  cleared: boolean,
): { readonly names: readonly string[]; readonly struck: readonly string[] } => {
  if (own === undefined) return { names: fresh, struck: [] }
  const rest = fresh.filter((n) => n !== own)
  return !cleared || declared.includes(own)
    ? { names: [own, ...rest], struck: [] }
    : { names: rest, struck: [own] }
}

/**
 * Every step whose agent declares a condition, top level and inside pieces alike, and
 * every step with a clock or a `waitFor` of its own — the header's count. A step re-declaring a met
 * condition counts: it is still a step that cannot start until something outside the
 * checkout says so, and a clock is the same fact with the answer known.
 */
export const waitingCount = (agents: readonly AgentDto[], entries: readonly Entry[]): number =>
  entries.reduce((n, entry) => {
    switch (entry.type) {
      case "agent":
        return n + (stepWaits(agents, entry).length > 0 || entry.waitUntil !== undefined ? 1 : 0)
      case "spawn":
        return (
          n + entry.children.flat().filter((c) => conditionsOf(agents, c.agent).length > 0).length
        )
      case "compose":
        return n
    }
  }, 0)
