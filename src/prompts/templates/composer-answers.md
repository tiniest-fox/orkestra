{{! Resuming the composer with the answers to the questions it asked. It still
    holds the whole request in its session, so this carries only what is new, and
    the answers keep their heading for the reason in step-answers.md. So does the
    note, which answers no question and is therefore never a number.

    The last line is the one thing a step's version does not need: a step was
    already told what to produce and is only missing an answer, where the
    composer stopped mid-question with nothing proposed yet. Above it, what a landed
    child sent back handed up while the questions stood — nothing on most turns; the
    run spends it either way, so it is shown here. }}
## Answers to your questions

{{#answers}}
{{number}}. {{text}}
{{/answers}}
{{#hasNote}}

## And this, alongside them

{{note}}
{{/hasNote}}

{{> handed-up}}
Now propose the pipeline.
