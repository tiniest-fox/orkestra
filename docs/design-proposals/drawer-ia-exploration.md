# Drawer IA Exploration

## The Core Tension

The drawer serves two fundamentally different jobs that happen to be triggered by the same artifact. When a task is awaiting review, the user needs to *act* — judge what the agent produced and decide to approve or reject. When they want to understand *why* something happened or compare versions, they need to *browse* — navigate through time, across iterations and stages. These two modes have opposite information hierarchies. Action mode wants the current artifact front-and-center with evidence nearby. Browse mode wants a navigable timeline where clicking into any past run reveals what it produced and what changed.

The current tab system doesn't distinguish between these modes. History is a flat log with no drill-through. Logs, diff, and artifact are all peer-level tabs, so nothing is structurally primary. The result: every state (running, reviewing, answering) has the same shape even though the tasks are different, and history is a dead end — you can see *that* a rejection happened but not *what* was rejected or *what changed* in the next attempt.

---

## Direction 1: Drill-Down History (Iteration as a navigable object)

**Pitch:** Keep the current tab structure for the action-state context, but make History a full drill-down view where each iteration is a clickable entry that expands into its own artifact + logs + diff.

### How it organizes the layers

- **Task layer** (the drawer, always present): header with stage/status, tab bar
- **Stage layer** (History tab, top level): grouped by stage — each stage is a collapsed section with its iteration count
- **Iteration layer** (History tab, drill-down): clicking an iteration expands it inline to show artifact, activity log, and (future) per-session diff

### Tab structure

All drawers keep their current primary tab order. History tab gains internal navigation:

```
History tab:
  [Stage: planning]
    Iteration #1  — approved — 4m12s  >
  [Stage: work]
    Iteration #1  — rejected — 12m04s  >   <- click to expand
      [artifact preview]
      [feedback given]
      [activity log]
    Iteration #2  — approved — 9m33s  >
```

The current iteration (the one being reviewed) is not in the history list — it lives in the Artifact tab. History is strictly past runs.

### Tradeoffs

