// Demo mock data for Storybook stories: tasks, logs, artifacts, and workflow config.

import {
  createMockArtifact,
  createMockFlowConfig,
  createMockIteration,
  createMockQuestion,
  createMockSessionLogInfo,
  createMockStageConfig,
  createMockStageLogInfo,
  createMockSubtaskProgress,
  createMockWorkflowConfig,
  createMockWorkflowTaskView,
} from "../../test/mocks/fixtures";
import type { LogEntry } from "../../types/workflow";

// ============================================================================
// Workflow Config
// ============================================================================

export const demoConfig = createMockWorkflowConfig({
  flows: {
    default: createMockFlowConfig({
      stages: [
        createMockStageConfig({
          name: "plan",
          artifact: "plan",
          inputs: [],
          capabilities: {},
        }),
        createMockStageConfig({
          name: "breakdown",
          artifact: "breakdown",
          inputs: ["plan"],
          capabilities: {
            subtasks: { flow: "hotfix" },
          },
        }),
        createMockStageConfig({
          name: "work",
          artifact: "summary",
          inputs: ["plan"],
          capabilities: {},
        }),
        createMockStageConfig({
          name: "review",
          artifact: "verdict",
          inputs: ["summary"],
          capabilities: {},
          gate: true,
        }),
      ],
    }),
  },
});

// ============================================================================
// Task 1: Working (agent_working on work)
// ============================================================================

const workingPlanArtifact = createMockArtifact({
  name: "plan",
  content:
    "## Plan\n\n### Objective\nAdd rate limiting to the public API endpoints to prevent abuse.\n\n### Approach\n1. Add a token bucket rate limiter middleware\n2. Configure per-endpoint limits\n3. Return 429 with Retry-After headers\n4. Add integration tests",
  stage: "plan",
  created_at: "2026-04-01T09:00:00Z",
  iteration: 1,
});

const workingPlanIteration = createMockIteration({
  id: "demo-rate-limiting-iter-1",
  task_id: "demo-rate-limiting",
  stage: "plan",
  iteration_number: 1,
  started_at: "2026-04-01T08:45:00Z",
  ended_at: "2026-04-01T09:00:00Z",
});

const workingWorkIteration = createMockIteration({
  id: "demo-rate-limiting-iter-2",
  task_id: "demo-rate-limiting",
  stage: "work",
  iteration_number: 1,
  started_at: "2026-04-07T10:15:00Z",
});

export const demoTaskWorking = createMockWorkflowTaskView({
  id: "demo-rate-limiting",
  title: "Add rate limiting to API endpoints",
  description: "Prevent abuse by adding a token bucket rate limiter to all public API endpoints.",
  state: { type: "agent_working", stage: "work" },
  artifacts: { plan: workingPlanArtifact },
  auto_mode: true,
  flow: "default",
  base_branch: "main",
  created_at: "2026-04-01T08:45:00Z",
  updated_at: "2026-04-07T10:15:00Z",
  iterations: [workingPlanIteration, workingWorkIteration],
  derived: {
    stages_with_logs: [
      createMockStageLogInfo({
        stage: "plan",
        sessions: [
          createMockSessionLogInfo({
            session_id: "demo-rate-limiting-plan-session",
            run_number: 1,
            is_current: false,
            created_at: "2026-04-01T08:45:00Z",
          }),
        ],
      }),
      createMockStageLogInfo({
        stage: "work",
        sessions: [
          createMockSessionLogInfo({
            session_id: "demo-rate-limiting-work-session",
            run_number: 1,
            is_current: true,
            created_at: "2026-04-07T10:15:00Z",
          }),
        ],
      }),
    ],
  },
});

// ============================================================================
// Task 2: Awaiting approval (awaiting_approval on review)
// ============================================================================

const reviewPlanArtifact = createMockArtifact({
  name: "plan",
  content:
    "## Plan\n\n### Objective\nRefactor the database connection pooling layer to use PgBouncer for better performance.\n\n### Approach\n1. Audit current connection pool configuration\n2. Introduce PgBouncer as a connection proxy\n3. Update environment config\n4. Load test before and after",
  stage: "plan",
  created_at: "2026-04-02T09:00:00Z",
  iteration: 1,
});

