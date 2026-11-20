import { defineConfig } from "vitest/config"

// Separate from the root `vitest.config.ts`, which scopes itself to `src/**` and
// `test/**` and so never sees this package. That is why the root `verify` chains
// `pnpm --filter @orkestra/client verify` rather than widening the root `test`.
export default defineConfig({
  test: {
    // Every run's temp folders under one directory of its own, removed with the run.
    globalSetup: ["../test/support/run-tmpdir.ts"],
    // happy-dom for everything, and `api/transport.test.ts` opts back out with a
    // `@vitest-environment node` docblock. That direction is deliberate: the DOM is
    // what all but one file here needs, and the transport tier is documented as the
    // one that touches no DOM (`client-style`, Tests). It also supplies the `window`
    // and the `location` two tests used to stub for themselves.
    //
    // happy-dom rather than jsdom for cost. Each isolated file runs in a fresh worker, so
    // each imports its DOM again: jsdom took about 330 ms of every file, against about
    // 140 ms here, and its renders ran about a third slower. Neither lays anything out or
    // paints a canvas, so what a browser does with layout is tier 3's either way.
    environment: "happy-dom",
    // Node 25 and later define a global `localStorage` and `sessionStorage` of their own,
    // `undefined` without `--localstorage-file`. Vitest installs a window property on the
    // global only where the global lacks it, so happy-dom's storage never arrived:
    // `localStorage.clear()` threw, and every component reading storage fell into its
    // error boundary. That passed on Node 24 and failed on the 26 `mise.toml` pins.
    // Turning Node's own Web Storage off leaves happy-dom's, as a browser would have.
    execArgv: ["--no-experimental-webstorage"],
    // **No test may open a connection MSW does not answer.** happy-dom behaves like a
    // browser here and jsdom did not: it follows a clicked link, opens a `_blank` window,
    // loads every iframe's `src`, and fetches a `<script src>` or a stylesheet `<link>`.
    // Each of those went to the real network — `localhost:5173` is the person's own
    // `pnpm ui` — or to MSW, which refused it without failing the test, so a stray request
    // a test really made stopped standing out.
    environmentOptions: {
      happyDOM: {
        settings: {
          // A script or a stylesheet a component puts in the document is not fetched, and
          // reads as loaded, as it would in a browser where the file exists.
          disableJavaScriptFileLoading: true,
          disableCSSFileLoading: true,
          handleDisabledFileLoadingAsSuccess: true,
          navigation: {
            // A clicked link or `location.assign` changes the address and loads nothing.
            disableMainFrameNavigation: true,
            // An iframe takes its `src` as its address and loads nothing; tier 2 asserts a
            // frame's attributes, and what it loads is tier 3's. Not
            // `disableIframePageLoading`, which does the same but writes an error per frame
            // to stderr through a console vitest cannot filter.
            disableChildFrameNavigation: true,
            // A `target="_blank"` link opens no window.
            disableChildPageNavigation: true,
          },
        },
      },
    },
    // Past the hook, one import, and it is why an assertion here can say `toBeDisabled()`
    // — see `test-setup.ts`.
    setupFiles: ["./test-setup.ts"],
    // `.tsx` as well as `.ts`, or an RTL page test silently does not run.
    include: ["src/**/*.test.{ts,tsx}"],
    // Vitest's default is to replace every CSS file with an empty string, and `?raw`
    // is not an exception — `format/tone.test.ts` asserts that `styles.css` defines the
    // tokens `toneClass` names, and it read `""` and passed on nothing until this was
    // set. It now also injects a stylesheet into the test document, which is what an
    // RTL test wants anyway; nothing asserts on computed style, because Tailwind's
    // utilities are built by the Vite plugin and a test runner does not run it.
    css: true,
    // Above the `findBy*` wait `test-setup.ts` sets, or the test is cut off before the
    // wait it is waiting on can report what it did not find — a contention failure
    // wearing a timeout's message instead of the missing element's.
    testTimeout: 15_000,
  },
})
