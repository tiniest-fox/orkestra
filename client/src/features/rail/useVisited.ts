/**
 * Every project the page has shown, in the order it first showed each — the frames a
 * host's page keeps mounted, so that switching back finds a project where it was left.
 *
 * Grown during render rather than in an effect: a frame added one commit late would mount
 * a paint after the switch that asked for it, and the pane under it would flash between.
 * Never shrinks — a frame that left the list would lose its place, which is what keeping
 * it is for.
 */

import { useState } from "react"

export const useVisited = (selected: string | undefined): readonly string[] => {
  const [visited, setVisited] = useState<readonly string[]>([])
  if (selected === undefined || visited.includes(selected)) return visited
  const next = [...visited, selected]
  setVisited(next)
  return next
}
