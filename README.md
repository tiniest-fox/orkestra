# Orkestra TS

Orkestra runs a coding agent through a pipeline it composed for the job: you
describe a trak, a composer proposes the steps, each step is a Claude Code or Codex
session that must return a schema-valid artifact, checks run against the repository, and a
human approves at the gates — unless you said you would not be there, which is what a
trak's **run mode** records and you can change as it runs. You can also skip the composer
and open a trak as a conversation with one agent you name — the plan is then that one
entry, and the trak finishes when its artifact is approved. The work happens in the trak's own git worktree, and
each approved or skipped step is committed onto the trak's own branch as it
completes — one commit per step that changed files — so the branch's history
mirrors the plan. The checkout stays there until you merge the trak or archive it.

This is a TypeScript reimplementation of Orkestra (~120k LOC Rust),
targeting the **Adaptive Pipeline** architecture rather than porting the existing
engine. **It is a working vertical spike, not production software.**

## Running it

Node 26.5.0 and pnpm 10.34.5, the versions `mise.toml` pins. Nothing below costs anything:

```bash
pnpm install
pnpm walkthrough                       # a 3-event happy path: the pure domain, then the same thing wired up
pnpm spike                             # adds a human gate, a malformed-response retry, and a restart
pnpm --filter @orkestra/client build   # the client the sim serves; without it the sim answers 503
PORT=<n> pnpm sim                      # the whole app over a temporary project, every agent turn scripted
pnpm verify                            # fmt:check → check → lint → knip → docs:check → test,
                                       # then the client's and the desktop's check → test → build
```

**A `pnpm` command refuses to run when `node_modules` does not match the lockfile**,
instead of failing part-way through on a missing import. Two states refuse: a tree
older than the lockfile — a pull you have not installed since — and a dependency added
to `package.json` and not installed, which stops every script in the workspace rather
than only one that needs it. The message names the fix:

```
 ERR_PNPM_VERIFY_DEPS_BEFORE_RUN  The installed dependencies in the modules directory is not up-to-date with the lockfile in <path>.
Run "pnpm install"
```

Run that install yourself. `pnpm install` is the one command never refused, so it always
works — and no other command repairs the tree for you, `pnpm app` included.

A pull request, a push to `main` and a button in the Actions tab each run the same chain
on GitHub (`.github/workflows/checks.yml`): `pnpm verify` in one job, and in a second the
browser tier, `pnpm --filter @orkestra/client e2e`, which runs nowhere else unless a person
runs it. Every test file runs on every run.
Nothing on GitHub spends anything.

These spawn a real agent CLI — `claude`, or `codex` for a step whose agent names a
`codex/…` model — and spend real tokens:

```bash
pnpm real:compose "<description>"   # the composer alone — one turn, no steps
pnpm real:trak "<description>"      # the whole engine, approving on your behalf
pnpm compose-lab "<description>"    # the composer for real, every other agent answered by you
pnpm ork "<description>"            # the same with nothing injected — you answer every gate
pnpm smoke                          # checks against the real CLI (~$0.08)
```

`pnpm ork` is the real thing: real permissions, real checks, and real writes to
the directory you started in. Its state survives the process, and these are what
you do to a trak afterwards. Each runs as `pnpm ork <sub>`; there is no `ork` binary:

