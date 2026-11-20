// The cases only real git can answer about the project checkout and what it takes from
// its remote — status, fetch, pull, stash, reconcile. Split off from `vcs-git.test.ts` so
// the files run beside each other; sending to the remote is `vcs-git-push.test.ts`.

import { Layer } from "effect"
import { NodeProcessLayer } from "../../src/agent/adapters/process-node.js"
import { GitCliLayer } from "../../src/vcs/adapters/git-cli.js"
import { testRepo } from "../support/vcs-fixture.js"
import { vcsGitRemoteContract } from "./vcs.js"

vcsGitRemoteContract({
  label: "git",
  repository: testRepo,
  layer: (repoDir) => GitCliLayer(repoDir).pipe(Layer.provide(NodeProcessLayer)),
  timeoutMs: 20_000,
})
