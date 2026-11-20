// The file browser's routes: the project checkout's tree, one file out of it, and a text
// search — against the scenario's real repository, since which files git sees is the
// subject.
//
// What is pinned here is the surface: what the tree lists and leaves out, the uncommitted
// edit the search finds, and every path the content route refuses. The refusals are the
// security boundary — `src/app/project-tree.ts` says why membership in the tree is the
// guard — so each way out of the checkout has a case of its own.

import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer, Schema, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { FileContentDto, FileSearchDto, ProjectFilesDto } from "@orkestra/shared/dto/files"
import { toWeb, type HttpServerResponse } from "@effect/platform/HttpServerResponse"
import { Process, type ProcessShape, type Spawned } from "../../src/agent/ports/process.js"
import { GitCliLayer } from "../../src/vcs/adapters/git-cli.js"
import { Vcs } from "../../src/vcs/ports/vcs.js"
import type { GitFailed } from "../../src/vcs/types/errors.js"
import { onGit } from "../support/flow.js"
import { commitOnHost, git } from "../support/git.js"
import { mount } from "../support/http.js"
import { fileRoutes } from "../../src/app/routes/files.js"

const { call } = mount(fileRoutes)

const { runFlow } = onGit

const jsonOf = (response: HttpServerResponse) =>
  Effect.promise(async (): Promise<unknown> => JSON.parse(await toWeb(response).text()))

const ask = (path: string) => call(new Request(`http://localhost/api/files${path}`))

const decoded = <A, I>(decode: Schema.Schema<A, I>, path: string) =>
  Effect.gen(function* () {
    const response = yield* ask(path)
    expect(response.status).toBe(200)
    return Schema.decodeUnknownSync(decode)(yield* jsonOf(response))
  })

const content = (path: string) => `/content?path=${encodeURIComponent(path)}`

/**
 * A project with one of everything the browser has to tell apart: a tracked file with an
 * uncommitted edit, an untracked one, two ignored ones, a binary, one over the cap, a
 * tracked file deleted on disk, tracked links out of the checkout, to an ignored file and
 * into `.git/`, and one to another listed file.
 */
const furnish = (repoDir: string): void => {
  appendFileSync(join(repoDir, ".gitignore"), ".env\nnode_modules/\n")
  mkdirSync(join(repoDir, "lib"))
  commitOnHost(repoDir, "lib/decide.ts", "export const decide = 1\n")
  commitOnHost(repoDir, "gone.md", "about to go\n")
  symlinkSync(mkdtempSync(join(tmpdir(), "outside-")), join(repoDir, "outside"))
  symlinkSync("/etc/hostname", join(repoDir, "hostname"))
  symlinkSync(".env", join(repoDir, "cfg"))
  symlinkSync(".git/config", join(repoDir, "gitcfg"))
  symlinkSync("lib/decide.ts", join(repoDir, "alias"))
  git(repoDir, "add", ".gitignore", "outside", "hostname", "cfg", "gitcfg", "alias")
  git(repoDir, "commit", "-m", "ignore secrets, and links out, in and across")

  writeFileSync(join(repoDir, "lib/decide.ts"), "export const decide = 1\n// Uncommitted marker\n")
  writeFileSync(join(repoDir, "notes.txt"), "an untracked note\n")
  writeFileSync(join(repoDir, ".env"), "SECRET=1\n")
  mkdirSync(join(repoDir, "node_modules"))
  writeFileSync(join(repoDir, "node_modules/dep.js"), "module.exports = 'marker'\n")
  writeFileSync(join(repoDir, "logo.bin"), Buffer.from([0x89, 0x50, 0x00, 0x47]))
  writeFileSync(join(repoDir, "big.txt"), "x".repeat(1024 * 1024 + 1))
  unlinkSync(join(repoDir, "gone.md"))
}

describe("the file browser's tree", () => {
  it("lists tracked and untracked files on disk, and nothing ignored or deleted", async () => {
    await runFlow([], (_id, _agent, _checks, repoDir) =>
      Effect.gen(function* () {
        furnish(repoDir)
        const { paths } = yield* decoded(ProjectFilesDto, "")
        expect(paths).toEqual(
          expect.arrayContaining(["README.md", "lib/decide.ts", "notes.txt", "logo.bin"]),
        )
        expect(paths).not.toContain(".env")
        expect(paths).not.toContain("node_modules/dep.js")
        expect(paths).not.toContain("gone.md")
      }),
    )
  })
})

describe("the file browser's content route", () => {
  it("reads a file as it is on disk, uncommitted edit included", async () => {
    await runFlow([], (_id, _agent, _checks, repoDir) =>
      Effect.gen(function* () {
        furnish(repoDir)
        expect(yield* decoded(FileContentDto, content("lib/decide.ts"))).toStrictEqual({
          _tag: "Text",
          path: "lib/decide.ts",
          text: "export const decide = 1\n// Uncommitted marker\n",
          lines: 2,
        })
      }),
    )
  })

  it("answers a binary file and one over the cap with their size and no content", async () => {
    await runFlow([], (_id, _agent, _checks, repoDir) =>
      Effect.gen(function* () {
        furnish(repoDir)
        expect(yield* decoded(FileContentDto, content("logo.bin"))).toStrictEqual({
          _tag: "Binary",
          path: "logo.bin",
          bytes: 4,
        })
        expect(yield* decoded(FileContentDto, content("big.txt"))).toStrictEqual({
          _tag: "TooLarge",
          path: "big.txt",
          bytes: 1024 * 1024 + 1,
        })
      }),
    )
  })

  it("refuses every path outside what the tree lists", async () => {
    await runFlow([], (_id, _agent, _checks, repoDir) =>
      Effect.gen(function* () {
        furnish(repoDir)
        for (const path of [
          "../../../etc/passwd",
          "src/../../etc/passwd",
          "/etc/passwd",
          ".env",
          "node_modules/dep.js",
          "gone.md",
          // Tracked, so listed — and refused because each resolves to a path git does not
          // list: out of the checkout, to an ignored file, and into `.git/`.
          "outside",
          "hostname",
          "cfg",
          "gitcfg",
          ".git/config",
          "no-such-file.ts",
        ]) {
          expect({ path, status: (yield* ask(content(path))).status }).toStrictEqual({
            path,
            status: 404,
          })
        }
        expect((yield* ask("/content")).status).toBe(400)
        // A link to a file the list does name still opens, as that file.
        expect(yield* decoded(FileContentDto, content("alias"))).toMatchObject({
          _tag: "Text",
          path: "alias",
          lines: 2,
        })
      }),
    )
  })
})

