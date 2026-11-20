/**
 * How a run of calls names itself.
 *
 * A decision about the *kind* rather than about the row, which is why it is here rather
 * than inline: a group and a single call have to agree about what a `Bash` is for, and
 * two switches drift.
 *
 * **Every word a row says about a call is in this file**, including the punctuation
 * joining two of them — a run holds several kinds now, and a caller assembling the
 * sentence from parts would be a second place deciding how one reads. Which end of a
 * detail is worth keeping is the one call-shaped decision that is not: `keepsTail` lives
 * in `format/activity`, because `ToolCall` reads it too.
 *
 * **Two surfaces phrase a run with it**: the drawer's group row, and the trak row's
 * activity line through `latestActivity`.
 */

import type { ToolEntryDto } from "../api/types"

type Kind = ToolEntryDto["kind"]

/**
 * The kinds a run counts separately. **An MCP call is counted as one more call**, beside
 * the unclassified ones: both say `Called`, and two counts with the same verb read
 * `called 1 time, and called 2 times`. Which calls were MCP is the opened run's to show.
 */
type Counted = Exclude<Kind, "Mcp">

const countedAs = (kind: Kind): Counted => (kind === "Mcp" ? "Other" : kind)

/**
 * The verb and the unit for each kind, so a group reads as a sentence.
 *
 * "Ran 3 commands", never "Bash 3 files" — the tool's name is the word a person watching
 * that CLI saw, but a *count* of them wants ordinary English or the row stops being
 * readable at a glance.
 *
 * **Both numbers of the unit are written out.** Every one of them happens to lose a
 * trailing `s`, so a slice would work today and would be a rule about English that this
 * table does not state — the first unit that pluralises any other way would read
 * `1 matche` and nothing would fail.
 */
const PHRASE: Record<Counted, readonly [verb: string, one: string, many: string]> = {
  Bash: ["Ran", "command", "commands"],
  Read: ["Read", "file", "files"],
  Edit: ["Edited", "file", "files"],
  Write: ["Wrote", "file", "files"],
  Grep: ["Searched", "time", "times"],
  Glob: ["Globbed", "pattern", "patterns"],
  WebSearch: ["Searched the web", "time", "times"],
  WebFetch: ["Fetched", "page", "pages"],
  Todo: ["Updated the plan", "time", "times"],
  Task: ["Delegated", "time", "times"],
  Other: ["Called", "time", "times"],
}

/**
 * What `count` calls of one kind are called.
 *
 * **`count` can be 1**, and that is the ordinary case rather than the edge one: a run
 * broken by a pause on either side of it is one call, and a lone call is counted rather
 * than drawn as a row of its own — see `ActivityGroup` for why that changed.
 */
const phraseFor = (kind: Counted, count: number): string => {
  const [verb, one, many] = PHRASE[kind]
  return `${verb} ${count} ${count === 1 ? one : many}`
}

/** A phrase joining another one, so only the first keeps its capital. */
const joining = (phrase: string): string => phrase.charAt(0).toLowerCase() + phrase.slice(1)

/**
 * What a whole run is called, when the run can hold more than one kind of call.
 *
 * `Read 4 files, and ran 1 command` — the kinds in the order the agent first reached for
 * them, each counted, read as one sentence. A run is a stretch of working rather than a
 * repetition of one activity (`groupRuns` carries why), so the row has to be able to say
 * several things and stay a row.
 *
 * **The list is Oxford-comma'd at two as well as at three**, which is not how a sentence
 * would ordinarily punctuate a pair. It reads as a list rather than as prose that happens
 * to have a count in it, and every row in this column is the same list of the same shape —
 * so the comma is the thing that makes the second half scannable rather than parsed.
 *
 * Empty for a group with no calls in it, which `ActivityGroup` never asks about: a group
 * is only phrased once its head is known to be a call.
 */
export const phraseForRun = (kinds: readonly Kind[]): string => {
  const counts = new Map<Counted, number>()
  for (const kind of kinds.map(countedAs)) counts.set(kind, (counts.get(kind) ?? 0) + 1)

  const [first, ...rest] = [...counts].map(([kind, count]) => phraseFor(kind, count))
  if (first === undefined) return ""
  const last = rest.at(-1)
  if (last === undefined) return first
  return [first, ...rest.slice(0, -1).map(joining), `and ${joining(last)}`].join(", ")
}

/**
 * Whether an opened run draws each call's own name beside its argument.
 *
 * **The question is whether the head has already said which tool this was.** It has when
 * the whole run is one tool — `Read 4 files` over four paths would be `Read` said four
 * more times — and two things break that.
 *
 * A run of several tools, told apart by **name** rather than by kind: `Skill`,
 * `ToolSearch`, `TaskStop` and `Monitor` all normalize to `Other`, so a kind-based answer
 * would hide exactly the word that says which of them made a row. Reading names also
 * separates `Edit` from `MultiEdit`.
 *
 * And a run of one tool whose kind is `Other`, because `Called 3 times` names no tool at
 * all. `PHRASE`'s verb is what carries the name on every other kind — `Ran`, `Read`,
 * `Edited` — and `Other` is the one that has nothing to carry, which is the cost of it
 * being the escape hatch rather than a word in the vocabulary.
 *
 * **Asked of the run's built-in calls only.** An MCP call always carries its own mark in
 * the label column and never its name, so it neither needs the built-in rows labelled
 * nor tells them apart: three reads beside one MCP call stay three bare paths.
 */
export const labelsCalls = (calls: readonly ToolEntryDto[]): boolean => {
  const builtin = calls.filter((call) => call.kind !== "Mcp")
  return (
    new Set(builtin.map((call) => call.name)).size > 1 ||
    builtin.some((call) => call.kind === "Other")
  )
}
