{{! The description the git bar hands the New Trak page when a reconcile would
    conflict. Not a turn's body: a person reads it in the description field, may
    edit it, and starts the trak themselves — so it is written as a request, in
    the words a person would have typed, and it carries everything the bar knew.

    The trak's checkout is cut from the local branch, and the remote-tracking
    ref is one every worktree of the repository shares, so the merge it asks for
    needs no fetch and no remote. }}
Merge `{{upstream}}` into `{{branch}}` and resolve the conflicts.

`{{branch}}` and `{{upstream}}` have both moved on, and merging them conflicts in:

{{#files}}
- `{{.}}`
{{/files}}

Run `git merge {{upstream}}` in this checkout. Resolve each conflict so that what both sides set out to do still holds, then commit the merge. Change nothing the merge does not need.
