/**
 * A transcript as the rows the live agent view draws: bookkeeping folded away, calls
 * gathered into runs, delegations and background jobs into cards, and pauses kept only
 * where they are still true.
 *
 * **Shared because two surfaces summarise the same work.** The drawer's log draws every
 * row; the list's trak row draws only the newest one, as a single line —
 * `latestActivity`. Both read the rows off here, so the row cannot say `Read src/a.ts`
 * while the log beside it says `Read 4 files`.
 *
 * `features/trak-detail/turns/turns.ts` cuts a transcript into turns first; this takes
 * one turn's entries, or one agent's.
 */

import type {
  ApiRetryEntryDto,
  CheckEntryDto,
  HookEntryDto,
  SubagentEntryDto,
  SubagentResultEntryDto,
  ToolEntryDto,
  TranscriptEntryDto,
  ViewEntryDto,
} from "../api/types"
import { activityText, retryText, withoutEnvelope } from "./activity"
import { phraseForRun } from "./toolPhrase"

/**
 * The `Note` kinds that are the engine talking about the turn rather than the agent
 * acting in it — and the one that is a *call's own outcome*.
 *
 * `ToolResult` is separated from the rest because it belongs to the call above it. That
 * is what lets a run of calls fold: see `groupEntries`.
 */
const isOutcome = (e: TranscriptEntryDto): boolean =>
  e._tag === "Note" && e.text.startsWith("ToolResult")

/** An outcome that came back non-zero. `ToolResult(ok)` is the only spelling that did not. */
const isFailedOutcome = (e: TranscriptEntryDto): boolean =>
  isOutcome(e) && e._tag === "Note" && !e.text.includes("ok")

/**
 * The call an outcome answers, where the provider said which — the join that lets an
 * outcome be *matched* to its call rather than counted onto whichever one has been waiting
 * longest.
 *
 * **`undefined` is a real answer and every reader here has to have a rule for it**: it is
 * every line written before the id was carried, and any provider that does not report one.
 * The rule is counting, which is what this replaces where the id exists and what it falls
 * back to where it does not.
 */
const outcomeCall = (e: TranscriptEntryDto): string | undefined =>
  e._tag === "Note" && isOutcome(e) ? e.call : undefined

/**
 * The engine talking about the turn, rather than the agent acting in it.
 *
 * Four `Note` kinds plus the two that bracket a run. In a real transcript these outnumber
 * the tool calls **five to one** — the file this was measured against holds 20 of them to
 * 4 calls — so drawing them all is the difference between a log you scan and a log you
 * scroll. Measured on one position: 1250px of rows down to about 600 for the same work.
 *
 * **`Thinking` is out of this list on purpose** — it is a *pause*, which is its own thing
 * and `isPause` is where it lives. Folding it away here would take it out before
 * `groupRuns` saw it, and both ending a run and drawing the live one depend on it getting
 * that far.
 *
 * `ToolResult` is deliberately *not* here. It is a call's own outcome rather than a note
 * about the turn, it rides in the group it belongs to, and `groupFailures` is what reads
 * it — so folding it away would take the only signal a failing call has.
 *
 * **`TextDelta` matches nothing the engine writes now** — the agent's words are a `Text`
 * entry, which is work and is drawn. It stays because a `transcript.jsonl` written before
 * that variant existed still holds `Note{text: "TextDelta(482 chars)"}` lines, and those
 * are bookkeeping: the text they stood for was never recorded.
 */
const ENGINE_NOTES = ["RateLimit", "TextDelta", "Usage", "Result("]

/**
 * The agent stopping to think — which is not work and not bookkeeping either.
 *
 * **Kept rather than folded away**, which is what separates it from an engine note: it
 * ends a run in `groupRuns`, and where it draws a row `Thinking` is what that row is.
 * Folding it into `ENGINE_NOTES` would take it out before either could happen.
 *
 * **Ending a run and drawing a row are separate questions**, and every pause answers the
 * first while `withoutEndedPauses` decides the second, after the grouping and never
 * before it.
 *
 * `runtime.ts` collapses a burst of ticks into one stored line, so a row stands for a
 * burst rather than for every tick inside it.
 */
export const isPause = (e: TranscriptEntryDto): boolean =>
  e._tag === "Note" && e.text.startsWith("Thinking")

/**
 * What the model said it was working out, where the provider gave a summary — the words
 * `eventLine` wrote after `Thinking: `. `undefined` for a pause that carries none, which
 * is every Claude pause and every line written before the summary was carried.
 *
 * **The dots' name, and nothing more.** It is what the live pause says instead of the
 * word `Thinking` — a running explanation of the wait, not a record of it — so it is
 * drawn exactly where the dots are and dropped with them. The tool calls are the log.
 */
export const pauseText = (e: TranscriptEntryDto): string | undefined => {
  if (!isPause(e) || e._tag !== "Note") return undefined
  const rest = e.text.slice("Thinking:".length).trim()
  return e.text.startsWith("Thinking:") && rest !== "" ? rest : undefined
}

export const isEngineLine = (e: TranscriptEntryDto): boolean =>
  e._tag === "Spawned" ||
  e._tag === "Session" ||
  (e._tag === "Note" && ENGINE_NOTES.some((p) => e.text.startsWith(p)))

/**
 * The provider kinds `test/smoke/known-kinds.json` has already written a reason for, as
 * the note text each one arrives as.
 *
 * **Catalogued means there is nothing to draw**, and that file is the argument rather than
 * this list: each entry there records why the kind carries nothing the transcript does not
 * already hold — a heartbeat whose elapsed is worse than the `at` on every row, a level
 * with no consumer, a slash-command list nothing here caches. The list is kept in step
 * with those keys and states no reason of its own.
 *
 * **Matched whole**, so a subtype nobody has written a reason for is a different kind and
 * still draws.
 *
 * **Hiding them is also what lets a parent's run fold back together.** A `Note` is not a
 * `Tool`, so each one ends the run behind it in `groupRuns` — a heartbeat between every
 * pair of twenty reads drew twenty `Read 1 file` rows with a note between each, where the
 * stretch of working is one `Read 20 files`.
 *
 * A rendering rule and nothing more: the kinds stay on the wire and in the transcript, so
 * a surface that finds a use for their counters still has them.
 */
