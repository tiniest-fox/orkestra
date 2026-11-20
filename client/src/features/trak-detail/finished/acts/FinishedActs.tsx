/**
 * The presses on the finished position, and the two endings that have none.
 *
 * **The row is two groups that cannot push each other.** The doors — *More work on it* and
 * *Ask about it* — hold the left and never move, relabel or change weight. The one press
 * that ends the trak holds the right edge, in one cell, and `endingCell` decides what is in
 * it: a ghost *Checking GitHub…* while the forge's answer can still decide it, then Merge,
 * a loud Archive, the `⋯` holding Archive, or nothing. So as the forge and the preview
 * answer, only that cell changes, and the right alignment is what keeps its width from
 * reaching the doors. On a phone the row is three equal cells — the doors, then the ending
 * — with short labels, and the third holds its place filled or not. Merge and Archive never
 * appear ahead of the doors once the forge answers, so the doors never move.
 *
 * **Only the ending is loud.** The doors are always quiet; a row whose cell is the `⋯` or
 * empty has no loud press, because nothing on it is the next step.
 *
 * **The band sits on the pane's bottom edge, always** — `FinishedFoot`. **The box opens
 * inside it, above the row**, with its Send and Cancel at its own foot: nothing is inserted
 * into the row while it is open, and the door that opened it reads as taken. **On a phone
 * the box opens in the row's place**, with everything that stands above the row — and the
 * way out of the box is the way back to the row. The chrome above the pane stays pinned
 * there, so a box over the row as well left a ticked comment no room to be seen or unticked
 * in.
 *
 * **Merge carries its destination in its label**, because a host merge goes into whatever
 * branch the daemon's machine is standing on. It is shown before it is honoured, and until
 * the preview answers the button says so rather than naming a branch it is guessing at.
 *
 * **And it says when the merge will not go in**, off the same preview. The press is the
 * same press either way — it attempts the merge and the outcome decides — so a stale
 * prediction costs a label and never a path. What changes is that pressing it plans a
 * resolution instead of putting the work in, which is worth knowing first.
 *
 * **A pull request open on the branch puts its own merge in the ending cell**, from the
 * moment the pane's whole answer is in hand: `MergeSplit`, GitHub's split button, live on
 * GitHub's own verdict, with the `⋯` holding Archive beside it. **The band says why GitHub
 * will not merge**, on a line above the row in GitHub's wording, and once the forge reports
 * the merge the cell is the loud Archive. GitHub's refusal of a press goes in the refusal
 * line above the row. On a phone the press stands on its own full-width line above the
 * doors, and the cell keeps the `⋯`.
 *
 * **Auto-merge's switch stands before that merge press**, on a trak that can take it —
 * `AutoMergePress`, with a line above the row naming the method it will merge by. The
 * picker in the header offers the same switch; the band is where a person deciding to merge
 * is already looking.
 *
 * **Archive always confirms first.** Either trigger opens `components/Confirmation` —
 * floated above the row for the loud press, in the menu's own popover for the `⋯` — with
 * the row still visible underneath, so the two doors are never unreachable. The trigger
 * stays live while the panel is open rather than `disabled`: a disabled crimson press
 * paints its ink at 1.47:1, and the open panel is what says which press was taken. The
 * panel's one line is the whole scope, and it changes with what is true: a merged trak's
 * merge commit stays, an unmerged branch's work goes, a branch nothing was committed to
 * has nothing to lose, and a held step is dropped.
 *
 * **Every ending with a pane offers both doors, `Merged` included.** Refusing a merged trak on
 * the grounds that more work on it is a new trak is wrong here, because a merged trak is
 * exactly the one you have a question about afterwards and one row is easier to learn than two.
 * `controls.ts` is where it is decided and carries why; nothing here reads a `_tag`.
 *
 * **Two presses, one box, and nothing in it to pick.** *More work on it* opens the box and
 * *Ask about it* opens the same box worded for a question — the label, the foot line, the
 * placeholder and the send are `doorWords`, and the agent goes on the request rather than
 * being chosen anywhere on screen. The press you took is disabled while its box is open and
 * the other one is not: pressing it changes the door under whatever has been typed or
 * ticked, which is the same one re-entry either way.
 *
 * **A refusal is drawn only where its own press is.** `useMerge` lives on the page, so a
 * mutation error outlives the state it was earned at — the merge's is gated on the cell
 * holding Merge. The archive's refusal draws inside its own confirmation panel. The send's
 * draws under the box, beside the Send at its foot. **One merge refusal leaves the band**: a
 * child's dirty parent is plated above the card by `FinishedView`, with the press that
 * commits it, and `refusedAbove` is the pane saying so.
 *
 * **The box opens on its own once something has been ticked**, because a tick on the
 * pull-request half above has to land somewhere a person can see it. A box opened that way
 * shuts when the last picked thing is removed, and its Cancel reads *Clear*: it removes
 * every tick and shuts the box, so **no press on this surface can be pressed and change
 * nothing.**
 *
 * **Neither route opens it where the state does not offer more work**: a pick survives the
 * press that moved the trak on, so `doors` gates the box as well as the presses that open
 * it. The pane above draws its ticks off that one answer too — `FinishedView` asks it once.
 */

