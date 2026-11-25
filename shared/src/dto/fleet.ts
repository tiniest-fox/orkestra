// The agents, models and MCP connections a trak may be started with. Part of the wire contract;
// `common.ts` says how the slices fit together.

import { Schema } from "effect"

// ============================================================================
// The fleet — what a trak may be started with
// ============================================================================

/**
 * One agent the library holds, from `GET /api/agents` — **all of them, startable or
 * not.**
 *
 * The list is what a surface resolves an agent's *name* against, and a plan entry can
 * name any agent at all: a step running `unblock` or `resolve` is drawn on the map like
 * every other step, and a list that stopped at the startable ones would leave those two
 * with no icon anything could reach. So `start` is a field on the row and the one screen
 * that cares — New Trak's grid — filters on it.
 *
 * **`start` is the engine saying so, which is the opposite of a client knowing.** The
 * rule this reverses was against a *surface* holding its own list of which agents are
 * odd; a boolean the engine sends is that rule kept, not weakened.
 *
 * `permission` is left off on purpose: it is a real property of an agent and nothing on
 * the wire's far side needs it yet — adding a field later is easy and removing one is
 * not. There is no display name because
 * `agent-file.ts` rejects `title:`: a plan entry references an agent by its filename,
 * so the name IS what the fleet is labelled by, here as in the composer's index.
 */
export const AgentDto = Schema.Struct({
  /** The filename without `.md` — `ui-prototype`. What `CreateTrakRequestDto.agent` carries. */
  name: Schema.String,
  /** The agent file's `description:`, verbatim and whole. */
  description: Schema.String,
  /** The agent file's `start:` — whether a person may open a trak with this one. */
  start: Schema.Boolean,
  /**
   * The agent file's `icon:` — an icon name in kebab, or absent.
   *
   * **Crossing the wire is the whole point**, and it is the one field here that is
   * purely about drawing. What a project's agents are is the project's to say, so
   * the surface is told rather than knowing: a client with its own name-to-glyph map
   * is a client that has to be edited every time somebody writes an agent file.
   *
   * Whether the name resolves is the surface's business, and an unresolvable one
   * draws whatever that surface uses for unknown — see `Agent.icon` for why the
   * engine does not check it.
   */
  icon: Schema.optional(Schema.String),
  /**
   * The agent file's `conditions:` verbatim — the names a step running this agent
   * waits on before it starts, `merged` and `deployed` among them where the file lists
   * them. Empty for an agent that runs at once.
   *
   * Crosses for the reason `icon` does: a proposal card marks where a plan's order splits
   * into *now* and *later*, and which agents wait is the project's to say. The names alone
   * — no description and no interval — because that is all a proposal card draws; a surface
   * that needs more asks for another field rather than reading the script's header itself.
   */
  conditions: Schema.Array(Schema.String),
  /**
   * The agent file's `model:` — what a step running this agent runs on when nobody picks
   * another.
   *
   * For the plan gate's swap: a step swapped to this agent runs on it, and the model menu
   * marks it as the agent's own. It is not what any one step runs on — a step continuing
   * another's conversation runs on that conversation's — so a surface drawing a step that
   * nobody edited reads `AgentStepDto.model`, which the engine resolved.
   */
  model: Schema.String,
  /**
   * Whether a plan entry may name this agent — the set the composer's plan is checked
   * against. The plan gate's swap offers these and no others, since an edited plan is
   * held to the same check.
   */
  plannable: Schema.Boolean,
})
export type AgentDto = Schema.Schema.Type<typeof AgentDto>

/**
 * `GET /api/models` — `models.yaml`, as the engine loaded it: every model a step may run
 * on, in file order, and the one a turn no agent file speaks for runs on.
 *
 * Its own route rather than a field on `AgentDto`, because neither half is a property of
 * any one agent: the list is what validates every `model:`, and `default` is the composer's
 * model and the engine's own agent's — so it is what a chat runs on when nobody picks.
 * New Chat's picker lists `allowed` verbatim with `default` chosen, and sends a name
 * back on `CreateTrakRequestDto.model` only when a person pressed one.
 *
 * **A model is a bare string here, and the `<provider>/<name>` grammar is the wire's.**
 * A qualified entry runs on that CLI; a bare one on `claude`. A surface may split it to
 * draw the CLI's mark, and may know nothing else about any entry.
 */
export const ModelsDto = Schema.Struct({
  default: Schema.String,
  allowed: Schema.Array(Schema.String),
})
export type ModelsDto = Schema.Schema.Type<typeof ModelsDto>
