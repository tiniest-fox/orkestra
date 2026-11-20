# Existing code in a round

Read this when the study touches code that already exists — a component you are
changing, a screen you want to see your change inside of, a host that needs providers to
mount at all. A greenfield page needs none of it.

`adopt` freezes a copy you can open up; `inject` splices into a live host. The two
compose, and the strongest closed-space round uses both.

## Where the code comes from, and how it gets in

Never recreate a component from memory. A mockup of a component nobody has looked at
lately is a mockup of the wrong component, and it costs a rebuild to find out.

Two questions, and they are not the same one. Answer both:

|  | |
|---|---|
| **Where does the code I am changing come from?** | `adopt` — a frozen copy you can open up · or write it fresh |
| **How does it reach the composition?** | `inject` — spliced into a live host · or `adopt` the host as well |

The strongest closed-space round takes one from each column: adopt the leaf so you can
hang knobs on it, inject it into the live host so you see it in context.

```
atelier adopt src/ui/Button.tsx          # _button.tsx — yours to change
atelier inject src/ui/Button.tsx src/ui/Card.tsx
```

**The subject — the thing you are changing — is adopted.** You cannot add a knob to
something you imported, so it has to be a copy you can open up:

```
atelier adopt src/ui/Button.tsx src/ui/tokens.ts
```

Each file lands in the round as `_button.tsx`, `_tokens.ts`, with the relative imports
*between them* repointed at the copies. Everything else the copies import is repointed
at the **real file** — through the alias when the config covers it, and as a relative
path out of the round when it does not, which works and says so. Bare specifiers are
untouched. `_`-prefixed files are never treated as designs, so an adopted file is a
sibling your designs import.

The command prints both lists — what became a copy, and what stayed live — so the split
is visible at the moment you make it. If something on the live list should have been
frozen, adopt it too and run it again.

It is precise because it is the real file, and frozen because it is a copy — which is
what a round is for. Adopting before writing anything is a good way to start a
closed-space round: bring the subject in, then design around it.

**The neighbours — things you would never edit in a mockup — are imported live**, via
`.atelier/atelier.config.json`:

```json
{ "alias": { "@": "src" }, "css": ["src/index.css"] }
```

Two cautions, and they are not the same size:

- `alias` is opt-in per import — no round resolves differently unless it uses one.
  It does one thing beyond resolving: the directories it names are added to what
  Tailwind scans, which is what makes classes written in live host code exist at all
  (below). That is additive, so it can give a finished round utilities it was missing;
  it cannot take any away. Injection is inert in the same way — the machinery does
  nothing until a design calls `inject()`.
- **`css` applies to every round in the repo, including finished ones.** Adding a
  stylesheet here silently changes how months-old mockups render, which is the one thing
  a round is supposed to be safe from. Add it when the host's tokens genuinely are the
  subject's context, and know that you are re-styling the archive when you do.

**However the host styles itself, it comes through.** Worth knowing which route each
takes, because only one of them needs anything from you:

| the host uses | how it reaches the round |
|---|---|
| a **global stylesheet** | `atelier adopt` follows a component's own `import './x.css'` and any `@import` under it, so an adopted component keeps its look without being asked. A live one carries its stylesheet through the import graph. |
| **CSS modules** | The same path — `Tab.module.css` is adopted alongside `Tab.tsx`, and a live component brings its own. A replacement that wants the original's look imports the module and uses its keys. |
| **Tailwind** | Nothing to do for classes written in the round. For classes written in *host* files the round imports live, see below — Tailwind never follows imports, so those need the `alias` config. |

**Tailwind finds classes by scanning files, and it does not follow imports.** What gets
scanned is the round, plus every directory the `alias` config points at. So a class name
that lives in a host file — the usual case being a lookup table like
`const tone = { good: 'text-green-600 bg-green-50', … }`, which is what a design system
does to keep whole class names literal — produces **nothing at all** unless an alias
covers the directory it is in. Nothing warns you. The design renders with the layout
right and the colour missing.

Setting an alias for the code you import live is therefore not only about readable
import lines; it is what makes that code's classes exist.

**A custom Tailwind theme needs the `css` key, and only the `css` key.** `bg-brand-600`
is defined by `@theme` in the host's own stylesheet, and a design that imports that
stylesheet itself:

```tsx
import '@/styles/tokens.css'   /* not enough on its own */
```

gets a *second, separate* Tailwind — one that has the theme but has never heard of the
round, so it emits the variables and no utilities. The symptom is the confusing one:
the tokens are all there in the inspector and every utility using them is missing. Put
the stylesheet in `css` instead, which pulls it into the round's own Tailwind, and the
theme and the scan are in the same place.