const CATALOGUED_KINDS = new Set([
  "Unknown(tool_progress)",
  "Unknown(system/task_progress)",
  "Unknown(system/task_updated)",
  "Unknown(system/background_tasks_changed)",
  "Unknown(system/commands_changed)",
  "Unknown(system/code_change_published)",
  "Unknown(system/vcs_state_changed)",
  "Unknown(system/informational)",
  "Unknown(item.completed/error)",
])

/** A kind `known-kinds.json` has answered, so there is nothing for a row to say. */
const isCatalogued = (e: TranscriptEntryDto): boolean =>
  e._tag === "Note" && CATALOGUED_KINDS.has(e.text)

/**
 * A turn's entries with the bookkeeping taken out — the engine's, and the provider kinds
 * whose reason for carrying nothing is already written down.
 *
 * **An unrecognised kind nobody catalogued is kept, and that is the decision rather than
 * the unfinished half of one.** Every kind the provider does not model arrives as
 * `Note{"Unknown(…)"}`, and one with no reason written for it draws a row so that somebody
 * notices it — the same rule as `pnpm smoke` failing on a kind that is not in
 * `test/smoke/known-kinds.json`. Hiding every `Unknown` would leave both halves silent.
 *
 * **Runs before `groupEntries`**, which is what lets a run of calls fold back together
 * across the heartbeats that were written between them, and it reaches the parent's rows
 * and every delegation's in one pass. `TurnSection` is where that order is set.
 */
export const workOnly = (entries: readonly TranscriptEntryDto[]): readonly TranscriptEntryDto[] =>
  entries.filter((e) => !isEngineLine(e) && !isCatalogued(e))

/**
 * A turn's entries with the JSON each one filed taken out — the row that held nothing
 * else is dropped, and the prose around it survives.
 *
 * `envelopes` is what the turns below this log reported writing, exact strings, off
 * `EventDto.envelope` — so this subtracts rather than recognises, and there is no
 * fence grammar here to disagree with the engine's. An entry holding none of them is
 * untouched, which is every turn that answered in prose and every one whose JSON did
 * not decode.
 *
 * **After `withoutSpoken`, and the order is load-bearing.** That filter matches a `Text`
 * entry to a `message` output by exact trimmed string, and a `message` a turn fell back
 * to still has whatever it wrote inside it. Trimming the entry first would stop the two
 * matching and draw the conversational reply twice, which is the bug `spokenBelow` exists
 * to kill.
 */
export const withoutEnvelopes = (
  entries: readonly TranscriptEntryDto[],
  envelopes: ReadonlySet<string>,
): readonly TranscriptEntryDto[] =>
  entries.flatMap((e): readonly TranscriptEntryDto[] => {
    if (e._tag !== "Text") return [e]
    const held = [...envelopes].find((envelope) => e.text.includes(envelope))
    const text = withoutEnvelope(e.text, held)
    return text === undefined ? [] : [{ ...e, text }]
  })

/**
 * A delegation and everything that happened inside it.
 *
 * `result` is absent while the subagent is still working, which is the state a person
 * watching most wants drawn — so it is optional here rather than a delegation only being
 * assembled once it is over.
 */
export interface Delegation {
  readonly head: SubagentEntryDto
  readonly result: SubagentResultEntryDto | undefined
  /**
   * Whether it came back clean, and **not the same fact as `result.ok`**: the answer's
   * `ok`, which the parent's own `ToolResult` can override to `false` when it reports an
   * error and nothing can override to `true`. A union rather than a replacement, because
   * the answer's `ok` is a guess about how a status is spelled and the note's is
   * observed — so the observed failure wins, and an observed success adds nothing to a
   * guess that already said so. See `nest`, and `taskEvents` in the provider's
   * normalizer.
   *
   * `undefined` while the subagent is still working.
   */
  readonly ok: boolean | undefined
  /**
   * Whether the parent detached it — `run_in_background` on the call that asked — and so
   * went on working without waiting for the answer.
   *
   * **Read off the opener rather than off the head.** The wire carries it on the `Tool`
   * entry because a shell command takes the same key: it says how a tool was invoked, not
   * what kind of tool it was. `nest` looks the opener up on its way to dropping it, which
   * is the only chance anything has to keep it.
   *
   * `false` where the opener said nothing and where the opener is not in this turn at
   * all — a delegation is inline unless something says otherwise, and drawing one
   * `background` on the strength of a missing field is the misreading this replaces.
   */
  readonly backgrounded: boolean
  /** The subagent's own lines, in transcript order. */
  readonly entries: readonly TranscriptEntryDto[]
}

/**
 * A background job: a call the turn went on without, and its completion when it lands.
 *
 * The shell counterpart of a `Delegation`, drawn with the same card anatomy — every job
 * gets a card of its own, ten as readily as two. A backgrounded *delegation* is not one
 * of these: it keeps its `Delegation`, which says strictly more.
 */
export interface Job {
  /** The call that started it. `detail` is the command, and the card's header. */
  readonly head: ToolEntryDto
  /**
   * The task's report. `undefined` while it is still running — and forever, on a turn
   * that was torn down before the work could land, which is what every stored turn from
   * before the engine waited looks like.
   */
  readonly report: SubagentResultEntryDto | undefined
  /**
   * Whether it came back clean, on `Delegation.ok`'s rule: the report's own `ok`, which
   * the call's observed `tool_result` error can set to `false` — a launch that failed —
   * and nothing can set to `true`.
   */
  readonly ok: boolean | undefined
  /** What the job is in the provider's words, off the `BackgroundStarted` join. */
  readonly description: string | undefined
  /**
   * The provider's task handle, off the same join — what the stop press names, since it
   * is the one name for the job both sides hold. Absent on a transcript from before the
   * join was carried, which is also one whose jobs are long dead.
   */
  readonly taskId: string | undefined
}

