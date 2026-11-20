/**
 * The disclosure, and only that: `turns.test.ts` decides where a run starts and stops,
 * this decides what a run looks like before and after you press it.
 *
 * It renders the component bare rather than through a route, because nothing here reads
 * the router or the query cache — the group is the whole input.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { TranscriptEntryDto } from "../../../../api/types"
import { makeApiRetry, makeHook, makeNote, makeTool } from "../../../../fixtures"
import ActivityGroup from "./ActivityGroup"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const read = (path: string): TranscriptEntryDto => makeTool({ detail: path })

const ok: TranscriptEntryDto = makeNote({ text: "ToolResult(ok)" })

/**
 * A group as `groupEntries` now builds one: the calls **and their results**, because a
 * provider writes a `ToolResult` after each and that is what a run of calls looks like on
 * the wire. A fixture of four bare `Tool` entries is a shape no transcript contains.
 */
const FOUR = ["a.ts", "b.ts", "c.ts", "d.ts"].flatMap((p) => [read(p), ok])

describe("ActivityGroup", () => {
  it("stands for four reads as one counted row, and shows no path until asked", () => {
    render(<ActivityGroup group={FOUR} />)

    expect(screen.getByRole("button", { name: "Read 4 files" }).getAttribute("aria-expanded")).toBe(
      "false",
    )
    expect(screen.queryByText("a.ts")).toBeNull()
  })

  it("opens into every call it stands for — the paths are why the row exists", () => {
    render(<ActivityGroup group={FOUR} />)

    fireEvent.click(screen.getByRole("button", { name: "Read 4 files" }))

    for (const path of ["a.ts", "b.ts", "c.ts", "d.ts"]) {
      expect(screen.getByText(path)).toBeDefined()
    }
  })

  it("counts a lone call the same way, singular, and holds its path back too", () => {
    render(<ActivityGroup group={[read("only.ts")]} />)

    expect(screen.getByRole("button", { name: "Read 1 file" })).toBeDefined()
    expect(screen.queryByText("only.ts")).toBeNull()
  })

  it("opens a lone call onto the one path it stands for", () => {
    render(<ActivityGroup group={[read("only.ts")]} />)

    fireEvent.click(screen.getByRole("button", { name: "Read 1 file" }))

    expect(screen.getByText("only.ts")).toBeDefined()
  })

  it("names every kind in a mixed run, in one sentence", () => {
    render(<ActivityGroup group={[...FOUR, makeTool({ name: "Bash", kind: "Bash" }), ok]} />)

    expect(screen.getByRole("button", { name: "Read 4 files, and ran 1 command" })).toBeDefined()
  })

  it("labels each call of a mixed run when it opens, because the head no longer can", () => {
    const bash = makeTool({ name: "Bash", kind: "Bash", detail: "pnpm verify" })
    render(<ActivityGroup group={[read("a.ts"), ok, bash, ok]} />)

    fireEvent.click(screen.getByRole("button", { name: "Read 1 file, and ran 1 command" }))

    // The name beside the detail, which a single-kind run leaves out — the row above it
    // has already said `Read`, and repeating it down the column says nothing.
    expect(screen.getByText("Bash")).toBeDefined()
    expect(screen.getByText("pnpm verify")).toBeDefined()
  })

  it("leaves the names out of a run that is all one kind", () => {
    render(<ActivityGroup group={FOUR} />)

    fireEvent.click(screen.getByRole("button", { name: "Read 4 files" }))

    expect(screen.queryByText("Read")).toBeNull()
  })

  it("draws an entry the engine already wrote down as its own line", () => {
    render(<ActivityGroup group={[makeNote({ text: "Result(1204 chars)" })]} />)

    expect(screen.getByText("Result(1204 chars)")).toBeDefined()
  })

  it("marks the calls that failed, and says nothing about the ones that did not", () => {
    // Success is the default and a default needs no mark — a tick on every row is a
    // column saying "as expected" four times, and what a reader scans it for is the one
    // that did not work.
    const bad: TranscriptEntryDto = makeNote({ text: "ToolResult(exit 1)" })
    render(<ActivityGroup group={[read("a.ts"), ok, read("b.ts"), bad, read("c.ts"), bad]} />)

    expect(screen.getByText("2 failed")).toBeDefined()
  })

  it("says nothing on the right when every call came back clean", () => {
    render(<ActivityGroup group={FOUR} />)

    expect(screen.queryByText(/failed/)).toBeNull()
  })
})

