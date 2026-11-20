{{! The `decision` figure's grammar. Rendered into the contract only for a step whose
    agent declares `figure: decision` on a section. The client parses this text, so a
    change here is a change to a format stored inside filed documents: the old form
    must still parse. }}
`decision` — one item per decision that had a real alternative, each ended by a
blank line. The first line is the decision; then `chose:`, `over:` and `why:`, one
line each. `flag: hard to reverse` marks one where redoing it later means redoing
what was built on it.

```decision
Source form
chose: one labeled fence per figure
over: a YAML fence; markdown tables upgraded in place
why: it reads cleanly as plain text
flag: hard to reverse

Over-marking
chose: no rule and no guard
over: a rule in the brief
why: the over-marked table read fine
```
