# Orkestra reference

How a project tells Orkestra what to do: every file under `.orkestra/`, what each key
in it means, and what the engine does with it. Written for an agent setting Orkestra up
in somebody else's repository.

Start with [concepts](concepts.md), then open the page for the file you are writing.

| Page | Covers |
|---|---|
| [concepts.md](concepts.md) | trak, step, goal, artifact, composer, check, process and gate |
| [agents.md](agents.md) | `.orkestra/agents/*.md`, every frontmatter key, and how a project file layers over a shipped agent |
| [fleet.md](fleet.md) | the agents Orkestra ships, what each is for, and `fleet.yaml` |
| [checks.md](checks.md) | `.orkestra/checks/*.sh` as checks, effects and conditions, `*.select.yaml`, and `deploy.sh` |
| [processes.md](processes.md) | `.orkestra/processes/*.sh`, the long-running servers a trak keeps up |
| [tools.md](tools.md) | `.orkestra/tools/*.sh`, commands a sandbox installs on first call |
| [goals.md](goals.md) | the goal file a goal's composer drafts, and `GOALS.md` |
| [models.md](models.md) | `.orkestra/models.yaml` |
| [worktrees.md](worktrees.md) | `.orkestra/worktrees/setup.sh`, `teardown.sh` and `env.sh` |
| [orkestra-md.md](orkestra-md.md) | `.orkestra/ORKESTRA.md`, guidance given to every step |
| [composition-md.md](composition-md.md) | `.orkestra/COMPOSITION.md`, guidance given to the composer |

## The directory

```
.orkestra/
  agents/          one .md file per role
  checks/          shell scripts an agent names as checks, effects or conditions
  processes/       long-running servers
  tools/           commands a sandbox installs
  worktrees/       setup.sh, teardown.sh, env.sh
  models.yaml
  fleet.yaml
  ORKESTRA.md
  COMPOSITION.md
  GOALS.md
  deploy.sh
  .local/          one person's copy of the same layout, kept out of git
```

**Every file is optional; the directory is not.** Orkestra ships a fleet of agents, so an
empty `.orkestra/` is a working project. The engine walks up from the directory it
starts in to the nearest `.orkestra/`, as git finds `.git`, and reads only the names
above. Any other entry is left alone. An agent, check, process or tool file is a contract:
an unknown key fails the load, naming the file, and the engine refuses to start until it
is fixed.

**`.orkestra/.local/` is one person's overlay.** It mirrors the layout above, the engine
keeps it out of git, and it is merged over the team's files at load. An agent file there
layers over the team's field by field, as [agents.md](agents.md) describes; a script
there replaces the team's script of the same name; `models.yaml` there adds to the
team's, as [models.md](models.md) describes; every other file there replaces the team's
whole.

The engine also keeps runtime state beside these files — `.database/`, `.worktrees/` and
`.trak/`. Those are the engine's, and nothing in this reference asks you to write them.
