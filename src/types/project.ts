/**
 * Types for the multi-project system.
 */

/**
 * A recent project entry stored in the recents list.
 */
export interface RecentProject {
  /** Absolute path to the project directory. */
  path: string;
  /** Display name (usually folder name). */
  display_name: string;
  /** ISO 8601 timestamp of when it was last opened. */
  last_opened: string;
}

/**
 * Information about the currently open project.
 */
export interface ProjectInfo {
  /** Absolute path to the project root. */
  project_root: string;
  /** Whether the project has git service available. */
  has_git: boolean;
  /** Whether the `gh` CLI is available for PR creation. */
  has_gh_cli: boolean;
}

/**
 * Response from opening a project.
 */
export interface OpenProjectResponse {
  /** Window label for the opened project. */
  window_label: string;
  /** Project root path. */
  project_root: string;
}
