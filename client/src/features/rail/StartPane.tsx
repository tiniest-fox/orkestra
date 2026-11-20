import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { PlugZap } from "lucide-react"
import EmptyState from "../../components/EmptyState"
import type { RailProjectDto } from "../../api/types"

type Phase = NonNullable<RailProjectDto["phase"]>

const SAID: Record<Phase, { readonly icon: LucideIcon; readonly words: string }> = {
  engine: { icon: PlugZap, words: "Waiting for its engine to answer." },
}

/**
 * The pane for a host project whose boot has said how far it has got: the band the app
 * draws while the engine works, as `ClonePane` draws it for a clone, naming the project
 * and the phase.
 */
const StartPane = ({
  name,
  phase,
}: {
  readonly name: string
  readonly phase: Phase
}): ReactNode => (
  <EmptyState tone="working" icon={SAID[phase].icon} title={`Starting ${name}`}>
    {SAID[phase].words}
  </EmptyState>
)

export default StartPane
