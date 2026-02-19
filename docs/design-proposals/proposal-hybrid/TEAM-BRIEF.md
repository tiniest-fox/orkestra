# Hybrid Design Expansion — Team Brief

## Context

Orkestra is a Tauri desktop app (React/TypeScript) for orchestrating AI coding agents. Users create tasks, agents plan and implement them, humans review at checkpoints. The UI currently has:
- Kanban board + slide-in sidebar panels
- Orange accent (#F04A00), stone neutrals, Geist font
- Task cards with state icons, iteration strips, subtask progress

## What Already Exists

The `proposal-hybrid/` directory has a set of HTML mockups for the "Forge" concept — a synthesis approach that's keyboard-driven, info-dense, and warm. The `README.md` defines the full design system. Key files:
- `index.html` — concept overview
- `feed.html` — main task feed (intent-grouped: Needs Attention / Active / Completed)
- `split.html` — split-pane view (list left, detail right)
- `review.html` — review flow
- `questions.html` — Q&A flow
- `logs.html` — log viewer
- `diff.html` — code diff viewer
- `subtasks.html` — subtask management
- `task-detail.html` — focused task view
- `create.html` — task creation
- `monitoring.html` — monitoring state
- `failed.html` — failure state
- `preview.html` — preview/artifact

## Direction

**Expand and refine the hybrid/Forge concept into a production-quality design spec.**

The screenshots from the current app show a split-pane layout that's cleaner than the current kanban. This is the right direction — keep it. The expansion should:

1. Establish a definitive, rigorous design system (tokens, components, states)
2. Add missing screens and flows that make the concept feel complete
3. Improve the visual polish and realism of key screens
4. Document patterns so they're consistent across all screens

## Design System Summary

**⚠️ DIRECTION CHANGE: Light mode only. No dark mode. Ignore the dark palette in README.md.**

The screenshots from the current app show a clean light UI — warm white background, dark text, colored accents. This is the right call. Dark mode adds complexity without benefit for this tool right now.

**Palette (light mode only) — Round 2 values, supersede all earlier references:**
- `canvas`: `#FAF8FC` (warm off-white, slight purple undertone)
- `surface-1`: `#FFFFFF` (elevated panels, sidebars)
- `surface-2`: `#F4F0F8` (nested content, code blocks, expanded sections)
- `surface-3`: `#EBE6F0` (hover states, keyboard badges, active items)
- `border`: `#E4DFE9` (structural borders)
- `accent`: `#E83558` (pink-red — interactive elements, focus rings, command prompt; replaces `#E8613A`)
- `accent-hover`: `#D42B4C`
- `accent-bg`: `rgba(232, 53, 88, 0.08)`
- `accent-2`: `#A63CB5` (pinky-purple — secondary/autonomous system states, subtask badges, auto-mode)
- `accent-2-bg`: `rgba(166, 60, 181, 0.08)`
- Signals: green `#16A34A`, amber `#D97706`, red `#DC2626`, blue `#2563EB`
- Text: primary `#1C1820`, secondary `#6B6078`, tertiary `#9890A4`

**Accent usage rule:** Use `--accent` (pink-red) for anything the user initiates or acts on. Use `--accent-2` (pinky-purple) for anything the system is doing autonomously that the user is observing.

**Typography — Round 2, replaces Inter + JetBrains Mono:**
- UI: IBM Plex Sans (labels, headings, buttons, artifact prose)
- Data: IBM Plex Mono (IDs, timestamps, code, stage names, keyboard badges, command input)
- Google Fonts import: `IBM+Plex+Sans:wght@400;500;600;700` and `IBM+Plex+Mono:wght@400;500;600`
- Rationale: IBM Plex was designed for developer-facing products; has more character than Inter at small sizes without sacrificing legibility; Plex Mono is narrower than JetBrains Mono and fits Forge's data-dense rows better.

**Status symbols (text-based, no icons) — Round 2 color corrections:**
- `*` **amber** = working (agent running — amber = in motion, matches active pipeline segment; green was wrong because green reads as "done")
- `?` blue = questions (blocked, waiting on user input)
- `!` red = failed (error, requires attention)
- `>` amber = review (awaiting approve/reject)
- `.` dim-green = done (complete, recedes visually)
- `~` muted = idle (queued, not yet started)
- `-` muted = archived (invisible in active feed)

**Layout:**
- Feed (grouped list) or split-pane (list left, detail right)
- Persistent command bar at top, status line at bottom
- No panels/sidebars/modals competing for space

## Screens Needed (gap analysis)

Missing or underdeveloped:
1. **`design-system.html`** — Full token/component reference (colors, type, buttons, states, pipeline component, symbols)
2. **`onboarding.html`** — Project picker screen (the first thing a user sees)
3. **`settings.html`** — Workflow/project settings view
4. **`integration.html`** — Post-completion flow (merge/PR/archive)
5. Refinements to: `feed.html`, `review.html`, `split.html` — more realistic content, better visual craft

## Key Design Decisions (preserve these)

- **No kanban** — Feed is intent-grouped, not stage-grouped
- **No icons** — Status via text symbols + color
- **No panels stacking** — Split view replaces panel competition
- **Pipeline in every row** — Horizontal stage progress visible without expanding
- **Keyboard-first** — Every action has a keybinding shown in the UI
- **Light palette only** — Warm off-white canvas, no dark mode

## Collaboration

Write artifacts to `docs/design-proposals/proposal-hybrid/`. Coordinate via this file — update the "Status" section below as work completes.

## Status

- [x] Design system reference (`design-system.html`) — light palette applied
- [x] Onboarding screen (`onboarding.html`)
- [x] Integration/merge flow (`integration.html`) — 6 states
- [x] Refined feed (`feed-refined.html`)
- [x] Refined split view (`split-refined.html`)
- [x] Refined questions screen (`questions-refined.html`)
- [x] Creative direction notes (`design-brief.md`)
- [x] UX flow documentation (`ux-flows.md`)
- [x] Research updated (`design-research.md`) — AI orchestration UI patterns 2025
- [ ] Settings screen (`settings.html`) — not yet built
