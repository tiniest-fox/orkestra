# Orkestra Concept Disambiguation

This file documents concepts that are easily confused or have misleading names. Read this before researching or writing any Orkestra documentation.

---

## Gates, Verdicts, and Approval

These three terms are distinct. Using them interchangeably is the most common documentation error.

### Gate

A **Gate** is a human-free quality check that must be resolved before a Trak can advance. Gates come in two forms:

- **Automated Gate** — deterministic. A shell script runs against the agent's committed work. The exit code determines the verdict. No human is involved; failure triggers an automatic retry.
- **Agentic Gate** — subjective. A dedicated agent evaluates the work and produces a verdict. The Trak then pauses for human Approval before acting on that verdict.

Gates are a stage-level configuration option, not a universal behavior. A stage without a gate skips directly to human Approval.

### Verdict

A **Verdict** is what a gate produces: **Pass** or **Fail**.

- Automated Gate verdict is determined by the script's exit code (0 = Pass, non-zero = Fail).
- Agentic Gate verdict is determined by the agent's evaluation of the work.

A Fail verdict from an Automated Gate triggers an automatic agent retry. A Fail verdict from an Agentic Gate pauses for human Approval before routing the Trak back to a previous stage.

### Approval

**Approval** is always human. It is the universal mechanism by which a human decides what happens next. Every stage requires Approval before advancing, unless `is_automated: true` is set.

There are two situations where a human gives Approval:

1. **Approving a work product** — the human reviews what an agent produced at a regular stage and decides to advance or send it back.
2. **Approving an Agentic Gate's verdict** — the human reviews the gate's Pass or Fail verdict and either accepts it (follows the recommended routing) or overrides it (sends the agent back to work regardless of the verdict).

**The confusion to avoid:** Approval is not a gate, and gates do not give approval. Gates produce verdicts; humans give approval. An Agentic Gate is not "adding human approval to a stage" — every stage already has human approval. What it adds is an agent-produced verdict for the human to act on.

### `capabilities.approval` in workflow.yaml

The current config key `capabilities.approval` is a **misleading name** — it predates this terminology and is likely to change. When documenting this capability, describe it as configuring a stage as an **Agentic Gate**, not as "adding approval." The config key is an implementation detail; the concept is an Agentic Gate.

---

## "Flow" vs. "Workflow"

- **Flow** — a specific named pipeline defined in `workflow.yaml` (e.g., `default`, `docs`, `subtask`). A Trak is assigned one flow at creation.
- **Workflow** — loosely refers to the entire `workflow.yaml` configuration, which contains all flows. Avoid using "workflow" to mean a specific pipeline; use "flow" instead.

---

## Internal State Strings vs. User-Facing Lifecycle Phases

Orkestra's internal state machine uses enum strings like `AwaitingSetup`, `GateRunning`, `AwaitingApproval`, and `WaitingOnChildren`. These are **never** user-facing vocabulary — do not document them as concepts users should know or reference.

Use the user-facing phase names instead:

| Internal State | User-Facing Phase |
|---|---|
| `AwaitingSetup` / `SettingUp` | Setup |
| `Queued` / `AgentWorking` | Running |
| `AwaitingGate` / `GateRunning` | Gate Check |
| `AwaitingApproval` | Awaiting Approval |
| `WaitingOnChildren` | Waiting on Subtraks |
| `Done` / `Archived` | Done |
| `Failed` / `Blocked` | Failed |

When writing lifecycle diagrams or state tables, always use the right column. If you encounter internal state strings in source code or log output, translate them before including them in documentation.

---

## "Auto mode" vs. `is_automated` (per-stage automation)

These are **not the same scope**:

- **`is_automated: true`** — a per-stage field in `workflow.yaml` that skips human Approval after that stage. Automation is configured stage-by-stage.
- **"Auto mode"** — a colloquial term sometimes used to describe a Trak that runs fully autonomously (all stages automated). This is not a documented Trak-level field; it emerges from all stages having `is_automated: true`.

**Avoid:** Describing "auto mode" as a Trak-level toggle or a single configuration option. A reader who encounters the phrase and looks for it in Workflow Configuration will only find `is_automated` on individual stages. If you need to describe fully-automated Traks, say "a Trak where all stages have `is_automated: true`" rather than "a Trak in auto mode".

---

## "Trak" vs "task"

- **User-facing**: **Trak** (capitalized noun) or `trak` (in CLI/YAML contexts)
- **Internal code**: `task`, `task_id`, `workflow_tasks` (database table name), `SubtaskService`

Do not use "task" in user-facing documentation. When you see internal code references, translate to "Trak" before including them in docs.

---

## "Subtraks" vs "Subtasks"

- **User-facing**: **Subtraks** (follows the Trak naming convention). Also used as a section label, table row, and Mermaid edge.
- **Internal code**: `subtask`, `SubtaskService`, `WaitingOnChildren` (state string)

The internal state `WaitingOnChildren` maps to the user-facing phase **Waiting on Subtraks** (see the phase table above). The config key in `workflow.yaml` is `subtasks` (lowercase, no Trak casing) — this is an implementation detail; the concept is **Subtraks**.

There is also a flow *name* collision: a flow named `subtask` (e.g., `flows.subtask:` in `workflow.yaml`) is a technical config value, not the user-facing concept "Subtraks". When showing YAML that references `subtasks.flow: subtask`, add a comment clarifying this — e.g., `# Simpler flow used for child Traks (Subtraks)` — so readers don't conflate the flow name with the concept.

---

## `verdict` Gate Kind — Human-First Rendering Order

`{ kind: "verdict" }` in the Pipeline component expands into **two** rendered gates: first `approval` (blue, "Human review"), then `verdict-result` (purple, "Agent verdict"). This may seem backwards — intuitively you'd expect the agent verdict to come first, since the agent evaluates before the human acts. The visual order reflects the Approval flow (human confirms the verdict), not the execution order.

This is correct behavior, not a rendering bug. Use `kind: "verdict"` as shown in existing pages without inverting the gate order or trying to split it into two explicit gates.

---

## `model` Field — Implicit Provider Selection

The `model` field in `workflow.yaml` doubles as both provider selection and model selection. This is not obvious from the field name.

- Omitting the field → Claude Code default model.
- A short name like `sonnet`, `opus`, `haiku` → Claude Code, specific model.
- A full model ID like `claude-sonnet-4-6` → Claude Code, explicit version.
- A provider-prefixed name like `claudecode/sonnet` or `opencode/kimi-k2` → explicit provider + model.
- A bare third-party name like `kimi-k2` → **OpenCode** implicitly selected as provider.

**The confusion to avoid:** Readers expect that the `model` field selects a model. It also implicitly selects a provider. Document the provider-selection behavior explicitly when writing the `model` field reference — especially the implicit OpenCode detection from bare model names.

---

*Maintained by the compound agent. Add entries when documentation confusions are found in the docs flow.*
