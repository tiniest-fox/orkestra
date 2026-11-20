// A vitest sequencer that starts the test files that took longest first, by the durations
// file `TEST_DURATIONS_IN` names — what `durations-reporter.ts` wrote on an earlier run.
// `.github/workflows/release.yml` hands it the last release's, because a fresh runner has
// no vitest results cache: vitest then orders by project name and file size, so a short
// file with a long run, such as `two-engines.test.ts`, starts last and the run waits on it.
//
// Longest first across both projects, since they share one pool and one worker count. A
// file the durations do not name runs first, as vitest runs an unknown file first. With no
// `TEST_DURATIONS_IN` it is vitest's own order, which a local results cache keeps.
//
// Under `--shard` it splits by the same durations, so the shards finish together: vitest's
// own split is by a hash of each path, which can put the real-container files, a third of
// the suite's time between four files, in one shard. **Every shard has to read the same
// durations file**, or two shards disagree on the split and a file runs twice or never;
// `release.yml` picks it by a rule each shard and each re-run of one resolves the same way.
// `TEST_SHARD_OUT`, where set, gets the shard's files, one path from the root a line, and
// `TEST_FILES_OUT` every shard's, which `release (engine)` checks the slices covered.

import { readFileSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { Schema } from "effect"
import { BaseSequencer, type TestSpecification } from "vitest/node"

const ROOT = join(import.meta.dirname, "..", "..")

/** One line of the durations file: the fields of it this reads. */
const Took = Schema.parseJson(
  Schema.Struct({ file: Schema.String, ms: Schema.Number, importMs: Schema.Number }),
)

/** Each file's milliseconds on a worker, importing it and running it, by its path from the root. */
const recorded = (path: string): Map<string, number> => {
  const took = new Map<string, number>()
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue
    const entry = Schema.decodeUnknownSync(Took)(line)
    took.set(entry.file, entry.ms + entry.importMs)
  }
  return took
}

/**
 * The files of shard `index` of `count`, 1-based as `--shard` writes it: longest first, each
 * to the shard with the least time so far, the lowest-numbered on a tie. A file the
 * durations do not name weighs the mean of those they do. The result depends only on the
 * files and the durations, so every shard computes the same split.
 */
export const shardByDuration = (
  files: readonly string[],
  took: ReadonlyMap<string, number>,
  index: number,
  count: number,
): string[] => {
  const known = [...took.values()]
  const fallback = known.length === 0 ? 1 : known.reduce((sum, ms) => sum + ms, 0) / known.length
  const weighed = files.map((file) => ({ file, ms: took.get(file) ?? fallback }))
  weighed.sort((a, b) => b.ms - a.ms || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
  const loads = Array.from({ length: count }, () => 0)
  const picked: string[] = []
  for (const { file, ms } of weighed) {
    const lightest = loads.indexOf(Math.min(...loads))
    loads[lightest] = (loads[lightest] ?? 0) + ms
    if (lightest === index - 1) picked.push(file)
  }
  return picked
}

/** Each spec's path from the root, a line each, into `out` where it names a file. */
const listInto = (out: string | undefined, specs: readonly TestSpecification[]): void => {
  if (out === undefined || out === "") return
  writeFileSync(out, specs.map((spec) => `${relative(ROOT, spec.moduleId)}\n`).join(""))
}

export class DurationsSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const from = process.env["TEST_DURATIONS_IN"]
    const chosen =
      from === undefined || from === ""
        ? await super.shard(files)
        : this.byDuration(files, recorded(from))
    listInto(process.env["TEST_SHARD_OUT"], chosen)
    listInto(process.env["TEST_FILES_OUT"], files)
    return chosen
  }

  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const from = process.env["TEST_DURATIONS_IN"]
    if (from === undefined || from === "") return super.sort(files)
    const took = recorded(from)
    const ms = (spec: TestSpecification): number =>
      took.get(relative(ROOT, spec.moduleId)) ?? Number.MAX_SAFE_INTEGER
    return [...files].sort((a, b) => ms(b) - ms(a))
  }

  private byDuration(files: TestSpecification[], took: Map<string, number>): TestSpecification[] {
    const { index, count } = this.ctx.config.shard ?? { index: 1, count: 1 }
    const path = (spec: TestSpecification): string => relative(ROOT, spec.moduleId)
    const picked = new Set(shardByDuration(files.map(path), took, index, count))
    return files.filter((spec) => picked.has(path(spec)))
  }
}