import type { KeyboardEvent, ReactNode } from "react"
import { useState } from "react"
import type { LucideIcon } from "lucide-react"
import { Archive, GitMerge, MessageSquarePlus } from "lucide-react"
import Button from "../../../../components/Button"
import ConfirmSheet from "../../../../components/ConfirmSheet"
import Confirmation from "../../../../components/Confirmation"
import MenuItem from "../../../../components/MenuItem"
import OverflowMenu from "../../../../components/OverflowMenu"
import AutoMergePress from "./AutoMergePress"
import MergeSplit, { CheckingPress } from "./MergeSplit"
import ChangeRequest from "./ChangeRequest"
import FinishedFoot from "./FinishedFoot"
import type { Door, EndingCell } from "../finished"
import { archiveScope, doorWords, pullMergeWords } from "../finished"
import type { PullMerge } from "../../pull-request/pullRequest"
import { pickedBase, reentryBody } from "../../pull-request/picks/reentryBody"
import type { Picked } from "../../pull-request/picks/reentryBody"
import type { Archiving } from "../../useArchive"
import type { Merge } from "../merge/useMerge"
import type { PullMerging } from "../merge/useMergePullRequest"
import type { MergeMethodPick } from "../merge/useSetMergeMethod"
import { mergeHoldsLine } from "../../../../format/mergeHolds"
import type { Changes } from "./useReenter"
import type { AutoMergeDto } from "../../../../api/types"
import { autoMergeNotice, autoMerging } from "../../autoMerge"
import type { AutoMergeSetting } from "../../run-mode/useSetAutoMerge"

/** Auto-merge as the band offers it: where it stands, and the press that turns it. */
export interface AutoMergeOffer {
  readonly value: AutoMergeDto | undefined
  readonly setting: AutoMergeSetting
}

/** The refusal the last press earned, in the header's own shape — plus the files, when a
 *  dirty host checkout is what refused it and the person has to go and act on them. */
const Refused = ({
  said,
  files,
}: {
  readonly said: string | undefined
  readonly files: readonly string[]
}): ReactNode =>
  said === undefined ? null : (
    <div role="alert" className="flex flex-col gap-1 text-sm text-tone-bad">
      <span>{said}</span>
      {files.map((file) => (
        <span key={file} className="truncate pl-2 font-mono text-2xs text-fg-muted">
          {file}
        </span>
      ))}
    </div>
  )

/** GitHub's reason it will not merge — the waiting tone, its headline in weight. */
const BlockedLine = ({ pull }: { readonly pull: PullMerge | undefined }): ReactNode => {
  if (pull?.verdict?._tag !== "Blocked") return null
  const { lead, text } = mergeHoldsLine(pull.verdict.holds)
  return (
    <p className="text-sm text-tone-waiting">
      {lead !== undefined && <span className="font-medium">{`${lead} `}</span>}
      {text}
    </p>
  )
}

/**
 * What stands above the row while the forge merge is on offer, top to bottom: a refused
 * press or pick, GitHub's reason it will not merge, then auto-merge — a refused switch, where
 * it stands, muted for sends spent and the waiting tone for a stop, and the method it will
 * merge by. On a phone the switch and the merge press follow, each on its own line, because
 * the row's third cell holds only the `⋯`.
 */
