/**
 * Where the reason for a recompose is typed — over the screen, behind a wash.
 *
 * **A sheet rather than the chat bar, at both places the press is offered.** The bar is
 * never armed for it: Enter must not mean two things at once, and the header's press is a
 * document away from the bar. So the press opens this, and this holds the one field.
 *
 * **What it has to say is the reversal, and it is two sentences rather than one.** The
 * press used to throw the step's work away and now keeps it, at every gate. At a gate
 * with a document on the table the engine commits this step's work before the composer
 * runs, so pressing it is taking the work as well; at a gate with nothing filed the same
 * commit keeps whatever the step edited before it said anything. `filed` is which of the
 * two this is, read off the state by the page, and the sentence is the one place a person
 * is told at the moment they are deciding.
 *
 * **A modal sits behind a wash** — `components/README`'s surface rule — and this is the
 * second surface here to take `--color-scrim`, after `Lightbox`. It shares that
 * component's placement and nothing else: `fixed inset-0 z-40` in the caller's own tree
 * with no portal, so nothing above the caller may carry `transform`, `filter`,
 * `backdrop-filter`, `will-change` or `contain` — `Lightbox.tsx` carries the rule and the
 * browser tier holds it. Not `Lightbox` itself, because that takes focus onto its own
 * close control as it opens and shuts on a press on the wash, and a sheet with a field in
 * it wants the cursor in the field and a stray press to lose nothing.
 *
 * **Escape shuts it and keeps the draft; nothing else shuts it but Cancel and a send that
 * landed.** The draft is the hook's, held per trak, so shutting is never losing. Escape is
 * a handler on this node, which a keystroke aimed at the document never reaches — it works
 * exactly while focus is inside, and the field's `autoFocus` puts it there as the sheet
 * opens. **No focus trap**, for `Lightbox`'s reason: holding Tab in would need a document
 * listener.
 *
 * **Enter in the field is a newline.** The reason is a paragraph, and the press below is
 * the send — the one place on this screen where the chat bar's Enter rule does not apply.
 *
 * `said` is the refusal the send earned, drawn where the send is: the sheet outlives a
 * refused press, because the way through one is to read it and try again.
 */

import type { KeyboardEvent, ReactNode } from "react"
import Button from "../../../components/Button"
import Field from "../../../components/Field"
import type { Recomposing } from "./useRecompose"

const HEADING = "Recompose from here?"

const RecomposeSheet = ({
  filed,
  recomposing,
}: {
  /** Whether the step has filed a document at this gate — `workAwaitsApproval`. */
  readonly filed: boolean
  readonly recomposing: Recomposing
}): ReactNode => (
  <div
    role="dialog"
    aria-label={HEADING}
    className="fixed inset-0 z-40 flex items-start justify-center bg-scrim p-4 pt-[12vh]"
    onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") recomposing.cancel()
    }}
  >
    <div className="flex w-full max-w-md min-w-0 flex-col gap-3 rounded-surface border border-border bg-surface p-4 shadow-modal">
      <span className="text-base font-medium text-fg">{HEADING}</span>
      <p className="text-sm text-fg-muted">
        {filed
          ? "This step’s work is committed first, then the composer replans everything after it with what you say."
          : "Nothing has been filed here, but the files this step edited are committed first all the same. The composer replans from this step with what you say."}
      </p>
      <Field
        id="recompose-reason"
        label="What should happen instead?"
        placeholder="What should happen instead?"
        rows={3}
        value={recomposing.draft}
        onChange={recomposing.write}
        autoFocus
      />
      {recomposing.said === undefined ? undefined : (
        <span role="alert" className="text-sm text-tone-bad">
          {recomposing.said}
        </span>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="md" onClick={recomposing.cancel}>
          Cancel
        </Button>
        {/* `busy` makes it non-submittable while the drive is starting rather than merely
            spinning; `disabled` covers somebody else already driving, and a blank reason —
            the composer run to read nothing spends the same as one run to read a paragraph. */}
        <Button
          variant="primary"
          size="md"
          busy={recomposing.isPending}
          disabled={recomposing.disabled || recomposing.draft.trim() === ""}
          onClick={recomposing.send}
        >
          Recompose
        </Button>
      </div>
    </div>
  </div>
)

export default RecomposeSheet
