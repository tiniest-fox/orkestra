// The standing channel: what a turn settled about the work, alongside what it
// produced.
//
// The request plus these, in order, is the trak's current intent — which is what
// every later agent reads, not the original request on its own. They ride the
// envelope rather than the document (see outputs/artifact.ts) because what a turn
// settled is a fact about the conversation, not a property of the file that carried
// it.
//
// **An agent writes these as `requirements`, and the engine calls them decisions.**
// The two names are one channel: the envelope field was renamed when it absorbed
// the work-the-plan-is-missing channel, and the old name is what `TrakCreated` and
// `ChildLanded` store — moving that would make every log written so far undecodable
// for a rename. `requirementsIn` is where the two field names become one list.

import { Array as Arr, Schema } from "effect"

const settled = {
  text: Schema.String,
  /**
   * Whether a human had already decided it — not who typed it. Both values are
   * written by the agent.
   *
   * > Could you point at the sentence a human wrote?
   *
   * Yes → `stated`, even though the agent paraphrased it. No → `assumed`, however
   * reasonable the inference was. An extension of something a human said is an
   * assumption; a restatement of it isn't.
   *
   * This is the field's whole job: an agent recording a decision can quietly
   * narrow the criteria, and *assumed* is the one line at a gate a human
   * genuinely must read.
   */
  source: Schema.Literal("stated", "assumed"),
}

/**
 * What an entry replaces: the names of what is no longer true, each either a
 * document key as the plan lists it — `1-investigate`, or `from-parent/1-investigate`
 * for one this trak was born holding — or a requirement id as `trak.md` lists it,
 * `1-investigate.2`. A document named is annotated: the projection writes the
 * entry's text above that document's first section, since no file under
 * `.orkestra/.trak/` is ever edited. A requirement named is folded out of every
 * rendered list, and this entry stands in its place.
 *
 * **A field rather than a kind, because it has to sit beside one.** An entry that
 * replaces a document and also says work is missing must be able to say both: as a
 * sixth kind it could not be `unplanned_work`, and an agent choosing between waking
 * the composer and recording the supersession chose the wake-up and the note was
 * lost. Non-empty, because a list naming nothing folds nothing, silently.
 *
 * **Never derived.** Every other provenance points at the step that filed the
 * entry, and this points the other way, the same as a correction's `at`.
 * `StepOutputFor` holds every name to one the step was shown.
 */
const Supersedes = Schema.NonEmptyArray(Schema.String)

/**
 * One decision, as an agent writes it. Three fields — four when it supersedes
 * something — and everything else is prose.
 *
 * `type`-adjacent rather than `_tag`-tagged for the reason everything under
 * `outputs/` is: an agent writes this JSON by hand. There is no tag at all here
 * because it is never a variant of anything — it is only ever an element of the
 * list on an envelope that already said what it was.
 *
 * **`source`, `kind` and `supersedes` are structured, because all three are read.** A
 * gate marks the assumed entries, `kind` is what routes, and `supersedes` is what
 * the projection annotates and the list folds on. Still rejected, each for the
 * reason `kind` was until something branched on it — nothing mechanical would read
 * them: a rationale (the artifact IS the rationale), and an author or a timestamp
 * (the log already knows which step filed it and when).
 *
 * **`kind: "supersedes"` with a `document` is still taken**, because it is what
 * every envelope filed before the field existed wrote, and a re-prompt over a shape
 * the agent's own examples still show would cost a turn for nothing. The kind is
 * spent into the field by `supersededBy`; nothing else reads it. One naming
 * nothing at all is a decode failure `elicit` re-prompts on, rather than an entry
 * that annotates nothing.
 */
export const Decided = Schema.Struct({
  ...settled,
  /**
   * Which of the four this is — and, for exactly one of them, what it costs.
   *
   * **`unplanned_work` is the only one that wakes the composer**; the other three
   * are recorded and nothing else happens. The line is not when the constraint
   * bites but whether somebody has to do work the plan does not have, which is the
   * question the merged-away `uncovered_work` channel used to ask by which field an
   * entry went in.
   *
   * **Optional here and required by the prompt**, the way `source`'s bar is:
   * nothing in this codebase decodes strictly, so a required field would empty the
   * recorded intent of every trak in the store — including one mid-flight — rather
   * than rejecting it.
   *
   * **Absent behaves as *not* `unplanned_work`.** That is the unsafe-looking
   * direction and it is deliberate: routing absence would spend a planning turn on
   * every stored entry and every forgetful agent, which is the whole of what this
   * field exists to stop.
   */
  kind: Schema.optional(
    Schema.Literal("out_of_scope", "unplanned_work", "constraint", "ruled_out", "supersedes"),
  ),
  supersedes: Schema.optional(Supersedes),
  /** The one document a `kind: "supersedes"` entry named before the field existed. */
  document: Schema.optional(Schema.String),
}).pipe(
  Schema.filter((d) =>
    d.kind === "supersedes" && d.supersedes === undefined && d.document === undefined
      ? "supersedes names nothing: put the document keys or requirement ids it replaces in `supersedes`"
      : undefined,
  ),
)
export type Decided = Schema.Schema.Type<typeof Decided>

