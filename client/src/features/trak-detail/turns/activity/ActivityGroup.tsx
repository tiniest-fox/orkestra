/**
 * A stretch of calling, as one row that opens into the calls it stands for.
 *
 * A step that read forty files is unreadable as forty rows and useless as "40 tool calls"
 * — so the row says `Read 40 files` and the paths are one click away. One phrase rather
 * than a name and a count beside each other: `Read ×40` *and* `40 files` says the same
 * thing twice and leaves the reader deciding which half is the row.
 *
 * **Only a failure is marked.** A tick on every successful call is a column saying "as
 * expected" twenty times, and what a reader scans that column for is the one row that did
 * not work — so success is silent and it is the failures that get the ink. It also gives
 * the detail column its width back, so fewer paths truncate at all.
 *
 * **A call draws the same way whether there are forty of them or one.** A lone call used to
 * put its name and its path straight on the row, which made the log two kinds of row that
 * had to be told apart before either could be read — and the count is what says which. So
 * one call is `Read 1 file` and opens into its path, exactly as four do.
 *
 * **A run holds whatever the agent did between two pauses, so the row can name more than
 * one kind**: `Read 4 files, and ran 1 command`. `phraseForRun` writes the sentence and
 * `groupRuns` decides where it starts and stops.
 *
 * **Opened, a run labels each call when the head has not already named it.** `Read 4
 * files` over four paths would be `Read` said four more times; a run holding two tools,
 * or one whose phrase is `Called 3 times`, says nothing about which line is which.
 * `labelsCalls` owns that question and carries why it is asked of names rather than kinds.
 *
 * **An MCP call opens to its mark and `server/tool`, never the provider's name for it**, so
 * a Claude row and a Codex row draw alike. The mark holds the label column whether or not
 * the run labels its built-in calls — `labelsCalls` asks that of them alone.
 *
 * **A call the agent described opens to its description over its command.** The closed row
 * and a running line both say what it is for; the command is what opening it is for.
 *
 * **A call still running stands out of the run, on a line of its own under it**, and the
 * row counts only the calls that have come back — so `Read 2 files` over a running
 * `pnpm verify` becomes `Read 2 files, and ran 1 command` when the result lands and the
 * line folds into it. A run whose every call is still open draws no row at all, only the
 * lines. `RunningCall` carries the line, its mark and its clock.
 *
 * **A hook marks the line of the call it ran for, and only that line.** The closed row says
 * nothing about hooks, a failed or blocked one included — it keeps its `N failed` and no
 * more — and opening it shows each call's `HookMark` at the right end, last after a
 * `failed` label. A call the CLI refused carries a `denied · <rule>` label there too, before
 * its hooks. A hook naming none of the run's calls draws as a quiet `<event> hook`
 * line under them with its mark.
 *
 * **A finished run says nothing about how long it took** — the cost of the treatment,
 * taken deliberately: the number is at its most useful on the call a person is waiting on,
 * and a column of durations on rows that are over is the noise the eye has to skip past to
 * find it. `unansweredCalls` is what decides a call is still open, and `live` is what says
 * the turn this group belongs to is one something is still driving.
 */

import type { ReactNode } from "react"
import { useState } from "react"
import { ChevronRight } from "lucide-react"
import type { HookEntryDto, TranscriptEntryDto } from "../../../../api/types"
import { Detail, QUIET } from "../../../../components/ToolCall"
import { retryText } from "../../../../format/activity"
import { deniedOn } from "../../../../format/denied"
import { hooksOn, strayHooks } from "../../../../format/hooks"
import ActivityRow from "./ActivityRow"
import DeniedMark from "./DeniedMark"
import HookMark from "./HookMark"
import Line from "./Line"
import McpMark from "./McpMark"
import RunningCall from "./RunningCall"
import Thinking from "./Thinking"
import {
  groupCalls,
  groupFailures,
  isPause,
  pauseRetry,
  pauseText,
  unansweredCalls,
} from "../../../../format/transcriptRows"
import { labelsCalls, phraseForRun } from "../../../../format/toolPhrase"

/** A described call opened: what it is for, and the command under it in the quieter ink. */
const DescribedCall = ({
  description,
  command,
}: {
  readonly description: string
  readonly command: string
}): ReactNode => (
  <span className="flex min-w-0 flex-1 flex-col">
    <span className="min-w-0 truncate font-mono text-xs text-fg-muted">{description}</span>
    <span className={QUIET}>{command}</span>
  </span>
)

/** A hook naming none of the run's calls, as a quiet line under them with its mark. */
const StrayHook = ({ hook }: { readonly hook: HookEntryDto }): ReactNode => (
  <li className="flex min-w-0 items-baseline gap-2 py-0.5">
    <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-subtle">{`${hook.event} hook`}</span>
    <HookMark hooks={[hook]} />
  </li>
)

