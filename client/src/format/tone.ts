/**
 * `tone` — a closed vocabulary, and the one place it becomes an appearance.
 *
 * `trakLabel` and `planView`'s `stepTone` both return a `Tone`, and two features
 * inventing two sets of strings is a drift no compiler catches. So the union lives
 * here, and so does the single map from the five names to the five appearances —
 * `client-style`'s rule is that colour decisions do not spread through components.
 *
 * A `Tone` is a semantic name, not a colour: `waiting` means a human owes an action,
 * whatever amber happens to be today.
 */
export type Tone = "neutral" | "working" | "waiting" | "good" | "bad"

/**
 * Five, deliberately. A sixth means an event kind was not thought about — add the
 * case to `trakLabel`'s switch instead of a tone here.
 *
 * | `Tone` | Means |
 * |---|---|
 * | `neutral` | it happened, nothing is owed |
 * | `working` | something is in flight right now |
 * | `waiting` | a human owes an action — the only tone the action bar reacts to |
 * | `good` | it went well and nothing is owed — a step or check that passed, work that was kept, or a trak that ran its plan out with nothing to merge |
 * | `bad` | a failure |
 *
 * `Record<Tone, string>` rather than a partial map or a function: adding a member to
 * the union is then a type error *here*, at the one place that has to decide what it
 * looks like, instead of rendering unstyled at some call site.
 *
 * **Whole class names only.** Tailwind v4 finds classes by scanning source text for
 * candidates, so a constructed string — `` `text-tone-${tone}` `` — compiles to
 * nothing at all: the utility never enters the stylesheet and the element renders
 * with no colour. Every value below has to stay a literal for that reason, which is
 * also why this is a lookup table and not string interpolation.
 */
export const toneClass: Record<Tone, string> = {
  neutral: "text-tone-neutral bg-tone-neutral-bg",
  working: "text-tone-working bg-tone-working-bg",
  waiting: "text-tone-waiting bg-tone-waiting-bg",
  good: "text-tone-good bg-tone-good-bg",
  bad: "text-tone-bad bg-tone-bad-bg",
}

/**
 * The same five as a foreground alone, and as a fill alone.
 *
 * `toneClass` carries both in one string, which is exactly right for a pill and
 * unusable for the two things a list row needs separately: a glyph tinted with
 * no box around it, and a box behind a glyph that already has its own colour.
 * Split rather than composed — `` `${toneInk[t]} ${toneFill[t]}` `` is a whole
 * class name either side of the space, where a template that *built* a class name
 * would emit no CSS at all. See above.
 */
export const toneInk: Record<Tone, string> = {
  neutral: "text-tone-neutral",
  working: "text-tone-working",
  waiting: "text-tone-waiting",
  good: "text-tone-good",
  bad: "text-tone-bad",
}

export const toneFill: Record<Tone, string> = {
  neutral: "bg-tone-neutral-bg",
  working: "bg-tone-working-bg",
  waiting: "bg-tone-waiting-bg",
  good: "bg-tone-good-bg",
  bad: "bg-tone-bad-bg",
}

/**
 * The third: what sits *behind* a plate's own fill, in the hairline the plate pulls in
 * by while a turn is running — the track the travelling segment moves along.
 *
 * **One consumer, and it stays here rather than in that component**, because it is the
 * third answer to *what colour is this tone* and the whole argument for this file is that
 * those live in one place. A fourth would want the same reason, not the same precedent.
 *
 * Halfway between the fill and the page: `styles.css` derives it and carries why. Whole
 * class names, for the reason above.
 */
export const toneTrack: Record<Tone, string> = {
  neutral: "bg-tone-neutral-track",
  working: "bg-tone-working-track",
  waiting: "bg-tone-waiting-track",
  good: "bg-tone-good-track",
  bad: "bg-tone-bad-track",
}

/**
 * The fourth: the tone's own ink as a fill, for a mark with no glyph on it — the goal
 * banner's landed rail segments. A mark that is all colour and no shape wants the ink at
 * full strength, which neither the pale fill nor the track gives. Whole class names.
 */
export const toneSolid: Record<Tone, string> = {
  neutral: "bg-tone-neutral",
  working: "bg-tone-working",
  waiting: "bg-tone-waiting",
  good: "bg-tone-good",
  bad: "bg-tone-bad",
}

/**
 * The five, in the order a reader should meet them: nothing owed → in flight → owed
 * → succeeded → failed. Exported because `Object.keys` on the map above loses the
 * `Tone` type, and a swatch view or a legend wants to iterate them.
 */
export const TONES: readonly Tone[] = ["neutral", "working", "waiting", "good", "bad"]
