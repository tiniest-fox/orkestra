/**
 * The trak's run mode, read out and changeable, with the two one-shots and auto-merge at the
 * foot of it.
 *
 * **A readout you press, which names the current mode and opens the panel that changes
 * it.** The control sits in the header band, with the hold under the same press rather than
 * beside it: the mode's mark and name on a quiet button with a
 * chevron, a radio row per mode with a phrase beside each name and the chosen one in the accent
 * with a check, and the hold in a recessed foot behind a switch.
 *
 * **Exactly one of these is on screen, and it belongs to whichever trak owns the step being
 * read.** On the trak's own steps it is in the header; standing on a spawn's piece it is in
 * `PieceBand` and the header carries none. The page decides which; this file draws one.
 *
 * **On `manual` the hold is not offered, and the skip row keeps the foot.** Every step
 * is already held until a person accepts it, so a hold promises exactly what is happening — and
 * the engine clears a pending hold as the mode is set there, so coming back to `smart` is a
 * fresh decision. Structural rather than a disabled row, which is the tell that it is a rule.
 * The same while a spawn runs — `holdable`, from `holdOffered` — because a spawn has no gate
 * on any mode, and a switch reading *Hold · this step* would name a step that cannot be held.
 * The skip is the other way about: every mode runs its checks, so it is offered on all four
 * and withheld only where no check run is ahead — `skippable`, from `skipChecksOffered`.
 *
 * **The one-shots are switches and the modes are a radio group, because they are different
 * things.** Exactly one mode is true and a check says *this is the one*; each switch is on or
 * off beside any of them. The whole row is the press — `Switch` is 26×16 and says so.
 *
 * **Pending, the readout carries `HOLD` on a filled plate after the name**, the app's move for
 * a label that is not prose, and the mark appears in both places at once so a reader meets the
 * same glyph reading the header and pressing the row. Below the breakpoint the plate is the
 * mark alone, square, which buys the title back 33px at 358 — cosmetic, so a `max-sm:` variant
 * rather than a `usePhone` branch. The word survives in the row's own name and in the readout's
 * `aria-label`. **An armed skip wears the same plate**, apart from the hold's rather than
 * combined with it — a combined plate saves room on the desk and almost none on the phone,
 * which is where the room is actually short. Its word is *skip checks* and cannot shorten: a
 * bare *Skip* is the gate action meaning *enter the next step with nothing filed*. So the word
 * goes below the breakpoint, where the hold's does.
 *
 * **Armed, the foot names what will not run**, off `nextChecks` — the wire carries the names
 * because which scripts a step runs is `.orkestra/` policy the screen cannot see — and on
 * `auto` and `decider` says the one extra thing that is true there: the step is accepted with
 * nobody reading it.
 *
 * **Auto-merge is a third switch in the foot, after the one-shots, and wears their plate**
 * — it is a setting that lasts rather than one spent on the next step, but it is drawn as the shape
 * already there: while on, a filled plate with the merge mark and *merge* after the mode
 * name. Stopped, the switch is off, the phrase says *stopped*, and a line under the row
 * gives the cause and what to do. It is offered on a trak that is not a piece, wherever it
 * is not archived — `Finished` included, where no mode is offered, so the readout names
 * auto-merge instead and the panel holds that one row.
 *
 * **A refusal reads beside the readout**, the shape `GatePresses` uses: what is on screen
 * is still true, and the same press is what a person reaches for again. Whichever of the
 * four hooks last refused is the one that speaks; they never refuse on the same press.
 */

import type { ReactNode } from "react"
import { Check, GitMerge, Hand, type LucideIcon, ShieldOff } from "lucide-react"
import type { AutoMergeDto, RunModeDto } from "../../../api/types"
import MenuItem from "../../../components/MenuItem"
import OverflowMenu from "../../../components/OverflowMenu"
import Switch from "../../../components/Switch"
import { MODE_WORDS, MODES } from "../../../format/runMode"
import { autoMergeNotice, autoMergePhrase, autoMerging } from "../autoMerge"
import { listed } from "../checks/check"
import type { PickerSettings } from "./usePickerSettings"

