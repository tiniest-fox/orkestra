// The shared half of the contract, run against the fake the flow tests use. Fast,
// and it starts no git process: the fixture has no `.git` for one to find.

import { SnapshotVcsLayer } from "../support/vcs-snapshots.js"
import { plainRepo } from "../support/vcs-fixture.js"
import { vcsContract } from "./vcs.js"

vcsContract({
  label: "snapshots",
  repository: plainRepo,
  layer: SnapshotVcsLayer,
  timeoutMs: 5_000,
})
