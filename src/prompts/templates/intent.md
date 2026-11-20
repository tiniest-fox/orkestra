{{! One block, because the description plus the requirements since IS what is
    being asked for — `references/glossary.md` calls the pair the intent. Two
    headings invited reading one without the other, and reading the description
    alone is what made a step four entries in answer the trak's opening question
    instead of doing its own job. "It started as" is what stops it: the message
    dates itself.

    The step's own instruction is above this block, and that ordering is the rest
    of the fix — see the comment at the top of `step.md`.

    `Requirements` is the word an agent writes back in its envelope and the
    heading `trak.md` keeps, so it stays the word here even without a heading of
    its own. What it writes and what it reads back have to be one word; see
    `decided.ts` for why the stored name cannot move.

    ON THE FRESH-SESSION BODIES ONLY, and not on any resume body. It cannot go
    stale mid-step: only an artifact carries requirements and an artifact ends a
    step, so nothing can be filed between two turns of one step. A schema
    re-prompt, answered questions, a failed check, a restart and a chat turn all
    sit inside one step with no artifact between them. Injecting it per turn would
    repeat an identical block into a conversation that already contains it
    verbatim — paid for every turn, and the kind of repetition that teaches a
    model to skim the thing it most needs to read.

    The lead-in is guarded too: with no requirements there is no "and then", and
    "it started as" dangling over one paragraph reads as a sentence cut off. }}
## How this work was asked for

{{#hasRequirements}}
It started as:

{{/hasRequirements}}
{{description}}
{{> attached}}

{{#hasRequirements}}
And then these **requirements** were recorded, oldest first. Later ones win, and
`assumed` means somebody read it into the work rather than confirmed it. Each is named
by its stage and its place there — `3-scope.2` — which is what a later entry names to
replace it; a replaced entry is already out of this list:

{{requirements}}

{{/hasRequirements}}
