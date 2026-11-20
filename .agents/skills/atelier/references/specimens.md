# Widgets, specimens and dark

Read this when the design is a part rather than a whole screen, produces more than one
exhibit, or has an opinion about the surface under it. A single full-page design needs none
of it — the default export and `frame: 'page'` are already what it wants.

## Is it a page, or a widget?

The first question about any design, and atelier assumed the answer for a long time. It is
a judgement about what you want to look at rather than a fact waiting to be discovered
about the design, so it is settled by what the round is doing:

**Page** — the chrome supplies the width. You get the viewport presets, zoom and fit, and
no caption, because a page fills its frame and there is no margin to put one in that is not
taken from the design.

- an entire page in aggregate
- testing responsiveness of UI across sizes
- the composition of several components across a page
- *fallback: a responsive canvas, for organising things that need somewhere to be displayed*

**Widget** — you supply the width. You get paper, a ground you declare, and a caption
carrying the name, claim and argument, with siblings laid out beside it on one sheet.

- a single control or UI component
- an inventory of a control's states
- a comparison of versions of a control
- *fallback: something small that does not deserve a full page*

Say it in `meta`:

```tsx
export const meta = defineMeta({
  name: 'Gauge',
  claim: 'The value rides its own track',
  why: '…',
  frame: { width: 260, ground: '#ffffff' },
})
```

| | |
|---|---|
| `frame` absent, or `'page'` | the design fills the viewport. The default, and every design written before this existed |
| `'widget'` | sized by the design, with the defaults — 360 wide, 24 of padding, on the harness's own surface |
| `{ width, ground, pad }` | the same, said precisely. All three optional |

**Declaring a width is a choice about the exhibit, not a measurement of the component.**
Plenty of real UI is fluid — a row that takes whatever width the page around it has. That
is still a widget: you pick a width so there is something to look at, the same way you pick
a ground, and 900 rather than 1100 usually changes the picture rather than the answer. What
the harness will not do is work it out for you. Nothing measures — shrink-wrapping needs a
two-pass measure and stops meaning anything the moment a design says `width: 100%` — so a
number is required, and a design that gives none gets 360.

**Declare the ground if the design has an opinion about it** — a control whose whole
argument is pale text on white is a different control on grey, and that must not be
something the harness decided. Omit it and you get the harness's own surface, which is
not a colour the design picked and should not be read as one.

**A fluid part shown at several widths is several specimens.** `frame` is resolved from the
declaration and never from knob values, so width cannot be a knob, `--sweep` cannot reach
it, and `atelier shot --width` is overridden for a widget — it is always photographed at
its own `width + 2·pad`. Three widths means three specimens declaring three. Responsiveness
of a whole *screen* is the other list: that is a page, where the viewport preset is
precisely the question being asked.

What the declaration buys: the design is drawn at 1:1 in focus and in the grid instead of
as a speck in a scaled-down page; `atelier shot` photographs the widget rather than a page
with a widget in the corner, which is a fraction of the tokens; and viewport and zoom stop
pretending to apply.

## Several specimens from one design

A **widget** is a scale — the opposite of a page. A **specimen** is one exhibit of it, and
a design produces one or several. Four states of one field are four specimens of one
widget, not four widgets.

A design's default export is one specimen: one frame, one width, one ground, one page of
paper. A design that wants four — a field at rest, focused, in error and disabled — can
draw all four inside that frame, but then it is a small *page* containing four things, and
none of them can be judged on a ground of its own.

Export `specimens` instead of a default export:

```tsx
export const meta = defineMeta({
  name: 'States',
  claim: 'One field, every state it has to survive',
  why: '…',
  frame: { width: 260, ground: '#ffffff' },   // what they all inherit
})

export const specimens = defineSpecimens(controls, {
  rest:  { claim: 'Nothing happening',       render: (v) => <Field v={v} /> },
  focus: { name: 'Focused', claim: 'A ring, not a colour swap',
                                             render: (v) => <Field v={v} focus /> },
  error: { claim: 'A line taller',
           why: 'The message takes a line rather than a tooltip, so nothing below it moves twice.',
                                             render: (v) => <Field v={v} bad /> },
  off:   { name: 'Disabled', claim: 'Its argument is the surface under it',
           frame: { width: 260, ground: '#e9e9e6' },   // its own ground
                                             render: (v) => <Field v={v} off /> },
})
```

