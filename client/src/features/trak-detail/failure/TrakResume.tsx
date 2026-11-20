/**
 * The way out of a stopped trak: the press, what it costs, and why the last one did not
 * land.
 *
 * **Its own file because two surfaces draw it and there must be one account.** `TrakFailure`
 * is the notice a stopped trak gets at a position with a chronology to end; the block
 * `TrakDetailPage` draws at the eight states the *engine* was working at replaces that
 * notice outright — same trak, same position, same press — so a second copy of the button
 * would be a second thing free to drift from the first about what resuming costs and what a
 * refusal says.
 *
 * `quiet` rather than `primary`, and the reason is `TrakFailure`'s: `--color-accent` and
 * `--color-tone-bad` sit two hex digits apart, so a primary button on an error plate is the
 * one-colour-two-labels collision `styles.css` warns about — and a way out of a stuck trak
 * is not the drawer asking a question.
 */

import type { ReactNode } from "react"
import { RotateCcw } from "lucide-react"
import Button from "../../../components/Button"
import type { NoticeWords } from "../../../format/failure"
import type { Resumption } from "./useResume"

const TrakResume = ({
  words,
  resumption,
}: {
  /** What the press is called and what it costs — `failureWords` or `stoppedWords`. */
  readonly words: NoticeWords
  /** The hook keyed to the trak this is *about*, which at a spawn's piece is the piece
   *  rather than the page's own trak — `useResume` carries why nothing here may
   *  auto-fire. */
  readonly resumption: Resumption
}): ReactNode => (
  <div className="flex min-w-0 flex-col gap-1.5">
    {/* Above nothing: the press is the last thing on the plate, so what it costs is
        read beside it rather than under it. */}
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="quiet"
        icon={RotateCcw}
        busy={resumption.isPending}
        disabled={resumption.disabled}
        onClick={resumption.resume}
      >
        {words.press}
      </Button>
      <span className="min-w-0 text-sm text-fg-subtle">{words.says}</span>
    </div>
    {resumption.said === undefined ? undefined : (
      <span role="alert" className="text-sm text-tone-bad">
        {resumption.said}
      </span>
    )}
  </div>
)

export default TrakResume
