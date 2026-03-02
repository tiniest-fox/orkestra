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
  - **Arbitrary opacity values are valid** (Tailwind v3.4+ JIT): `opacity-45`, `opacity-30`, etc. are all valid — JIT generates them on demand. They are NOT limited to the standard scale (0, 25, 50, 75, 100). Don't flag arbitrary opacity values in review.
- **Dark mode uses system preference**: The project uses `prefers-color-scheme: dark` for automatic dark mode. All Forge design tokens are CSS variables that flip automatically — no extra work needed when using token classes like `bg-canvas`, `text-primary`, `bg-surface-2`, etc. For standard Tailwind palette colors that don't map to a Forge token (stone, amber, purple in `taskStateColors.ts` / `stageColors.ts`), pair with an explicit `dark:` variant class (e.g. `bg-stone-300 dark:bg-stone-600`). Tailwind's `darkMode: 'media'` is configured so `dark:` variants respond to `prefers-color-scheme`.
- **Forge tokens used with opacity modifiers must be defined as RGB channels**: Tailwind's `/N` opacity modifier syntax (e.g. `bg-accent/40`, `text-status-error/60`) requires the CSS variable to be defined as space-separated RGB channels (`"R G B"`) rather than a hex string. Hex values silently break opacity — the class is applied but opacity has no effect. Affected tokens (accent, status-success, status-error, status-warning, status-info, violet, teal, merge) are already defined in the correct format in `tailwind.config.js`. When adding a new Forge token, check whether it will ever be used with `/N` and define it accordingly: `"--forge-my-token": "120 80 200"` not `"#7850C8"`.
- Use `PROSE_CLASSES` from `utils/prose.ts` for markdown rendering. Always pair with `text-forge-body` for font size — never use arbitrary values like `text-[13px]` alongside `PROSE_CLASSES`.

## Forge Design System

<!-- compound: unthinkingly-inventive-dugong -->

Forge is the project's design language — it is not an alternate or scoped visual language. It uses IBM Plex fonts, a warm purple-undertone palette, and pink-red accent (`accent`/`accent-*`). All components use Forge tokens by default.

**Animation coupling:** Keyframe names (`pipe-active-pulse`, `forge-pulse-opacity`) are coupled by string between `index.css` and TSX files with no compile-time check. Be careful when renaming them.

## UI Components

<!-- compound: freely-exquisite-chicken -->

**Button `className` overrides and CSS specificity**: The `Button` component concatenates classes with a plain string join (not `twMerge`). When you pass a `className` prop to override variant styles (e.g. hover colors), CSS specificity is determined by Tailwind's CSS generation order — not the order of classes in the HTML attribute. If your override and the variant's class have equal specificity, the result is unpredictable. Options when you need reliable overrides: (1) add `onAccent` prop if the button sits on an accent-colored background (it switches the hotkey badge and other internal styles), (2) create a dedicated variant in `Button.tsx` rather than overriding via `className`, or (3) wait for a `twMerge` migration.

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

## Error Surfacing in Action Handlers

<!-- compound: prodigally-forgiving-ibex -->

`useTaskDrawerState.ts` contains a pre-existing `invokeAndClose` helper that silently swallows backend errors (logs to `console.error` but does not update any error state). **Do not use `invokeAndClose` for new action handlers that need to surface errors to the user.**

For new handlers that users care about (e.g., submitting feedback, line comments), handle the error explicitly and store it in a `useState` error variable that the UI renders:

```tsx
const [error, setError] = useState<string | null>(null);

const handleAction = useCallback(async () => {
  if (loading) return;
  setLoading(true);
  setError(null);
  try {
    await invoke("workflow_action", { taskId: task.id });
    onClose();
  } catch (err) {
    setError(String(err));
    setLoading(false);
  }
}, [task.id, loading, onClose]);
```

See `submitLineCommentsForReview` / `submitLineCommentsForDoneTask` in `useTaskDrawerState.ts` for the reference pattern.

## Biome Lint Gotchas

<!-- compound: tightly-prudent-motmot -->

**`useRegexLiterals` auto-converts `new RegExp()` to literal form**: Biome's `useRegexLiterals` rule automatically rewrites `new RegExp("pattern")` to `/pattern/` literal syntax. If constructor form is required (e.g., to avoid escape conflicts with another lint rule), use `// biome-ignore lint/nursery/useRegexLiterals: <reason>` on the preceding line. Without the suppression, the automated formatter reverts the constructor form on every gate run, making the fix unstable.

