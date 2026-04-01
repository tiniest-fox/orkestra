# Launch Timeline

A concrete, phase-by-phase plan from preparation through 6 months post-launch.

---

## Phase 0: Foundation (6-8 Weeks Before Launch)

This phase is about making the product launch-ready and building the infrastructure for the launch itself. Nothing here is public-facing yet.

### Product Readiness

- [ ] Onboarding works without handholding. Test it by watching 3 people who have never seen Orkestra try to install and run it. Fix every friction point they hit.
- [ ] README is complete (see [content-strategy.md](content-strategy.md) for structure)
- [ ] CONTRIBUTING.md exists with clear contribution guidelines
- [ ] `good-first-issue` labels applied to 5+ GitHub issues — first contributors are your earliest community members
- [ ] All three stdio streams are piped correctly so the app doesn't hang in edge cases
- [ ] At least one demo workflow runs end-to-end on a fresh install on macOS, Linux (and Windows if supported)

### Infrastructure

- [ ] GitHub Discussions enabled
- [ ] Discord server created (invite link in README, but don't promote it heavily yet)
- [ ] Simple landing page with email capture — even a GitHub README with a link to a Typeform/Buttondown form works
- [ ] Your own domain with a blog (Ghost, Astro, or even just a GitHub Pages site) — needed for SEO
- [ ] Twitter/X account created if not already — start posting development updates now

### The Demo Video

The demo video is your highest-leverage asset. Record it during this phase.

**What to show:**
1. Creating a new task with a real, non-trivial description (e.g., "Add rate limiting to the API")
2. The planning stage output — show the agent's plan as a real artifact
3. The human approval moment — someone clicking approve
4. The implementation stage running — show actual code being written
5. The review stage catching an issue and requesting a change
6. The fix iteration
7. The final approval and merge

**Length:** Under 3 minutes for social, 5-10 minutes for YouTube. Cut it both ways from the same recording.

**Quality:** Good screen recording (1080p+, Loom or OBS), clear terminal/UI. Audio optional for the short cut; helpful for the long cut.

**This is non-negotiable.** Text explanation of Orkestra's workflow is insufficient. The pipeline is a visual concept. No demo = most people won't understand what you built.

### Early Access

- [ ] Identify 10-20 people you respect in the AI/developer tools space
- [ ] Give them early access, ask for brutal honest feedback specifically on: first-run experience, clarity of the pipeline concept, any workflow that doesn't work
- [ ] Fix the highest-friction issues before launch

---

## Phase 1: Soft Launch (2 Weeks Before Launch Day)

- [ ] Draft the HN Show HN post. Workshop the title with someone outside the project. The title is the most important thing to get right.
  - Good: "Show HN: Orkestra – open source AI coding pipeline with human approval gates"
  - Bad: "Show HN: I built a tool that uses AI agents to automate coding workflows with configurable stages"
- [ ] Draft Reddit posts for r/rust (technical angle) and r/LocalLLaMA (self-hosted AI angle)
- [ ] Prepare 3-5 Twitter posts to go out during launch week
- [ ] Finalize the demo video
- [ ] Reach out to 2-3 newsletter authors with a short pitch and demo link
- [ ] Set the launch date. Tuesday or Wednesday works best for HN timing.

---

## Phase 2: Launch Week

### Day 1 (Tuesday or Wednesday, 7-9am US Eastern)

**Post Show HN to Hacker News.**

Stay on HN for 3 hours after posting. Respond to every comment. This is not optional — HN's ranking algorithm rewards comment velocity, and your responses signal that the post is active and worth reading. Leaving HN after posting is the fastest way to watch your post fall off the front page.

Response guidelines:
- Be honest about limitations. HN respects self-awareness.
- Go technical. If someone asks how worktree isolation works, explain it.
- Thank critical comments. The commenter who points out your biggest weakness is the most valuable.
- Don't be defensive.

If the post hits the front page, emails will start coming in and GitHub stars will spike. This is the time to be available to respond to GitHub issues and new Discord members too.

### Day 2-3

- Post to r/rust: "I built a Rust-based AI coding workflow tool — here's what I learned about process management and worktree isolation." Technical angle, not a pitch.
- Share the HN thread on Twitter/X with a sentence of context

### Day 4-5

- Post to r/LocalLLaMA if Orkestra supports or plans to support local models (or position the self-hosted angle)
- Put the demo video on YouTube if you have a channel

### Day 7-10

- Product Hunt launch (separate from HN — give it its own day)
- Mobilize Discord/email list for Product Hunt votes

### Throughout Launch Week

- Respond to every GitHub issue within a few hours
- Welcome every new Discord member personally (or at minimum, the first 50)
- Collect all feedback into a prioritized list for the post-launch release

---

## Phase 3: Post-Launch Momentum (Weeks 2-8)

The post-launch period is where most projects lose momentum. Plan for it explicitly.

### Week 2: Fix and Release

Ship v0.1.1 or equivalent within 2 weeks of launch with the top issues from launch week feedback. Announce it. This signals active development and rewards early adopters who gave you feedback.

### Week 3: The Retrospective Post

Write "We launched on HN and here's what happened" — these posts perform extremely well on HN, Dev.to, and Twitter. People love honest post-mortems. Include:
- What the numbers looked like (stars, GitHub clones, Discord members)
- The most common feedback
- What you fixed
- What you're building next

This creates a second wave of traffic and demonstrates the kind of transparent, engaged founder behavior that builds community trust.

### Weeks 4-8: Comparison Content

Write "Orkestra vs Devin: a detailed comparison" and similar posts. These:
- Rank on Google for high-intent searches ("devin alternative", "open source ai coding tool")
- Demonstrate you understand your competitive position
- Give you a reason to reach out to the communities using those tools

**Rule:** Be honest and fair in comparisons. The developer community will read Devin's docs and verify your claims. If you're wrong or unfair, it damages credibility. If you're accurate, it builds it.

### Weeks 4-8: Newsletter and Podcast Outreach

Follow up with any newsletters that expressed interest during launch prep. A 4-6 week lag before following up is normal.

Pitch the Changelog podcast — they cover open source tools regularly and have a dedicated podcast format for project spotlights.

---

## Phase 4: Sustained Growth (Months 2-6)

**Confidence: Medium** — This phase is hardest to plan precisely because it depends heavily on what you learn in Phase 3. The activities below are the most reliable growth drivers regardless of what the data shows.

### Monthly Cadence

- **Release every 2-4 weeks** with a changelog entry. Even small improvements signal active development. A repo with no commits for 3 weeks looks abandoned.
- **"State of the project" post** monthly or quarterly — what you built, what you learned, what's coming. Post to HN ("Ask HN: how are you using Orkestra?"), Dev.to, and your newsletter.
- **Office hours** — A monthly 1-hour open video call where anyone can ask questions. Record and post. You learn more about user problems in one session than in 50 async GitHub issues.

### Content Priorities

1. "Build X with Orkestra" tutorial posts — pick real, non-trivial tasks and document the full pipeline
2. Technical deep-dives on architecture decisions — these rank on Google and establish thought leadership
3. Video demos of new features — record every major feature addition

### Conference Talks

Submit talk proposals to:
- RustConf (submission window usually in spring/summer)
- AI Engineer Summit
- FOSDEM (January, submit in fall)

A conference talk accepted is 3-6 months of lead time, but it generates YouTube content, press coverage, and community credibility that compounds.

### v1.0 as a Second Launch Event

Plan a v1.0 milestone with enough changes to justify a second major launch. This is typically 4-6 months after the initial launch. Use it for:
- A second Show HN post (legitimate with enough changes)
- Product Hunt relaunch
- Press outreach (a v1.0 is more newsworthy than a v0.1)

---

## Timeline Summary

```
Weeks -8 to -6  │  Foundation: product readiness, demo video, early access
Weeks -4 to -2  │  Soft launch: draft HN post, newsletter outreach, early access feedback
Week 0          │  Launch: HN (Day 1) → r/rust (Day 3) → Product Hunt (Day 7-10)
Weeks 1-2       │  Fix: v0.1.1 with launch feedback, respond to everything
Weeks 3-4       │  Retrospective post, comparison content
Weeks 5-8       │  Newsletter coverage, podcast pitches, second release
Months 2-3      │  Sustained content, monthly releases, office hours
Months 4-6      │  Conference talks submitted, v1.0 planning
Month 6+        │  v1.0 as second launch event
```

---

## Tradeoffs and Risk Assessment

### The "Launch Too Early" Risk

**High probability, high impact.** The most common failure mode for open source tools is a painful first-run experience. Technical early adopters on HN are the most valuable users and the most unforgiving. A broken install or confusing workflow on launch day creates a negative impression that's very hard to reverse.

**Mitigation:** Watch 3 people install and run Orkestra from scratch before launch. Fix every friction point. Delay launch if needed.

### The "Launch and Disappear" Risk

**High probability for solo founders, high impact.** The #1 reason developer tool communities fail is founder disappearance. If you post to HN and then go quiet for 2 weeks, the community dissolves. Users interpret silence as abandonment.

**Mitigation:** Block 3+ hours on launch day for HN. Plan a release within 2 weeks of launch. Set a calendar reminder for monthly community updates.

### The "Wrong Audience" Risk

**Medium probability.** Orkestra's pipeline-based approach is a cultural fit for teams that already have code review processes and want to add AI in a controlled way. It's a bad fit for developers who want fully autonomous AI. If HN feedback is "this is too much overhead", that's a signal about audience fit, not product quality.

**Mitigation:** Frame Orkestra honestly for teams that value oversight, not as a competitor to Devin for pure autonomy. The positioning docs are explicit about this.

### The "No Distribution" Risk

**Low probability if the plan is followed.** HN + GitHub is sufficient for a successful developer tool launch. The risk is skipping the distribution phase and expecting organic GitHub discovery to do the work.

**Mitigation:** Follow the launch week plan. HN is the one non-negotiable.
