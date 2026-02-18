# Creative Directions for Orkestra UI Redesign

## Current State Assessment

Orkestra is a task orchestration system for AI coding agents. The current UI is a **Kanban board with a slide-in detail sidebar** -- a competent but conventional pattern. The visual language (Geist font family, warm stone neutrals, orange accent at #F04A00, 12px panel radius, soft diffuse shadows) is clean and professional but lacks a distinctive personality. It could be any project management tool.

### What Works
- The panel layout system (PanelLayout + Slot) is architecturally sound -- animated grid transitions are smooth
- The warm stone palette is pleasant and avoids the cold sterility of pure grays
- Task state encoding through border colors + icon badges is information-rich
- The iteration card timeline gives good visibility into agent activity
- Flow picker in task creation is well-designed

### What Doesn't Work
- **The Kanban metaphor is wrong for this domain.** Orkestra tasks don't flow left-to-right through stages like Jira tickets moved by humans. They're *automated pipelines* -- the agent progresses through stages programmatically. A kanban board implies human drag-and-drop workflow; this app needs to communicate *autonomous progression with human checkpoints*.
- **Information hierarchy is flat.** Everything gets the same visual weight. The task card shows title, description, ID, error text, iteration dots, subtask progress, PR status, and multiple state icons -- all at roughly the same size and emphasis. There's no visual prioritization.
- **The detail sidebar is a content dump.** Tabs (Details, Artifacts, Iterations, Subtasks, PR, Logs) are organized by *data type*, not by *what the user needs to do*. A user reviewing a task needs: "What should I look at?" not "Which database table do you want to browse?"
- **No sense of motion or liveness.** This is a system where autonomous agents are actively working in real time. The UI is mostly static with a few spinners. It should feel *alive*.
- **The assistant is bolted on.** It's a separate panel with its own session history, disconnected from the task flow. There's no sense that the assistant *knows about* the tasks on the board.

---

## Direction A: "Mission Control"

### Concept
Reimagine Orkestra as a **real-time operations dashboard** -- like a NASA mission control or a Bloomberg terminal adapted for AI orchestration. Dense information, real-time feeds, and a sense of situational awareness. The user is a commander overseeing multiple autonomous agents. Every task is a mission with a live telemetry feed.

### Visual Language
- **Color palette:** Deep navy/charcoal base (#0f1729, #1a2332) with electric accents. Status colors are vivid and saturated -- emerald green for healthy, amber for attention, crimson for failure. Not pastel semantic colors, but *signal colors* designed for at-a-glance recognition against a dark background.
- **Typography:** Monospace-heavy. JetBrains Mono or IBM Plex Mono for data, Inter for labels. Numbers and IDs are first-class citizens, not afterthoughts. Tabular number formatting everywhere.
- **Grid system:** Strict 8px grid with precise alignment. Dense 4px gaps between elements. Information is packed tightly but never chaotic -- every pixel is intentional.
- **Borders and surfaces:** Thin 1px borders in muted blue-gray. No soft shadows -- surfaces are distinguished by slight background shade differences (like stacked layers of tinted glass). Border-radius is minimal: 4px maximum.
- **Motion:** Minimal decorative animation. Data changes are immediate. Status transitions use sharp 100ms color swaps, not smooth fades. Spinners are replaced by pulsing status dots.

### UX Paradigm: The Timeline Feed
Replace the kanban board with a **vertical timeline feed** -- every task is a row with a live activity stream flowing left to right.

```
[Task Title] [Stage Pipeline ----*----->] [Live Feed: "Reading src/auth.ts..."] [Actions]
[Task Title] [Stage Pipeline -------*-->] [Live Feed: "Tests passing (12/12)"]  [Review]
[Task Title] [Stage Pipeline -->*-------] [Awaiting: 2 questions]               [Answer]
```

- **The pipeline visualization is the centerpiece.** A horizontal progress bar showing all stages, with the current position marked. Each stage is a segment (proportional to expected duration or equal). Color-coded: completed (green), active (pulsing amber), upcoming (dim), failed (red).
- **Live feed column** shows the most recent agent action in real time -- tool uses, file reads, test results. This replaces the need to open a separate log panel for "what's happening right now."
- **Action column** surfaces exactly what the user needs to do: Review, Answer Questions, Resolve Conflict. No action needed = no button shown.
- **Clicking a row** expands it inline (accordion-style, not a sidebar) to show full details: artifacts, diff, iteration history, subtask tree.

### Key Interactions
- **Keyboard-first navigation.** J/K to move between tasks, Enter to expand, Escape to collapse. Number keys for quick actions (1=Approve, 2=Reject, 3=Answer).
- **Global status bar** at the top: total active agents, total tasks by state, system health metrics, last sync time.
- **Notification center** replaces scattered badge indicators. A single unified feed of "things that need your attention" with clear priority ordering.

### Personality
Precise. Authoritative. The UI communicates "you are in control of a powerful system." Designed for people who monitor multiple agents simultaneously and need instant situational awareness.

---

## Direction B: "The Workshop"

### Concept
Reimagine Orkestra as a **creative workshop** -- like Figma's canvas or a music producer's arrangement view (Ableton Live). Tasks aren't tickets in a queue; they're *projects on your workbench*. The UI should feel tactile, spatial, and inviting. You should want to spend time here.

### Visual Language
- **Color palette:** Warm, organic tones. Off-white canvas (#faf8f5) with rich earth tones: terracotta (#c4643a), sage (#6b8f71), slate blue (#4a6280), warm charcoal (#2d2926). The orange accent shifts warmer and more muted. Dark mode uses deep warm browns (#1a1614) rather than blue-tinged blacks.
- **Typography:** A personality font for headings -- something with character like Fraunces, Newsreader, or Source Serif 4 (variable weight). Body text in a humanist sans-serif (Nunito Sans, Source Sans 3). The combination should feel like a well-designed independent magazine, not a corporate dashboard.
- **Surfaces:** Layered paper/card metaphor. Cards have very subtle texture (CSS noise or gradient overlays). Shadows are warm-toned and soft, creating a sense of physical depth. Border-radius is generous: 16px for cards, 24px for containers.
- **Iconography:** Hand-drawn or sketched style icons (Phosphor Icons "thin" weight, or custom line illustrations). Softer and more approachable than Lucide's geometric precision.
- **Motion:** Organic, spring-based animations. Cards have slight bounce on hover. Transitions feel physical -- things slide, settle, and breathe. 300-400ms easing curves that feel handcrafted, not robotic.

### UX Paradigm: The Workbench
Replace the kanban columns with a **spatial canvas / card layout** that groups tasks by what matters: what needs your attention vs. what's cooking autonomously.

```
+--------------------------------------------------+
|  YOUR ATTENTION                                   |
|  +----------+  +----------+  +----------+        |
|  | Review   |  | 2 Qs     |  | Failed   |        |
|  | Auth     |  | Database |  | CI fix   |        |
|  | refactor |  | schema   |  |          |        |
|  +----------+  +----------+  +----------+        |
+--------------------------------------------------+
|  AGENTS AT WORK                                   |
|  +-----------------+  +-----------------+         |
|  | Planning:       |  | Coding:         |         |
|  | API endpoints   |  | User settings   |         |
|  | ~~~ ~~~ ~~~     |  | Reading files...|         |
|  +-----------------+  +-----------------+         |
+--------------------------------------------------+
|  RECENTLY COMPLETED                    View all > |
|  Auth refactor  *  DB migration  *  Test setup    |
+--------------------------------------------------+
```

- **Tasks are grouped by user intent**, not by pipeline stage. "Needs your attention" (questions, reviews, failures) always at the top. "Agents working" in the middle. "Done" collapses to a minimal strip.
- **Each card is a mini-dashboard.** For active tasks: a small circular progress indicator, the current stage name, and a one-line live status. For review tasks: the artifact preview (first ~3 lines of the plan/summary). For failed tasks: the error message right on the card.
- **Clicking a card opens it as a focused workspace** -- not a sidebar, but a full-panel takeover with a breadcrumb to return. Inside, the workspace is organized around the *current action*: if it's a review, the artifact is front-and-center with approve/reject below. If it's questions, the Q&A form is the primary view with context in a collapsible section.

### Key Interactions
- **Drag to reorder** within attention-needed section (for manual prioritization).
- **Quick actions on hover** -- approve/reject buttons appear directly on the card.
- **Ambient activity indicators** -- cards in "agents working" section have a subtle animated gradient border that pulses, like a breathing light. Each agent gets a consistent color so you can tell them apart at a glance.
- **The assistant is integrated into the workspace**, not a separate panel. A small persistent chat bubble in the bottom-right corner that can be expanded, but it's aware of whichever task card you're looking at.

### Personality
Warm. Inviting. Tactile. The UI communicates "this is your creative workspace where you collaborate with AI agents." Designed for people who work on one task at a time and want depth over breadth.

---

## Direction C: "The Terminal"

### Concept
Reimagine Orkestra as a **CLI-first, keyboard-driven interface** -- like Vim, Raycast, or a highly polished terminal emulator. The entire app is navigated through a command palette, text input, and keyboard shortcuts. The visual surface is deliberately minimal: maximum content, zero chrome. Every pixel that isn't content is waste.

### Visual Language
- **Color palette:** Two modes, both extreme. **Light:** Pure white (#ffffff) background, true black (#000000) text, zero gray chrome. Single accent color (the existing orange #F04A00) used only for interactive elements and focus states. **Dark:** True black (#000000) background, white text, orange accents. No "dark gray panels" -- just black and white with color for meaning.
- **Typography:** Monospace everything. Berkeley Mono, Iosevka, or Cascadia Code. Fixed-width creates natural alignment without needing grid systems. Different weights for hierarchy: Regular for body, Medium for labels, Bold for headings. No serif, no sans-serif.
- **Surfaces:** No cards, no panels, no borders, no shadows. Content is separated by whitespace alone. Sections are delineated by subtle horizontal rules or indentation levels. The interface looks like a beautifully typeset text document.
- **Iconography:** None. Status is communicated through text symbols and color: a green circle character for done, a red X for failed, an amber question mark for questions. Unicode characters, not icon fonts.
- **Motion:** Zero. No transitions, no animations, no hover effects beyond cursor changes. Content appears and disappears instantly. The interface feels like editing a file -- immediate, responsive, zero latency.

### UX Paradigm: The Buffer
The entire interface is a **single scrollable view** (like a Vim buffer or a terminal output) with a **persistent command bar** at the top.

```
> _                                              [3 active] [1 review] [1 failed]

# NEEDS ATTENTION

  ? database-schema-update        Review    planning    View plan, approve or reject
  ! ci-pipeline-fix               Failed    work        "cargo test failed: 3 errors"
  ? api-endpoint-design           Questions planning    2 questions awaiting answers

# ACTIVE

  ~ auth-refactor                 Work      coding      Reading src/middleware/auth.ts
  ~ user-settings-page            Planning  planning    Analyzing requirements...
  ~ test-infrastructure           Breakdown breakdown   Creating 4 subtasks

# COMPLETED TODAY

  . database-migration            Done      12:34       3 files changed
  . api-rate-limiting             Done      11:20       7 files changed
```

- **The command bar is everything.** Type to filter tasks, execute actions, create tasks, search artifacts, run queries. `review auth` jumps to the auth task's review. `approve` approves the currently focused task. `new Fix the login bug` creates a task. Tab-completion for task names, stage names, actions.
- **Focus mode.** Pressing Enter on any task replaces the list with that task's full detail view -- artifacts rendered as markdown, diff shown inline, iteration history as a chronological log. Press Escape to return to the list.
- **Inline actions.** When a task needs review, the approve/reject interface appears inline below it -- no modal, no sidebar, no panel transition. Type feedback directly in the list view.
- **Split view.** One keyboard shortcut (Ctrl+\\) splits the view vertically. Left side shows the task list, right side shows the focused task detail. Another press closes the split. This replaces the panel/sidebar system entirely.

### Key Interactions
- **Everything is keyboard-navigable.** Mouse works, but the entire interface is optimized for keyboard. Tab, Shift+Tab, Enter, Escape, and a vim-like j/k/h/l navigation mode.
- **Command palette (Cmd+K)** is the universal entry point. Every action in the app is executable from here. The palette shows recent actions, suggested actions for the current context, and fuzzy search across everything.
- **Inline log streaming.** When an agent is working, its latest actions stream directly in the list view (the "Reading src/..." text updates in real time). No need to open a separate log panel to see what's happening.
- **Markdown-native.** Artifacts (plans, summaries, reviews) render as styled markdown directly in the flow. No separate "Artifacts tab" -- the content is just there.

### Personality
Precise. Fast. Uncompromising. The UI communicates "this is a power tool for people who know what they're doing." Designed for developers who live in the terminal and want their orchestration tool to feel the same way. No onboarding, no hand-holding, no decorative elements.

---

## Recommendation for Proposals

Each direction should be developed into a full proposal with:

1. **Color palette** -- Full token set (backgrounds, surfaces, text, borders, accents, semantic states)
2. **Typography scale** -- Font families, sizes, weights, line heights for each level
3. **Component inventory** -- How each current component maps to the new design
4. **Key screen mockups (HTML/CSS):**
   - Main view (list/board/canvas with multiple tasks in various states)
   - Task detail (focused view of a single task)
   - Review flow (approve/reject with artifact preview)
   - Agent activity (live streaming of what agents are doing)
5. **Interaction model** -- Navigation patterns, keyboard shortcuts, responsive behavior
6. **Animation spec** -- Motion principles, timing, easing curves

### Proposal Assignments

- **Proposal A (Direction A: "Mission Control")** -- Dense, data-rich, timeline-based
- **Proposal B (Direction B: "The Workshop")** -- Warm, spatial, card-based
- **Proposal C (Direction C: "The Terminal")** -- Minimal, text-first, keyboard-driven

Each proposal should feel like it was designed by someone with a strong opinion. No hedging, no "we could go either way." Pick a lane and commit to it.
