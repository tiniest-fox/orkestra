# Flux — The Living Feed

## Core Idea

A single feed whose visual rhythm breathes with the state of your work — tall and urgent where decisions are needed, compact and calm where things are running fine.

## UX Philosophy

The feed's visual rhythm IS the status communication. You don't need to read badges or section headers — the shape of the list tells you what's happening. Tall cards = needs you. Compact rows = running fine. When a task needs your attention, it literally grows. When you handle it, it shrinks back down.

The key departure from Pulse: Flux shows you everything in one feed, not just the action queue. This serves the developer who also wants to monitor — to watch agents work, see progress, feel the system moving. The "Action" filter is still default, but the "All" view is a first-class experience.

## Visual Direction

**Four card variants, each with a distinct height:**

| Variant | Height | Background | Shadow | Radius |
|---------|--------|------------|--------|--------|
| Action Card (review) | ~170px | `surface` | yes | 12px |
| Question Card | ~190px | `surface` | yes | 12px |
| Working Row | ~64px | `surface-2` | none | 10px |
| Done Row | ~48px | `surface` | none | 8px |

The height cascade in "All" view: TALL → TALL → compact → compact → compact → minimal. The feed literally narrows as urgency decreases.

Working rows have a pulsing pink-red left stripe (opacity 1.0 → 0.4, 2s loop) — the only animation in the entire UI, and it's meaningful: it tells you something is actively happening without any text.

## What Makes Flux Different from Pulse

- Pulse hides non-actionable tasks by default. Flux shows everything with different visual weight.
- Working rows include a live log line ("Reading schema.rs…") — ambient awareness of what the agent is doing.
- The action summary bar is a natural-language urgency sentence at the top when needed: "2 reviews, 1 question need your attention."
- The "All" filter is the signature screen — the full height cascade is a visual concept no other developer tool has.

## Screens

| File | What it shows |
|------|--------------|
| [`feed.html`](./feed.html) | Action filter: tall action/question cards + compact working rows |
| [`all.html`](./all.html) | "All" filter: the full mixed-height cascade with all card types |
| Detail view | Shared with Pulse — see [`../pulse/detail.html`](../pulse/detail.html) |

## Emotional Register

Calm confidence. Ambient awareness. Organic responsiveness. The app feels alive — things are moving, changing, progressing. You are the calm center of a productive system. The feed breathes.
