// A step asking a person to let it run one command the CLI refused.
//
// Under auto mode the CLI's classifier refuses a risky call with nobody asked, and
// the turn carries on. A person's yes clears the refusal only when it names the
// command, so the step names it here and the engine writes the yes itself — the
// reply quotes `command` byte for byte, which an agent-written question with a
// recommended option could not promise.
//
// **It stops for a person on every run mode.** The classifier's refusal is not
// something the engine can consent to on anyone's behalf, so nothing unattended
// answers it.

import { Schema } from "effect"

export const Permission = Schema.Struct({
  type: Schema.tag("permission"),
  /** The exact command refused, as the agent ran it. Quoted back verbatim on a yes. */
  command: Schema.String,
  /** Why the step needs it — what the person reads before pressing. */
  reason: Schema.String,
})
export type Permission = Schema.Schema.Type<typeof Permission>

export const permission = (command: string, reason: string): Permission =>
  Permission.make({ command, reason })
