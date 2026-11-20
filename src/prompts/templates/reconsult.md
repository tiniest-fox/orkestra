{{! Where the trak has got to and what is being asked, included by composer.md
    under the intent — because on a re-consultation the two are one thing: what
    was asked for and what has been decided since, then what has actually
    happened.

    Renders nothing at all when the composer has not been asked anything, which is
    every first compose. That is what lets one body serve both turns: this is not a
    different prompt, it is the same prompt with something to say here.

    ONE BLOCK FOR SIX REASONS, because they are one question — what should the
    rest of this plan be? — asked from a position. `kept` and `remaining` are the
    plan either side of that position and are the same fact whichever reason
    applies, so only the paragraph naming the reason branches — and that paragraph
    is `reconsult-why`, a partial because it can render twice: a person's replan that
    raced a step's raise carries the raise inside it, and both are said.

    `isRefused` is the engine declining to start a step whose agent writes, because
    the branch merged after the plan was accepted; the reason is the same sentence the
    composer is refused with at decode.

    `isConflicted` is the only one that comes from git rather than from an agent or
    a person, and the only one where the work below is finished: the plan ran out,
    somebody pressed merge, and the branches disagreed. `into` names the destination
    and is the one fact the resolving checkout cannot recover for itself, so the
    block below makes the composer carry it onto that step's instruction — which is
    the only channel that reaches a step. It may be absent on a detached HEAD, and
    that case gets its own paragraph rather than silently dropping the requirement.

    `isPlanned` is the composer arriving at a compose entry of its own: nothing asked
    it, the plan simply reached the point it said it could not see past. It is first
    because it is the only one the composer already knows about.

    `remaining` carries INSTRUCTIONS, not just names, and that is load-bearing: the
    session is fresh and has never seen the current plan, so without them the tail
    cannot be handed back and every re-consultation rewrites it from scratch.

    Headings stay at `##`, and the last paragraph is `isReplanned` only: it is
    about a slot that failed on its merits, and a person replanning is the one reason
    that says so. `isRefused` also joins at a step that never began, but the decode
    refuses that step proposed again, so the paragraph is not its. The others join
    after filed work or at the end of the plan. }}
{{#isReconsult}}
## Where this has got to

{{> reconsult-why}}
{{#isPlanned}}
You planned this turn yourself: the plan stops here on purpose, and this is what
you said you could not see past:

{{plannedFor}}

Nothing has gone wrong. The work below is done and on a branch, and the answer is in
its artifacts. **If it is settled, propose the steps that follow from it; if it is
genuinely still open, ask rather than planning around it.**
{{/isPlanned}}

{{#hasKept}}
These steps have run and are kept — they are not yours to propose again:

{{#kept}}
- `{{name}}`{{#path}} — `{{path}}`{{/path}}
{{/kept}}
{{/hasKept}}
{{^hasKept}}
Nothing is kept: this is the first step of the plan.
{{/hasKept}}

{{#hasRemaining}}
These were planned next and have not run. **Your plan replaces exactly these:**

{{#remaining}}
- `{{name}}`{{#instruction}} — {{instruction}}{{/instruction}}
{{/remaining}}

Propose them again as they stand if they still hold. An otherwise unchanged
sequence with one entry added is an ordinary answer here, and the cheapest one.
{{/hasRemaining}}
{{^hasRemaining}}
Nothing was planned after this point, so your steps are appended to the ones
above.
{{/hasRemaining}}

Propose the shortest sequence that takes this in and finishes the work. Do not
re-propose finished work, and do not re-do the whole job because one part of it needs
attention.

**The shortest sequence is sometimes none.** Where the request is already satisfied by
what has run, `finished` is the answer. Judge that against the request and the artifacts,
never against how much work would be left: a job you cannot see the next move on is
`questions`, and one you cannot plan at all is `failed`. Where what you have been told
does not say what needs to change, ask.

{{#isReplanned}}
**Where a slot is still owed its work, change something.** A step proposed again
unchanged fails the same way: give it a different agent, a smaller piece of the same
job, or an instruction naming what to do differently. Where a person has to decide
something first, ask.
{{/isReplanned}}

{{/isReconsult}}