/** Auto-merge's own mark — New Trak's switch wears the same glyph. */
const MergeMark = ({ size }: { readonly size: number }): ReactNode => (
  <GitMerge size={size} strokeWidth={2.5} aria-hidden className="shrink-0" />
)

/** The hold's own mark, drawn the same everywhere it appears. */
const HoldMark = ({ size }: { readonly size: number }): ReactNode => (
  <Hand size={size} strokeWidth={2.5} aria-hidden className="shrink-0" />
)

/**
 * The skip's own mark, at `HoldMark`'s weight so the two read as one family. An open
 * path on purpose: every candidate's whole meaning is the thing cut through it, and a
 * fill would swallow the slash.
 */
const SkipMark = ({ size }: { readonly size: number }): ReactNode => (
  <ShieldOff size={size} strokeWidth={2.5} aria-hidden className="shrink-0" />
)

/** A pending mark on the readout: the plate, or the mark alone below the breakpoint. */
const Pending = ({
  mark,
  word,
}: {
  readonly mark: ReactNode
  readonly word: string
}): ReactNode => (
  <span className="flex h-[21px] shrink-0 items-center justify-center gap-1 rounded-pill bg-accent px-1.5 text-2xs font-bold uppercase tracking-wider text-accent-ink max-sm:w-[21px] max-sm:px-0">
    {mark}
    <span className="max-sm:hidden">{word}</span>
  </span>
)

/** One mode's row: its mark, its name, its phrase, and a check where it is the one. */
const ModeRow = ({
  mode,
  chosen,
  onPick,
}: {
  readonly mode: RunModeDto
  readonly chosen: boolean
  readonly onPick: () => void
}): ReactNode => {
  const { name, phrase, mark: Mark } = MODE_WORDS[mode]
  return (
    <MenuItem role="menuitemradio" checked={chosen} onClick={onPick}>
      <span className="flex items-center gap-1.5">
        {/* Every mark takes the same box, so the panel's left edge does not zig-zag. */}
        <span className="flex size-[21px] shrink-0 items-center justify-center">
          <Mark size={13} aria-hidden className={chosen ? "text-accent" : "text-fg-subtle"} />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className={`whitespace-nowrap ${chosen ? "font-medium text-accent" : ""}`}>
            {name}
          </span>
          <span className="min-w-0 truncate text-sm text-fg-subtle">{phrase}</span>
        </span>
        {chosen && <Check size={13} aria-hidden className="shrink-0 text-accent" />}
      </span>
    </MenuItem>
  )
}

/**
 * A one-shot's row, shaped like a mode's — a name that carries the weight and a phrase
 * beside it that does not. On, only the name changes tense.
 */
const SwitchRow = ({
  on,
  mark,
  name,
  phrase,
  onPress,
}: {
  readonly on: boolean
  readonly mark: ReactNode
  readonly name: string
  readonly phrase: string
  readonly onPress: () => void
}): ReactNode => (
  <MenuItem role="menuitemcheckbox" checked={on} onClick={onPress}>
    <span className="flex items-center gap-1.5">
      <span
        className={`flex size-[21px] shrink-0 items-center justify-center ${on ? "text-accent" : "text-fg-subtle"}`}
      >
        {mark}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className={`whitespace-nowrap font-medium ${on ? "text-accent" : ""}`}>{name}</span>
        <span className="min-w-0 truncate text-sm text-fg-subtle">{phrase}</span>
      </span>
      <Switch on={on} />
    </span>
  </MenuItem>
)

/**
 * What an armed skip means in words: the script that will not run, and on `auto` and `decider`
 * — which take a document nobody read — the consequence. Where the next step declares none, the
 * switch waits — the engine spends it only on a run with something to skip — and the sentence
 * says so.
 */
const consequence = (mode: RunModeDto, nextChecks: readonly string[]): string => {
  if (nextChecks.length === 0)
    return "The next step declares no checks; the first that does will not run them."
  const named = `${listed(nextChecks)} will not run on the next step.`
  return mode === "auto" || mode === "decider"
    ? `${named} It is accepted with nobody reading it.`
    : named
}

/** Auto-merge's switch, and while it is stopped the line under it that says why. */
interface MergeRow {
  readonly autoMerge: AutoMergeDto | undefined
  readonly onPress: () => void
}

