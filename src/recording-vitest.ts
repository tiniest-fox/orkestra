// The recording hook's vitest adapter: a setup file that tells the hook where a test file
// starts and ends. The engine hands a check its path as `ORKESTRA_RECORDING_VITEST`; a test
// stage run through `ORKESTRA_STAGES` lists it first in each project's `setupFiles`, and a
// project running vitest some other way lists it in its own config.
//
// vitest evaluates a setup file once per test file, before the test file itself, so the
// claim here comes before any of the test's own code runs; the `afterAll` registered here
// runs after the test file's own, since vitest runs those hooks in reverse. It imports
// nothing — not even `vitest`, which from this file would resolve to Orkestra's copy
// rather than the project's — and reaches the runner through the global vitest puts its
// own exports on for in-source tests.
//
// Where the hook is not loaded, which is any run of a check that declares no
// `fingerprint:`, this does nothing.

interface Recorder {
  readonly claim: (test: string) => void
  readonly finish: () => void
}

const recorder: unknown = Reflect.get(globalThis, Symbol.for("orkestra.recording"))
const vitest: unknown = Reflect.get(globalThis, "__vitest_index__")

const isRecorder = (value: unknown): value is Recorder =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "claim") === "function" &&
  typeof Reflect.get(value, "finish") === "function"

const testPath = (): string | undefined => {
  const expect: unknown =
    typeof vitest === "object" && vitest !== null ? Reflect.get(vitest, "expect") : undefined
  const getState: unknown =
    typeof expect === "function" ? Reflect.get(expect, "getState") : undefined
  const state: unknown =
    typeof getState === "function" ? Reflect.apply(getState, expect, []) : undefined
  const path: unknown =
    typeof state === "object" && state !== null ? Reflect.get(state, "testPath") : undefined
  return typeof path === "string" ? path : undefined
}

const afterAll: unknown =
  typeof vitest === "object" && vitest !== null ? Reflect.get(vitest, "afterAll") : undefined
const test = testPath()

// `finish` runs with no timeout of its own: the `0` is vitest's word for none. It is
// synchronous, so a timer can never interrupt it; vitest only compares the time it took
// with `hookTimeout` once it returns, and fails the test file when its cost — which grows
// with the scripts the file loaded and the paths it read — reaches 10s on a loaded machine.
// That failed whole files whose every test passed. A `finish` that never returns still
// blocks the worker with or without the timeout, so the timeout guarded nothing.
if (isRecorder(recorder) && typeof afterAll === "function" && test !== undefined) {
  recorder.claim(test)
  Reflect.apply(afterAll, undefined, [() => recorder.finish(), 0])
}
