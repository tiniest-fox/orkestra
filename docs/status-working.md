# Working Status

## Description

The Working status indicates that a task is actively being implemented by a worker agent. This is the main implementation phase where code changes are made.

## When Tasks Enter This Status

- After a plan is approved
- When a task is resumed after review changes are requested

## What Happens

1. A worker agent is spawned
2. The agent implements the approved plan
3. Code changes are made to the codebase
4. Tests may be run to verify changes
5. The agent reports completion or failure

## Valid Transitions From This Status

- **Done**: When implementation is completed successfully
- **Failed**: If implementation cannot be completed
- **Blocked**: If the agent encounters an issue requiring human input
