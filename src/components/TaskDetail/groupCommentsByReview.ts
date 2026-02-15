/**
 * Utility for grouping PR comments by their parent review.
 */

import type { PrComment, PrReview } from "../../types/workflow";

export interface ReviewWithComments {
  review: PrReview;
  comments: PrComment[];
}

export interface GroupedComments {
  reviewsWithComments: ReviewWithComments[];
  standaloneComments: PrComment[];
}

/**
 * Groups PR comments by their parent review.
 *
 * Comments with a `review_id` matching a review in the reviews array are nested
 * under that review. Comments with `review_id: null` or pointing to a non-existent
 * review ID are placed in the standalone comments array.
 */
export function groupCommentsByReview(reviews: PrReview[], comments: PrComment[]): GroupedComments {
  const reviewMap = new Map(reviews.map((r) => [r.id, r]));
  const commentsByReview = new Map<number, PrComment[]>();
  const standaloneComments: PrComment[] = [];

  for (const comment of comments) {
    if (comment.review_id != null && reviewMap.has(comment.review_id)) {
      const existing = commentsByReview.get(comment.review_id) || [];
      existing.push(comment);
      commentsByReview.set(comment.review_id, existing);
    } else {
      // Standalone: no review_id OR orphaned (review not in array)
      standaloneComments.push(comment);
    }
  }

  const reviewsWithComments = reviews.map((review) => ({
    review,
    comments: commentsByReview.get(review.id) || [],
  }));

  return { reviewsWithComments, standaloneComments };
}
