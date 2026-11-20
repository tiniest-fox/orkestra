Write every trak and goal this trak may read whose log has an event in a time window into
this checkout as JSON-lines files, for questions across many traks at once — answer them
with `jq` over the files rather than one `read_events` call per trak. Each one selected is
written whole, events before the window included: `traks/<id>/` and `goals/<id>/` each hold
`log.jsonl`, its events as stored with `at` in milliseconds; `engine.jsonl`, the engine's
warning and error lines naming it, where there are any; and `transcript.jsonl` where
`transcripts` is true. `index.json` at the root lists what was selected, every file with
its size, and every file left out with why. Archived traks are included. Every file is
redacted of the secret values the engine holds.

`since` is an ISO time, or `hours` is how far back from now — 24 hours where neither is
given; `until` is an ISO time, now where it is not given. `states` keeps only those whose
state is one of the names `list_traks` and `list_goals` show, such as `Failed`; `name`
keeps only those whose title or id contains it, ignoring case. `maxBytes` bounds the
whole snapshot, 25000000 where it is not given: over it, whole files are left out —
transcripts first, then the traks and goals whose last event is oldest. It writes under
`.orkestra/.snapshots/<time>/`, which git ignores, and never into the engine's state.
