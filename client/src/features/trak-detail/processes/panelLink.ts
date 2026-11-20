/**
 * Which item of the side panel a link in the trak's markdown names, if any — so a press on
 * it opens the panel there instead of a browser tab.
 *
 * **A process is matched by loopback and port, never by its address.** An agent writes
 * `localhost` and a path; the engine reports `127.0.0.1` or `[::1]` at the root. The panel
 * loads the process's own reported origin with the link's path, query and fragment, since
 * a dev server may answer on only one of the loopbacks and the engine already probed which.
 *
 * **Behind a host with a page domain a process also has its own hostname**, which an agent
 * may have copied off the panel's address: a link at that origin names the process too,
 * and its page is held as the loopback address all the same. `onPageOrigin` in
 * `format/hosted.ts` turns either into the address the frame loads, so there is one place
 * that knows both forms.
 *
 * **The pull request is matched only at its own root**, query and fragment aside: the tab
 * shows one pull request, and the shell refuses to load any other path on GitHub.
 *
 * Kind `pure`.
 */

import type { HostedProcessDto } from "../../../api/types"
import type { PageOrigins } from "../../../format/hosted"

/** The three names of one loopback. `URL` writes an IPv6 host with its brackets. */
const LOOPBACK: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"])

/** A link the panel takes: the process it names, or the pull request. */
export type PanelLink =
  | {
      readonly kind: "process"
      readonly name: string
      /** The run it was up as, and the address to load — `undefined` while it is not up. */
      readonly page: { readonly run: number; readonly url: string } | undefined
    }
  | { readonly kind: "pull" }

/**
 * A page a link asked for, held for one run of one process. `click` moves on every press,
 * because the shell loads a new address only when the run it is told changes.
 */
export interface HeldPage {
  readonly name: string
  readonly run: number
  readonly url: string
  readonly click: number
}

const parsed = (href: string): URL | undefined => {
  try {
    return new URL(href)
  } catch {
    return undefined
  }
}

/** The process whose page-domain origin `link` is at, if any. */
const atPageOrigin = (
  link: URL,
  processes: readonly HostedProcessDto[],
  origins: PageOrigins | undefined,
): HostedProcessDto | undefined =>
  origins === undefined ? undefined : processes.find((p) => origins(p.name) === link.origin)

/** The process a loopback link names by its port, if any. */
const atLoopback = (link: URL, processes: readonly HostedProcessDto[]) => {
  if (link.protocol !== "http:" || !LOOPBACK.has(link.hostname)) return undefined
  // An empty port is http's default, 80.
  const port = link.port === "" ? 80 : Number(link.port)
  return processes.find((p) => portOf(p) === port)
}

/** The port a process is bound to, in every state that records one. */
const portOf = (process: HostedProcessDto): number | undefined =>
  "port" in process.state ? process.state.port : undefined

const withoutSlash = (path: string): string => path.replace(/\/$/, "")

export const panelLink = (
  href: string,
  processes: readonly HostedProcessDto[],
  /** The pull request the panel offers, or `undefined` where it offers none. */
  pull: string | undefined,
  /** Where each process is served behind a page domain; `undefined` with none. */
  origins: PageOrigins | undefined,
): PanelLink | undefined => {
  const link = parsed(href)
  if (link === undefined) return undefined

  if (pull !== undefined) {
    const own = parsed(pull)
    if (
      own !== undefined &&
      link.origin === own.origin &&
      withoutSlash(link.pathname) === withoutSlash(own.pathname)
    )
      return { kind: "pull" }
  }

  const process = atPageOrigin(link, processes, origins) ?? atLoopback(link, processes)
  if (process === undefined) return undefined
  const { state } = process
  return {
    kind: "process",
    name: process.name,
    page:
      state._tag === "Running"
        ? {
            run: process.run,
            url: new URL(`${link.pathname}${link.search}${link.hash}`, state.url).href,
          }
        : undefined,
  }
}
