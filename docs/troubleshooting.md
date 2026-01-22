# Troubleshooting Guide

This guide covers common issues you may encounter when using Orkestra and how to resolve them.

## Table of Contents

- [Installation Issues](#installation-issues)
- [Task Management Issues](#task-management-issues)
- [Agent Issues](#agent-issues)
- [UI Issues](#ui-issues)
- [Build Issues](#build-issues)
- [Debugging Tips](#debugging-tips)

---

## Installation Issues

### Cargo build fails with missing dependencies

**Error message:**
```
error: failed to run custom build command for `...`
```

**Solution:**
1. Ensure you have Rust installed: `rustup --version`
2. Update Rust to the latest version: `rustup update`
3. Install system dependencies for your platform:
   - macOS: `xcode-select --install`
   - Linux: `sudo apt-get install build-essential pkg-config libssl-dev`

### Tauri app fails to start

**Error message:**
```
Error: failed to bundle project: ...
```

**Solution:**
1. Ensure Node.js is installed: `node --version`
2. Install frontend dependencies: `npm install`
3. Verify Tauri CLI is installed: `cargo install tauri-cli`
4. Try rebuilding: `npm run tauri build`

---

## Task Management Issues

### Task stuck in "Planning" status

**Symptoms:**
- Task shows "Planning" but no agent activity
- No logs appearing for the task

**Resolution steps:**
1. Check if an agent is running: `ps aux | grep claude`
2. View task logs: `ork task show TASK-XXX`
3. If agent crashed, resume the task: via the UI or restart planning
4. Check `.orkestra/tasks.jsonl` for any corrupted entries

### Tasks not appearing in the UI

**Symptoms:**
- Created tasks don't show in Kanban board
- Task list appears empty

**Resolution steps:**
1. Refresh the browser/UI
2. Check the task file exists: `cat .orkestra/tasks.jsonl`
3. Verify you're in the correct project directory
4. Restart the Tauri application

### "Task not found" error

**Error message:**
```
Error: Task with ID TASK-XXX not found
```

**Solution:**
1. Verify the task ID is correct: `ork task list`
2. Check if the task was deleted or if the JSONL file was modified
3. Ensure you're in the project root directory

---

## Agent Issues

### Agent fails to spawn

**Error message:**
```
Error: Failed to spawn Claude Code instance
```

**Resolution steps:**
1. Verify Claude Code CLI is installed and accessible
2. Check PATH environment variable includes Claude
3. Try running Claude manually: `claude --version`
4. Check system resources (memory, CPU)

### Agent not completing tasks

**Symptoms:**
- Agent starts but never calls `ork task complete`
- Task stays in "InProgress" indefinitely

**Resolution steps:**
1. Check agent logs for errors: `ork task show TASK-XXX`
2. The agent may have hit a complex issue - check its output
3. Manually fail the task if needed: `ork task fail TASK-XXX --reason "Agent timeout"`
4. Retry with a more specific task description

### Agent makes incorrect changes

**Symptoms:**
- Code changes don't match expected behavior
- Wrong files modified

**Resolution steps:**
1. Review the task description for clarity
2. Use git to inspect changes: `git diff`
3. Revert unwanted changes: `git checkout -- <file>`
4. Request changes during review phase with specific feedback

---

## UI Issues

### Kanban board not updating

**Symptoms:**
- Task status changes not reflected in UI
- Drag and drop not working

**Resolution steps:**
1. Refresh the page (Cmd/Ctrl + R)
2. Check browser console for JavaScript errors
3. Restart the Tauri dev server: `npm run tauri dev`
4. Clear browser cache if using web version

### Task detail sidebar not loading

**Symptoms:**
- Clicking a task doesn't show details
- Sidebar appears empty or stuck loading

**Resolution steps:**
1. Check for JavaScript errors in console
2. Verify the task exists: `ork task show TASK-XXX`
3. Restart the application
4. Check network tab for failed API calls

---

## Build Issues

### Rust compilation errors

**Error message:**
```
error[E0xxx]: ...
```

**Resolution steps:**
1. Run `cargo clean` then `cargo build`
2. Check for syntax errors in recent changes
3. Ensure all dependencies are up to date: `cargo update`
4. Review the specific error code in Rust documentation

### Frontend build failures

**Error message:**
```
npm ERR! ...
```

**Resolution steps:**
1. Delete `node_modules` and reinstall: `rm -rf node_modules && npm install`
2. Clear npm cache: `npm cache clean --force`
3. Check Node.js version compatibility
4. Look for TypeScript errors: `npm run build`

### Type errors in TypeScript

**Error message:**
```
TS2xxx: Type '...' is not assignable to type '...'
```

**Resolution steps:**
1. Check the specific file and line mentioned
2. Ensure type definitions are up to date
3. Run `npm run build` to see all type errors
4. Fix type mismatches in the order they appear

---

## Debugging Tips

### Enable verbose logging

Set the `RUST_LOG` environment variable for detailed output:
```bash
RUST_LOG=debug cargo run
```

### Inspect task data directly

View raw task data:
```bash
cat .orkestra/tasks.jsonl | jq '.'
```

View last N entries:
```bash
tail -n 10 .orkestra/tasks.jsonl | jq '.'
```

### Check agent prompts

Agent definition files are located in `.orkestra/agents/`:
- `planner.md` - Planner agent instructions
- `worker.md` - Worker agent instructions

### Reset task database

If the task database is corrupted:
```bash
# Backup first
cp .orkestra/tasks.jsonl .orkestra/tasks.jsonl.backup

# Delete and start fresh
rm .orkestra/tasks.jsonl
```

### Monitor agent output in real-time

When an agent is running, you can watch its output:
```bash
# In a separate terminal, tail the task logs
ork task show TASK-XXX --follow  # if supported
```

### Common log patterns to look for

- `"status": "Failed"` - Task encountered an error
- `"error"` - General error messages
- `"spawn"` - Agent spawn events
- `"complete"` - Task completion signals

---

## Getting Help

If you can't resolve an issue:

1. Check existing GitHub issues for similar problems
2. Collect relevant logs and error messages
3. Note your environment (OS, Rust version, Node version)
4. Open a new issue with detailed reproduction steps
