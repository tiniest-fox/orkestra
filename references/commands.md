# Commands

What each `pnpm` command run from this checkout does, and what it spends.

## What spends

These spawn a real agent CLI — `claude`, or `codex` for a step whose agent names a
`codex/…` model. Everything else is free.

| | |
|---|---|
| `pnpm real` | one turn, shows normalized events |
| `pnpm real:compose "<desc>"` | the composer alone |
| `pnpm real:trak "<desc>"` | the whole engine — approves on your behalf, clamps read-only |
| `pnpm compose-lab "<desc>"` | the composer for real and every other agent answered by you, so a plan can be pushed through a raised requirement and a replan for the price of the compose turns |
| `pnpm ork "<desc>"` | the same with nothing injected: real permissions, **writes to the directory you started in**, and you answer every gate. Needs `pnpm serve` running — it is a client, not an engine |
| `pnpm serve` | **the engine.** Every write goes through it and every surface talks to it. Free to boot and read; the acting routes spawn a real agent CLI. It also serves the built client at `/` — it says at boot whether `client/dist` is missing or older than its sources, and `pnpm --filter @orkestra/client build` is what refreshes it. Loopback and open with nothing set; `--host` binds wider and is refused unless `ORKESTRA_PASSPHRASE` is set, which puts a login in front of `/api/`. Its state is a SQLite file, `.orkestra/.database/store.sqlite` |
| `pnpm ui` | `pnpm serve` and `pnpm client` together on the port pair the project keeps — it prints both. Its presses are listed below |
| `pnpm smoke` | checks against the real CLI (~$0.08); `--codex` checks `codex` instead, which reports no cost |

## `pnpm ui`'s presses, one surface to a line

- **Spend, on a trak:** New Trak, New Chat, Draft the goal on New Goal, which starts a goal's composer drafting its file, Approve at a gate, Send answers on a question card, Allow and Refuse on a permission card, Send in the chat bar, Resume on a trak nothing is driving, Skip the wait on a trak resting on a condition or a clock, which starts the held step at once, the two that leave a step — File it, which re-enters the step told to file, and Recompose, which sends the composer your words — and the two doors on a trak at rest — Send it back, which plans, and Ask generic, which answers.
- **Spend, on a goal's screen**, each owing its composer a turn: Approve and start at its drafted file, Redraft there, Approve at a plan an older goal still stands at, Send answers on its question card, Retry or New session after a turn that failed, Send in its chat bar, and Resume on a paused goal. Pause, Drop, Confirm done and every change made from Edit on a running goal there spend nothing, nor does Dismiss on a goal at rest in the traks list.
- **Free, merging:** Merge and Archive spend nothing — they are `git` and one `gh` read — nor does the press that merges a finished trak's pull request on GitHub, behind its confirmation panel, which is `gh`, then `git` bringing the project checkout up to the merge where that needs no stash and no conflict, nor does the press on a refused merge that commits the parent's checkout and merges, which is two `git` commands.
- **Free, the chat bar:** Stop takes the chat bar's send button's place while an agent is running and the field is empty, and kills the turn — once the field holds text the button is Send again, and what it sends then starts no turn: the running agent reads it at its next tool call. The stop press on one background job — on the strip at the chat bar and on the job's card — writes one control line down the turn's open pipe and kills nothing else.
- **Free, processes:** Start, Restart and Stop on a trak's side panel run a script the project declares in the trak's checkout, and the same three on the git bar's processes cell — on a phone, the dock's processes tab and the sheet it opens — run it in the project checkout. Rebuild sandbox on a sandboxed trak's `⋯` menu is `git`, the runner and the setup script, and waits for a running turn to end.
- **Free, on a trak's own screen:** the run-mode picker, the two one-shots inside it — the hold, and the skip that keeps the next step's checks from running — and its auto-merge switch, which the finished band also carries beside the merge press, each append one event that is read later, so a trak parked at one stays parked. The stop press in a running check's band kills the script and parks the trak at the gate a failing check opens. A press inside an MCP tool's view in the transcript calls a tool on that view's own server through the CLI with no model turn — the first one after a turn starts the CLI in the trak's checkout with no prompt, and the engine ends it once it has been idle.
- **Free, the git bar:** Fetch, Pull, Push, Reconcile, and the stash press a refused pull or reconcile offers — on the strip along the foot of the window, or on a phone the sheet the dock's git-action tab opens — are `git` against the project checkout. Resolve in a Trak there opens the New Trak page with the request written and starts nothing.

## Serving from this checkout

`pnpm client` serves the UI but not the API — started alone, the list is empty. `pnpm ui`
runs both, and either one dying kills the other. Its two ports are derived from the
project's path, so a worktree's URL is the same every boot and two worktrees can serve at
once; a pair another project holds steps to the next free one, which is the only time the
URL moves. **A pair this project already holds is refused instead** — one engine per
project, because exclusion is a permit inside the single writing process and a second
daemon shares none of it. `pnpm ui:stop` stops the one that is running.

**The project is not always this checkout.** `pnpm serve`, `pnpm ui`, `pnpm ui:stop` and
`pnpm ork` each take `--dir <path>` — the repository to drive, default the directory you
are in. Every one of them has to be given the same `--dir`, since the port pair, the daemon
record and the already-running refusal are all keyed off it. Two engines from this one
checkout against two repositories is fine; two against one is what is refused.

## Building

`pnpm build` is free: it bundles the engine to `dist/serve.js`, `dist/ork.js`,
the two `dist/recording-*.js` and `dist/check-stages.js` with the templates, the shipped fleet and scripts and
`client/dist` copied beside them, so `node dist/serve.js --dir <repo>` runs without this
checkout. `src/app/packaged.ts` is where the two layouts meet — an asset the engine reads is
named there or the bundle loses it.

`pnpm app` builds `Orkestra.app` and installs it over `/Applications/Orkestra.app`; the
README's *A Mac app* says what it replaces and when it gives up. Packaging downloads an
Electron binary the first time, and nothing in it spends. Running the shell from this
checkout is in `desktop/CLAUDE.md`.

## When `node_modules` does not match the lockfile

The README says what refuses and that `pnpm install` clears it. The refusal reaches only the
`pnpm` typed at a terminal: pnpm exports the setting off to every script child, so nothing
under `pnpm ui` is gated, including every check in every trak worktree. An engine started
from `Orkestra.app` is not a pnpm child, so there each check is gated on its own. `pnpm
ui:stop` is refused along with the rest, so a live engine over a stale tree is stopped by
the pid `.orkestra/.database/daemon.json` names, or by installing first.
