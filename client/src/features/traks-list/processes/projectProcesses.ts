/**
 * What the project checkout's processes say on the git bar. The strip's cell carries a tally, the
 * phone sheet's switch a short mark and the dock's tab a count, and **a failure outranks a
 * count of what is up**: the mark reads "1 down" before it reads "2 up", because a bare
 * number beside a failure's glyph read as that many failures.
 */

import type { HostedProcessDto } from "../../../api/types"
import { elapsedText } from "../../../format/activity"
import { hostedLive, hostedWord, onPageOrigin, type PageOrigins } from "../../../format/hosted"

/**
 * Where a row's link opens, while its page is up: the page's own hostname behind a page
 * domain, which a phone or another machine can reach, else the loopback address the engine
 * reports, which only the machine running it can. A name too long for a hostname keeps
 * the loopback too.
 */
export const pageAddress = (
  process: HostedProcessDto,
  origins: PageOrigins | undefined,
): string | undefined => {
  const { state } = process
  if (state._tag !== "Running" || !process.page) return undefined
  const origin = origins?.(process.name)
  return origin === undefined ? state.url : onPageOrigin(state.url, origin)
}

/** A start that failed, or a process that died: the two a person did not ask for. */
const down = (processes: readonly HostedProcessDto[]): number =>
  processes.filter((p) => p.state._tag === "Exited" || p.state._tag === "DidNotComeUp").length

const up = (processes: readonly HostedProcessDto[]): number =>
  processes.filter((p) => hostedLive(p.state._tag)).length

/** The strip's cell: "2 running", "1 up · 1 down", "1 down", "none running". */
export const tally = (processes: readonly HostedProcessDto[]): string => {
  const bad = down(processes)
  const good = up(processes)
  if (bad > 0) return good > 0 ? `${String(good)} up · ${String(bad)} down` : `${String(bad)} down`
  return good > 0 ? `${String(good)} running` : "none running"
}

/** The dock tab's corner count, in the same order: how many are down, else how many are up. */
export const processCount = (
  processes: readonly HostedProcessDto[],
): { readonly n: number; readonly tone: "bad" | "good" } | undefined => {
  const bad = down(processes)
  if (bad > 0) return { n: bad, tone: "bad" }
  const good = up(processes)
  return good > 0 ? { n: good, tone: "good" } : undefined
}

/**
 * The line under a row's name — shorter than the side panel's `hostedLine`, because a row
 * is narrower than a header. `now` is epoch milliseconds.
 */
export const rowLine = (process: HostedProcessDto, now: number): string => {
  const { state } = process
  switch (state._tag) {
    case "Running":
      return `up ${elapsedText(state.readyAt, now) ?? "0s"}`
    case "Starting":
      return `starting · port ${String(state.port)}`
    case "NotStarted":
    case "Preparing":
    case "DidNotComeUp":
    case "Exited":
    case "Stopped":
    case "StoppedByRestart":
      return hostedWord(state).toLowerCase()
  }
}
