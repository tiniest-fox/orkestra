# Frontend Guidelines

## File Headers

TypeScript and TSX files use a plain `//` comment for the file-level header — not `//!`, which is Rust doc-comment syntax with no equivalent in TypeScript. A one-line `// Description of what this file does.` at the top is sufficient and correct.

## Component Structure

- One exported component per file, named to match the file (PascalCase).
- Small subcomponents that only serve one parent are fine in their own file alongside it.
- Nest component directories to reflect hierarchy. If `TaskDetail` contains `ArtifactsTab`, `DetailsTab`, etc., those live in `components/TaskDetail/`.
- Import sibling components directly (`import { ArtifactsTab } from "./ArtifactsTab"`), not through barrel exports. Barrel exports (`index.ts`) are used for the `ui/` design system and component groupings with multiple related exports (e.g., `SyncStatus/`, `Kanban/`).

<!-- compound: disloyally-adoring-baboon -->

**`ProjectList.tsx` enumerates props explicitly**: `ProjectList.tsx` passes each `ProjectRowActions` prop to `ProjectRow` by name (`onStart={actions.onStart}`, `onStop={actions.onStop}`, etc.) rather than spreading `{...actions}`. When adding a new prop to `ProjectRowActions`, you must add a corresponding line in `ProjectList.tsx` — it won't fail at compile time if you forget because the prop is optional, but the callback will be silently undefined.

## Logic and Hooks

- Keep component files focused on rendering. Extract complex logic (data fetching, form state, derived computations) into hooks.
- Component-specific hooks live alongside the component they serve, in the same directory.
- Shared hooks (used by multiple components) go in `hooks/`.
- Name hooks `useXxx.ts` — the hook name should describe what it provides, not what it wraps.
- **If a hook needs shared state across components** (multiple components calling the hook must see the same data), convert it to a context provider in `providers/`. Regular hooks create isolated state per call—providers create shared state. See `TasksProvider` and `AssistantProvider` for the pattern.

### Notification Permission (Browser API)

Never call `Notification.requestPermission()` on component mount in browser/PWA mode — Chrome flags this as abusive and can trigger a Google Safe Browsing block on the domain. The call must be deferred to an explicit user gesture (button click).

Tauri is the exception: native notification dialogs are not web API calls and are safe to request on mount. Use `import.meta.env.TAURI_ENV_PLATFORM` to distinguish: it is a non-empty string in Tauri and an empty string in browser/PWA.

```ts
const isTauri = Boolean(import.meta.env.TAURI_ENV_PLATFORM);

// Auto-request only in Tauri (native dialog, not flagged by Safe Browsing)
useEffect(() => {
  if (isTauri) requestPermission();
}, []);

// Browser/PWA: permission is requested only on explicit user action
const handleEnableClick = () => requestPermission();
```

See `hooks/useNotificationPermission.ts` for the canonical implementation.

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

### Resetting Refs on Prop Change

When a hook has multiple refs tracking internal request or display state (e.g., `hasFetchedOnceRef`, `diffShaRef`, `requestedIdsRef`), **all of them must be reset** in the same effect that reacts to the key prop (e.g., `taskId`) changing. Partial resets cause stale state from the previous value to bleed through — for instance, suppressing the loading spinner on the first fetch of a new task or briefly flashing the old data.

```ts
useEffect(() => {
  // Reset ALL tracking refs, not just the data ref
  diffShaRef.current = null;
  hasFetchedOnceRef.current = false;
  setDiff(null);
}, [taskId]);
```

Pattern: collect every ref that tracks "have I fetched / what did I fetch last" and reset them together as a unit when the identity prop changes.

### Cursor Ref + Array State Must Reset Together

When a hook maintains a cursor or position ref alongside a data array, clearing the array (e.g., on error via `setState([])`) **must also reset the cursor ref to its initial value**. If only the array is cleared, the next fetch requests entries "after cursor X" — which returns nothing because the local state was reset but the cursor still points past everything — leaving a permanent display gap until new entries advance the cursor beyond that position.

```ts
// WRONG — cursor ref left at old position after clearing
setLogs([]);

// CORRECT — reset cursor when clearing the data array
setLogs([]);
cursorRef.current = 0; // or undefined / null — whatever the initial value is
```

This applies to any hook that pairs `useRef` position tracking with a state array: log streams, infinite scroll, paginated lists.

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

**Common use case:** Hooks that attach `MutationObserver` or `ResizeObserver` to a DOM element. `MutationObserver` detects content additions, `requestAnimationFrame` ensures scroll happens after browser layout completes.

**Not applicable:** Imperative one-shot commands (e.g., `container.scrollLeft = container.scrollWidth`) triggered by data changes like `items.length`. Those use plain `useRef` — the element identity doesn't change, so there's nothing to re-attach. Only use this pattern when the *observer* must re-attach on element identity changes.

**Example:** See `useAutoScroll.ts` for the canonical implementation

<!-- compound: distractedly-warranted-ridgeback -->
**Testing components that use `useAutoScroll`**: `useAutoScroll` internally creates a `ResizeObserver`, which is not defined in jsdom. Any test file that renders a component using `useAutoScroll` (directly or transitively) must mock the hook:

```ts
vi.mock("../../hooks/useAutoScroll", () => ({
  useAutoScroll: () => ({ containerRef: vi.fn(), handleScroll: vi.fn() }),
}));
```

Adjust the import path as needed. Missing this mock causes `ResizeObserver is not defined` errors that surface at gate time, not at the component's own test file.

## Provider Remount via `key` Prop

<!-- compound: saucily-sanctified-curlew -->

When a provider holds `useState` initialized from a prop (e.g., a connection keyed to a resource ID), **the state does not update if the prop changes** — `useState` only reads its initializer on first mount. Use `key={resourceId}` on the provider's parent wrapper to force a full remount when the resource changes, reinitializing all state.

```tsx
// ProjectPageWrapper — forces full provider stack remount when project changes
<ProjectAppShell key={project.id} project={project} />
```

**Implication**: any provider that uses `useState(initialProp)` is intentionally ignoring prop updates — it expects remounts via `key` instead. Document this assumption with a comment in the provider file so future callers aren't confused by the prop appearing to be ignored.

**When NOT to use `key` remount**: if the provider genuinely needs to react to prop changes without unmounting (e.g., theme switching), use `useEffect` to sync the state instead.

## State Management

- Use the existing Context + hooks pattern (`TasksProvider`, `WorkflowConfigProvider`). No Redux, Zustand, or other state libraries.
- Access shared state via the provider hooks (`useTasks()`, `useWorkflowConfig()`). Don't prop-drill shared data.
- Local UI state (open/closed, selected tab, form inputs, drawer visibility) stays in the component via `useState`.

### Shared Provider Stack (`AppProviders`)

`AppProviders` (`providers/AppProviders.tsx`) is the canonical provider stack shared by every entry point (Tauri `App.tsx`, service `ProjectPage.tsx`). It wraps: `ToastProvider → WorkflowConfigProvider → TasksProvider → PrStatusProvider → GitHistoryProvider`.

**When adding a new provider, decide:**
- **Goes inside `AppProviders`**: needed by every entry point, must live inside `TransportProvider`. Add it in dependency order (dependencies closer to the root).
- **Stays outside**: entry-point-specific providers (`ProjectsProvider` in Tauri/PWA, `ProjectDetailProvider` in service mode) and connection-gate UI (`ReconnectingBanner`, `ProjectConnectionGate`) belong at their specific call site.

