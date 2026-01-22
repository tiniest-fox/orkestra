# Orkestra CLI Guide

The `ork` command-line interface provides task management capabilities for the Orkestra orchestration system.

## Installation

Build the CLI from the project root:

```bash
cargo build
```

The binary will be available at `./target/debug/ork` (or `./target/release/ork` for release builds).

## Command Reference

### Task Management

All task commands follow the pattern: `ork task <action> [options]`

---

### Listing Tasks

```bash
# List all tasks
ork task list

# Filter by status
ork task list --status planning
ork task list --status working
ork task list --status done
```

**Available status filters:** `planning`, `breaking_down`, `waiting_on_subtasks`, `working`, `done`, `failed`, `blocked`

---

### Viewing Task Details

```bash
# Show full details for a specific task
ork task show TASK-001
```

**Output includes:** ID, title, status, description, created/updated timestamps, summary (if complete), and error (if failed).

---

### Creating Tasks

```bash
# Create a new task with title only
ork task create --title "Implement user authentication"

# Create with title and description
ork task create --title "Add dark mode" --description "Implement a toggle for dark/light theme in the settings panel"

# Short flags
ork task create -t "Fix login bug" -d "Users cannot log in with special characters in password"
```

---

### Completing Tasks

Mark a task as complete (moves it to ready for review status):

```bash
ork task complete TASK-001 --summary "Implemented the feature with tests"

# Short flag
ork task complete TASK-001 -s "Fixed the bug by updating validation logic"
```

---

### Failing Tasks

Mark a task as failed when it cannot be completed:

```bash
ork task fail TASK-001 --reason "Dependency not available"

# Short flag
ork task fail TASK-001 -r "External API is down"
```

---

### Blocking Tasks

Mark a task as blocked when waiting on external factors:

```bash
ork task block TASK-001 --reason "Waiting for design approval"

# Short flag
ork task block TASK-001 -r "Need clarification on requirements"
```

---

### Updating Task Status

Manually set the status of a task:

```bash
ork task status TASK-001 working
ork task status TASK-001 planning
ork task status TASK-001 done
```

**Valid statuses:** `planning`, `breaking_down`, `waiting_on_subtasks`, `working`, `done`, `failed`, `blocked`

---

### Plan Management

#### Setting a Plan

Used by planner agents to set the implementation plan:

```bash
ork task set-plan TASK-001 --plan "## Implementation\n1. Create models\n2. Add routes\n3. Write tests"
```

#### Approving a Plan

Approve a task's plan and move it to the next phase:

```bash
ork task approve TASK-001
```

This spawns either a breakdown agent or worker agent depending on the task complexity.

#### Requesting Plan Changes

Request revisions to a plan:

```bash
ork task request-changes TASK-001 --feedback "Please add error handling considerations"

# Short flag
ork task request-changes TASK-001 -f "Need more detail on the database schema"
```

---

### Subtask Management

#### Creating Subtasks

Create a subtask under a parent task:

```bash
ork task create-subtask TASK-001 --title "Create database models" --description "Define User and Session models"

# Short flags
ork task create-subtask TASK-001 -t "Add API endpoints" -d "REST endpoints for CRUD operations"
```

#### Viewing Subtasks

List all subtasks of a parent task:

```bash
ork task subtasks TASK-001
```

---

### Breakdown Management

#### Setting a Breakdown

Used by breakdown agents to define how a task should be split:

```bash
ork task set-breakdown TASK-001 --breakdown "## Breakdown\n- Subtask 1: Database\n- Subtask 2: API\n- Subtask 3: UI"
```

#### Approving a Breakdown

Approve the breakdown and start working on subtasks:

```bash
ork task approve-breakdown TASK-001
```

This spawns worker agents for all subtasks.

#### Requesting Breakdown Changes

Request revisions to a breakdown:

```bash
ork task request-breakdown-changes TASK-001 --feedback "Split the API subtask into separate endpoints"
```

#### Skipping Breakdown

Skip the breakdown phase and go directly to working:

```bash
ork task skip-breakdown TASK-001
```

This spawns a worker agent to implement the task directly.

---

## Common Workflows

### Simple Task Workflow

```bash
# 1. Create a task
ork task create -t "Add logout button" -d "Add a logout button to the navbar"

# 2. After planning is complete, approve the plan
ork task approve TASK-001

# 3. Check progress
ork task show TASK-001

# 4. (Agent completes and runs)
# ork task complete TASK-001 --summary "Added logout button with confirmation dialog"
```

### Complex Task with Subtasks

```bash
# 1. Create the main task
ork task create -t "User authentication system" -d "Complete auth with login, logout, and sessions"

# 2. Approve plan (goes to breakdown phase)
ork task approve TASK-001

# 3. Approve breakdown (spawns workers for subtasks)
ork task approve-breakdown TASK-001

# 4. Monitor subtasks
ork task subtasks TASK-001

# 5. Monitor overall progress
ork task list --status working
```

### Handling Blocked Tasks

```bash
# View all blocked tasks
ork task list --status blocked

# After resolving the blocker, update status
ork task status TASK-003 working
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (task not found, invalid input, etc.) |

---

## Tips

- Use `ork task list` frequently to monitor task status
- Always provide meaningful summaries when completing tasks
- Use descriptive reasons when blocking or failing tasks to help with debugging
- Check subtask status with `ork task subtasks <parent-id>` for complex tasks
