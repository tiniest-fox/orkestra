#!/usr/bin/env node
// Label many items at once with Jev, TypeSafe's System One model.
//
//   node .agents/skills/jev/jev.mjs <questions.json> < items.jsonl
//
// One request per item, run in parallel; one labelled row out per row in, in the
// order they arrived. Read `.agents/skills/jev/SKILL.md` for how to use it and how
// to write the questions file.
//
// **No dependencies, and not TypeScript, on purpose.** It is a dev tool rather than
// part of the engine: nothing in `src/` imports it, `pnpm verify` does not reach it,
// and `node <path>` runs it in any worktree without tsx, a build, or a pnpm that
// refuses because node_modules drifted from the lockfile.

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

/** `TYPESAFE_BASE_URL` is the client SDKs' own override, and what the test points at a fake. */
const BASE_URL = (process.env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai").replace(/\/$/, "")
const ENDPOINT = `${BASE_URL}/v1/systemone`
const DEFAULT_MODEL = "jev-latest"
const DEFAULT_CONCURRENCY = 8

/** $0.042 per million input tokens; output tokens are free. */
const PRICE_PER_INPUT_TOKEN = 0.042 / 1_000_000

/**
 * Jev allows 32k tokens for the state plus the longest question. Characters are not
 * tokens, so this is a warning and not a refusal — the API is the authority on its
 * own limit, and guessing wrong here would block a request that would have worked.
 */
const LONG_STATE_CHARS = 110_000

const HELP = `
jev — label many items at once with Jev (TypeSafe System One).

  node .agents/skills/jev/jev.mjs <questions.json> < items.jsonl > labelled.jsonl

Two modes.

  Bulk (the default) — many items, one row each, to sort and count.
    stdin is one JSON value per line:
      {"id": "...", "state": <string|object>}   state is what Jev reads
      {"id": "...", ...}                        no state key: the rest is the state
      "some text"                               id is the line number

  Single (--one) — one item, everything Jev knows about it, pretty-printed.
    All of stdin is the state, as-is. No JSON to build:
      git diff | node .agents/skills/jev/jev.mjs questions.json --one

Both modes answer with the same keys: each question's name carries its value, and
a choice or a score adds <question>_confidence. A choice returns the option it
picked, a score a weighted position across your levels, a noul the probability the
statement is true. An item that failed carries "error" instead, and the run exits 1.

Options
  --one               all of stdin is one state; implies --raw, prints indented JSON
  --concurrency <n>   requests in flight        (default ${DEFAULT_CONCURRENCY})
  --model <name>      model to ask              (default ${DEFAULT_MODEL})
  --format <f>        jsonl | tsv | json        (default jsonl; json under --one)
  --limit <n>         only the first n items, to price a run before paying for it
  --raw               add the full distribution: <question>_probabilities for a
                      choice, <question>_levels for a score, keyed by level text
  --help

The key comes from TYPESAFE_API_KEY, or from .env here or in the main checkout.
`.trimStart()

// ============================================================================
// Arguments
// ============================================================================

/**
 * Never `process.exit` after writing to stdout or stderr. To a pipe both are
 * asynchronous, and `exit` drops whatever is still buffered — through `jq`, which is
 * the skill's own next step, 64 KiB of a 180 KiB run arrived and the rest never did,
 * with nothing to say so. Set the code and unwind instead; the process ends on its own
 * once the streams have drained.
 */
class Stop extends Error {}

const die = (message, code = 2) => {
  process.stderr.write(`jev: ${message}\n`)
  process.exitCode = code
  throw new Stop()
}

const parseArguments = (argv) => {
  const options = {
    questionsPath: undefined,
    concurrency: DEFAULT_CONCURRENCY,
    model: DEFAULT_MODEL,
    format: "jsonl",
    formatChosen: false,
    limit: Infinity,
    raw: false,
    one: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]
    const value = argv[i + 1]
    switch (argument) {
      case "--help":
      case "-h":
        process.stdout.write(HELP)
        process.exitCode = 0
        throw new Stop()
      case "--concurrency":
        options.concurrency = Number(value)
        i++
        if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
          die(`--concurrency wants a positive whole number, got ${JSON.stringify(value)}`)
        }
        break
      case "--model":
        options.model = value
        i++
        if (!options.model) die("--model wants a model name")
        break
      case "--format":
        options.format = value
        options.formatChosen = true
        i++
        if (!["jsonl", "tsv", "json"].includes(options.format)) {
          die(`--format wants jsonl, tsv or json, got ${JSON.stringify(value)}`)
        }
        break
      case "--limit":
        options.limit = Number(value)
        i++
        if (!Number.isInteger(options.limit) || options.limit < 1) {
          die(`--limit wants a positive whole number, got ${JSON.stringify(value)}`)
        }
        break
      case "--raw":
        options.raw = true
        break
      case "--one":
        options.one = true
        break
      default:
        if (argument.startsWith("-")) die(`unknown option ${argument}. Try --help`)
        if (options.questionsPath !== undefined) die(`two questions files: ${options.questionsPath} and ${argument}`)
        options.questionsPath = argument
    }
  }
  if (options.questionsPath === undefined) die("no questions file. Try --help")
  // Nothing to keep narrow at one item and nothing to tabulate, so single mode is the
  // deep look by default: the whole distribution, laid out rather than on one line.
  if (options.one) {
    options.raw = true
    if (!options.formatChosen) options.format = "json"
  }
  return options
}

