{{! The paragraph naming why the composer is being asked again — one block per
    reason, included by reconsult.md, which carries the framing either side of it.

    A PARTIAL RATHER THAN A RUN OF BLOCKS IN reconsult.md, because it renders twice
    on one turn: once for the ask that stands, and once more, from inside its own
    Replanned block, for the ask a person's recompose displaced when it landed after
    the turn it meant to interrupt had already sent the plan back. `displaced` is a
    whole view of that inner reason, and stepping into it is what makes the reason tag
    below read the inner one — the outer Replanned's and a displaced Refused's share
    the key, and a flat spread would have one silently win. NO TAG MAY BE SPELLED
    INSIDE THIS COMMENT: its closing braces end the comment, and the rest is prompt.

    EVERY `isX` FLAG IS PRESENT ON EVERY VIEW, `false` where it does not apply, and the
    partial depends on it: Mustache looks a missing key up the context stack, so a
    displaced Raised with no `isReplanned` of its own would find the outer view's
    `true`, render the person's paragraph again inside its own, and include this
    partial from there without end. `whyView` spells them out; do not remove one.

    `isDisplaced` IS TRUE ON THE NESTED VIEW ALONE, and every block branches on it.
    A displaced ask is an account the person's press did not read, not the thing
    the turn is asking about — so no block may claim to be the only account, say
    what is being asked of the whole turn, or name the answer it should end in
    while it renders as one. The facts it states, and the rules about how such an
    ask is answered, hold either way and stay.

    `handedUp` splits `isRaised` by which writer raised it: a step at its own
    position, or the join at a spawn's. Not a sixth reason — the plan either side is
    the same fact — but the opening paragraph and the sentence about the standing
    requirements are each false for the other writer, so they branch.

    `raisedWork` is NOT named `requirements`, and must not be: this partial and
    `intent` are rendered from one merged object, so a key of that name here
    overwrites the trak's standing requirements block — which is the only channel
    the four kinds that no longer wake the composer have. }}
{{#isRaised}}
{{#handedUp}}
The children of `{{raisedAt}}` have all landed and their work is merged onto this
branch. **Nothing here says that work was bad or that the plan was wrong.**
{{^isDisplaced}}
What is being asked is what the rest of the plan should be, now that this is known.
{{/isDisplaced}}
{{#isDisplaced}}
This was standing when the press above landed, and the press did not read it.
{{/isDisplaced}}

At least one of them found work that belongs to no piece of the split, and handed
it up rather than doing it. In each child's own words:

{{#raisedWork}}
- {{.}}
{{/raisedWork}}

The child's step that found it filed it as a requirement, so it is also in the
requirements above, usually in more detail. Nothing else a child settled is being
asked about here.
{{/handedUp}}
{{^handedUp}}
`{{raisedAt}}` did its work and filed its artifact. **Nothing here says that work
was bad or that the plan was wrong.**
{{^isDisplaced}}
What is being asked is what the rest of the plan should be, now that this is known.
{{/isDisplaced}}
{{#isDisplaced}}
This was standing when the press above landed, and the press did not read it.
{{/isDisplaced}}
{{#hasRaisedWork}}

It found work this plan does not have:

{{#raisedWork}}
- {{.}}
{{/raisedWork}}

Anything else it settled is in the requirements above — that needed no plan.
{{/hasRaisedWork}}
{{/handedUp}}
{{#hasCorrections}}

It says these documents are not good enough to work from:

{{#corrections}}
- `{{at}}` — {{text}}
{{/corrections}}

Each of these names work that was owed and not done — the check that never ran, the
case the breakdown left out. **The work is the answer**; a step that only rewrites the
document's prose has answered nothing. **A step doing that work may carry `continues`
naming the same document**, which resumes the conversation that produced it.

One that names no work — a sentence that is stale, or was mistaken when written —
buys no step: the plan you hand back is the one that stood.

**Whoever complained does not settle it.** The step that answers it is the one that
wrote the document, and a separate step judges the fix.
{{/hasCorrections}}
{{/isRaised}}
{{#isReplanned}}
A person stopped at `{{replannedAt}}` and asked for a different rest of the plan.
This is what they said:

{{reason}}

{{^isDisplaced}}
{{^hasDisplaced}}
Take it as the requirement. It is the only account you are given.
{{/hasDisplaced}}
{{#hasDisplaced}}
Take it as the requirement for what the rest of the plan is. It is not the only
account you are given: what follows was already standing when they pressed, and they
had not read it. **Neither cancels the other.** Their words shape the rest of the
plan; what follows names what still holds whatever shape it takes. Reconcile them, and
where they genuinely disagree, ask.
{{/hasDisplaced}}
{{/isDisplaced}}
{{#isDisplaced}}
This was standing when the press above landed: an earlier word of theirs. The press
above is the later word, and this one still holds wherever the two do not disagree.
{{/isDisplaced}}
{{#hasDisplaced}}

{{#displaced}}
{{> reconsult-why}}
{{/displaced}}
{{/hasDisplaced}}
{{/isReplanned}}
{{#isReentered}}
{{#isConflict}}
{{#conflictInto}}
This work already finished, set to be merged by Orkestra into `{{conflictInto}}` in the
project's checkout. This project has no remote, so there is no pull request. The merge
would conflict, and Orkestra sent it back to you to fix that.

{{arrived}}
{{^isDisplaced}}

Plan the merge of `{{conflictInto}}` into this branch, resolving every conflict, and
commit it there. Do not push: there is no remote. This fix runs to rest unattended,
and Orkestra merges once the branch goes in cleanly.
{{/isDisplaced}}
{{/conflictInto}}
{{^conflictInto}}
This work already finished and its pull request is open, set to be merged by Orkestra
once it merges cleanly and its checks pass. It does not merge cleanly: the forge reports
it conflicting with its base branch, or behind it where the base requires an up-to-date
branch. Orkestra sent it back to you to fix that.

{{arrived}}
{{^isDisplaced}}

{{^base}}
Plan the merge of the pull request's base branch into this branch, resolving every
{{/base}}
{{#base}}
Plan the merge of `origin/{{base}}`, the pull request's base branch as the remote has
it, into this branch, resolving every
{{/base}}
conflict — and merge it even where git reports none. Then plan the step that pushes this branch, so the open
pull request is updated; do not open a second one. This fix runs to the push
unattended, and Orkestra merges once the checks pass again.
{{/isDisplaced}}
{{/conflictInto}}
{{/isConflict}}
{{#isChecks}}
This work already finished and its pull request is open, set to be merged by Orkestra
once it merges cleanly and its checks pass. Its checks failed on the forge, so Orkestra
sent it back to you to fix them.

{{arrived}}
{{#failedChecks}}

Failed: {{failedChecks}}
{{/failedChecks}}
{{^isDisplaced}}

Read why they failed, plan the fix, and then the step that pushes this branch, so the
open pull request is updated; do not open a second one. Orkestra merges once the checks
pass.
{{/isDisplaced}}
{{/isChecks}}
{{^isConflict}}
{{^isChecks}}
This work already finished, and something came back:

{{arrived}}
{{#base}}
{{^isDisplaced}}

The forge will not merge this branch's open pull request as it stands, and judges it
against `origin/{{base}}` — the base branch as the remote has it, which can be ahead of
the local `{{base}}`. Plan the merge of `origin/{{base}}` into this branch, resolving
every conflict, and merge it even where git reports none. Then plan the step that pushes
this branch, so the open pull request is updated; do not open a second one.
{{/isDisplaced}}
{{/base}}
{{/isChecks}}
{{/isConflict}}

Everything below is done and on a branch.
{{^isDisplaced}}
What is being asked is what happens now.

**Nothing may be the answer.** If what came back is covered by what is already here,
answer `finished` with the reason — do not invent a step to have something to say.
{{/isDisplaced}}
{{#isDisplaced}}
It was standing when the press above landed, and what came back is still true:
whether it is already covered is a question the plan still has to answer.
{{/isDisplaced}}
{{/isReentered}}
{{#isRefused}}
The plan reached `{{refusedAt}}` and the engine refused to start it:

{{reason}}

The branch merged after that plan was accepted, so a step that writes is refused
here. Everything before it ran and is on the branch.
{{^isDisplaced}}
What is being asked is the rest of the plan without a step that writes — read-only
work, or nothing: answer `finished` with the reason if what remains needs a change,
and say that it belongs to a new trak.
{{/isDisplaced}}
{{#isDisplaced}}
The refusal stands whatever the press above asked for: a step that writes is still
refused here.
{{/isDisplaced}}
{{/isRefused}}
{{#isConflicted}}
This work finished and a person asked for it to be merged{{#into}} into `{{into}}`{{/into}}.
**The merge did not go in.** These files disagree:

{{#conflicts}}
- `{{.}}`
{{/conflicts}}

Nothing was merged and both branches are intact. **Nothing here says the work was
bad** — the other side moved while this ran.

{{^isDisplaced}}
What is being asked is a plan that resolves it.
{{/isDisplaced}}
{{#isDisplaced}}
It was standing when the press above landed, and a plan that resolves it is still
owed beside whatever they asked for.
{{/isDisplaced}}
A step that does so merges the destination **into this trak's own branch**, in the
checkout this trak already holds, fixes the disagreement there and commits — it does
not touch the branch the work is going to.

{{#into}}
**Write `{{into}}` into that step's instruction.** It is the one thing the step
cannot work out for itself: a checkout looks the same from inside whether the work is
going to the host repository or to a parent trak.
{{/into}}
{{^into}}
**Nothing recorded which branch this was aimed at** — the host is on a detached
`HEAD`, which has no name. Say so in that step's instruction: it has to establish
its own destination, and stop and ask if it cannot.
{{/into}}

Size this against the files. One file both sides added is a step; a disagreement
spread across the surface both pieces were built on is a plan that was wrong — ask,
and let the person decide what happens to that work. **Do not read the hunks**: that
is the resolving step's first act.

{{^isDisplaced}}
**Where the destination already carries this work**, answer `finished` with the
reason. A big conflict over work that is still owed is a step, or a question, never
this.

{{/isDisplaced}}
Nothing merges on its own afterwards: when your plan runs out, the person is asked
again.
{{/isConflicted}}
