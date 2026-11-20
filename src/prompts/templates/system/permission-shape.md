{{! The step's alone: a composer has no permission gate. On every step's contract
    because it costs nothing where no call is refused.

    THE RULE IS THE POINT, NOT THE SHAPE. Refused, an agent works around the
    refusal with a variant the classifier never judged — the thing a person would
    have wanted to be asked about. The command must be exact, because the engine
    quotes it back on a yes, and that is what clears the refusal. }}
- permission: a tool call this step needs was denied by the permission system, and
  only a person's consent can allow it.
  ```json
  { "type": "permission", "command": "<the exact command that was denied>",
    "reason": "<why this step needs it>" }
  ```
  Return this instead of working around the denial — no variant of the command,
  no other route to the same goal. `command` is the denied command character for
  character: if the person allows it, you are told so and run it unchanged; if
  they refuse, carry on without it.
