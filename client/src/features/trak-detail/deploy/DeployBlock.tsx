/**
 * The deploy, as one block above the ending card: what `deploy.sh` says about the merge
 * commit now, and the steps that are waiting on it.
 *
 * **One block, leading with the deploy's current state — unless the wait has stopped
 * asking.** The person asked for exactly that over a second block about the condition:
 * whether the deploy failed is the more interesting fact than the script's output, so the
 * head is the answer word, the version in mono, and a rocket on a plate in the answer's
 * tone. A stopped wait is the one thing that beats the answer: nothing will start the
 * held step, whatever the deploy has since said, so the head reads *Gave up* in `bad` as
 * the list row does — `headWords` carries why. What waits on it is a section
 * under the fields, drawn in the proposal card's own tiles — the form a person approved
 * those steps in — so the block replaces `HeldCard` while a step is held on `deployed`
 * rather than standing beside it.
 *
 * **The rows are the pull request card's rows.** Detail, Link, Last asked and Output, each
 * a label column and a value under a rule, so a deploy reads as the card beneath it does.
 * Leftover output is shown open, as a mono block behind a show/hide press — and always
 * open where the script wrote no JSON line, since the text is then the whole answer.
 *
 * **The loading states are the pull request card's, not this block's own.** Before the
 * route answers, `CheckingLine` stands where the head will be; while it is re-asked over
 * an answer already drawn, `Rechecking` travels the top edge. The hairline draws on every
 * re-ask here where the card withholds it once confirmed, because each poll may run the
 * script again and a deploy's status is a fact about a world that moves — the line is the
 * one honest sign that it is being asked.
 *
 * **The countdown sits in the corner while the deploy is not live**, at the held card's
 * own measurements and for its reason: the head line's size, labelled, never a larger
 * numeral. Gone at a stopped wait, gone where nothing is scheduled, and gone once the
 * deploy is live — the step starts on the next sweep and there is nothing left to count to.
 *
 * **The press that skips the wait sits beside it, wherever a step is held.** A step held
 * on `deployed` draws no held card, so the press the held card carries is drawn here
 * too, in the same place: the head row, small and quiet. `SkipPress` is the one press,
 * drawn twice — the cost of putting it in the wait's own block rather than at the pane's
 * foot.
 */

import type { ReactNode } from "react"
import { useState } from "react"
import { ExternalLink, Rocket } from "lucide-react"
import type { AgentDto, PlanDto, WaitingDto } from "../../../api/types"
import Plate from "../../../components/Plate"
import { toneInk } from "../../../format/tone"
import CheckingLine from "../checks/CheckingLine"
import { headWords, heldEntries, heldHead, shownUrl, type DeployAnswer } from "./deploy"
import PlanStep from "../cards/plan/PlanStep"
import { agoWords } from "../pull-request/pullRequest"
import Rechecking from "../checks/Rechecking"
import { entryMark, entryName } from "../family/rows"
import SkipPress from "../waits/SkipPress"
import { useCountdown } from "../waits/useCountdown"
import type { Skipping } from "../waits/useSkipWait"
import { spellLeft } from "../waits/waiting"

/** One row of the block's table, in the pull request card's own row shape. */
const Row = ({
  label,
  children,
}: {
  readonly label: string
  readonly children: ReactNode
}): ReactNode => (
  <div className="flex min-w-0 items-baseline gap-3 border-t border-border px-4 py-2.5">
    <span className="w-20 shrink-0 text-2xs font-medium uppercase tracking-wide text-fg-subtle">
      {label}
    </span>
    <span className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm text-fg-muted">{children}</span>
  </div>
)

/** The one way out to the deploy, with the address read without its scheme. It clears
 *  the touch floor below the breakpoint, because it is the block's one press that leaves. */
