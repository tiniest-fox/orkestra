// logic: a runner verb's failure, built from what the script left behind, and the one
// line of it a log or a terminal reads.

import type { RunnerFailure } from "../types/runner-failure.js"

/** What a runner verb left behind once it ended without doing its job. */
export interface VerbEnding {
  /** The runner file, relative to the project. */
  readonly file: string
  readonly verb: string
  readonly stderr: string
  /** The reason after `limited` on the result file, where the script wrote one. */
  readonly limited: string | undefined
  /** The reason after `lost` on the result file, where the script wrote one. */
  readonly lost: string | undefined
  /** The reason after `unreachable`: the provider's own API could not be reached. */
  readonly unreachable: string | undefined
  /** The reason after `absent`: the trak has no sandbox. */
  readonly absent: string | undefined
  /** The reason after `failed`: the provider refused the request, with its status. */
  readonly failed: string | undefined
}

/** The last line of `text` that holds anything, or `""` for none. */
export const lastLine = (text: string): string =>
  text
    .split("\n")
    .map((line) => line.trim())
    .findLast((line) => line !== "") ?? ""

/**
 * The failure a verb's ending describes. **A limit wins over a loss**: a script that
 * could not start a sandbox because the provider refused it reports both, and the limit
 * is the one a person can act on. An unreachable API wins over a loss, being the cause
 * of one.
 */
export const runnerFailureOf = (ending: VerbEnding): RunnerFailure => {
  const { file, verb, stderr } = ending
  if (ending.limited !== undefined)
    return { kind: "limited", said: ending.limited, file, verb, stderr }
  if (ending.unreachable !== undefined)
    return { kind: "unreachable", said: ending.unreachable, file, verb, stderr }
  if (ending.absent !== undefined)
    return { kind: "absent", said: ending.absent, file, verb, stderr }
  if (ending.lost !== undefined) return { kind: "lost", said: ending.lost, file, verb, stderr }
  if (ending.failed !== undefined)
    return { kind: "failed", said: ending.failed, file, verb, stderr }
  const said = lastLine(stderr)
  return { kind: "failed", said: said === "" ? "it printed nothing" : said, file, verb, stderr }
}

/**
 * Whether the runner could not reach the sandbox — its provider's API or the sandbox
 * itself — which says nothing of whether the command ran. Every retry on a dropped
 * connection asks this, so a script's `unreachable` is retried wherever its `lost` is.
 * **`absent` is not**: no wait brings a removed sandbox back, and a retry that ends in a
 * remake starts the trak again from an older commit with nothing saying so.
 */
export const isUnreached = (failure: RunnerFailure | undefined): boolean =>
  failure?.kind === "lost" || failure?.kind === "unreachable"

/** What each kind is, as the head of the line a log or a terminal reads. */
const HEADS: Readonly<Record<RunnerFailure["kind"], string>> = {
  limited: "the sandbox provider's limit was reached",
  unreachable: "the sandbox provider could not be reached",
  absent: "the sandbox is gone",
  lost: "the sandbox could not be reached",
  failed: "the runner failed",
}

/**
 * The failure as a reason: the kind and the sentence, then the runner file and verb, then
 * the whole of stderr where it says more than the sentence did.
 */
export const runnerReason = (failure: RunnerFailure): string => {
  const head = `${HEADS[failure.kind]}: ${failure.said} (${failure.file} ${failure.verb})`
  const rest = failure.stderr.trim()
  return rest === "" || rest === failure.said ? head : `${head}\n${rest}`
}
