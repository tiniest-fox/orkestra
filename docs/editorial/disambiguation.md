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

A **Verdict** is what a gate produces. The terms differ by gate type:

- **Automated Gate** uses **Pass / Fail** — determined by the script's exit code (0 = Pass, non-zero = Fail). A Fail triggers an automatic agent retry.
- **Agentic Gate** uses **Approve / Reject** — determined by the agent's evaluation of the work. A Reject pauses for human Approval before routing the Trak back to a previous stage.

Use the correct term for each gate type. An Automated Gate never "rejects"; an Agentic Gate never "fails."

### Approval

**Approval** is always human. It is the universal mechanism by which a human decides what happens next. Every stage requires Approval before advancing, unless the Trak is in auto mode.

There are two situations where a human gives Approval:

1. **Approving a work product** — the human reviews what an agent produced at a regular stage and decides to advance or send it back.
2. **Approving an Agentic Gate's verdict** — the human reviews the gate's Approve or Reject verdict and either accepts it (follows the recommended routing) or overrides it (sends the agent back to work regardless of the verdict).

**The confusion to avoid:** Approval is not a gate, and gates do not give approval. Gates produce verdicts; humans give approval. An Agentic Gate is not "adding human approval to a stage" — every stage already has human approval. What it adds is an agent-produced verdict for the human to act on.

### `gate: true` in workflow.yaml

Setting `gate: true` on a stage configures it as an **Agentic Gate**. When documenting this, describe it as configuring a stage as an Agentic Gate — not as "adding approval." Every stage already has human approval; what `gate: true` adds is an agent-produced verdict for the human to act on.

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
| `Failed` | Failed |
| `Blocked` | Blocked |

When writing lifecycle diagrams or state tables, always use the right column. If you encounter internal state strings in source code or log output, translate them before including them in documentation.

---

## `route_to` — Internal Agent Output Field

`route_to` is an internal field produced by a reviewing agent's structured output when it issues a rejection. It specifies which stage to route the Trak back to. It is **not** a `workflow.yaml` config field and is **not** user-configurable.

When documenting agentic gate rejection behavior, describe it in terms of the outcome ("the Trak routes back to the work stage") rather than naming the internal field. Users should not need to know that `route_to` exists.

**The confusion to avoid:** Describing `route_to` as a field users set or configure. It is an agent-produced value in the gate verdict JSON, invisible to users. The old `rejection_stage` config field that it replaced was user-configured; `route_to` is not.

---

## Questions — Always Available, Not a Capability

Any agent stage can produce questions without any configuration. **Questions are not a configurable capability.** The old `capabilities.ask_questions: true` field has been removed; using it produces a parse error.

When documenting stages or agent behavior, do not describe questions as something you "enable" or "configure." Describe them as a built-in behavior: an agent may ask questions at any stage, the Trak pauses for human answers, then the agent session resumes.

The **Capabilities** concept in Orkestra now refers only to `capabilities.subtasks`. Do not use "capability" or "capabilities" to describe questions.

---

## "Auto mode" (task-level automation)

**Auto mode** is a Trak-level boolean (`task.auto_mode`) that makes all stages advance without human approval. It is not a `workflow.yaml` field — it is a runtime property of the Trak, set at creation time or toggled via CLI/API.

- When `auto_mode = true`: every stage in the Trak auto-advances after producing output. Gates still run; only the human approval pause is skipped.
- When `auto_mode = false` (default): every stage pauses for human approval.

There is no per-stage automation flag. The old `is_automated: true` stage field no longer exists — using it produces a parse error.

**Avoid:** Describing `is_automated` as a valid config option. It has been removed.

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
