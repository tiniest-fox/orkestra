---
name: testing-tiers
description: Which tier a test belongs to in orkestra and what it must assert. Read before writing any test here, before adding a fake or helper, when a test needs a Layer, when adding a provider, and before touching anything under test/.
---

# Testing

Three tiers. **Which tier a test belongs to is decided by what it touches, not by what
it covers.**

| Testing…                                   | Goes in                                | Touches                                                                         | Command      |
| ------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------- | ------------ |
| a pure function in `types/` or `logic/`    | `*.test.ts` beside the file            | one function, no services                                                       | `pnpm test`  |
| a flow through the engine                  | `test/e2e/<theme>.test.ts`             | the real engine, faked edges                                                    | `pnpm test`  |
| **an entry point that drives the engine**  | `test/e2e/<surface>.test.ts`           | the real engine, faked edges, the surface's own request/response                | `pnpm test`  |
| **how a surface reads the wire itself**    | `test/e2e/<surface>-wire.test.ts`      | a real socket on port 0, raw request lines, no `Request`                        | `pnpm test`  |
| a port's guarantees                        | `test/contract/<port>.ts`              | one suite, run per implementation                                               | `pnpm test`  |
| a real provider CLI                        | `src/smoke.ts`                         | real tokens, by hand                                                            | `pnpm smoke` |

**A surface that can move a trak is tier 2** — `test/e2e/http-api.test.ts` is the worked
example. **A surface that decides anything from the raw request target owes the wire row
as well** — `test/e2e/guard-wire.test.ts`. A test built from `new Request(url)` has had its
target tidied by the `URL` constructor before the code under test sees it, so it cannot
express `//api/traks` or an absolute-form target; the guard shipped one slash wide with a
green suite for exactly that reason. Write the bytes, and assert each spelling the router
accepts. It matches no other row (not a pure function, not quite a flow), so without
this row nobody writes it. Beyond what every flow test asserts, it owes:

1. **What it refuses.** Every 4xx path, one test each. The refusals are where the
   judgement lives; the happy path is the easy half.
2. **That a refusal changes nothing.** Assert the event log is the same length after —
   a tidy status code that still appended is the bug wearing a hat.
3. **That a second driver is turned away.** Claim custody in the test and assert the
   surface refuses. It is the only assertion that catches an unclaimed drive.

## Before you add a test

- **No real process, container, git repository or engine boot where a fake does**:
  `runFlow` on the fake `Vcs` before `onGit`,
  one `scenario` before a second engine — see Tier 2.
- **No fixed sleep and no real timeout**: move time with `settableClock` from
  `test/support/clock.ts`, and wait on a condition.
- **Import each thing from the file that defines it, never through a hub**: `library` from
  `test/support/library.ts` rather than `scenario.ts`, `mount(…)` from `test/support/http.ts`
  rather than the whole API, one wire slice rather than a union — see below.
- **A file read off disk, or a `.ts` started as a child, gets a `reads:` row**, in `.orkestra/checks/verify.select.yaml` — see below.
- **Start a child only where the recorder follows it**: in a `mkdtempSync` directory of the
  test's own, with `NODE_OPTIONS` handed on, as Node or a `fingerprint:` tool — see below.
- **No fixed port and no assumed order**: listen on port 0 and read the port back, and wait for a state rather than an exact count of
  restarts or events.
- **Make every temp folder under `os.tmpdir()`, and remove none of them** — see below.

**A vitest run owns one temp directory, and nothing else removes temp folders.**
`test/support/run-tmpdir.ts`, the `globalSetup` of every `vitest.config.ts`, points `TMPDIR`
at `ork<pid in base 36>` under the real temp directory before any worker starts, and
removes it at teardown, in an `exit` handler, and in a sweep at the start of the next run.
So a test or helper takes its folder from `mkdtempSync(join(tmpdir(), …))` and adds no
`afterAll` removal; a child it starts inherits `TMPDIR` and lands inside too, and a vitest
it starts works in the run's directory rather than making one of its own. A path that
skips `os.tmpdir()` — `/tmp`, `/var/folders`, a temp directory read before setup ran —
leaks. A new vitest config takes the same `globalSetup`. The run's directory is at most 64
bytes, so a test that opens a socket in its own folder keeps its prefix to 24 bytes, as
`orkestra-2e-wake-` does. On GitHub, the `verify` job fails on any
top-level entry the checks add to the real temp directory, except `tsx-*`, tsx's compile
cache, and `orkestra-recording-hook-<16 hex>.mjs`, which a recorded check keeps on purpose. A
new file kept there on purpose is added to that exemption in `.github/workflows/checks.yml`.

