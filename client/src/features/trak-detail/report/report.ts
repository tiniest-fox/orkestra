/**
 * What the report pane says, decided from the engine's preview alone: which lines carry a
 * redaction mark, what the log choice's note reads, and whether the log can go at all.
 * The engine cleans and cuts; nothing here decides what a secret is.
 */

import type { ReportDto, ReportLeftOutReasonDto, ReportLogDto } from "../../../api/types"

/** The mark the engine writes where it took something out — `REDACTION_MARK`. */
const MARK = "[redacted]"

const count = (n: number): string => n.toLocaleString("en-US")

/** Why a log the person wanted cannot go, where it cannot. Exhaustive over the wire's reasons. */
export const lockedWords = (reason: ReportLeftOutReasonDto): string | undefined => {
  switch (reason) {
    case "turned-off":
      return undefined
    case "secrets-unreadable":
      return "The log is left out: the engine could not read its list of secrets to clean it with. The report says the log was withheld."
    case "undecodable":
      return "The log is left out: the trak's stored log will not decode. The report says the log was withheld."
  }
}

/** Why the preview's log cannot go, or `undefined` where it can. */
export const logLocked = (preview: ReportDto | undefined): string | undefined =>
  preview?.log._tag === "LeftOut" ? lockedWords(preview.log.reason) : undefined

/** The line under the log choice: how much of the log goes, and what the cut left out. */
export const logNote = (log: ReportLogDto | undefined): string => {
  if (log === undefined) return "The newest lines of the trak's log, cleaned of secrets."
  if (log._tag === "LeftOut")
    return lockedWords(log.reason) ?? "The log is left out, and the report says so."
  if (log.leftOut.lines === 0)
    return `The whole log, ${count(log.kept.lines)} lines, cleaned of secrets.`
  return `The last ${count(log.kept.lines)} lines. ${count(log.leftOut.lines)} earlier lines are left out, and the report says how many.`
}

/** One piece of a line: as written, or where the engine took something out. */
export interface Piece {
  /** Where it starts in the line, which names it among its neighbors. */
  readonly key: number
  readonly text: string
  readonly removed: boolean
}

/** A line cut at each redaction mark, so the pane can draw each mark as a removal. */
export const piecesOf = (line: string): readonly Piece[] => {
  const pieces: Piece[] = []
  let at = 0
  for (const [i, text] of line.split(MARK).entries()) {
    if (i > 0) {
      pieces.push({ key: at, text: MARK, removed: true })
      at += MARK.length
    }
    if (text !== "") pieces.push({ key: at, text, removed: false })
    at += text.length
  }
  return pieces
}

/** The log's lines, each keyed by its place in the whole log, which a poll does not move. */
export const keyedLines = (
  lines: readonly string[],
  before: number,
): readonly { readonly key: number; readonly line: string }[] =>
  lines.map((line, i) => ({ key: before + i, line }))

/** A reference the receipt opens rather than only copies. */
export const isLink = (reference: string): boolean => /^https?:\/\/\S+$/.test(reference)

/** The trak's details as the receiver gets them, one row each, in the order they are read. */
export const detailRows = (report: ReportDto): readonly (readonly [string, string])[] => {
  const { trak, engine } = report
  return [
    ["trak", trak.id],
    ...(trak.goal === undefined ? [] : [["goal", trak.goal] as const]),
    ...(trak.position === undefined ? [] : [["position", trak.position] as const]),
    ["state", trak.state],
    ...(trak.agent === undefined ? [] : [["agent", trak.agent] as const]),
    ["engine", `orkestra ${engine.version} · ${engine.platform}`],
  ]
}
