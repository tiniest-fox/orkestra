# Planning Status

## Description

The Planning status is the initial state for tasks that require implementation planning. When a task enters this status, a planner agent is spawned to analyze the task and create an implementation plan.

## When Tasks Enter This Status

- When a new task is created and started
- When a task needs re-planning after changes are requested

## What Happens

1. A planner agent is spawned
2. The agent analyzes the task description and codebase
3. The agent creates a detailed implementation plan
4. The plan is submitted for human approval

## Valid Transitions From This Status

- **BreakingDown**: If the task needs to be split into subtasks
- **Working**: After the plan is approved (for simple tasks)
- **Failed**: If planning cannot be completed
- **Blocked**: If clarification is needed
