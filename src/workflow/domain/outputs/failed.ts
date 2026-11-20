// The agent gave up. Terminal, and carries the agent's own reason.

import { Schema } from "effect"

export const Failed = Schema.Struct({
  type: Schema.tag("failed"),
  error: Schema.String,
})
export type Failed = Schema.Schema.Type<typeof Failed>

export const failed = (error: string): Failed => Failed.make({ error })
