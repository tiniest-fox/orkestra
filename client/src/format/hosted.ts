/**
 * What a hosted process's state reads as on screen: its word, its tone, its glyph, the
 * line under its name, and what its Page view says when there is no page to show.
 *
 * **Eight states, and every question here is an exhaustive switch over them**, so a
 * state the engine adds is a compile error in this file rather than a process drawn as
 * whatever the default was. There is no status chip anywhere — the plate's tone and glyph *are* the
 * status, and the line under the name says it in words.
 *
 * Kind `pure`: the glyphs are `lucide-react` components because every place that draws
 * one takes a component.
 */

import type { LucideIcon } from "lucide-react"
import {
  CircleAlert,
  CircleDashed,
  CircleSlash,
  CircleStop,
  CircleX,
  LoaderCircle,
  Radio,
  Slash,
  Square,
  TriangleAlert,
  X,
} from "lucide-react"
import type { HostedProcessDto, HostedStateDto, PreparingStageDto } from "../api/types"
import { elapsedText } from "./activity"
import type { Tone } from "./tone"

type Tag = HostedStateDto["_tag"]

/**
 * The origin each process is served from behind a page domain, by name; it answers
 * `undefined` for a name too long for a hostname. `api/pageDomain.ts` builds it.
 */
export type PageOrigins = (process: string) => string | undefined

/** `url`, a process's loopback address, at `origin` instead: the path, query and fragment kept. */
export const onPageOrigin = (url: string, origin: string): string => {
  const at = new URL(url)
  return new URL(`${at.pathname}${at.search}${at.hash}`, origin).href
}

/** The state in one or two words — a tab's title, the stopped screen's heading. */
export const hostedWord = (state: HostedStateDto): string => {
  switch (state._tag) {
    case "NotStarted":
      return "Not started"
    case "Preparing":
      return "Preparing"
    case "Starting":
      return "Starting"
    case "Running":
      return "Running"
    case "DidNotComeUp":
      return "Did not come up"
    case "Exited":
      return state.code === undefined ? "Exited" : `Exited ${String(state.code)}`
    case "Stopped":
      return "Stopped"
    case "StoppedByRestart":
      return "Stopped by restart"
  }
}

/**
 * A stop is `neutral` rather than `bad` whoever made it: it is what somebody asked for, and
 * nothing is owed. Only the two a person did not ask for — a start that failed and a
 * process that died — are failures.
 */
export const hostedTone = (tag: Tag): Tone => {
  switch (tag) {
    case "NotStarted":
    case "Stopped":
    case "StoppedByRestart":
      return "neutral"
    case "Preparing":
    case "Starting":
      return "working"
    case "Running":
      return "good"
    case "DidNotComeUp":
    case "Exited":
      return "bad"
  }
}

/**
 * The state's glyph, in one of two forms. **On a tone wash it is bare**, because the
 * plate is its ring; off one — a tab, the opener, the stopped screen — it carries its own
 * ring. Running's radio is a ring already, so it is the same glyph both ways.
 */
export const hostedGlyph = (tag: Tag, wash: boolean): LucideIcon => {
  switch (tag) {
    case "NotStarted":
      return CircleDashed
    case "Preparing":
    case "Starting":
      return LoaderCircle
    case "Running":
      return Radio
    case "DidNotComeUp":
      return wash ? TriangleAlert : CircleAlert
    case "Exited":
      return wash ? X : CircleX
    case "Stopped":
      return wash ? Square : CircleStop
    case "StoppedByRestart":
      return wash ? Slash : CircleSlash
  }
}

/** Preparing, starting or running: the three a Stop applies to, and a Start would refuse. */
export const hostedLive = (tag: Tag): boolean => {
  switch (tag) {
    case "Preparing":
    case "Starting":
    case "Running":
      return true
    case "NotStarted":
    case "DidNotComeUp":
    case "Exited":
    case "Stopped":
    case "StoppedByRestart":
      return false
  }
}

