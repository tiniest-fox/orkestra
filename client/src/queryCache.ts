/**
 * The cache vocabulary: what an entry is keyed by, and how often a busy one refreshes.
 * Two facts in one file because they have to agree — two hooks keying the same data
 * differently break invalidation *silently*.
 *
 * It held a third fact, `invalidateTrak`, which every acting hook's `onSuccess` called.
 * With seven acting hooks back it is still not here, because they do not all want the same
 * thing: `useCreateTrak` invalidates the list alone — the trak it made did not exist a
 * moment ago — where every other one invalidates both. Six out of seven agreeing is what a
 * helper would be extracted from, and the one that disagrees is the one it would make hard
 * to write correctly.
 *
 * Top-level rather than in a feature: both features key data here, and a
 * `traks-list/` importing a `trak-detail/` constant would be the first cross-feature
 * import. It is kind `pure` in `client-style`'s admission table — a `.ts` outside
 * `api/` that imports nothing at all.
 */

/**
 * The keys, as `client-style` fixes them. Literals at call sites are what drift;
 * this object is the only place any of them is spelled.
 *
 * They share no prefix, which is load-bearing rather than incidental:
 * `invalidateQueries` matches by key *prefix*, so a detail keyed `["traks", id]`
 * would make every list invalidation sweep every open detail as well.
 */