const reviewSummaryArtifact = createMockArtifact({
  name: "summary",
  content:
    "## Work Summary\n\n- Added PgBouncer config in `docker-compose.yml`\n- Updated `DATABASE_URL` handling in `config.py` to route through PgBouncer port\n- Added connection pool size docs in `README.md`\n- Load test results: p99 latency dropped from 420ms → 85ms under 500 concurrent users",
  stage: "work",
  created_at: "2026-04-04T16:30:00Z",
  iteration: 1,
});

export const demoTaskAwaitingApproval = createMockWorkflowTaskView({
  id: "demo-db-pooling",
  title: "Refactor database connection pooling",
  description: "Switch to PgBouncer for connection pooling to improve throughput under load.",
  state: { type: "awaiting_approval", stage: "review" },
  artifacts: { plan: reviewPlanArtifact, summary: reviewSummaryArtifact },
  auto_mode: false,
  flow: "default",
  base_branch: "main",
  created_at: "2026-04-02T09:00:00Z",
  updated_at: "2026-04-05T11:00:00Z",
  iterations: [
    createMockIteration({
      id: "demo-db-pooling-iter-1",
      task_id: "demo-db-pooling",
      stage: "plan",
      iteration_number: 1,
      started_at: "2026-04-02T09:00:00Z",
      ended_at: "2026-04-02T09:30:00Z",
    }),
    createMockIteration({
      id: "demo-db-pooling-iter-2",
      task_id: "demo-db-pooling",
      stage: "work",
      iteration_number: 1,
      started_at: "2026-04-03T10:00:00Z",
      ended_at: "2026-04-04T16:30:00Z",
    }),
    createMockIteration({
      id: "demo-db-pooling-iter-3",
      task_id: "demo-db-pooling",
      stage: "review",
      iteration_number: 1,
      started_at: "2026-04-05T10:00:00Z",
      ended_at: "2026-04-05T11:00:00Z",
    }),
  ],
  derived: {
    pending_approval: true,
    stages_with_logs: [
      createMockStageLogInfo({
        stage: "review",
        sessions: [
          createMockSessionLogInfo({
            session_id: "demo-db-pooling-review-session",
            run_number: 1,
            is_current: true,
            created_at: "2026-04-05T10:00:00Z",
          }),
        ],
      }),
    ],
  },
});

// ============================================================================
// Task 3: Awaiting question answer (awaiting_question_answer on plan)
// ============================================================================

export const demoTaskWithQuestions = createMockWorkflowTaskView({
  id: "demo-ci-cd-pipeline",
  title: "Set up CI/CD pipeline for staging",
  description: "Automate the build, test, and deploy pipeline for the staging environment.",
  state: { type: "awaiting_question_answer", stage: "plan" },
  auto_mode: false,
  flow: "default",
  base_branch: "main",
  created_at: "2026-04-06T14:00:00Z",
  updated_at: "2026-04-07T09:30:00Z",
  iterations: [
    createMockIteration({
      id: "demo-ci-cd-iter-1",
      task_id: "demo-ci-cd-pipeline",
      stage: "plan",
      iteration_number: 1,
      started_at: "2026-04-06T14:00:00Z",
      ended_at: undefined,
    }),
  ],
  derived: {
    has_questions: true,
    pending_questions: [
      createMockQuestion({
        question: "Which CI provider should we use?",
        options: [
          { label: "GitHub Actions", description: "Native to the repo, free for public projects" },
          { label: "CircleCI", description: "Faster caching, more config control" },
          { label: "GitLab CI", description: "Self-hostable, integrated with GitLab" },
        ],
      }),
      createMockQuestion({
        question: "What deployment strategy should staging use?",
        options: [
          { label: "Rolling deploy", description: "Zero downtime, gradual rollout" },
          { label: "Blue-green", description: "Instant cutover, requires double infra" },
          { label: "Recreate", description: "Simple but causes brief downtime" },
        ],
      }),
    ],
    stages_with_logs: [
      createMockStageLogInfo({
        stage: "plan",
        sessions: [
          createMockSessionLogInfo({
            session_id: "demo-ci-cd-plan-session",
            run_number: 1,
            is_current: true,
            created_at: "2026-04-06T14:00:00Z",
          }),
        ],
      }),
    ],
  },
});

