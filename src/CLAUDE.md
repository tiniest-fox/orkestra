# Frontend Guidelines

## Component Structure

- One exported component per file, named to match the file (PascalCase).
- Small subcomponents that only serve one parent are fine in their own file alongside it.
- Nest component directories to reflect hierarchy. If `TaskDetail` contains `ArtifactsTab`, `DetailsTab`, etc., those live in `components/TaskDetail/`.
- Import sibling components directly (`import { ArtifactsTab } from "./ArtifactsTab"`), not through barrel exports. Barrel exports (`index.ts`) are used for the `ui/` design system and component groupings with multiple related exports (e.g., `SyncStatus/`, `Kanban/`).

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

### DOM Observation Pattern (Callback Ref + useState)

When building hooks that observe DOM elements (auto-scroll, resize detection, mutation tracking), use a **callback ref + useState** to track the element reference. This makes `useEffect` re-run when the element changes, which is critical for attaching/detaching observers.

```tsx
const [container, setContainer] = useState<HTMLDivElement | null>(null);
const containerRef = useCallback((node: HTMLDivElement | null) => {
  setContainer(node);
}, []);

useEffect(() => {
  if (!container) return;

  const observer = new MutationObserver(() => {
    // React to DOM changes...
  });

  observer.observe(container, { childList: true, subtree: true });

  return () => observer.disconnect();
}, [container]); // Effect re-runs when element changes
```

**Why this pattern:**
- `useRef` doesn't trigger effect re-runs when `.current` changes (React doesn't track ref mutations)
- Callback ref + state ensures effects re-attach observers when the element reference changes
- Combine with `MutationObserver` + `requestAnimationFrame` for reliable DOM-change reactions

**Common use case:** Auto-scroll hooks that need to scroll after DOM content changes. `MutationObserver` detects content additions, `requestAnimationFrame` ensures scroll happens after browser layout completes.

**Example:** See `useAutoScroll.ts` for the canonical implementation

## State Management

- Use the existing Context + hooks pattern (`TasksProvider`, `WorkflowConfigProvider`). No Redux, Zustand, or other state libraries.
- Access shared state via the provider hooks (`useTasks()`, `useWorkflowConfig()`). Don't prop-drill shared data.
- Local UI state (open/closed, selected tab, form inputs, drawer visibility) stays in the component via `useState`.

## Styling

- Tailwind classes only. No CSS modules, styled-components, or inline style objects.
- Use the project's Forge design tokens: `canvas`, `surface-*`, `text-primary/secondary/tertiary/quaternary`, `accent-*`, `status-*`, `border`. These are native Tailwind tokens defined in `tailwind.config.js`.
  - **Border radius tokens**: `rounded-panel` (12px) for structural panels, `rounded-panel-sm` (8px) for smaller containers. For chat-like UI elements (messages, bubbles), `rounded-2xl` (16px) is acceptable to differentiate conversational UI from structural panels.
  - **Verify token names before using them.** Only classes defined in `tailwind.config.js` generate CSS. For example, status colors use `status-*` tokens (e.g., `bg-status-success`, `text-status-error`) — there are no `success-*`, `error-*`, `info-*`, or `warning-*` tokens. When in doubt, check `tailwind.config.js` first.
- **Light mode only**: The project is light-mode only. Do not add `dark:` variant classes.
- Use `PROSE_CLASSES` from `utils/prose.ts` for markdown rendering.

## Forge Design System

<!-- compound: unthinkingly-inventive-dugong -->

Forge is the project's design language — it is not an alternate or scoped visual language. It uses IBM Plex fonts, a warm purple-undertone palette, and pink-red accent (`accent`/`accent-*`). All components use Forge tokens by default.

**Animation coupling:** Keyframe names (`pipe-active-pulse`, `forge-pulse-opacity`) are coupled by string between `index.css` and TSX files with no compile-time check. Be careful when renaming them.

## UI Components