/**
 * What a caller of `groupEntries` tells a delegation from a job and from a run of calls
 * by. Both cards carry a `head`; whose entry heads it is the discriminant.
 */
export const isDelegation = (item: Row): item is Delegation =>
  "head" in item && item.head._tag === "Subagent"

export const isJob = (item: Row): item is Job => "head" in item && item.head._tag === "Tool"

/**
 * An MCP tool's call that left a view: the call, the `View` line that says the engine
 * kept one for it, and whether the call worked.
 *
 * **A row of its own, and it breaks the run it was made in** — a view is part of the
 * answer rather than one of the calls behind it, so the calls before and after are two
 * shorter runs and this call is in neither count.
 *
 * `ok` is `undefined` while nothing has reported on the call, which a reader should not
 * meet: the `View` line is written after the call's own outcome.
 */
export interface Viewed {
  readonly view: ViewEntryDto
  readonly call: ToolEntryDto
  readonly ok: boolean | undefined
}

/** A viewed call while its outcome is still to be met. `Viewed` is what comes out. */
interface OpenViewed {
  readonly view: ViewEntryDto
  readonly call: ToolEntryDto
  ok: boolean | undefined
}

/**
 * A call on the engine's check tool: the call, and the newest `Check` line for it — where
 * the check stands. A row of its own that breaks its run, as a view does: the run is the
 * evidence the agent is acting on, drawn where it called for it.
 */
export interface Checked {
  readonly checked: CheckEntryDto
  readonly call: ToolEntryDto
}

/** A row drawn as a card of its own rather than as a run: it closes the run behind it. */
export type Card = Delegation | Job | Viewed | Checked

type Row = Card | TranscriptEntryDto | readonly TranscriptEntryDto[]

export const isViewed = (item: Row): item is Viewed => "view" in item

export const isChecked = (item: Row): item is Checked => "checked" in item

const isCard = (item: Row): item is Card =>
  isDelegation(item) || isJob(item) || isViewed(item) || isChecked(item)

/**
 * Each check-tool call's newest `Check` line, by the id of the call it belongs to.
 *
 * By the call's own id where the line carries it, which is every line Claude Code's calls
 * leave. Codex gives the engine no id, so a line naming no call here is paired, in order,
 * with the calls on its `server`/`tool` that no line names — the oldest unpaired line with
 * the oldest unpaired call.
 */
const checkLines = (entries: readonly TranscriptEntryDto[]): ReadonlyMap<string, CheckEntryDto> => {
  const newest = new Map<string, CheckEntryDto>()
  for (const e of entries) if (e._tag === "Check") newest.set(e.call, e)
  const calls = entries.flatMap((e) => (e._tag === "Tool" && e.call !== undefined ? [e] : []))
  const ids = new Set(calls.map((c) => c.call))
  const joined = new Map<string, CheckEntryDto>()
  const unpaired: ToolEntryDto[] = calls.filter((c) => c.kind === "Mcp")
  for (const [id, line] of newest) {
    if (ids.has(id)) {
      joined.set(id, line)
      continue
    }
    const at = unpaired.findIndex(
      (c) => c.detail === `${line.server}/${line.tool}` && !newest.has(c.call ?? ""),
    )
    const call = unpaired[at]?.call
    if (call === undefined) continue
    joined.set(call, line)
    unpaired.splice(at, 1)
  }
  return joined
}

/**
 * What each `BackgroundStarted` says about the call that started it: its description, and
 * the task id — the other half of the same join, in the other direction: a job card's stop
 * press names the task, and the task id is the one name the stop route speaks.
 */
const startedJobs = (entries: readonly TranscriptEntryDto[]) => ({
  descriptions: new Map(
    entries.flatMap((e) =>
      e._tag === "BackgroundStarted" ? [[e.call, e.description] as const] : [],
    ),
  ),
  taskIds: new Map(
    entries.flatMap((e) => (e._tag === "BackgroundStarted" ? [[e.call, e.taskId] as const] : [])),
  ),
})

/** A delegation while it is still being filled in. `Delegation` is what comes out. */
interface OpenDelegation {
  readonly head: SubagentEntryDto
  result: SubagentResultEntryDto | undefined
  ok: boolean | undefined
  readonly backgrounded: boolean
  readonly entries: TranscriptEntryDto[]
}

/** A job while its report may still land. `Job` is what comes out. */
interface OpenJob {
  readonly head: ToolEntryDto
  report: SubagentResultEntryDto | undefined
  ok: boolean | undefined
  readonly description: string | undefined
  readonly taskId: string | undefined
}

/**
 * The calls that started background work, decided the way the requirement says: a task
 * is background work exactly when its id appeared in a `Background` level.
 *
 * Three sources, because the join arrived in stages and stored transcripts hold every
 * stage. `BackgroundStarted` is the join itself and covers everything a current engine
 * writes, a task the call's own input never marked included. A `backgrounded` call is
 * the capture that predates the join — the levels are there, the `task_started` field
 * is not — and the call's own `run_in_background` is all that says which call. And a
 * report whose `taskId` a level named joins a landed task back to its call where both
 * of the others are missing.
 *
 * Top-level calls only: a task a subagent backgrounded belongs to the subagent, whose
 * card already holds the call — a delegation is drawn one level deep.
 */
const backgroundCalls = (entries: readonly TranscriptEntryDto[]): ReadonlySet<string> => {
  const levelled = new Set(
    entries.flatMap((e) => (e._tag === "Background" ? e.tasks.map((t) => t.id) : [])),
  )
  const calls = new Set<string>()
  for (const e of entries) {
    if (e._tag === "BackgroundStarted") calls.add(e.call)
    if (
      e._tag === "Tool" &&
      e.call !== undefined &&
      e.parent === undefined &&
      e.backgrounded === true
    )
      calls.add(e.call)
    if (e._tag === "SubagentResult" && e.taskId !== undefined && levelled.has(e.taskId))
      calls.add(e.call)
  }
  return calls
}

