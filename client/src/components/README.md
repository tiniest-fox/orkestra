# `components/` — the design system, as code

Shared presentational primitives. Every file here is the `presentational` kind in
`client-style`'s admission table: props, pure helpers and local-state hooks only — no
data hooks, no `api/`, no side effects. One component per file, default-exported.

**This directory is the one exception to "populated on second use".** That rule exists to
stop a `utils/` growing by accident, and it is the right rule for code that turns out to
be shared. A design system is the other thing: declared up front, and a primitive belongs
here because it is part of the vocabulary, not because two callers happened to want it.
`Button` does clear the second-feature bar. The test to apply is _is this in the vocabulary_, not _how many callers are there_ — and
if the answer is no, the component belongs in its feature.

**This file records what to build, the reasons a reader needs to keep it that way, and
what is still open.**

## The system

Tokens live in `client/src/styles.css` and nowhere else. A component needing a value the
file does not name adds a token; it never reaches for an arbitrary utility.

|           |                                                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------------- |
| type      | IBM Plex Sans + Plex Mono · `--text-xs/sm/base/lg` at 10 / 11 / 13 / 16                                        |
|           | `--text-code` at 24, for a host's six-digit pairing code alone                                                 |
|           | **mono renders one step below the step it sits at** — a rule, not a token                                      |
| colour    | canvas `#faf8fc` · surface `#ffffff` · surface-2 `#efeaf5` · fg `#120f18` · muted `#443c54` · subtle `#564d68` |
| accent    | `#c2184a`, lifted 42% in dark → `#dc7996`                                                                      |
| tones     | five values; fills derived at 15% (20% in dark), never authored                                                |
| sources   | two — human `#4338ca`, machine `#0e7490`. _Who did this_, not how it is going. **Never inside a plate**        |
| border    | derived from `muted` at 7.5%. **Never a grey** — every neutral here is violet by construction                  |
| radius    | surface 6 · control 4 · chip is a pill · a field takes the control radius, like a button                       |
| elevation | `--shadow-menu` and `--shadow-modal`, each carrying a light and a dark value                                   |
| hover     | the accent as an **alpha fill**, so it composites over whatever ground is beneath: row 3%, bare 14% (dark +2)  |

**Surfaces follow one rule, and it is the thing to read before drawing anything new:**

| mechanism           | means                                              |
| ------------------- | -------------------------------------------------- |
| edge                | a distinct region, level with its neighbours       |
| shade (`surface-2`) | recessed — inside and subordinate to its container |
| shadow              | above the page, and temporarily                    |

A bar takes an edge. A field takes an edge. A menu is nearer than a modal, and a modal
sits behind a wash.

**A large surface takes `canvas`, not `surface-2`.** The shade token is tuned for a small
recess — a field, the chip inside a button — and under a whole pane it reads far too dark.
There is no in-between token: measured, an in-between value sits within 1.5% of `canvas`,
and what lifts a card off its ground is its edge rather than two points of luminance.

## Layering

Every z-index in `client/src` sits on one of four rungs, or is the one named exemption at
the foot of this section. There are no named tokens for them on purpose: prose here, plain
numbers at the sites, and the sites carry their own reasons.

| rung | what sits there                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10   | raised inside its own surface — a row's control over the full-row click overlay (`Row`), a card's pinned header over the body scrolling under it (`trak-detail/cards/CardShell`), a panel over the thing it hangs off (`OverflowMenu`, `trak-detail/finished/acts/FinishedActs`, the breakdown the chat bar's context line opens, with the line's press over the spend row, in `trak-detail/tokens/ContextLine`), the rail over the pane it slides beside (`Rail`), a working strip over a card's corner (`trak-detail/pull-request/PullRequestPane`), the login field over the strip that drops out from behind it (whose `z-0` is the ground a raised sibling starts hidden behind, not a rung) |
| 20   | a band the content passes under — the list's bar (`AppBar`), the dock (`traks-list/Dock`), every screen's header (`ScreenHeader`) and the piece band (`trak-detail/PieceBand`), the finished pane's press band over the card scrolling under it (`trak-detail/finished/acts/FinishedFoot`)                                                                                                                                                                                                                                                                                                                                                                                                        |
| 30   | the drawer (`Drawer`), over the bands and everything on them, and the desktop git strip beside it (`traks-list/git/GitStrip`) — the drawer stops at its top edge, and it comes after the drawer in the tree so its card, its notice and its menu open over the drawer's foot — and the desk's Files panel (`files/FilesPanel`), after both                                                                                                                                                                                                                                                                                                                                                        |
| 40   | over the whole window — the picture, the sheets (`Lightbox`, `trak-detail/changes/ChangeSheet`, `trak-detail/chat-bar/RecomposeSheet`, `Sheet`, `ConfirmSheet`), the ⌘K palette (`palette/Palette`) and a file on a phone (`files/PhoneFile`)                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

**Rank the band, never the panel.** A popover or overlay stays in the tree of whatever
opened it — no portal and no overlay root, because dismissal reads DOM containment
(`OverflowMenu`) and `Lightbox` says what a portal would cost — so a panel clears its
surroundings by its host's rank, not by a number of its own. A panel losing to chrome it
is not inside cannot be fixed by raising the panel: two rung-10 things in different
surfaces meet at equal rank and tree order decides, which is how a card's pinned header
once drew over the header's open picker. Put the host band on rung 20 instead.

**The one exemption is a sealed run.** `trak-detail/changes/ChangeTree` computes `30 - depth` so
a parent's sticky header draws over its child's, and `ChangeSheet` seals that whole run
behind `isolate` — none of those numbers ever meets the ladder, and renumbering them onto
rungs would invert the tree.

## Button

The one component whose API is settled in advance.

```tsx
<Button
  variant="primary" | "quiet" | "ghost" | "danger"   // four; there is no fifth
  size="sm" | "md" | "lg"
  icon={Plus}            // leading — a lucide component, not a name
  trailing={ChevronRight}
  kbd="⌘N"               // a shortcut chip, inset in the button
  busy block
  onClick={…}            // a button: it does something
/>

<Button to="/traks/$id" params={{ id }} size="sm">
  Review                 {/* a link: it goes somewhere */}
</Button>

<Button href="https://github.com/apps/…" variant="quiet" trailing={ExternalLink}>
  Install the GitHub App {/* another site, in a new tab */}
</Button>

<Button variant="ghost" size="md" icon={X} aria-label="Close" />   {/* a square */}
```

