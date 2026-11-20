import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BrowserLogin } from "./browser-login.js"

// Electron's main-process API stood in for by what `page-view.ts` touches: the IPC handlers
// it registers, the view it makes, the shell it hands links to, and the GitHub session it
// copies the browser's login into. What is under test is the decision between moving the
// view and loading it, and when the login is copied.
const handlers = new Map<string, (...args: unknown[]) => void>()
const loads: string[] = []
/** The fields of Electron's navigation event the pull request guard reads. */
interface GuardEvent {
  readonly isMainFrame: boolean
  readonly url: string
  readonly preventDefault: () => void
}
/** One view made: the session it was given, and what it has done. */
interface Made {
  readonly partition: string | undefined
  readonly loads: string[]
  /** What the view's guard listens for, by event. */
  readonly on: Map<string, (event: GuardEvent) => void>
  visible: boolean
  reloads: number
  /** Where the view was last placed, in the window's points. */
  bounds: unknown
}
const views: Made[] = []
/** What the shell handed the default browser. */
const opened: string[] = []
/** What the window was told about the login, in order. */
const told: unknown[] = []
/** What each copy reads from the browser, and how many have run. */
const browser: { read: BrowserLogin; copies: number } = { read: { state: "signed-out" }, copies: 0 }
/** The pull request view's cookies, by name. */
const jar = new Map<string, string>()

/** While set, every copy waits on it before it reads — a copy still in flight. */
const gate: { held: Promise<void> | undefined } = { held: undefined }

vi.mock("./browser-login.js", () => ({
  readBrowserLogin: async () => {
    browser.copies += 1
    await gate.held
    return browser.read
  },
}))

vi.mock("electron", () => ({
  app: { getApplicationNameForProtocol: () => "Dia" },
  ipcMain: {
    on: (channel: string, handler: (...args: unknown[]) => void) => handlers.set(channel, handler),
  },
  shell: {
    openExternal: (url: string) => {
      opened.push(url)
      return Promise.resolve()
    },
  },
  session: {
    fromPartition: () => ({
      cookies: {
        get: () =>
          Promise.resolve(
            [...jar].map(([name, value]) => ({ name, value, domain: "github.com", path: "/" })),
          ),
        remove: (_url: string, name: string) => {
          jar.delete(name)
          return Promise.resolve()
        },
        set: (cookie: { readonly name: string; readonly value: string }) => {
          jar.set(cookie.name, cookie.value)
          return Promise.resolve()
        },
      },
    }),
  },
  WebContentsView: class {
    readonly made: Made
    readonly webContents: Record<string, (...args: never[]) => unknown>
    constructor(options: { readonly webPreferences: { readonly partition?: string } }) {
      const made: Made = {
        partition: options.webPreferences.partition,
        loads: [],
        on: new Map(),
        visible: false,
        reloads: 0,
        bounds: undefined,
      }
      views.push(made)
      this.made = made
      this.webContents = {
        setWindowOpenHandler: () => undefined,
        on: (event: string, listener: never) => made.on.set(event, listener),
        getURL: () => made.loads.at(-1) ?? "",
        loadURL: (url: string) => {
          loads.push(url)
          made.loads.push(url)
          return Promise.resolve()
        },
        reload: () => {
          made.reloads += 1
        },
        close: () => undefined,
      }
    }
    setVisible = (visible: boolean): void => {
      this.made.visible = visible
    }
    getVisible = (): boolean => this.made.visible
    setBounds = (bounds: unknown): void => {
      this.made.bounds = bounds
    }
  },
}))

const { installPageView, resumePages, suspendPages } = await import("./page-view.js")

