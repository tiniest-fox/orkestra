{{! The `runs` figure's grammar. Rendered into the contract only for a step whose
    agent declares `figure: runs` on a section. Named `runs` rather than `checks`
    because `checks:` already names a step's scripts. `result:` is a closed set because
    the client draws one verdict per value. Stored inside filed documents, so the old
    form must still parse after any change. }}
`runs` — one item per thing you ran, in the order you ran it, each ended by a blank
line. The first line names the run; `result:` is `passed`, `failed` or `not run`;
`said:` is what it said, or why it did not run. A run that an earlier failure
stopped says `after <that run> failed`. Then, once each and after every run,
`cost:` says whether money was spent and `after:` what takes effect only once a
person restarts or runs something; leave `after:` out when nothing waits.

```runs
New case before the fix
result: failed
said: Failed as it should: the log existed (expected true to be false).

New case after the fix
result: passed
said: Passed.

lint
result: failed
said: 1 error: no-floating-promises at app/vcs.ts:1482.

test
result: not run
said: after lint failed

cost: None.
after: A running server picks this up only after a restart.
```