**One component, three elements.** Pass `to` and it renders the router's `Link`; pass
`href` and it renders an `<a>` to another site, opened in a new tab with `noreferrer`;
pass neither and it renders a `<button>`. The appearance is identical because the difference is not
visual — it is semantics, focus order, middle-click and bookmarking. It wraps the router's
`Link` rather than a bare `<a href>`, so `to` and `params` stay checked against the route
tree — which is why `href` is for a page off the app and never an in-app path.

- **`quiet` is white and takes an accent edge on hover at 60%**, not a background tint —
  it already has a plate, and tinting moves a surface that was never meant to move.
- **`ghost` has no resting surface**, so its hover builds one: the 14% `bare` tint.
- **`danger` is Ink · red at 42%** — the darkest thing in the palette with `tone-bad`
  mixed in. Weight rather than hue, which is what keeps it off the accent.
- **The `kbd` chip is a recess inside the button** — a plate, no border, `surface-2` on a
  light button and the label's own colour at 22% on a filled one.
- **`ref` reaches the `<button>`, and is the only prop here that is not about appearance.**
  `ButtonHTMLAttributes` carries none, so it is declared on the button half. `Confirmation`
  is the caller: it needs the node to move focus onto its own press. Without it, a component
  wanting the element writes its own `<button>` and leaves the system.
- **An icon with nothing beside it is a square, inferred rather than asked for.** No
  `iconOnly` prop: a glyph with no children, no `kbd` and no trailing glyph already says so,
  and a flag beside those three is a second way to say one thing that can disagree with it.
  The box goes square at the size's own height, the padding and the gap go, and the glyph is
  drawn a step heavier — alone it is the whole of what the control says. **It takes an
  `aria-label`**, because everything inside is `aria-hidden` and nothing else can name it.

**Ink · red is what a destructive button looks like; it is not permission to place one
beside the primary action.** Prefer destructive actions isolated, or in a dropdown, in
secondary positions.

## EmptyState

A region with nothing in it, saying why.

```tsx
<EmptyState loading />                              {/* first load */}
<EmptyState shape="blocks" tone="bad" icon={Unplug} title="Could not load this trak">
  {error.message}
</EmptyState>
```

- **Three of the four view states, and not the fourth.** First load, empty, and failure
  with no data are this. A refetch that failed with data still on screen is a one-line
  strip at the call site — the rows are still true, so nothing may cover them or push
  them down, and there is no shell that can hold that.
- **It draws the shape of what is missing** (`Skeleton`), so the region keeps the
  proportions it will have and the page does not redraw between "asking" and "there is
  nothing". `shape` picks the drawing and the gutter with it: `rows` for the list,
  `blocks` for the drawer's pane, and `checks` and `threads` for the two sections of the
  finished card whose rows are still coming. A further shape belongs in `Skeleton`, never
  at a call site.
- **The graphic is the only thing carrying the tone.** Title and sentence stay in the
  text colours; `role="alert"` is what reports a failure, not the red.
- **A stated band always has a sentence under its heading**, so `children` is required.
  A command keeps its place under the sentence.
- **Two frames move: the first load and `tone="working"`**, because on those two
  something is coming. A segment runs the band's top rule and the working glyph turns;
  under `motion-reduce` both park rather than vanish. The still frames gain none of it.
- **The action is a slot** and this component never knows what a button does. `NothingOpen`
  passes a `New Trak` link to the form, the same one the app bar's goes to; nothing passed
  here spends by itself, and whether a control that would belongs in the slot is the call
  site's decision rather than this shell's.
- **`under` is a second slot, below the presses, at the band's full width** — what a
  failed start printed, in the desktop rail's pane. The sentence keeps its own measure.
- **A region is this; a section inside a populated view is `EmptySection`.** Below.

## EmptySection

A section with nothing in it, inside a view whose other sections are full.

```tsx
<EmptySection shape="decisions">Nothing decided yet.</EmptySection>
```

- **`EmptyState`'s sibling, not its small size.** The shell may take a whole region
  because nothing else there is true. A section's neighbours _are_ still true, so it can
  take neither the room, nor the graphic, nor an action — and a direction that wanted one
  is the tell that the absence should have been a region.
- **What is left is the shape.** The sentence stands where the first entry would, over
  `Skeleton`'s ghosts of the entries after it, so the section keeps its proportions and
  the pane does not re-flow when the first one arrives. `shape` picks the ghosts and the
  mark beside the sentence with them.
- **The sentence is metadata, not prose** — the section talking about itself. At body
  size it competes with the entries it is standing in for.
- **The section's own note goes away while it is empty.** A note describing how to read a
  list, above a sentence saying there is no list, is two grey sentences where one
  answers. That is the call site's job, not this component's.
- **Rejected: a small plate** with a glyph and a slot. It repeats badly — two of them read
  as two notices rather than as two quiet absences.

## Field

```tsx
<Field id value onChange onKeyDown placeholder rows={1} disabled autoFocus label="…" />
```

- **A region, not a recess** — an edge on the surface, the mechanism a bar takes.
  Recessing says _inside and subordinate to its container_, which is true of the chip
  inside a button and false of the thing the whole screen is waiting for.
- **`rounded-control`, the same radius a button takes** — one radius at every call site,
  without a shape prop, because a primitive with two radii is one the next caller has to
  choose between. **Never a pill on a control that grows**: a pill is one shape and the
  things a field holds are not, so `rounded-pill` on a field holding three lines is a
  lozenge with the curve running through the first and last of them, and half the
  one-line height only avoids that by being a number kept in step with a height. Radius is
  therefore not one of the things separating a field from a quiet button — see _Decided
  since_.
- **A `textarea`, always.** What goes in one of these is a sentence to an agent, and a
  control that cannot show the second line of what you typed makes you write less than
  you meant to. `rows` sets a `minHeight` from the type scale rather than the attribute,
  which counts lines in whatever font the browser picked.
