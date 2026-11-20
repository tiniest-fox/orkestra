// `.orkestra/checks/verify-light.sh`, run whole in a repository of its own: what it runs on
// a branch where a step changed only a document, and what its test stage selects where the
// check has passed on no tree, and how it reports a failing test beside a proven one. The
// repository and the run are `test/support/verify-light.ts`'s.
//
// At the root beside `docs-check.test.ts` for the same reason: a script of this repo's,
// neither a flow nor a contract. The repository copies the two check scripts and their
// selection tables, and stubs every stage but the root suite, which is real vitest over a
// few source files and their tests, so what the stage reports is vitest's own selection.
// Beside it, three guards: that every `.ts` file this repository's tests start as a child
// process has a `run:` row in `verify.select.yaml`, that every test file that starts a
// Docker container is in a `held_back:` entry there, and that every import from one project
// into another is one `reach_of` maps.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { parse } from "yaml"
import {
  CHECKS,
  branch,
  lightRun,
  ranStatic,
  testStage,
  verifyLight,
} from "./support/verify-light.js"

const note = (dir: string): void => {
  mkdirSync(join(dir, "notes"))
  writeFileSync(join(dir, "notes", "BUGS.md"), "# Bugs\n\nNothing open.\n")
}

describe("verify-light", () => {
  it("runs only docs:check for a step that changed only a document, and says so", () => {
    const { dir, passed } = branch()
    note(dir)
    const lines = verifyLight(dir, passed).trim().split("\n")
    expect(lines.slice(0, -1)).toStrictEqual([
      "– pnpm fmt:check, not run: no changed file reaches a project",
      "– pnpm check, not run: no changed file reaches a project",
      "– pnpm lint, not run: no changed file reaches a project",
      "– pnpm knip, not run: no changed file reaches a project",
      "– pnpm --filter @orkestra/client check, not run: no changed file reaches client",
      "– pnpm --filter @orkestra/desktop check, not run: no changed file reaches desktop",
      "✓ pnpm docs:check",
      "– pnpm test, not run: no changed file is code a test can import",
      "– pnpm --filter @orkestra/client test, not run: no changed file is code a test can import",
    ])
    expect(ranStatic(dir)).toStrictEqual([])
  }, 60_000)

  it("selects the branch's earlier test files where it has passed on no tree", () => {
    const { dir } = branch()
    note(dir)
    expect(testStage(verifyLight(dir))).toBe("✓ pnpm test — test files: 1 ran, 0 already proven")
  }, 60_000)

  it("runs a selected file not proven, and reports its failure with the command that reruns it", () => {
    const { dir, passed } = branch()
    writeFileSync(
      join(dir, "src", "sum.ts"),
      "export const sum = (a: number, b: number) => a - b\n",
    )
    writeFileSync(
      join(dir, "src", "sum-type.test.ts"),
      'import { sum } from "./sum"\n\nit("is a function", () => expect(typeof sum).toBe("function"))\n',
    )
    const proven = join(dir, ".git", "proven")
    writeFileSync(proven, "src/sum-type.test.ts\n") // docs-check-ignore: a file of the fixture
    const { status, out } = lightRun(dir, passed, proven)
    expect(status).toBe(1)
    expect(out.slice(out.indexOf("  ran: "))).toBe(
      [
        "  ran: src/sum.test.ts", // docs-check-ignore: a file of the fixture
        "→ pnpm test",
        "`pnpm test` failed, and nothing after it ran.",
        "",
        "test files: 1 ran, 1 already proven",
        "",
        "FAIL src/sum.test.ts > adds", // docs-check-ignore: a file of the fixture
        "    AssertionError: expected -1 to be 3 // Object.is equality",
        "",
        "    - Expected",
        "    + Received",
        "",
        "    - 3",
        "    + -1",
        "    at src/sum.test.ts:3:36", // docs-check-ignore: a file of the fixture
        "  rerun: pnpm test src/sum.test.ts -t 'adds'", // docs-check-ignore: a file of the fixture
        "",
      ].join("\n"),
    )
  }, 60_000)
})

const REPO = fileURLToPath(new URL("..", import.meta.url))

/** Every `.ts` file under `dir`, from the checkout root, outside fixtures and packages. */
const sources = (dir: string): string[] =>
  readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === "node_modules" || path === join("test", "fixtures") ? [] : sources(path)
    }
    return path.endsWith(".ts") ? [path] : []
  })

/**
 * The `.ts` files a test or a helper starts as a child process, each with the file that
 * starts it, found by the two ways one is named: `new URL("….ts", import.meta.url)`, and a
 * path from the checkout root in a file that runs `tsx`. Comments are left out. A name that
 * is no file on disk is a file a test writes, not one it starts.
 */
