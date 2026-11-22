/**
 * How a run of calls names itself.
 *
 * A decision about the *call* rather than about the row, which is why it is here rather
 * than inline: a group and a single call have to agree about what a `Bash` is for, and
 * two switches drift.
 *
 * **Every word a row says about a call is in this file**, including the punctuation joining
 * two of them, except the verbs `shellVerbs` gives a shell call by its command — a run holds
 * several kinds now, and a caller assembling the sentence from parts would be a second place
 * deciding how one reads. Which end of a
 * detail is worth keeping is the one call-shaped decision that is not: `keepsTail` lives
 * in `format/activity`, because `ToolCall` reads it too.
 *
 * **Two surfaces phrase a run with it**: the drawer's group row, and the trak row's
 * activity line through `latestActivity`.
 */

import type { ToolEntryDto } from "../api/types"
import { shellVerbs } from "./shellVerb"

type Kind = ToolEntryDto["kind"]

/**
 * The verb phrase for each kind, so a run reads as a sentence.
 *
 * **No counts, for any kind.** A count of calls is wrong for `cat a b c`, and counting
 * paths parsed out of a command fails on globs and directories — so a sentence that said
 * `Read 3 files` would state a number the call does not support. The opened run lists
 * every call.
 *
 * `Bash` is the fallback only: a shell call whose command names its effects takes the verbs
 * `shellVerbs` gives it, and the same verb as the dedicated tool — a `cat` and a `Read` are
 * one `read`. An MCP call is one more `called tools`, beside the unclassified ones.
 */
const PHRASE: Record<Kind, string> = {
  Bash: "ran commands",
  Read: "read",
  Edit: "edited",
  Write: "wrote",
  Grep: "searched",
  Glob: "searched",
  WebSearch: "searched the web",
  WebFetch: "fetched pages",
  Todo: "updated the plan",
  Task: "delegated",
  Mcp: "called tools",
  Other: "called tools",
}

/**
 * What each call did, as verb phrases the run sentence can hold — several for a shell call
 * that did several things. The shell calls are classified together, because whether a
 * write was scratch or an edit was undone is something only the whole run can say.
 */
const phrasesFor = (calls: readonly ToolEntryDto[]): readonly string[] => {
  const shell = calls.filter((call) => call.kind === "Bash")
  const verbs = shellVerbs(shell.map((call) => call.command ?? call.detail ?? ""))
  return calls.flatMap((call) => {
    if (call.kind !== "Bash") return [PHRASE[call.kind]]
    return (verbs[shell.indexOf(call)] ?? [undefined]).map((verb) => verb ?? PHRASE.Bash)
  })
}

/**
 * What a whole run is called, when the run can hold more than one kind of call.
 *
 * `Read, searched, and edited` — what the calls did, each said once, in the order the
 * agent first did it. A run is a stretch of working rather than a repetition of one
 * activity (`groupRuns` carries why), so the row has to be able to say several things and
 * stay a row.
 *
 * **The list is Oxford-comma'd at two as well as at three**, which is not how a sentence
 * would ordinarily punctuate a pair. It reads as a list rather than as prose, and every row
 * in this column is the same list of the same shape — so the comma is the thing that makes
 * the second half scannable rather than parsed.
 *
 * Empty for a group with no calls in it, which `ActivityGroup` never asks about: a group
 * is only phrased once its head is known to be a call.
 */
export const phraseForRun = (calls: readonly ToolEntryDto[]): string => {
  const phrases = [...new Set(phrasesFor(calls))]
  const [first, ...rest] = phrases
  if (first === undefined) return ""
  const head = first.charAt(0).toUpperCase() + first.slice(1)
  const last = rest.at(-1)
  if (last === undefined) return head
  return [head, ...rest.slice(0, -1), `and ${last}`].join(", ")
}

/**
 * Whether an opened run draws each call's own name beside its argument.
 *
 * **The question is whether the head has already said which tool this was.** It has when
 * the whole run is one tool — `Read` over four paths would be `Read` said four more
 * times, and a run of shell calls is a column of commands whatever verb its head says —
 * and two things break that.
 *
 * A run of several tools, told apart by **name** rather than by kind: `Skill`,
 * `ToolSearch`, `TaskStop` and `Monitor` all normalize to `Other`, so a kind-based answer
 * would hide exactly the word that says which of them made a row. Reading names also
 * separates `Edit` from `MultiEdit`.
 *
 * And a run of one tool whose kind is `Other`, because `Called tools` names no tool at
 * all. `PHRASE`'s verb is what carries the name on every other kind — `Ran commands`,
 * `Read`, `Edited` — and `Other` is the one that has nothing to carry, which is the cost of it
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
