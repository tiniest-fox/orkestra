---
name: atelier-proof
description: Look at a UI component you have already built, without booting the app. Use when you want to see, check, screenshot or verify a component, screen or state you just wrote or changed — import it, give it realistic props, validate it renders, and inspect it visually. Faster and more reliable than starting the host application, which needs auth, seeded data and a route to reach the thing you are looking at. Triggers on "test the UI", "check the component renders", "screenshot this component", "does this look right", "verify my UI change", "see what this looks like", "render this component".
---

# Proof

**You built some UI. Look at it before you say it works.**

The habit this replaces is booting the host application: `pnpm dev`, log in, navigate to
the route, contrive the state. That costs minutes, needs credentials and seeded data, and
fails for reasons that have nothing to do with your component — so it gets skipped, and the
change ships unlooked-at.

A **proof** is one throwaway file that imports the real component, hands it props, and
renders it on its own. You look at it, and you delete it.

```
atelier proof src/ui/UserCard.tsx     seeds .atelier/proof/user-card.tsx
                                      → edit it: give the component realistic props
atelier check proof/user-card         does it render? any console errors? — exits non-zero
atelier read proof/user-card          what is actually on screen, as text — do this first
atelier shot proof/user-card          a PNG, when you need to see it
atelier shot proof/user-card --r2     …and a link to it, for a pull request
rm .atelier/proof/user-card.tsx       done
```

`atelier proof` with no arguments lists what is on the proof and how to clear it.

## Why this instead of the dev server

- **Nothing to log into.** The component is imported directly; there is no route, no
  session and no seeded row to arrange.
- **It fails loudly and in one place.** `atelier check` exits non-zero on a component that
  throws, a console error, or an import that no longer resolves. A dev server shows you a
  blank panel and leaves you to guess.
- **The answer is usually text.** `atelier read` reports real geometry, computed colour
  against the backdrop actually painted, contrast ratios, and what is clipped — for a
  fraction of what a screenshot costs. Reach for it first and take the picture only when
  the question is about composition.
- **It is the real component.** Imported live from the source tree, not copied, so what you
  are looking at is today's code. If it drifts, that is the point.

## Writing the file

The seed is an import and a default export. There is no `meta`, no config and no
ceremony — the file name is the name.

```tsx
import { UserCard } from '@/ui/UserCard'

export default function Proof() {
  return <UserCard name="Rosalind Fell-Whitmore" role="Admin" pending />
}
```

Three things decide whether what you see is true.

**1 — The default export takes no props.** The harness hands a design its knob values as
props, and a proof declares none, so a file that re-exports the component directly gets
every prop `undefined`. It keeps rendering, prints nothing, and shows you a picture of
something that is not your component. Always wrap it.

**2 — Give it the inputs that break things.** The longest realistic string, the empty case,
the three-digit number, the missing avatar. Read the component's own props type rather than
guessing. Content that is all median length is how a change passes review and fails in
production.

**3 — Reproduce the container, not just the component.** This is the commonest way a proof
lies. A component often draws itself and almost none of its own layout — the grid it sits
in, its padding, the rule between it and its neighbour frequently live in the *parent's*
selectors, keyed to a class the component never mentions. Import the component and its
stylesheet and you still get none of them. Find the one call site that renders it and copy
the element it sits inside, class name and all:

```tsx
<div className="panel__rows">     {/* the class its layout is keyed to */}
  <UserCard … />
</div>
```

There is no error when you get this wrong. The component renders, the console is clean, and
the layout is merely *different* — which you will read as the component being wrong. Check
against the real thing before you believe what the proof tells you.

## Size

The seed declares `frame: 'fit'`, which means *do not tell me*: the design is laid out at
the full viewport and the picture is cropped to what it actually painted. A small thing
comes back small; a full-width row comes back full width. Nothing about size is written in
the file.

You set the width while looking — `atelier shot proof/<name> --width 390` on the command
line, or the Viewport cell in `atelier dev`.

A fit taller than the viewport is cut at it, with nothing said and no help from `--full`,
so a proof of a long list comes back short and looks whole. Give it the height too:
`atelier shot proof/<name> --height 2400`.