A specimen carries the same three fields a design does — `name`, `claim` and `why`, two or
three sentences of it — so an exhibit that needs a sentence saying what it is *not* has
somewhere to put it. Each gets its own iframe, its own paper and its own caption, laid out
by the chrome. Each inherits `meta.frame` unless it declares its own, so a design 260px
wide says so once and the one state whose argument is about the surface under it overrides
the ground alone.

**A specimen is always a widget.** `frame: 'page'` on one is an error — not because a page
is too big, but because a page has no declared width, so the sheet has nothing to lay it
out at. Candidates that are whole pages want to be separate designs.

**Wide sets stack, and that is still a sheet.** The sheet is a wrapping row, so specimens
too wide to sit beside each other fall into a column instead. Each keeps its own paper,
ground and argument; what a wide set gives up is the side-by-side, not the layer.

**The hierarchy is study → round → design → specimen.** A specimen is the unit the chrome
frames; a design is a source of them.

Where they show up:

| | |
|---|---|
| focus | one paper each at 1:1 under one panel, side by side and wrapping when they are wide |
| the exploration cell, the index thumb, `atelier shot` | all of them at once in one picture, each at its own width and ground |

The chip in a design's meta row says how many it produces.

**Past about a dozen, look at them one at a time.** The sheet is fine at any number — it is
a scrolling page of real papers — but every *tiled* surface is built for a handful.
`atelier shot` puts a small set in one row and otherwise lays it out in roughly square
columns of a fixed-width sheet, so twenty wide
specimens arrive at about a third of size and are unreadable, and the exploration cell
tiles every one of them into a thumbnail. `atelier shot <ref> --specimen <name>` is ~150
tokens and is the right look for a large set.

## A set that co-exists is not a comparison that failed to pick

Two shapes wear the `specimens` export, and only one of them is a choice being made:

| | what is on the sheet | what happens next |
|---|---|---|
| **an inventory** | one thing under every input it has to survive — states, lengths, counts, widths | all of them survive; the set *is* the deliverable |
| **a comparison** | candidate treatments of one thing | one survives, and `scopes` says which knobs went with it |

An inventory is a first-class use of the layer. Every state a status row can be in, a field
at rest / focused / in error / disabled, one mark at six sizes, a fluid part at three
widths — none of those is choosing anything, and all of them want per-exhibit paper, ground
and caption, which is exactly what a sheet supplies and what drawing them into one frame
takes away.

The tell is `scopes`: declare it when the specimens compete, leave it off when they
co-exist. Most sets need none.

**What the sheet does not give you is grouping.** There are no section headers and no prose
between exhibits — a caption is a name, a claim and two or three sentences, and that is the
whole editorial structure on offer. A set that genuinely needs sections, with a paragraph
between the groups, is a page doing documentation. That is a fair answer; choose it out
loud, and say in `atelier note` that specimens were the alternative, rather than arriving
at it halfway through.

## Several candidates are several specimens

Treatments of the same control, judged against each other, is the other shape most
component-scale rounds take. It is the `specimens` export above, used for the second
purpose in that table — and the reason is state rather than taste:

**knob values are stored per design, so two designs cannot be held at the same settings.**
A comparison under different settings is not a comparison, so the candidates have to share
a manifest, and sharing a file is the only way they share one. Every specimen renders from
the same values, and fairness is a property of the file rather than a mechanism anyone has
to maintain.

Each candidate gets its own `name`, `claim`, `why` and its own paper, so nothing is lost
by not being a separate file — except a row in the exploration grid, which is the right
trade when the candidates are 300px wide.

The candidates may still live in their own files; `specimens` is a wiring layer, and
`render` can call anything:

```tsx
import { Framed } from './framed'
import { Quiet } from './quiet'

export const specimens = defineSpecimens(controls, {
  quiet:  { claim: "Say it in the list's own voice", scopes: ['quiet'],  render: (v) => <Quiet {...v} /> },
  framed: { claim: 'Give the absence an edge',       scopes: ['framed'], render: (v) => <Framed {...v} /> },
})
```

`scopes` is what makes the handoff honest when candidates compete; it is the next section.

**Choosing between two whole pages needs none of this.** They are separate designs, and
choosing one is what the exploration grid is for. Reach for specimens when the unit of
choice is a part rather than a whole screen.

**There is no furniture to draw the ground**, and none is needed. `meta.frame` and the
specimen sheet supply the paper, the declared width, the ground, the padding and a
caption in the gallery's own faces. Draw the bare widget and let the frame declaration
do the rest.

