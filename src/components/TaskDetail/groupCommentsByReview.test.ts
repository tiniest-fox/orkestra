import { describe, expect, it } from "vitest";
import type { PrComment, PrReview } from "../../types/workflow";
import { groupCommentsByReview } from "./groupCommentsByReview";

describe("groupCommentsByReview", () => {
  it("treats all comments as standalone when reviews array is empty", () => {
    const reviews: PrReview[] = [];
    const comments: PrComment[] = [
      {
        id: 1,
        author: "alice",
        body: "First comment",
        path: null,
        line: null,
        created_at: "2024-01-01T00:00:00Z",
        review_id: null,
      },
      {
        id: 2,
        author: "bob",
        body: "Second comment",
        path: null,
        line: null,
        created_at: "2024-01-01T00:00:01Z",
        review_id: 100,
      },
    ];

    const result = groupCommentsByReview(reviews, comments);

    expect(result.reviewsWithComments).toEqual([]);
    expect(result.standaloneComments).toHaveLength(2);
    expect(result.standaloneComments[0].id).toBe(1);
    expect(result.standaloneComments[1].id).toBe(2);
  });

  it("groups comments under their parent review when review_id matches", () => {
    const reviews: PrReview[] = [
      {
        id: 100,
        author: "alice",
        state: "APPROVED",
        body: null,
        submitted_at: "2024-01-01T00:00:00Z",
      },
    ];
    const comments: PrComment[] = [
      {
        id: 1,
        author: "alice",
        body: "Nested comment",
        path: "src/main.rs",
        line: 42,
        created_at: "2024-01-01T00:00:00Z",
        review_id: 100,
      },
    ];

    const result = groupCommentsByReview(reviews, comments);

    expect(result.reviewsWithComments).toHaveLength(1);
    expect(result.reviewsWithComments[0].review.id).toBe(100);
    expect(result.reviewsWithComments[0].comments).toHaveLength(1);
    expect(result.reviewsWithComments[0].comments[0].id).toBe(1);
    expect(result.standaloneComments).toHaveLength(0);
  });

  it("treats comments pointing to non-existent review IDs as standalone", () => {
    const reviews: PrReview[] = [
      {
        id: 100,
        author: "alice",
        state: "APPROVED",
        body: null,
        submitted_at: "2024-01-01T00:00:00Z",
      },
    ];
    const comments: PrComment[] = [
      {
        id: 1,
        author: "bob",
        body: "Orphaned comment",
        path: null,
        line: null,
        created_at: "2024-01-01T00:00:00Z",
        review_id: 999, // Non-existent review ID
      },
    ];

    const result = groupCommentsByReview(reviews, comments);

    expect(result.reviewsWithComments).toHaveLength(1);
    expect(result.reviewsWithComments[0].comments).toHaveLength(0);
    expect(result.standaloneComments).toHaveLength(1);
    expect(result.standaloneComments[0].id).toBe(1);
  });

  it("groups multiple comments under the same review", () => {
    const reviews: PrReview[] = [
      {
        id: 100,
        author: "alice",
        state: "COMMENTED",
        body: null,
        submitted_at: "2024-01-01T00:00:00Z",
      },
    ];
    const comments: PrComment[] = [
      {
        id: 1,
        author: "alice",
        body: "First nested comment",
        path: "src/lib.rs",
        line: 10,
        created_at: "2024-01-01T00:00:00Z",
        review_id: 100,
      },
      {
        id: 2,
        author: "alice",
        body: "Second nested comment",
        path: "src/lib.rs",
        line: 20,
        created_at: "2024-01-01T00:00:01Z",
        review_id: 100,
      },
      {
        id: 3,
        author: "alice",
        body: "Third nested comment",
        path: "src/main.rs",
        line: 5,
        created_at: "2024-01-01T00:00:02Z",
        review_id: 100,
      },
    ];

    const result = groupCommentsByReview(reviews, comments);

    expect(result.reviewsWithComments).toHaveLength(1);
    expect(result.reviewsWithComments[0].comments).toHaveLength(3);
    expect(result.standaloneComments).toHaveLength(0);
  });

  it("preserves comment order within each group", () => {
    const reviews: PrReview[] = [
      {
        id: 100,
        author: "alice",
        state: "COMMENTED",
        body: null,
        submitted_at: "2024-01-01T00:00:00Z",
      },
    ];
    const comments: PrComment[] = [
      {
        id: 3,
        author: "alice",
        body: "Third",
        path: null,
        line: null,
        created_at: "2024-01-01T00:00:02Z",
        review_id: 100,
      },
      {
        id: 1,
        author: "alice",
        body: "First",
        path: null,
        line: null,
        created_at: "2024-01-01T00:00:00Z",
        review_id: 100,
      },
      {
        id: 2,
        author: "alice",
        body: "Second",
        path: null,
        line: null,
        created_at: "2024-01-01T00:00:01Z",
        review_id: 100,
      },
    ];

    const result = groupCommentsByReview(reviews, comments);

    // Comments should appear in input order, not sorted
    const nestedIds = result.reviewsWithComments[0].comments.map((c) => c.id);
    expect(nestedIds).toEqual([3, 1, 2]);
  });

  it("treats comments with review_id null as standalone", () => {
    const reviews: PrReview[] = [
      {
        id: 100,
        author: "alice",
        state: "APPROVED",
        body: null,
        submitted_at: "2024-01-01T00:00:00Z",
      },
    ];
    const comments: PrComment[] = [
      {
        id: 1,
        author: "bob",
        body: "General comment",
        path: null,
        line: null,
        created_at: "2024-01-01T00:00:00Z",
        review_id: null,
      },
    ];

    const result = groupCommentsByReview(reviews, comments);

    expect(result.reviewsWithComments).toHaveLength(1);
    expect(result.reviewsWithComments[0].comments).toHaveLength(0);
    expect(result.standaloneComments).toHaveLength(1);
    expect(result.standaloneComments[0].id).toBe(1);
  });

  it("handles mixed scenario with nested, standalone, and orphaned comments", () => {
    const reviews: PrReview[] = [
      {
        id: 100,
        author: "alice",
        state: "APPROVED",
        body: null,
        submitted_at: "2024-01-01T00:00:00Z",
      },
      {
        id: 200,
        author: "bob",
        state: "CHANGES_REQUESTED",
        body: "Needs work",
        submitted_at: "2024-01-01T00:00:01Z",
      },
    ];
    const comments: PrComment[] = [
      // Nested under review 100
      {
        id: 1,
        author: "alice",
        body: "Comment on my own review",
        path: "src/main.rs",
        line: 10,
        created_at: "2024-01-01T00:00:00Z",
        review_id: 100,
      },
      // Standalone (null review_id)
      {
        id: 2,
        author: "carol",
        body: "General standalone comment",
        path: null,
        line: null,
        created_at: "2024-01-01T00:00:01Z",
        review_id: null,
      },
      // Nested under review 200
      {
        id: 3,
        author: "bob",
        body: "Specific issue here",
        path: "src/lib.rs",
        line: 42,
        created_at: "2024-01-01T00:00:02Z",
        review_id: 200,
      },
      // Orphaned (points to non-existent review)
      {
        id: 4,
        author: "dave",
        body: "Orphaned comment",
        path: null,
        line: null,
        created_at: "2024-01-01T00:00:03Z",
        review_id: 999,
      },
      // Another nested under review 100
      {
        id: 5,
        author: "alice",
        body: "Another comment on review 100",
        path: "src/main.rs",
        line: 20,
        created_at: "2024-01-01T00:00:04Z",
        review_id: 100,
      },
    ];

    const result = groupCommentsByReview(reviews, comments);

    // Two reviews in output, in input order (review 100, then review 200)
    expect(result.reviewsWithComments).toHaveLength(2);

    // Review 100 (first) has 2 comments (ids 1 and 5)
    expect(result.reviewsWithComments[0].review.id).toBe(100);
    expect(result.reviewsWithComments[0].comments).toHaveLength(2);
    expect(result.reviewsWithComments[0].comments.map((c) => c.id)).toEqual([1, 5]);

    // Review 200 (second) has 1 comment (id 3)
    expect(result.reviewsWithComments[1].review.id).toBe(200);
    expect(result.reviewsWithComments[1].comments).toHaveLength(1);
    expect(result.reviewsWithComments[1].comments[0].id).toBe(3);

    // Standalone: null review_id (id 2) and orphaned (id 4)
    expect(result.standaloneComments).toHaveLength(2);
    expect(result.standaloneComments.map((c) => c.id)).toEqual([2, 4]);
  });

  it("returns empty arrays when both inputs are empty", () => {
    const result = groupCommentsByReview([], []);

    expect(result.reviewsWithComments).toEqual([]);
    expect(result.standaloneComments).toEqual([]);
  });

  it("returns reviews with empty comment arrays when no comments exist", () => {
    const reviews: PrReview[] = [
      {
        id: 100,
        author: "alice",
        state: "APPROVED",
        body: null,
        submitted_at: "2024-01-01T00:00:00Z",
      },
      {
        id: 200,
        author: "bob",
        state: "COMMENTED",
        body: "Looks good",
        submitted_at: "2024-01-01T00:00:01Z",
      },
    ];

    const result = groupCommentsByReview(reviews, []);

    expect(result.reviewsWithComments).toHaveLength(2);
    expect(result.reviewsWithComments[0].comments).toEqual([]);
    expect(result.reviewsWithComments[1].comments).toEqual([]);
    expect(result.standaloneComments).toEqual([]);
  });
});
