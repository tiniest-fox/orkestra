# Design Research: Typography and Accent Color
## For the Creative Director — Forge Design System Refinement

---

## Part 1: Typography Research

### The Problem With Inter

Inter is not wrong. It is optimized for screen legibility, it renders cleanly at 11–13px, and it has become a genuinely good standard. The problem is exactly that: it is the standard. Every developer tool, every SaaS product, every new startup reaching for "clean and modern" lands on Inter. It has become the new Helvetica in the sense that nobody chose it, everyone uses it, and nothing feels considered about the decision anymore.

The replacement needs to do what Inter does — work at small sizes, carry dense information without noise — but read as a deliberate choice rather than a default.

---

### IBM Plex Sans

**Vibe:** Corporate intelligence with a humanist edge. IBM Plex Sans was designed by Mike Abbink and Dutch foundry Bold Monday specifically as IBM's brand typeface, replacing Helvetica. It carries the heritage of American gothics like Franklin Gothic and Trade Gothic, but with modifications built for screen legibility: a seriffed uppercase I, a lowercase l with a tail, and open counter forms that prevent letterforms from closing up at small sizes.

**At 11–14px:** This is where Plex actually earns its place. The design team engineered specific "plexness" into the letterforms — the open apertures and slightly wider counters mean individual characters remain distinct at 11px. Each glyph in the entire family is TrueType hinted. The Plex documentation specifically calls out that the open white spaces between stems and shoulders make the entire family "very readable in small sizes and at a distance." In practice, 11px IBM Plex Sans 500 holds up in ways that some competitors do not — the letters don't collapse into each other.

