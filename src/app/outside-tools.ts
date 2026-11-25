// The descriptions of the tools Orkestra Cloud serves to a person's own agent over MCP.
//
// The text is agent-facing, so it lives as templates under `outside/` like every other
// word sent to an agent. Cloud's host code may not import `prompts/`, so this module reads
// the files itself: importing it from `prompts/` would carry that ban's target into Cloud.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { TEMPLATES } from "./packaged.js"

/** The tools Cloud's outside MCP server offers, each described by `outside/tool-<name>.md`. */
export const OUTSIDE_TOOLS = [
  "list_projects",
  "list_traks",
  "read_trak",
  "read_record",
  "start_trak",
  "answer_trak",
  "approve_trak",
  "reject_trak",
  "retry_trak",
] as const

export type OutsideTool = (typeof OUTSIDE_TOOLS)[number]

/**
 * Every outside tool's description, read from `dir`. Throws on the first file missing,
 * naming its path, so a short install fails where Cloud boots rather than at a tool listing.
 */
export const readOutsideTools = (dir: string = TEMPLATES): ReadonlyMap<OutsideTool, string> =>
  new Map(
    OUTSIDE_TOOLS.map((name) => [
      name,
      readFileSync(join(dir, "outside", `tool-${name}.md`), "utf8").trim(),
    ]),
  )
