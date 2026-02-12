---
name: panel-slot
description: Panel/Slot layout system for Orkestra's frontend — primitives, patterns, and anti-patterns
---

# Panel/Slot Layout System

The Orkestra frontend uses a grid-based layout with three primitives for all panel UI. Every slide-in panel goes through this system — no exceptions.

## Three Primitives

| Primitive | Purpose | Use When |
|-----------|---------|----------|
| `Panel` | Visual container (rounded corners, borders, padding) | Structuring content inside a slot |
| `Slot` | Animated grid slot in `PanelLayout` — handles show/hide | Positioning and animating a slide-in panel |
| `ModalPanel` | Viewport overlay via `createPortal` to `document.body` | Dialogs, command palette, popovers anchored to viewport |

**Slide-in panel = `Panel` inside `Slot`.** Viewport overlay = `ModalPanel` directly.

## Adding a New Panel

### 1. Create the component

```tsx
// src/components/MyFeature/MyPanel.tsx
import { Panel } from "../ui";

export function MyPanel() {
  return (
    <Panel>
      <Panel.Header>
        <h2>My Panel</h2>
      </Panel.Header>
      <Panel.Body>
        {/* content */}
      </Panel.Body>
    </Panel>
  );
}
```

### 2. Add a Slot in `Orkestra.tsx`

Find the `PanelLayout` in `src/Orkestra.tsx` and add a new `Slot`:

```tsx
<Slot
  id="my-panel"
  type="panel"         // or "secondaryPanel" for nested sidebar
  size="md"            // "sm" | "md" | "lg" | "xl"
  visible={myPanelVisible}
>
  {myPanelVisible && <MyPanel />}
</Slot>
```

### 3. Add a preset in `providers/presets.ts`

Add entries to the types and lookup table:

```typescript
// Add to PresetName type
export type PresetName = ... | "MyFeature";

// Add to SlotContent type (if new component type)
export type SlotContent = ... | "MyPanel";

// Add to PRESETS lookup
MyFeature: { content: "KanbanBoard", panel: "MyPanel", secondaryPanel: null },
```

### 4. Add a method in `DisplayContextProvider`

```typescript
// In src/providers/DisplayContextProvider.tsx
const showMyFeature = useCallback(() => {
  setLayout({ preset: "MyFeature", isArchive: false, taskId: null, subtaskId: null, commitHash: null });
}, []);
```

Expose it in the context value.

## Visibility Flow

```
User action
  → DisplayContext method (e.g., showMyFeature)
    → layout state updates (preset: "MyFeature")
      → parent derives boolean: const myPanelVisible = layout.preset === "MyFeature"
        → <Slot visible={myPanelVisible}>{myPanelVisible && <MyPanel />}</Slot>
          → Slot animates grid sizing and opacity
```

On close:
- `Slot` fades out (opacity → 0, grid column → 0)
- `onTransitionEnd` fires when opacity transition completes
- `setDisplayedContent(null)` unmounts the child tree
- Cleanup effects run, panel resets state on reopen

## Anti-Patterns (BANNED)

### No absolute/fixed for slide-in panels
```tsx
// WRONG — bypasses layout system
<div className="fixed right-0 top-0 h-full w-96">
  <MyPanel />
</div>

// CORRECT — uses Slot
<Slot id="my-panel" type="panel" size="md" visible={visible}>
  {visible && <MyPanel />}
</Slot>
```

### No manual AnimatePresence
```tsx
// WRONG — Slot handles all animations
<AnimatePresence>
  {visible && <motion.div><MyPanel /></motion.div>}
</AnimatePresence>

// CORRECT — Slot handles transitions
<Slot visible={visible}>
  {visible && <MyPanel />}
</Slot>
```

### No local state for panel visibility
```tsx
// WRONG — navigation state lives in DisplayContext
const [showPanel, setShowPanel] = useState(false);

// CORRECT — use DisplayContext
const { showMyFeature } = useDisplayContext();
```

## Reference Files

| File | Role |
|------|------|
| `src/Orkestra.tsx` | All Slots — canonical example of the layout |
| `src/components/ui/PanelContainer/PanelLayout.tsx` | Grid container implementation |
| `src/components/ui/PanelContainer/Slot.tsx` | Animated slot implementation |
| `src/components/ui/PanelContainer/types.ts` | SlotProps, animation config |
| `src/providers/presets.ts` | All preset definitions (single source of truth) |
| `src/providers/DisplayContextProvider.tsx` | Navigation methods and layout state |
| `src/components/ui/Panel.tsx` | Visual container component |
| `src/components/ui/ModalPanel.tsx` | Viewport overlay component |

## Slot Props Reference

```typescript
interface SlotProps {
  id: string;           // Unique slot identifier
  type: "content" | "panel" | "secondaryPanel";  // Grid position
  size: "sm" | "md" | "lg" | "xl";               // Column width
  visible: boolean;     // Controls show/hide animation
  contentKey?: string;  // When changed, slot closes then reopens (content switching)
  plain?: boolean;      // Skip visual styling (for nested PanelLayouts)
  className?: string;   // Additional classes on the visual wrapper
  children: ReactNode;
}
```
