# Pulse — The Decision Inbox

## Core Idea

Orkestra mobile is an inbox you clear, not a dashboard you watch. Every card is a decision waiting to happen, and the reward is reaching zero.

## UX Philosophy

Mobile sessions start from a notification. The user has 15–60 seconds, a phone in one hand, and a specific intent: process what needs me and leave. Pulse is built entirely around this reality.

- **Default view is "Action"** — shows only tasks needing human input (questions, reviews, failures). Working and done tasks are one tap away in "All."
- **Inline actions** — Approve/Reject on review cards. Multiple-choice + text input on question cards. No navigation required for the most common actions.
- **Urgency ordering** — questions first (agent is literally blocked), then reviews, then failures. Sort order is the product's opinion about what matters.
- **"All caught up" empty state** — the app rewards you for clearing the queue. Inbox zero for agent orchestration.

## Visual Direction

Action cards: `bg-surface` + shadow. Compact working/done rows: `bg-surface-2` + flat. The background tint difference creates ambient hierarchy — your eye reads urgency from the surface brightness before reading any text.

Left-edge color stripes are the mobile translation of Orkestra's status-first desktop philosophy:
- `amber` → Review
- `blue` → Questions
- `red` → Failed/Blocked
- `pink-red` (accent) → Working
- `green` → Done
- `gray` → Waiting

## Screens

| File | What it shows |
|------|--------------|
| [`feed.html`](./feed.html) | Action filter active: review card, question card, failed card |
| [`detail.html`](./detail.html) | Full task detail: header + dot stepper + tabs + artifact content + sticky Approve/Reject footer |
| [`action.html`](./action.html) | Question answering: card in "answer selected" state, about to submit |

## Emotional Register

Decisive. Surgical. You are in command. Process fast, process well. When the queue is empty, feel the satisfaction of inbox zero. When something needs you, it's immediately obvious what to do.
