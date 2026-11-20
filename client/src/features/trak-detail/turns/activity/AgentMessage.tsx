/**
 * The agent talking. Every time it talks, not only the last time.
 *
 * **Not a card — the other half of the bubble.** A person's words already draw as a bubble
 * anchored right (`WhyRan`), and this is the same element facing the other way. So the
 * conversation gate costs no new shape: no header, no rule, no label.
 *
 * **It is the agent's voice rather than a gate's shape**, which is why the prose a turn
 * writes between two tool calls takes it as well as the prose it ends on. Those were drawn
 * as log rows in the tool column for a while, on the reasoning that only the last one is
 * addressed to you — but the difference between them is not what they *are*, it is that
 * the last one is the one still on the table when the turn stops. A `message` is a `Text`
 * entry the runtime kept; the log holding the same words in a different shape said the
 * agent had changed register when it had not.
 *
 * So this takes text rather than an output: `StepOutputView` and `ComposerOutputView` hand
 * it what a turn returned, `ActivityRow` hands it what the turn said on the way. One
 * component, or the two drift the moment either is adjusted.
 *
 * It carried a `waiting on you` caption and a separator, and both went for the reason this
 * pane keeps rediscovering — **they said what the content already says.** An unanswered
 * message from the agent *is* the trak waiting on you, and a surface that annotates that is
 * a surface talking about itself.
 *
 * **The bubble is a `div` rather than a `p`.** What an agent writes is markdown and renders
 * as blocks — a list, a table, a fenced block — and a paragraph cannot legally contain any
 * of them.
 *
 * **`px-4` is the log's text column, and `Line` is built to meet it.** What a turn writes
 * and what it did are one chronology, so a bubble whose first letter sits 12 in while the
 * row below it starts at 24 reads as two columns that nearly line up — which is worse than
 * either. The bubble's padding is the one of the two a reader can see, so it sets the
 * measure and the rows follow it.
 *
 * **`my-1` outside the bubble, and it is the one element in this pane that carries any.**
 * The rule is that the container gives the gap and nothing adds its own — see `TurnsView`,
 * which states it and states this exception. It cannot hold here, because this is the one
 * element drawn into *two* containers that space their children differently: the pane's
 * chronology at `gap-2`, and a delegation card's own list, which deliberately gives none
 * because what is inside a row is not the chronology. With no margin the bubble clears the
 * text of the row beside it by 10px in the first — the list's 8 and that row's own `py-0.5`
 * — and by 2px in the second, where its ring lands against their words.
 *
 * **A margin is the only lever that reaches both**, since neither container can be told
 * about the other's spacing, and the value is a compromise rather than an optimum: 4px puts
 * the card at 6 and the pane at 14, against 12 between two ordinary rows there. Larger reads
 * correctly in the card and makes the bubble conspicuous in the pane; smaller keeps the pane
 * even and leaves the card as tight as the state that failed review. **Do not spend it on
 * the card's list instead** — a gap there would space the tool rows too, which is the thing
 * that list exists to avoid.
 *
 * What makes the bubble read as the sentence rather than as a row is still its ground, its
 * edge and its own `py-2`, all of which are inside it. The margin buys separation, not
 * prominence.
 *
 * **On a phone the bubble is 90% of the pane and the 40px indent goes.** At 375px the
 * indent and 80% together left it about two thirds of the screen. `Said`'s rows drop
 * their indent at the same seam, so the two sides stay matched.
 */

import type { ReactNode } from "react"
import Markdown from "../../../../components/Markdown"

const AgentMessage = ({ text }: { readonly text: string }): ReactNode => (
  <div className="my-1 flex min-w-0 justify-start pr-10 max-sm:pr-0">
    <div className="min-w-0 max-w-[80%] max-sm:max-w-[90%] rounded-surface bg-surface px-4 py-2 text-fg ring-1 ring-border">
      <Markdown>{text}</Markdown>
    </div>
  </div>
)

export default AgentMessage
