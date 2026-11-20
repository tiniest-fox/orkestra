// What a trak leaves behind once its checkout is gone: a folder under
// `.orkestra/records/` holding how it went and every document it filed.
//
// Tier 2, and it has to be — the write happens inside a drive, through the real
// `Workspace` adapter, into the throwaway repository the fixture makes. What the
// record *says* is `record.ts`'s own test; what this owes is that every ending writes
// one without being asked, and that rebuilding the corpus twice changes nothing.

import * as fs from "node:fs"
import * as path from "node:path"
import { Effect, Schedule } from "effect"
import { describe, expect, it } from "vitest"
import { composer, runFlow, step } from "../support/flow.js"
import { forgeSaying } from "../support/forge.js"
import { act, create, human } from "../support/scenario.js"
import { reply } from "../support/scripted-agent.js"
import { ForgeAnswer } from "../../src/vcs/index.js"
import { Events } from "../../src/workflow/domain/event.js"
import type { TrakId } from "../../src/workflow/domain/trak.js"
import { Drives } from "../../src/app/drive.js"
import { writeCorpus } from "../../src/app/records.js"

const CORPUS = path.join(".orkestra", "records")

/** Every file in the corpus, keyed by its path relative to the corpus root. */
const corpusOf = (repoDir: string): ReadonlyMap<string, string> => {
  const root = path.join(repoDir, CORPUS)
  const found = new Map<string, string>()
  if (!fs.existsSync(root)) return found
  for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
    const full = path.join(entry.parentPath, entry.name)
    if (entry.isFile()) found.set(path.relative(root, full), fs.readFileSync(full, "utf8"))
  }
  return found
}

/** The one folder every file in the corpus is under, which for one trak is all of it. */
const folderIn = (files: ReadonlyMap<string, string>): string => {
  const folders = new Set<string>()
  for (const file of files.keys()) folders.add(path.dirname(file))
  const [only] = folders
  return only ?? ""
}

const namesIn = (files: ReadonlyMap<string, string>): readonly string[] => {
  const names: string[] = []
  for (const file of files.keys()) names.push(path.basename(file))
  return names.toSorted()
}

/**
 * The regenerate, with a workspace failure treated as a broken test rather than an
 * outcome — the directory is the fixture's own, so there is nothing to assert about
 * it refusing to be written.
 */
const rebuild = writeCorpus().pipe(Effect.orDie)

/**
 * Merge through the daemon's own drive rather than through `advance`.
 *
 * The record is written by the drive, after the trak has come to rest — so a test
 * that called `advance` directly would assert nothing about the thing that actually
 * files it.
 */
const mergeAndWait = (id: TrakId) =>
  Effect.gen(function* () {
    const drives = yield* Drives
    yield* drives.start(id, () => Events.merged())
    yield* Effect.repeat(drives.driving(id), {
      until: (driving) => !driving,
      schedule: Schedule.spaced("1 millis"),
    }).pipe(Effect.timeout("20 seconds"), Effect.orDie)
  })

/** The archive, through the same drive — what the Archive press on a finished trak runs. */
const archiveAndWait = (id: TrakId) =>
  Effect.gen(function* () {
    const drives = yield* Drives
    yield* drives.start(id, () => Events.closed())
    yield* Effect.repeat(drives.driving(id), {
      until: (driving) => !driving,
      schedule: Schedule.spaced("1 millis"),
    }).pipe(Effect.timeout("20 seconds"), Effect.orDie)
  })

/**
 * The abandonment, through the drive that interrupts whatever is running — what the
 * Archive press on a trak still going runs.
 */
const abandonAndWait = (id: TrakId, why: string) =>
  Effect.gen(function* () {
    const drives = yield* Drives
    yield* drives.takeOver(id, () => Events.abandoned(why))
    yield* Effect.repeat(drives.driving(id), {
      until: (driving) => !driving,
      schedule: Schedule.spaced("1 millis"),
    }).pipe(Effect.timeout("20 seconds"), Effect.orDie)
  })

