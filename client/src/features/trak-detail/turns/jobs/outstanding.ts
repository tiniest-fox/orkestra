/**
 * What is running right now, folded from one turn's `Background` levels.
 *
 * The level has REPLACE semantics — the last one seen is the whole answer, and an empty
 * one is the set going quiet — so the fold is *take the newest level* plus two joins the
 * level itself cannot say: the job's description and its start, both off the
 * `BackgroundStarted` the engine writes beside the level that first names a task.
 *
 * **A level is a fact about the turn that wrote it, and nothing later on the wire ever
 * supersedes it.** The CLI emits the level only on change, so a turn with no background
 * work emits none at all — nine of ten stored fixtures carry zero. A turn that was
 * stopped, that failed, or whose daemon died leaves its last non-empty set on disk
 * forever, and the work it named died with the process that held it. So the fold takes
 * one turn, never a list that spans several, and the callers hand it the turn in flight:
 * the chat bar the trak's newest turn while custody says something is driving, the map
 * row the position's newest turn.
 */

import type { TranscriptEntryDto, EventDto } from "../../../../api/types"
import { splitTurns, type Turn } from "../turns"

export interface OutstandingJob {
  /** The provider's own handle — the name the level and the stop route both speak. */
  readonly taskId: string
  /** What the job is, in the provider's words. Absent where nothing ever said. */
  readonly description: string | undefined
  /** When it went outstanding, off the first entry that named it. Absent on a stored
   *  transcript from before entries were stamped. */
  readonly since: number | undefined
}

/** The jobs one turn still has outstanding — none for no turn at all. */
export const outstandingJobs = (turn: Turn | undefined): readonly OutstandingJob[] => {
  let level: readonly { readonly id: string; readonly description?: string }[] = []
  const described = new Map<string, string>()
  const since = new Map<string, number | undefined>()
  for (const entry of turn?.entries ?? []) {
    if (entry._tag === "BackgroundStarted") {
      if (entry.description !== undefined) described.set(entry.taskId, entry.description)
      if (!since.has(entry.taskId)) since.set(entry.taskId, entry.at)
    }
    if (entry._tag !== "Background") continue
    level = entry.tasks
    for (const task of entry.tasks) {
      if (!since.has(task.id)) since.set(task.id, entry.at)
    }
  }
  return level.map((task) => ({
    taskId: task.id,
    description: task.description ?? described.get(task.id),
    since: since.get(task.id),
  }))
}

/**
 * The jobs the trak's turn in flight has outstanding, for the strip at the chat bar.
 *
 * The newest turn, and only while `running` — custody, not state, because a crashed
 * `AgentWorking` has nobody driving it and its last level names dead work. Between a
 * resume claiming custody and its first transcript line the newest turn is still the
 * one before, which is a window of under a second and closes on the new turn's `Spawned`.
 */
export const outstandingNow = (
  transcript: readonly TranscriptEntryDto[],
  log: readonly EventDto[],
  running: boolean,
): readonly OutstandingJob[] => (running ? outstandingJobs(splitTurns(transcript, log).at(-1)) : [])

/**
 * The one sentence both surfaces that spell a count out say — the phone's directive
 * block and the map's row — so the wording cannot drift between them. The rail's badge is the same
 * count as a numeral and says no sentence.
 */
export const stillRunningText = (count: number): string => `${String(count)} still running`
