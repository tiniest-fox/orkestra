# Example Task Workflow

This document walks through a complete task lifecycle in Orkestra, from creation to completion.

## Task Lifecycle Overview

```
Pending -> Planning -> AwaitingApproval -> InProgress -> ReadyForReview -> Done
                 \                              |
                  \--> (feedback loop) <--------/
                              |
                              v
                       Failed / Blocked
```

## Task Statuses

| Status | Description |
|--------|-------------|
| `pending` | Task created, waiting for agent assignment |
| `planning` | Planner agent is analyzing and creating implementation plan |
| `awaiting_approval` | Plan ready, waiting for user review |
| `in_progress` | Worker agent implementing the approved plan |
| `ready_for_review` | Implementation complete, awaiting user verification |
| `done` | Task fully completed and verified |
| `failed` | Task could not be completed |
| `blocked` | Task needs clarification or external input |

## Step-by-Step Example

### 1. Create a Task

Via CLI:
```bash
./target/debug/ork task create -t "Add login button" -d "Add a login button to the header component"
# Output: Created task: TASK-004
```

Or via the Tauri desktop UI by clicking the "New Task" button and filling in the details.

### 2. Planner Agent Analyzes Task

When the system picks up the pending task, a planner agent:
- Explores the codebase to understand context
- Identifies files that need modification
- Creates a step-by-step implementation plan
- Sets the plan using: `ork task set-plan TASK-004 --plan "..."`

The task moves to `awaiting_approval` status.

### 3. User Reviews and Approves Plan

View the plan in the UI or via CLI:
```bash
./target/debug/ork task show TASK-004
```

Approve the plan:
```bash
./target/debug/ork task approve TASK-004
# Output: Task TASK-004 plan approved. Status: in_progress
```

Or request changes:
```bash
./target/debug/ork task request-changes TASK-004 --feedback "Please also add styling for dark mode"
# Output: Changes requested for task TASK-004. Status: planning
```

### 4. Worker Agent Implements the Plan

Once approved, a worker agent:
- Reads the approved plan
- Makes the necessary code changes
- Runs tests/builds if applicable
- Reports completion: `ork task complete TASK-004 --summary "Added login button to Header.tsx"`

The task moves to `ready_for_review` status.

### 5. User Verifies and Closes Task

Review the changes made by checking:
- The task summary
- The execution logs
- The actual code changes (via git diff)

If satisfied, mark as done:
```bash
./target/debug/ork task status TASK-004 done
# Output: Task TASK-004 status updated to done
```

## Agent CLI Commands Reference

Commands agents use during execution:

```bash
# Complete a task successfully
./target/debug/ork task complete TASK-ID --summary "What was accomplished"

# Mark a task as failed
./target/debug/ork task fail TASK-ID --reason "Why it couldn't be completed"

# Mark a task as blocked (needs external input)
./target/debug/ork task block TASK-ID --reason "What clarification is needed"

# Set implementation plan (planner agent only)
./target/debug/ork task set-plan TASK-ID --plan "Implementation plan content"
```

## Handling Edge Cases

### Task Fails
If an agent cannot complete the task, it calls:
```bash
./target/debug/ork task fail TASK-004 --reason "Database schema required but not found"
```

The error is stored and visible in the UI for debugging.

### Task is Blocked
If the task needs clarification:
```bash
./target/debug/ork task block TASK-004 --reason "Unclear whether login should use OAuth or email/password"
```

User provides feedback, and the task can be unblocked by restarting the planning phase.

### Plan Rejected
If user requests changes to a plan, the task returns to `planning` status with feedback. The planner agent receives this feedback and produces a revised plan.