- **It grows with what is in it; `rows` is the floor.** Measured in layout, not in an
  effect — a frame painted at the old height is a visible jump on every keystroke that
  wraps. The resize grip goes with it: a handle that fights the height the content just
  set is a control arguing with itself. **The growth is capped**, because a bar is
  `shrink-0` in a column with whatever it sits under, and a pasted essay would otherwise
  grow the field until there was no pane left. **It re-measures on its own width as well
  as on its value**, through a `ResizeObserver` on the node it already holds — typing is
  not the only way a field gains a line, and a height measured at the old width is a
  scrollbar on a control whose whole claim is that it does not need one.
- **It says nothing about the wheel at all, and that is the decision.** It carried
  `overscroll-contain`, which was a dead spot: `contain` latches a gesture to the box under
  the cursor whether or not that box can scroll, and a field is always exactly the height of
  what is in it — so that was every one of them, and a question card with four answers is
  mostly field. Making it conditional on being capped is the wrong repair and shipped once:
  what catches the gesture a field hands on depends on where the field is, and the call sites
  do not agree — three sit inside the drawer's scrolling pane and the two chat bars are that
  pane's siblings, so an uncontained chat field scrolled the trak list behind the drawer.
  `Drawer` draws the boundary instead.
- **It borrows `Button`'s focus treatment, at offset 0 rather than 2.** Same width, same
  colour, on the border instead of standing off it: a ring two pixels outside a pill that
  runs the whole measure reads as a second edge floating around the first, where the same
  ring around an intrinsic-width button reads as a ring. Not a second answer to open
  question 1 — the same answer, placed.
- **`bare` hands the edge, the ground and the ring to a box around it**, and `ChatBar` is
  the one caller. _A region, not a recess_ survives it: the box is the region, and it holds
  exactly one control. Everywhere the field stands alone it keeps its own edge.

## ChatBar

```tsx
<ChatBar
  id="trak-chat"
  label="Say something to the agent"
  value={draft}
  onChange={setDraft}
  onSend={send}
  placeholder="Say something to the agent…"
  busy={isPending}
  disabled={disabled}
  said={said}
  sendLabel="Send"
/>
```

The band at the foot of a drawer, used by both `new-trak` and `trak-detail` so the two
never draw two copies of one control. **On the pane's own ground, not a band of its
own** — `bg-canvas`, no edge — because it is the last turn of the conversation, the one
not sent yet, and the send button sits _beside_ the field rather than under it: the field
grows with what you type, and anything below it would move while you were writing.

**One box, and what is inside it is the message.** The field is `bare` and the send sits
inside its edge, at the end. Attached files are part of the message, so the paperclip, the
tiles and the refusal for a file sit inside the box too, and the box's edge is the drop
outline (`ChatBox`). A press that acts on the trak rather than on the message goes
`beside`, on the bar's own ground. `control` is the send changing its meaning, never a
second one: the trak's stop while a turn runs, because the stop _is_ the send transformed.

- **Primitives, not a feature's hook.** `components/` may not import a feature's type,
  so `Chat` and the New Trak drawer's own state both flatten to `value`/`onChange`/
  `onSend` at the call site.
- **Two closings, and neither is this file's call.** _Why_ a bar is shut (`disabled`) and
  _what a shut field says about itself_ (`placeholder`) are each caller's own words —
  `trak-detail`'s `chatClosed` and the New Trak drawer's blank guard.
- **`sendDisabled` refuses the send and leaves the field open.** A disabled textarea is a
  blurred one, so a refusal that can come and go while somebody types — `trak-detail`'s
  custody, for the frame a drive lets go at a gate — goes here rather than in `disabled`.
- **`sendLabel` names the button**, because the screens ask different questions of the
  same press — `Send`, `Start trak` and `Start chat`.
- **`below` and `foot` carry the step's usage, and New Trak passes neither.** Both run
  under the box and `beside` alike, so a press coming or going never changes their width,
  and `beside` stays level with the box: `below` sits under it, and `foot` in the bar's
  bottom padding, on the home indicator's inset rather than under it. `trak-detail`'s spend
  row and context line fill them.
- **`attach` is `useAttachments`' answer, and its absence draws no paperclip.** The trak
  and goal bars and the New Trak and New Goal pages pass one; New Chat does not. The send
  stays shut, Enter included, while any file is still uploading.
- **`beside` is a slot and its presses collapse rather than unmount.** `trak-detail`'s
  `Reveal` animates a grid column `1fr → 0fr` with `min-w-0 overflow-hidden` inside —
  never a `max-width` to a number, which is wrong below the breakpoint where a square press
  is 44 rather than 36 — and the gap between presses is a margin on the collapsing wrapper,
  because a flex `gap` keeps room for a child at zero width.

## Markdown

```tsx
<div className="text-fg-muted">
  <Markdown>{section.body}</Markdown>
</div>
```

**Every string an agent writes is markdown**, and the pane drew all of them as
`whitespace-pre-wrap` — right about the newlines and wrong about everything else. A table
of options read as a paragraph of pipes.

- **Elements, never an HTML string.** `react-markdown` builds React elements, so markup in
  an agent's text is escaped rather than parsed and then cleaned up. Nothing here uses
  `dangerouslySetInnerHTML`, and nothing should: the input comes from a model.
- **The ink is the caller's.** No mapping sets a text colour, so a block inherits the `fg`
  / `fg-muted` / `fg-subtle` it stands in. What the mappings set is structure — weight,
  rules, gutters, the fill on a code span.
- **One mapping per element, and that list is the vocabulary.** An element with no entry
  renders with the browser's own styling, which against these tokens reads as a bug. Add
  the mapping rather than a `.markdown p` stylesheet, which would be a second place
  appearance is decided.
- **Where there is no room for a block, flatten instead** — `format/markdown.ts`'s
  `plainText`. A collapsed section's summary is one truncating line and an option's
  description is inline beside its label, and the raw string would show either reader
  punctuation instead of the sentence.
- **`img` is the one mapping that makes a request**, so it is the one with a rule rather
  than a class list: a remote or `data:` src would make any pane a beacon reporting when a
  person read the trak, from text a model produced. It draws only a path inside that trak's
  own checkout, and only where a page has said which trak that is — `MarkdownImages`, whose
  absence is the default and draws every image as its alt text. A file that is no longer
  there falls back the same way; a shot dies with its checkout, and the broken-image icon is
  the failure the route exists to remove.