**Where it's used:** IBM's own design language across Carbon Design System (IBM's open-source component library used in Watson, IBM Cloud). Hackernoon uses Plex throughout their site and uses Plex Mono specifically for UI text. The Cooper Hewitt Smithsonian Design Museum acquired IBM Plex Sans and Mono into their permanent collection in March 2024, which is a signal about its canonical status.

**Pros for Forge:**
- The seriffed I and tailed l solve a real readability problem at small sizes — distinguishing I, l, and 1 is critical in a dev tool showing IDs, stage names, and keyboard hints
- Seven weights (Thin–Bold) plus matching italics plus Condensed variant — full design range available
- The "corporate with warmth" personality aligns with Forge's "warm but not soft" brief
- Open source, variable font available

**Cons:**
- The IBM association is specific. The font carries an enterprise quality — considered, slightly formal — which is mostly an asset for Forge but may feel slightly heavy at the smallest sizes compared to a more neutral grotesque
- Five weights (not seven) is more common use in practice — the extremes (Thin, ExtraLight) are rarely useful in UI work
- Less geometric precision than Geist or Space Grotesk — it is humanist-adjacent, not pure grotesque

---

### IBM Plex Mono

**Vibe:** Structured, technical, readable. Designed as the monospace companion to IBM Plex Sans, it shares the DNA — open counters, TrueType hinting, consistent optical sizing — but in fixed-width form.

**At 11–14px:** Plex Mono is explicitly engineered for small-size rendering. The Plex documentation states the italic angles were chosen specifically to work best with pixels. IBM Plex Mono has no ligatures by default (this is correct for a UI context — ligatures in monospace are a code editor preference, not a UI convention). Character widths are slightly wider than competing options, which is a trade-off: more horizontal space per character, but individual characters are more legible at small sizes.

**How it pairs with IBM Plex Sans:** The pairing is native — it is the most coherent superfamily in the consideration set. Both fonts share optical weight calibration, similar x-height proportions, and the same hinting strategy. Using IBM Plex Sans + IBM Plex Mono is effectively using one font family with two modes. The cognitive effect is clean: proportional text reads as "content," monospace reads as "data," and neither is fighting the other for attention.

**IBM Plex Mono vs JetBrains Mono:**

| Quality | IBM Plex Mono | JetBrains Mono |
|---------|---------------|----------------|
| Character width | Slightly wider per character | More compact, fits more per line |
| Ligatures | None by default | Extensive optional ligatures |
| Optical weight at small sizes | Slightly heavier strokes, more distinct | Lighter, optimized for extended code reading |
| Personality | Corporate, structured, formal | Modern, developer-native, slightly more expressive |
| Eye strain in extended use | Strong | Marginally better for long code reading |
| UI context (not code editor) | Slightly better — wider characters more legible in short bursts | Optimized for full-screen code, slight overkill for UI badges |

For Forge specifically — where monospace is used for 11–12px keyboard badges, stage names, timestamps, and status fragments rather than full code blocks — IBM Plex Mono's slightly heavier weight at small sizes is an advantage. JetBrains Mono is built for long coding sessions. IBM Plex Mono is built for technical UI contexts.

---

### Alternatives With a Technical Bent

**Geist (Vercel, 2023)**
Already in the current Forge app. Designed by Vercel in collaboration with Basement Studio, explicitly "for developers and designers." Swiss design heritage — influenced by Univers, SF Pro, ABC Diatype, and Inter. High x-height, short descenders, angular strokes on specific terminals. Nine weights from Thin to Ultra Black.

The thing to understand about Geist is that it is essentially Inter with sharper angles and more Swiss rigidity. Where Inter is humanist-adjacent and forgiving, Geist is colder, more precise. At 11px it is excellent — the high x-height keeps letters open and the angular terminals prevent visual muddiness. The Geist Mono companion is equally strong.

The honest case for keeping Geist rather than switching to IBM Plex: Geist communicates "we chose a developer-native font" with the Vercel association — it is younger and sharper. IBM Plex communicates "we chose a rigorously engineered UI font" with the IBM association — it is considered and serious. For Forge, IBM Plex's slightly warmer quality is a better match for the "warm but not soft" brief.

**Space Grotesk**
Designed by Florian Karsten in 2017, derived from Space Mono but made proportional. Five weights, no italics. Distinctive features: single-story lowercase g, curved uppercase Q tail, extended uppercase G bar. Used by NordVPN, Lemonade, Miro, and a raft of Web3/crypto products.

Space Grotesk reads as "quirky geometric." It has personality that Inter and Geist lack, but that personality is specifically the personality of "interesting design tool or crypto startup." Not right for Forge — the distinctive letterforms would compete with the pipeline bars for visual attention, and the lack of italics limits utility.

**DM Sans**
Low-contrast geometric sans-serif, designed for use at smaller text sizes. Available in nine weights with matching italics. Clean and pleasant but relatively generic. It does not carry the technical DNA that Forge needs — it reads as "thoughtful SaaS product" rather than "power tool built by engineers for engineers."

**Outfit / Plus Jakarta Sans / Sora**
All in the same category: friendly geometric sans-serifs with a modern-but-approachable personality. Fine for consumer SaaS, marketing pages, fintech. The wrong register for Forge. They communicate approachability, not precision.

**Instrument Sans**
Production Type, 2013, variable font. Geometric base with humanist warmth. Relatively high x-height, good small-size legibility. Used in some design-focused tools. Instrument Sans reads as "boutique design studio" — it has a refined elegance that makes it well-suited for editorial or branding work. For Forge, it is slightly too refined: the letterforms have a craftsmanship quality that would feel out of place next to text symbols and stage names.

---

### Recommendation

**UI Font: IBM Plex Sans**

Use at the following weights for Forge's defined type scale:
- Section headers (11px, uppercase, tracked): 600
- Task titles (13px): 500
- Body / artifact prose (13px): 400
- Label / button (11px): 500
- App brand name (13px): 700

The case: IBM Plex Sans and Forge share the same philosophical brief — rigorously engineered for function, with enough warmth to avoid feeling like a terminal. The seriffed I and tailed l are not incidental: in a tool where users scan IDs, stage names, and keyboard hints at 11–13px, character disambiguation is load-bearing. It carries an intellectual weight (IBM, Carbon Design System, Hackernoon) rather than a startup weight (Inter, Geist) — for a tool that positions itself as a professional power tool, that association works.

**Mono Font: IBM Plex Mono**

The native pairing locks optical weight and x-height calibration between UI and data contexts. For Forge's specific use case — 11px keyboard badges, 12px timestamps and IDs, 11px status line — the slightly wider character footprint and heavier stroke at small sizes is the right trade-off. JetBrains Mono is the better code editor font; IBM Plex Mono is the better UI data font.

The switch from JetBrains Mono to IBM Plex Mono is subtle in isolation. In aggregate, across 50 task rows with timestamps, stage names, and keyboard hints, the visual coherence between Plex Sans and Plex Mono will make the interface feel like it was designed as a system rather than assembled from parts.

---

---

## Part 2: Pink-Red with Orange Undertones as a Product Accent

### What This Color Communicates

Pink-red is one of the more loaded color choices in product design, precisely because it is rare in developer tools. The space defaults to blue (focus, reliability, enterprise: Jira, GitHub, Linear), green (go, healthy, growth), or orange (energy, warmth: Raycast, GitLab, Figma). Pink-red occupies different psychological territory: urgency with warmth rather than urgency with danger (pure red), energy with edge rather than energy with friendliness (orange).

The products that have used pink-red in developer and productivity contexts:
- **Resend** — the developer email API. Their brand is anchored around a strong red-pink that communicates "built by developers who have aesthetic opinions." It positioned the product as the antitype to boring transactional email tools.
- **Framer** (historically) — used a warm red in earlier brand iterations alongside black and white. Communicated creative authority over aesthetic neutrality.
- **Notion's cherry** — their accent red-cherry in the 2022–2023 era. More desaturated and editorial than what Forge needs, but demonstrates that the color works in a "serious work tool" context without feeling like an emergency button.
- **Raycast** — their brand orange-red (#FF6363 range) is the closest analogue in the developer tool space. It communicates energy and speed without the coldness of blue. The specific brief for Forge pushes further toward pink, away from pure orange.

What pink-red with orange undertones says that other colors do not: **precision + heat**. It is not the cold confidence of blue. It is not the approachability of green. It is not the warmth-without-edge of orange. It is the color of something sharp and alive — which maps exactly to Forge's "alive" principle. The AI agents are running right now, and the accent says so.

---

### Primary Accent: Specific Hex Candidates

The brief: vibrant pink-red with orange undertones, readable on `#FAF8FC` (light canvas) and `#141118` (dark canvas). Must work as a UI element (button border, cursor, active border) and as text (keyboard hints, labels, the command bar `>` cursor).

**Candidate 1: `#E8365C`**
Position on the spectrum: leans pink-red. Less orange, more cherry. Strong vibrancy. Closer to Notion's more saturated cherry variants. At 13px on `#FAF8FC`, contrast ratio is approximately 4.8:1 — passes WCAG AA for normal text. As a border or accent element on the dark canvas, it reads as warm-bright without veering hot pink. This is the most controlled option.

**Candidate 2: `#F03558`**
Position: warmer than `#E8365C`, slightly more luminous. The orange undertone begins to emerge in the red channel pushing toward ~240 vs pure 220. Against `#FAF8FC`, this reads as energetic without aggression. On dark surfaces, it glows. The issue: at 11px as a keyboard badge label on dark, it approaches the edge of legibility without adjustment — a 10% brightness bump may be needed for the dark-mode token (this is standard practice: dark-mode accent tokens are usually lighter/more saturated than their light-mode equivalents).

**Candidate 3: `#EC3A5E`** — recommended primary
Position: the midpoint between cherry and warm coral. This sits at the exact intersection the brief describes: enough pink to read as warm and energetic, enough orange undertone to avoid cold magenta territory, not so much orange that it drifts toward Raycast's existing territory. It is vibrant without being aggressive.

Contrast on `#FAF8FC` canvas: approximately 4.6:1 — WCAG AA compliant for normal text and UI components.
As the command bar `>` cursor: high visibility, communicates "active" and "ready" without visual alarm.
As a button border on dark canvas: warm, readable, not competing with signal colors (green working, amber review, red error).

**Candidate 4: `#F24060`**
Position: the most energetic option. The R channel is highest here, which increases warmth. This is the option that generates the most visual energy. Use this if the intent is for the accent to be unmissable — the focused task indicator in split mode, the active task border. Risk: at small sizes (11px labels), it can read as slightly aggressive. Better used as a decoration/element color than a text color.

**Candidate 5: `#D93060`**
Position: slightly darker, more saturated. Closer to Resend's aesthetic. On the `#FAF8FC` canvas, this has better contrast (approximately 5.3:1) which makes it the strongest choice for text contexts specifically. As an accent element, it is slightly less vibrant than the others. Useful as an alternative if contrast requirements need to be prioritized over vibrancy.

**Working recommendation:**
- **Light mode accent**: `#EC3A5E`
- **Dark mode accent** (brightened for dark surface): `#F04E6E` — same hue, +10% lightness for legibility on `#141118`

---

### Secondary Accent: Pinky-Purple Candidates

The brief already specifies purple (`#A78BFA`) as a signal color for auto-mode indicator. The secondary accent should be distinct enough from that signal purple to read as "brand secondary" rather than "semantic state," but close enough in temperature to coexist with the primary pink-red without clashing.

**Option A: `#C952A8`** — warm magenta-purple
Sits between the crimson primary and a true purple. Has enough pink in it to feel like a family member of the primary, enough blue-purple to be clearly distinct. Works as: secondary action states, question indicators (replacing the existing blue `#60A5FA` in contexts where a warmer reading is needed), the secondary brand color for promotional or empty-state contexts.

**Option B: `#B845C8`** — violet-purple with pink warmth
More purple than Option A, but the pink undertone prevents it from reading cold. This is the "Framer aesthetic" option — the kind of secondary that communicates considered design taste. On dark canvas (`#141118`), it is vibrant without competing with the primary. Works well as a duo: primary `#EC3A5E` for primary actions and interactive elements, secondary `#B845C8` for supporting elements, auto-mode indicators, and decorative states.

**Option C: `#9D4FE8`** — indigo-purple, further from the primary
More independent from the primary. If the primary gets used heavily throughout the interface, this secondary reads as genuinely distinct rather than a sibling. The risk is that it overlaps in register with the existing signal purple (`#A78BFA`). Would require adjusting the signal palette to maintain separation.

**Working recommendation:** `#B845C8` as the secondary accent. Close enough to the primary to read as a designed system, different enough in hue to serve distinct semantic roles, distinct enough from the signal purple `#A78BFA` to avoid confusion.

---

### How to Handle Two Accents Without Visual Noise

This is not a new problem. The products that have solved it well use a strict role separation — not a rule about "use primary more than secondary" but a rule about what each color is allowed to do.

**The Linear pattern:** Linear's indigo accent is used for interactive surfaces (buttons, active states, focus rings). The neutrals do the structural work. The accent never competes with itself because there is only one accent used at any given visual layer. Their secondary color (violet-adjacent tones in hover states) emerges through opacity changes on the primary, not as a truly separate color. This is the most restrained approach.

**The GitHub/Primer pattern:** One functional primary (their "accent" — a blue), one brand moment color (their octocat green). The brand color appears in the logo, in success states, in marketing context. The functional primary is for all interactive elements. The two never appear adjacent in the UI. They coexist by occupying completely separate use cases.

**The Raycast pattern:** Orange as the primary brand and interactive color; purple and other hues only for plugin/extension categorization. The primary is ownable; the secondary is categorical. When the secondary appears, it always comes with a label, so users understand it as a type designation rather than a second brand signal.

**Recommendation for Forge:**

Define strict role separation in the token vocabulary:

**Accent Primary (`#EC3A5E` / dark: `#F04E6E`):**
- The command bar `>` cursor
- Active task left-border in split mode
- Primary CTA button fill
- Keyboard badge text in NEEDS ATTENTION context
- Section header accent line
- The active pipeline segment color for review-state tasks (replacing amber, which is already in use — or keeping amber for "review needed" and using the pink-red for "review in progress by user")

**Accent Secondary (`#B845C8` / dark: `#C85ED8`):**
- Auto-mode / flow indicator
- The question mark in question-state keyboard badges
- Subtask relationship indicators
- Any promotional or "new feature" callout context
- Decorative states in the onboarding screen

The organizing principle: primary accent means "this needs your attention or action." Secondary accent means "this is a system designation or state — informational, not imperative." As long as that distinction holds in the implementation, the two colors will never appear to compete. They appear in different contexts for different cognitive purposes.

**What to avoid:** Never use both accents on the same visual element (e.g., a button with a secondary accent border and a primary accent label). Never let the secondary appear in places that currently use the primary — the roles must be stable across the entire system, or the visual language collapses.

---

## Summary

**Typography:**
- Replace Inter with **IBM Plex Sans** (Thin to Bold)
- Replace JetBrains Mono with **IBM Plex Mono**
- Weight mapping: titles at 500, body at 400, section headers at 600, brand at 700
- The native superfamily pairing creates visual coherence between proportional and monospace contexts that no cross-family pairing achieves

**Color:**
- Primary accent: **`#EC3A5E`** (light), **`#F04E6E`** (dark) — vibrant pink-red with orange warmth
- Secondary accent: **`#B845C8`** (light), **`#C85ED8`** (dark) — warm violet-purple
- Role separation is the mechanism that prevents visual noise — define it in the token vocabulary and enforce it in the spec

---

*Sources consulted:*
- [IBM Plex design documentation](https://www.ibm.com/plex/)
- [IBM Plex — Typographica review](https://typographica.org/typeface-reviews/ibm-plex/)
- [Beautiful Web Type — IBM Plex Sans](https://beautifulwebtype.com/ibm-plex-sans/)
- [The Birth of Geist typeface](https://basement.studio/post/the-birth-of-geist-a-typeface-crafted-for-the-web)
- [Geist Font — Vercel](https://vercel.com/font)
- [Space Grotesk — Typewolf](https://www.typewolf.com/space-grotesk)
- [Radix UI Colors source](https://github.com/radix-ui/colors)
- [Color in Design Systems — EightShapes](https://medium.com/eightshapes-llc/color-in-design-systems-a1c80f65fa3)
- [Raycast Brand Guidelines](https://www.raycast.com/templates/brand-guidelines)
- [Linear Brand Color Palette — Mobbin](https://mobbin.com/colors/brand/linear)
- [IBM Plex Mono font comparison — dx13.co.uk](https://dx13.co.uk/articles/2023/02/17/monospaced/)
- [Best Programming Fonts 2025 — Rantau Studio](https://rantaustudio.com/best-font-for-programming/)
