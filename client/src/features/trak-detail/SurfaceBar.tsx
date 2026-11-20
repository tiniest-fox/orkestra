/**
 * The phone's four surfaces, as one bar of equal tabs: Agent, Map, Trak, Changes.
 *
 * The desk's `StepBar` is a navigator doing two jobs — the wide segment names the
 * position, the three tabs name the trak's surfaces. On the phone the strip and the
 * directive block under the Agent tab have the first job, so this bar has only the
 * second, and the step level becomes an ordinary tab beside the other three.
 *
 * **It is called `Agent`, not `Step`** — the truer word, and `StepBar`'s own docstring
 * says so: the step level is the agent's own turns, read against three surfaces of the
 * whole trak. The desktop bar still says `Step` by carrying no label at all; whether it
 * should follow is an open question the phone rounds left open, and this file does not
 * decide it.
 *
 * `max-sm:h-11` on `TabBar` is what gives these tabs the touch floor; the glyphs are
 * the step bar's own, so the two bars name a surface with one mark.
 */

import type { ReactNode } from "react"
import { Bot, FileText, GitBranch, GitCompare } from "lucide-react"
import type { Level } from "../../components/StepBar"
import Tab from "../../components/Tab"
import TabBar from "../../components/TabBar"

const SURFACES = [
  { key: "step", label: "Agent", glyph: Bot },
  { key: "map", label: "Map", glyph: GitBranch },
  { key: "trak", label: "Trak", glyph: FileText },
  { key: "changes", label: "Changes", glyph: GitCompare },
] as const

const SurfaceBar = ({
  level,
  onLevel,
}: {
  readonly level: Level
  readonly onLevel: (to: Level) => void
}): ReactNode => (
  <TabBar label="Trak surfaces">
    {SURFACES.map(({ key, label, glyph }) => (
      <Tab
        key={key}
        label={label}
        icon={glyph}
        grow
        current={level === key}
        onClick={() => {
          onLevel(key)
        }}
      />
    ))}
  </TabBar>
)

export default SurfaceBar
