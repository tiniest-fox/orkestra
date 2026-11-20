/**
 * The six table fences an agent writes — `decision`, `scope`, `criteria`, `files`, `runs`
 * and the free `table` — read into the one shape `components/MarkedTable` draws.
 *
 * **The text is the fallback, so a fence that does not read is not an error.** `undefined`
 * here sends the fence back to `Markdown`'s plain plate, which draws exactly what the agent
 * wrote and what the next agent reads. That is why the reading is strict: a misspelt key
 * folded silently into the cell above it would draw a table that says less than its source,
 * where refusing draws the source.
 *
 * **Every grammar shares its frame.** A `## Heading` line starts a section, and an indented
 * line belongs to the line above it. Three grammars are *blocks* — an item is a run of lines
 * ended by a blank one, its first line or its `key:` lines making the row. Two are *lines* —
 * an item is one unindented line, and its indented lines are what it holds. The engine
 * teaches the same text, one template per figure; a filed document keeps whatever grammar
 * it was written in, so a change here must still read the old one.
 */

/** Tints a column's head and washes its cells. */
export type Role = "plain" | "good" | "bad"

/** A judgement on one cell, which washes that cell alone: `met:` on a criterion, a run's result. */
export type Verdict = "good" | "bad" | "partly"

/** A row's icon, a key entry, or the arrow that leads a cell. */
export type Mark =
  | "flag"
  | "check"
  | "warn"
  | "new"
  | "changed"
  | "test"
  | "person"
  | "script"
  | "better"
  | "worse"
  | "same"

/** `lead` names the row and comes first; `path` says its cells are file paths. */
export type Column = {
  readonly head: string
  readonly role: Role
  readonly lead: boolean
  readonly path: boolean
}

export type Cell = {
  readonly text: string
  readonly mark: Mark | undefined
  readonly verdict: Verdict | undefined
}

export type Row = {
  readonly cells: readonly Cell[]
  readonly icon: Mark | undefined
  /** What a press opens under the row's cells, and the label it carries on a phone. */
  readonly detail: string | undefined
  readonly detailLabel: string
  /** The heading this row sits under. A new section starts wherever it changes. */
  readonly section: string | undefined
}

export type MarkedTableConfig = {
  readonly columns: readonly Column[]
  readonly rows: readonly Row[]
  /** The line under the table saying what each icon or arrow means. */
  readonly key: readonly (readonly [Mark, string])[]
  /** Labelled lines drawn under the table, outside it: a run's cost and what waits. */
  readonly notes: readonly (readonly [string, string])[]
}

/** The most columns the table can lay out; a free table with more draws as its source. */
const MOST_COLUMNS = 4

/* ------------------------------------------------------------------ the shared frame */

const HEADING = /^##\s+(\S.*)$/
const FIELD = /^([a-z]+):\s*(.*)$/

const indented = (line: string): boolean => /^\s/.test(line)

/** Every entry, or nothing when any of them failed to read. */
const every = <T>(xs: readonly (T | undefined)[]): readonly T[] | undefined =>
  xs.some((x) => x === undefined) ? undefined : xs.filter((x): x is T => x !== undefined)

type Block = { readonly section: string | undefined; readonly lines: readonly string[] }

/**
 * Items ended by a blank line or a heading. An indented line continues the line above it,
 * joined by a space, so a long `why:` can wrap the way an agent writes it.
 */
const blocksOf = (source: string): readonly Block[] | undefined => {
  const blocks: { section: string | undefined; lines: string[] }[] = []
  let section: string | undefined = undefined
  let open = false
  for (const raw of source.split("\n")) {
    const line = raw.trimEnd()
    const heading = indented(line) ? undefined : HEADING.exec(line)?.[1]
    if (line === "" || heading !== undefined) {
      open = false
      if (heading !== undefined) section = heading.trim()
      continue
    }
    const last = blocks.at(-1)
    if (indented(line)) {
      if (!open || last === undefined) return undefined
      const at = last.lines.length - 1
      last.lines[at] = `${last.lines[at] ?? ""} ${line.trim()}`
    } else if (open && last !== undefined) last.lines.push(line)
    else {
      blocks.push({ section, lines: [line] })
      open = true
    }
  }
  return blocks
}

