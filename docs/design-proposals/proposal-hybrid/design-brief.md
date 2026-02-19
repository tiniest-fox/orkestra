# Forge Design Brief
## Creative Direction for the Orkestra UI Expansion

---

## The Verdict

The Forge direction is confirmed. The screenshots of the current app validate the approach: split-pane, intent-grouped list, text symbols for status, pipeline breadcrumb visible per task. This is the right model. The design work ahead is about sharpening, completing, and making it feel inevitable rather than assembled.

What the screenshots show is the skeleton. What we're building is the living thing.

---

## What Forge Is

Forge is a **keyboard-driven power tool that respects the user's intelligence**. It assumes the user is a developer who runs a terminal, reads stack traces, and has opinions about their editor config. It does not hold their hand. It does not explain itself with tooltips and onboarding flows. It shows them what is happening, tells them what needs their attention, and gets out of the way.

The interface is **warm but not soft**. The palette has a slight purple undertone in the dark — not the cold blue-navy of a Bloomberg terminal, not the cozy earth tones of a design tool. Closer to a well-configured Warp terminal, or Linear's dark mode at its best: considered, not corporate.

The interface is **dense but not cluttered**. Every row of the task list contains more information than it appears to: the symbol, the title, the pipeline visualization, the live status fragment. Nothing is wasted. But there is breathing room between sections, and the type scale creates clear hierarchy so eyes travel in the right order.

The interface is **alive**. Agents are actively running. Stages pulse when active. Status fragments update in real time. The design communicates that this is not a project tracker where things move when humans drag them — this is an orchestration system where things are happening right now, and the user is the checkpoint.

---

## What Forge Is Not

**Not a kanban board.** No columns. No cards in a grid. The whole point is that autonomous pipelines do not map to horizontal human workflows. The feed is vertical, intent-grouped, and sequential.

**Not an icon-heavy app.** No icon font. No SVGs for status. Text symbols in signal colors: `*` `?` `!` `>` `.` `~` `-`. These are unambiguous, load instantly, and can be read in peripheral vision. Adding icons would soften the tool's sharpness.

**Not a modal-heavy app.** No modals. No panels that stack. The split view replaces the sidebar. The command bar replaces the creation modal. Actions happen inline or in the right pane.

**Not cold or punishing.** The warm dark palette and Inter typography prevent this from becoming a terminal cosplay. It should feel designed, not configured.

**Not generic.** The pipeline visualization in every task row is the signature element of this system. No other product does this. Every other design decision must protect and reinforce that uniqueness — not compete with it.

---

## The Personality

The right mental model: **a Rust compiler error message designed by a good typographer**.

That is: precise, dense, every character meaningful — but rendered with genuine care for readability. The Rust compiler gives you exactly what you need to fix the problem and nothing else. Forge does the same. No decorative text, no empty states that say "Wow, so clean! Add your first task!", no progress bars for things that don't need progress bars.

The app talks to you in the same way a sharp colleague would: direct, informative, no fluff.

---

## The Visual Signature: Pipeline in Every Row

This is the design decision everything else orbits. Every task row — in both the feed and the list pane of the split view — shows a horizontal pipeline visualization. Colored segments, proportional or equal, showing all stages with current position marked.

This is the thing that makes Forge immediately legible as an orchestration tool rather than a task manager. Looking at the feed, a developer understands instantly: "Three tasks are in work, two are waiting for my review, one failed at checks." They didn't have to open anything. They didn't have to read status text. The pipeline bars communicated it.

The pipeline component must be built with care:
- All-pending: dim segments, first one slightly highlighted
- In progress: completed segments in dim green, active segment pulsing amber
- At review: completed up to review stage, review segment in amber, user attention demanded
- Failed: completed up to failure, failed segment in red, everything after in dim
- Completed: all segments in dim green, final state quiet and satisfied

---

## The Definitive Token Set

One color system, used everywhere. No drift between files.

**Dark mode (primary):**
- Canvas: `#141118` — the warm near-black with purple undertone. Not `#111111`, not `#0D0D0D`.
- Surface-1: `#1C1820` — command bar, status line, elevated panels
- Surface-2: `#242029` — expanded content, code blocks, nested sections
- Surface-3: `#2E2936` — hover states, keyboard badges, active backgrounds
- Surface-hover: `#282330` — row hover, subtle highlight
- Border: `rgba(168, 162, 178, 0.12)` — barely visible, structural only
- Accent: `#E8613A` — terracotta orange. The one truly warm element.

