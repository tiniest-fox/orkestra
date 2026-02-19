# Design Research: Inspiration, Patterns & Comps

Research into external design patterns and inspiration for rethinking the Orkestra UI.

---

## 1. Competitive Analysis: How Similar Tools Handle These Problems

### Linear (linear.app)

**What they do well:**
- **Extreme keyboard-first design** - Nearly every action is accessible via shortcuts; Cmd+K powers the whole app
- **Multiple view modes** - Board (kanban), list, and timeline views for the same data
- **Minimal color palette** - In 2025, Linear shifted to near-monochrome black/white with very selective bold accent colors (one primary color, used sparingly)
- **Issue detail as a centered modal/page** - Not a sidebar; issues open as full-width content with rich editing
- **Cycle/sprint visualization** - Timeline bars showing progress through time, not just stage columns
- **Sub-issues with inline expansion** - Nested issues expand inline rather than navigating to a new view
- **Smart grouping** - Issues can be grouped by status, assignee, priority, label, or cycle

**Relevant patterns for Orkestra:**
- Consider a list view alternative to kanban for dense task monitoring
- Linear's approach to sub-issues (inline expand) could replace Orkestra's secondary panel approach for subtasks
- Their color restraint is worth studying - the current Orkestra orange-to-purple stage palette is busier than needed

### GitHub Issues / GitHub Projects

**What they do well:**
- **Board, table, and roadmap views** - Same data, multiple presentations
- **Custom fields** - Metadata fields (priority, size, iteration) configurable per project
- **Sidebar detail view** - Issues open in a side pane when in board view, or full-page when navigated directly
- **Tight git integration** - PRs, branches, and commits linked directly in the issue timeline
- **Activity timeline** - Rich event stream mixing comments, status changes, code references, and automated events

**Relevant patterns for Orkestra:**
- GitHub's activity timeline pattern (mixing human and automated events) is close to what Orkestra needs for iteration history
- The table view would be valuable for monitoring many tasks at once
- Custom fields / metadata display is minimal and scannable

### Shortcut (formerly Clubhouse)

**What they do well:**
- **Stories grouped into Epics** - Visual parent-child relationship between work items
- **Workflow-based columns** - Custom workflow states per team
- **Iteration tracking** - Clear sprint/cycle boundaries
- **Story detail as a full modal** - Rich detail view that doesn't leave the board context

**Relevant patterns for Orkestra:**
- Epic-to-story grouping is analogous to parent-to-subtask in Orkestra
- Their modal approach for detail views preserves board context better than a sidebar

### Vercel Dashboard

**What they do well:**
- **Dev-first UX** - Respects developer time, no unnecessary decoration
- **Information density done right** - Dense data presented cleanly with consistent spacing
- **Deployment timeline** - Chronological view of builds/deployments with status indicators
- **Real-time status** - Build logs stream in real-time with clear success/failure states
- **Monochrome with semantic color** - Almost entirely grayscale, with color reserved exclusively for status (green=success, red=error, yellow=warning)

**Relevant patterns for Orkestra:**
- Vercel's deployment log viewer is a strong reference for Orkestra's agent logs
- Their monochrome-with-semantic-color approach could clean up Orkestra's visual hierarchy
- The deployment timeline pattern maps well to task iteration history

### Railway Dashboard

**What they do well:**
- **Project-based organization** - Multiple services managed in one project view
- **Canvas/graph view** - Services displayed as nodes in a spatial layout showing relationships
- **Beautiful, minimal UI** - Clean with excellent dark mode
- **Resource monitoring** - Real-time metrics displayed inline

**Relevant patterns for Orkestra:**
- Railway's canvas view could inspire a dependency graph view for subtasks
- Their approach to monitoring multiple concurrent processes is directly relevant

### Notion

**What they do well:**
- **Block-based composability** - Everything is a composable block
- **Fixed sidebar (224px)** - Predictable navigation
- **Database views** - Same data rendered as table, board, list, calendar, gallery, or timeline
- **Clean typography hierarchy** - Medium weight text, subtle color differentiation for primary vs. supporting content
- **Minimal UI chrome** - Controls appear on hover, keeping the resting state clean

**Relevant patterns for Orkestra:**
- Hover-to-reveal controls could reduce visual clutter on task cards
- Multiple database views (especially table/list alongside kanban) would be valuable
- Notion's sidebar width (224px) is notably narrower than Orkestra's 480px panels

---

## 2. UI Pattern Research

### Kanban Board Patterns