const PullMergeAbove = ({
  said,
  pull,
  merging,
  methodPick,
  autoMerge,
  phone,
}: {
  readonly said: string | undefined
  readonly pull: PullMerge | undefined
  readonly merging: PullMerging
  readonly methodPick: MergeMethodPick
  readonly autoMerge: AutoMergeOffer | undefined
  readonly phone: boolean
}): ReactNode => {
  const notice = autoMergeNotice(autoMerge?.value)
  const on = autoMerging(autoMerge?.value)
  return (
    <>
      <Refused said={said} files={[]} />
      <Refused said={methodPick.said} files={[]} />
      <BlockedLine pull={pull} />
      {autoMerge !== undefined && <Refused said={autoMerge.setting.said} files={[]} />}
      {notice !== undefined && (
        <p className={`text-sm ${notice.waiting ? "text-tone-waiting" : "text-fg-muted"}`}>
          {notice.text}
        </p>
      )}
      {on && pull !== undefined && (
        <p className="text-sm text-fg-muted">
          {`Auto-merge will ${pullMergeWords(pull.method).verb} #${String(pull.number)} once GitHub allows it.`}
        </p>
      )}
      {phone && autoMerge !== undefined && (
        <AutoMergePress
          on={on}
          disabled={autoMerge.setting.disabled}
          onToggle={autoMerge.setting.set}
          block
        />
      )}
      {phone &&
        (pull === undefined ? (
          <CheckingPress block />
        ) : (
          <MergeSplit pull={pull} merging={merging} methodPick={methodPick} block phone />
        ))}
    </>
  )
}

/**
 * What the merge press is called.
 *
 * The conflict wins over the destination, because it is the one that changes what
 * pressing it does: a merge that goes in puts the work there, and one that does not
 * sends the trak back to the composer for a resolution. Naming the branch as well
 * would be two facts competing for the same few words, and only one of them is news.
 * A phone says the verb alone, so that three presses fit one row.
 */
const mergeLabel = (
  destination: string | undefined,
  conflicts: boolean | undefined,
  phone: boolean,
): string =>
  conflicts === true
    ? phone
      ? "Resolve"
      : "Resolve merge conflicts"
    : phone
      ? "Merge"
      : destination === undefined
        ? "Merge it"
        : `Merge into ${destination}`

/**
 * Which door the box is open on, or none.
 *
 * A tick above opens the box without a press, because it has to land somewhere visible —
 * but only where the state actually takes more work. A pick made at `Finished` outlives
 * the press that sent the trak to `Closing`, and drawing the box for it there would offer
 * a send the route answers `409 NotAtRest`.
 *
 * **A tick opens the plan door**, because a ticked failing check is something to change
 * and the composer is what does something about it. The press still wins where both say
 * something: ticking and then asking is a question with the check quoted under it.
 */
const doorOf = (
  offered: boolean,
  asking: Door | undefined,
  picked: readonly Picked[],
): Door | undefined => (!offered ? undefined : (asking ?? (picked.length > 0 ? "plan" : undefined)))

/**
 * The open box's send, and its way out — at the box's own foot.
 *
 * **The body is composed here and nowhere else**, off the same list and sentence the box
 * draws. Blank is what turns the press off, which is why it is one question rather than
 * two. **With something ticked the way out reads *Clear***, because what holds the box
 * open is the picked list: shutting it without emptying the list would be a press that
 * changes nothing on screen.
 */
const SendPress = ({
  door,
  changes,
  picked,
  onShut,
  onClear,
}: {
  readonly door: Door
  readonly changes: Changes
  readonly picked: readonly Picked[]
  readonly onShut: () => void
  readonly onClear: () => void
}): ReactNode => {
  const body = reentryBody(picked, changes.what)
  const words = doorWords(door)
  return (
    <span className="flex gap-2">
      <Button
        icon={MessageSquarePlus}
        busy={changes.isPending}
        disabled={changes.disabled || body === ""}
        onClick={() => {
          // The base rides only the plan door: it is the composer that is told to merge it.
          changes.send(
            body,
            words.agent,
            words.agent === undefined ? pickedBase(picked) : undefined,
          )
        }}
      >
        {words.send}
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          if (picked.length > 0) onClear()
          onShut()
        }}
      >
        {picked.length > 0 ? "Clear" : "Cancel"}
      </Button>
    </span>
  )
}