`pnpm vitest run <file> --reporter=verbose` prints each test's time and the file's
`Duration` — for a client file, run it from `client/`. Hold both to the test-time
targets below.

## Tier 1 — beside the code

`src/agent/logic/extract.test.ts` next to `extract.ts`: a test that has to be _found_
gets deleted instead of updated.

**Only `types/` and `logic/` files earn tier-1 tests.** **If you build a `Layer` inside
a `*.test.ts` next to source, the test is in the wrong tier.**

Assert on values, not narrowed fields — `expect(events).toMatchObject([{ _tag:
"SessionStarted", id }])` also pins what _isn't_ there. Lint enforces it
(`vitest/no-conditional-expect`).

## Tier 2 — the real engine, faked edges

Real `decide`, `replayHistory`, `advance`, real prompt assembly. Faked: the provider,
the store, the id generator, and the `Vcs` unless the test asks for git. No subprocess,
and no clock but the settable one below.

```
test/
  support/
    scripted-agent.ts   a provider fake matching on the REQUEST, not call order
    scenario.ts         the harness: memory store, fixed ids, expect* helpers
    library.ts          the fixture `Library` every flow runs against
    flow.ts             turn builders — composer(), step() — and runFlow()
    vcs-snapshots.ts    the fake Vcs: history in memory, checkouts on disk
    prompt-log.ts       writes the per-test prompt transcript
    sim-states.ts       the states `pnpm sim` seeds, reached by pressing the real engine
  e2e/                  one theme per file
  contract/             a port's contract, written once
  fixtures/
```

**The fake matches on the request, not on call order.** When the engine calls the agent
in an order you did not expect, the test fails on _the unexpected request_ rather than
silently handing back the wrong reply.

**What a flow test must assert, because final state alone hides it:**

1. **The event log** — `expect(yield* logTags(id)).toEqual([…])` catches an extra spawn,
   a missing gate, or a retry that leaked into the log.
2. **The session id** — catches a retry that started a fresh conversation instead of
   resuming.

**`runFlow` runs on the fake `Vcs`; `onGit.runFlow` runs on `GitCliLayer` in a
throwaway repository.** Take `onGit` when git is the subject — a branch, a merge, a
remote, a commit an agent makes in its checkout, git's patch text — or when the test
reads the repository with `git`. The fake answers what the port promises and nothing
more; its header lists what it leaves out. A test that needs one of those either runs
`onGit`, or widens the fake together with a shared `vcsContract` case that git passes
too.

**`scenario` provides `PublicPeopleLayer`**, as `pnpm serve` runs it, so a flow sees and
presses everything.

**Test-time targets:**

| Measure                                                 | Target                                                                                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Full engine run (`pnpm test` at the root)               | 2 minutes or less, on an idle machine                                                                                       |
| Slowest single test                                     | 2 s or less                                                                                                                 |
| Slowest test file                                       | 10 s or less                                                                                                                |
| `verify-light` after a docs-only edit                   | 0 tests                                                                                                                     |
| `verify-light` after a one-slice edit                   | 30 test files or fewer, 60 s or less                                                                                        |
| `verify-light` after an edit to a shared or common file | no fixed limit; reported                                                                                                    |
| Reliability                                             | three green `checks` runs on `main` in a row; no test fails in 20 full engine runs under a load of up to 2 × the core count |

The targets are soft: nothing gates on them, and a miss is reported and worked on. A new
or changed test is held to them. A test that would exceed them belongs in a lower tier or
needs a stated reason.

**The reliability target's load is up to 2 × the core count** — about 8 on a 4-core
machine. A test that fails only above that load is not a reliability failure, and a
real-process test is held to passing up to that load, not beyond it.

