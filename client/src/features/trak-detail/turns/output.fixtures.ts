/**
 * What an agent or the composer files at the end of a turn.
 *
 * These are the members of `StepOutputDto` and `ComposerOutputDto`, and **each is typed to
 * its member rather than to the union** — which is the whole reason they reach anything.
 * `ProposalCard` takes a proposal, not an output; a value typed to the union is not
 * assignable to it and would leave the card blocked with nothing to say why.
 *
 * That also makes one value do two jobs: a member satisfies the member-typed card *and*
 * the union-typed view, so `proposal` below feeds `ProposalCard` and `ComposerOutputView`
 * at once. The two views are not the same union — `proposal` is the composer's and never
 * appears in a step's, `artifact` and `stuck` only ever in a step's — so both are covered
 * here rather than one standing in for the other.
 */

import type { ComposerOutputDto, StepOutputDto } from "../../../api/types"

type Step<T extends StepOutputDto["type"]> = Extract<StepOutputDto, { type: T }>
type Composed<T extends ComposerOutputDto["type"]> = Extract<ComposerOutputDto, { type: T }>

export const proposal: Composed<"proposal"> = {
  type: "proposal",
  title: "Derive the catalogue panel from the props types",
  rationale:
    "A list of components is a list somebody maintains. The types already say what each one takes, so the panel can be resolved when asked instead of written down and kept in step.",
  steps: [
    {
      type: "agent",
      agent: "builder",
      instruction: "walk the exported components",
      conversational: false,
    },
    {
      type: "agent",
      agent: "builder",
      instruction: "classify each prop, and split a union props type into its branches",
      conversational: false,
    },
    {
      type: "agent",
      agent: "reviewer",
      instruction: "check the derived panel against a real client",
      conversational: true,
    },
  ],
}

/**
 * A plan whose middle is a spawn, at the length the composer actually writes.
 *
 * The card's other two fixtures are short phrases, which is why nothing here caught the
 * instruction being cut: every entry fitted the line it was clipped to. This one runs to a
 * paragraph an entry, holds the longest agent name the library has, and spawns three
 * children two of which share an agent — so a column cannot be keyed or told apart by what
 * runs it. The third holds a plan of two, which is the ragged grid at gallery scale.
 *
 * It is also the one fixture whose steps claim a rung, and only some of them do: a plan
 * where every entry carries a label is not the plan the composer writes, and the ragged
 * right-hand column is the thing to look at.
 */
export const spawningProposal: Composed<"proposal"> = {
  type: "proposal",
  title: "Say which files disagreed when a merge conflicts, and what to do next",
  rationale:
    "The merge already knows the paths and throws them away at the last hop, so the expensive half of this is a review rather than a build — which is why the middle of the plan is a spawn and not a step.",
  steps: [
    {
      type: "agent",
      agent: "scope-and-approach",
      instruction:
        "Settle what a person can do about a conflict from inside the drawer, and where the line is. Resolving a conflict is an edit to a working tree that Orkestra does not own, so the honest scope may be showing the paths and opening the checkout rather than offering a merge tool — say which, and what each one costs.",
      conversational: true,
    },
    {
      type: "spawn",
      instruction:
        "Three lenses over the same change, because a merge surface fails in three unrelated ways and a single reviewer reads for one of them. None of these needs another one's output; each is its own review, and this is where the plan gets expensive.",
      children: [
        [
          {
            agent: "review",
            instruction:
              "Read it as a state machine: which TrakState a conflicted merge leaves the trak in, whether decide can move it anywhere from there, and whether a second attempt is reachable without a restart.",
          },
        ],
        [
          {
            agent: "review",
            instruction:
              "Read it for what happens when git says something the parser did not expect — a rename, a delete on both sides, a submodule, a path with a space in it.",
          },
        ],
        // A piece that checks its own work, which is what a piece holding a plan
        // buys — and the only ragged column in the gallery.
        [
          {
            agent: "build",
            instruction:
              "Draw the paths that disagreed, as a list under the merge notice, with the checkout one press away.",
          },
          {
            agent: "design-review",
            instruction: "Read the copy. A conflict is not a failure and must not read as one.",
          },
        ],
      ],
    },
    {
      type: "agent",
      agent: "build",
      instruction:
        "Build what the reviews agreed on. The paths come off the event and are drawn as a list; nothing here shells out to git beyond what the merge already ran.",
      conversational: false,
    },
  ],
}

/** No rationale, which is the shape a short proposal actually arrives in. */
export const bareProposal: Composed<"proposal"> = {
  type: "proposal",
  title: "Bump the provider client",
  steps: [
    {
      type: "agent",
      agent: "builder",
      instruction: "move to the streaming API",
      conversational: false,
    },
  ],
}

export const questions: Step<"questions"> = {
  type: "questions",
  questions: [
    {
      question: "Should a union props type be one entry or two?",
      context:
        "A Button whose props are AsButton | AsLink is one component in the editor and was listed as two here, sitting side by side as though they were unrelated.",
      options: [
        {
          label: "One entry with a branch knob",
          description: "The panel already has a control for a choice.",
        },
        {
          label: "Two entries",
          description: "Each renders without a gate, at the cost of the count being wrong.",
        },
      ],
    },
    {
      question: "What should an optional string open on?",
      options: [{ label: "Not sent" }, { label: "Its own name" }, { label: "Empty" }],
    },
  ],
}

/** The composer's alone: the one answer that ends a trak without anything having failed. */
export const composerFinished: Composed<"finished"> = {
  type: "finished",
  reason:
    "The offline case the review raised is already covered by the fallback 2-build put in, and the test for it is in the same commit. Nothing is left to plan.",
}

export const failed: Step<"failed"> = {
  type: "failed",
  error: "the provider returned 502 after three retries, and the last attempt timed out at 120s",
}

export const message: Step<"message"> = {
  type: "message",
  text: "Nothing to do — the walk found no components under the included paths.",
}

export const artifact: Step<"artifact"> = {
  type: "artifact",
  sections: {
    Summary: "Split the catalogue walk so a union props type becomes one entry with a branch knob.",
    Approach:
      "Derive each branch separately, then fold the results back together. Props every branch shares stay unconditional; the rest carry the branch they belong to.",
  },
  requirements: [{ text: "A union props type is one component with variants", source: "assumed" }],
}

export const stuck: Step<"stuck"> = {
  type: "stuck",
  tried: "Keying the fixture registry on the printed type name, then on a normalised form of it.",
  happened:
    "The props are Schema-derived and print as a page of structure rather than as a name, so nothing matched and no error was raised.",
  diagnosis:
    "Name matching cannot work here at all. The checker answers assignability directly, which is exact and needs no unwrap rules.",
  requirements: [
    { text: "Match a fixture to a prop by assignability, never by name", source: "stated" },
  ],
}
