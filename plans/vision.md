# Orkestra Vision

## What Is Orkestra?

Orkestra is a lightweight desktop application for orchestrating multiple Claude Code instances. It provides a visual interface for managing AI-driven development workflows, where specialized agents handle planning, coding, and reviewing tasks with human oversight at key decision points.

## Core Principles

### 1. Agent Experience First
Everything is designed to make it easy for Claude Code agents to understand context, perform work, and report status. Simple CLI commands, clear task descriptions, structured data.

### 2. Local-First, Git-Native
All state lives in the project repository (`.orkestra/`). Sharing happens through git. No external services, no accounts, no sync infrastructure.

### 3. Human-in-the-Loop at Decision Points
Agents work autonomously within their scope, but humans approve plans and review code before it ships. Trust but verify.

### 4. Start Simple, Extend Later
Build for one user (you) first. No configurability, no plugins, no multi-platform support until the core works well.

## The Problem

Running multiple Claude Code sessions for parallel work is manageable but chaotic:
- Hard to track what each session is working on
- No structured handoff between planning, execution, and review
- Context gets lost between sessions
- No visibility into overall progress

## The Solution

A kanban-style interface where:
- Tasks flow through defined states (planning → working → reviewing → done)
- Specialized agents pick up tasks appropriate to their role
- All context is preserved and passed to agents automatically
- You can see at a glance what's happening across all work streams

## User Workflow

1. **Add a task**: Describe what you want done
2. **Planning**: A planner agent scopes the work and creates a plan
3. **Approval**: You review and approve (or refine) the plan
4. **Execution**: Worker agents implement the plan
5. **Review**: Reviewer agents check the work, flag issues
6. **Final Review**: You review the code and approve for merge
7. **Done**: Work is committed/merged

## Key Concepts

### Epics
A coherent unit of work that typically results in one PR. Contains multiple tasks. Represents a feature, fix, or improvement.

### Tasks
Individual pieces of work within an epic. Has a state, assigned agent type, description, and context.

### Sub-tasks
Lightweight units attached to tasks, typically created by reviewers to track required fixes. Act as requirements that must be resolved before the parent task can proceed.

### Agents
Claude Code instances with specific roles defined by markdown files:
- **Planner**: Breaks down requests into actionable plans
- **Worker**: Implements code changes
- **Reviewer**: Checks work quality, security, correctness

### Orchestrator
The central coordinator (the app itself + optional chat interface) that manages task flow and spawns agents.

## Non-Goals (For Now)

- Cross-platform support (macOS only)
- Multi-user/team features (git handles sharing)
- Plugin architecture (hardcoded integrations first)
- Asana/Linear/Jira integration
- Git worktree management (close follow, but not MVP)
- Agent memory/context sharing across sessions
- Automatic retry on failure

## Success Criteria

The MVP is successful when you can:
1. Add a task via the UI
2. Have a worker agent pick it up and complete it
3. See the task move through states on the kanban board
4. Know when something fails (red indicator)
5. All state persists across app restarts
