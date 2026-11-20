{{! The artifact's declared sections, from the `output:` of the agent this step
    names — rendered from the same declaration the schema checks, so the prompt
    cannot ask for one set of sections while the engine requires another. Said on
    the session: the sections cannot change between a step's turns.

    `when` on a section is the fact that makes it due: sections left to judgment
    were filled almost every time, each with a heading saying nothing was there.

    THE FORM TABLE IS A MAPPING AND MUST STAY ONE. Written as a menu of devices, a
    model picks whichever reads as most thorough, every time — so each row names
    the CONTENT SHAPE first and the device second, and the devices nobody should
    reach for (`sequenceDiagram`) are absent rather than discouraged. Only caps and
    form constraints bind; "be concise" does not.

    `figures` is every figure a section declares, plus `table`. Each grammar is
    rendered by prompt.ts rather than included as a partial, because a partial in
    the section loop repeats once per section. }}
## What the artifact must contain

Return your output as `sections`: an object whose keys are exactly the titles below.

{{#shapeSections}}
- **{{title}}**{{#when}} — only when {{when}}{{/when}}{{#figure}} — written as the `{{figure}}` figure{{/figure}}
  {{description}}
{{/shapeSections}}

A section with nothing in it fails: say so in the section rather than leaving it
out. A section marked *only when* is the one exception: leave it out unless its
condition holds, and never write it to say that nothing is there.

## How to write it

Two readers: a person deciding whether this goes forward, and the agent that picks
it up. Lead with the answer for the first, keep the argument for the second.

Cut preamble, restatement of the section title, and any sentence whose deletion
changes nothing. Argue where a reader could reasonably disagree; assert the rest.
A point made twice reads as two points.

A word limit in a section description is a cap; a count is what such a section
usually runs to, not a quota. Get under a cap by cutting whole points, never by
dropping articles and stacking nouns.

Match the form to what you are saying:

| what you are saying | how |
|---|---|
| independent items, each a phrase | bullets |
| items with attributes to compare | a table |
| a linear ordering | a numbered list, naming who did each step |
| branching logic, or the states a thing has | a mermaid `flowchart` or `stateDiagram-v2` |
| a change at one site | a fenced `diff` block |
| evidence, quoted verbatim | a fenced block |
| what something looks like on screen | `![alt](path)` — a file in your worktree |
| one argument that has to hold together | prose |

A table is an index, not a container: scanned columns first, prose column under
forty words. Never exceed it: what does not fit goes in a section below, and the
row points at it. Draw a diagram when it replaces a paragraph.

A fence whose contents are code names its language — ```ts, ```json, ```bash — so
it draws colored rather than gray; a `diff` fence names it after the word, ```diff ts.
Pseudo-code is ```pseudo. Output, a log, and prose stay unlabeled.

**An image is drawn only out of your own worktree**; any other path, a URL
included, shows as its alt text. Write the alt text as the sentence you would have
written without the picture, because the shot does not outlive the checkout.

## Figures

A figure is a fenced block labeled with its name, inside a section's markdown. A
person sees it drawn; the next agent reads the text as written, so it has to read
as plain text too. A section marked *written as* a figure is that figure, and any
section may hold a `table` in place of a markdown table.

In every grammar, an indented line belongs to the line above it. In `table`,
`decision`, `scope`, `criteria`, `files` and `changes`, a `## Heading` line starts a
group of items; no other figure takes a heading.
{{#figures}}

{{grammar}}
{{/figures}}
