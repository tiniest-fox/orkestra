---
name: client-style
description: Where code goes in client/, the transport seam, component and hook rules, query keys, the rules for a button that spends money, the phone breakpoint and what holds it, and the client-specific lint relaxations. Read before creating any file under client/, before adding a feature directory, before touching a transport file under api/ or an action hook, before adding a field or a frame to the wire contract under shared/src/dto/, before laying out or restyling a screen, before making a proof of one, and before reviewing a client diff.
---

# `client/` — the read-and-act UI

`client/` and `shared/` are pnpm workspace packages outside `src/`, and **both are
inside the gates**. Wiring a package into the gates is `new-module`'s checklist; the part
specific to here:

**`client/` is linted by a *second* oxlint invocation, not an appended path.** The first
passes `--tsconfig tsconfig.json`, which overrides tsconfig discovery for every file it
lints and would hold browser code to the engine's config, with no `DOM`. `fmt:check` does
append the path; `check`, `test` and `build` come from `client`'s own `verify`, chained
from the root's, because Vite and a second tsconfig are its own toolchain.

`pnpm verify` at the root must fail when `client/` is broken, by any of those routes.

## The transport seam — the one enforceable boundary

```
client/src/api/      ← the only directory that may import a wire protocol
client/src/features/ ← composing views + hooks; imports api/, never fetch
client/src/components/, hooks/, format/   ← shared, populated on second use
```

**The engine's transport is one file per wire slice.** `api/http.ts` is the plumbing — the
two errors, `url()`, `get`/`post` and the session — and imports no slice but `common`. Each
other file decodes one slice and is named for it: `api/trak.ts` for `shared/src/dto/trak.ts`,
`api/fleet.ts` for `fleet`, and so on; the `host-engine` slice's routes are
`api/engine.ts`. **A route goes in the file named for the slice
its answer decodes from**, and a hook imports the file for each slice it reads, so an edit
to one slice reruns only the client tests that reach that slice. `api/types.ts` stays one file: it is type-only, and a type import selects no
test.

**Two transports, both behind that seam.** The engine's files own `fetch`; `api/launcher.ts`
owns `window.orkestra`, the bridge the desktop shell's preload puts on the launch window,
and `api/rail.ts` and `api/page.ts` own the shell's other two bridges the same way. A
hook depends on the signatures and never learns which is behind it, so a third — Tauri —
would change `api/` and every hook and component would recompile untouched.

**`api/launcher.ts` and `api/rail.ts` each have a second transport**, a host's HTTP API,
used on any call that finds no bridge on the window. A host may fill it: the hook hands it
in from the `hostTransport` slot, as a parameter, so no transport file imports React, and
the slot's default is `undefined` — a page with no bridge says it could not read its
projects. So a function added to either seam owes an answer in
`HostTransport` as well, or a reason in the `host` state that keeps its press off the page.

**The engine analogy is `ports/` + `adapters/`** — `features/` depends on the port
(the signatures in `api/`) and `fetch` versus Tauri IPC is the adapter behind it. Which
is also why `api/types.ts` exists: the port's vocabulary, re-exported from
`@orkestra/shared` so no feature imports the wire package directly.

Enforced by oxlint in `client/.oxlintrc.json`, by two rules rather than one:
`no-restricted-globals` for `fetch`/`XMLHttpRequest`/`WebSocket`/`EventSource`,
`no-restricted-imports`
for `node:http`, `undici` and `@tauri-apps/**`. Restricted everywhere and exempted for
`src/api/**`, so a directory added later is covered without anyone remembering to list
it. **A `fetch` in a component is a lint failure, not a review note** — lift the call
into the `api/` file for its slice.

**Every URL the client writes resolves against the page's `<base>`, never against `/`.**
A host may serve the page under a path prefix such as `/p/<project>/`, and the page
learns that prefix from `<base href>` alone — `client/src/base.ts` says how. An API path goes
through `url()` in `api/http.ts`, an app path through the router, a worker or manifest
URL is written relative, and a `localStorage` or `sessionStorage` key goes through
`storageKey`. A literal `/api/…`, `location.origin` or a root-relative `href` works with
no prefix and breaks behind one, and no lint or test catches a new one.

## File kinds — admission table

