/**
 * Shared utilities for iteration outcome display.
 * Single source of truth for outcome-to-color mappings.
 */

import type { WorkflowIteration } from "../types/workflow";

/**
 * Semantic color categories for iteration outcomes.
 */
export type OutcomeSemantic = "success" | "warning" | "info" | "error" | "neutral" | "rejection";

/**
 * Maps an iteration outcome to its semantic color category.
 * This is the canonical mapping used by all UI components.
 */
export function getOutcomeSemantic(outcome: WorkflowIteration["outcome"]): OutcomeSemantic {
  if (!outcome) return "neutral";

  switch (outcome.type) {
    case "approved":
    case "completed":
      return "success";
    case "rejected":
    case "blocked":
      return "warning";
    case "awaiting_answers":
      return "info";
    case "agent_error":
    case "integration_failed":
    case "spawn_failed":
    case "script_failed":
      return "error";
    case "skipped":
      return "neutral";
    case "rejection":
    case "awaiting_rejection_review":
      return "rejection";
  }
}

/**
 * Human-readable label for an outcome type.
 * Canonical source — all UI components should use this instead of duplicating the mapping.
 */
export function outcomeLabel(outcome: WorkflowIteration["outcome"]): string {
  if (!outcome) return "In Progress";

  switch (outcome.type) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "awaiting_answers":
      return "Awaiting Answers";
    case "completed":
      return "Completed";
    case "integration_failed":
      return "Integration Failed";
    case "agent_error":
      return "Agent Error";
    case "spawn_failed":
      return "Spawn Failed";
    case "blocked":
      return "Blocked";
    case "skipped":
      return "Skipped";
    case "rejection":
      return "Rejected";
    case "awaiting_rejection_review":
      return "Rejection Pending Review";
    case "script_failed":
      return "Script Failed";
  }
}

/**
 * Color classes for compact indicators (light backgrounds with dark text).
 * Used by IterationIndicator component.
 */
export function getOutcomeIndicatorColor(semantic: OutcomeSemantic): string {
  switch (semantic) {
    case "success":
      return "bg-success-100 text-success-700 dark:bg-success-900 dark:text-success-300";
    case "warning":
      return "bg-warning-100 text-warning-700 dark:bg-warning-900 dark:text-warning-300";
    case "info":
      return "bg-info-100 text-info-700 dark:bg-info-900 dark:text-info-300";
    case "error":
      return "bg-error-100 text-error-700 dark:bg-error-900 dark:text-error-300";
    case "rejection":
      return "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300";
    case "neutral":
      return "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300";
  }
}

/**
 * Color classes for card badges (text + light background).
 * Used by IterationCard component.
 */
export function getOutcomeBadgeColor(semantic: OutcomeSemantic): string {
  switch (semantic) {
    case "success":
      return "text-success-700 bg-success-50 dark:text-success-300 dark:bg-success-950";
    case "warning":
      return "text-warning-700 bg-warning-50 dark:text-warning-300 dark:bg-warning-950";
    case "info":
      return "text-info-700 bg-info-50 dark:text-info-300 dark:bg-info-950";
    case "error":
      return "text-error-700 bg-error-50 dark:text-error-300 dark:bg-error-950";
    case "rejection":
      return "text-purple-700 bg-purple-50 dark:text-purple-300 dark:bg-purple-950";
    case "neutral":
      return "text-gray-700 bg-gray-50 dark:text-gray-300 dark:bg-gray-900";
  }
}
