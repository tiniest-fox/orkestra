//! Structural overrides for the Catppuccin diff viewer.
//!
//! Catppuccin Latte (light) and Catppuccin Mocha (dark) handle all token colors.
//! These overrides only add things syntect's CSS generator doesn't emit:
//!   - italic comments
//!   - near-black fallthrough for any unmatched tokens

export const FORGE_SYNTAX_OVERRIDES = `
/* -- Fallthrough — near-black for any unclassified token in light mode -- */
[class*="syn-"] { color: #4c4f69; }

@media (prefers-color-scheme: dark) {
  [class*="syn-"] { color: var(--forge-text-primary); }
}

/* -- Comments — italic -- */
.syn-comment,
.syn-comment span { font-style: italic !important; }
`;
