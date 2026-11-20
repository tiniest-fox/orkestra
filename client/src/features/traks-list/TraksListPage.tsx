/**
 * Every live trak in `.orkestra/.database/traks/`, one row each, polled while anyone is
 * looking. The row says what the trak is, what it is doing, and what is waiting on
 * you — see `TrakRow`, which owns the whole of how one is drawn. The archived ones
 * arrive as a count and draw as one, under a header that does not open.
 *
 * The four states a polled screen has (`client-style`) are all here, and they are
 * branched **on `data === undefined` first, never on `isError` first**: TanStack keeps
 * the last data while a background refetch is failing, so leading with the error would
 * blank a working list every time a laptop sleeps.
 *
 * **A list, not a table.** It was a `<table>` while a row was three columns of the
 * same shape; a row is now a chip, a stack of up to three lines, and a slot holding
 * either a link or a log line, and the columns were the thing being got rid of. `<ul>`
 * and `<li>` still carry roles the tests find it by, which was the reason the table
 * was worth having.
 *
 * **Full bleed, and no heading**, because the app bar above it names the app: a card
 * centred in a measure says "this list is a document" while the chrome says the
 * opposite, and an `<h1>Traks</h1>` under a bar naming the app is the app's name twice.
 * The rows carry their own padding, so the page has none — and the three states that
 * are not a list are `EmptyState`, which draws the shape of the rows that are missing
 * and carries its own gutter.
 *
 * **Grouped, not flat.** `TrakSections` owns what the rows are divided into and what
 * order they run in — twelve sections, top to bottom by what is owed, and inside each one
 * the trak a person touched most recently first.
 *
 * A spawn is one row, not one per piece: `asTree` gathers the children still out onto
 * their parent's band, and the pieces that have been folded back in leave the list
 * altogether. **The group moves as one**, into the furthest-up section any member is in,
 * so a piece never appears as a row divorced from its parent — the sole exception being
 * a piece whose parent the list does not hold at all.
 *
 * **The second read is the forge's, and it is one query for the whole page.** Every
 * finished row's branch goes up in one question and comes back in a single answer, and
 * `rungsOf` matches the two by branch — so what a row says about its pull request costs
 * nothing per row. It used to be a fan-out, one call per finished trak per poll over a
 * pile nothing archives; `useForgeListing` carries what that cost and why it is gone.
 * Nothing about it crosses `GET /api/traks`, which stays a read that costs no I/O.
 *
 * **A forge that could not be asked is drawn on the rows it bears on, not as a failure
 * over the page.** It is an ordinary answer — no `gh`, no login, no remote, a network
 * that is down — and the rows it stops us classifying say so themselves, under *Finished*.
 * A strip above the list would be a notice about somebody's tooling over work that is
 * perfectly fine, and the rows would still be claiming what they could not know.
 */

import type { ReactNode } from "react"
import type { AgentDto, CliUsageDto, TrakListDto } from "../../api/types"
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { Inbox, Unplug } from "lucide-react"
import GitDock from "./git/GitDock"
import GitStrip from "./git/GitStrip"
import { useUsage } from "./git/useUsage"
import { useGitBar } from "./git/useGitBar"
import type { GitBar } from "./git/useGitBar"
import { useProjectProcesses } from "./processes/useProjectProcesses"
import ProjectTools from "./ProjectTools"
import { type ProjectTools as Tools, useProjectTools } from "./useProjectTools"
import type { ProjectProcesses } from "./processes/useProjectProcesses"
import { forgeBranches, rungsOf } from "./pullRung"
import PushOffer from "./PushOffer"
import TrakSections from "./TrakSections"
import { askedBranches, useForgeListing } from "./useForgeListing"
import { useTraks } from "./useTraks"
import { useGoals } from "./useGoals"
import GoalStack from "./GoalStack"
import { useDismissGoal } from "./useDismissGoal"
import { useAgents } from "../../hooks/useAgents"
import { useForgeMemory } from "../../hooks/useForgeMemory"
import { usePhone } from "../../hooks/usePhone"
import { useWideDrawer } from "../../hooks/useWideDrawer"
import Button from "../../components/Button"
import EmptyState from "../../components/EmptyState"

