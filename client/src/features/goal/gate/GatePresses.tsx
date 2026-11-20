/**
 * A goal gate's presses, at the right of its card's header: the one that takes what is on
 * the table, and the refusal the last press earned beside it — the sentence a trak gate's
 * `GatePresses` draws. It draws only where the goal offers its action (`GoalDto.offers`);
 * anything else the person wants of the composer at a gate is said in the chat bar.
 */

import { Check } from "lucide-react"
import type { ReactNode } from "react"
import type { GoalDto, GoalSettingsDto } from "../../../api/types"
import Button from "../../../components/Button"
import type { GoalAct } from "../useGoalAct"
import type { CardAsk } from "./gate"

const PRIMARY: Record<CardAsk["_tag"], string> = {
  file: "Approve and start",
  plan: "Approve",
  done: "Confirm done",
}

const GatePresses = ({
  ask,
  offers,
  act,
  limits,
  branch,
  merges,
}: {
  readonly ask: CardAsk
  readonly offers: GoalDto["offers"]
  readonly act: GoalAct
  /** What the person set on the drafted file, sent with its Approve; absent at every other gate. */
  readonly limits: GoalSettingsDto | undefined
  /** The goal branch left on the drafted file, sent beside `limits`; empty is none. */
  readonly branch: string | undefined
  /** Confirm merges a sub-goal's branch into its parent's, and the press says so. */
  readonly merges: boolean
}): ReactNode => {
  const take = ask._tag === "done" ? "Confirm" : "Approve"
  return (
    <>
      {act.said === undefined ? undefined : (
        <span role="alert" className="min-w-0 truncate text-sm text-tone-bad">
          {act.said}
        </span>
      )}
      {offers.includes(take) && (
        <Button
          size="sm"
          icon={Check}
          busy={act.isPending}
          disabled={act.disabled}
          onClick={() =>
            act.act(
              take === "Approve" && limits !== undefined
                ? {
                    _tag: take,
                    limits,
                    ...(branch === undefined || branch === "" ? {} : { branch }),
                  }
                : { _tag: take },
            )
          }
        >
          {merges && ask._tag === "done" ? "Confirm and merge" : PRIMARY[ask._tag]}
        </Button>
      )}
    </>
  )
}

export default GatePresses
