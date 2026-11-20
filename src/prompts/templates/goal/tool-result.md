{{! What a goal tool call answers the composer with — one outcome per call, named by
    the key the engine sets. A refusal says why and what to do instead, because the
    composer's next move is all it can do about one. }}
{{#over}}Refused: the goal is over — done or dropped. Nothing more can be opened or changed.{{/over}}
{{#notComposing}}Refused: the goal is not in a composer turn, so there is nothing for this call to belong to.{{/notComposing}}
{{#badArguments}}Refused: the arguments do not fit this tool. {{badArguments}}{{/badArguments}}
{{#drafting}}Refused: the goal has no approved file yet. Draft it with `draft_goal`; traks open after the person approves it.{{/drafting}}
{{#filed}}Refused: the goal file is already approved, so there is nothing to draft.{{/filed}}
{{#badFile}}Refused: the draft does not make a goal file. {{badFile}}{{/badFile}}
{{#taken}}Refused: another goal in this project is already named `{{taken}}`. Pick another name.{{/taken}}
{{#paused}}Refused: the goal is paused, so nothing new is opened. Say so and end your turn; you are told when it resumes.{{/paused}}
{{#autoMergeRefused}}Refused: the goal does not let a trak merge its own pull request. Open it without `auto_merge`; its pull request then waits for the person.{{/autoMergeRefused}}
{{#mode}}Refused: the goal allows only {{allowed}} as a run mode, and this asked for {{mode}}.{{/mode}}
{{#parallel}}Refused: {{parallel}} of your traks are already running, which is the goal's limit{{#family}}, counted across the parent goal and all its sub-goals{{/family}}{{#own}}, counted over this sub-goal's own traks{{/own}}. Wait for one to land.{{/parallel}}
{{#perHour}}Refused: {{perHour}} traks were opened in the last hour, which is the goal's limit{{#family}}, counted across the parent goal and all its sub-goals{{/family}}{{#own}}, counted over this sub-goal's own traks{{/own}}. Wait for the hour to pass.{{/perHour}}
{{#perDay}}Refused: {{perDay}} traks were opened in the last day, which is the goal's limit{{#family}}, counted across the parent goal and all its sub-goals{{/family}}{{#own}}, counted over this sub-goal's own traks{{/own}}. Wait for the day to pass.{{/perDay}}
{{#nested}}Refused: this goal is a sub-goal, and a sub-goal opens traks, never sub-goals of its own. Plan the work as traks.{{/nested}}
{{#notPlanned}}Refused: the plan holds no sub-goal titled `{{notPlanned}}`. Add it with `replan` first, or use a title the plan holds.{{/notPlanned}}
{{#subgoalTaken}}Refused: the sub-goal `{{subgoalTaken}}` is already open or done.{{/subgoalTaken}}
{{#branchRefused}}Refused: the sub-goal's branch could not be made, and nothing was opened. {{branchRefused}}{{/branchRefused}}
{{#noGoalBranch}}Refused: this goal has no goal branch; its traks land on the default branch directly, so there is nothing to merge.{{/noGoalBranch}}
{{#subgoalBranch}}Refused: this goal is a sub-goal, and its branch is cut from its parent's goal branch rather than the default branch.{{/subgoalBranch}}
{{#noDefaultBranch}}Refused: `origin` names no default branch to merge from.{{/noDefaultBranch}}
{{#mergeFailed}}Refused: the default branch could not be merged into `{{branch}}` and pushed, so `origin`'s `{{branch}}` is as it was: {{reason}}. Try again after your next landing; if it keeps failing, tell the person.{{/mergeFailed}}
{{#subgoalsLive}}Refused: these sub-goals are still going: {{subgoalsLive}}. The goal is done only once each is done or dropped; you are woken as each one is.{{/subgoalsLive}}
{{#noSubgoals}}Refused: this goal is a sub-goal, and has no sub-goals of its own.{{/noSubgoals}}
{{#notYourSubgoal}}Refused: `{{notYourSubgoal}}` is not a sub-goal this goal opened.{{/notYourSubgoal}}
{{#subgoalOver}}Refused: the sub-goal `{{subgoalOver}}` is done or dropped, so nothing more reaches it.{{/subgoalOver}}
{{#subgoalPersons}}Refused: the sub-goal `{{subgoalPersons}}` is waiting at a gate, and that gate is its person's to answer.{{/subgoalPersons}}
{{#busy}}Refused: that trak is being driven already. Try again once it stops.{{/busy}}
{{#notOpened}}Refused: `{{notOpened}}` is not a trak this goal opened.{{/notOpened}}
{{#notYours}}Refused: `{{notYours}}` is not one of this goal's running traks.{{/notYours}}
{{#persons}}Refused: `{{persons}}` is waiting on the person, and that gate is theirs to answer.{{/persons}}
{{#notMoved}}Refused: `{{trak}}` was not sent the message, and nothing changed: {{why}}. Tell the person; settling the branch is theirs.{{/notMoved}}
{{#notStopped}}Refused: `{{notStopped}}` is not stopped at a gate, so it cannot be recomposed now. Send it a message instead.{{/notStopped}}
{{#drafted}}The draft is written up for the person. They see it when your turn ends.{{/drafted}}
{{#opened}}Opened trak `{{opened}}`.{{/opened}}
{{#subgoalOpened}}Opened sub-goal `{{subgoalOpened}}`. It opens its own traks, and you are woken once it is done, dropped or stuck.{{/subgoalOpened}}
{{#messaged}}Sent to `{{messaged}}`.{{/messaged}}
{{#recomposed}}`{{recomposed}}` is re-planning its remaining steps.{{/recomposed}}
{{#dropped}}Dropped `{{dropped}}`.{{/dropped}}
{{#replanned}}The plan is replaced.{{/replanned}}
{{#escalated}}The questions are asked. The person's answers are your next turn.{{/escalated}}
{{#actionRequested}}The request is up for the person. Their report — done, or why they could not — is your next turn.{{/actionRequested}}
{{#upToDate}}`{{branch}}` already holds everything on `{{base}}`. Nothing was merged.{{/upToDate}}
{{#mergedDefault}}Merged `{{base}}` into `{{branch}}` and pushed it. Traks opened from now on start from it.{{/mergedDefault}}
{{#mergeConflicted}}`{{base}}` at `{{commit}}` conflicts with `{{branch}}` in {{paths}}. Nothing was merged. Open a trak with `open_trak` that merges `{{commit}}` into its own branch, resolves these paths, and lands on the goal branch.{{/mergeConflicted}}
{{#doneProposed}}Done is proposed. The person confirms it, or says what is missing.{{/doneProposed}}