/**
 * The list, and whatever is open over it.
 *
 * The `<Outlet />` is the trak drawer's mount point — `routes.ts` makes the trak route a
 * child of this one, so the list stays rendered and clickable beside the drawer rather
 * than being replaced by it. There is no scrim: triaging one trak against the next
 * should not cost a close.
 *
 * **Below the breakpoint the dock is the list's other piece of chrome**, in every state
 * of the page — starting a trak is the act that fixes an empty list, so the pill may
 * not vanish with the rows. The `pb` is the scroller paying the dock back — the band,
 * the pill raised 16px above it, and clearance, or the last row sits under both —
 * plus `safe-b`, because the dock itself rides the home-indicator inset higher
 * (`pb-safe-b` on `Dock`) and the reservation must move with it. On desktop the inset
 * is 0 and the whole class is inert above the breakpoint anyway. The drawer's `z-30`
 * covers the dock's `z-20`, so a trak opened over the list takes the whole screen.
 *
 * **The git bar is drawn here, in every state of the page, because every screen is.** The
 * shell route is this page, so the list and every drawer over it are under this tree; the
 * chrome above it may hold no data hook. On a desktop it is the strip along the foot, after
 * the outlet so its card opens over a drawer, and the list pays its 32px back with `pb-8`.
 * On a phone it is the dock's tabs, two either side of the pill. The project checkout's
 * processes and the door to its files ride on it, at the strip's left edge and in the
 * dock's two left tabs.
 *
 * **The file browser and the ⌘K palette are drawn here for the same reason** — `tools`,
 * after the strip so the palette draws over everything. The Files panel never shares the
 * screen with a drawer from the outlet: `useProjectTools` keeps one of the two.
 */
const Page = ({
  phone,
  git,
  processes,
  usage,
  tools,
  list,
  agents,
  goals,
  children,
}: {
  readonly phone: boolean
  readonly git: GitBar
  readonly processes: ProjectProcesses
  /** Each CLI's plan usage, `undefined` until the first answer. */
  readonly usage: readonly CliUsageDto[] | undefined
  /** The file browser and the palette — `useProjectTools`. */
  readonly tools: Tools
  /** The list as last read, which the palette searches; `undefined` before the first. */
  readonly list: TrakListDto | undefined
  readonly agents: readonly AgentDto[]
  /** The goal stack, or nothing while the goals have not answered. */
  readonly goals: ReactNode
  readonly children: ReactNode
}): ReactNode => (
  <>
    <main className="flex flex-col pb-8 max-sm:pb-[calc(--spacing(24)+var(--spacing-safe-b))]">
      {/* The ask-once notification band, over the list in every one of its states —
          it decides for itself whether there is anything to ask. */}
      <PushOffer />
      {/* In every state too: a goal at its plan gate has opened nothing, so the list it
          sits over may well be empty. */}
      {goals}
      {children}
    </main>
    {phone && (
      <GitDock bar={git} processes={processes} usage={usage} onFiles={tools.browser.toggle} />
    )}
    <Outlet />
    {!phone && <GitStrip bar={git} processes={processes} usage={usage} files={tools.browser} />}
    <ProjectTools
      tools={tools}
      phone={phone}
      traks={list?.traks ?? []}
      archived={list?.archived ?? 0}
      agents={agents}
      branch={git.view?.head}
    />
  </>
)

