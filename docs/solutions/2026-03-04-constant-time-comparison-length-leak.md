---
title: ConstantTimeEq length leak in auth comparisons
date: 2026-03-04
tags: [security, auth, networking]
category: bug-pattern
module: orkestra-networking
symptoms:
  - timing side-channel on token length
  - subtle::ConstantTimeEq on &[u8] returns early when lengths differ
---

# ConstantTimeEq Length Leak in Auth Comparisons

## Problem

`subtle::ConstantTimeEq` on `[u8]` slices short-circuits when lengths differ, leaking the token length via timing. An attacker sending progressively longer tokens can measure when the comparison cost increases to infer the expected token length.

```rust
// WRONG — leaks token length
use subtle::ConstantTimeEq;
let ok = stored.as_bytes().ct_eq(provided.as_bytes()).into();
```

## Fix

Hash both sides with SHA-256 before comparing. The digests are always 32 bytes, so `ct_eq` never sees unequal lengths.

```rust
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

let stored_hash = Sha256::digest(stored.as_bytes());
let provided_hash = Sha256::digest(provided.as_bytes());
let ok = stored_hash.ct_eq(&provided_hash).into();
```

`sha2` is already in `orkestra-networking`'s dependency tree.

## Where This Applies

Any place that does constant-time comparison of user-supplied strings against stored secrets:
- Basic Auth password check (`require_basic_auth` in `server.rs`)
- Bearer token check (`is_authenticated` in `server.rs`)
- Any future API key or shared-secret validation

## Notes from First Implementation

The first implementation used `ct_eq` directly on `&[u8]` in both `require_basic_auth` and `is_authenticated`. Both sites needed the fix simultaneously — fixing only one leaves the other vulnerable.