/** The open box, with its send and its way out at its own foot. */
const OpenBox = ({
  door,
  glyph,
  changes,
  picked,
  onRemove,
  taken,
  onShut,
  onClear,
  phone,
}: {
  readonly door: Door
  readonly glyph: LucideIcon
  readonly changes: Changes
  readonly picked: readonly Picked[]
  readonly onRemove: (key: string) => void
  readonly taken: boolean
  readonly onShut: () => void
  readonly onClear: () => void
  readonly phone: boolean
}): ReactNode => (
  <ChangeRequest
    door={door}
    glyph={glyph}
    changes={changes}
    picked={picked}
    onRemove={onRemove}
    taken={taken}
    phone={phone}
    actions={
      <SendPress door={door} changes={changes} picked={picked} onShut={onShut} onClear={onClear} />
    }
  />
)

/**
 * The archive's two homes, and the one confirmation both open. Loud, the press is the
 * trigger and the panel floats above the row, against its right edge where the press is —
 * the act is the panel's own press, and the trigger stays live while it is open. In the
 * `⋯`, the panel replaces the item inside the menu's own popover. `confirming` lives here
 * because it is the panel's whole state, and exactly one of the two homes is mounted.
 *
 * **On a phone both homes ask in a `ConfirmSheet`** instead: the press opens it, and the
 * `⋯`'s item shuts the popover as the sheet rises beside it — so there the menu's dismissal
 * leaves `confirming` alone.
 */
const ArchiveActs = ({
  promoted,
  archiving,
  scope,
  block,
  phone,
}: {
  readonly promoted: boolean
  readonly archiving: Archiving
  /** The panel's one line — `archiveScope`, true of this trak rather than a formula. */
  readonly scope: string
  readonly block: boolean
  readonly phone: boolean
}): ReactNode => {
  const [confirming, setConfirming] = useState(false)
  const ask = {
    heading: "Archive this trak?",
    press: "Archive",
    busy: archiving.isPending,
    disabled: archiving.disabled,
    said: archiving.said,
    onCancel: () => {
      setConfirming(false)
    },
    onConfirm: archiving.archive,
  }
  const panel = <Confirmation {...ask}>{scope}</Confirmation>
  const sheet = phone && confirming && <ConfirmSheet {...ask}>{scope}</ConfirmSheet>
  return promoted ? (
    <>
      {sheet}
      {confirming && !phone && (
        /* A dialog by role as well as by look: the trigger beside it and the press
           inside it both say Archive, and the role is what keeps the two apart for
           anything reading names rather than pixels.

           Escape is the container's, here as in `OverflowMenu` and `Lightbox` —
           `Confirmation` takes focus onto its own press and owns no key handler, so
           a panel whose wrapper has none is one Escape cannot shut. A plain handler
           on this node rather than a document listener, for the same reason those
           two give: it works exactly while focus is inside, which the panel's own
           focus-taking guarantees at the moment it matters. */
        <div
          role="dialog"
          aria-label="Archive this trak?"
          className="absolute bottom-full right-0 z-10 mb-1.5 w-fit rounded-surface border border-border bg-surface shadow-modal"
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key === "Escape") setConfirming(false)
          }}
        >
          {panel}
        </div>
      )}
      <Button
        variant="primary"
        icon={Archive}
        block={block}
        onClick={() => {
          setConfirming(true)
        }}
      >
        Archive
      </Button>
    </>
  ) : (
    <>
      {/* Up: the band is always on the pane's bottom edge, so below it is off screen. */}
      <OverflowMenu
        label="More endings"
        up
        onDismiss={() => {
          if (!phone) setConfirming(false)
        }}
      >
        {(shut) =>
          confirming && !phone ? (
            panel
          ) : (
            <MenuItem
              onClick={() => {
                setConfirming(true)
                if (phone) shut()
              }}
            >
              Archive this trak
            </MenuItem>
          )
        }
      </OverflowMenu>
      {sheet}
    </>
  )
}

/**
 * The desk's ending cell while a pull request is open: auto-merge's switch, the split press,
 * then the `⋯` holding Archive. A phone draws the first two above the row and keeps the `⋯`.
 */
