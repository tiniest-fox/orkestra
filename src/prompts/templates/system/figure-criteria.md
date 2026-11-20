{{! The `criteria` figure's grammar. Rendered into the contract only for a step whose
    agent declares `figure: criteria` on a section. `how:` and `met:` are closed sets
    because the client draws one icon per `how:` value and one verdict per `met:`
    value. `met:` is optional so a plan, which judges nothing, writes the same figure
    a review does. Stored inside filed documents, so the old form must still parse
    after any change. }}
`criteria` — one item per condition, each ended by a blank line. The first line is
the condition; `by:` is how it is verified; `how:` is one word of `test`, `check`,
`script` or `person`, the main one where `by:` names several. Where you are judging
work against the condition, `met:` is `yes`, `no` or `partly`, and `by:` says what
shows it; a plan, which judges nothing, leaves `met:` out.

```criteria
An agent file naming an unknown figure fails to load, naming the file and the section.
by: a test on the loader
how: test
met: yes

The marked table reads at phone width.
by: a person looks, through a proof
how: person
met: partly
```