const twoDigits = (n: number): string => String(n).padStart(2, "0")

/**
 * The browser's own clock for an instant, as `10:42`. The engine's times are epoch
 * milliseconds, and the person reading is in the browser's timezone, not the engine's.
 */
export const clockAt = (at: number): string => {
  const when = new Date(at)
  return `${twoDigits(when.getHours())}:${twoDigits(when.getMinutes())}`
}

/** What a start is waiting on before its script runs, in words. */
export const stageLine = (stage: PreparingStageDto): string => {
  switch (stage._tag) {
    case "Readying":
      return "Waking the sandbox"
    case "Copying":
      return `Copying files into the sandbox · ${String(stage.sent)} of ${String(stage.total)}`
    case "Launching":
      return "Starting its script"
  }
}

/**
 * Why a start failed, split as the engine sends it: the sentence, then the last lines the
 * script printed, which a screen draws as the script's own words.
 */
export const failureOf = (reason: string): { readonly said: string; readonly tail: string[] } => {
  const [said = "", ...tail] = reason.split("\n")
  return { said, tail }
}

/**
 * The line under the process's name: the state in words, with the port and the clock.
 * `now` is epoch milliseconds, so a starting or running process's count moves as the
 * caller redraws it.
 */
export const hostedLine = (process: HostedProcessDto, now: number): string => {
  const { state } = process
  switch (state._tag) {
    case "NotStarted":
      return `${process.name}.sh has not run in this checkout`
    case "Preparing":
      return `${stageLine(state.stage)} · ${elapsedText(state.startedAt, now) ?? "0s"}`
    case "Starting":
      return `Waiting for port ${String(state.port)} to answer · ${elapsedText(state.startedAt, now) ?? "0s"}`
    case "Running":
      return `Running on port ${String(state.port)} · up ${elapsedText(state.readyAt, now) ?? "0s"}`
    case "DidNotComeUp":
      return failureOf(state.reason).said
    case "Exited": {
      const how =
        state.code === undefined
          ? `Ended by ${state.signal ?? "a signal"}`
          : `Exited with code ${String(state.code)}`
      const after = elapsedText(state.startedAt, state.at)
      return `${how} at ${clockAt(state.at)}${after === undefined ? "" : `, after ${after}`}`
    }
    case "Stopped":
      return `Stopped at ${clockAt(state.at)}`
    case "StoppedByRestart":
      return `Stopped when the engine restarted at ${clockAt(state.at)}`
  }
}

/** What the Page view says in place of a page, for every state but `Running`. */
export const pageAbsent = (state: Exclude<HostedStateDto, { _tag: "Running" }>): string => {
  switch (state._tag) {
    case "NotStarted":
      return "Start it to see its page here."
    case "Preparing":
      return `${stageLine(state.stage)}…`
    case "Starting":
      return "Waiting for the page…"
    case "DidNotComeUp":
      return failureOf(state.reason).said
    case "Exited":
      return "It exited on its own. The log has the last lines."
    case "Stopped":
      return "Stopped. Start it again to see its page."
    case "StoppedByRestart":
      return "Stopped when the engine restarted."
  }
}

/** Broken first, then moving, then up, then at rest — the order the opener reads from. */
const SEVERITY: readonly Tag[] = [
  "DidNotComeUp",
  "Exited",
  "Preparing",
  "Starting",
  "Running",
  "StoppedByRestart",
  "Stopped",
  "NotStarted",
]

/**
 * The state the side panel's opener wears, or `undefined` when nothing is up and nothing
 * is broken — the opener then says nothing about state, because a row of processes at
 * rest is the ordinary case and a glyph for it would be noise.
 */
export const openerState = (processes: readonly HostedProcessDto[]): Tag | undefined => {
  const worst = SEVERITY.find((tag) => processes.some((p) => p.state._tag === tag))
  return worst === undefined || hostedTone(worst) === "neutral" ? undefined : worst
}