|                                                                                                                                  |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ork list`                                                                                                                       | every live trak, where each is parked, and what a held checkout is costing you — and how many are archived, which is all the engine says of those                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ork resume <id>`                                                                                                                | pick one back up — a gate, an interrupted turn, or the position it failed at                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `ork record <id>`                                                                                                                | how one went: runs, checks, gates, cost, tokens, and where the time went. Computed from the log, so it is free and cannot disagree with it                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ork records`                                                                                                                    | every trak whose checkout is gone — merged, archived or abandoned, never merely finished — as a folder under `.orkestra/records/`: its record plus every document it filed. The ending writes its own; this rewrites the lot, which is how the corpus arrives on a checkout that ended everything before it existed, and how a format change lands                                                                                                                                                                                                                          |
| `ork merge <id>`                                                                                                                 | a finished one's branch into the branch **you are standing on** — never one it picks for you. For a spawn's child, into the parent that is waiting for it. Refuses a dirty tree without touching a branch, and says beforehand whether the merge will conflict. One that does merges nothing and sends the trak back to the composer for a plan that settles it                                                                                                                                                                                                             |
| `ork archive <id> ["<why>"]`                                                                                                     | put it away: the checkout goes, and so do the branch, its recorded base and fork refs and the branch’s copy on GitHub — after a yes. A finished one is asked about on GitHub once, so a trak whose pull request went in ends `Merged` and reaches the corpus; for a child it is the **drop** — nothing merges, and the parent is told so. One that has not finished needs the `"<why>"`, and is the only command that interrupts a turn in flight rather than being refused by it: what exists is committed, then all of it goes, so what it tried survives only in the log |
| `ork reenter <id> "<what came back>"`                                                                                            | a trak at rest, picked up on its own branch. The composer's new steps are **appended** to the ones that ran. Where its pull request merged, the branch is first rebased onto `origin/<base>` and force-pushed, so the work goes into a fresh pull request; where that cannot be done, it is refused and nothing changes                                                                                                                                                                                                                                                     |
| `ork wipe [<id>]`                                                                                                                | clear one trak, or everything                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `ork revoke-sessions`                                                                                                            | log every browser out of a gated engine, on every device                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Only `resume` and `reenter` spend anything.

## A Mac app

`desktop/` wraps the engine in an Electron shell: each window holds several projects
behind a rail of tiles down its left edge, and each project is on its own engine — started
when its tile is first selected, or attached to if something is already serving that
repository. Switching tiles keeps each project where you left it. A tile's picture is the
favicon-like file highest in the checkout, else two letters on a colour; it carries a
count of the traks waiting on you, leaving out idle ones, and a moving edge while one is
running. A project sits in one window only, and opening one another window holds brings
that window forward.
Removing a project from its window, closing the window and quitting each stop the engines
the app started. Quitting keeps every open window for the next launch, which starts only
the project each one had selected; a closed window is forgotten. With no window to put
back it opens on the projects you last worked in, one press each, with a button for a
folder that is not on the list — and a window with no projects lists the same. A recent whose folder cannot be reached is not drawn, and stays
recorded for when it can be; one that is refused when pressed — gone, not a repository,
no `.orkestra/` — becomes a tile whose pane says which check failed, and leaves the list.
Once every window is closed, File → Recent Projects… and the dock icon bring that list
back. Pressing a
link never replaces the trak you are reading: `http`, `https` and `mailto:` go to
whatever application your Mac opens them with — a deploy address, a link in an agent's
prose, including one that points back at the project's own engine — and a link on any
other scheme does nothing. Moving around the app itself stays in the window. The one
exception is a finished trak's pull request: its link opens GitHub's page in the side
panel, where a navigation on `https://github.com` stays and anything else goes out. The
panel carries the GitHub login of your default browser when that is a Chromium one — Dia,
Chrome, Arc, Brave or Edge — copied each time it opens; macOS asks once for the keychain.
Continue with Google there opens your browser to sign in.

```bash
pnpm app                                 # build and install: /Applications/Orkestra.app, plus a .dmg under desktop/build/
pnpm --filter @orkestra/desktop start    # run it from this checkout, once everything but the packaging is built
```

`pnpm app` runs five steps in order — the client bundle, the engine as one file
(`dist/serve.js`), the shell around it, packaging, then the install — and stops at the
first failure, which pnpm names. The install replaces `/Applications/Orkestra.app`, and
quits a running Orkestra first, which stops every engine that app started; if the app
is asking about a turn in flight and has not gone within thirty seconds, the install
fails with nothing replaced. The `.dmg` is for handing the build to someone else.
It is named for the version in the root `package.json` — the one number the app,
`/api/health` and `ork --version` all report, so a release is a bump there and nothing
else. It is ad-hoc signed and not notarized, so **whoever you hand it to is refused on
first launch and clears it once at System Settings → Privacy & Security → Open Anyway**;
macOS 15 removed the right-click bypass.

