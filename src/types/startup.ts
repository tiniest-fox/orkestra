/**
 * Startup status types for the frontend.
 *
 * These types match the Rust types in src-tauri/src/startup.rs
 */

/**
 * Category of startup error for programmatic handling.
 */
export type StartupErrorCategory =
  | "project_not_found"
  | "config_load_error"
  | "config_validation_error"
  | "database_error";

/**
 * A startup error with details and remediation suggestion.
 */
export interface StartupError {
  /** Error category for programmatic handling */
  category: StartupErrorCategory;
  /** Human-readable error message */
  message: string;
  /** Additional details (e.g., list of validation errors) */
  details: string[];
  /** Suggested fix for the user */
  remediation?: string;
}

/**
 * A non-fatal warning during startup.
 */
export interface StartupWarning {
  /** Warning message */
  message: string;
  /** Additional context */
  context?: string;
}

/**
 * Startup status from the backend.
 */
export type StartupStatus =
  | {
      status: "initializing";
    }
  | {
      status: "ready";
      project_root: string;
      warnings: StartupWarning[];
    }
  | {
      status: "failed";
      errors: StartupError[];
    };

/**
 * Get a human-readable label for an error category.
 */
export function getCategoryLabel(category: StartupErrorCategory): string {
  switch (category) {
    case "project_not_found":
      return "Project Not Found";
    case "config_load_error":
      return "Configuration Error";
    case "config_validation_error":
      return "Invalid Configuration";
    case "database_error":
      return "Database Error";
    default:
      return "Error";
  }
}