const PullMergeActs = ({
  pull,
  merging,
  methodPick,
  archiving,
  scope,
  phone,
  autoMerge,
}: {
  readonly pull: PullMerge
  readonly merging: PullMerging
  readonly methodPick: MergeMethodPick
  readonly archiving: Archiving
  readonly scope: string
  readonly phone: boolean
  readonly autoMerge: AutoMergeOffer | undefined
}): ReactNode => (
  <span className="flex min-w-0 items-center gap-2">
    {!phone && autoMerge !== undefined && (
      <AutoMergePress
        on={autoMerging(autoMerge.value)}
        disabled={autoMerge.setting.disabled}
        onToggle={autoMerge.setting.set}
        block={false}
      />
    )}
    {!phone && (
      <MergeSplit
        pull={pull}
        merging={merging}
        methodPick={methodPick}
        block={false}
        phone={false}
      />
    )}
    <span className="shrink-0">
      <ArchiveActs
        promoted={false}
        archiving={archiving}
        scope={scope}
        block={false}
        phone={phone}
      />
    </span>
  </span>
)

/**
 * The right-hand cell, drawn from `endingCell`. The ghost is `busy` and `disabled` so it
 * reads as a press that is not yet one, in the same place and at the same height as the
 * press it becomes.
 */
const Ending = ({
  cell,
  merge,
  pull,
  pullMerging,
  methodPick,
  destination,
  conflicts,
  archiving,
  scope,
  phone,
  autoMerge,
}: {
  readonly cell: EndingCell
  readonly merge: Merge
  readonly pull: PullMerge | undefined
  readonly pullMerging: PullMerging
  readonly methodPick: MergeMethodPick
  readonly destination: string | undefined
  readonly conflicts: boolean | undefined
  readonly archiving: Archiving
  readonly scope: string
  readonly phone: boolean
  readonly autoMerge: AutoMergeOffer | undefined
}): ReactNode => {
  switch (cell) {
    case "checking":
      return (
        <Button variant="ghost" busy disabled block={phone}>
          {phone ? "Checking…" : "Checking GitHub…"}
        </Button>
      )
    case "mergePull":
      // `endingCell` answers this only where `pullMergeOf` has an answer; `undefined` is the
      // moment the pane's answer is replaced, and draws what that moment is. On a phone the
      // press stands above the row, so the cell is the `⋯` either way.
      if (pull === undefined) {
        return phone ? (
          <ArchiveActs
            promoted={false}
            archiving={archiving}
            scope={scope}
            block={false}
            phone={phone}
          />
        ) : (
          <CheckingPress block={false} />
        )
      }
      return (
        <PullMergeActs
          pull={pull}
          merging={pullMerging}
          methodPick={methodPick}
          archiving={archiving}
          scope={scope}
          phone={phone}
          autoMerge={autoMerge}
        />
      )
    case "merge":
      return (
        <Button
          icon={GitMerge}
          busy={merge.isPending}
          disabled={merge.disabled}
          block={phone}
          onClick={merge.merge}
        >
          {mergeLabel(destination, conflicts, phone)}
        </Button>
      )
    case "archive":
      return (
        <ArchiveActs promoted archiving={archiving} scope={scope} block={phone} phone={phone} />
      )
    case "menu":
      return (
        <ArchiveActs
          promoted={false}
          archiving={archiving}
          scope={scope}
          block={false}
          phone={phone}
        />
      )
    case "none":
      return null
  }
}

/** What the row and the box are drawn from. */
interface FinishedActsProps {
  /** What the right-hand cell holds — `endingCell`, the one part of the row that changes. */
  readonly cell: EndingCell
  /** Whether the state takes more work — `changesOffered`. It draws the doors and gates the
   *  box, whatever has been ticked. */
  readonly doors: boolean
  /** Whether the branch is in — the forge says merged, or a wait found it landed. With
   *  `moved` and `waiting` it decides what Archive's panel says. */
  readonly merged: boolean
  readonly moved: boolean
  readonly waiting: boolean
  /** What stands where the presses would be, at a state that offers none. `endingWords`. */
  readonly instead: string | undefined
  /** What the merge button names, or `undefined` until the preview answers. */
  readonly destination: string | undefined
  /** Whether that merge would conflict — `undefined` until the preview answers. */
  readonly conflicts: boolean | undefined
  /** The mark the ask door's agent wears, resolved off the wire by `FinishedView` — the
   *  fallback while the agents query is out, which is what `agentGlyph` promises. */
  readonly askGlyph: LucideIcon
  readonly merge: Merge
  /** The open pull request the forge merge press is drawn from — `pullMergeOf`. */
  readonly pull: PullMerge | undefined
  readonly pullMerging: PullMerging
  /** The method menu on the forge merge press — `useSetMergeMethod`. */
  readonly methodPick: MergeMethodPick
  /** Auto-merge's switch, drawn beside the forge merge press and nowhere else — `undefined`
   *  on a trak that cannot take it. */
  readonly autoMerge: AutoMergeOffer | undefined
  /** Whether the pane has already drawn the merge's refusal above the card — a child's
   *  dirty parent, on the plate that carries the press through it. */
  readonly refusedAbove: boolean
  readonly archiving: Archiving
  readonly changes: Changes
  /** What was ticked on the pull-request half above, listed in the box and sent with it. */
  readonly picked: readonly Picked[]
  readonly onRemove: (key: string) => void
  /** Removes every tick — the box's *Clear*. */
  readonly onClear: () => void
  /** Below the seam: three equal cells and the short labels. */
  readonly phone: boolean
}

