// The shipped `open-pr.sh` against a real repository and a stubbed `gh`: which pull
// request it opens or updates as the branch's history on the forge grows, and which
// branch it aims that pull request at. `ORKESTRA_TARGET_BRANCH` is what the
// engine sets for a trak on a goal branch, and unset for every other trak.

import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { Effect } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { SHIPPED_AGENTS } from "../../src/app/packaged.js"
import { addOrigin, git, type Origin } from "../support/git.js"
import { testRepo } from "../support/vcs-fixture.js"

const SCRIPT = path.join(SHIPPED_AGENTS, "checks", "open-pr.sh")

/**
 * A `gh` over a fake forge: `pulls` holds the branch's pull requests as
 * `<number> <state> <url>` lines — what the script's `--jq` asks gh to print — and
 * `pr create` appends an open one. Each call's arguments are logged one per line.
 */
const stubGh = (dir: string, pulls: string): string => {
  const bin = path.join(dir, "bin")
  fs.mkdirSync(bin)
  const forge = path.join(dir, "pulls")
  fs.writeFileSync(forge, pulls)
  fs.writeFileSync(
    path.join(bin, "gh"),
    [
      "#!/bin/bash",
      `printf '%s\\n' "$*" >> "${path.join(dir, "gh.log")}"`,
      `if [ "$1 $2" = "pr list" ]; then cat "${forge}"; fi`,
      `if [ "$1 $2" = "pr create" ]; then`,
      `  n=$(( $(grep -c . "${forge}") + 1 ))`,
      `  printf '%s OPEN https://example.com/pr/%s\\n' "$n" "$n" >> "${forge}"`,
      "  echo https://example.com/pr/$n",
      "fi",
      "",
    ].join("\n"),
    { mode: 0o755 },
  )
  return bin
}

const origins: Origin[] = []
afterEach(() => {
  for (const o of origins.splice(0)) o.remove()
})

interface Run {
  readonly calls: readonly string[]
  readonly status: number
  readonly stdout: string
}

/**
 * Run the script `runs` times on a trak branch with a filed pull-request document,
 * over a forge holding `pulls`; `gh`'s calls so far and the script's result, per run.
 */
const openPr = (target: string | undefined, pulls = "", runs = 1) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.map(testRepo, (repo): Run[] => {
        origins.push(addOrigin(repo))
        git(repo, "checkout", "--quiet", "-b", "trak/t1")
        const trak = path.join(repo, ".orkestra", ".trak")
        fs.mkdirSync(trak, { recursive: true })
        fs.writeFileSync(
          path.join(trak, "6-pull-request.md"),
          "## Title\n\nShip it\n\n## Body\n\nWhy.\n",
        )
        const bin = stubGh(path.dirname(trak), pulls)
        // Run from a copy beside the stub, so `bash` is handed no path outside the
        // directories the test made; the copy is the shipped script's bytes.
        const script = path.join(bin, "open-pr.sh")
        fs.copyFileSync(SCRIPT, script)
        const env = Object.fromEntries(
          Object.entries(process.env).filter(([k]) => k !== "ORKESTRA_TARGET_BRANCH"),
        )
        const log = path.join(path.dirname(trak), "gh.log")
        return Array.from({ length: runs }, () => {
          const r = spawnSync("bash", [script], {
            cwd: repo,
            encoding: "utf8",
            env: {
              ...env,
              PATH: `${bin}:${env["PATH"] ?? ""}`,
              ...(target === undefined ? {} : { ORKESTRA_TARGET_BRANCH: target }),
            },
          })
          return {
            calls: fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : [],
            status: r.status ?? -1,
            stdout: r.stdout,
          }
        })
      }),
    ),
  )

/** One run's calls, failing the test where the script did not exit zero. */
const calls = async (target: string | undefined, pulls = ""): Promise<readonly string[]> => {
  const [run] = await openPr(target, pulls)
  expect(run?.stdout).toContain("Title: Ship it")
  return run?.calls ?? []
}

describe("open-pr.sh", () => {
  it("opens the pull request with no --base where no target branch is set", async () => {
    const c = await calls(undefined)
    expect(c.at(-1)).toMatch(/^pr create --head trak\/t1 --title Ship it/)
    expect(c.join("\n")).not.toContain("--base")
  })

  it("aims a new pull request at ORKESTRA_TARGET_BRANCH", async () => {
    const c = await calls("goal/ship")
    expect(c.at(-1)).toMatch(/^pr create --head trak\/t1 --base goal\/ship --title Ship it/)
  })

  it("aims the open pull request it updates there too", async () => {
    const c = await calls("goal/ship", "1 OPEN https://example.com/pr/1\n")
    expect(c.at(-1)).toMatch(/^pr edit https:\/\/example.com\/pr\/1 --base goal\/ship --title/)
  })

  it("opens a fresh pull request after a merged one, and updates that one next time", async () => {
    const [first, second] = await openPr(undefined, "1 MERGED https://example.com/pr/1\n", 2)
    expect(first?.stdout).toContain("Opened https://example.com/pr/2")
    expect(first?.calls.at(-1)).toMatch(/^pr create --head trak\/t1 --title Ship it/)
    expect(second?.stdout).toContain("Updated https://example.com/pr/2")
    expect(second?.calls.at(-1)).toMatch(/^pr edit https:\/\/example.com\/pr\/2 --title Ship it/)
  })

  it("takes the newest pull request whatever order the forge lists them in", async () => {
    const c = await calls(
      undefined,
      "3 OPEN https://example.com/pr/3\n1 MERGED https://example.com/pr/1\n",
    )
    expect(c.at(-1)).toMatch(/^pr edit https:\/\/example.com\/pr\/3 /)
  })

  it("refuses where the newest pull request was closed, and says nothing of reopening", async () => {
    const [run] = await openPr(
      undefined,
      "1 MERGED https://example.com/pr/1\n2 CLOSED https://example.com/pr/2\n",
    )
    expect(run?.status).toBe(1)
    expect(run?.stdout).toContain("closed without merging")
    expect(run?.stdout.toLowerCase()).not.toContain("reopen")
    expect(run?.calls.some((c) => /^pr (create|edit)/.test(c))).toBe(false)
  })
})
