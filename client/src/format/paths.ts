/**
 * A tool call's detail, with the checkout it happened in taken off the front of every
 * path in it.
 *
 * A worktree's path is around ninety characters before the interesting part starts, so a
 * row that truncates left to right is all prefix: `Read /Users/…/.worktrees/d68da68b-…`
 * and the filename never arrives. `Read src/agent/logic/event-line.ts` is the same fact
 * at a width a list has.
 *
 * **Display only, and it is a string subtraction rather than a recogniser.** The wire and
 * the recorded transcript keep the absolute path, and the root taken off is the one the
 * engine reports for *this* trak — so a path the turn reached outside its checkout stays
 * whole, which is the direction to be wrong in: reaching out is the interesting case.
 * Nothing may round-trip through this.
 */

import type { TranscriptEntryDto } from "../api/types"

/** The characters a regex would otherwise read as syntax — a worktree path holds `.`. */
const quoted = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * The root, matched wherever it appears rather than as a prefix — a shell command holds
 * paths mid-string and routinely more than one, `cd <root>/client && pnpm test`.
 *
 * Both boundaries are guarded, because a path is not a word and `indexOf` cannot tell
 * `<root>/src` from `<root>-backup/src` or from `/elsewhere<root>/src`. The separator is
 * eaten with the root so what is left is relative; a root at the very end has no
 * separator to eat and becomes `.`, which is what it names.
 */
const rootIn = (root: string): RegExp =>
  new RegExp(`(?<![\\w./-])${quoted(root)}(?![\\w.-])(/(?=\\S))?`, "g")

/**
 * One string with the checkout taken off every path in it.
 *
 * **A command line, never prose.** The two callers are a tool call's argument and the
 * line a check was spawned as; the agent's own words and the engine's notes are drawn
 * whole, because a substitution over arbitrary markdown is a different risk from one over
 * an argument. That is a rule about who may call this rather than something it can check,
 * which is why the entry-shaped wrapper below still exists.
 *
 * Returns what it was given wherever it cannot shorten — no root, nothing to take off —
 * rather than reporting anything, on `shortId`'s posture: a truncation helper that fails
 * is worse than one that under-shortens.
 */
export const withoutRoot = (
  text: string,
  /** The trak's checkout. Absent before a worktree exists, and on a path this cannot help. */
  root: string | undefined,
): string => {
  if (root === undefined) return text
  // A root written with a trailing separator would match nothing at all: the boundary
  // after it lands mid-filename, where every character is one the guard rejects.
  const at = root.replace(/\/+$/, "")
  if (at === "") return text
  return text.replace(rootIn(at), (hit) => (hit.endsWith("/") ? "" : "."))
}

/**
 * The same entry, with a `Tool`'s argument cut back to the worktree it acted in.
 *
 * **A call carrying a `command` has a description for its `detail`**, which is the agent's
 * prose and is left whole, on `withoutRoot`'s rule; the command behind it is shortened.
 */
export const withoutWorktree = (
  entry: TranscriptEntryDto,
  root: string | undefined,
): TranscriptEntryDto => {
  if (entry._tag !== "Tool") return entry
  const detail =
    entry.detail === undefined || entry.command !== undefined
      ? entry.detail
      : withoutRoot(entry.detail, root)
  const command = entry.command === undefined ? undefined : withoutRoot(entry.command, root)
  if (detail === entry.detail && command === entry.command) return entry
  return {
    ...entry,
    ...(detail === undefined ? {} : { detail }),
    ...(command === undefined ? {} : { command }),
  }
}