type Item = {
  readonly section: string | undefined
  readonly head: string
  readonly under: readonly string[]
}

/** One item per unindented line, holding the indented lines after it. Blank lines are spacing. */
const itemsOf = (lines: readonly string[]): readonly Item[] | undefined => {
  const items: { section: string | undefined; head: string; under: string[] }[] = []
  let section: string | undefined = undefined
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line === "") continue
    if (indented(line)) {
      const last = items.at(-1)
      if (last === undefined) return undefined
      last.under.push(line.trim())
      continue
    }
    const heading = HEADING.exec(line)?.[1]
    if (heading === undefined) items.push({ section, head: line, under: [] })
    else section = heading.trim()
  }
  return items
}

/** `key: value` lines, every key one the grammar names; `undefined` on any other line. */
const fieldsOf = (
  lines: readonly string[],
  keys: readonly string[],
): ReadonlyMap<string, string> | undefined => {
  const fields = new Map<string, string>()
  for (const line of lines) {
    const match = FIELD.exec(line)
    const key = match?.[1]
    if (key === undefined || !keys.includes(key)) return undefined
    fields.set(key, (match?.[2] ?? "").trim())
  }
  return fields
}

const plain = (text: string | undefined, verdict?: Verdict): Cell => ({
  text: text ?? "",
  mark: undefined,
  verdict,
})

const column = (head: string, role: Role, lead = false, path = false): Column => ({
  head,
  role,
  lead,
  path,
})

/** A table with no rows says nothing a code block would not, and has no layout to draw. */
const filled = (config: MarkedTableConfig): MarkedTableConfig | undefined =>
  config.rows.length === 0 ? undefined : config

/* ------------------------------------------------------------------ the presets */

const decision = (source: string): MarkedTableConfig | undefined => {
  const blocks = blocksOf(source)
  const rows = every(
    (blocks ?? []).map((block): Row | undefined => {
      const [title, ...rest] = block.lines
      const fields = fieldsOf(rest, ["chose", "over", "why", "flag"])
      if (title === undefined || fields === undefined) return undefined
      return {
        cells: [plain(title), plain(fields.get("chose")), plain(fields.get("over"))],
        icon: fields.has("flag") ? "flag" : undefined,
        detail: fields.get("why"),
        detailLabel: "Why",
        section: block.section,
      }
    }),
  )
  if (blocks === undefined || rows === undefined) return undefined
  return filled({
    columns: [column("Decision", "plain", true), column("Chosen", "good"), column("Over", "bad")],
    rows,
    key: rows.some((row) => row.icon === "flag") ? [["flag", "Hard to reverse"]] : [],
    notes: [],
  })
}

const scope = (source: string): MarkedTableConfig | undefined => {
  const blocks = blocksOf(source)
  const rows = every(
    (blocks ?? []).map((block): Row | undefined => {
      const fields = fieldsOf(block.lines, ["in", "out", "why"])
      if (fields === undefined) return undefined
      return {
        cells: [plain(fields.get("in")), plain(fields.get("out"))],
        icon: undefined,
        detail: fields.get("why"),
        detailLabel: "Why out",
        section: block.section,
      }
    }),
  )
  if (blocks === undefined || rows === undefined) return undefined
  return filled({ columns: [column("In", "good"), column("Out", "bad")], rows, key: [], notes: [] })
}

/** How a criterion is verified, in the order its key lists them. */
const HOW: readonly (readonly [string, Mark, string])[] = [
  ["test", "test", "A test"],
  ["check", "check", "A check"],
  ["script", "script", "A script"],
  ["person", "person", "A person looks"],
]

/** A judgement on a criterion, drawn on its Verified by cell. */
const MET: Readonly<Record<string, Verdict>> = { yes: "good", no: "bad", partly: "partly" }

/** `3 met · 1 partly · 1 not met`, naming only the verdicts given. */
const tallyOf = (verdicts: readonly (Verdict | undefined)[]): string =>
  (
    [
      ["good", "met"],
      ["partly", "partly"],
      ["bad", "not met"],
    ] as const
  )
    .map(([verdict, words]) => [verdicts.filter((v) => v === verdict).length, words] as const)
    .filter(([n]) => n > 0)
    .map(([n, words]) => `${String(n)} ${words}`)
    .join(" · ")

