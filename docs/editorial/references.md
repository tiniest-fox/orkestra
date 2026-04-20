# Documentation References

These are the docs sites we use as quality benchmarks. Read them before writing or editing. When in doubt about a structural or tonal decision, ask: would this feel at home in Linear's docs?

---

## Primary Reference: Linear

**Site:** https://linear.app/docs

**Why:** Engineering-focused, app-like, and treats documentation as part of the product experience. Nothing is wasted — every sentence earns its place. Confident and direct without being terse. Assumes a smart reader and respects their time.

**What to take from it:**
- **Tone:** Straightforward and professional without being dry. No filler, no hedging, no "In this guide, we will explore..."
- **Structure:** Concept first, then configuration. Readers leave with a mental model, not just steps to copy.
- **Scannability:** Headers that communicate meaning on their own. A reader skimming the TOC should understand what a page covers.
- **Confidence:** State how things work. Don't over-qualify with "typically" or "usually" unless there's genuine variance.

---

## Secondary Reference: Tailscale

**Site:** https://tailscale.com/kb

**Why:** A technically complex tool made genuinely approachable without dumbing anything down. Best-in-class concept guides — they build accurate mental models before showing configuration.

**What to take from it:**
- How to introduce a complex concept without overwhelming the reader
- The balance between "how to use it" and "how it works"
- Useful for Vibe Coder-targeted pages where approachability matters

---

## Structural Framework: Diátaxis

**Site:** https://diataxis.fr

**Why:** The framework behind most docs sites developers love (Django, FastAPI, Tailscale). Defines four distinct document types — tutorials, how-to guides, reference, explanation — each serving a different reader need. Our document types in `writer.md` (concept guide, how-to guide, reference, overview) map directly to this.

**What to take from it:**
- Don't mix document types on a single page without intent. A reference page that turns into a tutorial loses both audiences.
- "Explanation" (concept guides) and "reference" serve completely different needs — don't collapse them.
- When a page feels unfocused, it's usually because it's trying to be two document types at once.
