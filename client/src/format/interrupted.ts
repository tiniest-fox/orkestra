/**
 * Whether a trak stopped without saying so — the one reading of a state that needs
 * custody beside it to mean anything.
 *
 * **In `format/` because both features ask it.** The detail page draws the stopped notice
 * and its Resume off it; the list files the row under *Errors* and stops its mark off it.
 * Asked in two places with two copies, one surface would call a trak stopped while the
 * other still drew it as working — which is the bug that moved it here.
 */

import type { TrakStateDto } from "../api/types"

/**
 * Whether the state is one the engine only reaches with a command in flight.
 *
 * **Everything that is neither parked at a gate nor settled**, which is `app/dto.ts`'s
 * `interrupted` minus its custody half, read off the same tags. `replayHistory` leaves a
 * trak in the state its last command was issued from and nothing else writes an ending,
 * so an in-flight tag is the log saying *this position was still going when the log
 * stopped*.
 *
 * **`Failed` is not one of them.** A failure is retryable and `restartFrom` knows where
 * from — but the engine wrote that ending, so it is a trak that stopped rather than one
 * whose process vanished, and the press it wants is a retry with the error in front of
 * it. Not this one, and not from here.
 *
 * **`AwaitingChildren` is not one of them either, and it is the case this switch exists
 * to get right.** It is not a gate — `asGate` says so, and the server calls a parent
 * sitting in it interrupted for exactly that reason — but a parent holds no drive of its
 * own for as long as it waits: what ends the wait is a person merging or closing each
 * child, one trak at a time. So *nobody is driving it* is the ordinary case there, and
 * grouping it with the rest would put a permanent Resume on every healthy parent.
 */
const commandInFlight = (state: TrakStateDto): boolean => {
  switch (state._tag) {
    case "Preparing":
    case "Composing":
    case "AgentWorking":
    // The kill is the command in flight, and a resume issues it again — never the turn.
    case "Stopping":
    case "CheckRunning":
    case "HandingOff":
    case "Spawning":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Abandoning":
    case "Merging":
    case "Closing":
      return true

    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "AwaitingHuman":
    case "AwaitingChildren":
    case "Finished":
    case "Closed":
    case "Merged":
    case "Abandoned":
    case "Failed":
      return false
  }
}

/**
 * Whether the trak stopped without saying so — a command was in flight and nothing is
 * carrying it.
 *
 * **The two facts only mean this together, which is why neither is enough on its own.**
 * A trak somebody is driving right now is in the same states and is not stuck, it is
 * busy; a trak at a gate is not driving anything and is not stuck either, it is waiting
 * for a person. Killing `pnpm ui` mid-turn is what leaves the pair: the log's last
 * command has no ending and the process that would have written one is gone.
 *
 * **Nothing recovers this on its own, which is what the press is for.** Booting `serve`
 * replays the log; it never re-issues a command, so an interrupted trak sits at its
 * position until somebody says pick it up. `POST /resume` is that, and `decide` reads
 * where to pick up from off the state — see `useResume`.
 */
export const runInterrupted = (
  state: TrakStateDto,
  /** `custody.holder !== undefined` — asked by the caller, for `planAwaitsApproval`'s reason. */
  running: boolean,
): boolean => !running && commandInFlight(state)
