import { Either } from "effect"
import { describe, expect, it } from "vitest"
import { goalDraftRefusal, goalFileText, parseGoal } from "./goal-file.js"

const file = (frontmatter: string, body = "Goals run end to end.\n"): string =>
  `---\n${frontmatter}\n---\n\n${body}`

/** The parsed goal, or the failure's reason — so no assertion is conditional. */
const parse = (text: string, name = "ship-goals"): unknown =>
  Either.match(parseGoal(`goals/${name}.md`, name, text), {
    onLeft: (e) => e.reason,
    onRight: (g) => g,
  })

describe("a goal file", () => {
  it("reads the title, the line, the body as the finished state, and no limits", () => {
    expect(parse(file("title: Ship goals\nline: The engine side"))).toEqual({
      name: "ship-goals",
      title: "Ship goals",
      line: "The engine side",
      finished: "Goals run end to end.",
      limits: {},
    })
  })

  it("reads every limit, spelled as the file spells it", () => {
    const text = file(
      "title: t\nline: l\nparallel: 2\ntraks_per_hour: 3\ntraks_per_day: 10\nmodes: [smart, auto]",
    )
    expect(parse(text)).toMatchObject({
      limits: { parallel: 2, perHour: 3, perDay: 10, modes: ["smart", "auto"] },
    })
  })

  it("reads auto_merge in three states, the older true and false among them", () => {
    const read = (key: string) => {
      const goal = parse(file(`title: t\nline: l${key}`))
      return typeof goal === "object" && goal !== null && "limits" in goal ? goal.limits : goal
    }
    expect(read("\nauto_merge: never")).toEqual({ autoMerge: "never" })
    expect(read("\nauto_merge: always")).toEqual({ autoMerge: "always" })
    expect(read("\nauto_merge: false")).toEqual({ autoMerge: "never" })
    expect(read("\nauto_merge: true")).toEqual({})
    expect(read("")).toEqual({})
  })

  it("writes auto_merge back as it was read", () => {
    const goal = {
      name: "g",
      title: "t",
      line: "l",
      finished: "Done.",
      limits: { autoMerge: "always" as const },
    }
    expect(goalFileText(goal)).toContain("auto_merge: always")
    expect(parse(goalFileText(goal), "g")).toEqual(goal)
  })

  it("reads a goal branch, writes it back, and leaves it out where the file names none", () => {
    expect(parse(file("title: t\nline: l\nbranch: goal/ship-goals"))).toMatchObject({
      branch: "goal/ship-goals",
    })
    expect(parse(file("title: t\nline: l"))).not.toHaveProperty("branch")
    const goal = {
      name: "g",
      title: "t",
      line: "l",
      finished: "Done.",
      limits: {},
      branch: "goal/g",
    }
    expect(goalFileText(goal)).toContain('branch: "goal/g"')
    expect(parse(goalFileText(goal), "g")).toEqual(goal)
  })

  it("refuses a goal branch no branch could be called, naming the field", () => {
    expect(parse(file("title: t\nline: l\nbranch: two words"))).toContain("`branch:`")
    expect(parse(file("title: t\nline: l\nbranch: -x"))).toContain("`branch:`")
    expect(parse(file("title: t\nline: l\nbranch: a..b"))).toContain("`branch:`")
  })

  it("refuses a mode that is not a run mode, naming the field", () => {
    expect(parse(file("title: t\nline: l\nmodes: [yolo]"))).toContain("`modes:`")
  })

  it("refuses a limit that is not a positive whole number", () => {
    expect(parse(file("title: t\nline: l\nparallel: 0"))).toContain("`parallel:`")
    expect(parse(file("title: t\nline: l\ntraks_per_day: 1.5"))).toContain("`parallel:`")
  })

  it("refuses an unknown field by name, and says where a description goes", () => {
    expect(parse(file("title: t\nline: l\nwhen: soon"))).toContain("unknown field `when:`")
    expect(parse(file("title: t\nline: l\ndescription: d"))).toContain(
      "the body is the description",
    )
  })

  it("refuses a file with no body — a goal that says nothing can never be done", () => {
    expect(parse(file("title: t\nline: l", ""))).toContain("no body")
  })

  it("refuses a name a start could not send", () => {
    expect(parse(file("title: t\nline: l"), "Ship Goals")).toContain("lowercase-kebab")
  })
})

describe("a drafted goal's text", () => {
  const drafted = {
    name: "search-everywhere",
    title: "Search: every trak",
    line: 'Find any trak by typing "anything"',
    finished: "One box finds traks.\n\nIt works on a phone.",
    limits: { parallel: 2, perDay: 6, modes: ["smart", "auto"] as const },
  }

  it("reads back as the goal it was written from, quotes and colons included", () => {
    expect(parse(goalFileText(drafted), drafted.name)).toEqual(drafted)
    expect(goalDraftRefusal(drafted)).toBeUndefined()
  })

  it("is refused for a name a start could not name", () => {
    expect(goalDraftRefusal({ ...drafted, name: "Search Everywhere" })).toContain("lowercase-kebab")
  })
})
