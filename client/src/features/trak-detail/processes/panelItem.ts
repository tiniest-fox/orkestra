/**
 * What the side panel can show, and which of it is showing: one of the project's hosted
 * processes, or — inside Orkestra.app, once the forge has found one — the trak's pull request
 * on GitHub. The pull request is one more tab, last in the strip, rather than a pretend
 * process: it has no state to start or stop and no log.
 *
 * Kind `pure`.
 */

import type { HostedProcessDto } from "../../../api/types"
import type { Heading } from "../pull-request/pullRequest"

/** An item the reader picked. A process is named, since a project may declare several. */
export type PanelItem =
  | { readonly kind: "process"; readonly name: string }
  | { readonly kind: "pull" }

/** The pull request the panel offers, and whether this page has heard from the forge yet. */
export interface PanelPull {
  readonly heading: Heading
  /** `false` withholds the tab's tone, as the card's plate withholds it — `PullRequestHeader`. */
  readonly confirmed: boolean
}

/** The item drawn, with the process it names resolved. */
export type ShownItem =
  | { readonly kind: "process"; readonly process: HostedProcessDto }
  | { readonly kind: "pull" }

/**
 * The item picked while it is still there; else the first process, else the pull request.
 * `undefined` where there is nothing to show.
 */
export const shownItem = (
  processes: readonly HostedProcessDto[],
  pull: boolean,
  active: PanelItem | undefined,
): ShownItem | undefined => {
  if (active?.kind === "pull" && pull) return { kind: "pull" }
  const picked =
    active?.kind === "process" ? processes.find((p) => p.name === active.name) : undefined
  const process = picked ?? processes[0]
  if (process !== undefined) return { kind: "process", process }
  return pull ? { kind: "pull" } : undefined
}
