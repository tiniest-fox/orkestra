# Failed Status

## Description

The Failed status indicates that a task could not be completed. This may be due to technical issues, invalid requirements, or other problems that prevented successful implementation.

## When Tasks Enter This Status

- When an agent reports failure
- When a critical error occurs during planning or implementation
- When a task is manually marked as failed

## What Happens

1. The failure reason is recorded
2. The task is marked as failed
3. Any dependent tasks may need to be reviewed
4. Human intervention may be required

## Valid Transitions From This Status

- **Planning**: If the task is retried with new approach
- **Blocked**: If waiting for external resolution

Failed is typically a terminal state but tasks can be retried.