/** Which delegation a line was written inside, on the entries that can say. */
const insideOf = (entry: TranscriptEntryDto): string | undefined =>
  "parent" in entry ? entry.parent : undefined

/**
 * A hook that has something to say without its call: it failed, blocked or stopped, or
 * printed a line. The rest ran cleanly, and draw only as the faint mark on their call.
 */
const troubled = (hook: HookEntryDto): boolean =>
  hook.status !== "completed" || hook.output.length > 0

/**
 * A turn's entries, with each delegation's own lines gathered under the call that asked
 * for them.
 *
 * **Keyed by the provider's `tool_use` id and never by arrival order.** A subagent
 * started with `run_in_background` runs while its parent keeps working, so the two
 * interleave in the stream — a rule that closed a delegation at the next unrelated line
 * would file half of one agent's work under the other. Every open delegation stays open
 * for the rest of the turn for the same reason.
 *
 * **A line whose `parent` names no delegation stays where it is.** That is every line of
 * every transcript written before the id existed, and it is also a subagent whose
 * `task_started` never arrived — both read as the agent's own work, which is what they
 * looked like before and is the conservative direction.
 *
 * Three things are deliberately dropped, and two of them are read on their way out. The
 * `Tool` call that opened the delegation, whose `call` matches a head: the `Subagent`
 * entry says the same thing and more, so keeping both draws the row twice — once as the
 * job and once as `Agent general-purpose`. Its `backgrounded` is kept first, because that
 * is the only place on the wire it exists. And the `ToolResult` note answering that call,
 * which has no summary and nothing to add about a delegation the card is already drawing.
 *
 * **One `Agent` call is owed exactly one outcome, and it is recognised by the id it names
 * rather than by where it lands.** An inline delegation blocks its parent, so the call
 * cannot report until the answer has — `task_notification`, then `tool_result`. A
 * backgrounded one reports at once: `task_started`, then a `tool_result` saying *async agent
 * launched successfully*, and the answer arrives much later with nothing behind it at all.
 * Both carry the `Agent` call's own id, so both are found by asking, and no ordering has to
 * be assumed: not the two above, not a head that lands while a parent call is already open,
 * not two launches acknowledged out of order, and not the bookkeeping the engine writes in
 * between.
 *
 * **This replaced a queue, and the queue is why the same defect was found three times.**
 * Owed-one-outcome was true and unenforceable by position: a delegation was enqueued at its
 * head, so the next top-level outcome was taken as its own — and the `Agent` call is
 * routinely issued in the same message as another tool, whose outcome arrives first. That
 * outcome then vanished from the run it belonged to, which went on counting up as though
 * still waiting, while a failure it carried was drawn on the card instead of on the command
 * that earned it.
 *
 * **The third thing dropped is an answer naming no delegation and no job, and it is
 * dropped here rather than filtered in the provider.** `system/task_notification` carries
 * no `task_type`, so the normalizer — stateless by design, which is the reason
 * `known-kinds.json` already gives for leaving `task_updated` alone — cannot tell a
 * subagent's answer from a slow shell command's, and 309 of 317 observed bookends are the
 * shell. Here both halves are in hand: a `task_started` opened a delegation under that
 * id, a backgrounded call opened a job, or nothing did. So the unmatched ones are the
 * inline ones, and drawing *A subagent answered* for each `pnpm verify` is the symptom
 * this whole treatment exists to remove — where a *background* command's completion is
 * the fact a person is waiting on, and lands on the card its call opened.
 *
 * **When the parent's own outcome reports an error it is the only observed verdict there
 * is**, so it sets the delegation's `ok` rather than being thrown away. `SubagentResult.ok`
 * comes from comparing a status against `"failed"`, a spelling nobody has captured; this
 * came from `is_error`, which is on the wire. Dropping it would leave the guess as the sole
 * source of a failure signal it cannot reliably produce. A launch acknowledgement that comes
 * back an error is read the same way: a delegation that failed before it started puts
 * `failed` on the card, which says more than an error row beside a card drawn as running.
 *
 * **An outcome that names no call at all is read as the parent's own**, which is every one
 * written before the id existed — `unansweredCalls` is what still counts those onto the
 * calls above them. So a delegation's acknowledgement in such a transcript is never
 * recognised here: it is spent on whichever parent call was open, and a sibling's failure
 * landing behind it can lose the badge it earned to a row of its own. Replaying the 24
 * traks in `.orkestra/.database` moves one outcome, and nothing but the id can fix it.
 */
