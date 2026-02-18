# Proposal B: "The Workshop"

## Design Philosophy

The Workshop treats Orkestra as a place where you and AI agents collaborate on software tasks. The central insight: **the user's job is to respond to agent requests, not to monitor a pipeline.** Every pixel of this design is organized around surfacing what needs human attention and making the response as frictionless as possible.

### Why Not a Kanban Board?

The current kanban board organizes tasks by workflow stage (Planning, Breakdown, Work, Checks, Review, Compound, Done, Failed, Blocked). This is a pipeline-centric view that answers "where is each task in the process?"

But that's the wrong question for this app. The user doesn't care that three tasks are in "Work" stage and two are in "Planning." They care about: **which tasks need me right now, and which are fine on their own?**

The Workshop replaces pipeline-stage columns with intent-based sections:
- **Your Attention** -- Tasks that need human action (questions, reviews, failures, integration)
- **Agents at Work** -- Tasks progressing autonomously (no action needed)
- **Recently Completed** -- Tasks that are done (archive or integrate)

This reorganization means the user's primary screen directly answers their primary question.

### Why Full-Screen Focus Instead of Sidebars?

The current design uses a 480px sidebar for task details. This creates three problems:
1. The sidebar competes with the board for screen space
2. 480px is too narrow for meaningful content (markdown artifacts, code diffs, log output)
3. Opening one panel closes another (assistant vs task detail vs git history)

The Workshop eliminates sidebars entirely. Clicking a task card transitions to a full-screen Focus view. The full width of the screen is available for content. There's no competition for space because only one level of content is shown at a time.

### Why State-Adaptive Views?

The current task detail has 6 tabs (Details, Subtasks, Activity, Logs, Artifacts, PR) that stay constant regardless of task state. A conditional footer panel shows the relevant action (review, answer questions, resume, integrate, archive) but this creates unpredictable behavior.

The Workshop flips this: the task's state drives the entire layout.

| Task State | Focus View Layout |
|------------|------------------|
| Needs review | Artifact is hero, approve/reject bar at bottom |
| Has questions | Questions form is the entire view |
| Agent working | Live activity feed with progress indicator |
| Failed/blocked | Error message is hero, retry options below |
| Waiting on children | Subtask overview with progress |
| Done | Integration options prominently displayed |

There are no tabs. The most important content for the current state is always visible without navigation.

---

## Visual Language

### Color Palette

**Light mode:**
- Canvas: #FAF8F5 (warm off-white)
- Surface: #FFFFFF (cards, panels)
- Text primary: #2D2926 (warm charcoal)
- Text secondary: #78716C (warm gray)
- Text tertiary: #A8A29E (light warm gray)
- Border: #E7E5E4 (stone-200 equivalent)
- Accent primary: #C4643A (terracotta -- warm, approachable alternative to the current orange)
- Accent secondary: #6B8F71 (sage green)
- Success: #3D8B4F (forest green)
- Warning: #C48A2C (amber gold)
- Error: #B84233 (brick red)
- Info: #4A6280 (slate blue)

**Dark mode:**
- Canvas: #1A1614 (deep warm brown, not blue-black)
- Surface: #231F1C (warm elevated surface)
- Text primary: #F5F0EB (warm white)
- Text secondary: #A8A29E
- Text tertiary: #78716C
- Border: #3D3835 (warm dark border)
- Accents same as light, slightly brighter for contrast

### Typography

- **Headings:** Fraunces (variable optical size, 9-144). A deliberate, opinionated serif with soft, slightly organic letterforms that immediately distinguish Orkestra from generic SaaS tools. 600 weight for section titles, 700 for page titles. Letter-spacing: -0.02em for large sizes, -0.01em for medium.
- **Body:** Nunito Sans (variable). A humanist sans-serif with rounded terminals and open apertures -- exceptionally readable at small sizes while maintaining the warm personality. 400 for body, 500 for labels, 600 for emphasis. Pairs naturally with Fraunces without competing.
- **Mono:** JetBrains Mono. Used for task IDs, code snippets, log entries, and technical content. 400 weight for body, 500 for emphasis.

**Scale:**
- Page title: 28px / 1.2 line-height / Fraunces 600 / -0.02em
- Section title: 18px / 1.4 / Fraunces 500 / -0.01em
- Card title: 16px / 1.3 / Fraunces 500
- Body: 14px / 1.5 / Nunito Sans 400
- Small/label: 13px / 1.5 / Nunito Sans 600
- Micro/mono: 12px / 1.5 / JetBrains Mono 400

### Spacing & Radius

- Base unit: 4px
- Card padding: 16px (4 units)
- Section gap: 24px (6 units)
- Card gap: 12px (3 units)
- Card radius: 16px
- Button radius: 12px
- Input radius: 10px
- Badge radius: 8px

### Shadows

Warm-toned, multi-layered for physical depth:
- Card resting: `0 1px 3px rgba(45, 41, 38, 0.08), 0 1px 2px rgba(45, 41, 38, 0.06)`
- Card hover: `0 4px 12px rgba(45, 41, 38, 0.10), 0 2px 4px rgba(45, 41, 38, 0.06)`
- Modal: `0 16px 48px rgba(45, 41, 38, 0.16), 0 4px 12px rgba(45, 41, 38, 0.08)`

### Iconography

