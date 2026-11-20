/**
 * Work the composer asked the person to do by hand, as a to-do card: what it is, the steps
 * in order, what the goal needs it for, and the person's report — **Done**, or **Couldn't**
 * with a note saying why. The note is optional beside Done and required beside Couldn't,
 * because the composer cannot act on "couldn't" alone.
 *
 * **Both presses spend**: each owes the composer a turn, which is told what was asked and
 * what the person reported. Only a live card has presses and the note; an earlier request
 * stays in the thread folded to its title, and the person's report is the line after it.
 */

import { Check, ClipboardCheck, X } from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"
import type { GoalActionRequestDto, GoalDto } from "../../../api/types"
import Button from "../../../components/Button"
import Field from "../../../components/Field"
import Markdown from "../../../components/Markdown"
import CardShell from "../../trak-detail/cards/CardShell"
import type { GoalAct } from "../useGoalAct"
import { reportAction } from "./gate"

/** The steps as one numbered list, so a step's code span or link draws as anywhere else. */
const stepList = (steps: readonly string[]): string =>
  steps.map((step, i) => `${String(i + 1)}. ${step}`).join("\n")

const ActionCard = ({
  request,
  live,
  offers,
  act,
}: {
  readonly request: GoalActionRequestDto
  /** The goal stands at this request now. */
  readonly live: boolean
  readonly offers: GoalDto["offers"]
  readonly act: GoalAct
}): ReactNode => {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState("")
  const reporting = live && offers.includes("Reported")
  const couldnt = reportAction(false, note)
  const send = (report: ReturnType<typeof reportAction>): void => {
    if (report !== undefined) act.act(report)
  }
  return (
    <CardShell
      icon={ClipboardCheck}
      tone={live ? "waiting" : "neutral"}
      head="Needs you to do"
      {...(live
        ? {}
        : {
            open,
            onToggle: () => {
              setOpen(!open)
            },
            summary: open ? undefined : request.title,
          })}
      actions={
        reporting ? (
          <>
            {act.said === undefined ? undefined : (
              <span role="alert" className="min-w-0 truncate text-sm text-tone-bad">
                {act.said}
              </span>
            )}
            <Button
              variant="quiet"
              size="sm"
              icon={X}
              disabled={act.disabled || couldnt === undefined}
              onClick={() => {
                send(couldnt)
              }}
            >
              Couldn't
            </Button>
            <Button
              size="sm"
              icon={Check}
              busy={act.isPending}
              disabled={act.disabled}
              onClick={() => {
                send(reportAction(true, note))
              }}
            >
              Done
            </Button>
          </>
        ) : undefined
      }
    >
      {live || open ? (
        <div className="flex min-w-0 flex-col gap-3">
          <p className="min-w-0 text-base font-medium text-fg">{request.title}</p>
          <div className="min-w-0 text-base text-fg">
            <Markdown>{stepList(request.steps)}</Markdown>
          </div>
          <p className="min-w-0 text-sm text-fg-muted">{request.why}</p>
          {reporting ? (
            <Field
              id="action-note"
              label="Note for the composer"
              value={note}
              onChange={setNote}
              rows={1}
              unzoomed
              disabled={act.disabled}
              placeholder="Anything it should know — required if you couldn't"
            />
          ) : undefined}
        </div>
      ) : undefined}
    </CardShell>
  )
}

export default ActionCard