const nest = (entries: readonly TranscriptEntryDto[]): readonly (TranscriptEntryDto | Card)[] => {
  const views = new Map(entries.flatMap((e) => (e._tag === "View" ? [[e.call, e] as const] : [])))
  const viewed = new Map<string, OpenViewed>()
  const checks = checkLines(entries)
  const heads = new Set(entries.flatMap((e) => (e._tag === "Subagent" ? [e.call] : [])))
  // The opener's `backgrounded`, taken in a pass of its own because the two halves arrive
  // in either order: the `Agent` call is written when the CLI frames it and the
  // `task_started` when the task registers, and a background one is the case where the
  // gap between them holds other work.
  const detached = new Map(
    entries.flatMap((e) =>
      e._tag === "Tool" && e.call !== undefined ? [[e.call, e.backgrounded === true] as const] : [],
    ),
  )
  // A delegation is never a job as well: its card says strictly more, `background` mark
  // included — so the heads are taken out here, or the `Agent` call a card already
  // replaces would open a second card as a job.
  const backgrounded = new Set([...backgroundCalls(entries)].filter((call) => !heads.has(call)))
  const { descriptions, taskIds } = startedJobs(entries)
  const open = new Map<string, OpenDelegation>()
  const jobs = new Map<string, OpenJob>()
  const out: (TranscriptEntryDto | Card)[] = []

  for (const entry of entries) {
    // The two state entries are consumed by the passes above and draw no row of their
    // own: the live list at the input bar is the level's surface, and the transcript
    // keeps no frozen record of what a turn ended with.
    if (entry._tag === "Background" || entry._tag === "BackgroundStarted") continue
    // A fact about a call, drawn where the call is — never a row of its own.
    if (entry._tag === "View" || entry._tag === "Check") continue
    if (entry._tag === "Subagent") {
      const node: OpenDelegation = {
        head: entry,
        result: undefined,
        ok: undefined,
        backgrounded: detached.get(entry.call) ?? false,
        entries: [],
      }
      open.set(entry.call, node)
      out.push(node)
      continue
    }
    if (entry._tag === "SubagentResult") {
      const node = open.get(entry.call)
      if (node !== undefined) {
        node.result = entry
        node.ok = entry.ok
        continue
      }
      // A background command's completion lands on the card its call opened — drawn
      // when it lands, which is the moment a person watching learns the work is over.
      const job = jobs.get(entry.call)
      if (job !== undefined) {
        job.report = entry
        job.ok = entry.ok
        continue
      }
      // A `task_notification` for a task nothing here opened: an inline shell
      // command's. Dropped rather than drawn — every `pnpm verify` writes one, and
      // *A subagent answered* beside each was the regression this treatment removed.
      continue
    }
    // A sidechain line between two answers belongs to its own subagent, and is the
    // subagent's work rather than the parent's however the two interleave.
    const parent = insideOf(entry)
    const inside = parent === undefined ? undefined : open.get(parent)
    if (inside !== undefined) {
      inside.entries.push(entry)
      continue
    }
    // A call that left a view is the view's card, out of whatever run it was made in.
    const view =
      entry._tag === "Tool" && entry.call !== undefined ? views.get(entry.call) : undefined
    if (entry._tag === "Tool" && entry.call !== undefined && view !== undefined) {
      const node: OpenViewed = { view, call: entry, ok: undefined }
      viewed.set(entry.call, node)
      out.push(node)
      continue
    }
    // A call on the engine's check tool is its card. Its outcome is the card's own verdict,
    // so the result line the call left is dropped below rather than drawn.
    const checked =
      entry._tag === "Tool" && entry.call !== undefined ? checks.get(entry.call) : undefined
    if (entry._tag === "Tool" && checked !== undefined) {
      out.push({ checked, call: entry })
      continue
    }
    // A backgrounded shell call is a card, not a row in a run: the turn went on without
    // it, so what follows in the log is not what it did — and its completion needs a
    // place to land minutes later.
    if (entry._tag === "Tool" && entry.call !== undefined && backgrounded.has(entry.call)) {
      const node: OpenJob = {
        head: entry,
        report: undefined,
        ok: undefined,
        description: descriptions.get(entry.call),
        taskId: taskIds.get(entry.call),
      }
      jobs.set(entry.call, node)
      out.push(node)
      continue
    }
    const answers = outcomeCall(entry)
    const drawn = answers === undefined ? undefined : viewed.get(answers)
    if (drawn !== undefined) {
      drawn.ok = !isFailedOutcome(entry)
      continue
    }
    if (answers !== undefined && checks.has(answers)) continue
    if (answers !== undefined && heads.has(answers)) {
      // The `Agent` call's own outcome — the launch acknowledgement or the report behind
      // the answer, and the card is drawing whichever it is. A clean one adds nothing to it;
      // a failed one is the only verdict anything observed, and it lands on the delegation
      // it names rather than on the one that has been waiting longest.
      const broken = isFailedOutcome(entry) ? open.get(answers) : undefined
      if (broken !== undefined) broken.ok = false
      continue
    }
    if (answers !== undefined && jobs.has(answers)) {
      // The job's launch acknowledgement, read the same way: a clean one says the card's
      // own story, a failed one is a launch that failed and the only verdict there is.
      const broken = isFailedOutcome(entry) ? jobs.get(answers) : undefined
      if (broken !== undefined) broken.ok = false
      continue
    }
    const opener = entry._tag === "Tool" && entry.call !== undefined && heads.has(entry.call)
    if (!opener) out.push(entry)
  }

  return out
}

/**
 * The calls in a group nothing has reported on, oldest first.
 *
 * **Matched where the outcome names a call, counted where it does not.** The id is the
 * whole answer when it is there: an outcome joins the call it names whichever order the
 * turn's parallel calls came back in. An outcome carrying none is still owed to *some* call
 * in the run, so it is counted off the front of what remains — the rule every entry written
 * before the id was carried is read by, and the reason a run in an old transcript still
 * folds instead of drawing a row per outcome.
 */
export const unansweredCalls = (group: readonly TranscriptEntryDto[]): readonly ToolEntryDto[] => {
  const outcomes = group.filter(isOutcome)
  const answered = new Set(
    outcomes.flatMap((e) => {
      const call = outcomeCall(e)
      return call === undefined ? [] : [call]
    }),
  )
  const unnamed = outcomes.filter((e) => outcomeCall(e) === undefined).length
  return groupCalls(group)
    .filter((call) => call.call === undefined || !answered.has(call.call))
    .slice(unnamed)
}

/**
 * The run an outcome belongs to. `undefined` where nothing in the turn so far is waiting for
 * it — which `gather` draws as a row only when it failed, a clean one saying nothing at all
 * without the call it answers.
 *
 * The group holding the call it names, or — for an outcome naming none — the earliest group
 * still holding an unreported call, since with two open at once the one that has been
 * waiting longest is the one whose outcome is due.
 */
const reportedOn = (
  groups: readonly TranscriptEntryDto[][],
  outcome: TranscriptEntryDto,
): TranscriptEntryDto[] | undefined => {
  const call = outcomeCall(outcome)
  if (call !== undefined)
    return groups.find((group) => group.some((e) => e._tag === "Tool" && e.call === call))
  return groups.find((group) => group[0]?._tag === "Tool" && unansweredCalls(group).length > 0)
}

