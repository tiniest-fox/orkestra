# Community Building

## The Core Principle

The founder's personal visibility and responsiveness is the product in the first 6 months. A slightly rougher tool with an obsessively responsive founder beats a polished tool with a ghost maintainer every time.

This is well-documented across Supabase, Linear, Vercel, and nearly every successful developer tool. The pattern is consistent: founders answer questions personally in Discord for the first year. The community forms around that responsiveness, and then it becomes self-sustaining.

**Confidence: High** — This is one of the most consistent patterns in successful developer tool launches.

---

## Platforms

### GitHub Discussions

**Use for:** Technical questions, bug reports, feature requests, design discussions

**Why this matters:**
- Indexed by Google. Questions answered here become SEO content over time.
- Creates a searchable knowledge base that reduces repeat support questions
- PR-friendly: contributions to answers are visible on contributors' profiles

**Setup before launch:**
- Enable GitHub Discussions in repository settings
- Create starter categories: Q&A, Ideas, Show and Tell, General
- Post a pinned "Welcome to Orkestra Discussions" post that explains how to ask a good question

**Your behavior:**
- Respond to every post within 24 hours for the first 3 months
- Close questions with a summary of the resolution
- Convert good questions into documentation entries

---

### Discord

**Use for:** Real-time help, casual community, feedback sessions, direct user conversations

**Why not just GitHub Discussions?**
Discord enables the kind of real-time, back-and-forth conversation that builds community feeling. GitHub Discussions is better for async, durable content. Both serve different needs.

**Channel structure (start small, expand as needed):**

```
# INFO
  #announcements   (you post here, read-only)
  #getting-started (pinned links to docs, quick start)

# COMMUNITY
  #general         (casual conversation)
  #showcase        (users sharing what they built with Orkestra)
  #feedback        (what's working, what isn't)

# SUPPORT
  #help            (questions — redirect GitHub-worthy questions to Discussions)

# DEVELOPMENT
  #contributors    (people actively contributing to the codebase)
  #roadmap         (share upcoming work, get input)
```

**Don't create channels you won't actively moderate.** An empty #ideas channel looks abandoned. Add channels when there's enough conversation that it needs its own space.

**Your behavior:**
- Welcome every new member personally (or at minimum the first 50-100)
- Be present in #help multiple times per day during launch period
- Share development updates in #roadmap before they're public — Discord members get early context

---

### GitHub Issues

GitHub Issues are not community-building per se, but they're where community members make their first contribution. Set them up to encourage that.

**Before launch:**
- Apply `good-first-issue` labels to 5-10 issues. These are your onramp for contributors.
- Write clear issue templates (bug report, feature request). Reduce the friction to file a good issue.
- Create a pinned "How to contribute" issue or link to CONTRIBUTING.md in the template

**Your behavior:**
- Label all issues within 24 hours
- Respond to bug reports with "reproduced" or "cannot reproduce" acknowledgment
- Thank contributors by name in release notes — this creates strong positive reinforcement

---

## Community Flywheel

The pattern that sustains community growth:

```
1. Founder visible and responsive (response time < 24h)
2. Users get unstuck quickly → tell others → more users arrive
3. Power users get early access to new features → feel invested
4. Good contributions get highlighted in changelog by name
5. Highlighted contributors tell their networks → new contributors arrive
6. Community helps newer members → founder burden decreases
7. Repeat
```

The flywheel stalls at step 1 if the founder disappears. It stalls at step 5 if contributions go unacknowledged.

---

## Office Hours

A monthly 1-hour open video call (Zoom, Google Meet, or Discord Stage) where anyone can show up and ask questions.

**Why this works:**
- You learn more about user problems in one session than in 50 async messages
- Users who attend feel personally invested
- Recording and posting the call creates additional content

**Format:**
- No formal agenda — just show up and talk with users
- Record and post to YouTube/Discord
- Take notes on every recurring question or frustration

**Frequency:** Monthly for the first 6 months. Then adjust based on demand.

---

## The "Building in Public" Approach

Before launch and throughout the first year, share development progress publicly on Twitter/X and in Discord.

**What to share:**
- Design decisions and why you made them ("we almost did X but chose Y because Z")
- Things that didn't work and what you learned
- Early looks at new features before they're polished
- Behind-the-scenes of running an open source project

**What not to share:**
- Marketing language ("excited to announce")
- Vague "working on something big" teases
- Comparison attacks on competitors

Building in public builds trust because it's honest and it creates an audience before you need them. People who've followed your development journey are far more likely to try the product and tell others than cold-start users.

**Commitment required:** 2-4 posts per week on Twitter/X. This is roughly 30-60 minutes per week of writing. Sustainable for a solo founder.

---

## First 50 Users: Do Things That Don't Scale

Before you have processes, be a person. Strategies that work at 50 users but not at 5,000:

- DM every person who stars the repo in the first week. Ask what brought them there and what they're hoping to use Orkestra for.
- Get on a 30-minute call with anyone who asks. You are the support team.
- Write personalized responses to every GitHub Issue. Not templates.
- Invite early users to a "founding members" Discord role with early access to features.

This doesn't scale. That's fine. The relationships you build with the first 50 users become your most reliable feedback source, your most enthusiastic advocates, and in some cases your first contributors.

---

## Community Health Signals

These indicate a healthy community (good), or a community in trouble (bad):

**Healthy signs:**
- Users answering each other's questions (not waiting for you)
- Users sharing what they built with Orkestra
- Critical but constructive feedback in Discussions
- First-time GitHub contributors submitting PRs

**Warning signs:**
- Same basic questions asked repeatedly (documentation problem)
- No activity in Discussions for > 2 weeks
- Issues filed with no response for > 1 week
- Users reporting the same bugs multiple times

---

## Moderation

Keep moderation light but explicit. Have a code of conduct before launch (the Contributor Covenant is the standard, one-page, works fine for most open source projects).

Common moderation cases for developer tools:
- Off-topic posts: redirect kindly to the right channel or forum
- Duplicate questions: link to the existing answer
- Hostile or dismissive behavior: direct message first, remove from server if repeated

You won't need to make many moderation decisions in the first few months. Having a written policy means you're never making it up on the spot.