/**
 * Auto-merge's row — the third switch, drawn as the one-shots are though it is a setting
 * that lasts. Off while stopped, so the press that starts it afresh is the one a person
 * reaches for; the line under it is the cause and what to do, in the armed skip's voice.
 */
const AutoMergeRow = ({ autoMerge, onPress }: MergeRow): ReactNode => {
  const on = autoMerging(autoMerge)
  const notice = autoMergeNotice(autoMerge)
  return (
    <>
      <SwitchRow
        on={on}
        mark={<MergeMark size={13} />}
        name={on ? "Auto-merging" : "Auto-merge"}
        phrase={autoMergePhrase(autoMerge)}
        onPress={onPress}
      />
      {notice?.waiting === true && (
        <span className="px-2 pb-1.5 pt-0.5 text-sm text-tone-waiting">{notice.text}</span>
      )}
    </>
  )
}

/**
 * The panel's recessed floor and what stands on it. The foot is the rows' own ground
 * moved: it runs to the panel's bottom corners and takes its radius, so the one-shots stop
 * being the last items in a list and become the floor. The negative margins undo the
 * panel's `p-1`; the 6px above is the air between. With no mode rows above it — at
 * `Finished` — it is the whole panel, and takes every corner.
 */
const Foot = ({
  hold,
  skip,
  merge,
  mode,
  nextChecks,
  alone,
}: {
  /** The hold's row, or nothing where the hold is not offered. */
  readonly hold: { readonly holding: boolean; readonly onPress: () => void } | undefined
  /** The skip's row, or nothing where no check run is ahead. */
  readonly skip: { readonly skipping: boolean; readonly onPress: () => void } | undefined
  /** Auto-merge's row, or nothing where it is not offered. */
  readonly merge: MergeRow | undefined
  readonly mode: RunModeDto
  readonly nextChecks: readonly string[]
  /** No mode rows above: the foot is the panel. */
  readonly alone: boolean
}): ReactNode =>
  hold === undefined && skip === undefined && merge === undefined ? undefined : (
    <span
      className={`-mx-1 -mb-1 flex flex-col bg-surface-2 px-1 pb-1 ${alone ? "-mt-1 rounded-surface pt-1" : "mt-1.5 rounded-b-surface"}`}
    >
      {hold === undefined ? undefined : (
        <SwitchRow
          on={hold.holding}
          mark={<HoldMark size={13} />}
          name={hold.holding ? "Holding" : "Hold"}
          phrase="this step"
          onPress={hold.onPress}
        />
      )}
      {skip === undefined ? undefined : (
        <SwitchRow
          on={skip.skipping}
          mark={<SkipMark size={13} />}
          name={skip.skipping ? "Skipping checks" : "Skip checks"}
          phrase="the next step"
          onPress={skip.onPress}
        />
      )}
      {/* Inside the recess and only while armed, so the panel at rest is the panel that
          shipped before the switch existed. */}
      {skip?.skipping === true && (
        <span className="px-2 pb-1.5 pt-0.5 text-sm text-tone-waiting">
          {consequence(mode, nextChecks)}
        </span>
      )}
      {merge === undefined ? undefined : <AutoMergeRow {...merge} />}
    </span>
  )

/**
 * The readout at `Finished`, where no mode is offered and auto-merge is the panel's one
 * row: its mark, and the word with its state beside it — the state in the accent while on.
 *
 * **Below the breakpoint the words go, as the plates' do**, because the header's title is
 * the only thing in that row that can give way, and *Auto-merge on* cut it to two letters at
 * 390px. Off is the bare mark; on adds the filled plate, square and mark-only there. The
 * person chose that over keeping *on* and *off* as words, knowing off is told from on only by
 * the fill. The label still says it in words.
 */
const MergeFace = ({ on }: { readonly on: boolean }): ReactNode => (
  <>
    <span className="whitespace-nowrap max-sm:hidden">
      Auto-merge <span className={on ? "text-accent" : "text-fg-subtle"}>{on ? "on" : "off"}</span>
    </span>
    {on && (
      <span className="flex sm:hidden">
        <Pending mark={<MergeMark size={13} />} word="merge" />
      </span>
    )}
  </>
)

