# Technical Design

Two independent bugs, both one-liner fixes using existing infrastructure.

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Stale stage in prompt | `chat_promotion_guidance.md` line 10 hardcodes `"stage": "planning"` — model copies it, backend rejects | Remove `"stage"` from the example JSON, or replace with a placeholder instruction |
| `[object Object]` toast | `String(err)` on Tauri's `{ code, message }` error objects | Replace with existing `extractErrorMessage()` from `src/utils/errors.ts` |

`extractErrorMessage` already exists, is tested (`src/utils/errors.test.ts`), and is used in `GitHistoryProvider`, `useTaskDrawerState`, and `ErrorState` — but 6 files still use raw `String(err)`.

**Testing**: The prompt fix is verified by reading the template. The error extraction fix is covered by existing `extractErrorMessage` unit tests. E2e verification: accept a proposal → chat promotes to Trak without error; force a backend rejection → toast shows readable message.

---

## Implementation Instructions

## Trak Summary

Accepting an assistant-chat proposal fails with `[object Object]` toast. Two bugs: (1) the promotion-guidance prompt template hardcodes `"planning"` as a stage name, which the model copies verbatim — backend rejects it since the actual stage is `"plan"`. (2) The frontend uses `String(err)` on Tauri's `{ code, message }` error objects, producing `[object Object]` instead of the actual message.

## What to Do

### Bug 1: Fix the prompt template

**File:** `crates/orkestra-core/src/prompts/templates/assistant/chat_promotion_guidance.md`

The example JSON block (lines 6-14) hardcodes `"stage": "planning"` and `"flow": "default"`. The model copies these literally. Replace the example so it doesn't contain any specific stage or flow names that could be copied. Instead, use placeholder comments that instruct the model to pick from the available flows list below.

Change the example block to something like:
```
````
```ork
{
  "type": "proposal",
  "flow": "<flow name from list below>",
  "stage": "<stage name from list below>",
  "title": "Short title here",
  "content": "## Summary\n\nDescription of the work..."
}
```
````
```

This ensures the model reads the dynamically-injected `{available_flows}` section (line 21) to pick valid names, rather than copying stale literals.

### Bug 2: Replace `String(err)` with `extractErrorMessage`

The utility already exists at `src/utils/errors.ts` and handles `{ code, message }` objects, `Error` instances, and plain strings. It's tested in `src/utils/errors.test.ts`.

**Files to update** — replace every `String(err)` with `extractErrorMessage(err)` and add the import:

| File | Lines with `String(err)` |
|------|-------------------------|
| `src/components/Feed/AssistantDrawer.tsx` | 193, 213, 227, 393, 431, 670 |
| `src/components/Feed/FeedView.tsx` | 388, 393, 398, 405, 411 |
| `src/components/Feed/SkipStageModal.tsx` | 40 |
| `src/components/Feed/SendToStageModal.tsx` | 62 |
| `src/components/Feed/FileViewerDrawer.tsx` | 43 |
| `src/components/Feed/Drawer/Sections/SubtasksSection.tsx` | 128 |

For each file:
1. Add `import { extractErrorMessage } from "../../utils/errors";` (adjust relative path for depth)
2. Replace `String(err)` with `extractErrorMessage(err)` at all listed lines
3. Also update `isDisconnectError` in `src/utils/transportErrors.ts` to use `extractErrorMessage` instead of its inline fallback — keeps error extraction consistent:
   ```ts
   import { extractErrorMessage } from "./errors";
   // ...
   const msg = extractErrorMessage(err);
   ```

**Pattern to follow:** See `src/components/Feed/Drawer/useTaskDrawerState.ts` — it already imports and uses `extractErrorMessage` correctly.

## Acceptance Criteria

- The prompt template example contains no hardcoded stage or flow names — only placeholders directing the model to the available flows list
- All `showError(String(err))` calls in the listed files use `extractErrorMessage(err)` instead
- `isDisconnectError` in `transportErrors.ts` delegates to `extractErrorMessage` for consistent error message extraction
- `cargo fmt --all -- --check` and `cargo clippy --workspace --tests` pass (prompt is a .md file, no Rust code changes)
- Frontend builds without errors (`pnpm build`)