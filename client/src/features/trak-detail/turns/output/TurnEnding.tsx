/**
 * How a turn ended, at the point in the sequence where it stopped — `WhyRan`'s opposite
 * number, and drawn in the same two columns for that reason. The pair reads *ended here ·
 * picked up here* without inventing a second idiom: a restart already heads the turn after
 * this one with *Restarted — the turn was cut off*, and what was missing was the ending of
 * the turn before it.
 *
 * **A line rather than a plate, because it is history.** `TrakFailure` is the plate, and it
 * is about a *standing* condition with a press on it; once a restart has moved the trak
 * past this, there is nothing to decide here and nothing to press — only a place in the log
 * where a turn stopped. So it takes the shape of the things that merely happened.
 *
 * **The words are `format/failure.ts`'s and never this file's.** They are the same words the
 * notice used while the trak was standing at this failure, so a line that spelled its own
 * would be the surface calling one event two things depending on how long ago it was.
 *
 * `kind: "provider"` is read rather than assumed: `decide` settles every `TurnFailed` as
 * `fail(reason, "provider", apiKind)`, which is the only way that event ends a trak.
 */

import type { ReactNode } from "react"
import { TriangleAlert } from "lucide-react"
import { failureWords } from "../../../../format/failure"
import type { Ending } from "../../filed"
import Line from "../activity/Line"

const TurnEnding = ({ ending }: { readonly ending: Ending }): ReactNode => (
  <li className="min-w-0">
    <Line lead={<TriangleAlert size={12} className="text-tone-bad" />}>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 font-mono text-xs text-tone-bad">
          {
            failureWords({
              _tag: "Failed",
              error: ending.reason,
              kind: "provider",
              apiKind: ending.apiKind,
              ...(ending.runner === undefined ? {} : { runner: ending.runner }),
            }).head
          }
        </span>
        <span className="min-w-0 truncate font-mono text-xs text-fg-subtle">
          the turn ended here
        </span>
      </span>
    </Line>
  </li>
)

export default TurnEnding
