# Positioning and Differentiation

## The Competitive Landscape

The AI coding tools space is crowded at the extremes — fully autonomous agents (Devin) and IDE extensions (Cursor) — but the middle ground of *structured, human-overseen AI workflows* is wide open.

| Tool | Model | Key Weakness vs Orkestra |
|------|-------|--------------------------|
| Devin | Fully autonomous, cloud-only | No human oversight, $500/mo, closed source, hallucination risk is unconstrained |
| Cursor | IDE extension, reactive | Not workflow-based; no planning pipeline; no multi-agent |
| GitHub Copilot Workspace | GitHub-integrated | Early-stage, Microsoft-controlled, no customization |
| SWE-agent | Research-oriented | No UI, no pipeline config, not production-ready |
| Aider | CLI, simple loop | Single-agent, no planning/review stages |
| Claude Code (raw) | Single-agent CLI | No orchestration, no approval gates, no configurable workflow |

**Confidence: High** — these are well-documented limitations from public reviews, GitHub issues, and user complaints.

## Core Differentiators (Ranked by Strength)

### 1. Human-in-the-loop at every stage (Strongest)

Devin's main documented failure mode is unconstrained autonomy — the agent goes off-rails and no one catches it until the damage is done. Orkestra's approval gates are a *feature*, not a limitation.

The narrative: "We don't believe fully autonomous AI coding is reliable yet. We built the tool we actually want to use — one where the AI does the hard work and a human makes the final call."

This positions Devin as risky and Orkestra as pragmatic. It also predicts the eventual winning architecture for enterprise adoption.

### 2. Configurable pipeline (Strong)

YAML-configurable stages means teams can adapt the workflow to their actual process: code review requirements, compliance gates, custom validation scripts, different agents for different stage types.

This is a moat. No other tool lets you define "our planning stage uses Claude, our implementation uses OpenCode, our review runs a custom script, and we always require human approval before merge."

### 3. Open source and self-hosted (Strong for certain audiences)

Enterprises and privacy-conscious developers will not send their codebase to a third-party cloud. Orkestra's self-hosted model means the code never leaves your infrastructure.

This is also a trust argument: "You can read every line of code that touches your repository."

### 4. Git worktree isolation (Medium)

Clean branch-per-task model. Each AI agent works in its own isolated worktree. No interference between parallel tasks, full git history, easy rollback. Integrates with existing git workflows.

Technical users will appreciate this immediately. Less technically-oriented users may need it explained.

### 5. Multi-provider support (Medium)

Claude Code and OpenCode today. The provider registry is designed for extensibility. This is a hedge against vendor lock-in at the agent level.

### 6. Rust implementation (Smaller audience, strong within it)

Performance, reliability, lightweight daemon. Resonates in the Rust community (300k+ on r/rust). Less important outside that community.

## Messaging Hierarchy

**Primary message (use everywhere):**
> "The AI coding workflow that works *with* your team, not around it."

**Supporting messages (pick 2-3 per context):**
- "Configure the pipeline your team actually uses"
- "Every AI decision goes through your review before it merges"
- "Open source: your code stays on your infrastructure"
- "Plan, implement, review — each stage the right agent, every change your approval"

**What to avoid:**
- Competing on raw coding ability ("our AI writes better code"). You cannot win this against Devin/Cursor's marketing budgets, and it's not true.
- "Replaces your engineering team." The developer community will not trust this claim, and it's the wrong positioning anyway.
- Comparing yourself to GitHub Copilot — different product category, confuses the message.

## Ideal Customer Profile

**Primary:** Technical founders and senior engineers at startups/small teams who:
- Are already using Claude Code or similar tools manually
- Want to automate the repetitive parts of the agent workflow
- Care about code quality and want review gates
- Are comfortable with CLI tools and self-hosting

**Secondary:** Engineering leads at mid-size companies who:
- Need to justify AI tool adoption to security/compliance teams
- Want to customize the pipeline to match their engineering process
- Prefer open source for auditability

**Not (yet):** Large enterprises with complex procurement, non-technical users, anyone who wants a fully hands-off solution.

## Positioning Statement (for HN / README headline)

> "Orkestra is an open source AI task orchestration system for software development. It manages a configurable pipeline of AI agents — planning, implementation, review — with human approval gates at every stage, git worktree isolation for each task, and full configurability via YAML."

Shorter version (for Twitter bio / GitHub description):
> "AI-powered dev workflow automation with human-in-the-loop approvals. Configure stages, agents, and review gates in YAML. Self-hosted."

## Talking About Competitors

**Rule:** Be honest, not dismissive. The developer community respects nuance and distrusts hype.

Do: "Devin is impressive for fully autonomous tasks, but we think the right architecture for most teams today includes a human in the loop. Here's why."

Don't: "Devin is garbage, Cursor doesn't do real workflows, etc."

The "our competitors are good but solve a different problem" framing is both honest and more persuasive than attacks.
