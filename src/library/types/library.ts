// types: the shape of a whole `.orkestra` directory.

import type { Agent } from "./agent.js"
import type { Check } from "./check.js"
import type { HostedProcess } from "./process.js"
import type { SandboxTool } from "./tool.js"

export interface ModelRegistry {
  /**
   * Every model an agent may name. A set with a stable order for display, not a
   * ranking: resolution was max-over-the-techniques-in-a-step, and with one agent
   * per step there is nothing to resolve, so the ordering has no reader.
   *
   * The list stays because it is the only thing that validates `model:`. A typo
   * there is a human's typo in policy and the one that costs a whole trak to
   * discover, since it surfaces as a provider error mid-turn.
   */
  readonly allowed: readonly string[]
  /**
   * The reasoning effort each model runs at unless the agent file says otherwise, by
   * the name in `allowed`. A model with no entry here runs at its CLI's own default,
   * which is every model of a project that declares none.
   */
  readonly efforts: ReadonlyMap<string, string>
  /**
   * `default:` on disk: the model for the turns no agent file of this project's
   * names one for — the COMPOSER, and every role the engine ships, `generic`
   * included, since a shipped file may not name a model of its own. A role only a
   * project writes names its own.
   */
  readonly composer: string
  /**
   * `context_windows:` on disk — how many tokens each model's context holds, by the
   * name `allowed` lists it under. A table a person fills, and the fallback: each CLI
   * reports the window itself per turn, and the engine is the only place a surface may
   * learn either from. A model with no entry and no turn that reported one has no known
   * window, which a surface draws as no ceiling.
   */
  readonly windows: Readonly<Record<string, number>>
}

export interface Library {
  /**
   * The fleet, by name. A plan entry names one, and the composer's index is
   * built from the descriptions.
   *
   * Never empty, unlike every other registry here: a project with no agents
   * cannot have a plan, so a fleet is what makes a `.orkestra/` a `.orkestra/`.
   */
  readonly agents: ReadonlyMap<string, Agent>
  /**
   * The one agent the **engine** ships — `generic`, role-less, the thing a person
   * asking a question of finished work is put in front of.
   *
   * **Beside the fleet rather than in it, and everything that follows is by
   * omission.** The composer's index and the set that rejects a plan naming an
   * agent which does not exist are both built from `agents` alone, so nothing has
   * to be taught to leave this one out. What has to find it — the three points a
   * running step's agent is resolved, `GET /api/agents`, and the create route's
   * `startable`, since this one opens a trak too — asks `agentNamed` or `fleet`.
   *
   * Its model is `models.composer`, because a file shipped inside the engine
   * cannot name one: see `shippedLayer`.
   */
  readonly generic: Agent
  /**
   * Shell scripts that verify a step's work, by name. An agent names any number
   * of them, and the names are validated against this map at load.
   */
  readonly checks: ReadonlyMap<string, Check>
  /**
   * `.orkestra/processes/*.sh` by name — the long-running programs a trak may keep up in
   * its checkout. Started by a person's press, or before a turn of an agent whose
   * `processes:` lists one, and kept until it is stopped or the checkout goes.
   */
  readonly processes: ReadonlyMap<string, HostedProcess>
  /**
   * `.orkestra/tools/*.sh` by name — commands a sandbox installs on their first call. Under
   * a runner each is sent to the sandbox with an entry that installs it
   * once and runs it; with none, each is only parsed, so a broken header is still reported.
   */
  readonly tools: ReadonlyMap<string, SandboxTool>
  /**
   * `.orkestra/worktrees/setup.sh` — run once in each new worktree, before the
   * composer's turn. A fresh checkout has no `node_modules`, so without it the
   * first check an agent declares fails for a reason that has nothing to do with
   * the work.
   *
   * A `Check` because it is the same kind of file — a script, a directory, and
   * an exit code. Not *in* `checks`, because nothing selects it: an agent that
   * could name setup would be choosing when the workspace exists.
   *
   * Run again on each sandbox a trak is given unless it declares `reaches: external` —
   * see `Check.reaches`.
   */
  readonly setup: Check | undefined
  /**
   * `.orkestra/worktrees/teardown.sh` — run in a trak's checkout just before the
   * engine removes it, to undo what `setup.sh` made outside it: a per-worktree
   * database, a container. A `Check` for `setup`'s reason, and sees `env.sh` the same.
   *
   * It must be safe to run twice. A restart between the script passing and
   * `git worktree remove` runs it again, and nothing records that it finished.
   * Exiting non-zero or timing out keeps the checkout and the branch, and a resume
   * runs it again. Skipped when the checkout is already gone, because that
   * directory is what `env.sh` derives the per-worktree names from — and under a runner
   * when it declares `reaches: local`, since the release takes everything it would undo.
   * See `Check.reaches`.
   */
  readonly teardown: Check | undefined
  /**
   * `.orkestra/worktrees/env.sh` — sourced in a spawn's own directory before every
   * agent turn, check, effect, `setup.sh` and `teardown.sh`, and the variables it leaves **exported**
   * are laid over that spawn's inherited environment. How a repository's toolchain
   * loads is the repository's to say; the engine never learns what `mise` is, and a
   * project without the script inherits exactly what the engine has.
   *
   * Every spawn and never cached, because a trak may change the pinned version.
   * Before `setup.sh` too, which a tool manager tolerates: `mise env` exits 0 for a
   * tool not installed yet. Never before the engine's own `git` and `gh` — those skip
   * hooks, and the engine calls them constantly.
   *
   * A `Check` for `setup`'s reason, with the same header and the same `timeout_seconds`.
   * A script that exits non-zero or times out fails the spawn it was for, with its
   * stderr; there is no fallback to the inherited environment, because an agent
   * quietly finding the wrong ruby is the bug this exists to remove.
   */
  readonly env: Check | undefined
  /**
   * `.orkestra/deploy.sh` — what answers the `deployed` condition, run from `root`
   * with the merge commit as `$1` once the trak's branch has gone in. `exit 0` is
   * live, `1` not yet, anything else gives up — a condition's exits exactly. Its
   * stdout may carry one JSON line a surface draws from; see `readDeployOutput`.
   *
   * A `Check` for `setup`'s reason, and its presence is what makes `deployed` a
   * name an agent may list. Optional `asked_every_seconds:` is how often the engine
   * asks it again while a trak waits.
   */
  readonly deploy: Check | undefined
  /**
   * The directory `.orkestra/` sits in — the project. Where `deploy.sh` runs, because
   * a deploy's status does not depend on any checkout, and a trak that has been
   * archived has none.
   */
  readonly root: string
  readonly models: ModelRegistry
  /** `.orkestra/COMPOSITION.md` — how this team wants pipelines sequenced. */
  readonly composition: string
  /**
   * `.orkestra/GOALS.md` — this project's rules for a goal's composer, such as when to
   * propose a goal branch. Empty string when the project defines none.
   */
  readonly goals: string
  /**
   * `.orkestra/ORKESTRA.md` — project-wide guidance injected into every step,
   * the equivalent of a CLAUDE.md for agents working under Orkestra. Empty
   * string when the project defines none; the template omits the section.
   */
  readonly guidance: string
}