- **A picture that drew is a press, and one that came out as words is not.** A shot is
  written at a width the pane cannot show, so pressing it opens it whole in a `Lightbox`.
  The button is bare — no plate, no edge, the picture itself is the affordance — and it
  exists only in the branch that draws an `<img>`, so every fallback above has nothing to
  press by construction rather than by a check.
- **Every block that is not prose is a figure, in one `Figure`**: a 1px `guide` line all
  round at the control radius on `canvas`, a 9px-caps header band on `surface` naming it,
  and a footer in the same type. Markdown spaces its blocks 12px apart and a figure takes
  6px more each side. It is drawn wherever markdown is — a message as much as a filed document.
- **A ``diff fence draws as the Changes tab draws a change** — `DiffBlock`: the ground
carries it, an added row washed green and a removed one red, the sign in a sticky column
of its own. No line numbers, because nothing knows them; lines scroll rather than wrap; a
`@@` row is a band with rules. Not shiki's `diff` grammar, whose added-line green fails
4.5:1. The sign is real text: neither
`aria-hidden` nor `select-none`, unlike `ChangeHunk`'s gutter, because here it is the only
thing besides colour that says added or removed. **The text is coloured where the fence
names its language after the word** — ``diff ts — and left in the ink it stands in where
  it does not, since a diff names no file.
- **A fence labelled with a language `format/grammar` names draws coloured** —
  `CodeBlock`, in a figure named for the language, through the highlighter the Changes tab
  already loads. Unlabelled stays grey on purpose, in a figure named `output`: the corpus
  of those is declarations, shell commands, output and prose mixed, and prose coloured as
  code is worse than prose left grey.
- **A ```pseudo fence draws in tiniestfox's rules-pseudo colouring** — `PseudoCode`, from
  `format/pseudo` and the `--color-syntax-*` palette. Inside a figure's panel — an
  overview's sketch — it stands in tiniestfox's dashed edge marked `pseudo`, so it is never
  read as code that runs.
- **A `decision`, `scope`, `criteria`, `files`, `runs` or `table` fence draws as a marked
  table** — `MarkedTable`, from what `format/markedTable` reads out of the fence; **so does
  a plain markdown table**, through `format/markdownTable`, unless a cell holds a link or a
  picture that table cannot draw, which keeps it a plain grid in the same frame. Nothing
  opens and nothing is clamped: every cell wraps to its full height and a row's detail is a
  column of its own. A
  fence under one of those labels that does not read draws as its source, so what shows is
  what the agent wrote.
- **A figure fence draws as its figure, and as its source where it does not read** —
  because the text is still what the agent wrote and what the next one reads. The overview,
  the walkthrough and the change map are one figure, `Navigator`: a 200px rail that picks
  one item (`NavigatorRail`, numbered by `RailNumber` where items are), and that item's
  content on `surface` beside it. It measures its tallest closed state once and holds that
  height, capped at 320px, while the reader picks or opens things, scrolling inside only as
  far as the picked item's own content, since a hidden one is folded to no height; under
  576px of its own width, measured on its own node, the rail stacks above, capped at 154px.
  The overview's and the change map's content is a `FileTree` — folders as rows, folded
  through `format/fileTree`, each file a `FileTreeRow` that opens inline where it has
  something to open.
- **An ```overview fence is `ArchitectureMap`** — the parts down the rail in call order,
  then the entries outside the plan under "Outside"; a file opens into its own sketch
  through `PseudoCode` in its dashed edge, and a part's whole-part sketch, the older form,
  draws once under its tree. `format/overview.ts` reads the fence.
- **A ```walkthrough fence is `Walkthrough`** — the chosen path's numbered steps down the
  rail, the paths as tabs in the header band where there is more than one, and the picked
  step's `WalkDiagram` — actors across the top, the picked hop lit, earlier hops faint,
  later ones not drawn — with its words under it; Back and Next are the footer.
  `format/walkthrough.ts` reads the fence; one that does not parse, or names more than five
  actors, draws as its source.
- **A ```changes fence is `ChangeMap`** — the buckets down the rail with their reasons, and
  the picked bucket's tree. On a step's page `MarkdownChanges` joins it to that step's
  diff: its commit once it has one, else the uncommitted work while the step is at its
  gate, running or failed, else none. The join adds line counts, a press that opens a
  file's lines inline (the paired gutter at a desk, the new side's alone when narrow), a
  warning on a path the diff lacks, and an Unexplained bucket — the last two withheld where
  the diff was capped. With no provider it draws what the agent wrote and a file opens
  nothing.
- **A ```mermaid fence is styled through mermaid's own theme, plus one stylesheet rule** —
  `MermaidBlock` and `hooks/useMermaid`: the `base` theme with its variables set to the
  tokens (surface nodes, guide box lines, accent edges and arrowheads, fg labels, Plex Sans
  at 11px, curved edges), every flowchart and state diagram turned left to right
  (`format/mermaid`), and the rule in `styles.css` that fills the state end dot with the
  accent. Too wide, it shrinks to 0.8 and then scrolls; narrower, it is centred. Redrawing
  mermaid's layout ourselves is not done.
- **A diagram opens the same view from a control in its header band**, not by being
  pressed. `MermaidBlock` keeps its sideways scroller, and in Chromium a scrollbar drag ends
  in a `click` on the ancestors — so a pressable block would open on every nudge of a wide
  diagram. The two shapes opening two ways is the cost of that. The control never sits over
  the drawing, which fills the figure's width once shrunk; on a phone the band grows to 44px
  to hold it rather than the press reaching past a band the figure clips.

## AnsiText

```tsx
<pre className="whitespace-pre-wrap font-mono text-xs text-fg-muted">
  <AnsiText text={check.output} />