const DeployLink = ({ url }: { readonly url: string }): ReactNode => (
  <a
    href={url}
    target="_blank"
    rel="noreferrer"
    className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-control text-fg-muted hover:text-fg max-sm:min-h-11"
  >
    <span className="min-w-0 truncate">{shownUrl(url)}</span>
    <ExternalLink size={11} aria-hidden className="shrink-0" />
  </a>
)

/**
 * Everything the script printed beside its JSON line. Open by default and behind a press
 * only where there are fields — with no fields the text is the whole answer and hiding it
 * would be hiding the deploy.
 */
const Output = ({ text, bare }: { readonly text: string; readonly bare: boolean }): ReactNode => {
  const [open, setOpen] = useState(true)
  return (
    <>
      {!bare && (
        <span>
          <button
            type="button"
            onClick={() => {
              setOpen((was) => !was)
            }}
            className="inline-flex items-center rounded-control font-mono text-2xs text-fg-subtle hover:text-fg max-sm:min-h-11 max-sm:min-w-11"
          >
            {open ? "hide output" : "show output"}
          </button>
        </span>
      )}
      {(bare || open) && (
        <pre className="min-w-0 overflow-x-auto whitespace-pre-wrap break-words rounded-control bg-surface-2 px-3 py-2 font-mono text-2xs leading-4 text-fg-muted">
          {text}
        </pre>
      )}
    </>
  )
}

/** The rows under the head, in the order a reader wants them: what, where, when, and
 *  then everything else the script had to say. */
const Fields = ({
  answer,
  now,
}: {
  readonly answer: DeployAnswer
  readonly now: number
}): ReactNode => {
  const bare =
    answer.url === undefined && answer.version === undefined && answer.detail === undefined
  return (
    <div className="flex min-w-0 flex-col">
      {answer.detail !== undefined && (
        <Row label="Detail">
          <span className="break-words">{answer.detail}</span>
        </Row>
      )}
      {answer.url !== undefined && (
        <Row label="Link">
          <DeployLink url={answer.url} />
        </Row>
      )}
      <Row label="Last asked">
        <span className="font-mono text-2xs">{agoWords(answer.at, now)}</span>
      </Row>
      {answer.text !== "" && (
        <Row label="Output">
          <Output text={answer.text} bare={bare} />
        </Row>
      )}
    </div>
  )
}

/** The head: the plate, the `Deploy` label, the answer and the version, the corner, and
 *  the press where a step is held. */
const Head = ({
  answer,
  stopped,
  left,
  skipping,
}: {
  readonly answer: DeployAnswer | undefined
  /** The wait has stopped asking: the head says so ahead of whatever the script says. */
  readonly stopped: boolean
  /** Seconds to the next ask, or nothing to count to. */
  readonly left: number | undefined
  /** The press that starts the held step now — drawn only where a step is held. */
  readonly skipping: Skipping | undefined
}): ReactNode => {
  const { word, tone } = headWords(answer?.answer, stopped)
  return (
    <div className="flex min-w-0 flex-col gap-1.5 px-4 pb-3 pt-3.5">
      {/* Wraps for the held card's reason: at a phone the corner and the press drop to a
          line of their own rather than crushing the answer word. */}
      <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2">
        <span className="pt-0.5">
          <Plate tone={tone}>
            <Rocket size={14} aria-hidden />
          </Plate>
        </span>
        <span className="flex min-w-44 flex-1 flex-col gap-0.5">
          <span className="text-2xs font-medium uppercase tracking-wide text-fg-subtle">
            Deploy
          </span>
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className={`text-lg font-medium ${toneInk[tone]}`}>{word}</span>
            {answer?.version !== undefined && (
              <span className="min-w-0 break-all font-mono text-base text-fg">
                {answer.version}
              </span>
            )}
          </span>
        </span>
        <span className="ml-auto flex shrink-0 items-start gap-3">
          {left !== undefined && (
            <span className="flex shrink-0 flex-col items-end gap-0.5">
              <span className="text-2xs uppercase tracking-wide text-fg-subtle">next ask</span>
              <span className="font-mono text-base leading-5 text-tone-working">
                {spellLeft(left)}
              </span>
            </span>
          )}
          {skipping !== undefined && (
            <span className="shrink-0 pt-0.5">
              <SkipPress skipping={skipping} />
            </span>
          )}
        </span>
      </div>
      {skipping?.said !== undefined && (
        <span role="alert" className="min-w-0 pl-9 text-sm text-tone-bad">
          {skipping.said}
        </span>
      )}
    </div>
  )
}

