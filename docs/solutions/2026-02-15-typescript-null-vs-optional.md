---
date: 2026-02-15
title: TypeScript null-union types vs optional properties for Rust Option<T>
category: type-safety
tags: [typescript, rust, tauri, serde]
symptoms:
  - Reviewers flag "Rust-TypeScript type contract mismatch"
  - Optional properties (T?) used where null unions (T | null) needed
  - Serde serialization produces null, TypeScript expects property-absent
---

# TypeScript null-union types vs optional properties for Rust Option<T>

## Problem

Rust `Option<T>` fields serialize to JSON with **explicit `null` values** via Serde. TypeScript optional properties (`field?: T`) mean the property may be **absent**, not present-with-null-value. Using `T?` for Rust `Option<T>` creates a semantic type contract mismatch at the API boundary.

## Root Cause

Serde's default serialization for `Option::None` produces `{"field": null}`, not an absent property. TypeScript's `field?: T` type allows both `{field: "value"}` and `{}` (property absent), but TypeScript's type checker does **not** treat `null` as equivalent to absent.

## Solution

Use explicit null unions in TypeScript for all fields that map to Rust `Option<T>`:

```typescript
// ❌ WRONG - optional property
interface PrComment {
  path?: string;  // Expects property absent, gets {"path": null}
}

// ✅ CORRECT - null union
interface PrComment {
  path: string | null;  // Matches Serde's {"path": null}
}
```

## Example from Task `supposedly-discrete-phalarope`

**Rust** (`src-tauri/src/commands/queries.rs`):
```rust
#[derive(Serialize)]
pub struct PrComment {
    pub path: Option<String>,       // Serializes as null when None
    pub line: Option<i64>,           // Serializes as null when None
    pub review_id: Option<i64>,      // Serializes as null when None
}
```

**TypeScript (before fix)** (`src/types/workflow.ts`):
```typescript
export interface PrComment {
  path?: string;      // ❌ Type mismatch
  line?: number;      // ❌ Type mismatch
  review_id?: number; // ❌ Type mismatch
}
```

**TypeScript (after fix)**:
```typescript
export interface PrComment {
  path: string | null;      // ✅ Matches Serde
  line: number | null;      // ✅ Matches Serde
  review_id: number | null; // ✅ Matches Serde
}
```

## When This Pattern Applies

- **Tauri commands** returning Rust structs with `Option<T>` fields
- Any Rust→TypeScript boundary where Serde serialization is involved
- JSON APIs where `null` values are explicit (not omitted)

## Prevention

When adding a new Rust type that crosses the Tauri boundary:

1. Check for `Option<T>` fields in the Rust struct
2. Use `T | null` in the corresponding TypeScript interface, **not** `T?`
3. Verify test data uses explicit `null` values to match the runtime contract
