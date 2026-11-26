# The shipped fleet

Orkestra ships a set of agents every project starts from, so a project needs no agent file
to run. They live in the engine, under `src/library/shipped/agents/`, and a project
changes one by layering a file of the same name over it — see
[agents.md](agents.md#layering-over-a-shipped-agent).

Every shipped agent runs on `models.yaml`'s `default:` and names no checks, conditions,
processes or skills. A project adds those in its own file for the role, which is usually
the whole of what it writes:

```markdown
---
checks:
  - test
---
```

saved as `.orkestra/agents/build.md`, gives the shipped `build` agent a check.

## The agents

**Opens a trak** means the agent has `start: true`, and the app offers it as the first
step of a trak.

| Agent | Permission | Opens a trak | What it is for |
|---|---|---|---|
| `build` | write | yes | Works out how to build an agreed change, builds it, and reports what it did. Any step that changes code or tests |
| `diagnose` | read-only | yes | Finds the cause of a failure this checkout cannot reproduce, from evidence elsewhere: live data, monitoring, an intermittent fault. Fixes nothing |
| `exercise` | write | yes | Uses built work the way a person or a calling program would, and quotes what happened. Changes nothing |
| `experiment` | write | yes | Settles a factual question by running the thing — how a foreign CLI behaves, what a library can do — and quotes what came back |
| `guide` | read-only | yes | Walks a person through work that needs a human hand, one step at a time. Only ever a conversation |
| `investigate` | write | yes | Traces a reported problem to its cause and commits a failing test. Fixes nothing; the failing test is the handoff |
| `operator` | read-only | yes | Does what a trak needs done outside the checkout — posting to a tracker, calling a service — asking first |
| `pull-request` | read-only | no | Writes the pull request for the branch. Its document is the pull request, and approving it runs the `open-pr` effect, which opens or updates it |
| `research` | read-only | yes | Lays out the options for a decision the codebase cannot answer, and what each costs. Recommends nothing |
| `resolve` | write | no | Brings the target branch into the trak's branch and settles what the two disagree about, when a merge did not go in |
| `review` | write | yes | Judges finished work against its criteria, says whether it ships, and applies small corrections itself |
| `review-comments` | read-only | no | Files what a reviewer wrote on the branch's pull request, verbatim, so the next plan answers what was said |
| `scope-and-approach` | read-only | yes | Settles what to build by asking, and names the approach. The planning step for anything that adds or changes behavior |
| `survey` | read-only | yes | Reads an area and reports how it works and what depends on it. Settles nothing |
| `think-through` | read-only | yes | Talks an idea through against the code before it is a piece of work. Only ever a conversation |
| `ui-prototype` | write | yes | Settles what a screen should look like by building a throwaway study a person looks at |
| `unblock` | write | no | Picks up a step that reported it was stuck, with a fresh context |
| `write-docs` | write | yes | Rewrites documents, or sweeps a finished branch for what everything built after it now has to do |

The engine also ships `generic`, the role-less agent that answers a question or does the
one thing it was asked. It is not in the fleet: the composer's list of agents leaves it
out, and a project file may not take its name.

## `fleet.yaml`

**Path:** `.orkestra/fleet.yaml`, or `.orkestra/.local/fleet.yaml`, which replaces it whole.

Turns shipped agents off for this project.

```yaml
refused:
  - guide
  - operator
```

| Key | Type | Default | What it does |
|---|---|---|---|
| `refused:` | list of shipped agent names | `[]` | Shipped agents this project does not use. The engine loads none of them |

A name Orkestra does not ship fails the load: a project's own agent is turned off by
deleting its file. A project file that defines a refused agent also fails the load. Any
other key fails the load.