// ============================================================================
// Credentials
// ============================================================================

/**
 * A worktree has no `.env` of its own — it is gitignored, so it exists only in the
 * checkout somebody cloned. `--git-common-dir` is the one thing that points from
 * inside a worktree back at that checkout.
 */
const envFilePaths = () => {
  const paths = [join(process.cwd(), ".env")]
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    if (common) paths.push(join(dirname(common), ".env"))
  } catch {
    // Not a git checkout, or no git. The cwd path above is still worth trying.
  }
  return paths
}

const readKeyFromEnvFile = (path) => {
  if (!existsSync(path)) return undefined
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*(?:export\s+)?TYPESAFE_API_KEY\s*=\s*(.*)$/.exec(line)
    if (match) return match[1].trim().replace(/^["']|["']$/g, "")
  }
  return undefined
}

const apiKey = () => {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY
  const paths = envFilePaths()
  for (const path of paths) {
    const key = readKeyFromEnvFile(path)
    if (key) return key
  }
  die(`no TYPESAFE_API_KEY in the environment, or in ${paths.join(" or ")}`)
}

// ============================================================================
// Input
// ============================================================================

const TYPES = new Set(["noul", "choice", "score"])

/** Columns every row carries, which an answer must not overwrite. */
const RESERVED = new Set(["id", "error"])
/** Columns a question adds beside its own, which another question's name must not take. */
const SUFFIXES = ["_confidence", "_probabilities", "_levels"]

/**
 * A malformed questions file makes every item fail the same way, so it is worth
 * catching once here rather than paying for N identical 400s.
 */
const readQuestions = (path) => {
  if (!existsSync(path)) die(`no questions file at ${path}`)
  let questions
  try {
    questions = JSON.parse(readFileSync(path, "utf8"))
  } catch (cause) {
    die(`${path} is not valid JSON: ${cause.message}`)
  }
  if (questions === null || typeof questions !== "object" || Array.isArray(questions)) {
    die(`${path} must be a JSON object mapping a name you choose to a question`)
  }
  const names = Object.keys(questions)
  if (names.length === 0) die(`${path} has no questions in it`)
  for (const name of names) {
    // A name that lands on a column the script owns is silent: `id` loses the join key,
    // `error` marks every row failed, `risk_confidence` beside `risk` takes its column.
    if (RESERVED.has(name)) {
      die(`question "${name}" would overwrite the "${name}" column every row carries; name it something else`)
    }
    for (const suffix of SUFFIXES) {
      const other = name.endsWith(suffix) ? name.slice(0, -suffix.length) : undefined
      if (other !== undefined && names.includes(other)) {
        die(`question "${name}" would overwrite the ${suffix.slice(1)} column of question "${other}"; name it something else`)
      }
    }
    const question = questions[name]
    if (question === null || typeof question !== "object") die(`question "${name}" is not an object`)
    if (!TYPES.has(question.type)) {
      die(`question "${name}" has type ${JSON.stringify(question.type)}; wants noul, choice or score`)
    }
    if (!question.instructions) die(`question "${name}" has no instructions`)
    if (question.type !== "noul" && !question.criteria) {
      die(`a ${question.type} question needs criteria; "${name}" has none`)
    }
  }
  return questions
}

const readStdin = async () => {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString("utf8")
}

const parseItems = (text, limit) => {
  const items = []
  const lines = text.split("\n")
  for (let i = 0; i < lines.length && items.length < limit; i++) {
    const line = lines[i].trim()
    if (line === "") continue
    let value
    try {
      value = JSON.parse(line)
    } catch (cause) {
      die(`stdin line ${i + 1} is not valid JSON: ${cause.message}`)
    }
    const fallbackId = String(i + 1)
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      items.push({ id: fallbackId, state: value })
      continue
    }
    const id = value.id === undefined ? fallbackId : String(value.id)
    if (value.state !== undefined) {
      items.push({ id, state: value.state })
      continue
    }
    const { id: _ignored, ...rest } = value
    items.push({ id, state: rest })
  }
  if (items.length === 0) die("no items on stdin")
  return items
}

