# WaitingOnSubtasks Status

## Description

The WaitingOnSubtasks status indicates that a parent task is waiting for its child subtasks to complete. The parent task cannot proceed until all blocking subtasks are done.

## When Tasks Enter This Status

- After a task has been broken down into subtasks
- When subtasks are created for a parent task

## What Happens

1. The parent task remains in this status
2. Subtasks are worked on independently
3. Progress is tracked as subtasks complete
4. When all subtasks are done, the parent can proceed

## Valid Transitions From This Status

- **Done**: When all subtasks are completed successfully
- **Failed**: If a critical subtask fails
- **Blocked**: If subtasks encounter blocking issues
