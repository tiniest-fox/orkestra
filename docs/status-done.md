# Done Status

## Description

The Done status indicates that a task has been completed successfully. All planned work has been implemented and the task is considered finished.

## When Tasks Enter This Status

- When a worker agent completes implementation
- When all subtasks of a parent task are done
- When a task is manually marked as complete

## What Happens

1. The task is marked as complete
2. A completion summary is recorded
3. The task is archived in the task history
4. Any dependent tasks may be unblocked

## Valid Transitions From This Status

This is a terminal state. Tasks in Done status do not transition to other statuses under normal circumstances.
