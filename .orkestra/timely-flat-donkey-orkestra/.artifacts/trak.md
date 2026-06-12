**Trak ID**: timely-flat-donkey
**Title**: Add out-of-sync icon with higher precedence

### Description
When a Trak is in the done state, we have a series of different icons / colors we use for different states. I want to add one for not in sync with remote that sits higher in the precedence than “failed checks”.

The idea is we tend to have:
- Trak finishes
- Open PR
- Checks fail
- Fix checks
- Trak finishes but looks like it has failed checks when really it’s out of sync with main and needs to be pushed

In that last case I want it to be clear that the next stpe is sync with main, not fix checks. So a new icon and color.