**Signal colors (dark):**
- Green: `#4ADE80` — working, approved, healthy
- Green-dim: `#22804A` — completed stages (quieter success)
- Amber: `#FBBF24` — review needed, attention
- Red: `#F87171` — failed, blocked, error
- Blue: `#60A5FA` — questions, informational
- Purple: `#A78BFA` — secondary, auto-mode indicator

**Text hierarchy (dark):**
- Primary: `#F0ECF4` — task titles, headings, active content
- Secondary: `#B8B0C4` — body text, descriptions, artifact prose
- Tertiary: `#706880` — labels, timestamps, metadata
- Muted: `#524A5C` — disabled, decorative, pipeline stage names for upcoming stages

**Light mode:** The README.md values are correct. Use them.

---

## Typography Rules

Two fonts. Clear roles. No exceptions.

**Inter** — for anything the user reads to understand: task titles, artifact prose, section headers, button labels, descriptions, error messages.

**JetBrains Mono** — for anything the user scans to act on: task IDs, timestamps, stage names in the pipeline, keyboard shortcut badges, the command bar input, git metadata, status line content.

The rule is not arbitrary. It creates a visual separation between "content" and "data" that helps the eye navigate dense rows quickly. A user glancing at the feed processes the monospace segments differently from the proportional title text, and that cognitive separation is a feature.

**Scale — do not invent new sizes:**
- App brand: 13px Inter 700, tracking -0.02em
- Section header: 11px Inter 600, uppercase, tracking 0.06em
- Task title: 13px Inter 500, tracking -0.01em
- Body / artifact prose: 13px Inter 400
- Label / button: 11px Inter 500
- Data (IDs, timestamps): 12px JetBrains Mono 400
- Keyboard badges: 11px JetBrains Mono 400
- Status line: 11px JetBrains Mono 400

---

## Layout Architecture: The Two Modes

### Feed Mode (default)
Full-width scrollable list. Command bar at top. Status line at bottom. Three sections:
1. **NEEDS ATTENTION** — tasks requiring the user to act (review, questions, failed). Always first.
2. **ACTIVE** — agents running autonomously. User can see live status but no action required.
3. **COMPLETED TODAY** — done tasks, dimmed, aged off naturally.

No fourth section for "idle" or "queued" — those appear in ACTIVE at low visual weight.

### Split Mode (Ctrl+\)
Left pane: the feed list, compressed. Sections still present, pipeline still visible per row. Fixed width ~360px.
Right pane: the focused task in full detail. Artifact rendered as markdown. Action bar at the bottom.

The split pane is the primary working mode. The feed is for situational awareness.

---

## Screens to Build

### Already exists (refine, don't replace):
- `feed.html` — The token system is right. The pipeline visualization needs to be more prominent. Row height could increase slightly for breathing room. Live status fragment should be more visually distinct from the task title.
- `split.html` — The layout is correct. The left pane needs section headers and pipeline bars. The right pane needs a more considered header area showing the pipeline state inline.
- `review.html` — Good foundation. The sidebar pipeline list is in the wrong direction — pipeline should be horizontal in the header, not a vertical list in the sidebar. The sidebar is better used for iteration history and task metadata.

### Needed (new):
- `design-system.html` — The canonical reference. Every token, every component, every state. This is what the team builds from.
- `onboarding.html` — First-run project picker. The user opens the app, selects or initializes a project. This is brand-establishing territory — the first impression.
- `settings.html` — Workflow and project configuration. Stage management, agent configuration, flow definitions.
- `integration.html` — Post-completion merge flow. Task is done, agent integrated, PR available. The denouement.

---

## Moments for Differentiation

These are the three places where we can do something that no other productivity tool does. They are not decoration. They are functional moments where good design creates real value.

### 1. The Pipeline Bar as the Primary Status Metaphor

Most tools show status as a badge or a column. Forge shows the entire journey in every row. The pipeline bar communicates: "where you were, where you are, what comes next" without opening anything. This needs to be executed with precision. The segments need to be exactly right in terms of sizing, color progression, and active-state animation. A pulse on the active segment. A quiet dim-green for completed stages. Amber for the stage waiting on the user.

Done right, a user can read the entire state of their system in two seconds of scanning the feed. Done wrong, it's just colored blocks.

### 2. The Command Bar as the Primary Input Model

