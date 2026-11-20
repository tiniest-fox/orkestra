# The catalogue

Every component the repo already declares, with knobs derived from its props types. A
study is where you decide something; the catalogue is where you look at what exists.

**Nothing is generated and nothing is written.** There is no list of components anywhere,
because a catalogue that names its entries is a catalogue somebody has to maintain. It is
resolved when asked, from the types, by the host's own TypeScript.

Turn it on with a `catalogue` key in `.atelier/atelier.config.json` naming the paths to
walk. That is the whole setup; a repo without the key has no catalogue, which is the
default and not an error.

## The states an entry can be in

Four, and telling them apart is most of what this file is for.

| | known | what it means | what fixes it |
|---|---|---|---|
| **derived** | from the type | every prop resolved to a knob | — |
| **blocked** | from the type | a required prop no type can describe | a fixture, or a preview |
| **broken** | only by rendering | it threw | usually a wrapper |
| **skipped** | from the type | it declares no props at all | nothing — it is a page |

**Blocked is not an error and must not be drawn as one.** Nothing failed: the props type
asked for a domain object and a type cannot say what one looks like. The component is
waiting on a person, and mounting it to watch it throw would turn a missing value into a
stack trace.

**Broken is the one you cannot see coming.** No static signal separates a hook that needs
a provider from one that does not, so an entry whose props all resolve can still throw. Be
careful what you claim on the strength of a walk that has not drawn anything: *not blocked*
is what the derivation knows, and *renders* is a different sentence.

## Fixtures — a value, matched to a prop by its type

A `*.fixtures.ts` file exports named values. Each one becomes an option on a knob for
every prop it fits, and *fits* means **assignable**, not similarly named.

That is the whole reason this beats a preview per component. A preview supplies one frozen
value; a set of fixtures becomes a control, so the state union at the middle of a domain
object turns into something you can sweep on every component that takes one.

- **They must sit inside the host's TypeScript project.** A fixture the checker cannot see
  has no type, and a value with no type matches nothing. That is the only constraint on
  where they live, so put them where the repo would naturally put them.
- **Export names are the UI.** They are the option labels in the panel, they go into saved
  state and into a link. `t1` and `t2` are a working fixture set and a useless panel.
- **The filename is for you.** Matching ignores it, so organise into one file or twenty. It
  surfaces only when two files export the same name and one of them has to be told apart.
- **An array prop offers `ALL`, `NONE`, and each fixture on its own.** A list drawn with
  one row is a picture of the wrong thing, and one row is exactly what you want when the
  question is how a row looks. `NONE` is the empty array, which is not the same as the ∅
  square — ∅ declines to send an optional prop, where an empty array is a value a
  *required* prop can take and the state a component with a sub-list is usually in. The
  two are upper-case because every other option is a name you exported and these are not;
  a fixture that claims either name takes it back.
- **A factory does not match, and should not.** `(running: boolean) => Trak` is not
  assignable to `Trak`, so it is ignored without a special case — and a knob needs a value
  it can name, not a function it would have to call.

A fixture may compute — deriving one from a recorded transcript through the host's own
mapper gives you the shape the app really produces — but it must **export values, not
factories.**

**A preview still wins where it exists**, and the two answer different questions: a preview
is one component's arrangement, a fixture is one type's values. Use a preview for the prop
only one component has.

## The wrapper — context every entry renders inside

A host whose components read a router or a query client needs one, and without it every
entry that touches one throws for a reason nothing on screen would explain.

Name it under `catalogue` in the config. **Declared, not discovered**, which is the
opposite of how fixtures are found and for a reason worth keeping: fixtures are many and
scattered, so a convention is the only thing that scales, while there is exactly one
wrapper and it is app-wide — so naming it costs a line, removes every ambiguity a search
would introduce, and lets you see from the config whether one exists at all.

It takes `{ children }` and returns them wrapped. Two rules:

- **It supplies context and draws nothing.** Every entry renders inside it, so anything
  visible reframes all of them at once, and showing a component unadorned is the point.
  The trap is specific and everyone walks into it: reaching for the app's real router means
  reaching for its root route, which is usually the app's chrome. Build a throwaway route
  whose component is the children instead, and give it a memory history so a link resolves
  without navigating away from the thing you are looking at.
- **It is the catalogue's, never a round's.** A round is a frozen snapshot, and wrapping an
  old one in today's providers would change what it draws without anyone touching it. A
  round that needs context imports it — see `existing-code.md`, "When the host needs
  providers to render at all".

Mirror the host's own test setup where it has one. It has already decided what a component
needs in order to mount, and disagreeing with it means the catalogue and the tests are
rendering two different applications.

## What it will not tell you

**A misnamed fixture file fails silently.** Nothing is looking for `traks.fixture.ts`, so
it is not an error, it is an absence — the component simply stays blocked as though you had
never written it. `atelier catalogue list` reports what was found, and zero is the answer
worth checking first.

**A fixture that matches more than you meant is invisible too.** Assignability is exact but
it is structural, so a loosely typed value can fit props you were not thinking about. The
knob names the file its options came from; that is the thing to read when an option turns
up somewhere surprising.

Changes to the host's own source — a new fixture, a new component, a changed props type —
are picked up while the server runs, so the catalogue does not need restarting to notice
them.
