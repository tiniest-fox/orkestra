/**
 * A step saying it could not do the work.
 *
 * **A document with the Approve taken away**, which is the whole design. `StuckDto` is
 * three named fields rather than `sections` — the shape the agent was held to rather than
 * the shape it was stored in — so it draws as three sections and needs no new machinery.
 * What differs is the gate: `decide` refuses `Approve` here because nothing was filed to
 * approve, which is why this card can never grow the one the artifact will.
 *
 * **The tone is on the header, not the body.** The account itself is ordinary prose — a
 * careful description of what was tried and what happened — and colouring it would make
 * an honest report look like an error. `stuck` is the wall rather than a setback, and the
 * useful thing to do with it is stop in front of a person rather than go back to the
 * composer.
 */

import type { ReactNode } from "react"
import { TriangleAlert } from "lucide-react"
import type { StepOutputDto } from "../../../api/types"
import Markdown from "../../../components/Markdown"
import CardShell from "./CardShell"

type Stuck = Extract<StepOutputDto, { type: "stuck" }>

const Section = ({ title, body }: { readonly title: string; readonly body: string }): ReactNode => (
  <div className="flex min-w-0 flex-col gap-1">
    <span className="text-sm font-medium text-fg">{title}</span>
    {/* `happened` is asked for verbatim — errors, not a paraphrase — so this is the one
        of the three most likely to arrive as a fenced block. */}
    <div className="min-w-0 text-fg-muted">
      <Markdown>{body}</Markdown>
    </div>
  </div>
)

const StuckCard = ({
  stuck,
  head,
  actions,
}: {
  readonly stuck: Stuck
  readonly head: string
  /** The gate's presses — the recompose, at the gate this parks. Built by the page. */
  readonly actions?: ReactNode
}): ReactNode => (
  <CardShell icon={TriangleAlert} tone="bad" head={head} actions={actions}>
    <Section title="What I tried" body={stuck.tried} />
    <Section title="What happened" body={stuck.happened} />
    <Section title="What I think is going on" body={stuck.diagnosis} />
  </CardShell>
)

export default StuckCard
