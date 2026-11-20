# Habits

What a model draws when nobody is choosing. Each habit is right somewhere, so none is
banned — but each is a default, and **a default ships only with a reason**, written as a
comment beside it in the design's source. A reason points at the brief, the host's system,
the approved position, or a state the element encodes. *It looks finished* is not one.

- Where the brief or the host already uses a habit, follow it.
- Where an axis is free, do not spend it on one.
- A habit caught in a draft is rewritten, not softened: a thinner stripe is the same stripe.

## A coloured stripe down one side

- **Tell:** a thick coloured `border-left` on a card, list item or callout, often in a
  different colour on each.
- **Why it reads as generated:** decoration posing as status, implying an alert or category
  that does not exist.
- **Weigh:** can you name in one word what the colour means — *selected*, *failing*,
  *yours*? Then it carries a state: one stripe, one meaning, wherever that state holds. If
  the word is *accent*, remove it.

**Never where the radius is larger than the stripe is wide, even with a reason.** A border's
inner edge is rounded by the radius minus its width. At zero the stripe stays a straight
bar; past it the stripe bends round the corner into a crescent, which looks cheap whatever
it means. A 3px stripe on a 3px radius is a stripe; on a 12px card it is a crescent. There,
use a tint, an icon or a border all round, or square the element.

## A status badge as the default way to show state

- **Tell:** a pill or dot on every row, nav item or title; a rainbow of badge colours; *New*
  or *Live* with nothing behind it.
- **Why it reads as generated:** copied from admin tools. Reached for first, it marks every
  state, the ordinary ones included, so all look equally loud and the colours map to
  nothing defined.
- **Weigh:**
  - Does this state ask anything of the reader? The ordinary one — fine, neutral, as
    expected — needs no badge, label or icon. Mark the exceptions; no mark means *normal*.
  - For the rest, a word in the row, its order or group, or a missing action often says it
    with less.
  - When a badge is right, give each colour one defined state, keep the roles few, and
    label any dot a reader would have to decode.

## The rest

| habit | tell | why it reads as generated | weigh |
|---|---|---|---|
| Cards everywhere | Every block in a rounded, shadowed box, sometimes nested | Equal containment flattens hierarchy | Keep a card for what a person acts on as one thing; group the rest with space, rules and type |
| One radius, one shadow | The same large radius and soft grey shadow on everything | Nothing differs, so nothing leads | Radius by role; one of shadow, border or tint per surface |
| Purple, indigo, gradients | Violet accents, purple-to-blue hero, gradient text | A framework's default accent, not the product's | Where does the colour come from? One job per colour; text stays solid |
| Icon tile above headings | Icon in a tinted rounded square, heading, two sentences, times three | The tile adds shape, not information | Inline with the heading if it helps find the item; otherwise drop it |
| Default typeface | Inter, Geist or Space Grotesk, unexplained | Shows nobody chose | Use the host's faces, or name what this one does |
| Glow on dark | Several saturated accents, glows, aurora | Every accent competes | One dominant colour, one accent, neutrals |
| Emoji as icons | Emoji as nav icons, bullets, markers | Cheapest icon; renders differently per platform | The host's icon set |
| Hero metric | Big number, small label, row of stats | Stock template; the number lacks context | Only the number the reader came for, with its comparison |
| Eyebrow label | Small tracked-out caps above a heading | A second heading saying the same thing | Keep it only if it says what the heading cannot; else fold it in |
| Glass and blur | Frosted panels for the look | Blur solves layering these panels lack | Only over content the reader still needs to sense |
| Only the happy path | Every list full, every request succeeded | The demo always has data | Draw empty, loading and error states with layout-breaking fixtures |
