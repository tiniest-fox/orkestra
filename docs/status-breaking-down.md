# BreakingDown Status

## Description

The BreakingDown status indicates that a task is being decomposed into smaller subtasks. This happens when a task is too large or complex to be implemented in a single work session.

## When Tasks Enter This Status

- After planning determines the task should be split
- When a task is explicitly marked for breakdown

## What Happens

1. The system analyzes the approved plan
2. Subtasks are created for each logical unit of work
3. Dependencies between subtasks are established
4. The parent task transitions to waiting on subtasks

## Valid Transitions From This Status

- **WaitingOnSubtasks**: After subtasks are created
- **Failed**: If breakdown cannot be completed
- **Blocked**: If clarification is needed
