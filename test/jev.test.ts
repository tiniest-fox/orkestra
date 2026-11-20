// The Jev helper script, driven the way a person drives it: `node` on the file, JSON
// on stdin, and stdout read through a pipe.
//
// At the root beside `locks.test.ts` because it is neither a flow nor a contract: the
// script is a dev tool under `.agents/skills/`, nothing in `src/` reaches it, and no
// other gate runs it. Through a pipe on purpose — stdout to a pipe is asynchronous, so
// a `process.exit` after the write drops whatever is still buffered, and a test that
// read the output from a file would pass over the exact loss. `jq` is the skill's own
// next step, and `jq` is a pipe.
//
// That asynchrony is macOS and Windows only: on Linux a pipe is synchronous, so the
// first test below catches a reintroduced `process.exit` here and holds the invariant
// rather than the regression there. Measured on this machine, 110 of 300 rows arrive
// once the exit is put back.
//
// No network. `TYPESAFE_BASE_URL` points the script at a server this file starts on
// port 0, which also counts what it was asked — so a refusal that must come before any
// request is paid for is asserted, not assumed.

import { spawn } from "node:child_process"
import { mkdtemp, writeFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Schema } from "effect"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const SCRIPT = fileURLToPath(new URL("../.agents/skills/jev/jev.mjs", import.meta.url))

/** What the fake needs from a request: the state, to decide whether to refuse it, and the question names. */
const RequestBody = Schema.Struct({
  state: Schema.Unknown,
  questions: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
})

/** The state that makes the fake refuse an item, with a status the script does not retry. */
const REFUSED = "refuse this one"

/**
 * A stand-in for the API that answers every question as a noul of 0.5 whatever its
 * type — the tests below are about what the script does around an answer, never about
 * the answer — and refuses one state outright with a 400, which the script treats as
 * final rather than retrying. `asked` is how a test proves nothing was sent.
 */
const fake = (): { readonly server: Server; readonly asked: () => number } => {
  let asked = 0
  const server = createServer((request, response) => {
    let text = ""
    request.setEncoding("utf8")
    request.on("data", (chunk: string) => {
      text += chunk
    })
    request.on("end", () => {
      asked += 1
      const parsed: unknown = JSON.parse(text)
      const body = Schema.decodeUnknownSync(RequestBody)(parsed)
      if (body.state === REFUSED) {
        response.writeHead(400, { "content-type": "application/json" })
        response.end(JSON.stringify({ detail: "refused by the fake" }))
        return
      }
      const answers = Object.fromEntries(
        Object.keys(body.questions).map((name) => [name, { type: "noul", noul: 0.5 }]),
      )
      response.writeHead(200, { "content-type": "application/json" })
      response.end(
        JSON.stringify({
          model: "jev-fake",
          answers,
          usage: { input_tokens: 10, output_tokens: 0 },
        }),
      )
    })
  })
  return { server, asked: () => asked }
}

interface Run {
  readonly stdout: string
  readonly stderr: string
  readonly code: number
}

/** One invocation: stdin written whole, both streams collected through pipes, exit code kept. */
const run = (baseUrl: string, args: readonly string[], stdin: string): Promise<Run> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, TYPESAFE_API_KEY: "apikey_test", TYPESAFE_BASE_URL: baseUrl },
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? -1 })
    })
    child.stdin.end(stdin)
  })

/** One noul question per name, as a file the script can be pointed at. */
const questionsFile = async (dir: string, names: readonly string[]): Promise<string> => {
  const path = join(dir, `${names.join("-").slice(0, 40)}.json`)
  const questions = Object.fromEntries(
    names.map((name) => [name, { type: "noul", instructions: `is ${name}` }]),
  )
  await writeFile(path, JSON.stringify(questions))
  return path
}

/** Serve on an ephemeral loopback port and say where. Port 0: this has nothing to do with a project. */
const listening = (server: Server): Promise<string> =>
  new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address !== "object" || address === null) {
        reject(new Error("expected a TCP address"))
        return
      }
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })

const closed = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => {
      resolve()
    })
  })

const jsonl = (values: readonly unknown[]): string =>
  values.map((v) => JSON.stringify(v)).join("\n")

/** `text` as the JSON value it is, typed as nothing — for `toStrictEqual`, which takes unknown. */
const parsed = (text: string): unknown => {
  const value: unknown = JSON.parse(text)
  return value
}

