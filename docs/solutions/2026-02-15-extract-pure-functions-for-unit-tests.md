---
date: 2026-02-15
title: Extract pure functions from React components for isolated unit testing
category: testing
tags: [typescript, react, testing, vitest]
symptoms:
  - Reviewers flag "Pure function not directly unit tested"
  - Component tests mix logic verification with rendering verification
  - Test failures don't isolate whether bug is in logic or UI
---

# Extract pure functions from React components for isolated unit testing

## Problem

Pure functions embedded in React components (data transformations, grouping logic, filtering) are only tested indirectly through component rendering tests. When tests fail, it's unclear whether the issue is in the pure logic or the rendering layer. This violates **Clear Boundaries** — pure logic should be testable in isolation.

## Solution

Extract pure functions to separate utility files with dedicated unit tests. Component tests then focus on rendering behavior, prop handling, and UI interactions.

### Example from Task `supposedly-discrete-phalarope`

**Before** (`src/components/TaskDetail/PrTab.tsx`):
```typescript
// Pure function embedded in component file
function groupCommentsByReview(reviews: PrReview[], comments: PrComment[]): GroupedComments {
  const reviewMap = new Map(reviews.map((r) => [r.id, r]));
  const commentsByReview = new Map<number, PrComment[]>();
  const standaloneComments: PrComment[] = [];
  // ... 20 lines of grouping logic
}

export default function PrTab() {
  // Component uses groupCommentsByReview
}
```

**After** — extracted utility (`src/components/TaskDetail/groupCommentsByReview.ts`):
```typescript
export interface GroupedComments {
  reviewComments: Map<number, PrComment[]>;
  standaloneComments: PrComment[];
}

export function groupCommentsByReview(
  reviews: PrReview[],
  comments: PrComment[]
): GroupedComments {
  // Same logic, now independently testable
}
```

**Unit test** (`src/components/TaskDetail/groupCommentsByReview.test.ts`):
```typescript
describe("groupCommentsByReview", () => {
  it("nests comments under their parent review", () => {
    const reviews = [{ id: 1, author: "alice", state: "APPROVED" }];
    const comments = [
      { id: 10, review_id: 1, body: "LGTM" },
      { id: 11, review_id: 1, body: "Nice work" }
    ];
    const result = groupCommentsByReview(reviews, comments);
    expect(result.reviewComments.get(1)).toHaveLength(2);
    expect(result.standaloneComments).toHaveLength(0);
  });

  it("treats orphaned comments as standalone", () => {
    const reviews = [{ id: 1, author: "alice" }];
    const comments = [{ id: 10, review_id: 999, body: "orphaned" }];
    const result = groupCommentsByReview(reviews, comments);
    expect(result.standaloneComments).toHaveLength(1);
  });

  // 7 more edge case tests...
});
```

**Component test** (`src/components/TaskDetail/PrTab.test.tsx`):
```typescript
// Now focuses on UI behavior, not logic
it("expands review to show nested comments", async () => {
  const reviews = [{ id: 1, author: "alice" }];
  const comments = [{ id: 10, review_id: 1, body: "LGTM" }];
  render(<PrTab reviews={reviews} comments={comments} />);

  const expandButton = screen.getByLabelText("Expand comments");
  await userEvent.click(expandButton);

  expect(screen.getByText("LGTM")).toBeInTheDocument();
});
```

## Benefits

1. **Isolation** — Logic bugs are caught by unit tests before component testing
2. **Speed** — Pure function tests run faster (no React rendering overhead)
3. **Clarity** — Test failures immediately identify the failing layer (logic vs UI)
4. **Reusability** — Extracted utilities can be imported by multiple components

## When to Extract

Extract when:
- Function is pure (same inputs → same outputs, no side effects)
- Function is >10 lines or has complex logic (conditionals, loops, data transformations)
- Function needs edge case testing (empty inputs, null handling, ordering preservation)

## File Organization

```
src/components/TaskDetail/
  PrTab.tsx              # Component (uses groupCommentsByReview)
  PrTab.test.tsx         # Component tests (UI behavior)
  groupCommentsByReview.ts      # Pure utility (exported)
  groupCommentsByReview.test.ts # Unit tests (logic verification)
```

## Testing Coverage Guide

**Unit tests should cover:**
- Happy path (typical inputs)
- Edge cases (empty inputs, null values)
- Boundary conditions (single item, max items)
- Error conditions (orphaned references, invalid data)

**Component tests should cover:**
- Rendering with different prop combinations
- User interactions (clicks, typing, form submissions)
- Conditional UI (expand/collapse, show/hide)
- Integration with child components
