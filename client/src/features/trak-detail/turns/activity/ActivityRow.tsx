/**
 * One transcript entry, on one line.
 *
 * A tool call is `ToolCall` — the tool's own name and what it acted on, drawn apart, with
 * the detail truncating from whichever end is the throwaway one. It is a shared component
 * because the list row's activity slot draws the same entry.
 *
 * Everything else is a line the engine already wrote, drawn quieter than the work —
 * everything except `Text`, which is the agent speaking and leaves the columns for the
 * bubble. `AgentMessage` carries why that is a property of the voice rather than of where
 * in the turn it happened.
 */

import type { ReactNode } from "react"
import type { TranscriptEntryDto } from "../../../../api/types"
import ToolCall, { QUIET } from "../../../../components/ToolCall"
import { activityText, retryText } from "../../../../format/activity"
import AgentMessage from "./AgentMessage"
import HookMark from "./HookMark"
import Said from "../output/Said"
import Line from "./Line"
import Thinking from "./Thinking"
import { isPause, pauseText } from "../../../../format/transcriptRows"

const ActivityRow = ({ entry }: { readonly entry: TranscriptEntryDto }): ReactNode => {
  switch (entry._tag) {
    // **Nothing reaches this arm any more, and it stays because the switch is total over
    // the wire's union rather than over what one caller happens to send.** A `Tool` entry
    // can only ever be in a `Tool`-headed group, and `ActivityGroup` now draws every one
    // of those as a counted row — so this is what a call looked like before a run of one
    // folded like a run of forty, and what it would fall back to if that stopped.
    case "Tool":
      return (
        <Line>
          <ToolCall name={entry.name} detail={entry.detail} kind={entry.kind} />
        </Line>
      )
    // Never reached, for `Tool`'s reason: `groupEntries` draws the call this line is
    // about as the view's card and drops the line. What it would say if that stopped.
    case "View":
      return (
        <Line>
          <span className={QUIET}>{`${entry.server}/${entry.tool}`}</span>
        </Line>
      )
    // Never reached, for `View`'s reason: the call it is about is drawn as the check's card.
    case "Check":
      return (
        <Line>
          <span className={QUIET}>{`${entry.server}/${entry.tool} ${entry.name}`}</span>
        </Line>
      )
    // A stray hook in a turn that has no run for it to sit in, the one case `gather` leaves
    // on a line of its own: the quiet line it draws inside a run, here outside one.
    case "Hook":
      return (
        <Line trailing={<HookMark hooks={[entry]} />}>
          <span className={QUIET}>{`${entry.event} hook`}</span>
        </Line>
      )
    // A denial naming no call in the turn is the one case `gather` leaves on a line of its
    // own. All three say what `activityText` says, in the quiet ink.
    case "Denied":
    case "Spawned":
    case "Session":
      return (
        <Line>
          <span className={QUIET}>{activityText(entry)}</span>
        </Line>
      )
    // Drawn rather than folded with the rest of the engine's lines: it is the only thing
    // that explains why the agent's answer appears twice in one turn, and a reader who
    // cannot see it is looking at a step that filed the same document over again.
    case "Reask":
      return (
        <Line>
          <span className={QUIET}>{`Asked again — ${entry.reason}`}</span>
        </Line>
      )
    // The one entry that is not a line the engine wrote, so it is the one that leaves the
    // two columns entirely: this is the agent talking, and the agent talking is a bubble.
    // It was a `Line` of muted prose, which read as a longer note among the notes.
    case "Text":
      return <AgentMessage text={entry.text} />
    // The other entry that leaves the two columns, and for the mirrored reason: a person
    // said this to the agent while the turn ran, and this is where in the turn it was
    // read. Anchored right, as the message that started the turn is.
    case "Said":
      return (
        <div className="flex min-w-0 justify-end pl-10 max-sm:pl-0">
          <Said text={entry.text} />
        </div>
      )
    // **Nothing reaches this arm, and it stays for the reason the `Tool` one does.** A
    // `Subagent` entry always opens a delegation in `nest`, answered or not, and
    // `SubagentGroup` is what draws one — a transcript cut off mid-delegation is a card
    // with no answer in it rather than a row. This is what it would fall back to.
    case "Subagent":
      return (
        <Line>
          <span className={QUIET}>
            {`Delegated ${entry.description ?? entry.agentType ?? "to a subagent"}`}
          </span>
        </Line>
      )
    // **Nothing reaches this arm either, and for the same reason the `Tool` one is here:
    // the switch is total over the wire's union rather than over what one caller sends.**
    // An answer that names a delegation rides inside it, and one that names none is a
    // task notification for something that was never a delegation — `nest` drops those
    // rather than drawing *A subagent answered* beside every slow shell command.
    case "SubagentResult":
      return (
        <Line>
          <span className={QUIET}>{entry.ok ? "A subagent answered" : "A subagent failed"}</span>
        </Line>
      )
    // **Nothing reaches these two arms either.** Both are state `nest` consumes — the
    // level folds into the live list and the join into the job cards — so a row here is
    // what either would fall back to if that stopped, on the `Tool` arm's rule that the
    // switch is total over the wire's union.
    case "Background":
      return (
        <Line>
          <span className={QUIET}>
            {entry.tasks.length === 0
              ? "No background work running"
              : `${entry.tasks.length} background ${entry.tasks.length === 1 ? "job" : "jobs"} running`}
          </span>
        </Line>
      )
    case "BackgroundStarted":
      return (
        <Line>
          <span className={QUIET}>{`Backgrounded ${entry.description ?? entry.taskId}`}</span>
        </Line>
      )
    // The fallback, for a retry that landed with no pause in front of it. Where there is
    // one — which is every retry a real turn produces, since the provider is waiting on
    // the model when it retries — `groupRuns` folds it into that pause and `Thinking`
    // draws it in waiting ink. Quiet here rather than absent: a retry a reader cannot see
    // at all is the worse failure of the two.
    case "ApiRetry":
      return (
        <Line>
          <span className={QUIET}>{retryText(entry)}</span>
        </Line>
      )
    // A pause is the one `Note` that is not the engine saying something happened, so it is
    // the one drawn as a mark and its name rather than as a sentence — `Thinking` carries
    // why. **No pause reaches this arm**, for the reason the `Tool` one stays: every
    // pause-headed group is drawn by `ActivityGroup`, which holds the turn's custody and
    // is what can say whether the wait is over. This is what a pause would fall back to
    // — its dots running, since a row cannot tell.
    case "Note":
      return (
        <Line>
          {isPause(entry) ? (
            <Thinking text={pauseText(entry)} />
          ) : (
            <span className={QUIET}>{entry.text}</span>
          )}
        </Line>
      )
  }
}

export default ActivityRow
