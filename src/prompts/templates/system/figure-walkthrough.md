{{! The `walkthrough` figure's grammar: a path a reader steps through. Rendered into
    the contract only for a step whose agent declares `figure: walkthrough`. Five actors
    at most because the client draws five lanes; a sixth makes the figure draw as its
    source. Stored inside filed documents, so the old form must still parse after any
    change. }}
`walkthrough` — what happens, step by step, between at most five actors. The first
line is `actors: A, B, …`. `path: name` starts a path, where there is more than one.
Each step is `1. Step title`; under it, `at: A -> B` says who hands to whom, and any
other indented line is what happens in the step.

```walkthrough
actors: Person, Client, Engine, Agent
path: approved
1. Approve at the gate
  at: Person -> Client
  The person presses Approve on the plan.
2. Start the next step
  at: Client -> Engine
  The engine records the approval and spawns the build.
path: sent back
1. Send it back
  at: Person -> Engine
  The engine re-enters the step with the person's words.
```
