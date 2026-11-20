`pnpm --filter @orkestra/desktop start [<repo>]` runs the shell from this checkout —
it needs everything before the packaging step built — puts back the windows `windows.json` records, or with none shows the launch window (the
recent projects, one press each, and a button for the folder picker). A window holds a
rail of projects and starts one `dist/serve.js` per project on Electron's own Node the
first time its tile is selected — or attaches to an engine already serving it — and draws
that engine's own URL in a view right of the rail, kept alive while another tile is
selected. The shell loads two pages off disk: `client/launcher.html` for the launch window
and `client/rail.html` for every other window's own page, both built with the client and
copied beside the engine, so they draw with the client's own components and tokens. A
project's view is the client, so the presses `references/commands.md` lists as spending spend here too. Each engine's `/api/stream` is watched for a
trak parking, finishing, failing or giving up on its condition, and each becomes a notification that opens the
trak, and that the trak opening in its view closes. Recent projects and the saved windows live in `~/Library/Application Support/Orkestra/`.

**Starting, attaching to, stopping and watching an engine is `src/supervisor/`, which a
host process shares.** `main.ts` hands `startEngine` the two parts that are Electron's —
`process.execPath` under `ELECTRON_RUN_AS_NODE`, and the login shell's `PATH` — so a
change to supervision that needs neither goes in `src/supervisor/`, and nothing that
needs Electron goes there.

A window's rail page has `rail-preload.ts`, which puts `window.orkestraRail` — the
`RailBridge` in `shared/src/rail.ts` — and the launch window's `window.orkestra` on it.
That page is the shell's own and is the only one that can add, start or remove a project.
**A host serves the same page at its root with no bridge on it**, so a press or a field
added to `RailBridge` or `LauncherBridge` owes an answer through `HostTransport` in `client/src/api/rail.ts`, which a host provides, or
none on a host's `readOnly` list — `client-style` has the seam.

**A window holds several projects, and each rule below is one a change to `main.ts` has to
keep:**

- **What belongs to a project is kept on the project, never on the window** — its engine,
  its view, its stream watch, its page views. A native view is placed from the pane's
  corner rather than the window's, and the shell takes it off screen when another tile is
  selected, because the project's page cannot know one was (`suspendPages`,
  `resumePages`).
- **A project leaves through `closeProject` and nowhere else.** An engine being started is
  in `opening`, a started one is on its project, and one being stopped is in `stopping`;
  the quit waits on all three, so an engine in none of them outlives the app with no
  window.
- **Only an engine this app started is stopped, and only that one is asked about** —
  `started` filters both. An attached engine keeps running, so a question about its turn
  warns of a death that does not happen.
- **Every way to open a project goes through `openProject`.** Its routing is what keeps a
  project in one window; a second tile for one project is two views on one engine.
- **`windows.json` is rewritten on every change to a rail, and never once a quit is past
  its question** — a write after that records the windows as they close, and the next
  launch puts none back.
- **The rail page is told its state whole, and a press on it returns nothing.** A project
  with no view leaves the pane to that page, so an engine state the page does not draw is
  an empty pane.

**Starting the shell from a worktree acts on the person's own windows.** The run from a
checkout and the installed app read the same `windows.json`, and nothing keeps two shells
apart: a launch puts back every window the file records and starts each one's selected
project, and closing one of those windows takes it out of the file.

A project's view has one preload, `page-preload.ts`, which puts `window.orkestraPage` —
the `PageBridge` in `shared/src/page.ts` — on the engine's pages. **Those pages render
agent-written prose, so anything added to that bridge is reachable by it**: it stays
one-way sends about the native views plus one listener for the pull request view's login
state — a word and a browser's name — and the main process checks every argument again. A process's page view loads only loopback `http:` addresses; a second view, in a
persisted session of its own so the GitHub login never reaches a page an agent's code
serves, loads only an `https://github.com` pull request, and the address is what picks
the view. Each keeps its own navigation guard, and reloads when the
client's run key changes, never on the address alone — a restart is handed the same port.
A view handed a new run stays hidden until that run's page has loaded, since until then it
holds the previous trak's page; the client draws a loading state under it.
The pull request view's guard keeps it on github.com. Google refuses to sign in an
embedded browser, so the view never signs in itself: each time it is shown, and each time
the window comes back to the front, the shell copies the GitHub cookies out of the default
browser — a Chromium one only — reading its key from the keychain, which macOS asks about
once. Continue with Google opens GitHub's sign-in form in that browser instead.