**Current best practices (from Dribbble/Behance analysis):**
- **Swimlane headers** should show count + optional summary metrics
- **Card density** varies: some designs show minimal info (title only) with detail on hover/click; others pack status, assignee, tags, dates
- **Column width** typically 280-320px
- **Vertical scrolling** within columns is standard
- **Drag-and-drop** remains the expected interaction (Orkestra doesn't have this since tasks move automatically)
- **Color coding** should be purposeful - stage color OR status color, not both simultaneously
- **Empty columns** should collapse or show placeholder state (Orkestra already does this well)

**Modern trend: Cards as status dashboards**
Rather than static cards, modern task cards function as mini-dashboards showing:
- Active agent/assignee with live indicator
- Progress through stages (mini pipeline visualization)
- Time elapsed / estimated
- Quick action buttons on hover

### Task Detail / Side Panel Patterns

**Common approaches:**
1. **Sidebar panel (480-600px)** - GitHub Issues, Jira. Preserves board context but limits detail space.
2. **Modal/dialog (centered, 60-80% viewport)** - Linear, Shortcut. More space, still preserves context.
3. **Full-page navigation** - Traditional approach. Maximum detail space, loses board context.
4. **Split pane** - VS Code style. Board on left, detail on right, resizable.

**Orkestra's current approach** (right sidebar, 480px) is reasonable but leads to panel stacking issues when subtask + diff panels are also open.

**Recommendation areas to explore:**
- Sliding modal (like Linear) that still shows the board underneath
- Tabbed workspace where board and detail are separate tabs (like browser tabs)
- Expandable card that grows in-place on the board

### Subtask/Hierarchy Visualization

**Patterns from the research:**
1. **Inline expansion** - Parent card expands to reveal children (Linear sub-issues)
2. **Nested list** - Indented list view showing parent-child (Asana)
3. **Progress bar on parent** - Orkestra already does this well
4. **Dependency graph** - DAG visualization showing subtask ordering (Railway canvas-like)
5. **Gantt/timeline** - Subtasks as bars on a timeline showing parallelism

**Orkestra's subtask handling** is currently a tab within the parent's detail sidebar + optional secondary panel. The subtask progress bar on the kanban card is effective.

### Approval Workflow Patterns

**Best practices from research:**
- **Clear visual hierarchy** between pending and completed approval steps
- **Color-coded status** - green (approved), amber (pending), red (rejected)
- **Progress tracker** showing where the item is in the approval pipeline
- **Inline action buttons** - Approve/reject available without navigation
- **Reason/feedback capture** - Rejection always requires a reason
- **Audit trail** - Full history of approval decisions visible

**Orkestra's current implementation** handles this well with the ReviewPanel footer. The pending rejection confirmation flow (reviewer auto-rejects, human confirms/overrides) is a sophisticated pattern.

### Log Viewer / Terminal Output Patterns

**Key findings:**
- **Streaming logs** should auto-scroll but allow manual scroll lock (Orkestra implements this)
- **Collapsible sections** help manage verbose output (Orkestra groups tool calls)
- **Syntax highlighting** for code blocks within logs
- **Timestamp display** - Optional, togglable
- **Search/filter** within logs (Orkestra doesn't have this yet)
- **Log level filtering** - Show/hide by severity
- **Full-screen mode** - Log viewer should be expandable to full viewport when needed

**Reference implementations:**
- Vercel's build log viewer: streaming, collapsible steps, clear success/failure
- SigNoz logs UI: structured log analysis with search and filter
- Logdy: real-time web-based viewer with TypeScript-powered filtering

### Code Diff Viewer Patterns

**Best practices:**
- **Unified and split views** - Both should be available; unified for quick review, split for detailed comparison
- **Syntax highlighting** per language
- **File tree navigation** - Collapsible left sidebar listing changed files
- **Inline comments** - Ability to add comments on specific lines (relevant for PR review)
- **Auto mode** - Unified for small diffs, split for large changes
- **Character-level diff** - Highlight exact changed characters within modified lines
- **Minimap** for large files

---

## 3. Design Trend Analysis (2025)

### Developer Tool Design Trends

1. **Monochrome + Semantic Color Only**
   - Linear, Vercel, and GitHub have all moved toward near-monochrome interfaces
   - Color is reserved exclusively for actionable status: success (green), error (red), warning (amber), info (blue)
   - Stage/category colors are desaturated or removed entirely
   - This makes status instantly scannable - if something has color, it needs attention

2. **Depth Through Subtle Shadows, Not Color**
   - Multi-layer, diffuse shadows create visual hierarchy
   - Orkestra already uses this pattern well with `shadow-panel`
   - Cards "float" above background with very subtle depth

3. **Glassmorphism / Translucency (Selective Use)**
   - Apple's "Liquid Glass" has mainstreamed translucent surfaces in 2025
   - Effective for overlay panels, modals, and floating UI
   - Not appropriate for data-dense views (readability concerns)
   - Could work well for Orkestra's command palette overlay or notification toasts

4. **Generous Whitespace, Tight Typography**
   - More padding between sections, less between related elements
   - Typography does the heavy lifting for hierarchy (weight, size) instead of color
   - Geist font (which Orkestra uses) is well-suited to this trend

5. **Progressive Disclosure**
   - Controls appear on hover; resting state is minimal
   - Secondary information is collapsed by default
   - "Show more" patterns rather than displaying everything upfront

6. **Dark Mode as First-Class**
   - Not an afterthought - some tools design dark-first
   - Dark backgrounds with very subtle borders instead of strong dividers
   - Orkestra already supports dark mode via system preference

### AI Agent UI Specific Trends

1. **Transparency and Explainability**
   - Visible "thought logs" showing agent reasoning
   - Clear indication of what the agent is doing and why
   - Orkestra's log viewer serves this role but could be more prominent

2. **Human-in-the-Loop Controls**
   - Clear intervention points (interrupt, redirect, approve)
   - Confidence indicators on agent decisions
   - Orkestra's review/approval/interrupt system is strong here

3. **Generative UI**
   - AI agents generating interface elements dynamically
   - Less relevant for Orkestra's orchestration focus

4. **Real-time Status Dashboard**
   - Live monitoring of agent processes, resource usage
   - At-a-glance health indicators
   - Orkestra's task cards serve as mini-dashboards but lack metrics (timing, cost)

---

## 4. Key Takeaways for Orkestra Redesign

### High-Impact Improvements

1. **Add a list/table view** alongside the kanban board. Kanban is great for visual workflow, but a dense list view is better for monitoring many tasks. Every major competitor offers multiple views.

2. **Reduce the color palette.** Move from the orange-to-purple stage gradient toward monochrome with semantic-only color. Status colors (failed=red, questions=blue, review=amber, done=green) are already effective; stage colors add visual noise without adding information.

3. **Rethink the panel stacking model.** Three simultaneous panels (board + task detail + subtask detail + diff) creates horizontal space problems. Consider:
   - Modal/overlay for task detail instead of sidebar
   - In-place expansion for subtasks
   - Dedicated "focus mode" that replaces the board entirely

4. **Add search and filter to the log viewer.** Every reference implementation highlights this as essential for developer tools.

5. **Surface agent timing and metrics.** Add duration, token/cost estimates, or elapsed time to task cards and iteration history. This is table-stakes for AI orchestration dashboards.

6. **Consider a timeline/activity view.** A vertical timeline showing all task activity (iterations, stage transitions, human actions) in chronological order would complement the kanban board view.

### Design Philosophy Recommendations

- **Monochrome + semantic color** (like Vercel/Linear 2025) instead of the current warm orange palette
- **Progressive disclosure** - show less by default, reveal on interaction
- **Dense but scannable** - optimize for information density without clutter
- **Keyboard-first** - the command palette is a great start; extend keyboard navigation throughout
- **Agent-transparent** - make agent activity visible and understandable at every level

### Component-Level Opportunities

| Component | Current | Opportunity |
|-----------|---------|-------------|
| **Task card** | Dense with many signals | Simplify resting state, progressive disclosure on hover |
| **Kanban columns** | Stage-colored dots | Replace with minimal headers, remove stage color |
| **Detail sidebar** | 480px fixed panel | Consider modal/overlay or expandable layout |
| **Log viewer** | Nested in sidebar tab | Add full-screen mode, search, filtering |
| **Subtask view** | Secondary panel (480px) | Inline expansion or modal |
| **Iteration indicator** | Colored squares strip | Consider a mini-timeline or sparkline |
| **Footer action panels** | Multiple exclusive panels | Unified action bar with contextual buttons |
| **Review panel** | Fixed 200px footer | Inline in detail view or floating action bar |

---

## 5. Reference Links

### Competitive Analysis
- [Linear - The system for product development](https://linear.app/)
- [Linear Concepts & Conceptual Model](https://linear.app/docs/conceptual-model)
- [Linear Board Layout Docs](https://linear.app/docs/board-layout)
- [Linear Design Trend (LogRocket)](https://blog.logrocket.com/ux-design/linear-design/)
- [GitHub Issues - Project Planning](https://github.com/features/issues)
- [Vercel Dashboard UX Analysis (Medium)](https://medium.com/design-bootcamp/vercels-new-dashboard-ux-what-it-teaches-us-about-developer-centric-design-93117215fe31)
- [Railway vs Vercel Comparison](https://ritza.co/articles/gen-articles/cloud-hosting-providers/railway-vs-vercel/)

### Design Patterns
- [Dribbble: Kanban Board Designs](https://dribbble.com/tags/kanban-board)
- [Dribbble: Task Management Dashboard](https://dribbble.com/tags/task-management-dashboard)
- [Dribbble: Project Management Dashboard](https://dribbble.com/tags/project_management_dashboard)
- [SaaS UI Workflow Patterns (curated GitHub gist)](https://gist.github.com/mpaiva-cc/d4ef3a652872cb5a91aa529db98d62dd)
- [Complex Approvals App Design (UXPin)](https://www.uxpin.com/studio/blog/complex-approvals-app-design/)
- [Approval Workflow Design Patterns (Cflow)](https://www.cflowapps.com/approval-workflow-design-patterns/)
- [Notion Sidebar UI Breakdown (Medium)](https://medium.com/@quickmasum/ui-breakdown-of-notions-sidebar-2121364ec78d)

### AI Agent UIs
- [AI Agents + Tools: The Practical Stack (Shinkai)](https://blog.shinkai.com/ai-agents-tools-in-2025-the-practical-stack-ui-runtimes-and-orchestration/)
- [UI Design for AI Agents (Fuselab)](https://fuselabcreative.com/ui-design-for-ai-agents/)
- [Designing Agentic Systems for Enterprise (Daito)](https://www.daitodesign.com/blog/agentic-systems)
- [A2UI: Agent-Driven Interfaces (Google)](https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/)
- [10 Best AI Agent Dashboards (TheCrunch)](https://thecrunch.io/ai-agent-dashboard/)

### Log Viewers & Dev Tools
- [SigNoz Logs UI](https://signoz.io/blog/logs-ui/)
- [Logdy Real-Time Log Viewer](https://logdy.dev/)
- [AI Agent Observability Tools 2026](https://research.aimultiple.com/agentic-monitoring/)

### Diff Viewers
- [Unified vs Split Diff (matklad)](https://matklad.github.io/2023/10/23/unified-vs-split-diff.html)
- [diff2html - Diff Rendering](https://diff2html.xyz/)
- [react-diff-viewer](https://github.com/praneshr/react-diff-viewer)

### Design Trends
- [Glassmorphism & Apple Liquid Glass 2025](https://www.everydayux.net/glassmorphism-apple-liquid-glass-interface-design/)
- [20 Modern UI Design Trends 2025 (Medium)](https://medium.com/@baheer224/20-modern-ui-design-trends-for-developers-in-2025-efdefa5d69e0)
- [15 UI/UX Design Trends 2025 (Tenet)](https://www.wearetenet.com/blog/ui-ux-design-trends)
- [Neumorphism vs Glassmorphism 2025](https://redliodesigns.com/blog/neumorphism-vs-glassmorphism-2025-ui-trends)

---

## 6. AI Agent Orchestration UI Patterns (2025)

The existing research draws from project management tools — Linear, GitHub, Notion. That's useful but insufficient. Orkestra isn't a project management tool that happens to use AI; it's an AI orchestration tool that happens to track tasks. The interaction model is fundamentally different. This section documents how tools that share Orkestra's actual domain — autonomous agents doing real work, humans reviewing and steering — have solved these problems in 2025.

---

### 6.1 The Competitive Landscape

**Devin 2.0 (Cognition)** — the clearest structural analog to Orkestra. Each task session runs in an isolated VM with a cloud-based IDE. The session list is a collapsible left panel; the right side is the active session's full environment: shell, browser, editor, and a conversation thread. The key insight from Devin's design: sessions are the primary object, not tasks. The session list shows status at a glance; clicking one takes you fully into that context. Devin also introduced MultiDevin — a manager agent plus up to 10 worker agents — where the UI shows the manager's plan and each worker's branch as a unit of work. This maps directly to Orkestra's parent/subtask model.

What Devin gets right: making the agent's workspace the center of gravity. What it doesn't solve well: monitoring many sessions simultaneously. The collapsible panel is not a dashboard; you can only watch one session at a time. This is Orkestra's opportunity.

**Cursor 2.0** — released October 2025, the multi-agent interface is the clearest production example of what "agents as objects" looks like in an IDE. A sidebar panel lists running agents by name, each showing status, active file, and output logs. Cursor supports up to 8 agents in parallel, each isolated to a git worktree. The sidebar is the management surface; the editor pane is where you inspect any individual agent's work. The tab metaphor (each agent gets a chat tab) allows quick switching without losing context.

What Cursor gets right: treating agents as named, manageable processes rather than ephemeral conversations. What it gets wrong: the sidebar is an IDE panel, not a purpose-built orchestration surface. It's added to a code editor rather than designed from scratch. The mental model is still "I'm a developer with AI assistance" rather than "I'm a director with AI workers."

**VS Code Agent HQ** (October–November 2025) — Microsoft's answer to Cursor 2.0. The Agent Sessions view is a unified sidebar showing all local, cloud, and background agents across Copilot, GitHub, and custom agents. Background agents run in isolated worktrees; the Agent HQ view shows which are active and lets you inspect, stop, or restart any of them. The November 2025 update brought background agents into the main chat UI, so you can monitor them without leaving the editor context. The "delegate from chat" pattern — a dropdown in the chat view that routes a request to a specific agent — is a notable micro-interaction: intent entry and agent routing happen in the same gesture.

What VS Code gets right: unifying heterogeneous agents (local, cloud, custom) under one management surface. What it gets wrong: it's still fundamentally an IDE with an agent layer bolted on. The Agent HQ experience is not differentiated enough from the file explorer — it's a list in a panel, not a first-class view.

**Windsurf (Codeium/Cognition)** — acquired by Cognition in 2025, positioning as "the next-generation agentic IDE." Its Cascade agent indexes the entire codebase, maintaining memory across sessions. The interaction model is conversation-first: a persistent chat pane where the agent explains what it's doing, asks questions, and requests confirmation. Windsurf's design emphasis is on the agent's reasoning being visible in the conversation thread — tool calls appear as collapsible inline blocks within the chat, not in a separate log panel.

What Windsurf gets right: embedding tool execution trace inside the conversation rather than relegating it to a log tab. The user sees a complete narrative: "I'm going to do X" → [tool call block] → "I did X, here's what I found." What it gets wrong: conversation-first doesn't scale to managing 10 parallel tasks. At high task counts, a chat thread per task becomes overwhelming.

**Claude Code** — terminal-first, intentionally minimal UI. The main interaction is a streaming conversation with tool use visible inline. No separate task management layer. The design is opinionated: if you want a dashboard, build one on top. Claude Code is the clearest example of prioritizing agent capability over management UI. Its adoption by Orkestra as the default agent provider means Orkestra is effectively the dashboard layer that Claude Code explicitly declined to build.

**Warp** — the clearest reference for Orkestra's split-pane design, not because Warp does agent orchestration, but because it figured out how to make a content-dense terminal feel spacious. Warp's key contribution: the "block" abstraction. Each command + its output is a block — selectable, copyable, shareable. The AI works in its own pane with the same block structure. The visual result is that even highly verbose output feels navigable because it has clear boundaries. For Orkestra, this translates directly to the log viewer: agent actions should be blocks, not a raw stream.

---

### 6.2 The Convergent Pattern: Sessions as Objects

Every tool in this space has independently arrived at the same structural decision: the agent session (or task) must be a first-class, named, persistent object that can be monitored, paused, redirected, and compared against other sessions. This is not obvious — the earlier generation of AI tools treated each conversation as ephemeral and stateless.

The practical UI consequence: session lists with status at a glance. Every tool has one. The differentiator is not whether you have a session list, but what information density you provide in that list and how you handle the transition from list to detail.

Cursor and VS Code both converge on a sidebar list with a detail area. Devin uses a collapsible panel with a full-screen detail. None of them have solved the "manage 10 things at once" problem well, because they're all building on top of an existing editor paradigm that wasn't designed for orchestration. This is Orkestra's structural advantage: the feed-with-inline-status model (the Forge concept) is designed from scratch for orchestration, not retrofitted.

---

### 6.3 Status Visualization: What Works Beyond Spinners

The research reveals a clear hierarchy of status communication effectiveness, from worst to best:

**Spinners** — universally used, universally insufficient. They communicate "something is happening" but nothing about what, how far along, or whether it's healthy. Every tool starts here and graduates away from it.

**Status text with activity description** — Cursor, Devin, and Warp all show a live activity string: "Analyzing auth.rs", "Running tests", "Writing to 3 files". This is substantially more useful than a spinner because it communicates intent. The failure mode: text updates can feel noisy and anxious if they change too frequently.

**Pipeline/stage visualization** — the most information-dense format. Orkestra's current iteration strip (and Forge's pipeline bar) are ahead of most tools here. No major competitor shows stage-level progress inline in a task list. This is a genuine differentiator worth doubling down on.

**Event stream / activity feed** — LangSmith, Langfuse, and AgentOps (observability tools) render agent execution as a hierarchical trace: the top-level task contains nested spans for each tool call, LLM generation, and retrieval step. This is the richest format, but it requires a dedicated view. The key insight from observability tooling: nested spans communicate parent-child execution relationships that flat logs cannot. For Orkestra's log viewer, hierarchical collapsible sections (stage → iteration → tool calls) would be more scannable than a flat stream.

**The pulse/breathing indicator** — a pattern that's emerging specifically for background agents: a subtle animated indicator (not a spinner) that breathes slowly to show the agent is alive without demanding attention. Cursor uses this for background agents. It's a significant UX improvement over a static status badge because it distinguishes "working normally in background" from "idle" without creating visual urgency.

The practical recommendation for Orkestra: the Forge concept's text-based status symbol (`*`, `?`, `!`, `>`) combined with a live activity string in the feed row is already the right direction. The addition worth considering: a subtle pulse animation specifically on the `*` symbol for active agents, as Forge's README specifies but which is worth reinforcing as the most important single animation in the system.

---

### 6.4 Human-in-the-Loop: The State of the Art

The most thorough current analysis is Smashing Magazine's February 2026 piece "Designing For Agentic AI: Practical UX Patterns For Control, Consent, And Accountability." It identifies five production-proven patterns organized by when in the agent lifecycle they apply.

**Pre-action: Intent Preview.** Before any significant irreversible action, the agent presents a plain-language plan with sequential steps and explicit choice: Proceed / Edit / Handle Myself. This is non-negotiable for actions involving file writes, API calls, or state changes. Devin implements this as the initial plan review; Claude Code's Plan Mode (read-only inspection before execution) is the same pattern. The key design requirement: the preview must be specific enough to be meaningful. "I'm going to make some changes" fails. "I'm going to modify 4 files to extract JWT validation into a middleware layer" passes.

**In-action: Explainable Rationale.** While the agent works, show the "why" using a "Because X, I'm doing Y" structure — not a technical log, but a justification grounded in the user's stated goals. This is what makes the difference between agent output that feels like a black box and output that feels like a junior developer explaining their work. Windsurf's inline tool call blocks approach this; they show what the agent did but not always why.

**In-action: Confidence Signal.** Surface the agent's uncertainty where it's relevant to the human's decision. LangSmith and similar observability tools show this as a quality score; Smashing's article recommends scope declarations ("I'm 90% confident about the authentication changes; the caching layer is less certain"). For Orkestra's review flow, this maps to the artifact quality signal in the plan review step — the agent could flag which parts of its plan it's less certain about.

**Post-action: Dissolving UI.** This is a specific anti-double-click pattern: once a human takes an approval or rejection action, the action buttons immediately replace themselves with a static record of the decision ("Approved by Christian at 14:32"). This prevents race conditions and creates an implicit audit trail. It's a small but important detail in the review flow.

**Post-action: Action Audit and Undo.** A chronological log of all agent-initiated actions with undo where reversible. The key design detail: time-limited undos with transparent expiry. "Undo available for 30 minutes" is better than silently removing the undo option. This is most relevant for Orkestra's post-integration state — what did this task actually change, and can any of it be reversed?

**The Autonomy Dial.** Multiple sources identify this as the emerging meta-pattern: a per-task or per-stage setting for how autonomous the agent should be, ranging from "Observe & Suggest" through "Plan & Propose" through "Act with Confirmation" to "Act Autonomously." Orkestra's current auto-mode toggle is the simplest version of this. The more nuanced implementation would allow different autonomy levels per stage — fully autonomous for planning, confirmation-required for code changes, mandatory human review before integration.

---

### 6.5 Split-Pane Interface: Best-in-Class Lessons

**Zed** — the most technically sophisticated split-pane implementation. Panes are a tree data structure; splits can happen in any direction and nest arbitrarily. The interaction model is keyboard-first (Cmd+K followed by arrow direction to split). Zed's design insight: the split ratio is user-controlled by dragging the divider, and double-clicking the divider resets to 50/50. This is a tiny affordance but it matters — it tells the user the divider is interactive without requiring documentation. For Orkestra's split view (list left, detail right), making the divider draggable with a reset affordance is worth the implementation cost.

**Warp** — AI in its own pane. The pane metaphor works because Warp treats AI and terminal as peers, not as primary/secondary. The AI pane has the same visual language as the terminal pane. This avoids the common mistake of making the AI panel feel like an overlay or sidebar — it's a first-class workspace. For Orkestra's split view, the detail pane should feel as substantial as the list pane, not like a flyout attached to it.

**VS Code** — the reference for "persistent split that survives navigation." In VS Code, splitting the editor creates two independent panes that can navigate independently. This is relevant for Orkestra: in split view, the right detail pane should be able to show a different task than the one selected in the left list, allowing comparison or independent navigation. Most tools don't do this — selection in the list always forces the detail view. Allowing detail pane independence (even just remembering the last-viewed task when you navigate the list) is a small feature with high power-user value.

**Linear's focus mode** — not a split pane, but worth noting for what it eliminates. Linear's focus mode removes the sidebar entirely, giving the selected issue full width. The implication: the best split-pane interfaces also have a full-focus mode. Orkestra's Forge concept handles this with the `ctrl+\` toggle; the point is that toggling between views should be instant and effortless, not a navigation event.

The common thread across all best-in-class split-pane implementations: the split ratio is user-configurable, the divider is visually obvious without being distracting, keyboard shortcuts exist for everything, and there's always an escape hatch to full-focus on one side.

---

### 6.6 Observability Tools as UI Reference

LangSmith, Langfuse, and AgentOps are not direct competitors to Orkestra — they're developer-facing observability tools for debugging agent pipelines. But they've solved the "show what an agent did, in what order, with what results" problem more rigorously than any orchestration UI has.

The key pattern from all three: **nested trace visualization**. A run is the top level. Inside it are spans — one per agent step, tool call, or LLM generation. Spans can be expanded to show inputs, outputs, latency, and token count. The visual hierarchy (indentation + connecting lines) makes the execution order and parent-child relationships immediately clear.

This maps directly to Orkestra's log viewer design problem. The current implementation has log entries in a flat stream. The opportunity: structure the log as a hierarchy — stage → iteration → tool calls — with collapsible sections at each level. The iteration level would show duration and outcome (approved/rejected). The tool call level would show the tool name, arguments, and result. Expanded by default only for the most recent iteration; collapsed for history.

AgentOps adds one more pattern worth noting: **session replay**. Rather than just showing a log, AgentOps can replay an agent session at variable speed, showing exactly what the agent saw and did at each moment. This is overkill for Orkestra's current stage, but the underlying insight is important: the log should be a navigable timeline, not just a scroll. Adding timestamps to each log entry and making them anchor links (so you can share a URL to a specific point in an agent session) is the lightweight version of this.

---

### 6.7 Differentiation Opportunities

Based on the competitive landscape, here are the specific gaps where Orkestra can be distinctively better:

**1. The only orchestration-first interface.** Every competitor builds agent management on top of a code editor or chat interface. Orkestra is the only product where the orchestration view is the native, designed-from-scratch primary surface. The Forge feed concept — intent-grouped sections, pipeline bars in every row, status symbols without icons — is not just different aesthetically. It's a fundamentally different mental model: you are a director, not a developer. Lean into this. Don't add an editor pane. Don't add a chat pane. Own the orchestration layer completely.

**2. Multi-task visibility at scale.** No tool does a good job of letting you see the state of 10 parallel agents simultaneously. Cursor's sidebar gets cluttered. Devin's session panel is not a dashboard. Orkestra's feed model — where each row is a complete status snapshot with a pipeline bar — can show 20 tasks in the viewport simultaneously, each with meaningful status. This requires the pipeline bar to work hard. The active stage should pulse; the `*` symbol should be the most visually distinct element when work is happening. The feed is the differentiator; invest in making it dense and scannable without being noisy.

**3. Approval and review as a first-class surface.** Every tool treats the review step as a modal or a conversation continuation. None of them have a dedicated, designed review flow with artifact rendering, iterative rejection history, and clear approve/reject affordances. Orkestra's review panel (and Forge's inline review in the detail pane) is already more considered than anything in the competitive space. The key improvement: make the artifact the dominant visual element in review, with the approve/reject actions as secondary chrome. Most tools invert this — the action buttons are prominent and the artifact is something you scroll to see.

**4. The question-answering flow.** When an agent asks a clarifying question mid-task, every tool handles this as a chat message with a text reply. Orkestra's question form panel (numbered questions, input fields, batch answer submission) is a structurally better design — it treats a question as a structured data request rather than a conversational exchange. This is a small thing that signals product sophistication to users who encounter it.

**5. Rejection history as learning signal.** Orkestra tracks iterations — every rejection, every feedback message, the agent's response. No competitor surfaces this as a coherent timeline. The iteration history in the Forge detail view (compact list of iterations with outcome badges) is uniquely useful: it lets the human reviewer see whether the agent is getting closer or drifting. Surface the iteration delta clearly — "This is iteration 3. Previous feedback asked for X; this artifact now addresses X but introduced Y." The agent doesn't produce this summary, but the UI can show the feedback from iteration 2 alongside the artifact from iteration 3.

**6. Autonomy configuration per stage.** Multiple sources cite the "autonomy dial" as the emerging meta-pattern, but no tool has shipped a clean implementation for a multi-stage workflow. Orkestra's workflow system — configurable per stage — is the right architecture for this. The UI opportunity: in the task creation flow or task settings, show the pipeline with per-stage autonomy toggles. "Auto-approve planning? Always / First time / Never." This makes Orkestra's existing auto-mode feature feel designed rather than bolted on.

---

### 6.8 What to Avoid

**Don't build an embedded code editor.** The temptation will grow as users ask for it. Resist. The moment Orkestra adds an editor pane, it becomes a worse Cursor. The value proposition is orchestration, not editing. Users have VS Code or Zed for that.

**Don't default to chat-first.** The chat interface is fine for Q&A with the assistant, but it's the wrong primary surface for task management. Windsurf and Claude Code's conversation-first design works because they're single-task tools. Orkestra manages multiple tasks in parallel; a chat thread per task doesn't scale to the multi-task view.

**Don't add confidence percentages without calibration.** The "Confidence Signal" pattern from Smashing is appealing but dangerous if the percentages are arbitrary. An uncalibrated confidence score destroys trust faster than no score at all. If Orkestra surfaces agent confidence, it should come from the agent's own output (e.g., the agent flags uncertainty in its plan artifact) rather than being computed from metadata.

**Don't make the intervention flow punishing.** The most common failure mode in human-in-the-loop systems is making human review so expensive (so many clicks, so much context-switching) that users skip it. The Forge design avoids this by putting the artifact and the approve/reject in the same view. Preserve this. Any redesign of the review flow that adds navigation steps is a regression.

---

### 6.9 Reference Links (AI Orchestration, 2025)

- [Devin 2.0 Launch — Cognition](https://cognition.ai/blog/devin-2)
- [Cursor 2.0 Multi-Agent Interface — lilys.ai](https://lilys.ai/en/notes/cursor-20-20251106/cursor-new-multi-agent-interface)
- [VS Code Unified Agent Experience (Nov 2025)](https://code.visualstudio.com/blogs/2025/11/03/unified-agent-experience)
- [VS Code Agent HQ Announcement — Visual Studio Magazine](https://visualstudiomagazine.com/articles/2025/11/12/vs-code-1-106-adds-agent-hq-new-security-controls.aspx)
- [VS Code Background Agents Documentation](https://code.visualstudio.com/docs/copilot/agents/background-agents)
- [10 Things Developers Want from Agentic IDEs — RedMonk](https://redmonk.com/kholterhoff/2025/12/22/10-things-developers-want-from-their-agentic-ides-in-2025/)
- [Designing For Agentic AI: Practical UX Patterns — Smashing Magazine](https://www.smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/)
- [Beyond Generative: The Rise of Agentic AI — Smashing Magazine](https://www.smashingmagazine.com/2026/01/beyond-generative-rise-agentic-ai-user-centric-design/)
- [Design Patterns For AI Interfaces — Smashing Magazine](https://www.smashingmagazine.com/2025/07/design-patterns-ai-interfaces/)
- [Designing for Autonomy: UX Principles for Agentic AI — UXmatters](https://www.uxmatters.com/mt/archives/2025/12/designing-for-autonomy-ux-principles-for-agentic-ai.php)
- [Agentic AI UI/UX Patterns — Agentic Design](https://agentic-design.ai/patterns/ui-ux-patterns)
- [7 UX Patterns for Human Oversight in Ambient AI Agents](https://www.bprigent.com/article/7-ux-patterns-for-human-oversight-in-ambient-ai-agents)
- [Human-in-the-Loop in Agentic Workflows — Orkes](https://orkes.io/blog/human-in-the-loop/)
- [AG-UI Interrupt-Aware Run Lifecycle](https://docs.ag-ui.com/drafts/interrupts)
- [LangSmith AI Agent Observability Platform](https://www.langchain.com/langsmith/observability)
- [Langfuse — Open Source LLM Observability](https://langfuse.com/)
- [AgentOps and LangSmith Observability Compared](https://www.akira.ai/blog/langsmith-and-agentops-with-ai-agents)
- [Warp: The Agentic Development Environment](https://www.warp.dev/)
- [Warp Split Pane Tree Data Structure](https://www.warp.dev/blog/using-tree-data-structures-to-implement-terminal-split-panes-more-fun-than-it-sounds)
- [Agent-Native Development: Devin 2.0 Technical Design](https://medium.com/@takafumi.endo/agent-native-development-a-deep-dive-into-devin-2-0s-technical-design-3451587d23c0)
