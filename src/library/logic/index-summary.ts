// logic: the compact index handed to the composer — name + description only, so
// selection stays cheap. The full brief loads only for the agent a step names.
//
// The name is the label because the name is what a proposal has to write back.
// That is also why an agent file has no `title:` field: a second display string
// would be one nothing reads.

import type { Library } from "../types/library.js"

/**
 * The fleet, as the composer sees it. One index where there were three —
 * techniques, output shapes and checks — because there is now one choice per
 * step rather than three.
 *
 * `model` and `permission` are deliberately absent. They are not the composer's
 * business, and showing it what each agent costs invites it to plan for the
 * wrong thing.
 */
export const agentIndex = (lib: Library): string =>
  [...lib.agents.values()].map((a) => `- ${a.name}: ${a.description}`).join("\n")
