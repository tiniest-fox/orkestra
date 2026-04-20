# Component Palette

The authoritative reference for everything available when writing docs pages. Check here before writing — if what you need isn't listed, see **Requesting New Components** at the bottom.

---

## MDX Components

These are imported at the top of an MDX file, after frontmatter:

```
import Callout from "../../components/docs/Callout.astro";
import Steps from "../../components/docs/Steps.astro";
import GitHubButton from "../../components/docs/GitHubButton.astro";
import Pipeline from "../../components/docs/Pipeline.astro";
import Mermaid from "../../components/docs/Mermaid.astro";
```

Only import what you use.

---

### Callout

Pulls important information out of the prose flow so it doesn't get missed.

```
<Callout type="note">Supplemental context that doesn't interrupt the main flow.</Callout>
<Callout type="tip">An optional shortcut or improvement the reader might not discover themselves.</Callout>
<Callout type="warning" title="Custom Title">Something that can go wrong or surprises people.</Callout>
<Callout type="danger">Something that causes data loss, breakage, or hard-to-reverse consequences.</Callout>
```

**Props:**
- `type` — `note` (default) | `tip` | `warning` | `danger`
- `title` — optional string, overrides the default label

**Use for:** Information that would be buried or skipped if left in body text — gotchas, prerequisites, important constraints, optional improvements.

**Don't use for:** Every important sentence. If you're reaching for a Callout every other paragraph, the structure needs rethinking. Callouts lose their signal value when overused.

---

### Steps

Renders an ordered list with bold accent-colored number circles. Use for procedures where sequence genuinely matters.

```
<Steps>
1. **Step title**

   Explanation of the step. Can include code blocks, inline code, or multiple paragraphs.

2. **Next step**

   More detail.
</Steps>
```

**Requires:** A blank line between the bold step title and the body text, or the MDX parser will not render correctly.

**Use for:** Installation sequences, configuration walkthroughs, anything where doing step 3 before step 2 would break something.

**Don't use for:** Lists of options, feature descriptions, or anything where the order is arbitrary. Use a plain ordered list or bullet list instead.

---

### GitHubButton

A linked button pointing to a GitHub resource. Conventionally placed at the end of a page.

```
<GitHubButton href="https://github.com/tiniest-fox/orkestra" />
<GitHubButton href="https://github.com/tiniest-fox/orkestra" label="View source" />
```

**Props:**
- `href` — required. Full GitHub URL.
- `label` — optional string, defaults to `"View on GitHub"`

**Use for:** Linking to relevant source code, the main repo, or specific files at the end of a reference or concept page.

---

### Pipeline

Renders a branded, vertical pipeline flow diagram from structured data. Stages are the main nodes; gates appear as distinct pill-shaped nodes between stages, each showing its rejection path to the left.

**Prefer Pipeline over Mermaid for any stage or workflow flow.** Pipeline produces authoritative, on-brand diagrams that communicate gate topology clearly. Only reach for Mermaid when the structure genuinely can't be expressed as a linear sequence of stages.

**Keep pipelines simple.** A 3–4 stage flow is easier to follow than a 6-stage one. If a stage isn't essential for understanding the concept being explained, leave it out.

```
import Pipeline from "../../components/docs/Pipeline.astro";

<Pipeline
  stages={[
    { name: "Planning", gate: { kind: "approval" } },
    { name: "Work", gate: [{ kind: "check" }, { kind: "approval" }] },
    { name: "Review", gate: { kind: "verdict", onApproveFail: "Work" } },
  ]}
  terminal="Ready for PR / Merge"
/>
```

**Props:**
- `stages` — required. Array of stage objects.
  - `name` — required string. Stage display name.
  - `description` — optional string. Subtitle shown below the name in muted text.
  - `auto` — optional boolean. Stage runs without human interaction — renders with a muted background and a green "Automatic" badge.
  - `gate` — optional. A single gate object or ordered array of gates that run after this stage before the pipeline advances. Three kinds:
    - `{ kind: "check", onFail? }` — automated gate script (amber, ⚡ icon). `onFail` defaults to re-running the preceding stage.
    - `{ kind: "approval", onFail? }` — human reviews output (blue, 👤 icon). `onFail` defaults to re-running the preceding stage.
    - `{ kind: "verdict", onReject?, onApproveFail? }` — agent produces a pass/fail verdict, then a human confirms it (renders as two gates: human review first, then agent verdict). `onReject` is where to go when the human rejects (default: re-run stage). `onApproveFail` is where to go when the human approves a Fail verdict (default: re-run stage).
- `terminal` — optional string. Label for the terminal endpoint node. Defaults to `"Done"`.

**Gate outcome icons:**
- Automated gates (check, verdict): red ✕ for fail, green ✓ for pass
- Approval gates: amber speech bubble for "return with notes", green thumbs up for approve

**Use for:** Any linear sequence of named pipeline stages — workflow flows, onboarding walkthroughs, multi-step processes where stage order and gate topology matter.

**Don't use for:** State machines with multiple branching paths or cycles. Those are better expressed as prose with a definition list.

---

### Mermaid

Renders a Mermaid diagram client-side. Theme follows `prefers-color-scheme` automatically.

```
import Mermaid from "../../components/docs/Mermaid.astro";

<Mermaid diagram={`
graph TD
  A[Start] --> B[End]
`} />
```

**Props:**
- `diagram` — required. Pass the diagram definition as a template literal.

**Use for:** Diagrams that genuinely can't be expressed as a Pipeline — sequence diagrams, entity-relationship diagrams, state machines with multiple branching paths. If you're reaching for Mermaid for a stage flow, use Pipeline instead.

**Don't use for:** Linear stage flows — use Pipeline instead. Simple relationships a table or list communicates more clearly. Diagrams add cognitive load; only worth it when the visual structure genuinely helps and Pipeline can't express it.

**Supported diagram types:** flowchart, sequence, state, class, entity-relationship, gantt, pie. See [Mermaid docs](https://mermaid.js.org/intro/) for syntax.

---

## Native Markdown Patterns

These don't require imports.

### Code blocks

Always specify the language for syntax highlighting:

````
```yaml
gate:
  command: ".orkestra/scripts/checks.sh"
  timeout_seconds: 300
```
````

Common languages: `yaml`, `bash`, `typescript`, `json`, `mdx`. Use a plain ` ``` ` fence (no language) only for file trees or plain text output.

### Tables

Use for structured data with clear column relationships — config option references, comparison tables, property listings.

```
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | string | — | Stage identifier |
```

Don't use tables for information that reads naturally as prose or a bullet list.

### Inline code

Use backticks for: config keys, file paths, CLI commands, stage names, specific values a user would type. Don't use for general technical terms.

### Header hierarchy

- `##` — major sections within a page
- `###` — subsections
- `####` — use sparingly, only when `###` genuinely needs subdivision

Don't skip levels. Don't use `#` — the page title is already rendered from frontmatter.

---

## Requesting New Components

If what you need doesn't exist, check `editorial/component-requests.md` first — someone may have already requested it. If so, add your use case to the "Also needed for" list in your draft artifact rather than filing a duplicate.

If nothing matches your need, document the gap in your draft artifact under `Component Requests`. The editor validates it; the compound agent adds it to `editorial/component-requests.md`. Validated requests graduate to a Component Trak when prioritized.

Don't build components yourself. Writer agents stay in `src/content/docs/`. Component work happens in a separate Trak.