const called = (name: string, detail: string): TranscriptEntryDto =>
  makeTool({ name, kind: "Other", detail })

/**
 * The four tools the audit found drawing as a bare name. They all normalize to `Other`,
 * whose phrase is `Called 3 times` and names no tool at all — so the head cannot stand in
 * for the label the way `Read 4 files` does.
 */
describe("ActivityGroup — the tools nothing classifies", () => {
  it("labels each call of a run of them, though they are all one kind", () => {
    render(
      <ActivityGroup
        group={[called("Skill", "atelier-proof"), ok, called("TaskStop", "task_4b1e"), ok]}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Called 2 times" }))

    // Kind-based, both rows would be a bare argument with nothing saying which tool made
    // it — `Skill` and `TaskStop` are the same kind and are not the same thing.
    for (const text of ["Skill", "atelier-proof", "TaskStop", "task_4b1e"]) {
      expect(screen.getByText(text)).toBeDefined()
    }
  })

  it("labels a run of one of them too, because `Called 2 times` names nothing", () => {
    render(
      <ActivityGroup group={[called("Skill", "atelier-proof"), ok, called("Skill", "run"), ok]} />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Called 2 times" }))

    expect(screen.getAllByText("Skill")).toHaveLength(2)
  })

  it("still leaves the name out where the head has already said it", () => {
    // `Read 4 files` over four paths would be `Read` said four more times.
    render(<ActivityGroup group={FOUR} />)

    fireEvent.click(screen.getByRole("button", { name: "Read 4 files" }))
    expect(screen.queryByText("Read")).toBeNull()
  })
})

describe("ActivityGroup — a call still running", () => {
  const at = 1_786_400_000_000

  /** `Date` and the store's interval both faked, so a second can pass with nothing new arriving. */
  const now = (offset: number): void => {
    vi.useFakeTimers()
    vi.setSystemTime(at + offset)
  }

  const slow: TranscriptEntryDto = makeTool({
    name: "Bash",
    kind: "Bash",
    detail: "pnpm verify",
    call: "c-verify",
    at,
  })
  const answered: TranscriptEntryDto = makeNote({ text: "ToolResult(ok)", call: "c-verify" })
  const reads = [read("a.ts"), ok, read("b.ts"), ok]

  it("draws the call on its own line under the run, counting only what has finished", () => {
    now(1000)
    render(<ActivityGroup group={[...reads, slow]} live />)

    expect(screen.getByRole("button", { name: "Read 2 files" })).toBeDefined()
    expect(screen.getByText("pnpm verify")).toBeDefined()
  })

  it("folds the call into the count once its result arrives", () => {
    now(1000)
    render(<ActivityGroup group={[...reads, slow, answered]} live />)

    expect(screen.getByRole("button", { name: "Read 2 files, and ran 1 command" })).toBeDefined()
    expect(screen.queryByText("pnpm verify")).toBeNull()
  })

  it("draws no row above a call that is the whole run, only the line", () => {
    now(1000)
    render(<ActivityGroup group={[slow]} live />)

    expect(screen.queryByRole("button")).toBeNull()
    // A bare command keeps breaking anywhere: it has no words to break between.
    expect(screen.getByText("pnpm verify").className).toContain("break-all")
  })

  it("names any kind but a command by its tool, and shows the text whole", () => {
    now(1000)
    const url = "https://docs.anthropic.com/en/docs/claude-code/cli-reference#print-mode-flags"
    render(
      <ActivityGroup
        group={[makeTool({ name: "WebFetch", kind: "WebFetch", detail: url, at })]}
        live
      />,
    )

    expect(screen.getByText(`WebFetch ${url}`)).toBeDefined()
  })

  it("holds the clock back for the first three seconds", () => {
    now(2000)
    render(<ActivityGroup group={[slow]} live />)

    expect(screen.queryByText(/^Running/u)).toBeNull()
  })

  it("shows the clock once the call has run three seconds", () => {
    now(112_000)
    render(<ActivityGroup group={[slow]} live />)

    expect(screen.getByText("Running · 1m 52s")).toBeDefined()
  })

  it("keeps counting every second while nothing new arrives", () => {
    now(40_000)
    render(<ActivityGroup group={[slow]} live />)
    expect(screen.getByText("Running · 40s")).toBeDefined()

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(screen.getByText("Running · 42s")).toBeDefined()
  })

  it("draws every call still open, each with its own clock, in the order they went out", () => {
    now(22_000)
    const tests = makeTool({ name: "Bash", kind: "Bash", detail: "pnpm test", call: "c-test", at })
    const verify = makeTool({
      name: "Bash",
      kind: "Bash",
      detail: "pnpm verify",
      call: "c-verify",
      at: at + 4000,
    })
    render(<ActivityGroup group={[tests, verify]} live />)

    const lines = screen.getAllByText(/^pnpm /u).map((e) => e.textContent)
    expect(lines).toEqual(["pnpm test", "pnpm verify"])
    expect(screen.getByText("Running · 22s")).toBeDefined()
    expect(screen.getByText("Running · 18s")).toBeDefined()
  })

  it("folds a call nothing is driving, though it never answered", () => {
    // The default, and the answer for every group but the live end of the live turn.
    now(112_000)
    render(<ActivityGroup group={[slow]} />)

    expect(screen.getByRole("button", { name: /Ran 1 command/ })).toBeDefined()
    expect(screen.queryByText("pnpm verify")).toBeNull()
    expect(screen.queryByText(/^Running/u)).toBeNull()
  })

  it("keeps the failure count on the run while a call below it runs", () => {
    now(31_000)
    const bad: TranscriptEntryDto = makeNote({ text: "ToolResult(exit 1)" })
    render(<ActivityGroup group={[makeTool({ at, detail: "a.ts" }), bad, slow]} live />)

    expect(screen.getByText("1 failed")).toBeDefined()
    expect(screen.getByText("Running · 31s")).toBeDefined()
  })
})

describe("ActivityGroup — a pause the provider retried during", () => {
  const thinking: TranscriptEntryDto = makeNote({ text: "Thinking" })

  const retried: readonly TranscriptEntryDto[] = [
    thinking,
    makeApiRetry({ attempt: 2, of: 5, status: "429" }),
  ]

  it("says what is happening on the pause itself rather than on a row of its own", () => {
    render(<ActivityGroup group={retried} driving />)

    expect(screen.getByText("retrying · 429 · attempt 2 of 5")).toBeDefined()
    // One row, not the pause and a line under it: the agent was waiting the whole time.
    expect(screen.getAllByText("Thinking")).toHaveLength(1)
  })

  it("keeps the words and drops the dots once nothing is driving the turn", () => {
    // This is the one pause that outlives its own wait, so on a finished turn it is the
    // only thing left moving on the screen — which is what it gets read as. The words are
    // the account of the retry and stay; the dots are a claim about right now.
    render(<ActivityGroup group={retried} />)

    expect(screen.getByText("retrying · 429 · attempt 2 of 5")).toBeDefined()
    expect(screen.queryByText("Thinking")).toBeNull()
  })

  it("draws an ordinary pause as the dots and their name, and nothing else", () => {
    render(<ActivityGroup group={[thinking]} live driving />)

    expect(screen.getByText("Thinking")).toBeDefined()
    expect(screen.queryByText(/retrying/)).toBeNull()
  })
})

describe("ActivityGroup — a pause carrying the model's summary", () => {
  const thought: TranscriptEntryDto = makeNote({
    text: "Thinking: Planning file size counting method",
  })

  it("names the dots with the summary rather than the word", () => {
    const { container } = render(<ActivityGroup group={[thought]} driving />)

    expect(screen.getByText("Planning file size counting method")).toBeDefined()
    expect(screen.queryByText("Thinking")).toBeNull()
    expect(container.querySelectorAll(".animate-thinking")).toHaveLength(3)
  })

  it("names them by the latest summary where the model thought twice", () => {
    // `gather` folded the two lines into one group; what the row says is what it is
    // thinking now.
    const later: TranscriptEntryDto = makeNote({ text: "Thinking: Verifying the byte counts" })
    render(<ActivityGroup group={[thought, later]} driving />)

    expect(screen.getByText("Verifying the byte counts")).toBeDefined()
    expect(screen.queryByText("Planning file size counting method")).toBeNull()
  })

  it("draws the retry after the summary, on the same row", () => {
    render(
      <ActivityGroup
        group={[thought, makeApiRetry({ attempt: 2, of: 5, status: "429" })]}
        driving
      />,
    )

    expect(screen.getByText("Planning file size counting method")).toBeDefined()
    expect(screen.getByText("retrying · 429 · attempt 2 of 5")).toBeDefined()
  })
})

describe("ActivityGroup — a command the agent described", () => {
  const at = 1_786_400_000_000

  it("opens a described command onto its description, with the command under it", () => {
    const heredoc = "cat > app/tag.rb <<'EOF'"
    const call = makeTool({
      name: "Bash",
      kind: "Bash",
      detail: "Write the tag component",
      command: heredoc,
    })
    render(<ActivityGroup group={[call, ok]} />)
    expect(screen.queryByText(heredoc)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /Ran 1 command/ }))

    expect(screen.getByText("Write the tag component")).toBeDefined()
    expect(screen.getByText(heredoc)).toBeDefined()
  })

  it("says what a running command is for when the agent described it", () => {
    vi.useFakeTimers()
    vi.setSystemTime(at + 1000)
    const call = makeTool({
      name: "Bash",
      kind: "Bash",
      detail: "Run the touched specs",
      command: "bin/rspec spec/a_spec.rb",
      at,
    })
    render(<ActivityGroup group={[call]} live />)

    // Prose breaks between words; `break-all` split "partials" into "partial / s".
    expect(screen.getByText("Run the touched specs").className).toContain("break-words")
    expect(screen.getByText("Run the touched specs").className).not.toContain("break-all")
    expect(screen.queryByText("bin/rspec spec/a_spec.rb")).toBeNull()
  })
})

