{{! The free `table` figure's grammar, taught to every step whatever its sections
    declare, because any section may hold a table. No rule against marking every cell:
    the person who chose this format found an over-marked table read fine. Stored
    inside filed documents, so the old form must still parse after any change. }}
`table` — any table, in place of a markdown one. The first line is the header,
cells split by `|`, four columns at most; a header starting `+ ` heads a column of good points, `- ` a
column of bad ones. An optional `key:` line names the icons the table uses. Each
row starts with an unindented lead cell, which may open with `[icon]`; its indented
lines are the remaining cells, in order. A cell starting `+ `, `- ` or `= ` draws as
better, worse or the same. The icons are `flag`, `check`, `warn`, `new`, `changed`,
`test` and `person`.

```table
Approach | + Gains | - Costs
key: check Chosen
[check] One fence per figure
  reads as plain text
  a grammar to teach for each
A YAML fence
  one parser for every figure
  indentation a reader has to count
```
