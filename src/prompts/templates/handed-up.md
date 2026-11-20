{{! What landed children sent back have handed up since a composer run last landed —
    `Trak.handUps`. A refiled hand-up has no join to ride and splices nothing, so it
    waits on the trak for the next composer turn, whatever asked for it, and the run
    that lands spends it. Every composer body includes this, because that run spends
    the list whichever body it was sent: a body that left it out would spend
    hand-ups nobody read.

    Renders as nothing on most turns. Included by composer.md above `reconsult`, for
    the reason `hasSiblings` sits there, and by each resume body at its end.

    Three closing sentences, one per kind of body. `handUpsBesideIntent` is the full
    prompt, where the requirements block is above and the piece's entries are in
    it. `handUpsAfterMessage` is the chat body, whose bareness is what the session
    contract reads as a person waiting for a reply — this block is the one thing
    that may follow the message there, so it says in words what the bareness said,
    and gives nothing back. The rest are framed resumes, which render no
    requirements: the session was opened before the piece's entries arrived. }}
{{#hasHandUps}}
## Handed up since

A piece of this work that had already landed was sent back, and its composer found
work that belongs to no piece of the split. In its own words:

{{#handUps}}
- {{.}}
{{/handUps}}

{{#handUpsBesideIntent}}
It is also in the requirements above, under that piece's name. Plan it, or say why
not.
{{/handUpsBesideIntent}}
{{#handUpsAfterMessage}}
The words above this heading are a person's, waiting to read what you say back:
answer them as you would have, and say what you make of this where it bears on the
answer.
{{/handUpsAfterMessage}}
{{^handUpsBesideIntent}}
{{^handUpsAfterMessage}}
It is also a requirement under that piece's name, on the trak's list rather than in
this session. Plan it, or say why not.
{{/handUpsAfterMessage}}
{{/handUpsBesideIntent}}

{{/hasHandUps}}
