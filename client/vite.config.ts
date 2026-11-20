import { createHash } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { defineConfig, loadEnv, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// Both ports come from the environment, and `pnpm ui` is what puts them there: it derives
// a pair from the checkout's path and verifies both are free before it spawns anything, so
// the engine and this proxy agree on the API's number without either side owning a fixed
// one. The defaults below are the standalone pair — `pnpm serve` in one terminal, `pnpm
// client` in another.
//
// **Read them through `loadEnv`, not `process.env`.** `tsconfig.json` omits node's
// types deliberately — rule 4 there — so a bare `process.env` in this file would not
// compile, and that rule is worth more than the characters it costs: it is what stops
// one landing in browser code. `loadEnv` is Vite's own typed reader, and its prefix
// argument is a filter, so nothing unprefixed in the environment is visible here.
//
// Both are chosen before this file sees them, because **`port: 0` does not work in
// Vite**: it resolves a falsy port as "unset" and falls back to 5173 (`resolveServerUrls`
// in vite's `chunks/node.js`), which is the opposite of picking a free one.
const ports = (mode: string) => {
  const env = loadEnv(mode, ".", "ORKESTRA_")
  const client = env["ORKESTRA_CLIENT_PORT"]
  return {
    api: env["ORKESTRA_API_PORT"] ?? "3001",
    // Vite walks up from a taken port, so a stale dev server costs a number, not a
    // boot — which is the backstop under `pnpm ui`'s probe and the whole story for
    // the 5173 default.
    client: client === undefined ? 5173 : Number(client),
  }
}

// One id per bundle, compiled into the page and written beside it, so a page can ask the
// engine which build it serves now and compare (`features/new-build/`). The engine reads
// `build.json` per request (`bundleId` in `src/app/client-bundle.ts`).
//
// **The id is the bundle's own hash, not a random one.** The same sources build the same
// bytes, so a rebuild that changed nothing leaves `dist/` as it was: a page is not offered
// a reload into the code it is already running, and a test that reads `dist/` is skipped
// on its print rather than re-run after every build. The page's code holds the id, so the
// hash is taken with a placeholder of the same length in its place, and then swapped in.
//
// **Written after every other file.** `vite build` empties `dist/` first, so a reload
// mid-build is a 503; an id written ahead of `index.html` would offer a reload into it.
// `writeBundle` runs once the output is on disk, and only when the build succeeded.
//
// None under the dev server: the page has no id, so it never checks — Vite reloads that
// page by itself, and `dist/`'s id says nothing about the code it shows.
const PLACEHOLDER = "ORKESTRA_BUILD_ID_PLACEHOLDER_XX"

const stampBuild = (): Plugin => {
  let id = ""
  return {
    name: "orkestra-build-id",
    apply: "build",
    config: () => ({ define: { "import.meta.env.VITE_BUILD_ID": JSON.stringify(PLACEHOLDER) } }),
    generateBundle: (_, bundle) => {
      const hash = createHash("sha256")
      for (const name of Object.keys(bundle).toSorted()) {
        const output = bundle[name]
        if (output === undefined) continue
        hash.update(name).update(output.type === "chunk" ? output.code : output.source)
      }
      id = hash.digest("hex").slice(0, PLACEHOLDER.length)
      for (const output of Object.values(bundle))
        if (output.type === "chunk") output.code = output.code.replaceAll(PLACEHOLDER, id)
    },
    writeBundle: async ({ dir }) => {
      if (dir === undefined) return
      await writeFile(join(dir, "build.json"), JSON.stringify({ id }))
    },
  }
}

export default defineConfig(({ mode }) => {
  const port = ports(mode)
  return {
    plugins: [react(), tailwindcss(), stampBuild()],
    // Every URL Vite writes is relative, in every page out of one build — the app, the
    // desktop shell's launch window and rail, and in a host's build any page of its own. Electron loads the shell's two off disk, `file://`, where an
    // absolute `/assets/…` names the filesystem root. The app is served under whatever
    // prefix a host puts it at, and learns it from the `<base>` in `index.html`
    // (`src/base.ts`): the URLs in the page resolve against that tag rather than against
    // the route, so `/traks/<id>` still finds `assets/`, and a chunk or a stylesheet
    // resolves against the file that names it. One bundle serves any prefix.
    base: "./",
    build: {
      rollupOptions: {
        input: {
          index: "index.html",
          launcher: "launcher.html",
          rail: "rail.html",
        },
      },
      // Raised past one 1,334.6 kB chunk — React, TanStack Query + Router, `effect`'s
      // Schema runtime (the seam imports it as a value on purpose), `react-markdown` with
      // the unified/micromark tree under it, and the whole `lucide` icon set. `pnpm verify`
      // is required to be silent, and this default is an advisory nobody can act on without
      // a per-module measurement.
      //
      // **It is a tripwire, and it has fired eight times.** It stood at 600, then at 750
      // for `react-markdown` and the unified/micromark tree. The second firing was **not a
      // dependency**: the drawer's ending menu added ~3 kB of ordinary components and
      // crossed 750, which was the news rather than the 3 kB.
      //
      // **The third is a choice, and recording it is the point of this comment.** An agent
      // file names its own glyph, so `AgentGrid` resolves an icon from a string that only
      // exists at runtime — nothing can be tree-shaken against that, and the barrel costs
      // ~497 kB raw / ~127 kB gzip. Measured when this UI was only ever served from
      // `127.0.0.1`, where transfer is free and the only real cost is parsing an inert
      // record once. The tripwire is the thing that disagrees, and it was overruled
      // knowingly rather than quietly.
      //
      // **That ground has moved.** `src/app/client-bundle.ts` serves this bundle from
      // the engine at `/`, so a phone or a tunnel now pays for the barrel over a real
      // link. Nothing here changes on that alone — the raises below are still the
      // accretion — but the free-transfer premise the third firing was overruled on no
      // longer holds for every reader of the bundle.
      //
      // **The fourth is the second one again, and that is what it says.** The drawer's
      // Changes surface added ~11.6 kB raw / ~3.8 kB gzip of ordinary components and
      // crossed 1310 — measured at 1,308.98 kB before it and 1,320.60 after. **No
      // dependency is in that number.** It arrived with a syntax highlighter, and shiki's
      // core, its theme and its sixteen grammars are every one of them a chunk of their
      // own, reached by `import()` in `useHighlight` and fetched when a diff with that
      // language is on screen. Two firings out of four are now the entry chunk accreting
      // application code at a few kB a feature, which is the reading, not the raise.
      //
      // **The fifth fired on a merge, and neither side of it fired alone.** The finished
      // pane's pull-request half added ~14 kB raw of ordinary components — measured at
      // 1,320.60 before and 1,334.61 after — and **no dependency is in that number**
      // either. It never touched this limit: it was built and verified against 1310, was
      // silent there, and crossed 1330 only once the Changes surface's raise and its own
      // code were on one branch. So three firings out of five are now the accretion, and
      // the thing this one adds is that no single change has to be the culprit — two that
      // each cleared their own limit are enough.
      //
      // **The sixth is the fifth again: it fired on merges, and no branch fired alone.**
      // The branch that found it — the forge hold, ~1.45 kB of ordinary components,
      // measured at 1,350.16 kB before and 1,351.61 after — was over the limit before its
      // own change was on it: the merges since the last raise had already crossed 1340,
      // each silent against the limit it was built under. **No dependency is in that
      // number.** Four firings out of six are now the accretion.
      //
      // **The seventh is the sixth again.** The notification offer — the band, its hook
      // and the two push calls at the seam, ~2 kB of ordinary components — measured at
      // 1,358.72 kB before it and 1,360.84 after, and the branch was within 1.3 kB of
      // the limit before its own change was on it. **No dependency is in that number**:
      // `web-push` is the engine's, and the service worker and manifest ship beside the
      // chunk, not in it. Five firings out of seven are now the accretion.
      //
      // **The eighth is the fifth and sixth again, and this time all three branches were
      // silent.** The phone work landed as three pieces built apart — the phone shell, the
      // diff view's stack layout, and the notification offer that set 1370 — and each
      // measured only its own additions against the limit it was built under. On one
      // branch they are 1,371.64 kB against `main`'s 1,358.78: ~12.9 kB of ordinary
      // components, and **no dependency is in that number** — `web-push` is the engine's,
      // and `sw.js`, the manifest and the icons ship beside the chunk rather than in it.
      // Six firings out of eight are now the accretion, and the raise before this one is
      // the clearest case yet of a branch's own measurement not being the tree's.
      //
      // **The ninth is the seventh again.** The run-mode picker on the trak screen — the
      // readout and its panel, the piece's band, the held band, a `Switch`, two hooks at
      // the seam and the mode vocabulary moved to `format/` — measured at 1,384.34 kB
      // against a tree that cleared 1380 the turn before, so ~4 kB of ordinary components.
      // **No dependency is in that number**: three more lucide glyphs, tree-shaken in.
      // Seven firings out of nine are now the accretion.
      //
      // **The tenth is the eighth again: the tree was over before the change was on it.**
      // Background work's live strip, its stop press and the count on three position
      // surfaces — ~4.4 kB of ordinary components — measured at 1,394.05 kB before and
      // 1,398.40 after, and 1,394.05 is already past the 1390 the ninth set: the step
      // before this one added its job cards against a limit it never saw fire. **No
      // dependency is in that number**: one more lucide glyph, tree-shaken in. Eight
      // firings out of ten are now the accretion.
      //
      // **The eleventh is neither side's change: it is the two of them together.** Merging
      // the destination in brought the continues mark and its notice onto this branch, and
      // 1,398.40 became 1,401.37 — each half under the 1400 the tenth set, the sum over it.
      // **No dependency is in that number**: one more lucide glyph, tree-shaken in. Nine
      // firings out of eleven are now the accretion.
      //
      // **The twelfth is the ninth again.** The two gate controls — the cancel press in the
      // check console's band, the skip row and its plate in the run-mode panel, the notice
      // a skipped step's card carries, and two hooks at the seam — measured at 1,410.66 kB
      // against the 1,401.37 the eleventh recorded, so ~9.3 kB of ordinary components. **No
      // dependency is in that number**: one more lucide glyph, tree-shaken in. Ten firings
      // out of twelve are now the accretion.
      //
      // So the limit moves to the next number rather than a comfortable one, and it still
      // fires soon. Route-level splitting remains the only answer left for the ~800 kB
      // underneath the barrel, which is that accretion and is not what any of these raises
      // were for.
      chunkSizeWarningLimit: 1420,
    },
    server: {
      // Loopback, explicitly. Vite's default is already localhost, but the dev server
      // proxies to an API with two endpoints that spawn a real `claude`, so "the default
      // is probably fine" is not the standard to hold this to. The engine widens with
      // `--host`, and only behind the passphrase its guard checks (`src/app/guard.ts`);
      // this server has no guard of its own, so it stays here — a phone gets the built
      // client from the engine, never from this.
      host: "127.0.0.1",
      // Under `pnpm ui` this is the checkout's own port, the same one every boot, so it
      // is worth bookmarking. Nothing has to agree with it: the
      // browser learns the origin from the URL you open, and every fetch the page makes
      // is same-origin through the proxy below.
      port: port.client,
      // So `pnpm serve` and `pnpm --filter @orkestra/client dev` work together: the
      // client always calls a same-origin `/api/...`, which means `api/http.ts` needs
      // no base-URL branch, and no CORS headers are needed on the engine.
      proxy: { "/api": { target: `http://localhost:${port.api}`, changeOrigin: true } },
    },
  }
})
