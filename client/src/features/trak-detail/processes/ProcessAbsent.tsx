/**
 * The Page view of a process with no page to show: its state's glyph, the state's word and
 * one sentence. A start that failed says why, under it the last lines its script printed,
 * wrapped rather than scrolled so a phone shows them whole; it and a process that died add
 * the way to the log.
 *
 * It sits at the panel's bottom edge, so it takes the home indicator's inset as a margin,
 * `ProcessLog`'s empty screen's rule, and `HostedPage`'s frame takes the same.
 */

import type { ReactNode } from "react"
import { ScrollText } from "lucide-react"
import type { HostedStateDto } from "../../../api/types"
import Button from "../../../components/Button"
import Figure from "../../../components/Figure"
import { CODE } from "../../../components/PseudoCode"
import { failureOf, hostedWord, pageAbsent } from "../../../format/hosted"
import ProcessGlyph from "../../../components/ProcessGlyph"

const ProcessAbsent = ({
  state,
  onLog,
}: {
  readonly state: Exclude<HostedStateDto, { _tag: "Running" }>
  readonly onLog: () => void
}): ReactNode => (
  <div className="mb-safe-b flex min-h-48 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
    <ProcessGlyph tag={state._tag} size={28} />
    <p className="text-base font-medium text-fg">{hostedWord(state)}</p>
    <p className="text-sm text-fg-muted">{pageAbsent(state)}</p>
    {state._tag === "DidNotComeUp" && failureOf(state.reason).tail.length > 0 && (
      <Figure label="output">
        <pre className={`m-0 whitespace-pre-wrap text-left [overflow-wrap:anywhere] ${CODE}`}>
          {failureOf(state.reason).tail.join("\n")}
        </pre>
      </Figure>
    )}
    {(state._tag === "DidNotComeUp" || state._tag === "Exited") && (
      <Button variant="quiet" size="sm" icon={ScrollText} onClick={onLog}>
        Show the log
      </Button>
    )}
  </div>
)

export default ProcessAbsent
