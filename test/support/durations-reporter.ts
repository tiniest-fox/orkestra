// A vitest reporter that records how long each test file and each test took, for the
// artifact `.github/workflows/checks.yml` uploads. `.orkestra/checks/verify.sh` adds it
// only when `TEST_DURATIONS_OUT` names a file, which only CI sets. It writes nothing to
// stdout: the check's output is what an agent reads, and vitest's own `json` reporter
// logs a line there naming the file it wrote.
//
// One JSON object a line, appended as each file finishes, so the three suites can share
// one file and a run that fails or is killed still keeps every file it finished. `ms` is
// what the default reporter prints beside the file: its tests and hooks. `importMs` is
// collecting it — importing the file and running its `describe` callbacks. Paths are from
// the repository root, because the three suites share one file.

import { appendFileSync } from "node:fs"
import { join, relative } from "node:path"
import type { Reporter, TestModule } from "vitest/node"

const ROOT = join(import.meta.dirname, "..", "..")

// oxlint-disable-next-line import/no-default-export -- vitest loads a reporter from a path by its default export
export default class DurationsReporter implements Reporter {
  onTestModuleEnd(module: TestModule): void {
    const out = process.env["TEST_DURATIONS_OUT"]
    if (out === undefined || out === "") return
    const diagnostic = module.diagnostic()
    const tests = [...module.children.allTests()].map((test) => ({
      name: test.fullName,
      state: test.result().state,
      ms: Math.round(test.diagnostic()?.duration ?? 0),
    }))
    const line = {
      file: relative(ROOT, module.moduleId),
      state: module.state(),
      ms: Math.round(diagnostic.duration),
      importMs: Math.round(diagnostic.collectDuration),
      tests,
    }
    appendFileSync(out, `${JSON.stringify(line)}\n`)
  }
}