export const queryKeys = {
  traks: ["traks"] as const,
  trak: (id: string) => ["trak", id] as const,
  /**
   * Which agents a trak can be started with. The one key here that is not about a trak
   * at all — it is the library, read at boot and on a reload pressed in the project
   * menu, and never because anything happened to a trak. So nothing invalidates it and it does not poll:
   * an acting hook sweeping it would be sweeping a fact its action cannot alter.
   */
  agents: ["agents"] as const,
  /**
   * The models a step may run on, and the default — `models.yaml` as the engine loaded
   * it. The library's other half, on `agents`' terms exactly: read at boot and on a
   * reload, so nothing invalidates it and it does not poll.
   */
  models: ["models"] as const,
  /**
   * Whether this browser is in. The guard in front of the API answers it, and it is the
   * one key the app reads before it draws anything else — a page asked for with no
   * session is a page of refusals. Polled like everything the engine owns, because an
   * engine restart forgets every session and nothing else here would notice.
   */
  session: ["session"] as const,
  /**
   * Which client build the engine serves now — `client` on `/api/health`, for the page to
   * compare with its own. Polled slowly, and invalidated each time the stream connects.
   */
  build: ["build"] as const,
  /**
   * The project's name, from the checkout `/api/health` reports — read only where a
   * phone's header names it. An engine drives one checkout for its whole life, so nothing
   * invalidates it and it does not poll.
   */
  engine: ["engine"] as const,
  /**
   * Where a merge would put this trak's work — a third entry, and its own key rather than
   * a suffix on `trak`, for the prefix reason above: it is not part of the detail and an
   * ending must not sweep it away mid-press. It is also not the same *kind* of fact —
   * `into` describes the daemon's checkout, so it goes stale when somebody switches
   * branch over there rather than when anything happens to this trak.
   */
  mergePreview: (id: string) => ["merge-preview", id] as const,
  /**
   * Every slice of one trak's diff at once — the prefix, and the only invalidation this
   * family takes. A commit moves all three answers together, and nothing can move one of
   * them alone.
   */
  changesOf: (id: string) => ["changes", id] as const,
  /**
   * What one slice of a trak's work did to the files. Its own root for the prefix reason
   * above, and **the slice is part of the key**: a trak holds three of these at once and
   * they are three different answers, so keying them together would make the picker's last
   * press overwrite the one before it.
   *
   * Built from the prefix rather than spelled out, so the two cannot drift into a sweep
   * that matches nothing.
   */
  changes: (id: string, at: string) => [...queryKeys.changesOf(id), at] as const,
  /** One file of a slice, opened from collapsed — under the slice, so a commit sweeps it too. */
  changedFile: (id: string, at: string, path: string) =>
    [...queryKeys.changes(id, at), "file", path] as const,
  /**
   * What the forge says about this trak's branch. Its own key rather than a suffix on
   * `trak`, for `mergePreview`'s prefix reason and for the same second one: it describes
   * something outside this engine, so it goes stale when somebody pushes or reviews over
   * there rather than when anything happens to this trak — and an ending must not sweep it.
   *
   * Nothing invalidates it. No press here writes to the forge, so no action this client
   * takes can change the answer, and the poll is the whole of how it stays current.
   *
   * **It is one of the two keys the browser writes to storage**, and the only one whose key
   * survives a reload unchanged — it names a trak, where the listing below names a question
   * that moves. So a reloaded finished page has its last card in hand on the frame it
   * paints. `forgeMemory` holds the allow-list and the hour, and reads this root off here so
   * the two cannot drift.
   */
  pullRequest: (id: string) => ["pull-request", id] as const,
  /**
   * What the forge says about many branches at once — the list's read, and the only key
   * here that names no trak at all.
   *
   * **Its own root rather than a prefix of the one above**, even though the two ask one
   * service the same kind of question: `invalidateQueries` matches by prefix, so
   * `["pull-request"]` would sweep every open pane's answer as well, and the two are
   * different shapes fetched by different routes. Nothing invalidates either — no press
   * in this client writes to a forge, and the poll is the whole of how both stay current.
   *
   * **The branches are part of the key, and the caller owes them sorted.** They are the
   * question, so two different sets are two different answers — and a set that arrived in
   * a different order would be a new key, refetching on a render and making the poll
   * interval mean nothing.
   *
   * **Which is also why an answer restored from storage is not found by this key.** The
   * question moves whenever a trak finishes or merges, so the reload where the last answer
   * matters most is the one where the key has changed under it. The persist plugin writes
   * this key like any other; what reads it back is `forgeMemory`, by branch and across
   * every listing in the cache at once.
   */
  pullRequests: (branches: readonly string[]) => ["pull-requests", branches] as const,
  /**
   * What `deploy.sh` says about this trak's merge commit. Its own root rather than a
   * suffix on `trak`, for `pullRequest`'s two reasons: an ending must not sweep it, and it
   * describes a world outside this engine — a deploy goes live without anything happening
   * to the trak. Nothing invalidates it; the poll is the whole of how it stays current.
   *
   * Not written to storage, unlike the two forge keys: a remembered deploy status is a
   * claim about a world that moved while nobody was looking, and the page asks again the
   * moment it opens.
   */
  deploy: (id: string) => ["deploy", id] as const,
  /**
   * The hosted processes the project declares, at one trak's checkout — the daemon's
   * memory, like a check's run. Its own root rather than a suffix on `trak`, for
   * `mergePreview`'s prefix reason: a process never moves a trak, so no press on the trak
   * changes it and an ending must not sweep it. The process family of frames patches it,
   * and a press on a process invalidates it alone.
   */
  processes: (id: string) => ["processes", id] as const,
  /**
   * The same on the project checkout, which no trak owns. Its own root, so a sweep of
   * every trak's processes by their prefix never reaches it.
   */
  projectProcesses: ["project-processes"] as const,
  /**
   * One view an MCP tool's call left on a trak, whole — its HTML and the call's
   * arguments and result. Its own root for `mergePreview`'s prefix reason, and the call
   * is part of the key because a trak holds a view per call. Written once by the
   * engine, when the call completed, so nothing invalidates it and it does not poll.
   */
  view: (id: string, call: string) => ["view", id, call] as const,
  /**
   * The terminals and editors installed on the engine's machine, and the one of each a
   * press on the trak header's controls opens. A fact about the machine, not about any
   * trak, so it shares no prefix with the keys above and no ending sweeps it. One key
   * for both kinds, because one scan answers both and a pick of either re-asks the whole.
   *
   * **Not polled, and not for `agents`' reason** — the answer *can* move while the
   * engine is up (an app installed, a pick made in another tab). The route behind it
   * runs the scan per request — a `plutil` per installed application — so a poll would
   * pay that every interval for a change that happens a few times a year. A fresh mount
   * re-asks, and the pick's own mutation invalidates it, which is the one write this
   * client can make to the answer.
   */
  openers: ["openers"] as const,
  /**
   * The desktop shell's recent projects, read by its launch window and by nothing the
   * engine serves. A fact about the machine, like `openers`; not polled, because the
   * shell pushes every change over the bridge and the page writes it straight in.
   */
  recents: ["recents"] as const,
  /**
   * One desktop window's rail — its projects, where each one's engine stands, and which
   * the pane shows — or a host's, off its rail stream. Pushed whole like `recents`, and not
   * polled for the same reason; read by `rail.html` and by nothing the engine serves.
   */
  rail: ["rail"] as const,
  /**
   * Every GitHub repo a host's stored token reaches — what the rail's search offers. Asked
   * each time the search opens and never polled: each answer is a `gh` call that pages
   * through the whole list, and nothing on the page changes it. The team Add is for is in
   * the key, since each team's installations reach different repos; `""` is the host's own.
   */
  hostRepos: (team: string | undefined) => ["host-repos", team ?? ""] as const,
  /**
   * A host's tokens, its named secrets and each project's own — what Settings draws.
   * Asked while it is open, and polled then, since
   * `pnpm host secrets` can change it from a terminal; a save invalidates it.
   */
  hostSettings: ["host-settings"] as const,
  /**
   * A host's paired devices — the settings pane's other half. Asked while it is open, and
   * polled then, because a device's last-seen time moves on every request it makes.
   */
  hostDevices: ["host-devices"] as const,
  /**
   * The Claude credentials of the user this device acts as — the settings pane's first
   * group. Asked and polled while the pane is open, since an engine marks one refused and
   * `pnpm host secrets --user` changes them with nobody pressing anything here; a save
   * writes the answer rather than invalidating.
   */
  hostCredential: ["host-credential"] as const,
  /**
   * The role the asking device acts with on a host. Asked once as the page loads: no route
   * changes a user's role, and removing one revokes the device asking.
   */
  hostMe: ["host-me"] as const,
  /**
   * Whether a host offers a GitHub sign-in on its pairing page. Asked once as the page loads:
   * storing the App's client while it is open is answered by a reload.
   */
  hostSignIn: ["host-sign-in"] as const,
  /**
   * One project's webhook callers on a host. Asked while its Project settings are open, and
   * polled then, since a caller's last request moves with nobody pressing anything here; an
   * add or a revoke invalidates it.
   */
  hostCallers: (project: string) => ["host-callers", project] as const,
  /**
   * A host's MCP sign-ins and its callback address: the host's own for Settings, `""`,
   * or one project's — its own and the host's — for its Project settings. Asked while either
   * is open, and polled then, since a refresh the provider refuses turns one to
   * `needs-sign-in`.
   */
  hostConnections: (project: string | undefined) => ["host-connections", project ?? ""] as const,
  /**
   * Which sign-in one project's MCP server names are bound to on a host. Asked and polled
   * while its Project settings are open, beside the sign-ins; a bind or an unbind
   * invalidates it.
   */
  hostBindings: (project: string) => ["host-bindings", project] as const,
  /**
   * Every team on a host, its members and each App installation's team — Settings'
   * Teams group, a host admin's. Asked and polled while the pane is open; a create or an
   * assignment invalidates it.
   */
  hostTeams: ["host-teams"] as const,
  /**
   * One team's settings — its members, named secrets and installations — what its settings pane
   * draws. Asked and polled while that pane is open; a member or secret press invalidates it.
   */
  hostTeamSettings: (team: string) => ["host-team-settings", team] as const,
  /**
   * One project's settings on a host — its tokens, its own secrets and what it runs with
   * besides — what Project settings draws. Asked and polled while that pane is open; a
   * secret's save invalidates it.
   */
  hostProjectSettings: (project: string) => ["host-project-settings", project] as const,
  /**
   * The project checkout's branch, its upstream and how far apart they are — the git
   * bar's read. A fact about the engine's own checkout rather than any trak, so it shares
   * no prefix with the keys above and no ending sweeps it. Polled like everything the
   * engine owns, and the poll is what drives the engine's automatic fetch. A press on the
   * bar answers with the same shape and writes it here.
   */
  git: ["git"] as const,
  /**
   * Each CLI's plan usage, as the engine last read it — daemon memory, which a
   * running Claude turn reports into. Polled, though a read costs the engine nothing, and patched whole
   * by every `Usage` frame. No press changes it.
   */
  usage: ["usage"] as const,
  /**
   * Every goal the project started — the traks list's banners read the ones not dismissed.
   * Its own root, and no prefix of `goal`'s: the list and a goal's screen are two routes.
   */
  goals: ["goals"] as const,
  /**
   * One goal whole: the goal, its log and its composer's transcript. Invalidated by every
   * `Goal` frame rather than patched — the frame says only that the goal moved — and by
   * every press on the goal.
   */
  goal: (id: string) => ["goal", id] as const,
  /**
   * Every file git sees in the project checkout — the file browser's tree, and what the
   * palette matches a path against. A fact about the engine's own checkout, like `git`, so
   * it shares no prefix with any trak's key. Polled while something draws it, which is
   * what keeps an untracked file just written from being missing.
   */
  files: ["files"] as const,
  /**
   * One file of that checkout as the viewer draws it. Under `files` because it is the same
   * checkout; polled while open, so an edit made on disk reaches the viewer.
   */
  fileContent: (path: string) => ["files", "content", path] as const,
  /** The lines of those files holding `q`. The query is the question, so it is the key. */
  fileSearch: (q: string) => ["files", "search", q] as const,
  /**
   * The put-away traks matching `q`, off the engine's archived set. Its own root rather
   * than under `traks`: an acting hook's sweep of the list must not reach it, and nothing a
   * press does moves a name already in the archive.
   */
  archived: (q: string) => ["archived", q] as const,
}

