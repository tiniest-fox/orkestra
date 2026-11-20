import { createHash } from "node:crypto"
import { defineConfig } from "@playwright/test"

/**
 * Tier 3: the app as it is served, in a browser that is really running it.
 *
 * **This tier exists because of what the other two cannot reach.** A page test builds
 * its own router, a hook test hands the hook a fake stream, and the transport test
 * never opens a socket — so nothing below this ever sees the Vite proxy, a real
 * `EventSource`, or `App` composed the way it ships. The bug that put this here was a
 * `Link` outside the router provider: every unit test passed and the first thing a
 * browser did was render a blank page.
 *
 * **It is read-only, and that is a rule rather than a coincidence.** The engine it boots
 * is the real one against this checkout's real `.orkestra/.database/`, so a spec that
 * clicked *Start trak* would run a composer and bill for it. Nothing here presses a
 * control that spends — see `e2e/README.md`.
 *
 * **The pair is derived from the checkout, never pinned.** One machine runs a person's
 * `pnpm ui` and several traks at once, so two worktrees in their Playwright phase together
 * is the ordinary case rather than a race — and a constant pair means the second to bind
 * dies on `is already used`. Same path, same pair, every run; two worktrees, two pairs.
 *
 * **47000–48999, which must stay disjoint from `basePort`'s window and below macOS's
 * ephemeral range.** `app/discovery.ts` draws 8000 pairs from 31000, so that window is
 * 31000–46999: a pair inside it can be the one somebody's `pnpm ui` is already serving,
 * and nothing checks. It is the same technique as `basePort` rather than a call to it — a
 * config in `client/` that imported `src/app/discovery.js` would pull the engine's module
 * graph, `effect` included, into the client package's own toolchain. Staying disjoint is
 * the only thing the copy has to keep true.
 *
 * **`reuseExistingServer` stays `false`.** Setting it is what the error message suggests
 * and it is the wrong fix: a run that attached to whatever was already listening would
 * test another checkout's build and pass.
 *
 * **Two projects, split by file.** `chromium` runs `app.spec.ts` at Playwright's default
 * desktop viewport; `phone` runs `phone.spec.ts` at 375×667 — the narrowest device in
 * scope — with `hasTouch` and `isMobile`, which is what makes Chromium answer
 * `(pointer: coarse)` and so selects every touch branch the app has. The phone specs are
 * the only standing check that can *measure* the phone layout: happy-dom loads no stylesheet
 * and reports every box as 0, so the 640px seam, the 44px touch floor and the safe-area
 * tokens are held nowhere else. Each project ignores the other's file because the desktop
 * specs assume a desktop layout and vice versa — one suite run at both widths would
 * double the wall clock to assert half-truths.
 *
 * **What only a host's build draws is not here.** This config serves the public client,
 * whose slots draw nothing.
 */
const FIRST_E2E_PORT = 47_000
const E2E_PAIRS = 1_000
/** `process.cwd()` under `pnpm --filter @orkestra/client e2e` is this package, so it is
 *  the worktree's own path and a second checkout is a different one. */
const base =
  FIRST_E2E_PORT +
  (createHash("sha1").update(process.cwd()).digest().readUInt32BE(0) % E2E_PAIRS) * 2
const API_PORT = base
const CLIENT_PORT = base + 1

/** The narrowest device in scope, with the touch that makes Chromium answer `(pointer:
 *  coarse)`. A host's config may run its phone spec under the same. */
export const PHONE = {
  browserName: "chromium",
  viewport: { width: 375, height: 667 },
  hasTouch: true,
  isMobile: true,
} as const

/**
 * Both halves, booted together and ready once the engine answers through Vite's proxy.
 * A host's config that boots its own halves the same way, after this config's run has
 * ended, shares the checkout's pair and never one engine.
 */
export const webServer = {
  // `ui:both` rather than the two halves separately, so the proxy under test is the
  // one that ships — `-k` also means neither half can be left running.
  command: "pnpm ui:both",
  // Ready means the engine answers through Vite's proxy, not that Vite serves `/`. Vite
  // serves the root before the engine binds its port, and a page loaded in that gap
  // gets 502 from the proxy on `/api/session` — the first test failed on that console
  // error. `/api/health` is the one route the guard leaves open, and Playwright reads
  // the proxy's 502 as not ready yet, so this waits for Vite, its proxy and the engine together.
  url: `http://127.0.0.1:${String(CLIENT_PORT)}/api/health`,
  reuseExistingServer: false,
  timeout: 60_000,
  cwd: "..",
  // Both streams reach the test output, prefixed `[WebServer]`. Playwright drops stdout
  // by default, and `concurrently` prints why either half exited there — so a server that
  // died mid-run left only `ERR_CONNECTION_REFUSED` on every test after it.
  stdout: "pipe",
  stderr: "pipe",
  env: {
    ORKESTRA_API_PORT: String(API_PORT),
    ORKESTRA_CLIENT_PORT: String(CLIENT_PORT),
  },
} as const

export default defineConfig({
  testDir: "./e2e",
  // One worker: the specs share one engine and one database, and the whole point of
  // this tier is that it is the real thing rather than an isolated copy.
  workers: 1,
  forbidOnly: true,
  // On CI the HTML report is written too, for the workflow to upload when the tier fails.
  reporter: process.env["CI"] === undefined ? "list" : [["dot"], ["html", { open: "never" }]],
  use: { baseURL: `http://127.0.0.1:${String(CLIENT_PORT)}` },
  projects: [
    { name: "chromium", use: { browserName: "chromium" }, testIgnore: /phone\.spec\.ts/ },
    { name: "phone", use: PHONE, testMatch: /phone\.spec\.ts/ },
  ],
  webServer,
})