</pre>
```

A string a process wrote, drawn as the terminal would have drawn it, checked against the
real bytes of stored check failures.

- **Spans and nothing else** — no box, no font, no ink of its own. It replaces the
  `{text}` in a caller's own element, so the caller keeps the whitespace rule, the
  measure and the size it already had. That is what lets one component serve a scrolling
  wall of check output and a one-line failure sentence with no variant between them.
- **Colour stays _meaning_** — passed, failed, careful, quiet — which the token file
  already names. A dark terminal plate inside the pane was the rejected alternative, as
  was collapsing hue to three greys.
- **An index outside the base sixteen is drawn as itself** rather than folded onto a tone.
  A box-drawing has no tone it means, and an answer for one index is a promise of 239 more
  that nobody could check.
- **`format/ansi.ts` is where the mapping and the contrast measurement behind `dim` are
  stated**, so a correction to either goes there and not here.

## ToolCall

```tsx
<ToolCall name={entry.name} detail={entry.detail} kind={entry.kind} />
```

One tool call as its two halves — the provider's own name, then what it acted on, as the
drawer's transcript rows draw it. The list row's activity slot names a run by its phrase
instead (`latestActivity` in `format/transcriptRows`) and takes only `QUIET` from here.

- **The detail truncates from whichever end is the throwaway one.** A path keeps its
  tail, a command its head — `keepsTail` in `format/activity` owns the decision per kind.
- **It stays inside whatever width the caller gives it**, at any name length: the detail
  gives way first and the name truncates once there is nothing left to give. So a 256px
  slot is as safe a caller as the drawer's line, which is not true of the two spans this
  replaced.
- **`Detail` and `QUIET` are the named exports** — the argument alone, for a caller
  drawing it under a heading that already said which tool (`trak-detail`'s opened runs),
  and the ink for an entry that is not a call at all, so no caller writes those classes
  out again.
- **No box, no size of its own beyond the type step** — it replaces the two spans a
  caller wrote by hand, inside whatever line or slot the caller owns.

## Drawer

```tsx
<Drawer label="Trak">…</Drawer>
```

A region over the list, with an edge and a shadow, full height and over the app bar too.
**No scrim** — the list stays visible and clickable beside it, so triaging one trak
against the next never costs a close. A drawer that dimmed what it covered would be saying
_finish with this first_.

**A wheel that starts anywhere inside it stops at its edge**, which is `overflow-hidden
overscroll-contain` on the column: no scrim is exactly what makes that a rule rather than a
nicety, since the list moving behind a drawer that did not is something the reader watches
happen. **It is here rather than on the controls** because where a control sits decides what
catches the gesture it hands on, and the ones in a drawer do not agree — the pane inside
catches everything drawn in it, and the chat bar beside the pane had nothing. A prop asking
each control which position it is in would be this one decision copied to every call site.

## ScreenHeader

```tsx
<ScreenHeader title={name} meta={[id, goal]} phone={phone} menu={ending} actions={presses} />
```

The one header a drawer screen draws: a title row — the way out, the title over one mono
metadata row, at most one `action` and at most one ghost `⋯` — and under it an actions row,
hung from the right, only where `actions` is given. **Every action is a 30px bordered
press** and the menu is a ghost `⋯` at that height; it places them and sizes none of them.
**No status chip and no state words in it**: the pane says what a thing is doing. **Once the
header itself is `@6xl` wide the actions row folds up into the title row** — a container
query on its own width, so the 440px column beside the side panel keeps two rows on any
screen — and being a container, it may hold nothing `fixed`.

## Lightbox

```tsx
<Lightbox label="the drawer" onClose={shut}>
  <img src={url} alt="the drawer" className="max-h-full max-w-full rounded-control" />
</Lightbox>
```

One thing shown whole over the window, on the wash. **The first surface here that covers
the screen, and the caller of `--color-scrim`** — the token was authored with the rest of
the elevation values and had none until this. `Drawer` refuses a wash on purpose; this
takes one, because something opened over everything is saying _finish with this first_.

- **A slot, not an image viewer.** It holds a picture and a rendered diagram from the first
  commit, so a `src` prop would already have been rewritten. What it owns is the wash, the
  centring and the ways out.
- **Whole and still** — no zoom, no pan, nothing to scroll inside it. A picture is capped at
  its own pixels, so a small proof shot is not blown into a blur; a diagram is line art with
  a viewBox and fills the window instead.
- **`fixed inset-0` at `z-40` in the caller's own tree, no portal.** Over the drawer's
  `z-30`. The price is that nothing in the chain above a caller may carry `transform`,
  `filter`, `backdrop-filter`, `will-change` or `contain` — any of those becomes the
  containing block and it draws inside the drawer instead.
- **It takes focus onto its own close control as it opens**, `Confirmation`'s exception for
  `Confirmation`'s reason: Escape is a handler on its own node, which a keystroke aimed at
  the document never reaches. Its own node carries `tabIndex={-1}` so that a press on the
  picture lands focus there rather than on `<body>`, which is where Chromium sends it when
  nothing above what was pressed is focusable — without it, Escape stopped working the
  moment you clicked the thing you had opened. **There is no focus trap** — Tab leaves for
  the page behind and takes Escape with it, and holding it in would need a document
  listener.
- **Putting focus back on whatever opened it is the caller's**, in its own `onClose`: the
  press belongs to the caller, and reaching for it from in here would be touching another
  component's DOM.
- **A press on the wash shuts it; a press on what it is showing does not.** A caller whose
  child should also shut it makes that child `pointer-events-none`, which is what the
  diagram does — a drawing scaled to fit letterboxes inside its own box, and every press on
  the dark margin would otherwise land on the SVG.

## OverflowMenu · MenuItem · Confirmation

```tsx
<OverflowMenu label="More options" onDismiss={() => setAsking(false)}>
  <MenuItem onClick={() => setAsking(true)}>Archive this trak</MenuItem>
</OverflowMenu>

<Confirmation heading="Archive this trak?" press="Archive" said={said} onCancel={…} onConfirm={…}>
  The checkout goes, and so does the branch — here and on GitHub.