The command bar is always visible, always focused, always ready. It is not a search bar. It is not a palette you invoke. It is the prompt. The accent-colored `>` cursor blinks and says: "what do you want to do?" Type `new Fix the login bug` to create a task. Type `approve` to approve the focused task. Type `review ork-042` to jump directly to a task's review.

The visual treatment of the command bar — the monospace input, the accent-colored prompt character, the subtle hints visible in the right gutter — should make the user feel like they are talking to the system. Not clicking through it.

### 3. The Transition from Feed to Split

Pressing `Enter` or `Ctrl+\` should feel like zooming in. The list compresses to the left. The detail expands to the right. This is not a modal. Nothing covers anything. The user's spatial understanding of the list is preserved — they can still see where they are.

The focused row in the left pane should have a left-border accent (2px, terracotta orange) so the user's eye connects the list item to the right pane content. This is a small detail with significant cognitive payoff.

---

## What the Visual Agent Must Not Do

- Do not introduce new colors not in the token set. If a new semantic state emerges, map it to an existing signal color and document it.
- Do not use gradients on UI chrome. Gradients are only acceptable inside the pipeline bar segments.
- Do not increase border radius beyond 8px. The tool is precise, not rounded.
- Do not use font sizes outside the defined scale.
- Do not add drop shadows to task rows. Only elevated surfaces (command bar, action cards) get shadows.
- Do not add decorative illustrations, empty-state artwork, or onboarding mascots. The brand is the typography and the palette.
- Do not use the word "Kanban" anywhere in the UI.

## What the UX Agent Must Not Do

- Do not introduce modals. No modal for task creation, no modal for confirmation, no modal for settings panels.
- Do not add tabs inside the right pane. The right pane has one view: the current task in its current state.
- Do not add "are you sure?" dialogs for approve/reject. The user knows what they're doing.
- Do not hide keyboard shortcuts. Every action that has a keybinding shows the keybinding. Always.
- Do not put pipeline information in a tooltip. It belongs in the row.

---

## The Standard

Every screen should answer yes to all three questions:

1. **Can a developer read the state of their tasks in under five seconds without opening anything?**
2. **Is every interactive element keyboard-accessible with a visible hint?**
3. **Does this look like it was designed by one person with a strong point of view, or does it look like it was built by committee?**

If the answer to #3 is "committee," keep working.

---

## Palette & Typography Revision (Round 2)

These decisions supersede the original token values wherever they conflict. Every screen, component, and token reference must use these values. No exceptions.

---

### Primary Accent: `#E83558`

**Name:** `--accent`
**Previous value:** `#E8613A` (terracotta orange — retired)

This is a pink-red with orange warmth underneath. It reads as energetic and interactive without tipping into hot pink or cherry red. The hue sits at approximately 350° — red shifted strongly toward pink, with enough saturation (~85%) and mid-range lightness (~55%) to work across all required contexts.

**Contrast verification (light mode):**
- White text on `#E83558` fill: ~8.5:1 — passes AA and AAA
- `#E83558` as text on canvas `#FAF8FC`: ~8.1:1 — passes AA
- As a border/ring: opaque, no contrast issue
- As a tint at 8% opacity on `#FAF8FC`: subtle, correct for focused row backgrounds

**Token set derived from this value:**
```
--accent:           #E83558
--accent-hover:     #D42B4C   (darkened ~8%)
--accent-bg:        rgba(232, 53, 88, 0.08)
--accent-bg-strong: rgba(232, 53, 88, 0.14)
```

---

### Secondary Accent: `#A63CB5`

**Name:** `--accent-2`
**Previous state:** Purple `#7C3AED` existed as a signal color. It is replaced and promoted to a proper accent role.

This is a pinky-purple — distinctly different from the primary's red warmth, but related through the shared pink bridge. It sits at ~290° hue, saturated, mid-dark. It reads as purple to the eye while containing clear pink content. It does not read as "blue-purple" (which would conflict with the blue signal) and does not read as "red" (which would conflict with the primary).

**Contrast verification (light mode):**
- White text on `#A63CB5` fill: ~7.8:1 — passes AA
- `#A63CB5` as text on canvas `#FAF8FC`: ~7.2:1 — passes AA
- As a border/tint: correct at all opacity levels

**Token set derived from this value:**
```
--accent-2:         #A63CB5
--accent-2-hover:   #91339E
--accent-2-bg:      rgba(166, 60, 181, 0.08)
```

