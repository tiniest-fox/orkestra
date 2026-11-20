// logic: what a turn answered, folded from the events it emitted.
//
// A fold rather than "find the last text", for the reason `meter.ts` is one: the
// runtime consumes a stream, and a turn that dies mid-flight still said what it said.
//
// The rule is *which* words are the answer. One invocation ends several turns — the
// provider gives itself another each time background work reports — and each ends with
// a result of its own. The first that holds the caller's envelope is the answer alone;
// with no such result, every result is part of it. A subagent's prose never is.

import type { BackgroundTask, ProviderEvent } from "../types/provider-event.js"
import type { SessionId, Settles } from "../types/session.js"

/**
 * The answer so far, how far the turn has got, and the session it said it was running in.
 *
 * `answered` says a result is in hand, so `text` is what the provider reported rather
 * than the deltas read off a turn that never finished. `settled` says one of those
 * results held the envelope, and `text` is that result alone.
 *
 * `session` rides here because it is the other thing a re-ask needs off the same
 * stream: a provider that announces its own id (`ResumeStrategy.ReportedId`) is
 * resumed by the id it announced, never by the one the request carried. The first
 * announcement wins — a provider that re-announces does so with the same id.
 *
 * `outstanding` is the background tasks alive as the provider last said, and `stopped`
 * is that set as it stood at the result that settled the turn: the work a harness stops
 * because the envelope is in. Empty on a turn that did not settle, and on a provider
 * that reports no level.
 */
export interface Answer {
  readonly text: string
  readonly answered: boolean
  readonly settled: boolean
  readonly session: SessionId | undefined
  readonly outstanding: readonly BackgroundTask[]
  readonly stopped: readonly BackgroundTask[]
}

/** What a turn that said nothing answered. */
export const noAnswer: Answer = {
  text: "",
  answered: false,
  settled: false,
  session: undefined,
  outstanding: [],
  stopped: [],
}

/** A result joined onto the ones before it. An empty one adds nothing, separator included. */
const joined = (before: string, text: string): string =>
  [before, text].filter((part) => part !== "").join("\n\n")

/**
 * One more event, absorbed.
 *
 * **A result that settles is the whole answer, and nothing after counts.** What the
 * agent said earlier in the turn was said while it waited — *"waiting for the check"* —
 * and a surface draws the words around an envelope as its brief. What arrives afterwards
 * is about the work the harness stopped once the envelope was in.
 *
 * **A result that does not settle joins the ones before it, in order.** The report an
 * agent writes when its background task ends is a later result than the sentence saying
 * it will wait, and keeping the first alone files the sentence.
 *
 * **Deltas are read only until the first result.** They are what a killed or failed
 * turn leaves, and a result replaces them — the provider builds it from the same
 * message. After one, loose text is a turn whose result the harness withheld: the reply
 * to a message that arrived once the answer was complete.
 *
 * **Only the parent agent's own text accumulates.** `parent` names the delegation a line
 * was written inside, and a subagent's report is addressed to the agent that asked for
 * it. It matters when no `Result` arrives, because `extractJson` takes the *last*
 * JSON-shaped thing it finds.
 */
export const answering =
  (settles: Settles) =>
  (a: Answer, e: ProviderEvent): Answer => {
    if (e._tag === "SessionStarted") return { ...a, session: a.session ?? e.id }
    if (a.settled) return a
    if (e._tag === "BackgroundTasks") return { ...a, outstanding: e.tasks }
    if (e._tag === "Result") {
      if (settles(e.text)) {
        return { ...a, text: e.text, answered: true, settled: true, stopped: a.outstanding }
      }
      return { ...a, text: a.answered ? joined(a.text, e.text) : e.text, answered: true }
    }
    if (e._tag === "TextDelta" && e.parent === undefined && !a.answered) {
      return { ...a, text: a.text + e.text }
    }
    return a
  }

/**
 * What a whole turn answered where nothing in it is an envelope — every result, joined.
 * `answerOf([])` is `""`, which is what a dead turn said.
 */
export const answerOf = (events: readonly ProviderEvent[]): string =>
  events.reduce(
    answering(() => false),
    noAnswer,
  ).text
