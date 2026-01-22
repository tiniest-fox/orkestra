---
title: "Update Dependencies"
auto_run: false
---

Check for outdated dependencies and update them safely.

Steps:
1. For Rust dependencies:
   - Run `cargo outdated` to check for outdated crates
   - Update minor and patch versions in Cargo.toml
   - Run `cargo build` and `cargo test` to verify nothing breaks

2. For npm dependencies:
   - Run `npm outdated` to check for outdated packages
   - Update minor and patch versions
   - Run `npm run build` and `npm run check` to verify nothing breaks

Be conservative with major version updates - only update if the changelog shows no breaking changes that affect our usage.
