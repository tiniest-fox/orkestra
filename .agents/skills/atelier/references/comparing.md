# Deciding what varies, and where

Read this before writing a round, and again before opening the next one. It is about a
single decision made over and over: **does this difference belong to a knob, or to a
design of its own?** Everything else here follows from that.

The goal is not to reach an answer quickly. It is to get the user to *their* answer
quickly — which usually means showing them a direction they can push on, at a level
coarse enough to judge, with the fiddly parts already open in the panel so they are not
spending a round trip on them.

## A knob is what the user pushes; a design is what they pick

The tell is whether *more of this* means anything.

A difference that is ordered — bigger, tighter, warmer, denser — is a knob. The user can
find their answer by dragging, and no round trip is involved. A difference that is two
incompatible arguments about what the screen is *for* is a design, because there is
nothing between them to drag through.

The other way to ask it: can the user judge this by looking at one thing? Then it is a
knob. Do they have to see two things side by side? Then it is a design.

## The sweep test

**If sweeping a knob to its extreme turns design A into design B, they were never two
designs.** They are one design and a knob.

```
atelier shot split-rail --sweep density=comfortable,compact
```

If that sheet contains the design you put in another file, delete the file. You have
been paying a whole tile of the grid, a second `meta`, and a second saved state for
something the panel gives away.

This is the expensive failure and it is the common one, because *make several* is what
the tool is shaped for. Three designs that differ in padding and type size are one design
with two knobs, and the user pays the difference in attention.

## A round holds one altitude

Every design in a round differs at the same level. A round where one design restructures
the page, one recolours it, and one rewrites the copy is not a comparison — the three
are answers to different questions, and the user has to do the sorting you skipped.

Pick the coarsest altitude that still answers what was asked. If the question is *how
should this page be organised*, the designs disagree about organisation and agree about
everything else; the colour and the copy are constants or knobs, not a third design.

Write `meta.claim` at the round's altitude too. If one claim is "Totals lead" and the
next is "Slightly warmer greys", the round is at two altitudes and the claims are where
it shows first.

## A direction drags its details in with it

A high-level direction usually arrives carrying micro-decisions. *Structure it as a split
rail, and the actions become a new kind of button.* The rail is the question; the button
is not, but it is on screen and the user is looking at it.

**Give your best version of the micro UI, and put lots of tweaks and toggles on it, so
the user can play with the detail without it ruining the direction.** That is the whole
practice, and it has two halves that fail in opposite ways.

*Your best version*, because a rail with an unconvincing button gets judged as an
unconvincing rail. A detail left rough does not read as unfinished — it reads as the
direction being wrong. Fidelity here is not polish, it is what makes the comparison
about the thing you asked about.

*Lots of tweaks*, because otherwise the user's only move is to say "yes to the rail, but
that button is too round" — a message, an edit and a reload, to settle something they
could have settled by dragging. This is the case where a big manifest is right even
though the question is narrow. `Expose what the question needs` in `controls.md` says not
to put knobs on things nobody is unsettling; a detail the direction *introduces* is not
that. Nobody decided it yet, it arrived with the proposal, and it is under consideration
by the fact of being on screen. Give it its own scope and its three or four knobs.

**Say which is which at handover.** The panel draws the round's question and the detail
riding along in exactly the same way, so nothing on screen distinguishes them. One line —
"the rail is the question; the button knobs are there so you can stop looking at it" — is
what keeps the round from being answered on the wrong axis.

## Applying one answer to every design

**Knob values are stored per design**, so a button in three direction files has three
saved files and nothing ties them together. That is fine, because the user is choosing between rails
rather than between buttons; the detail does not need to be judged fairly, it needs to
be good and adjustable.

What it does mean is that "make it that one, everywhere" is a file edit rather than a
control. Put the component and its manifest fragment in `shared.tsx` and spread it:

```tsx
// shared.tsx — the component and the manifest fragment travel together
export const buttonControls = defineControls({
  button: {
    radius: { type: 'enum', options: { sharp: 'rounded-none', soft: 'rounded-md', pill: 'rounded-full' }, default: 'soft' },
    weight: { type: 'enum', options: { medium: 'font-medium', semibold: 'font-semibold' }, default: 'semibold' },
    pad:    { type: 'enum', options: { sm: 'px-3 py-1.5', md: 'px-4 py-2', lg: 'px-5 py-3' }, default: 'md' },
  },
})

// split-rail.tsx
export const controls = defineControls({ ...buttonControls, rail: { … } })
```