describe("a trak whose checkout is gone leaves a record", () => {
  it("writes a folder holding how it went and what it filed, without being asked", async () => {
    await runFlow(
      [composer("work"), step(1, "work", reply.artifact("done"))],
      (id, _agentLog, _checksLog, repoDir) =>
        Effect.gen(function* () {
          yield* create(id, "Add a --json flag")
          yield* act(id, 0, human.approve())
          yield* act(id, 1, human.approve())
          // Nothing yet: a finished trak is one nobody has decided about.
          expect([...corpusOf(repoDir).keys()]).toEqual([])

          yield* mergeAndWait(id)

          const files = corpusOf(repoDir)
          const folder = folderIn(files)
          // The **whole** id, not a prefix: a trak is named with three words, so
          // eight characters of one is a fragment of its adjective — it matches no
          // directory under `.orkestra/.database/traks/` and `ork resume` takes no
          // partial phrase. The day and the slug in front of it are what make the
          // folder readable; the id is what makes it findable.
          const day = folder.split("/")[0] ?? ""
          expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
          expect(folder).toBe(`${day}/add-a-json-flag-${id}`)
          // The record, and the artifact — which is the half with no other way out
          // of the log, since the worktree that held `.orkestra/.trak/` is gone.
          expect(namesIn(files)).toEqual(["01-work.md", "record.md"])
          const written = files.get(path.join(folder, "record.md")) ?? ""
          // And on the one line a cross-trak grep reads, which is what it is for.
          expect(written).toContain(`\`${id}\` · merged ·`)
          expect(written).toContain("- branch `trak/")
          expect(written).toContain("[01-work.md](01-work.md)")
          expect(files.get(path.join(folder, "01-work.md"))).toContain("done")
        }),
    )
  })

  it("writes one for a trak whose pull request merged, at the archive", async () => {
    // These traks never had a record: the work went in on the forge, and until the
    // archive asked GitHub nothing here could learn it. The log now ends `Merged`,
    // so `keepRecord` files it exactly as a local merge is filed.
    await runFlow(
      [composer("work"), step(1, "work", reply.artifact("done"))],
      (id, _agentLog, _checksLog, repoDir) =>
        Effect.gen(function* () {
          yield* create(id, "Add a --json flag")
          yield* act(id, 0, human.approve())
          yield* act(id, 1, human.approve())
          expect([...corpusOf(repoDir).keys()]).toEqual([])

          yield* archiveAndWait(id)

          const files = corpusOf(repoDir)
          const written = files.get(path.join(folderIn(files), "record.md")) ?? ""
          expect(written).toContain(`\`${id}\` · merged ·`)
        }),
      undefined,
      undefined,
      forgeSaying(
        ForgeAnswer.Found({
          pullRequest: {
            number: 14,
            url: "https://forge/pr/14",
            title: "Add a --json flag",
            state: "merged",
            mergeCommit: "9f31c07aa11",
            isDraft: false,
            merging: "unknown",
            rollup: "passed",
            checks: [],
            reviews: [],
            conversation: [],
            truncated: [],
            mergeMethods: [],
          },
        }),
      ),
    )
  })
})

describe("an archive leaves a record too", () => {
  it("writes one at the archive of a trak that only wrote documents", async () => {
    // The scripted step files an artifact and touches nothing else, so the branch
    // never moves and the archive is the only door — the shape of a survey or a
    // research piece. Its documents are gitignored, so the folder is the only place
    // they survive the checkout.
    await runFlow(
      [composer("work"), step(1, "work", reply.artifact("found it"))],
      (id, _agentLog, _checksLog, repoDir) =>
        Effect.gen(function* () {
          yield* create(id, "Survey the schema")
          yield* act(id, 0, human.approve())
          yield* act(id, 1, human.approve())
          expect([...corpusOf(repoDir).keys()]).toEqual([])

          yield* archiveAndWait(id)

          const files = corpusOf(repoDir)
          const folder = folderIn(files)
          expect(namesIn(files)).toEqual(["01-work.md", "record.md"])
          expect(files.get(path.join(folder, "record.md"))).toContain(`\`${id}\` · closed ·`)
          expect(files.get(path.join(folder, "01-work.md"))).toContain("found it")
        }),
    )
  })

  it("writes one at an abandonment, which is the other way a checkout goes", async () => {
    await runFlow(
      [composer("work"), step(1, "work", reply.artifact("done"))],
      (id, _agentLog, _checksLog, repoDir) =>
        Effect.gen(function* () {
          yield* create(id, "Add a --json flag")
          yield* act(id, 0, human.approve())
          expect([...corpusOf(repoDir).keys()]).toEqual([])

          yield* abandonAndWait(id, "changed direction")

          const files = corpusOf(repoDir)
          const written = files.get(path.join(folderIn(files), "record.md")) ?? ""
          expect(written).toContain(`\`${id}\` · abandoned — changed direction ·`)
        }),
    )
  })
})

describe("the corpus is a function of the logs", () => {
  it("rebuilds the whole corpus from history, and a second run changes nothing", async () => {
    await runFlow(
      [composer("work"), step(1, "work", reply.artifact("done"))],
      (id, _agentLog, _checksLog, repoDir) =>
        Effect.gen(function* () {
          yield* create(id, "Add a --json flag")
          yield* act(id, 0, human.approve())
          yield* act(id, 1, human.approve())
          yield* mergeAndWait(id)

          // What the merge itself wrote, kept before it is cleared: this is the
          // half the design rests on — one writer, two callers, so the backfill and
          // the merge cannot produce two formats.
          const atMerge = corpusOf(repoDir)
          expect(atMerge.size).toBe(2)

          // Cleared behind the writer's back, which is what a checkout that merged
          // everything before the corpus existed looks like.
          fs.rmSync(path.join(repoDir, CORPUS), { recursive: true, force: true })
          expect([...corpusOf(repoDir).keys()]).toEqual([])

          const first = yield* rebuild
          const after = corpusOf(repoDir)
          expect(first).toHaveLength(1)
          // Contents included. Comparing only the second rebuild to the first
          // asserted the backfill agrees with itself, which it would go on doing
          // after somebody split the two paths apart.
          expect(after).toEqual(atMerge)

          // Byte-identical, because the folder is a function of the log and the log
          // did not move. This is what makes a format change a re-run.
          expect(yield* rebuild).toEqual(first)
          expect(corpusOf(repoDir)).toEqual(after)
        }),
    )
  })
})
