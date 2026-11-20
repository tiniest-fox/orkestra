// Asserts against the REAL templates in src/prompts/templates, read straight off
// disk. A fake template set would only prove that rendering works — the thing
// worth protecting is that the shipped prompts still say what we think they say.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import { type Agent, FIGURES, type OutputSection, type Skill } from "../../library/types/agent.js"
import { TEMPLATE_NAMES, type Templates } from "../../prompts/index.js"
import { buildComposerPrompt, buildStepPrompt, buildSystemPrompt } from "./prompt.js"
import { artifact as makeArtifact } from "./outputs/artifact.js"
import { SessionId } from "../../agent/types/session.js"
import { noSlot } from "./trak.js"
import type { Recorded } from "./outputs/decided.js"
import { proposal, type Step } from "./outputs/proposal.js"
import { supersedable } from "./projection.js"
import { emptyTrak, GoalId, type Reconsult, TrakId } from "./trak.js"
import { Triggers } from "./trigger.js"
import { spellLocal } from "./wait-until.js"

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "prompts", "templates")
const templates: Templates = new Map(
  TEMPLATE_NAMES.map((n) => [n, readFileSync(join(DIR, `${n}.md`), "utf8")]),
)

/** The escape byte, spelled once — a literal one in a test file is invisible. */
const ESC = "\u001B"

const SECTIONS: readonly OutputSection[] = [
  { title: "Summary", description: "What changes.", when: undefined, figure: undefined },
  {
    title: "Risks",
    description: "What might bite.",
    when: "a step is left half-done",
    figure: undefined,
  },
]

const agent: Agent = {
  name: "build",
  description: "Implements a specified change and reports what it did.",
  model: "haiku",
  permission: "write",
  sections: SECTIONS,
  checks: [],
  effects: [],
  conditions: [],
  processes: [],
  skills: [],
  start: true,
  place: "sandbox" as const,
  icon: undefined,
  effort: undefined,
  brief: "## Implementation conventions\n\nMatch the surrounding code.",
}
const step: Step = { agent: "build", instruction: "Describe what the change involves." }
const trak = { ...emptyTrak(TrakId.make("t1")), description: "Add a --json flag" }
const ctx = {
  trak,
  step,
  agent,
  trigger: Triggers.initial(),
  guidance: "",
  index: 0,
  checks: [],
  checkTool: [],
  effects: [],
  conditions: [],
  processes: [],
  processTools: false,
  stopped: [],
  skills: [],
}

/** Two steps done, a third about to run — the shape the artifact list is about. */
const midway = {
  ...trak,
  plan: proposal("Add a flag", [
    { agent: "discovery", instruction: "Plan it." },
    { agent: "breakdown", instruction: "Break it down." },
    { agent: "build", instruction: "Do it." },
  ]),
  artifacts: new Map([
    ["0-discovery", makeArtifact({ Summary: "what we found" })],
    ["1-breakdown", makeArtifact({ Summary: "the steps to take" })],
  ]),
  // The two that ran. A slot with a session is what says a turn happened here, and
  // it is what `firstUnrun` reads to decide where a revision joins on — so a fixture
  // without them describes a plan nothing has started.
  slots: new Map([
    [0, { ...noSlot, session: SessionId.make("00000000-0000-4000-8000-00000000000a") }],
    [1, { ...noSlot, session: SessionId.make("00000000-0000-4000-8000-00000000000b") }],
  ]),
}

describe("buildStepPrompt — first attempt", () => {
  const p = buildStepPrompt(templates, ctx)

  it("includes the trak description, the agent's brief and the artifact key", () => {
    expect(p).toContain("Add a --json flag")
    expect(p).toContain("Match the surrounding code.")
    expect(p).toContain("`0-build`")
  })

  it("includes the composer's per-step instruction", () => {
    expect(p).toContain("Describe what the change involves.")
  })

  it("stops at the work — the contract is on the session, not in the body", () => {
    // The envelope and the declared sections are the same on every turn of this
    // step's session, so they are said once there rather than in each body.
    expect(p).not.toContain('"type": "artifact"')
    expect(p).not.toContain('"type": "questions"')
    expect(p).not.toContain("What the artifact must contain")
    expect(p.trimEnd().endsWith("Produce the artifact named `0-build`.")).toBe(true)
  })

  it("shows the whole sequence, marking where this step is", () => {
    // A step seeing only its own instruction cannot tell whether anything follows
    // it — which is what a requirement about the rest of the plan is a judgment about.
    const planned = {
      ...trak,
      plan: proposal("Add a flag", [
        { agent: "discovery", instruction: "Plan it." },
        { agent: "build", instruction: "Do it." },
        { agent: "review", instruction: "Review it." },
      ]),
    }
    const out = buildStepPrompt(templates, { ...ctx, trak: planned, index: 1 })
    expect(out).toContain("## The plan")
    expect(out).toContain("- 0-discovery\n")
    expect(out).toContain("- 1-build  ← YOU ARE HERE")
    expect(out).toContain("- 2-review\n")
    // other steps' instructions are NOT included — one directive per prompt
    expect(out).not.toContain("Review it.")
  })

  it("numbers a repeated agent by position, so two reviews are two artifacts", () => {
    const twice = {
      ...trak,
      plan: proposal("Review it twice", [
        { agent: "review", instruction: "First pass." },
        { agent: "review", instruction: "Second pass." },
      ]),
    }
    const out = buildStepPrompt(templates, { ...ctx, trak: twice, index: 1 })
    expect(out).toContain("- 0-review\n")
    expect(out).toContain("- 1-review  ← YOU ARE HERE")
  })

  it("omits the plan section when there is no proposal yet", () => {
    expect(p).not.toContain("## The plan")
  })

  it("says nothing about reconciling sources — there is only one brief", () => {
    // Concatenating several sources means two output specs arriving at once and a
    // prompt that has to say which wins. One agent means nothing to reconcile rather
    // than made conditional.
    expect(p).not.toContain("one document")
    expect(p).not.toContain("merge the sections")
  })

  it("tells a read-only agent why its edit tools are denied", () => {
    // The deny list without the reason is what makes an agent work around the
    // denial instead of accepting it. Mechanism: one sentence, true of any
    // read-only role, so it ships with the tool rather than living in a brief.
    const reading = buildStepPrompt(templates, {
      ...ctx,
      agent: { ...agent, permission: "read-only" },
    })
    expect(reading).toContain("tools that edit files are denied")
    expect(reading).toContain("a later step makes the change")
    // and a writing step does not pay for it
    expect(p).not.toContain("denied for this step")
  })

  it("carries no artifact section when nothing has been produced", () => {
    expect(p).not.toContain("The step before yours")
    expect(p).not.toContain(".orkestra/.trak/")
  })

  it("lists a path against every step that has filed one, and injects only the last", () => {
    // The whole of cut 3, at the point it is visible: the plan and "artifacts so
    // far" were the same sequence twice, so the second is now a path per entry.
    // The immediately preceding document still comes inline — a sequential
    // pipeline's handoff is what a step almost always needs.
    const out = buildStepPrompt(templates, { ...ctx, trak: midway, index: 2 })
    expect(out).toContain("- 0-discovery — `.orkestra/.trak/0-discovery.md`")
    expect(out).toContain("- 1-breakdown — `.orkestra/.trak/1-breakdown.md`")
    expect(out).toContain("- 2-build  ← YOU ARE HERE")
    expect(out).toContain("The step before yours: 1-breakdown")
    expect(out).toContain("the steps to take")
    // and the older one is a path, not a document
    expect(out).not.toContain("what we found")
  })

  it("gives the step about to run no path — its artifact is what the turn is for", () => {
    const out = buildStepPrompt(templates, { ...ctx, trak: midway, index: 2 })
    expect(out).not.toContain(".orkestra/.trak/2-build.md")
  })

  it("omits project guidance when the project defines none", () => {
    expect(buildStepPrompt(templates, { ...ctx, guidance: "Be terse." })).toContain("Be terse.")
    // "" must not leave a stray blank section behind
    expect(p).not.toContain("\n\n\n\n")
  })

  it("does not HTML-escape — a prompt is not a web page", () => {
    const quoted = { ...trak, description: 'Add a "--json" flag to <List>' }
    const out = buildStepPrompt(templates, { ...ctx, trak: quoted })
    expect(out).toContain('Add a "--json" flag to <List>')
    expect(out).not.toContain("&quot;")
    expect(out).not.toContain("&lt;")
  })
})