// ============================================================================
// Task 4: Waiting on children (waiting_on_children on breakdown)
// ============================================================================

const searchPlanArtifact = createMockArtifact({
  name: "plan",
  content:
    "## Plan\n\nImplement full-text search across tasks and assistant conversations using PostgreSQL `tsvector` + `tsquery`.\n\n### Subtasks\n1. Add FTS columns and indexes to the schema\n2. Build search API endpoint\n3. Wire up frontend search input\n4. Add ranking/highlighting\n5. Write e2e tests",
  stage: "plan",
  created_at: "2026-04-03T10:00:00Z",
  iteration: 1,
});

const searchBreakdownArtifact = createMockArtifact({
  name: "breakdown",
  content:
    "## Breakdown\n\n5 subtasks created:\n- `schema-fts`: Add tsvector columns and GIN indexes\n- `api-search`: POST /search endpoint with ranking\n- `frontend-search`: Search input + results panel\n- `highlighting`: Snippet extraction with ts_headline\n- `e2e-search`: End-to-end test coverage",
  stage: "breakdown",
  created_at: "2026-04-03T10:45:00Z",
  iteration: 1,
});

export const demoTaskParent = createMockWorkflowTaskView({
  id: "demo-full-text-search",
  title: "Implement full-text search",
  description: "Add FTS across tasks and assistant conversations using PostgreSQL.",
  state: { type: "waiting_on_children", stage: "breakdown" },
  artifacts: { plan: searchPlanArtifact, breakdown: searchBreakdownArtifact },
  auto_mode: false,
  flow: "default",
  base_branch: "main",
  created_at: "2026-04-03T09:30:00Z",
  updated_at: "2026-04-07T08:00:00Z",
  iterations: [
    createMockIteration({
      id: "demo-fts-iter-1",
      task_id: "demo-full-text-search",
      stage: "plan",
      iteration_number: 1,
      started_at: "2026-04-03T09:30:00Z",
      ended_at: "2026-04-03T10:00:00Z",
    }),
    createMockIteration({
      id: "demo-fts-iter-2",
      task_id: "demo-full-text-search",
      stage: "breakdown",
      iteration_number: 1,
      started_at: "2026-04-03T10:00:00Z",
      ended_at: "2026-04-03T10:45:00Z",
    }),
  ],
  derived: {
    is_waiting_on_children: true,
    subtask_progress: createMockSubtaskProgress({
      total: 5,
      done: 2,
      working: 1,
      has_questions: 1,
      waiting: 1,
      failed: 0,
      blocked: 0,
      interrupted: 0,
      needs_review: 0,
    }),
    stages_with_logs: [
      createMockStageLogInfo({
        stage: "plan",
        sessions: [
          createMockSessionLogInfo({
            session_id: "demo-fts-plan-session",
            run_number: 1,
            is_current: false,
            created_at: "2026-04-03T09:30:00Z",
          }),
        ],
      }),
      createMockStageLogInfo({
        stage: "breakdown",
        sessions: [
          createMockSessionLogInfo({
            session_id: "demo-fts-breakdown-session",
            run_number: 1,
            is_current: false,
            created_at: "2026-04-03T10:00:00Z",
          }),
        ],
      }),
    ],
  },
});

// ============================================================================
// Task 5: Done
// ============================================================================