const spawnedEntries = (): Map<string, string> => {
  const found = new Map<string, string>()
  const starters = [...sources("src"), ...sources("test")].filter(
    (file) => file.startsWith(`test${sep}`) || file.endsWith(".test.ts"),
  )
  for (const file of starters) {
    const code = readFileSync(join(REPO, file), "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n")
    const named = [
      ...[...code.matchAll(/new URL\(\s*["'`]([^"'`]+\.ts)["'`],\s*import\.meta\.url\s*\)/g)].map(
        ([, path = ""]) => relative(REPO, resolve(REPO, dirname(file), path)),
      ),
      ...(/(?<![.\w])tsx\b/.test(code)
        ? [...code.matchAll(/["'`]((?:src|test)\/[^"'`\s]+\.ts)["'`]/g)].map(
            ([, path = ""]) => path,
          )
        : []),
    ]
    for (const path of named) {
      if (path !== file && existsSync(join(REPO, path))) found.set(path, file)
    }
  }
  return found
}

/** `verify.select.yaml`, as the stage runner reads it. */
const SELECT: unknown = parse(readFileSync(join(CHECKS, "verify.select.yaml"), "utf8"))

const fieldOf = (value: unknown, name: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []

describe("verify.select.yaml's spawned entries", () => {
  it("lists every .ts file a test starts as a child process as a run: row", () => {
    const reads = fieldOf(SELECT, "reads")
    const rows = new Set(
      Object.keys(typeof reads === "object" && reads !== null ? reads : {})
        .filter((pattern) => pattern.startsWith("run:"))
        .map((pattern) => pattern.slice("run:".length)),
    )
    expect(rows).toContain("src/serve.ts")
    const missing = [...spawnedEntries()]
      .filter(([entry]) => !rows.has(entry))
      .map(([entry, by]) => `${entry}, started by ${by}, has no run: row under reads:`)
    expect(missing).toStrictEqual([])
  })
})

/** Code without its comment lines, as `spawnedEntries` reads it. */
const uncommented = (file: string): string =>
  readFileSync(join(REPO, file), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n")

const DOCKER_INFO = /["'`]docker["'`],\s*\[\s*["'`]info["'`]/

/**
 * The test files that start a Docker container, found by the probe each makes first:
 * `docker info` in the file itself, or in a module of `test/` it imports by a relative path.
 */
const dockerTests = (): string[] => {
  const files = [...sources("src"), ...sources("test")]
  const probing = new Set(files.filter((file) => DOCKER_INFO.test(uncommented(file))))
  return files
    .filter((file) => file.endsWith(".test.ts"))
    .filter(
      (file) =>
        probing.has(file) ||
        [...uncommented(file).matchAll(/from\s+["'](\.[^"']+)\.js["']/g)].some(([, path = ""]) =>
          probing.has(relative(REPO, resolve(REPO, dirname(file), `${path}.ts`))),
        ),
    )
}

describe("verify.select.yaml's real-container tests", () => {
  it("names every test file that probes docker info in a held_back: entry", () => {
    const held = fieldOf(SELECT, "held_back")
    const rows = new Set(
      (Array.isArray(held) ? held : []).flatMap((entry: unknown) =>
        strings(fieldOf(entry, "tests")),
      ),
    )
    const found = dockerTests()
    const missing = found
      .filter((file) => !rows.has(file.split(sep).join("/")))
      .map((file) => `${file} probes docker info and is in no held_back: entry`)
    expect(missing).toStrictEqual([])
  })
})

/** The project a file from the checkout root belongs to, as `reach_of` names projects. */
const projectOf = (path: string): string | undefined => {
  const [top = ""] = path.split("/")
  if (top === "src" || top === "test") return "engine"
  if (top === "shared" || top === "client" || top === "desktop") return top
  return undefined
}

/** The directory each workspace package's name resolves to, for an import by that name. */
const PACKAGES: ReadonlyMap<string, string> = new Map(
  ["shared", "client", "desktop"].map((dir) => {
    const manifest: unknown = JSON.parse(readFileSync(join(REPO, dir, "package.json"), "utf8"))
    const name =
      typeof manifest === "object" && manifest !== null && "name" in manifest
        ? String(manifest.name)
        : dir
    return [name, dir]
  }),
)

/**
 * Every import in a tracked `.ts` or `.tsx` file whose target is in another project, as
 * `<importing project> <imported path>`: a relative one resolved from the file, and one by
 * a workspace package's name taken as that package's directory.
 */
const crossings = (): string[] => {
  const tracked = execFileSync("git", ["ls-files", "*.ts", "*.tsx"], {
    cwd: REPO,
    encoding: "utf8",
  })
  const found = new Set<string>()
  for (const file of tracked.split("\n").filter(Boolean)) {
    const from = projectOf(file)
    if (from === undefined || file.startsWith("test/fixtures/")) continue
    const code = readFileSync(join(REPO, file), "utf8")
    for (const [, specifier = ""] of code.matchAll(
      /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g,
    )) {
      const pkg = [...PACKAGES].find(
        ([name]) => specifier === name || specifier.startsWith(`${name}/`),
      )
      const target = specifier.startsWith(".")
        ? relative(REPO, resolve(REPO, dirname(file), specifier))
            .split(sep)
            .join("/")
        : pkg === undefined
          ? undefined
          : `${pkg[1]}/${specifier.slice(pkg[0].length + 1)}`
      const to = target === undefined ? undefined : projectOf(target)
      if (target !== undefined && to !== undefined && to !== from) found.add(`${from} ${target}`)
    }
  }
  return [...found].sort()
}

describe("verify.sh's reach rule", () => {
  it("maps every import from one project into another to the importing project", () => {
    const script = readFileSync(join(CHECKS, "verify.sh"), "utf8")
    const rule = /^PROJECTS=\(.*\)$\n\nreach_of\(\) \{\n[\s\S]*?^\}$/m.exec(script)?.[0] ?? ""
    expect(rule).toContain("reach_of")
    const found = crossings()
    // The two imports the rule exists for, so a regex that stops matching fails here.
    expect(found).toContain("client src/app/view-policy")
    expect(found.some((line) => line.startsWith("desktop src/"))).toBe(true)
    const reaches = execFileSync(
      "bash",
      [
        "-c",
        `${rule}\nwhile read -r from path; do reach_of "$path" | grep -qxF "$from" || echo "$from $path"; done`,
      ],
      { input: found.join("\n") + "\n", encoding: "utf8" },
    )
    const missing = reaches
      .split("\n")
      .filter(Boolean)
      .map((line) => `${line.replace(" ", " imports ")}, and reach_of does not map that path to it`)
    expect(missing).toStrictEqual([])
  })
})