Fit cannot invent a container. A component whose width comes from the pane holding it has
no width of its own to measure, so give it that pane — the same rule as (3) above.

## Several states at once

Render them in one file. A proof is a component, so a loop, a wrapper and some state are
all available:

```tsx
const CASES = [
  { label: 'rest', props: {} },
  { label: 'pending', props: { pending: true } },
  { label: 'error', props: { error: 'That address is missing an @' } },
]

export default function Proof() {
  return (
    <div style={{ display: 'grid', gap: 24, padding: 24 }}>
      {CASES.map((c) => (
        <div key={c.label}>
          <div style={{ font: '11px monospace', opacity: 0.6 }}>{c.label}</div>
          <UserCard {...c.props} />
        </div>
      ))}
    </div>
  )
}
```

Interaction works too — a proof can hold `useState` and be clicked in `atelier dev`. A
static knob is a picture of a knob.

## When the component needs a router or a query client

Some components cannot mount alone: they read a query client, a router, a store. Do not
reconstruct that from memory — copy the host's own composition. `atelier adopt src/main.tsx`
brings the entry point in; delete the `createRoot` and export what is left, keep it in one
file at the root of `.atelier/`, and import it from the proof.

Mock the wire, not the hook. Stub `fetch` and let the real client decode the response — a
stubbed hook will happily render a state the server cannot produce.

## Putting one in a pull request

`--r2` publishes the PNG and prints a link, through the account holder's own `wrangler
login`. It serves `image/png`, so `![](<url>)` renders inline in a description, a comment
or an issue — which is what makes it the way to show a reviewer the component you just
changed. Dragging the file into the comment box does the same thing and needs hands; this
does not.

```
atelier shot proof/user-card --r2
```

It renders at `--dpr 2` rather than the usual 1, because a link is opened by a person on
a real screen rather than read back into a conversation. That also makes the PNG left in
`.shots/` the expensive one — shoot without `--r2` when you are the one looking.

**The picture outlives the proof, and that is the point.** You delete the file when you
have looked, so the link is the only thing left — nothing can regenerate it, and nobody
can check it against the source it came from. Say in the comment which commit it is a
picture of, because the image cannot.

**Republishing does not reliably refresh a comment.** The key is
`<repo>/proof-v1-<name>.png` — no date, no content hash — so it is the proof's *name*
that decides the address, and proofing the same component again overwrites what is
there. That will not update a picture someone has already been shown: hosts that render
images inline mostly copy them to a domain of their own first, GitHub included, and keep
serving the copy. Post the new link rather than re-publishing the old one.

The name being the address is the part to watch, because a proof's name is short and
reused. Proof a *different* component under a name you have used before and you have
quietly replaced the picture behind an old link with something unrelated. Pick a name
you will not want again if its picture is going anywhere someone might scroll back to.

**Anyone with the link can read it.** There is no password on a picture. A proof renders
the real component against whatever you handed it, so publishing one publishes the
fixture — invent the names, addresses and amounts rather than pasting a row out of a
database. *Realistic* is what makes a proof true; *real* is what makes it a leak.

## Rules

- **Never commit a proof.** The rest of `.atelier/` is committed — the studies are the
  argument for why a screen ended up the way it did. `proof/` is ignored because it makes
  no argument: it is a look at code the source tree already has.
- **Delete it when you have looked.** The gallery keeps a count of them on the Proofs entry
  in its spine, and `atelier proof` and `atelier list` will name them, so a stale one is
  visible rather than lost. Nothing removes it on your behalf — `atelier prune proof` is
  the whole of the cleanup, and it runs when you say so. One kept "in case" is an unowned
  copy of a question nobody is asking.
- **No claim, no knobs, no saving.** A proof draws no control panel and saves nothing;
  `controls` exported here would not render. It is a look, not a record.
- **Look at what came back, not at whether the command exited 0.** A broken import is
  loud; a component rendering slightly wrong is silent, and that is the failure this
  exists to catch.
- **If the answer turns out to be "this needs redesigning", stop.** A proof has no claim
  and no argument, so a redesign done in one leaves no trace of why anything changed. That
  is a design question, and it wants the **atelier** skill and a study — `atelier new
  <name>` — which gives you several options side by side, a control panel, and a record of
  what was chosen.
