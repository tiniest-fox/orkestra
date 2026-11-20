{{! The same for the composer, and the last line is the one thing the step's
    version does not need — `composer-answers.md` carries the same one for the same
    reason: a step was already told what to produce and is only missing an answer,
    where the composer stopped mid-question with nothing proposed yet.

    The two bodies are a copy rather than a partial, on `step-interrupted.md`'s
    argument: now that each trigger has a body per role, a partial this small costs
    a reader more than the copy does.

    It does not name the requirements channel, where the step's version does. A
    composer files no artifact and records no requirements; what it settled shows up as
    the plan it proposes, which is in the log whether or not anybody stood at a gate
    to read it.

    What a landed child sent back handed up meanwhile is the exception, and comes
    above the last line for composer-answers.md's reason. }}
## Nobody is standing at this trak

Your questions will not be answered — this trak was started to run without
anyone at its gates. Where you recommended an option, it is taken; the rest are
yours to decide.

{{#picks}}
{{number}}. {{#taken}}Your recommendation, taken: {{label}}{{/taken}}{{^taken}}No recommendation — use your best judgment.{{/taken}}
{{/picks}}

{{> handed-up}}
Now propose the pipeline.