/**
 * Does this entry say somebody has to do work the plan does not have?
 *
 * A function rather than a field read, for the reason `isConversational` is one: the
 * field is optional, and *absent means not this one* is exactly the kind of rule two
 * readers can disagree about. `raisedBy` is the only caller that matters — it is
 * where a filed entry does or does not buy a planning turn.
 */
export const isUnplanned = (d: Decided): boolean => d.kind === "unplanned_work"

/**
 * Every name an entry supersedes, whichever shape it was written in — empty for the
 * many that supersede nothing. The one reader of `document`, so the legacy shape
 * becomes the field here and nowhere else.
 */
export const supersededBy = (d: Decided): readonly string[] =>
  Arr.dedupe([...(d.supersedes ?? []), ...(d.document === undefined ? [] : [d.document])])

/**
 * The same entry as the log stores it, which is also how it was stored before
 * `supersedes` was a list: a `document` beside it. Decoded through `Recorded`, so
 * no reader inside the engine meets the old field.
 */
const Stored = Schema.Struct({
  ...settled,
  at: Schema.String,
  document: Schema.optional(Schema.String),
  supersedes: Schema.optional(Supersedes),
})

const Standing = Schema.Struct({
  ...settled,
  at: Schema.String,
  supersedes: Schema.optional(Supersedes),
})

/**
 * A `Decided` plus where it was filed — `1-breakdown`, the artifact key of the
 * step whose envelope carried it.
 *
 * **Provenance is derived, not declared.** The event carrying the artifact came
 * from a known step, so `replayHistory` can fill this in without the agent
 * writing it. Free, and it is what a human uses to judge an entry they don't
 * recognise. The id every later entry names it by — `identified` — is derived the
 * same way, from `at` and the entry's place among that step's.
 *
 * **`kind` is deliberately not carried across**, which is why the fields are named
 * rather than spread: the kind is spent the moment it routes. By the time a later
 * step reads this list the composer has planned the work, and *work nobody has
 * planned* read as a standing constraint is a misread of a label that has gone stale.
 *
 * **`supersedes` is carried, because it is never spent.** The projection reads it
 * on every turn to put the note above the document it names, and every rendering
 * of the list reads it to fold the requirement it names. A log written before the
 * field existed stored the one document in `document`, and decoding folds that
 * into the list, so the trak never carries two spellings of one fact.
 */
export const Recorded = Schema.transform(Stored, Standing, {
  strict: true,
  decode: ({ document, supersedes: named, ...rest }) => {
    const names = [...(named ?? []), ...(document === undefined ? [] : [document])]
    return Arr.isNonEmptyReadonlyArray(names) ? { ...rest, supersedes: names } : rest
  },
  encode: (r) => r,
})
export type Recorded = Schema.Schema.Type<typeof Recorded>

/**
 * A filed entry with its provenance stamped — the one place the two shapes meet,
 * so no filer can be the one that drops what it supersedes on the way through.
 *
 * `supersedes` is passed rather than read off `d`, because the names an agent wrote
 * are its own trak's and the join re-keys them under the piece it landed from — see
 * `joinChildren`. A caller with nothing to re-key hands back `supersededBy(d)`.
 */
export const recorded = (d: Decided, at: string, supersedes: readonly string[]): Recorded => ({
  text: d.text,
  source: d.source,
  at,
  ...(Arr.isNonEmptyReadonlyArray(supersedes) ? { supersedes } : {}),
})

/**
 * A stamped entry as an agent would have written it — what a child's own decisions
 * become on the event that lands them on the parent, whose replay stamps them again.
 *
 * Named rather than left to structural typing, because `Recorded` is assignable to
 * `Decided` as it stands, and that assignment carries `at` along as an excess key
 * the wire would then store.
 */
export const decidedOf = (r: Recorded): Decided =>
  r.supersedes === undefined
    ? { text: r.text, source: r.source }
    : { text: r.text, source: r.source, supersedes: r.supersedes }