`atelier adopt <stylesheet>` stays reserved for a round frozen on purpose — a round
rendering live components against a stylesheet copied months ago is the worst of both,
because the components move and their styles do not.

## When the host needs providers to render at all

A real screen usually cannot be rendered on its own. It reads a query client, or a
router, or both, and rendering it bare throws. Nothing in the harness supplies any of
that, and nothing should: what a screen needs to exist is the host's own composition,
already written down in its entry point.

**Do not reconstruct it from memory — `atelier adopt src/main.tsx` and open the copy
up.** Delete the `createRoot` and export what is left. It is the same argument adopt
always makes: precise because it is the real file.

Then keep it in one file at the root of `.atelier/`, shared by every round, and reach
it by alias so no design counts directory levels back to it:

```json
{ "alias": { "@app": "src", "@atelier": ".atelier" } }
```

```tsx
import { App, serve } from '@atelier/live'
```

Three rules, each of which cost something to learn:

- **Share the plumbing, freeze the fixtures.** The wrapper is context and should drift
  with the app; the data is the argument and belongs to the round. A shared wrapper is
  referenced rather than applied, so a round that does not import it is untouched —
  which is what keeps this on the right side of the `alias`/`css` line above.
- **Mock the wire, not the hook.** Stub `fetch` and let the host's real client decode
  the response. A hook stubbed instead will happily render a state the server cannot
  produce — a real round argued for weeks about a status string the wire did not
  permit, and the decode is what eventually said so. Delegate every request you do not
  recognise, or Vite's own module traffic goes down with it.
- **Do not seed the query cache instead.** It looks equivalent and is not: a polling
  screen re-asks within seconds and starts truthfully reporting that the engine is
  unreachable. Answer the network and the seed is redundant anyway.

Mirror the host's own test setup where it has one — it has already decided what a page
needs in order to mount, and disagreeing with it means your mockup and its tests are
rendering two different applications.

**A round imports its wrapper; the catalogue is given one.** The difference is not
arbitrary. A round is written by hand and is a frozen snapshot, so it says what it needs
and one that says nothing keeps drawing what it always drew. The catalogue is derived and
covers everything the repo declares, so it has nobody to ask — see `catalogue.md`, "The
wrapper".

**A round built this way is alive, not archived.** It renders until the app moves far
enough and then it stops, and that is the trade for it having been accurate when it was
made. Nothing detects it — the old screenshot stays on disk, so the gallery keeps
showing a healthy picture of a design that no longer runs. Write the note while it is
still on screen.

## Changing something inside a live component

Adopting reaches upward badly. To see your button inside the real card you would have to
adopt the card, then whatever the card reaches through, all the way to the root — a round
full of copies of code nobody is designing, each one free to drift.

Inject instead. `atelier inject src/ui/Button.tsx src/ui/Card.tsx` seeds every design in
the round with the real `Card` imported live, `Button` imported *only for its identity*,
and a rule between them. Give it the host alone — `atelier inject src/ui/Card.tsx` — and
it seeds the additive shape instead, for a part that does not exist yet:

```tsx
export default function Design({ radius }: Props<typeof controls>) {
  inject([[Button, (p) => <Mine {...p} radius={radius} />]])
  return <Card title="Delete this workspace?">…</Card>
}
```

Every `Button` created anywhere below `Card` becomes yours — including in files `Card`
imports without naming, because the match is on the element as it is created, not on
anyone's import.

**`inject()` goes in the design's body, above the `return`.** That is what lets the
replacement close over the current knob values. The harness keeps the element type stable
across renders, so a slider updates the design instead of remounting it.

A rule is `[target, replacement, condition?]` and there is exactly one rule shape.
Adding is written the same way as replacing:

```tsx
inject([
  [Button, Pill],                                   // every Button
  [Button, Danger, text('Confirm')],                // the one that says Confirm
  [Button, Quiet, when((p) => p['ghost'])],         // matched on a prop
  [Card, around((el) => <Frame>{el}</Frame>)],      // a layer outside the card
  [Card, inside((tree) => append(tree, <Foot />))], // spliced into its own tree
])
```

Rules are tried in order and the first match wins, so **narrow rules go first** — an
unconditional rule above a conditional one swallows everything and the conditional one
never fires. Conditions compose with `all`, `any` and `not`. `inside` also has
`prepend`, `withStyle`, `insertBefore` and `replaceWhere(tree, m, (el, i) => …)` for when
you genuinely mean "the second one".

Four things to know, in the order they will bite you:

- **The replacement inherits the original's prop contract.** It receives exactly what the
  host was passing — spread the rest, keep the names, forward refs. Drop the spread and
  the host renders something plausible and wrong. This is the one failure here that
  nothing checks for you.
