/**
 * A ```walkthrough fence, read into the paths a reader steps through.
 *
 * ```
 * actors: View, Client, Engine
 *
 * path: During the turn
 * 1. The view asks
 *    at: View -> Client
 *    The view posts `tools/call`.
 * ```
 *
 * One `actors:` line first, then each `path:` and its numbered steps. An indented line
 * belongs to the step above it: `at:` names who the step is between, and every other one
 * is the step's body. A walkthrough with a single path may leave out its `path:` line.
 *
 * **`undefined` is the whole failure**, and the caller draws the fence as the source it
 * is. The text is what the agent wrote and what the next agent reads, so a walkthrough
 * that does not parse loses nothing by being shown as written — and a guess at what a
 * malformed one meant would draw a sequence nobody wrote.
 *
 * **Five actors at most**, because the track every row ends in is drawn at a width that
 * holds five lanes, and a sixth would be cut to a sliver.
 */

export const MAX_ACTORS = 5

/** One step: its title, the lanes it is between in order, and its words. */
export type WalkStep = {
  readonly title: string
  /** Lane indices into `Walk.actors`, never empty. A step on one lane stays inside it. */
  readonly at: readonly number[]
  readonly body: string
}

export type WalkPath = {
  /** Empty for the one path of a walkthrough that never named it. */
  readonly name: string
  readonly steps: readonly WalkStep[]
  /** The lanes no step of this path touches, which is how a path that ends early is told. */
  readonly unreached: readonly number[]
}

export type Walk = {
  readonly actors: readonly string[]
  readonly paths: readonly WalkPath[]
}

type Draft = { title: string; at: number[] | undefined; body: string[] }
type DraftPath = { name: string; steps: Draft[] }

const ACTORS = /^actors:(.*)$/
const PATH = /^path:(.*)$/
const STEP = /^\d+\.\s+(\S.*)$/
const AT = /^at:(.*)$/

/** `A -> B -> C` as lane indices, or `undefined` where one is not an actor. */
const lanesOf = (actors: readonly string[], text: string): number[] | undefined => {
  const lanes = text.split("->").map((name) => actors.indexOf(name.trim()))
  return lanes.includes(-1) ? undefined : lanes
}

/** An indented line, added to the step it continues. `false` where it cannot be. */
const continueStep = (
  actors: readonly string[],
  step: Draft | undefined,
  line: string,
): boolean => {
  if (step === undefined) return false
  const at = AT.exec(line)?.[1]
  if (at === undefined) {
    step.body.push(line)
    return true
  }
  if (step.at !== undefined) return false
  step.at = lanesOf(actors, at)
  return step.at !== undefined
}

const pathOf = (actors: readonly string[], draft: DraftPath): WalkPath | undefined => {
  const steps: WalkStep[] = []
  for (const step of draft.steps) {
    if (step.at === undefined) return undefined
    steps.push({ title: step.title, at: step.at, body: step.body.join(" ") })
  }
  if (steps.length === 0) return undefined
  const reached = new Set(steps.flatMap((step) => step.at))
  return {
    name: draft.name,
    steps,
    unreached: actors.flatMap((_, lane) => (reached.has(lane) ? [] : [lane])),
  }
}

const actorsOf = (line: string | undefined): string[] | undefined => {
  const listed = ACTORS.exec(line ?? "")?.[1]
  if (listed === undefined) return undefined
  const actors = listed.split(",").map((name) => name.trim())
  const sound =
    actors.length <= MAX_ACTORS && !actors.includes("") && new Set(actors).size === actors.length
  return sound ? actors : undefined
}

export const parseWalkthrough = (source: string): Walk | undefined => {
  const lines = source.split("\n").filter((line) => line.trim() !== "")
  const actors = actorsOf(lines[0]?.trim())
  if (actors === undefined) return undefined
  const drafts: DraftPath[] = []
  for (const line of lines.slice(1)) {
    const trimmed = line.trim()
    const path = PATH.exec(trimmed)?.[1]?.trim()
    const title = STEP.exec(trimmed)?.[1]?.trim()
    const indented = /^\s/.test(line)
    if (indented) {
      if (!continueStep(actors, drafts.at(-1)?.steps.at(-1), trimmed)) return undefined
    } else if (path !== undefined && path !== "") {
      drafts.push({ name: path, steps: [] })
    } else if (title !== undefined) {
      // A step before any `path:` opens the unnamed one, which only a walkthrough with
      // no named path may have.
      if (drafts.length === 0) drafts.push({ name: "", steps: [] })
      drafts.at(-1)?.steps.push({ title, at: undefined, body: [] })
    } else return undefined
  }
  const named = drafts.filter((draft) => draft.name !== "")
  if (named.length !== drafts.length && drafts.length > 1) return undefined
  if (new Set(named.map((draft) => draft.name)).size !== named.length) return undefined
  const paths = drafts.map((draft) => pathOf(actors, draft))
  if (paths.length === 0 || paths.includes(undefined)) return undefined
  return { actors, paths: paths.filter((path) => path !== undefined) }
}