- Low disruption: existing drawers change minimally
- Drill-down pattern is familiar (accordion/disclosure)
- The mode mismatch isn't solved — action mode and browse mode still share the same shell
- "View past artifact while reviewing current one" still requires tab-switching; no side-by-side
- If iteration count grows large, history list gets long with no good pagination story
- Per-session diff slots naturally here (each expanded iteration shows its session's diff), but the expand UI could get heavy

---

## Direction 2: Mode Switch (Action mode vs. History mode)

**Pitch:** The drawer has two explicit top-level modes. Action mode is what exists today (optimized for the current task state). History mode is a separate, dedicated browsing experience — a persistent timeline on the left, a detail pane on the right.

### How it organizes the layers

- **Task layer**: the toggle between modes; the persistent context (task title, overall status)
- **Stage + Iteration layer** (History mode, left pane): a vertical timeline — stages as section headers, iterations as rows. Clicking any row loads it in the right pane.
- **Session layer** (History mode, right pane): artifact, activity log, per-session diff for whichever iteration is selected

### Tab / navigation structure

```
[ Action ]  [ History ]    <- top-level mode toggle in drawer header

-- Action mode (current state) --
Tabs: [Artifact] [Diff] [Logs]
Footer: Approve / Reject (or Resume / Interrupt, etc.)

-- History mode --
Left sidebar: stage-grouped timeline, each iteration as a row
Right pane:   [Artifact] [Logs] [Diff (session)]   <- for selected iteration
No footer action — history is read-only
```

Action mode loses the History tab entirely. History mode has no footer actions. The modes are mutually exclusive and structurally distinct.

### Tradeoffs

- Cleanly solves the mode mismatch: action and browse have different shapes because they serve different jobs
- The two-pane history view enables direct comparison ("iteration 2 had this artifact, iteration 3 had this") without tab-switching
- Drawer becomes wider for the two-pane layout, or the left pane compresses the right — either way it's a tighter fit in a side-drawer
- Users who want to quickly glance at one past iteration before approving now need two clicks (switch mode, click iteration) instead of one (tab to history, scroll)
- Mode toggle adds a conceptual layer the user has to understand: "there are two modes, I'm in one"
- Per-session diff lands cleanly in the History mode right pane — the right place for the right context

---

## Direction 3: Contextual Sidebar (History as ambient context, not a tab)

**Pitch:** Remove History as a tab entirely. Collapse the iteration timeline into a persistent, narrow sidebar on the left edge of the drawer that is always visible. The main content area shows the action-relevant content (artifact, logs, diff). Clicking a past iteration in the sidebar swaps the main content area to show that iteration's artifact without changing tabs.

### How it organizes the layers

- **Task layer**: the drawer shell — always present
- **Stage + Iteration layer**: left sidebar, always visible, shows all iterations grouped by stage. Current iteration highlighted. Past iterations are lower opacity.
- **Session layer**: main content area. In the current iteration context: Artifact / Diff / Logs tabs. In a past iteration context: artifact and (future) session diff, with a "return to current" affordance.

### Tab / navigation structure

```
+---------+------------------------------------------+
|         |  [Artifact]  [Diff]  [Logs]               |
| WORK    |                                            |
|  #3 <- |  <current artifact content>                |
|  #2     |                                            |
|  #1     |                                            |
|---------|                                            |
| PLAN    |                                            |
|  #1     |                                            |
+---------+------------------------------------------+
                         [Approve] [Reject]
```

Clicking iteration #2 in the sidebar: main area shows that iteration's artifact (read-only, dimmed header indicating "viewing past iteration"), with a banner or button to return to current. The Approve/Reject footer is hidden when viewing a past iteration.

### Tradeoffs

- History is never more than one click away from any state — no tab-switching required to compare past and current
- Drawer width requirement: the sidebar needs ~120-140px of fixed width, which eats into the main content area
- In narrow drawer configurations or when logs are the main content (which need horizontal space), this will feel cramped
- The "sidebar swap the main area" pattern is less obvious than tabs — users may not realize clicking a past iteration changes what they're looking at
- The implicit mode shift (current vs. past iteration) needs clear visual treatment to avoid confusion about "is this the current artifact I'm reviewing?"
- This direction has the best answer to "I want to see what version 2 looked like while deciding about version 3" — it's a single click in the sidebar

---

## Recommendation

**Direction 2 (Mode Switch) is the one to explore further**, with one modification: make the mode toggle cheap and obvious.

The core reason: the action/browse distinction is real and meaningful. Trying to serve both with the same tab bar consistently underserves one or the other. Right now it underserves browse (History is a dead end). Direction 1 (Drill-Down) improves browse within the existing shape but doesn't fix the mode mismatch. Direction 3 is elegant but the fixed sidebar width is a persistent cost on every drawer, every state, even when the user never wants to look at history.

Direction 2 names the distinction explicitly and gives each mode the structure it deserves. The modification: the History tab in the current tab bar becomes the mode toggle. Users already understand the History tab as "go look at what happened." Making it switch the drawer into a dedicated history mode is a small leap from their existing mental model. You avoid adding a novel top-level toggle control — the tab bar already does this job.

**What to prototype:**
- History tab click changes the drawer shape: main area becomes two-pane (left timeline, right detail), footer actions disappear
- A "Back" or "X" in the history header (or Escape) returns to the action mode
- The right-pane detail starts on the most recent completed iteration, not empty — so arriving in history mode immediately shows something meaningful
- Per-session diff lives in the right pane's tab bar as a future slot, so the structure can accept it without a redesign

**The open question before building:** Is the two-pane layout viable at the drawer's current width? If not, the history mode could be full-width (no left sidebar, just a list that when clicked replaces the whole pane with an iteration detail view). That's Direction 1 with explicit mode context — still better than the current dead-end History tab, even if it loses the side-by-side comparison.
