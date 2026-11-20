{{! The full prompt for a run with a fresh session, which is a step's first
    attempt — including the first attempt of a step a revised plan put here.
    Later attempts on a live session get the step-* body named for the trigger
    that caused them.

    `instruction` is the composer's, always. A replan writes the instruction into
    the new plan entry.

    It ends at the work. The envelopes and the declared sections are on the
    session's system prompt (system.md + system/step.md), because neither changes
    between this step's turns.

    **The instruction leads**, and `intent` — what was asked, and the requirements
    since — follows it: the shortest and most specific thing in the prompt goes where
    it is read first. }}
# This step

{{instruction}}

{{! A skipped step files nothing, so its absence looks exactly like a step that
    has not run — which is the one thing a later agent must not conclude. What
    the human said lands here rather than in a channel of its own, because it is
    the same kind of thing as the instruction above it. }}
{{#afterSkip}}
`{{skippedName}}` was skipped, so there is no document from it and there will not
be one. {{#skipMessage}}The person running this said: {{skipMessage}}{{/skipMessage}}

{{/afterSkip}}
{{! A step started by a person before its condition was met. Said here for the
    reason the skip above is: how this turn came to run is the same kind of thing
    as the instruction. The one fact that matters is that the condition does not
    hold — a step that waits for a deploy and is started early must not report on
    a deploy that has not happened. }}
{{#skippedWait}}
This step was held until `{{skippedWait}}` was met, and it is not: a person
started the step anyway. Do not take what that condition waits for as having happened, and say
in the artifact where that limits what you can do.

{{/skippedWait}}
{{> intent}}
{{#guidance}}
{{guidance}}

{{/guidance}}
{{brief}}

{{! Mechanism, beside the deny list the provider builds from the same declaration.
    An agent that finds `Edit` denied and does not know why does not shrug and
    continue — it works around the denial, or spends turns discovering the
    boundary. One fixed sentence, nothing per-tool and nothing in `.orkestra/`. }}
{{#readOnly}}
The tools that edit files are denied for this step. Your output is the artifact,
not a change to the repository — a later step makes the change.

{{/readOnly}}
{{! The composer template's fact, shorter: a step is told where its branch goes so
    a step that opens a pull request, or writes as if the main line were next, is
    not doing so for want of being told. Guarded on having a parent — see
    `parentView` for why neither flag below will do. }}
{{#hasParent}}
## This trak is a child

This trak was spawned by another trak, its parent. Its branch was cut from the
parent's branch rather than from the main line, and when it finishes its work is
merged back into the parent's worktree — not into the main line.

{{/hasParent}}
{{! A child of a spawn is one piece of work that was decided somewhere else, so
    the documents behind that decision are on disk here too — under their own
    directory, because a child's own positions are numbered from zero and would
    otherwise collide with the parent's.

    Paths rather than documents, on the same argument as the plan below: the one
    that matters is injected in full under "The step before yours", and the rest
    are a tool call away. Absent for a trak nobody spawned. }}
{{#hasInherited}}
## The work this is a piece of

These were produced before this piece was split out, and they are what it was
split out of.

{{#inherited}}
- {{name}} — `{{path}}`
{{/inherited}}

{{/hasInherited}}
{{! The rule that has to arrive with the roster in `trak.md`, and it is here rather
    than in that file because a document is data and this is an instruction. Absent
    unless another piece exists — a rule about work that falls to nobody is where
    boilerplate blindness starts, so a spawn of one and an ordinary trak see neither
    half.

    IT REACHES THE STEP AGENT AND NOT ONLY THE COMPOSER, deliberately. The false
    finding this exists to stop was filed by a step that opened the file, found no
    trace of the half it expected, and cited each claim correctly — every one true of
    its checkout and false of the finished work. The turn that verifies hardest is the
    one that confirms a stale world hardest, and a composer told afterwards is being
    asked to overrule better evidence than its own.

    It names `unplanned_work` because that channel's own definition is what the agent
    is otherwise following correctly: a child's plan is one piece, so everything
    outside it satisfies *work this plan does not have* read literally. }}
{{#hasSiblings}}
## The pieces beside this one

This work was split, and this is one piece of it. `.orkestra/.trak/trak.md` names
every piece and marks which one is yours. The others are being done at the same
time, in checkouts of their own — **their work is not in this one, and nothing here
will tell you whether it exists yet.**

So **a gap that belongs to another piece is not work this plan is missing.** A claim
you can check about it is true of this checkout and false of the finished work. Do
not build it, and do not file it as `unplanned_work` — say what this piece needs from
that one, as a `constraint`, and do your own piece.

**Work that belongs to no piece is `unplanned_work`.** Nobody else is doing it, and
this trak's composer hands it up to the parent when this piece lands. Recorded as any
other kind, it stops here.

{{/hasSiblings}}
{{! One list: a step that has finished has written its artifact to a file, and
    what is here is its path — a whole document per entry would make the last step
    of a long plan pay for every one it mostly does not need.

    A spawn entry lists its pieces under it, indented, because it is N traks
    rather than one turn and there is no single document behind it — a step after
    one is meant to read them all. Each piece lists every document it filed, one
    level further in, since a piece of two steps hands back both. }}
{{#hasPlan}}
## The plan

{{#plan}}
- {{name}}{{#here}}  ← YOU ARE HERE{{/here}}{{#skipped}}  — skipped{{/skipped}}{{#path}} — `{{path}}`{{/path}}
{{#children}}
  - {{name}}
{{#documents}}
    - {{name}} — `{{path}}`
{{/documents}}
{{/children}}
{{/plan}}

{{/hasPlan}}
{{! The one document still injected, and on a narrower argument than the rest: a
    sequential pipeline's handoff is what a step almost always needs, so making
    the common case a tool call buys nothing. }}
{{#hasPreceding}}
## The step before yours: {{precedingName}}

Here in full, so you do not have to open it. Everything earlier is a path above.

{{precedingText}}

{{/hasPreceding}}
{{! What will judge the work, said before it starts. An agent that knows a check
    is coming can run it itself, which is the cheapest place to catch a failure —
    the alternative is a whole extra iteration spent being told.

    Two lists, kept apart: the checks that run after this step, and every check the
    tool takes, which is the project's whole set that keeps a pass. A step with none
    of its own is told so in words, or it reads the tool's list as what will judge it. }}
{{#checkSection}}
{{#hasChecks}}
## Checks that will run on your artifact

These run against the repository as soon as you finish, and each must pass. A
failure comes back to you.

{{#checks}}
- `{{name}}` — {{description}}
{{/checks}}

{{#hasCheckTool}}
Run them before you finish with the `run_check` tool on the `orkestra-trak` server,
not the script or the command behind it. It runs the script the engine runs after you,
and a pass it records on these files is not run again.{{#untooled}} For the others,
run only what your change touches.{{/untooled}}
The tool takes {{checkTool}} — every check this project keeps a pass for, not only
the ones above.
{{/hasCheckTool}}
{{^hasCheckTool}}
Before you finish, run only what your change touches.
{{/hasCheckTool}}

{{/hasChecks}}
{{^hasChecks}}
## Checks you can run

No check runs on your artifact once you finish.

The `run_check` tool on the `orkestra-trak` server takes {{checkTool}} — every check
this project keeps a pass for. To run one whole, call the tool rather than the script
or the command behind it: a pass it records on these files is not run again while the
files stay as they are.

{{/hasChecks}}
{{/checkSection}}
{{! Mechanism: which servers are up in this checkout for this turn, and where. The
    engine started the ones the agent lists before the turn, and a start that failed
    does not stop the turn — so the agent has to be told, or it reads a refused
    connection as a bug in the work. }}
{{#hasProcesses}}
## Processes running in this checkout

{{#processes}}
- `{{name}}` — {{description}} {{#url}}Running at {{url}}, which is also in `${{variable}}`.{{/url}}{{#down}}**Not running:** {{#didNotComeUp}}it did not come up. {{reason}}{{/didNotComeUp}}{{#exited}}it exited{{#exitCode}} with code {{exitCode}}{{/exitCode}}.{{/exited}}{{#stopped}}it was stopped.{{/stopped}}{{#stoppedByRestart}}it was stopped when the engine restarted.{{/stoppedByRestart}}{{#notStarted}}it has not started.{{/notStarted}}{{/down}}
{{/processes}}

{{/hasProcesses}}
{{! Mechanism: the process tools on the session's server, and the one way to keep a
    process up past the turn. Background work dies when the turn files, so an agent
    that backgrounds a server loses it and reads the loss as a bug in the work. }}
{{#processTools}}
## Processes you can manage

The `orkestra-trak` server manages this trak's declared processes:
`process_status` for every one or one `name`, and `start_process`, `restart_process`,
`stop_process` and `process_logs` for one `name`. Restart one after a change it does
not pick up by itself, rather than starting a server of your own.

A process you need past your turn — a dev server, a watcher — is declared as a script
in this checkout and started with `start_process`. Never start one in the background
yourself: that is stopped when you file. The script is `.orkestra/processes/<name>.sh`, executable,
serving on `$PORT`, with a header the engine reads:

```bash
#!/bin/bash
# ---
# description: What it is, told to every turn it runs beside.
# ---
exec your-server --port "$PORT"
```

{{/processTools}}
Produce the artifact named `{{artifactName}}`.
