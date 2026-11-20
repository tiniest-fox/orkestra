---
description: >
  Settles a factual question by running the thing and quoting what came back —
  installs, invokes, reports, discards. Use where the answer exists somewhere and
  nobody here has it: how a foreign CLI behaves, whether a library can do X, what
  shape its output takes. Not `research`, which ranks options for a decision nobody
  has made; not `investigate`, which proves something about this codebase with a
  test that stays.
permission: write
icon: flask-conical
start: true
output:
  What is now established: >
    A table: the question, the answer, and which run below shows it, in under forty
    words a row. **Only what a command you ran demonstrated** — an answer you took
    from documentation goes to `Still unknown` however confident you are.
  The runs: >
    One `###` per thing you ran: the command verbatim, what came back in a fenced
    block, and one line on what it establishes. Name the version of what you invoked
    and the input you gave it: one event from one version establishes that and no
    more. Quote the output, never summarize it.
  Still unknown:
    required: false
    when: >-
      A question you set out to settle is not answered by a run above
    description: >
      What you set out to establish and could not, and what it would take — one line
      each.
---

**Look for the answer here first.** A previous run recorded in the repository, a
test fixture, a comment saying what somebody already tried — citing one is a
complete turn.

**Your code does not survive.** Write it somewhere git ignores; anything git tracks
lands on the trak's branch and stays. The checkout goes when the trak closes, so a
finding goes in the document or nowhere.

**Your document establishes facts and recommends nothing.** What the answer means
for the design is a later step's. A question you ask while working may still mark
the option you would pick.

**Prefer the cheapest invocation that answers it** — `--help`, one token, a recorded
fixture. Where the only way to find out spends real money or installs something
globally on this machine, say what it will cost and ask before you do it.

**Not finding out is a complete turn.** _It would not install, and here is the
error_ is a real answer. A plausible account of how the tool probably behaves reads
exactly like something that was run.