/** The two doors, each disabled while its own box is the open one. */
const DoorPresses = ({
  open,
  glyph,
  disabled,
  phone,
  onOpen,
}: {
  readonly open: Door | undefined
  readonly glyph: LucideIcon
  readonly disabled: boolean
  readonly phone: boolean
  readonly onOpen: (door: Door) => void
}): ReactNode => (
  <>
    <Button
      variant="quiet"
      icon={MessageSquarePlus}
      block={phone}
      disabled={open === "plan" || disabled}
      onClick={() => {
        onOpen("plan")
      }}
    >
      {phone ? "More work" : "More work on it"}
    </Button>
    <Button
      variant="quiet"
      icon={glyph}
      block={phone}
      disabled={open === "ask" || disabled}
      onClick={() => {
        onOpen("ask")
      }}
    >
      {phone ? "Ask" : "Ask about it"}
    </Button>
  </>
)

const FinishedActs = ({
  cell,
  doors,
  merged,
  moved,
  waiting,
  instead,
  askGlyph,
  merge,
  pullMerging,
  refusedAbove,
  changes,
  picked,
  onRemove,
  onClear,
  phone,
  // What only the ending cell reads — and `autoMerge`, which the line above the row reads too.
  ...ending
}: FinishedActsProps): ReactNode => {
  const [asking, setAsking] = useState<Door | undefined>(undefined)
  const door = doorOf(doors, asking, picked)
  // A phone's box stands in the row's place, and so in place of what stands above the row.
  const row = !phone || door === undefined

  // Never an empty space where buttons were: a state with nothing on offer says so.
  if (cell === "none" && !doors)
    return instead === undefined ? null : (
      <FinishedFoot>
        <p className="text-sm text-fg-subtle">{instead}</p>
      </FinishedFoot>
    )

  return (
    <FinishedFoot>
      <div className="flex flex-col gap-3">
        {door !== undefined && (
          <OpenBox
            door={door}
            glyph={askGlyph}
            changes={changes}
            picked={picked}
            onRemove={onRemove}
            taken={asking !== undefined}
            onShut={() => {
              setAsking(undefined)
            }}
            onClear={onClear}
            phone={phone}
          />
        )}
        <Refused said={door === undefined ? undefined : changes.said} files={[]} />
        {row && cell === "merge" && !refusedAbove && (
          <Refused said={merge.said} files={merge.files} />
        )}
        {row && cell === "mergePull" && (
          <PullMergeAbove
            said={pullMerging.said}
            pull={ending.pull}
            merging={pullMerging}
            methodPick={ending.methodPick}
            autoMerge={ending.autoMerge}
            phone={phone}
          />
        )}
        {/* Three equal cells below the seam, so three presses always fit one line; at desk
            each press hugs its label and the spacer pushes the ending to the right edge.
            `relative` is the loud Archive's confirmation's containing block. */}
        {row && (
          <div className="relative grid grid-cols-3 gap-2 sm:flex sm:items-center">
            {doors && (
              <DoorPresses
                open={door}
                glyph={askGlyph}
                disabled={changes.disabled}
                phone={phone}
                onOpen={setAsking}
              />
            )}
            <span className="hidden flex-1 sm:block" />
            <span className="col-start-3 flex min-w-0 justify-end">
              <Ending
                {...ending}
                cell={cell}
                merge={merge}
                pullMerging={pullMerging}
                scope={archiveScope(merged, moved, waiting)}
                phone={phone}
              />
            </span>
          </div>
        )}
      </div>
    </FinishedFoot>
  )
}

export default FinishedActs
