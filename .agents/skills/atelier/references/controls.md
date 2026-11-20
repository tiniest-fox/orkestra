# Writing the manifest

Read this whenever you are writing or revising `controls` — which is most rounds. It
covers what belongs in the manifest at all, the control types and their fields, bundling
several values under one name, and whether a round's weight goes in each design or in a
shared file.

What it does not cover is *which* differences deserve a knob rather than a design of
their own. That is `comparing.md`, and it is the decision this file assumes you have
already made.

## Expose the internals of the subject, the API of everything else

Designing the button? `pad`, `radius`, `text` are knobs. Designing a modal that
*contains* a button? The button is `design="outline"`, and its padding is a different
study. This is the rule that decides what belongs in the manifest.

## Expose what the question needs, not everything possible

A knob is cheap to write and not cheap to read. **Every knob is a question you are
putting to the user**, and they have to answer it or decide it does not matter — so a
manifest of forty is a manifest that hides the three that count.

The test is not "could this vary". It is **"is this under consideration"**. Ask what the
user is trying to learn, and expose that. Adding a knob later costs one line and a
reload; un-asking a question you already asked costs their attention, and you cannot get
it back.

The number of knobs is not the measure — the design space is:

**Open space — a greenfield page.** Nothing is settled, so almost everything is a
question. Twenty knobs is right here, because the user is deciding what the thing *is*.
What you still owe them is thought in the options and the defaults: bounds that are
plausible rather than `0` to `100`, and a default that is your actual recommendation.

```tsx
export const controls = defineControls({
  layout: { type: 'enum', options: { stack: '1fr', split: 'repeat(2, minmax(0, 1fr))' }, default: 'split' },
  measure: { type: 'range', min: 480, max: 1200, step: 20, unit: 'px', default: 880 },
  bg: { type: 'color', default: '#ffffff' },
  accent: { type: 'color', default: '#4f46e5' },
  heading: {
    size: { type: 'range', min: 24, max: 64, step: 1, unit: 'px', default: 38 },
    tracking: { type: 'range', min: -0.04, max: 0.02, step: 0.005, unit: 'em', default: -0.02 },
  },
  body: { size: { type: 'range', min: 12, max: 20, step: 1, unit: 'px', default: 15 } },
})
```

**Closed space — a change to one component.** The system already answered nearly every
question, so re-asking is not generosity, it is an invitation to unsettle something
nobody was unsettling. *"Make the destructive button read as more serious"* is this
manifest, and no more:

```tsx
export const controls = defineControls({
  weight: { type: 'enum', options: { medium: 'font-medium', semibold: 'font-semibold' }, default: 'semibold' },
  danger: {
    bg: { type: 'color', options: { '600': { value: 'bg-red-600', swatch: '#dc2626' }, '700': { value: 'bg-red-700', swatch: '#b91c1c' } }, default: '700' },
    ring: { type: 'toggle', default: true },
  },
})
```

No `radius`, no `pad`, no `fontFamily` — the system decided those, and a slider on a
decided value is a bug report waiting to be filed. **Hard-code them from the real
tokens** and let them show up in the design without showing up in the panel. If the user
wants one of them open, they will say so, and it is one line.

The same applies inside an open-space study once something gets decided. When the
palette is settled, the accent stops being a `color` picker and becomes a constant; what
survives as a knob is only what is still in the air.

**A prototype's manifest is its spine, not its states.** One design at full fidelity,
built to be clicked, has dozens of interactions, and a knob on each of them is a panel
with the spine buried in it. So the manifest holds which screen you are on and anything
that changes what the screen is *for*; every other interaction is ordinary `useState`,
however many there are. That is this section's rule rather than an exception to it — the
question is *what is this like to use*, and nobody is being asked to choose a hover state.
`prototype.md` is the whole account, including what local state costs.


## Control types

| type | fields | the component receives |
|---|---|---|
| `range` | `min`, `max`, `step?`, `unit?`, `default` | number |
| `color` | `options?`, `free?`, `default` | string |
| `enum` | `options`, `default?` | string, or the bundle it names |
| `toggle` | `default` | boolean |
| `text` | `default`, `placeholder?` | string |

All accept `label`, `hint`, `when` and `state`.

## An output knob, or a state knob

Every knob is one of two kinds, and `state` is what says which.

An **output knob** is a decision about the thing being built — a radius, an accent, a
density. A **state knob** is where the design was left standing: which screen it is on,
whether the drawer is open, which nav item is lit. Mark one `state: true`.