</Confirmation>
```

The `⋯` and what it opens. This is open question 2 answered — the destructive guideline on
`Button` assumed one and there was none. Lifted out of `trak-detail`'s finished position,
which had the only copy.

- **The panel is a slot.** Items go in it, or a `Confirmation` in place of them, or a plain
  sentence at a state that has nothing to offer. A list-of-items prop would be this file
  guessing at a shape three callers disagree about.
- **A destructive press is two presses, and the second is not a typed sentence.**
  `Confirmation` is the panel's second state, at the same anchor and under the same shadow,
  so nothing moves and nothing is covered — which is what makes it affordable without a
  modal. Cancel first, both on one row, right-aligned: stacked, the destructive press is
  the biggest target in the panel. **A caller may also promote it out of a menu** into a
  `role="dialog"` wrapper of its own, which does cover what is behind and owns its own
  Escape — `trak-detail`'s Archive is the one, and the occlusion was drawn and accepted.
- **On a phone every confirmation is `ConfirmSheet`** instead — `Confirmation` laid out for
  a bottom sheet, on the wash, closed by Cancel, Escape or the wash. The caller picks it
  from `usePhone`. **A sheet asked from a band's `⋯` is drawn by the page, after the
  pane**: the item shuts the popover and reports what it asks. Mounted inside its band, the
  sheet ranks at the band's rung 20 and every later band at that rung paints over it —
  `FinishedFoot` over the header's Archive did.
- **`relative inline-flex` around the trigger, and the panel hangs off `top-full`.** A bare
  inline wrapper is one line-height tall rather than one button tall, so `top-full` drops
  the panel back over the row the trigger is in. The finished position never saw it because
  its trigger sits in a row of buttons its own height.
- **The body is unmounted while the panel is shut**, so state a caller keeps in there starts
  fresh each time. `onDismiss` is for the state that cannot live in there — which of two
  bodies a caller is showing, so a panel dismissed on a confirmation reopens at the item.
- **`MenuItem` is not a `Button`.** The four variants are all a control standing on a
  surface; an item is a full-width row of the panel — no plate, no edge, the `bare` hover
  tint. **`role="menuitemradio"` or `"menuitemcheckbox"` with `checked`** makes it one of a
  set; the check or the `Switch` that shows the state is `aria-hidden`, and `aria-checked`
  is what a screen reader reads.
- **The trigger is the `⋯` unless a `face` is given.** `trak-detail`'s run-mode picker is a
  readout that opens — the mode's mark, its name and a chevron on a `quiet` button — and it
  is the same group, panel and dismissal under a trigger with words on it. `label` stays the
  accessible name either way.
- **A caller that has to draw the trigger itself passes `trigger`** — a component given
  `open` and `toggle`, module-level or held with `useMemo` while what it draws is the same,
  so it is not remounted each render — and keeps the panel and the dismissal rules. The
  terminal control's pick half and the plan gate's agent and model pair are the cases:
  halves of a plate no `Button` draws. The button it draws owes its own `aria-label`,
  `aria-expanded` and `aria-haspopup`.
- **`under` hangs the panel from the caller's group rather than the trigger**, from its
  left edge: the wrapper drops its `relative`, so the caller's nearest positioned ancestor
  is what the panel hangs off. The plan gate's pair uses it so both halves open under the
  whole pair and stay on a phone.
- **No effect and no document listener in the menu.** Escape and focus leaving the group,
  both plain handlers on its own nodes. A click-anywhere dismissal needs `window`, which is
  a hook's business.
- **So the panel's body has to hold focus, and `Confirmation` takes it.** Escape is a
  handler on the group, which a keystroke aimed at the document never reaches — and the
  `MenuItem` that opens the confirmation unmounts as it does, which in Chromium leaves focus
  on `<body>`. `Confirmation` puts it on its own press, before paint, on mount and nowhere
  else: a ref and a layout effect, the presentational kind's one exception. It is in the
  body rather than in the menu because the menu never knows what is in its slot.
- **Focus going _nowhere_ is not focus leaving.** Chromium raises the same
  `focusout`/`relatedTarget: null` for a click onto background — which must dismiss — and
  for a focused child the panel's own render just disabled or unmounted, which must not:
  the second is `Confirmation`'s destructive press, and dismissing on it takes the panel
  down exactly when it should be showing `busy` and then the refusal. The rule is in
  `OverflowMenu`'s docstring and pressed through in `e2e/app.spec.ts`, because happy-dom
  implements none of it.

## Switch

```tsx
<MenuItem role="menuitemcheckbox" checked={holding} onClick={press}>
  … <Switch on={holding} />
</MenuItem>
```

An on/off state made visible, and **not a press**. 26×16 with a 12px knob, which is under
the 44px touch floor on its own — so the row around it is the control and this is the
state that row holds, `aria-hidden` inside something that carries `aria-checked`. A switch
rather than a check because what it stands for is independent of everything beside it: three
modes are a radio group and a check says _this is the one_; a one-shot can be on beside any
of them.

## TabBar · Tab · StepBar

```tsx
<TabBar label="Trak navigator">
  <div className="flex-1">…</div>
  <Tab label="Map" icon={GitBranch} current={level === "map"} onClick={go} />
</TabBar>