const criteria = (source: string): MarkedTableConfig | undefined => {
  const blocks = blocksOf(source)
  const rows = every(
    (blocks ?? []).map((block): Row | undefined => {
      const [condition, ...rest] = block.lines
      const fields = fieldsOf(rest, ["by", "how", "met"])
      if (condition === undefined || fields === undefined) return undefined
      const how = fields.get("how")?.toLowerCase()
      const icon = HOW.find(([word]) => word === how)?.[1]
      if (how !== undefined && icon === undefined) return undefined
      const met = fields.get("met")?.toLowerCase()
      const verdict = met === undefined || !Object.hasOwn(MET, met) ? undefined : MET[met]
      if (met !== undefined && verdict === undefined) return undefined
      return {
        cells: [plain(condition), plain(fields.get("by"), verdict)],
        icon,
        detail: undefined,
        detailLabel: "",
        section: block.section,
      }
    }),
  )
  if (blocks === undefined || rows === undefined) return undefined
  const verdicts = rows.map((row) => row.cells[1]?.verdict)
  // A fence that judged nothing — a plan's — draws as it always did, with no tally.
  const tally: readonly (readonly [Mark, string])[] = verdicts.some((v) => v !== undefined)
    ? [["check", tallyOf(verdicts)]]
    : []
  return filled({
    columns: [column("Condition", "plain", true), column("Verified by", "plain")],
    rows,
    key: [
      ...tally,
      ...HOW.filter(([, mark]) => rows.some((row) => row.icon === mark)).map(
        ([, mark, words]) => [mark, words] as const,
      ),
    ],
    notes: [],
  })
}

const files = (source: string): MarkedTableConfig | undefined => {
  const items = itemsOf(source.split("\n"))
  if (items === undefined) return undefined
  const rows = items.map((item): Row => {
    const touch = item.head.startsWith("+ ")
      ? "new"
      : item.head.startsWith("~ ")
        ? "changed"
        : undefined
    const path = (touch === undefined ? item.head : item.head.slice(2)).trim().replaceAll("`", "")
    return {
      cells: [plain(path), plain(item.under.join(" "))],
      icon: touch,
      detail: undefined,
      detailLabel: "",
      section: item.section,
    }
  })
  const key: (readonly [Mark, string])[] = []
  if (rows.some((row) => row.icon === "new")) key.push(["new", "New"])
  if (rows.some((row) => row.icon === "changed")) key.push(["changed", "Changed"])
  return filled({
    columns: [column("File", "plain", true, true), column("What it is", "plain")],
    rows,
    key,
    notes: [],
  })
}

/** A run's result, as the verdict its said cell carries. A run that did not happen has none. */
const RESULT: Readonly<Record<string, Verdict | undefined>> = {
  passed: "good",
  failed: "bad",
  "not run": undefined,
}

/** The lines after every run, drawn under the table rather than as rows of it. */
const CODA: readonly (readonly [string, string])[] = [
  ["cost", "Cost"],
  ["after", "After"],
]

const runs = (source: string): MarkedTableConfig | undefined => {
  const blocks = blocksOf(source)
  if (blocks === undefined) return undefined
  // `cost:` and `after:` close the fence as a block of their own, its first line a field.
  const coda = blocks.at(-1)
  const closed = CODA.some(([key]) => coda?.lines[0]?.startsWith(`${key}:`) === true)
  const fields =
    closed && coda !== undefined
      ? fieldsOf(
          coda.lines,
          CODA.map(([key]) => key),
        )
      : new Map<string, string>()
  if (fields === undefined) return undefined
  const rows = every(
    (closed ? blocks.slice(0, -1) : blocks).map((block): Row | undefined => {
      const [name, ...rest] = block.lines
      const run = fieldsOf(rest, ["result", "said"])
      const result = run?.get("result")?.toLowerCase()
      if (name === undefined || run === undefined || result === undefined) return undefined
      if (!Object.hasOwn(RESULT, result)) return undefined
      const said = run.get("said") ?? ""
      // `after lint failed` reads as a reason only once it says what did not happen.
      const text = result === "not run" && said.startsWith("after ") ? `Not run, ${said}` : said
      return {
        cells: [plain(name), plain(text, RESULT[result])],
        icon: undefined,
        detail: undefined,
        detailLabel: "",
        section: block.section,
      }
    }),
  )
  if (rows === undefined) return undefined
  return filled({
    columns: [column("Run", "plain", true), column("What it said", "plain")],
    rows,
    key: [],
    notes: CODA.flatMap(([key, label]) => {
      const text = fields.get(key)
      return text === undefined || text === "" ? [] : [[label, text] as const]
    }),
  })
}