const TraksListPage = (): ReactNode => {
  const { data, isError, error, refetch } = useTraks()
  // The breakpoint, read once here and passed down as a prop: the views stay views, and
  // the tier-2 tests — where `matchMedia` does not exist — get the desktop layout they
  // are written against.
  const phone = usePhone()
  // Whether anything is open in the outlet. Every route under the shell but the index is
  // a drawer over the right of the list, so a band abreast would run under it; the rows
  // stack their pieces while one is open. Read off the location rather than off a route
  // id, because the drawers are three routes today and the index is the one that is not.
  const stacked = useRouterState({ select: (s) => s.location.pathname !== "/" })
  // A trak drawn with its side panel leaves the list its first 48px, and the section
  // headers become the index rail's counts — the trak page holds the flag while it does.
  const rail = useWideDrawer()
  // Unconditional, and its absence is never a state of this screen: the library answers
  // once and cheaply, and a row whose mark cannot be resolved draws the fallback rather
  // than nothing. Held above the early returns because a hook cannot be called after one.
  const agents = useAgents()
  // One call for the whole page, whatever is on it, and none at all where nothing on it
  // has run its plan out. Asked here rather than inside a row for a second reason as well:
  // a row can be under a shut lid, and a query with no observer stops asking — a per-row
  // hook would unmount the moment its answer moved its row under a closed one, and put it
  // back fifteen seconds later.
  const asked = askedBranches(forgeBranches(data?.traks ?? []))
  const forge = useForgeListing(asked)
  // What the forge last said about these branches, from before this page was loaded. It
  // costs no call — it is the answers already in the cache, read by branch rather than by
  // the question they were asked under, which is what makes a restored one reachable after
  // a trak has finished and moved the question.
  const memory = useForgeMemory()
  // The project checkout's git, polled — which is also what fetches it every five minutes.
  // *Resolve in a Trak* starts nothing: it opens the New Trak page with the engine's
  // request for the merge in the field, and the person starts the trak there.
  const navigate = useNavigate()
  const git = useGitBar((description) => {
    void navigate({ to: "/traks/new", state: { description } })
  })
  const processes = useProjectProcesses()
  const usage = useUsage()
  const tools = useProjectTools()
  // Every goal the person has not dismissed, going or at rest, and the way to start a new
  // one. Its own query, so a list that failed to load still shows them, and goals that
  // failed to load hide nothing of the list. The stack waits for the answer, so the door
  // never flashes over a goal about to be drawn.
  const goals = useGoals()
  const dismissal = useDismissGoal()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const open = pathname.startsWith("/goals/")
    ? decodeURIComponent(pathname.slice("/goals/".length))
    : undefined
  const stack =
    goals.data === undefined ? undefined : (
      <GoalStack
        goals={goals.data.goals.filter((g) => !g.dismissed)}
        open={open}
        phone={phone}
        onDismiss={dismissal.dismiss}
        dismissing={dismissal.dismissing}
      />
    )

  const chrome = { phone, git, processes, usage, tools, list: data, agents: agents.data ?? [] }

  if (data === undefined) {
    if (!isError)
      return (
        <Page {...chrome} goals={stack}>
          <EmptyState loading />
        </Page>
      )
    return (
      <Page {...chrome} goals={stack}>
        <EmptyState
          tone="bad"
          icon={Unplug}
          title="Could not reach the engine"
          action={<Button onClick={() => void refetch()}>Try again</Button>}
        >
          {error.message}. The engine serves this list, so nothing here is current until it answers
          — is `pnpm serve` running?
        </EmptyState>
      </Page>
    )
  }

  // Nothing live and nothing put away. A project whose every trak is archived is not
  // this page: it draws the archived header, with `NothingOpen` where the rows would be.
  if (data.traks.length === 0 && data.archived === 0) {
    return (
      <Page {...chrome} goals={stack}>
        <EmptyState icon={Inbox} title="No traks yet">
          A trak is one piece of work, driven from a description to a commit. Press New Trak to
          start one.
        </EmptyState>
      </Page>
    )
  }

  return (
    <Page {...chrome} goals={stack}>
      {/* Stale data stays on screen; the failure is a strip beside it, never the shell
          above — the rows are still true, so nothing may cover them or push them down.
          `role="status"` and not `alert`, because nothing is broken for the reader and
          the next poll may well fix it. */}
      {isError && (
        <div
          role="status"
          className="flex items-center gap-3 border-b border-border px-gutter py-2"
        >
          <Unplug size={12} aria-hidden className="shrink-0 text-tone-waiting" />
          <span className="text-sm text-fg-muted">
            Last refresh failed — showing what was here.
          </span>
          <span className="ml-auto">
            <Button variant="ghost" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </span>
        </div>
      )}
      <TrakSections
        traks={data.traks}
        archived={data.archived}
        rungs={rungsOf(data.traks, forge.data, asked, memory)}
        agents={agents.data ?? []}
        phone={phone}
        stacked={stacked}
        rail={rail}
      />
    </Page>
  )
}

export default TraksListPage