// ============================================================================
// Asking
// ============================================================================

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529])
const ATTEMPTS = 5

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const ask = async (state, questions, options, key) => {
  const body = JSON.stringify({ state, model: options.model, questions })
  let delay = 500
  for (let attempt = 1; ; attempt++) {
    const last = attempt === ATTEMPTS
    let response
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body,
      })
    } catch (cause) {
      if (last) throw new Error(`could not reach the API: ${cause.message}`)
      await sleep(delay + Math.random() * 250)
      delay *= 2
      continue
    }
    if (response.ok) return response.json()
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 300)
    if (last || !RETRYABLE.has(response.status)) {
      throw new Error(`HTTP ${response.status}: ${detail}`)
    }
    // The server knows better than the backoff schedule when it says so.
    const after = Number(response.headers.get("retry-after"))
    await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : delay + Math.random() * 250)
    delay *= 2
  }
}

/**
 * A score's `probabilities` are keyed by level index — `{"0": 0, "1": 1}` — which says
 * nothing without the questions file open beside it. The response carries the level text
 * as `legend`, so re-key by that and the distribution reads on its own.
 */
const levels = (answer) => {
  if (!answer.legend) return answer.probabilities
  const out = {}
  for (const [index, probability] of Object.entries(answer.probabilities ?? {})) {
    out[answer.legend[index] ?? index] = probability
  }
  return out
}

const flatten = (answers, raw) => {
  const row = {}
  for (const [name, answer] of Object.entries(answers)) {
    if (answer.type === "noul") row[name] = answer.noul
    else if (answer.type === "choice") {
      row[name] = answer.choice
      row[`${name}_confidence`] = answer.confidence
      if (raw) row[`${name}_probabilities`] = answer.probabilities
    } else if (answer.type === "score") {
      row[name] = answer.score
      row[`${name}_confidence`] = answer.confidence
      if (raw) row[`${name}_levels`] = levels(answer)
    } else row[name] = answer
  }
  return row
}

const mapWithLimit = async (items, limit, fn) => {
  const results = new Array(items.length)
  let next = 0
  const worker = async () => {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

// ============================================================================
// Output
// ============================================================================

const TSV_UNSAFE = /[\t\n\r]/g

const asTsv = (rows) => {
  const columns = []
  for (const row of rows) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key)
  const cell = (value) =>
    value === undefined
      ? ""
      : (typeof value === "string" ? value : JSON.stringify(value)).replace(TSV_UNSAFE, " ")
  return [columns.join("\t"), ...rows.map((row) => columns.map((c) => cell(row[c])).join("\t"))].join("\n") + "\n"
}

// ============================================================================
// Run
// ============================================================================

const main = async () => {
  const options = parseArguments(process.argv.slice(2))
  const questions = readQuestions(options.questionsPath)
  const key = apiKey()
  const stdin = await readStdin()
  if (options.one && stdin.trim() === "") die("nothing on stdin")
  const items = options.one ? [{ id: undefined, state: stdin }] : parseItems(stdin, options.limit)

  let done = 0
  let inputTokens = 0
  let model = options.model
  const progress = () => {
    if (process.stderr.isTTY) process.stderr.write(`\rjev: ${done}/${items.length}`)
  }

  const rows = await mapWithLimit(items, options.concurrency, async (item) => {
    const size = typeof item.state === "string" ? item.state.length : JSON.stringify(item.state).length
    if (size > LONG_STATE_CHARS) {
      process.stderr.write(`\rjev: ${item.id} is ${size} characters and may exceed Jev's 32k-token state budget\n`)
    }
    try {
      const result = await ask(item.state, questions, options, key)
      inputTokens += result.usage?.input_tokens ?? 0
      model = result.model ?? model
      const answers = flatten(result.answers ?? {}, options.raw)
      return item.id === undefined ? answers : { id: item.id, ...answers }
    } catch (cause) {
      return item.id === undefined ? { error: cause.message } : { id: item.id, error: cause.message }
    } finally {
      done++
      progress()
    }
  })

  if (process.stderr.isTTY) process.stderr.write("\r")
  const printed =
    options.format === "tsv"
      ? asTsv(rows)
      : options.format === "json"
        ? JSON.stringify(options.one ? rows[0] : rows, null, 2) + "\n"
        : rows.map((r) => JSON.stringify(r)).join("\n") + "\n"
  process.stdout.write(printed)

  const failed = rows.filter((row) => row.error !== undefined).length
  const cost = (inputTokens * PRICE_PER_INPUT_TOKEN).toFixed(4)
  process.stderr.write(
    `jev: ${rows.length} ${rows.length === 1 ? "item" : "items"} · ${failed} failed · ${inputTokens.toLocaleString("en-US")} input tokens · $${cost} · ${model}\n`,
  )
  if (failed > 0) process.exitCode = 1
}

try {
  await main()
} catch (cause) {
  if (!(cause instanceof Stop)) throw cause
}