<!-- compound: finally-idealistic-linnet -->

**`useKeyWithClickEvents` on non-semantic elements**: Biome requires a `onKeyDown` handler alongside every `onClick`, even on `tabIndex={-1}` divs/spans where keyboard nav is intentionally handled elsewhere (e.g., by a parent input). Use a no-op `onKeyDown={() => {}}` to satisfy the rule — do not use `biome-ignore` (it's invalid inside JSX prop position).

```tsx
// Keyboard nav handled by parent input; no-op satisfies biome rule
<div onClick={handleSelect} onKeyDown={() => {}} tabIndex={-1}>
  {label}
</div>
```

## Gate Execution Data Model

<!-- compound: veritably-soaring-kinkajou -->

Gate output is **not** stored as log entries. Gates store their output in `iteration.gate_result` (a `{ lines: string[], exit_code: number }` object on the iteration) — not via the agent session log system. Consequently, `workflow_get_latest_log` returns nothing while a gate is running; you must read `task.iterations` directly.

- **Find latest gate output**: reverse-search `task.iterations` for the most recent entry where `gate_result != null`
- **Detect gate running**: check `task.state.type === "gate_running"` (already present on `WorkflowTaskView`)
- **Reference pattern**: `DrawerGateTab.tsx` shows how to find the relevant gate iteration and render its output lines

## Task Status Predicates

<!-- compound: dully-maximum-sunbeam -->

`isActivelyProgressing` in `utils/taskStatus.ts` is a **header-metric-scoped** predicate — it excludes `integrating` because the header displays integrating tasks in a separate count. It is NOT a universal "is this task doing something" check.

**Callers that need `integrating` included** (e.g., showing UI for any in-flight task) must add an explicit guard:

```tsx
// Correct pattern when you need both
task.state.type === "integrating" || isActivelyProgressing(task)
```

Using `isActivelyProgressing` alone in contexts that previously handled `integrating` will silently drop those tasks. See `FeedRowActions.tsx` for the reference pattern.

## Types

- Use `import type` for type-only imports.
- Workflow domain types live in `types/workflow.ts`.
- Don't duplicate backend types — the Tauri bindings generate TypeScript types from Rust.

## Testing

- Tests use Vitest + React Testing Library.
- Test files sit alongside the component: `Component.test.tsx`.
- **jsdom limitations**: The test environment doesn't implement all DOM APIs. If a component uses `scrollIntoView()`, `IntersectionObserver`, or other browser-specific APIs, mock the component in parent component tests to prevent runtime errors. See `Orkestra.test.tsx` for the pattern.
- **`@tanstack/react-virtual` renders 0 items in jsdom**: The virtualizer measures DOM element heights to determine which items to render. In jsdom there are no layout measurements, so `virtualItems` is always empty. Tests that exercise virtualizer-dependent behavior (`scrollToFile`, active-path tracking, `onActivePathChange` callbacks) are impractical in unit tests — document them as requiring manual verification and focus test coverage on the hook or logic layer instead (e.g., `useAutoCollapsePaths.test.ts` tests the collapse logic without touching the virtualizer).

## Keyboard Navigation

<!-- compound: beauteously-liberal-pollock -->

Use `useNavHandler` from `HotkeyScope` for keyboard shortcuts instead of raw `window.addEventListener`. Raw listeners bypass scope isolation — they fire regardless of which drawer or panel is focused, and they won't benefit from future hotkey system updates.

```tsx
// Avoid
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.key === "j") selectNext();
    if (e.key === "k") selectPrev();
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}, []);

// Prefer — respects HotkeyScope isolation
useNavHandler({ onNext: selectNext, onPrev: selectPrev });
```

### Pure Utility Module Tests

<!-- compound: enormously-solid-whippet -->

Pure utility modules (functions with no React/DOM dependencies) must have a unit test file alongside them (`utility.test.ts`). These modules carry the correctness burden for their callers and are easy to exercise in isolation with Vitest.

```ts
import { describe, expect, it } from "vitest";
import { myUtil } from "./myUtil";

describe("myUtil", () => {
  it("handles normal case", () => {
    expect(myUtil("input")).toBe("expected");
  });
});
```

**Example:** `optionKey.ts` / `optionKey.test.ts`.

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
