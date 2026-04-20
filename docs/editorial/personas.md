# Orkestra Documentation Personas

These personas represent the primary readers of the Orkestra docs. Each doc page should have a clear primary persona. Writer and editor agents use these to calibrate tone, depth, and what to lead with.

---

## Primary Personas

### The Vibe Coder

**Who they are:** Building something with AI assistance — a side project, an MVP, an experiment. Probably their first serious agentic workflow. Not deeply interested in configuration or internals; they want to ship something cool and see it work.

**What they need:**
- Quick path to a working setup
- Concrete examples they can copy and run
- Reassurance that the defaults are sensible
- Clear "what do I do next" at every step

**What loses them:**
- Long configuration reference tables before they've seen anything work
- Explanation of edge cases and failure modes before they've hit them
- Internal detail or nuance that isn't relevant to getting started
- Jargon without immediate definition

**Writing for them:** Short sentences. Lead with the result, explain why second. Use examples before exhaustive option lists. If there's a happy path, show it first and put advanced options in a callout or later section.

---

### The Practicing Engineer

**Who they are:** Already has strong coding practices and wants to extend them to AI agents. Cares about reliability, reproducibility, and predictable agent behavior. Wants to understand the model fully so they can tune it — configure gates, write precise prompts, control what agents do and don't do.

**What they need:**
- Complete reference: every config option, every behavior, every constraint
- The mental model behind how the system works, not just what to do
- Concrete examples of non-trivial configurations (gates, flows, multi-stage pipelines)
- Clear failure modes and how to handle them

**What loses them:**
- Oversimplification that omits important nuance
- Examples that only show the minimal case
- Missing information that forces them to read source code

**Writing for them:** Be precise. Show the full picture. Lead with the concept so they can build an accurate mental model, then show configuration. Don't bury constraints in a footnote.

---

## Secondary Persona

### The Team Lead / Evaluator

**Who they are:** Evaluating Orkestra for their team or org. Wants to understand what it does, whether it fits their workflow, and what adoption would look like. Less interested in step-by-step setup; more interested in "what does this get us and what does it cost us."

**What they need:**
- Clear explanation of the value proposition and what problem it solves
- How it fits into existing workflows (git, CI/CD, code review)
- What configuration and maintenance looks like at scale
- What the failure modes and limitations are

**What loses them:**
- Docs that assume they've already decided to use it
- No discussion of tradeoffs or constraints
- Marketing language without substance

**Writing for them:** This persona is rarely the primary target for a given page, but overview and concept pages should be written with them in mind as a secondary reader. They're skimming for signal, not following a tutorial.

---

## Assigning Personas

Every doc page should have a clear **primary persona** — the reader it's optimized for. Most pages implicitly serve a secondary persona too, but when there's a tension between depth and brevity, the primary persona wins.

General guidance:
- Getting started, quickstart, tutorials → **Vibe Coder** primary
- Concept guides, how-to guides, configuration reference → **Practicing Engineer** primary
- Overview pages, landing pages → **Team Lead / Evaluator** secondary lens, but still written for the primary reader of that section

When the writer determines which persona a page is for, that choice should be reflected in structure and tone — not just noted in the draft artifact.
