/**
 * One goal gate as a trak card: the drafted file, the proposed traks, the composer's
 * question, the work it asked for by hand (`ActionCard`) or the proposed done, in the trak screen's own `CardShell` and `QuestionsCard`.
 * The Chat tab draws it in place of the move's call row, the one place a person answers a
 * gate, pressing through the `GoalAct` the page holds.
 *
 * **Only a live card has presses, and only a live card is open.** `live` is the caller's
 * `asksNow`; an earlier draft, plan or done stays in the thread folded to one line, and
 * opens on a press of its header. An earlier question is `QuestionsCard`'s settled record.
 *
 * **No goal framing.** These cards carry no person's sentence, file path, plan note or
 * escalated trak.
 *
 * **A sub-goal's done card says where Confirm merges**, where its parent has a goal branch:
 * the press reads `Confirm and merge`, and a mono line under the head names
 * `<its branch> → <parent's branch>`, in the bad ink once a merge was refused for a
 * conflict, so the press itself says what it does. A plan that proposes sub-goals lists them
 * first, each spec whole, then its traks.
 *
 * **Approve, an answer and a report spend**: each owes the composer a turn. Confirm does
 * not. Asking for another draft, or another plan, is a message in the chat bar below.
 */

import { FileText, Flag, ListTree, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"
import type { GoalDto } from "../../../api/types"
import Markdown from "../../../components/Markdown"
import { plainText } from "../../../format/markdown"
import CardShell from "../../trak-detail/cards/CardShell"
import type { Answered } from "../../trak-detail/filed"
import QuestionsCard from "../../trak-detail/cards/questions/QuestionsCard"
import DraftBranch from "../DraftBranch"
import DraftFile from "../DraftFile"
import DraftSettings from "../DraftSettings"
import { limitsOf, sameSettings, type Settings, settingsOf } from "../settings"
import PlannedRow from "../PlannedRow"
import type { GoalAct } from "../useGoalAct"
import ActionCard from "./ActionCard"
import SubgoalProposedRow from "../SubgoalProposedRow"
import { answeringOf, type CardAsk, type DoneMerge, type GateAsk } from "./gate"
import GatePresses from "./GatePresses"

const ICON: Record<CardAsk["_tag"], LucideIcon> = {
  file: FileText,
  plan: ListTree,
  done: Flag,
}

const head = (ask: CardAsk): string => {
  switch (ask._tag) {
    case "file":
      return "Drafted goal file"
    case "plan": {
      const traks = `${String(ask.traks.length)} ${ask.traks.length === 1 ? "trak" : "traks"}`
      const n = ask.subgoals.length
      return n === 0
        ? `Proposed ${traks}`
        : `Proposed ${String(n)} ${n === 1 ? "sub-goal" : "sub-goals"} · ${traks}`
    }
    case "done":
      return "Proposed done"
  }
}

/** What a folded card says on its header line. */
const summary = (ask: CardAsk): string => {
  switch (ask._tag) {
    case "file":
      return ask.draft.title
    case "plan":
      return [...ask.subgoals, ...ask.traks].map((t) => t.title).join(" · ")
    case "done":
      return plainText(ask.summary)
  }
}

const LIST =
  "flex min-w-0 flex-col overflow-hidden rounded-surface border border-border bg-surface [&>li+li]:border-t [&>li+li]:border-border"

const Label = ({ children }: { readonly children: string }): ReactNode => (
  <span className="font-mono text-2xs uppercase tracking-wider text-fg-subtle">{children}</span>
)

const Body = ({
  ask,
  settings,
  branch,
  merge,
  conflicted,
}: {
  readonly ask: CardAsk
  /** The drafted file's settings and goal branch, which only the file's card draws. */
  readonly settings: ReactNode
  readonly branch: ReactNode
  readonly merge: DoneMerge | undefined
  readonly conflicted: boolean
}): ReactNode => {
  switch (ask._tag) {
    case "file":
      return <DraftFile draft={ask.draft} settings={settings} branch={branch} />
    case "plan": {
      const traks = (
        <ul className={LIST}>
          {ask.traks.map((t, i) => (
            <PlannedRow
              // oxlint-disable-next-line react/no-array-index-key -- a plan is positional, with no id on the wire
              key={i}
              title={t.title}
              mode={t.mode}
              line={t.description}
              look="proposed"
            />
          ))}
        </ul>
      )
      if (ask.subgoals.length === 0) return traks
      return (
        <div className="flex min-w-0 flex-col gap-3">
          <Label>Sub-goals</Label>
          <ul className={LIST}>
            {ask.subgoals.map((sub) => (
              <SubgoalProposedRow key={sub.title} sub={sub} />
            ))}
          </ul>
          {ask.traks.length > 0 && <Label>Traks</Label>}
          {ask.traks.length > 0 && traks}
        </div>
      )
    }
    case "done":
      return (
        <div className="flex min-w-0 flex-col gap-3">
          {merge !== undefined && (
            <span
              className={`truncate font-mono text-2xs ${conflicted ? "text-tone-bad" : "text-fg-subtle"}`}
            >
              {`${merge.from} → ${merge.into}`}
            </span>
          )}
          <div className="min-w-0 text-base text-fg">
            <Markdown>{ask.summary}</Markdown>
          </div>
        </div>
      )
  }
}

const GateCard = ({
  ask,
  live,
  offers,
  act,
  answer,
  merge,
  phone,
}: {
  readonly ask: GateAsk
  /** The goal stands at this gate now — `asksNow`. */
  readonly live: boolean
  readonly offers: GoalDto["offers"]
  readonly act: GoalAct
  /** What a person answered an earlier escalation, for its settled record. */
  readonly answer: Answered | undefined
  /** Where Confirm done merges, on a sub-goal whose parent has a goal branch. */
  readonly merge: DoneMerge | undefined
  readonly phone: boolean
}): ReactNode => {
  const [open, setOpen] = useState(false)
  // Kept beside the draft it was made on: a redraft with other settings starts over.
  const [edited, setEdited] = useState<{ readonly on: Settings; readonly to: Settings }>()
  const [renamed, setRenamed] = useState<{ readonly on: string; readonly to: string }>()
  if (ask._tag === "escalation")
    return (
      <QuestionsCard
        head="The composer asks"
        questions={{ type: "questions", questions: ask.questions }}
        answering={live && offers.includes("Answer") ? answeringOf(act) : undefined}
        {...(answer === undefined ? {} : { answered: answer })}
      />
    )
  if (ask._tag === "action")
    return <ActionCard request={ask.request} live={live} offers={offers} act={act} />
  const shown = live || open
  const drafted = ask._tag === "file" ? settingsOf(ask.draft.limits) : undefined
  const settings =
    drafted !== undefined && edited !== undefined && sameSettings(edited.on, drafted)
      ? edited.to
      : drafted
  const draftedBranch = ask._tag === "file" ? (ask.draft.branch ?? "") : undefined
  const branch =
    draftedBranch !== undefined && renamed !== undefined && renamed.on === draftedBranch
      ? renamed.to
      : draftedBranch
  return (
    <CardShell
      icon={ICON[ask._tag]}
      head={head(ask)}
      {...(live
        ? {}
        : {
            open,
            onToggle: () => {
              setOpen(!open)
            },
            summary: open ? undefined : summary(ask),
          })}
      actions={
        live ? (
          <GatePresses
            ask={ask}
            offers={offers}
            act={act}
            limits={settings === undefined ? undefined : limitsOf(settings)}
            branch={branch?.trim()}
            merges={merge !== undefined}
          />
        ) : undefined
      }
    >
      {shown ? (
        <Body
          ask={ask}
          merge={merge}
          conflicted={act.refused === "SubgoalConflicted"}
          settings={
            drafted === undefined || settings === undefined ? undefined : (
              <DraftSettings
                drafted={drafted}
                settings={settings}
                onChange={live ? (to) => setEdited({ on: drafted, to }) : undefined}
                phone={phone}
              />
            )
          }
          branch={
            draftedBranch === undefined || branch === undefined ? undefined : (
              <DraftBranch
                drafted={draftedBranch}
                branch={branch}
                onChange={live ? (to) => setRenamed({ on: draftedBranch, to }) : undefined}
              />
            )
          }
        />
      ) : undefined}
    </CardShell>
  )
}

export default GateCard
