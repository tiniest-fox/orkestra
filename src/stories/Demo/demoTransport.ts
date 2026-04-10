// Demo transport factory that serves realistic mock data to Storybook demo stories.
import type { Transport } from "../../transport/types";
import { demoConfig, demoLogsBySession, demoTasks } from "./demoData";

export function createDemoTransport(): Transport {
  return {
    connectionState: "connected",
    supportsLocalOperations: false,
    requiresAuthentication: false,
    onConnectionStateChange: () => () => {},
    on: () => () => {},
    call: <T>(method: string, params?: Record<string, unknown>): Promise<T> => {
      const resolve = (value: unknown): Promise<T> => Promise.resolve(value as T);
      switch (method) {
        case "get_startup_data":
          return resolve({ config: demoConfig, tasks: demoTasks });
        case "list_tasks":
          return resolve(demoTasks);
        case "get_logs": {
          const sessionId = params?.session_id as string | undefined;
          return resolve({
            entries: sessionId ? (demoLogsBySession[sessionId] ?? []) : [],
            cursor: null,
          });
        }
        case "get_project_info":
          return resolve({ project_root: "/workspace/my-project", project_name: "my-project" });
        case "get_commit_log":
          return resolve([]);
        case "list_branches":
          return resolve({
            current: "main",
            branches: ["main", "task/rate-limiting", "task/db-pooling"],
          });
        case "git_sync_status":
          return resolve({ ahead: 0, behind: 0 });
        case "get_diff":
          return resolve({ files: [] });
        case "get_branch_commits":
          return resolve({ commits: [], has_uncommitted_changes: false });
        case "get_uncommitted_diff":
          return resolve({ files: [] });
        case "get_batch_file_counts":
          return resolve({});
        // Action RPCs — resolve successfully to make buttons interactive
        case "approve":
        case "reject":
        case "answer_questions":
        case "interrupt":
        case "resume":
          return resolve(null);
        default:
          return new Promise(() => {}); // pause polling chains
      }
    },
  };
}
