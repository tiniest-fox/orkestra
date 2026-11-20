/**
 * The card's two faces, the verdict of the check that judged it, and the press that ends
 * a check still running.
 *
 * **In `CardShell`'s `band`, which needed no change to take it.** That slot is already a
 * full-bleed strip between the header row and the body, drawn whether or not the card is
 * folded. The tabs get their own line rather than a new slot on the header row.
 *
 * **`components/Tab`, not a segment of its own**, even though `TabBar` is
 * `h-9` and rules top and bottom — a second hairline directly under the card header. The
 * bar is what carries that, not the tab, so the tab itself composes here at card scale
 * with the container supplying the height and the one rule below.
 *
 * **`face` is `undefined` on a folded card and nothing is lit.** A superseded attempt
 * folds to its header and the strip stays, because the verdict is the useful half of it at
 * a glance; marking a face as current while neither is on screen would be the card saying
 * where you are when you are nowhere. Pressing either opens it — see `ArtifactCard`.
 *
 * **The cancel is one press at the right end, after the verdict, and it is `StopPress`.**
 * No confirmation and no second state, the system's one stop glyph, and it ends the run
 * outright — the trak parks at the stop that already exists for a failure. It is drawn only
 * while the run is in flight and only where the page handed a press, which is custody's
 * answer.
 *
 * **Below the breakpoint the tabs are their glyphs alone**, with the words kept as their
 * names: at 390px the two words took 160px and a place pill beside the verdict cut
 * `failed · exit 1` short, when the verdict is the one thing a phone reader opens the band
 * for. The person chose this over dropping the pill on a phone or accepting the cut.
 *
 * **The band is 32px and grows to 44px below the breakpoint**, taking the press with it —
 * the touch floor, paid in console height. Not a hit target grown past the square: the
 * card is `overflow-hidden`, so a 44px pseudo-element measures 44 in CSS and 32 on glass.
 *
 * **A skipped or reused run's Gate tab is drawn and unpressable.** Nothing ran this time, so
 * there is nothing behind it; a tab that vanished would leave the card the shape of one with no check, which
 * on this surface reads as a pass.
 */

import type { ReactNode } from "react"
import { Check, FileText, ShieldOff, Square, TerminalSquare, TriangleAlert } from "lucide-react"
import Tab from "../../../../components/Tab"
import { toneInk } from "../../../../format/tone"
import {
  hasConsole,
  verdictText,
  verdictTone,
  type CheckPhase,
  type CheckRun,
  type Face,
} from "../../checks/check"
import PlacePill from "../../../../components/PlacePill"
import StopPress from "../../turns/jobs/StopPress"
import type { Stopping } from "../../useStop"

/** The one mark per phase, at the size the strip's mono reads at. */
const glyph = (phase: CheckPhase): ReactNode => {
  switch (phase) {
    case "running":
      // The one mark the system has for *this is still going*, at the size `Elapsed`
      // draws it — deliberately not a second speed. `styles.css` asks for that.
      return (
        <span
          aria-hidden
          className="size-1 animate-thinking rounded-pill bg-tone-working motion-reduce:animate-none"
        />
      )
    case "passed":
      return <Check size={11} aria-hidden />
    case "failed":
      return <TriangleAlert size={11} aria-hidden />
    // The same filled square that ended it: a reader meets one glyph in both places.
    case "cancelled":
      return <Square size={11} aria-hidden fill="currentColor" />
    case "skipped":
      return <ShieldOff size={11} strokeWidth={2.5} aria-hidden />
    case "reused":
      return <Check size={11} aria-hidden />
  }
}

const GateStrip = ({
  run,
  face,
  onFace,
  cancelling,
}: {
  readonly run: CheckRun
  /** Which face is showing, or `undefined` where the card is folded and none is. */
  readonly face: Face | undefined
  readonly onFace: (to: Face) => void
  /** The press that ends the run, where the page offers one — `cancelChecksOffered`. */
  readonly cancelling: Stopping | undefined
}): ReactNode => {
  const press = run.phase === "running" && cancelling !== undefined ? cancelling : undefined
  return (
    <div
      className={`flex h-8 shrink-0 items-stretch justify-between gap-2 border-b border-border bg-surface max-sm:h-11 ${
        press === undefined ? "pr-3" : "pr-2"
      }`}
    >
      {/* The bar owns the hairline between its segments, for `TabBar`'s reason: whether a
          segment is first is a fact about the bar rather than about the segment. */}
      <div className="flex shrink-0 items-stretch [&>*+*]:border-l [&>*+*]:border-border">
        <Tab
          label="Gate"
          icon={TerminalSquare}
          bare
          current={face === "gate"}
          disabled={!hasConsole(run)}
          onClick={() => {
            onFace("gate")
          }}
        />
        <Tab
          label="Document"
          icon={FileText}
          bare
          current={face === "document"}
          onClick={() => {
            onFace("document")
          }}
        />
      </div>

      <div className="flex min-w-0 items-center gap-2">
        {/* Before the verdict, which keeps the band's right end as it does with no place
            to draw. **The pill gives up its width first, down to the cloud alone**: its
            wrapper keeps the pill's floor — no `min-w-0` — and a shrink factor this large
            puts all of a phone's shortfall on it but a fraction of a pixel, which is under
            what the verdict needs to draw an ellipsis. Only once the pill is at its floor
            does the verdict give up anything, as it had to before for two checks' names.
            The id is one press away in the detail; the verdict is the band's whole answer. */}
        <span className="flex shrink-100000">
          <PlacePill place={run.place} />
        </span>
        <span
          className={`flex min-w-0 items-center gap-1.5 font-mono text-2xs [&>*]:shrink-0 ${toneInk[verdictTone(run.phase)]}`}
        >
          {glyph(run.phase)}
          {/* Read at render rather than ticked: a running check writes a frame every few
              hundred milliseconds and each one redraws this, which is where `ActivityGroup`
              takes its duration from too. A timer here would be a second clock. */}
          {/* Cut rather than the tabs: at phone width a verdict naming two checks is wider
              than what the tabs leave it, and drawn whole it runs under them. */}
          <span className="min-w-0 shrink! truncate">{verdictText(run, Date.now())}</span>
        </span>
        {press === undefined ? undefined : (
          <StopPress label={run.name} disabled={press.disabled} onPress={press.stop} />
        )}
      </div>
    </div>
  )
}

export default GateStrip
