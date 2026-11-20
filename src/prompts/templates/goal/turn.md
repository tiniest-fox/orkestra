{{! The body of one goal composer turn. A fresh session is handed the goal whole; a
    resumed one already holds it, and is handed what changed: why it is being asked
    now, what woke it, and where every one of its traks stands. }}
{{#fresh}}
# The goal: {{title}}

{{line}}

## When it is done

{{finished}}

{{#parent}}
## A sub-goal

This goal is one part of the goal **{{parent}}**, whose plan held it. Its traks share
that goal's limits, below.

{{/parent}}
{{#branch}}
## Where its traks land

On the goal branch `{{branch}}`: each trak is cut from it and its pull request goes into
it. Once the goal is done, one pull request takes the branch into the default branch.

{{/branch}}
{{/fresh}}
{{#rules}}
## This project's rules for goals

{{rules}}

{{/rules}}
{{#drafting}}
# A goal, asked for in a sentence

{{asked}}
{{#askedFiles}}{{> attached}}{{/askedFiles}}

Its traks may open on: {{askedModes}}.

{{! A goal a trak's composer proposed as the trak finished: what that trak filed, whole,
    so the draft starts from the work already done rather than from the words alone. }}
{{#documents.length}}
## What the work that proposed it filed

{{#documents}}
### {{name}}

{{#sections}}
#### {{heading}}

{{body}}

{{/sections}}
{{/documents}}
{{/documents.length}}
{{#draftFirst}}
Read the checkout, then weigh what the sentence leaves open: how far the work goes,
the whole of what it covers, and the approach. Where answers would change the file,
ask them now with one `escalate` call. Where the sentence settles them, draft the goal
file with `draft_goal`.
{{/draftFirst}}
{{#said}}
The person wrote to you about the draft, below. Answer them, and call `draft_goal`
again if what they say changes the file.
{{/said}}
{{/drafting}}
{{^drafting}}
{{#filed}}
The person approved the goal file. Open the traks you are confident in, and list the
likely next few with `replan`.
{{/filed}}
## Limits

{{#limited}}
{{#parallel}}
- At most {{parallel}} of your traks running at once.
{{/parallel}}
{{#perHour}}
- At most {{perHour}} traks opened in any hour.
{{/perHour}}
{{#perDay}}
- At most {{perDay}} traks opened in any day.
{{/perDay}}
{{#modes}}
- Run modes allowed: {{modes}}.
{{/modes}}
{{#noAutoMerge}}
- No trak may be opened with `auto_merge`: the person merges every pull request.
{{/noAutoMerge}}
{{#alwaysAutoMerge}}
- Every trak opens with `auto_merge`, whatever you pass: its pull request merges once its
  checks pass.
{{/alwaysAutoMerge}}
{{/limited}}
{{^limited}}
None: open as many traks as the work can use, on any run mode.
{{/limited}}
{{/drafting}}

{{#started}}
Open the traks you are confident in, and list the likely next few with `replan`.
{{/started}}
{{#approved}}
The person approved the plan. Open what can run now{{#subgoalPlan.length}}, and each
sub-goal with `open_subgoal`{{/subgoalPlan.length}}.
{{/approved}}
{{#said}}
The person says:

{{said}}
{{#saidFiles}}{{> attached}}{{/saidFiles}}
{{/said}}
{{#answered}}
The person answered your questions:

{{#pairs}}
{{number}}. {{#question}}{{question}} — {{/question}}{{answer}}
{{/pairs}}
{{#note}}

And this, alongside them:

{{note}}
{{/note}}
{{/answered}}
{{#reported}}
{{#request}}
You asked the person to do this by hand: **{{request}}**

{{#steps}}
{{number}}. {{step}}
{{/steps}}

{{/request}}
{{#done}}
They report it done.
{{/done}}
{{^done}}
They report they could not do it.
{{/done}}
{{#note}}

They say:

{{note}}
{{/note}}
{{/reported}}
{{#drafting}}
{{#answered}}

Draft the goal file with `draft_goal` now, from the sentence and these answers. Call
`escalate` again instead only where an answer opened a question that would change the
file and that reading the checkout does not settle.
{{/answered}}
{{#reported}}

{{#done}}
Draft the goal file with `draft_goal` now, from the sentence and what the person did.
{{/done}}
{{^done}}
Draft the goal file with `draft_goal` now, around what could not be done. Where the
file cannot be written without it, ask again instead: `request_action` for another way
to get it done, or `escalate` for a decision about going without it.
{{/done}}
{{/reported}}
{{/drafting}}
{{#resumed}}
The person resumed the goal after a pause. Nothing was opened while it was paused.
{{/resumed}}
{{#woken}}
One or more of your traks needs you.
{{/woken}}

{{#wakes.length}}
## Since you were last asked

{{#wakes}}
{{#what}}
- `{{trak}}`: {{what}}
{{/what}}
{{#subgoal}}
- Sub-goal `{{id}}` — {{title}}: {{what}}{{#summary}}. {{summary}}{{/summary}}
{{/subgoal}}
{{#handOff.length}}
- `{{trak}}` handed off work, and nothing was opened for it:
{{#handOff}}
  - {{.}}
{{/handOff}}
{{/handOff.length}}
{{/wakes}}

{{/wakes.length}}
## Your traks

{{#traks}}
- `{{id}}` — {{title}} ({{mode}}): {{where}}
{{/traks}}
{{^traks}}
None opened yet.
{{/traks}}

{{#subgoals.length}}
## Your sub-goals

{{#subgoals}}
- `{{id}}` — {{title}}: {{where}}; traks {{opened}} opened, {{landed}} landed, {{running}} running
{{/subgoals}}

{{/subgoals.length}}
{{#plan.length}}
## The plan as it stands

{{#plan}}
1. {{title}} ({{mode}})
{{/plan}}
{{/plan.length}}
{{#subgoalPlan.length}}

### Sub-goals in the plan

{{#subgoalPlan}}
- {{title}} — {{line}}
{{/subgoalPlan}}
{{/subgoalPlan.length}}
{{#others.length}}

## Other goals going in this project

Each opens traks of its own. Before planning work near one, read what it is finished
at and its traks, and plan nothing another goal already covers.

{{#others}}
- **{{title}}**{{#line}} — {{line}}{{/line}}
{{#finished}}
  - Finished when:
{{finished}}
{{/finished}}
{{^finished}}
  - Not approved yet: it is still being drafted.
{{/finished}}
{{#traks}}
  - Trak `{{id}}` — {{title}} ({{status}})
{{/traks}}
{{^traks}}
  - No traks opened yet.
{{/traks}}
{{/others}}
{{/others.length}}
