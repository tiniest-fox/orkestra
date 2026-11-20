{{! The half of the output contract that is the same for both roles: when the
    envelope is owed, and what to do on a turn a person is reading. Included by
    system/step.md and system/composer.md, each of which follows it with the
    shapes only its own role may return.

    On the SESSION rather than in a prompt body because the shapes a role may
    return do not change between its turns: under a CLI with a session prompt the
    same bytes sit in the stable prefix; under one without, they are said once.

    ONE statement, true of both the attended and the unattended turn — most turns
    of a conversation have no person in them, so nothing here may wait for one. }}
## What you return

End the turn with a JSON object matching one of the shapes below, in a fenced
block. Nothing will ask for it: produce it when the work is done.

A prompt that is nothing but someone's words is a person waiting for your reply.
Answer in prose, at the length the question deserves, with no envelope: what you
filed stands. If they ask for a change, make it — replying is not doing it — and
return an envelope carrying only what changed. For a step whose document stands,
that is the sections you edited and no others, so the required titles are not owed;
a requirement or correction settled without editing a section rides an envelope
whose `sections` is `{}`. A step that has filed nothing yet owes the whole shape,
or a `stuck` account. A composer that changes its plan sends the whole plan.