/** A project window, and the `focus` and `closed` listeners the shell put on it. */
const windowOf = () => {
  const focus: (() => void)[] = []
  const closed: (() => void)[] = []
  /** Where the project's own view sits, and whether another tile is selected. */
  const at = { origin: { x: 0, y: 0 }, hidden: false }
  return {
    focus,
    closed,
    at,
    webContents: {
      getZoomFactor: () => 1,
      on: () => undefined,
      send: (_channel: string, login: unknown) => told.push(login),
    },
    contentView: { addChildView: () => undefined, removeChildView: () => undefined },
    on: (_event: "focus", listener: () => void) => focus.push(listener),
    once: (_event: "closed", listener: () => void) => closed.push(listener),
    origin: () => at.origin,
    hidden: () => at.hidden,
  }
}
const focused = (window: ReturnType<typeof windowOf>): void => {
  for (const listener of window.focus) listener()
}
const SENDER = {}
const WINDOW = windowOf()
/** Each sender's window: a test that needs a window's login state of its own adds one. */
const windows = new Map<object, ReturnType<typeof windowOf>>([[SENDER, WINDOW]])
const BOX = { x: 488, y: 120, width: 792, height: 700 }
const ADDRESS = "http://127.0.0.1:47213/"

installPageView(
  (sender) => windows.get(sender),
  () => undefined,
)

const show = (run: string, url: string): void => {
  handlers.get("page:show")?.({ sender: SENDER }, run, url, BOX)
}

describe("when the native page view loads", () => {
  beforeEach(() => {
    loads.length = 0
  })

  it("loads a new run fresh at the same address — a restart keeps its port", () => {
    show(JSON.stringify(["t", "dev", 1]), ADDRESS)
    show(JSON.stringify(["t", "dev", 2]), ADDRESS)
    expect(loads).toStrictEqual([ADDRESS, ADDRESS])
  })

  it("only moves the view for the same run, so a resize does not reload the page", () => {
    show(JSON.stringify(["t", "dev", 3]), ADDRESS)
    show(JSON.stringify(["t", "dev", 3]), ADDRESS)
    expect(loads).toStrictEqual([ADDRESS])
  })

  it("loads another trak's process given a freed port", () => {
    show(JSON.stringify(["a", "dev", 1]), ADDRESS)
    show(JSON.stringify(["b", "dev", 1]), ADDRESS)
    expect(loads).toStrictEqual([ADDRESS, ADDRESS])
  })
})

describe("when the page asks for a pull request", () => {
  const PULL = "https://github.com/tiniest-fox/orkestra-ts/pull/121"
  const DEV = JSON.stringify(["t", "dev", 9])
  const PR = JSON.stringify(["t", "pull-request", PULL])
  const viewOf = (url: string): Made | undefined => views.find((v) => v.loads.includes(url))

  it("draws it in a second view, in GitHub's own persisted session", async () => {
    show(PR, PULL)
    await vi.waitFor(() => expect(viewOf(PULL)).toBeDefined())
    expect(viewOf(PULL)?.partition).toBe("persist:github")
    expect(viewOf(ADDRESS)?.partition).toBeUndefined()
  })

  it("reloads neither page when the pane switches between them, and shows one at a time", () => {
    show(DEV, ADDRESS)
    show(PR, PULL)
    const before = loads.length
    show(DEV, ADDRESS)
    show(PR, PULL)
    expect(loads).toHaveLength(before)
    expect([viewOf(ADDRESS)?.visible, viewOf(PULL)?.visible]).toStrictEqual([false, true])
  })

  it("reloads only the view that is showing, and hides both", () => {
    show(PR, PULL)
    const pull = viewOf(PULL)
    const before = pull?.reloads ?? 0
    handlers.get("page:reload")?.({ sender: SENDER })
    expect(pull?.reloads).toBe(before + 1)
    expect(viewOf(ADDRESS)?.reloads).toBe(0)
    handlers.get("page:hide")?.({ sender: SENDER })
    expect(views.every((v) => !v.visible)).toBe(true)
  })

  it("refuses any other https address", () => {
    const before = views.length
    show(JSON.stringify(["t", "pull-request", "x"]), "https://example.com/a/b/pull/1")
    expect(views).toHaveLength(before)
    expect(loads).not.toContain("https://example.com/a/b/pull/1")
  })
})