The split exists because each entry point manages its own `TransportProvider` (Tauri injects a `TauriTransport`; service mode injects a `WebSocketTransport` keyed to the project) and its own connection-gating UX, while the data providers inside are identical across all paths.

<!-- compound: fairly-prolific-jabiru -->
### Optimistic Updates Pattern

Mutation operations (approve, reject, answer question, etc.) apply an optimistic state transition immediately so the UI reflects the expected next state while the server request is in flight. Polling then self-corrects if anything diverges.

**Key files:**
- `src/utils/optimisticTransitions.ts` — pure function `applyOptimisticTransition(task, action, config)` mapping (current state, action) → next `WorkflowTaskView` using a **shallow merge** (spread existing derived, only override relevant fields). Centralizes all transition logic for auditability.
- `src/utils/workflowNavigation.ts` — `resolveFlowStageNames(flow, config)` provides flow-aware stage name resolution; consumed by both `pipelineSegments.ts` and `optimisticTransitions.ts` as the single source of truth.
- `TasksProvider.tsx` — holds the `pendingOptimisticUpdates: Map<taskId, PendingEntry>` ref and `applyOptimistic` callback.

**Three invariants to maintain:**
1. **Stale closure avoidance**: `applyOptimistic` reads from `tasksRef.current.find(...)`, NOT the `tasks` state variable. Using `tasks` directly creates a stale closure that re-runs on every 2s poll. The dependency array must be `[config]` only.
2. **Convergence-based clearing**: Entries are cleared when `server.updated_at !== entry.preActionUpdatedAt` (server acknowledged the change). Do NOT clear on the server response event — the task might not have been re-fetched yet.
3. **TTL sweep for error paths**: `reconcileWithPendingOptimistic` sweeps entries older than 30s (`addedAt` field on `PendingEntry`) and entries for task IDs absent from the server result (archived tasks). This self-heals when the server never received the request.

**Pattern for adding a new optimistic action:**
```ts
// 1. Add case to optimisticTransitions.ts
case "my_action":
  return { ...task, derived: { ...task.derived, current_phase: "agent_working" } };

// 2. Call applyOptimistic before transport.call in useTaskDrawerState.ts
applyOptimistic(task.id, "my_action");
await transport.call("my_action", { taskId: task.id });
```

**Out-of-scope actions** (skip optimistic updates): `create_task` (requires temporary ID synthesis), `archive_task` (moves task off the board), `set_auto_mode` (already has its own optimistic pattern), `delete_task` (different list-mutation pattern).

<!-- compound: insensibly-beneficial-codling -->
### Module-Level Cache Pattern

Several providers (`TasksProvider`, `GitHistoryProvider`, `WorkflowConfigProvider`) use module-level variables for cross-mount caching — data survives component unmounts and is available immediately on remount without a loading flash.

**Shape**: `Map<string, T>` keyed by project URL. Initialize as `new Map<string, T>()`. Reads use `.get(projectUrl) ?? null`, writes use `.set(projectUrl, data)`, clears use `.delete(projectUrl)`. The Map handles per-project isolation inherently — no equality check needed.

**Rules:**
- Use **separate variables** for logically distinct datasets (e.g., `tasksCacheEntry` and `archivedTasksCacheEntry` are independent). Never merge them into one object with spread — concurrent async fetches clobber each other's data via the read-then-write pattern.
- Polled providers (tasks, git history) self-heal after reconnect via natural polling resumption — **do not add explicit reconnect invalidation** to them.
- One-shot providers (workflow config) **must** explicitly clear their cache and re-fetch on reconnect; polling won't do it for them.
- Maps accumulate entries for every project URL visited during the session (no implicit eviction). This is fine in practice — sessions visit few projects — but worth noting if memory becomes a concern.

### `demoTransport.ts` Must Stay in Sync with Response Shapes

`src/stories/Demo/demoTransport.ts` is a hardcoded demo implementation of the transport interface for Storybook. Every command returns a static value. When a command's **response shape changes** (e.g., `get_logs` switching from a plain array to a `{ logs, cursor }` envelope), update `demoTransport.ts` too.

TypeScript won't catch this — transport methods return `Promise<unknown>`, so the mismatch compiles silently. The break only surfaces at runtime in Storybook or when a reviewer traces the response path.

**Rule:** Any time you change what a backend command returns, `demoTransport.ts` is in scope for that change.

## Styling

- Tailwind classes only. No CSS modules, styled-components, or inline style objects.
- Use the project's Forge design tokens: `canvas`, `surface-*`, `text-text-primary/secondary/tertiary/quaternary`, `accent-*`, `status-*`, `border`. These are native Tailwind tokens defined in `tailwind.config.js`.
  - **Text color classes use `text-text-*` prefix** (not `text-primary`): `text-text-primary`, `text-text-secondary`, `text-text-tertiary`, `text-text-quaternary`. The `text` nesting in `tailwind.config.js` means the utility class doubles the word. Using `text-primary` renders with browser defaults.
  - **Border radius tokens**: `rounded-panel` (12px) for structural panels, `rounded-panel-sm` (8px) for smaller containers. For chat-like UI elements (messages, bubbles), `rounded-2xl` (16px) is acceptable to differentiate conversational UI from structural panels.
  - **Verify token names before using them.** Only classes defined in `tailwind.config.js` generate CSS. For example, status colors use `status-*` tokens (e.g., `bg-status-success`, `text-status-error`) — there are no `success-*`, `error-*`, `info-*`, or `warning-*` tokens. When in doubt, check `tailwind.config.js` first.
  - **Arbitrary opacity values are valid** (Tailwind v3.4+ JIT): `opacity-45`, `opacity-30`, etc. are all valid — JIT generates them on demand. They are NOT limited to the standard scale (0, 25, 50, 75, 100). Don't flag arbitrary opacity values in review.
- **Dark mode uses system preference**: The project uses `prefers-color-scheme: dark` for automatic dark mode. All Forge design tokens are CSS variables that flip automatically — no extra work needed when using token classes like `bg-canvas`, `text-primary`, `bg-surface-2`, etc. For standard Tailwind palette colors that don't map to a Forge token (stone, amber, purple in `taskStateColors.ts` / `stageColors.ts`), pair with an explicit `dark:` variant class (e.g. `bg-stone-300 dark:bg-stone-600`). Tailwind's `darkMode: 'media'` is configured so `dark:` variants respond to `prefers-color-scheme`.
- **Forge tokens used with opacity modifiers must be defined as RGB channels**: Tailwind's `/N` opacity modifier syntax (e.g. `bg-accent/40`, `text-status-error/60`) requires the CSS variable to be defined as space-separated RGB channels (`"R G B"`) rather than a hex string. Hex values silently break opacity — the class is applied but opacity has no effect. Affected tokens (accent, status-success, status-error, status-warning, status-info, violet, teal, merge) are already defined in the correct format in `tailwind.config.js`. When adding a new Forge token, check whether it will ever be used with `/N` and define it accordingly: `"--forge-my-token": "120 80 200"` not `"#7850C8"`.
- **Typography scale — use `text-forge-*` tokens, not arbitrary sizes**: Never use `text-[12px]`, `text-[13px]`, etc. Use the named scale from `tailwind.config.js`:
  - `text-forge-mono-label` (10px/14px) — structural labels, dividers
  - `text-forge-mono-sm` (11px/16px) — tool calls, script output, file names
  - `text-forge-mono-md` (12px/18px) — diff lines, code content
  - `text-forge-body` (13px/20px) — thinking, assistant prose (pair with `font-sans`)
  - `text-forge-body-md` (14px/20px) — prose headings
  The exception: `PROSE_CLASSES` from `utils/prose.ts` has its own sizing — always pair it with `text-forge-body` and never use arbitrary sizes alongside it.