## How it is put together

One pure function decides everything and a thin loop does the work. `decide(trak,
event)` returns `Advance` (run these commands), `Await` (park; someone owes us an
event) or `Settle` — no I/O, no `Effect`, fully testable with no setup. State is
never stored, only derived: the event log is replayed. Everything effectful lives
behind a port with exactly one adapter.

```
src/
  agent/      run a coding-agent CLI, get schema-valid output
  library/    load + resolve .orkestra definitions
  prompts/    every word we send an agent, as .md templates
  recording/  what a test file depended on, and whether a later checkout still agrees
  vcs/        git worktrees, the commit that keeps the work, and the forge
  workflow/   the coupled core: domain · ports · adapters · runtime
  app/        Layer wiring and the HTTP API behind the UI
```

What an agent is told is **policy** and lives in `.orkestra/` — a named agent per
file, checks, `COMPOSITION.md` — layered over the roles and scripts the engine ships
under `src/library/shipped/`. How a turn is framed is **mechanism** and lives in
`src/prompts/templates/`. Editing an agent's brief changes what it is told with no
code change; that split is the whole bet. `.orkestra/.local/` is the same layout again
for one person — git-ignored by the engine and merged over the team's at load, so an
agent can be tried here before anyone is asked to review it.

A plan entry names **one agent**, and the agent declares everything else about the
step: what it knows, what its artifact must contain, what it may change, what
has to pass before a human sees it, what runs **after** its work is on the branch —
the one place a plan reaches outside its own checkout, and the approval it already
got is what authorised it — and whether it can be the first thing that happens in a
trak. A check that already passed on exactly the same files, in any checkout on this
machine, is accepted on that pass rather than run again, unless its file says
`cache: false` — including a pass any step's agent kept by running the check
through the engine's `run_check` tool during its turn; one that says
`ignores_linguist_generated: true` counts the files `.gitattributes` marks
`linguist-generated` as no change. A check that says `units: <label>` is handed a file to
append each unit it proved to and a file of the units already proven under that label on
the same files, so a later check sharing the label can skip them — kept however the run
ends, and never read by the engine. One that also says `fingerprint: [<tool>, …]` runs with
a hook loaded into every Node process, which records each test file's executed functions,
file reads and spawns of the listed tools; a later run on another tree skips a test file
whose every recorded input still holds, and runs it on anything the hook could not
account for, or on a doubt it filed under an assumption where `CI` is set, since only a
machine without it trusts one. The diff view draws `linguist-generated` files
folded, with their `+/−`, and reads a file's lines only when it is opened.

A **goal** sits above traks: a finished state a person approves, kept only on the goal's own log,
and a composer that reaches it by opening the traks it is confident in, keeping a short
plan of what is likely next, and adding traks as each lands or stops. Every move it makes is a tool call on an MCP server only its session
is handed, and the engine refuses one the goal's limits forbid — its approved file's, or a person's
change since. It stops for a person at
its drafted file, an escalation, work it asks the person to do by hand, and done; the gates of the traks it opens stay
their person's. A person starts one from a sentence in the New Goal drawer, or a chat
with the `generic` agent opens one through its `open_goal` tool and the goal names that
trak. A top-level trak's composer may also propose one as it finishes, and the goal
starts once the trak has finished, drafting its file from the trak's documents. Either is followed on its own screen and in a banner over the traks list. A goal
file's `branch:` lands every trak of the goal on one goal branch instead of the default
branch, which receives the goal as one pull request a person merges once it is done; between traks
the composer merges the default branch into it, opening a trak only where that merge conflicts. A goal's
plan may also hold sub-goals, which its composer opens as goals of their own, each with
its own composer and gates and opening its traks at once, landing on the parent's goal branch where it has one.

## Not built

The spike goes end to end, and these are the named gaps rather than a full list of
everything a production system would want:

