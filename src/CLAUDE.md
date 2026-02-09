# Frontend Guidelines

## Component Structure

- One exported component per file, named to match the file (PascalCase).
- Small subcomponents that only serve one parent are fine in their own file alongside it.
- Nest component directories to reflect hierarchy. If `TaskDetail` contains `ArtifactsTab`, `DetailsTab`, etc., those live in `components/TaskDetail/`.
- Import sibling components directly (`import { ArtifactsTab } from "./ArtifactsTab"`), not through barrel exports. Barrel exports (`index.ts`) are only for the `ui/` design system.

## Logic and Hooks

- Keep component files focused on rendering. Extract complex logic (data fetching, form state, derived computations) into hooks.
- Component-specific hooks live alongside the component they serve, in the same directory.
- Shared hooks (used by multiple components) go in `hooks/`.
- Name hooks `useXxx.ts` — the hook name should describe what it provides, not what it wraps.
- **If a hook needs shared state across components** (multiple components calling the hook must see the same data), convert it to a context provider in `providers/`. Regular hooks create isolated state per call—providers create shared state. See `TasksProvider` and `AssistantProvider` for the pattern.

## State Management

- Use the existing Context + hooks pattern (`TasksProvider`, `WorkflowConfigProvider`, `DisplayContextProvider`). No Redux, Zustand, or other state libraries.
- Access shared state via the provider hooks (`useTasks()`, `useWorkflowConfig()`, `useDisplayContext()`). Don't prop-drill shared data.
- **Navigation state** goes through `DisplayContextProvider`. It manages two dimensions: `View` (main content area — board, future archive/git views) and `Focus` (side panel — task, subtask, create form, or nothing). All UI transitions (clicking task cards, command palette results, close buttons) route through its methods (`focusTask`, `focusSubtask`, `closeFocus`, etc.). Don't manage navigation with local state.
- Local UI state (open/closed, selected tab, form inputs) stays in the component via `useState`.

## Styling

- Tailwind classes only. No CSS modules, styled-components, or inline style objects.
- Use the project's custom design tokens: `stone-*` (neutrals), `orange-*` (accent), semantic colors (`info`, `warning`, `error`, `success`), `panel` border radius and shadows.
- Dark mode is via `darkMode: 'media'` (system preference). Use `dark:` variants where needed.

## UI Components

- Use the existing design system in `components/ui/` — `Panel`, `Button`, `Badge`, `IconButton`, `TabbedPanel`, `ModalPanel`, etc.
- The `Panel` component uses compound subcomponents: `Panel.Header`, `Panel.Body`, `Panel.Footer`, etc.
- For modal/overlay UI (dialogs, palettes, popovers anchored to the viewport), use `ModalPanel`. It renders via `createPortal` to `document.body` with backdrop, animations, and escape-to-close built in. Don't introduce competing portal or overlay patterns.
- Icons come from `lucide-react`. Animations use `framer-motion`.

## Panel Layout System

**The canonical pattern for all slide-in panels**: `PanelLayout` + `Slot` components control layout and animation for every panel that slides in and out (task detail, create form, assistant, session history, diff viewer).

### What it is

- **`PanelLayout`** — Container that manages a CSS grid for all panels. Lives in `Orkestra.tsx`.
- **`Slot`** — Animated grid slot that registers itself and handles transitions via grid template changes. Each panel content goes inside a `Slot`.
- **Visibility state** — Controlled by `DisplayContext` focus state flowing to the `visible` prop on each `Slot`. The `Slot` manages opacity, pointer-events, and grid sizing. Content inside always renders; the `Slot` handles show/hide.

### The rule

Every panel that slides in/out MUST be a `Slot` inside the `PanelLayout` in `Orkestra.tsx`. No exceptions.

### Anti-patterns (banned)

- **No `absolute`/`fixed` positioning for slide-in panels** — this bypasses the layout system and breaks animation consistency.
- **No `framer-motion` `AnimatePresence` or manual transitions** for panel visibility — `Slot` handles all animations.

### How visibility works

1. User action triggers `DisplayContext` method (e.g., `openAssistant`, `focusTask`, `toggleAssistantHistory`)
2. Context updates focus state (e.g., `{ type: "assistant", showHistory: true }`)
3. Parent derives boolean: `const historyVisible = focus.type === "assistant" && focus.showHistory === true`
4. **Conditionally render children**: `<Slot visible={historyVisible}>{historyVisible && <Component />}</Slot>`
5. `Slot` animates grid sizing and opacity. When closing, content stays visible during fade-out animation via `displayedContent`, then unmounts via `onTransitionEnd` callback. This ensures cleanup effects run and panels reset state on reopen.

### The three panel primitives

- **`Panel`** — Visual container (rounded corners, borders, padding). Use for content structure.
- **`Slot`** — Animated layout slot in the grid. Use for positioning and show/hide animation.
- **`ModalPanel`** — Viewport overlay (dialogs, command palette). Use for content that anchors to the viewport, not the grid.

When building a slide-in panel: wrap `Panel` inside `Slot`. For viewport overlays: use `ModalPanel` directly.

### Reference

- **Canonical example**: `Orkestra.tsx` — shows all Slots (assistant-history, assistant, sidebar, subtask, diff, subtask-diff, board)
- **Implementation**: `components/ui/PanelContainer/` — `PanelLayout.tsx` and `Slot.tsx`
- **Event-driven cleanup pattern**: `Slot` uses `onTransitionEnd` to detect when fade-out completes, then calls `setDisplayedContent(null)` to unmount the child tree. This is more reliable than `setTimeout` since it responds to actual transition completion, not hardcoded durations.

## Types

- Use `import type` for type-only imports.
- Workflow domain types live in `types/workflow.ts`.
- Don't duplicate backend types — the Tauri bindings generate TypeScript types from Rust.

## Testing

- Tests use Vitest + React Testing Library.
- Test files sit alongside the component: `Component.test.tsx`.
- **jsdom limitations**: The test environment doesn't implement all DOM APIs. If a component uses `scrollIntoView()`, `IntersectionObserver`, or other browser-specific APIs, mock the component in parent component tests to prevent runtime errors. See `Orkestra.test.tsx` for the pattern.