<StepBar level={level} mark={<StepMark … />} name={name} caption={caption} onLevel={setLevel} />
<StepBar level="step" caption="Waiting for a description" disabled />
```

A band of flush segments with a rule above and below, exactly one of them lit. `StepBar` is
the navigator the app has at desk width: a `TabBar` whose wide first segment is the
position and whose tabs are the trak's surfaces. Below the phone breakpoint the trak page
draws `trak-detail/SurfaceBar` instead — the same `TabBar` holding four equal tabs, each
`grow`, with the strip and the directive block under its Agent tab doing the wide
segment's job.

- **The band owns the hairline between segments**, through `[&>*+*]` — whether a segment is
  first is a fact about the bar, and a part carrying its own divider grows a wrong edge the
  moment one is reordered or hidden. Segments are deliberately unequal, which is also why
  `Marker` fixes its own width instead of filling what it marks.
- **The position segment carries `name` then `caption`** — what runs it, then what it is
  for: the map row's two lines flattened onto one, told apart by weight alone. The name
  takes no colour of its own so that the segment's lit/unlit ink still reaches it, and it
  shrinks last, because a slug is shorter than a sentence and worth keeping whole.
- **`bare` draws a tab's glyph alone below the breakpoint**, its word kept as the name
  and its width held at the 44px floor. The check band is the one user: there the words
  cut the verdict, which is what a phone reader opens the band for.
- **Lit is ink plus the `Marker`, never a plate.** The dividers already say the bar is in
  parts, which is a cheaper claim than plating one of them.
- **`disabled` means the bar has nothing behind it**, not that a tab is unavailable — the
  New Trak drawer and the cold-open frame draw the shape so that nothing moves when the map
  arrives. It replaced `InertStepBar`, which was this geometry copied by hand and free to
  drift from it.
- **Disabled is `Button`'s `opacity-45`, and the contrast bar does not apply to it.** These
  labels were `text-fg-subtle` while they were `<span>`s, because an opacity put them at
  2.36:1 — right for dim text, and wrong the moment they became controls: WCAG 1.4.3
  exempts an _inactive user interface component_, which a `<button disabled>` is and a
  faded `<span>` is not. A step in the ink scale is also not a difference anyone sees.
- **`mark` is a slot, and that is what let the bar leave the feature.** What a position
  looks like is `StepMark`'s job, and that reads a `StepStatus` and a `MapRow` — types
  `components/` cannot see. A bar with nothing behind it takes the default: the mark for an
  entry that has not run.
- **The arrows stay, beside a `Rail` that can also be pressed.** They look vestigial once
  every position is on screen as its own press, but a piece's tile is 14px and stepping
  through a spawn by clicking is harder than pressing an arrow twice. The rail is for seeing where you are, the arrows for
  stepping — the redundancy is the decision, not an oversight.

## Rail

```tsx
<Rail open={level !== "map"}>
  {bands.length > 0 && <TrakRail bands={bands} at={spot?.key} onPick={go} />}
</Rail>
<Rail />
```

A 48px strip down the left of the drawer's pane, with an edge and its own scroll. It holds
the marks; what the marks _are_ is `TrakRail`'s, which reads a `Band[]` this directory
cannot see — the same slot split as `StepBar`'s `mark`, and for the same reason.

- **48 is measured, not chosen.** Below about 40 a 24px plate, the position marker and a
  gutter stop fitting together.
- **Three drawers have to agree about it** — the detail page fills it, the cold-open frame
  and the New Trak drawer draw it empty — which is why it is here and not in `trak-detail`.
  Same argument as `StepBar`'s `disabled`: the pane must not jump sideways when a plan
  arrives.
- **Handed `open`, it is out of flow and slides** — `-48px` off the left edge over `SLIDE`,
  which the pane beside it shares so the two travel together. The strip moves by
  `transform`; the pane moves by `margin-left` and never by `transform`, because
  `Lightbox` and `ChangeSheet` are `fixed` inside it and a transformed ancestor would
  contain them. The detail page withholds it
  on the map, where every position is already drawn at full size, and the map's pane takes
  the 48px back: it is the drawer's full width, where Agent, Trak and Changes are the width
  beside the strip. Neither pane changes width while the two move. It stays mounted, so
  `aria-hidden` and `inert` go on by hand while it is out; and happy-dom loads no stylesheet, so
  a render test asks whether the rail is _collapsed_, never whether it is there. Without
  `open` it is the strip in flow the two empty frames draw.
- **It fades at the foot rather than clipping.** A re-composed plan is longer than the rail
  is tall, and the mark that falls off the bottom is the _ending_ — the one a reader most
  wants. The fade is a `mask-image` on the container, because a gradient inside a scroll box
  scrolls away with the content.

## Plate

```tsx
<Plate tone={tone} running={running}>
  <Glyph size={14} aria-hidden />
</Plate>

<Plate tone={tone} size="tile" running={running}>   {/* a spawn's column in the rail */}
  <Glyph size={8} aria-hidden />
