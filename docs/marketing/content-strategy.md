# Content Strategy

## The Core Asset: The Demo

No blog post, tweet, or Reddit comment will do more for Orkestra's growth than a well-produced demo video showing the actual pipeline working.

**Why this matters specifically for Orkestra:**
The human-in-the-loop pipeline is a *visual* concept. "An AI agent that asks for your approval before merging" lands completely differently when you see the approval screen appear than when you read those words.

### What the demo must show

1. Creating a task with a real, non-trivial description (not "fix a typo")
2. The planning stage output as a concrete artifact
3. The human reviewing and approving the plan
4. The implementation running — showing actual code changes happening
5. The review stage: agent catching something, requesting a change
6. The human approving or requesting a revision
7. The final merge

The demo should use a real codebase task, not a toy example. "Add rate limiting to this API" is better than "create a hello world function."

### Video specs

| Version | Length | Use case |
|---------|--------|----------|
| Social cut | 60-90 seconds, no audio | Twitter, Discord, README GIF |
| Full demo | 5-10 minutes, with narration | YouTube, Hacker News, ProductHunt |

Record once. Cut both versions from the same footage.

**Technical requirements:** 1080p+, clear terminal/UI. OBS or Loom work fine. If using Loom, disable the face cam for the short version.

---

## README Structure

The README is your product page. It's the first thing every visitor sees. Get it right before launch.

**Structure:**

```
1. One-sentence value prop
   "Orkestra is an open source AI coding workflow that runs AI agents
   through a configurable pipeline — plan, implement, review — with
   human approval at every stage."

2. Demo GIF (animated, showing the pipeline in action)

3. Key differentiators (3-5 bullets, not marketing, actual features)
   - Human-in-the-loop: every AI output requires your approval before advancing
   - Configurable pipeline: define stages, agents, and gates in YAML
   - Git worktree isolation: each task gets its own branch
   - Multi-provider: Claude Code and OpenCode supported
   - Self-hosted: your code never leaves your infrastructure

4. Quick start (under 5 commands from clone to first workflow)

5. How it works (architecture overview, maybe a diagram)

6. Comparison table vs alternatives

7. Documentation link

8. Community link (Discord / GitHub Discussions)
```

**What to cut:**
- Long feature lists before the demo
- Architecture deep-dives in the README (that's what docs/ is for)
- Installation instructions that require more than 5 steps before the user sees something work

---

## Technical Blog Posts

Write on your own domain (via Hashnode for custom domain + SEO, or a static site). These are for long-term Google visibility and developer credibility.

**Priority posts (write before or shortly after launch):**

### 1. "The problem with fully autonomous AI coding agents"
**Audience:** Developers who've tried Devin or seen the AI coding hype and been burned
**Angle:** The "why" behind Orkestra's human-in-the-loop design
**SEO target:** "ai coding agent problems", "devin alternative", "human in the loop coding"
**Confidence: High value** — directly addresses the most common objection ("why not just use Devin?")

### 2. "Git worktrees: how we give each AI agent isolated context"
**Audience:** Technical developers who care about clean git workflows
**Angle:** The engineering decision to use worktrees, how it works, tradeoffs
**SEO target:** "git worktree ai", "ai agent git isolation"
**Confidence: Medium** — narrow audience but very high quality signal

### 3. "Building configurable AI workflows in YAML"
**Audience:** DevOps/platform engineers who want to customize AI tooling
**Angle:** Tutorial showing how to configure a custom pipeline
**SEO target:** "ai workflow yaml", "configurable ai pipeline"
**Confidence: Medium** — tutorial format ranks well

### 4. "Why we built Orkestra in Rust"
**Audience:** Rust developers, technical evaluators
**Angle:** Performance, safety, the daemon architecture
**SEO target:** "rust developer tools", r/rust post fodder
**Confidence: Medium-High** — r/rust will read this and it builds credibility

### 5. "Multi-agent pipelines vs single-agent loops: lessons learned"
**Audience:** AI engineering practitioners
**Angle:** Architectural lessons, what works, what doesn't
**SEO target:** "multi-agent ai", "agent pipeline architecture"
**Confidence: Medium** — more competitive space but thought leadership value

---

## Building in Public

**What it is:** Sharing the development process publicly on Twitter/X, in Discord, and occasionally in longer-form posts.

**Why it works:**
- Builds an audience *before* you need them (before launch)
- Creates a stream of content without requiring polished blog posts
- Developer audiences respond to authentic problem-solving narratives
- Generates early feedback that improves the product

**What to post:**

| Type | Example | Frequency |
|------|---------|-----------|
| Design decisions | "We almost used X but chose Y because [reason]" | Weekly |
| Hard problems | "Spent 2 days on this and here's what I learned" | As they happen |
| Milestones | "First external user completed a full workflow" | When they happen |
| Architecture sketches | Show a diagram, ask for input | Monthly |
| Honest updates | "This part is harder than expected, here's why" | Monthly |

**What not to post:**
- Marketing language — "excited to announce"
- Vague teases — "something big coming"
- Attack posts on competitors

**Commitment:** 3-5 posts per week, starting 6-8 weeks before launch. This is enough to have a presence without burning out.

---

## SEO Strategy

Organic search is a slow channel (3-6 months to see results) but compounds over time.

**High-intent, low-competition keywords:**

| Keyword | Competition | Intent |
|---------|-------------|--------|
| "ai coding agent with human oversight" | Low | High |
| "open source devin alternative" | Medium | High |
| "configurable ai coding pipeline" | Very low | Medium |
| "claude code automation workflow" | Low | High |
| "multi-agent code review" | Very low | Medium |
| "git worktree ai agent" | Very low | High |
| "self-hosted ai coding tool" | Low | High |

**Strategy:** Write content that answers questions these keywords represent. Don't keyword-stuff — write genuinely useful content and include the keywords naturally.

**The "alternatives to X" format** is the highest-ROI SEO strategy for developer tools. Cal.com built a significant portion of their organic traffic on "open source alternative to Calendly" positioning. Write:
- "The best open source alternatives to Devin"
- "Devin vs open source AI coding tools: 2025 comparison"

These rank for high-intent queries from people actively evaluating tools.

---

## Announcement Post Structure

For HN Show HN, the body of the post should be:

```
We built [one-sentence description].

[Why we built it — honest problem description, not marketing]

[What makes it different — 3-4 points, factual not hype]

[Technical detail — the HN audience is technical, give them something to engage with]

[Current state — be honest about where it is: beta, early, stable]

[Link to demo video]

[How to get started — one command or two]

[What feedback you're looking for]
```

HN rewards honesty and technical depth. The best Show HN posts read like "here's what I built, here's why, here's what I'm unsure about" rather than product announcements.

---

## Changelog and Release Notes

Every release needs a changelog entry. This is not optional.

**Why:** A repo with no release notes looks abandoned. A repo with consistent "v0.1.1: Fixed X, improved Y, added Z" entries looks actively maintained. Developer tools live and die on this signal.

**Format (simple is fine):**

```markdown
## v0.2.0 — 2025-XX-XX

### Added
- OpenCode provider support
- Flow overrides for disallowed tools

### Fixed
- Worktree setup script not running on first task
- Session recovery after daemon restart

### Contributors
Thanks to @username for the OpenCode integration!
```

GitHub Releases + a CHANGELOG.md in the repo cover both discoverability (GitHub shows release count on the repo page) and permanence (the file is in git history).
