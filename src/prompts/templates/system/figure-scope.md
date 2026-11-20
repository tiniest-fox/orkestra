{{! The `scope` figure's grammar. Rendered into the contract only for a step whose
    agent declares `figure: scope` on a section. Stored inside filed documents, so
    the old form must still parse after any change. }}
`scope` — one item per line of the boundary, each ended by a blank line: `in:` what
is built, `out:` what is not, `why:` the reason for the omission.

```scope
in: the `figure:` key, parsed and checked at load
out: a press inside a figure that writes to the trak
why: a filed document stays frozen
```