**Slices over the one-slice target**, because the tests they select really run them:

| Slice                                                                              | Files                            | Why                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/workflow/ports/passes.ts`                                                     | about 80                         | `runtime.ts` reads `Passes` for every check it runs, and `scenario.ts` builds every flow on `passes-memory.ts`                                                                                                                                                                                                                                                                                       |
| `src/workflow/ports/locks.ts`, and the other ports `runtime.ts` or `drive.ts` take | about 70–80                      | every flow test runs `runtime.ts` and `drive.ts`; only fewer tests through `scenario.ts` lowers it                                                                                                                                                                                                                                                                                                   |
| `src/agent/logic/meter.ts`, `src/agent/ports/diagrams.ts`                          | about 75                         | every turn `runtime.ts` runs folds each provider event through `metered` and checks its diagrams through `Diagrams`, and `scenario.ts` provides the fake `Diagrams` to every flow. A port in front of `metered` would be provided by `scenario.ts` too, so it would select the same files                                                                                                            |
| `shared/src/dto/host-engine.ts` | not measured | `push.ts`, `guard.ts` and `routes/host.ts` decode its shapes, and every engine assembly holds them |
| `shared/src/dto/trak-frames.ts`                                                    | about 50                         | the engine builds the frames in `src/app/dto.ts` and `routes/stream.ts`, so every test that serves the API runs them, and `src/supervisor/watch.ts` decodes them                                                                                                                                                                                                                                          |
| `shared/src/dto/goals.ts`, `shared/src/dto/usage.ts`                               | about 30 engine and 20–23 client | the engine files are the tests that serve the API, plus `sim.test.ts`, which starts a whole engine. Every client page test mounts `routes.ts`, which imports every page, and the traks list page reads goals and usage; each such file pays about 1 s of import against 0.2 s of happy-dom. A `shared/` edit also runs every project's static stages first, about 25 s |

**A test that needs a `Library` and runs no flow takes `library` from
`test/support/library.ts`**, never from `scenario.ts`, which imports `runtime.ts`. The
check, runner and sandbox tests that took it from `scenario.ts` were 22 files in the
selection of every edit the runtime reaches.

**A port only some assemblies offer stays out of `drive.ts` and `runtime.ts`.** `Leases`
exists only under an external store, so `drive.ts` reads `OtherCopies`, built over it in
`src/app/other-copies.ts`, rather than importing it — and an edit to the port selects
about 13 files rather than 98.

**A module that decodes some members of a wire union imports those members from a slice of
their own**, never the whole union. The supervisor's watcher decodes four stream frames, from
`trak-frames.ts`. Decoding all of `stream.ts` puts every test of the watcher in the selection
of each slice a frame carries.

**Exempt from the per-test and per-file targets**, for the reason in each row:

| Files                                                                                                 | Why                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/e2e/fingerprints.test.ts`, `fingerprints-reaching`, `fingerprints-runner`, `fingerprints-carry` | each case is real nested vitest runs under the recording hook                                                                                                                                                                                                                    |
| `test/verify-light*.test.ts`                                                                          | each case runs `verify-light.sh` whole: real git, the stage runner started twice, to list what changed and to run, and vitest for each suite. A case takes 1.5–3 s alone, so a file of five or six cases passes 10 s under load                                                  |
| `test/e2e/http-api.test.ts`                                                                           | over 10 s only under load. Each flow boots its own `scenario`, about 10 ms of CPU, and cannot share one: every flow uses the id `scenario-trak` and many read the whole list. the deferred entry *a flow test pays about ten milliseconds of boot before its body runs* holds the cut |

**A test that reads a committed file off disk with `readFile` adds that file as a `reads:`
row in `.orkestra/checks/verify.select.yaml`.** `verify-light` follows imports
alone, so without the row a change to the file runs none of its tests.

**A test that starts a `.ts` file as a child process adds a `run:<entry>` row to the same
table**, naming the files that start it. What the child imports is outside vitest's graph
too, so the stage runner lists the entry's imports with esbuild, `@orkestra/shared` included,
and a change to any of them runs those readers. Name the entry as `new URL("….ts",
import.meta.url)`, or as a `src/…` or `test/…` path in a file that runs `tsx`:
`verify-light.test.ts` finds entries named those two ways and fails on one with no row. An
entry built up with `join(…)` gets past that test.

