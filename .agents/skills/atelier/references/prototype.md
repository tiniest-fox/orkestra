# Prototypes

A **prototype** is one design at full fidelity, built to be clicked rather than compared.
It answers *what is this like to use* — the one question a grid cannot answer, because a
grid is a row of still pictures and what is being judged is the movement between them.

It is a round like any other: dated, named, kept, one study above it. What differs is what
the design is made of and what happens to it afterwards.

**It is neither of the two things it resembles.** A proof looks at a component the source
tree already has; a prototype draws what does not exist yet, which is why this is a study
and a proof is not. A wireframe holds treatment still on purpose, so the reader reacts to
structure; a prototype holds nothing still, because a flow judged through grey boxes is
judged on the wrong thing.

## Where it sits against a choosing round

Either side of one, **including before there is one**. *Find out what is possible* is a
reason to build a prototype, and three directions drawn against a flow nobody has clicked
are three answers to a question that was never checked.

After a direction is settled it is the ordinary case — the flow made real in the direction
the user picked.

## The spine

**Navigation is knobs. Everything below it is ordinary React state.**

The **spine** is which screen you are on, plus anything that changes what the screen is
*for*: a modal being open, which step of a wizard you are in. Write it with `useTweak`, so
a click moves the panel and the panel moves the screen.

**Every spine knob is `state: true`** — the spine is the worked case of a state knob, and
marking it is what keeps the spine out of the copied handoff and lets the round be settled.
`references/controls.md`. Call `useTweak` in the design's own body and pass the setter to
whatever is clicked; a call from a helper component cannot be settled, and `pick` refuses it.

```tsx
export const controls = defineControls({
  screen: { type: 'enum', options: { browse: 'browse', item: 'item', cart: 'cart' }, default: 'browse', state: true },
  modal: { type: 'enum', options: { none: 'none', confirm: 'confirm' }, default: 'none', state: true },
})

export default function Design({ screen, modal }: Props<typeof controls>) {
  const go = useTweak('screen')
  …
}
```

Everything else is `useState`, freely and in quantity — a hovered row, an open dropdown,
what is typed into a field, which tab of a local group is showing. **That reverses
`SKILL.md`'s rule** that a design never holds its own state, and it reverses it for one
reason: a prototype has dozens of interactions, and a manifest of dozens is a panel nobody
can find the spine in.

**What local state gives up is an address.** `?s=` cannot reach it and `atelier shot
--set` cannot render it, so a screen reachable only by typing into a field can be neither
linked to nor shot. That is the whole cost, and it is why the line is drawn at *changes
what the screen is for*: the states worth linking to are exactly the ones on the spine.

**Nothing enforces the line.** The two-truths check that catches local state shadowing a
knob walks only the wireframe kit's parts, so a prototype that navigates with `useState`
draws perfectly and says nothing. Getting it wrong costs the addresses, not the render.

## The claim says what it is for

An ordinary design's `meta.claim` says what that design argues, because it is competing. A
prototype competes with nothing, so its claim says **what it is for** — the question it
was built to answer.

```tsx
export const meta = defineMeta({
  name: 'Checkout, end to end',
  claim: 'For clicking the whole purchase through before we commit to the step count',
  why: 'Payment is faked and the address book holds one saved card; every other path works',
})
```

That is also the honest answer to the *no claim — add meta.claim* the grid prints over any
design without one. And `why` is where **what is faked** goes — which paths work and which
are dead ends — so nobody clicks a link that was never wired and reads it as a bug.

## Afterwards

**Nothing is handed over.** A prototype's code does not port: there is no real data, no
auth and no routing, so what survives is what the clicking settled — the screens, the
steps, what turned out to be missing. Write that down with `atelier note`, the way any
round's result is written down.

**It can be picked, and the settled file still clicks.** `pick` freezes the output knobs
and hands each state knob to the picked file's own `useState`, so a marked spine keeps
moving rather than pinning the prototype to one screen. An unmarked one is refused by name.

The exception is a design drawing the wireframe kit's writing parts, which `pick` refuses
by name — `references/wireframe.md` says why.
