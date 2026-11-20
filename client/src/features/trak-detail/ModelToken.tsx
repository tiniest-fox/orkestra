/**
 * A step's model and the effort it runs at, as one token: its bare name behind the glyph
 * of the CLI that runs it, and — where an effort was declared — the level in a second
 * compartment of the same pill. It leads the spend row under the chat box —
 * `chat-bar/TrakChatBar`.
 *
 * **One pill, two compartments, and the shape carries the meaning so neither word has
 * to.** A reader who has never seen a level knows the second compartment is not part of
 * the model's name. The pill's outer edge and the rule between them are both `guide`,
 * never `border`: `border` is `fg-muted` mixed *into `surface`*, so on a `surface-2`
 * ground it is very nearly nothing, where `guide` composites over whatever is behind it.
 *
 * **The effort is what gives, and the model name never truncates** — half a model name
 * is a different model, and the effort is the fact a reader can live without at 390.
 *
 * **The level is drawn whole and as a word, never shortened and never as a position on a
 * scale.** This client holds no list of levels and no ordering: a safe short form has to
 * be checked unique against the set it came from — `minimal` and `medium` collide at one
 * letter — and a scale needs an order nothing on the wire carries.
 *
 * No effort declared draws today's pill exactly — one compartment and no rule — which is
 * every step of a project that declares none, so it has to look deliberate.
 *
 * Presentational, and its own file so a trak's step and a piece's draw one token.
 */

import type { ReactNode } from "react"
import { bareName, cliGlyph } from "../../format/modelName"

const ModelToken = ({
  model,
  effort,
}: {
  readonly model: string
  /** **Absent is the ordinary case**: nothing declared one, and the CLI runs at its own default. */
  readonly effort: string | undefined
}): ReactNode => {
  const Glyph = cliGlyph(model)
  const name = bareName(model)
  return (
    <span
      // Two unlabelled mono words read to somebody who knows the vocabulary and are nothing
      // to a screen reader, so the pill says both facts in words.
      aria-label={effort === undefined ? `Model ${name}` : `Model ${name}, effort ${effort}`}
      // `overflow-hidden` so the compartments clip to the pill's own radius instead of each
      // carrying half of it. `min-w-0` written out even though the clip supplies it, because
      // a compartment holding a `shrink-0` name gets cut by the clip with no ellipsis and
      // nothing reporting it.
      className="flex min-w-0 items-center overflow-hidden rounded-pill border border-guide font-mono text-2xs text-fg-muted"
    >
      <span className="flex shrink-0 items-center gap-1 px-1.5 py-px">
        <Glyph size={11} aria-hidden className="shrink-0 opacity-70" />
        <span>{name}</span>
      </span>
      {effort !== undefined && (
        <span className="min-w-0 self-stretch truncate border-l border-guide px-1.5 py-px">
          {effort}
        </span>
      )}
    </span>
  )
}

export default ModelToken
