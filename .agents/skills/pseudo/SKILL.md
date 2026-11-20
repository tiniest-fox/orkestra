---
name: pseudo
description: Use when writing or reading pseudo-code — any ```pseudo fence — in a stillroom take, a walkdown record, or any other markdown a tiniestfox tool draws, or when asked to sketch how some code, job or flow works at the level of its decisions rather than its lines.
---

# Pseudo-code

One notation for describing how something works without writing the code. It has a small
fixed core, **rules** that wrap a block, and **holes** for what is not worth spelling out.
The reader is a person skimming a page, so a block has to read cold, without this guide.

The tools that install this skill draw a ` ```pseudo ` fence coloured, inside a
dashed edge marked `pseudo`, so it is never mistaken for code that runs. Each tool's own
skill says where in its pages pseudo belongs; this one says how to write it.

## The notation

- **Core:** `x = value`, `define name(args)`, `each x in xs`, `while`, `if` / `else`,
  `return`, `skip`. Indentation, two spaces, is the only block delimiter. Assignment is `=`;
  compare with `==` or plain words (`if status is done`).
- **Rules line:** a line with an indented body that is not a core keyword. Comma-separated
  bare words, phrases or `key: value` pairs: `parallel, retries: 3, timeout: 5s`. The rules
  apply loosely to everything in the block below. Any wording works; there is no fixed list.
- **Rules on a loop head:** after the first comma, `each key in keys, parallel`.
- **Handlers** are rules blocks placed _inside_ the block they handle: `when: error`,
  `when: success`, `when: empty`, `when: timeout`, `when: cancelled`,
  `when: <specific error>`, `finally`, `undo` (how to reverse this block if a later step
  fails), `each retry`.
- **Hole:** `{a brief stand-in}` hand-waves something that is not worth showing. Braces mean
  nothing else, so data is written `[a, b]` or in words.
- **Comment:** `#` to the end of the line.
- Fence every block as ` ```pseudo `.

```pseudo
# Nightly job: pull changed accounts from upstream and merge them in
define sync_accounts(since)
  pages = {every page of accounts changed upstream since the last run}

  each page in pages
    parallel, retries: 3, timeout: 5s
      each account in page.accounts
        record = fetch_details(account.id)
        merged = {merge record into our copy; upstream wins conflicts}

        atomic
          save(merged)
          mark account.id synced at now

      when: error
        log("skipped", account.id)

      finally
        update progress

  return number of accounts synced
```

```pseudo
each page in pages
  parallel, retries: 3, timeout: 5s
    each account in page.accounts
      record = fetch_details(account.id)
      save(record)

      undo
        restore(account.id, {previous snapshot})

    when: rate limited
      wait {until the upstream window resets}
    when: error
      log("skipped", account.id)
    when: success
      mark page done
    finally
      update progress

  when: empty
    log("nothing changed since", since)
```

## Writing it well

**One statement, one line.** Never continue a long statement on an indented next line: an
indented line under a statement makes that statement a rules line. Shorten it, or put part
of it in a hole.

**Call syntax names only what is real.** A call like `fetch_details(account.id)` reads as a
function that exists, and is coloured as code colours a call. Use it only for something
that exists in the code being described, or that a `define` in the same block declares.
Everything else is plain words (`mark account.id synced at now`) or a hole. Backticks mean
nothing here; a name is real because it is called or defined, not because it is quoted.

**Holes hand-wave; they do not ask.** A hole is a short stand-in for a step whose detail
would cost the reader more than it tells them: `{merge record into our copy; upstream wins
conflicts}`. It can say what the step produces or holds to. It is not an open question, and
a reader does not raise it as one.

**Stay at the level of decisions.** Show the shape of the work and what matters in it:
ordering, concurrency, failure, what happens to data. Stop where what is left is choices
any implementation would make. If it would nearly compile, it is too detailed.

**Do not import another language's syntax.** No `do`, `try` / `except` / `catch`, `async` /
`await`, decorators, semicolons, braces for blocks, `←`, or type annotations. Concurrency,
retries, timeouts and transactions are rules lines, not calls like `retry(3)` or
`with transaction()`.

**Put rules directly above what they govern.** Wrap the narrowest block a rule applies to.
If only the fetch retries, wrap only the fetch:

```pseudo
timeout: 5s, retries: 3
  record = fetch_details(account.id)
save(record)
```

**Consider the handlers.** For anything that touches the network, another service, or more
than one store, decide which the reader needs: `when: error`, `when: empty`,
`when: timeout`, `undo`. They are usually the most valuable lines in a sketch and the ones
most often missing. Do not add a handler that restates the obvious.

**Keep it short.** Aim for blocks under about 25 lines. Split a larger flow into several
`define`s, each with a sentence of prose around it. Prose says _why_; the pseudo-code shows
_what happens_.

## Reading it

- A line with an indented body that is not a core keyword is a rules line, and its rules
  apply loosely to the whole block below.
- Handlers belong to the block they are indented inside.
- A loop is always `each x in xs`. `each` without `in`, as in `each retry`, is a handler.
- `and`, `or`, `not` and `is` join a condition only in an `if`, `else if` or `while` head,
  and `in` is a keyword only in a loop head; anywhere else they are plain words.
- `{…}` is a step the author chose not to spell out. Read it as a summary, and go to the
  code it stands for when the detail matters.
- A call names something real. When the block sits beside code, that is where to find it.

## Before finishing

- No statement runs onto a second line.
- Every call names something that exists or that the block defines; the rest is words or
  holes.
- Indentation is a consistent two spaces, and only core blocks and rules lines have
  indented bodies.
- Rules sit directly above the narrowest block they govern.
- Anything that can fail has the handlers the reader needs.
- No syntax borrowed from Python, Ruby, JavaScript or similar.
- Fenced as ` ```pseudo `.