```tsx
screen: { type: 'enum', options: { browse: 'browse', cart: 'cart' }, default: 'browse', state: true },
```

The test is whether it belongs in a handoff. Whoever implements the real thing acts on
`radius: 'lg'` and can do nothing with `screen: 'cart'` — so the two `json` copy verbs
leave state knobs out, along with a scope the drop empties. Everything that *addresses* a
design keeps them: Save, `?s=`, **Copy link** and `atelier shot --set`. That is the whole
reason a screen is a knob rather than `useState`.

The panel draws the difference. Root state knobs are hoisted into a `view` pane of their
own above the design's own sections, and a state knob inside a scope stays in that scope
with a dot before its name.

**A knob the design writes back through `useTweak` has to be a state knob.** `atelier
pick` freezes an output knob into a constant, so a written one would settle as a control
that renders and no longer moves; `pick` refuses the design and names the knob instead.
State knobs survive a pick live, in the picked file's own `useState`. The reverse does not
follow — a state knob nothing writes is ordinary, and moves from the panel alone.

## A knob that depends on another

`when` says what has to be true elsewhere for a knob to mean anything. Unsatisfied, the
knob **is not drawn** — the panel lists it at the foot of its section against what it is
waiting on, so it is still findable and still says what would bring it back.

```tsx
export const controls = defineControls({
  showIcon: { type: 'toggle', default: true },
  iconType: { type: 'enum', options: { chevron: '›', arrow: '→' }, when: { showIcon: true } },
})
```

Three rules, and the second is the one that catches people:

- **The key is a path, read the way `useTweak` reads one** — a bare key is a root knob,
  `scope.key` is a scoped one. A knob inside a scope that depends on a sibling names it in
  full: `when: { icon.showIcon: true }`. One resolution rule rather than two.
- **The value is compared against state — the option's *name*, not what it resolves to.**
  `when: { size: 'lg' }`, never `when: { size: 'text-lg' }`. Writing the resolved value
  gives a knob that is never shown, which is why `atelier shot` checks it against the
  target's own options.
- **A chain resolves to its first unmet link.** If `iconRotation` needs `iconType:
  'chevron'` and `iconType` is itself waiting on `showIcon`, the panel says `showIcon` —
  naming the nearer condition would report something that has already happened.

**Ask first whether it should be one control.** `icon: { type: 'enum', options: { none,
chevron, arrow } }` makes the dependency impossible rather than merely handled, costs a
knob rather than a field, and adds no concept. It is the cheaper fix wherever it fits, and
all it gives up is *remember my icon choice while it is switched off* — which `when` keeps,
because a hidden knob keeps its value and gets it back when the dependency is met.

The reasoning, and the three treatments this was chosen over, are in
`.atelier/2026-08/panel-inert/v1`.

**`unit` is display-only** — it is the suffix the panel shows next to the number. The
component gets a bare number and composes its own units: `` fontSize: `${size}px` ``.

**Options are maps**, `name: value`. The name is what the panel shows and what the saved
JSON records; the value is what the component receives.

```tsx
size: { type: 'enum', options: { sm: 'text-sm', lg: 'text-lg' }, default: 'sm' }
```

The user picks `lg`; the component gets `text-lg`; the saved file says `"size": "lg"`.
That file is what you implement from, so it speaks the design system's vocabulary rather
than repeating class strings you already wrote down here.

**`color` options carry a swatch** when the value is not itself a colour — the panel has
no access to the host repo's theme, so `bg-brand-600` can only be drawn if you say what
it looks like:

```tsx
bg: { type: 'color', options: { brand: { value: 'bg-brand-600', swatch: '#4f46e5' } }, default: 'brand' }
```

Without options, `color` is a free picker and `default` is a colour. There is no icon
type: the chrome cannot render markup a design authored, so use `enum` — `arrow-right`
reads perfectly well in a dropdown.

**`free` lets a palette also take an arbitrary colour.** The list gains one more row,
"Other", which opens the OS picker; state then holds either an option's name or a colour,
and the saved file records whichever the user landed on:

```tsx
ink: { type: 'color', free: true, options: { black: '#000', white: '#fff' }, default: 'black' }
```

It is declared per knob rather than always on, because **an option's value need not be a
colour.** The `bg-brand-600` palette above hands the design a class name, and an arbitrary
hex reaching the same prop is a broken class — the component renders, unstyled, and
nothing says why. So `free` belongs on a palette whose values are themselves colours, and
`atelier shot` objects when it is declared on one whose values are not.

