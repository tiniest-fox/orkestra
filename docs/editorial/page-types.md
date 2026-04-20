# Page Type Reference

Structural templates for every doc page type in use. Each entry defines the purpose, skeleton, primary persona, and a pointer to the current gold-standard exemplar.

These complement `style.md` (which covers tone and anti-patterns) and `personas.md` (which covers reader profiles). Use them when starting a new page or auditing an existing one.

---

## Page Types at a Glance

| Type | Diátaxis equivalent | Primary persona | Reader goal |
|------|---------------------|-----------------|-------------|
| [Product Overview](#product-overview) | Explanation (macro) | Team Lead / Evaluator | Understand what Orkestra is and whether it fits |
| [Concept Guide](#concept-guide) | Explanation (focused) | Practicing Engineer | Build an accurate mental model of one concept |
| [Tutorial](#tutorial) | Tutorial | Vibe Coder | Get something working end to end |
| [Reference](#reference) | Reference | Practicing Engineer | Look up a specific option, field, or value |

---

## Product Overview

**Purpose:** The entry point to the docs. Answers "what is this and why would I use it?" for a reader who has never touched Orkestra. Surfaces the key concepts and routes the reader to the right starting point.

**Primary persona:** Team Lead / Evaluator (skimming for signal), with Vibe Coder as the secondary reader who might start here before jumping to the tutorial.

**Exemplar:** `src/content/docs/overview.mdx`

### Skeleton

```
[Opening — problem statement, 1–2 sentences]
  Start with the pain that Orkestra solves, not with Orkestra itself.
  End with a one-sentence summary of the solution.

[Early-stage / status callout, if applicable]
  Use type="note". Only if there's a meaningful constraint the reader
  should know before going further (e.g., alpha software, breaking changes).

## How it works
  3–5 numbered steps describing the high-level flow from user intent to outcome.
  Each step: bold verb phrase + one sentence of explanation.
  No configuration detail, no edge cases — just the happy path.

## Key concepts
  Bullet list of 3–6 foundational terms with one-sentence definitions.
  Link each term to its concept guide page on first mention.
  Include only what's needed to navigate the rest of the docs.

## Get started
  One sentence + a single link to the tutorial or getting started guide.
  No other next steps — the reader has one job.
```

### Rules for this type

- The opening must state the problem *before* naming the solution. Never lead with "Orkestra is..."
- No YAML, no configuration, no code examples. Those belong in concept guides and reference pages.
- `## Key concepts` is a glossary, not a full explanation. If a term needs more than two sentences, it needs its own concept guide page.
- One "Get started" link at the end. Don't give the reader three options.

---

## Concept Guide

**Purpose:** Teaches the reader what one concept is, why it exists, and how it behaves — so they can build a correct mental model before they configure anything. The goal is understanding, not action.

**Primary persona:** Practicing Engineer who wants the full picture before touching config.

**Exemplar:** `src/content/docs/traks.mdx`

### Skeleton

```
[Opening — problem → concept → analogy, ~80 words]
  Sentence 1: State the problem this concept solves.
  Sentence 2: Name the concept and define it in one clause.
  Sentence 3 (optional): A clarifying contrast ("Unlike X, this is Y").
  Sentence 4: An analogy that grounds the concept in something familiar.

## Anatomy of a [Concept]
  What is a [Concept] made of? What are its parts?
  Use a bullet list with bold property names + brief definitions.
  Include a Callout if any property has a non-obvious constraint.

## [Concept] Lifecycle  (or "How [Concept] Works")
  How does this thing behave over time?
  Use a Mermaid diagram for sequential or branching flows.
  Follow the diagram with a table mapping phase names to descriptions.
  Use user-facing phase names (see disambiguation.md), never internal state strings.

## Key Behaviors  (or named capability sections)
  What does this concept do that the reader needs to understand?
  Use bold phrases as sub-headings within the section (not ### headers).
  Each behavior: 2–4 sentences. State what it does, then why it matters.
  Cross-reference configuration pages at the end of each behavior — don't embed YAML here.

[No configuration examples. Link to the relevant reference page instead.]
```

### Rules for this type

- No YAML or configuration syntax on a concept page. If you find yourself writing `gate.command:`, stop and link to the reference page instead.
- The analogy in the opening is mandatory for any non-obvious concept. It's the fastest path to an accurate mental model.
- End with a clear "what next" sentence pointing to the how-to or reference page. A reader who finishes a concept page is ready to act.
- A concept page that runs longer than ~600 words is usually trying to be two pages. Split it.

---

## Tutorial

**Purpose:** Gets the reader from zero to a working setup through a linear, step-by-step procedure. The reader's goal is to succeed at the task, not to understand why each step works. Explanations are kept minimal.

**Primary persona:** Vibe Coder who wants to see it work before they understand how.

**Exemplar:** `src/content/docs/get-started.mdx`

### Skeleton

```
[Opening — prerequisites, no fluff]
  One sentence stating what the tutorial accomplishes.
  Immediately followed by a bullet list of prerequisites (tools, versions, API keys).
  No motivating paragraph. No "in this guide, we will...".

## [Major task name]  (e.g., "Installation")
  <Steps>
    1. **Short imperative title**

       One to three sentences of explanation.
       Include the exact command the reader needs to run.

    2. **Next step**

       Explanation. Code block if needed.
  </Steps>

## What's next
  One to three sentences.
  Give the reader exactly one logical next step — a link to the first concept guide
  or the configuration reference they'll need for their project.

[GitHubButton at the end, optional]
```

### Rules for this type

- Prerequisites come first — before any steps, before any explanation. Never bury them.
- Steps use `<Steps>` with `**bold imperative titles**`. Each step title should be an action ("Clone the repository", not "The repository").
- Keep explanations inside steps minimal. The reader is not here to learn; they're here to do. Save "why" for a Callout if it's genuinely needed to prevent mistakes.
- "What's next" is a single link. Don't give the reader a menu.
- No advanced options, edge cases, or alternative paths inside the tutorial. Those go in a reference page. If there's an alternative (e.g., npm vs. pnpm), pick the recommended one and note the alternative briefly in parentheses.

---

## Reference

**Purpose:** The complete, scannable specification for a configuration surface, API, or command. The reader is mid-task and needs a specific fact. They are not reading linearly.

**Primary persona:** Practicing Engineer who already understands the concept and needs the exact field name, type, or default.

**Exemplar:** `src/content/docs/workflow.mdx`

### Skeleton

```
[Opening — one paragraph, orientation only]
  State what file or command this page documents and what it controls.
  Name any key terms (flow, stage, etc.) in one sentence each.
  No setup instructions. No conceptual background beyond what's needed
  to read the tables below.

## File Structure  (or "Command Structure", "Object Structure")
  A minimal code block showing the shape of the config with placeholder values.
  This gives the reader orientation before the detailed field tables.

## [Top-level object] Fields
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  One row per field. Descriptions are facts, not instructions.
  Include default values in the Description column where applicable.

  Add a Callout immediately after the table for any field with a non-obvious
  constraint (e.g., mutual exclusivity, ordering requirements).

## [Nested object or sub-feature] Fields  (repeat as needed)
  Same table structure. Add a short code block example after each table
  showing the fields in context — not a full annotated example, just enough
  to show correct nesting.

## Full Annotated Example  (at the end)
  A complete, realistic, working example of the config file.
  Include comments (# comment) to explain non-obvious choices.
  This is the "copy and customize" starting point.

[GitHubButton at the end]
```

### Rules for this type

- No conceptual background beyond the one-paragraph orientation. If the reader needs to understand *why* a field exists, that's a concept guide. Link to it.
- Every field must appear in the table. Omissions are bugs.
- Descriptions in tables are facts ("Stage to return to on rejection"), not instructions ("Set this to the name of the stage you want to return to").
- The Full Annotated Example is not optional for config reference pages. It's what a reader copies when they're starting from scratch.
- Don't add "See Also" sections. Cross-reference inline, on first mention, using a sentence — not a link list at the bottom.

---

*Maintained by the editorial system. Add a new entry when a new page type is introduced to the docs.*