export const demoTaskDone = createMockWorkflowTaskView({
  id: "demo-memory-leak-fix",
  title: "Fix memory leak in WebSocket handler",
  description: "Track down and fix the event listener leak causing memory growth over time.",
  state: { type: "done" },
  artifacts: {
    plan: createMockArtifact({
      name: "plan",
      content:
        "## Plan\n\nProfile the WebSocket handler under sustained load and identify unbounded listener accumulation.\n\n1. Run heap profiler\n2. Find root cause\n3. Fix listener teardown\n4. Add regression test",
      stage: "plan",
      created_at: "2026-03-28T10:00:00Z",
      iteration: 1,
    }),
    summary: createMockArtifact({
      name: "summary",
      content:
        "## Summary\n\n- Root cause: `on('message', handler)` called on reconnect without removing the previous listener\n- Fix: store handler ref and call `off()` in the cleanup function\n- Added `ws.listenerCount('message') === 1` assertion in integration test",
      stage: "work",
      created_at: "2026-03-29T14:00:00Z",
      iteration: 1,
    }),
  },
  pr_url: "https://github.com/example/my-project/pull/247",
  auto_mode: false,
  flow: "default",
  base_branch: "main",
  created_at: "2026-03-28T09:30:00Z",
  updated_at: "2026-03-30T11:00:00Z",
  completed_at: "2026-03-30T11:00:00Z",
  iterations: [
    createMockIteration({
      id: "demo-memleak-iter-1",
      task_id: "demo-memory-leak-fix",
      stage: "plan",
      iteration_number: 1,
      started_at: "2026-03-28T09:30:00Z",
      ended_at: "2026-03-28T10:00:00Z",
    }),
    createMockIteration({
      id: "demo-memleak-iter-2",
      task_id: "demo-memory-leak-fix",
      stage: "work",
      iteration_number: 1,
      started_at: "2026-03-28T11:00:00Z",
      ended_at: "2026-03-29T14:00:00Z",
    }),
    createMockIteration({
      id: "demo-memleak-iter-3",
      task_id: "demo-memory-leak-fix",
      stage: "review",
      iteration_number: 1,
      started_at: "2026-03-30T09:00:00Z",
      ended_at: "2026-03-30T11:00:00Z",
    }),
  ],
  derived: {
    is_done: true,
    is_terminal: true,
    current_stage: null,
    stages_with_logs: [
      createMockStageLogInfo({
        stage: "work",
        sessions: [
          createMockSessionLogInfo({
            session_id: "demo-memleak-work-session",
            run_number: 1,
            is_current: false,
            created_at: "2026-03-28T11:00:00Z",
          }),
        ],
      }),
    ],
  },
});

// ============================================================================
// Task 6: Queued
// ============================================================================

export const demoTaskQueued = createMockWorkflowTaskView({
  id: "demo-dark-mode",
  title: "Add dark mode support to settings",
  description: "Let users toggle between light and dark themes from the settings page.",
  state: { type: "queued", stage: "plan" },
  auto_mode: false,
  flow: "default",
  base_branch: "main",
  created_at: "2026-04-08T16:00:00Z",
  updated_at: "2026-04-08T16:00:00Z",
});

// ============================================================================
// Task 7: Gate running
// ============================================================================

export const demoTaskGateRunning = createMockWorkflowTaskView({
  id: "demo-oauth2-migration",
  title: "Migrate user auth to OAuth2",
  description: "Replace session-cookie auth with OAuth2 to support SSO integrations.",
  state: { type: "gate_running", stage: "work" },
  artifacts: {
    plan: createMockArtifact({
      name: "plan",
      content:
        "## Plan\n\n1. Integrate `passport-oauth2` library\n2. Add OAuth2 provider config\n3. Replace session middleware\n4. Update login/logout routes\n5. Migrate existing sessions gracefully",
      stage: "plan",
      created_at: "2026-04-05T09:00:00Z",
      iteration: 1,
    }),
    summary: createMockArtifact({
      name: "summary",
      content:
        "## Summary\n\n- Integrated `passport-oauth2` with Google and GitHub providers\n- Replaced express-session middleware with OAuth2 token validation\n- Updated login/logout routes to use `/auth/google` and `/auth/github` redirect flows\n- Added session migration script for existing cookie-based sessions\n- All 47 auth tests passing",
      stage: "work",
      created_at: "2026-04-07T14:00:00Z",
      iteration: 1,
    }),
  },
  auto_mode: true,
  flow: "default",
  base_branch: "main",
  created_at: "2026-04-05T08:30:00Z",
  updated_at: "2026-04-07T14:00:00Z",
  iterations: [
    createMockIteration({
      id: "demo-oauth2-iter-1",
      task_id: "demo-oauth2-migration",
      stage: "plan",
      iteration_number: 1,
      started_at: "2026-04-05T09:00:00Z",
      ended_at: "2026-04-05T09:30:00Z",
    }),
    createMockIteration({
      id: "demo-oauth2-iter-2",
      task_id: "demo-oauth2-migration",
      stage: "work",
      iteration_number: 1,
      started_at: "2026-04-07T12:00:00Z",
      ended_at: "2026-04-07T14:00:00Z",
    }),
  ],
  derived: {
    is_system_active: true,
    phase_icon: "gate",
    stages_with_logs: [
      createMockStageLogInfo({
        stage: "work",
        sessions: [
          createMockSessionLogInfo({
            session_id: "demo-oauth2-work-session",
            run_number: 1,
            is_current: false,
            created_at: "2026-04-07T12:00:00Z",
          }),
        ],
      }),
    ],
  },
});

