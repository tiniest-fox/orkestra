// What a condition's exit means, and what a deploy script printed. Pure, so the
// runtime asking at step entry and the daemon asking again on the interval read one
// answer from one place.
//
// The third meaning belongs to the `conditions:` list alone: a check keeps
// `exit 0 = pass` and nothing else, and an effect keeps `exit 0 = did it`. Only a
// script asked *whether the world has moved* has three things to say about it.

import { Either } from "effect"

export type ConditionAnswer = "met" | "unmet" | "stopped"

/**
 * `0` is met, `1` is not yet, and **any other code gives up**: the thing this condition
 * waits for is never going to happen, or the script cannot tell — a pull request
 * closed unmerged, a `gh` that is logged out, a crash. The trak stays where it is and
 * the engine stops asking; nothing is failed, because the work is not what went wrong,
 * and a push says the wait is over.
 *
 * `exitCode` is absent for a script that timed out or could not be spawned — see
 * `CheckOutcome` — and **absent is not yet, on purpose.** A hung poll or a checkout
 * that has gone is nothing the world said about the condition, and reading it as a
 * verdict either way would end a wait over an outage. Branching on the code alone,
 * never on `passed`, is what keeps that true.
 */
export const conditionAnswer = (exitCode: number | undefined): ConditionAnswer =>
  exitCode === 0 ? "met" : exitCode === undefined || exitCode === 1 ? "unmet" : "stopped"

/**
 * What `.orkestra/deploy.sh` said, read off its output: one JSON line carrying named
 * fields, and the rest as text.
 *
 * **The last line that parses as a JSON object wins**, because the output is stderr
 * then stdout — see `CheckOutcome` — and a script's diagnostics come first. A line
 * that is JSON but not an object is text like any other. The three fields a surface
 * draws are read by name and anything else on the object is dropped; a value that is
 * not a string is dropped too, rather than stringified into a link nobody can follow.
 */
export interface DeployOutput {
  readonly url?: string
  readonly version?: string
  readonly detail?: string
  /** Everything but the JSON line, in the order it was printed. */
  readonly text: string
}

const objectOf = (line: string): Record<string, unknown> | undefined => {
  const trimmed = line.trim()
  if (!trimmed.startsWith("{")) return undefined
  const parsed = Either.try((): unknown => JSON.parse(trimmed))
  if (Either.isLeft(parsed)) return undefined
  const value = parsed.right
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined
}

const stringAt = (fields: Record<string, unknown>, key: string): string | undefined => {
  const value = fields[key]
  return typeof value === "string" ? value : undefined
}

export const readDeployOutput = (output: string): DeployOutput => {
  const lines = output.split("\n")
  const at = lines.findLastIndex((line) => objectOf(line) !== undefined)
  if (at < 0) return { text: output.trim() }
  const fields = objectOf(lines[at] ?? "") ?? {}
  const url = stringAt(fields, "url")
  const version = stringAt(fields, "version")
  const detail = stringAt(fields, "detail")
  return {
    ...(url === undefined ? {} : { url }),
    ...(version === undefined ? {} : { version }),
    ...(detail === undefined ? {} : { detail }),
    text: lines
      .filter((_, i) => i !== at)
      .join("\n")
      .trim(),
  }
}