- Use `PROSE_CLASSES` from `utils/prose.ts` for markdown rendering. Always pair with `text-forge-body` for font size — never use arbitrary values like `text-[13px]` alongside `PROSE_CLASSES`.
- **Full rich content rendering** (mermaid diagrams, wireframe blocks, syntax highlighting): use `ReactMarkdown` with `richContentPlugins` and `richContentComponents` from `utils/richContentConfig.ts`. These are configuration objects (remark/rehype plugins + component overrides), not a standalone component. See `AssistantTextLine` in `Feed/MessageList.tsx` for the pattern — all message types (user, assistant, system) should use this same config for consistent rendering.

## Android PWA Viewport

<!-- compound: unseemly-sunny-blowfish -->

To prevent the document from scrolling on Android when installed as a PWA, apply all three together in `src/index.css`:

```css
body {
  height: 100vh;       /* fallback for browsers without dvh support */
  height: 100dvh;      /* dynamic viewport height — excludes browser chrome on Android */
  overflow: hidden;    /* prevents content overflow from being scrollable */
  overscroll-behavior: none; /* prevents pull-to-refresh and elastic scroll */
}
```

**Why `100dvh` needs the `100vh` fallback**: CSS assigns properties in order — the second `height` declaration overrides the first only if the browser understands `dvh`. Older browsers that don't support `dvh` ignore the second line and use the `vh` fallback. Do not write just `height: 100dvh` without the fallback.

**`maximum-scale=1.0, user-scalable=no`** in `index.html`'s viewport meta tag disables pinch-to-zoom. This is intentional for native-app-like PWA behavior but must be revisited if accessibility zoom support becomes a requirement.

## Vite Build Modes

<!-- compound: abysmally-conquering-leafroller -->

The project has two Vite build modes configured in `vite.config.ts`: default (Tauri) and `service`.

- `pnpm build` — Tauri mode (default).
- `pnpm build --mode service` — Service mode. Uses `service.html` as the entry point and outputs to `dist-service/`.

PWA installability is provided by a static `public/manifest.json` linked from `index.html`. There is no service worker — the app requires the daemon to function and has no meaningful offline behaviour.

## Pre-React HTML Skeleton (`index.html`)

<!-- compound: slickly-continuous-bonobo -->

`index.html` contains a pre-React loading skeleton (shown before JS hydrates) that mirrors `FeedLoadingSkeleton.tsx`. Because it's plain HTML, it cannot use Tailwind or CSS variables — it uses hardcoded hex colors that duplicate Forge token values from `src/index.css`.

**When changing `FeedLoadingSkeleton.tsx` (layout, structure, or colors), update `index.html` too.** The pre-React skeleton must stay dimensionally consistent with the React skeleton to avoid layout shifts during hydration. This includes:
1. **Color changes** — `src/index.css` is canonical; `index.html` uses hardcoded hex equivalents.
2. **Layout/structure changes** — DOM structure and dimensions in `index.html` must match `FeedLoadingSkeleton.tsx`.

<!-- compound: wittingly-dominant-tuatara -->
**Safe-area inset on mobile — use a two-div structure, not padding on a fixed-height element.** Global `box-sizing: border-box` causes `padding-bottom: env(safe-area-inset-bottom)` to be subtracted *from* the element's height instead of added. Use a wrapper div for the padding and an inner div for the fixed height:

```html
<!-- index.html -->
<div class="skeleton-footer-safe">   <!-- wrapper: padding-bottom: env(safe-area-inset-bottom) -->
  <div class="skeleton-footer"></div> <!-- inner: height: 49px, no padding -->
</div>
```

This mirrors `FeedLoadingSkeleton.tsx`'s two-div pattern (outer `pb-safe` wrapper + inner `h-[49px]` div) and keeps the total height additive: `49px + safe-area-inset`.