| Kind | Where | May import | May NOT |
|---|---|---|---|
| `page` | `features/*/<Name>Page.tsx` | feature hooks + sibling views | `fetch`, wire protocols, business logic |
| `presentational` | `features/**/XxxView.tsx`, `components/` | props + pure helpers + **local-state hooks** + a **layout effect on its own node** | **data hooks** (`use*Query`), `api/`, any other effect |
| `hook` | `features/**/use*.ts`, `hooks/` | `api/` transport files + React + pure helpers | JSX, presentational components |
| `transport` | `api/http.ts` and one file per wire slice | the wire protocol + `@orkestra/shared` types | anything in `features/`, React, JSX |
| `contract` | `api/types.ts` | `@orkestra/shared` types (re-export only) | anything else — no logic, no values |
| `pure` | `*.ts` (not `.tsx`), outside `api/` and not `routes.ts` | `api/types`, sibling pure modules, and a `lucide-react` icon where the prop it feeds takes a component | React hooks or JSX, `fetch`, any side effect |
| `routing` | `routes.ts` | the router + page components, and the history the router is given (`backStack.ts`, `api/frame`'s `frameShown`) | anything else — no data, no loaders, no JSX of its own |
| `entry` | `main.tsx`, `launcher.tsx`, `rail.tsx` | the `App` or page it mounts + the providers | anything else — no JSX of its own beyond the provider tree |
| `mount` | `EngineStream.tsx` | one hook, and nothing else | rendering anything — its body is a hook and its return is `undefined` |
| `shell` | `App.tsx` | `routes.ts` + `styles.css` | anything else — it is one line, and everything that needs router context is the chrome's |
| `gate` | `features/login/SessionGate.tsx` | one feature's hooks and views, and `components/AppBar`, around `children` | anything about a trak — it draws the bar and decides what its slot holds and whether the app is drawn under it, not what the app draws |
| `chrome` | `AppChrome.tsx` | `components/` + `Outlet`, the `gate`, the `mount` and `NewBuildBand`, and in the slot only, `OpenerControl` with the opener hooks, `usePhone`, and the ⌘K door with `hooks/usePalette`; for a phone's bar, `hooks/useHostFrame` and `hooks/useEngineName`; and `hooks/useNotificationOpens`, which needs the router on every screen | any other data hook, `api/`, anything about a trak — it is the root route's component, and the gate and the stream sit in it because the bar holds a `Link` and the stream must not open before the login. The project's openers mount inside `action`, so the listing is not asked for before the login either |

`main.tsx` owns *mounting* (`#root`, the `QueryClientProvider`); `App.tsx` owns *what the
app is* and is one line — `<RouterProvider router={router} />`. Splitting them is what
lets a test render `<App/>` without a real DOM root.

Every file is exactly one kind. **A presentational component with a `fetch` is in the
wrong kind** — the logic belongs in a hook; the call belongs in `api/`.

**"Presentational" bans data, not state.** `useState`/`useReducer`/`useRef` for something
local — a disclosure toggle, a controlled textarea, "show raw JSON" — is ordinary React
and stays in the component. The line is *where the data comes from*: a component that
fetches, mutates, or reads the query cache is in the wrong kind.

**And it bans effects, except measuring and setting its own node.** `Field` grows a
textarea to its content, `DrawerPane` and `GateFace` each keep their scroll at the bottom
as lines arrive, and `Confirmation` takes focus onto its own press as it opens; none can be
a hook, because a
hook cannot reach the node, and none belongs to the page, because the page does not own the
box. Two rules make it an exception rather than a hole: it must be `useLayoutEffect`, since
a frame painted before it — at the old measurement, or with focus nowhere — is a visible
jump or a keystroke lost to the document, and it must touch nothing but the ref it holds.
Anything reaching `window`, a timer, or another component's DOM is a hook.

**A `ResizeObserver` on that same node is inside the exception, and it is the only
subscription that is.** `Field` needs one — a box sized to its content has to be resized
when its width changes, and nothing rerenders it when the drawer narrows — and it observes
and writes the one ref, so both rules above still hold. `SpendRow` holds another: it
measures its own track, because how many squares fit is a function of the width and
nothing rerenders it when the drawer narrows. `window.addEventListener("resize")`
is the version that does not: it is the window's event, every field on screen would take a
copy of it, and it fires for resizes that changed nothing about the node.

## Directory is a map of functionality

Feature-first: a stranger reading `ls -R client/src` knows what the app does without
opening a file. A feature directory (`traks-list/`, `trak-detail/`) holds its Page, its
views, its colocated hooks and its pure helpers together.

**A feature too big to scan is grouped one level down, by what each group draws.**
`trak-detail/` is: `changes/`, `pull-request/`, `checks/`, `turns/`, `tokens/`,
`finished/`, `waits/`, `family/`, `cards/`, `openers/`, `deploy/`, `chat-bar/`,
`failure/` and `run-mode/`. A new file goes into the group whose word its name carries
(`ChangeFoo.tsx` → `changes/`). The top level keeps the page shell and the hooks that act
on the trak as a whole (`useApprove`, `useStop`, `useFile`). A group gets a
subdirectory of its own once it splits the same way (`cards/gate/`, `finished/merge/`).
No rule needs wiring for a new group: the client's bans and test overrides are written
as `src/**`.

**`components/` and `hooks/` start empty.** A thing moves there only when a *second*
feature needs it — premature sharing is how a `utils/` grows.

**Routes are code-based, declared in `client/src/routes.ts`** with TanStack Router's
`createRoute` — no file-based convention competing with the feature-first layout.
A route names its page component and, on one route, validates a search param. **No
loaders**: data comes from the feature's hook, so there is exactly one place data is
fetched — and `validateSearch` is not one, because it fetches nothing.

**The back stack is the list and at most one screen over it, and the router's history
enforces it** — `backStack.ts`. A move from the list pushes and marks the entry; every
other move replaces; a move to the list from a marked entry goes back. So a `Link` or a
`navigate` never chooses `replace` for itself: the history overrules it. **A move between
screens goes through the router**, a `Link` or `navigate` — never `window.history`,
`window.location` or a bare `<a href>` to an in-app path, which skip the rule — and a close
or back press is a link to `/`, never `history.back()`. Under a host the
frames share the top window's stack, and `api/frame.ts` says how the page keeps one entry
among them. A notification click reaches an open page as a message from the worker
(`api/worker.ts`), never `WindowClient.navigate`, which reloads and pushes.

**The one search param is `?spot=` on `/traks/$id`, and what belongs in a URL is the test
it passed.** A spawn's piece is read and acted on inside its parent's drawer, so *which
piece* is the difference between two screens that are otherwise the same trak, and a link
or a reload has to land on the same one. Which *altitude* the drawer is at is not: it is
where a reader happens to be looking, and it stays in the page. A second param wants the
same argument, not a precedent.

## Compose first — a new appearance is a design decision

**Start from `client/src/components/`.** It holds the design system as code, and its
`README.md` is the inventory, the layering ladder and what is still open. A screen is a
composition of those primitives with layout utilities — `flex`, `grid`, `gap`, padding,
width — around them.

| you need | do |
|---|---|
| a control, a pill, a row, a panel | use the primitive |
| it nearly fits — a size, a spacing, a width | layout utilities and **tokens** around it, at the call site |
| it does not fit, and what you want *feels like a component* | **stop and ask.** That is a design decision |

The tell is not "am I writing a lot of classes". It is **am I inventing an appearance**:
a new fill, a new edge treatment, a new state colour, a new shape. Padding a thing
differently is styling; giving it a look the system has no name for is a component,
whether or not it lives in a file of its own. An invented appearance passes every gate
and is found by eye months later.

**A drawer screen's top band is `ScreenHeader`, never one of its own.** Its slots are the
size rule: the title row holds at most one action and one ghost `⋯`, the actions row any
number, right-aligned, and every action is one 30px bordered press. `components/README.md`'s entry for it
has the rest, including the fold at `@6xl`.

**No badge or chip repeats a state the screen already says.** A badge stays only where it
is the sole carrier of its state, as the run-mode picker's MERGE badge is.

**Tokens, never raw values** — `bg-surface-2`, not `bg-[#efeaf5]`; `text-sm`, not
`text-[11px]`. And not Tailwind's own defaults where the system names its own: the radius
scale is `rounded-surface` / `rounded-control` / `rounded-pill`, so `rounded-sm` is drift
even though it compiles.

## Components — one per file, minimal logic

**One component per file** — the default export; anything else in the file is ≤10 lines
and presentational. **If you can lift a block out to a pure function and the component
still reads clearly, you should have**: the same split as `workflow/domain/` being pure
and `runtime.ts` wiring it.

| In a component | NOT in a component |
|---|---|
| prop destructuring, early returns on loading/error | data shaping (`transcript` → turns — the map belongs in the view, the split in `turns.ts`) |
| composing `<View>`s | business decisions (`if (state._tag === "AwaitingHuman")` → a pure `*View.ts`) |
| dispatching callback props | calling `fetch` / `api/` directly (always via a hook) |
| local UI state (`useState` for a toggle) | anything that reads or writes the query cache |

**A fact about one position travels as the row, not as a prop per fact.** `rows.ts`
computes a `MapRow` per position and `TurnsView` takes it whole, so a fact added there
reaches the pane without a hop being edited. The two gate marks were an optional prop
through six components before that, and a hop that forgot one drew no band and failed no
check.

**A prop a hop merely forwards is `T | undefined`, never `T?`.** Optional is what makes
the dropped hop silent — the default draws nothing, which on these surfaces reads as
nothing being there — where required-and-undefined fails `tsc` at the hop that stopped
passing it. `?` stays right for a prop a caller may genuinely not have.

## `tone` — a closed vocabulary, exported once

`trakLabel` and `planView`'s `stepTone` both return a `tone`, and two features inventing
two sets of strings is a drift no compiler catches. One union in one pure module
(`client/src/format/tone.ts`), and **a semantic name, not a colour**:

| `tone` | Means |
|---|---|
| `neutral` | it happened, nothing is owed — `TrakCreated`, `WorktreeReady` |
| `working` | something is in flight right now |
| `waiting` | a human owes an action — a gate, a finished trak holding a branch there is still a merge to make from |
| `good` | it went well and nothing is owed — a step or check that passed, work that was kept, a finished trak with nothing to merge |
| `bad` | a failure: `Failed`, `CheckFailed`, `TurnFailed`, `WorktreeFailed` |

Five, deliberately. A sixth means a state was not thought about — add the case to
`trakLabel`'s switch instead. **A tone is a status**, which is why *who did this* is its
own family — `--color-source-human` and `--color-source-machine` — rather than a sixth and
seventh tone; `styles.css` carries that argument, and the rule that keeps the pair apart
from the tones: **a source colour never goes inside a plate.**

## Every view has four states, and the third is the one that bites

First load (the only state where a spinner is right) · empty (a sentence naming what
would put something here — `pnpm ork "<desc>"` starts a trak — never a blank panel) ·
**refetch failure with data present** · failure with no data (the error, in words, and a
retry).

**The first, second and fourth are `components/EmptyState`** — one shell, differing by a
tone, an icon and a sentence, because a list that is loading and a list that is empty
follow each other within a second and a page that redraws between them reads as a
flicker. Its README says what a caller owes it.

**The third renders the stale data plus an unobtrusive retry affordance**, because with a
1.5s poll a single dropped request must not blank a working screen — and it is
deliberately *not* the shell, since nothing may cover rows that are still true. TanStack
Query keeps `data` while `isError` is true on a background refetch, so **branch on `data
=== undefined` first** — branching on `isError` first flickers the page to an error every
time the laptop sleeps.

## Accessibility — because the tests assert on roles

Tier-2 tests assert roles and text, which only works if the markup carries them — so
semantic elements over `div`s is an authoring rule here, not a polish pass. **If a test
needs `getByTestId` to find something, the markup is the thing to fix.** An `aria-label`
is the fallback when no visible text names a control, not the default.

## Hooks — colocated, depend on a port

A hook depends on a port, not an adapter: it accepts an injectable queryFn (or takes a
stubbed `QueryClient` in tests). The fake matches on the request, not on call order — see
`testing-tiers`.

**A hook is an options factory plus a one-line wrapper**, not one function. The factory
takes the injectable queryFn/mutationFn and returns the options object; the hook is
`useQuery(xQueryOptions())`. That is what makes the decisions — the poll predicate, the
key, what `onSuccess` invalidates — reachable from a tier-1 test with no React, and it
leaves the hook itself with nothing left to test.

**A hook that folds the cache rather than reading a query must subscribe to the cache.**
`useQuery` re-renders its readers; `getQueryData` does not — so a fold run during render
redraws only when its component happens to render for some other reason, which is a
drawer's fresh answer sitting in the cache while the row behind it draws the old one until
the list's own poll. `useForgeMemory` is the one and has the shape: `useSyncExternalStore`
over `QueryCache.subscribe`, filtered to the keys the fold reads, snapshotting a counter
rather than the folded value — that store compares snapshots by identity, and a value
rebuilt per render never matches itself.

**The stream is the transport; the poll is the backstop.** Every append the engine
makes arrives on `GET /api/stream` as a frame, and `useEngineStream` either patches the
trak it names or invalidates it. `POLL_MS` is 15s and exists for what a stream cannot
cover — a connection that dropped and has not noticed, a suspended tab, a frame lost
between the two. **Do not delete it**: a UI whose only source of truth is a socket goes
quietly stale when the socket does.

**A frame patches only when it is the next one in its own sequence.** `seq` is what makes
that decidable, and `applyFrame` is the pure function that decides — anything else falls
through to a refetch. Patching is what draws a running turn without a poll behind it; the
fallback is what stops it becoming a log with a hole in it, which reads exactly like a
complete log.

**Every field the engine derives from the log rides the `Appended` frame, and nothing a
screen draws waits for the poll.** The poll cannot be waited for: writing a frame into
the cache re-arms it, so it never fires while a turn is busy — `queryCache.ts` has the
mechanism. So `TrakProjectionDto` is spread into both `TrakDetailDto` and the frame, and
`applyFrame` replaces the lot on every one; a field added to the projection reaches the
drawer without another edit. What the frame cannot carry is what no append can say:
custody rides `Drive`, published by the driver at both ends of a drive, and a check rides
its own family. A new field on `TrakDetailDto` is one of those two kinds — derived, and
it goes in the projection; the daemon's own memory, and it needs a frame of its own.

**Work in progress at the seam is one daemon-memory field, `seam`, patched by the
`SeamStatus` frame.** A surface that shows what the engine is doing at a sandbox draws it
through `seamWords` in `format/seam.ts`, and reads it ahead of `preparing` and
`reattaching`, which stay only until preparation and reattaching move onto the seam
operation. It draws no sentence of its own for the same wait.

**A frame of its own carries the whole of what it reports.** `Drive` sends the whole
`custody` rather than *released*, and the check family replaces a run rather than amending
one, so a watcher assigns what it is given instead of reconciling it with what it holds —
only `Appended` and `Activity` have a `seq` that makes a delta decidable. Nothing under
`api/` registers the new tag: the names come off `EngineFrameDto`'s members, and
`applyFrame`'s switch is exhaustive, so the compiler names the one place to handle it.

**What `seq` counts differs by family, and one family has no file behind it at all.**
`Appended` and `Activity` count a trak's log events and transcript entries, so a refetch
re-reads the store. `CheckStarted`/`CheckOutput`/`CheckEnded` carry a check's output as it is
printed, which is never written down — a script looping on `echo` would otherwise fill
something permanent — so `CheckOutput.seq` counts chunks within the run and the refetch
reads `TrakDetailDto.check`, the daemon's memory of it. The consequence to hold on to:
**a passed run's console does not survive an engine restart**, and a failed one is still
readable off `CheckFailedDto` in the log.

**One subscription for the whole app.** `EventSource` is banned outside the seam and
`useEngineStream` is its only caller, because a second subscriber is a second copy of
the patching rules with its own idea of what has been applied. It is mounted above the
router, so navigating does not end it.

**The list is invalidated, never patched.** `instruction` and `activity` on a summary
are projections the server computes; rebuilding them here would be a second copy of
rules the client does not own. Debounced, because a busy turn writes a frame per tool
call.

**Four queries do not poll, and all four prove the rule below.** `useAgents` and
`useModels` read a library the engine loaded once when its layers were built — no running
trak can change it and no frame reports it, so nothing a poll could observe moves while the
engine is up. A new agent file, or a model added to `models.yaml`, appears when the engine
restarts, not on a reload. `useRecents` reads the desktop shell's own file, and the bridge
sends every change to it, so a poll would ask a process on this machine for a fact it has
already pushed; a host's list stands in for it there, and a host reads that once at boot. `useViews` reads a view an MCP tool's call left, which the engine wrote once when the
call completed and never changes. Everything else the *engine* owns polls.

**Poll unconditionally. `refetchInterval` is a number, not a predicate.** A query gated
on "is anything running" keeps a coarse copy of the engine's state that only the
suppressed fetch could correct: a trak nobody held when you last asked gets claimed a
moment later by `pnpm ork`, by another tab, or by this tab's own action, and a query that
stopped asking never finds out.

**Assume any trak can change and ask. Make the answer cheap, not the question rare** —
`updated_at`, an ETag, a log mtime. Optimising the question loses information; optimising
the answer does not.

**No `setInterval`, no `clearInterval`.** The class worth guarding is a poll outliving its
subscriber, and TanStack already closes it — no mounted observer means no polling, and a
hidden tab does not poll either (`refetchIntervalInBackground` defaults false). A
hand-rolled interval has neither property.

**A clock that only displays is the exception, and it has to earn both properties back.**
`useSecond` is the one: it ticks the seconds `useCountdown` counts down to a wait's next
ask and a running call's clock counts up from. It fetches nothing, and its interval lives
in a module store read through `useSyncExternalStore`, so it runs exactly while something
is subscribed and goes with the last row that unmounts. An interval written inside a component has neither, whatever it
draws.

**Custody answers "may I act", not "should I poll".** `running` on a summary and
`custody.holder` on a detail are the same fact from the same port, held across the whole
drive. So it is the right input to a button that would start a second drive, and no input
at all to a view deciding whether to look. Never derive either from `state`: a crashed run
stays `AgentWorking` with nobody holding it.

**Query keys are a fixed vocabulary, not a per-hook invention.** Two hooks that key the
same data differently break invalidation silently — the mutation succeeds, the list never
refreshes, and nothing errors.

| Key | Data |
|---|---|
| `["traks"]` | the list: a row per **live** trak, and a count of the archived ones. No summary is sent for an archived trak; the ⌘K palette finds one by name on `["archived", q]`, which carries its title and id and nothing else |
| `["trak", id]` | one trak's detail |
| `["merge-preview", id]` | where a merge would put it — the host's branch, not the trak's |
| `["pull-request", id]` | what the forge says about one branch, whole — the finished pane's second half |
| `["pull-requests", branches]` | what the forge says about **many** branches, coarsely — one answer for the traks list, matched to rows by branch. The sorted branch set is in the key because it is the question |
| `["agents"]` | every agent the engine holds, `start` among the fields — the library, not a trak |
| `["models"]` | `models.yaml` as loaded — the models a step may run on, in file order, and the default. The library's other half, on `["agents"]`' terms: read at boot and on a reload pressed in the project menu, never invalidated, never polled — a screen mounting it asks again |
| `["build"]` | which client build the engine serves now, for the page to compare with its own. Polled every five minutes while visible, asked again on tab return and invalidated by the stream each time it connects. Never asked on a page with no build id of its own — the dev page |
| `["engine"]` | the project's name, from the checkout `/api/health` reports. Read only by a phone's header on an engine reached with no host; an engine drives one checkout for its life, so never invalidated and never polled |
| `["session"]` | whether this browser is in. Read by the gate before anything else is drawn; `false` is data rather than an error, so a refusal settles instead of retrying. Polled, because an engine restart forgets every session and nothing else would notice |
| `["changes", id, at]` | what one slice of a trak's work did to the files. The slice is in the key because a trak holds three at once; `["changes", id]` is the prefix a commit sweeps |
| `["processes", id]` | the hosted processes the project declares, at one trak's checkout — daemon memory, like a check's run. Patched by the `Process` and `ProcessOutput` frames, which re-read nothing else; invalidated by a press on a process and by nothing on the trak, since a process never moves one |
| `["project-processes"]` | the same on the project checkout, which no trak owns — the git bar's processes cell. Its own root, so a sweep of every trak's `["processes"]` never reaches it; patched by the frames that name no trak, invalidated by a press on the bar |
| `["view", id, call]` | one view an MCP tool's call left on a trak, whole — its HTML for a frame's `srcdoc`, and the call's arguments and result. Fetched only while its card is open; written once by the engine, so nothing invalidates it and it does not poll |
| `["git"]` | the project checkout's branch, upstream, counts and last fetch — the git bar's read, and no trak's. Polled, and the poll is what makes the engine fetch every five minutes; a press on the bar answers with the same shape and writes it here rather than invalidating |
| `["usage"]` | each CLI's plan usage as the engine last read it — daemon memory, which only a running Claude turn refreshes. Polled as a backstop, and patched whole by every `Usage` frame; no press touches it |
| `["deploy", id]` | what the project's `deploy.sh` says about one trak's merge commit — the finished pane's deploy block. Asked only where the project has the script (`TrakDetailDto.deployScript`) and a wait has landed the branch or the trak ended `Merged`, because every answer but `none` may run it; never persisted, since a deploy's status moves while nobody is looking |
| `["goals"]` | every goal the project started — the traks list's banners read every one not dismissed, and a trak's header the title of the goal that opened it. Polled, and invalidated by every `Goal` frame |
| `["files"]` | every file git sees in the project checkout — the file browser's tree, and what the palette matches paths against. Asked only while the Files panel or the palette is open, and polled then |
| `["files", "content", path]` | one file as the viewer draws it — its text, or its size where it is binary or over 1 MB. Polled while open; no `keepPreviousData`, since the path is the subject |
| `["files", "search", q]` | the lines of those files holding `q`. Asked once the typing settles and from two characters, with `keepPreviousData` |
| `["archived", q]` | the put-away traks whose title or id holds `q`, off the engine's archived set. Its own root, so no acting hook's sweep of `["traks"]` reaches it |
| `["goal", id]` | one goal whole: the goal, its log and its composer's transcript. Invalidated by every `Goal` frame rather than patched — the frame names the goal and carries nothing else — and by every press on it |

**A key that carries a varying value needs `placeholderData: keepPreviousData`, or the
value changing is a cache miss.** The branch set changes whenever a trak finishes, and
`useQuery` on a key nothing has answered yet hands back `undefined` — so a surface that
draws something for *no answer* draws it every time the value moves, not once per tab.
Ask what the empty case renders as before deciding whether that is survivable: on the
traks list it rendered as *Ready to merge*, which is a verdict.

A mutation's `onSuccess` must invalidate the **first two** — an action changes the row in
the list and the detail behind it. Every acting hook but one does; `useCreateTrak` takes the
list alone, because the trak it made did not exist a moment ago and the detail the caller
navigates to is fetched fresh on arrival. The third and fourth share no prefix with the
others on purpose: each describes something outside this trak — the daemon's own checkout,
and the forge — so an ending must not sweep either away mid-press, and **one press alone
invalidates a forge key**: `useMergePullRequest` writes to the forge and takes
`["pull-request", id]`, because the forge's next answer is the only record of that merge.
No other press writes there, and the poll is the whole of how they stay *current*. **The two forge keys share no prefix either**, which is the same
rule one level down: `["pull-requests", branches]` would otherwise be swept by nothing and
sweep nothing, but `["pull-request"]` as a prefix of it would tie a pane's answer to a
list's. They are different routes answering different questions — one branch in full
against many branches coarsely — and **a surface asking about many branches must not fan
the first one out**: that is one process and one network call per row per poll, over a set nothing
archives. **The last key is invalidated by the stream rather than by any
mutation**: what a commit did to the files is git's answer and no press here produces one, so
`useEngineStream` sweeps its prefix when a `WorkCommitted` arrives and nothing else touches
it. `queryCache.ts` holds the keys and `POLL_MS` and
nothing else: each hook spells its own invalidation, and it sits at the top of `src/`
because both features key data — a `traks-list/` importing a `trak-detail/` constant would
be a feature reaching into another for something neither owns.

**The two forge keys are the only *query* data written to `localStorage`, and only for an
hour.** `main.tsx` mounts `PersistQueryClientProvider` over an allow-list — `forgeMemory`
holds it, reads the two roots off `queryKeys` so they cannot drift, and drops a *we could
not ask* answer because an hour later it is evidence of nothing. It is what keeps a
reloaded page saying what it was saying, since both forge reads cost the engine a `gh`
process and neither can answer on the frame the page paints. Two rules follow:

- **Nothing else may be persisted, and that means mutations as well as queries.** The plugin
  checks `maxAge` once over the whole stored writing rather than per entry, so anything else
  under that roof silently comes under the same hour — and a trak's log there would be a
  browser writing megabytes on every poll. **A key allow-list covers only half of it**: the
  library's `shouldDehydrateMutation` defaults to persisting any *paused* mutation, a
  mutation has no key for an allow-list to read, and `networkMode: "online"` pauses one
  whenever `navigator.onLine` goes false — which says nothing about an engine on localhost.
  So `shouldDehydrateMutation: () => false`, outright: every press here either spends real
  money or moves a trak, and neither is a thing to replay out of storage.
- **A restored `["pull-requests", branches]` is not found by its key**, because the branch
  set is the question and the question moves whenever a trak finishes. `useForgeMemory`
  reads every answer under *both* forge roots by *branch* instead — the listings and each
  trak's own `["pull-request", id]`, newest winning per branch — and that store is the one
  source `rungsOf` draws rungs from. Anything keyed by a question rather than a subject
  wants the same treatment.

**A preference this browser holds is its own `localStorage` key, outside all of that.**
Which run mode the new-trak form offers (`new-trak/runMode.ts`) is a fact about one
browser's picture of the work rather than about a trak, so it goes nowhere near the engine
and nowhere near the persister. Three rules, and that file follows them:

- **The key is namespaced under `orkestra` and read through `storageKey`**, because an
  unprefixed word is not ours to take, and behind a host the origin is shared with every
  other project it serves.
- **It is read once, in a `useState` initializer** — never on every render and never from
  storage events — so a value another tab wrote cannot swap the screen under somebody
  looking at it.
- **A stored string that is not a value the type allows means nothing was chosen**, and the
  default stands. A preference that cannot be read is one that was never expressed: no
  throw, no repair, and a tier-1 test beside the pure reader saying so.

`onSuccess` **returns** the invalidation promise. TanStack waits for it before settling
the mutation, so `isPending` covers the refetch and the button below stays disabled
across the gap instead of flickering enabled with stale data behind it.

**An action hook starts a drive, and most of them spend real money.** Twenty-six exist —
`useCreateTrak`, `useApprove`, `useAnswer`, `usePermit`, `useSendChat`, `useResume`, `useSkipWait`,
`useMerge`, `useCommitAndMerge`, `useMergePullRequest`, `useArchive`, `useReenter`, `useArchiveUnfinished`,
`useStop`, `useStopJob`, `useFile`, `useRecompose`, `useSetMode`, `useSetHold`,
`useSkipChecks`, `useSetAutoMerge`, `useChooseOpener`, `useOpenCheckout`, `useOpenProjectCheckout`, `useProcessPress` and
`useRebuildSandbox` —
and a hook that POSTs to `/act`,
`/resume`, `/run-now`, `/reenter` or `/file` spawns a `claude`, the same spend as `pnpm
ork`, from a button. `useBreakOut` is not a twenty-fifth: it is `useStop`, `useFile` and `useRecompose`
read from one place, so a caller cannot hand custody to a hook that must not have it —
and `usePickerSettings` is the same shape over `useSetMode`, `useSetHold`,
`useSkipChecks` and `useSetAutoMerge`, the four that take no custody at all.

**`useMerge`, `useCommitAndMerge`, `useArchive`, `useArchiveUnfinished` and `useStop` spend
nothing and are under the same contract**, which is the thing not to get wrong: the rules
below are about *a second drive*, not about money. All five routes claim custody exactly as
`/act` does, so a double click races a `git merge`. Three rules follow, because the server
cannot tell a deliberate click from a double one:

- **Disabled while in flight, and while `running` is true.** Not merely a spinner —
  actually non-submittable, so a second click cannot start a second turn. `running` is
  `custody.holder !== undefined` on a detail, read by the caller and passed in: a hook
  must not hold a second opinion about a trak the page already has in hand.
- **The callback refuses when disabled as well.** A control that forgets to read
  `disabled` still must not be able to start a second drive.
- **Nothing auto-fires.** No action in a `useEffect`, no retry-on-mount, no
  `refetchOnWindowFocus` on a mutation. A turn starts because a person asked, once.

The server refuses the concurrent case with a 409, but a 409 the user provoked is a UI bug
caught downstream, not a design.

**A fourth rule, because the trak an acting hook is keyed to moves under it.** The detail
page keys its hooks to whichever trak owns the position on screen, and the route param
changes without the page unmounting — so everything a hook holds has to be scoped to the id
it was earned at, in one of two ways:

- **Mutation state is dropped on a change of id** — `useScopedTo`, called by every acting
  hook in `trak-detail/` that acts *for a trak*. `useChooseOpener` is the one that does
  not, because what it writes is the machine's terminal or editor pick rather than
  anything about a trak, so its pending flag and its refusal stay true wherever the
  drawer moves.
  A pending flag drawn on the next trak's card and a refusal sentence
  read as the engine's answer to a press nobody made are the visible half; the half that
  spends is that `MutationObserver` re-points a *pending* mutation at the newest options, so
  an unscoped hook invalidates the trak the reader stepped to.
- **A typed draft is held per trak id instead of dropped** — `useSendChat` and `useReenter`.
  Nothing on that screen names the addressee, so a field that followed a reader would send
  one piece's words to another; a field that emptied would lose the words of somebody who
  stepped away to check something. Keying by id answers both, and it is also what makes the
  clear-on-success clear the trak the press was *sent* to.

**Component state under a position needs the same answer, and its answer is a `key`.** React
keeps state at the same place in the tree, so `DrawerPane` keys the turns to `spot.key` —
without it the answer form is one instance shared by every position the drawer steps through,
already holding the answers meant for the previous one.

**Four exceptions on that first rule, `useArchiveUnfinished`, `useStop`, `useFile` and
`useRecompose`: all are live while `running` is true.** The
first rule exists to stop a *second* drive racing the first; ending a trak, stopping its
turn, asking it to file and recomposing from it are the presses whose point is to override
the first — each route
interrupts whatever fiber holds the trak and forks its own event in place, so a control
greyed out while an agent works would be dead in exactly the case somebody reached for it.
**The other two halves still hold and are not optional**: disabled while its own mutation is
pending, and a callback that refuses when disabled. All four take **no `running` argument at
all** rather than one they ignore — a hook accepting the fact and doing nothing with it reads
as an oversight at every call site. `useFile` and `useRecompose` are also offered at a gate,
where the route *does* refuse a drive under way: there `fileOffered` and `recomposeOffered`
read custody the ordinary way
up and withhold the press, so the hook still has nothing to do with it. **That is the shape a
press with two routes takes** — custody in the predicate, one way up at each place, and none
in the hook, because a hook that also guarded on `running` would draw a permanently dead
send in exactly the mid-turn case the press exists for. One other reason
carries, and it is `useSetMode` and `useSetHold`
below: *this press starts no drive at all*. *This press is cheap* is not one of them.

**`useStopJob` is live while `running` is true for a reason of its own, and it is the
strong form of `useSetMode`'s**: the route starts no drive *and claims no custody* — one
control line down the turn's open pipe — and the job it stops only exists while something
is driving, so a press gated on `running` would be dead in every case it is drawn for. It
takes no `running` argument, and the two pending-guard halves still hold: one mutation
covers every row, disabled while any stop is in flight.

**`useSendChat` is live while a turn or a check runs, and takes `blocked` rather than
`running`.** What is sent there starts no drive: the engine writes it down as waiting and
the running agent reads it, or the next turn does, or it is the chat at the gate the trak
parks at. `messageKept` in `controls.ts` is the states that holds for, `chatClosed` reads it
with custody to open the bar, and `sendBlocked` is the same pair handed to the hook — so
the callback still refuses exactly where the engine would. The bar's one button follows the
draft there: the stop while the field is empty, the send once it holds text. What a stop or
an ending hands back arrives as `TrakDetailDto.returned`, and the hook lays it into the
draft once, during render — not in an effect.

**What still waits is `TrakDetailDto.messages`, and it is drawn inside the conversation
scroll, after everything else the pane draws.** `WaitingMessages` is the last child of
every pane `StepPane` renders, a transcript or not, so the list scrolls with the
conversation and never sits fixed over the chat bar. A surface reads the list the engine
sends and does not fold `MessageWaiting` and `MessageDelivered` out of the log: the
message a delivery removes is the engine's to name.

**`stopOffered` is the one control that reads custody the other way up**, and it belongs
with those two: it is `false` unless something is driving, because there is no turn to
interrupt otherwise. It is exactly complementary to `runInterrupted` — a crashed run wants
the resume, not the stop. At `Stopping` it is `false` and `stopTaken` draws
`stopPressTaken` — busy, not pressable — in its place: the route answers once the intent is on the log, before the kill.

**`useProcessPress` — Start, Restart and Stop on a hosted process, a trak's or with no trak the project checkout's — takes no `running`
for the same reason as the three below**: the route runs or kills a script in the checkout,
never a turn, so no drive under way refuses it. It is two mutations rather than one, because
a start answers only once the process is up and a shared pending flag would grey out Stop on
the process a person most wants to stop.

**`useMergePullRequest` — the finished band's merge of a pull request on the forge — takes
no `running`, for `useProcessPress`'s reason**: the route claims no custody and appends
nothing, so no drive refuses it. Its callback refuses while its own press is in flight and
while GitHub's own verdict, `mergeVerdict` on the pane's answer, is not `Mergeable` — the
client keeps no readiness rule of its own.

**`useRebuildSandbox` — Rebuild on a sandboxed trak's `⋯` menu — takes no `running`, for
`useProcessPress`'s reason**: the route claims no custody and appends nothing, and the engine
queues a press made under a running turn. It is disabled while the detail's `rebuild` says one
is owed, since a second press would ask for nothing.

**The git bar's press — Fetch, Pull, Reconcile and Push, in `traks-list/git/useGitBar` —
is not one of the twenty-three and takes no `running`.** It acts on the project checkout,
which no trak owns, so its routes claim no custody and no drive can refuse them. The two
pending-guard halves still hold: one mutation for every press, the stash variant of pull
and reconcile included, and nothing on the bar pressable while any is in flight or the
engine is fetching. *Resolve in a Trak* is no press at all — it opens the New Trak page
with the engine's description in router state and starts nothing.

**A goal's seven acting hooks are outside the twenty-three and keep the same contract.**
`useGoalAct` is every press on a goal's `/act` — Approve, an answer, Confirm done, Retry,
New session and Send — and all but Confirm spend: it takes `GoalDto.running`, a composer turn under
way, as a trak's hooks take custody, and its `say` alone ignores it, for `useSendChat`'s
reason — the running composer reads what is sent. `useStopGoal` takes none, for
`useStop`'s reason, and spends nothing: it kills the turn in flight. `usePauseGoal` takes none, for
`useStopJob`'s reason: a pause is the press reached for while the composer works.
`useGoalSettings` takes none for the same reason, and spends nothing: a running goal's
limits, modes and auto-merge are replaced on its log and no turn starts. `useDropGoal`
takes none for the same reason, and spends nothing: the drop kills a turn in flight.
`useStartGoal` spends and takes nothing, for `useCreateTrak`'s reason: the goal does not
exist until it succeeds. `useDismissGoal`, in `traks-list/`, spends nothing and takes
nothing, since a goal at rest has no turn to race. Which
`/act` presses a goal offers is `GoalDto.offers`, the engine's own list, and nothing in the
client decides it again.

**`useSetMode`, `useSetHold` and `useSkipChecks` take no `running` either, and for a
third reason: the route takes no drive at all.** `POST /mode`, `POST /hold` and `POST
/skip-checks` append one event each and the next gate — or the next check run — reads it,
so there is no second drive for the guard to prevent — and greying the picker out while a
turn runs would kill it in the case it exists for, swapping to `manual` because the step
now running is the one to read. `modeSettable` is the control, drawn wherever the trak is
not at rest; the hold's row is withheld on `manual` by the picker, and the skip's is
withheld by `skipChecksOffered` where no check run is ahead.

**The cancel in a running check's band is `useStop` again**, offered by
`cancelChecksOffered` — custody the other way up, as `stopOffered` reads it — and threaded
to `GateStrip` as a required `Stopping | undefined`, since a hop that dropped it would draw
no press and fail no check.

**A refusal is the failure worth rendering, and its sentence has one home.** Both 409s an
approval can earn are told apart by their body rather than by the reason phrase, so an
acting hook hands its caller the sentence — `format/refusal.ts`, exhaustive over
`RefusalDto` — and never the `RefusedError`.

**A screen that opens a trak without showing the run mode never sends `auto`.** The mode
is set at creation and inherited by everything the trak becomes — changeable afterwards
from the trak's own screen, but the first gate is decided before anybody has looked — and
`auto` is the one that must never be picked on somebody's behalf: `approvedInAdvance` in
`attention.ts` short-circuits every stop, so the trak plans and runs whatever it raised
with nobody reading any of it. New Chat is the case — no mode strip, so it sends the
remembered choice with `auto` read as `smart` (`forChat` in `new-trak/runMode.ts`).
`decider` passes through: it parks every question and conversation, so nothing is
answered on the person's behalf. A door
that *does* draw the strip is the person's own answer and needs no such guard.

**Which gate a control belongs to is decided in `features/*/controls.ts`, from
`TrakStateDto` alone.** `decide` settles an action a gate does not accept as
`Failed{kind:"engine"}`, so a control drawn one state too wide does not get refused: it
ends the trak. Too wide means *at another gate* — a control drawn where there is no gate
at all is the case `/act` catches first, `409 NotParked` and nothing appended.
`planAwaitsApproval` is the pattern — one exhaustive switch per control, `true` for the
states that accept it and an explicit `false` for every other.

**`AwaitingHuman` needs a second exhaustive switch, over its `kind`.** Three of the five
gate kinds have filed nothing, and `decide` settles an approval at one of them
`Failed{kind:"engine"}` — so a control that stopped at the `_tag` would be drawn at three
gates that end the trak. `workAwaitsApproval` is that shape. One press can
belong to two states (`Approve` is offered at both approval gates); write it as two
predicates the caller `||`s, never one switch over both, because the two carry different
step indices and nothing downstream can tell them apart afterwards.

**`Failed` needs one too, over its own `kind`.** A merge git refused leaves a trak that ran
its plan out, holds its checkout and has its work on its branch, so `Failed{merge}` belongs
with the ending states — `finishedPosition` returns it and the Merge press is offered on
it, where every other kind stopped somewhere inside the plan. A control that is `true` at
`Finished` and answers one `false` for the whole `Failed` tag is therefore drawn too
narrow, and the person at a refused merge is left with a card and no way off it;
`mergeRefused` is the predicate that splits the tag.

**A press whose subject is a gate is withheld off that gate's own row.** The state says
the trak is waiting; which row the reader is standing on says whether they are where the
wait is, and a reader on an earlier run of a re-composed trak is not. The row is not on
the wire union, so it composes above the switch as custody does. A press whose subject is
the *running turn* reads no row — no row is a gate while a step runs.

**Custody may be an argument to a control, never a case inside its switch.** Most controls
are a fact about the state alone, and the acting hook guards custody separately — but two
questions are genuinely about the pair, and putting the pair in one predicate is the only
honest way to answer them. `chatClosed` says why a bar is shut; `runInterrupted` says the
trak stopped without saying so, which is *a command was in flight* **and** *nobody is
carrying it* and is neither of those alone. Keep the switch pure and compose one line
above it, so the exhaustive part stays a fact about the wire union.

**Custody is an argument to a drawn count as well as to a control.** A `Background` level
is a fact about the turn that wrote it and nothing later on the wire supersedes it — the
CLI emits one only on change, so a turn whose daemon went away leaves its last non-empty
set on disk and the work it named died with the process. A count gated on `status ===
"running"`, which is `TrakStateDto` alone, therefore draws jobs that are gone. `outstanding.ts`
is the fold and it takes one turn; the caller owes it a turn something is driving.

## An MCP tool's view — a server's document on our page

A **view** is HTML an MCP server wrote, drawn in the transcript. Everything it can do
goes through messages to the page holding it, and `turns/views/viewHost.ts` is the whole
of what the host answers.

| A view may | A view may not |
|---|---|
| call a tool on its own server that the server opens to views — as it loads as well as on a press | call another server's tool, or one the server kept for the model |
| open an `http:` or `https:` link | send a message to the model, change the model's context, or read another resource |
| fetch from the hosts its server declared for connecting and for resources | embed a frame, or load any document but the one it was served as |

- **A request the host does not offer is refused in the protocol's own words**, never
  dropped: a view that asks finds out rather than waiting. A new method is a decision
  about what a server's script may do on a person's behalf, not a case to add.
- **The frame is `sandbox="allow-scripts"` and fed by `srcdoc`, with the string the
  engine sent.** `viewDocument` in `src/app/view-policy.ts` writes the network policy
  into that string, so a surface that builds its own document, or adds
  `allow-same-origin`, has no policy and a script in the app's origin. The view is never
  given an address: a `text/html` route opened on its own runs the server's script as
  the app.
- **A frame that has loaded a second document is answered nothing.** The policy refuses
  every address but `about:blank`, and what a frame then holds is not the view.
- **The engine decides whether a press is allowed, and the client never does** —
  `callViewTool` sends the tool's bare name as the view wrote it, and the refusal is
  what is drawn. A press spends nothing and is not disabled while a turn runs.
- **A view redraws from the arguments and result the engine stored.** Never call the
  tool again to redraw: after the turn the server is a new process holding none of the
  turn's memory.
- **The height is the view's own report, up to a cap** — 720px at a desk, 320px on a
  phone. Past it the view is cut, with a press that grows it in place: a scroller inside
  the transcript traps the wheel half-way down a conversation.

**A goal composer's tool has no HTML view; its view is React inside the same frame.**
`goal/moves/MoveView` draws one per goal event, from the event the call left rather than
the call's arguments — a refused call had arguments too and left no event. A trak inside
one is `GoalTrakRow`, the real `TrakRow`, which a served document could not hold.

**A trak is drawn as `TrakRow` wherever it appears** — the list, a goal's tabs, a goal
tool's view, the ⌘K palette — and a put-away one, which has no summary, as
`ArchivedTrakRow`, built from the row's own parts. The row carries the run mode's `ModeBadge` on every mode, `manual` included,
and the goal mark on a trak a goal opened; a surface with a row of its own draws neither,
and nothing fails when it does.

**Work that ran in a sandbox is marked with `PlacePill` wherever it appears** — a step or
turn head, a check band, a process row — and a sandboxed trak's mark with `CloudDisc`. A
new surface that draws a turn, a check or a process takes the pill from the `place` its
DTO carries. Local work, and work whose record has no `place`, draws nothing. The pill
draws only `place.runner` and the ids off the wire. Nothing fails when a surface leaves
it out.

## DTO contract — `@orkestra/shared`

The wire contract is one file per feature under `shared/src/dto/`, each exporting the
Effect `Schema` *and* the derived type. **There is no barrel**: an importer names the slice,
`@orkestra/shared/dto/trak`, so an edit to one feature's shapes reruns only the tests that
reach that slice. The server imports the Schema for `decode`/`encode`; `api/` decodes with
it too, and a feature does `import type` — erased by esbuild.
**Rename a field in the Schema and both `tsc` runs fail** — DTO drift is a compile error,
not a runtime surprise.

**A new shape goes in the slice whose header names its feature** — each slice's first
line says what it holds. A feature no header names is a new slice, and a new slice needs an
override of its own in the root `.oxlintrc.json` listing the slices it may import — without
one it may import no slice at all. The routes that answer with a slice live in the
`src/app/routes/` group of the same name — `where-code-goes` has the rule — and the client
calls them from a new transport file of the same name under `api/`, never from `api/http.ts`.

**A slice imports only the slices its override lists**, in one direction, and `common.ts`
imports none. A shape two slices both need goes into the one the other already imports;
into `common.ts` only when neither may import the other. A shape that would make a slice
import one it otherwise has no use for gets a slice of its own, and so does a shape a
reader outside the client takes off an engine: `reload.ts` holds the answer the `fleet`
group's `POST /api/reload` sends, so its reader does not import `fleet.ts`, and
`trak-frames.ts` holds the four stream frames a watcher decodes, so it does not import
`stream.ts` and every slice a frame carries.

**What the wire does NOT carry is part of the contract.** No `gate` (see the regression
checklist), and no synthesised values: `custody.holder` is `{ since }` only because that is
all the `Runs.holder` port reports, and a field the server would have to invent to fill is
left off instead. If the UI wants elapsed time, widen the port — do not compute it at the
boundary.

**But a value the engine can resolve, it resolves.** `AgentStepDto.waitUntil` and
`WaitingDto.until` are an instant in epoch milliseconds, never the composer's
`wait_until` spelling: the anchor a duration counts from is `Trak.planAt`, which only the
engine holds, so a client handed `PT90M` would need that anchor and the grammar as
well — a second resolution of one instant, free to disagree with the sweep's. **The
resolved field's presence is then the signal a surface reads**, which is why nothing in
`client/` matches on the engine's reserved name.

**A step's waits are not only its agent's.** `AgentStepDto.waitFor` is a wait the
composer put on the step, beside its agent's `conditions`. A surface that draws or counts
what a step waits on reads both, through `planWaits` and `waitingCount` in
`features/trak-detail/waits/`: the step's own is drawn on its rule every time, and the
agent's names only at their first sight.

**A model is one of those, and the wire's grammar is the only thing about it `client/`
may know.** `AgentStepDto.model` is what the step will actually run on — the pick made on
New Chat or at the plan gate where there was one, its agent file's `model:` otherwise.
A proposal's steps carry none, since a swap at the plan gate changes it: the gate draws
a step's pick, else `AgentDto.model` for its agent, and a continuing step the model of
the step it continues. `format/modelName.ts`
splits it on the `<provider>/<name>` the far end uses to name a CLI, and keys one glyph
off the provider; which models exist is the `["models"]` query. A map keyed by a model's
name is the map `CLAUDE.md` forbids, drawn for models instead of agents.

**A model's context window is that map again, so both rungs of it are on the wire.** A
ceiling is taken in order: `usage.contextWindow` on the turn's own ending, which is what
the CLI itself reported; then `AgentStepDto.contextWindow` beside `model`, which is the
project's `models.yaml` table; then **no ceiling** — a bar with no percentage and no
remainder, never a guessed window. Both fields are optional and either may be absent
alone.

**What fills that bar is `usage.context` and nothing computed from the four counters.**
Those are the turn's spend, added over every model call, and a conversation re-read at
each call sums to several windows' worth — a step's spend routinely runs to many times
its window, so a percentage taken from it draws past the end of the bar and reads as a
layout fault. `usage.context` is a reading the engine took at the turn's last model call;
a turn carrying none has an *unmeasured* window, which is not an empty one.

**Fold spend on `"usage" in e`, never on a list of tags.** Every ending but `Restarted`
carries it — the three a turn writes for itself and the four a person's press writes by
killing one, `HumanActed` and `Abandoned` among them only where a `sessionId` says a turn
was killed — and `Restarted` carries none by decision. A narrower test silently stops
counting the day another gains the field, which is a total that quietly drifts low rather
than a screen that breaks. The list receives no log to fold and draws no spend at all:
`TrakSummaryDto.context` is the reading at the position the trak stands at, over the window
the engine resolved for it, and the row's ring is that fraction and nothing scaled against
other rows.

**A turn that has not ended is on `TrakDetailDto.inFlight`, and it is laid over the log,
never folded into it.** The run record is where the engine keeps a running turn's spend,
so it rides the detail as daemon memory beside `custody`, and `InFlight` is its frame — a
release with no `turn` when the turn ends, after its ending is on the log. `liveSpend` in
`tokens/usage.ts` is the only reader: it answers for the row whose position the turn
names and whose status is `running`, so a reading never draws on another position's
meter, and the moment an `Appended` moves the state the overlay stops — the ending's own
`usage` is on the log by then, and counting both would be the one double-count in the
fold. Its `estimate` is added to its `usage` counters for the spend figure and is never a
context reading.

**`AgentStepDto.effort` beside it is one of the CLI's own levels, carried whole.** Draw
it as it arrived: `client/` holds no list of levels and no ordering, so abbreviating one
or placing it on a scale invents a fact the wire does not carry.

**An attached file is uploaded on its own before the message is sent, and the message
carries only ids.** The upload is `POST /api/attachments?name=<file name>` with the raw
bytes as the body and the file's type as `content-type`, answered by
`AttachmentUploadedDto` or by `AttachmentRefusedDto` on 413 or 415. Each message request
then sends `attachments: string[]` at the top level of its body, and only when it holds an
id. More than `MAX_ATTACHMENTS` ids, or an id the engine no longer holds, is refused 422.
**Refuse before uploading with `attachmentRefusal` from `@orkestra/shared/dto/attachments`**
— the function the route asks too, so both ends refuse the same files. A limit written a
second time in `client/` is free to disagree with it.

**A sent message's files come back on the item that carries it**, as `attachments:
AttachmentDto[]`. `path` is relative to the checkout the turn ran in, and a trak's image
draws through `/api/traks/:id/image?path=`, which serves nothing once that checkout is
gone. A new surface that takes a message gets the controls by passing `useAttachments`'
answer as `ChatBar`'s `attach` — `client/src/components/README.md`.

**The requirements list arrives unfolded, and folding it is the client's.** Every
`RecordedDto` the engine recorded is on the wire, superseded ones included, so a screen
that maps the array draws a requirement every other reader has withdrawn. Drop each entry
whose `id` appears in another's `supersedes` — `standing` in `TrakDetailsView.tsx` — and
key the list by `id`, which is also the name to show, because that is what a later entry
names it by.

## Effect in the client — types everywhere, the runtime only at the seam

**`effect` is a real dependency of `client/`, imported as a value only under `api/`.**
Everywhere else it is `import type`, erased by esbuild. TanStack Query already owns async
state, retries, dedupe, caching and polling, so an `Effect.runPromise` inside a `queryFn`
is Effect reduced to a promise-builder.

**The exception is decoding in `api/`.** Type-only imports make DTO drift a
*compile-time* guard, which is worth nothing at runtime: `res.json()` trusts the server
completely, and the two shipping modes this is aimed at — a Tauri app with a stale
background `serve`, a hosted deploy one version behind — are exactly where that trust
breaks, surfacing as undefined-field access in a component instead of one error at the
boundary. `Schema.decodeUnknownSync(TrakDetailDto)` costs bundle size and buys a legible
failure, and it throws, which is precisely how a `queryFn` reports a bad response.
Redefining the shapes in zod/valibot reintroduces the drift `shared/` exists to kill.

**Enforced, not remembered**: `no-restricted-imports` permits *value* imports of `effect`
under `client/src/api/**` only, the same shape as the `fetch` ban. Otherwise it erodes the
first time a component wants `Option`.

**Do not model the state machine twice.** The temptation Effect brings is a client-side
`decide` so the UI can predict transitions. Derive from what the server reports; never
predict. A second copy of the machine multiplies every class of bug a single misread
field causes.

## Lint relaxations for `client/` only

Five, and the list is closed — a sixth needs a reason in the config, not a quiet edit:

| Rule | Why relaxed in `client/` |
|---|---|
| `unicorn/no-null` | React refs are `useRef<T>(null)`; `createRef` returns `null` |
| `exactOptionalPropertyTypes` (tsconfig) | passing `undefined` to optional props is idiomatic React |
| `import/no-default-export` (`.tsx` only) | components default-export; `.ts` files keep named exports |
| `react/react-in-jsx-scope` | enabling the `react` plugin switches this on, and it encodes the *classic* JSX runtime. `tsconfig.json` sets `jsx: "react-jsx"`, where the compiler injects the factory and an explicit `import React` is dead weight. Matching the rule to the transform, not loosening a boundary |
| `import/no-unassigned-import` (`**/*.css` only) | `import "./styles.css"` has no binding to assign — that *is* how Vite pulls a stylesheet into the graph. Scoped to CSS, so an unassigned import of a module is still an error |

**Kept unchanged: `max-lines-per-function: 100`.** It is the forcing function to split a
component — a 100-line `.tsx` of mostly JSX is the signal to extract a `<View>`.

**Kept unchanged, with per-site opt-outs: `react/no-array-index-key`.** The log, the
transcript, an answer list and the rows of a fenced block are append-only and positional,
with no id on the wire — the one shape React's own guidance allows an index key for, and
the alternative is fabricating an id at the boundary. So `// oxlint-disable-next-line` per site, never the rule off: a
list that *can* reorder must still fail.

Added: the `react` plugin's rules (`rules-of-hooks`, `exhaustive-deps`, `jsx-key`). There
is no separate react-hooks plugin in oxlint — the hooks rules carry the `react/` prefix.

**`no-console` is inherited only because `client/.oxlintrc.json` says `extends`.** A
nested oxlint config replaces the root one rather than layering on it, so deleting that
line leaves `client/` with almost none of the engine's rules and nothing reports it.

So: **never restate an engine rule here** — it drifts from the root copy silently. An
entry file needing `no-console` off is an `overrides` exemption, as `.oxlintrc.json` does
for `src/serve.ts`; never blanket-disable it for components.

**`fetch` needs `no-restricted-globals`, not `no-restricted-imports`** — nothing imports a
global. The import ban covers `node:http`, `undici`, `@tauri-apps/**`, `effect` and
`@orkestra/shared` with its `dto/*` slices; the last two use `allowTypeImports: true`, which is what makes "types
anywhere, values only at the seam" enforceable.

**Bans are restrict-everywhere, then exempt `src/api/**`** — not listed against
`features/**` and `components/**`. Enumerating today's directories leaves tomorrow's
ungoverned.

## Styling — Tailwind v4, tokens in one file

**`client/src/styles.css` is the only token file.** No `tailwind.config.js`, no PostCSS —
v4 declares its theme in CSS. A component needing a value the file does not name adds a
token, not an arbitrary utility (`bg-[#123456]`, `text-[13px]`). Tokens are trimmed from
the Rust Orkestra's Forge.

Each of these has a silent failure behind it:

| Rule | What goes wrong otherwise |
|---|---|
| **`@theme`, never `@theme inline`** | plain `@theme` compiles `bg-canvas` to `var(--color-canvas)`, so the `prefers-color-scheme` block flips it. `inline` bakes the literal value in and dark mode silently does nothing |
| **Whole literal class names** | Tailwind finds classes by scanning source text. `` `text-tone-${tone}` `` emits no CSS at all — the element renders uncoloured. This is why `toneClass` is a lookup table |
| **No RGB-channel convention** | Forge stores opacity-capable colours as bare channels because v3 needed `rgb(var(--x) / <alpha-value>)`. v4 uses `color-mix()`, so plain hex works with `bg-accent/40`. Do not reintroduce channels; the "hex breaks opacity" hazard does not exist here |
| **Text tokens are `fg`** | Forge nests them under `text`, so the utility doubles the word and the natural-looking `text-primary` silently renders browser defaults. `text-fg-muted` cannot fail that way |

Colour lives in the token file and in `format/tone.ts`'s `Record<Tone, string>`, never in
components. **SVG takes a paint, not a class, and the answer is still the token**:
a fill is a whole variable name such as `var(--color-tone-bad)` — a constructed
`var(--color-tone-${t})` resolves to nothing and the shape renders black. Dark mode is
`prefers-color-scheme` only — no class toggle, matching Forge's own `darkMode: 'media'` —
so a `dark:` variant at a call site should be rare to absent.

`tailwindcss` is in `knip.json`'s `ignoreDependencies` for `client`: it is used only by
`@import "tailwindcss"`, and knip does not follow imports inside CSS.

**A z-index is not a layout utility — every one sits on a rung.** `components/README.md`'s
layering section names the four (10 raised inside its own surface, 20 a band the content
passes under, 30 the drawer, 40 over the window) and the one sealed exemption. A popover
stays in the tree of whatever opened it, so **rank the band, never the panel**: a panel that
loses to chrome it is not inside met that chrome at equal rank, and raising the panel's own
number fixes nothing a rank on its host would not — which is how a card's pinned header came
to draw over the trak header's open picker. **Ranking a band adds a stacking context**, so
check first that no `fixed` descendant renders inside it: it would be clamped to the band's
rung and lose to the drawer.

**Nothing above a `fixed` overlay may carry `transform`, `filter`, `backdrop-filter`,
`will-change` or `contain`.** `Lightbox` and `ChangeSheet` are `fixed inset-0` in the
caller's own tree with no portal, so any one of those on any ancestor becomes their
containing block and the overlay draws inside that ancestor instead of over the window.
`translateX(0px)` counts — the identity transform is still a transform, which is how the
drawer's pane acquired the fault while looking motionless. `Lightbox.tsx` carries the rule.
**Only tier 3 can see it**: happy-dom reports every box as 0, and an atelier proof has no
ancestor chain to be wrong, so a green `verify` and a clean shot both pass a broken
overlay. `app.spec.ts` measures the opened overlay's box against the viewport.

**Every overlay carries `role="dialog"` or `role="menu"`.** In Orkestra.app a hosted
process's page, and a trak's pull request, is a native view the shell draws above the
whole window, and `useNativePage` hides it only while an element with one of those roles
overlaps the pane. An overlay without one opens underneath the page, and nothing outside
the app shows it: the browser draws an `<iframe>` there instead, or no pull request tab.

**A markdown link opens the side panel only through `panelLink`.** `SideDrawer` provides
`MarkdownLinks` around the whole trak screen except on a phone, so markdown portalled
outside its children opens the browser. A panel item a link should reach is a case in
`panelLink`, never an `onClick` on an `<a>`. The renderer prevents the default only once
`follow` answers `true`, because the shell opens the system browser for any new window the
page does not stop. An open page loads a new address only when its run key changes, so a
press that deep-links moves the key.

**Chrome a surface makes redundant slides out rather than unmounting.** The position rail
is withheld on the map, which already draws every position at full size. Collapsing rather
than unmounting is what the person asked for — it leaves rather than vanishes — and it owes
three things:

| owes | because |
| --- | --- |
| `aria-hidden` and `inert` by hand, and kept on | a collapsed thing is still in the focus order, still in the accessibility tree and still hit-testable |
| a render test that asks whether it is _collapsed_, never whether it is _there_ — a role query is that test, because happy-dom honours the `inert` above | happy-dom loads no stylesheet, so it is present to every tier-2 query on every surface |
| a width per surface on the content beside it, not one width for both | one width leaves the strip's 48px dead behind it, and a control at that edge — a send, an Approve, a scrollbar — is unreachable |

**Two things that travel together share one duration and transition different properties.**
`Rail` exports `SLIDE` so the strip and the pane cannot move at different speeds. The strip
moves by `transform` because it is the pane's _sibling_ and contains nothing of the pane's;
the pane moves by `margin-left` because it is the overlay's ancestor and the rule above
forbids it a transform. **Neither may change width during the move** — the surface change
swaps the content on the frame the move starts, so each is laid out at its final width from
its first frame and the `Drawer`'s `overflow-hidden` clips whichever edge is out.

**Every engine rule not contradicted above still applies — when this file is silent, defer
to `house-style`** rather than re-deriving.

## Three pages out of one build — the app and the desktop shell's two

`client/` has three entries: `main.tsx` under `index.html`, the app the engine serves;
`launcher.tsx` under `launcher.html`, the macOS shell's launch window; and `rail.tsx` under
`rail.html`, the page every other window of the shell loads — the project rail, and the
pane for a project with no client to show. The other two are in this package beside the
app for one reason — so they draw with these components and these tokens rather than a
copy of them under `desktop/`.

**`rail.html` is `launcher.html` again in every row below**, with `api/rail.ts` and
`shared/src/rail.ts` as its seam and contract, and it carries the launch window's bridge
as well. What it adds: each started project is this same app in a native view the shell
lays over the page's pane, so the page says where the pane is (`usePane`) and draws it
only for a project that is starting, failed or refused, or for a window holding none.

**A host may serve `rail.html` with no bridge on it**, and both seams then read the host's
HTTP API through the `hostTransport` slot. The state says what differs, so no hook or view
asks which transport answered: a host's started project carries an `href`, which the page
frames itself — one frame per project shown, hidden and `inert` rather than unmounted so
each keeps its place — and a host's list is `host`. The open project is `?project=<id>` in
the page's address.

`features/rail/` imports the list's sectioning and the launch window's rows and hooks —
the imports across features in `client/`, each because a copy would be a second answer.

Everything different about it, and each line is load-bearing:

| | |
|---|---|
| Electron loads it off disk | `vite.config.ts`'s `base: "./"` writes every page's asset URLs relative, because under `file://` an absolute `/assets/…` names the filesystem root. `index.html` alone carries a `<base href="/">`, which this page must not: on disk it would name the filesystem root again |
| its transport is a preload bridge | `api/launcher.ts`, and `window.orkestra` is undefined anywhere else. The shape it carries is `shared/src/launcher.ts`, because `client/` and `desktop/` may not import each other |
| the engine serves it regardless | it is a file in `client/dist`, so `/launcher.html` answers over the network with no bridge on it. The seam reports that absence as a query error — a page that drew an empty list instead would read as *you have no projects* |
| no router, no stream, no persistence | one screen, and no engine is running while it draws. It mounts its own `QueryClient` |
| a host may serve it as well | so it has a phone layout, and only there — below |

## Slots — where a host draws into a public screen

**Where a public screen draws something only a host fills, it calls a slot from
`client/src/slots.tsx`**: a component whose default draws nothing — or, where one screen
draws the host's part in several places, a hook whose default answer draws nothing, as the
rail's `useHostRail` is. A host's build swaps the file for one that exports the same names
with the same props. No registry and no lookup at runtime.

- **A new host part of the rail is a field of `HostRail`, not a new slot.** `NO_HOST` in
  `slots.tsx` answers the field with nothing.
- **A slot's gates stay public.** `TrakBand` and `GoalBand` draw exactly where `ownership`
  is set, and every press that gives way to them reads `ownership` itself.

## Phone and desk — one 640px seam

**The app installs to a home screen, so a screen that only reads at desk width is
unfinished.** 375px is the narrowest viewport in scope.

**The launch window is the one page exempt, and its host is what earns that** — nothing
but `Orkestra.app` can show it, so no phone viewport exists to hold it to; a launch window
narrowed to its 380px minimum is the survival width instead. Anything the engine or a host
serves has no such argument.

**The rail page draws its phone layout only for a host's list.** On a phone a host's page
swaps the rail for a header across the top that opens a sheet of projects. Over a project's
traks list that header is the only one, carrying the frame's search, and the frame draws no
bar — the two documents speak through `api/frame.ts`; over any other screen it is the strip
above that screen's own header. A window of
`Orkestra.app` narrowed past the breakpoint keeps its rail, because the shell lays a native
view over the pane and a sheet the page drew would open underneath it.

**The seam is stated in three places and nothing checks that they agree** — `usePhone`'s
`(max-width: 639.98px)`, Tailwind's own `sm` boundary behind every `max-sm:` variant, and
the raw media query at the foot of `styles.css`. A component the hook removes while a
`max-sm:` rule still styles it is a layout half-switched, and every test passes.

| The difference is | Say it with |
|---|---|
| structural — a component in the tree or not | `usePhone`, passed down as a prop |
| cosmetic — a size, a spacing, a hidden label | a `max-sm:` variant |

**Structural swaps go through the hook so only one layout is in the tree.** happy-dom loads no
stylesheet, so a phone layout merely hidden by CSS is *visible* to every tier-2 query, and
the page's controls are found twice.

**A figure keys on its own width instead**, and figures and `ScreenHeader` are the only
things in the client that do. `ScreenHeader` folds its actions row into its title row at
`@6xl` (1152px), because the same trak header is the whole drawer or the 440px column
beside the side panel, and the window cannot tell which. `MarkedTable`, `ArchitectureMap`, `Walkthrough` and `ChangeMap` are each a
`@container` and switch at `@xl:` (576px), because each is drawn inside a drawer as narrow as 570px on a
desk and inside a message bubble narrower still, where the viewport says nothing about the
box. `ChangeMap` also swaps one structure — a file's lines nested under its row, or a
drill-in replacing the list — so it measures its own width with a `ResizeObserver` for
that. Every other figure's two layouts are one tree, so a tier-2 test of `MarkedTable` finds a
column's head twice — in the header and as each cell's label. A figure's parser in
`format/` is half of a grammar the engine teaches; `prompts-are-files` has the other half
and the steps for adding one.

**The top bar carries one press below the breakpoint — the search glyph — and no other**,
so a destination reachable only from the app bar's slot is reachable on a phone only by
typing its URL. `AppChrome`'s slot
is `max-sm:hidden` and the phone's doors sit at the foot, under the thumb, in the list's
own `Dock`. Nothing fails when a new one is added without a phone door: the slot still
renders and every test at desk width passes.

**A control whose effect lands on the engine's own machine is drawn only above the
breakpoint, and that is the only gate there is.** Opening a terminal or an editor at a
checkout puts a window on the machine the engine runs on — never on the phone or the
tunnelled browser looking at it — and the engine cannot tell those apart, since a tunnel
client reaches it over loopback exactly like a local browser.
So where the viewer is sitting is unknowable, and the phone layout is the one viewer
known not to be at that desk. Gate the query too, not only the drawing:
`useOpenerListing` takes `usePhone`'s answer as `enabled`, because the route behind it
runs a `plutil` per installed application.

**Width decides the layout; `(pointer: coarse)` decides the input.** They are different
questions and an iPad with a keyboard attached is why — it is a wide viewport with a fine
pointer. `ChatBar` reads the pointer at the keystroke: Enter sends on a hardware keyboard
and breaks the line on a touch one, where there is no Shift to reach for and the send
button spends money.

**On a phone a confirmation is `ConfirmSheet`**, the shared bottom sheet, never
`Confirmation` floated in a panel; the caller picks between them from `usePhone`. **A sheet
asked from a band's `⋯` is drawn by the page, after the pane, never by the band**: the item
shuts the popover and reports what it asks. Mounted inside its band, the sheet ranks at the
band's rung and every later band at that rung paints over it. `components/README.md` has the
detail.

**44×44 CSS px is the floor for anything that acts** below the breakpoint — `max-sm:min-h-11`
on `Button`, `MenuItem` and the login input, and a `calc` on `TabBar`, which draws its own
`border-y` and so measures 42 at a plain `h-11`. A control drawn outside those primitives
carries the class by hand.

**Something smaller than the floor that looks pressable must not be the press.** `Switch`
is the case — 26×16, so it takes no `onClick` and no `role`, and the row it sits in is the
control that clears the floor and carries the `aria-checked` a screen reader reads.

**A press added to a fixed-height band grows the band, not the hit target.** The check
console's is 32px on a desk and `max-sm:h-11` below the breakpoint, because a target grown
past its box is clipped by the card's `overflow-hidden` — it would measure 44 in CSS and
32 on glass, and `getBoundingClientRect()` reads the CSS, so the suite below would pass on
a press a thumb misses.

**A touch area grown past its box by an invisible `before:` must not take a neighbour's
taps.** A positioned reach paints over an unpositioned neighbour drawn before it, so the
neighbour needs `relative z-10`. A hit test is the only thing that sees the overlap, which
is why `phone.spec.ts` taps each of the directive's arrows low.

**On a phone a trak's position rail is a strip with a directive block under it, on the
Agent tab only.** The directive's ‹ and › are the way to move; every mark and tile also
moves, but is too small to aim at. The directive is one 44px row — ‹, the mark, the
instruction, › — and names only the position on screen, with no state in words: the mark's
tone carries it, another piece running is the strip's tiles to show, and a count of
background jobs is its corner numeral.

**On a phone everything above a trak's pane stays pinned** — the header, the surface tabs,
the strip and the directive block, on every surface (`TrakDetailPage`'s `chromeFor`). Room
for the pane is found by making what is below the chrome smaller, never by scrolling or
collapsing the chrome: the person rejected every such design. **The one exception is a
field with the keyboard up**: while any field under the chrome has focus, the whole chrome
hides, and it comes back when the field lets go (`useTyping`). Something new above a
trak's pane goes in that chrome, and is paid for out of the pane.

**Content clears the notch and the home indicator through the spacing tokens**, never
`env()` at a call site: `pt-safe-t`, `pb-safe-b`, and `pb-foot` where a bar pays the
bottom inset for the content above it. They compute to 0 on a desk, so they sit on shared
chrome unconditionally rather than behind a variant. **A surface at the bottom edge of the
screen must name its payer** — `DrawerPane` pays `pb-safe-b` at exactly the two altitudes
where no chat bar is drawn under it.

**A token derived from a safe area reads the base token, never `env()` a second time** —
`--spacing-foot` is `calc(16px + var(--spacing-safe-b))`. `phone.spec.ts` simulates a
device by overriding `--spacing-safe-b`, so a second `env()` is an inset the suite cannot
see move, and the padding it pays for goes unmeasured with every case green.

**Nothing below tier 3 can see any of this**, because happy-dom reports every box as 0. The
touch floor, the layout at 375px and the insets are held only by `client/e2e/phone.spec.ts`, which
measures `getBoundingClientRect()` and computed style. It enumerates its controls by
hand, so one added later is unmeasured until someone adds it there.

## Proofs — a picture of a change, and what it cannot show

**A change a person can see ships with a picture of it.** A proof is one throwaway file
under `.atelier/proof/` that imports the real component and renders it against invented
data. Look at what came back, and embed the shot in your document:
`![what it shows](.atelier/proof/.shots/<name>.png)` draws at the gate, so the person
approving the work sees the screen while they can still act on it. Name the proof as you
seed it, with `--as`, because everything after this is keyed to that name.
`witty-jade-otter` below is a stand-in for your own trak, not a name to copy:

```bash
atelier proof client/src/components/Button.tsx --as button-witty-jade-otter
atelier check proof/button-witty-jade-otter # does it render? console clean?
atelier shot proof/button-witty-jade-otter  # → .atelier/proof/.shots/<name>.png
```

**Anything with a phone layout owes a second shot at `atelier shot --width 390`.** A
desk-width picture of a screen that also has a phone composition is evidence about half
the change, and the phone half is the one nothing below the browser tier can see.

`.agents/skills/atelier-proof/SKILL.md` has the workflow and the ways a proof lies —
chiefly that a component's layout usually lives in its *parent's* selectors, so one
imported on its own renders cleanly as something that is not in the app.

**A proof cannot see a fault that an ancestor causes**, because it has no ancestor chain
to be wrong — it shows the good case whatever the app does. The `fixed` overlay under a
transformed parent, above, is the one this client has shipped. Do not offer a shot as
evidence about anything above the component it imports.

**Neither `atelier` skill is ours to edit.** The CLI rewrites both `SKILL.md` files from
its own templates on every invocation, so a rule added there is deleted by the next
`atelier shot` anyone runs. A proof rule this project needs goes here.

**The name is `<subject>-<trak>`, forty characters at the outside.** The pull-request
step publishes every proof on the branch, and the public address is built from the
filename and nothing else, so past forty — where that address is cut — two traks
silently overwrite each other's picture. `<trak>` is this trak's whole name, all three
words of it — the directory you are working in is named for it, and so is the branch
after `trak/`. The mint redraws until the whole name is unused and guarantees nothing
about any one word, so two traks sharing an adjective are ordinary rather than a
coincidence. A legacy trak named with a UUID takes that UUID's first eight characters
instead. The subject gets what is left of forty — twenty-three characters beside
`witty-jade-otter` above, ten beside a three-word name at its longest. **Shorten the
subject, never the trak.**

**A reviewer's proof opens its subject with `look-`** — `look-button-witty-jade-otter`,
inside the same forty. The builder's proof is on the same branch under the same trak,
so a reviewer reusing its subject overwrites the builder's picture with no error.

**Leave the file where it is when you have looked**: a proof is kept until the pull
request is open, whatever `atelier` says about deleting it. `.atelier/proof/` is
git-ignored, so it never reaches the diff and it dies with the checkout.

## Tests — tier-1 beside, tier-2 RTL, tier-3 deferred

Tier definitions live in `testing-tiers`; this section says where client tests go.

| Tier | File | What it touches |
|---|---|---|
| 1 — pure | `*.test.ts` beside the pure file | one function, no React, no `fetch` |
| 2 — transport | `client/src/api/transport.test.ts` | MSW, no DOM; handlers import `@orkestra/shared` types |
| 2 — render/hook | `*.test.tsx` beside the component or hook | RTL + MSW; handlers import `@orkestra/shared` types |
| 2 — composition | `client/src/App.test.tsx` | the real `<App/>` — the provider tree and the root route together |
| 2 — phone layout | `*.phone.test.tsx` beside the page | RTL with `matchMedia` stubbed — which branch drew, never a measurement |
| 3 — E2E | `client/e2e/*.spec.ts` | `pnpm ui:both` and a real browser, at two viewports — on GitHub, not in `verify` |

**Build a DTO with `client/src/fixtures.ts`, not by hand.** One `make*` per wire shape,
each taking a `Partial` of everything but the discriminant, so a test writes the fields the
case is about and nothing else. It is kind `pure` — `api/types` and nothing else — because
a DTO is a plain object with no Schema to decode.

- **Never assert on a value it generated.** `id` and `sessionId` come from a counter, so a
  test that cares about one passes it in.
- **Two places hand-write literals on purpose.** `api/transport.test.ts` is one — the wire
  shape *is* what that tier tests, and a builder would be testing the builder. An expected
  value in a `toEqual` is the other: a builder's defaults would silently widen what is
  being asserted.

**A `*.fixtures.ts` file is the atelier's, and is found rather than imported.** Each export
is a knob option matched to a prop by assignability, so those files export *values* and the
factory they call exports functions — see `.agents/skills/atelier/references/catalogue.md`.
Nothing imports them, which is why they and `atelier.wrapper.tsx` are in `knip.json`'s
`ignore`: their consumer is a discovery walk outside the graph knip is given.

**A page test cannot see the app.** It builds its own `createRouter` around `routeTree`,
which is right — a page *is* a route component — and it means nothing below tier 3 ever
renders `App`. That gap shipped a blank page once. `App.test.tsx` is the cheap half of
the fix: it mounts the composition and asserts something drew.

**Tier 3 is in `verify` and must stay free.** It boots the real engine against this
checkout's real `.orkestra/.database/`, so a spec that clicked a control which spends
would run a composer and bill for it. Read, navigate and type; never submit. It needs a
browser on the machine — `playwright install chromium`. Two projects split by file:
`app.spec.ts` at the default desktop viewport, `phone.spec.ts` at 375×667 with a coarse
pointer. A part only a slot draws — the ownership band, a host's rail — draws nothing
under this config, so no spec here can measure it.

**A phone tier-2 test stubs `matchMedia`, and the stub must answer one query at a time.**
happy-dom answers it for a 1024px window, so `usePhone` reads desktop, which is what every
other page test is written against. Match on `(max-width` rather than returning
`true`: a stub that says yes to everything also says `(pointer: coarse)`, which turns off
Enter-to-send in a test that is about the layout.

**The environment is `happy-dom`, and one file opts out.** `api/transport.test.ts` carries
a `// @vitest-environment node` docblock, because that tier is *defined* by touching no DOM.
That is the only exemption; a new one needs the same kind of reason. happy-dom rather than
jsdom for cost — `client/vitest.config.ts` says why.

**Node's `fetch` throws on a relative URL before MSW can see it**, which is what the
node-environment seam test runs on. So `api/http.ts` resolves each path against
`document.baseURI` itself, which happy-dom supplies and that test stubs. **Do not add a base-URL branch to `api/http.ts`
instead**: `vite.config.ts` records why the client has no base URL to configure, and a test
runner is not a reason to reverse it. Resolve per call, not at module scope — a static
import hoists above `beforeAll`.

**A polling test needs a `window`, and the environment is where it comes from.**
query-core decides once, at module-evaluation time, whether it is on a server (`typeof
window === "undefined"`) and a server schedules no `refetchInterval` at all — so under a
`node` environment a polling test passes vacuously with the interval never armed. **Do not
move a polling test to the node environment** without re-reading this.

**A page test mounts the real `routeTree` under a memory history.** A page here is a route
component — `TrakDetailPage` reads its id through `getRouteApi` — so rendering one bare
would test something the app does not ship. `routes.ts` exports the tree for that, and
each test builds its own `QueryClient` and router: a shared cache lets one test's answer
satisfy the next.

**No snapshot tests.** One asserts everything and therefore nothing — it fails on a
reworded label, passes on a drawer that shows the wrong step's work, and the fix is always
to re-record it. Assert the two or three facts the component exists to get right.

## The regression checklist — load-bearing

These are the guards that pay for the whole spec:

1. **Every projection over a wire union is an exhaustive switch.** `trakLabel` over every
   `TrakState._tag`, `planView`'s `stepAt` and `composerStatus` over the same — so a new
   state on the server is a compile error in the client until it is handled, the same
   mechanism that makes `Command.$match` in `runtime.ts` safe. Do not replace a switch
   with a lookup table, and do not let a `default:` stand in for the cases nobody has
   thought about yet.
2. **MSW handlers import `@orkestra/shared` types.** A handler returning a shape that
   fails the DTO is a `tsc` failure — mocks cannot silently drift from the contract.
3. **`useTraks` asserts polling stops when the last subscriber leaves**, and
   `useEngineStream` asserts the same of the stream. A poll that outlives its watcher is
   a request loop nobody reads; a *stream* that does is worse — a live socket writing
   into a cache the app has stopped rendering, and unlike a poll it never stops on its
   own. The hook takes an injectable `subscribe`, because an `EventSource` is invisible
   to MSW and a test that mocked one would be testing the mock. **What that leaves
   uncovered is the registration**, and a frame kind went missing there once: a listener
   is registered per event name, so a tag nothing registered for is dropped before any of
   this runs. `api/transport.test.ts` stubs a fake `EventSource` at the seam and asserts the
   registered names are the union's — no test that hands a frame to `applyFrame` or to
   `receiveFrame` can see it.
4. **The transport-seam lint passes.** A `fetch` in `features/**` is a failure — catches
   the slow leak where someone calls `fetch` inline.
5. **Which controls to show is a pure function of `TrakStateDto`** — an exhaustive switch
   over every state, not over a gate, asserted directly and never inferred from a rendered
   snapshot. `controls.ts` is where they live, and its test asserts the *negative* over
   every state rather than over a sample.
6. **Nothing derives "can I act?" from anything but `state`.** There is no `gate` on the
   wire and there must not be one: the engine's `Trak.lastGate` is its memory of the last
   gate and outlives it deliberately, so a guard reading it fails a healthy trak. **"May I
   act *now*" is the separate question**, it is `custody.holder`, and neither may stand in
   for the other — a crashed run stays `AgentWorking` with nobody holding it.
