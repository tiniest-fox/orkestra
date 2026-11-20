/**
 * What marks a call as one to a tool an external server supplies, in the place a built-in
 * call puts its name. One generic mark for every server: a mark per server would be a
 * list of servers, and which servers exist is the project's to say, not the client's.
 *
 * `top-px` sits the icon on the text's baseline, which an SVG has none of — `Line` says why.
 */

import type { ReactNode } from "react"
import { Puzzle } from "lucide-react"

const McpMark = (): ReactNode => (
  <Puzzle
    size={11}
    strokeWidth={2}
    aria-label="MCP tool"
    className="relative top-px shrink-0 text-fg-subtle"
  />
)

export default McpMark
