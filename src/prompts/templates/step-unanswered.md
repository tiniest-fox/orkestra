{{! Resuming a step whose questions nobody is going to answer, because the trak is
    running unattended. The conversation is intact — every path here resumes a
    session — so the questions do not need repeating back.

    It has a heading, and the heading is the point. The session contract says a
    prompt that is nothing but someone's words is a person typing; a bare "Use your
    best judgment" is exactly that shape, and this turn runs through `elicit`
    rather than `converse`, so a prose reply burns three re-prompts and settles the
    trak `Failed{agent}`. The heading is what says nobody typed this.

    It must not read as an answer. `step-answers.md` speaks for a person who
    decided; this says the decision is the agent's now, which is a different fact
    about the same output — and an agent that recorded "they said use your
    judgment" as a stated decision would be citing a person who never spoke. The
    same holds for a recommendation taken: it is the agent's own pick handed back,
    so each line says *your recommendation* rather than presenting the label as a
    reply.

    The last line is why the requirements channel is named here and nowhere else in a
    resume body: a choice made with nobody to check it is exactly the one somebody
    reads afterwards, and `assumed` is what marks it as the agent's. It names
    `constraint` because that is what a settled question is, and because the kind is
    what decides whether recording it stops the trak — this body only runs where
    nobody is standing at one, so a turn that reached for the routing kind here would
    buy the plan gate the mode exists to avoid. }}
## Nobody is standing at this trak

Your questions will not be answered — this trak runs without anyone at its gates.
Where you recommended an option, it is taken; the rest are yours to decide. Either way
the choice is yours, not an answer anyone gave.

{{#picks}}
{{number}}. {{#taken}}Your recommendation, taken: {{label}}{{/taken}}{{^taken}}No recommendation — use your best judgment.{{/taken}}
{{/picks}}

Carry on.

Record what you settled as a requirement — `kind: "constraint"`, `source:
"assumed"` — so the choice is visible to whoever reads this later.
