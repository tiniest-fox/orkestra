import { defineConfig } from "vitest/config"

// Separate from the root `vitest.config.ts`, which scopes itself to `src/**` and
// `test/**` and so never sees this package — the root `verify` chains this package's
// own `verify` instead. Only tier-1 tests live here: the pure decisions beside the code.
// Nothing under test imports `electron`.
//
// The recording hook's setup file, which a check with `fingerprint:` names, as the root
// config lists it. Nothing without it.
const recording = process.env["ORKESTRA_RECORDING_VITEST"]

export default defineConfig({
  test: {
    // Every run's temp folders under one directory of its own, removed with the run.
    globalSetup: ["../test/support/run-tmpdir.ts"],
    include: ["src/**/*.test.ts"],
    setupFiles: recording === undefined ? [] : [recording],
  },
})
