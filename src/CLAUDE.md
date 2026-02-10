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

### Lazy Loading Pattern (Avoiding Reactive Loops)

When implementing on-demand data fetching triggered by state changes, use a `useRef<Set<T>>` to track requested items **outside the dependency array**. This prevents infinite loops where fetching updates state, which triggers the effect, which fetches again.

```tsx
const [items, setItems] = useState<Item[]>([]);
const [details, setDetails] = useState<Map<string, Detail>>(new Map());
const requestedIdsRef = useRef<Set<string>>(new Set());

useEffect(() => {
  const missing = items
    .map(item => item.id)
    .filter(id => !requestedIdsRef.current.has(id));

  if (missing.length === 0) return;

  // Mark as in-flight BEFORE async call
  for (const id of missing) requestedIdsRef.current.add(id);

  fetchDetails(missing)
    .then(result => setDetails(prev => new Map([...prev, ...result])))
    .catch(err => {
      // Remove failed IDs so they can be retried
      for (const id of missing) requestedIdsRef.current.delete(id);
    });
}, [items]); // Only items in deps, NOT requestedIdsRef or details
```

**Key points:**
- Dependency array includes only the trigger state (`items`), not the ref or result state
- Mark items as requested BEFORE the async call to prevent duplicate requests
- Remove failed items from the ref so they retry on next trigger
- See `GitHistoryProvider.tsx` for the canonical example

## State Management

- Use the existing Context + hooks pattern (`TasksProvider`, `WorkflowConfigProvider`, `DisplayContextProvider`). No Redux, Zustand, or other state libraries.
- Access shared state via the provider hooks (`useTasks()`, `useWorkflowConfig()`, `useDisplayContext()`). Don't prop-drill shared data.
- **Navigation state** goes through `DisplayContextProvider` via a preset-based system. Each user action (clicking a task, opening git history, toggling assistant) maps to a named preset that defines which components occupy the three layout slots: `content` (main area), `panel` (primary sidebar), and `secondaryPanel` (nested sidebar). All presets are defined in `providers/presets.ts` as the single source of truth. All UI transitions route through the provider's methods (`showTask`, `showSubtask`, `toggleGitHistory`, `closeFocus`, etc.). Don't manage navigation with local state.
- Local UI state (open/closed, selected tab, form inputs) stays in the component via `useState`.

## Styling

- Tailwind classes only. No CSS modules, styled-components, or inline style objects.
- Use the project's custom design tokens: `stone-*` (neutrals), `orange-*` (accent), semantic colors (`info`, `warning`, `error`, `success`), `panel` border radius and shadows.
  - **Border radius tokens**: `rounded-panel` (12px) for structural panels, `rounded-panel-sm` (8px) for smaller containers. For chat-like UI elements (messages, bubbles), `rounded-2xl` (16px) is acceptable to differentiate conversational UI from structural panels.
- **Dark mode pattern**: Always use `light-value dark:dark-value` for all color classes. Never hardcode only light or only dark colors. Dark mode is via `darkMode: 'media'` (system preference).
  - Text: `text-stone-700 dark:text-stone-300` (600-700 for light, 200-300 for dark)
  - Backgrounds: `bg-stone-50 dark:bg-stone-900` (50-100 for light, 800-900 for dark)
  - Borders: `border-stone-300 dark:border-stone-700` (200-300 for light, 600-700 for dark)
  - Accents: `text-orange-600 dark:text-orange-400` (600 for light, 400 for dark)
- Use `PROSE_CLASSES_LIGHT` from `utils/prose.ts` for markdown rendering - it includes dual-mode variants. Don't use `PROSE_CLASSES_DARK`.

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