/**
 * The readout: the mode's mark and name with a plate for each thing pending or standing
 * beside it — or, where no mode is offered, auto-merge's mark and state alone. The label
 * says the same in words, since everything inside the trigger is `aria-hidden`.
 */
const readoutOf = (
  mode: RunModeDto | undefined,
  holding: boolean,
  armed: boolean,
  merging: boolean,
): { readonly label: string; readonly icon: LucideIcon; readonly face: ReactNode } => {
  if (mode === undefined)
    return {
      label: `Auto-merge: ${merging ? "on" : "off"}`,
      icon: GitMerge,
      face: <MergeFace on={merging} />,
    }
  const { name, mark } = MODE_WORDS[mode]
  return {
    label: `Run mode: ${name}${holding ? ", holding this step" : ""}${
      armed ? ", skipping checks on the next step" : ""
    }${merging ? ", auto-merging" : ""}`,
    icon: mark,
    face: (
      <>
        <span>{name}</span>
        {holding && <Pending mark={<HoldMark size={13} />} word="hold" />}
        {armed && <Pending mark={<SkipMark size={13} />} word="skip checks" />}
        {merging && <Pending mark={<MergeMark size={13} />} word="merge" />}
      </>
    ),
  }
}

const RunModePicker = ({
  mode,
  modes,
  holding,
  holdable,
  skipping,
  skippable,
  nextChecks,
  autoMerge,
  settings,
}: {
  readonly mode: RunModeDto
  /** Whether the trak has a next gate for a mode to decide — `modeSettable`. Without one,
   *  only auto-merge is offered, and the readout reads it out instead of the mode. */
  readonly modes: boolean
  readonly holding: boolean
  /** Whether the state has a step a hold can hold — `holdOffered`. */
  readonly holdable: boolean
  readonly skipping: boolean
  /** Whether a check run is ahead for the skip to arm — `skipChecksOffered`. */
  readonly skippable: boolean
  /** The names the foot says will not run — `TrakDetailDto.nextChecks`. */
  readonly nextChecks: readonly string[]
  /** `TrakDetailDto.autoMerge` where the switch is offered — `autoMergeSettable`, on a trak
   *  that is not a piece — and `false` where it is not. */
  readonly autoMerge: AutoMergeDto | undefined | false
  readonly settings: PickerSettings
}): ReactNode => {
  const { setting, hold, skip } = settings
  // On `manual` every gate is stood at, so the one-shot promises nothing new — not on the
  // readout, not in the panel. At a spawn there is no step to hold, for the same
  // structural answer. The skip has no such clamp. Neither is offered where no mode is.
  const offered = modes && mode !== "manual" && holdable
  const armed = modes && skipping && skippable
  const merging = autoMerge !== false && autoMerging(autoMerge)
  const said = hold.said ?? skip.said ?? setting.said ?? settings.autoMerge.said
  return (
    <>
      {/* Capped, because it sits in the header's group and nothing there may grow —
          `TrakHeader` says why: the title is the only elastic thing in that row. */}
      {said === undefined ? undefined : (
        <span
          role="alert"
          className="max-w-56 min-w-0 truncate text-sm text-tone-bad max-sm:max-w-28"
        >
          {said}
        </span>
      )}
      <OverflowMenu {...readoutOf(modes ? mode : undefined, holding && offered, armed, merging)}>
        {(shut) => (
          <>
            {modes &&
              MODES.map((m) => (
                <ModeRow
                  key={m}
                  mode={m}
                  chosen={m === mode}
                  onPick={() => {
                    setting.set(m)
                    shut()
                  }}
                />
              ))}
            <Foot
              mode={mode}
              nextChecks={nextChecks}
              alone={!modes}
              hold={
                offered
                  ? {
                      holding,
                      onPress: () => {
                        hold.set(!holding)
                        shut()
                      },
                    }
                  : undefined
              }
              skip={
                modes && skippable
                  ? {
                      skipping,
                      onPress: () => {
                        skip.set(!skipping)
                        shut()
                      },
                    }
                  : undefined
              }
              merge={
                autoMerge === false
                  ? undefined
                  : {
                      autoMerge,
                      onPress: () => {
                        settings.autoMerge.set(!merging)
                        shut()
                      },
                    }
              }
            />
          </>
        )}
      </OverflowMenu>
    </>
  )
}

export default RunModePicker
