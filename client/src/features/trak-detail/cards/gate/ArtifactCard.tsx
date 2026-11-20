/**
 * What a step filed, as a card at the end of its log.
 *
 * **The log runs to the artifact and this is where it ends** — one chronology, with the
 * document as the last thing the turn did. The pane opens scrolled to it, because that is
 * what a reader came for; the transcript above is the evidence they read when the
 * document surprises them.
 *
 * **The gate's press is `CardShell`'s slot, passed straight through**, the same way
 * `ProposalCard` takes it: the document is what a person is being asked about, so the
 * button that takes it is on the document. This card still does not know that — whether
 * there is a press at all is `workAwaitsApproval` at the page, and it arrives here already
 * built. A card must not choose its own buttons, and the reason is specific: the approval
 * gate takes `Approve` and refuses `Skip`, the two that take `Skip` refuse `Approve`, and a
 * press a gate refuses is settled as `Failed{engine}` — a wrong verdict rather than a
 * refusal.
 *
 * `Replan` arrives in the same slot, welded to Approve — `GatePresses` carries why. `Skip`
 * is still `pnpm ork`.
 *
 * **A check gives the card a second face, and it is the same card**, not a pane of its own
 * or a block in the log: the check and the work it judges are one object, so they fold as
 * one, scroll as one, and a superseded attempt keeps its own run instead of leaving it
 * stranded. Which face is showing is `check.ts`'s rule and a press writes over it, for that
 * run's phase only.
 */

import type { ReactNode } from "react"
import { useState } from "react"
import type { CorrectionDto, DecidedDto, DocumentDto, MarkDto } from "../../../../api/types"
import ArtifactBody from "./ArtifactBody"
import CardShell from "../CardShell"
import { faceFor, type CheckRun, type Chosen } from "../../checks/check"
import ChecksSkippedNotice from "../../checks/ChecksSkippedNotice"
import GateFace from "./GateFace"
import GateStrip from "./GateStrip"
import HeldBand from "./HeldBand"
import UnattendedBand from "./UnattendedBand"
import type { Stopping } from "../../useStop"

const ArtifactCard = ({
  document,
  requirements,
  corrections,
  uncovered,
  head,
  actions,
  atGate,
  superseded = false,
  run,
  cancelling,
}: {
  readonly document: DocumentDto
  /** What the envelope this card is drawing filed — not the trak's accumulated list. */
  readonly requirements: readonly DecidedDto[]
  readonly corrections?: readonly CorrectionDto[]
  /** Work the plan did not have, on an envelope filed before `requirements` absorbed it. */
  readonly uncovered?: readonly string[]
  /** What the header says. A position files under its own name, and a child under its. */
  readonly head: string
  /** The gate's presses, when this document is the one a person is standing at. */
  readonly actions?: ReactNode
  /**
   * What happened at this document's gate. The other half of `actions`: one is the press
   * being offered, this is the press that was never made — or, on a `Held` atGate, the
   * press that *was*. `HeldBand` is `UnattendedBand`'s mirror.
   */
  readonly atGate: MarkDto | undefined
  /**
   * An earlier attempt at this position, kept but folded.
   *
   * A step re-entered after a failing check files twice, and both are in the log. Showing
   * them open is a step arguing with itself, so everything but the last collapses to its
   * header — the reference does the same, and it is what keeps a re-run position from
   * being two documents.
   */
  readonly superseded?: boolean
  /**
   * The check that judged this document, where one ran and there is anything left of it.
   *
   * `undefined` on every position whose agent declares none — half of them here — and the
   * card is then exactly what it was before this existed, which is what stops the strip
   * becoming furniture that is empty more often than not.
   */
  readonly run?: CheckRun
  /**
   * The press that ends the check in flight over this document, where the page offers one.
   * Required down to the strip, `undefined` spelled out, for `atGate`'s reason.
   */
  readonly cancelling: Stopping | undefined
}): ReactNode => {
  const [open, setOpen] = useState(!superseded)
  /** What a person pressed, and the phase they pressed it in. `check.ts` carries the rule. */
  const [chosen, setChosen] = useState<Chosen | undefined>(undefined)
  const face = run === undefined ? "document" : faceFor(run, chosen)

  return (
    <CardShell
      head={head}
      open={open}
      onToggle={() => {
        setOpen(!open)
      }}
      summary={open ? undefined : Object.keys(document.sections).join(", ")}
      actions={actions}
      // Both drawn on a folded attempt: a superseded document that nobody read is exactly
      // the one worth finding, and folding it is about its length rather than its standing.
      //
      // The strip first, directly under the header; the warrant
      // under it, against the body it is about.
      band={
        run === undefined && atGate === undefined ? undefined : (
          <>
            {run === undefined ? undefined : (
              <GateStrip
                run={run}
                face={open ? face : undefined}
                onFace={(to) => {
                  setChosen({ phase: run.phase, face: to })
                  // A press on a folded card is a press to read something, so it opens it.
                  // Nothing else would happen: the body is what the faces are.
                  setOpen(true)
                }}
                cancelling={cancelling}
              />
            )}
            {atGate === undefined ? undefined : atGate._tag === "Held" ? (
              <HeldBand />
            ) : (
              <UnattendedBand why={atGate} />
            )}
          </>
        )
      }
    >
      {!open ? undefined : run !== undefined && face === "gate" ? (
        // The sentence under a failing console belongs to the gate rather than to the run,
        // and a press being on the table is the whole of what says this is one.
        <GateFace run={run} asked={actions !== undefined} />
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          {/* The absence said a second time, in the body, where the strip's line is read
              at a glance — `ChecksSkippedNotice` carries why once is not enough. The name
              is the joined list `runOf` built, split back for the sentence. */}
          {run?.phase === "skipped" && <ChecksSkippedNotice names={run.name.split(", ")} />}
          <ArtifactBody
            document={document}
            requirements={requirements}
            corrections={corrections}
            uncovered={uncovered}
          />
        </div>
      )}
    </CardShell>
  )
}

export default ArtifactCard
