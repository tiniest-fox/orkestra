import { describe, expect, it } from "vitest"
import { differs, limitsOf, modeLocked, settingsOf, toggledMode } from "./settings"

describe("a goal's settings", () => {
  it("spell every absence out as a choice, and fold each back to absent", () => {
    const all = settingsOf({})
    expect(all).toEqual({
      parallel: undefined,
      perHour: undefined,
      perDay: undefined,
      modes: ["manual", "smart", "decider", "auto"],
      merge: "composer",
    })
    expect(limitsOf(all)).toEqual({})
  })

  it("send every setting that limits something, whole", () => {
    const set = settingsOf({ parallel: 2, perDay: 5, modes: ["auto", "smart"], autoMerge: "never" })
    expect(limitsOf(set)).toEqual({
      parallel: 2,
      perDay: 5,
      modes: ["smart", "auto"],
      autoMerge: "never",
    })
    expect(limitsOf({ ...set, merge: "always" }).autoMerge).toBe("always")
  })

  it("keep the last mode on, and say it cannot go off", () => {
    const one = settingsOf({ modes: ["smart"] })
    expect(toggledMode(one, "smart")).toBe(one)
    expect(modeLocked(one, "smart")).toBe(true)
    expect(toggledMode(one, "manual").modes).toEqual(["manual", "smart"])
    expect(modeLocked(toggledMode(one, "manual"), "smart")).toBe(false)
  })

  it("mark only what differs from the draft", () => {
    const draft = settingsOf({ parallel: 2, modes: ["smart", "auto"] })
    const edited = { ...draft, parallel: 3, merge: "always" as const }
    expect(differs(draft, edited, "parallel")).toBe(true)
    expect(differs(draft, edited, "merge")).toBe(true)
    expect(differs(draft, edited, "modes")).toBe(false)
    expect(differs(draft, edited, "perDay")).toBe(false)
  })
})