/**
 * One agent's entries, with an unbroken stretch of calling gathered into one group.
 *
 * **A rendering rule, and it belongs nowhere else.** A step that read 284 files is
 * unreadable as 284 rows, but the paths are the reason the rows exist — so the
 * collapsing happens here, where a group can be expanded back into what it stands for.
 * Aggregating at the event or at the store would throw the paths away.
 *
 * **A run is calls separated only by their own results — of any kind, not of one.** It
 * grouped by kind until a read between two edits broke both, which against a real
 * transcript is most of them: an agent interleaves. What a row stands for is therefore a
 * *stretch of working*, and `phraseForRun` is what counts the kinds inside it — `Read 4
 * files, and ran 1 command` rather than three rows that have to be read together to say
 * the same thing.
 *
 * **What separates two runs is a pause, and every pause gets a group of its own here** —
 * the same group anything that is not a call takes, with the one exception that a pause
 * following a pause joins it rather than opening a second. Which of those groups is
 * *drawn* is a later question and a different one: only the live tail is, and `withoutEndedPauses`
 * is what asks it. `ActivityGroup` is what knows the row is three dots and their name —
 * the model's own summary where it gave one — rather than a line of text, and `Thinking`
 * carries why.
 *
 * The outcomes ride along in the group they belong to rather than being dropped, because
 * a row has to be able to say *three of these four failed*.
 *
 * Takes one agent's lines, which is what makes it reusable inside a delegation: the
 * subagent's own log is grouped by exactly this rule.
 */
export const groupRuns = (
  entries: readonly TranscriptEntryDto[],
): readonly (readonly TranscriptEntryDto[])[] =>
  // A list of one agent's own entries holds no cards, so this drops nothing: it is
  // the narrowing back to what a caller with no cards in its input asked for.
  gather(entries).flatMap((item) => (isCard(item) ? [] : [item]))

/**
 * Where each hook rides: on the line of the call it ran for, or — a stray — in the run it
 * arrived in. **Never a row of its own, so it never ends a run**: a hook between two reads
 * leaves them one `Read 2 files`.
 *
 * Only a call on a line of a run carries a mark, so a hook on one a card took — a view, a
 * check, a delegation, a background job — or naming no call is a stray, and a stray that
 * ran cleanly and printed nothing has nothing to say and is dropped.
 *
 * A pre-call hook arrives before its call, so it waits for the call to land and joins
 * the run that takes it. A stray joins the newest run behind it, or where the turn has
 * none yet, the first run after it. One that finds no run at all in its turn is the one
 * case drawn on a line of its own, after everything else: dropping it would hide a hook
 * that failed or blocked, which is the case it is kept for.
 */
const hookPlacer = (items: readonly (TranscriptEntryDto | Card)[]) => {
  const lined = new Set(
    items.flatMap((e) => (!isCard(e) && e._tag === "Tool" && e.call !== undefined ? [e.call] : [])),
  )
  const waiting = new Map<string, HookEntryDto[]>()
  const strays: HookEntryDto[] = []
  return {
    place: (hook: HookEntryDto, runs: readonly TranscriptEntryDto[][]): void => {
      const call = hook.call
      if (call !== undefined && lined.has(call)) {
        const run = runs.find((group) => group.some((e) => e._tag === "Tool" && e.call === call))
        if (run === undefined) waiting.set(call, [...(waiting.get(call) ?? []), hook])
        else run.push(hook)
        return
      }
      if (!troubled(hook)) return
      const run = runs.findLast((group) => group[0]?._tag === "Tool")
      if (run === undefined) strays.push(hook)
      else run.push(hook)
    },
    /** A call has just joined `run`: what was waiting on it, and any stray held for a run. */
    landed: (call: ToolEntryDto, run: TranscriptEntryDto[]): void => {
      run.push(...(call.call === undefined ? [] : (waiting.get(call.call) ?? [])), ...strays)
      if (call.call !== undefined) waiting.delete(call.call)
      strays.length = 0
    },
    leftover: (): readonly HookEntryDto[] => strays,
  }
}

/**
 * The rule above, over a turn's rows — which are its runs *and* its delegations.
 *
 * **A delegation is a group already** — its own head, its own outcomes, its own runs inside
 * it — so it never joins a run and always closes the one behind it. What it must not do is
 * end the turn's accounting: a parent call issued beside the `Agent` is still open when the
 * card lands, and its outcome arrives after it. Grouping each stretch between two cards
 * separately left that outcome with no call to fold onto, so it drew as a bare
 * `ToolResult(ok)` row under the card while the command above went on counting up.
 */
