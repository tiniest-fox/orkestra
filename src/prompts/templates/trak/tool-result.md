{{! What a call on the engine's tools answers the step with — one outcome per call, named
    by the key the engine sets. A refusal says what to do instead. }}
{{#noTurn}}Refused: no turn of this step is running, so there is nothing for this call to belong to.{{/noTurn}}
{{#toolNotOffered}}Refused: `{{toolNotOffered}}` is not one of the tools offered to this step.{{/toolNotOffered}}
{{#notOffered}}Refused: that is not one of the checks this tool runs for you. It runs {{notOffered}}.{{/notOffered}}
{{#noneOffered}}Refused: this project has no check this tool can run here.{{/noneOffered}}
{{#badArguments}}Refused: the arguments do not fit this tool. {{badArguments}}{{/badArguments}}
{{#reused}}`{{name}}` already passed on these files. Nothing ran, and it will not run again after you finish unless a file changes.{{/reused}}
{{#passed}}`{{name}}` passed, and the pass is kept: it will not run again after you finish unless a file changes.{{/passed}}
{{#unrecorded}}`{{name}}` passed, but files changed while it ran, so the pass is not kept. A step whose checks name it runs it again.{{/unrecorded}}
{{#failed}}`{{name}}` failed{{#exitCode}} with exit code {{exitCode}}{{/exitCode}}.{{/failed}}
{{#ended}}`{{name}}` was stopped when the turn ended. Nothing was kept.{{/ended}}
{{#output}}

What it printed:

```
{{output}}
```
{{/output}}
{{#noTrak}}Refused: there is no trak `{{noTrak}}`. `list_traks` gives the ids of the live ones, and with `archived: true` of the archived ones.{{/noTrak}}
{{#noGoal}}Refused: there is no goal `{{noGoal}}`. `list_goals` gives the ids.{{/noGoal}}
{{#notReadable}}Refused: {{notReadable}} is not one you may read, if it exists.{{/notReadable}}
{{#oneOf}}Refused: name exactly one of `trak` and `goal`.{{/oneOf}}
{{#storeFailed}}Refused: the engine could not read that log. {{storeFailed}}{{/storeFailed}}
{{#noTraks}}There are no other live traks in this project.{{/noTraks}}
{{#traks}}
- `{{id}}` — {{title}}
  state: {{state}}{{#step}}, at `{{step}}`{{/step}}{{#goal}}; goal `{{goal}}`{{/goal}}
{{/traks}}
{{#matchingAlone}}Refused: `matching` searches the archived traks only, so pass it with `archived: true`.{{/matchingAlone}}
{{#noArchived}}No archived trak you may read matches.{{/noArchived}}
{{#archivedTraks}}
- `{{id}}` — {{title}}
{{/archivedTraks}}
{{#archivedCut}}

Only the first {{archivedCut}} by title are listed. Pass `matching` to narrow the search.
{{/archivedCut}}
{{#read}}
Trak `{{id}}` — {{title}}
state: {{state}}{{#step}}, at `{{step}}`{{/step}}{{#goal}}; goal `{{goal}}`{{/goal}}
{{/read}}
{{#artifacts.length}}

Its documents, each read with `read_artifact`:
{{/artifacts.length}}
{{#artifacts}}
- `{{name}}`
{{/artifacts}}
{{#noArtifact}}Refused: trak `{{ofTrak}}` has filed no document `{{noArtifact}}`. `read_trak` lists the ones it has.{{/noArtifact}}
{{#artifactName}}`{{artifactName}}` of trak `{{artifactOf}}`:

{{artifactText}}
{{/artifactName}}
{{#openedGoal}}{{#again}}This call already opened goal `{{openedGoal}}`; no second goal was opened.{{/again}}{{^again}}Opened goal `{{openedGoal}}`. Its composer is drafting the goal file, which the person approves on the goal's screen before any trak is opened.{{/again}}{{/openedGoal}}
{{#unknownProcess}}Refused: no process `{{unknownProcess}}` is declared here.{{#unknownReason}} {{unknownReason}}{{/unknownReason}} `process_status` lists the ones that are.{{/unknownProcess}}
{{#noProcesses}}No process is declared here. Declare one as `.orkestra/processes/<name>.sh` in this checkout.{{/noProcesses}}
{{#processes}}
- `{{name}}` — {{#notStarted}}not started{{/notStarted}}{{#preparing}}starting: {{#readying}}waking the sandbox{{/readying}}{{#copying}}copying files into the sandbox, {{sent}} of {{total}} sent{{/copying}}{{#launching}}starting its script{{/launching}}{{/preparing}}{{#starting}}starting{{/starting}}{{#url}}running at {{url}}{{/url}}{{#notUp}}did not come up: {{notUp}}{{/notUp}}{{#exited}}exited{{#exitCode}} with code {{exitCode}}{{/exitCode}}{{#exitSignal}} on {{exitSignal}}{{/exitSignal}}{{/exited}}{{#stopped}}stopped{{/stopped}}{{#stoppedByRestart}}stopped when the engine restarted{{/stoppedByRestart}}
{{/processes}}
{{#unreadable.length}}

Declared in this checkout and not used:
{{/unreadable.length}}
{{#unreadable}}
- `{{shown}}` — {{reason}}
{{/unreadable}}
{{#log}}

The end of what it printed:

```
{{log}}
```
{{/log}}
{{#noLog}}`{{noLog}}` has printed nothing in its current run.{{/noLog}}
{{#logOf}}The last {{lines}} lines `{{logOf}}` printed, at most:

```
{{printed}}
```
{{/logOf}}
{{#noTurns}}No turn is running in this engine.{{/noTurns}}
{{#turns}}
- {{#trak}}trak `{{trak}}`, {{position}}{{/trak}}{{#goal}}goal `{{goal}}`, its composer{{/goal}}
  started {{started}}; last provider event {{#lastEvent}}{{lastEvent}}{{/lastEvent}}{{^lastEvent}}none yet{{/lastEvent}}
  runs {{#execId}}in sandbox `{{sandbox}}`, exec `{{execId}}`{{#pid}}, runner pid {{pid}}{{/pid}}{{/execId}}{{^execId}}{{#pid}}on the engine's machine, pid {{pid}}{{/pid}}{{^pid}}nowhere yet: no CLI has started{{/pid}}{{/execId}}
{{/turns}}
{{#noGoals}}There are no goals in this project.{{/noGoals}}
{{#goals}}
- `{{id}}` — {{title}}
  state: {{state}}; {{running}}{{#paused}}; {{paused}}{{/paused}}{{#owed}}; owed a turn for {{owed}}{{/owed}}; {{trakCount}}{{#offers}}; a person may press {{offers}}{{/offers}}
{{/goals}}
{{#goalRead}}
Goal `{{id}}` — {{title}}
state: {{state}}; {{running}}{{#paused}}; {{paused}}{{/paused}}{{#owed}}; owed a turn for {{owed}}{{/owed}}; {{trakCount}}{{#offers}}; a person may press {{offers}}{{/offers}}
{{/goalRead}}
{{#goalTraks.length}}

Its traks:
{{/goalTraks.length}}
{{#goalTraks}}
- `{{id}}` — {{title}} ({{status}})
{{/goalTraks}}
{{#emptyLog}}{{emptyLog}} has no transcript yet.{{/emptyLog}}
{{#entriesOf}}

The newest {{newestEvents}} entries of {{entriesOf}}, oldest first:
{{/entriesOf}}
{{#entries}}
- {{at}} {{raw}}
{{/entries}}
{{#noLogLines}}The engine has logged no warning or error that matches.{{/noLogLines}}
{{#logLines}}
- {{at}} {{level}} {{message}}
{{/logLines}}
{{#snapshotAt}}Wrote a snapshot of {{snapshotTraks}} trak(s) and {{snapshotGoals}} goal(s) to `{{snapshotAt}}` in this checkout: {{snapshotFiles}} file(s) and `index.json`, {{snapshotBytes}} bytes in all. Every file is redacted of the secret values the engine holds; a note below counts any it found.{{/snapshotAt}}
{{#snapshotOmitted.length}}

Left out, each listed in `index.json` too:
{{/snapshotOmitted.length}}
{{#snapshotOmitted}}
- `{{path}}`{{#bytes}}, {{bytes}} bytes{{/bytes}} — {{#sizeBound}}over `maxBytes`{{#unread}}, so it was not read{{/unread}}{{/sizeBound}}{{#undecodable}}the engine could not decode it{{/undecodable}}
{{/snapshotOmitted}}
{{#snapshotFailed}}Refused: the snapshot could not be written. {{snapshotFailed}}{{/snapshotFailed}}
{{#readsOnly}}

You read only the traks and goals that everyone who sees your work sees too.{{#seenBy}} That is {{seenBy}}.{{/seenBy}}{{^seenBy}} No user the host names sees your work, so you read only yourself.{{/seenBy}}{{#unasked}} The engine could not ask the host who its users are, so it counts each trak and goal as seen only by the user named as its owner: {{unasked}}{{/unasked}}
{{/readsOnly}}
{{#redacted}}{{redacted}} secret value(s) the engine holds appeared in this answer, each replaced with `[redacted]`.{{/redacted}}