describe("when the pull request view copies the browser's login", () => {
  const PULL = "https://github.com/tiniest-fox/orkestra-ts/pull/200"
  const PR = JSON.stringify(["login", "pull-request", PULL])
  const viewOf = (): Made | undefined => views.find((v) => v.loads.includes(PULL))
  const SIGNED_IN: BrowserLogin = {
    state: "copied",
    cookies: [
      {
        host: "github.com",
        name: "user_session",
        value: "abc",
        path: "/",
        secure: true,
        httpOnly: true,
        expires: undefined,
        sameSite: "lax",
      },
    ],
  }

  beforeEach(() => {
    told.length = 0
    jar.clear()
  })

  it("copies before the first load, so the page arrives signed in", async () => {
    browser.read = SIGNED_IN
    const before = browser.copies
    show(PR, PULL)
    await vi.waitFor(() => expect(viewOf()).toBeDefined())
    expect(browser.copies).toBe(before + 1)
    expect(jar.get("user_session")).toBe("abc")
    expect(told.at(-1)).toStrictEqual({ state: "copied", browser: "Dia" })
  })

  it("copies again when the panel is opened again, and reloads only when the login moved", async () => {
    show(PR, PULL)
    await vi.waitFor(() => expect(viewOf()).toBeDefined())
    const view = viewOf()
    handlers.get("page:hide")?.({ sender: SENDER })
    jar.set("user_session", "abc")
    browser.read = SIGNED_IN
    const reloads = view?.reloads ?? 0
    show(PR, PULL)
    await vi.waitFor(() => expect(told.at(-1)).toStrictEqual({ state: "copied", browser: "Dia" }))
    expect(view?.reloads).toBe(reloads)
    handlers.get("page:hide")?.({ sender: SENDER })
    browser.read = { state: "signed-out" }
    show(PR, PULL)
    await vi.waitFor(() => expect(view?.reloads).toBe(reloads + 1))
    expect(told.at(-1)).toStrictEqual({ state: "browser-out", browser: "Dia" })
  })

  it("sends Continue with Google to the browser as GitHub's sign-in form, and says it is waiting", async () => {
    const GOOGLE = "https://accounts.google.com/o/oauth2"
    show(PR, PULL)
    await vi.waitFor(() => expect(viewOf()).toBeDefined())
    const redirect = (): void =>
      viewOf()?.on.get("will-redirect")?.({
        isMainFrame: true,
        url: GOOGLE,
        preventDefault: () => undefined,
      })
    redirect()
    expect(opened.at(-1)).toBe(GOOGLE)
    viewOf()?.loads.push("https://github.com/login")
    redirect()
    expect(opened.at(-1)).toBe(
      "https://github.com/login?return_to=%2Ftiniest-fox%2Forkestra-ts%2Fpull%2F200",
    )
    expect(told.at(-1)).toStrictEqual({ state: "waiting", browser: "Dia" })
  })
})