const gather = (
  items: readonly (TranscriptEntryDto | Card)[],
): readonly (TranscriptEntryDto[] | Card)[] => {
  const out: (TranscriptEntryDto[] | Card)[] = []
  /** The runs in `out`, in order — every group an outcome may still fold back onto. */
  const groups: TranscriptEntryDto[][] = []
  /** The run at the end, while there is one: `undefined` once a card has closed it. */
  let last: TranscriptEntryDto[] | undefined
  /** Whether that run is still open to another call. */
  let running = false
  const hooks = hookPlacer(items)
  for (const entry of items) {
    // A job is a card exactly as a delegation is: its own row, and the run behind it
    // closed — a burst of backgrounded calls draws a card each, never a folded run.
    if (isCard(entry)) {
      out.push(entry)
      last = undefined
      running = false
      continue
    }
    if (entry._tag === "Hook") {
      hooks.place(entry, groups)
      continue
    }
    // A denial joins the run holding the call it names, as an outcome does, and draws on
    // that call's line. One naming no call here falls through to a row of its own.
    const deniedRun =
      entry._tag === "Denied" && entry.call !== undefined
        ? groups.find((g) => g.some((e) => e._tag === "Tool" && e.call === entry.call))
        : undefined
    if (deniedRun !== undefined) {
      deniedRun.push(entry)
      continue
    }
    const head = last?.[0]
    // Two pauses with nothing between them are one pause. `runtime.ts` already collapses a
    // burst of ticks into one line, so a second line means a second burst — with something
    // between them that `workOnly` has since taken away, or a second summary from a model
    // that thought twice before acting. What the row says is *it is thinking now*, and it
    // says it once; `ActivityGroup` names the dots by the latest summary in the group, the
    // way `pauseRetry` reads the latest attempt.
    if (isPause(entry) && head !== undefined && isPause(head)) {
      last?.push(entry)
      continue
    }
    // A retry joins the pause it interrupted, exactly as an outcome joins its call. The
    // agent was waiting either way, so a line of its own between two stretches of work
    // would draw the wait as a third thing that happened — and it belongs to no tool
    // call, so it must not take the ink that means one failed. `pauseRetry` is what reads
    // it back out; a retry with no pause in front of it falls through to a row of its own.
    if (entry._tag === "ApiRetry" && head !== undefined && isPause(head)) {
      last?.push(entry)
      continue
    }
    // A call's own result joins the run it reports on and never starts a group of its own —
    // **however far from its call it landed**. A pause, a delegation's card and a kind
    // nobody catalogued all land between a call and its outcome, and parallel calls report
    // in whatever order they finish: asking only whether the *last* group is a run left the
    // outcome opening a group, drawing `ToolResult(ok)` as a row beside a command whose own
    // row then counted up forever. Whatever it landed behind keeps its own row and the
    // outcome folds back past it. It leaves `running` alone either way: the call it reports
    // on did not end the run, and whatever came between them did.
    //
    // Which run is `reportedOn`'s answer, and it is the id's when the outcome carries one.
    const reported = isOutcome(entry) ? reportedOn(groups, entry) : undefined
    if (reported !== undefined) {
      reported.push(entry)
      continue
    }
    // An outcome nothing here is waiting for, which is a delegation's acknowledgement in
    // any transcript written before the provider carried the id — nothing joins it to the
    // `Agent` call, and the call itself was dropped with the card that replaced it. Drawn
    // only if it failed: `ToolResult(ok)` on its own names no tool, no path and no time, so
    // the row is the one the request pasted and says nothing a reader can use, where a
    // failure is evidence and the only account of it there is.
    if (isOutcome(entry) && !isFailedOutcome(entry)) continue
    if (entry._tag === "Tool" && running && last !== undefined) {
      last.push(entry)
      hooks.landed(entry, last)
      continue
    }
    const group = [entry]
    out.push(group)
    groups.push(group)
    last = group
    if (entry._tag === "Tool") hooks.landed(entry, group)
    // Anything that is not a call is its own row and closes the run behind it.
    running = entry._tag === "Tool"
  }
  for (const stray of hooks.leftover()) out.push([stray])
  return out
}

/**
 * Where a turn's late conversation starts: the first message a person sent that the
 * agent read after it had given its answer, or the end of the list where there is none.
 *
 * Everything from there on is a second exchange in the same process — the step keeps
 * the answer it filed, and the reply is conversation only — so a surface draws it below
 * the document rather than above it, where it would read as leading up to the answer.
 * A message read *before* the answer is part of the work and stays where it was read.
 */
export const lateFrom = (entries: readonly TranscriptEntryDto[]): number => {
  const answered = entries.findIndex((e) => e._tag === "Note" && e.text.startsWith("Result("))
  if (answered === -1) return entries.length
  const said = entries.findIndex((e, i) => i > answered && e._tag === "Said")
  return said === -1 ? entries.length : said
}

/**
 * A turn's entries as the rows to draw: runs of one activity, and delegations.
 *
 * `isDelegation` is what a caller tells the two apart by.
 */
export const groupEntries = (
  entries: readonly TranscriptEntryDto[],
): readonly (readonly TranscriptEntryDto[] | Card)[] => gather(nest(entries))

/**
 * The retry a pause is drawn with, where the provider retried during it.
 *
 * **The most recent attempt rather than all of them.** `attempt 4 of 5` supersedes
 * `attempt 3 of 5` — the row says *what is happening in this pause*, and a pause that
 * stacked a line per attempt would draw the same wait four times over.
 *
 * `undefined` for a group that is not a pause at all, which is every group holding work:
 * a retry that landed with no pause in front of it is its own row, and `ActivityRow`'s
 * `ApiRetry` arm is what draws that.
 */
export const pauseRetry = (group: readonly TranscriptEntryDto[]): ApiRetryEntryDto | undefined => {
  const head = group[0]
  if (head === undefined || !isPause(head)) return undefined
  return group.flatMap((e) => (e._tag === "ApiRetry" ? [e] : [])).at(-1)
}

/**
 * A pause that is over: not the one still happening, and with no retry to account for.
 *
 * `stillGoing` is the caller's fact rather than the row's — a pause cannot tell from its
 * own contents whether anything is still driving the turn it sits in.
 */
const endedPause = (row: readonly TranscriptEntryDto[] | Card, stillGoing: boolean): boolean => {
  if (stillGoing || isCard(row)) return false
  const head = row[0]
  return head !== undefined && isPause(head) && pauseRetry(row) === undefined
}

