// Shared predicates for PR status evaluation.

import type { PrStatus } from "../types/workflow";

export function hasConflicts(status: PrStatus): boolean {
  return status.merge_state_status === "DIRTY" || status.mergeable === false;
}
