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
      return "error";
    case "skipped":
      return "neutral";
    case "rejection":
      return "rejection";
  }
}

/**
 * Color classes for compact indicators (solid backgrounds).
 * Used by IterationIndicator component.
 */
export function getOutcomeIndicatorColor(semantic: OutcomeSemantic): string {
  switch (semantic) {
    case "success":
      return "bg-success-500 dark:bg-success-600";
    case "warning":
      return "bg-warning-500 dark:bg-warning-600";
    case "info":
      return "bg-info-500 dark:bg-info-600";
    case "error":
      return "bg-error-500 dark:bg-error-600";
    case "rejection":
      return "bg-purple-500 dark:bg-purple-600";
    case "neutral":
      return "bg-stone-300 dark:bg-stone-600";
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
