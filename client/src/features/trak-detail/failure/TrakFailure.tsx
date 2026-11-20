/**
 * Why a trak stopped, and the way out — drawn at the position it stopped on, in the
 * chronology of the trak it belongs to. `DrawerPane` carries the one position that has no
 * such chronology to end: a parent resting on a position its spawn's pieces own, where the
 * notice takes the head of the pane rather than the tail of somebody else's log.
 *
 * **Both stoppages, one notice.** A trak the engine wrote an ending for and a trak whose
 * process went away mid-command are the same thing to a reader — it is not going anywhere,
 * and here is what to press — so they take one plate, one layout and one hook, and differ
 * only in the words `format/failure.ts` hands over. The press out of the second used to be
 * bare chrome in the header band with nothing saying what had happened.
 *
 * **Keyed on the state, not on a transcript entry.** Three of the four `Failure` kinds
 * write no transcript row at all and an interrupted run writes nothing by definition, so an
 * entry could not carry either; and being about the trak's condition *now* is what makes it
 * disappear the moment a restart moves the state on, taking the folded rows with it. It
 * sits here rather than in the header band or in the chat bar's place.
 *
 * **A classified provider failure's own words are drawn nowhere** — not open, not behind a
 * disclosure. A rate limit's error is a 300-character JSON blob, and the sentence above
 * says everything a person can act on. `ork resume <id>` prints it in full.
 *
 * **One nobody classified is the exception**: its sentence says only that there is no name
 * for it, and a spawn that failed, a `model:` naming no provider and a CLI that exited
 * before answering all read that way. The provider's text is the only thing that tells
 * them apart, so it is behind the same press a runner's output is.
 *
 * **A runner's failure is the exception**, because there the sentence is the script's and
 * the runner file and verb are what a person opens to fix it: both are drawn under the
 * line, and what the script printed — the provider's own text — is behind a press. It
 * wraps rather than scrolls, so a phone reads it at its own width.
 *
 * **So is a refusal by the runners-only guard**: its sentence is the engine's, it names the
 * missing runner, and it is the line, in place of the kind's.
 *
 * **And so is a failed setup**: what the script printed is the error a person fixes, so it
 * is behind the same press a runner's output is.
 *
 * **And so is a remake that left the uncommitted changes behind**: the ref holding them is
 * drawn whole under the line, selectable in one press and wrapping at any width.
 *
 * **A failed effect gets a second press**, `EffectSkip`, under the first: a skip goes on to
 * the next step without the effect, where a restart runs it again.
 *
 * **Not at the eight states the engine itself was working at.** `engineWork` names them,
 * and the block `TrakDetailPage` draws there replaces this notice rather than standing
 * above it — same trak, same position, and two plates saying *this is happening* and *this
 * stopped* within 200px contradict each other. The press is `TrakResume` in both, so
 * there is one account of it.
 */

import { type ReactNode, useState } from "react"
import { ChevronDown, ChevronRight, CircleSlash } from "lucide-react"
import AnsiText from "../../../components/AnsiText"
import Button from "../../../components/Button"
import type { NoticeWords, RunnerWords } from "../../../format/failure"
import { Shell } from "../turns/output/FailedNotice"
import EffectSkip from "./EffectSkip"
import TrakResume from "./TrakResume"
import type { Resumption } from "./useResume"
import type { EffectSkipping } from "./useSkipEffects"

/**
 * What a script printed, behind a press — nothing where it printed nothing. It wraps rather
 * than scrolls, so a phone reads it at its own width.
 */
const Printed = ({ text }: { readonly text: string }): ReactNode => {
  const [open, setOpen] = useState(false)
  const printed = text.trim()
  if (printed === "") return undefined
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon={open ? ChevronDown : ChevronRight}
        onClick={() => {
          setOpen(!open)
        }}
      >
        {open ? "Hide what it printed" : "Show what it printed"}
      </Button>
      {open && (
        <pre className="w-full min-w-0 whitespace-pre-wrap break-words font-mono text-xs leading-4 text-fg-muted">
          <AnsiText text={printed} />
        </pre>
      )}
    </>
  )
}

/** The runner file and verb under the line, and what the script printed behind a press. */
const RunnerDetail = ({ runner }: { readonly runner: RunnerWords }): ReactNode => (
  <div className="flex min-w-0 flex-col items-start gap-1">
    <p className="min-w-0 break-all font-mono text-xs text-fg-subtle">from {runner.names}</p>
    <Printed text={runner.printed} />
  </div>
)

const TrakFailure = ({
  words,
  resumption,
  skipping,
}: {
  /** What stopped it and what the press costs — `failureWords` or `stoppedWords`. */
  readonly words: NoticeWords
  /** The hook keyed to the trak this notice is *about*, which at a spawn's piece is the
   *  piece rather than the page's own trak — `useResume` carries why nothing here may
   *  auto-fire. */
  readonly resumption: Resumption
  /** The skip, where a failed effect stopped the trak, and `undefined` at every other failure. */
  readonly skipping: EffectSkipping | undefined
}): ReactNode => (
  <Shell icon={<CircleSlash size={11} />} head={words.head}>
    <p className="text-base leading-5 text-fg-muted">{words.line}</p>
    {words.runner !== undefined && <RunnerDetail runner={words.runner} />}
    {words.setup !== undefined && (
      <div className="flex min-w-0 flex-col items-start gap-1">
        <Printed text={words.setup} />
      </div>
    )}
    {words.unnamed !== undefined && (
      <div className="flex min-w-0 flex-col items-start gap-1">
        <Printed text={words.unnamed} />
      </div>
    )}
    {words.carried !== undefined && (
      <code className="min-w-0 select-all break-all font-mono text-xs text-fg">
        {words.carried}
      </code>
    )}
    <div className="mt-1 flex min-w-0 flex-col gap-2">
      <TrakResume words={words} resumption={resumption} />
      {skipping === undefined ? undefined : <EffectSkip skipping={skipping} />}
    </div>
  </Shell>
)

export default TrakFailure