- Use the existing design system in `components/ui/` — `Panel`, `Button`, `Badge`, `IconButton`, `TabbedPanel`, `ModalPanel`, etc.
- The `Panel` component uses compound subcomponents: `Panel.Header`, `Panel.Body`, `Panel.Footer`, etc.
- For modal/overlay UI (dialogs, palettes, popovers anchored to the viewport), use `ModalPanel`. It renders via `createPortal` to `document.body` with backdrop, animations, and escape-to-close built in. Don't introduce competing portal or overlay patterns.
- Icons come from `lucide-react`. Animations use `framer-motion`.

## Slide-in Drawer Pattern

<!-- compound: rustically-discrete-lion -->

The current pattern for slide-in panels (git history, assistant) uses `Drawer` from `components/ui/Drawer/Drawer.tsx`. It uses absolute positioning to overlay the feed from the right while leaving a strip of the main content visible.

**Pattern:**
1. Add a boolean `useState` to `FeedView` (or the relevant parent) for open/closed: `const [assistantOpen, setAssistantOpen] = useState(false)`
2. Render `<Drawer open={open} onClose={() => setOpen(false)}>` with the panel content inside
3. Wire entry points (button, hotkey, command bar) to `setOpen(true)`, ensuring mutually exclusive drawers close each other: `setGitHistoryOpen(false); setAssistantOpen(true)`
4. Update `FeedStatusLine` to show the correct hotkey hint for the open drawer

**Canonical examples:** `GitHistoryDrawer.tsx` and `AssistantDrawer.tsx`

For viewport overlays (dialogs, command palette): use `ModalPanel` instead.

## Feed Row Action Buttons

<!-- compound: messily-dazzled-jellyfish -->

When adding action buttons inside clickable rows (e.g., `FeedRow`, `FeedTaskRow`), **always call `e.stopPropagation()` before the action handler**. Without it, the click bubbles to the row's `onClick`, triggering both the action and the row navigation (e.g., opening the drawer).

```tsx
onClick={(e) => {
  e.stopPropagation();
  onApprove();
}}
```

The `FeedRowActions.tsx` "View" button demonstrates this pattern. All new action buttons in row components must follow it.

## Biome Lint Gotchas

<!-- compound: tightly-prudent-motmot -->

**`useKeyWithClickEvents` on non-semantic elements**: Biome requires a `onKeyDown` handler alongside every `onClick`, even on `tabIndex={-1}` divs/spans where keyboard nav is intentionally handled elsewhere (e.g., by a parent input). Use a no-op `onKeyDown={() => {}}` to satisfy the rule — do not use `biome-ignore` (it's invalid inside JSX prop position).

```tsx
// Keyboard nav handled by parent input; no-op satisfies biome rule
<div onClick={handleSelect} onKeyDown={() => {}} tabIndex={-1}>
  {label}
</div>
```

## Types

- Use `import type` for type-only imports.
- Workflow domain types live in `types/workflow.ts`.
- Don't duplicate backend types — the Tauri bindings generate TypeScript types from Rust.

## Testing

- Tests use Vitest + React Testing Library.
- Test files sit alongside the component: `Component.test.tsx`.
- **jsdom limitations**: The test environment doesn't implement all DOM APIs. If a component uses `scrollIntoView()`, `IntersectionObserver`, or other browser-specific APIs, mock the component in parent component tests to prevent runtime errors. See `Orkestra.test.tsx` for the pattern.

### Default Expansion State Tests

<!-- compound: modishly-courageous-beagle -->

When changing `defaultExpanded` props on `CollapsibleSection` components, update test assertions comprehensively:

1. **Remove obsolete user interactions**: If a section starts expanded, remove the `userEvent.click()` calls that previously expanded it.
2. **Update visibility assertions**: Content that was previously `not.toBeInTheDocument()` should now use `toBeInTheDocument()`.
3. **Check all test files**: Search for text content from the affected section (e.g., `getByText("alice")` for Reviews) to find ALL tests that assume the old state.

Common mistake: Updating tests that directly interact with the changed section but missing tests that indirectly check visibility (like "renders sections collapsed by default" tests).

**Example from task modishly-courageous-beagle:**
- Changed Reviews section from collapsed → expanded by default
- Required updating 5 tests across multiple test blocks
- First iteration only updated 2 tests (direct interaction tests)
- Second iteration updated 1 more test
- Third iteration caught the remaining 2 tests
