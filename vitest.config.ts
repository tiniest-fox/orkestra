import { defineConfig } from "vitest/config"
import { DurationsSequencer } from "./test/support/durations-sequencer.js"

// src/smoke.ts spawns a real agent and costs tokens — `pnpm smoke` only.
const exclude = ["**/node_modules/**", "test/fixtures/**"]

// What lets `git` be sealed under `fingerprint:`: no configuration but a repository's own,
// no templates copied into a new one, and an identity and dates of its own, so a fixture's
// commits do not depend on the machine the tests run on. The binary and the helpers in
// `git --exec-path` are what the hook records in their place.
const env = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TEMPLATE_DIR: "",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
}

export default defineConfig({
  test: {
    // Every run's temp folders under one directory of its own, removed with the run.
    globalSetup: ["./test/support/run-tmpdir.ts"],
    sequence: { sequencer: DurationsSequencer },
    // A worker per core, not vitest's one fewer: much of a flow's time is spent waiting on
    // a child process or git, so the extra worker fills a core that would sit idle. On a box
    // other work already saturates, it buys nothing and spends more CPU.
    maxWorkers: "100%",
    // Two projects for one reason: they need different timeouts, and the split is what
    // keeps the tight one tight.
    //
    // A test under `test/` spawns processes and runs git, so its wall-clock is the
    // machine's and not the code's — and this gate runs inside a worktree while other
    // traks verify beside it. At vitest's default 5s those suites report contention as
    // failure. A unit test beside the code is pure and returns in single-digit
    // milliseconds, so 5s there is still an assertion about the code, and raising it
    // everywhere would be the thing that hides a genuinely slow one.
    //
    // Not `fileParallelism: false`: serialising drops vitest's own share of the
    // contention and none of the rest of the machine's, so on a loaded box it times the
    // same tests out and takes several times the wall-clock to do it.
    projects: [
      {
        test: {
          // Unit tests live beside the code (mirroring Rust's #[cfg(test)] mod tests).
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude,
          env,
        },
      },
      {
        test: {
          // Scenarios and contract suites span files and live under test/.
          name: "flows",
          include: ["test/**/*.test.ts"],
          exclude,
          env,
          testTimeout: 30_000,
        },
      },
    ],
  },
})