/**
 * What an envelope filed on the standing channel, whichever name it used.
 *
 * **The old name is still read, and that is not politeness to old files.** Nothing
 * here decodes strictly, so an envelope carrying `decisions` would have the key
 * dropped in silence rather than rejected — and every trak in the store predates the
 * rename, so every one of them would replay with an empty intent, including one that
 * is mid-flight. One function so no reader can be the one that forgets.
 *
 * Structural rather than over `Artifact | Stuck`, because both envelopes carry the
 * pair and `stuck.ts` already imports `artifact.ts`.
 */
export const requirementsIn = (out: {
  readonly requirements?: readonly Decided[] | undefined
  readonly decisions?: readonly Decided[] | undefined
}): readonly Decided[] => out.requirements ?? out.decisions ?? []

/**
 * The list with a step's later attempt folded in: an entry the list already holds
 * under the same key, verbatim, is not added again, and everything else appends.
 *
 * A union rather than the last attempt's list, because a re-run does not restate
 * everything its first attempt settled — one in the store dropped a live constraint
 * that way — and a union rather than a fuzzy match, because two wordings of one
 * decision are a judgement this has no business making. Appending rather than
 * reordering is what keeps every id stable: an entry's ordinal is its place among its
 * step's, and nothing here moves one.
 */
export const accumulated = (
  decisions: readonly Recorded[],
  filed: readonly Recorded[],
): readonly Recorded[] => {
  const held = new Set(decisions.map(signature))
  const added: Recorded[] = []
  for (const d of filed) {
    const key = signature(d)
    if (held.has(key)) continue
    held.add(key)
    added.push(d)
  }
  return added.length === 0 ? decisions : [...decisions, ...added]
}

const signature = (d: Recorded): string =>
  [d.at, d.source, ...(d.supersedes ?? []), d.text.trim()].join("\n")

/**
 * A recorded entry with the name every later entry uses for it: the step that filed
 * it and its ordinal among that step's, `3-scope.2`. Ordinals count from one, and
 * over the whole list rather than what is rendered, so folding an entry moves no
 * other's id.
 *
 * Derived here rather than stored, for `at`'s reason: the list already says it, and
 * a stored copy could disagree. What makes it stable is `accumulated` — the channel
 * only ever appends.
 */
export interface Identified extends Recorded {
  readonly id: string
}

export const identified = (entries: readonly Recorded[]): readonly Identified[] => {
  const seen = new Map<string, number>()
  return entries.map((d) => {
    const n = (seen.get(d.at) ?? 0) + 1
    seen.set(d.at, n)
    return { ...d, id: `${d.at}.${n}` }
  })
}

/**
 * The entries that still stand: every one, less each that a later entry names in
 * its `supersedes`. What every list a reader is shown renders from, so a superseded
 * requirement is read nowhere — the entry that replaced it restates whatever of it
 * still held, and that is the contract's rule for writing one.
 *
 * Folded by id rather than by position, so an entry that supersedes a document
 * folds nothing and an entry that names an id not on this list — one a child's own
 * plan replaced — folds nothing either.
 *
 * **Takes ids already given, never a list to number.** A caller that shows part of
 * the list — the record, which leaves out what a child was born holding — numbers
 * the whole and slices after, so one entry has one name on every surface. Numbering
 * here would give the sliced list ids of its own.
 */
export const standing = (entries: readonly Identified[]): readonly Identified[] => {
  const folded = new Set(entries.flatMap((d) => d.supersedes ?? []))
  return entries.filter((d) => !folded.has(d.id))
}

/**
 * The channel as markdown — a list, assumed entries visibly marked, the id on its
 * own line, and what an entry supersedes beside it. Every entry another has
 * superseded is left out.
 *
 * One renderer, so `trak.md` and the record cannot drift apart. Same argument and
 * same place in the design as `artifactText`: rendering is a view, and every
 * reader that wants prose asks for it.
 */
export const decisionsText = (entries: readonly Identified[]): string =>
  standing(entries)
    .map((d) => {
      const trail = [
        `*${d.id}*`,
        ...(d.supersedes === undefined
          ? []
          : [`supersedes ${d.supersedes.map((name) => `\`${name}\``).join(", ")}`]),
      ]
      return `- **${d.source}** — ${d.text.trim()}\n  ${trail.join(", ")}`
    })
    .join("\n")

/**
 * The note a superseded document opens with: the claim that is true now, and the
 * entry that filed it. Empty when nothing supersedes the document, which is nearly
 * every one.
 *
 * A blockquote per entry rather than a section, so it cannot be mistaken for one
 * the document declared — and above the first section rather than beside the
 * sentence it replaces, because nothing here knows which sentence that was.
 */
export const supersededText = (entries: readonly Identified[]): string =>
  entries.map((d) => `> **Superseded by \`${d.id}\`** — ${d.text.trim()}`).join("\n\n")