**What the harness will not supply** is the contexts a round is actually about. A mark at
16px inside a mock browser tab, a toast against a real panel edge, a button in a form —
those are the specimen, and they belong in the design or its `shared.tsx`.

## `scopes`, and the handoff for one candidate

Specimens change the render, never the manifest: one design is one `controls` export and
one saved file. So a knob only one candidate needs still sits in the shared manifest and
still reaches the artifact, and whoever implements from it cannot tell which half applies.
Which knobs belong to which cannot be inferred from any render — say it:

```tsx
export const specimens = defineSpecimens(controls, {
  quiet:  { claim: '…', scopes: ['quiet'],           render: (v) => <Quiet {...v} /> },
  framed: { claim: '…', scopes: ['framed', 'edge'],  render: (v) => <Framed {...v} /> },
})
```

Then the `json` action on each specimen's caption copies **that one's** handoff: the
unscoped globals, plus any scope nobody claims, plus its own. The panel's own Copy JSON and
Save are not filtered by scopes, because the design is what the file is.

Most sets need no `scopes` at all — four states of one field draw from the same knobs, so
there is nothing to attribute. Declare it when the specimens are *competing* rather than
co-existing.

**Filtering the handoff is not filtering the render.** Every specimen keeps drawing. Hiding
the ones that lost would spend the side-by-side, which is the reason the set is on one
sheet at all.

## A design that goes dark owns its own ground

**There is no theme control in the gallery, and dark mode is not a thing the harness
knows about.** If dark is part of what you are testing, it is a knob like any other:

```tsx
export const controls = defineControls({ dark: { type: 'toggle', default: false } })

export const meta = defineMeta({
  name: 'Ledger row',
  frame: { width: 320, pad: 0 },   // pad: 0 — see below
})

export default function Ledger({ dark }: { dark: boolean }) {
  return (
    <div className={`${dark ? 'dark' : ''} bg-white p-6 dark:bg-zinc-900`}>…</div>
  )
}
```

Two rules, and the second is the one that catches people:

- **Put `.dark` on your own root.** Tailwind here is configured with
  `@custom-variant dark (&:where(.dark, .dark *))`, so `dark:` keys off that class and
  not off `prefers-color-scheme`. It has to: nothing but the OS can switch that media
  query, so a design keyed on it has no dark state anyone can look at. A design written
  with `@media (prefers-color-scheme: dark)` will render in whichever mode your machine
  is in and never move.
- **Take `pad: 0` and draw your own padding.** The `pad` in `frame` is painted by the
  harness, which has never heard of your knob — so a design that turns its background
  dark and leaves the padding to atelier ends up as a dark card in a white bezel.
  Owning your background means owning the whole surface.

To review both at once, sweep the knob rather than reaching for a mode:

```
atelier shot ledger --sweep dark=false,true
```

That is one labelled sheet with the pair side by side, which is what you wanted a dark
toggle for.

## Rules

- **A component design is a specimen sheet.** Render the states — default, hover,
  disabled, long label — as specimens rather than as a knob. A knob shows one state at a
  time and the set is the thing worth looking at, so the knob costs you the whole exhibit.
  A design *may* hold state when the design question is itself behavioural — and when it
  does, the state is a knob it writes with `useTweak` rather than `useState`, marked
  `state: true`, so the panel and the screen cannot disagree. See SKILL.md. **That case is
  a default export and not a sheet:** a specimen's `render` reads a frozen constant, so a
  sheet calling `useTweak` cannot be settled and `pick` refuses it. A sheet's state knobs
  freeze at their saved values along with its output knobs. That is the narrow case: a switch whose
  *behaviour* is the argument. Every state a thing can be in is the wide one, and it is
  this rule. Export `specimens` rather than drawing the states into one frame — the chrome
  gives each its own paper, ground and caption.
- **A specimen that draws itself at more than one size computes from the size, never from
  a percentage.** `padding: '19%'` resolves against the *containing block's* width, so a
  tile that looks right on its own gets 41px of padding the moment it sits inside a 218px
  strip — the content box collapses and the component renders as a correctly-coloured
  empty square. It reads as "the mark failed to draw" rather than as a layout bug, so the
  hunt starts in the wrong place. `padding: size * 0.19` is the same intention and cannot
  do this. `%` and `em` are fine on a page and wrong on anything composed at several
  sizes.
- **An injected design is the exception**, and it is in `existing-code.md` under the same
  name. A design spliced into a live host is one real screen with one thing changed, and
  it does not become a specimen sheet.
