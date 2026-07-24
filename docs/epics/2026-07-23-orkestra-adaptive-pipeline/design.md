# Orkestra Adaptive Pipeline

*Design notes — living doc, last shaped from the design conversation on 2026-07-23.*

## Why this exists

The current pipeline is a static, hand-authored sequence of stages per flow (`planning → breakdown → work → review → compound`), configured once in `workflow.yaml`. Three concrete pains motivated a rethink:

- PR feedback (`Request Changes`, `Fix Merge Conflicts`, failed checks) always routes to a single hardcoded recovery stage and replays the *entire* remaining pipeline — a one-line lint fix pays for the same `work → review → compound` cycle as a substantive change.
- `breakdown` always runs, even for Traks a single worker could obviously handle, because nothing upstream is positioned to know that without paying breakdown's own research cost.
- Different "kinds" of work (bug fix, prompt tuning, generic feature) look like they need different pipelines, but most of what's actually different is technique, not structure.

This doc tracks what we've settled and what's still open. It is not an implementation plan — it's the shape we're aligned on before one gets written.

---

## The core shift

Stop treating a Trak's path as a name picked from a small set of hand-authored flows. Instead:

- A Trak's pipeline is **composed**, not selected — assembled from small reusable building blocks rather than matched to one of a few pre-written shapes.
- Composition happens at two levels: **which stages run at all** (structural), and **what technique a given stage actually uses** (behavioral).
- The only hard structural fork left in the system is **does this end in a PR or not** — everything that does draws from one shared library of composable stages; everything that doesn't is a chat.
- **`flow` itself disappears as a named, pre-authored container** — for top-level Traks and subtask children alike. What replaces it is a Technique library plus a composer that assembles a Trak-specific sequence fresh every time. See "Workflow type" below.

---

## Decisions

### Composition model

