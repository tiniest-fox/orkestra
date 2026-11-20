// logic: the shipped fleet, `.orkestra/` and `.orkestra/.local/` -> one LibrarySource.
//
// Three layers, the later winning: what the engine ships, the team's directory, and a
// person's private mirror of it kept out of git by the engine. What wins when more
// than one holds a file is a rule about what the library IS, so it lives here, pure,
// and the adapter only reads the trees.

import type {
  AgentFiles,
  LibrarySource,
  ScriptSource,
  ShippedSource,
  TreeSource,
} from "./assemble.js"

/**
 * A script another layer's file of the same name hides, as the two paths a person would
 * open. The loader logs every one at boot, which is the only place one is reported:
 * nothing on the wire or on screen tells whose script ran.
 */
export interface Shadow {
  readonly over: string
  readonly under: string
}

/** Union by name, the later map winning, and each file it hid reported. */
const union = (
  layers: readonly ReadonlyMap<string, ScriptSource>[],
  shadows: Shadow[],
): ReadonlyMap<string, ScriptSource> => {
  const merged = new Map<string, ScriptSource>()
  for (const layer of layers) {
    for (const [name, file] of layer) {
      const hidden = merged.get(name)
      if (hidden !== undefined) shadows.push({ over: file.shown, under: hidden.shown })
      merged.set(name, file)
    }
  }
  return merged
}

/**
 * Agents are lined up rather than merged: each name keeps every file that speaks for it,
 * bottom first, and `assembleLibrary` merges them field by field once each is parsed.
 * Checks, hosted processes and sandbox tools union by name, a script replaced whole. Guidance,
 * composition, `fleet.yaml` and the worktree scripts are replaced outright rather than
 * appended — two pieces of guidance can contradict each other, and an agent must never read
 * both. `models.yaml`
 * is the exception that is neither: it travels beside the team's, because its merge
 * needs both files parsed.
 */
export const overlay = (
  shipped: ShippedSource,
  team: TreeSource,
  local: TreeSource | undefined,
  root: string,
): { readonly source: Omit<LibrarySource, "skills">; readonly shadows: readonly Shadow[] } => {
  const shadows: Shadow[] = []
  const trees = local === undefined ? [team] : [team, local]
  const names = new Set(
    [shipped.agents, ...trees.map((t) => t.agents)].flatMap((m) => Array.from(m.keys())),
  )
  const agents = new Map(
    [...names].map((name): [string, AgentFiles] => [
      name,
      {
        shipped: shipped.agents.get(name),
        repo: trees.flatMap((t) => {
          const file = t.agents.get(name)
          return file === undefined ? [] : [file]
        }),
      },
    ]),
  )
  const checks = union([shipped.checks, ...trees.map((t) => t.checks)], shadows)
  // Nothing ships one: which servers a repository runs is the repository's to say.
  const processes = union(
    trees.map((t) => t.processes),
    shadows,
  )
  // Nothing ships one either: which tools a sandbox installs is the repository's to say.
  const tools = union(
    trees.map((t) => t.tools),
    shadows,
  )
  return {
    source: {
      agents,
      checks,
      processes,
      tools,
      shippedChecks: [...shipped.checks.keys()],
      setup: local?.setup ?? team.setup,
      teardown: local?.teardown ?? team.teardown,
      env: local?.env ?? team.env,
      deploy: local?.deploy ?? team.deploy,
      models: team.models,
      // The team's alone: how a person's own file would merge with it is undecided,
      // and that person's servers already reach every turn through their CLI's config.
      mcp: team.mcp,
      localModels: local?.models,
      composition: local?.composition ?? team.composition,
      goals: local?.goals ?? team.goals,
      guidance: local?.guidance ?? team.guidance,
      fleet: local?.fleet ?? team.fleet,
      generic: shipped.generic,
      root,
    },
    shadows,
  }
}
