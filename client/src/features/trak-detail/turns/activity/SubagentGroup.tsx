/**
 * A delegation, as a card holding the work another agent did inside this turn.
 *
 * **Not a row, and that is the whole answer to the complaint this came from.** Drawn as
 * one, `Agent general-purpose` reads as a tool call that failed — a name in the column
 * where names go, with the space beside it where an argument should be, empty. An edge
 * and a ground say *something else is happening in here* before a word is read.
 *
 * **No accent bar down its left side, ever.** A card that needs to say something says it with its
 * fill, its whole edge, its name or its elevation.
 *
 * **The header is `<agent> · <background|subagent> · <elapsed>`.** The agent leads,
 * because a card already says a delegation happened and what a reader wants next is who
 * it went to; how it was started sits behind it; the clock is right-aligned and is there
 * only while it is running. A working card says nothing else at all, since the elapsed and
 * its dot already carry it.
 *
 * **A delegation with no agent type reads `background task`.** Never *unnamed* and never
 * *hidden*: both read as a field that came back empty, which is the misreading this
 * exists to remove. No captured stream produces one, so the fallback is proved by a test
 * rather than by a fixture.
 *
 * **It opens while running and folds when it is done**, showing what it was *asked* and
 * never what it answered — reading an answer is a click, on purpose: the group is about
 * what is happening, and an answer is detail.
 *
 * **What it was asked is `description`, and the prompt itself is drawn nowhere.** A real
 * one is a kilobyte of headings and numbered lists, and rendered as a bubble it was the
 * same element the agent's own speech uses — so the parent briefing a subagent read as the
 * subagent talking, at the top of the card and longer than everything under it. The
 * truncated line under the agent's name says what the job is, folded or open, and nothing
 * stands in the prompt's place: a card that exists and a line saying what for have already
 * said that a briefing happened.
 *
 * **Inside, the subagent's three most recent lines with `N earlier` above them**, in the
 * column the header's name and the description are already in. No rule and no step in — the
 * border is the only boundary the contents need, and an indent with nothing drawing it is a
 * step nobody can see.
 *
 * **The answer is not a tool call.** It is that agent speaking, so it is drawn as prose.
 */

import type { ReactNode } from "react"
import { Fragment, useState } from "react"
import { ChevronRight } from "lucide-react"
import { elapsedText } from "../../../../format/activity"
import ActivityGroup from "./ActivityGroup"
import AgentMessage from "./AgentMessage"
import Elapsed from "./Elapsed"
import Line from "./Line"
import { groupRuns, withoutEndedPauses, type Delegation } from "../../../../format/transcriptRows"

/** How many of the subagent's own rows a card shows before folding the rest away. */
const WINDOW = 3

/** What a delegation that named no agent type is called. Never blank, never *unnamed*. */
const UNNAMED = "background task"

