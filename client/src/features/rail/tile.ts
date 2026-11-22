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
 * An opaque icon whose corners are rounded at no more than a quarter of its side, with the
 * color of the ground just inside its top-left corner as a CSS color.
 */
export interface RoundedTile {
  readonly ground: string
}

/**
 * A found icon's form: a `tile` brings its own opaque ground to every edge and corner, a
 * `RoundedTile` brings one everywhere but its rounded corners, and a `glyph` is a shape on a
 * transparent ground.
 */
export type IconForm = "tile" | RoundedTile | "glyph"

/** The roundest corner a rounded tile may have, as a share of its side. */
const ROUNDEST = 0.25

/**
 * Whether the pixel whose top-left is (`x`, `y`) lies in what a corner of radius
 * `ROUNDEST × side` cuts away — with a pixel's grace inward, so the anti-aliased rim of a
 * corner rounded at exactly a quarter still counts as cut away.
 */
const cutAway = (x: number, y: number, side: number): boolean => {
  const radius = side * ROUNDEST
  // Folded into the top-left corner, so one test covers all four.
  const across = Math.min(x + 0.5, side - x - 0.5)
  const down = Math.min(y + 0.5, side - y - 0.5)
  if (across >= radius || down >= radius) return false
  return Math.hypot(radius - across, radius - down) > radius - 1
}

/**
 * The ground of a rounded tile: the first fully opaque pixel along the top-left diagonal,
 * then one further in, past the anti-aliased rim.
 */
const groundOf = (pixels: Uint8ClampedArray, side: number): string => {
  let at = 0
  while (at < side - 1 && (pixels[(at * side + at) * 4 + 3] ?? 0) < 255) at += 1
  const step = Math.min(at + 1, side - 1)
  const base = (step * side + step) * 4
  const [red, green, blue] = [pixels[base] ?? 0, pixels[base + 1] ?? 0, pixels[base + 2] ?? 0]
  return `rgb(${String(red)} ${String(green)} ${String(blue)})`
}

/**
 * The form, from the RGBA pixels of the icon drawn on a `side`-square canvas. A tile when
 * every corner pixel is fully opaque; a rounded tile when every pixel that is not fully
 * opaque lies in what a quarter-side corner would cut away; a glyph otherwise. A circle,
 * or a square rounded past a quarter, leaves pixels open outside those corners and so
 * reads as a glyph, which draws it set in on the plate — the safer of the two mistakes.
 */
export const formOfPixels = (pixels: Uint8ClampedArray, side: number): IconForm => {
  if (side < 1 || pixels.length !== side * side * 4) return "glyph"
  const alphaAt = (x: number, y: number): number => pixels[(y * side + x) * 4 + 3] ?? 0
  const last = side - 1
  if (
    [alphaAt(0, 0), alphaAt(last, 0), alphaAt(0, last), alphaAt(last, last)].every((a) => a === 255)
  )
    return "tile"
  for (let y = 0; y < side; y += 1)
    for (let x = 0; x < side; x += 1)
      if (alphaAt(x, y) < 255 && !cutAway(x, y, side)) return "glyph"
  return { ground: groundOf(pixels, side) }
}