Reach for it when the palette is a set of good starting points rather than the whole of
what is allowed — a page's accent, a mark's two halves. Leave it off when the palette is
the system and going outside it is the thing you are trying to notice; that is the closed
space above, and the escape hatch is exactly what closed means.

## One name, several values

An `enum` option can carry a **bundle** — several values that travel together:

```tsx
face: {
  type: 'enum',
  options: {
    rockwell: { family: 'Rockwell, Georgia, serif', size: 38, weight: 400, tracking: -0.01 },
    iowan:    { family: "'Iowan Old Style', Georgia, serif", size: 36, weight: 600, tracking: -0.02 },
  },
  default: 'iowan',
}
```

The design reads `face.family`, `face.size`; the saved file still says `"face": "iowan"`.

Reach for it when picking one thing genuinely means picking the others. A typeface is
the clearest case — it is not a drop-in, since Baskerville at 13px reads two steps
smaller than Iowan at 13px, and a slab at 600 is a shout where an old-style face at 600
is emphasis — so a `face` knob that moved only the family would hand the user a design
that got worse when they chose correctly. A density and the four spacings it implies is
the same shape.

Two rules, and both are the same rule:

- **Every option must carry the same keys.** One missing `tracking` hands the design
  `undefined` and the design *draws* — one face untracked, nothing announced anywhere.
  `atelier shot` says so; that check is why this is safe to use.
- **A bundle locks what it carries.** Once `rockwell` means 38/400/−0.01, *yes but a
  point bigger* has nowhere to go. If that question is live, declare the override as its
  own knob — one line, and it says out loud that it is an override.

Bundles are `enum` only. A record on a `color` option is always `{ value, swatch }`, and
the design still receives the value alone.

**Check for a platform answer first.** The round that produced this feature ended up not
needing it: `font-size-adjust` normalises x-height across faces, so switching a face
stopped changing the apparent size and none of the numbers had to move. A knob that
carries four values is worth having, and it is also worth thirty seconds asking whether
the browser already solves the thing you are about to bundle.

**Declare a control for anything you were tempted to guess at** — *within the question
being asked*. If you catch yourself picking between two spacings and neither is settled,
that is a knob, and it is the entire point of the tool. If the system already picked, it
is a constant. See "Expose what the question needs" above; the difference between the
two is the whole skill.

## How much of a design lives in the file

A round can put its weight in either place, and the two shapes cost very differently.

**Self-contained** — each design draws the whole thing. Use it when the directions
differ *structurally*: a different information hierarchy, a different navigation model.
There is no shared skeleton to factor out, because disagreeing about the skeleton is the
point. Expect 300–500 lines a design.

**Thin over a fat `shared.tsx`** — the chrome and a controls fragment live in
`shared.tsx`, and a design is `meta`, a spread, and its delta:

```tsx
// shared.tsx
export const typeControls = defineControls({
  size: { type: 'range', min: 11, max: 18, step: 0.5, unit: 'px', default: 13 },
  weight: { type: 'enum', options: { medium: 'font-medium', semibold: 'font-semibold' }, default: 'semibold' },
})

// iowan.tsx — the whole design
export const meta = defineMeta({ name: 'Iowan', claim: '…', why: '…' })
export const controls = defineControls({ ...typeControls, reach: { …} })
export default (p: Props<typeof controls>) => <Chrome {...p} family="'Iowan Old Style', Georgia, serif" />
```

The spread keeps its literal types, so `p.weight` is still `'font-medium' | 'font-semibold'`
rather than `string`. Use it when the directions differ in *treatment* — a typeface, a
density, a colour story — against a skeleton nobody is arguing about. Designs come out
around 30 lines, so a seventh candidate costs almost nothing to add and nothing to
regret.

Neither is the right default. Ask which thing the round is actually comparing: if you
cannot say what the shared skeleton would be, the designs are structural and each wants
its own file; if you can, putting it in one place is what lets the round hold seven
candidates instead of three.


## Rules

- **Tailwind's job changes with the design space.** In an open space, values come
  through props and go into inline styles — `style={{ fontSize: `${size}px` }}` — and
  Tailwind does structure: `flex`, `grid`, `gap-4`, `min-h-screen`. In a closed space,
  the knob carries a **class name**, and it must be written out in full in the manifest:
  Tailwind cannot see a class assembled at runtime, so `` `text-${size}` `` silently
  produces nothing. An inline style in a closed-space study is usually the smell that
  someone is inventing a value the system does not have.