/** The steps the deploy holds, as the proposal card draws them: numbered, marked, whole. */
const Held = ({
  held,
  plan,
  agents,
}: {
  readonly held: WaitingDto
  readonly plan: PlanDto | undefined
  readonly agents: readonly AgentDto[]
}): ReactNode => {
  const entries = heldEntries(held, plan)
  const { title, fact } = heldHead(held, entries.length)
  return (
    <section
      aria-label={title}
      className="flex min-w-0 flex-col gap-2 border-t border-border px-4 pb-3.5 pt-3"
    >
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="text-2xs font-medium uppercase tracking-wide text-fg-subtle">{title}</span>
        <span className="font-mono text-2xs text-fg-subtle">{fact}</span>
      </span>
      {entries.length > 0 && (
        <ol className="flex min-w-0 flex-col gap-2">
          {entries.map(({ mark, entry }) => (
            <li
              key={mark}
              className="flex min-w-0 flex-col rounded-surface border border-border p-2.5"
            >
              <PlanStep
                mark={mark}
                glyph={entryMark(entry, agents)}
                agent={entryName(entry)}
                instruction={entry.instruction ?? ""}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

const DeployBlock = ({
  answer,
  checking,
  fetching,
  held,
  nextAsk,
  plan,
  agents,
  skipping,
}: {
  /** What the script said, or nothing where it has not run — see `deployRan`. */
  readonly answer: DeployAnswer | undefined
  /** Nothing in hand yet: the checking line stands where the head will be. */
  readonly checking: boolean
  /** A fetch is out over an answer already drawn: the hairline travels the top edge. */
  readonly fetching: boolean
  /** The wait, where a step is held on `deployed` — draws the steps section. */
  readonly held: WaitingDto | undefined
  /** `TrakDetailDto.nextAsk` — absent where nothing is scheduled. */
  readonly nextAsk: number | undefined
  readonly plan: PlanDto | undefined
  /** The library, for each held step's mark. */
  readonly agents: readonly AgentDto[]
  /** The press that starts the held step now; drawn only where `held` is. */
  readonly skipping: Skipping
}): ReactNode => {
  // Counted only while the deploy is being asked about: not once it is live, since the
  // step starts on the next sweep, and not at a stopped wait, where nothing is scheduled.
  const counting = held !== undefined && !held.stopped && answer?.answer !== "live"
  const left = useCountdown(counting ? nextAsk : undefined)
  // Read once here, so the rows measure against the same moment the poll redraws on.
  const now = Date.now()
  const rechecking = fetching && !checking
  return (
    // `relative` and `overflow-hidden` for the card's reason: the hairline is drawn on the
    // block's own edge, out of the flow, and clipped to its corner.
    <section
      aria-label="Deploy"
      className="relative flex min-w-0 flex-col overflow-hidden rounded-surface border border-border bg-surface"
    >
      {rechecking && <Rechecking />}
      {checking ? (
        <CheckingLine>Asking deploy.sh about the merge commit…</CheckingLine>
      ) : (
        <Head
          answer={answer}
          stopped={held?.stopped === true}
          left={left}
          skipping={held === undefined ? undefined : skipping}
        />
      )}
      {!checking && answer !== undefined && <Fields answer={answer} now={now} />}
      {held !== undefined && <Held held={held} plan={plan} agents={agents} />}
    </section>
  )
}

export default DeployBlock
