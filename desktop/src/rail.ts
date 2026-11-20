// What a window's rail page is told about one project, built from what the main process
// holds. Pure, so the shapes are testable without Electron; `main.ts` holds the state and
// sends the result.

import { basename } from "node:path"
import type { RailProjectDto } from "@orkestra/shared/rail"
import type { TrakSummaryDto } from "@orkestra/shared/dto/trak"

/** Why a project has no client to show: the sentence, and what its engine last printed. */
export interface Failure {
  readonly reason: string
  readonly output: string | undefined
}

/** What the main process holds about one project that the rail draws. */
export interface Tile {
  readonly root: string
  readonly state: RailProjectDto["engine"]
  readonly failure: Failure | undefined
  readonly icon: string | undefined
  readonly traks: readonly TrakSummaryDto[] | undefined
}

/** `path` as a person reads it — `recents.ts`'s rule for the launch window's rows. */
const shortOf = (path: string, home: string): string =>
  path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path

/**
 * A failed start as the pane draws it. `startEngine` throws one message — a sentence, a
 * blank line, then the last lines the child printed — and the pane sets the two apart,
 * so they are split here.
 */
export const failureOf = (thrown: unknown): Failure => {
  const message = thrown instanceof Error ? thrown.message : String(thrown)
  const gap = message.indexOf("\n\n")
  const sentence = gap === -1 ? message : message.slice(0, gap)
  const output = gap === -1 ? "" : message.slice(gap + 2).trim()
  return {
    reason: `${sentence.slice(0, 1).toUpperCase()}${sentence.slice(1)}`,
    output: output === "" ? undefined : output,
  }
}

/** The root in a failure's sentence is said the way the rail says it, as `short`. */
export const railProject = (tile: Tile, home: string): RailProjectDto => ({
  path: tile.root,
  name: basename(tile.root),
  short: shortOf(tile.root, home),
  engine: tile.state,
  ...(tile.icon === undefined ? {} : { icon: tile.icon }),
  ...(tile.failure === undefined
    ? {}
    : {
        failure: {
          reason: tile.failure.reason.replace(tile.root, shortOf(tile.root, home)),
          ...(tile.failure.output === undefined ? {} : { output: tile.failure.output }),
        },
      }),
  ...(tile.traks === undefined ? {} : { traks: tile.traks }),
})