The scope still has to be tagged `data-atelier="button"` in each design that draws it.
The spread keeps its literal types, so nothing is lost by not writing it out.

Now when the user lands on a button they like and says *that one, everywhere*, **change
the default in `shared.tsx`.** Every design that has not been saved over picks it up on
reload, and the decision ends up written in a file rather than in three JSON blobs that
happen to agree. One edit, and it is the same edit whether the round holds two designs or
seven.

**Divergence is information, not a bug.** If the user ends up with a pill in Split Rail
and a sharp edge in One Sheet, that is a finding about the two directions — the rail
wants a softer action than the sheet does. Say so in `meta.why` or `atelier note`, because
the saved files will show two values and nothing in them says which was deliberate.

## When a detail starts an argument, promote it

The detail rides along until it stops being a detail. **The signal is the user talking
about the button instead of the rail** — and when that happens the round has quietly
changed its question, which is the one thing a round must not do silently.

Say so and open a round for it, at component scale, with the winning structure fixed
around it. Do not let it take over the round it was riding in: a directions round that
ends up being about a button has answered neither question, because the rails were never
compared and the buttons were never held still against each other.

## A round holds one comparison

The round is a comparison along one axis. Everything else on screen is either a constant
or a knob — good, adjustable, and not being chosen between.

| the question | the shape |
|---|---|
| which direction | directions are designs; the details inside them are knobs, shared defaults in `shared.tsx` |
| which treatment of one part | treatments are `specimens` of one design; the surrounding structure is fixed to one |
| both | two rounds, coarse one first |

Specimens are the one thing that genuinely shares state — several exhibits, one manifest,
one saved file — which is why they are the shape for choosing between small things. See
`specimens.md`. Trying to run both axes at once is how you get six designs that are three
structures times two button treatments, none of which can be held still against the
others.

**Not every round is choosing.** A round can exist to *show* — every state one control has
to survive, one mark at six sizes, a fluid part at three widths. Nothing is being picked
between there, and the rules above about altitude and one comparison do not apply: the set
is the deliverable, it belongs in one design as `specimens`, and it is finished when it is
exhaustive rather than when one survives. Say which kind of round it is at handover, since
a sheet of exhibits and a sheet of candidates look identical on screen and only one of them
is asking the user a question.

## Rounds descend, and the manifest descends with them

Round 1 is coarse designs with wide knobs. What the user picks gets *hard-coded* in round
2 — not only "we are building on Split Rail", but the knobs that carried round 1's
question retiring into constants, with finer ones appearing in their place.

**There is one altitude above the coarsest layout: the job.** Designs that differ in what
the thing is *for* — one that summarises, one that lets you act, one that compares — are a
legitimate round, and they pass every test on this page. No knob sweeps from one to
another, and the round holds one altitude because the axis is the job.

**Reach for it rarely, and never as a substitute for asking.** Three real designs is an
expensive way to settle something two messages of conversation usually settle, and a round
of jobs is the hardest kind to compare fairly: the jobs are the only thing varying, so
they are the only thing *not* held constant, and the user ends up picking on how it looks.
The case where drawing beats asking is narrow — when the jobs are hard to imagine
*unbuilt*, not merely undecided. "What would this dashboard even show" is that; "which of
these two flows do we want" is not.

If you open one, say so at handover, and expect the answer to be a job rather than a
design. The winner does not descend into round 2 as a layout — it descends as the brief
that round 2's layouts are drawn against.

`controls.md` says the same thing about a settled palette: the accent stops being a
`color` picker and becomes a constant. That is this rule at the scale of one knob. At the
scale of a study it is the whole arc — a round 2 whose manifest looks like round 1's has
not descended, and that is visible by eye.

**The constants come from the saved JSON, not from memory.** `atelier brief` prints them
under `←`:

```
atelier brief checkout-flow/v1
```