// ============================================================================
// Aggregate export
// ============================================================================

export const demoTasks = [
  demoTaskWorking,
  demoTaskAwaitingApproval,
  demoTaskWithQuestions,
  demoTaskParent,
  demoTaskDone,
  demoTaskQueued,
  demoTaskGateRunning,
];

// ============================================================================
// Demo log entries keyed by session ID
// ============================================================================

const workingSessionLogs: LogEntry[] = [
  {
    type: "text",
    content:
      "Let me start by reading the existing middleware setup to understand how to integrate the rate limiter.",
  },
  {
    type: "tool_use",
    tool: "Read",
    id: "tool-1",
    input: { tool: "read", file_path: "src/middleware/index.ts" },
  },
  {
    type: "tool_result",
    tool: "Read",
    tool_use_id: "tool-1",
    content:
      'import express from "express";\nimport { authMiddleware } from "./auth";\n\nexport function applyMiddleware(app: express.Application) {\n  app.use(authMiddleware);\n}',
  },
  {
    type: "text",
    content: "I'll add the rate limiter after auth. Let me create the rate limiter module first.",
  },
  {
    type: "tool_use",
    tool: "Write",
    id: "tool-2",
    input: { tool: "write", file_path: "src/middleware/rateLimiter.ts" },
  },
  {
    type: "tool_result",
    tool: "Write",
    tool_use_id: "tool-2",
    content: "File written successfully.",
  },
  {
    type: "tool_use",
    tool: "Edit",
    id: "tool-3",
    input: { tool: "edit", file_path: "src/middleware/index.ts" },
  },
  {
    type: "tool_result",
    tool: "Edit",
    tool_use_id: "tool-3",
    content: "File updated successfully.",
  },
  {
    type: "tool_use",
    tool: "Bash",
    id: "tool-4",
    input: { tool: "bash", command: "pnpm test --filter=middleware" },
  },
  {
    type: "tool_result",
    tool: "Bash",
    tool_use_id: "tool-4",
    content: "✓ 12 tests passed (middleware suite)\nAll tests passed.",
  },
  {
    type: "text",
    content: "Rate limiter implemented and tests passing. Moving on to adding integration tests.",
  },
];

const reviewSessionLogs: LogEntry[] = [
  {
    type: "text",
    content:
      "Reviewing the database connection pooling refactor. Let me check the diff and summary.",
  },
  {
    type: "text",
    content:
      "The PgBouncer integration looks clean. Connection pool size is now configurable via env var. The load test numbers are compelling — 5x latency improvement at 500 concurrent users.",
  },
  {
    type: "text",
    content:
      "One concern: the README update only mentions the port number but not the `pool_mode = transaction` setting that's critical for correctness. That said, this is covered in the docker-compose comments. Approving.",
  },
  {
    type: "artifact_produced",
    name: "review",
    artifact_id: "demo-review-artifact",
    artifact: {
      name: "review",
      content: "Approved. The connection pooling implementation is correct.",
      stage: "review",
      created_at: "2026-01-15T11:00:00Z",
      iteration: 1,
    },
  },
];

const ciCdPlanSessionLogs: LogEntry[] = [
  {
    type: "text",
    content:
      "I need to set up a CI/CD pipeline for staging. Let me start by checking what CI configuration already exists in the repository.",
  },
  {
    type: "tool_use",
    tool: "Read",
    id: "tool-1",
    input: { tool: "read", file_path: ".github/workflows/ci.yml" },
  },
  {
    type: "tool_result",
    tool: "Read",
    tool_use_id: "tool-1",
    content: "File not found.",
  },
  {
    type: "tool_use",
    tool: "Glob",
    id: "tool-2",
    input: { tool: "glob", pattern: "**/.circleci/**" },
  },
  {
    type: "tool_result",
    tool: "Glob",
    tool_use_id: "tool-2",
    content: "No matches found.",
  },
  {
    type: "text",
    content:
      "No existing CI configuration found. Before I can proceed with the plan, I need to understand a few things about the target setup — the choice of CI provider significantly affects the file structure, secrets management, and caching strategy. I also need to know the intended deployment strategy since that determines how the staging environment is updated.",
  },
];

