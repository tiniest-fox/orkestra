# Wireframes

A **wireframe** is a fidelity, not a shortcut. It is a design drawn deliberately rough so
that a reader reacts to the structure rather than to the treatment — and the roughness has
to be *uniform and declared*, because a rough detail inside an otherwise finished design
reads as the direction being wrong rather than as unfinished. `comparing.md` says exactly
that, and it is the reason this is a whole mode rather than a licence to draw less
carefully.

Reach for it in one case: **the round's question is structure, flow or information
hierarchy, and the treatment is the control you are holding still.** Anywhere else it is
the wrong instrument.

## The two rules

**Wireframe the neighbours, never the subject.** `controls.md` already says the button
inside a modal study is `design="outline"` and its padding is a different study. This is
that rule extended to parts that do not exist yet: a wireframe part stands where something
is *not* being decided. A `WireBox` where the thing you are designing should be is a round
with nothing in it.

**Strip style, never content.** The fixtures rule holds here exactly as it does everywhere —
the longest realistic string, the zero state, the three-digit number, the missing value.
This is not a preference. The published finding is that *the content inspires feedback, not
the container*, and lingering placeholders hide the constraints you were trying to find.
Grey boxes where the words go is the single most common way a wireframe round produces
nothing.

## Using it

Everything comes from `atelier`, like the rest of the contract. The parts must sit inside a
`<Wireframe>`, which loads the skin and marks the design as provisional; one used outside
throws, because a wireframe part rendering unstyled looks like a finished proposal and
argues the opposite of what you meant.

```tsx
import {
  defineControls, defineMeta, Wireframe, WireSteps, WireField, WirePicker,
  WireBox, WireOverlay, WireButton, WireNote, wireSteps, wirePicker,
  wireOverlay, wireNotes, type Props,
} from 'atelier'

export const controls = defineControls({
  ...wireNotes(),
  ...wireSteps('step', STEPS),
  ...wirePicker('service', SERVICES),
  ...wireOverlay('confirm'),
})

export default function Design({ step, service, confirm, notes }: Props<typeof controls>) {
  return (
    <Wireframe notes={notes} className="min-h-screen p-8">
      <WireSteps of={STEPS} state={step} scope="step" />
      <WireField label="Customer" value={SHIPMENT.customer} />
      <WirePicker of={SERVICES} state={service} scope="service" label="Service" />
      <WireBox label="date picker — not designed yet" />
      <WireButton emphasis="primary">Continue</WireButton>

      <WireOverlay state={confirm} scope="confirm" title="Confirm booking">…</WireOverlay>
    </Wireframe>
  )
}
```

`example-wireframe` is the worked round: two information architectures at one treatment.

## The fragments, and the structural questions they carry

**A part cannot contribute a knob by existing.** `controls` is a static export read before
anything renders — the panel, `--set`, `brief` and the saved JSON all come from it. A knob
that appeared because a component mounted would flicker as branches render and be
unreachable by `--set` before the first paint. So the kit ships **fragments a design
spreads**, which is the house idiom already: `comparing.md` says to keep a component and its
manifest fragment together and spread it.

Each fragment declares a **scope** holding the state *and* one structural question, because
the manifest is one level deep and the two belong together.

| fragment | scope it declares | the question it asks |
|---|---|---|
| `wireOverlay(path)` | `{ open, as }` | `dialog · sheet · inline · page` — where the interruption lives |
| `wireSteps(path, of)` | `{ value, as }` | `tabs · steps · accordion · all` — one at a time, or all of it |
| `wirePicker(path, of)` | `{ value, as }` | `select · radios · segmented` — how the options are offered |
| `wireNotes()` | `notes` toggle | whether annotations are drawn |

**The state half of a fragment is a state knob; the structural half is not.** `open`,
`value` and `notes` carry `state: true`, so the copied handoff holds the `as` answers the
round was about and not where the flow was left standing. `controls.md` is the account of
the two kinds.

**A design drawing the writing parts cannot be settled.** `WireOverlay`, `WireSteps`,
`WirePicker` and `WireCheck` write their knob from inside the kit, on a path the design's
own source never names, so `atelier pick` has no setter to hand them and refuses the
design naming the parts.

**A kit knob may ask a structural question, never a treatment one.** Treatment is the thing
a wireframe holds still — a radius knob on a hand-drawn border is meaningless and a colour
knob is the mode arguing against itself. Each of these would otherwise cost a whole round to
answer, which is the trade `SKILL.md` opens with: a knob is one line, a round trip is a
message, a rebuild and a reload of the user's attention.

Set `step.as` to `all` on a wizard and it becomes the long-form design. That is the knob
doing its job — the user walks to the neighbouring answer without anybody opening a v2.

## The parts

Ten, and the list is closed until something earns its way on. `?` marks an optional prop;
every part also takes `className`, which is where Tailwind does the layout.

