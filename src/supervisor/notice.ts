// What a trak's new state is worth a desktop notification for — the rule
// `src/app/push.ts` applies for a phone, written against the wire's state rather than
// the engine's: the three parked states, `Finished` and `Failed`. Everything between is
// the engine working, which is what the person is not being asked to look at.
//
// A `Finished` trak holding a step behind a condition is not finished, and is not
// called so: the rest is silent, and the one thing told is the condition giving up —
// `push.ts` carries why, and the two must say the same thing about the same frame.

import type { TrakStateDto } from "@orkestra/shared/dto/trak"

export interface Notice {
  readonly trak: string
  readonly body: string
}

/**
 * The wait a `Finished` trak is resting on, as both reads report it: a frame and the
 * list each carry the whole `WaitingDto`, so a trak read off the list after a `Resync`
 * says which condition it is held on and whether that condition gave up. `name` is
 * optional only for a wait a reader could not name.
 */
export interface Wait {
  readonly name: string | undefined
  readonly stopped: boolean
}

/**
 * The most of the name a body may carry. The notification centre shows the opening of
 * a body and cuts the rest, and the state verb is the suffix — so an unbounded name
 * would say neither waiting, finished nor failed. Titles and requests are bounded
 * nowhere upstream, and a request carries literal newlines.
 */
const NAME_CAP = 60

const clipped = (name: string): string => {
  const flat = name.replaceAll(/\s+/g, " ").trim()
  return flat.length <= NAME_CAP ? flat : `${flat.slice(0, NAME_CAP)}…`
}

/**
 * The parked states, as `shared/src/dto/trak.ts` says a client tells them: by switching on
 * `state._tag`, since there is deliberately no gate DTO.
 */
const parked = (state: TrakStateDto): boolean =>
  state._tag === "AwaitingProposal" ||
  state._tag === "AwaitingComposerAnswers" ||
  state._tag === "AwaitingHuman"

/**
 * The notice for a trak that just became `state`, or `undefined` for a state nobody is
 * buzzed for. `name` is the plan's title or the request — the chain every list row
 * draws — since a notification shows the body and nothing else.
 */
export const noticeFor = (
  trak: string,
  state: TrakStateDto,
  name: string,
  wait: Wait | undefined,
): Notice | undefined => {
  const called = clipped(name)
  const body = parked(state)
    ? `${called} is waiting on you`
    : state._tag === "Finished"
      ? wait === undefined
        ? `${called} finished`
        : wait.stopped
          ? `${called} gave up waiting on ${wait.name ?? "its condition"}`
          : undefined
      : state._tag === "Failed"
        ? `${called} failed`
        : undefined
  return body === undefined ? undefined : { trak, body }
}

/**
 * What one frame is compared to the last on: the tag, and at `Finished` whether the
 * plan is held and whether its condition has given up. A give-up leaves the tag alone,
 * so by tag it would be a re-park and never told.
 */
export const phaseOf = (state: TrakStateDto, wait: Wait | undefined): string =>
  wait === undefined ? state._tag : `${state._tag}:${wait.stopped ? "stopped" : "held"}`

/**
 * Whether a frame's state is a transition worth telling: the phase changed. A frame
 * that re-parks the same gate — a restart, a conversation returning to it — says
 * nothing the person has not already heard.
 */
export const changed = (
  previous: string | undefined,
  state: TrakStateDto,
  wait: Wait | undefined,
): boolean => previous !== phaseOf(state, wait)