| Decision | Rationale |
|---|---|
| Introduce **Techniques** — small, named, combinable units of behavior (e.g. red/green testing, prompt-investigation, vertical-slice decomposition, specialist-panel sizing) | These replace hand-authored named flows (`hotfix`, `quick`, `micro`) as the way variation gets expressed. A stage's actual behavior is *always* some combination of Techniques — no default behavior exists outside that combination, unlike optional `.claude/skills/` files today. |
| Keep two distinct composition questions separate: **which stages run** vs. **what a stage does** | Conflating them is how `planner.md` ended up needing to secretly carry two jobs (assess requirements *and* decide downstream shape) earlier in this design. Keeping them separate keeps each prompt single-purpose. |
| **Depth dials stay in-session; only structural forks get pipeline-level visibility** | Already proven: `reviewer.md`'s specialist-panel sizing, `planner.md`'s Q&A depth, `breakdown.md`'s self-review panel, `compound.md`'s tiered investigation all self-limit today with no external orchestration. Don't rebuild what already works. Promote to pipeline-level only when the decision changes the Trak's actual state (creates Subtraks, skips an independent check). |
| ~~Some Techniques are *pinned*, not discretionary — a Technique can declare `pinned_when` in its own frontmatter, a mechanical condition (e.g. "any step with write access," "touches `src/payments/**`") under which it's always included, no composer judgment involved at all.~~ **Removed — folded into `COMPOSITION.md` guidance instead.** | The original justification was reliability insurance ("will the composer remember to include this every time"), not a documented incentive-to-distrust-judgment case — a genuinely different bar than the one that justifies mechanizing anything else in this design. Once the mandatory-verification non-negotiable (below) was also reconsidered on the same trust-the-composer grounds, keeping a *different* mechanical bypass for lower-stakes reliability concerns stopped being consistent: if prose-only trust in `COMPOSITION.md` is good enough for "should this get reviewed before Done," it's good enough for "remember to check the skills directory." No Technique bypasses composer discretion anywhere in the design now — pinning would only be worth reconsidering for something genuinely external to software judgment entirely (a compliance or legal requirement), and no such case exists yet. Dropping it also sidesteps a real technical wrinkle for free: a `path_glob`-style condition can't be mechanically evaluated at proposal time anyway, since a composed step has no diff to match against until it actually runs — there was no clean answer to that timing problem waiting to be found. |
| **`.orkestra/COMPOSITION.md` — a prose playbook the composer reads alongside every Trak, encoding team conventions for how composition should go in recurring situations** ("bug reports without clear repro steps: start with `red-green`"; "frontend changes: include `storybook-story`"; **"unless changes are exceedingly trivial, include some review to verify the work"**). Shapes judgment, it doesn't bypass it — nothing here is a hard mandate, the composer weighs it like any other context. | Not "payments must always have X," but "this is how we as a team like things to compose in these circumstances." Same relationship CLAUDE.md already has to a worker's coding decisions — richer context for a judgment call, not a rule replacing it. Also gives `compound` a clean third landing spot alongside code-pattern learnings (→ nearest `CLAUDE.md`) and prompt tuning (→ a Technique's own file): composition-level learnings ("we keep needing to remind the composer to include X here") land here instead of nowhere. **This is also now where the "always get independent review" preference lives** — see "Mechanism vs. policy" below for why that moved out of the runtime and into this file. One clear, simply-worded line does the job; this doesn't need to be an exhaustive audit of every case the old mandatory rule and pinning mechanism used to cover — most of what those were guarding against wasn't a real, verified protocol to begin with. |

### Mechanism vs. policy — a line worth stating explicitly

*(New section, added after the review non-negotiable was reconsidered — see below.)*

Two genuinely different kinds of rules run through this design, and they belong in different places:

- **Mechanism** — protocol-level facts about how the orchestration engine itself works: the output shapes an agent can produce (Artifact, Questions, Subtraks, Approval, Failed, Blocked, `NeedsRecomposition`), how the escape hatch behaves, how a step signals it's stuck. Every deployment of this system needs these to work identically regardless of what team is using it or what they're building. Mechanism is hardcoded in the orchestrator and auto-injected into every session — it is **not** user-editable content, because it isn't a policy choice, it's how the tool works.
- **Policy** — opinions about how software engineering work specifically should be approached or validated: whether a bug fix needs a red/green step, whether frontend changes need a Storybook story, whether every code change gets an independent review before Done. These vary legitimately by team and deployment, and belong entirely in Techniques, `COMPOSITION.md`, and the coordination agent's own prompt — user-authored, user-editable, never baked into the runtime.

This line is what killed the original "independent verification is a mandatory, tagged Technique category" non-negotiable (below) — that was a policy opinion wearing mechanism's clothes. It's also why the "if you keep hitting the same gate failure, this might be systemic" nudge (see Cost model) stays hardcoded: knowing the escape hatch exists and when it's appropriate to use is mechanism, not an opinion about how anyone's software should be built.

### Non-negotiables

*(Only two genuine runtime mechanisms survive here now; the verification item was reconsidered and moved to policy — struck through below rather than deleted, to keep the doc's own decision history visible.)*

| Decision | Rationale |
|---|---|
| ~~Independent verification is a mandatory, tagged Technique category — enforced before Done, composed by an invocation independent of whatever produced the work.~~ **Removed as a runtime rule.** | This was the one non-negotiable that turned out to be policy, not mechanism (see above) — an opinion about how *this team* wants software validated, not a structural fact about the orchestration engine. It now lives as strong guidance in `COMPOSITION.md`/the coordination agent's prompt. The actual backstop for PR-ending work was never really the internal pipeline anyway: a human already has to approve the PR before it merges, and if the composer skipped review and the result isn't good enough, "Request Changes" already routes back through composer re-invocation (see Entry point). Nothing structural was lost by removing the runtime enforcement — the real floor was always the human at merge time. |
| **Breakdown is elidable only for a narrow, self-evident subclass** — description already names the exact file/change, nothing left to decide | Planning can't judge *hidden* complexity (it explicitly has no codebase context), but it *can* recognize when nothing is being decided at all. That's a different, safer judgment than predicting complexity. |
| **The escape hatch is a clean iteration end, not a mid-session pause-and-resume.** When a step hits something its composition didn't cover, it ends with a new trigger — call it `NeedsRecomposition`, distinct from `Blocked` (external blockers) since this is an internal plan gap, not something outside stopping it. The composer proposes what runs next as a fresh invocation, not a resumed session — see Cost model. | Simpler than an earlier draft of this doc, which had the original step pause and later resume mid-thought once a gap was resolved — real complexity for no real benefit. This reuses the exact shape already used for gate failures and rejections (iteration ends, composer reacts, new iteration begins), just with a new trigger reason. Bounds the cost of a wrong triviality guess; only nets out if it fires rarely, worth watching in practice. |
| **Compound is elidable more freely** than breakdown, for the same self-evident subclass | Not a safety check — worst case is a missed documentation opportunity, not a correctness risk. |

### Cost model

| Decision | Rationale |
|---|---|
| **No persistent supervisor re-invoked after every stage.** Compose once, re-enter only on escalation. | A full-time supervisor doubles invocation count for every Trak forever (including trivial ones), becomes a single point of failure for all routing, and fights local self-routing over authority. Escalation-triggered mirrors the `CHANGES_REQUESTED` "one-iteration-then-handoff" pattern already in the codebase. |
| **Escalation re-entry is a fresh composer invocation, not a resumed session.** *(Revised — an earlier version of this doc had the composer resume the same session for cheapness. On reflection that was inconsistent with how the worker's own escape hatch already works.)* Every recomposition (recovery, `NeedsRecomposition`, escalation) gets the Trak's durable history — original description, prior proposal, each step's checkpointed artifact, and the specific reason recomposition triggered — as ordinary context, the same way a fresh worker invocation gets the diff/artifacts after `NeedsRecomposition` rather than resuming the stalled session in place. | The worker's escape hatch already settled this exact question ("starts fresh... not resuming the stalled session in place") for the same reason: resuming mid-thought is real complexity for no real benefit once the relevant facts are durable, not session-only memory. Applying it uniformly to the composer too removes an entire category of concern — there's no long-lived composer session to manage, so there's no context-compaction problem to solve for it either (see Open questions, composer session lifetime — now resolved for the same reason). It may also produce *better* recompositions: a session that's been grinding on a plan that turned out wrong carries some anchoring bias toward defending that plan; a fresh read of the current facts doesn't. Only the initial bootstrap chat remains a genuine live session, since it's an actual back-and-forth conversation with a human. |
| **Prefer mechanical, non-agent signals over semantic judgment wherever one already exists** | Tool-call-driven exploration (reading files, `git log`, CLI history) is a bigger and more variable cost than raw prompt tokens. When a structured diagnostic already exists before any agent runs (a CI check name, a specific lint rule), route on that signal directly — don't spawn something to go rediscover what's already known. |
| **No hard cap on retries or recomposition cycles — infinite is the default, backstopped by hardcoded self-recognition prompting, not a mechanical count.** A step that keeps failing its gate gets unlimited local retries, but the orchestrator hardcodes (mechanism, not policy — see above) a nudge into every session's baseline scaffolding: if this keeps happening and looks systemic rather than incremental, use `NeedsRecomposition`. Same principle one level up: if the *composer* is repeatedly recomposing the same Trak, that's hardcoded guidance to flag it directly to a human (`Blocked`) rather than proposing yet another automated plan. | Matches current production behavior (infinite retries today) rather than introducing a new, unvalidated threshold. An arbitrary count ("3 failures," "5 recompositions") has no evidence behind it; self-recognition through prompting is a strict improvement over doing nothing, without inventing a number. Repeated recomposition is a stronger signal than a single step's repeated gate failures — multiple different plans all ran into trouble, not just one fix not landing — which is why it gets its own explicit prompting rather than being folded into the in-step version. |

### Workflow "type" — and why flows dissolve entirely

| Decision | Rationale |
|---|---|
| **"Different workflow" (bug fix, prompt tuning, feature work) is not a structural fork** — it's Technique selection within one shared space of composable stages | None of these need different artifacts, completion criteria, or integration steps — only different technique inside a stage. Modeling them as Techniques (not flows) also means a Trak touching *both* code and a prompt file can use both techniques at once, which mutually-exclusive flows can't do. |
| **The one real structural fork: does this Trak end in a PR?** | Mechanical, not a judgment call. Yes → composed from the Technique library. No → it's a chat — already a genuinely distinct *task type* in this codebase (`flow = ""`, quiescent, explicit `promote_to_flow`), not a new concept, and not something `flow` config ever governed anyway. |
| **`flow` disappears as a named, pre-authored container entirely** — no "generic pipeline," no "subtask flow." *(Corrected from an earlier draft of this doc, which kept "flows, but fewer of them.")* | Every job a flow used to do has a non-flow replacement: bounding valid next-steps → trusted directly to composer judgment, not a declared graph (see "What we chose not to mechanize"); "Done" → the composer's terminal proposal, confirmed by whatever review policy `COMPOSITION.md` specifies plus the human at merge; per-context config (model preference, gate, tool restrictions) → carried directly on the Technique that needs it, not a flow-level override. |
| **No Technique-level flag or per-stage capability gates subtask creation. What triggers child creation is the *shape* of a step's structured output — literally containing a Subtraks-style payload (child briefs + dependencies) — not the name the composer gives the surrounding artifact.** Artifact names are freeform labels with no runtime significance (already decided); "breakdown" in the worked example was just a label, not a recognized type. Only a step whose Techniques actually did decomposition work would ever produce that output shape. Not configured like today's `capabilities.subtasks` opt-in. | Same distinction the real system already makes today, independent of artifact naming: agent output comes in a few structural shapes (Artifact, Questions, Subtraks, Approval, Failed, Blocked) — `workflow.yaml`'s `artifact: breakdown` was always just a display label; the actual trigger was the output's shape plus a capability gate. We already dropped the gate; the shape check is what's left doing real work. |
| **Two separate things, only one of which needed dropping: whether an output shape is *available* to a step at all (ungated, standing option, decided above), and whether an agent has any *reason* to reach for it (purely a function of whether some composed Technique's own prompt content teaches that skill).** No Technique in the mix teaching "write self-contained briefs, declare dependencies, slice vertically" means no path to producing that shape — not because it's blocked, but because nothing pointed there. Generalizes past subtasks: the old system also gated `ask_questions` per stage the same way `capabilities.subtasks` gated decomposition. Neither needs a flag anymore — both reduce to instructional content, not permission. | Confirms the mechanism is instructional, not a permission system in disguise — avoids quietly reintroducing a capability gate under a different name. |
| **Subtask children are composed, not routed to a named flow — and breakdown *is* the composer for them, in the same invocation that writes their briefs, not a separate later step.** When breakdown creates Subtraks, it specifies each one's Technique composition directly as part of its own output — it already has full context; a subsequent "compose this child" invocation would just re-derive what breakdown had already implicitly decided while writing the brief. For a dependent child, breakdown's composition is provisional until the dependency resolves; the same escape-hatch mechanism `work` already has covers a prediction that turned out wrong. No `capabilities.subtasks.flow` pointer. | Unifies "how a subtask gets its pipeline" with "how any Trak gets its pipeline" instead of special-casing it, and avoids paying for a redundant invocation to re-decide something the entity with the most context already decided. |

### Entry point

| Decision | Rationale |
|---|---|
| **Chat becomes the universal front door**, not one option among several | A chat/assistant session already has full tool access and a prewarmed worktree — it can investigate cheaply as part of natural conversation, which fixes the "planning has no codebase context" problem outright. It's also where cross-domain ambiguity gets resolved through actual dialogue instead of a guessed classification. |
| **The chat proposes the whole composed flow up front** (plan-and-execute), not one stage at a time | Avoids the myopia risk of pure hop-by-hop self-routing, without paying persistent-supervisor cost — this *is* the one-shot composer. |
| **Auto mode is unchanged from today, and is *not* what lets a confident proposal skip confirmation.** It's a blunt, human-set, per-Trak toggle: when on, every checkpoint auto-advances unconditionally — no agent judgment involved, no exception for Questions. It has nothing to do with how good a given proposal is. | Corrected from an earlier draft of this doc, which conflated auto mode with the composer's own confidence in a specific proposal — two genuinely different mechanisms with different owners (a human's blanket policy vs. an agent's per-instance judgment). |
| **A separate, new mechanism — call it composer clearance — is what actually lets a confident proposal skip a confirmation click, independent of whether auto mode is even on.** The composer judges, per proposal, whether it's solid enough that a human doesn't need to look before execution starts. | *(Rationale revised — the original version of this leaned on "mandatory independent verification still happens regardless," which no longer exists as a runtime rule.)* This is honestly the same *shape* of risk as letting a worker decide whether its own work needs review — the composer judging its own plan. Accepted anyway, but not risk-free: whatever a PR-ending Trak produces still has to clear the human at merge time regardless of whether a human saw the plan first, and "Request Changes" on a bad result routes straight back through composer re-invocation — a real, structural correction path, not a hypothetical one. The stakes of a wrong clearance call are "a human sees the result later instead of the plan earlier," not "nothing ever checks this again." |
| **Two separable questions at the chat entry point, governed by different things.** (1) Does the composer have enough to propose *anything* coherent yet? Same scope-assessment judgment `planner.md` already makes today (Small: skip questions; Medium/Large: ask first) — independent of both auto mode and composer clearance. (2) Once it can propose a composition, does it go or wait for confirmation? Governed by composer clearance, with actual auto mode overriding on top (hands-off regardless of clearance) if a human has it turned on for this Trak. | Composer clearance must never cause (1) to get skipped — it's a judgment about whether *this specific, already-understood proposal* needs a confirmation click, not a license to guess at genuinely unclear requirements. |
| **`requirements-discovery` also exists as a discretionary Technique, not only as the bootstrap chat's own invisible scope-assessment.** *(Added after a lightweight validation exercise — see below — not a build, just prompting an Opus agent as the composer role with a Technique index + `COMPOSITION.md` and checking its judgment.)* | The exercise confirmed a composer, given a genuinely underspecified ask, can confidently propose `requirements-discovery` as the sole first step and stop there — deferring everything downstream rather than guessing — and that a *separate* fresh invocation, later handed the resulting requirements agreement plus a human's "let's build this," correctly composes the real implementation with full confidence and no re-litigating the settled scope. This doesn't replace the bootstrap chat's own scope-assessment (still real for the live pre-creation conversation) — it's the pipeline-level equivalent for a Trak that needs a dedicated, checkpointed discovery session: reopened later by new human input, or where the ask needs more structure than casual back-and-forth gives it. Whether the bootstrap chat's own Q&A becomes redundant once this Technique exists, or the two coexist for different moments, is still open — flagging rather than resolving it here. |
| **Recovery events (feedback, conflicts, failed checks) re-invoke the composer as a fresh invocation** *(revised — not a resumed session, see Cost model)*, rather than routing to a static config value | Replaces today's single hardcoded `recovery_stage`. The recomposition proposes a right-sized mini-flow for the specific fix — as small as "just `work`" for a trivial one, handed the Trak's durable history as context. Being a separate invocation from the worker sidesteps the self-grading risk with no special-case rule needed. |

---

## `workflow.yaml` inventory — what carries over

Reviewed against the live `.orkestra/workflow.yaml` (10 flows: `default`, `quick`, `hotfix`, `micro`, `prompt-iteration`, `docs`, `component`, `bugfix`, `opencode`, `pty`) — not just the packaged default.

### Per-stage fields

| Field | Fate |
|---|---|
| `artifact` | **Stays, but assigned by the composer per step, not declared by Techniques.** Techniques carry preconditions (what must exist already); the composer names each step's output when it proposes the step. No longer lives in a named flow container. |
| `gate` (command + timeout) | **Technique-carried, not pipeline-level infrastructure.** `bugfix`'s inverted-pass-fail gate confirms verification behavior is often *part of* a technique, not separate from it. A baseline "standard verification" Technique is essentially always in the mix for code-touching work by composition convention (`COMPOSITION.md`) — itself just another Technique a team chooses to lean on heavily, not a hardcoded exception outside the system. |
| `capabilities.subtasks.flow` | **Gone.** Replaced by the same composer mechanism used everywhere else, invoked with the breakdown's brief as (richer) starting context — not a pointer to a static named flow. |
| `model` | **Becomes a registry lookup (`.orkestra/models.yaml`), with optional Technique-carried overrides.** See "Model selection" below. |
| `description` | **Absorbed into Technique frontmatter.** |
| `prompt` | **Decomposed into Techniques.** ~17 largely-overlapping prompt files today (`reviewer.md`, `subtask-reviewer.md`, `prompt_reviewer.md`, `editor.md`... all "review," differently flavored) collapse toward a shared library. |
| `disallowed_tools` | **Technique-carried.** The same 7-line cargo/tauri restriction block is copy-pasted verbatim across `default.work`, `hotfix.work`, `bugfix.investigate`, `bugfix.fix` — exactly the duplication Techniques are meant to kill. |
| `integration.on_failure` | **Gone.** Superseded by composer recomposition on recovery (already decided above). |
| YAML anchors (`&work_stage`, `&compound_stage`) | **Moot.** Existed only to dedupe identical stage blocks across flows; unnecessary once stages compose from shared Techniques. |

### Flows — none of these survive as named containers; here's what each one's distinguishing content becomes

| Flow today | What it becomes |
|---|---|
| `default` | No longer a container — just the ordinary case where the composer draws on the full Technique library with no special technique flagged. |
| `quick` | Already the self-evident/skip-breakdown case, hand-authored as an escape hatch today — confirms the design rather than complicating it. Becomes "the composer skips planning/investigation Techniques," not a separate named flow. |
| `hotfix` | This project's name for today's subtask/positional routing (breakdown's children land here via a static pointer). Becomes: children are composed the same way as any Trak, from richer starting context — no named flow, no pointer. |
| `prompt-iteration`, `docs`, `component`, `bugfix` | Each collapses into Technique selection on the shared pipeline (prompt-tuning, read-only investigation, red/green, respectively). Each exists today as a full bespoke flow *because* there's no cheaper way to express "same shape, different technique" — direct validation of the redesign. |
| `micro` (work only, no review stage) | **Resolved — no longer a contradiction.** *(This previously conflicted with a runtime-mandatory review rule; that rule is gone — see Non-negotiables and Mechanism vs. policy.)* `micro`'s no-review behavior is now just an ordinary composition outcome: for a genuinely trivial Trak, the composer (per `COMPOSITION.md` guidance) may reasonably compose a sequence with a very light or no dedicated review step. Nothing carves out a special exception for it anymore — it's not a different *kind* of Trak, just a case where composition happens to be lean. |
| `opencode`, `pty` | **Not a Technique/flow question.** Different model provider / execution transport entirely, orthogonal to technique. Keep this as its own axis — don't fold into Technique composition. |

**New nuance surfaced:** `bugfix.investigate` uses `checks-expect-test-failure.sh` — a gate that only passes when tests *fail*. That's the actual enforcement mechanism for red/green, not prompt prose. A "red/green" Technique therefore can't be just a prompt fragment — it needs to carry or reference a specific gate-script behavior. **Resolved below.**

---

## Directory layout (draft)

```
.orkestra/techniques/    # Technique .md files, frontmatter-driven
.orkestra/checks/        # gate scripts, comment-header metadata
.orkestra/models.yaml    # one ranked list across all providers/transports + a default entry — see Model selection below
.orkestra/COMPOSITION.md # prose playbook guiding the composer's judgment — see Composition model decisions above
```

**No stage-role taxonomy.** A composed step has no type. It's just whichever Techniques constitute it at that position in the sequence — tool restrictions, checks, and model all *derive* from that Technique set; nothing is pre-declared by a category. Write access is open by default for every step; a Technique that genuinely needs read-only behavior restricts `Edit`/`Write` via `disallowed_tools` the same way any other tool restriction works — no separate flag. **Independent verification doesn't get special runtime treatment either** — whether and how thoroughly a step gets reviewed is entirely a composition choice, guided by `COMPOSITION.md`, backstopped only by the human at PR-merge time (see Non-negotiables and Mechanism vs. policy).

**`.orkestra/techniques/*.md` frontmatter** — deliberately minimal. No preconditions, no `incompatible_with`, no `requires_write` (see "What we chose not to mechanize" below):

- `title`, `description` — discovery/selection signal, and what the composer reads to pick candidates (see "Selection mechanism," resolved below).
- **carried check reference** — if this Technique implies specific verification behavior (see below), the reference lives here. Purely descriptive ("this Technique brings this check along") — feeds the check-union rule below, isn't itself a validation gate.
- `disallowed_tools` — Technique-carried, resolved by union (see below). Write access is open by default; a read-only Technique restricts `Edit`/`Write` here rather than needing its own separate flag.
- **`model`** — optional, references an entry in `.orkestra/models.yaml`'s ranked list (any provider/transport) — a definitive requirement, not a suggestion. When a step combines Techniques that specify different models, resolve to the highest-ranked one present — never silently downgrade.

*(An earlier draft of this doc also had a `pinned_when` field — a mechanical condition bypassing composer discretion entirely for Techniques a human never wanted silently skipped. Dropped: see Composition model decisions above. Every Technique is discretionary now; "never skip this" is a `COMPOSITION.md` instruction, not a frontmatter field.)*

**A Technique file is not the only place step-specific content comes from.** A composed step also carries a **lightweight instruction** — optional freeform text the composer writes for that step alone, not a reusable library entry (see "Composition proposal schema" below). This is where Trak-specific framing lives when no existing Technique fully covers what a step needs, without requiring the composer to draft a whole new Technique file in the moment. Compound treats recurring patterns in these lightweight instructions as ordinary input to its own learning-capture job — no explicit significance-tagging required from the composer; compound's existing tiered investigation already self-sizes how much attention this deserves.

### What we chose not to mechanize

Considered and dropped **`preconditions`** (what a Technique needs to already exist before it runs, e.g. "self-review needs a draft to review") and **`incompatible_with`** (Techniques that can never share a step, e.g. investigate ↔ work) — plus the validation logic each would have required.

The reason: both were trying to prevent mistakes a coherent composer, with full context of the Trak and of every Technique's own description, simply wouldn't make. Proposing self-review with nothing to review, or fusing investigate and work into one step, isn't a subtle failure mode a validation layer needs to catch — it's as implausible as a competent engineer scheduling a code review before any code exists. Building frontmatter fields and a set-intersection check for that is real complexity bought for a risk that doesn't materialize.

Also dropped, for a different reason — **redundancy, not implausibility**: `requires_write` (a composed step's write access is open by default; a Technique that genuinely needs read-only behavior already has `disallowed_tools` to restrict `Edit`/`Write` — no need for a second field expressing the same thing) and `expect_failure` on checks (the inversion for red/green-style checks is handled entirely inside the check script's own exit logic — the runtime never needs to interpret exit codes differently per check, it's always just "0 = pass.")

**Also removed, for a third reason — policy, not mechanism:** mandatory independent verification as a runtime-enforced rule (see Non-negotiables, Mechanism vs. policy). Unlike the items above, this one wasn't dropped because a coherent composer wouldn't need it, or because it duplicated an existing field — it was dropped because "should this get reviewed, and how thoroughly" is an opinion about software practice that varies by team, not a structural fact about the orchestration engine, and it belongs in `COMPOSITION.md`/the coordination agent's prompt instead. The backstop that made this safe to remove already existed independently: a human approves the PR before merge regardless of what the internal pipeline did.

**Same reasoning killed `pinned_when` too** (see Composition model decisions above) — once "should this get reviewed" was moved to pure prose trust, keeping a *different* mechanical bypass around for lower-stakes reliability concerns ("will the composer remember to include X") stopped being consistent. No Technique bypasses composer discretion anywhere in this design now; "never skip this" is a `COMPOSITION.md` instruction like everything else.

**The test for what's actually worth mechanizing, going forward:** mechanize when you're resolving multiple *simultaneously legitimate* requirements into one answer that has to exist no matter how good the composer is (you can't literally run two different models for one step — that's arithmetic, not error-catching). Mechanize when there's a documented *incentive* reason to distrust judgment, like self-grading bias — but note that even the self-grading concern about verification was ultimately resolved as policy, not mechanism, once the actual backstop (the human at merge) was accounted for; "self-grading bias exists" doesn't by itself mean the runtime has to enforce the fix. Don't mechanize to catch a mistake a reasonably capable, fully-informed composer wouldn't make in the first place, and don't mechanize an opinion just because it's a good opinion — put good opinions in `COMPOSITION.md` where they're visible and editable instead.

**`.orkestra/checks/*.sh` frontmatter is real, just not literal top-of-file YAML** (the shebang has to be line one). Pattern: a delimited comment block immediately after the shebang, parsed by a loader and otherwise inert to the shell:

```bash
#!/usr/bin/env bash
# ---
# title: Expect Test Failure
# description: Passes only when the target test fails — proves a regression test demonstrates the bug
# timeout_seconds: 1200
# ---
```

No `expect_failure` flag — the inversion for red/green-style checks lives entirely in the script's own exit logic (see the worked example below). The runtime's contract is identical for every check, always "exit 0 = pass"; `description` documents what that means for this particular script.

### Model selection: `.orkestra/models.yaml` is a single ranked preference list, no provider carve-out

| Decision | Rationale |
|---|---|
| **`.orkestra/models.yaml` is one ranked list across *all* available models/providers/transports** (Claude direct, `claude-pty/*`, `opencode-go/*`, whatever else) — not tiers-with-a-carve-out for exotic providers. Techniques carry `model` referencing an entry in this list — a definitive requirement, not a soft hint; a composed step resolves to the **highest-ranked value** among its constituent Techniques; nothing specified anywhere → the list's default entry. | One list, one rule, no special-casing by provider. Model tier stays low-stakes to get wrong — quality isn't gated on it the way it might have been under the old mandatory-review framing — so "take the highest-ranked value present" resolves conflicts for free. |
| **Checks resolve by union + dedup, not by rank.** A composed step's checks = every check reference across its constituent Techniques, duplicates removed, and the step must pass **all** of them to advance. | Different resolution *kind* than model tier, and deliberately so: model tier is a scalar with a natural order (max wins); checks are a set of independent verification concerns that can coexist (union wins). `disallowed_tools` is the same shape as checks — a set, union wins. **General rule:** how a Technique-carried property resolves depends on whether it's scalar-with-order (→ max) or a set (→ union), not decided ad hoc per field. |
| **Contradictory checks composed into the same step... are trusted to the composer, not caught by a declared `incompatible_with` field.** | Dropped `incompatible_with` entirely (see "What we chose not to mechanize" above) — a composer with full context wouldn't fuse investigate and work into one step any more than it would misname an artifact. |
| **Artifact type is assigned directly by the composer when it proposes a step — not derived from Technique declarations.** | The composer already has full context of every Technique going into a step, so naming the output isn't a new judgment call. |

---

## Composition proposal schema

*(New section — this didn't exist as concrete schema in the earlier draft; it's what a composer invocation actually emits.)*

```
Proposal:
  steps: [Step]       # ordered, the composer's proposed sequence
  clearance: bool     # composer's own judgment — skip human confirmation?

Step:
  artifact_name: string      # composer-assigned label, no runtime meaning beyond display
  techniques: [string]       # 0+ Technique name references; empty is valid
  instruction: string?       # optional lightweight freeform text
```

Deliberately minimal. A few things it does *not* carry, and why:

- **No model/checks/`disallowed_tools` fields.** These are derived downstream by mechanical resolution (max over `techniques`' model values, union over their checks/tools) once a step's Technique list is known — not something the composer computes or restates.
- **No `is_done` field.** A Trak reaches Done when the proposed sequence is exhausted and the last step's actual output happens to be Approval-shaped — a consequence of execution, not something the proposal declares up front.
- **No per-step provisional flag.** Every step past the first is implicitly revisable via `NeedsRecomposition` if reality diverges — that's already true of the whole mechanism, so marking specific steps "provisional" would be redundant.
- **No justification string alongside `clearance`.** Considered adding one for later human auditing, but the composer's full reasoning already exists in its own session transcript if anyone needs to check it.
- **A proposal exhausting without an Approval-shaped output doesn't force anything on its own.** If the last step's output isn't Approval-shaped (e.g. a proposal that only ever committed to a `requirements-discovery` step), the Trak isn't Done and nothing mechanically re-invokes the composer either — it simply sits, artifact checkpointed, the same way a quiescent non-PR chat waits for `promote_to_flow`. A fresh composer invocation only happens when something actually occurs — a human responds, feedback arrives — never on a bare "the proposal ran out of steps" rule. Validated by the same exercise referenced in the Entry point section above: a fresh invocation handed the original ask, a settled requirements agreement, and a human's explicit "let's build this" correctly resumed composing — nothing needed to force that call before the human supplied it.

**This same schema is reused, not duplicated, in three places:**
1. The initial bootstrap proposal from the chat entry point.
2. Any recomposition (recovery, `NeedsRecomposition`, escalation) — same shape, invoked with the Trak's durable history as context instead of a fresh Trak description.
3. Nested inside each child of a `Subtraks` payload: `{ brief: string, depends_on: [child_id], proposal: Proposal }` — breakdown *is* the composer for its own children, so it emits this directly as part of its own output rather than a second, different schema.

---

## Worked examples

### A full Technique file

`.orkestra/techniques/red-green.md`:

```markdown
---
title: Red/Green Investigation
description: >
  Investigate a bug by writing a failing test that reproduces it, before
  attempting any fix. Use when root cause isn't yet confirmed and the bug
  is reproducible.
check: expect-test-failure
model: opus
---

# Red/Green Investigation

Find the root cause of the reported bug and prove it with a failing test —
do not implement a fix in this step.

1. Reproduce the reported symptom.
2. Identify the root cause in the code.
3. Write a test that demonstrates the bug. It must fail.
4. Stop there — fixing it is a separate step.

Your artifact should describe the root cause and point to the failing test.
```

Its carried check, `.orkestra/checks/expect-test-failure.sh`:

```bash
#!/usr/bin/env bash
# ---
# title: Expect Test Failure
# description: Passes only when the target test fails — proves the regression test demonstrates the bug
# timeout_seconds: 1200
# ---
set -euo pipefail
if cargo test "$1" 2>&1 | grep -q "test result: FAILED"; then
  exit 0   # failed as expected — bug reproduced
else
  echo "Expected this test to fail (proving the bug); it passed."
  exit 1
fi
```

Two more, in brief, for contrast:

- `.orkestra/techniques/implementation-conventions.md` — pure behavioral guidance ("follow existing project patterns"), `model: sonnet`, no check of its own, no tool restrictions (write access is open by default). A modifier, not artifact-defining, present in nearly every code-touching step.
- `.orkestra/techniques/standard-verification.md` — a verification-floor Technique this team chooses to lean on heavily via `COMPOSITION.md` convention (and possibly `pinned_when`), carries `check: standard-checks` (lint/build/test), no `model` specified. Not a runtime-mandatory category — just a Technique this team almost always wants included, the same way `implementation-conventions` is.

### Use case 1 — Build: "Add a `--json` flag to `ork trak list`"

Self-evident from the description alone — no ambiguity, no design decision.

1. Chat: human describes it. The composer peeks at `cli/src/main.rs` (cheap — chat already has a worktree), confirms this is contained, and proposes the whole sequence up front:
   - **Step 1** — Techniques: `implementation-conventions` + `standard-verification`. Composer names the artifact `summary`. Model: only `implementation-conventions` specifies one (`sonnet`) → resolves to `sonnet`. Checks: union → just `standard-checks`, normal pass semantics.
   - **Step 2** — Techniques: `focused-review` (a lighter review Technique — sizes itself down internally, same in-session depth dial `reviewer.md` already does today). Composer names the artifact `verdict`. Included here because `COMPOSITION.md` calls for an independent look at code-touching work, not because anything forces it.
   - No breakdown-equivalent, no compound — self-evident subclass, both elided.
2. Composer is confident enough in this specific proposal to grant it composer clearance — both steps proceed without a confirmation click. Each step still checkpoints its own artifact.
3. Step 1 runs, `standard-checks` passes, advances. Step 2 approves. Done.

### Use case 2 — Fix: "Export crashes on an empty dataset"

Not self-evident — root cause unknown, could be contained or not.

1. Chat: human describes the symptom. The composer can't tell yet whether this is one line or several, so it proposes investigation first, rather than guessing:
   - **Step 1** — Technique: `red-green`. Composer names the artifact `investigation`. Model: `red-green` specifies `opus` → resolves to `opus`. Check: `expect-test-failure` — must see the new regression test *fail* to advance, proving the bug is real.
   - **Step 2** — Techniques: `implementation-conventions` (specifies `sonnet`) + `regression-safety` (a Technique for user-facing crash fixes, specifies `opus`, no check of its own) + `standard-verification`. Composer names the artifact `summary`. Model resolves to `opus` — the higher-ranked one wins even though `implementation-conventions` asked for less.
   - **Step 3** — an independent review, per `COMPOSITION.md` convention for code-touching work, sized down to two reviewers by its own scope assessment given a contained fix. Artifact: `verdict`.
   - **Step 4** — compound runs (Tier 1 passive scan) — this Trak needed real investigation, so it doesn't qualify for the self-evident elision Use Case 1 got. Likely no-ops here (clean fix), but it still runs.
2. The composer isn't fully confident this is as contained as it looks, so it withholds clearance and pauses for a human to confirm the proposed sequence before any step spawns.
3. Step 1 runs — the test fails as expected, bug reproduced, advances. Step 2 runs — `standard-checks` pass, advances. Step 3 approves. Step 4 no-ops. Done.

### Use case 3 — Subtasks: "Add `.orkestra/techniques/` loading with a CLI to inspect it"

Big enough, and split-able enough, that decomposition earns its keep — unlike Use Case 2, which stayed one linear chain even though it needed real investigation.

1. Chat: human describes wanting the frontmatter-parsing system plus `ork technique list`/`show` commands to inspect it. The composer notices this bundles more than one plausible deliverable (parsing vs. CLI surface) — it doesn't try to confirm from the description alone whether that's a real interface seam or a false one; that confirmation is `vertical-slice-decomposition`'s own job, done with actual codebase research once it runs (see the next step).
2. Composer proposes:
   - **Step 1** — Technique: `vertical-slice-decomposition` (does its own codebase research, same self-limiting Case 1/Case 2 judgment `breakdown.md` already makes today). Composer names the artifact `breakdown` — a label for display, nothing more. What actually triggers child creation is the *shape* of the output: it literally contains a `Subtraks`-style payload (child briefs + dependencies + each child's own `Proposal`).
   - The breakdown names two Subtraks, each with a self-contained brief **and its own nested `Proposal`** (per the schema above) — it's already the entity with full context, so there's no separate later step re-deriving what it just decided. **A** — "Technique frontmatter parser": `implementation-conventions` + `standard-verification`. **B** — "`ork technique list`/`show` CLI commands," declared dependent on A's interface: `implementation-conventions` + `standard-verification`, provisional pending A's actual output.
   - Parent enters `WaitingOnChildren`.
3. **Subtrak A executes the composition breakdown already specified** — merges into the parent's branch. No separate compose-then-execute step; breakdown's proposal for an independent child is final.
4. **Subtrak B executes next**, checked against what breakdown assumed: if A's actual finished interface matches the brief closely enough, B runs the composition as specified. If it's genuinely diverged, B raises `NeedsRecomposition` — a fresh composer invocation revises before proceeding, rather than executing a stale plan built on a prediction that turned out wrong.
5. Once both children are Done, **the parent gets one more composed step of its own** — an `integration-consistency-review` Technique checking the pieces actually fit together (does B's CLI usage match what A's parser really exposes, not just what the brief assumed).
6. Compound runs at the parent level once that closes out. Done.

The contrast worth noticing: Use Case 1 skips two steps entirely and never pauses for a human; Use Case 2 keeps every step and pauses once, up front; Use Case 3 forks into two independently-composed children and adds a step neither child's own verification would've caught — driven entirely by what the composer could tell from the description and the breakdown's own findings, not by which named flow someone picked at creation, and not by any rule forcing review to exist at all.

### Use case 4 — Underspecified ask: "Make the Trak review process better"

Unlike Use Cases 1-3, the *ask itself* is unclear, not just the implementation. "The Trak review process" could mean the automated `standard-review` agent's own behavior, the human-facing review UX in the frontend, the review stage's routing, or a prompt file — and "better" names no direction at all.

1. Chat: the human's description doesn't resolve this. Rather than guess a domain, the composer proposes exactly one step:
   - **Step 1** — Technique: `requirements-discovery`. Composer names the artifact `requirements`. The instruction surfaces the distinct interpretations directly and asks the human to pick, alongside what "better" should mean concretely. Nothing downstream is proposed — the composer is explicit that composing further has to wait for this to resolve.
2. Composer withholds clearance — this is exactly the case a human should see before it runs.
3. Human confirms; `requirements-discovery` runs its own rounds of questions and lands a requirements agreement: the ask meant the review verdict's *presentation* in the frontend (not the underlying review logic) — a scoped, presentation-only `src/components/` change with explicit success criteria and no open technical questions.
4. Nothing forces the Trak to keep moving from here — it sits, artifact checkpointed, same as a quiescent chat (see Composition proposal schema, above). Only once the human says "let's implement this" does a fresh composer invocation reconsider: given the now-settled requirements agreement, it confidently composes `implementation-conventions` + `storybook-story` + `standard-verification` (frontend, touches `src/components/`) → `standard-review` → `compound-learning-capture`, and grants clearance this time — the ambiguity that justified withholding it originally is gone.

The contrast this adds to the other three: Use Case 4 is the only one where the *ask*, not the implementation, was the open question — and resolving it costs exactly one extra recomposition boundary, not a rebuilt pipeline or a special-cased "planning stage."

---

## Open questions

**Naming**

- [x] ~~Finalize a name for the composable-technique concept.~~ Resolved: **Technique**. Considered a musical register (Motif, Riff, Lick, Phrase, Étude) and an ork/swarm register (Stratagem, Tactic, Instinct, Ploy) — landed on the plain, explicit option instead of a themed one. Avoided "Capability" (collides with existing `workflow.yaml` stage `capabilities`) and "Trait" (collides with Rust language semantics and this codebase's documented "Interface (trait)" pattern).

**Technique mechanics**

- [x] ~~How do multiple mandatory Techniques combine into one coherent step without contradicting each other?~~ Resolved: **trust the composer.** Considered and dropped both `preconditions` (sequencing) and `incompatible_with` (exclusion) as declared, checked fields — both were guarding against mistakes a composer with full Trak context simply wouldn't make. See "What we chose not to mechanize" for the general test of what's actually worth mechanizing vs. not.
- [x] ~~Selection mechanism must stay cheap for the discretionary Techniques only.~~ Resolved: expose a compact index — `title` + `description` for every discretionary (non-pinned) Technique in the library — on every composition call; only the selected Technique's full body gets loaded, and only for the step it's attached to. No separate `tags` taxonomy on top of prose description — same "trust a coherent reader" reasoning already used for dropping `preconditions`/`incompatible_with`. This is deliberately the cheapest thing that could work for a realistically-sized (dozens, not hundreds) library, not a permanent answer — revisit with real retrieval/filtering machinery only if the index itself becomes a meaningful cost or the composer starts visibly missing relevant entries.
- [x] ~~What's the default/floor Technique when nothing specific matches?~~ Resolved: no separate configured "default Technique" needed. Every step already gets irreducible orchestrator scaffolding regardless of Technique selection (its brief, how to signal Done/Blocked/`NeedsRecomposition`, tool access) — Techniques are additive on top of that, not the sole source of behavior. An empty Technique list just means no additive guidance layered on, which is a coherent outcome, not undefined behavior. Separately, a composed step always may carry an optional **lightweight instruction** — freeform, Trak-specific, not a reusable library entry — for the middle ground where no existing Technique fully fits but a full new Technique isn't warranted either. Compound treats recurring lightweight-instruction patterns as ordinary input to its own learning-capture job (no explicit significance-tagging required from the composer).

**Pipeline mechanics**

- [x] ~~If flows no longer serve as the bounding/validation set, what replaces `has_stage()`-style validation?~~ Resolved: nothing formally replaces it. The composer names each step's artifact and picks its Techniques directly, trusted the same way we trust it not to propose incoherent combinations.
- [x] ~~What's the minimal fixed stage-role taxonomy the runtime needs?~~ Resolved: none. Worktree access, tool restrictions, checks, and model are all Technique-declared — a composed step derives everything it needs from its Technique set, no pre-declared category required. *(Updated: this now includes independent verification too — it doesn't get a "review" role or a mandatory-tag category either. Whether and how a step gets reviewed is entirely a composition choice, see Mechanism vs. policy.)*
- [x] ~~Concrete schema for a stage's output to carry a routing/composition proposal.~~ Resolved: see "Composition proposal schema" above — `Proposal { steps: [Step], clearance }`, `Step { artifact_name, techniques, instruction? }`. Model/checks/tools always derived downstream, never composer-authored. Same schema reused for recomposition and nested inside `Subtraks` children.
- [x] ~~Concrete mechanism for `work`'s escape hatch?~~ Resolved: a `NeedsRecomposition` trigger, same shape as gate failure/rejection (clean iteration end, composer reacts via a fresh invocation, proposes next step).
- [x] ~~Escalation trigger thresholds for composer re-entry (rejection count, gate failure count, explicit low-confidence signal)?~~ Resolved: no mechanical count. `NeedsRecomposition` stays fully explicit and judgment-driven — no threshold triggers it automatically. For failures that don't come with an explicit signal, infinite local retries remain the default (matches current production behavior), backstopped by a hardcoded (mechanism, not policy) prompt nudge: if repeated gate failures look systemic rather than incremental, use the bailout. Merge conflicts escalate to composer re-entry only once the existing automatic conflict-recovery logic in `integration.rs` already gives up — no new threshold invented there either.
- [x] ~~(New, surfaced in this pass) Should there be a cap on `NeedsRecomposition` cycles for a whole Trak?~~ Resolved: no hard cap here either — same self-recognition principle applied one level up, hardcoded into the composer's own baseline instructions: if it's recomposing repeatedly for the same Trak, that's guidance to flag it directly to a human via `Blocked` rather than proposing yet another automated plan. Repeated recomposition is treated as a stronger signal than repeated in-step gate failures (multiple different plans running into trouble, not just one fix not landing), which is why it gets its own explicit prompting rather than folding into the in-step version.
- [x] ~~Exact criteria for the mechanical "provably formatting-only" review bypass.~~ **Moot.** This only mattered as a bypass for a mandatory review floor; that floor no longer exists as a runtime rule (see Non-negotiables). A `micro`-shaped, trivial Trak is now just an ordinary composition outcome, not a special bypass case.
- [x] ~~Composer session lifetime: does it persist across the entire Trak lifecycle including post-Done recovery, or does something re-anchor it? When does it get compacted?~~ Resolved, and simpler than the question assumed: it doesn't persist past the initial bootstrap chat at all. Every subsequent composer invocation — recovery, `NeedsRecomposition`, escalation — is a fresh spawn handed the Trak's durable history (description, prior proposal, artifacts, the specific trigger reason) as ordinary context, not a resumed session (see Cost model). "Post-Done recovery" isn't really a coherent case either: once a Trak is actually Done (merged), anything that comes up afterward is a new Trak with its own fresh bootstrap chat, not a reopening of the old composer's context. No compaction mechanism needed, because there's no long-lived session to compact.

**Rollout**

- [x] ~~No discussion yet of migration from the current static `default`/`subtask` YAML flows to this model, or whether they coexist during a transition.~~ Resolved: hard cutover, no coexistence period. This project's own policy is no backwards-compatibility shims for a codebase with no external users yet — maintaining two parallel pipeline-shape mechanisms (named-flow lookup and composed-step execution) simultaneously across the orchestrator, frontend, and test suite would cost real ongoing complexity for a transition period the project doesn't actually need. In-flight Traks get resolved manually before cutover (single-user codebase, so this is cheap); `workflow.yaml`'s flow definitions and the legacy stage-config code path get deleted outright in one commit once the composed system covers what the converted Technique library needs.

---

## Terminology (working)

- **Technique** — a small, named, combinable behavior unit (e.g. red/green, prompt-investigation). A composed step's behavior *is* its Technique combination, including its check, tool restrictions, and model requirement, plus whatever lightweight instruction the composer adds on top.
- **Composer** — the role (chat at bootstrap, a fresh invocation at recovery/escalation, or breakdown composing for a subtask child) that proposes a Trak's composed sequence of steps/Techniques. Not a persistent supervisor, and not a persistent session past the initial bootstrap chat — every later invocation is fresh, handed durable context rather than resumed. One mechanism, used everywhere a pipeline needs to be shaped.
- **Composed step** — a discrete, checkpointed unit of execution (its own session, its own artifact) identified by its position and its Technique contents plus its lightweight instruction — not by a pre-declared type. Replaces "stage" as a typed concept; "stage" is still fine as loose shorthand for "one step in the sequence."
- **Lightweight instruction** — optional freeform text the composer attaches to a step, alongside or instead of Technique references. Trak-specific, not a reusable library entry. Recurring patterns here are a signal for compound to consider proposing a new named Technique — captured as a reviewable draft, not silent, ephemeral improvisation.
- **Structural fork** — a decision that changes the Trak's actual artifacts/state (create Subtraks) — earns pipeline-level visibility.
- **Depth dial** — a decision that only changes how much effort a step spends (panel size, investigation depth) — stays in-session.
- **Mechanism vs. policy** — mechanism is protocol-level and hardcoded in the orchestrator, identical across every deployment (output shapes, escape-hatch behavior, self-recognition prompting); policy is an opinion about how software should be built or validated, and lives entirely in Techniques/`COMPOSITION.md`/the coordination agent's prompt. Several early drafts of this doc mistakenly baked policy into mechanism (stage-role taxonomy, mandatory verification) before correcting course.
- **Composer clearance** — the composer's own per-proposal judgment that a specific composed sequence is solid enough to skip a human confirmation click before execution starts. Distinct from **auto mode**, a blunt, human-set, per-Trak toggle that advances everything unconditionally regardless of any agent's judgment. The backstop for a wrong clearance call is the human at PR-merge time plus the recomposition loop on "Request Changes" — not a runtime-enforced review floor.
