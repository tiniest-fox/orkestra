# Orkestra Mobile — Design Proposals

Two concepts selected by the creative director after a full team research → UX → visual → creative direction pipeline.

## Process

1. **design-research** — Competitive analysis: Linear, GitHub Mobile, Vercel, Railway, PagerDuty, Slack. Identified four design directions.
2. **design-ux × 3** — Three UX specialists ran in parallel, each developing one direction independently (Triage Inbox, Card Stack, Adaptive Feed).
3. **design-visual × 3** — Three visual specialists specified exact component values for each concept in parallel.
4. **design-creative-director** — Evaluated all three with full team output, dropped Orbit, selected Pulse and Stack (reshaping Direction C), synthesized the final HTML brief.

---

## Selected Concepts

### [Pulse — The Decision Inbox](./pulse/)

> "Orkestra mobile is an inbox you clear, not a dashboard you watch."

The Action filter is the default view. Every card is a decision waiting to happen. Inline approve/reject and inline question-answering mean you never navigate to take the most common actions. The stripe-badge-button decision path (urgency → state → action) creates a visual reading sequence specific to this product. Emotional register: decisive, surgical, rewarding.

**Screens:**
| File | Description |
|------|-------------|
| [`feed.html`](./pulse/feed.html) | Action feed: review card, question card, failed card |
| [`detail.html`](./pulse/detail.html) | Task detail: dot stepper, tabs, artifact content, sticky Approve/Reject |
| [`action.html`](./pulse/action.html) | Question answering: option selected, Next button visible |
| [`diff.html`](./pulse/diff.html) | Diff view: file list with expanded unified diff, gutter line numbers |

---

### [Stack — The Focus Queue](./stack/)

> "Each task that needs you gets the whole screen. One card, one decision, full attention."

Full-screen immersive cards. The canvas is an active design element — it washes green on approve swipe, red on reject. Physics-based interaction with spring curves creates muscle memory. Visual asymmetry between Approve (accent fill) and Reject (muted border) encodes the happy path. Emotional register: calm focus, quiet confidence, deliberate decisiveness.

**Screens:**
| File | Description |
|------|-------------|
| [`focus.html`](./stack/focus.html) | Focus mode: full-screen approval card with pipeline dots, prose content, action bar |
| [`detail.html`](./stack/detail.html) | Task detail: same structure as Pulse, Stack-specific button styling |
| [`diff.html`](./stack/diff.html) | Diff view: unified diff with expanded file, gutter numbers, collapsed files |
| [`empty.html`](./stack/empty.html) | "All caught up" empty state — inbox zero moment, muted purple checkmark |

---

## What Was Rejected

**Orbit (Status Board)** — Grouped sections, stat bars, bottom tab bar, bottom sheets. Competent pattern assembly (the Linear/GitHub Mobile playbook) executed without a unifying creative idea. Two taps minimum to approve; Pulse does it in one. The activity tab is content that users scroll through once and never open again. The bottom tab bar is cargo-culting Linear for an app that has one primary screen.

**Direction D (Adaptive Feed / Flux)** — Best technical insight: variable card heights as a communication mechanism. But it's a technical architecture, not a creative concept. "A smart list that adapts" is a feature description, not a product opinion. Its best ideas were absorbed into both selected concepts: the variable-height card vocabulary is used in Pulse's "All" filter; the action summary bar appears in both; the stripe color transition animation is shared.

**Direction C standalone (Card Stack)** — The boldest concept, but Browse mode was underdeveloped (too generic), and the Focus/Browse binary toggle created a navigation problem. The creative director reshaped it as Stack: replaced the binary toggle with a 3-segment control (Focus/Browse/Done), upgraded Browse to use Pulse's card vocabulary, added Direction D's action summary bar to Browse.

---

## Design Decisions That Apply to Both

- **No bottom tab bar** — The 3-segment control (Action/All/Done or Focus/Browse/Done) is sufficient. One primary screen.
- **No bottom sheets for task preview** — Full-screen push only.
- **No slide-in drawers** — The desktop pattern doesn't translate at 375px.
- **No pipeline bar in the feed** — Stage name pill replaces it. The bar lives in the detail view's dot stepper.
- **Left-edge color stripe** — The mobile translation of Orkestra's status-first philosophy. 3px (Pulse) / 4px (Stack), urgency-mapped: amber=review, blue=questions, red=failed, pink-red=working, green=done, gray=waiting.
- **Action buttons always visible** — Never hover-reveal. Mobile assumes touch.
- **Question card as hero component** — Inline multiple-choice + text input, answerable without navigation. No existing developer tool does this.
- **Default to action-first** — Both concepts default to their action-oriented view. The research is unanimous: mobile is a notification handler, not a browsing experience.
- **Approve button distinction** — Pulse: purple (`#7c3aed`). Stack: accent pink-red (`rgb(232,53,88)`). Reject is always muted (no accent coloring) to create visual asymmetry favoring the happy path.

---

## Also Included

The [`flux/`](./flux/) directory contains an earlier iteration (Direction D developed independently before the creative director reshaped it). It's kept as reference — the variable-height card cascade in [`flux/all.html`](./flux/all.html) clearly demonstrates the concept that was partially absorbed into both selected concepts.
