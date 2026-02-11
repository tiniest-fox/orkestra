import { DiffSkeletonBody } from "../Diff/DiffSkeletonBody";

/**
 * CommitDiffSkeleton - Loading skeleton for CommitDiffPanel body content.
 * Renders only the loading state for the panel body, not the header.
 */
export function CommitDiffSkeleton() {
  return <DiffSkeletonBody />;
}