/* ------------------------------------------------------------------ the free table */

/** The icons a free table's row or key may name. */
const ICONS: Readonly<Record<string, Mark>> = {
  flag: "flag",
  check: "check",
  warn: "warn",
  new: "new",
  changed: "changed",
  test: "test",
  person: "person",
}
const ARROWS: Readonly<Record<string, Mark>> = { "+": "better", "-": "worse", "=": "same" }

const iconOf = (word: string): Mark | undefined =>
  Object.hasOwn(ICONS, word) ? ICONS[word] : undefined

/** A cell, with the arrow its leading `+ `, `- ` or `= ` asks for. */
const cellOf = (text: string): Cell => {
  const mark = /^([+=-]) /.exec(text)?.[1]
  const arrow = mark === undefined ? undefined : ARROWS[mark]
  return arrow === undefined
    ? plain(text)
    : { text: text.slice(2).trim(), mark: arrow, verdict: undefined }
}

/** `Head | + Good head | - Bad head`. */
const headsOf = (line: string): readonly Column[] | undefined => {
  const heads = line.split("|").map((head) => head.trim())
  if (heads.length > MOST_COLUMNS || heads.some((head) => head === "")) return undefined
  return heads.map((head, i) => {
    const role: Role = head.startsWith("+ ") ? "good" : head.startsWith("- ") ? "bad" : "plain"
    return column(role === "plain" ? head : head.slice(2).trim(), role, i === 0)
  })
}

/** `key: flag Hard to reverse, + Better, - Worse`. */
const keyOf = (line: string): readonly (readonly [Mark, string])[] | undefined =>
  every(
    line
      .slice("key:".length)
      .split(",")
      .map((entry): readonly [Mark, string] | undefined => {
        const [word = "", ...words] = entry.trim().split(/\s+/)
        const mark = ARROWS[word] ?? iconOf(word)
        const label = words.join(" ")
        return mark === undefined || label === "" ? undefined : [mark, label]
      }),
  )

const table = (source: string): MarkedTableConfig | undefined => {
  const lines = source.split("\n")
  const start = lines.findIndex((line) => line.trim() !== "")
  const columns = headsOf(lines[start] ?? "")
  if (start === -1 || columns === undefined) return undefined
  const next = start + 1
  const keyed = /^key:\s/.test(lines[next] ?? "")
  const key = keyed ? keyOf(lines[next] ?? "") : []
  const items = itemsOf(lines.slice(keyed ? next + 1 : next))
  if (key === undefined || items === undefined) return undefined
  const rows = every(
    items.map((item): Row | undefined => {
      if (item.under.length + 1 > columns.length) return undefined
      const icon = /^\[(\w+)\]\s*(.*)$/.exec(item.head)
      const named = icon?.[1] === undefined ? undefined : iconOf(icon[1])
      if (icon !== null && named === undefined) return undefined
      const lead = icon === null ? item.head : (icon[2] ?? "")
      return {
        cells: [lead, ...item.under].map(cellOf),
        icon: named,
        detail: undefined,
        detailLabel: "",
        section: item.section,
      }
    }),
  )
  return rows === undefined ? undefined : filled({ columns, rows, key, notes: [] })
}

/* ------------------------------------------------------------------ the dispatch */

const READERS: Readonly<Record<string, (source: string) => MarkedTableConfig | undefined>> = {
  decision,
  scope,
  criteria,
  files,
  runs,
  table,
}

/**
 * The table a fence draws, or `undefined` — for a label that is not one of the six, and
 * for a fence under one of them that does not read.
 */
export const markedTableOf = (label: string, source: string): MarkedTableConfig | undefined =>
  Object.hasOwn(READERS, label) ? READERS[label]?.(source) : undefined
