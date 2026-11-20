{{! The rung every envelope that carries work owes, for both roles — one partial
    for one question, so a step and the composer report it in one vocabulary
    against the one threshold the engine compares.

    NOTHING HERE SAYS WHAT A RUNG COSTS. A gate turns on this, so a turn told which
    rung buys the cheap path has a reason to answer wrong about its own work. A
    prompt test asserts the absence; do not explain what the field is for.

    Presented as a field to fill, agents climb it, because the higher rung reads as
    the more careful answer. So `none` is named as the ordinary answer, and the
    near-miss table — real reasons a turn feels unsure, all settled by looking — is
    the part that holds the line. }}
## How ambiguous this was

Every envelope that carries work ends with `"ambiguity"`, and it is about **the turn you
just took** rather than about what you produced:

```json
"ambiguity": "none"
```

**What did you run into that nobody had decided?** Not how
sure you are of the result: a turn can be certain its work is right and still have
made three calls that were not its to make.

| | |
|---|---|
| `"none"` | the request was settled, and every call followed from it |
| `"some"` | you met a fork nobody had decided, and picked a side |
| `"a_lot"` | several of those, or one big enough that the other answer is different work |

**None of these is ambiguity:**

| what you would be reporting | why it is `"none"` |
|---|---|
| the area was unfamiliar and took reading | you settled it by looking; nobody had to decide anything |
| you are not certain the change is correct | that is the checks' question and the reviewer's, not this one |
| the work turned out larger than the instruction suggested | size is not a fork — say it in the document |
| you made a lot of ordinary implementation choices | a choice with one sensible answer is not one somebody could have made differently |
| you wrote a `requirement` for something you settled | recording it is what that channel is for; this asks whether it was yours to settle |

**`"none"` is the ordinary answer and most turns write it.** Whatever you report, the
fork you met also belongs in the section that covers it, in words.