const ftsPlanSessionLogs: LogEntry[] = [
  {
    type: "text",
    content:
      "The goal is to add full-text search across tasks and assistant conversations using PostgreSQL's built-in FTS capabilities. Let me first check the current schema to understand the table structure.",
  },
  {
    type: "tool_use",
    tool: "Read",
    id: "tool-1",
    input: {
      tool: "read",
      file_path: "crates/orkestra-store/src/migrations/V1__initial_schema.sql",
    },
  },
  {
    type: "tool_result",
    tool: "Read",
    tool_use_id: "tool-1",
    content:
      "CREATE TABLE workflow_tasks (\n  id TEXT PRIMARY KEY,\n  title TEXT NOT NULL,\n  description TEXT,\n  state TEXT NOT NULL,\n  ...\n);\n\nCREATE TABLE assistant_messages (\n  id TEXT PRIMARY KEY,\n  session_id TEXT NOT NULL,\n  content TEXT NOT NULL,\n  ...\n);",
  },
  {
    type: "text",
    content:
      "Good. Both `workflow_tasks` and `assistant_messages` have `TEXT` columns to index. The FTS approach will use `tsvector` columns with GIN indexes on `title || description` for tasks and `content` for messages. Ranking with `ts_rank_cd` and snippet extraction via `ts_headline` will make results actionable.",
  },
  {
    type: "artifact_produced",
    name: "plan",
    artifact_id: "demo-fts-plan-artifact",
    artifact: {
      name: "plan",
      content:
        "## Plan\n\nImplement full-text search across tasks and assistant conversations using PostgreSQL `tsvector` + `tsquery`.\n\n### Subtasks\n1. Add FTS columns and indexes to the schema\n2. Build search API endpoint\n3. Wire up frontend search input\n4. Add ranking/highlighting\n5. Write e2e tests",
      stage: "plan",
      created_at: "2026-04-03T10:00:00Z",
      iteration: 1,
    },
  },
];

const ftsBreakdownSessionLogs: LogEntry[] = [
  {
    type: "text",
    content:
      "Analyzing the FTS plan. Five distinct concerns: schema migration, API layer, frontend UI, snippet highlighting, and e2e coverage. Each can be worked independently with clear interfaces between them — the schema migration must land first, but the other four are parallelizable.",
  },
  {
    type: "text",
    content:
      "Decomposing into subtasks: `schema-fts` blocks everything else; `api-search` depends only on schema; `frontend-search` and `highlighting` depend on the API; `e2e-search` depends on all four.",
  },
  {
    type: "artifact_produced",
    name: "breakdown",
    artifact_id: "demo-fts-breakdown-artifact",
    artifact: {
      name: "breakdown",
      content:
        "## Breakdown\n\n5 subtasks created:\n- `schema-fts`: Add tsvector columns and GIN indexes\n- `api-search`: POST /search endpoint with ranking\n- `frontend-search`: Search input + results panel\n- `highlighting`: Snippet extraction with ts_headline\n- `e2e-search`: End-to-end test coverage",
      stage: "breakdown",
      created_at: "2026-04-03T10:45:00Z",
      iteration: 1,
    },
  },
];