/** A call to a tool an external server supplies, as both normalizers write one. */
const mcp = (detail: string, over: Partial<TranscriptEntryDto> = {}): TranscriptEntryDto =>
  makeTool({ name: "mcp_tool_call", kind: "Mcp", detail, ...over })

describe("ActivityGroup — an MCP call", () => {
  const at = 1_786_400_000_000
  it("opens onto its mark and server/tool, and never the provider's name", () => {
    render(<ActivityGroup group={[read("a.ts"), ok, mcp("linear/get_issue"), ok]} />)

    fireEvent.click(screen.getByRole("button", { name: "Read 1 file, and called 1 time" }))

    expect(screen.getByLabelText("MCP tool")).toBeDefined()
    expect(screen.getByText("linear/get_issue")).toBeDefined()
    expect(screen.queryByText("mcp_tool_call")).toBeNull()
    // The reads stay bare: only the MCP call would have made the run labelled.
    expect(screen.queryByText("Read")).toBeNull()
  })

  it("runs on one truncated line behind its mark", () => {
    vi.useFakeTimers()
    vi.setSystemTime(at + 1000)
    render(<ActivityGroup group={[mcp("linear/get_issue", { at })]} live />)

    expect(screen.getByLabelText("MCP tool")).toBeDefined()
    expect(screen.getByText("linear/get_issue").className).toContain("truncate")
    expect(screen.queryByText(/mcp_tool_call/)).toBeNull()
  })
})