const SubagentGroup = ({
  delegation,
  live = false,
}: {
  readonly delegation: Delegation
  /**
   * Whether this turn is the one something is still driving — see `ActivityGroup`.
   *
   * Everything that reads it pairs it with `result === undefined`, which is `driving`: the
   * clock in the header, whether the card still ends on a pause, and the liveness its rows
   * are drawn under. *What is it doing right now* is asked hardest of a card that is still
   * open, and answered by none of the three once it answered.
   */
  readonly live?: boolean
}): ReactNode => {
  /**
   * Whether a reader has said which way they want it, which nobody has until they press.
   *
   * **Follows the delegation until then, rather than latching at mount.** A card opened
   * because it was running has to fold when the answer lands, and `useState(running)`
   * would keep it open — the initial value is read once. Once pressed it stays where it
   * was put, because that press was about this card rather than about its state.
   */
  const [pressed, setPressed] = useState<boolean | undefined>(undefined)
  const { head, result, backgrounded } = delegation
  const open = pressed ?? result === undefined
  /** Whether the subagent is still working — the card's own liveness, asked three ways. */
  const driving = live && result === undefined
  const elapsed = driving ? elapsedText(head.at, Date.now()) : undefined

  // A card still working keeps the pause at its tail and drops the earlier ones; one that
  // has answered draws none at all. Before the window rather than after it, so a pause
  // nobody can see cannot spend one of the three visible slots or be counted as `N
  // earlier` — the count is of rows a reader can actually get to.
  const rows = withoutEndedPauses(groupRuns(delegation.entries), driving)
  const earlier = Math.max(0, rows.length - WINDOW)

  return (
    // No vertical padding: the pane's gap is the whole of what separates this card from
    // its neighbours, and the padding a card keeps is inside its own bordered box.
    <li className="min-w-0">
      {/* `bg-canvas` on the pane's own ground rather than a surface: the card is inset
          into the log, not raised off it, and the edge is what draws the boundary. */}
      <div className="flex min-w-0 flex-col rounded-control border border-border bg-canvas px-2 py-1.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setPressed(!open)
          }}
          className="flex w-full min-w-0 items-center gap-2 rounded-control text-left"
        >
          <ChevronRight
            size={12}
            className={`shrink-0 text-fg-subtle ${open ? "rotate-90" : ""}`}
          />
          <span className="min-w-0 truncate font-mono text-xs font-medium text-fg">
            {head.agentType ?? UNNAMED}
          </span>
          <span className="shrink-0 font-mono text-2xs text-fg-subtle">
            {backgrounded ? "background" : "subagent"}
          </span>
          {/* Pushed to the far end rather than given a slot, so a header with nothing to
              say on the right keeps its measure. A failure and a clock cannot both be
              here: elapsed stops the moment an answer lands, and that is what failed it. */}
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {delegation.ok === false ? (
              <span className="font-mono text-2xs text-tone-bad">failed</span>
            ) : delegation.result?.outcome === "stopped" ? (
              // The quiet ink on purpose: a stop is a thing that was done to the
              // subagent — by a person, or by the CLI's teardown — never a verdict on
              // the work, and through `ok` alone it reads as a success.
              <span className="font-mono text-2xs text-fg-subtle">stopped</span>
            ) : undefined}
            {elapsed === undefined ? undefined : <Elapsed text={elapsed} />}
          </span>
        </button>

        {/* What it was asked, and it never moves — folded or open, running or done. `pl-5`
            puts it under the agent's name rather than under the caret. */}
        {head.description === undefined ? undefined : (
          <span className="min-w-0 truncate pl-5 font-mono text-xs text-fg-subtle">
            {head.description}
          </span>
        )}

        {/* One column rather than a step in: the header's name, the description, these
            rows and the answer under them all start at 20. `Line` fixes its own text at 16
            and no caller may move that, so the 4px it is short lives here. A rule is what
            is *not* here — the border already says where the delegation starts and stops,
            and a second boundary inside it is the same statement twice.

            Nothing to show draws nothing at all — a delegation that has just been asked
            for has no lines yet, and a gap under the header would be the card claiming to
            hold something.

            **No `gap-2`, where the pane's own rows all take one.** The standard gap spaces
            the chronology, and this card is one row of it — what is inside a row is not.
            Three rows at the log's own rhythm keep the card the size of the thing it
            stands for; spaced like the pane they would read as a second chronology beside
            it. Same answer as an opened run, which is the only other list nested in a
            row. */}
        {open && (rows.length > 0 || result?.summary !== undefined) ? (
          <ol className="mt-1 flex min-w-0 flex-col pl-1">
            {earlier === 0 ? undefined : (
              <li className="min-w-0">
                <Line>
                  <span className="font-mono text-2xs text-fg-subtle">{`${String(earlier)} earlier`}</span>
                </Line>
              </li>
            )}
            {/* The most recent three, newest last. A subagent that delegated in turn draws
                as a row of its own beside this card rather than a second level down: its
                `Subagent` entry carries no parent, so it opens a delegation where it
                lands. The ids make the tree; one level of it is drawn. */}
            {rows.slice(earlier).map((row, i) => (
              // oxlint-disable-next-line react/no-array-index-key -- append-only transcript
              <Fragment key={i}>
                {/* The card's own liveness rather than the turn's, and nothing on screen
                    shows it today: `ApiRetry` carries no `parent`, so a retry never lands
                    inside a card and the row that reads this is the retry row. Handed down
                    anyway, because the default says *nothing is driving this* and that is
                    the wrong answer for a card that is still working. */}
                <ActivityGroup group={row} driving={driving} />
              </Fragment>
            ))}
            {result?.summary === undefined ? undefined : (
              <li className="min-w-0">
                <AgentMessage text={result.summary} />
              </li>
            )}
          </ol>
        ) : undefined}
      </div>
    </li>
  )
}

export default SubagentGroup
