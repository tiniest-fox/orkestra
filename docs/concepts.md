# Concepts

The words every other page uses. Each is defined once here.

| Word | What it means |
|---|---|
| **trak** | one piece of work: a description, a plan, a worktree, a branch, and an append-only log of events |
| **intent** | the description plus every decision recorded since — what the composer and every later agent read, rather than the original request |
| **worktree** | the checkout a trak works in. Every turn and every check runs there |
| **plan** | the ordered list of steps a trak runs |
| **step** (a **plan entry**) | one entry in the plan: a compose, an agent turn, or a spawn. A step names **one** agent, and nothing else about the step is on the entry |
| **agent** | a named role, defined in one file: its model, permission, output sections, checks, effects, conditions, processes, skills, and the brief. See [agents.md](agents.md) |
| **composer** | the agent that proposes the plan. A step like any other: each of its runs is an entry in the plan. It chooses agents by their `description:` and reads `COMPOSITION.md` |
| **turn** | one ask of one step, and normally one invocation of the agent's CLI |
| **artifact** | a step's primary output: its sections, and optionally requirements and corrections |
| **requirement** | something a turn settled about the finished work. It accumulates onto the trak and outlives the document that carried it |
| **check** | a script an agent names under `checks:`, run against the worktree after the artifact and before a person sees it. Non-zero means **the work is wrong**, and sends the step back to fix it. See [checks.md](checks.md) |
| **effect** | the same kind of script, named under `effects:`, run once the step's work is on the branch and a person has approved it. It acts outside the checkout, so non-zero means **it could not do it** |
| **condition** | the same kind of script again, named under `conditions:`, asked before a step of that agent starts. `0` runs the step, `1` is *not yet*, and anything else gives up |
| **process** (a **hosted process**) | a long-running script under `.orkestra/processes/` — a dev server, a gallery — kept up in one trak's checkout on a port the engine assigns. See [processes.md](processes.md) |
| **gate** | a state a trak is parked at with a person owing it something: an approval, answers, failing checks, a stuck step, or a conversation |
| **run mode** | how much of a trak its person stands at: `manual` stops at every gate; `smart` lets a gate go past unless the turn reported ambiguity or the record shows a person is needed; `auto` takes the plan and each artifact for them and answers questions with the agent's recommended option; `decider` takes the plan and each artifact as `auto` does, but stops for every question and conversation. On every mode a failing check and a stuck step stop for the person |
| **goal** | a finished state a person approves as its **goal file**, and the composer that reaches it by opening traks, waiting for each to land and adding more. See [goals.md](goals.md) |
| **spawn** | a plan entry that is several pieces of work which do not need each other's output, each run as its own trak, a **child** of the one that spawned it |

## How a trak runs

1. A person describes the work, and the engine makes a worktree and a branch for it.
   `worktrees/setup.sh` runs there if the project has one.
2. The composer reads the description and every agent's `description:`, and proposes a
   plan. In `manual` mode a person approves it at a gate.
3. Each step runs its agent. The agent files an artifact with the sections its agent file
   declares under `output:`.
4. The engine runs the agent's `checks:` against the worktree. A failure sends the step
   back to the same agent with the output.
5. The step stops at a gate. Once the artifact is approved, the engine runs the agent's
   `effects:`, and the next step starts.
6. A step whose agent lists `conditions:` waits until each one answers `0`.
7. When the last step is approved, the plan has run out and the trak is finished.