describe("ActivityGroup, with hooks", () => {
  const call = makeTool({ name: "commandExecution", kind: "Bash", detail: "rm -rf x", call: "c" })
  const blocked = makeHook({ call: "c", status: "blocked", message: "exit 2" })
  const stray = makeHook({ call: "gone", event: "postToolUse", status: "failed" })
  const group = [
    makeHook({ call: "c" }),
    call,
    makeNote({ text: "ToolResult(error)", call: "c" }),
    blocked,
    stray,
  ]

  it("marks no hook on the closed row, which keeps only its failed count", () => {
    render(<ActivityGroup group={group} />)

    expect(screen.getByText("1 failed")).toBeDefined()
    expect(screen.queryByRole("button", { name: /hook/ })).toBeNull()
  })

  it("marks the call's line with one mark for both hooks, and the stray on a line of its own", () => {
    render(<ActivityGroup group={group} />)
    fireEvent.click(screen.getByRole("button", { name: /Ran 1 command/ }))

    expect(screen.getByRole("button", { name: "2 hooks, blocked" })).toBeDefined()
    expect(screen.getByText("postToolUse hook")).toBeDefined()
    expect(screen.getByRole("button", { name: "1 hook, failed" })).toBeDefined()
  })

  it("opens what each hook said on a press", () => {
    render(<ActivityGroup group={group} />)
    fireEvent.click(screen.getByRole("button", { name: /Ran 1 command/ }))
    fireEvent.click(screen.getByRole("button", { name: "2 hooks, blocked" }))

    const card = screen.getByRole("dialog", { name: "2 hooks, blocked" })
    expect(card.textContent).toContain("blocked · exit 2")
    expect(card.textContent).toContain("no output")
  })
})
