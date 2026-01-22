---
title: "Code Cleanup"
auto_run: true
---

Run linters and formatters to clean up the codebase.

Focus on:
- Running `cargo fmt` to format Rust code
- Running `cargo clippy --fix` to fix common Rust issues
- Running `npm run check:fix` to fix TypeScript/React lint and format issues
- Fixing any obvious issues that don't require architectural decisions

Do not make changes that alter behavior - only formatting and lint fixes.
