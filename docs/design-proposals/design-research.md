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
