{{! Resuming a step with the answers to the questions it asked. The agent already
    holds the full context, so this carries only what is new.

    Answers keep their heading where a message gets none, because they are
    positional: the numbering is the only thing that maps them back to the
    questions that were asked.

    The heading also says what this turn is not. A bare prompt means a person is
    waiting to read a reply — see system/contract.md — and answers are not that:
    they were given so the step could get on with it, not so it could reply to
    them.

    The note is the one thing here that answers no question, so it gets a heading
    of its own and no number: appended to the list it would read as an answer to a
    question nobody asked. Nothing frames how to weigh it, for step-message.md's
    reason — telling an agent what to make of what it was just told second-guesses
    the person who said it — and it carries what an answer carries. }}
## Answers to your questions

{{#answers}}
{{number}}. {{text}}
{{/answers}}
{{#hasNote}}

## And this, alongside them

{{note}}
{{/hasNote}}
