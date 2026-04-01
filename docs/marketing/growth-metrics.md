# Growth Metrics

What to track, why, and what good looks like.

## North Star Metric

**Weekly Active Repositories** — the number of distinct repos running at least one Orkestra workflow per week.

This measures actual usage, not just installation. It answers: "Is Orkestra part of people's real work?"

Everything else is either a leading indicator (feeds into this) or a lagging indicator (follows from it).

**Implementation note:** This requires opt-in telemetry. See the telemetry section at the bottom.

---

## Acquisition Metrics

How people discover and arrive at Orkestra.

| Metric | Where to find it | What good looks like |
|--------|-----------------|---------------------|
| GitHub stars | GitHub repo | 100 in week 1 (launch); 1,000 by month 3 |
| GitHub clones/week | GitHub Insights → Traffic | Clones >> views signals word-of-mouth |
| Website unique visitors | Analytics (Plausible / Fathom) | Traffic source breakdown matters more than total |
| Email list size | Email provider | Growth rate > absolute number |
| HN upvotes on launch post | HN | 100+ = successful launch; 300+ = great launch |

**Note on GitHub stars:** Stars are social proof but not usage. A tool with 2,000 stars and 5 active users is worse than a tool with 200 stars and 50 active users. Track stars for the signal they give (is word getting out?) but don't optimize for star count at the expense of genuine usage.

---

## Activation Metrics

Are people who install actually using Orkestra?

| Metric | Description | Target |
|--------|-------------|--------|
| % who create first task | Of all installs, how many create even one task? | >50% in month 1 |
| % who complete first workflow | Of those who create a task, how many complete plan→review→merge? | >30% in month 1 |
| Time to first completed workflow | From install to first completed workflow | <30 minutes ideally |

**Why activation matters more than acquisition:** 1,000 installs that all fail at first run is worse than 50 installs that all succeed. Activation rate is the best proxy for "does the product actually work" that you can measure.

**Improving activation:** Watch people install and use it. Not surveys, not analytics — actually watch. This is the highest-leverage thing you can do in the first 3 months.

---

## Retention Metrics

Are people coming back?

| Metric | Description | Target (rough) |
|--------|-------------|----------------|
| Day-7 retention | % of week-1 users still active in week 2 | >40% |
| Day-30 retention | % of month-1 users still active in month 2 | >20% |
| Day-90 retention | % of users still active after 3 months | >10% |

**For open source tools:** These numbers are harder to measure precisely without telemetry, but are the most important signal of product-market fit. A tool with low retention hasn't solved the problem well enough. A tool with high retention has found its audience.

---

## Community Metrics

Is a community forming around the tool?

| Metric | Target (6 months) |
|--------|------------------|
| Discord members | 500+ |
| GitHub Discussions posts/week | 5+ |
| GitHub Issues opened/week | 5+ (engagement signal) |
| External PRs/month | 3+ |
| % of Discord questions answered by non-founders | >30% |

**The community self-sufficiency ratio** (% of questions answered without founder involvement) is the best signal that a real community has formed. When this exceeds 30%, the community can sustain itself.

---

## Vanity Metrics

Track these for context, but don't optimize for them:

- **Total GitHub stars** — Social proof, not usage
- **Twitter followers** — Audience size, not customer acquisition
- **ProductHunt votes** — One-day event, not sustained growth

These numbers look good in screenshots but don't predict whether Orkestra is actually helping people.

---

## Reporting Cadence

**Weekly (quick check):**
- GitHub stars delta
- New GitHub Issues
- Discord new members
- Any notable feedback or bug reports

**Monthly (real analysis):**
- Week-over-week active repo count
- Activation and retention trends
- Traffic sources (which channels are actually driving usage)
- Community health signals
- What the top 3 user complaints are

**Quarterly (strategic):**
- Are we growing? At what rate?
- What's the conversion funnel breakdown?
- Who are our most active users and what do they have in common?
- Is the north star metric moving in the right direction?

---

## Implementing Telemetry

Measuring activation and retention without telemetry requires user surveys, which are unreliable and low-response. But telemetry in developer tools is contentious — developers distrust "phone home" behavior and will disable or fork tools that collect data without consent.

**The only acceptable approach for open source developer tools:**

1. **Opt-in only.** Never collect anything by default.
2. **Explicit prompt at first run:** "Would you like to send anonymous usage stats to help improve Orkestra? This sends [specific list of events]. No code or file contents are ever sent. [y/N]"
3. **Explicit docs page** explaining exactly what is collected, where it goes, and how to disable it
4. **Local flag to disable:** `orkestra telemetry disable` should completely stop all data collection
5. **Open source the telemetry endpoint** or use a self-hostable analytics tool (PostHog self-hosted)

**What to collect (if user opts in):**
- Install event (version, OS, provider)
- Task created event (no content, no metadata)
- Workflow completed event (stages completed, no artifacts)
- Error events (error type, not message — no user data in messages)

**What to never collect:**
- Code content
- Task descriptions
- File paths or project names
- Personally identifiable information of any kind

**Confidence:** High — This approach is modeled on Homebrew's telemetry, which is well-regarded in the developer community despite initial controversy. Explicit opt-in with clear disclosure is the right bar.

---

## Competitive Benchmarks

To calibrate expectations:

| Tool | Launch → 1k stars | Launch → 10k stars |
|------|-------------------|---------------------|
| Atuin | ~1 month | ~6 months |
| Mise (rtx) | ~2 weeks | ~3 months |
| Zed editor | ~1 week (had pre-existing reputation) | ~1 month |
| Supabase | ~3 months | ~18 months |

These are successful tools in a comparable space. Realistic Orkestra targets:
- 1k stars: 1-2 months after a successful HN launch
- 100 active repos/week: 3-6 months
- 10k stars: 12-18 months (requires sustained content + multiple launch events)

**Confidence: Medium** — Trajectory varies hugely based on launch execution, product quality, and market timing. These are directionally correct benchmarks, not guarantees.