- **A rule that matches nothing fails the round.** `atelier shot` says which rule missed,
  lists what *was* rendered so you can see what to aim at instead, and writes no PNG. A
  picture of an injection that no-oped is a picture of the untouched host: it costs a full
  image to learn nothing and it reads as success.
- **`memo()` and HOCs are both reachable**, by different routes — a `memo` wrapper is
  seen through, and an HOC renders the wrapped component itself so the swap catches it one
  level down. A hand-rolled `<button>` in the host is not reachable, because it is a copy
  rather than a wrapper and nothing connects the two. Neither is anything inside a
  prebundled `node_modules` dependency.
- **Hooks in a replacement sit on the injection's own fiber**, so they must be
  unconditional and stable in count, and the replacement will not appear in DevTools. For
  the same reason a rule list must not change shape between renders.

## Four shapes this takes

**Restyle a part in place.** The commonest one, and what `atelier inject <target> <host>`
seeds:

```tsx
inject([[Button, (p) => <Mine {...p} radius={radius} />]])
return <Card title="Delete this workspace?">…</Card>
```

**Design something that does not exist yet.** A new footer for the card. There is nothing
to replace, so nothing to target by identity — you splice into the host's own tree:

```tsx
inject([[Card, inside((tree) => append(tree, <MyFooter gap={gap} />))]])
return <Card title="Delete this workspace?">…</Card>
```

`atelier inject src/ui/Card.tsx` — the host alone, no target — seeds exactly this. It is
the strongest case for injecting over adopting: a new footer is right or wrong *against
the real card*, and a card you recreated from memory cannot tell you which. `around`
instead of `inside` when the new part belongs outside the host, like an overlay or a
ribbon.

**Adopt the leaf, inject the copy.** When the thing you are changing needs to be opened
up — knobs on its internals, not just its API:

```
atelier adopt src/ui/Button.tsx
```
```tsx
import { Button } from '@/ui/button'       // the live one, for its identity
import { Button as Base } from './_button' // the copy, yours to change

inject([[Button, (p) => <Base {...p} pad={pad} />]])
```

**Compare placement rather than treatment.** When the question is *where* the new part
goes, each design puts the same component somewhere different — and the round is the
comparison:

```tsx
// header.tsx
inject([[Card, inside((tree) => prepend(tree, <Note />))]])
// footer.tsx
inject([[Card, inside((tree) => append(tree, <Note />))]])
// beside.tsx
inject([[Card, inside((tree) => insertBefore(tree, CardActions, <Note />))]])
```

Put `Note` in `shared.tsx` so the designs differ in placement and nothing else. This is
the shape a component explorer cannot do at all, and it is worth reaching for.

---

**Adopt the *host* only when the host itself is the subject.** You cannot splice a change
to the card's own layout — for that you need the file open.

## Leave seams where you will want to design

Both halves of this grip the same thing: **a component**. `inject` matches on component
identity, and `adopt`'s unit is a file. Markup inlined in a parent — a `<button>` built
inside a `.map()`, a header assembled in the page that renders it — is neither. You cannot
target it, and the smallest thing you can copy is whatever slab it lives in.

That is a real difference in what a round costs. A tab rail whose tab was eleven lines of
inline JSX made "restyle the tab" mean adopting the whole rail, editing a copy, and
looking at it outside the header it belongs to. Pulled out as `Tab.tsx`, the same round
adopts eleven lines and injects them into the live rail, inside the live header, with the
real canvas underneath — and the only file the round owns is the one being designed.

**Not every span.** The line is *would I want to hold this still while I change that* — the
thing you would swap, restyle or replace on its own. A cell in a toolbar, a row in a list,
a tab: yes. Its label element: no. Decomposing past that buys nothing and costs the
indirection.

Act on it at step 5, when you implement the design that won. That is the moment the seam
is cheap: you are already editing the file, you have just spent a round discovering which
piece was the subject, and extracting it is what makes the *next* round about that piece a
small one. A codebase that has been designed against a few times ends up shaped like the
questions people ask of it.


## Rules

- **An injected design is not a specimen sheet.** It is one real screen with one thing
  changed, because the context is the entire reason to inject rather than adopt. The
  comparison lives across the designs, not inside one of them. `specimens.md` argues that
  a component design *is* a specimen sheet; this is that rule arriving at the same place
  from the other side, and injection is where the two part company.
- **`inject()` goes in the design body, not at module scope**, whenever the replacement
  uses a knob. Hooks inside a replacement must be unconditional, and the rule list must
  not change shape between renders.
- **An injection that never fires is a failure, not a subtlety.** It blocks the shot.
