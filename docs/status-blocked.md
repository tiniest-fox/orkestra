# Blocked Status

## Description

The Blocked status indicates that a task cannot proceed due to external dependencies or issues requiring human intervention. The task is waiting for something to be resolved before it can continue.

## When Tasks Enter This Status

- When an agent needs clarification from a human
- When external dependencies are not met
- When a task is blocked by another task
- When manual intervention is required

## What Happens

1. The blocking reason is recorded
2. The task waits for resolution
3. Human review may be triggered
4. Notifications may be sent to stakeholders

## Valid Transitions From This Status

- **Planning**: If the task needs re-planning after unblock
- **Working**: If the task can resume implementation
- **Failed**: If the blocking issue cannot be resolved