- **Anything that watches a pull request on its own.** A plan can open and update
  one — the engine ships a `pull-request` role whose document is the body and an
  `open-pr` script on its `effects:` that sends it once the step's work is on the
  branch — and two surfaces read one back: the finished pane in full, and the trak
  list coarsely, one answer covering every branch. But both reads happen only while
  somebody is looking, and a trak still learns a review
  arrived when a person reads it there and sends it back. The one thing the engine
  polls for itself is a `conditions:` script an agent declares, which holds a plan entry
  at `Finished` until it exits zero — so a project can write the watching it wants. Two
  waits the engine answers without a script: `merged`, off that same coarse listing or a
  merge made here, and `deployed`, which then runs the project's `.orkestra/deploy.sh`
  with the merge commit. Either may also sit on one plan entry as its `wait_for`, which
  the composer writes. Once either has passed, nothing writes to the branch again.
  A third is a clock: `wait_until` on a plan entry holds it until an hour the composer
  named, or a duration from when it planned — and the sweep wakes it on the instant.
- **A third provider.** Codex is the second: an agent naming `codex/<model>` in
  `models.yaml` runs on `codex app-server`, with `elicit` untouched. One agent names it
  today — `codex-test`, a probe launched by hand — and a Codex trak records no spend,
  because the CLI reports token counts and no dollar figure. Codex also tells no
  MCP server that it understands views, so a server that checks before offering a tool
  with one shows no view on a Codex step; a server that offers it regardless does. OpenCode would be the
  third, and the same shape.
- **A supervisor.** The engine schedules nothing but the waits a plan asked for — a
  `conditions:` script asked again on its interval, an entry's `wait_until` started on
  the hour it named, a goal's finished trak archived once the forge says its pull
  request merged, and an **auto-merge** trak's pull request merged once it would go in
  cleanly with its checks passed and it waits on nothing but the merge, or sent back to its own composer when it would not —
  merged into the project's checkout instead where there is no `origin` —
  and the one thing that watches moves nothing: a subscriber to the
  event feed sends a phone a push notification when a trak parks at a gate, finishes,
  fails or gives up waiting on a condition. The engine reads a clock for those and to
  stamp the log, never to decide anything else, so every other move is because a person
  ran a command — `ork resume` after a failure, `ork reenter` when the world comes back —
  or because a goal's composer, woken by one of its traks landing or stopping, made it. A
  boot checks every going goal's traks against their logs and runs a turn the goal owes,
  so a composer turn a stopped engine cut off is run again when it starts.
- **Attachments past the chat bar.** A file can go with a trak or goal chat, a new trak
  or a new goal, and nowhere else — not an answer to questions, a replan or a change
  request. The checkout holds the only copy, and nothing removes an upload no message
  named.
- **`ork init`.** Nothing writes a `.orkestra/` directory; this repo's was authored
  by hand.
- Property-based generators — tests hand-enumerate state/event pairs today.
- **Cross-trak compounding.** The corpus exists and nothing reads across it — no index,
  no review agent, no ranking. That is on purpose: the deliverable was the record, and
  the harvester is an ordinary trak you point at `.orkestra/records/`.

## Documents

[`CLAUDE.md`](CLAUDE.md) routes an agent before it touches anything,
[`references/glossary.md`](references/glossary.md) defines the vocabulary the rest
assumes, [`references/commands.md`](references/commands.md) says what each command does and spends, and `.agents/skills/` holds the working knowledge,
loaded at the moment it is needed rather than read up front. Those and this file are kept
true of the code as it is.

[`notes/`](notes) is everything that is not: [`todo/`](notes/todo) is what we
knowingly deferred, one file per entry with the trigger that settles it, [`IDEAS.md`](notes/IDEAS.md) is
loose ideas one line at a time, [`BUGS.md`](notes/BUGS.md) is what is broken now, and design
work goes in a dated directory. **Each dated
note opens with the month it was written and its status then, and is never edited after** —
read it for why a decision went the way it did, not for what is there now.