describe("when a sign-in in the browser is pending", () => {
  const PULL = "https://github.com/tiniest-fox/orkestra-ts/pull/300"
  const SIGNED_IN: BrowserLogin = {
    state: "copied",
    cookies: [
      {
        host: "github.com",
        name: "user_session",
        value: "fresh",
        path: "/",
        secure: true,
        httpOnly: true,
        expires: undefined,
        sameSite: "lax",
      },
    ],
  }
  /** A window of its own, shown the pull request, with the first copy settled. */
  const openedOn = async (read: BrowserLogin) => {
    const sender = {}
    const window = windowOf()
    windows.set(sender, window)
    browser.read = read
    told.length = 0
    handlers.get("page:show")?.({ sender }, JSON.stringify([sender, PULL]), PULL, BOX)
    await vi.waitFor(() => expect(told).toHaveLength(1))
    return { sender, window, view: views.at(-1) }
  }

  beforeEach(() => {
    jar.clear()
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("keeps saying waiting and copies again until the browser has written the login", async () => {
    const { window, view } = await openedOn({ state: "signed-out" })
    expect(told.at(-1)).toStrictEqual({ state: "signed-out", browser: "Dia" })

    // Back from the browser before it has committed the new cookie to disk.
    focused(window)
    await vi.waitFor(() => expect(told).toHaveLength(2))
    expect(told.at(-1)).toStrictEqual({ state: "waiting", browser: "Dia" })

    browser.read = SIGNED_IN
    await vi.advanceTimersByTimeAsync(5000)
    expect(told.at(-1)).toStrictEqual({ state: "copied", browser: "Dia" })
    expect(jar.get("user_session")).toBe("fresh")
    expect(view?.reloads).toBe(1)

    // The login arrived, so nothing copies again.
    const copies = browser.copies
    await vi.advanceTimersByTimeAsync(60_000)
    expect(browser.copies).toBe(copies)
  })

  it("says what it read once the wait runs out", async () => {
    const { sender } = await openedOn({ state: "signed-out" })
    handlers.get("page:sign-in")?.({ sender })
    expect(told.at(-1)).toStrictEqual({ state: "waiting", browser: "Dia" })
    handlers.get("page:copy-login")?.({ sender })
    await vi.advanceTimersByTimeAsync(55_000)
    expect(told.at(-1)).toStrictEqual({ state: "waiting", browser: "Dia" })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(told.at(-1)).toStrictEqual({ state: "signed-out", browser: "Dia" })
    const copies = browser.copies
    await vi.advanceTimersByTimeAsync(60_000)
    expect(browser.copies).toBe(copies)
  })
})

describe("when the window closes during a pending sign-in", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("schedules no retry from a copy that settles after it closed", async () => {
    const sender = {}
    const window = windowOf()
    windows.set(sender, window)
    browser.read = { state: "signed-out" }
    told.length = 0
    const PULL = "https://github.com/tiniest-fox/orkestra-ts/pull/302"
    handlers.get("page:show")?.({ sender }, PULL, PULL, BOX)
    await vi.waitFor(() => expect(told).toHaveLength(1))
    handlers.get("page:sign-in")?.({ sender })

    const { promise, resolve: release } = Promise.withResolvers<void>()
    gate.held = promise
    focused(window)
    for (const listener of window.closed) listener()
    windows.delete(sender)
    gate.held = undefined
    release()
    const copies = browser.copies
    const said = told.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(browser.copies).toBe(copies)
    expect(told).toHaveLength(said)
  })
})

describe("when macOS refused the keychain", () => {
  it("does not copy again as focus comes back from the prompt, but Try again does", async () => {
    const sender = {}
    const window = windowOf()
    windows.set(sender, window)
    browser.read = { state: "keychain" }
    told.length = 0
    const PULL = "https://github.com/tiniest-fox/orkestra-ts/pull/301"
    handlers.get("page:show")?.({ sender }, PULL, PULL, BOX)
    await vi.waitFor(() => expect(told.at(-1)).toStrictEqual({ state: "keychain", browser: "Dia" }))
    const copies = browser.copies

    focused(window)
    await Promise.resolve()
    expect(browser.copies).toBe(copies)

    handlers.get("page:copy-login")?.({ sender })
    await vi.waitFor(() => expect(browser.copies).toBe(copies + 1))
  })
})

describe("when the pane switches to another trak's pull request", () => {
  const FIRST = "https://github.com/tiniest-fox/orkestra-ts/pull/400"
  const SECOND = "https://github.com/tiniest-fox/orkestra-ts/pull/401"
  const viewOf = (): Made | undefined => views.find((v) => v.loads.includes(FIRST))

  afterEach(() => {
    gate.held = undefined
  })

  it("does not draw the previous trak's pull request while the next one's copy runs", async () => {
    show(JSON.stringify(["first", "pull-request", FIRST]), FIRST)
    await vi.waitFor(() => expect(viewOf()).toBeDefined())
    const view = viewOf()
    // The client unmounts the old trak's pane and mounts the new one's: hide, then show.
    handlers.get("page:hide")?.({ sender: SENDER })
    const held = Promise.withResolvers<void>()
    gate.held = held.promise
    show(JSON.stringify(["second", "pull-request", SECOND]), SECOND)
    // The copy before the second load is still reading the browser's store.
    expect({ visible: view?.visible, page: view?.loads.at(-1) }).not.toStrictEqual({
      visible: true,
      page: FIRST,
    })
    held.resolve()
    await vi.waitFor(() => expect(view?.loads.at(-1)).toBe(SECOND))
    await vi.waitFor(() => expect(view?.visible).toBe(true))
  })

  it("leaves the view hidden when the pane was hidden before the next page landed", async () => {
    const THIRD = "https://github.com/tiniest-fox/orkestra-ts/pull/402"
    const held = Promise.withResolvers<void>()
    gate.held = held.promise
    show(JSON.stringify(["third", "pull-request", THIRD]), THIRD)
    handlers.get("page:hide")?.({ sender: SENDER })
    held.resolve()
    const view = views.find((v) => v.partition === "persist:github")
    await vi.waitFor(() => expect(view?.loads.at(-1)).toBe(THIRD))
    // Past every step of the load's continuation, which runs on promises.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(view?.visible).toBe(false)
  })

  it("shows the trak switched back to, never the one passed through, on a switch there and back", async () => {
    const BACK = "https://github.com/tiniest-fox/orkestra-ts/pull/403"
    const THROUGH = "https://github.com/tiniest-fox/orkestra-ts/pull/404"
    show(JSON.stringify(["back", "pull-request", BACK]), BACK)
    const view = views.find((v) => v.partition === "persist:github")
    await vi.waitFor(() => expect(view?.loads.at(-1)).toBe(BACK))
    await vi.waitFor(() => expect(view?.visible).toBe(true))
    const held = Promise.withResolvers<void>()
    gate.held = held.promise
    handlers.get("page:hide")?.({ sender: SENDER })
    show(JSON.stringify(["through", "pull-request", THROUGH]), THROUGH)
    handlers.get("page:hide")?.({ sender: SENDER })
    show(JSON.stringify(["back", "pull-request", BACK]), BACK)
    expect(view?.visible).toBe(false)
    held.resolve()
    await vi.waitFor(() => expect(view?.visible).toBe(true))
    expect(view?.loads.at(-1)).toBe(BACK)
    expect(view?.loads).not.toContain(THROUGH)
  })
})

describe("when several projects share a window", () => {
  /** A project of its own, so nothing another test showed is in its views. */
  const project = () => {
    const sender = {}
    const window = windowOf()
    windows.set(sender, window)
    return { sender, window }
  }
  const made = (url: string): Made | undefined => views.find((v) => v.loads.includes(url))

  it("places a pane from the project's own corner, which is right of the rail", () => {
    const { sender, window } = project()
    window.at.origin = { x: 48, y: 0 }
    const url = "http://127.0.0.1:47301/"
    handlers.get("page:show")?.({ sender }, "run", url, BOX)
    expect(made(url)?.bounds).toStrictEqual({ ...BOX, x: BOX.x + 48 })
  })

  it("takes a project's page off screen when another tile is selected, and puts it back", async () => {
    const { sender, window } = project()
    const url = "http://127.0.0.1:47302/"
    handlers.get("page:show")?.({ sender }, "run", url, BOX)
    await vi.waitFor(() => expect(made(url)?.visible).toBe(true))

    window.at.hidden = true
    suspendPages(window)
    expect(made(url)?.visible).toBe(false)

    window.at.hidden = false
    resumePages(window)
    expect(made(url)?.visible).toBe(true)
    expect(made(url)?.loads).toStrictEqual([url])
  })

  it("holds a page asked for while the project is off screen until it is selected", async () => {
    const { sender, window } = project()
    window.at.hidden = true
    const url = "http://127.0.0.1:47303/"
    handlers.get("page:show")?.({ sender }, "run", url, BOX)
    expect(made(url)?.visible).toBe(false)

    window.at.hidden = false
    resumePages(window)
    await vi.waitFor(() => expect(made(url)?.visible).toBe(true))
  })

  it("leaves a page its own project hid off screen when the project comes back", () => {
    const { sender, window } = project()
    const url = "http://127.0.0.1:47304/"
    handlers.get("page:show")?.({ sender }, "run", url, BOX)
    handlers.get("page:hide")?.({ sender })
    suspendPages(window)
    resumePages(window)
    expect(made(url)?.visible).toBe(false)
  })
})
