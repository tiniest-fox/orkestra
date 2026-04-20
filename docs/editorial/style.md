# Writing Style Guide

Concrete rules derived from the Diátaxis framework and analysis of Linear and Tailscale — the docs sites we benchmark against. These apply to every page. When a rule conflicts with instinct, the rule wins.

---

## Document Type Model (Diátaxis)

Every page belongs to one primary type. The type determines structure, tone, what to include, and what to leave out. Getting this wrong is the root cause of most docs that feel muddled.

### The two axes

```
                   ACQUISITION (learning)
                          │
          Explanation     │     Tutorial
          (understand)    │     (learn by doing)
                          │
COGNITION ────────────────┼──────────────────── ACTION
(thinking)                │                  (doing)
                          │
          Reference       │     How-to guide
          (look up)       │     (accomplish a task)
                          │
                   APPLICATION (working)
```

- **Tutorials** — doing + learning. The reader is a student. You lead; they follow.
- **How-to guides** — doing + working. The reader is a practitioner solving a specific problem.
- **Reference** — thinking + working. The reader needs a fact while mid-task.
- **Explanation** — thinking + learning. The reader is studying to build understanding.

### The diagnostic tests

**Tutorial vs. how-to:** Is the reader here to build general competence, or to accomplish one specific thing? Tutorials make learners; how-tos serve practitioners. *The most common conflation in developer docs.*

**Reference vs. explanation:** Would someone read this *while actively working*, or *after stepping away to think*? Reference is consulted mid-task. Explanation is read to understand. If it's boring and list-like — it's reference. If it needs context and "why" — it's explanation.

### The purity rule

**Don't mix types on a single page.** Each type excludes the others by design:
- Tutorials: don't explain why things work, don't offer choices, don't include reference material
- How-to guides: don't teach concepts, don't include background, don't assume the reader is a beginner
- Reference: don't interpret, don't explain rationale, don't include step-by-step instructions
- Explanation: don't include steps, don't solve immediate problems, don't list every option

When a page feels unfocused, run the diagnostic tests above. It's almost always a type collision.

---

## Openings

**Lead concept pages with the problem, not the feature name.**
Before naming what a feature is, state the pain it solves. Readers need to know why they should care before they'll absorb what it is.

> ❌ "Quality gates are a feature of Orkestra stages that run a shell script after agent work completes."
> ✅ "Agents don't always get it right on the first pass. Quality gates catch failures automatically and send the agent back to fix them — without you having to watch."

**Never open with the page title restated.**
If the page is titled "Traks", don't start with "A Trak is...". Start with what problem it solves or what it enables.

**No soft openings.**
Never use: "In this guide, we will...", "This document covers...", "Welcome to...", "Let's explore...". Start with content.

---

## Concept Pages

**Three-part intro: definition → clarification → analogy.**
For any non-obvious concept, introduce it in three moves: say what it is, clarify what makes it distinct, then give an analogy that grounds it. Do this in ~80 words or fewer before moving on.

**No implementation details on concept pages.**
A concept page explains what something is and why it exists. Configuration options, YAML syntax, and step-by-step setup belong in how-to or reference pages. Mixing them makes concept pages bloated and how-to pages redundant. Link out instead.

**End concept pages with a clear "what next" link.**
Readers who finish a concept page are ready to act. Give them one obvious next step.

---

## How-To Pages

**Prerequisites in the first paragraph. Always.**
If a task requires something — a specific config, an installed tool, a workflow setup — say so in the first two sentences. Never bury prerequisites midway through.

**Setup and requirements come after a brief orientation.**
For complex features, spend one short paragraph explaining what the reader is about to set up and why, then list requirements. Don't open cold with a requirement list.

**Callouts explain the why behind a step, not just flag it.**
A callout after a step should answer the implicit question "why do I need to do this?" — not just repeat what the step said.

> ❌ `<Callout>` The gate must exit zero to pass. `</Callout>`
> ✅ `<Callout>` The gate's exit code is how Orkestra decides whether to advance or retry. A non-zero exit sends the agent back with the script's output as feedback. `</Callout>`

---

## Structure

**Headers communicate meaning without reading the body.**
Read only the headers on a page. You should understand what the page covers and roughly where to find each thing. If a header only makes sense in context ("Next steps", "More on this", "Overview"), rewrite it.

**Group complex features by capability, not by UI location.**
When a feature has multiple sub-features, group sections by what each capability *does*, not by where it lives in the UI or config file.

> ❌ Settings → Stages → Gate Configuration → Timeout
> ✅ Automatic Retries / Approval Checkpoints / Failure Handling

**No transition prose.**
Never write: "Now that we've covered X, let's move on to Y.", "With that in mind...", "As mentioned above...", "It's worth noting that...". Just start the next section.

---

## Callout Usage

Each callout type has a specific job. Use the right one:

| Type | Use for |
|------|---------|
| `note` | Supplemental context that doesn't fit in the flow but is genuinely useful |
| `tip` | An optional improvement or shortcut the reader might not discover themselves |
| `warning` | Something that can go wrong or a constraint that surprises people |
| `danger` | Something that will cause data loss, breakage, or hard-to-reverse consequences |

Don't use callouts as a way to avoid integrating information into the prose. If you're reaching for a callout for every other paragraph, the structure needs rethinking.

---

## Availability and Constraints

**State feature availability and limits explicitly.**
If a feature has plan-gating, limits, or prerequisites, say so plainly inline — don't hide it in a footnote or assume the reader will discover it. ("Available on all plans." / "Requires a gate configured in `workflow.yaml`.")

**State constraints as facts, not warnings.**
Constraints aren't scary — they're just true. State them directly without over-hedging.

> ❌ "Note that you should be aware that a Trak's flow cannot be changed after creation."
> ✅ "A Trak's flow is fixed at creation time."

---

## Cross-Referencing

**Cross-reference, never duplicate.**
When a page touches a concept covered elsewhere, link to it in one sentence. Don't re-explain it inline — that creates two sources of truth.

**Link on first mention.**
The first time a page uses a concept that has its own doc page, link it. Don't link every subsequent mention.

---

## Handling Unverified Fields

When the research analysis flags a field or feature as "needs team verification before documenting" or "verify before writing," do **not** document it as stable. Instead:

- Include the field in its natural location in the reference table.
- Immediately follow with a `warning` Callout stating that the field's behavior is unverified and may change.

```mdx
| `auto_merge` | boolean | No | `false` | If `true`, merges automatically ... |

<Callout type="warning" title="Unverified behavior">
The `auto_merge` field was found in the source but is not documented elsewhere. Its behavior is unverified — treat it as experimental until confirmed.
</Callout>
```

**Never omit a flagged field** — silently skipping it leaves readers with an incomplete reference. **Never document it as stable** — doing so creates a HIGH finding in the review stage.

---

## Anti-Patterns

These are always wrong:

- "In this guide, we will explore..."
- "It's worth noting that..."
- "Please note that..." (use a Callout)
- "As mentioned above..."
- "Now that we've covered X..."
- Restating the page title in the first sentence
- Burying prerequisites after the first step
- A concept page with YAML examples in it
- A how-to page that starts with a conceptual explanation longer than two sentences