const ActivityGroup = ({
  group,
  live = false,
  driving = false,
}: {
  readonly group: readonly TranscriptEntryDto[]
  /**
   * Whether this group is the live end of a turn something is still driving.
   *
   * **Defaults to `false`, which is the answer for all but the few at the live end.** A run
   * reads as finished unless a caller that can see the whole picture says otherwise —
   * `TurnSection` is the only one that can, and a group that guessed from its own contents
   * would count up forever on a turn that died mid-call.
   */
  readonly live?: boolean
  /**
   * Whether anything is still driving the turn this group sits in — the same fact
   * `withoutEndedPauses` is given, and a wider one than `live`: a group in the middle of a turn
   * something is driving is not the live end and is still in a turn being driven.
   *
   * **One row reads it, and only for its dots.** A pause the provider retried during is
   * drawn after the wait is over, wherever it sits, and the dots on it are a claim about
   * right now — so they stop when the turn does. Nothing else on the row moves.
   */
  readonly driving?: boolean
}): ReactNode => {
  const [open, setOpen] = useState(false)
  const all = groupCalls(group)
  const head = all[0]
  const failures = groupFailures(group)

  // A group holding no calls at all is not a run, and draws as whatever it is. Mapping
  // rather than taking the head: a branch that rendered `group[0]` alone would drop
  // entries silently if the grouping rule ever widened.
  if (head === undefined) {
    // A pause reaching here is one of exactly two: the live tail of a turn something is
    // still driving, or one the provider retried during. `withoutEndedPauses` dropped the rest
    // before this was asked, so the only question left is whether the wait is still going
    // — and the second of the two is the one that can be drawn after it ended.
    //
    // A pause the provider retried during is one row rather than the pause and a line per
    // attempt — `Thinking` is what the whole of it says, and the words are what it gained.
    //
    // The dots are named by the latest summary in the group, as the retry is the latest
    // attempt: `gather` folds a model's second thought onto its first, and what the row
    // says is what it is thinking *now*.
    const pause = group.findLast(isPause)
    if (pause !== undefined) {
      const retry = pauseRetry(group)
      return (
        <li className="min-w-0">
          <Line>
            <Thinking
              text={pauseText(pause)}
              retry={retry === undefined ? undefined : retryText(retry)}
              ended={retry !== undefined && !driving}
            />
          </Line>
        </li>
      )
    }
    return group.map((entry, i) => (
      // oxlint-disable-next-line react/no-array-index-key -- append-only transcript
      <li key={i} className="min-w-0">
        <ActivityRow entry={entry} />
      </li>
    ))
  }

  const failed =
    failures === 0 ? undefined : (
      <span className="font-mono text-2xs text-tone-bad">{`${failures} failed`}</span>
    )

  // Every call nothing has answered, in dispatch order — two dispatched together are two
  // lines, whichever answers first. Asked only of a live group: a turn that died mid-call
  // leaves a call unanswered forever, and it must fold like any other.
  const running = live ? unansweredCalls(group) : []
  const calls = all.filter((call) => !running.includes(call))

  const kinds = calls.map((call) => call.kind)
  const labelled = labelsCalls(calls)

  return (
    <li className="min-w-0">
      {calls.length === 0 ? undefined : (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => {
              setOpen(!open)
            }}
            className="w-full rounded-control hover:bg-hover-row"
          >
            <Line
              lead={
                <ChevronRight size={12} className={`text-fg-subtle ${open ? "rotate-90" : ""}`} />
              }
              trailing={failed}
            >
              <span className="font-mono text-xs text-fg">{phraseForRun(kinds)}</span>
            </Line>
          </button>
          {/* The calls it stands for, on a rule that starts under the caret — so they read as
              inside the row above rather than as more rows beside it. The three together land
              their text in the same column as the group's own phrase, which is `Line`'s. */}
          {open ? (
            <ol className="ml-1.5 flex min-w-0 flex-col border-l border-border pl-2">
              {calls.map((entry, i) => (
                // oxlint-disable-next-line react/no-array-index-key -- append-only transcript
                <li key={i} className="flex min-w-0 items-baseline gap-2 py-0.5">
                  {entry.kind === "Mcp" ? (
                    <McpMark />
                  ) : labelled ? (
                    <span className="shrink-0 font-mono text-xs text-fg-subtle">{entry.name}</span>
                  ) : undefined}
                  {entry.detail === undefined ? undefined : entry.command === undefined ? (
                    <Detail text={entry.detail} kind={entry.kind} />
                  ) : (
                    <DescribedCall description={entry.detail} command={entry.command} />
                  )}
                  <DeniedMark denied={deniedOn(group, entry.call)} />
                  <HookMark hooks={hooksOn(group, entry.call)} />
                </li>
              ))}
              {strayHooks(group).map((hook, i) => (
                // oxlint-disable-next-line react/no-array-index-key -- append-only transcript
                <StrayHook key={`hook-${i}`} hook={hook} />
              ))}
            </ol>
          ) : undefined}
        </>
      )}
      {running.map((call, i) => (
        <RunningCall key={call.call ?? i} call={call} hooks={hooksOn(group, call.call)} />
      ))}
    </li>
  )
}

export default ActivityGroup
