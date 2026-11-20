Merge the default branch, as `origin` holds it now, into this goal's branch, and push the
result. It takes no arguments and goes one way only: the goal branch reaches the default
branch through the pull request the person merges once the goal is done.

- A clean merge finishes inside this call. Nothing else is needed.
- A conflict changes nothing on the goal branch. The answer names the conflicting paths
  and the default branch's commit it was merging.

Refused on a goal with no goal branch, on a sub-goal, and while the goal is paused.