describe("buildStepPrompt — a piece split out of larger work", () => {
  // A spawn child: one step of its own, and the parent's documents behind it.
  const piece = {
    ...trak,
    plan: proposal("The footer components", [{ agent: "build", instruction: "Build it." }]),
    inherited: [
      ["0-discovery", makeArtifact({ Summary: "what we found" })],
      ["1-breakdown", makeArtifact({ Summary: "three pieces, and this is one" })],
    ],
  } as const
  const p = buildStepPrompt(templates, { ...ctx, trak: piece })

  it("lists what it was born holding, under a directory of its own, by the key it goes by", () => {
    expect(p).toContain("The work this is a piece of")
    expect(p).toContain("- from-parent/0-discovery — `.orkestra/.trak/from-parent/0-discovery.md`")
    expect(p).toContain("- from-parent/1-breakdown — `.orkestra/.trak/from-parent/1-breakdown.md`")
  })

  it("names each inherited document by the key a supersedes may name, even where its own plan re-uses it", () => {
    // The contract says to name a document as this list lists it, and `supersedable`
    // is what holds the agent to that. Shown bare, `0-discovery` here is accepted —
    // the child's own step 0 is `discovery` too — and the note lands on the wrong file.
    const reusing = {
      ...piece,
      plan: proposal("The footer components", [
        { agent: "discovery", instruction: "Look again." },
        { agent: "build", instruction: "Build it." },
      ]),
      artifacts: new Map([["0-discovery", makeArtifact({ Summary: "looked again" })]]),
    }
    const out = buildStepPrompt(templates, { ...ctx, trak: reusing, index: 1 })
    const listed = [...out.matchAll(/^- (\S+) — `\.orkestra\/\.trak\/from-parent\//gm)].map(
      (m) => m[1],
    )
    expect(listed).toEqual(supersedable(reusing, 1).filter((k) => k.startsWith("from-parent/")))
    expect(supersedable(reusing, 1)).toEqual([
      "from-parent/0-discovery",
      "from-parent/1-breakdown",
      "0-discovery",
    ])
  })

  it("injects the last of them as the step before this one", () => {
    // A child's first step has filed nothing, and the parent's last artifact is
    // what the spawn was decided from — the same handoff a sequential step gets.
    expect(p).toContain("The step before yours: from-parent/1-breakdown")
    expect(p).toContain("three pieces, and this is one")
    // and the older one stays a path
    expect(p).not.toContain("what we found")
  })

  it("gives way to this trak's own work as soon as it has any", () => {
    const going = {
      ...piece,
      plan: proposal("The footer components", [
        { agent: "build", instruction: "Build it." },
        { agent: "review", instruction: "Review it." },
      ]),
      artifacts: new Map([["0-build", makeArtifact({ Summary: "the footer, built" })]]),
    }
    const out = buildStepPrompt(templates, { ...ctx, trak: going, index: 1 })
    expect(out).toContain("The step before yours: 0-build")
    expect(out).not.toContain("The step before yours: from-parent/1-breakdown")
    // and the inherited list is still there, because it is not the same question
    expect(out).toContain("The work this is a piece of")
  })

  it("says nothing at all on a trak nobody spawned", () => {
    const out = buildStepPrompt(templates, { ...ctx, trak: midway, index: 2 })
    expect(out).not.toContain("The work this is a piece of")
    expect(out).not.toContain("from-parent")
  })
})

describe("buildStepPrompt — the intent", () => {
  const decided = {
    ...trak,
    decisions: [
      { text: "the admin view is out of scope", source: "stated", at: "0-discovery" },
      { text: '"responsive" means phone and desktop', source: "assumed", at: "0-discovery" },
    ],
  } as const

  it("carries every requirement filed before this turn, under the request", () => {
    const p = buildStepPrompt(templates, { ...ctx, trak: decided })
    expect(p).toContain("**requirements** were recorded")
    expect(p).toContain("- **stated** — the admin view is out of scope")
    expect(p).toContain('- **assumed** — "responsive" means phone and desktop')
    expect(p).toContain("*0-discovery.1*")
    // Under the request, because the two together are what is being asked for.
    expect(p.indexOf("Add a --json flag")).toBeLessThan(p.indexOf("**requirements** were recorded"))
  })

  it("says an assumed entry is nobody's agreement, which is the whole of `source`", () => {
    expect(buildStepPrompt(templates, { ...ctx, trak: decided })).toContain(
      "`assumed` means somebody read it into the work",
    )
  })

  it("says nothing at all when nothing has been settled", () => {
    expect(buildStepPrompt(templates, ctx)).not.toContain("**requirements** were recorded")
  })

  it("is absent from every resume body, and cannot go stale for want of it", () => {
    // Only an artifact carries requirements and an artifact ends a step, so nothing
    // can be filed between two turns of one step. Repeating it per turn would put
    // an identical block into a conversation that already contains it verbatim.
    const resumes = [
      Triggers.message("what about the admin view?"),
      Triggers.answers(["yes"]),
      Triggers.checkFailure("verify", "2 errors"),
      Triggers.interrupted(),
    ]
    for (const trigger of resumes) {
      expect(buildStepPrompt(templates, { ...ctx, trak: decided, trigger })).not.toContain(
        "**requirements** were recorded",
      )
    }
  })
})

describe("buildStepPrompt — what it opens on", () => {
  // The step four entries into `quiet-emerald-capybara` read its trak's opening
  // question first and answered it instead of doing its own job. The order is the
  // fix, so the order is what is pinned: the instruction at word 1, and the message
  // after it under a heading that dates it.
  const decided = {
    ...trak,
    decisions: [{ text: "the admin view is out of scope", source: "stated", at: "0-discovery" }],
  } as const

  it("opens on the instruction, and the message it was asked with comes after", () => {
    const p = buildStepPrompt(templates, ctx)
    expect(p.startsWith("# This step\n\nDescribe what the change involves.\n")).toBe(true)
    expect(p.indexOf("## How this work was asked for")).toBeLessThan(p.indexOf("Add a --json flag"))
  })

  it("dates the message only when something has been recorded since", () => {
    // "It started as" over one paragraph and nothing after it reads as a sentence
    // cut off, so the lead-in is guarded on the same flag as the requirements.
    expect(buildStepPrompt(templates, ctx)).not.toContain("It started as:")
    const p = buildStepPrompt(templates, { ...ctx, trak: decided })
    expect(p).toContain("It started as:\n\nAdd a --json flag\n\nAnd then these **requirements**")
  })

  it("keeps the skipped-step note with the instruction, above the message", () => {
    const skipped = {
      ...midway,
      slots: new Map([
        [0, { ...noSlot, session: SessionId.make("00000000-0000-4000-8000-00000000000a") }],
        [1, { ...noSlot, skipped: true, skipNote: "not needed" }],
      ]),
    }
    const p = buildStepPrompt(templates, { ...ctx, trak: skipped, index: 2 })
    expect(p.indexOf("Do it.")).toBeLessThan(p.indexOf("`1-breakdown` was skipped"))
    expect(p.indexOf("was skipped")).toBeLessThan(p.indexOf("## How this work was asked for"))
  })

  it("labels the message with the heading trak.md uses, in both prompts", () => {
    // `intent.md` makes one-name-for-one-thing a rule: the block an agent reads and
    // the file it is told to open have to agree. `projection.test.ts` pins the file's
    // side of the same string.
    const heading = "## How this work was asked for\n\nAdd a"
    expect(buildStepPrompt(templates, ctx)).toContain(heading)
    expect(buildComposerPrompt(templates, ctxFor("- build: does work"))).toContain(heading)
  })
})

describe("buildStepPrompt — a person's answer to a permission request", () => {
  it("says yes naming the command byte for byte, which is what clears a refusal", () => {
    // Backslashes, quotes, a backtick and `{{` — anything a template engine or an
    // escape would change. Escaping is off, so the command comes back as named.
    const command = "DANGEROUSLY_DISABLE_SAFETY_GUARD=1 echo \"a\\nb\" '{{x}}' && cat `ls`"
    const p = buildStepPrompt(templates, { ...ctx, trigger: Triggers.permitted(command) })
    expect(p).toContain(`Yes, you can run \`${command}\`.`)
  })

  it("says no naming the command, and tells the step to carry on without it", () => {
    const p = buildStepPrompt(templates, { ...ctx, trigger: Triggers.refused("make deploy") })
    expect(p).toContain("No — do not run `make deploy`.")
    expect(p).toContain("Carry on without it.")
    expect(p).not.toContain("Yes, you can run")
  })
})

describe("buildStepPrompt — resume", () => {
  it("sends only the new context, not the whole prompt again", () => {
    const p = buildStepPrompt(templates, { ...ctx, trigger: Triggers.message("too broad") })
    expect(p).toContain("too broad")
    // the agent already holds this in its session history
    expect(p).not.toContain("Add a --json flag")
    expect(p).not.toContain("Match the surrounding code.")
  })

  it("carries nothing but the message — that bareness is the signal", () => {
    // The human's words, with nothing around them — which is exactly what the
    // contract on the session names as "a person is waiting to read what you say
    // back". Any framing here would spend that signal.
    expect(buildStepPrompt(templates, { ...ctx, trigger: Triggers.message("too broad") })).toBe(
      "too broad",
    )
  })

  it("renders answers as a numbered list", () => {
    const p = buildStepPrompt(templates, { ...ctx, trigger: Triggers.answers(["yes", "no"]) })
    expect(p).toContain("1. yes")
    expect(p).toContain("2. no")
  })

  it("gives the note a heading of its own, below the answers and never numbered", () => {
    const p = buildStepPrompt(templates, {
      ...ctx,
      trigger: Triggers.answers(["yes", "no"], "we ship this on Friday"),
    })
    expect(p).toContain("we ship this on Friday")
    // The numbering is the only thing joining an answer to its question, so a third
    // number here would be an answer to a question that was never asked.
    expect(p).not.toContain("3. we ship this on Friday")
    expect(p).toContain("1. yes")
    expect(p).toContain("2. no")
    expect(p.indexOf("2. no")).toBeLessThan(p.indexOf("we ship this on Friday"))
  })

  it("says nothing at all about the note when there is none", () => {
    // Byte-identical to the body a resume got before the field existed: a heading over
    // nothing reads as a person having said something and gone quiet.
    const bare = buildStepPrompt(templates, { ...ctx, trigger: Triggers.answers(["yes", "no"]) })
    expect(bare).toBe("## Answers to your questions\n\n1. yes\n2. no")
  })

  it("takes the recommended option where one was marked, and leaves the rest to the agent", () => {
    const p = buildStepPrompt(templates, {
      ...ctx,
      trigger: Triggers.unanswered([{ recommended: "list only" }, {}]),
    })
    expect(p).toContain("## Nobody is standing at this trak")
    expect(p).toContain("1. Your recommendation, taken: list only\n")
    expect(p).toContain("2. No recommendation — use your best judgment.\n")
    // The agent's own pick handed back, never a heading that speaks for a person.
    expect(p).not.toContain("Answers to your questions")
  })

  it("gives every non-chat resume a heading, so it cannot read as a bare message", () => {
    // Only a `Message` arrives unframed; each of the others announces what it is,
    // which is what tells the agent nobody is waiting on a reply.
    const framed = [
      Triggers.answers(["yes"]),
      Triggers.checkFailure("verify", "2 errors"),
      Triggers.interrupted(),
      Triggers.permitted("make deploy"),
      Triggers.refused("make deploy"),
    ]
    // No carve-out. An `|| startsWith("Continue.")` here would exempt the one
    // unframed body, leaving the invariant this names the one thing unchecked.
    for (const trigger of framed) {
      const p = buildStepPrompt(templates, { ...ctx, trigger })
      expect(p.startsWith("## ")).toBe(true)
    }
  })

  it("frames a failed check as a script's output, not as something a person said", () => {
    const p = buildStepPrompt(templates, {
      ...ctx,
      // docs-check-ignore: invented compiler output, not a path in this repo
      trigger: Triggers.checkFailure("verify", "2 errors in src/foo.ts"),
    })
    expect(p).toContain("The `verify` check failed")
    // docs-check-ignore: same invented output, asserted verbatim
    expect(p).toContain("2 errors in src/foo.ts")
    expect(p).toContain("produce the artifact again")
  })

  it("hands the agent the words without the terminal's formatting", () => {
    // The event keeps the escapes because the drawer renders the colour. An agent has no
    // colour: it reads the codes as content, spends tokens on them, and can quote them
    // back. Every family, not only the one that colours — a cursor move printed as text
    // is what opened this, and it is not an SGR sequence.
    const p = buildStepPrompt(templates, {
      ...ctx,
      trigger: Triggers.checkFailure(
        "verify",
        `${ESC}[31m2 failed${ESC}[0m${ESC}[2K${ESC}[?25l${ESC}]0;title${ESC}\\`,
      ),
    })
    expect(p).toContain("2 failed")
    expect(p).not.toContain(ESC)
  })

  it("tells a resumed step to continue, framed so it cannot read as a person", () => {
    const p = buildStepPrompt(templates, { ...ctx, trigger: Triggers.interrupted() })
    expect(p).toBe("## Continue\n\nCarry on from where you left off.")
    // The heading is the point, not decoration. The session contract reads an
    // unframed body as someone typing, and this is the one resume that runs
    // through `elicit` rather than `converse` — taken for a person, it would be
    // answered in prose, re-prompted three times, and settle `Failed{agent}`.
    expect(p.startsWith("## ")).toBe(true)
    // Deliberately says nothing about *why* the turn is being re-run: `Interrupted`
    // now carries every retry of a `Failed` trak, so a crash is only one of the
    // causes and the prompt cannot name the right one. See step-interrupted.md.
    expect(p).not.toContain("the process running it died")
  })

  it("gives a step the composer's instruction, which is the only one there is", () => {
    // A step re-entered by a revised plan is an ordinary first run of a new plan
    // entry, and the composer wrote its instruction. One hole, one source for it.
    const p = buildStepPrompt(templates, ctx)
    expect(p).toContain("Add a --json flag")
    expect(p).toContain("Describe what the change involves.")
  })

  it("re-sends no contract on any resume", () => {
    // A resume prompt carries no contract: the envelope and the declared sections
    // are on the session, said once.
    for (const trigger of [
      Triggers.message("x"),
      Triggers.answers(["yes"]),
      Triggers.checkFailure("verify", "out"),
      Triggers.interrupted(),
    ]) {
      const p = buildStepPrompt(templates, { ...ctx, trigger })
      expect(p).not.toContain('"type": "artifact"')
      expect(p).not.toContain('"type": "questions"')
      expect(p).not.toContain("What the artifact must contain")
    }
  })
})

/** A fixed moment, so the time the composer is told is assertable on any machine. */
const NOW = new Date(2026, 8, 14, 15, 7).getTime()

const ctxFor = (agentIndex: string, decisions: readonly Recorded[] = []) => ({
  description: "Add a flag",
  trak: { ...trak, decisions },
  agentIndex,
  composition: "Keep it lean.",
  trigger: Triggers.initial(),
  now: NOW,
  deployed: false,
  stopped: [],
})

/** One piece of a split of two — the shape both rules below are guarded on. */
const split = {
  instruction: "Two halves, and neither reads the other's output.",
  pieces: [
    { name: "1.0-build", instruction: "Move the engine half." },
    { name: "1.1-build", instruction: "Move the client half." },
  ],
} as const
const beside = {
  ...trak,
  parent: { id: TrakId.make("t0"), step: 1, child: 0, depth: 1 },
  split,
} as const

describe("buildComposerPrompt — the time, and the one rule for a wait", () => {
  it("tells the composer what time it is, on the local clock, beside `wait_until`", () => {
    const p = buildComposerPrompt(templates, ctxFor("- build: does work"))
    expect(p).toContain(`It is now ${spellLocal(NOW)}.`)
    expect(p).toContain("`wait_until`")
    // A duration counts from this turn — not from approval, which can be hours later.
    expect(p).toContain("counted from **now**")
  })

  it("offers `wait_for: merged` always, and `deployed` only where the project has a deploy script", () => {
    const without = buildComposerPrompt(templates, ctxFor("- build: does work"))
    expect(without).toContain("`wait_for`")
    expect(without).toContain('`"merged"` waits until the')
    expect(without).not.toContain('`"deployed"`')
    const deploying = buildComposerPrompt(templates, {
      ...ctxFor("- build: does work"),
      deployed: true,
    })
    expect(deploying).toContain('`"deployed"` waits until it has merged')
  })

  it("names what a merge wait costs, and that an unasked one is explained on its step", () => {
    const p = buildComposerPrompt(templates, ctxFor("- build: does work"))
    expect(p).toContain("A wait for a merge with no")
    expect(p).toContain("A trak that merges itself merges through the wait.")
    expect(p).not.toContain("Nothing merges it on its own")
    expect(p).toContain("Nothing at or after the waiting step may change the branch")
    expect(p).toContain("that step's `instruction` must say that it waits")
  })

  it("pairs `wait_until` with `wait_for` for a check at a later time once the change is in", () => {
    const p = buildComposerPrompt(templates, ctxFor("- build: does work"))
    expect(p).toContain("A check at a later time once the change is in takes both fields")
    expect(p).toContain("A `wait_until` alone keeps a trak that")
  })

  it("says when a wait is warranted, and that a request naming no time gets none", () => {
    const p = buildComposerPrompt(templates, ctxFor("- build: does work"))
    expect(p).toContain("Only when the request names a time, or something that happens at one.")
    expect(p).toContain("A request that names neither gets no wait")
  })

  it("is absent from every resume body — a time on a resumed session is a stale one", () => {
    for (const trigger of [Triggers.message("more"), Triggers.answers(["yes"])]) {
      expect(
        buildComposerPrompt(templates, { ...ctxFor("- build: does work"), trigger }),
      ).not.toContain("It is now")
    }
  })
})

describe("the pieces beside this one", () => {
  it("tells a step that a gap belonging to another piece is not work its plan is missing", () => {
    // The false finding this exists to stop was a step agent's: it read its checkout
    // correctly and reported the other half as work nobody had planned.
    const p = buildStepPrompt(templates, { ...ctx, trak: beside })
    expect(p).toContain("## The pieces beside this one")
    expect(p).toContain("not work this plan is missing")
    expect(p).toContain("`unplanned_work`")
  })

  it("tells the composer the same, so a step reporting it is answered by the plan it has", () => {
    const p = buildComposerPrompt(templates, { ...ctxFor("- build: does work"), trak: beside })
    expect(p).toContain("## The pieces beside this one")
    expect(p).toContain("Work that falls to another piece is not work this plan is missing")
  })

  it("names nobody, because the roster is in the file every turn opens", () => {
    const p = buildStepPrompt(templates, { ...ctx, trak: beside })
    expect(p).toContain(".orkestra/.trak/trak.md")
    expect(p).not.toContain("1.1-build")
    expect(p).not.toContain("Move the client half.")
  })

  it("says nothing to either on a spawn of one, or on a trak nobody split", () => {
    const alone = { ...beside, split: { ...split, pieces: [split.pieces[0]] } } as const
    for (const t of [alone, trak]) {
      expect(buildStepPrompt(templates, { ...ctx, trak: t })).not.toContain(
        "The pieces beside this one",
      )
      expect(
        buildComposerPrompt(templates, { ...ctxFor("- build: does work"), trak: t }),
      ).not.toContain("The pieces beside this one")
    }
  })
})

/**
 * The shipped `generic` brief, read off disk, so what is asserted is what a New Chat is
 * told. Its body is everything after the frontmatter.
 */
const GENERIC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "library", "shipped", "generic.md"),
  "utf8",
)
  .split(/^---$/m)
  .slice(2)
  .join("---")
const CHAT_RULE = "file it in your artifact as an\n`unplanned_work` requirement"

describe("buildStepPrompt — the entry a trak was opened with", () => {
  const generic = { ...agent, name: "generic", brief: GENERIC }
  const answer: Step = { agent: "generic", instruction: "Answer it." }
  const prompt = (t: typeof trak, index: number): string =>
    buildStepPrompt(templates, { ...ctx, agent: generic, step: answer, trak: t, index })

  it("tells a New Chat the chat rule, and an Ask on the same trak nothing of it", () => {
    const chat = { ...trak, plan: proposal("Chat", [answer]) }
    const asked = { ...trak, plan: proposal("Chat", [answer, answer]) }
    const opened = prompt(chat, 0)
    expect(opened).toContain(CHAT_RULE)
    expect(opened).not.toContain("{{")
    expect(prompt(asked, 1)).not.toContain(CHAT_RULE)
    expect(prompt(asked, 1)).toContain("do whatever the user asks of you")
  })

  it("is not a composed plan's first agent, which sits behind the compose entry", () => {
    const composed = {
      ...trak,
      plan: { title: "Composed", steps: [{ type: "compose" }, answer] },
    } as const
    expect(prompt(composed, 1)).not.toContain(CHAT_RULE)
  })

  it("is not a spawned child's first entry, though it is born holding a plan", () => {
    expect(prompt({ ...beside, plan: proposal("Piece", [answer]) }, 0)).not.toContain(CHAT_RULE)
  })
})

describe("this trak is a child", () => {
  const alone = { ...beside, split: { ...split, pieces: [split.pieces[0]] } } as const

  it("tells a step it was spawned, where its branch was cut from, and where its work goes", () => {
    const p = buildStepPrompt(templates, { ...ctx, trak: beside })
    expect(p).toContain("## This trak is a child")
    expect(p).toContain("cut from the\nparent's branch")
    expect(p).toContain("merged back into the parent's worktree — not into the main line")
  })

  it("tells the composer the same, in the word the conventions' exception is written in", () => {
    // The composer that opened a pull request from a child had been told its request
    // was "one piece of something larger" and nothing about a branch. The word the
    // team's rule uses is *child*, and this is where that word arrives.
    const p = buildComposerPrompt(templates, { ...ctxFor("- build: does work"), trak: beside })
    expect(p).toContain("## This trak is a child")
    expect(p).toContain("merged back into the parent's worktree — not into the main\nline")
  })

  it("says it on a spawn of one, which has no siblings to be told about", () => {
    // The guard is having a parent and nothing narrower: `hasSiblings` is false here,
    // and `hasInherited` is false for a child born with nothing visible above it.
    const born = { ...alone, inherited: [] } as const
    for (const t of [alone, born]) {
      expect(buildStepPrompt(templates, { ...ctx, trak: t })).toContain("## This trak is a child")
      expect(
        buildComposerPrompt(templates, { ...ctxFor("- build: does work"), trak: t }),
      ).toContain("## This trak is a child")
    }
  })

  it("says nothing to either on a trak nobody spawned", () => {
    expect(buildStepPrompt(templates, { ...ctx, trak })).not.toContain("This trak is a child")
    expect(buildComposerPrompt(templates, { ...ctxFor("- build: does work"), trak })).not.toContain(
      "This trak is a child",
    )
  })
})

describe("work that belongs on another base", () => {
  it("tells a trak with no parent it may hand work off, on either answer", () => {
    const p = buildComposerPrompt(templates, { ...ctxFor("- build: does work"), trak })
    expect(p).toContain("hand it\noff")
    expect(p).toContain('"handOff"')
    expect(p).toContain("beside `title` and `steps`")
    expect(p).toContain("beside `reason`")
    expect(p).toContain("default branch")
  })

  it("tells a goal's trak its hand-off goes to the goal, and tells no other trak", () => {
    const inGoal = { ...trak, goal: GoalId.make("g") }
    const told = buildComposerPrompt(templates, { ...ctxFor("- build: does work"), trak: inGoal })
    expect(told).toContain("goes to the goal's composer")
    expect(buildComposerPrompt(templates, { ...ctxFor("- build: does work"), trak })).not.toContain(
      "goal's composer",
    )
  })

  it("never tells a child, whose branch goes back to its parent", () => {
    // The mirror of the child block: a child's composer is refused a `handOff` at
    // decode, and a field it was told about would be a refusal it earns every time.
    for (const t of [beside, { ...beside, inherited: [] }]) {
      const p = buildComposerPrompt(templates, { ...ctxFor("- build: does work"), trak: t })
      expect(p).not.toContain("handOff")
      expect(p).not.toContain("another base")
    }
  })

  it("keeps the word for it out of both, as every block here does", () => {
    expect(buildComposerPrompt(templates, { ...ctxFor("- build: does work"), trak })).not.toMatch(
      /hand(ed)? (it )?off .*\btrak\b/,
    )
  })
})

describe("what landed children handed up since", () => {
  const owed = { ...trak, handUps: ["the cache belongs to no piece"] } as const
  /** Every trigger a composer can be sent, each with the body it renders. */
  const triggers = [
    Triggers.initial(),
    Triggers.reconsulted(),
    Triggers.message("why does review come last?"),
    Triggers.answers(["yes"]),
    Triggers.unanswered([{}]),
    Triggers.interrupted(),
    Triggers.unread(),
    Triggers.filing(),
    Triggers.checkFailure("verify", "2 errors"),
  ]
  const of = (t: typeof trak, trigger: (typeof triggers)[number]): string =>
    buildComposerPrompt(templates, { ...ctxFor("- build: does work"), trak: t, trigger })

  it("is shown on every composer body, because the run that lands spends it", () => {
    for (const trigger of triggers) {
      const p = of(owed, trigger)
      // The tag rides in the value, so a failure names the body.
      expect([trigger._tag, p.includes("## Handed up since")]).toEqual([trigger._tag, true])
      expect(p).toContain("- the cache belongs to no piece")
    }
  })

  it("is absent from every body where nothing is owed", () => {
    for (const trigger of triggers) expect(of(trak, trigger)).not.toContain("Handed up since")
  })

  it("points at the requirements above only where the body renders them", () => {
    // A full body carries the standing list, so the piece's entries are above; a
    // resume body carries none, and a pointer there would name a block nobody sent.
    const decided = {
      ...owed,
      decisions: [{ text: "rate-limit per key", source: "stated", at: "0-build" }],
    } as const
    for (const trigger of triggers) {
      const p = of(decided, trigger)
      expect([trigger._tag, p.includes("in the requirements above")]).toEqual([
        trigger._tag,
        p.includes("**requirements** were recorded"),
      ])
    }
  })

  it("follows a chat as the one thing that may, and gives the words back their bareness", () => {
    const p = of(owed, Triggers.message("why does review come last?"))
    expect(p.startsWith("why does review come last?\n\n## Handed up since")).toBe(true)
    expect(p).toContain("waiting to read what you say back")
  })

  it("sits above the closing line of a framed resume, so the last word is still what to do", () => {
    const p = of(owed, Triggers.answers(["yes"]))
    expect(p.indexOf("## Handed up since")).toBeLessThan(p.indexOf("Now propose the pipeline."))
    expect(p.endsWith("Now propose the pipeline.")).toBe(true)
  })
})

describe("buildComposerPrompt", () => {
  const p = buildComposerPrompt(templates, ctxFor("- build: does work"))

  it("carries the request, the agent index and team conventions", () => {
    expect(p).toContain("Add a flag")
    expect(p).toContain("- build: does work")
    expect(p).toContain("Keep it lean.")
  })

  it("tells the composer to decide, not to investigate", () => {
    // Substrings must not straddle a line wrap in the template — the first
    // version of this assertion failed on a phrase that spanned two lines.
    expect(p).toContain("least work")
    expect(p).toContain("You are not doing the work")
    // and why: the research does not survive into the step that needs it
    expect(p).toContain("thrown away")
  })

  it("explains the agent/instruction division of labour", () => {
    expect(p).toContain("Do not\n  restate any of that")
    expect(p).toContain("in your own words")
  })

  it("says a step names exactly one agent, and what to do when it seems to want two", () => {
    // The falsifier for decision 1 of the epic, stated to the participant most
    // likely to hit it: a plan that repeatedly wants two agents in one step
    // means the fleet is missing one, not that a step should carry both.
    expect(p).toContain("One agent per step")
    expect(p).toContain("it wants two steps")
  })

  it("says a repeated agent does not overwrite, so nothing has to invent a slug", () => {
    expect(p).toContain("keyed by position")
  })

  it("asks for a rationale only when there is news, and says to leave it out otherwise", () => {
    // The field a user asked for, kept narrow on purpose: a justification that is
    // always present is one a reader skims before approving, which looks like
    // oversight and is not. What earns a line is what the composer *found*.
    expect(p).toContain("only when you found something")
    expect(p).toContain("Leave it out when there is nothing to say")
    expect(p).toContain("not a justification for your plan")
  })

  it("asks for a title that names the whole work, not the latest request", () => {
    expect(p).toContain("`title` is one line")
    expect(p).toContain("It is never the latest request")
  })

  it("tells the composer NOT to propose a terminal step — Finished is index N", () => {
    expect(p).toContain("Do not include a terminal step")
  })

  it("puts a number on how much the composer may read, and says why so little", () => {
    // Observed against a real composer: a vague request drew five and six `Bash`
    // calls where a shaped one drew none — sixty seconds against nine. The old
    // wording said "one grep or one file read, not an exploration", which reads
    // as an example rather than a limit, so this gives it a ceiling and states
    // the asymmetry that makes the ceiling right.
    expect(p).toContain("two or three calls at the very most")
    expect(p).toContain("none at all is the common case")
    expect(p).toContain("What you learn is thrown away")
    expect(p).toContain("A discovery step keeps what it finds")
    // The failure mode itself, named — exploring is most tempting exactly where
    // it pays worst, which is the case the composer gets wrong.
    expect(p).toContain("the less exploring is worth")
  })

  it("says a plan may end before the job is done, and what it costs to say so", () => {
    // **The promise is kept by an entry, not by goodwill.** A last `compose` step is
    // what routes a plan that stops short back to the composer; without one, the trak
    // comes to rest. So both halves have to be stated, and which one applies has to be
    // the composer's own decision rather than a mood.
    expect(p).toContain("A plan that does not finish the job is a real plan")
    expect(p).toContain("**you are asked again**")
    expect(p).toContain("comes to rest")
    // The guard, in the words it is guarded by everywhere else here: a field that
    // buys a turn and a gate must not be fillable for reassurance.
    expect(p).toContain("cannot state the next entry precisely")
    // And the guard against the opposite failure, which is what stops this
    // reading as "one step is always safe".
    expect(p).toContain("not a license to propose one step and wait")
  })

  it("offers one registry — agents, and nothing else", () => {
    // Shapes and checks belong to the agent, so the composer is neither shown them
    // nor able to name them.
    expect(p).not.toContain("Available artifact shapes")
    expect(p).not.toContain("Available checks")
    expect(p).toContain("## Available agents")
  })

  it("stops at the plan — the contract is on the session, not in the body", () => {
    expect(p).not.toContain('"type": "proposal"')
    expect(p).not.toContain('"type": "questions"')
    expect(p.trimEnd().endsWith("You are not choosing how much oversight there is.")).toBe(true)
  })

  it("reads the intent rather than the request, on the one path where they differ", () => {
    // Reachable now that a plan can be revised mid-flight: the composer is
    // re-consulted after steps have filed requirements, and the fresh body is the
    // only place they can reach it.
    expect(p).not.toContain("**requirements** were recorded")
    const revised = buildComposerPrompt(
      templates,
      ctxFor("- build: does work", [
        { text: "the admin view is out of scope", source: "stated", at: "0-discovery" },
      ]),
    )
    expect(revised).toContain("**requirements** were recorded")
    expect(revised).toContain("- **stated** — the admin view is out of scope")
  })

  it("says nothing about where this got to on a first compose, which is most of them", () => {
    expect(p).not.toContain("Where this has got to")
  })

  it("lists what a spawned piece was born holding, and nothing for work nobody split", () => {
    // A child composes its own next steps once the one-step plan it was born with
    // runs out, and the documents behind the split are the whole of what says how
    // far its piece reaches.
    expect(p).not.toContain("The work this is a piece of")
    const piece = buildComposerPrompt(templates, {
      ...ctxFor("- build: does work"),
      trak: {
        ...trak,
        inherited: [["1-breakdown", makeArtifact({ Summary: "three pieces, and this is one" })]],
      },
    })
    expect(piece).toContain("The work this is a piece of")
    expect(piece).toContain(
      "- from-parent/1-breakdown — `.orkestra/.trak/from-parent/1-breakdown.md`",
    )
    // A path, not the document: this turn decides from judgment and reads little.
    expect(piece).not.toContain("three pieces, and this is one")
  })
})

describe("buildComposerPrompt — a re-entry that answers the forge refusing a merge", () => {
  const done = {
    ...midway,
    slots: new Map([
      ...midway.slots,
      [2, { ...noSlot, session: SessionId.make("00000000-0000-4000-8000-00000000000c") }],
    ]),
  }
  const reentry = (why: Extract<Reconsult["why"], { _tag: "Reentered" }>): string =>
    buildComposerPrompt(templates, {
      ...ctxFor("- unblock: picks up work another step could not finish"),
      trak: { ...done, reconsult: { why } },
      trigger: Triggers.reconsulted(),
    })
  const what = "Pull request #7 cannot merge as it stands."
  const unnamed =
    "Plan the merge of the pull request's base branch into this branch, resolving every\nconflict"

  it("names the remote's base and asks for the push, on a person's press", () => {
    const p = reentry({ _tag: "Reentered", what, base: "main" })
    expect(p).toContain(what)
    expect(p).toContain("Plan the merge of `origin/main` into this branch")
    expect(p).toContain("plan the step that pushes")
  })

  it("names the remote's base on the engine's send-back for a conflict", () => {
    const p = reentry({ _tag: "Reentered", what, cause: { _tag: "Conflict" }, base: "main" })
    expect(p).toContain("Plan the merge of `origin/main`, the pull request's base branch")
    expect(p).not.toContain(unnamed)
    // One instruction, not the person's paragraph as well.
    expect(p).not.toContain("judges it\nagainst")
  })

  it("says what it always said where no base was named", () => {
    expect(reentry({ _tag: "Reentered", what, cause: { _tag: "Conflict" } })).toContain(unnamed)
    const plain = reentry({ _tag: "Reentered", what })
    expect(plain).not.toContain("origin/")
    expect(plain).not.toContain("pushes")
  })
})

describe("buildComposerPrompt — asked what the rest of the plan should be", () => {
  /** Two steps filed, the third not: the shape every re-consultation is about. */
  const asked = (why: Reconsult["why"]) => ({
    ...ctxFor("- unblock: picks up work another step could not finish"),
    trak: { ...midway, reconsult: { why } },
    trigger: Triggers.reconsulted(),
  })

  const stuckAt2 = asked({ _tag: "Replanned", step: 2, reason: "try a smaller piece" })
  const raisedAt1 = asked({
    _tag: "Raised",
    step: 1,
    requirements: ["and a mockup first"],
    corrections: [],
  })

  it("lists the steps the join keeps, with a path against each one that filed", () => {
    const p = buildComposerPrompt(templates, stuckAt2)
    expect(p).toContain("## Where this has got to")
    expect(p).toContain("`0-discovery` — `.orkestra/.trak/0-discovery.md`")
    expect(p).toContain("`1-breakdown` — `.orkestra/.trak/1-breakdown.md`")
    // The join is at 2, so `2-build`'s slot is still owed work and is not kept.
    expect(p).not.toContain("`2-build` — `.orkestra")
  })

  it("lists the tail it replaces WITH ITS INSTRUCTIONS, so it can be handed back", () => {
    // The session is fresh and has never seen this plan. Without the instructions
    // "unchanged plus one entry" is unsayable and every compose rewrites the tail.
    const p = buildComposerPrompt(templates, raisedAt1)
    expect(p).toContain("Your plan replaces exactly these")
    expect(p).toContain("`2-build` — Do it.")
    expect(p).toContain("one entry added is an ordinary answer")
  })

  it("hands over what a person said, and calls it the requirement", () => {
    const p = buildComposerPrompt(templates, stuckAt2)
    expect(p).toContain("stopped at `2-build`")
    expect(p).toContain("try a smaller piece")
    expect(p).toContain("It is the only account you are given")
  })

  it("tells it to change something, because the same move unchanged fails again", () => {
    expect(buildComposerPrompt(templates, stuckAt2)).toContain("change something")
  })

  it("says a raised requirement is not a complaint, because a person approved that artifact", () => {
    const p = buildComposerPrompt(templates, raisedAt1)
    expect(p).toContain("`1-breakdown` did its work")
    expect(p).toContain("and a mockup first")
    expect(p).toContain("Nothing here says that work")
    // And it is not sent up the unblock ladder: nothing here is owed rescuing.
    expect(p).not.toContain("change something")
  })

  it("says what came back, when the world came back to finished work", () => {
    // Every step ran — that is what "already finished" means — so there is no tail
    // for the revision to replace and its steps are appended to the end.
    const done = {
      ...midway,
      slots: new Map([
        ...midway.slots,
        [2, { ...noSlot, session: SessionId.make("00000000-0000-4000-8000-00000000000c") }],
      ]),
    }
    const p = buildComposerPrompt(templates, {
      ...asked({ _tag: "Reentered", what: "CI is red" }),
      trak: { ...done, reconsult: { why: { _tag: "Reentered" as const, what: "CI is red" } } },
    })
    expect(p).toContain("This work already finished")
    expect(p).toContain("CI is red")
    expect(p).toContain("your steps are appended")
  })

  it("makes the composer carry the destination's name onto the step that resolves", () => {
    // The one fact the resolving checkout cannot recover for itself: a host trak's
    // worktree and a spawn's child's are indistinguishable from inside, so a step
    // left to derive its own destination merges the host's branch inward whatever
    // this trak was actually aimed at — and conflicts again on the next press.
    const p = buildComposerPrompt(
      templates,
      asked({ _tag: "Conflicted", paths: ["flag.ts"], into: "trak/9f2c" }),
    )
    expect(p).toContain("The merge did not go in")
    expect(p).toContain("`flag.ts`")
    expect(p).toContain("Write `trak/9f2c` into that step's instruction")
    expect(p).not.toContain("Nothing recorded which branch")
  })

  it("says the destination was never named, rather than dropping the requirement", () => {
    // A detached host `HEAD` has no branch name to record. The step still has to
    // arrive at a destination, so the absence is stated and the derivation is asked
    // for explicitly — going quiet here is what looks like nothing being required.
    const p = buildComposerPrompt(templates, asked({ _tag: "Conflicted", paths: ["flag.ts"] }))
    expect(p).toContain("Nothing recorded which branch this was aimed at")
    expect(p).not.toContain("into that step's instruction")
  })

  it("quotes the composer's own question back, when the plan reached the entry it wrote", () => {
    // The one route here with nothing on `Trak.reconsult`: nothing asked, the plan
    // simply arrived at a compose entry the composer proposed. What is being answered
    // is that entry's own instruction, read off the plan at the join.
    const question = "one service or two — not decidable until the discovery lands"
    const p = buildComposerPrompt(templates, {
      ...ctxFor("- unblock: picks up work another step could not finish"),
      trigger: Triggers.reconsulted(),
      trak: {
        ...midway,
        plan: proposal("Add a flag", [
          { agent: "discovery", instruction: "Plan it." },
          { agent: "breakdown", instruction: "Break it down." },
          { type: "compose", instruction: question },
        ]),
      },
    })
    expect(p).toContain("You planned this turn yourself")
    expect(p).toContain(question)
    expect(p).toContain("your steps are appended")
    // The entry is the composer's note to itself, not a step to re-propose — so it
    // is dropped from both lists, exactly as an engine-written compose is.
    expect(p).not.toContain("`2-compose`")
    // Nothing is owed rescuing: every step ran and filed. That paragraph is a
    // person replanning's alone.
    expect(p).not.toContain("change something")
  })

  it("is the full prompt: this is a fresh session, so nothing may be assumed", () => {
    const p = buildComposerPrompt(templates, stuckAt2)
    expect(p).toContain("Compose a pipeline")
    expect(p).toContain("Add a flag")
    expect(p).toContain("## Available agents")
  })
})

describe("buildComposerPrompt — a raise that came home at a join", () => {
  const asked = (why: Reconsult["why"]) => ({
    ...ctxFor("- unblock: picks up work another step could not finish"),
    trak: { ...midway, reconsult: { why } },
    trigger: Triggers.reconsulted(),
  })
  const raisedAt1 = asked({
    _tag: "Raised",
    step: 1,
    requirements: ["and a mockup first"],
    corrections: [],
  })

  it("tells a spawn's raise apart from a step's, because the child already filed the work", () => {
    // The join writes a `Raised` at the spawn position when a child hands work up.
    // A spawn files nothing under its own key, and the work it raises is the very
    // entry the child's step put on the requirements — so the step wording, which
    // says the artifact was filed and everything else needed no plan, is false here.
    const joined = {
      ...midway,
      plan: proposal("Add a flag", [
        { agent: "discovery", instruction: "Plan it." },
        {
          type: "spawn",
          instruction: "both halves at once",
          children: [{ agent: "build", instruction: "the client half" }],
        },
        { agent: "build", instruction: "Do it." },
      ]),
      slots: new Map([
        [0, { ...noSlot, session: SessionId.make("00000000-0000-4000-8000-00000000000a") }],
        [1, { ...noSlot, children: [{ id: TrakId.make("c1"), landing: undefined }] }],
      ]),
      reconsult: {
        why: {
          _tag: "Raised" as const,
          step: 1,
          requirements: ["the shared parser has to be built first"],
          corrections: [],
        },
      },
    }
    const p = buildComposerPrompt(templates, { ...asked(joined.reconsult.why), trak: joined })
    expect(p).toContain("The children of `1-spawn` have all landed")
    expect(p).toContain("handed\nit up rather than doing it")
    expect(p).toContain("the shared parser has to be built first")
    expect(p).toContain("filed it as a requirement, so it is also in the\nrequirements above")
    expect(p).not.toContain("did its work and filed its artifact")
    expect(p).not.toContain("that needed no plan")
    // And the join still lands after the spawn: the tail it replaces is `2-build`.
    expect(p).toContain("`2-build` — Do it.")
    // A step's raise is unchanged by the split.
    const fromStep = buildComposerPrompt(templates, raisedAt1)
    expect(fromStep).toContain("that needed no plan")
    expect(fromStep).not.toContain("handed\nit up")
  })
})

/**
 * Every kind the writer can fold, keyed by tag so a sixth is a compile error here.
 * Each row is the ask, its own words, and the sentence its block says in place of
 * the ones that speak for the whole turn — withholding those is half the rule, and
 * a block that withholds them and says nothing instead leaves the composer an
 * account with no statement of what it is.
 */
const DISPLACED: Record<Reconsult["why"]["_tag"], readonly [Reconsult["why"], string, string]> = {
  Raised: [
    {
      _tag: "Raised",
      step: 1,
      requirements: ["and a mockup first"],
      corrections: [{ at: "0-discovery", text: "it names no files" }],
    },
    "it names no files",
    "the press did not read it",
  ],
  Reentered: [
    { _tag: "Reentered", what: "CI is red" },
    "CI is red",
    "what came back is still true",
  ],
  Refused: [
    { _tag: "Refused", step: 2, reason: "`fix` writes" },
    "`fix` writes",
    "The refusal stands whatever the press above asked for",
  ],
  Conflicted: [
    { _tag: "Conflicted", paths: ["flag.ts"], into: "main" },
    "`flag.ts`",
    "a plan that resolves it is still",
  ],
  Replanned: [
    { _tag: "Replanned", step: 1, reason: "at the gate" },
    "at the gate",
    "an earlier word of theirs",
  ],
}

/**
 * Its own block, because what it protects is not any one reason: the composer's views
 * are spread into one object, so a key defined twice is a block rendering the other
 * one's data with nothing to say so. `Raised` did exactly that to the standing
 * requirements — replacing them with its own list, or, on a corrections-only turn,
 * deleting the heading outright — and three of the four kinds of requirement have
 * that block as their only route to a planning turn.
 *
 * Every reason gets a case, not just the one that broke: the collision is a property
 * of the spread rather than of the arm, so the next view to define a key twice will
 * be a different arm.
 */
describe("buildComposerPrompt — a person's replan that raced what the step sent back", () => {
  /** The raced press: the person's words, with the ask they displaced inside. */
  const racing = (displaced: Reconsult["why"]) => ({
    ...ctxFor("- unblock: picks up work another step could not finish"),
    trak: {
      ...midway,
      reconsult: {
        why: { _tag: "Replanned" as const, step: 2, reason: "go simpler", displaced },
      },
    },
    trigger: Triggers.reconsulted(),
  })
  const complained = racing({
    _tag: "Raised",
    step: 1,
    requirements: ["and a mockup first"],
    corrections: [{ at: "0-discovery", text: "it names no files" }],
  })

  it("hands over both: the person's words, and the corrections the step filed", () => {
    // The corrections live in `reconsult.why` alone. A press that wrote over the raise
    // sent the composer *go simpler* and nothing about a document being sent back.
    const p = buildComposerPrompt(templates, complained)
    expect(p).toContain("stopped at `2-build`")
    expect(p).toContain("go simpler")
    expect(p).toContain("`1-breakdown` did its work")
    expect(p).toContain("and a mockup first")
    expect(p).toContain("`0-discovery` — it names no files")
    expect(p).toContain("not good enough to work from")
  })

  it("says neither cancels the other, in place of calling the words the only account", () => {
    const p = buildComposerPrompt(templates, complained)
    expect(p).toContain("Neither cancels the other")
    expect(p).toContain("Reconcile them")
    expect(p).not.toContain("It is the only account you are given")
  })

  it("renders the person's paragraph once, and the displaced reason under its own keys", () => {
    // Every `isX` flag is present on every view, so the nested reason cannot fall back
    // to the outer frame — which would render the replan paragraph inside itself and
    // include the partial without end. One occurrence is the whole assertion.
    const p = buildComposerPrompt(templates, complained)
    expect(p.split("asked for a different rest of the plan")).toHaveLength(2)
    expect(p.split("did its work and filed its artifact")).toHaveLength(2)
    // A Mustache comment ends at the first `}}`, so a tag spelled inside one spills the
    // rest of the comment into the prompt — which every substring above would survive.
    expect(p).not.toContain("}}")
  })

  it.each(Object.entries(DISPLACED))(
    "renders a displaced %s with its own words, and not the outer ones",
    (_kind, [why, words]) => {
      // `reason` is a key of `Refused` as well as of `Replanned`: inside the displaced
      // block the inner one has to win, and the outer paragraph still reads its own.
      const p = buildComposerPrompt(templates, racing(why))
      expect(p).toContain("go simpler")
      expect(p).toContain(words)
      expect(p).toContain("Neither cancels the other")
      expect(p).not.toContain("}}")
    },
  )

  it.each(Object.entries(DISPLACED))(
    "renders a displaced %s as the account it is, not as what the turn is asking",
    (_kind, [why, , says]) => {
      // The sentences that speak for the whole turn are the standing ask's alone. A
      // displaced Replanned used to say it was the only account two paragraphs after
      // the outer one said it was not; the other kinds each said what was being asked
      // of the turn, and two of them named the answer it should end in.
      const p = buildComposerPrompt(templates, racing(why))
      expect(p).not.toContain("It is the only account you are given")
      expect(p).not.toContain("What is being asked")
      expect(p).not.toContain("answer `finished`")
      // And says what it is instead. Asserted as well as the absences, because a block
      // that lost its nested sentence would pass every one of them: the kind would go
      // quiet rather than wrong, which is the way this partial erodes.
      expect(p).toContain(says)
      // The outer paragraph, and no second copy of it from inside the displaced block.
      expect(p.split("Take it as the requirement")).toHaveLength(2)
    },
  )

  it("renders a fold inside a fold, each level as the account it is", () => {
    // Two raced presses, the second after a resume: the type admits it and every reader
    // recurses. The innermost `Raised` still reaches the composer with its corrections.
    const twice = racing({
      _tag: "Replanned",
      step: 1,
      reason: "at the gate",
      displaced: DISPLACED.Raised[0],
    })
    const p = buildComposerPrompt(templates, twice)
    expect(p).toContain("go simpler")
    expect(p).toContain("at the gate")
    expect(p).toContain("it names no files")
    // Both nested levels say what they are: the middle one a person's earlier press,
    // the innermost the raise neither of them read.
    expect(p).toContain(DISPLACED.Replanned[2])
    expect(p).toContain(DISPLACED.Raised[2])
    expect(p.split("asked for a different rest of the plan")).toHaveLength(3)
    expect(p.split("Take it as the requirement")).toHaveLength(2)
    expect(p).not.toContain("It is the only account you are given")
    expect(p).not.toContain("What is being asked")
  })
})

describe("buildComposerPrompt — the trak's requirements survive every reason it is re-asked", () => {
  const settled: readonly Recorded[] = [
    { text: "we are staying on the current library", source: "stated", at: "0-build" },
  ]
  /** `decisionsText`'s own output, which is what the block is supposed to carry. */
  const rendered = "- **stated** — we are staying on the current library\n  *0-build.1*"

  const REASONS = [
    [
      "work raised",
      { _tag: "Raised", step: 1, requirements: ["the footer wants designing"], corrections: [] },
    ],
    [
      "a complaint and nothing else",
      {
        _tag: "Raised",
        step: 1,
        requirements: [],
        corrections: [{ at: "0-discovery", text: "it names no files" }],
      },
    ],
    ["a person replanning", { _tag: "Replanned", step: 2, reason: "try a smaller piece" }],
    ["the world coming back", { _tag: "Reentered", what: "CI is red" }],
    ["a merge that did not go in", { _tag: "Conflicted", paths: ["flag.ts"] }],
    ["the engine refusing a writer", { _tag: "Refused", step: 2, reason: "`fix` writes" }],
  ] as const satisfies readonly (readonly [string, Reconsult["why"]])[]

  it.each(REASONS)("still shows what the trak has settled, asked because of %s", (_, why) => {
    const p = buildComposerPrompt(templates, {
      ...ctxFor("- unblock: picks up work another step could not finish"),
      trak: { ...midway, decisions: settled, reconsult: { why } },
      trigger: Triggers.reconsulted(),
    })
    expect(p).toContain("**requirements** were recorded")
    expect(p).toContain("oldest first. Later ones win")
    expect(p).toContain(rendered)
  })

  it("still shows them at a compose entry the composer wrote for itself", () => {
    // The fifth reason, and the one with nothing on `Trak.reconsult` — so it is a
    // fixture rather than a row above.
    const p = buildComposerPrompt(templates, {
      ...ctxFor("- unblock: picks up work another step could not finish"),
      trak: {
        ...midway,
        decisions: settled,
        plan: proposal("Add a flag", [
          { agent: "discovery", instruction: "Plan it." },
          { agent: "breakdown", instruction: "Break it down." },
          { type: "compose", instruction: "one service or two" },
        ]),
      },
      trigger: Triggers.reconsulted(),
    })
    expect(p).toContain("You planned this turn yourself")
    expect(p).toContain(rendered)
  })

  it("keeps the raised list beside them, under a heading of its own", () => {
    // The two blocks are different things and both are owed: what this trak has
    // decided, and what the step that just filed says the plan is missing. Before the
    // rename the second stood where the first should have been, wearing its heading.
    const p = buildComposerPrompt(templates, {
      ...ctxFor("- unblock: picks up work another step could not finish"),
      trak: {
        ...midway,
        decisions: settled,
        reconsult: {
          why: {
            _tag: "Raised",
            step: 1,
            requirements: ["the footer wants designing"],
            corrections: [],
          },
        },
      },
      trigger: Triggers.reconsulted(),
    })
    expect(p).toContain(rendered)
    expect(p).toContain("It found work this plan does not have:\n\n- the footer wants designing")
    expect(p.indexOf("**requirements** were recorded")).toBeLessThan(
      p.indexOf("## Where this has got to"),
    )
  })
})

describe("buildComposerPrompt — resume after answering", () => {
  it("carries only the answers, not the whole request again", () => {
    const p = buildComposerPrompt(templates, {
      ...ctxFor("- build: does work"),
      trigger: Triggers.answers(["list only"]),
    })
    expect(p).toContain("1. list only")
    expect(p).not.toContain("Add a flag")
    expect(p).toContain("Now propose the pipeline.")
  })

  it("carries the note under its own heading, ahead of the instruction to propose", () => {
    const p = buildComposerPrompt(templates, {
      ...ctxFor("- build: does work"),
      trigger: Triggers.answers(["list only"], "keep it to two steps"),
    })
    expect(p).toContain("keep it to two steps")
    expect(p).not.toContain("2. keep it to two steps")
    expect(p.indexOf("keep it to two steps")).toBeLessThan(p.indexOf("Now propose the pipeline."))
  })

  it("is what it always was when nobody sent a note", () => {
    const p = buildComposerPrompt(templates, {
      ...ctxFor("- build: does work"),
      trigger: Triggers.answers(["list only"]),
    })
    expect(p).toBe("## Answers to your questions\n\n1. list only\n\nNow propose the pipeline.")
  })

  it("hands the composer its own recommendation back by number, ahead of the instruction to propose", () => {
    const p = buildComposerPrompt(templates, {
      ...ctxFor("- build: does work"),
      trigger: Triggers.unanswered([{}, { recommended: "own PR" }]),
    })
    expect(p).toContain("1. No recommendation — use your best judgment.\n")
    expect(p).toContain("2. Your recommendation, taken: own PR\n")
    expect(p.indexOf("2. Your recommendation")).toBeLessThan(p.indexOf("Now propose the pipeline."))
  })

  it("lets a message through as written, with nothing around it", () => {
    // The composer's chat turn, and the same bareness a step's has: the contract
    // on the session is what reads an unframed prompt as a person waiting.
    const p = buildComposerPrompt(templates, {
      ...ctxFor("- build: does work"),
      trigger: Triggers.message("why does review come last?"),
    })
    expect(p).toBe("why does review come last?")
  })

  it("tells a resumed composer to continue, framed so it cannot read as a person", () => {
    const p = buildComposerPrompt(templates, {
      ...ctxFor("- build: does work"),
      trigger: Triggers.interrupted(),
    })
    expect(p).toBe("## Continue\n\nCarry on from where you left off.")
    expect(p).not.toContain("the process running it died")
  })

  it("falls back to the full prompt for the one trigger only a step can have", () => {
    // `decide` never builds a `Compose` with it, but `Command.Compose` carries the
    // whole `Trigger`, so selection has to answer for it. The answer is the full
    // prompt: every resume body assumes a session already holding the request, and
    // that assumption is exactly what would be wrong here.
    const p = buildComposerPrompt(templates, {
      ...ctxFor("- build: does work"),
      trigger: Triggers.checkFailure("v", "out"),
    })
    expect(p).toContain("Add a flag")
    expect(p).toContain("- build: does work")
    expect(p).toContain("Compose a pipeline")
    expect(p).not.toContain("Continue.")
  })

  it("re-sends no contract on any resume", () => {
    for (const trigger of [
      Triggers.message("x"),
      Triggers.answers(["list only"]),
      Triggers.interrupted(),
    ]) {
      const p = buildComposerPrompt(templates, { ...ctxFor("- build: does work"), trigger })
      expect(p).not.toContain('"type": "proposal"')
      expect(p).not.toContain('"type": "questions"')
    }
  })
})

/** The figure labels a prompt opens a fence with — each grammar's example, once. */
const figuresTaught = (p: string) =>
  [...p.matchAll(/^```(\w+)$/gmu)]
    .map((m) => m[1])
    .filter((label) => FIGURES.some((f) => f === label))

/** Both halves as one text — what a CLI with a session prompt is handed. */
const stepSystem = (
  sections: readonly OutputSection[] = SECTIONS,
  conversational = false,
  skills: readonly Skill[] = [],
) => {
  const brief = buildSystemPrompt(templates, { role: "step", sections, conversational, skills })
  return `${brief.core}\n\n${brief.contract}`
}
const composerBrief = buildSystemPrompt(templates, { role: "composer" })
const composerSystem = `${composerBrief.core}\n\n${composerBrief.contract}`

describe("buildSystemPrompt — the core both roles share", () => {
  const both = [stepSystem(), composerSystem]

  it("says only the envelope is kept, which is why brevity is the rule", () => {
    for (const p of both) expect(p).toContain("every other word you write is discarded")
  })

  it("decides narration by who is watching, never by the model's thinking", () => {
    for (const p of both) {
      expect(p).toContain("Explain what you are doing only when a person is watching")
      expect(p).toContain("at most a short outline of the major steps")
      expect(p).not.toMatch(/reasoning|think out loud/i)
    }
  })

  it("does not let terse be read as incomplete", () => {
    // The one risk of this prompt: an agent that trims the output contract too.
    for (const p of both) expect(p).toContain("Terse is not incomplete")
  })

  it("carries no project policy — that arrives as data, from .orkestra", () => {
    for (const p of both) {
      expect(p).not.toContain("{{")
      expect(p).not.toContain("orkestra-ts")
    }
  })

  it("keeps the core and the contract apart, with the contract whole", () => {
    // A CLI with no session prompt is told the core once and the contract again on
    // a takeover, so each half has to stand on its own — and a role whose contract
    // failed to render would still produce a plausible-looking core otherwise.
    const stepBrief = buildSystemPrompt(templates, {
      role: "step",
      sections: SECTIONS,
      conversational: false,
      skills: [],
    })
    for (const brief of [stepBrief, composerBrief]) {
      expect(brief.core).toContain("# Running under Orkestra")
      expect(brief.core).not.toContain("## What you return")
      expect(brief.contract).toContain("## What you return")
    }
  })
})

describe("buildSystemPrompt — the contract, said once per session", () => {
  const both = [stepSystem(), composerSystem]

  it("owes the envelope when the work is done, with or without a human present", () => {
    // The wording that replaced a `chatting` flag with two openings. It has to
    // hold for every turn of a session at once, and most of those turns have
    // nobody in them — so nothing here waits for a person or for agreement.
    for (const p of both) {
      expect(p).toContain("End the turn with a JSON object")
      expect(p).toContain("produce it when the work is done")
      // the two conditional openings it replaced
      expect(p).not.toContain("If — and only if —")
      expect(p).not.toContain("End your response with a JSON object")
    }
  })

  it("says a bare prompt means a person is waiting to read the reply", () => {
    // A standing rule on the session rather than something said in the body of
    // that turn. The resume bodies are what make it decidable: only a `Message`
    // arrives unframed.
    // Short substrings only: the template wraps at 80, so anything longer than a
    // few words straddles a line break.
    for (const p of both) {
      expect(p).toContain("nothing but someone's words")
      expect(p).toContain("a person waiting for your reply")
      expect(p).toContain("Answer in prose")
    }
  })

  it("does not let a reply stand in for the work it was asked for", () => {
    // The failure this sentence exists for: "make it narrower" getting back
    // "I could narrow that" instead of a narrower artifact.
    for (const p of both) {
      expect(p).toContain("replying is not doing it")
    }
  })

  it("owes the envelope on a chat only where the document changes, and only the change", () => {
    // The other failure the same paragraph exists for: "do it" at a gate buying the
    // whole document again. Prose sends no envelope; an edit sends the sections it
    // touched. `StepOutputFor(_, true)` is what holds the step to exactly that.
    for (const p of both) {
      expect(p).toContain("with no envelope")
      expect(p).toContain("carrying only what changed")
      expect(p).toContain("the sections you edited")
      expect(p).toContain("what you\nfiled stands")
    }
    // The composer has no partial plan to send, and the same paragraph says so.
    expect(both[1]).toContain("sends the whole plan")
  })
})

describe("buildSystemPrompt — the step's half", () => {
  it("asks for a language on a code fence, which is what the client colours by", () => {
    const p = stepSystem()
    expect(p).toContain("A fence whose contents are code names its language")
    // And not on the rest: prose coloured as code is worse than prose left grey.
    expect(p).toContain("stay unlabeled")
  })

  it("carries the step's shapes and none of the composer's", () => {
    const p = stepSystem()
    expect(p).toContain('"type": "artifact"')
    expect(p).toContain('"type": "questions"')
    expect(p).not.toContain('"type": "proposal"')
  })

  it("offers `permission`, and tells a step not to work around a denial", () => {
    const p = stepSystem()
    expect(p).toContain('"type": "permission"')
    expect(p).toContain("instead of working around the")
    // The composer has no such gate, so no such shape.
    expect(composerSystem).not.toContain('"type": "permission"')
  })

  it("offers `stuck`, which names no destination and schedules nothing", () => {
    const p = stepSystem()
    expect(p).toContain('"type": "stuck"')
    expect(p).not.toContain("routeTo")
    // The line that keeps it from reading as a request for help: nothing plans
    // from it, so an agent reaching for it is stopping the work, not delegating.
    // Short substrings: the template wraps at 80, so a longer phrase straddles it.
    expect(p).toContain("nothing is planned")
    expect(p).toContain("no agent\nis sent to rescue it")
    // The first step can say so like any other — the review-first unlock.
    expect(p).not.toContain("no stage ran before this one")
  })

  it("makes `stuck` the last resort, after every other shape, and names the fields", () => {
    const p = stepSystem()
    expect(p).toContain("only when you can file neither the artifact")
    expect(p).toContain("`questions`, nor `permission`")
    for (const field of ["tried", "happened", "diagnosis"]) {
      expect(p).toContain(`**${field}**`)
    }
  })

  it("carries the anti-instinct, because the default is ten more turns of flailing", () => {
    const p = stepSystem()
    // Short substring: the template wraps at 80, so a longer phrase straddles it.
    expect(p).toContain("rather than retrying an approach")
    expect(p).toContain("beats five muddled")
  })

  it("tells a step `failed` is not its to return, rather than staying silent about it", () => {
    // An agent that has seen the shape elsewhere reaches for it; silence would
    // cost three re-prompts to discover.
    expect(stepSystem()).toContain("there is no such shape here")
  })

  it("offers `requirements`, and keeps it apart from being stuck", () => {
    const p = stepSystem()
    expect(p).toContain('"requirements"')
    // The bar, which is the whole of why the field is not a follow-up list: every
    // other test in this contract turns on what the agent was unsure of.
    expect(p).toContain("consequence, not uncertainty")
    expect(p).toContain("even when you are sure of it")
    // and the line that stops the two envelopes overlapping
    expect(p).toContain("Work the plan is missing is not `stuck`")
  })

  it("offers `corrections`, and states the question that sorts them from requirements", () => {
    const p = stepSystem()
    expect(p).toContain('"corrections"')
    expect(p).toContain("Would this still be true after somebody fixed it?")
    // The near-misses are the lever this contract had not yet pulled: both blocks
    // this one replaced stated the bar in prose and both still over-fired.
    expect(p).toContain("If it is visible in the diff, it is not a requirement")
    expect(p).toContain("a worry, not a decision")
  })

  it("states the agent's declared sections, and asks for them as `sections`", () => {
    const p = stepSystem()
    expect(p).toContain("## What the artifact must contain")
    expect(p).toContain("**Summary**")
    expect(p).toContain("**Risks** — only when a step is left half-done")
    expect(p).toContain('"sections": { "<title>": "<markdown>", … }')
    expect(p).not.toContain('"content": "<the output you were asked for>"')
  })

  it("teaches the grammar of each figure its sections declare, and `table`, and no other", () => {
    const p = stepSystem([
      { title: "Choices", description: "What was chosen.", when: undefined, figure: "decision" },
      { title: "Files", description: "Where.", when: "a file is new", figure: "files" },
    ])
    expect(p).toContain("**Choices** — written as the `decision` figure")
    expect(p).toContain("**Files** — only when a file is new — written as the `files` figure")
    const taught = figuresTaught(p)
    expect(taught).toEqual(["decision", "files", "table"])
  })

  it("teaches `table` alone to a step whose sections declare no figure", () => {
    const taught = figuresTaught(stepSystem())
    expect(taught).toEqual(["table"])
  })
})

/** The step contract with the one paragraph that moves cut out of it. */
const withoutDeadline = (p: string) =>
  p.slice(0, p.indexOf("**This step")) + p.slice(p.indexOf("- artifact:"))

describe("buildSystemPrompt — the repository skills a role names", () => {
  const SKILLS: readonly Skill[] = [
    { name: "house-style", path: ".claude/skills/house-style/SKILL.md" },
    { name: "lens", path: ".agents/skills/lens/SKILL.md" },
  ]

  it("names each skill with its path, on the session so every turn carries it", () => {
    const p = stepSystem(SECTIONS, false, SKILLS)
    expect(p).toContain("## Skills this role reads")
    expect(p).toContain("- `house-style` — `.claude/skills/house-style/SKILL.md`")
    expect(p).toContain("- `lens` — `.agents/skills/lens/SKILL.md`")
  })

  it("says nothing about skills for a role that names none", () => {
    expect(stepSystem()).not.toContain("Skills this role reads")
    expect(stepSystem()).not.toContain("SKILL.md")
  })
})

describe("buildSystemPrompt — a conversational step, which owes the same artifact later", () => {
  const enforced = stepSystem(SECTIONS, false)
  const unenforced = stepSystem(SECTIONS, true)

  it("moves the deadline, and says so in one line", () => {
    expect(enforced).toContain("owes its artifact from the first turn")
    expect(enforced).not.toContain("starts as a conversation")

    expect(unenforced).toContain("starts as a conversation")
    expect(unenforced).toContain("the artifact is not owed on the first")
    expect(unenforced).not.toContain("owes its artifact from the first turn")
  })

  it("carries the anti-instinct inline, so every agent gets it without a brief", () => {
    // A model asked to talk something through will summarise and stop. What it
    // has to be told is that the two are not the same thing.
    // Short substrings: the template wraps at 80, so a longer phrase straddles it.
    expect(unenforced).toContain("when the work has settled, not when a turn feels")
  })

  it("renders the output contract identically in both, which is what makes that concrete", () => {
    // The claim the whole flag rests on: the shapes, the sections and the
    // the stuck rules do not move — only when the artifact is owed does. Cut the
    // one paragraph out of each and what is left has to be the same prompt.
    expect(withoutDeadline(unenforced)).toBe(withoutDeadline(enforced))
    // and the cut found something in both, rather than passing on two no-ops
    expect(withoutDeadline(enforced).length).toBeLessThan(enforced.length)
    expect(withoutDeadline(unenforced).length).toBeLessThan(unenforced.length)
  })
})

/**
 * Its own block, because what it holds is the whole of a rule nothing else can enforce:
 * a gate turns on this rung, and the only thing keeping it answerable honestly is that
 * the paragraph asking for it never says so.
 *
 * Both roles, from one partial — a step reports what its work ran into and the composer
 * what planning ran into, and two paragraphs for one field is two vocabularies the
 * threshold compares as though they were one.
 */
/** The ambiguity block itself, from its heading to the next one — see its last case. */
const askedFor = (p: string): string => {
  const from = p.indexOf("## How ambiguous this was")
  const next = p.indexOf("\n## ", from + 1)
  return p.slice(from, next === -1 ? undefined : next)
}

describe("buildSystemPrompt — the rung every envelope that carries work owes", () => {
  const both = [
    [
      "step",
      stepSystem([
        { title: "Summary", description: "what changed", when: undefined, figure: undefined },
      ]),
    ],
    ["composer", composerSystem],
  ] as const

  it.each(both)("asks %s what the turn ran into, and never how sure it is", (_role, p) => {
    expect(p).toContain("How ambiguous this was")
    expect(p).toContain("What did you run into that nobody had decided?")
    // The half that keeps it from being a confidence rating, which is answerable from
    // nothing and drifts with the tone of the brief.
    expect(p).toContain("Not how")
    expect(p).toContain("sure you are of the result")
    expect(p).toContain("you are not certain the change is correct")
  })

  it.each(both)("tells %s that the lowest rung is the ordinary answer", (_role, p) => {
    // Presented as a field to fill, an agent fills it — and here filling it means
    // climbing, because the higher rung reads as the more careful answer.
    expect(p).toContain("is the ordinary answer and most turns write it")
  })

  it.each(both)("says nothing to %s about a rung buying or costing a gate", (_role, p) => {
    // The whole of what makes it askable. A rung a turn knows a gate turns on is a
    // question about the work put to the party with a reason to answer it wrong —
    // which is what `clearance` was. No later change may explain the field in gates to
    // make it more accurate. Asserted over the block alone, because the prompt around
    // it talks about gates for its own reasons.
    const block = askedFor(p)
    expect(block).not.toContain("gate")
    expect(block).not.toContain("approv")
    expect(block).not.toContain("unattended")
    expect(block).not.toContain("nobody read")
  })
})

describe("buildSystemPrompt — the composer's half", () => {
  it("offers the composer Questions as well as a Proposal", () => {
    expect(composerSystem).toContain('"type": "proposal"')
    expect(composerSystem).toContain('"type": "questions"')
    // and tells it why guessing is dear
    expect(composerSystem).toContain("costs the whole pipeline")
  })

  it("does not offer the composer shapes it has no business returning", () => {
    expect(composerSystem).not.toContain('"type": "artifact"')
    expect(composerSystem).not.toContain('"type": "stuck"')
  })

  it("describes question options, not bare strings", () => {
    expect(composerSystem).toContain('"options"')
    expect(composerSystem).toContain('"label"')
  })

  it("takes no per-step data — a composer's contract is the same on every trak", () => {
    expect(composerSystem).not.toContain("What the artifact must contain")
    expect(composerSystem).not.toContain("What I tried")
  })
})

describe("buildStepPrompt — a step a person started before its condition was met", () => {
  it("tells the step which condition it was waiting on, under the instruction, and only then", () => {
    const forced = {
      ...trak,
      slots: new Map([[0, { ...noSlot, skippedWait: "merged" }]]),
    }
    const out = buildStepPrompt(templates, { ...ctx, trak: forced })
    expect(out).toContain("This step was held until `merged` was met, and it is not")
    expect(out).toContain("started the step anyway")
    // The fact sits under the instruction, where a skipped step's note does.
    expect(out.indexOf("Describe what the change involves.")).toBeLessThan(
      out.indexOf("This step was held until"),
    )
    // And above what was asked for, on the same argument: it is a fact about how
    // this turn came to run, not part of the request.
    expect(out.indexOf("This step was held until")).toBeLessThan(
      out.indexOf("## How this work was asked for"),
    )
    expect(buildStepPrompt(templates, ctx)).not.toContain("This step was held until")
  })
})

describe("buildStepPrompt — hosted processes", () => {
  it("says which hosted processes are up and where, and why one is not", () => {
    const hosting = buildStepPrompt(templates, {
      ...ctx,
      processes: [
        {
          name: "dev",
          description: "The dev server.",
          url: "http://[::1]:22345/",
          notUp: undefined,
          reason: undefined,
          exitCode: undefined,
          variable: "HOSTED_DEV_URL",
        },
        {
          name: "api",
          description: "The API.",
          url: undefined,
          notUp: "didNotComeUp",
          reason: "Nothing answered on port 22346 in 30s, so it was stopped.",
          exitCode: undefined,
          variable: "HOSTED_API_URL",
        },
        {
          name: "web",
          description: "The web server.",
          url: undefined,
          notUp: "exited",
          reason: undefined,
          exitCode: 0,
          variable: "HOSTED_WEB_URL",
        },
      ],
      processTools: true,
    })
    expect(hosting).toContain("Running at http://[::1]:22345/, which is also in `$HOSTED_DEV_URL`.")
    expect(hosting).toContain("**Not running:** it did not come up. Nothing answered on port 22346")
    expect(hosting).toContain("**Not running:** it exited with code 0.")
    expect(hosting).toContain("`process_status` for every one")
    expect(hosting).toContain("Never start one in the background")
    // A step with nothing hosted and no process tools is told nothing about either.
    const bare = buildStepPrompt(templates, ctx)
    expect(bare).not.toContain("Processes running in this checkout")
    expect(bare).not.toContain("Processes you can manage")
  })
})

describe("the background work a session's last filing stopped", () => {
  const stopped = [{ id: "bq7", description: "pnpm verify" }, { id: "c41" }]
  const NOTICE = "## From Orkestra: background work your last filing stopped"

  it("names each stopped task after the body, by its description or else its handle", () => {
    const p = buildStepPrompt(templates, {
      ...ctx,
      trigger: Triggers.answers(["yes"]),
      stopped,
    })
    expect(p.startsWith("## Answers to your questions\n\n1. yes\n\n" + NOTICE)).toBe(true)
    expect(p).toContain("\n- pnpm verify\n- c41\n")
    expect(p).toContain("wait for it to finish before you file")
  })

  it("leaves a person's message as the first thing in the prompt it was typed into", () => {
    const p = buildStepPrompt(templates, {
      ...ctx,
      trigger: Triggers.message("Is that right?"),
      stopped,
    })
    expect(p.startsWith(`Is that right?\n\n${NOTICE}`)).toBe(true)
  })

  it("says nothing on any body when nothing was stopped", () => {
    // Byte for byte what the body was, so a turn that stopped nothing is sent the
    // prompt it was sent before the notice existed.
    expect(
      buildStepPrompt(templates, { ...ctx, trigger: Triggers.message("Is that right?") }),
    ).toBe("Is that right?")
    const triggers = [
      Triggers.initial(),
      Triggers.answers(["yes"]),
      Triggers.checkFailure("verify", "2 errors"),
      Triggers.interrupted(),
    ]
    for (const trigger of triggers) {
      expect(buildStepPrompt(templates, { ...ctx, trigger })).not.toContain("From Orkestra")
      expect(buildComposerPrompt(templates, { ...ctxFor(""), trigger })).not.toContain(
        "From Orkestra",
      )
    }
  })

  it("is owed on every body a session can be sent, the full ones and the composer's too", () => {
    const triggers = [
      Triggers.initial(),
      Triggers.message("Is that right?"),
      Triggers.answers(["yes"]),
      Triggers.checkFailure("verify", "2 errors"),
      Triggers.interrupted(),
    ]
    for (const trigger of triggers) {
      expect(buildStepPrompt(templates, { ...ctx, trigger, stopped })).toContain(NOTICE)
      expect(buildComposerPrompt(templates, { ...ctxFor(""), trigger, stopped })).toContain(NOTICE)
    }
  })
})

describe("the standing instruction on filing with background work running", () => {
  it("tells both roles that filing stops it, so a job that must finish is waited for", () => {
    const core = buildSystemPrompt(templates, { role: "composer" }).core
    expect(core).toContain("## Filing ends the turn")
    expect(core).toContain("Writing the JSON object ends the turn")
    expect(core).toContain("wait for a job that has to finish")
    expect(core).toContain("started with the `start_process` tool")
  })
})
