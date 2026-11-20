/**
 * One re-entry body, composed on the screen out of the things that were ticked and the
 * sentence somebody wrote.
 *
 * **The whole of what the engine learns about a pick happens here.** `POST /reenter`
 * takes one required string — no list, no kinds, no ids — so five ticked things and one
 * typed paragraph arrive identical. That is the cost of composing here rather than
 * teaching the route a shape, and it is not recoverable downstream: nothing after this
 * can tell them apart. The one fact sent beside the body is `pickedBase`'s.
 *
 * **Quoted, never paraphrased.** The string reaches the planner's prompt unescaped
 * (`prompts/logic/render.ts` turns escaping off and says why), so a `>` block survives the
 * trip whole — which is what lets a reviewer's own words be planned from rather than this
 * surface's summary of them.
 *
 * A pure function with no React and no network, so every case below is a tier-1 test.
 */

/**
 * One thing a person ticked, already in words.
 *
 * **Built where the fact is, drawn and composed from one value.** The named line in the
 * box at the foot and the block in the sent body come from the same object, so what a
 * reader removed and what stops being sent cannot come apart.
 */
export interface Picked {
  /**
   * Stable identity for the tick and the remove, and the React key of the row it is drawn
   * on — one string, so the two cannot drift.
   *
   * **Only ever a value the wire promises is unique**: a check's `id`, the forge's own
   * permalink to the comment a conversation opened with, a comment's own. Never a name,
   * never an author plus a line, and — the one that shipped — never a check's link, which
   * whoever created the run supplies and several checks routinely share. Each of those keys
   * two different things alike, which draws both rows ticked and sends one of them.
   * `pullRequest.ts` composes each, and its `checkKey` and `threadKey` are the only places
   * any of it is decided.
   *
   * **A position is the fallback and only that**, for the one case the wire offers no
   * permalink for: a thread with no comments at all, named by its review's `id` and its
   * place in that review. It costs what a position always costs — a list that re-orders
   * under the poll moves the tick — and it is taken because two threads of one review can
   * never both hold one position.
   */
  readonly key: string
  /** The named line in the box at the foot, and nothing else. Never sent. */
  readonly label: string
  /** The block's first line: what happened, and on which pull request. */
  readonly said: string
  /** Lines under it that say where — a file and line, a link to a run. Often empty. */
  readonly where: readonly string[]
  /**
   * The text to quote verbatim, or absent where there is none.
   *
   * **A check has none by construction.** Its output is never fetched, so a ticked check
   * contributes its name, when it failed and its link — quoting a transcript here would
   * need the second forge call the whole read is built to avoid.
   */
  readonly quote: string | undefined
  /**
   * The pull request's base branch, on the pick for the forge refusing the merge and on
   * nothing else. Sent beside the body rather than in it, so the engine can tell the
   * composer which ref to merge and to plan the push — see `pickedBase`.
   */
  readonly base?: string | undefined
}

/**
 * The picked list is keyed, never positional.
 *
 * **`key` is the identity and the list is the single source of truth**: a row's tick is
 * drawn from `isPicked` rather than held beside it, so removing a line from the box at the
 * foot takes the tick with it. Two answers to *is this picked* is a surface that can
 * disagree with what it would send.
 */
export const isPicked = (held: readonly Picked[], key: string): boolean =>
  held.some((one) => one.key === key)

/** Ticking something that is already picked unticks it. */
export const togglePick = (held: readonly Picked[], item: Picked): readonly Picked[] =>
  isPicked(held, item.key)
    ? held.filter((one) => one.key !== item.key)
    : // Appended, so the order in the sent body is the order they were ticked in.
      [...held, item]

/**
 * Every one of `items` ticked — or, where every one already is, every one unticked.
 *
 * **One press on a reviewer's head reaches only what already carries a tick of its own**:
 * the caller hands over the picks of the rows under that head, and a resolved conversation
 * has none to hand. Appended in the caller's order, which is the order the rows are drawn
 * in, so the sent body reads down the card.
 */
export const pickAll = (held: readonly Picked[], items: readonly Picked[]): readonly Picked[] =>
  items.every((one) => isPicked(held, one.key))
    ? held.filter((one) => !items.some((item) => item.key === one.key))
    : [...held, ...items.filter((one) => !isPicked(held, one.key))]

/** Dropped from the box at the foot, which is the affordance that does not need the row. */
export const removePick = (held: readonly Picked[], key: string): readonly Picked[] =>
  held.filter((one) => one.key !== key)

/** Every line of a body, prefixed — a blank line inside a comment stays inside the quote. */
const quoted = (text: string): string =>
  text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")

/** One picked thing as its block: what happened and where, then the text it stands for. */
const block = (picked: Picked): string =>
  [
    picked.said,
    ...picked.where,
    ...(picked.quote === undefined ? [] : [quoted(picked.quote)]),
  ].join("\n")

/**
 * The sentence first, then one block per picked thing, blocks separated by a blank line.
 *
 * **Either half may be empty and the other still sends.** Ticking three things and typing
 * nothing is a complete request — the blocks say what is wrong — and typing a sentence
 * with nothing ticked is the plain re-entry this surface has always had. Both empty
 * returns the empty string, which is what the press reads to know it is off.
 */
export const reentryBody = (picked: readonly Picked[], sentence: string): string => {
  const said = sentence.trim()
  return [...(said === "" ? [] : [said]), ...picked.map(block)].join("\n\n")
}

/**
 * The base branch a ticked refusal names, or `undefined` where none is ticked or the forge
 * named none. The body cannot carry it: the engine reads the body as prose.
 */
export const pickedBase = (picked: readonly Picked[]): string | undefined =>
  picked.find((one) => one.base !== undefined)?.base