/**
 * A turn's rows without the pauses that have ended.
 *
 * **The dots say *it is thinking now*, and that is true of at most one row on a screen.**
 * `runtime.ts` writes a line per burst, so a turn that stopped six times drew six sets of
 * animating dots — a record of every wait that ever happened, with nothing separating the
 * one still going from the five that are over. Kept where it is the last row of a turn
 * something is still driving; dropped everywhere else, including at the tail of a turn
 * nothing is carrying, where the animation is precisely the confident wrong fact
 * `runningSince` refuses for the same reason.
 *
 * **A summary on the pause changes none of this.** The words are the dots' name — what
 * the agent is working out *now* — and a name for a wait that is over is a row saying
 * nothing the calls either side do not; the calls are the log and the pause is the live
 * explanation between them.
 *
 * **A dropped pause leaves nothing behind, and nothing marks where one was.** The pane
 * spaces every pair of rows in it by the same 8px, so air standing in for the boundary
 * would be a second gap on top of the one the list already gives — the one row in the log
 * spaced unlike its neighbours. The cost is accepted and is the whole of it: two stretches
 * of working separated by a pause are drawn exactly as two stretches that were not.
 *
 * **A pause the provider retried during survives either way**, because it is the only
 * visible account of the retry: `gather` folded the `ApiRetry` into it, so `ActivityRow`'s
 * own `ApiRetry` arm can no longer draw what this would drop.
 *
 * **Positional, so it runs over the rows and not over the entries.** Every other filter
 * here drops an entry by what it *is*; this one asks where it landed, which is only
 * knowable once `groupEntries` has grouped them. Filtering earlier would also stop a pause
 * ending the run behind it, and a run is a stretch of working precisely because a pause
 * closes it.
 *
 * A hidden pause therefore still ends its run, and two run rows can end up adjacent with
 * nothing between them. That is the cheaper wrong of the two: merging them would fold a
 * whole turn into one row over one opened list of everything it did, and cost `1 failed`
 * the stretch it annotates.
 *
 * A rendering rule and nothing more — the line stays in `transcript.jsonl` and on the
 * wire, as `workOnly`'s catalogued kinds do.
 */
export const withoutEndedPauses = <Kept extends readonly TranscriptEntryDto[] | Card>(
  rows: readonly Kept[],
  live: boolean,
): readonly Kept[] => rows.filter((row, i) => !endedPause(row, live && i === rows.length - 1))

/**
 * How a job's card reads once there is anything to say: an outcome word when it landed,
 * and nothing while it runs.
 *
 * `stopped` first and unconditionally — a stop is a thing that was done to the job, not
 * a verdict on it, and neither `ok` may repaint it. `failed` is either verdict that
 * exists: the report's own, or the launch acknowledgement's, which is the only one a job
 * that never started gets. `undefined` is a job still running — and equally one a torn-
 * down turn left unreported, where a word would be a guess about work nothing observed.
 */
export const jobOutcome = (job: Job): "completed" | "failed" | "stopped" | undefined => {
  if (job.report === undefined) return job.ok === false ? "failed" : undefined
  if (job.report.outcome === "stopped") return "stopped"
  if (job.ok === false) return "failed"
  return "completed"
}

/**
 * The calls a group stands for, without the results that ride with them.
 *
 * Narrowed to `ToolEntryDto` rather than left at the wire's union: a run holds calls of
 * several kinds now, so its row is counted by `kind` and its opened rows are labelled by
 * `name` — and both of those are questions only a call can answer.
 */
export const groupCalls = (group: readonly TranscriptEntryDto[]): readonly ToolEntryDto[] =>
  group.filter((e) => e._tag === "Tool")

/** How many of a group's calls came back non-zero. `0` is the ordinary case. */
export const groupFailures = (group: readonly TranscriptEntryDto[]): number =>
  group.filter(isFailedOutcome).length

/**
 * When the earliest call a run is still waiting on was made. `undefined` where every call
 * has been answered. `unansweredCalls` is where an outcome is joined to its call — by the
 * id it names, and by counting only where it names none.
 *
 * **Ask this only of a group that is the live tail of a turn something is still driving.**
 * A run in the middle of a transcript is over whatever its outcomes say — a turn that died
 * mid-call leaves one unanswered forever — and a duration counting up on one of those is
 * precisely the confident wrong fact this treatment exists to remove. `TurnSection` is
 * where that is decided, and `undefined` is what a row with no stamp gets either way.
 */
export const runningSince = (group: readonly TranscriptEntryDto[]): number | undefined =>
  unansweredCalls(group)[0]?.at

/**
 * The newest row the live log would draw, as the one line a trak's row has room for — the
 * agent's words, `Thinking` or the model's name for what it is working out, or a run's
 * phrase such as `Read 1 file, and ran 2 commands`.
 *
 * **The log's own pipeline, and then its own words for the last row.** `workOnly`,
 * `groupEntries` and `withoutEndedPauses` decide which row is last, exactly as they do in
 * `TurnSection`; `ActivityGroup` names a run by `phraseForRun` and a pause by `pauseText`,
 * and so does this. A row that summarised on rules of its own would say `Read src/a.ts`
 * while the log beside it said `Read 4 files`.
 *
 * **Asked only of a turn something is still driving**, which is the only time the engine
 * sends the entries — so the live pause survives and an ended one does not, as at the
 * log's live end.
 *
 * A card names what it stands for: a delegation by the job it was given, a background job
 * by its description or its command. `undefined` where no row would be drawn — a turn that
 * has only just started, or one whose newest words were the envelope it is filing.
 */
export const latestActivity = (
  entries: readonly TranscriptEntryDto[],
  envelope: string | undefined,
): string | undefined => {
  const filed = new Set(envelope === undefined ? [] : [envelope])
  const last = withoutEndedPauses(
    groupEntries(withoutEnvelopes(workOnly(entries), filed)),
    true,
  ).at(-1)
  if (last === undefined) return undefined
  if (isDelegation(last)) return activityText(last.head)
  if (isJob(last)) return `Backgrounded ${last.description ?? last.head.detail ?? last.head.name}`
  if (isViewed(last)) return `${last.view.server}/${last.view.tool}`
  if (isChecked(last)) return `${last.checked.server}/${last.checked.tool} ${last.checked.name}`
  const calls = groupCalls(last)
  if (calls.length > 0) return phraseForRun(calls.map((call) => call.kind))
  const pause = last.findLast(isPause)
  if (pause !== undefined) {
    const retry = pauseRetry(last)
    const name = pauseText(pause) ?? "Thinking"
    return retry === undefined ? name : `${name} · ${retryText(retry)}`
  }
  // Any other group is one entry, drawn as its own row.
  const entry = last.at(-1)
  return entry === undefined ? undefined : activityText(entry)
}
