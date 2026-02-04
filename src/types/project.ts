/**
 * Project-related types for the frontend.
 *
 * These types match the Rust types in src-tauri/src/state/mod.rs
 */

/**
 * A recently opened project with metadata.
 */
export interface RecentProject {
  /** Absolute path to the project root */
  path: string;
  /** Display name (typically the folder name) */
  display_name: string;
  /** ISO 8601 timestamp of when the project was last opened */
  last_opened: string;
}

/**
 * Basic project information.
 */
export interface ProjectInfo {
  /** Absolute path to the project root */
  path: string;
  /** Display name (typically the folder name) */
  display_name: string;
}