| | props | draws |
|---|---|---|
| `Wireframe` | `children`, `notes?`, `style?` | the root `<div class="wire">`; passes through other div attributes |
| `WireOverlay` | `state`, `scope`, `title?`, `children` | a `<dialog>`, a sheet, a full page, or an in-flow section |
| `WireSteps` | `of`, `state`, `scope` | a tab strip, numbered steps, an accordion, or nothing at `all` |
| `WirePicker` | `of`, `state`, `scope`, `label?` | a `<select>`, a radio set, or a segmented control |
| `WireCheck` | `checked`, `knob`, `label` | a label around `<input type="checkbox">` |
| `WireField` | `label`, `value?`, `placeholder?`, `multiline?`, `rows?` | a labelled input, or a textarea |
| `WireButton` | `emphasis?`, `children` | a button at one of three emphases |
| `WireBox` | `label`, `height?` | a hatched rectangle with the label centred |
| `WireDevice` | `kind?`, `width?`, `caption?`, `children` | a phone, tablet or browser frame |
| `WireNote` | `children`, `mark?` | a remark on the design, in annotation blue |
| `WireAsk` | `label`, `children` | a bracket round the region the round is asking about |

And the props that are easy to get backwards:

| prop | it is |
|---|---|
| `of` | **the same options map the fragment declared.** Pass the object, not its keys |
| `state` | **the scope object**, as the design received it — `{ open, as }` or `{ value, as }` |
| `scope` | that scope's **path**, as a string. The part writes `scope.open` or `scope.value` |
| `knob` | on `WireCheck`, a plain knob path — it has no fragment because it has no `as` |
| `emphasis` | `primary` leads, `secondary` is the default, `quiet` recedes |

`optionName(of, value)` is exported too, for a design driving an enum without one of these
parts. It is the value-to-name conversion `useTweak` needs, and hand-rolling it is how it
goes wrong.

### `state` and `scope`, and why it is two props

A design never reads a knob except through its props, so a component cannot fetch its
current value and has to be handed it; and `useTweak` writes by path, so the path has to be
named. There is no `useAtelierValue()` and there will not be one.

The consequence: **nothing in the type system stops you passing local state as `state`.**
`atelier check` does:

```
! <WireOverlay knob="confirm.open"> was given true but the knob holds false — two truths.
  The value must be the one this design received as a prop, never local state
```

It compares the value each part was handed against what the knob it named actually holds,
on the first render rather than after the sweep. The same pass catches a value that is not
in its own `of` map — a failure the parts can see and nothing else can, because the lookup
falls back to the first option and renders a plausible wrong answer:

```
! <WireSteps knob="step.value"> was given "One", which is not a value in its `of` map —
  the first option is being shown instead
```

A knob naming nothing at all is reported once, by the existing `useTweak` check, rather than
twice for one mistake.

### The value is not the key

An enum knob stores the option's **name** and hands the design the **value** it resolves to.
So with `STEPS = { details: 'Details', … }`, `step.value` is `'Details'` and the knob holds
`details`. The parts do that conversion internally, which is most of why they exist — and it
is why `of` must be the same object the fragment declared. A different map with the same
keys silently matches nothing and the first option wins.

### A scope needs a tag, so put each one on a branch that draws

`checkTags` reads the DOM, so a declared scope inside a branch that is not currently
rendering reads as a scope pointing at nothing. The parts tag themselves — `WireOverlay`
carries `data-atelier={scope}` and so do the others, which also makes them addressable by
`atelier read --scope confirm`. But a wizard hides most of itself by definition, so **put
each scope on the step that opens by default**, or the check will object at the design's own
starting state.

### Everything else is a `<div>` and Tailwind

The kit is small on purpose. A part earns a place here on one of two arms — it absorbs
something that fails **silently**, or there is **no element** for it at all — and layout is
neither. There is no stack and no grid, because `flex flex-col gap-4` already works, is
already what this skill teaches, and swapping it for a novel API buys nothing.

Anything with no part here is a `WireBox` with a label saying what it stands in for. The
label is what makes it rejectable — *"date picker — not designed yet"* is a proposal
somebody can argue with, and an unlabelled grey rectangle is a hole.

### `emphasis` is a prop, and there is no tone

Which action a design pushes you toward is a claim the design makes, declared per button. A
knob dragging "which one is primary" is incoherent when four are on screen.

Three levels, and **no `danger` or `info`**. The label already carries that — *"Delete
account"* is danger and *"Learn more"* is info, so a tone variant at this fidelity is
redundant with the words. And tone is carried by colour: red against a grey sketch is the
most salient thing on the page and would pull every eye to the one element that is not the
question. Every kit surveyed ships secondary and ghost buttons; none ships a danger one.

