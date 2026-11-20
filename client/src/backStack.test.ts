import { createMemoryHistory, createRouter } from "@tanstack/react-router"
import type { RouterHistory } from "@tanstack/react-router"
import { describe, expect, it } from "vitest"
import { open, reclaim, release, stackStep, withBackStack } from "./backStack"
import { routeTree } from "./routes"

/** A history under the rule at `home`, opened on `at`, shown or not as `shown` says. */
const stack = (
  at: string,
  home = "/",
  shown: { value: boolean } = { value: true },
): RouterHistory =>
  withBackStack(createMemoryHistory({ initialEntries: [at] }), home, () => shown.value)

/** Where the history is, and whether an entry of this page sits below it. */
const where = (history: RouterHistory): { path: string; below: boolean; overList: boolean } => ({
  path: history.location.href,
  below: history.canGoBack(),
  overList: history.location.state.overList === true,
})

describe("stackStep", () => {
  it("pushes from the list to anything else, and only while shown", () => {
    expect(stackStep({ home: true, overList: false }, false, true)).toEqual({
      move: "push",
      overList: true,
    })
    expect(stackStep({ home: true, overList: false }, false, false)).toEqual({
      move: "replace",
      overList: false,
    })
    expect(stackStep({ home: true, overList: false }, true, true)).toEqual({
      move: "replace",
      overList: false,
    })
  })

  it("goes back to the list from an entry over it, and replaces from any other", () => {
    expect(stackStep({ home: false, overList: true }, true, true)).toEqual({
      move: "back",
      overList: false,
    })
    expect(stackStep({ home: false, overList: false }, true, true)).toEqual({
      move: "replace",
      overList: false,
    })
  })

  it("replaces between screens, carrying the mark while shown", () => {
    expect(stackStep({ home: false, overList: true }, false, true)).toEqual({
      move: "replace",
      overList: true,
    })
    expect(stackStep({ home: false, overList: false }, false, true)).toEqual({
      move: "replace",
      overList: false,
    })
    expect(stackStep({ home: false, overList: true }, false, false)).toEqual({
      move: "replace",
      overList: false,
    })
  })
})

describe("withBackStack", () => {
  it("keeps the list and one screen over it, whatever the caller asked for", () => {
    const history = stack("/")

    history.push("/traks/a")
    expect(where(history)).toEqual({ path: "/traks/a", below: true, overList: true })
    history.push("/traks/b")
    history.push("/traks/b?spot=x")
    history.replace("/goals/g")
    expect(where(history)).toEqual({ path: "/goals/g", below: true, overList: true })

    history.push("/")
    expect(where(history)).toEqual({ path: "/", below: false, overList: false })
  })

  it("replaces a screen opened cold with the list rather than stacking one under it", () => {
    const history = stack("/traks/a")

    history.push("/")
    expect(where(history)).toEqual({ path: "/", below: false, overList: false })
  })

  it("keeps the state a caller hands over", () => {
    const history = stack("/")

    history.push("/traks/new", { description: "merge it" })
    expect(history.location.state.description).toBe("merge it")
  })

  it("reads the list at the page's prefix", () => {
    const history = stack("/p/x/", "/p/x/")

    history.push("/p/x/traks/a")
    expect(where(history)).toMatchObject({ below: true, overList: true })
    history.push("/p/x")
    expect(where(history)).toEqual({ path: "/p/x/", below: false, overList: false })
  })

  it("does not push while hidden", () => {
    const history = stack("/", "/", { value: false })

    history.push("/traks/a")
    expect(where(history)).toEqual({ path: "/traks/a", below: false, overList: false })
  })

  it("holds under the router's own navigation", async () => {
    const history = stack("/")
    const router = createRouter({ routeTree, history })
    await router.load()

    await router.navigate({ to: "/traks/$id", params: { id: "a" } })
    await router.navigate({ to: "/traks/$id", params: { id: "b" } })
    await router.navigate({ to: "/traks/$id", params: { id: "b" }, search: { spot: "x" } })
    expect(where(history)).toEqual({ path: "/traks/b?spot=x", below: true, overList: true })

    await router.navigate({ to: "/" })
    expect(where(history)).toEqual({ path: "/", below: false, overList: false })
    expect(router.state.location.pathname).toBe("/")
  })
})

describe("a frame's share of the back stack", () => {
  it("gives its entry up when hidden, staying on its screen", () => {
    const shown = { value: true }
    const history = stack("/", "/", shown)
    history.push("/traks/a")

    shown.value = false
    release(history, "/")
    expect(where(history)).toEqual({ path: "/traks/a", below: false, overList: false })
  })

  it("takes an entry back when shown again, so back goes to its list", () => {
    const shown = { value: false }
    const history = stack("/traks/a", "/", shown)

    shown.value = true
    reclaim(history, "/")
    expect(where(history)).toEqual({ path: "/traks/a", below: true, overList: true })
    history.back()
    expect(where(history)).toMatchObject({ path: "/", below: false })
  })

  it("leaves the list, and an entry it already holds, alone", () => {
    const listed = stack("/")
    reclaim(listed, "/")
    expect(where(listed)).toEqual({ path: "/", below: false, overList: false })

    const holding = stack("/")
    holding.push("/traks/a")
    reclaim(holding, "/")
    expect(where(holding)).toEqual({ path: "/traks/a", below: true, overList: true })
  })
})

describe("open", () => {
  it("routes a notification click by the rule", () => {
    const history = stack("/")

    open(history, "http://h/traks/a", "http://h")
    expect(where(history)).toEqual({ path: "/traks/a", below: true, overList: true })
    open(history, "http://h/goals/g", "http://h")
    expect(where(history)).toEqual({ path: "/goals/g", below: true, overList: true })
  })

  it("ignores a URL on another origin", () => {
    const history = stack("/")

    open(history, "http://elsewhere/traks/a", "http://h")
    expect(where(history)).toEqual({ path: "/", below: false, overList: false })
  })
})