**`FeedLoadingSkeleton` header uses `<a href="/">`, not `<Link>`.** The skeleton renders in multiple contexts: inside a `BrowserRouter` (service/PWA mode) and outside one (Tauri's `main.tsx`). `<Link>` crashes when rendered outside a Router. Using `<a href="/">` causes a full page reload in service mode, but that's acceptable — the skeleton is a loading screen with no app state to lose. Do not change this to `<Link>`.

The skeleton also has a `statusText` element (`.loading-status-text`) that shows a loading message. Always populate it when adding new skeleton states so the UI doesn't jump between "has status" and "no status" variants.

## Forge Design System

<!-- compound: unthinkingly-inventive-dugong -->

Forge is the project's design language — it is not an alternate or scoped visual language. It uses IBM Plex fonts, a warm purple-undertone palette, and pink-red accent (`accent`/`accent-*`). All components use Forge tokens by default.

**Some Forge tokens are bare RGB channels — never use them directly as CSS colors.** `--forge-accent` and `--forge-status-{success,error,warning,info}` are stored as space-separated RGB channels (e.g., `232 53 88`) for Tailwind v3 opacity modifier support. Using them raw in CSS (`color: var(--forge-accent)`) produces invalid CSS. Always use the `--color-*` wrappers defined in `tailwind.config.js` (and in `docs/src/styles/global.css` for the Astro docs site), which apply `rgb()`:

```css
/* Wrong — bare channel token is not a valid CSS color */
color: var(--forge-accent);
border-color: var(--forge-status-error);

/* Correct — --color-* wrappers include the rgb() call */
color: var(--color-accent);
border-color: var(--color-status-error);
```

Tokens that are already valid CSS colors (`--forge-border`, `--forge-text-*`, `--forge-surface-*`, `--forge-status-*-bg`, `--forge-status-purple/pink/cyan/orange`) can be used directly, but prefer the `--color-*` equivalents for consistency.

**Animation coupling:** Keyframe names (`pipe-active-pulse`, `forge-pulse-opacity`) are coupled by string between `index.css` and TSX files with no compile-time check. Be careful when renaming them.

<!-- compound: regularly-befriended-nuthatch -->
**Custom keyframes use Tailwind arbitrary value syntax — not inline styles.** Even though `forge-pulse-opacity` and `pipe-active-pulse` are defined in `index.css` (not `tailwind.config.js`), you can still reference them via Tailwind's bracket syntax. Never use an inline `style` prop for animations when this syntax works:

```tsx
// Correct — Tailwind arbitrary value syntax works for CSS-defined keyframes
className="animate-[forge-pulse-opacity_2s_ease-in-out_infinite]"

// Wrong — inline style violates the "Tailwind classes only" convention
style={{ animation: "forge-pulse-opacity 2s ease-in-out infinite" }}
```

See `ProjectRow.tsx` and `MobileTabBar.tsx` for canonical usage.

## UI Components

<!-- compound: freely-exquisite-chicken -->

**Button `className` overrides and CSS specificity**: The `Button` component concatenates classes with a plain string join (not `twMerge`). When you pass a `className` prop to override variant styles (e.g. hover colors), CSS specificity is determined by Tailwind's CSS generation order — not the order of classes in the HTML attribute. If your override and the variant's class have equal specificity, the result is unpredictable. Options when you need reliable overrides: (1) add `onAccent` prop if the button sits on an accent-colored background (it switches the hotkey badge and other internal styles), (2) create a dedicated variant in `Button.tsx` rather than overriding via `className`, or (3) wait for a `twMerge` migration.

- Use the existing design system in `components/ui/` — `Panel`, `Button`, `IconButton`, `ModalPanel`, `Drawer`, `Dropdown`, etc.
- The `Panel` component uses compound subcomponents: `Panel.Header`, `Panel.Body`, `Panel.Footer`, etc.

<!-- compound: distractedly-warranted-ridgeback -->
**`Panel.Body` does not forward refs or `onScroll`**: if a scroll container needs `useAutoScroll` (which requires a `ref` and `onScroll` on the element), replace `Panel.Body scrollable` with a plain `<div className="p-4 flex-1 overflow-auto max-h-[60vh]">` — those are the equivalent Tailwind classes. A future improvement would be adding ref forwarding to `PanelBody`, but until then drop to a raw div.
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

<!-- compound: sensitively-jaunty-shad -->

**Clickable rows with inner buttons must use `div role="button"`, not `<button>`**: Nesting `<button>` inside `<button>` is invalid HTML — browsers handle it inconsistently (often ejecting the inner button). When a row is keyboard-navigable AND contains action buttons, the row wrapper must be a `<div role="button" tabIndex={0}>` with an `onKeyDown` handler for Enter/Space.

```tsx
// Correct — div wrapper allows inner <button> elements
<div
  role="button"
  tabIndex={0}
  onClick={handleRowClick}
  onKeyDown={(e) => {
    if (e.key === "Enter" || e.key === " ") handleRowClick();
  }}
>
  <button onClick={(e) => { e.stopPropagation(); onAction(); }}>Action</button>
</div>

// Wrong — nested <button> inside <button> is invalid HTML
<button onClick={handleRowClick}>
  <button onClick={(e) => { e.stopPropagation(); onAction(); }}>Action</button>
</button>
```

**Reference:** `FeedRow.tsx` lines 61-70 and `ProjectRow.tsx` are the canonical examples.

## Error Surfacing in Action Handlers

<!-- compound: prodigally-forgiving-ibex -->

`useTaskDrawerState.ts` contains a pre-existing `invokeAndClose` helper that silently swallows backend errors (logs to `console.error` but does not update any error state). **Do not use `invokeAndClose` for new action handlers that need to surface errors to the user.**

<!-- compound: seasonally-sensual-guineapig -->
**Always guard action handler `.catch()` calls with `isDisconnectError`** — Any action handler that calls `transport.call()` and shows a toast on error must filter through `isDisconnectError(err)` before calling `showError`. Without this guard, dead-socket reconnection produces spurious "Request timed out" toasts — the exact scenario these transport-layer fixes are meant to make silent.

```tsx
import { isDisconnectError } from "../transport/transportErrors";

onApprove: async (taskId) => {
  try {
    await transport.call("approve", { task_id: taskId });
  } catch (err) {
    if (!isDisconnectError(err)) showError(String(err)); // suppress disconnect/timeout noise
  }
},
```

This applies to every `.catch()` or `catch (err)` block in `FeedView.tsx`, `AssistantDrawer.tsx`, `InteractiveDrawer.tsx`, `SubtasksSection.tsx`, and any new component with feed actions. Reviewers check all action handlers — missing guards are a guaranteed HIGH finding.

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

## Flow-Aware Stage Filtering

<!-- compound: urgently-welcome-katydid -->

When displaying a list of stages the user can navigate to (e.g., a "send to stage" dropdown), **always use the task's current flow** to get the valid stage list. Since `WorkflowConfig` has no top-level `stages` array, all stage lookups go through `config.flows[task.flow]`.

```ts
import { resolveFlowStageNames } from "../utils/workflowNavigation";

// Get only stages valid for this task's flow
const validStageNames = resolveFlowStageNames(task.flow, config);
// Or directly for full StageConfig objects:
const flowStages = config.flows[task.flow]?.stages ?? [];
const otherStages = flowStages.filter(s => s.name !== task.derived.current_stage);
```

`resolveFlowStageNames` is also used by `optimisticTransitions.ts` and `pipelineSegments.ts` as the single source of truth for flow-aware stage name lists.

## Tauri Dialog Gotcha: `window.confirm()` is Non-Blocking

<!-- compound: lewdly-known-dormouse -->

`window.confirm()` returns `true` immediately in Tauri's webview (WKWebView on macOS, WebView2 on Windows) while showing the dialog asynchronously. **Never use `window.confirm()` for destructive action confirmations in this app.**

Use `confirmAction` from `src/utils/confirmAction.ts` instead — it uses `@tauri-apps/plugin-dialog` in Tauri (returns a proper `Promise<boolean>`) and falls back to `window.confirm()` in browser/PWA contexts:

```ts
import { confirmAction } from "../utils/confirmAction";

const confirmed = await confirmAction("Archive this Trak?");
if (!confirmed) return;
await transport.call("archive_task", { taskId: task.id });
```

This applies to any destructive confirmation (archive, delete, reset). The `@tauri-apps/plugin-dialog` package is already installed.

## Biome Lint Gotchas

<!-- compound: tightly-prudent-motmot -->

**`noAutofocus` blocks `autoFocus` on form elements**: Biome's `a11y/noAutofocus` rule (part of the recommended ruleset) disallows the `autoFocus` prop on inputs, textareas, and selects. Remove `autoFocus` from form elements inside modals — users can tab to them or click as needed.

**`useRegexLiterals` auto-converts `new RegExp()` to literal form**: Biome's `useRegexLiterals` rule automatically rewrites `new RegExp("pattern")` to `/pattern/` literal syntax. If constructor form is required (e.g., to avoid escape conflicts with another lint rule), use `// biome-ignore lint/nursery/useRegexLiterals: <reason>` on the preceding line. Without the suppression, the automated formatter reverts the constructor form on every gate run, making the fix unstable.

<!-- compound: manly-fragrant-porpoise -->

**`noArrayIndexKey` suppression detaches when the line exceeds 100 chars**: A `// biome-ignore lint/suspicious/noArrayIndexKey` comment must be on the line immediately before the JSX element containing `key={i}`. If adding props causes that element to exceed Biome's 100-char line limit, the formatter splits the element across lines, moving `key={i}` to a new line and leaving the suppression orphaned — which triggers a `suppressions/unused` error alongside the original `noArrayIndexKey` error. Fix by keeping the JSX element short: extract a variable for the long prop value so the element itself fits in 100 chars.

```tsx
// Before (breaks if line > 100 chars after formatting):
// biome-ignore lint/suspicious/noArrayIndexKey: stable list
<ToolLine key={i} summary={toolSummary(entry, projectRoot)} />

// After (extract variable so element stays short):
const summary = toolSummary(entry, projectRoot);
// biome-ignore lint/suspicious/noArrayIndexKey: stable list
<ToolLine key={i} summary={summary} />
```

<!-- compound: finally-idealistic-linnet -->

**`useKeyWithClickEvents` on non-semantic elements**: Biome requires a `onKeyDown` handler alongside every `onClick`, even on `tabIndex={-1}` divs/spans where keyboard nav is intentionally handled elsewhere (e.g., by a parent input). Use a no-op `onKeyDown={() => {}}` to satisfy the rule — do not use `biome-ignore` (it's invalid inside JSX prop position).

```tsx
// Keyboard nav handled by parent input; no-op satisfies biome rule
<div onClick={handleSelect} onKeyDown={() => {}} tabIndex={-1}>
  {label}
</div>
```

<!-- compound: lengthily-enchanted-fieldfare -->

**`useSemanticElements` conflicts with `role="status"` for loading skeletons**: Biome's `useSemanticElements` rule flags `<div role="status">` and suggests using `<output>`, but `<output>` is semantically for form calculation results — not loading indicators. Use `<div role="status">` with a `biome-ignore` line comment:

```tsx
// biome-ignore lint/a11y/useSemanticElements: role="status" is correct for loading indicators; <output> is for form results
<div role="status" aria-label="Loading...">
```

## Loading State Patterns

<!-- compound: lengthily-enchanted-fieldfare -->

**Always set `hasLoaded` in `finally`, never just in the success path**: When using a boolean flag to guard against false empty-states during initial fetch, always set it in `finally` so a failed fetch doesn't leave the skeleton spinning forever:

```tsx
const [hasLoaded, setHasLoaded] = useState(false);

useEffect(() => {
  fetchProjects()
    .then(setProjects)
    .catch(console.error)
    .finally(() => setHasLoaded(true)); // not in .then — failure must also resolve the loading state
}, []);
```

Show the skeleton (or empty state guard) with `{!hasLoaded ? <Skeleton /> : <Content />}`. `hasLoaded` is write-once — never reset it to `false` on re-fetch; a brief stale render is better than re-showing the skeleton on every poll cycle.

## Gate Execution Data Model

<!-- compound: veritably-soaring-kinkajou -->

Gate output is stored as `LogEntry` variants in the agent log timeline — not as a separate `gate_result` on iterations. The three gate log entry types are:

- `{ type: "gate_started"; command: string }` — emitted when the gate script begins
- `{ type: "gate_output"; content: string }` — emitted for each line of gate script output (may contain ANSI escape codes)
- `{ type: "gate_completed"; exit_code: number; passed: boolean }` — emitted when the gate script finishes

These entries flow through `workflow_get_latest_log` like any other log entries. Use `AnsiText` from `src/utils/ansi.tsx` to render `gate_output` content. The gate tab has been removed — gate output renders inline in the agent tab.

## Terminal Task State: current_stage is Null

<!-- compound: obligingly-dear-porgy -->

For terminal `TaskState` variants (`done`, `failed`, `blocked`, `archived`), `task.derived.current_stage` is intentionally `null` (set in `status.rs`). **Never assume `current_stage` is non-null when writing frontend code for logs, artifacts, or any stage-dependent UI.**

To derive the last active stage for terminal tasks, use:
- `task.derived.stages_with_logs[last].stage` — ordered chronologically by session creation; last entry = most recently active stage
- `task.iterations[last].stage` — last iteration's stage field

The polling guard in `useLogs.ts` relies on this: `activeLogStage === task.derived.current_stage` evaluates to `"stage-name" === null` → `false`, so terminal tasks are fetched once (via `useEffect`) and not polled.

## Assistant Session Active State

<!-- compound: modestly-saintly-mynah -->

Use `agent_pid != null` to determine whether an assistant session is actively running. Do **not** use `session_state === "active" || "spawning"` — `session_state` is never updated to `"completed"` on the backend, so it reads stale forever and will keep the loading spinner indefinitely.

```tsx
// Correct
const isAgentRunning = session?.agent_pid != null;

// Wrong — session_state is never cleared
const isAgentRunning = session?.session_state === "active" || session?.session_state === "spawning";
```

## Task Status Predicates

<!-- compound: dully-maximum-sunbeam -->

`isActivelyProgressing` in `utils/taskStatus.ts` is a **header-metric-scoped** predicate — it excludes `integrating` because the header displays integrating tasks in a separate count. It is NOT a universal "is this task doing something" check.

**Callers that need `integrating` included** (e.g., showing UI for any in-flight task) must add an explicit guard:

```tsx
// Correct pattern when you need both
task.state.type === "integrating" || isActivelyProgressing(task)
```

Using `isActivelyProgressing` alone in contexts that previously handled `integrating` will silently drop those tasks. See `FeedRowActions.tsx` for the reference pattern.

## React Router Navigation

<!-- compound: cheerily-matchless-tilapia -->

Use `<Link to="...">` from `react-router-dom` for all internal SPA navigation within components that render inside a `BrowserRouter`. Use `<a href="...">` only for external URLs or components that are intentionally outside the router context (e.g., pure utility UI rendered in a non-SPA context).

`<a href="/">` for an internal route forces a full page reload (bypassing React Router's history), which breaks SPA behavior. "Keeping a component decoupled from react-router-dom" is not a valid reason to use `<a>` when the component renders inside a BrowserRouter — import `Link` instead.

## Tauri-Specific Data Access

<!-- compound: factually-persuasive-kinkajou -->

**`ProjectsProvider.currentProject` is always null in Tauri mode.** `ProjectsProvider` populates `currentProject` from localStorage, which is only written during the PWA pairing flow. TauriTransport bypasses that flow entirely — so any code that reads `currentProject` will always see null when running as the desktop app.

When you need project info in Tauri mode (e.g., the project root path, folder name), call the backend directly:

```ts
import { useTransport } from "../transport/TransportProvider";

const transport = useTransport();
transport.call("get_project_info").then((info) => {
  const folderName = info.project_root.split("/").pop() || info.project_root;
});
```

This applies to any code gated on `IS_TAURI` that needs project context. The `get_project_info` command is always available in Tauri mode regardless of pairing state.

## Types

- Use `import type` for type-only imports.
- Workflow domain types live in `types/workflow.ts`.
- Don't duplicate backend types — the Tauri bindings generate TypeScript types from Rust.

## Verdict Badge Derivation

Verdict display is computed in two places — this is intentional, not duplication. They serve different data sources:

- **`DrawerTabContent.tsx`** (live view): uses backend-computed `DerivedTaskState` (e.g., `task.derived.pending_approval`, `task.derived.pending_rejection`). No config lookup needed; the backend already has the full workflow config.
- **`HistoricalRunView.tsx`** (past runs): computes verdict from raw iteration outcomes because historical snapshots don't carry pre-computed derived state. Requires a config lookup to distinguish agentic gate stages from regular human-review gates.

**Flow-scoped stage lookup is required for correctness.** When `HistoricalRunView.tsx` queries stage config (e.g., `workflow.stage(flow, stageName).has_agentic_gate()`), always scope to `task.flow` — never flat-map across all flows. Flows may share stage names, and searching all flows silently returns the wrong config for any task not in the first matching flow.

```tsx
// Correct — scoped to this task's flow
const stageConfig = config.flows
  .find(f => f.name === task.flow)
  ?.stages.find(s => s.name === stageName);

// Wrong — searches all flows, returns wrong config when flows share stage names
const stageConfig = config.flows
  .flatMap(f => f.stages)
  .find(s => s.name === stageName);
```

## Artifact and Iteration Numbering

<!-- compound: frivolously-memorable-spitz -->

Both `WorkflowArtifact.iteration` and `WorkflowIteration.iteration_number` are **1-based**. Do not add a `+1` offset when matching an artifact to its producing iteration — compare them directly:

```ts
// Correct
task.iterations.find(it => it.stage === artifact.stage && it.iteration_number === artifact.iteration)

// Wrong — artifact.iteration is already 1-based
task.iterations.find(it => it.stage === artifact.stage && it.iteration_number === artifact.iteration + 1)
```

Legacy artifacts produced before the `iteration` field existed have `iteration: 0` (from `#[serde(default)]` on the Rust side). Since valid `iteration_number` values start at 1, these will never match — correct graceful degradation, no badge shown.

## TanStack Virtual Patterns

<!-- compound: dourly-topical-pratincole -->

**Sticky file headers inside a virtualizer**: Standard `position:sticky` doesn't work for items inside a virtualizer — each header sticks independently, causing all headers to float over each other. The correct pattern:

1. Place a **single sticky overlay element before the virtualizer container** (`position:sticky; top:0; z-index`) in the DOM
2. Track the topmost visible item by inspecting `virtualItems` on each scroll
3. Render that item's header in the overlay — not inside the virtualizer list

**`firstVisible` predicate — direction matters**: To find the topmost visible file, iterate in *reverse* and find the last item whose top is at or above `scrollTop`:

```ts
const firstVisible = [...virtualItems]
  .reverse()
  .find(item => item.start <= scrollElement.scrollTop);
```

**Never use `find(item => item.start >= scrollTop)`** — that finds the first item *below* the viewport, skipping the file the user is currently reading. The inversion is subtle and easy to get backwards.

Note: `Array.prototype.findLast` is ES2023 — use `[...arr].reverse().find()` for ES2020 targets.

**`virtualItems` sort order**: TanStack Virtual guarantees `virtualItems` is sorted ascending by `start`. The reverse-find pattern relies on this guarantee — a `reduce`-based approach would make the intent explicit if the sort assumption ever feels fragile.

## Testing

- Tests use Vitest + React Testing Library.
- Test files sit alongside the component: `Component.test.tsx`.
- **New components require test coverage** — every new or extracted component needs at minimum one test for the default rendering path and one test per meaningful conditional branch (image vs link, loading vs loaded, Tauri vs web, etc.). A component with no test file is incomplete, the same as a component with no story. **New conditional branches added to existing components also require tests** — when you add a new rendering path (e.g., `taskResources ? render(...) : null`) to an existing component, add a test covering each branch of that condition, even though the component already has a test file.
- **jsdom limitations**: The test environment doesn't implement all DOM APIs. If a component uses `scrollIntoView()`, `IntersectionObserver`, or other browser-specific APIs, mock the component in parent component tests to prevent runtime errors. See `Orkestra.test.tsx` for the pattern.
- **Document-level event listeners ARE testable in jsdom**: Components that attach `mousedown`, `keydown`, or similar listeners to `document` can be fully tested using `fireEvent.mouseDown(document.body)` / `fireEvent.keyDown(document, { key: "Escape" })`. jsdom's event system bubbles events through the document normally — the limitation is layout (no measurements, no observers), not event dispatch. Don't mark outside-click or keyboard dismissal logic as "manual only."
- **`@tanstack/react-virtual` renders 0 items in jsdom**: The virtualizer measures DOM element heights to determine which items to render. In jsdom there are no layout measurements, so `virtualItems` is always empty. Tests that exercise virtualizer-dependent behavior (`scrollToFile`, active-path tracking, `onActivePathChange` callbacks) are impractical in unit tests — document them as requiring manual verification and focus test coverage on the hook or logic layer instead (e.g., `useAutoCollapsePaths.test.ts` tests the collapse logic without touching the virtualizer).
- **`vi.fn` type argument constraint**: `vi.fn<TArgs, TReturn>()` is not supported — Vitest's `vi.fn` only accepts 0 or 1 type argument. When you need to specify the return type, add an explicit return type annotation on the implementation function instead: `vi.fn((): ReturnType => value)`.
- **Mock reset in test files**: Always add `beforeEach(() => mockXxx.mockReset())` for module-level mocks. Without it, tests that run in any order can observe state from earlier tests, causing subtle ordering-sensitive failures that only appear when tests are added or reordered.
- **`vi.stubEnv` cleanup**: Always restore env stubs in `afterEach(() => vi.unstubAllEnvs())`, not inline after assertions. If an assertion throws before the inline `vi.unstubAllEnvs()` call, the stub leaks and affects subsequent tests in the file.
- **Testing module-level constants (e.g., `IS_TAURI`)**: Module-level constants are evaluated once at import time — `vi.stubEnv` alone doesn't affect them after import. Use `vi.resetModules()` + dynamic `import()` inside each test (or `beforeEach`) to force re-evaluation with the stubbed environment:

<!-- compound: sluggishly-neutral-eft -->
```ts
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllEnvs());

it("behaves correctly in Tauri mode", async () => {
  vi.stubEnv("VITE_IS_TAURI", "true");
  const { useMyHook } = await import("./useMyHook"); // fresh import with IS_TAURI=true
  // ... test
});
```

Each test gets a fresh module evaluation. Always pair with `vi.unstubAllEnvs()` cleanup.
- **`vi.runAllTimersAsync()` with `setInterval` causes infinite loop**: `vi.runAllTimersAsync()` repeatedly fires all pending timers including `setInterval`, triggering indefinitely until Vitest aborts at 10000 iterations. Use `vi.advanceTimersByTimeAsync(N)` instead — it only fires timers that would trigger within N milliseconds, so it's bounded and safe with intervals.
- **Mocking `../transport` requires all four exports**: `vi.mock("../transport", ...)` replaces the entire module, so every hook must be present: `useConnectionState`, `useHasConnected`, `useTransport`, and `useTransportListener`. When a test sets `useHasConnected: () => true`, the app tree mounts `AppProviders` (WorkflowConfigProvider, TasksProvider, PrStatusProvider, GitHistoryProvider) — all of which call `useTransport()`. A missing export causes a runtime error. Use a never-resolving promise for `useTransport.call` to keep providers in their loading state without errors: `useTransport: () => ({ call: () => new Promise(() => {}) })`.

- **`useTransportListener` must be imported directly (not via barrel) when tests need to mock it**: `vi.mock("../transport/useTransportListener")` only intercepts imports from that exact path. If the component imports `useTransportListener` from `"../transport"` (the barrel), the mock is invisible and handler capture fails. Import it directly in components whose tests mock it: `import { useTransportListener } from "../transport/useTransportListener"`. See `useSessionLogs.ts` and `useBrowserNotifications.ts` for the pattern.

<!-- compound: sketchily-soaring-tick -->
- **`vi.mock` factory cannot reference `const` variables**: `vi.mock(...)` is hoisted to the top of the file by Vitest's transformer, but `const`/`let` declarations are not — they stay in place. Any `const mockFn = vi.fn()` referenced inside a `vi.mock(...)` factory will be `undefined` at runtime. Use `vi.hoisted()` to declare mocks that factories need:

```ts
const { mockRender, mockCreateRoot } = vi.hoisted(() => {
  const mockRender = vi.fn();
  const mockCreateRoot = vi.fn(() => ({ render: mockRender, unmount: vi.fn() }));
  return { mockRender, mockCreateRoot };
});

vi.mock("react-dom/client", () => ({ createRoot: mockCreateRoot }));
```

`vi.hoisted()` runs before the module is mocked, so its return values are available when factory functions execute.

<!-- compound: boorishly-profitable-cat -->

<!-- compound: garishly-true-wren -->

<!-- compound: prominently-restful-ratel -->
- **`vi.useFakeTimers()` / `vi.useRealTimers()` cleanup**: Always restore real timers in `afterEach(() => vi.useRealTimers())` at file scope, not inline at the end of each test. If an assertion throws before the inline `vi.useRealTimers()` call, fake timers leak and affect subsequent tests. This follows the same pattern as `vi.unstubAllEnvs()` cleanup.

## Storybook Stories

Stories live in `src/stories/`. The shared infrastructure is in `src/stories/storybook-helpers.tsx`.

**Provider setup**: Every story needs the full provider stack. Use `StorybookProviders` as the wrapper or rely on `storybookDecorator` (registered in `.storybook/preview.ts`), which wraps all stories automatically.

```tsx
import { storybookDecorator } from "../stories/storybook-helpers";
export default { decorators: [storybookDecorator] };
```

**`useWorkflowConfig` vs `useWorkflowConfigState`**: `useWorkflowConfig()` throws when config is null — which happens on every first render before the async `get_startup_data` resolves. In Storybook (and any component that conditionally gates on config), use `useWorkflowConfigState()` instead — it returns `{ config: null }` safely. `StorybookProviders` includes a `ConfigGate` that waits for config before rendering children, preventing null-config throws from consumers.

**Mock transport (`createMockTransport`)**: Returns a `Transport` with `supportsLocalOperations: false` (bypasses Tauri fast paths and `useRunScript`) and a routing table for every RPC method called by `AppProviders` child providers. The `default` branch returns a never-resolving promise to pause polling chains for unhandled methods.

When adding a new RPC method to the mock, verify the return shape against the `transport.call<T>()` call at the usage site — the `<T>` type parameter is the authoritative expected shape. A shape mismatch (e.g., returning `{ entries: [], cursor: null }` when the hook expects `LogEntry[]`) causes silent type coercion that only surfaces as a story crash at render time.

**Custom transport stories**: When a story group needs a transport with different stage names, data, or RPC behaviour than the global mock, every story file in that group must explicitly wrap with `StorybookProviders` passing the custom transport — **do not rely on the global `storybookDecorator`**, which injects the default mock transport and will cause stage name mismatches:

```tsx
const decorator = (Story: React.ComponentType) => (
  <StorybookProviders transport={createDemoTransport()}>
    <Story />
  </StorybookProviders>
);
export default { decorators: [decorator] };
```

See `src/stories/Demo/AppShell.stories.tsx` for the reference pattern.

**Provider completeness**: `StorybookProviders` must include every context provider used by app-level components. When adding a new provider to the app, check whether any component in the `Orkestra` tree consumes it — if so, add it (or its stub variant) to `StorybookProviders` in `storybook-helpers.tsx`. Entry-point providers like `ProjectsProvider`/`ProjectDetailProvider` are easy to forget because they live outside `AppProviders`. Use `ProjectDetailProvider` (the stub) rather than the full `ProjectsProvider` — it avoids `localStorage` side effects and provides safe defaults (`projects: []`, `currentProject: null`, mutations throw).

**Build limitation**: `pnpm build-storybook` only bundles JavaScript — it does not render stories, so runtime errors (missing providers, undefined hooks, broken context) are invisible to the build step and to `checks.sh`. The only way to catch these is manual story review or a dedicated Storybook test runner (not yet set up).

**Story requirement**: Every new UI component and every existing component with changed props, new visual states, or modified appearance must have a Storybook story. A component without a story cannot be visually reviewed — this is a hard requirement, not a nice-to-have. Specifically:

- New components in `src/components/` — at minimum one story showing the default/happy path
- Conditional rendering branches (loading, error, empty, disabled) — each meaningful state gets its own named story
- Changed components — update existing stories to cover the new behavior; add stories for states that didn't exist before

**Visual review workflow**: Because `pnpm build-storybook` doesn't render stories, visual verification requires running Storybook locally:

1. Start the dev server: `pnpm storybook` (serves at `http://localhost:6006`)
2. Navigate to the component's story in the browser
3. Verify every story variant renders correctly — check layout, spacing, and edge-case states
4. Fix any runtime errors (missing providers, broken context) before submitting

To run the automated test runner against a live instance: `pnpm test-storybook --url http://localhost:6006` (requires the dev server to be running first).

**Screenshot-as-resource workflow**: When stories are added or modified, generate screenshots and register them as resources so they appear in the Trak drawer throughout the workflow. The expected workflow:

1. Run Storybook: `pnpm storybook` (serves at `http://localhost:6006`)
2. Take screenshots — either via `pnpm test-storybook` with a snapshot configuration, or manually from the browser
3. Save screenshots to a stable path in the worktree (e.g., `.orkestra/screenshots/ResourceItem.png`)
4. Register each screenshot as a resource in the agent's structured output, using the component name as the key so multiple screenshots coexist without collision:
   ```json
   {"name": "screenshot:ResourceItem", "url": "/absolute/path/to/.orkestra/screenshots/ResourceItem.png", "description": "ResourceItem — image and link variants"}
   {"name": "screenshot:FeedRow", "url": "/absolute/path/to/.orkestra/screenshots/FeedRow.png", "description": "FeedRow — default and selected states"}
   ```

In Tauri, resources with a local image path (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`) render as inline `<img>` tags in the Trak drawer's Resources tab. In web/daemon mode they render as plain text.

## Keyboard Navigation

<!-- compound: beauteously-liberal-pollock -->

Use `useNavHandler` from `HotkeyScope` for keyboard shortcuts instead of raw `window.addEventListener`. Raw listeners bypass scope isolation — they fire regardless of which drawer or panel is focused, and they won't benefit from future hotkey system updates.

<!-- compound: shyly-limber-sponge -->

**Mobile guards on keyboard `useEffect` handlers**: When a component uses `useIsMobile()`, every `useEffect` that registers keyboard listeners must include an early-return guard and add `isMobile` to the dependency array. Missing guards cause single-key shortcuts to fire on touch devices:

```tsx
const isMobile = useIsMobile();

useEffect(() => {
  if (isMobile) return; // required — skip on touch devices
  const handler = (e: KeyboardEvent) => { /* ... */ };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}, [isMobile, /* other deps */]); // isMobile must be in deps
```

Modifier-key shortcuts (Cmd+K, Shift+A, Alt+key) can remain active on mobile — they have no physical equivalent on most touch keyboards and are harmless. Single-key nav shortcuts (j/k, g/h, etc.) must be suppressed. `HotkeyScope` handles suppression automatically for `useNavHandler` callers; only raw-listener effects need manual guards.

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

### antml-Namespaced Tag Literals in Test Strings

<!-- compound: hungrily-avid-turkey -->

When writing test strings that contain Claude's `<...>` XML tags (e.g., `<parameter>`, `<function_calls>`), construct the closing tags via string concatenation to avoid the literal string being treated as a real XML element:

```ts
// Avoid — the literal closing tag is stripped by XML-aware tools
const input = "content inside param tags";

// Prefer — construct closing tags via concatenation
const CLOSE_PARAM = "</" + "antml:parameter>";
const input = `<parameter>content${CLOSE_PARAM}`;
```

This matters when testing regexes that strip Claude's structured output blocks from text (e.g., `stripParameterBlocks`). The same applies to `<function_calls>` and similar antml-namespaced tags.

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

The same requirement applies to non-trivial pure functions exported from component files. If a component file exports a pure function for testability (e.g., `buildVirtualItems` exported from `MessageList.tsx`), add coverage in the component's existing test file (e.g., `MessageList.test.ts`). Pure functions exported from hook files are covered by the shared-hook pattern below.

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

### Mobile/Desktop Conditional Rendering Tests

<!-- compound: disloyally-adoring-baboon -->

When the same text appears in mutually exclusive mobile and desktop branches (e.g., `{isMobile && <Log/>}` and `{!isMobile && <Log/>}`), count-based assertions (`getAllByText(...).length >= 2`) are fragile — exactly one branch renders, always producing a count of 1 in both modes.

Use **structural (DOM ancestry) assertions** instead: verify *where* in the DOM the text appears, not how many times.

```tsx
const logText = screen.getByText("Starting...");
// Mobile: log is in a sibling div (not inside role="button" row)
expect(logText.closest('[role="button"]')).toBeNull();
// Desktop: log is inside the role="button" row
expect(logText.closest('[role="button"]')).not.toBeNull();
```

This correctly distinguishes mobile vs desktop regardless of whether `useIsMobile` is mocked.

**Also**: When removing a UI element (e.g., a status label div), search the test file for `getByText` calls that assert on text from that element and remove or update them — stale text assertions cause gate failures.

## Diff Search Architecture: Content-Space / HTML-Space Invariant

<!-- compound: dissolutely-dear-horse -->

The diff viewer's find feature separates search from highlighting across two spaces:

- **Search (`useDiffSearch`)** — operates in **content-space**: raw text from `line.content`, producing `DiffMatch` objects with character-offset ranges in that plain text.
- **Highlighting (`highlightSearchInHtml`)** — operates in **HTML-space**: accepts pre-computed `SearchRange[]` (content-space offsets) and maps them through an entity-aware HTML walker. HTML entities (`&lt;`, `&amp;`, `&gt;`) count as **1 content character** even though they span 4+ HTML characters.

**Key invariant**: `line.content` and the text content of `line.html` are identical modulo entity encoding. Search offsets from `useDiffSearch` are always valid input to `highlightSearchInHtml`.

**Do not break this invariant** when changing either side:
- If you modify the search to operate differently (e.g., case-insensitive, regex), ensure `SearchRange` offsets still refer to content-space characters.
- If you modify `highlightSearchInHtml`, maintain entity-awareness in the walker — HTML entity sequences must advance `textPos` by 1, not by their raw HTML length.

`SearchRange[]` per line are computed in `FileSection.tsx` (`HunkLines`) and `CollapsedSection.tsx` from `fileMatches + currentMatch`. `DiffLine.tsx` renders them via `highlightSearchInHtml`. `searchQuery` is never passed below `DiffContent.tsx` — ranges are the single source of truth at the render layer.

## Interactive Mode Entry Point

**"Enter interactive mode" belongs in `DrawerHeader` overflow menu only, never in `FeedRowActions`.** `FeedRowActions.tsx` renders quick inline actions for the feed list row. The interactive mode entry point is intentionally placed only in the `DrawerHeader` overflow menu (visible when the drawer is open) — it is not a row-level action. When enabling "Enter interactive mode" for a new Trak state, update `DrawerHeader.tsx`'s condition, not `FeedRowActions.tsx`.

## Keep TypeScript Unions in Sync with Rust Enum Variants

When you add new variants to Rust enums that are serialized and sent to the frontend (`TaskState`, `IterationTrigger`, `Phase`, etc.), you **must** also add the corresponding TypeScript discriminated union members in `src/types/workflow.ts`. Serde serializes Rust enum variants as `{ "type": "variant_name", ... }` — if the TypeScript union doesn't include the new member, the frontend silently treats the state as `unknown` or breaks type narrowing.

Checklist before submitting any Rust enum variant addition:
1. Search `src/types/workflow.ts` for the TypeScript type that mirrors the Rust enum
2. Add the new member using the same `{ type: "variant_name"; field: type }` pattern as existing members
3. Verify any `switch` statements or type guards in the frontend still handle all cases

This is a MEDIUM-severity finding reviewers always catch. Missing frontend type updates don't cause compile errors — they only surface at runtime or in type-checking.

## Remove Duplicate Definitions When Extracting to a New Module

When you extract a type, interface, or constant to a new canonical file (e.g., moving `StartupData` from `main.tsx` to `startup.ts`), you must also remove any duplicate local definitions from all consumers:

1. After creating the canonical file, grep for the type/interface name across the codebase
2. Check every consumer file for a local redefinition of the same type
3. Replace local redefinitions with an `import type { X }` from the canonical source

Failing to remove the duplicate definition is a Single Source of Truth violation and is a guaranteed rejection. This step is easy to miss because the code compiles fine with both definitions in scope — TypeScript structural typing means the duplicate is silently compatible.

## Extract Shared Logic to Hooks Before Implementing in Multiple Providers

When the breakdown asks you to add the same state/logic to multiple providers or components (e.g., a staleness timer, a polling flag, a cache invalidation trigger), **extract to a shared hook first** — don't implement inline in each consumer. Duplicate `useState`/`useEffect` blocks across multiple files violate Single Source of Truth and are a guaranteed HIGH-severity rejection.

Pattern:
1. Create `src/hooks/useSharedConcept.ts` with the canonical logic
2. Import and use `const result = useSharedConcept(input)` in each consumer
3. Export any pure utility functions from the same hook file (not a separate file)
4. **If the hook exports a pure utility function** (e.g., a CSS class helper), add a `useSharedConcept.test.ts` unit test alongside it — this file requires unit tests for pure utility modules.

Reference: `src/hooks/useStalenessTimer.ts` exports both `useStalenessTimer` (hook) and `stalenessClass` (pure utility).

## Test Both Sides of Connection State Guards

<!-- compound: perceptibly-epic-pickerel -->

When adding a `connectionState === "connected"` guard to a polling hook, the guard *is* the behavioral change — test it explicitly. A test that only exercises the happy path (connected, data arrives) won't catch a regression that removes the guard.

**Required test coverage when adding a connection guard:**
1. Guard suppresses the operation when `connectionState !== "connected"` — set `mockTransport.connectionState = "disconnected"` before rendering and assert that the callback is never invoked
2. Guard allows the operation when connected (the happy path, often already covered by existing tests)

`useConnectionState` reads from the global transport mock, so mutating `mockTransport.connectionState` is sufficient — no additional mock setup required.

**Components using `usePolling` that still lack connection guards** (known follow-up):
- `src/components/Feed/LatestLogSummary.tsx`
- `src/service/components/ProjectLatestLog.tsx`
