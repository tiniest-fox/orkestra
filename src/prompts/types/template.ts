// types: the set of system prompts, and the names by which they are addressed.
//
// Data only. The service Tag lives in ports/, the loader in adapters/ — which is
// what lets workflow/domain import this file without reaching Context or Layer.

/**
 * Every piece of text this system sends to an agent, keyed by name.
 *
 * These are MECHANISM: implementation-neutral guidance about how an agent should
 * behave inside Orkestra. They ship with the tool, are versioned with it, and
 * live in `src/prompts/templates/*.md`.
 *
 * They are NOT the user's prompts. Project-specific guidance — an agent's brief,
 * composition conventions, `ORKESTRA.md` — is POLICY, lives in `.orkestra/`, and
 * arrives as data to be injected into these templates. The split is the point: a
 * user edits what the agent should know, never how Orkestra frames a turn.
 */
export const TEMPLATE_NAMES = [
  /**
   * The standing brief, stated on the session rather than rendered into a prompt
   * body — a resume prompt carries only what is new, so a rule that must always
   * hold has nowhere else to live. A CLI with no session prompt is handed it in
   * the body once, when the conversation opens.
   *
   * `system` is the shared core; `system/step` and `system/composer` are the
   * role's output contract, rendered separately by `buildSystemPrompt` as the
   * brief's other half. Everything under `system/` is therefore constant for the
   * life of a session, which is exactly why it is stated on the session instead
   * of at the end of every prompt body.
   *
   * A name may contain a slash: it is a map key, and both the loader and the
   * tests turn it into a path with `join(dir, `${name}.md`)`.
   */
  "system",
  "system/step",
  "system/composer",
  // One body per Trigger, for each of the two roles that take one. A step gets
  // the full `step` prompt on a fresh session and one of the resume bodies on a
  // live one; the composer is the same shape, and its `Reconsulted` turn renders
  // the full body because a replan is a fresh session by decision. `prompt.ts`
  // picks between them with an exhaustive Match, so another trigger is a compile
  // error rather than a body that quietly renders the wrong words.
  "step",
  "step-message",
  "step-answers",
  "step-unanswered",
  "step-unread",
  "step-filing",
  "step-check-failure",
  "step-interrupted",
  "step-permitted",
  "step-refused",
  "composer",
  "composer-message",
  "composer-answers",
  "composer-unanswered",
  "composer-interrupted",
  "elicit-retry",
  // Not a body: appended to whichever one a session is sent next after a filing of
  // its own stopped background work. See `withStopped` in `prompt.ts`.
  "stopped-tasks",
  // The step's reason for that retry when an artifact holds a diagram that does not parse.
  "diagram-refused",
  // The reason for that retry when the block a response ends on was written as an
  // envelope and does not parse.
  "envelope-unparsed",
  // Not a body: what the setup hook refuses a shell command with once setup has failed,
  // written into the status file it reads.
  "setup-failed",
  // Partials: included by the above rather than rendered directly, and placed by
  // what they belong to rather than by being partials. Everything under `system/`
  // is the output contract and is stated once per session; `intent` is a block of
  // a per-turn body, shared by the two fresh-session prompts because the request
  // and the decisions since it are one thing on either of them.
  "intent",
  // The composer's alone, and it renders as nothing on a first compose. One
  // partial for all four reasons it gets asked again, because they are one
  // question asked from a position — only the paragraph naming the reason
  // branches.
  "reconsult",
  // The paragraph naming the reason, split out of `reconsult` because it renders twice
  // on one turn — once for the ask that stands, once from inside its own Replanned
  // block for the ask a raced recompose displaced.
  "reconsult-why",
  // The composer's too, and the one partial every composer body includes: the run
  // that lands spends `Trak.handUps` whichever body it was sent, so each has to show
  // them. Nothing on most turns.
  "handed-up",
  // The files a person sent with what they wrote, as paths: included after the words in
  // every body that carries them, and nothing where none were sent.
  "attached",
  // Not a body: a message written down a running turn's pipe, with its files listed after
  // it — the one place a person's words reach an agent without a turn of their own.
  "steered",
  // Not a turn's body: the description the git bar fills the New Trak page with when a
  // reconcile would conflict. A person starts that trak, so it is rendered for a route.
  "resolve-conflict",
  "system/contract",
  "system/requirements",
  "system/corrections",
  // Included by both halves of the contract, because it is one question asked of both
  // roles about the turn they just took — two paragraphs for one field would be two
  // vocabularies the engine compares as though they were one.
  "system/ambiguity",
  "system/output-shape",
  // One grammar per figure a section may ask for with `figure:`. Rendered into the view
  // rather than included as partials, so a step is taught only the grammars its
  // sections declare — `prompt.ts` maps each figure name to its template here.
  "system/figure-decision",
  "system/figure-scope",
  "system/figure-criteria",
  "system/figure-files",
  "system/figure-table",
  "system/figure-overview",
  "system/figure-walkthrough",
  "system/figure-changes",
  "system/figure-runs",
  "system/questions-shape",
  "system/permission-shape",
  // The step's half alone: the repository skills its agent names, and nothing for most.
  "system/skills",
  // A goal's composer: its standing brief, the body of each turn, and one description
  // per tool on the server its session is handed — sent as that tool's description.
  "goal/brief",
  "goal/turn",
  "goal/tool-draft_goal",
  "goal/tool-open_subgoal",
  "goal/tool-open_trak",
  "goal/tool-message_trak",
  "goal/tool-recompose_trak",
  "goal/tool-drop_trak",
  "goal/tool-message_subgoal",
  "goal/tool-drop_subgoal",
  "goal/tool-replan",
  "goal/tool-escalate",
  "goal/tool-merge_default_branch",
  "goal/tool-request_action",
  "goal/tool-propose_done",
  // What each of those calls answers with: one outcome per call, refusals included.
  "goal/tool-result",
  // What `message_subgoal` wakes a sub-goal's composer with: the message, and who wrote it.
  "goal/subgoal-message",
  // A step's turn: the engine's tools on the server its session is handed — the check
  // tool, and the ones the engine's own agent is offered — each one's description, and
  // what a call answers with.
  "trak/tool-run_check",
  "trak/tool-turn_status",
  "trak/tool-list_traks",
  "trak/tool-read_trak",
  "trak/tool-read_artifact",
  "trak/tool-list_goals",
  "trak/tool-read_goal",
  "trak/tool-read_transcript",
  "trak/tool-read_events",
  "trak/tool-engine_log",
  "trak/tool-snapshot_logs",
  "trak/tool-open_goal",
  "trak/tool-process_status",
  "trak/tool-start_process",
  "trak/tool-restart_process",
  "trak/tool-stop_process",
  "trak/tool-process_logs",
  "trak/tool-result",
  // What a call answers when an engine restart cut it: the sandbox's relay resent it to the
  // engine that came back, which runs nothing for it.
  "trak/lost-to-restart",
] as const

export type TemplateName = (typeof TEMPLATE_NAMES)[number]

export type Templates = ReadonlyMap<TemplateName, string>
