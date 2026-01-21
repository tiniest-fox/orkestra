# Orkestra Roadmap

## Phase 0: Foundation (MVP)
**Goal**: Prove the core loop works

### Deliverables
- Tauri desktop app with kanban UI
- JSONL task storage
- CLI for agent state updates
- Worker agent spawning
- File watcher for live updates

### Task Flow
```
User creates task → Agent picks up → Agent completes → Human reviews → Done
```

### Definition of Done
- Can create task in UI
- Worker agent automatically starts
- Task moves through states
- Failed tasks show red
- State persists across restarts

---

## Phase 1: Planning & Approval
**Goal**: Add human checkpoints before work begins

### Deliverables
- Planner agent definition
- Plan approval UI
- `unscoped` → `planning` → `planned` → `approved` flow
- Rejection with feedback

### Task Flow
```
User creates task → Planner scopes → Human approves plan → Worker implements → Human reviews → Done
```

### New States
- `unscoped`: Just created
- `planning`: Planner agent working
- `planned`: Awaiting human approval
- `approved`: Ready for implementation

### New CLI Commands
```bash
orkestra task submit-plan TASK-123 --plan "The plan markdown..."
```

---

## Phase 2: Review Agents
**Goal**: Automated quality gates before human review

### Deliverables
- Reviewer agent definitions (security, simplicity, etc.)
- Review feedback model
- Sub-task creation for requested changes
- Review workflow UI

### Task Flow
```
... → Worker completes → Reviewer checks → [pass/fail] → Human reviews → Done
```

### New States
- `ready_for_review`: Work done, needs automated review
- `reviewing`: Reviewer agent working
- `changes_requested`: Reviewer found issues
- `approved_for_merge`: All reviewers passed

### Sub-task Model
```typescript
interface SubTask {
  id: string;
  parent_task_id: string;
  description: string;  // "Fix SQL injection in auth.ts:45"
  status: 'pending' | 'resolved';
  created_by: string;   // "reviewer:security"
}
```

---

## Phase 3: Epics & Context
**Goal**: Group related work, provide richer context to agents

### Deliverables
- Epic CRUD (UI + CLI)
- Epic → Task hierarchy
- Context passing (epic description, related tasks, file history)
- Epic-level status view

### Data Model
```typescript
interface Epic {
  id: string;
  title: string;
  description: string;
  status: 'active' | 'completed' | 'archived';
  branch?: string;
  pr_url?: string;
}
```

### Context Injection
Agents receive:
- Current task details
- Parent epic description
- Summaries of completed tasks in epic
- Relevant file paths

---

## Phase 4: Git Integration
**Goal**: Tie work to branches and PRs

### Deliverables
- Branch association per epic
- PR link storage
- Branch/PR sidebar in UI
- Quick-create task from PR comments

### UI Addition
```
┌──────────────┬──────────────────────────────────────┐
│   Branches   │            Kanban Board              │
│              │                                      │
│ ● main       │  [Pending] [In Progress] [Review]   │
│ ○ feature/x  │                                      │
│   └─ PR #42  │                                      │
│ ○ feature/y  │                                      │
│              │                                      │
└──────────────┴──────────────────────────────────────┘
```

---

## Phase 5: Git Worktrees
**Goal**: Parallel work on multiple branches without conflicts

### Deliverables
- Automatic worktree creation per epic
- Agent spawning in correct worktree
- Worktree cleanup on epic completion
- UI indication of worktree status

### Workflow
1. Create epic → auto-create worktree + branch
2. Agents work in isolated worktree
3. No cross-contamination between parallel work streams
4. Merge worktree back on completion

---

## Phase 6: Agent Output & Debugging
**Goal**: Visibility into what agents are doing

### Deliverables
- Live output streaming (optional)
- Output history per task
- Agent log viewer in UI
- Restart failed agent button

### UI Addition
```
┌─────────────────────────────────────────────────────┐
│ Task: TASK-123 - Implement login form               │
├─────────────────────────────────────────────────────┤
│ Status: in_progress                                 │
│ Agent: worker                                       │
│ Started: 2 minutes ago                              │
├─────────────────────────────────────────────────────┤
│ Output:                                             │
│ > Reading src/components/LoginForm.tsx...           │
│ > Creating form validation...                       │
│ > Running tests...                                  │
│ > █                                                 │
└─────────────────────────────────────────────────────┘
```

---

## Phase 7: Orchestrator Chat
**Goal**: Natural language interface for task creation

### Deliverables
- Chat panel in UI
- Chat-to-task conversion
- Orchestrator agent (or just structured prompting)
- Quick actions from chat

### Workflow
```
User: "I need to add password reset functionality"
Orkestra: "I'll create a task for that. Should I have the planner break it down?"
User: "Yes"
Orkestra: [Creates task, assigns to planner]
```

---

## Phase 8: Polish & Quality of Life
**Goal**: Make it pleasant to use daily

### Deliverables
- Keyboard shortcuts
- Drag-and-drop task reordering
- Task search/filter
- Dark mode
- Notifications for state changes
- Settings panel

---

## Future Possibilities (Not Planned)

These might be valuable but are explicitly not on the roadmap:

- **Multi-project support**: Switch between repos
- **Team features**: Shared task state beyond git
- **External integrations**: Asana, Linear, Jira, Slack
- **Custom agent types**: User-defined roles
- **Agent memory**: Persistent context across sessions
- **Windows/Linux support**: Cross-platform builds
- **Cloud sync**: State sync without git
- **Analytics**: Track agent performance, success rates

---

## Version Mapping

| Version | Phase | Key Feature |
|---------|-------|-------------|
| 0.1.0   | 0     | MVP - Basic task flow |
| 0.2.0   | 1     | Planning & approval |
| 0.3.0   | 2     | Review agents |
| 0.4.0   | 3     | Epics & context |
| 0.5.0   | 4     | Git integration |
| 0.6.0   | 5     | Git worktrees |
| 0.7.0   | 6     | Agent output |
| 0.8.0   | 7     | Orchestrator chat |
| 1.0.0   | 8     | Polish |