Phosphor Icons (regular weight) -- rounder and warmer than Lucide. Key icons:
- Attention: Bell, WarningCircle, ChatCircleDots, Eye
- States: CheckCircle, XCircle, Pause, Lightning
- Navigation: ArrowLeft, MagnifyingGlass, Plus, X
- Actions: ThumbsUp, ThumbsDown, PaperPlaneRight

### Animation

Spring-based (not linear or cubic-bezier). CSS `transition` with custom timing or Framer Motion spring configs:
- **Quick interactions** (hover, toggle): stiffness 500, damping 30 (~150ms)
- **Layout transitions** (card to focus): stiffness 300, damping 30 (~350ms)
- **Entrance animations**: stiffness 260, damping 24 (~400ms, slight bounce)

The breathing pulse on active agent cards uses a CSS keyframe: `opacity` oscillating between 0.4 and 1.0 over 3s with ease-in-out.

---

## Component Mapping

How current components map to The Workshop:

| Current Component | Workshop Equivalent |
|-------------------|-------------------|
| KanbanBoard + KanbanColumn | Workbench (intent-based sections) |
| TaskCard | WorkbenchCard (state-adapted, with inline quick actions) |
| TaskDetailSidebar (6 tabs + footer) | FocusView (state-adaptive full-screen) |
| ReviewPanel (footer) | FocusView review mode (artifact hero + action bar) |
| QuestionFormPanel (footer) | FocusView question mode (full-screen form) |
| IntegrationPanel (footer) | FocusView integration mode |
| LogsTab (3-level tabs) | FocusView activity mode (single unified feed) |
| ArtifactsTab | Inline in FocusView (artifact is the hero, not a tab) |
| IterationsTab | Activity timeline within FocusView context sidebar |
| SubtasksTab + nested sidebar | FocusView subtask mode (flat list, breadcrumb nav) |
| DiffPanel (replaces board) | FocusView sub-view (replaces main content within focus) |
| CommitHistoryPanel | Removed (use terminal/IDE) |
| AssistantPanel + SessionHistory | Floating chat overlay (bottom-right) |
| CommandPalette | Kept, enhanced with action commands |
| NewTaskPanel (sidebar) | Modal overlay (bottom sheet) |
| ArchivedListView | Filter on "Recently Completed" or a separate archive page |
| BranchIndicator + SyncStatus | Compact status in top bar (kept minimal) |

---

## Information Architecture

```
Workbench (Home)
  |
  +-- Your Attention section
  |     +-- [Card: Review task] --> Focus: Review mode
  |     +-- [Card: Questions]   --> Focus: Question mode
  |     +-- [Card: Failed]      --> Focus: Error recovery mode
  |     +-- [Card: Integrate]   --> Focus: Integration mode
  |
  +-- Agents at Work section
  |     +-- [Card: Active task]  --> Focus: Monitoring mode
  |     +-- [Card: Active task]  --> Focus: Monitoring mode
  |
  +-- Recently Completed section
        +-- [Card: Done task]    --> Focus: Integration/Archive mode
        +-- Archive all action

Focus View (per-task)
  |
  +-- Breadcrumb: Workbench > [Task Title] (> [Subtask] if applicable)
  +-- State-adaptive main content (see table above)
  +-- Context sidebar (collapsible, right side)
  |     +-- Task description
  |     +-- Stage pipeline visualization
  |     +-- Iteration timeline (compact)
  +-- Action bar (bottom, sticky) -- approve/reject/submit/retry
  +-- Changes sub-view (replaces main content when viewing diff)

Global Overlays
  +-- Assistant chat (bottom-right floating)
  +-- New task modal (bottom sheet)
  +-- Command palette (centered modal, Cmd+K)
```

---

## Key Decisions & Trade-offs

### Removed features
- **Commit history panel**: Developers have git tools. Orkestra's value is orchestration, not git GUI.
- **Push/pull from UI**: Same rationale. Keep a status indicator, remove the actions.
- **Per-session log navigation**: Replace with a single unified activity feed. Stage boundaries shown as dividers.
- **Iteration indicator on cards**: The colored dots are cryptic. Replace with a simple stage label.
- **Task ID on cards**: Move to focus view header. Not needed for scanning.

### Simplified features
- **Archive**: Not a global mode switch. It's a filter or a sub-page linked from "Recently Completed."
- **Branch selector**: Collapsed by default in task creation. Most tasks use the default branch.
- **Auto-task templates**: Moved into command palette rather than a separate dropdown.

### Preserved features
- **Flow picker in task creation**: This is well-designed. Keep it.
- **Auto mode toggle**: Core differentiator. Keep it prominent.
- **Subtask progress visualization**: Important for parent tasks. Keep as inline progress bar on cards.
- **PR status after integration**: Keep as a section in the Focus view's integration mode.
- **Diff viewer**: Keep as a sub-view within Focus, not a global panel.

### Added features
- **Quick actions on card hover**: Approve/view buttons on attention-needed cards for rapid response.
- **"Next task" transition**: After approving/rejecting, auto-navigate to the next attention-needed task.
- **Breathing pulse on active cards**: Visual indicator of agent liveness without requiring the user to open logs.

---

## Responsive Considerations

- **Wide screens (>1400px)**: Workbench cards in 3-column grid. Focus view uses full width for artifact + context sidebar.
- **Medium screens (1000-1400px)**: Workbench cards in 2-column grid. Focus view hides context sidebar (accessible via toggle).
- **Narrow screens (<1000px)**: Workbench cards in single column. Focus view is full-width content only.

The lack of sidebars makes responsiveness straightforward -- there's only one dimension to adapt (card grid columns).
