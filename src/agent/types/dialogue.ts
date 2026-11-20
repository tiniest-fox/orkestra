// types: one spawn's side of a conversation with a CLI that has to be asked for
// things before it will take a prompt — see `PromptDelivery.Dialogue`.

import type { SteeredMessage } from "./session.js"

/**
 * What a provider's dialogue function returns, once per spawn: the first line to
 * write, and the lines to write in answer to each line the CLI prints. Built by the
 * provider directory and driven by the harness, so neither knows the other's framing.
 *
 * **It remembers what it wrote and what was answered**, as a normalizer built per
 * spawn does, because a message for the running turn has to name that turn and only
 * an earlier answer says what it is called.
 *
 * - `steer` — the lines that hand a person's message to the turn. Empty where the
 *   dialogue is holding it for a turn not yet named; it then leaves in a later
 *   `replyTo`. The message is the dialogue's from this call on, whichever it was.
 * - `settled` — whether nothing the dialogue wrote is still owed an answer and no turn
 *   it started is running. The harness closes the pipe only where this holds, since a
 *   CLI of this kind exits when its stdin does and takes an unanswered message with it.
 */
export interface Dialogue {
  readonly opening: string
  readonly replyTo: (line: string) => readonly string[]
  readonly steer: (message: SteeredMessage) => readonly string[]
  readonly settled: () => boolean
}
