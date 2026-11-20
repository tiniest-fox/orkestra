# House rules

**This file is yours.** atelier seeds it once and never touches it again — unlike
`atelier.ts` and `CLAUDE.md` beside it, which are regenerated on every command. Delete
everything below and write what this repo actually needs.

It is read at the start of a study, before anything is written, and it is the only place
a repo can tell an agent something atelier cannot work out for itself. The shipped skill
is deliberately generic; this is where it stops being generic.

## What belongs here

Facts an agent would otherwise have to guess at or discover the hard way:

- **How code from this repo reaches a round.** A command that renders a component,
  a script that builds fixtures, the one call site worth copying a container from.
- **What has to be loaded for a design to look right.** An icon font, a theme
  stylesheet, a provider — anything whose absence renders *plausibly wrong* rather
  than failing.
- **Where the subjects live.** Which directories hold components worth designing
  against, and which hold code nobody should be mocking.
- **What is expensive.** A component that needs a database record, a screen that
  needs auth, a state that only exists after a migration.

## What does not

- **Rules about designing.** Those are in the skill, they apply everywhere, and a
  second copy here goes stale against it silently.
- **A record of decisions.** That is what a round is. This file is kept true, so
  anything in it that stops being true is a bug rather than a snapshot.
- **The scripts themselves.** Host code lives wherever host code lives in this repo —
  it imports the app. Point at it from here.

## A shape that works

    ## Rendering a <thing> into a round

        <the exact command, with a real example>

    Needs <what has to be true first>. <What it cannot do.>

    ## Loading

    <stylesheet or font> must be in `atelier.config.json`'s `css`, or <what breaks,
    and how it looks when it breaks>.

Keep it short enough that it is read rather than skimmed. If a section is growing an
argument, it is a dated note and belongs wherever this repo keeps those.