**A test that presses HTTP routes mounts only the route groups it presses** —
`mount(viewRoutes)` from `test/support/http.ts`. A test file that imports a group runs on
every edit to that group, so mounting the whole API runs it on an edit to any route. Only
a test whose subject spans the API takes `serving(apiRouter)`, as `http-api.test.ts` does.

**One theme per file**; a `flows.test.ts` is where scenarios go to be lost. **A new fake
or helper goes in `test/support/`**, never copied between themes.

**A test reads no `process.env`, clock or randomness that `vitest.config.ts`'s `env` does
not pin.** Both test checks declare `fingerprint:`, and none of the three is recorded, so a
test whose answer depends on one is skipped on its print when it should have run.

**A test file is skipped on its print only when the hook saw every input.** Anything it
cannot see makes the file unsure, and an unsure file runs every time:

- **Write only under a directory the test made** with `mkdtempSync` under `os.tmpdir()`, and
  name no fixed path such as `/srv/repo`. A write elsewhere under the temp directory is the
  `tmpdir` assumption, and a write anywhere else is unsure.
- **Spawn only Node, or a tool both checks list in `fingerprint:`.** A Node child records
  itself, and so does a script whose `#!` line runs `node` — write a fake CLI that way. A
  script the test wrote into its own directory and runs by its path counts as its `#!`
  interpreter running it, where the hook is handed on — the environment inherited, or one
  that names `NODE_OPTIONS`. A shell script's own reads, a native binary such as `esbuild`, a
  worker thread other than the one esbuild's `transformSync` starts under `tsx`, and a tool
  neither list names are unsure. A script the repository ships runs from a copy in the test's directory, so the
  tool is handed no path outside it. `verify.sh` and `verify-light.sh` keep one identical
  list, because the list is part of the print's key and the two share one store.
- **Run `git` only in a repository the test made.** `git` in the checkout answers from the
  index, which no print holds; `module-names.test.ts` reads the tree from disk for that reason.

**A native tool's reads are declared by vouching for it.** Hand the process that runs it
`ORKESTRA_RECORDING_VOUCHED=<tool>`, and its spawn is accepted with only its binary as an
input — then the test reads every file the tool read, from the tool's own account of it,
as `build.test.ts` reads esbuild's metafile. A file the test does not read is a wrong skip.
Any other input the hook cannot see is pinned in `vitest.config.ts`, which every print
holds, or the file is left unsure. A doubt the hook files as an assumption
— `ps`, `tmpdir`, `lockfile`, `gitconfig` — skips only where `CI` is unset, and nothing in
`.orkestra/` or a check script changes that.

## Prompt transcripts are a review surface, not assertions

With `ORKESTRA_PROMPT_LOGS=1` set, every flow test writes
`test/e2e/logs/<file>/<test>.xml` — the exact text each agent saw, per turn, with prompts
and replies as CDATA. Unset, nothing is written, because a write into the checkout makes
the test unsure under `fingerprint:`. Nothing asserts on them. They exist so
a prompt change is **reviewable**: assertions check a handful of substrings while a
reader sees the whole thing. They are deterministic, so a file that changed between two
runs is a real change in what an agent is told. The directory is git-ignored: read them
on the machine that ran the suite, and `git clean -xdf test/e2e/logs` before a full run
drops the orphans a renamed test leaves behind.

**Read them after touching `src/prompts/templates/`.**

## Contract tests are the multi-provider bet

Write the contract once, run it against every implementation. Adding a provider means
making an existing suite pass. **A contract test that branches on which provider it is
running is a design smell** — express the difference as a declared capability
(`supportsSessionHandoff`) the suite reads.

**The `Vcs` contract is two suites.** `vcsContract` reads every answer through the port
and the files on disk, and runs against both `GitCliLayer` and the fake.
`vcsGitContract` also reads git itself, and runs against git alone. A case that calls
`git`, needs an `origin`, or commits outside the port goes in the second. The fake is
only trusted under the flows because it passes the first, so a change to either
implementation keeps `vcs-snapshots.test.ts` green.