const memleakWorkSessionLogs: LogEntry[] = [
  {
    type: "text",
    content:
      "The issue is memory growth in the WebSocket handler over time. Most likely cause is unbounded event listener accumulation on reconnects. Let me run the heap profiler to confirm.",
  },
  {
    type: "tool_use",
    tool: "Bash",
    id: "tool-1",
    input: { tool: "bash", command: "node --expose-gc scripts/heap-profile.js --duration=60" },
  },
  {
    type: "tool_result",
    tool: "Bash",
    tool_use_id: "tool-1",
    content:
      "Heap snapshot saved to heap-20260328.heapsnapshot\nRetained size growth: +42MB over 60s\nTop retainer: EventEmitter → WebSocket (1847 listeners on 'message')",
  },
  {
    type: "text",
    content:
      "1847 listeners on 'message' — that's the leak. Each reconnect adds a new listener without cleaning up the old one. Let me look at the WebSocket handler.",
  },
  {
    type: "tool_use",
    tool: "Read",
    id: "tool-2",
    input: { tool: "read", file_path: "src/server/websocket/handler.ts" },
  },
  {
    type: "tool_result",
    tool: "Read",
    tool_use_id: "tool-2",
    content:
      'export function attachHandlers(ws: WebSocket) {\n  ws.on("message", (data) => {\n    handleMessage(data);\n  });\n  ws.on("open", () => attachHandlers(ws)); // BUG: re-registers on every open\n}',
  },
  {
    type: "text",
    content:
      "Found it. `attachHandlers` is called recursively on every `open` event, stacking listeners. Fix: store the handler reference and remove it before re-registering, or restructure to avoid the recursive call entirely.",
  },
  {
    type: "tool_use",
    tool: "Edit",
    id: "tool-3",
    input: { tool: "edit", file_path: "src/server/websocket/handler.ts" },
  },
  {
    type: "tool_result",
    tool: "Edit",
    tool_use_id: "tool-3",
    content: "File updated successfully.",
  },
  {
    type: "tool_use",
    tool: "Bash",
    id: "tool-4",
    input: { tool: "bash", command: "cargo test -p orkestra-core -- websocket" },
  },
  {
    type: "tool_result",
    tool: "Bash",
    tool_use_id: "tool-4",
    content:
      "running 8 tests\ntest websocket::handler::listener_count_is_one_after_reconnect ... ok\ntest result: ok. 8 passed; 0 failed",
  },
  {
    type: "text",
    content:
      "Fix confirmed. `listenerCount('message')` stays at 1 across 10 simulated reconnects. Heap growth in the profiler is now flat.",
  },
];

const oauth2WorkSessionLogs: LogEntry[] = [
  {
    type: "text",
    content:
      "Starting the OAuth2 migration. The plan calls for integrating `passport-oauth2` with Google and GitHub providers, then replacing the existing session-cookie middleware. Let me check the current auth setup first.",
  },
  {
    type: "tool_use",
    tool: "Read",
    id: "tool-1",
    input: { tool: "read", file_path: "src/middleware/auth.ts" },
  },
  {
    type: "tool_result",
    tool: "Read",
    tool_use_id: "tool-1",
    content:
      'import session from "express-session";\nimport { sessionStore } from "../store/session";\n\nexport const authMiddleware = session({\n  secret: process.env.SESSION_SECRET,\n  store: sessionStore,\n  resave: false,\n  saveUninitialized: false,\n});',
  },
  {
    type: "tool_use",
    tool: "Write",
    id: "tool-2",
    input: { tool: "write", file_path: "src/auth/providers.ts" },
  },
  {
    type: "tool_result",
    tool: "Write",
    tool_use_id: "tool-2",
    content: "File written successfully.",
  },
  {
    type: "tool_use",
    tool: "Edit",
    id: "tool-3",
    input: { tool: "edit", file_path: "src/routes/auth.ts" },
  },
  {
    type: "tool_result",
    tool: "Edit",
    tool_use_id: "tool-3",
    content: "File updated successfully.",
  },
  {
    type: "tool_use",
    tool: "Bash",
    id: "tool-4",
    input: { tool: "bash", command: "pnpm test --filter=auth" },
  },
  {
    type: "tool_result",
    tool: "Bash",
    tool_use_id: "tool-4",
    content: "✓ 47 tests passed (auth suite)\nAll tests passed.",
  },
  {
    type: "text",
    content:
      "OAuth2 providers wired up and all 47 auth tests passing. Session migration script added for existing cookie-based sessions.",
  },
];

export const demoLogsBySession: Record<string, LogEntry[]> = {
  "demo-rate-limiting-work-session": workingSessionLogs,
  "demo-db-pooling-review-session": reviewSessionLogs,
  "demo-ci-cd-plan-session": ciCdPlanSessionLogs,
  "demo-fts-plan-session": ftsPlanSessionLogs,
  "demo-fts-breakdown-session": ftsBreakdownSessionLogs,
  "demo-memleak-work-session": memleakWorkSessionLogs,
  "demo-oauth2-work-session": oauth2WorkSessionLogs,
};