describe("the file browser's search", () => {
  it("finds an uncommitted line and an untracked file, ignoring case, and no ignored file", async () => {
    await runFlow([], (_id, _agent, _checks, repoDir) =>
      Effect.gen(function* () {
        furnish(repoDir)
        expect(yield* decoded(FileSearchDto, "/search?q=MARKER")).toStrictEqual({
          matches: [{ path: "lib/decide.ts", line: 2, text: "// Uncommitted marker" }],
          cut: false,
        })
        expect((yield* decoded(FileSearchDto, "/search?q=untracked")).matches).toStrictEqual([
          { path: "notes.txt", line: 1, text: "an untracked note" },
        ])
      }),
    )
  })

  it("stops at the cap and says the answer was cut", async () => {
    await runFlow([], (_id, _agent, _checks, repoDir) =>
      Effect.gen(function* () {
        // More matching lines than the route's cap of 200, in one file and across two.
        writeFileSync(join(repoDir, "many.txt"), "needle\n".repeat(150))
        writeFileSync(join(repoDir, "more.txt"), "needle\n".repeat(150))
        const found = yield* decoded(FileSearchDto, "/search?q=needle")
        expect(found.cut).toBe(true)
        expect(found.matches).toHaveLength(200)
        expect(found.matches.at(-1)).toStrictEqual({ path: "more.txt", line: 50, text: "needle" })
      }),
    )
  })

  it("reads a query that starts with a dash as text, and no match as an empty answer", async () => {
    await runFlow([], (_id, _agent, _checks, repoDir) =>
      Effect.gen(function* () {
        furnish(repoDir)
        expect(yield* decoded(FileSearchDto, "/search?q=-n")).toStrictEqual({
          matches: [],
          cut: false,
        })
        expect(yield* decoded(FileSearchDto, "/search?q=frobnicate")).toStrictEqual({
          matches: [],
          cut: false,
        })
        expect((yield* ask("/search")).status).toBe(400)
      }),
    )
  })
})

/** A process that printed `line` and exited 0. */
const answered = (line: string): Spawned => ({
  pid: 4242,
  lines: Stream.make(line),
  exited: Effect.succeed({ code: 0, signal: undefined, stderr: "" }),
  send: () => Effect.void,
  endInput: Effect.void,
})

/**
 * A `Process` that answers git's two startup questions, and whose `git grep` prints a
 * match per pull, forever — so a search that read to the end would never answer. `pulled`
 * counts the rows the search took off it.
 */
const endlessGrep = (): {
  readonly layer: Layer.Layer<Vcs, GitFailed>
  readonly pulled: () => number
} => {
  let pulled = 0
  const proc: ProcessShape = {
    spawn: (spec) =>
      Effect.succeed(
        spec.args[0] === "grep"
          ? {
              ...answered(""),
              lines: Stream.repeatEffect(
                Effect.sync(() => {
                  pulled += 1
                  return `lib/a.ts\0${String(pulled)}\0needle`
                }),
              ),
              exited: Effect.never,
            }
          : answered(spec.args[0] === "--version" ? "git version 2.43.0" : "/repo"),
      ),
    isAlive: () => Effect.succeed(false),
    kill: () => Effect.void,
    startTime: () => Effect.succeed(undefined),
    killExec: () => Effect.void,
  }
  return {
    layer: GitCliLayer("/repo").pipe(Layer.provide(Layer.succeed(Process, proc))),
    pulled: () => pulled,
  }
}

describe("the search's early stop", () => {
  it("takes limit + 1 rows off git and no more, and answers cut", async () => {
    const grep = endlessGrep()
    const found = await Effect.runPromise(
      Effect.flatMap(Vcs, (vcs) => vcs.grepProject("needle", 5)).pipe(Effect.provide(grep.layer)),
    )
    expect(found.cut).toBe(true)
    expect(found.matches.map((m) => m.line)).toStrictEqual([1, 2, 3, 4, 5])
    expect(grep.pulled()).toBe(6)
  })

  it("answers a cut search on a large output well inside the kill's grace period", async () => {
    await runFlow([], (_id, _agent, _checks, repoDir) =>
      Effect.gen(function* () {
        // Far more than a pipe buffer, so git is still writing when the cap is reached
        // and the scope has to end it — the case that waited out the 2s grace.
        writeFileSync(join(repoDir, "huge.txt"), "needle in a haystack\n".repeat(200_000))
        const started = Date.now()
        const found = yield* decoded(FileSearchDto, "/search?q=needle")
        const took = Date.now() - started
        expect(found.cut).toBe(true)
        expect(found.matches).toHaveLength(200)
        expect(took).toBeLessThan(1000)
      }),
    )
  })
})