`provider-claude-fixtures.test.ts` and `provider-codex-fixtures.test.ts` each run the
whole contract against the real spec with only `Process` faked, and the replayer
**always exits 0** — which proves the in-band error path stands on its own. The contract
takes the `model` name that selects the implementation, because the registry indexes by
it: a second CLI's arm reaches its adapter through a qualified name and nothing else.
The Codex replayer is not a file played start to finish: the prompt reaches Codex in the
harness's reply to the thread request's answer, so `serving` prints a fixture up to that
answer and picks the rest once the reply is in — and records every line written, which
is where a Codex test reads the prompt, the model and the resume from.

**A spec that reads a file gets a real one, and the spawn's own environment is what
points at it.** Faking `Process` does not reach `sessionLog`: `cli-provider.ts` opens
that path for real, so the Codex arm writes a captured rollout into a temp directory and
hands the request `CODEX_HOME`. A `under` that cannot be redirected by an environment
variable is one no contract test can exercise without touching the person's own home.
Cover the absences too — a file named for another thread, and a home with nothing in
it — since a reading that fails to arrive must fail nothing.

Fixture provenance is part of the fixture. **Never edit a `.captured.jsonl` by hand** —
that turns evidence into fiction.

## Tier 3 — smoke, by hand, and that's the point

1. **Always `model: "haiku"`.** A smoke test proves plumbing, not quality.
2. **Assert the resume.** Session handoff is the product promise and no fake can verify
   it.
3. **Detect unrecognised stream kinds** against `test/smoke/known-kinds.json`, so an
   upstream change is a visible diff rather than a quiet degradation.
4. **An MCP server a check needs is a committed fixture, dialed with
   `--strict-mcp-config`** — `test/fixtures/mcp/view-server.ts`, which imports nothing
   outside Node and which `node` runs with its types stripped. The person's own servers
   are then never started by a check. The view check is `claude`'s alone: `pnpm smoke
--codex` has none.

## Inject time and randomness

Effect's `Clock` and `Random`, and the `Ids` port for every generated id. `randomUUID`
and `Math.random` belong in an adapter or an entry-point script — never in `domain/`,
`logic/`, an interaction, **or a mapper in `app/`**. Sessions are
`00000000-0000-4000-8000-00000000000N`, which is the only reason session-reuse is
assertable at all; a flow's trak ids are `child-N`, because nothing requires the format.

**`Ids` is a port whose fake is not the only implementation a test drives.** A
trak id is three words drawn from a wordlist and has to be checked free before it is
given, so the live layer takes the draw as an argument — a collision is scripted rather
than waited for, since random words will not collide inside a test run.

**A test that moves the clock takes `settableClock` from `test/support/clock.ts`, given
to the one call it means to shift with `Effect.withClock`** — the condition sweep is the
only such call today. Never `TestContext`: building it sets the clock for the whole fiber
for as long as its scope stands, which is the flow body, and the flow body waits on forked
drives with `idle`, whose sleep would then never come due. `settableClock` keeps the live
clock's `sleep` for that reason, and everything outside the one call keeps the live clock.

**A test asserting on a local-clock value builds the expectation with the same local
`Date` constructor the code uses** — `new Date(2026, 8, 14, 15, 7)`, never an epoch number
and never a `Z` literal. `wait_until` resolves on the local calendar in both packages, so
an expectation written in UTC passes only in the author's zone.

**A value you cannot source from a port is not a field.** A mapper that reaches for
`Date.now()` publishes the time the request was served under a name that claims
otherwise. If the port does not report it, widen the port or drop the field; never
synthesise it at the boundary.

**A test file that passed on a tree is not run again on that tree by the next tier.**
`verify.sh` runs every test stage through the engine's stage runner, which
reports each passing file as a unit under `units: vitest`, keyed with `cache_across: os`. A
suite `verify.sh` runs any other way neither skips nor records a file, and a vitest config
here names no recording setup file, because the runner lists it. So a test's result has to follow from the tracked files and the
OS: one that reads an ignored or `linguist-generated` file, the network, or the
architecture passes once and is then skipped until the tree changes.