Those are the values the user actually landed on. Round 2 writes them in as defaults or
as constants, and the ones it writes as constants are the round's statement about what is
now settled. Guessing here quietly re-opens a question the user already closed.

Do not edit round 1 to record any of this. v1 is what was shown; the settling is what v2
is for.

## One design should sit further out than is comfortable

Three designs that all accept the brief compare three treatments of a premise nobody
tested. That is the common shape of a round and it is how a study spends four files
confirming its own starting assumption.

**The dark horse refuses a premise the other three share**, rather than treating the same
one differently. For *an admin dashboard*, the premises worth refusing are that it is a
dashboard, that it is a screen, and that anyone goes to it:

- an inbox of exceptions, where nothing that is working appears and the empty state is
  success
- a digest that arrives, with a screen only for disagreeing with it
- one number, wall-sized, everything else a keystroke away
- no new surface — the work shows up in whatever the person already has open

None of those is reachable by varying a dashboard, which is the point.

**It breaks the altitude rule on purpose, and one tile is what pays for it.** The other
three are still a fair comparison with each other; the fourth is not competing with them,
it is asking whether the axis they share is the right one. Do not make it the round's
axis — a round where every design refuses a different premise is a round of jobs, which is
covered above and carries its own warning against reaching for it.

**It is the cheap version of widening.** A narrow round that turns out to have been aimed
wrong costs a whole round to discover; a dark horse costs one file and finds out on the
first pass. When it wins, that is the same result as the section below and arrives sooner.

**It still argues.** `claim` and `why`, with `why` naming what it gives up, exactly like
every other design in the round. A dark horse that cannot say what it costs is not a
direction, it is a provocation, and the user will read it as one.

**Only while the study is still coarse.** Once a round has descended to how the chosen
thing is laid out, a design that refuses the premise is off-altitude with nothing to buy
it back — that is a new study, or a conversation, and usually the conversation.

## A round may widen

Descent is not a ratchet. A narrow round sometimes shows that the whole direction was
wrong — that is a real result, and the response is a *wider* round rather than a finer
one, at an altitude above the one that failed.

Say so when you open it. A v3 that is coarser than v2 looks like a mistake unless
`atelier note` says the direction was abandoned and why. That note is the only thing that
will explain the shape of the study to anyone reading it later, including you.

## Sometimes the fastest round is one design

When the direction is already settled and the real question is *how far in this
direction*, three files are three ways of asking the same thing badly. One design with a
generous manifest lets the user converge in the panel and never spend a round trip.

This cuts against the grain of the tool — `atelier new` takes `--names` and `--count 3`,
and everything about the gallery is built to compare. The count is a judgement, not a
default. Ask what the user is choosing *between*; if the honest answer is "nothing, they
are dialling something in", write one design and open it up.

The inverse is worth as much: if you cannot say what each design argues for, you do not
have several designs. You have one design and some knobs you have not declared yet.

Dialling is not the only one-design round. **Fitting** is below, and a **prototype** —
one design at full fidelity, built to be clicked — is `prototype.md`.

## Fitting: one position inside a system that already decided

**Fitting** is the round that draws one thing into a place already built — a screen added
to an existing product, a part added to a page nobody is rethinking. The surrounding
system answered the questions a choosing round would ask, so there is nothing to compare
and a great deal to obey.

It is one design, like dialling, and underneath the two are opposites:

| | dialling | fitting |
|---|---|---|
| where it comes from | a round that already happened, descending | nothing — it starts fresh |
| what is already settled | whatever the last round landed on | nearly everything, by the system |
| the manifest | generous, free values, the question still open | few knobs, carrying the system's own names |

Confusing them produces the expensive version of both. A fitting given a dialling's
manifest re-opens a palette and a type scale the product settled long ago, and the round
is spent declining to change them. A dialling given a fitting's manifest has nothing to
drag, so the round trip it existed to save happens anyway.

`Closed space` in `controls.md` is that same distinction made about the manifest; this is
it made about the round.

**It still argues.** The one position gets `meta.claim` and `meta.why` like anything else:
what it does with the space it was given, and what it gives up. A design that cannot say
that has not been fitted to anything — it has just been drawn.
