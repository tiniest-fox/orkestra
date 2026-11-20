{{! The `overview` figure's grammar: the architecture map. Rendered into the contract
    only for a step whose agent declares `figure: overview` on a section. A file opens
    into its own sketch, colored as rules-pseudo, so the notation is taught here.
    Stored inside filed documents, so the old form must still parse after any change:
    a `sketch:` at the part's own depth still reads, as one sketch for the part. }}
`overview` — the parts of the change, numbered in the order they call each other:
`1. Part | gist`. Indented under a part: `in: <root>` for the directory it lives
in, then `+ path — note` for a new file and `~ path — note` for a changed one, each
relative to that directory. Indented under a file: `sketch:`, with that file's
pseudo-code indented below it. Then `outside: Name | note` for each thing the parts
reach that is not being changed, `A -> B: label` for each connection, and
`order: <one sentence>` for the order to build them in.

A sketch is pseudo-code at the level of its decisions, not its lines: `define`,
`each x in xs`, `if`, `else`, `return` and `skip` open blocks, `{braces}` hold a
value described in words, `"quotes"` hold literal text, and `#` starts a comment.

```overview
1. Loader | reads the key and refuses an unknown name
  in: app/config
  ~ agent.ts — parses `figure:`
    sketch:
      define load_agent(spec)
        if spec.figure is not in FIGURES
          refuse("unknown figure", {the section})
2. Prompt | teaches each declared figure's grammar
  in: app/prompt
  ~ contract.ts — the grammars, after the sections
  + grammar.ts — one grammar per figure
outside: Client | draws each fence
Loader -> Prompt: the section's figure
Prompt -> Client: the fence the agent writes
order: The loader first, because the prompt reads what it parsed.
```
