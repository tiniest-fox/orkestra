/**
 * What a person has said that no agent has read yet, at the foot of the conversation.
 *
 * **The last thing in the scroll, after the live end, and it scrolls with it** — a
 * message sent while a turn runs is newer than everything the turn has written, and
 * the place for the newest thing is where the next one will appear. Each leaves from
 * here: into the turn above as the agent reads it, into the chat that opens the next
 * turn, or back into the field on a stop.
 *
 * **A clock beside each and no words.** The outline already says *not yet*; the mark
 * says it is time that is owed rather than an error, and a label for the group would be
 * a second line on a phone for what two glyphs carry.
 *
 * Drawn whole, however long: what a person is waiting on is their own sentence, and a
 * clamp would hide the half they would check.
 */

import type { ReactNode } from "react"
import { Clock } from "lucide-react"
import type { WaitingMessageDto } from "../../../../api/types"
import Said from "./Said"

const WaitingMessages = ({
  messages,
}: {
  readonly messages: readonly WaitingMessageDto[]
}): ReactNode =>
  messages.length === 0 ? undefined : (
    <ol aria-label="Waiting messages" className="flex min-w-0 flex-col gap-1.5">
      {messages.map((m) => (
        <li
          key={m.id}
          className="flex w-full min-w-0 items-start justify-end gap-1.5 pl-10 max-sm:pl-0"
        >
          {/* Level with the bubble's first line: its padding and half a line down. */}
          <Clock size={11} aria-hidden className="mt-3 shrink-0 text-fg-subtle" />
          <Said text={m.message} waiting attachments={m.attachments} />
        </li>
      ))}
    </ol>
  )

export default WaitingMessages