</Plate>
```

The leading square a list row, a plan entry and the navigator's position all wear: 24px box,
14px glyph, `rounded-control`, ink and fill off `format/tone`. **A slot rather than an
`icon` prop** — its callers hand it three different glyph components, and a prop taking all
three would be a second icon registry.

- **`running` is a segment travelling the box's own edge**, and it is the only motion left
  on these surfaces. A conic gradient painted behind the plate with the plate inset on top,
  because a border can be solid or dashed and nothing else. **It depends on
  `--color-tone-*-bg` being opaque**: making one an alpha lets the gradient through and the
  plate becomes a spinning disc.
- **The segment runs on a track, which is the third colour a tone has** (`toneTrack`). The
  gradient is transparent for three quarters of its turn, so without a fill of its own that
  ring showed the page: invisible in light, and in dark a near-black moat around a plate
  that had visibly shrunk. The track sits halfway between the plate's fill and the page.
  Looked at in dark and settled there — it is also what brought the segment's own contrast
  in dark back down to roughly what it is in light.
- **`size="tile"` is 14px and `--radius-tile`**, which is what a spawn's column draws in the
  strip. Nothing else varies between the two — a third appearance would be a third
  component.
- **What the glyph says is _which agent_, not how it is going.** The fill and the segment
  carry that, so nothing may put a status glyph back on a plate at either size — the 14px
  tile draws the same `MapRow.mark` at 10px.

## The inventory

`styles.css` has landed. `Button`, `Row`, `Skeleton`, `EmptyState` and
`EmptySection` are built; every inline `<button>`, the list row's shell
and every place with nothing in it — a region or a section — now go through them. The
rest is not written; each reads tokens that now exist, so they can be taken in any order.

|                                | replaces                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| ✅ `Button`                    | every inline `<button>` — `TraksListPage`, `TrakRow`                                     |
| `Link`                         | scattered `<a>`                                                                          |
| ✅ `Row`                       | the row shell in `TrakRow` — padding, hover, the three slots and the band below          |
| ✅ `Skeleton`                  | the shape of missing content — three shapes, for `EmptyState` and the trak tab           |
| ✅ `EmptyState`                | the loading, empty and unreachable branches of both pages                                |
| ✅ `EmptySection`              | an empty section among full ones — the decisions on the trak tab                         |
| ✅ `Field`                     | the one control you type into — the New Trak drawer and the chat bar                     |
| ✅ `Drawer`                    | the region over the list, lifted out of `TrakDetailPage` when a second opened            |
| ✅ `ChatBar`                   | the composer band, one copy for `new-trak` and `trak-detail` alike                       |
| ✅ `ChatBox` · `AttachTile`    | the chat bar's box, and a file attached in it — the paperclip, the tiles, the drop edge  |
| ✅ `TabBar` · `Tab`            | a band of flush segments, one of them lit — the shape a navigator takes                  |
| ✅ `StepBar`                   | the drawer's navigator, one copy for a trak with a map and one without (`disabled`)      |
| ✅ `ScreenHeader`              | the top band every drawer screen laid out for itself — trak, goal, Files, the New pages  |
| ✅ `Section`                   | a reading surface's accent heading on a hairline — the Trak tab and the Goal tab         |
| ✅ `Rail`                      | the strip of position marks down the pane's left edge, one copy for all three drawers    |
| ✅ `Plate`                     | the tone-tinted leading square — `TrakMark`, `StepMark`, the navigator's position        |
| ✅ `AppBar`                    | the bar — the mark, the word, one slot; the gate fills it once you are in, never before  |
| ✅ `Mark`                      | the favicon redrawn — the bar, and the desktop shell's two pages                         |
| ✅ `PhoneHeader`               | the phone's one header over the list — picture, eyebrow, name, then `waiting` and `end`  |
| ✅ `PhoneSearch`               | search on a phone, a 44px press — the bar's door, and a host's header over a frame       |
| ✅ `Markdown`                  | `whitespace-pre-wrap` on every string an agent wrote — messages, sections                |
| ✅ `Figure`                    | the frame each figure drew for itself — every block of markdown that is not prose        |
| ✅ `AnsiText`                  | the raw `<pre>` on every string a process wrote — a check output, a turn reason          |
| ✅ `ToolCall`                  | a tool call's name-and-detail line — the drawer's transcript rows                        |
| ✅ `Lightbox`                  | a picture or a diagram over the whole window — the first surface here to cover it        |
| ✅ `OverflowMenu` · `MenuItem` | the finished position's own `⋯`, and the drawer header's ending                          |
| ✅ `Confirmation`              | are-you-sure, where a modal would be — the panel's second state                          |
| ✅ `ConfirmSheet`              | the same are-you-sure on a phone, as a bottom sheet rising from the foot                 |
| ✅ `Switch`                    | an on/off state inside a row that is the press — the run-mode picker's hold              |
| ✅ `ModeStrip`                 | the four run modes as one strip — New Trak's mode band, and a webhook caller's mode      |
| ✅ `Tick`                      | a real checkbox — the pull-request picks, and deleting a clone on a host's remove        |
| ✅ `Progress`                  | a goal's marks, landed of planned — a goal at rest; the list's banner draws its own rail |
| ✅ `PlacePill` · `PlaceDetail` | where remote work ran — step, turn, check band, process row; local work draws nothing    |
| ✅ `CloudDisc`                 | the 16px sandbox disc — a traks-list square's top-right, and a phone's step head         |
| `Region` · `Recess` · `Raised` | the panels in `trak-detail`                                                              |
| `Kbd` · `Meta` · `KV` · `Icon` | `TrakIcon`, `TrakDetailsView`                                                            |

## Decisions taken

- **Icons come from `lucide-react`.** With more icons expected, hand-copying paths stops
  being cheaper than importing.
  It is tree-shakeable, and it was the only dependency this work added — `react-markdown`
  and `remark-gfm` arrived later, with `Markdown`.
- **There is no `control` hover tint.** It existed only for quiet buttons, which now use
  an edge.
- **One surface radius.** Panels and overlays both settled at 6, so they are one token.
- **Links are underlined always**, and hover **darkens toward the ink** — never opacity:
  at 80% opacity a link measures 4.44:1 and fails the bar this system holds; darkening
  15% toward `fg` measures 7.33:1.

## Decided since

**A field and a quiet button differ by measure, alignment and cursor — not by a fill, an
edge or a radius.** They share a hairline, and that was open question 1. A field is
`w-full` and takes its container's whole measure, left-aligned, placeholder in the muted
ink, `cursor-text`; a quiet button is intrinsic-width, centred, `cursor-pointer`. Both are
`rounded-control`.

**Nothing may be added to that list to tell the two apart.** They never appear at the same
width, so the layout already separates them — and inventing a fill, an edge or a radius to
separate things the layout separates is how a system grows a surface it cannot name. A
shorter list is the answer working, not a gap in it.

## Open

Ordered by what blocks the most.

1. **Density and focus** were never asked. They are constants nobody has chosen —
   `Field` moving the ring onto its border is a placement, not the choice.
2. **Dark may have two mechanisms rather than three** — shadow barely registers on a dark
   ground, and it is open whether the ring is doing all the work.
3. **The surface rule runs out at three levels** of nesting, and at a menu opened inside a
   modal. Both are real here: the detail page nests panels, and a confirm dialog can
   carry a dropdown. **`Confirmation` is the same seam from the other side** and does not
   close it: a destructive two-press decision now lives inside something that dismisses on
   Escape and on focus-out. With no field in it the worst case is a lost press rather than
   a lost paragraph, so it ships — but whether the dismissal rules should differ between a
   menu's two states is still open.
4. **Bar-on-scroll** is undesigned. The bar takes an edge at rest; whether it rises when
   the list scrolls under it was an option nobody picked.
5. **Tooltip and toast** have never been drawn. The two break-out presses on the chat bar
   are bare glyphs — a parcel checked, a road sign — with `aria-label` as their only name,
   and nothing on screen resolves them. Taken knowingly for a tool with one user; a
   `title`, a tooltip primitive, or nothing is undecided.
6. **Selected and hover now share a hue**, so the 2px inset accent bar on a selected row
   is load-bearing. If it is ever dropped, the two states collapse into one.
7. **A two-target button group has no primitive.** `trak-detail/cards/gate/GatePresses` welds
   `✓ Approve │ + Recompose` by hand — shared edge, the radius flattened at the join, the
   second half `quiet` — because recomposing at a document gate commits the work first and
   a separate press would say the opposite, and `OpenerControl` welds an icon
   press to the chevron that picks it, on one plate whose edge lifts for either half —
   drawn twice in the trak header and twice in the top bar, once per kind.
   Whether it becomes a primitive or a documented pair rule is undecided; the pair should be
   judged with a third press in mind, since `Skip` lands in the same row.
