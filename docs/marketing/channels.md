# Launch Channels

Channels ranked by expected ROI for a solo technical founder launching a developer tool.

## Tier 1: Do These First

### Hacker News (Show HN)

**Confidence: High** — The single highest-value channel for developer tools targeting technical founders and early adopters.

**What to expect:**
- A good Show HN for a Rust/AI tools post reaches 200-500 upvotes and drives 2,000-10,000 unique visitors in 24 hours
- A mediocre post gets 20-50 upvotes and fades in 2 hours — no second chances

**Requirements for success:**
- Working product that installs and runs without handholding
- Honest, humble framing — HN is allergic to hype
- Founder responds to every comment in the first 2 hours (this is non-negotiable; it's how the algorithm works)
- Technical depth in your responses, not marketing language

**Timing:**
- Post Tuesday to Thursday, 7–9am US Eastern time
- Avoid Mondays, Fridays, and weekends — lower traffic and different audience composition

**Title formula that works:**
> "Show HN: Orkestra – open source AI coding workflow with human-in-the-loop approvals"

The title should be descriptive, not clever. HN users skim.

**One shot:** Do not post prematurely. You get one Show HN per product. Use it when the product is genuinely ready. If the first HN post lands poorly, a second one is near-impossible to recover.

**Comparable launches:** Zed editor, Atuin (shell history), Mise (runtime manager), Supabase all used Show HN as their primary launch channel with strong results.

---

### GitHub

**Confidence: High** — It's not just a repository; it's a discovery channel.

**GitHub Trending:** Reaching the daily Trending page for Rust repos requires ~20-50 stars/day. A successful HN post usually provides this. Trending drives significant organic traffic but it's downstream of external channels, not a primary strategy.

**Repository hygiene (do these before launch):**
- Add a clear one-line description: "AI-powered dev workflow automation with human-in-the-loop approvals. Self-hosted."
- Set all relevant Topics/tags (at least 10): `rust`, `tauri`, `ai-agents`, `workflow`, `developer-tools`, `claude`, `code-generation`, `automation`, `git`, `open-source`
- Add a social preview image (1280x640px) — this image appears in all Twitter/Slack/HN link unfurls
- Pin the repo on your GitHub profile

**Stars as social proof:** 100 stars is a hobby project. 1,000 stars starts to feel legitimate. 5,000 stars is a community. The trajectory matters as much as the number — a repo with 500 stars growing by 50/week looks healthier than one stuck at 3,000.

---

### Twitter/X

**Confidence: Medium** — The AI and developer tools community is real and active here, but reach has declined since 2023 algorithmic changes.

**Who to reach:**
- AI engineering community: Simon Willison, swyx, Andrej Karpathy, Linus Lee
- Rust community: ThePrimeagen, Thorsten Ball
- Dev tools: Theo Browne, Fireship

**What works:**
- A 60-second demo video or GIF showing the actual workflow (plan → implement → review)
- "I built X, here's how it works" thread — no pitch, just technical explanation
- Building in public before launch (see [content-strategy.md](content-strategy.md))

**What doesn't work:**
- Cold "please check out my project" DMs
- Text-only posts explaining a workflow that needs to be seen
- Posting without an established account — start building the account 6-8 weeks before launch

---

## Tier 2: High Value for Specific Audiences

### Reddit

**Confidence: Medium-High** for the right subreddits

**Best subreddits for Orkestra:**

| Subreddit | Audience | Angle | Expected reach |
|-----------|----------|-------|----------------|
| r/rust | Rust developers | Implementation story, performance | Medium (300k members, engaged) |
| r/LocalLLaMA | AI/LLM enthusiasts | Self-hosted AI, model support | Medium-high (2M+ members) |
| r/MachineLearning | ML practitioners | Multi-agent architecture | Low (high bar for posts) |
| r/programming | General dev | Open source launch | Low-medium (competitive) |
| r/devops | DevOps/platform engineers | CI/CD integration, automation | Low-medium |

**Rules:**
- Do not post to multiple subreddits on the same day — it looks like spam
- Read each subreddit's rules before posting. r/rust allows project posts; r/programming is stricter
- r/rust is your strongest bet: the community actively celebrates open source Rust projects
- Post 2 days after HN with a different angle (technical implementation for r/rust, not the same marketing pitch)

---

### YouTube

**Confidence: Medium** (high ceiling, high effort)

**The key asset:** A 5-10 minute video showing a *real* coding task going through the full Orkestra pipeline. Not a screencast of the README — an actual task being planned, implemented, reviewed, and merged with visible AI output and human decisions.

**Distribution options:**
- Self-hosted on your channel (slow burn, long-tail SEO value)
- Pitching to Fireship, ThePrimeagen, or Theo Browne for coverage (very high impact, hard to land)

**Pitching to creators:**
- Don't cold-DM asking for review
- Engage with their content for 4-6 weeks first
- Lead with what's interesting to *their audience*, not to you
- Offer a working demo environment + exclusive early access, not just a GitHub link

---

### Product Hunt

**Confidence: Low-Medium** for developer tools specifically

Product Hunt has shifted toward consumer/SaaS products. Developer tools often underperform relative to effort. Still worth doing — a #1 Product of the Day is a credential that helps with press pitches.

**If you do it:**
- Launch 1-2 weeks *after* HN, not simultaneously
- Find a hunter with 1,000+ followers to post it (reach out 2-3 weeks in advance)
- Prepare a compelling GIF/video and tagline
- Mobilize your Discord/email list to vote on launch day

---

## Tier 3: Sustained Growth

### Dev.to / Hashnode

**Confidence: Medium** for long-term SEO

Good for long-form technical content that ranks on Google. Not a primary launch channel but drives slow, steady organic traffic over time.

Write here:
- "Why we built Orkestra in Rust" — performance, safety, correctness story
- "The problem with fully autonomous AI coding agents" — human-in-the-loop philosophy
- "Git worktrees: how we give each AI agent isolated context"
- "Building configurable AI workflows with YAML"

Host on your own domain (via Hashnode) for SEO benefit. Dev.to has built-in audience distribution.

---

### Newsletters

**Confidence: Medium** — targeted but relationship-dependent

Relevant newsletters:
- **TLDR Newsletter** — 1M+ subscribers, strong developer audience, covers open source tools
- **Changelog** — Developer-focused, has covered similar tools
- **Ahead of AI** — AI engineering focus, smaller but highly targeted
- **Console.dev** — Developer tools newsletter, often covers open source

Approach: short, direct email. "Hi, I launched Orkestra — [one sentence]. Here's a demo link. Happy to give you early access." No press releases, no lengthy pitches.

---

### Awesome Lists

**Confidence: Low-Medium** — slow burn, still worth doing

Curated "awesome" lists on GitHub drive a steady trickle of stars and discovery. Submit after launch (need existing stars for maintainers to accept):
- awesome-ai-tools
- awesome-rust
- awesome-developer-tools
- awesome-open-source-alternatives

Open PRs to the most relevant ones 1-2 weeks post-launch.

---

### Conference Talks

**Confidence: Medium** (6+ month horizon)

Submit to:
- **RustConf** — Rust community, obvious fit for the implementation story
- **AI Engineer Summit** — AI engineering practitioners, direct audience
- **FOSDEM** — European open source developers, strong community values fit

Talk angles:
- "Building reliable AI coding pipelines in Rust" — technical
- "Why human-in-the-loop beats fully autonomous agents (for now)" — opinionated, controversial enough to be interesting

Conference talks drive a long tail of YouTube views and GitHub stars over 6-12 months.

---

## What to Ignore (at First)

- **LinkedIn** — Not where developers discover tools. Fine for B2B SaaS, not for open source dev tools.
- **Instagram/TikTok** — Wrong audience entirely.
- **Press releases** — Tech journalists don't cover open source launches without a relationship or a very unusual hook. Save the energy.
- **Paid ads** — Developer tools with no established trust perform terribly with paid ads. Build organic credibility first.
