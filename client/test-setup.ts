// Loaded before every test file. One import, and one happy-dom gap.
//
// `@testing-library/jest-dom` adds the matchers that let an assertion say what it
// means: `toBeDisabled()` rather than `hasAttribute("disabled")`, `toHaveValue()`
// rather than a `getByDisplayValue` lookup standing in for one. Without it those read
// as DOM trivia and the thing being asserted gets lost in the mechanism.
import "@testing-library/jest-dom/vitest"
import { configure } from "@testing-library/dom"

/**
 * How long a `findBy*` waits for an element to appear.
 *
 * The default is 1s, which is a wall-clock budget on a machine that is also running
 * other traks' suites: a render queued behind another worker arrives after it, and a page
 * test fails on contention while the same test alone passes. Nothing here waits for real
 * work — a fake resolves immediately — so a query that has not found its element in five
 * seconds has not found it.
 */
configure({ asyncUtilTimeout: 5_000 })

/**
 * happy-dom supplies `scrollIntoView`, `ResizeObserver` and `localStorage` itself — the
 * first two as no-ops, the store as a real one per test file — so nothing here stubs them.
 *
 * **So every test below tier 3 draws a field whose observer can never fire, and the thing
 * to know is where that is made up for**: `e2e/app.spec.ts`'s two *re-fits … when the
 * drawer narrows under it* cases, which resize the window and poll the box. They are the
 * only cases in the repository that can fail if the observer goes.
 */

/**
 * The gap: happy-dom has no `EventSource`, and constructing one is a `ReferenceError`.
 * The root route mounts the engine's stream behind the session gate, so every page test
 * that mounts `routeTree` — which is every page test — opens one the moment the gate
 * admits it.
 *
 * **Inert**, because nothing below tier 3 can observe what the real one does. MSW cannot see an `EventSource`, and the
 * hook behind it is tested by handing frames in — `useEngineStream.test.tsx` — so a stub
 * that delivered anything would be a second fixture for a thing already covered. What it
 * has to do is be constructible, take listeners, and close.
 *
 * Defined rather than assigned: the DOM type wants the whole
 * interface — `readyState`, the three `on*` handlers, the constants — and an inert class
 * carrying all of that would be a fixture for a thing nothing reads.
 *
 * Configurable, so a file testing what a stream delivers can put its own in place with
 * `vi.stubGlobal`.
 *
 * **Guarded, because this file loads for the node-environment test too.**
 * `api/transport.test.ts` opts out of the DOM with a docblock, and is defined by having none.
 */
if (typeof window !== "undefined")
  Object.defineProperty(window, "EventSource", {
    configurable: true,
    value: class {
      addEventListener(): void {}
      removeEventListener(): void {}
      close(): void {}
    },
  })
