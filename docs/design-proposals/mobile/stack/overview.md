# Stack — The Focus Queue

## Core Idea

Each task that needs you gets the whole screen. One card, one decision, full attention. Process and advance. The app breathes when your queue is clear.

## UX Philosophy

No developer tool gives each task the full screen. Linear, GitHub, Jira — they are all list-first. Stack says: this task deserves your full attention. Read the plan. Understand what the agent did. Then decide. The full-screen card is respect for the decision, not just the data.

The canvas is an active design element. The warm lilac background is not passive wallpaper — it washes green when you swipe to approve, red when you reject. It celebrates when your queue empties. The background has an emotional state.

Navigation: **Focus / Browse / Done** (segmented control). Focus is the card stack. Browse is the full task list (using Pulse's card vocabulary — action cards for things needing attention, compact rows for working tasks). Done is completed work.

## What Makes Stack Different

- **Full-screen immersion** — 16px viewport inset, 16px border-radius. The card is a physical object, not a row in a table. Title at 20px/600. Body at 16px/24px line height. Nothing is cramped.
- **Canvas as responsive negative space** — washes green during approve swipe, red during reject. "All caught up" empty state is just the canvas with a quiet purple checkmark. The background of the app has an emotional state.
- **Physics-based interaction** — spring curves (damping 0.7, stiffness 300). Cards tilt max 4° when dragged. Haptic at threshold. Users feel the commit point in their thumb before they see it.
- **Visual asymmetry between buttons** — Approve uses accent fill, Reject uses muted border. The UI encodes the happy path. Not by hiding Reject — by making Approve visually heavier.
- **"All caught up" uses muted purple (#9B8ACA), not green** — Purple is brand. Green would imply task completion (a task state). This detail reveals design thinking.

## Browse Mode

Stack's Browse mode is Pulse's feed. Action cards (tall, with inline approve/reject) for tasks needing attention. Compact rows for working tasks. This means leaving Focus mode doesn't feel like a different app — the visual language is consistent.

## Visual Direction

- Card: `bg-surface`, 16px radius, 4px left stripe (wider than Pulse's 3px — the card is bigger), `shadow-lg`
- Dark mode: edge-lit cards (`1px inset rgba(255,255,255,0.04)` top+left) instead of drop shadows
- Action bar: `backdrop-blur-md bg-canvas/80` — indicates it's a persistent overlay, not part of the card
- Pipeline dots in header: 6px, completed purple, current accent with pulse ring, future hollow
- Stack indicator ("2 of 5") floats on canvas above card — ambient, not navigational

## Screens

| File | What it shows |
|------|--------------|
| [`focus.html`](./focus.html) | Focus mode: full-screen approval card with pipeline dots, prose content, action bar |
| [`empty.html`](./empty.html) | "All caught up" empty state — the inbox-zero moment |
| Detail view | Shared with Pulse — see [`../pulse/detail.html`](../pulse/detail.html) |

## Emotional Register

Calm focus. Quiet confidence. Deliberate decisiveness. You are not scanning a list — you are considering one thing at a time. The app clears distractions. When the queue empties, the canvas reward state is a moment of genuine calm. The emotional arc: focused attention → decisive action → quiet satisfaction.