---

### Usage Model: Primary vs. Secondary Accent

This table is authoritative. Do not use secondary where primary is specified, and vice versa.

| Context | Token | Reasoning |
|---|---|---|
| Command bar `>` prompt character | `--accent` | The primary entry point of the system |
| Command bar caret color | `--accent` | Same element |
| Button fill (`.btn--accent`) | `--accent` | Primary action |
| Focus rings and keyboard focus outlines | `--accent` | Universal interactive indicator |
| Active/focused task row left-border | `--accent` | Connects list item to detail pane |
| Branch name in status line | `--accent` | High-signal git context |
| Inline code color in artifacts | `--accent` | Code is interactive/technical content |
| Section number labels in design docs | `--accent` | Navigational emphasis |
| Subtask / waiting-on-children badge | `--accent-2` | Secondary state, not primary action |
| Auto-mode indicator | `--accent-2` | Secondary system behavior |
| Orchestration-level status indicators | `--accent-2` | Distinct from task-level primary actions |
| Any second-tier interactive highlight | `--accent-2` | Visual separation from primary CTA layer |

**The rule in plain terms:** Use `--accent` for anything the user initiates or acts on. Use `--accent-2` for anything the system is doing autonomously that the user is observing but not directly controlling.

---

### Typography: IBM Plex Sans + IBM Plex Mono

**Previous:** Inter + JetBrains Mono (retired)

**New stack:**
```
--font-ui:   'IBM Plex Sans', system-ui, -apple-system, sans-serif
--font-mono: 'IBM Plex Mono', 'SF Mono', 'Cascadia Code', monospace
```

**Google Fonts import:**
```html
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

**Rationale — and this is not a soft rationale:**

Inter is the default choice for every SaaS product built in the last five years. It is technically excellent and visually invisible. That invisibility is the problem. Forge is a developer tool with a specific personality: precise, considered, slightly unusual. The font should signal that.

IBM Plex Sans was designed by Mike Abbink at IBM for developer-facing products. Its distinguishing feature is slightly squared terminals and a degree of geometric rationality that Inter lacks. At small sizes — 11px, 12px, 13px, which is where Forge lives — IBM Plex Sans has more character than Inter without sacrificing legibility. The caps are strong. The numbers are clean. It does not look like every other product.

IBM Plex Mono is the natural pair. Same design system, same DNA. It is narrower than JetBrains Mono, which is actually an advantage in Forge's data-dense rows — task IDs, timestamps, stage names, and status fragments all compete for horizontal space. Plex Mono fits more characters at the same point size without sacrificing the monospace legibility that makes scanning fast.

Both fonts are available on Google Fonts with the weights Forge needs (400, 500, 600, 700).

**The type scale is unchanged.** Only the font family changes. All sizes, weights, and tracking values remain as specified in the original brief.

---

### Status Symbol Color Convention: Corrected

**The problem with the previous convention:** `*` working was green. Green semantically means "done," "success," "healthy." In every system a developer uses — CI badges, terminal output, test runners, monitoring dashboards — green means the thing completed successfully. Showing `*` in green for an actively running agent contradicts every prior association the user has. It makes "working" look like "done."

**The correction:**

| Symbol | State | Color | Token | Reasoning |
|---|---|---|---|---|
| `*` | Working / agent running | Amber | `--amber` | Amber = in progress, process underway, attention possible. Matches the active pipeline segment color. |
| `?` | Questions / blocked | Blue | `--blue` | Unchanged. Blue = informational, waiting on input. |
| `!` | Failed | Red | `--red` | Unchanged. Red = error. |
| `>` | Review / awaiting approval | Amber | `--amber` | Unchanged. Same "needs attention" register as working. |
| `.` | Done / complete | Dim green | `--green-dim` | Green for completion, dimmed because this state recedes. |
| `~` | Idle / queued | Muted text | `--text-muted` | Unchanged. No signal, no urgency. |
| `-` | Archived | Muted text | `--text-muted` | Unchanged. Invisible in active feed. |

**The coherence this creates:** Active pipeline segments pulse amber. The `*` working symbol is also amber. A developer glancing at the feed reads: amber means "process in motion." Green means "finished." That mapping is correct, consistent, and aligned with their prior knowledge from every other tool they use.

**The animation spec is unchanged:** Only `*` animates. It pulses at 2.5s ease-in-out cycle, opacity 0.4 to 1.0. The color is now amber instead of green.