/**
 * How often a mounted, visible query re-asks. Unconditional — `useTraks` says why a
 * predicate over "is anything happening" was the wrong shape.
 *
 * **A backstop now, not the transport.** What keeps a screen current is the engine's
 * stream: every append arrives as a frame and either patches the trak or invalidates
 * it. This is what covers a connection that dropped and has not noticed, or a browser
 * that suspended the tab. So it is slow on purpose, and it is *not* deleted: a UI whose
 * only source of truth is a socket is a UI that goes quietly stale when the socket does.
 *
 * **It does not fire while frames arrive.** Writing a frame into the cache is a query
 * update, and `QueryObserver` re-arms the interval on every one — a busy turn writes a
 * transcript line about a second apart, so the interval restarts before it can reach
 * its end. That is fine and not to be fixed: a lost frame is caught by `seq` and
 * refetched at once, and a poll that did fire would re-read a long trak's log and
 * transcript, a megabyte or more, every interval throughout the turn. What it means
 * for a frame is that **nothing a screen draws may wait for the poll** — a field the
 * engine derives rides the frame, or it is stale until the drawer is closed.
 *
 * Still a number rather than a predicate, and still unconditional, for the reason
 * `useTraks` gives: a query that decides whether to ask needs a fetch to learn that
 * fetching was warranted.
 */
export const POLL_MS = 15_000