If a destructive action needs marking, that is a `WireNote` — visibly a remark rather than a
decision. And if the round's question *is* how to warn people, then tone is the subject, and
the first rule says this should not be a wireframe round at all.

### `WireField` is uncontrolled, and that is deliberate

It takes `value` as a fixture and never writes anything back. Text a person types into a
wireframe is not a decision, so it does not want a knob — `specimens.md` is explicit that
this is not permission to turn every state into a switch. If what someone types *is* the
question, that is a `text` control and a plain `<input>` reading it.

## Annotation is the half a design system does not have

Every wireframing tool surveyed ships a markup vocabulary and no design system ships any of
it — Balsamiq has a whole Markup category, Whimsical has `w-annotation`, Figma's lo-fi kit
ships Annotations and Flow Lines. That is the difference between describing what is built
and arguing about what is not.

```tsx
<WireNote mark="1">Nothing you already answered is on screen. That is the trade.</WireNote>

<WireAsk label="the question: does the summary have to be visible the whole time?">
  <aside>…</aside>
</WireAsk>
```

**`WireAsk` is the on-screen version of a handover sentence.** `SKILL.md` step 4 says to tell
the user which knobs are the question and which are a detail riding along, *"because the
panel draws the two identically, so nothing on screen tells them apart"*. Said out loud that
survives one message; bracketed on the design it survives a context clear. Use it once per
design, twice at most — a design where everything is bracketed has said nothing.

**Annotations are the one place the kit uses colour, and that is the rule holding rather
than breaking.** A wireframe is grey so nothing reads as a decision; an annotation has to
read as *not a decision*, which is the same argument inverted. Pen blue rather than red, for
the reason above. Nothing in an annotation inherits the wobble either — a straight dashed
edge is doing real work by being visibly a different instrument.

**They are not `notes.md`, and the two should not be merged.** An annotation is *on* the
design and travels with the file; a note is *about* the round and travels with the record.
The Pin cell is the reader's version of this gesture, after the fact; these are the writer's,
beforehand.

`wireNotes()` turns them off, and it is the only knob the kit offers globally. Everything
else it could offer is either treatment or already the chrome's job — the viewport being the
obvious one.

## What the parts are absorbing

Each of these was found by rendering a design rather than by reading one, and each is
invisible in a browser. That is the whole reason the kit exists rather than a snippet.

- **A modal is imperative.** `<dialog open>` as an attribute gives a non-modal dialog with
  no backdrop and no top layer; only `showModal()` reaches the real one. `WireOverlay` syncs
  the knob into the element.
- **The platform dismisses without telling React.** Escape closes a `<dialog>` directly, so
  the knob would say open while the screen said shut. `WireOverlay` writes the close back.
- **Tailwind's preflight deletes the centring.** `margin: 0` on every element overwrites the
  UA stylesheet's `margin: auto`, and the dialog opens against the top-left corner with the
  backdrop painting correctly.
- **Native controls hide their state from the tool.** A `<select>` keeps its value and a
  checkbox its checked-ness as DOM *properties*, which a DOM walk cannot read — so
  `atelier check` reports the knob as moving nothing and `atelier read` cannot say what it
  is set to. `WirePicker` and `WireCheck` reflect it into an attribute.
- **A tag rule outranks a utility.** A `.wire label` rule would beat Tailwind's `.block` on
  specificity, silently turning every labelled field inline and reflowing the form.
  `WireField` owns its markup so the collision cannot happen.

## `WireDevice` is not the viewport

The chrome already renders a design at 390 in a real iframe, where media queries fire
honestly, and that is the right instrument for *is this right on a phone*. `WireDevice` is
for drawing a phone and a desktop **side by side on one page**, where the comparison is the
point.

## What a wireframe round does not do

- It does not answer a treatment question. Two wireframes differing in colour is two
  identical wireframes.
- It does not replace `specimens`. Every state one part survives is still an inventory.
- It does not descend into an implementation. `.atelier/` is scratch; a wireframe is further
  from shippable than an ordinary design, not closer.
- **It does not draw arrows between screens, and it is not going to.** Every wireframing tool
  ships flow lines because a Balsamiq screen cannot be clicked — the arrow is a drawn claim
  standing in for behaviour the artifact cannot perform. These designs perform it: the flow
  is a knob, and `atelier shot --sweep step.value=a,b,c` puts the whole of it on one labelled
  sheet, generated from the design rather than drawn beside it. A hand-drawn edge is a claim
  nothing verifies, and it lies silently the day the design moves.
- **And a round is not a sequence.** `docs/terms.md`: a design is *what you choose between*.
  Three designs as three screens of a flow is the wrong unit — a flow belongs inside one
  design, as a knob. That is the reason arrows would do harm rather than merely cost
  something: the vocabulary would quietly invite the misuse.
