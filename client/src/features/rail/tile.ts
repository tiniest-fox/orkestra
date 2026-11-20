/**
 * What one tile on the project rail says, worked out from what the shell sends about its
 * project. Kind `pure`.
 */

import type { RailProjectDto, TrakSummaryDto } from "../../api/types"
import type { Rungs } from "../traks-list/pullRung"
import { idleOf } from "../traks-list/idle"
import { asSections } from "../traks-list/sections"

/**
 * No forge answers: the rail holds none, and asking for them would be a `gh` process
 * per project per poll for a number on a tile.
 */
const NO_RUNGS: Rungs = new Map()

/**
 * How many traks in the project need the person — the live groups in the list's own top
 * section, taken from the list's own sectioning so the two cannot drift. `undefined`
 * where the shell has no list for the project, which is not zero: a project that is not
 * started, or whose engine refuses the app's credential, has not said.
 *
 * **Counted from each trak's state alone.** The list also files a row by what the forge
 * says of its pull request, and none of those piles is the top one — so a count here can
 * only differ from the list's header where a rung has moved a row *out* of it, which no
 * rung does.
 *
 * **An idle group is not counted**, though the list still files it under *Needs you*: a
 * gate nobody has touched in three days is not what the rail is asking the person to look
 * at, so a project whose only waiting traks are idle wears no count. Idle is the list's
 * own `idleOf` — every member idle — so a group the list draws faded is one the rail
 * leaves out.
 *
 * The one import across features in `client/`: the sectioning is the list's, and a copy
 * of it here would be a second answer to which traks are waiting on a person.
 */
export const owedOf = (traks: readonly TrakSummaryDto[] | undefined): number | undefined =>
  traks === undefined
    ? undefined
    : (asSections(traks, NO_RUNGS)
        .find((section) => section.key === "attention")
        ?.rows.filter((row) => !idleOf(row)).length ?? 0)

/** Whether anything in the project is being driven right now — custody, never state. */
export const runningOf = (traks: readonly TrakSummaryDto[] | undefined): boolean =>
  traks?.some((trak) => trak.running) ?? false

/**
 * The two letters a tile with no picture wears: the first of each of the name's first
 * two words, or its first two characters where it is one word.
 */
export const initialsOf = (name: string): string => {
  const [first, second] = name.split(/[-_ .]/u).filter((part) => part.length > 0)
  const letters =
    first !== undefined && second !== undefined
      ? `${first.slice(0, 1)}${second.slice(0, 1)}`
      : name.slice(0, 2)
  return letters.toUpperCase()
}

/** The hue those letters sit on — the same for a name every time, and spread across names. */
export const hueOf = (name: string): number => {
  let hue = 7
  for (let at = 0; at < name.length; at += 1) hue = (hue * 31 + name.charCodeAt(at)) % 360
  return hue
}

/** What a tile says of a boot, by how far the host says it has got. */
const PHASE: Record<NonNullable<RailProjectDto["phase"]> | "unsaid", string> = {
  engine: "waiting for its engine",
  unsaid: "starting",
}

/**
 * What the picture and marks say about a project, in words — `undefined` for a started
 * project with nothing waiting and nothing running, which is the tile with no marks.
 */
export const statusOf = (project: RailProjectDto): string | undefined => {
  const owed = owedOf(project.traks) ?? 0
  const said: Record<RailProjectDto["engine"], string | undefined> = {
    off: "not started",
    starting:
      project.progress === undefined
        ? PHASE[project.phase ?? "unsaid"]
        : `cloning, ${String(Math.round(project.progress))}%`,
    started: undefined,
    failed: "did not start",
    refused: "cannot be opened",
  }
  const parts = [
    project.noOrkestra === undefined ? said[project.engine] : "has no .orkestra/",
    owed > 0 ? `${String(owed)} waiting on you` : undefined,
    runningOf(project.traks) ? "running" : undefined,
  ].filter((part) => part !== undefined)
  return parts.length === 0 ? undefined : parts.join(", ")
}

/** What a screen reader hears for a tile: the name, then what the picture and marks say. */
export const tileLabel = (project: RailProjectDto): string => {
  const status = statusOf(project)
  return status === undefined ? project.name : `${project.name}, ${status}`
}

/**
 * A found icon's form: a `tile` brings its own opaque ground, a `glyph` is a shape on a
 * transparent one.
 */
export type IconForm = "tile" | "glyph"

/**
 * The form, from the alpha of the icon's four corner pixels: a tile only when every one is
 * fully opaque. A corner a rounded tile anti-aliases reads as a glyph, which draws it set
 * in on the plate rather than clipped — the safer of the two mistakes.
 */
export const formOfCorners = (alphas: readonly number[]): IconForm =>
  alphas.length === 4 && alphas.every((alpha) => alpha === 255) ? "tile" : "glyph"