describe("the jev helper script", () => {
  const api = fake()
  let baseUrl = ""
  let dir = ""

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "jev-test-"))
    baseUrl = await listening(api.server)
  })

  afterAll(() => closed(api.server))

  it("delivers every row through a pipe when an item failed", async () => {
    // Enough rows, each wide enough, that the output is well past the 64 KiB a pipe
    // buffers: a `process.exit` after the write would cut it there. One item refused,
    // so this is the run that exits 1 — the one the skill tells the reader to check.
    const names = Array.from({ length: 60 }, (_, i) => `q${i}`)
    const questions = await questionsFile(dir, names)
    const items = Array.from({ length: 300 }, (_, i) => ({
      id: `pr-${i}`,
      state: i === 7 ? REFUSED : `item ${i}`,
    }))

    const result = await run(baseUrl, [questions, "--concurrency", "32"], jsonl(items))

    expect(result.code).toBe(1)
    const lines = result.stdout.trimEnd().split("\n")
    expect(lines).toHaveLength(300)
    expect(Buffer.byteLength(result.stdout)).toBeGreaterThan(65_536)
    expect(parsed(lines[7] ?? "")).toStrictEqual({
      id: "pr-7",
      error: 'HTTP 400: {"detail":"refused by the fake"}',
    })
    expect(parsed(lines[299] ?? "")).toMatchObject({ id: "pr-299", q0: 0.5, q59: 0.5 })
    expect(result.stderr).toContain("300 items · 1 failed")
  })

  it("ends with the exit code and the whole message on --help and on a refused argument", async () => {
    const help = await run(baseUrl, ["--help"], "")
    expect(help.code).toBe(0)
    expect(help.stdout.trimEnd().endsWith("or in the main checkout.")).toBe(true)

    const refused = await run(baseUrl, ["whatever.json", "--format", "yaml"], "")
    expect(refused.code).toBe(2)
    expect(refused.stderr).toBe('jev: --format wants jsonl, tsv or json, got "yaml"\n')
    expect(refused.stdout).toBe("")
  })

  it("chooses the JSON shape from the mode, never from the row count", async () => {
    const questions = await questionsFile(dir, ["q0"])

    // Bulk over a one-item corpus is still bulk: an array of one, so a consumer's
    // `jq '.[]'` works at one item exactly as it does at two.
    const bulk = await run(
      baseUrl,
      [questions, "--format", "json"],
      jsonl([{ id: "only", state: "x" }]),
    )
    expect(bulk.code).toBe(0)
    expect(parsed(bulk.stdout)).toStrictEqual([{ id: "only", q0: 0.5 }])

    const two = await run(
      baseUrl,
      [questions, "--format", "json"],
      jsonl([
        { id: "a", state: "x" },
        { id: "b", state: "y" },
      ]),
    )
    expect(parsed(two.stdout)).toStrictEqual([
      { id: "a", q0: 0.5 },
      { id: "b", q0: 0.5 },
    ])

    // Single mode is the one object, with no id to carry.
    const one = await run(baseUrl, [questions, "--one"], "some text as the whole state")
    expect(one.code).toBe(0)
    expect(parsed(one.stdout)).toStrictEqual({ q0: 0.5 })
  })

  it("refuses a question named for a column the script owns, before any request", async () => {
    const before = api.asked()

    const id = await run(
      baseUrl,
      [await questionsFile(dir, ["id"])],
      jsonl([{ id: "x", state: "x" }]),
    )
    expect(id.code).toBe(2)
    expect(id.stderr).toContain('question "id" would overwrite the "id" column')

    const error = await run(
      baseUrl,
      [await questionsFile(dir, ["error"])],
      jsonl([{ id: "x", state: "x" }]),
    )
    expect(error.code).toBe(2)
    expect(error.stderr).toContain('question "error" would overwrite the "error" column')

    const column = await run(
      baseUrl,
      [await questionsFile(dir, ["risk", "risk_confidence"])],
      jsonl([{ id: "x", state: "x" }]),
    )
    expect(column.code).toBe(2)
    expect(column.stderr).toContain(
      'question "risk_confidence" would overwrite the confidence column of question "risk"',
    )

    expect(api.asked()).toBe(before)
  })
})
