import { describe, expect, it } from "vitest"
import { type Jar, mirrorLogin } from "./panel-login.js"

/** The view's cookie jar, by name, standing in for the three calls `mirrorLogin` makes. */
const jarOf = (held: Record<string, string>): { jar: Map<string, string>; cookies: Jar } => {
  const jar = new Map(Object.entries(held))
  const cookies: Jar = {
    get: () =>
      Promise.resolve([...jar].map(([name, value]) => ({ name, value, domain: ".github.com" }))),
    remove: (_url: string, name: string) => Promise.resolve(void jar.delete(name)),
    set: (cookie) => Promise.resolve(void jar.set(cookie.name ?? "", cookie.value ?? "")),
  }
  return { jar, cookies }
}

describe("mirroring the browser's login into the pull request view", () => {
  it("tells a first use from a browser that signed out by what the view held", async () => {
    expect(await mirrorLogin(jarOf({}).cookies, { state: "signed-out" })).toStrictEqual({
      state: "signed-out",
      changed: false,
    })
    const { jar, cookies } = jarOf({ user_session: "old", logged_in: "yes" })
    expect(await mirrorLogin(cookies, { state: "signed-out" })).toStrictEqual({
      state: "browser-out",
      changed: true,
    })
    expect(jar.size).toBe(0)
  })

  it("leaves the view's own login alone when the read failed", async () => {
    const { jar, cookies } = jarOf({ user_session: "typed-in-the-panel" })
    expect(await mirrorLogin(cookies, { state: "keychain" })).toStrictEqual({
      state: "keychain",
      changed: false,
    })
    expect(await mirrorLogin(cookies, { state: "not-chromium" })).toStrictEqual({
      state: "not-chromium",
      changed: false,
    })
    expect(jar.get("user_session")).toBe("typed-in-the-panel")
  })

  it("replaces what the view held with the browser's, and drops an expired cookie", async () => {
    const { jar, cookies } = jarOf({ user_session: "old", stale: "x" })
    const cookie = {
      host: "github.com",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
    } as const
    expect(
      await mirrorLogin(cookies, {
        state: "copied",
        cookies: [
          { ...cookie, name: "user_session", value: "new", expires: undefined },
          { ...cookie, name: "gone", value: "x", expires: 1 },
        ],
      }),
    ).toStrictEqual({ state: "copied", changed: true })
    expect([...jar]).toStrictEqual([["user_session", "new"]])
  })
})
