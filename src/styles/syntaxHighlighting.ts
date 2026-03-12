//! Shared syntax highlighting overrides for the Forge diff viewer.
//!
//! Catppuccin Latte spirit, Forge palette. Six hue families:
//!   Violet  (#7C3AED)  keywords, storage, modifiers
//!   Sky     (#0284C7)  strings — passive data, lighter/airier
//!   Blue    (#1D64D8)  functions — active, callable
//!   Amber/Peach/Rust   constants, types, attrs, macros
//!   Teal    (#0D9488)  string escapes, character constants
//!   Pink-red (#C42444) HTML/JSX tag names
//!
//! Selectors use !important to beat syntect's high-specificity inline styles.
//! Dark mode block adjusts hues for legibility on dark backgrounds.

export const FORGE_SYNTAX_OVERRIDES = `
/* ── Base — fallthrough to near-black for any unmatched token ─────────────── */

[class*="syn-"] { color: #1C1820; }

@media (prefers-color-scheme: dark) {
  [class*="syn-"] { color: var(--forge-text-primary); }
}

/* ── Light mode (default) ─────────────────────────────────────────────────── */

/* -- Comments — intentionally muted, italic -- */
.syn-comment,
.syn-comment span { color: #7A6896 !important; font-style: italic !important; }

/* -- Strings — deep sky blue, passive/data feel -- */
[class*="syn-string"],
[class*="syn-string"] span { color: #075985 !important; }

/* -- String escapes — deeper teal, distinct from string body -- */
[class*="syn-string"] [class*="syn-escape"],
[class*="syn-constant"][class*="syn-character"][class*="syn-escape"] { color: #0F766E !important; }

/* -- Keywords and storage — deep violet -- */
.syn-keyword,
.syn-keyword span,
.syn-storage,
.syn-storage span,
.syn-storage.syn-type,
.syn-storage.syn-type span,
.syn-storage.syn-modifier,
.syn-storage.syn-modifier span,
.syn-keyword.syn-control,
.syn-keyword.syn-control span,
.syn-keyword.syn-operator,
.syn-keyword.syn-operator span,
.syn-keyword.syn-other,
.syn-keyword.syn-other span { color: #6D28D9 !important; }

/* -- Numeric constants — rich amber -- */
.syn-constant.syn-numeric,
.syn-constant.syn-numeric span { color: #B45309 !important; }

/* -- Language constants (true/false/nil/null) — deep orange -- */
.syn-constant.syn-language,
.syn-constant.syn-language span { color: #C2410C !important; }

/* -- Character constants — deep teal -- */
.syn-constant.syn-character,
.syn-constant.syn-character span { color: #0F766E !important; }

/* -- Other constants — rich amber -- */
.syn-constant.syn-other,
.syn-constant.syn-other span { color: #B45309 !important; }

/* -- Function names — deep blue -- */
.syn-entity.syn-name.syn-function,
.syn-entity.syn-name.syn-function span { color: #1D4ED8 !important; }

/* -- Support/builtin functions — same blue family -- */
.syn-support.syn-function,
.syn-support.syn-function span { color: #1E5FBF !important; }

/* -- Support constants (CSS property values: flex, bold, none…) — deep orange -- */
.syn-support.syn-constant,
.syn-support.syn-constant span { color: #C2410C !important; }

/* -- CSS selectors — deep violet -- */
.syn-meta.syn-selector.syn-css,
.syn-meta.syn-selector.syn-css span { color: #6D28D9 !important; }

/* -- Type / class names — deep golden amber -- */
.syn-entity.syn-name.syn-type,
.syn-entity.syn-name.syn-type span,
.syn-entity.syn-name.syn-class,
.syn-entity.syn-name.syn-class span,
.syn-support.syn-type,
.syn-support.syn-type span,
.syn-support.syn-class,
.syn-support.syn-class span { color: #92600A !important; }

/* -- HTML/JSX tag names — deep rose -- */
.syn-entity.syn-name.syn-tag,
.syn-entity.syn-name.syn-tag span { color: #9F1239 !important; }

/* -- HTML/JSX attribute names — deep rust -- */
.syn-entity.syn-other.syn-attribute-name,
.syn-entity.syn-other.syn-attribute-name span { color: #9A3412 !important; }

/* -- Variable parameters — vivid purple, distinct from keyword violet -- */
.syn-variable.syn-parameter,
.syn-variable.syn-parameter span { color: #9333EA !important; }

/* -- Other variables — base text, don't over-color -- */
.syn-variable,
.syn-variable span { color: #1C1820 !important; }

/* -- Punctuation — muted but readable -- */
.syn-punctuation,
.syn-punctuation span,
.syn-meta.syn-brace,
.syn-meta.syn-brace span { color: #5C546E !important; }

/* -- Preprocessor / macros — deep orange -- */
.syn-meta.syn-preprocessor,
.syn-meta.syn-preprocessor span,
.syn-support.syn-other.syn-macro,
.syn-support.syn-other.syn-macro span { color: #C2410C !important; }

/* -- Module / namespace names — deep golden amber -- */
.syn-entity.syn-name.syn-module,
.syn-entity.syn-name.syn-module span,
.syn-entity.syn-name.syn-namespace,
.syn-entity.syn-name.syn-namespace span { color: #92600A !important; }

/* -- Invalid tokens — deep red -- */
.syn-invalid,
.syn-invalid span { color: #B91C1C !important; }

/* ── Dark mode ────────────────────────────────────────────────────────────── */

@media (prefers-color-scheme: dark) {
  /* -- Comments — slightly brighter on dark backgrounds -- */
  .syn-comment,
  .syn-comment span { color: #8B80A8 !important; font-style: italic !important; }

  /* -- Strings — lighter sky blue for dark backgrounds -- */
  [class*="syn-string"],
  [class*="syn-string"] span { color: #38BDF8 !important; }

  /* -- String escapes — teal, slightly lighter -- */
  [class*="syn-string"] [class*="syn-escape"],
  [class*="syn-constant"][class*="syn-character"][class*="syn-escape"] { color: #14B8A6 !important; }

  /* -- Keywords and storage — lighter violet for dark backgrounds -- */
  .syn-keyword,
  .syn-keyword span,
  .syn-storage,
  .syn-storage span,
  .syn-storage.syn-type,
  .syn-storage.syn-type span,
  .syn-storage.syn-modifier,
  .syn-storage.syn-modifier span,
  .syn-keyword.syn-control,
  .syn-keyword.syn-control span,
  .syn-keyword.syn-operator,
  .syn-keyword.syn-operator span,
  .syn-keyword.syn-other,
  .syn-keyword.syn-other span { color: #A78BFA !important; }

  /* -- Numeric constants — lighter amber -- */
  .syn-constant.syn-numeric,
  .syn-constant.syn-numeric span { color: #FBB240 !important; }

  /* -- Language constants — lighter peach/orange -- */
  .syn-constant.syn-language,
  .syn-constant.syn-language span { color: #F97316 !important; }

  /* -- Character constants — teal -- */
  .syn-constant.syn-character,
  .syn-constant.syn-character span { color: #14B8A6 !important; }

  /* -- Other constants -- */
  .syn-constant.syn-other,
  .syn-constant.syn-other span { color: #FBB240 !important; }

  /* -- Function names — lighter blue -- */
  .syn-entity.syn-name.syn-function,
  .syn-entity.syn-name.syn-function span { color: #60A5FA !important; }

  /* -- Support/builtin functions -- */
  .syn-support.syn-function,
  .syn-support.syn-function span { color: #7AB8F5 !important; }

  /* -- Support constants (CSS property values) -- */
  .syn-support.syn-constant,
  .syn-support.syn-constant span { color: #F97316 !important; }

  /* -- CSS selectors -- */
  .syn-meta.syn-selector.syn-css,
  .syn-meta.syn-selector.syn-css span { color: #A78BFA !important; }

  /* -- Type / class names — golden amber, brightened -- */
  .syn-entity.syn-name.syn-type,
  .syn-entity.syn-name.syn-type span,
  .syn-entity.syn-name.syn-class,
  .syn-entity.syn-name.syn-class span,
  .syn-support.syn-type,
  .syn-support.syn-type span,
  .syn-support.syn-class,
  .syn-support.syn-class span { color: #FBBF24 !important; }

  /* -- HTML/JSX tag names — lighter pink-red -- */
  .syn-entity.syn-name.syn-tag,
  .syn-entity.syn-name.syn-tag span { color: #F472B6 !important; }

  /* -- HTML/JSX attribute names — lighter rust -- */
  .syn-entity.syn-other.syn-attribute-name,
  .syn-entity.syn-other.syn-attribute-name span { color: #FB923C !important; }

  /* -- Variable parameters -- */
  .syn-variable.syn-parameter,
  .syn-variable.syn-parameter span { color: #C4B5FD !important; }

  /* -- Other variables — use CSS variable for base text in dark mode -- */
  .syn-variable,
  .syn-variable span { color: var(--forge-text-primary) !important; }

  /* -- Punctuation — muted but visible on dark -- */
  .syn-punctuation,
  .syn-punctuation span,
  .syn-meta.syn-brace,
  .syn-meta.syn-brace span { color: #6B6580 !important; }

  /* -- Preprocessor / macros -- */
  .syn-meta.syn-preprocessor,
  .syn-meta.syn-preprocessor span,
  .syn-support.syn-other.syn-macro,
  .syn-support.syn-other.syn-macro span { color: #F97316 !important; }

  /* -- Module / namespace names -- */
  .syn-entity.syn-name.syn-module,
  .syn-entity.syn-name.syn-module span,
  .syn-entity.syn-name.syn-namespace,
  .syn-entity.syn-name.syn-namespace span { color: #FBBF24 !important; }

  /* -- Invalid tokens -- */
  .syn-invalid,
  .syn-invalid span { color: #EF4444 !important; }
}
`;
